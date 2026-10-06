use super::{
    json, merge_additional_api_parameters, model_info, positive_cap, reject_fields, response_text,
    text_messages, AiRequest, CloudEvent, ModelInfo, TokenUsage, Value, GEMINI_DEFAULT_OUTPUT_CAP,
};
// https://ai.google.dev/api/generate-content; https://ai.google.dev/api/models
// https://ai.google.dev/gemini-api/docs/generate-content/thinking
fn model_id(id: &str) -> Result<&str, String> {
    let id = id.strip_prefix("models/").unwrap_or(id);
    if id.is_empty()
        || !id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.'))
    {
        return Err("Invalid Gemini model ID.".into());
    }
    Ok(id)
}
pub(super) fn endpoint(base: &str, model: &str) -> Result<String, String> {
    Ok(format!(
        "{base}/models/{}:streamGenerateContent?alt=sse",
        model_id(model)?
    ))
}

pub(super) fn body(
    payload: &AiRequest,
    mut additional: serde_json::Map<String, Value>,
) -> Result<Value, String> {
    reject_fields(
        &additional,
        &[
            "contents",
            "systemInstruction",
            "system_instruction",
            "generation_config",
            "tools",
            "cachedContent",
            "cached_content",
        ],
    )?;
    let config = &payload.request_parameter_config;
    let (system, messages) = text_messages(payload)?;
    let contents: Vec<Value> = messages
        .iter()
        .map(|message| {
            json!({
                "role": if message["role"] == "assistant" {"model"} else {"user"},
                "parts":[{"text":message["content"]}]
            })
        })
        .collect();
    // Explicit Ryokan fallback, mirrored by providerTokenBudget.ts. Never assume
    // the model's default output limit in context planning.
    let mut generation = json!({"maxOutputTokens":GEMINI_DEFAULT_OUTPUT_CAP});
    if config.max_tokens_enabled {
        generation["maxOutputTokens"] = json!(config.max_tokens);
    }
    if config.temperature_enabled {
        generation["temperature"] = json!(payload.temperature);
    }
    if config.top_p_enabled {
        if let Some(value) = payload.top_p {
            generation["topP"] = json!(value);
        }
    }
    if config.top_k_enabled {
        if let Some(value) = payload.top_k {
            generation["topK"] = json!(value);
        }
    }
    if config.frequency_penalty_enabled {
        if let Some(value) = payload.frequency_penalty {
            generation["frequencyPenalty"] = json!(value);
        }
    }
    // Ryokan's repetitionPenalty is a multiplicative repetition penalty, not the
    // additive presencePenalty Gemini exposes. It is deliberately not remapped.
    if config.thinking_budget_enabled {
        generation["thinkingConfig"] =
            json!({"thinkingBudget":config.thinking_budget,"includeThoughts":true});
    } else if config.reasoning_dialect.as_deref() == Some("gemini") {
        if let Some(level @ ("minimal" | "low" | "medium" | "high")) =
            config.reasoning_level.as_deref()
        {
            generation["thinkingConfig"] =
                json!({"thinkingLevel":level.to_ascii_uppercase(),"includeThoughts":true});
        }
    }
    if let Some(custom) = additional.remove("generationConfig") {
        let custom = custom
            .as_object()
            .ok_or("generationConfig must be an object.")?;
        reject_fields(
            custom,
            &["max_output_tokens", "thinking_config", "candidate_count"],
        )?;
        if custom
            .get("candidateCount")
            .is_some_and(|v| v.as_u64() != Some(1))
        {
            return Err("Ryokan supports one Gemini response candidate per request.".into());
        }
        // Same deterministic shallow merge as the frontend budget policy.
        generation.as_object_mut().unwrap().extend(custom.clone());
    }
    if let Some(cap) = generation.get("maxOutputTokens") {
        positive_cap(cap, "generationConfig.maxOutputTokens")?;
    }
    if let Some(thinking) = generation.get("thinkingConfig") {
        let thinking = thinking
            .as_object()
            .ok_or("thinkingConfig must be an object.")?;
        reject_fields(thinking, &["thinking_budget", "thinking_level"])?;
        if thinking.contains_key("thinkingBudget") && thinking.contains_key("thinkingLevel") {
            return Err("Choose either Gemini thinkingBudget or thinkingLevel, not both.".into());
        }
        if let Some(budget) = thinking.get("thinkingBudget") {
            if !budget
                .as_i64()
                .is_some_and(|v| (-1..=i32::MAX as i64).contains(&v))
            {
                return Err(
                    "Gemini thinkingBudget must be an integer >= -1; -1 selects dynamic thinking."
                        .into(),
                );
            }
        }
    }
    let mut body = json!({"contents":contents,"generationConfig":generation});
    if !system.is_empty() {
        body["systemInstruction"] = json!({"parts":[{"text":system.join("\n\n")}]});
    }
    merge_additional_api_parameters(&mut body, additional);
    Ok(body)
}

