use super::{
    count_at, json, merge_additional_api_parameters, model_info, parse_token_usage, positive_cap,
    reject_fields, response_text, text_messages, AiRequest, CloudEvent, ModelInfo,
    ModelReasoningInfo, TokenUsage, Value, ANTHROPIC_DEFAULT_OUTPUT_CAP,
};
// https://platform.claude.com/docs/en/api/messages/create
// https://platform.claude.com/docs/en/api/models/list
// https://platform.claude.com/docs/en/build-with-claude/streaming
// Sampling was removed after Opus 4.6. Only documented older families opt in;
// unknown/new models use native defaults, never guessed sampling capabilities.
fn legacy_sampling(id: &str) -> bool {
    [
        "claude-3-",
        "claude-3.5-",
        "claude-3-5-",
        "claude-3-7-",
        "claude-sonnet-4-5",
        "claude-opus-4-5",
        "claude-haiku-4-5",
        "claude-sonnet-4-6",
        "claude-opus-4-6",
        "claude-sonnet-4-20250514",
        "claude-opus-4-20250514",
        "claude-opus-4-1",
    ]
    .iter()
    .any(|prefix| id.starts_with(prefix))
}

pub(super) fn body(
    payload: &AiRequest,
    additional: serde_json::Map<String, Value>,
) -> Result<Value, String> {
    reject_fields(&additional, &["system", "tools"])?;
    let config = &payload.request_parameter_config;
    let (system, messages) = text_messages(payload)?;
    let mut body = json!({"model":payload.model,"messages":messages,"stream":true,
        "max_tokens":if config.max_tokens_enabled {config.max_tokens} else {ANTHROPIC_DEFAULT_OUTPUT_CAP}});
    if !system.is_empty() {
        body["system"] = json!(system.join("\n\n"));
    }
    if legacy_sampling(&payload.model) {
        if config.temperature_enabled {
            body["temperature"] = json!(payload.temperature);
        }
        if config.top_p_enabled {
            if let Some(value) = payload.top_p {
                body["top_p"] = json!(value);
            }
        }
        if config.top_k_enabled {
            if let Some(value) = payload.top_k {
                body["top_k"] = json!(value);
            }
        }
    }
    if config.thinking_budget_enabled {
        body["thinking"] = json!({"type":"enabled","budget_tokens":config.thinking_budget});
    } else if config.reasoning_dialect.as_deref() == Some("anthropic") {
        if let Some(level @ ("low" | "medium" | "high" | "xhigh" | "max")) =
            config.reasoning_level.as_deref()
        {
            body["thinking"] = json!({"type":"adaptive"});
            body["output_config"] = json!({"effort":level});
        }
    }
    merge_additional_api_parameters(&mut body, additional);
    let total = positive_cap(&body["max_tokens"], "max_tokens")?;
    if body.pointer("/thinking/type").and_then(Value::as_str) == Some("enabled") {
        let budget = positive_cap(&body["thinking"]["budget_tokens"], "thinking.budget_tokens")?;
        if budget < 1024 || budget >= total {
            return Err("Anthropic thinking budget must be at least 1024 and smaller than max_tokens (the combined thinking/answer cap).".into());
        }
    }
    if matches!(
        body.pointer("/thinking/type").and_then(Value::as_str),
        Some("enabled" | "adaptive")
    ) {
        // Thinking requests do not support temperature/top_k; top_p must be >=0.95.
        body.as_object_mut().unwrap().remove("temperature");
        body.as_object_mut().unwrap().remove("top_k");
        if body
            .get("top_p")
            .and_then(Value::as_f64)
            .is_some_and(|p| p < 0.95)
        {
            return Err("Anthropic thinking requires top_p >= 0.95.".into());
        }
    }
    Ok(body)
}

pub(super) fn model(value: &Value) -> Option<ModelInfo> {
    let id = value.get("id")?.as_str()?.to_owned();
    let mut parameters = vec!["max_tokens".into()];
    if legacy_sampling(&id) {
        parameters.extend(
            ["temperature", "top_p", "top_k"]
                .into_iter()
                .map(str::to_owned),
        );
    }
    if value.pointer("/capabilities/thinking/types/enabled/supported") == Some(&Value::Bool(true)) {
        parameters.push("thinking_budget_tokens".into());
    }
    let reasoning = (value.pointer("/capabilities/thinking/types/adaptive/supported")
        == Some(&Value::Bool(true)))
    .then(|| ModelReasoningInfo {
        supported: true,
        allowed_options: Some(
            ["low", "medium", "high", "xhigh", "max"]
                .into_iter()
                .filter(|level| {
                    value.pointer(&format!("/capabilities/effort/{level}/supported"))
                        == Some(&Value::Bool(true))
                })
                .map(str::to_owned)
                .collect(),
        ),
    });
    let mut model = model_info(
        id,
        value.get("max_input_tokens").and_then(Value::as_u64),
        parameters,
        reasoning,
    );
    model.input_token_limit = model.context_length;
    model.output_token_limit = value.get("max_output_tokens").and_then(Value::as_u64);
    model.parameter_source = Some("api_contract");
    let manual = value
        .pointer("/capabilities/thinking/types/enabled/supported")
        .and_then(Value::as_bool);
    let adaptive = value
        .pointer("/capabilities/thinking/types/adaptive/supported")
        .and_then(Value::as_bool);
    model.thinking_supported = if manual == Some(true) || adaptive == Some(true) {
        Some(true)
    } else if manual == Some(false) && adaptive == Some(false) {
        Some(false)
    } else {
        None
    };
    Some(model)
}

pub(super) fn event(value: &Value) -> Result<CloudEvent, String> {
    let mut event = CloudEvent::default();
    match value.get("type").and_then(Value::as_str) {
        Some("message_start") => {
            if let Some(message) = value.get("message") {
                event.usage = usage(message);
            }
        }
        Some("message_delta") => event.usage = usage(value),
        Some("content_block_start") => {
            event.text = value
                .pointer("/content_block/text")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into();
            event.thinking = value
                .pointer("/content_block/thinking")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .into();
        }
        Some("content_block_delta") => match value.pointer("/delta/type").and_then(Value::as_str) {
            Some("text_delta") => {
                event.text = value
                    .pointer("/delta/text")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into()
            }
            Some("thinking_delta") => {
                event.thinking = value
                    .pointer("/delta/thinking")
                    .and_then(Value::as_str)
                    .unwrap_or_default()
                    .into()
            }
            _ => {} // Signature and future deltas are intentionally not displayed.
        },
        Some("message_stop") => {
            event.finished = true;
            event.terminal = true;
        }
        Some(_) => {} // The official API permits new event types.
        None => return Err("Anthropic stream event is missing its type.".into()),
    }
    Ok(event)
}

fn usage(value: &Value) -> Option<TokenUsage> {
    let mut usage = parse_token_usage(value).unwrap_or_default();
    // Anthropic input_tokens EXCLUDES cache reads/writes; Ryokan inputTokens
    // represents the entire prompt, as in OpenAI/Gemini. Include both exactly once.
    if let Some(input) = count_at(value, &["usage", "input_tokens"]) {
        usage.input_tokens = Some(
            input
                .saturating_add(count_at(value, &["usage", "cache_read_input_tokens"]).unwrap_or(0))
                .saturating_add(
                    count_at(value, &["usage", "cache_creation_input_tokens"]).unwrap_or(0),
                ),
        );
    }
    usage.actual_model = response_text(value, "model");
    (!usage.is_empty()).then_some(usage)
}
