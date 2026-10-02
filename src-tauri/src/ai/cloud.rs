//! Isolated native adapters. The legacy OpenAI-compatible request/stream path is untouched.
use super::*;
use serde_json::{json, Value};
mod anthropic;
mod gemini;
mod nanogpt;
#[cfg(test)]
mod tests;

// Explicit application fallback caps, mirrored by providerTokenBudget.ts.
const ANTHROPIC_DEFAULT_OUTPUT_CAP: u32 = 4096;
const GEMINI_DEFAULT_OUTPUT_CAP: u32 = 8192;

pub(super) fn is_provider(kind: Option<&str>) -> bool {
    matches!(kind, Some("nanogpt" | "anthropic" | "gemini"))
}

fn validate_base(base: &str, kind: &str, key: &str) -> Result<String, String> {
    if key.trim().is_empty() {
        return Err("Enter an API key for this provider.".into());
    }
    let expected = match kind {
        "nanogpt" => "https://api.nano-gpt.com/api/v1",
        "anthropic" => "https://api.anthropic.com/v1",
        "gemini" => "https://generativelanguage.googleapis.com/v1beta",
        _ => return Err("Unsupported cloud provider".into()),
    };
    if base.trim_end_matches('/') != expected {
        return Err("This provider requires its official API base URL. Use Custom for compatible endpoints.".into());
    }
    Ok(expected.into())
}

fn authenticate(
    request: reqwest::RequestBuilder,
    kind: &str,
    key: &str,
) -> reqwest::RequestBuilder {
    match kind {
        "anthropic" => request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        "gemini" => request.header("x-goog-api-key", key),
        _ => request.bearer_auth(key),
    }
}

async fn json_response(
    request: reqwest::RequestBuilder,
    key: &str,
    model: &str,
    messages: &[Value],
) -> Result<Value, String> {
    let response = request
        .send()
        .await
        .map_err(|e| transport_error(&e, model))?;
    let status = response.status().as_u16();
    let body = response
        .text()
        .await
        .map_err(|e| transport_error(&e, model))?;
    if !(200..300).contains(&status) {
        return Err(api_error_from_body(status, &body, key, model, messages));
    }
    serde_json::from_str(&body).map_err(|_| "The provider returned malformed JSON.".into())
}

async fn send_cancellable(
    request: reqwest::RequestBuilder,
    token: &CancellationToken,
    model: &str,
) -> Result<Option<reqwest::Response>, String> {
    tokio::select! {
        biased;
        _ = token.cancelled() => Ok(None),
        result = request.send() => result.map(Some).map_err(|e| transport_error(&e, model)),
    }
}

fn model_info(
    id: String,
    context: Option<u64>,
    parameters: Vec<String>,
    reasoning: Option<ModelReasoningInfo>,
) -> ModelInfo {
    ModelInfo {
        id,
        context_length: context,
        supported_parameters: Some(parameters),
        reasoning,
        pricing: None,
        architecture: None,
    }
}

pub(super) async fn fetch_models(
    base: &str,
    key: &str,
    kind: &str,
) -> Result<Vec<ModelInfo>, String> {
    let base = validate_base(base, kind, key)?;
    let mut models = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = std::collections::HashSet::new();
    loop {
        let mut request = authenticate(
            CLIENT
                .get(format!("{base}/models"))
                .timeout(Duration::from_secs(30)),
            kind,
            key,
        );
        request = match kind {
            "nanogpt" => request.query(&[("detailed", "true")]),
            "anthropic" => request.query(&[("limit", "1000")]),
            _ => request.query(&[("pageSize", "1000")]),
        };
        if let Some(value) = &cursor {
            request = request.query(&[(
                if kind == "anthropic" {
                    "after_id"
                } else {
                    "pageToken"
                },
                value,
            )]);
        }
        let value = json_response(request, key, "", &[]).await?;
        let entries = value
            .get(if kind == "gemini" { "models" } else { "data" })
            .and_then(Value::as_array)
            .ok_or("The model list has an invalid format.")?;
        for entry in entries {
            let model = match kind {
                "nanogpt" => nanogpt::model(entry),
                "anthropic" => anthropic::model(entry),
                _ => gemini::model(entry),
            };
            if let Some(model) = model {
                models.push(model);
            }
        }
        cursor = match kind {
            "anthropic" if value.get("has_more") == Some(&Value::Bool(true)) => Some(
                value
                    .get("last_id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .ok_or("The model list is missing its pagination cursor.")?
                    .into(),
            ),
            "gemini" => value
                .get("nextPageToken")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            _ => None,
        };
        if let Some(cursor) = &cursor {
            if !seen.insert(cursor.clone()) || seen.len() > 100 {
                return Err("Invalid model-list pagination.".into());
            }
        } else {
            break;
        }
    }
    Ok(models)
}

#[derive(Default, Debug)]
struct CloudEvent {
    text: String,
    thinking: String,
    usage: Option<TokenUsage>,
    terminal: bool,
    finished: bool,
}

fn decode(kind: &str, data: &str) -> Result<CloudEvent, String> {
    if kind == "nanogpt" && data.trim() == "[DONE]" {
        return Ok(CloudEvent {
            terminal: true,
            finished: true,
            ..Default::default()
        });
    }
    let value: Value = serde_json::from_str(data)
        .map_err(|_| "The provider sent malformed streaming JSON.".to_string())?;
    if value.get("error").is_some() {
        return Err(data.into());
    }
    match kind {
        "nanogpt" => nanogpt::event(&value),
        "anthropic" => anthropic::event(&value),
        "gemini" => gemini::event(&value),
        _ => Err("Unsupported provider".into()),
    }
}

// New providers share batching and cancellation primitives, not the legacy parser.
async fn consume<F>(
    response: reqwest::Response,
    kind: &str,
    token: &CancellationToken,
    mut flush: F,
) -> Result<Option<TokenUsage>, String>
where
    F: FnMut(&mut String, &mut String) -> Result<(), String>,
{
    let mut stream = response.bytes_stream().eventsource();
    let mut text = String::new();
    let mut thinking = String::new();
    let mut usage = None;
    let mut finished = false;
    let mut tick = tokio::time::interval(Duration::from_millis(25));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => { flush(&mut text, &mut thinking)?; return Ok(usage); }
            event = stream.next() => {
                let Some(event) = event else { break; };
                let event = event.map_err(|_| "The provider stream was interrupted.".to_string())?;
                let event = decode(kind, &event.data)?;
                text.push_str(&event.text);
                thinking.push_str(&event.thinking);
                if let Some(incoming) = event.usage { usage = Some(merge_token_usage(usage, incoming)); }
                finished |= event.finished;
                if event.terminal { break; }
            }
            _ = tick.tick() => flush(&mut text, &mut thinking)?,
        }
    }
    flush(&mut text, &mut thinking)?;
    if !finished {
        return Err("The provider stream ended before completion.".into());
    }
    Ok(usage)
}