pub(super) fn model(value: &Value) -> Option<ModelInfo> {
    if !value
        .get("supportedGenerationMethods")?
        .as_array()?
        .iter()
        .any(|v| v == "generateContent")
    {
        return None;
    }
    let id = value
        .get("name")?
        .as_str()?
        .strip_prefix("models/")?
        .to_owned();
    let mut parameters = vec!["max_tokens".into(), "frequency_penalty".into()];
    for (native, normalized) in [
        ("temperature", "temperature"),
        ("topP", "top_p"),
        ("topK", "top_k"),
    ] {
        if value.get(native).is_some_and(|v| !v.is_null()) {
            parameters.push(normalized.into());
        }
    }
    if value.get("thinking") == Some(&Value::Bool(true)) {
        parameters.push("thinking_budget_tokens".into());
    }
    // Models metadata advertises thinking, but not the permitted thinkingLevel
    // values. Leave effort UI undisclosed rather than infer levels from IDs.
    let mut model = model_info(
        id,
        value.get("inputTokenLimit").and_then(Value::as_u64),
        parameters,
        None,
    );
    model.input_token_limit = model.context_length;
    model.output_token_limit = value.get("outputTokenLimit").and_then(Value::as_u64);
    model.parameter_source = Some("api_contract");
    model.thinking_supported = value.get("thinking").and_then(Value::as_bool);
    Some(model)
}

pub(super) fn event(value: &Value) -> Result<CloudEvent, String> {
    if let Some(reason) = value
        .pointer("/promptFeedback/blockReason")
        .and_then(Value::as_str)
    {
        return Err(format!("Gemini blocked the prompt: {reason}"));
    }
    let mut event = CloudEvent::default();
    if let Some(parts) = value
        .pointer("/candidates/0/content/parts")
        .and_then(Value::as_array)
    {
        for part in parts {
            if let Some(text) = part.get("text").and_then(Value::as_str) {
                if part.get("thought") == Some(&Value::Bool(true)) {
                    event.thinking.push_str(text);
                } else {
                    event.text.push_str(text);
                }
            }
        }
    }
    if let Some(reason) = value
        .pointer("/candidates/0/finishReason")
        .and_then(Value::as_str)
    {
        if !matches!(reason, "STOP" | "MAX_TOKENS") {
            return Err(format!("Gemini generation stopped: {reason}"));
        }
        event.finished = true;
        event.finish_reason = Some(reason.into());
    }
    if let Some(metadata) = value.get("usageMetadata") {
        let candidate = metadata.get("candidatesTokenCount").and_then(Value::as_u64);
        let thoughts = metadata.get("thoughtsTokenCount").and_then(Value::as_u64);
        event.usage = Some(TokenUsage {
            input_tokens: metadata.get("promptTokenCount").and_then(Value::as_u64),
            cached_input_tokens: metadata
                .get("cachedContentTokenCount")
                .and_then(Value::as_u64),
            // Ryokan/OpenAI outputTokens includes reasoning, Gemini reports it separately.
            output_tokens: candidate.map(|count| count.saturating_add(thoughts.unwrap_or(0))),
            reasoning_tokens: thoughts,
            actual_model: response_text(value, "modelVersion"),
            ..Default::default()
        });
    }
    Ok(event)
}
