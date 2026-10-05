//! Provider request parameters and compatible request-body construction.
use super::AiRequest;
use serde::Deserialize;

const PROTECTED_API_PARAMETER_KEYS: [&str; 3] = ["messages", "model", "stream"];

/// Parses a configured object without coercing any JSON values. Ryokan's core
/// protocol fields are rejected as a group so a conflict can never partially
/// apply or depend on merge order.
pub(super) fn parse_additional_api_parameters(
    raw: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if raw.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }

    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid JSON: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "the root value is not a JSON object".to_string())?;

    let conflicts: Vec<&str> = PROTECTED_API_PARAMETER_KEYS
        .iter()
        .copied()
        .filter(|key| object.contains_key(*key))
        .collect();
    if !conflicts.is_empty() {
        return Err(format!(
            "protected fields cannot be overridden: {}",
            conflicts.join(", ")
        ));
    }

    Ok(object.clone())
}

#[derive(Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub(super) enum RequestPurpose {
    Summary,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub(super) struct RequestApiParameterConfig {
    #[serde(default)]
    pub(super) purpose: Option<RequestPurpose>,
    #[serde(default)]
    pub(super) service_tier: Option<String>,
    #[serde(default)]
    pub(super) reasoning_dialect: Option<String>,
    #[serde(default)]
    pub(super) reasoning_level: Option<String>,
    #[serde(default)]
    pub(super) temperature_enabled: bool,
    pub(super) max_tokens_enabled: bool,
    #[serde(default)]
    pub(super) presence_penalty_enabled: bool,
    pub(super) thinking_budget_enabled: bool,
    #[serde(default)]
    pub(super) top_p_enabled: bool,
    #[serde(default)]
    pub(super) top_k_enabled: bool,
    #[serde(default)]
    pub(super) min_p_enabled: bool,
    #[serde(default)]
    pub(super) frequency_penalty_enabled: bool,
    pub(super) max_tokens: u32,
    pub(super) thinking_budget: u32,
    pub(super) additional_parameters: serde_json::Map<String, serde_json::Value>,
}

/// Guard the final body, including custom parameters. Auto preserves existing
/// custom tiers on supported APIs; an explicit profile selection takes precedence.
/// Contracts are documented alongside supportedServiceTiers in the frontend.
pub(super) fn apply_service_tier(
    body: &mut serde_json::Value,
    provider_kind: Option<&str>,
    base_url: &str,
    config: &RequestApiParameterConfig,
) {
    let url = reqwest::Url::parse(base_url).ok();
    let support = url
        .as_ref()
        .filter(|url| url.scheme() == "https")
        .map(|url| {
            match (
                provider_kind,
                url.host_str(),
                url.path().trim_end_matches('/'),
            ) {
                (Some("openai"), Some("api.openai.com"), "/v1")
                | (Some("openrouter"), Some("openrouter.ai"), "/api/v1") => (true, true),
                (Some("xai"), Some("api.x.ai"), "/v1") => (true, false),
                _ => (false, false),
            }
        })
        .unwrap_or((false, false));

    match config.service_tier.as_deref() {
        Some("standard") if support.0 => body["service_tier"] = serde_json::json!("default"),
        Some("flex") if support.1 => body["service_tier"] = serde_json::json!("flex"),
        _ => {}
    }
    // Never leak the field to a merely OpenAI-compatible server, or Flex to xAI.
    if !support.0
        || (!support.1 && body.get("service_tier").and_then(|v| v.as_str()) == Some("flex"))
    {
        body.as_object_mut().unwrap().remove("service_tier");
    }
}

pub(super) fn merge_additional_api_parameters(
    body: &mut serde_json::Value,
    parameters: serde_json::Map<String, serde_json::Value>,
) {
    let Some(body) = body.as_object_mut() else {
        return;
    };
    // Power-user values intentionally win for non-protected keys. The parser
    // rejects protocol-critical conflicts before this deterministic merge.
    body.extend(parameters);
}

