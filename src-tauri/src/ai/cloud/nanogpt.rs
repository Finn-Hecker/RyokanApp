use super::{
    apply_compatible_sampling, json, merge_additional_api_parameters, model_info,
    request_stream_usage, stream_token_usage, AiRequest, CloudEvent, ModelInfo, ModelReasoningInfo,
    TokenUsage, Value,
};
// https://docs.nano-gpt.com/api-reference/endpoint/chat-completion
// https://docs.nano-gpt.com/api-reference/miscellaneous/streaming-protocol
pub(super) fn body(
    payload: &AiRequest,
    additional: serde_json::Map<String, Value>,
) -> Result<Value, String> {
    let config = &payload.request_parameter_config;
    let mut body = json!({"model":payload.model,"messages":payload.messages,"stream":true});
    apply_compatible_sampling(&mut body, payload, config.max_tokens);
    if config.reasoning_dialect.as_deref() == Some("nanogpt") {
        if let Some(level @ ("none" | "minimal" | "low" | "medium" | "high" | "xhigh")) =
            config.reasoning_level.as_deref()
        {
            body["reasoning_effort"] = json!(level);
        }
    }
    merge_additional_api_parameters(&mut body, additional);
    request_stream_usage(&mut body);
    Ok(body)
}

pub(super) fn model(value: &Value) -> Option<ModelInfo> {
    let id = value.get("id")?.as_str()?.to_owned();
    let parameters = [
        "temperature",
        "max_tokens",
        "top_p",
        "top_k",
        "min_p",
        "repetition_penalty",
        "frequency_penalty",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    let reasoning =
        (value.pointer("/capabilities/reasoning") == Some(&Value::Bool(true))).then(|| {
            ModelReasoningInfo {
                supported: true,
                allowed_options: Some(
                    ["none", "minimal", "low", "medium", "high", "xhigh"]
                        .into_iter()
                        .map(str::to_owned)
                        .collect(),
                ),
            }
        });
    let mut model = model_info(
        id,
        value.get("context_length").and_then(Value::as_u64),
        parameters,
        reasoning,
    );
    model.parameter_source = Some("api_contract");
    model.thinking_supported = value
        .pointer("/capabilities/reasoning")
        .and_then(Value::as_bool);
    model.pricing = value.get("pricing").and_then(super::super::pricing::nanogpt_price);
    Some(model)
}

pub(super) fn event(value: &Value) -> Result<CloudEvent, String> {
    let delta = value.pointer("/choices/0/delta");
    let mut usage = stream_token_usage(value, Some("nanogpt"));
    if let Some(pricing) = value.get("x_nanogpt_pricing") {
        let reported = usage.get_or_insert_with(TokenUsage::default);
        if reported.input_tokens.is_none() {
            reported.input_tokens = pricing.get("inputTokens").and_then(Value::as_u64);
        }
        if reported.output_tokens.is_none() {
            reported.output_tokens = pricing.get("outputTokens").and_then(Value::as_u64);
        }
        // Only explicit USD account charges, never model price quotes or crypto amounts.
        if pricing.get("paymentSource").and_then(Value::as_str) == Some("USD") {
            reported.cost_usd = pricing
                .get("cost")
                .and_then(Value::as_f64)
                .filter(|cost| cost.is_finite() && *cost >= 0.0);
        } else if pricing.get("currency").and_then(Value::as_str) == Some("USD") {
            reported.cost_usd = pricing
                .get("amount")
                .and_then(Value::as_f64)
                .filter(|cost| cost.is_finite() && *cost >= 0.0);
        }
    }
    Ok(CloudEvent {
        text: delta
            .and_then(|v| v.get("content"))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .into(),
        thinking: delta
            .and_then(|v| v.get("reasoning_content").or_else(|| v.get("reasoning")))
            .and_then(Value::as_str)
            .unwrap_or_default()
            .into(),
        usage: usage.filter(|usage| !usage.is_empty()),
        ..Default::default()
    })
}