pub(super) async fn generate(
    window: &Window,
    payload: &AiRequest,
    token: &CancellationToken,
) -> Result<Option<TokenUsage>, String> {
    let kind = payload.provider_kind.as_deref().unwrap();
    let base = validate_base(&payload.url, kind, &payload.api_key)?;
    let additional = parse_additional_api_parameters(
        &Value::Object(
            payload
                .request_parameter_config
                .additional_parameters
                .clone(),
        )
        .to_string(),
    )?;
    let (url, body) = match kind {
        "nanogpt" => (
            format!("{base}/chat/completions"),
            nanogpt::body(payload, additional)?,
        ),
        "anthropic" => (
            format!("{base}/messages"),
            anthropic::body(payload, additional)?,
        ),
        _ => (
            gemini::endpoint(&base, &payload.model)?,
            gemini::body(payload, additional)?,
        ),
    };
    let request = authenticate(
        CLIENT
            .post(url)
            .header("Accept", "text/event-stream")
            .json(&body),
        kind,
        &payload.api_key,
    );
    let Some(response) = send_cancellable(request, token, &payload.model).await? else {
        return Ok(None);
    };
    if !response.status().is_success() {
        crate::diagnostics::record(crate::diagnostics::Event::ProviderFailed);
        let status = response.status().as_u16();
        let body = tokio::select! {
            _ = token.cancelled() => return Ok(None),
            body = response.text() => body.unwrap_or_default(),
        };
        return Err(api_error_from_body(
            status,
            &body,
            &payload.api_key,
            &payload.model,
            &payload.messages,
        ));
    }
    consume(response, kind, token, |text, thinking| {
        flush_batches(window, text, thinking, &payload.generation_id)
    })
    .await
    .map_err(|error| {
        api_error_from_body(
            0,
            &error,
            &payload.api_key,
            &payload.model,
            &payload.messages,
        )
    })
}

fn text_messages(payload: &AiRequest) -> Result<(Vec<String>, Vec<Value>), String> {
    let mut system = Vec::new();
    let mut messages = Vec::new();
    for message in &payload.messages {
        let role = message
            .get("role")
            .and_then(Value::as_str)
            .ok_or("Missing message role")?;
        let content = message
            .get("content")
            .and_then(Value::as_str)
            .ok_or("This provider adapter accepts text messages only")?;
        match role {
            "system" => system.push(content.into()),
            "user" | "assistant" => messages.push(json!({"role":role,"content":content})),
            _ => return Err("Unsupported message role for this provider".into()),
        }
    }
    if messages.is_empty() {
        return Err("A conversation message is required.".into());
    }
    Ok((system, messages))
}

fn positive_cap(value: &Value, name: &str) -> Result<u64, String> {
    value
        .as_u64()
        .filter(|n| *n > 0 && *n <= u32::MAX as u64)
        .ok_or_else(|| format!("{name} must be a positive integer."))
}

fn reject_fields(
    parameters: &serde_json::Map<String, Value>,
    fields: &[&str],
) -> Result<(), String> {
    if let Some(field) = fields.iter().find(|field| parameters.contains_key(**field)) {
        return Err(format!(
            "Protected provider field cannot be overridden: {field}"
        ));
    }
    Ok(())
}