pub(super) fn apply_reasoning_level(
    body: &mut serde_json::Value,
    provider_kind: Option<&str>,
    config: &RequestApiParameterConfig,
) {
    let level = match config.reasoning_level.as_deref() {
        Some(level @ ("none" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max")) => {
            Some(level)
        }
        _ => None,
    };
    match (provider_kind, config.reasoning_dialect.as_deref()) {
        (Some("openrouter"), Some("openrouter")) if level.is_some() => {
            body["reasoning"] = serde_json::json!({ "effort": level.unwrap() })
        }
        (Some("lm_studio"), Some("lm_studio")) if level.is_some() => {
            body["reasoning_effort"] = serde_json::json!(level.unwrap())
        }
        (Some("llama_cpp"), Some("llama_cpp_effort")) if level.is_some() => {
            body["reasoning_effort"] = serde_json::json!(level.unwrap())
        }
        (Some("openai"), Some("openai")) => {
            if let Some(level) = level {
                body["reasoning_effort"] = serde_json::json!(level);
            }
            if level != Some("none") {
                body.as_object_mut().unwrap().remove("temperature");
                body.as_object_mut().unwrap().remove("top_p");
            }
            if let Some(max_tokens) = body.as_object_mut().unwrap().remove("max_tokens") {
                body["max_completion_tokens"] = max_tokens;
            }
        }
        (Some("xai"), Some("xai")) => {
            if let Some(level) = level {
                body["reasoning_effort"] = serde_json::json!(level);
            }
            body.as_object_mut().unwrap().remove("frequency_penalty");
            body.as_object_mut().unwrap().remove("repetition_penalty");
            body.as_object_mut().unwrap().remove("stop");
        }
        _ => {}
    }
}

pub(super) fn request_stream_usage(body: &mut serde_json::Value) {
    let Some(object) = body.as_object_mut() else {
        return;
    };
    let options = object
        .entry("stream_options")
        .or_insert_with(|| serde_json::json!({}));
    if !options.is_object() {
        *options = serde_json::json!({});
    }
    options["include_usage"] = serde_json::json!(true);
}

/// Application intent translated only for endpoints with matching controls.
pub(super) fn apply_summary_policy(body: &mut serde_json::Value, payload: &AiRequest) {
    if payload.request_parameter_config.purpose != Some(RequestPurpose::Summary) {
        return;
    }
    match payload.provider_kind.as_deref() {
        Some("openrouter") => body["reasoning"] = serde_json::json!({"enabled": false}),
        Some("llama_cpp" | "lm_studio" | "koboldcpp" | "ollama") => {
            body["chat_template_kwargs"] = serde_json::json!({"enable_thinking": false});
        }
        // Preserve Custom's previous explicit compatibility policy.
        Some("generic_openai") | None => {
            body["chat_template_kwargs"] = serde_json::json!({"enable_thinking": false});
            body["reasoning"] = serde_json::json!({"enabled": false});
        }
        _ => {} // Native/default thinking is allowed to consume the combined output cap.
    }
}

/// Only sampler fields whose semantics are identical for compatible providers.
pub(super) fn apply_compatible_sampling(
    body: &mut serde_json::Value,
    payload: &AiRequest,
    max_tokens: u32,
) {
    let config = &payload.request_parameter_config;
    if config.temperature_enabled {
        body["temperature"] = serde_json::json!(payload.temperature);
    }
    if config.max_tokens_enabled {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    for (enabled, name, value) in [
        (
            config.presence_penalty_enabled,
            "repetition_penalty",
            payload.presence_penalty.map(|v| serde_json::json!(v)),
        ),
        (
            config.top_p_enabled,
            "top_p",
            payload.top_p.map(|v| serde_json::json!(v)),
        ),
        (
            config.top_k_enabled,
            "top_k",
            payload.top_k.map(|v| serde_json::json!(v)),
        ),
        (
            config.min_p_enabled,
            "min_p",
            payload.min_p.map(|v| serde_json::json!(v)),
        ),
        (
            config.frequency_penalty_enabled,
            "frequency_penalty",
            payload.frequency_penalty.map(|v| serde_json::json!(v)),
        ),
    ] {
        if enabled {
            if let Some(value) = value {
                body[name] = value;
            }
        }
    }
}

pub(super) fn compatible_body(payload: &AiRequest) -> Result<serde_json::Value, String> {
    let config = &payload.request_parameter_config;
    let additional_parameters = parse_additional_api_parameters(
        &serde_json::Value::Object(config.additional_parameters.clone()).to_string(),
    )?;
    let total_cap = config
        .max_tokens
        .saturating_add(if config.thinking_budget_enabled {
            config.thinking_budget
        } else {
            0
        });
    let mut body = serde_json::json!({
        "model": payload.model,
        "messages": payload.messages,
        "stream": true
    });

    apply_compatible_sampling(&mut body, payload, total_cap);

    // This is a local chat-template extension, not an OpenAI/xAI field.
    if matches!(
        payload.provider_kind.as_deref(),
        Some("llama_cpp" | "lm_studio" | "koboldcpp" | "ollama")
    ) {
        body["chat_template_kwargs"] = serde_json::json!({ "enable_thinking": true });
    }
    if config.thinking_budget_enabled && payload.provider_kind.as_deref() == Some("llama_cpp") {
        body["thinking_budget_tokens"] = serde_json::json!(config.thinking_budget);
    }

    apply_reasoning_level(
        &mut body,
        payload.provider_kind.as_deref(),
        &payload.request_parameter_config,
    );

    merge_additional_api_parameters(&mut body, additional_parameters);
    // Request-level automatic caching follows the growing conversation. Explicit
    // custom values (including null) take precedence; the provider checks eligibility.
    if payload.provider_kind.as_deref() == Some("openrouter")
        && payload
            .model
            .strip_prefix('~')
            .unwrap_or(&payload.model)
            .starts_with("anthropic/claude-")
    {
        body.as_object_mut()
            .unwrap()
            .entry("cache_control")
            .or_insert_with(|| serde_json::json!({ "type": "ephemeral" }));
    }
    // Apply after custom fields so rerolls and summaries cannot override the
    // persisted chat identity with a per-request session ID.
    if payload.provider_kind.as_deref() == Some("openrouter") {
        if let Some(chat_id) = payload.chat_id.as_deref().filter(|id| !id.is_empty()) {
            body["session_id"] = serde_json::json!(chat_id);
        }
    }
    apply_summary_policy(&mut body, payload);
    apply_service_tier(
        &mut body,
        payload.provider_kind.as_deref(),
        &payload.url,
        &payload.request_parameter_config,
    );
    if matches!(
        payload.provider_kind.as_deref(),
        Some(
            "openrouter"
                | "llama_cpp"
                | "lm_studio"
                | "koboldcpp"
                | "ollama"
                | "openai"
                | "xai"
                | "generic_openai"
        )
    ) {
        request_stream_usage(&mut body);
    }

    Ok(body)
}
