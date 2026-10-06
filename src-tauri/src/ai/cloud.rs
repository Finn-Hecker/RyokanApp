//! Native adapters share transport and batching, while retaining their own protocol mappers.
use super::{
    api_error_from_body, apply_compatible_sampling, count_at, flush_batches,
    merge_additional_api_parameters, merge_token_usage, parse_additional_api_parameters,
    parse_token_usage, read_error_body, request_stream_usage, response_text, stream_token_usage,
    transport_error, AiRequest, ModelInfo, ModelReasoningInfo, StreamFailure, TokenUsage, CLIENT,
};
use eventsource_stream::Eventsource;
use futures::StreamExt;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::Window;
use tokio_util::sync::CancellationToken;
mod anthropic;
mod gemini;
mod nanogpt;
#[cfg(test)]
mod tests;

// Explicit application fallback caps, mirrored by providerTokenBudget.ts.
const ANTHROPIC_DEFAULT_OUTPUT_CAP: u32 = 4096;
const GEMINI_DEFAULT_OUTPUT_CAP: u32 = 8192;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum CloudProvider {
    NanoGpt,
    Anthropic,
    Gemini,
}

impl CloudProvider {
    pub(super) fn parse(kind: Option<&str>) -> Option<Self> {
        match kind {
            Some("nanogpt") => Some(Self::NanoGpt),
            Some("anthropic") => Some(Self::Anthropic),
            Some("gemini") => Some(Self::Gemini),
            _ => None,
        }
    }
}

pub(super) fn is_provider(kind: Option<&str>) -> bool {
    CloudProvider::parse(kind).is_some()
}

fn validate_base(base: &str, kind: CloudProvider, key: &str) -> Result<String, String> {
    if key.trim().is_empty() {
        return Err("Enter an API key for this provider.".into());
    }
    let expected = match kind {
        CloudProvider::NanoGpt => "https://api.nano-gpt.com/api/v1",
        CloudProvider::Anthropic => "https://api.anthropic.com/v1",
        CloudProvider::Gemini => "https://generativelanguage.googleapis.com/v1beta",
    };
    if base.trim_end_matches('/') != expected {
        return Err("This provider requires its official API base URL. Use Custom for compatible endpoints.".into());
    }
    Ok(expected.into())
}

fn authenticate(
    request: reqwest::RequestBuilder,
    kind: CloudProvider,
    key: &str,
) -> reqwest::RequestBuilder {
    match kind {
        CloudProvider::Anthropic => request
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01"),
        CloudProvider::Gemini => request.header("x-goog-api-key", key),
        CloudProvider::NanoGpt => request.bearer_auth(key),
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
        result = request.send() => result.map(Some).map_err(|e| {
            crate::diagnostics::record(crate::diagnostics::Event::TransportFailed);
            transport_error(&e, model)
        }),
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
        input_token_limit: None,
        output_token_limit: None,
        parameter_source: Some("model_metadata"),
        thinking_supported: None,
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
    let kind = CloudProvider::parse(Some(kind)).ok_or("Unsupported cloud provider")?;
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
            CloudProvider::NanoGpt => request.query(&[("detailed", "true")]),
            CloudProvider::Anthropic => request.query(&[("limit", "1000")]),
            CloudProvider::Gemini => request.query(&[("pageSize", "1000")]),
        };
        if let Some(value) = &cursor {
            request = request.query(&[(
                if kind == CloudProvider::Anthropic {
                    "after_id"
                } else {
                    "pageToken"
                },
                value,
            )]);
        }
        let value = json_response(request, key, "", &[]).await?;
        let entries = value
            .get(if kind == CloudProvider::Gemini {
                "models"
            } else {
                "data"
            })
            .and_then(Value::as_array)
            .ok_or("The model list has an invalid format.")?;
        for entry in entries {
            let model = match kind {
                CloudProvider::NanoGpt => nanogpt::model(entry),
                CloudProvider::Anthropic => anthropic::model(entry),
                CloudProvider::Gemini => gemini::model(entry),
            };
            if let Some(model) = model {
                models.push(model);
            }
        }
        cursor = match kind {
            CloudProvider::Anthropic if value.get("has_more") == Some(&Value::Bool(true)) => Some(
                value
                    .get("last_id")
                    .and_then(Value::as_str)
                    .filter(|s| !s.is_empty())
                    .ok_or("The model list is missing its pagination cursor.")?
                    .into(),
            ),
            CloudProvider::Gemini => value
                .get("nextPageToken")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .map(str::to_owned),
            CloudProvider::Anthropic | CloudProvider::NanoGpt => None,
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
    finish_reason: Option<String>,
}

fn decode(kind: CloudProvider, data: &str) -> Result<CloudEvent, StreamFailure> {
    if kind == CloudProvider::NanoGpt && data.trim() == "[DONE]" {
        return Ok(CloudEvent {
            terminal: true,
            finished: true,
            ..Default::default()
        });
    }
    let value: Value = serde_json::from_str(data).map_err(|_| {
        StreamFailure::Protocol("The provider sent malformed streaming JSON.".into())
    })?;
    if value.get("error").is_some() {
        return Err(StreamFailure::Provider(data.into()));
    }
    if kind == CloudProvider::Anthropic && value.get("type").and_then(Value::as_str).is_none() {
        return Err(StreamFailure::Protocol("Anthropic stream event is missing its type.".into()));
    }
    match kind {
        CloudProvider::NanoGpt => nanogpt::event(&value).map_err(StreamFailure::Provider),
        CloudProvider::Anthropic => anthropic::event(&value).map_err(StreamFailure::Provider),
        CloudProvider::Gemini => gemini::event(&value).map_err(StreamFailure::Provider),
    }
}

// New providers share batching and cancellation primitives, not the legacy parser.
async fn consume<F>(
    response: reqwest::Response,
    kind: CloudProvider,
    token: &CancellationToken,
    summary: bool,
    mut flush: F,
) -> Result<Option<TokenUsage>, StreamFailure>
where
    F: FnMut(&mut String, &mut String) -> Result<(), String>,
{
    let mut stream = response.bytes_stream().eventsource();
    let mut text = String::new();
    let mut thinking = String::new();
    let mut usage = None;
    let mut finished = false;
    let mut finish_reason = None;
    let mut tick = tokio::time::interval(Duration::from_millis(25));
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        tokio::select! {
            biased;
            _ = token.cancelled() => { flush(&mut text, &mut thinking).map_err(StreamFailure::Delivery)?; return Ok(usage); }
            event = stream.next() => {
                let Some(event) = event else { break; };
                let event = event.map_err(|_| StreamFailure::Transport("The provider stream was interrupted.".into()))?;
                let event = decode(kind, &event.data)?;
                if let Some(reason) = event.finish_reason {
                    super::validate_summary_completion(summary, Some(&reason))?;
                    finish_reason = Some(reason);
                }
                text.push_str(&event.text);
                thinking.push_str(&event.thinking);
                if let Some(incoming) = event.usage { usage = Some(merge_token_usage(usage, incoming)); }
                finished |= event.finished;
                if event.terminal { break; }
            }
            _ = tick.tick() => flush(&mut text, &mut thinking).map_err(StreamFailure::Delivery)?,
        }
    }
    flush(&mut text, &mut thinking).map_err(StreamFailure::Delivery)?;
    if !finished {
        return Err(StreamFailure::Protocol(
            "The provider stream ended before completion.".into(),
        ));
    }
    super::validate_summary_completion(summary, finish_reason.as_deref())?;
    Ok(usage)
}

pub(super) async fn generate(
    window: &Window,
    payload: &AiRequest,
    token: &CancellationToken,
) -> Result<Option<TokenUsage>, String> {
    let kind = CloudProvider::parse(payload.provider_kind.as_deref())
        .ok_or("Unsupported cloud provider")?;
    let base = validate_base(&payload.url, kind, &payload.api_key)?;
    let mut additional = parse_additional_api_parameters(
        &Value::Object(
            payload
                .request_parameter_config
                .additional_parameters
                .clone(),
        )
        .to_string(),
    )?;
    // Preserve the native endpoints' existing rejection of foreign compatibility controls.
    // Summary intent no longer generates these fields; explicit legacy JSON stays compatible.
    match kind {
        CloudProvider::NanoGpt => {}
        CloudProvider::Anthropic | CloudProvider::Gemini => {
            additional.remove("chat_template_kwargs");
            additional.remove("reasoning");
        }
    }
    let (url, body) = match kind {
        CloudProvider::NanoGpt => (
            format!("{base}/chat/completions"),
            nanogpt::body(payload, additional)?,
        ),
        CloudProvider::Anthropic => (
            format!("{base}/messages"),
            anthropic::body(payload, additional)?,
        ),
        CloudProvider::Gemini => (
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
        let Some(body) = read_error_body(response, token).await else {
            return Ok(None);
        };
        return Err(api_error_from_body(
            status,
            &body,
            &payload.api_key,
            &payload.model,
            &payload.messages,
        ));
    }
    consume(response, kind, token, payload.request_parameter_config.purpose == Some(super::parameters::RequestPurpose::Summary), |text, thinking| {
        flush_batches(window, text, thinking, &payload.generation_id)
    })
    .await
    .map_err(|error| error.into_ipc(payload))
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
