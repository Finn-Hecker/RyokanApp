use super::{
    api_error_from_body, apply_reasoning_level, apply_service_tier, cancellation_matches,
    merge_additional_api_parameters, merge_token_usage, parse_additional_api_parameters,
    parse_token_usage, request_stream_usage, stream_token_usage, AiRequest,
    RequestApiParameterConfig, StreamChunk,
};

#[test]
fn generation_metadata_survives_sparse_stream_chunks() {
    let initial = super::stream_token_usage(
        &serde_json::json!({"model":"actual-model", "service_tier":"flex"}),
        Some("openai"),
    );
    let final_chunk = super::stream_token_usage(
        &serde_json::json!({"usage":{"prompt_tokens":100, "cost":0.002}}),
        Some("openrouter"),
    )
    .unwrap();
    let merged = super::merge_token_usage(initial, final_chunk);
    assert_eq!(merged.actual_model.as_deref(), Some("actual-model"));
    assert_eq!(merged.service_tier.as_deref(), Some("flex"));
    assert_eq!(merged.cost_usd, Some(0.002));
    assert_eq!(merged.input_tokens, Some(100));
    let restored: super::TokenUsage =
        serde_json::from_str(&serde_json::to_string(&merged).unwrap()).unwrap();
    assert_eq!(restored, merged);
}

#[tokio::test]
async fn openrouter_top_level_tier_survives_fragmented_sse_and_ipc() {
    use eventsource_stream::Eventsource;
    use futures::StreamExt;

    // Exercise the same SSE decoder, JSON parser and accounting helpers as
    // call_ai_api. Fixtures are synthetic protocol cases, not captured traffic.
    for tier_position in 0..5 {
        let mut chunks = vec![
            serde_json::json!({"choices":[{"delta":{"role":"assistant"}}], "usage":null}),
            serde_json::json!({"choices":[{"delta":{"content":"Hello"}}]}),
            serde_json::json!({"choices":[{"delta":{},"finish_reason":"stop"}]}),
            serde_json::json!({"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":1}}),
            serde_json::json!({}),
        ];
        chunks[tier_position]["service_tier"] = serde_json::json!("flex");
        // Null and missing fields on later events must not erase the report.
        chunks.push(serde_json::json!({"choices":[], "service_tier":null}));
        let mut wire = String::from(": OPENROUTER PROCESSING\r\n\r\n");
        for chunk in chunks {
            wire.push_str(&format!("data: {chunk}\r\n\r\n"));
        }
        wire.push_str("data: [DONE]\r\n\r\n");
        for fragment_size in [1, 7, 4096] {
            let fragments: Vec<Result<Vec<u8>, std::io::Error>> = wire
                .as_bytes()
                .chunks(fragment_size)
                .map(|bytes| Ok(bytes.to_vec()))
                .collect();
            let mut events = futures::stream::iter(fragments).eventsource();
            let mut reported = None;
            let mut reached_done = false;
            while let Some(event) = events.next().await {
                let event = event.unwrap();
                if event.data == "[DONE]" {
                    reached_done = true;
                    break;
                }
                let value: serde_json::Value = serde_json::from_str(&event.data).unwrap();
                if let Some(usage) = stream_token_usage(&value, Some("openrouter")) {
                    reported = Some(merge_token_usage(reported, usage));
                }
            }
            assert!(reached_done);
            let reported = reported.unwrap();
            assert_eq!(reported.service_tier.as_deref(), Some("flex"));
            assert_eq!(reported.input_tokens, Some(12));
            let ipc = serde_json::to_value(&reported).unwrap();
            assert_eq!(ipc["serviceTier"], "flex");
            assert!(ipc.get("service_tier").is_none());
            assert_eq!(
                serde_json::from_value::<super::TokenUsage>(ipc).unwrap(),
                reported
            );
        }
    }
}

#[test]
fn openrouter_flex_request_does_not_supply_missing_or_different_response_tier() {
    let mut body = serde_json::json!({"model":"test", "stream":true});
    let config = RequestApiParameterConfig {
        service_tier: Some("flex".into()),
        ..Default::default()
    };
    apply_service_tier(
        &mut body,
        Some("openrouter"),
        "https://openrouter.ai/api/v1",
        &config,
    );
    request_stream_usage(&mut body);
    assert_eq!(body["service_tier"], "flex");
    assert_eq!(body["stream"], true);
    for tier in [
        None,
        Some(serde_json::Value::Null),
        Some(serde_json::json!("default")),
        Some(serde_json::json!("flex")),
    ] {
        let mut response = serde_json::json!({"usage":{"prompt_tokens":12}});
        if let Some(value) = &tier {
            response["service_tier"] = value.clone();
        }
        let usage = stream_token_usage(&response, Some("openrouter")).unwrap();
        assert_eq!(
            usage.service_tier.as_deref(),
            tier.as_ref().and_then(|v| v.as_str())
        );
    }
    // Chat Completions must read the top level, not another API's usage shape.
    let response = serde_json::json!({"service_tier":"default", "usage":{"service_tier":"flex"}});
    assert_eq!(
        stream_token_usage(&response, Some("openrouter"))
            .unwrap()
            .service_tier
            .as_deref(),
        Some("default")
    );
}

#[test]
fn costs_require_known_provider_and_valid_account_charge() {
    for provider in [
        None,
        Some("openai"),
        Some("xai"),
        Some("generic_openai"),
        Some("llama_cpp"),
    ] {
        assert!(
            super::stream_token_usage(&serde_json::json!({"usage":{"cost":0.1}}), provider)
                .is_none()
        );
    }
    for cost in [
        serde_json::json!(null),
        serde_json::json!(-1),
        serde_json::json!("0.1"),
    ] {
        assert!(super::stream_token_usage(
            &serde_json::json!({"usage":{"cost":cost}}),
            Some("openrouter")
        )
        .is_none());
    }
    assert!(super::stream_token_usage(
        &serde_json::json!({"usage":{"cost_details":{"upstream_inference_cost":19}}}),
        Some("openrouter")
    )
    .is_none());
    assert_eq!(
        super::stream_token_usage(&serde_json::json!({"usage":{"cost":0}}), Some("openrouter"))
            .unwrap()
            .cost_usd,
        Some(0.0)
    );
    assert!(super::stream_token_usage(
        &serde_json::json!({"model":"", "service_tier":null}),
        Some("openai")
    )
    .is_none());
}

#[test]
fn xai_billed_ticks_convert_units_and_replace_running_totals() {
    let first = stream_token_usage(
        &serde_json::json!({"usage":{"cost_in_usd_ticks":10000000}}),
        Some("xai"),
    );
    let last = stream_token_usage(
        &serde_json::json!({"usage":{"cost_in_usd_ticks":25000000}}),
        Some("xai"),
    )
    .unwrap();
    assert_eq!(merge_token_usage(first, last).cost_usd, Some(0.0025));
    assert_eq!(
        stream_token_usage(
            &serde_json::json!({"usage":{"cost_in_usd_ticks":0}}),
            Some("xai")
        )
        .unwrap()
        .cost_usd,
        Some(0.0)
    );
    for ticks in [
        serde_json::json!(-1),
        serde_json::json!("42"),
        serde_json::json!(0.5),
        serde_json::json!(null),
    ] {
        assert!(stream_token_usage(
            &serde_json::json!({"usage":{"cost_in_usd_ticks":ticks}}),
            Some("xai")
        )
        .is_none());
    }
    assert!(stream_token_usage(
        &serde_json::json!({"usage":{"cost_in_usd_ticks":42}}),
        Some("generic_openai")
    )
    .is_none());
}

#[test]
fn service_tier_maps_only_supported_provider_endpoints() {
    for (provider, url, standard, flex) in [
        ("openai", "https://api.openai.com/v1", true, true),
        ("openrouter", "https://openrouter.ai/api/v1/", true, true),
        ("xai", "https://api.x.ai/v1", true, false),
        (
            "openai",
            "https://api.openai.com.evil.example/v1",
            false,
            false,
        ),
        ("openai", "https://api.openai.com/other", false, false),
        ("openai", "invalid", false, false),
        ("openrouter", "https://custom.example/api/v1", false, false),
        ("generic_openai", "https://api.openai.com/v1", false, false),
        ("llama_cpp", "http://localhost/v1", false, false),
        ("lm_studio", "http://localhost/v1", false, false),
        ("koboldcpp", "http://localhost/v1", false, false),
        ("ollama", "http://localhost/v1", false, false),
    ] {
        for tier in [
            None,
            Some("auto"),
            Some("standard"),
            Some("flex"),
            Some("invalid"),
        ] {
            let config = RequestApiParameterConfig {
                service_tier: tier.map(str::to_owned),
                ..Default::default()
            };
            let mut body = serde_json::json!({"model": "test", "stream": true});
            apply_service_tier(&mut body, Some(provider), url, &config);
            let expected = match tier {
                Some("standard") if standard => Some("default"),
                Some("flex") if flex => Some("flex"),
                _ => None,
            };
            assert_eq!(
                body.get("service_tier").and_then(|v| v.as_str()),
                expected,
                "{provider}: {tier:?}"
            );
            assert_eq!(body["model"], "test");
            assert_eq!(body["stream"], true);
        }
    }
}

#[test]
fn service_tier_custom_parameters_respect_profile_selection_and_api_support() {
    let mut config = RequestApiParameterConfig::default();
    let custom = serde_json::json!({"service_tier": "flex", "seed": 7});
    let mut body = custom.clone();
    apply_service_tier(
        &mut body,
        Some("openai"),
        "https://api.openai.com/v1",
        &config,
    );
    assert_eq!(body, custom); // Auto keeps existing supported custom fields.
    config.service_tier = Some("standard".into());
    apply_service_tier(
        &mut body,
        Some("openai"),
        "https://api.openai.com/v1",
        &config,
    );
    assert_eq!(body["service_tier"], "default");
    config.service_tier = Some("flex".into());
    apply_service_tier(
        &mut body,
        Some("openai"),
        "https://api.openai.com/v1",
        &config,
    );
    assert_eq!(body["service_tier"], "flex");
    for (provider, url) in [
        ("xai", "https://api.x.ai/v1"),
        ("generic_openai", "https://custom.example/v1"),
    ] {
        let mut body = custom.clone();
        apply_service_tier(&mut body, Some(provider), url, &config);
        assert_eq!(body, serde_json::json!({"seed": 7}));
    }
}

#[test]
fn generation_requires_profile_bound_parameter_config() {
    let mut payload = serde_json::json!({
        "url": "http://localhost/v1", "api_key": "", "model": "test",
        "messages": [], "temperature": 0.8,
        "request_parameter_config": {
            "maxTokensEnabled": true, "thinkingBudgetEnabled": false,
            "maxTokens": 300, "thinkingBudget": 2500,
            "additionalParameters": {}
        }
    });
    assert!(serde_json::from_value::<AiRequest>(payload.clone()).is_ok());
    payload
        .as_object_mut()
        .unwrap()
        .remove("request_parameter_config");
    assert!(serde_json::from_value::<AiRequest>(payload).is_err());
}

#[test]
fn parses_provider_reported_usage_without_estimating_missing_metrics() {
    let openrouter = serde_json::json!({"usage": {
        "prompt_tokens": 120, "completion_tokens": 40,
        "prompt_tokens_details": {"cached_tokens": 80},
        "completion_tokens_details": {"reasoning_tokens": 12}
    }});
    let usage = parse_token_usage(&openrouter).unwrap();
    assert_eq!(
        (
            usage.input_tokens,
            usage.cached_input_tokens,
            usage.output_tokens,
            usage.reasoning_tokens
        ),
        (Some(120), Some(80), Some(40), Some(12))
    );

    let lm_studio = parse_token_usage(&serde_json::json!({"usage": {
        "prompt_tokens": 10, "completion_tokens": 4
    }}))
    .unwrap();
    assert_eq!(lm_studio.cached_input_tokens, None);
    assert_eq!(lm_studio.reasoning_tokens, None);
    assert_eq!(
        parse_token_usage(&serde_json::json!({"usage": {"total_tokens": 14}})),
        None
    );
    assert_eq!(
        parse_token_usage(&serde_json::json!({"usage": {
            "prompt_tokens": -1, "completion_tokens": "4"
        }})),
        None
    );
}

#[test]
fn parses_compatible_details_and_native_ollama_counts() {
    let compatible = parse_token_usage(&serde_json::json!({"usage": {
        "input_tokens": 15, "output_tokens": 8,
        "input_tokens_details": {"cached_tokens": 3},
        "output_tokens_details": {"reasoning_tokens": 2}
    }}))
    .unwrap();
    assert_eq!(
        (
            compatible.input_tokens,
            compatible.cached_input_tokens,
            compatible.output_tokens,
            compatible.reasoning_tokens
        ),
        (Some(15), Some(3), Some(8), Some(2))
    );
    let ollama =
        parse_token_usage(&serde_json::json!({"prompt_eval_count": 19, "eval_count": 6})).unwrap();
    assert_eq!(
        (
            ollama.input_tokens,
            ollama.output_tokens,
            ollama.cached_input_tokens
        ),
        (Some(19), Some(6), None)
    );
}

#[test]
fn usage_only_final_stream_chunk_is_accepted() {
    let final_chunk = serde_json::json!({
        "choices": [], "usage": {"prompt_tokens": 21, "completion_tokens": 7}
    });
    let chunk: StreamChunk = serde_json::from_value(final_chunk.clone()).unwrap();
    assert!(chunk.choices.is_empty());
    let usage = stream_token_usage(&final_chunk, Some("openrouter")).unwrap();
    assert_eq!(
        (usage.input_tokens, usage.output_tokens),
        (Some(21), Some(7))
    );
    assert!(stream_token_usage(&serde_json::json!({"choices": []}), Some("openrouter")).is_none());
}

#[test]
fn llama_timings_cache_count_is_used_only_for_llama_and_merges_with_usage() {
    let first = stream_token_usage(
        &serde_json::json!({"usage": {
            "prompt_tokens": 40, "completion_tokens": 9
        }}),
        Some("llama_cpp"),
    );
    let final_chunk = serde_json::json!({"choices": [], "timings": {"cache_n": 30}});
    let final_usage = stream_token_usage(&final_chunk, Some("llama_cpp")).unwrap();
    let merged = merge_token_usage(first, final_usage);
    assert_eq!(
        (
            merged.input_tokens,
            merged.cached_input_tokens,
            merged.output_tokens
        ),
        (Some(40), Some(30), Some(9))
    );
    assert!(stream_token_usage(&final_chunk, Some("koboldcpp")).is_none());
}

#[test]
fn stream_usage_request_survives_custom_stream_options() {
    let mut body = serde_json::json!({"stream_options": {"include_usage": false, "other": true}});
    request_stream_usage(&mut body);
    assert_eq!(
        body["stream_options"],
        serde_json::json!({"include_usage": true, "other": true})
    );
}

#[test]
fn openrouter_efforts_keep_the_nested_request_dialect() {
    for level in [
        "none", "minimal", "low", "medium", "high", "xhigh", "max", "auto", "invalid",
    ] {
        let config = RequestApiParameterConfig {
            reasoning_dialect: Some("openrouter".into()),
            reasoning_level: Some(level.into()),
            ..Default::default()
        };
        let mut body = serde_json::json!({});
        apply_reasoning_level(&mut body, Some("openrouter"), &config);
        if matches!(level, "auto" | "invalid") {
            assert_eq!(body, serde_json::json!({}));
        } else {
            assert_eq!(body, serde_json::json!({"reasoning": {"effort": level}}));
        }
    }
}

#[test]
fn reasoning_uses_only_the_selected_provider_dialect() {
    let mut config = RequestApiParameterConfig {
        reasoning_dialect: Some("openai".into()),
        reasoning_level: Some("low".into()),
        ..Default::default()
    };
    let base = serde_json::json!({"temperature": 0.7, "top_p": 0.9, "max_tokens": 1300});
    let mut body = base.clone();
    apply_reasoning_level(&mut body, Some("openai"), &config);
    assert_eq!(body["reasoning_effort"], "low");
    assert_eq!(body["max_completion_tokens"], 1300);
    assert!(body.get("max_tokens").is_none());
    assert!(body.get("temperature").is_none());
    let mut mismatch = base.clone();
    apply_reasoning_level(&mut mismatch, Some("xai"), &config);
    assert_eq!(mismatch, base);
    config.reasoning_dialect = Some("openrouter".into());
    config.reasoning_level = Some("high".into());
    apply_reasoning_level(&mut mismatch, Some("openrouter"), &config);
    assert_eq!(mismatch["reasoning"]["effort"], "high");
    config.reasoning_dialect = Some("lm_studio".into());
    config.reasoning_level = Some("medium".into());
    let mut studio = serde_json::json!({});
    apply_reasoning_level(&mut studio, Some("lm_studio"), &config);
    assert_eq!(studio["reasoning_effort"], "medium");
    config.reasoning_dialect = Some("openrouter".into());
    config.reasoning_level = Some("auto".into());
    let mut automatic = base.clone();
    apply_reasoning_level(&mut automatic, Some("openrouter"), &config);
    assert_eq!(automatic, base);
    config.reasoning_dialect = Some("openai".into());
    apply_reasoning_level(&mut automatic, Some("openai"), &config);
    assert!(automatic.get("reasoning_effort").is_none());
    assert_eq!(automatic["max_completion_tokens"], 1300);
}

#[test]
fn summary_requests_preserve_provider_reasoning_defaults_and_explicit_configuration() {
    for provider in [Some("openrouter"), Some("generic_openai"), None] {
        let mut payload: super::AiRequest = serde_json::from_value(serde_json::json!({
            "provider_kind": provider, "url": "https://example.test/v1", "api_key": "",
            "model": "fixture/model", "messages": [{"role": "user", "content": "Summarize"}],
            "temperature": 0.3,
            "request_parameter_config": {
                "purpose": "summary", "reasoningDialect": null, "reasoningLevel": "auto",
                "temperatureEnabled": true, "maxTokensEnabled": true,
                "thinkingBudgetEnabled": false, "maxTokens": 1024, "thinkingBudget": 0,
                "additionalParameters": {}
            }
        })).unwrap();
        let body = super::compatible_body(&payload).unwrap();
        assert!(body.get("reasoning").is_none(), "{provider:?}: {body}");
        assert!(body.get("reasoning_effort").is_none());
        assert!(body.get("thinking_budget_tokens").is_none());
        assert_eq!(body["temperature"], serde_json::json!(payload.temperature));
        assert_eq!(body["max_tokens"], 1024);
        assert!(body.get("chat_template_kwargs").is_none());

        let reasoning = serde_json::json!({"enabled": true, "effort": "high"});
        payload
            .request_parameter_config
            .additional_parameters
            .insert("reasoning".into(), reasoning.clone());
        let configured = super::compatible_body(&payload).unwrap();
        assert_eq!(configured["reasoning"], reasoning);
        assert_eq!(configured["max_tokens"], 1024);
    }
}

#[test]
fn bound_request_uses_config_without_duplicate_token_values() {
    for (enabled, expected) in [(false, 300), (true, 2800)] {
        let payload: super::AiRequest = serde_json::from_value(serde_json::json!({
            "provider_kind":"llama_cpp", "url":"http://localhost/v1", "api_key":"", "model":"fixture",
            "messages":[{"role":"user","content":"Hello"}], "temperature":0.7,
            "request_parameter_config":{"maxTokensEnabled":true,"thinkingBudgetEnabled":enabled,
                "maxTokens":300,"thinkingBudget":2500,"additionalParameters":{}}
        })).unwrap();
        let body = super::compatible_body(&payload).unwrap();
        assert_eq!(body["max_tokens"], expected);
        assert_eq!(
            body.get("thinking_budget_tokens").and_then(|v| v.as_u64()),
            if enabled { Some(2500) } else { None }
        );
    }
}

#[test]
fn summary_preserves_compatible_profile_reasoning_and_override_precedence() {
    for (provider, dialect) in [
        ("openrouter", "openrouter"), ("openai", "openai"), ("xai", "xai"),
        ("llama_cpp", "llama_cpp_effort"), ("lm_studio", "lm_studio"),
        ("koboldcpp", ""), ("ollama", ""), ("generic_openai", ""),
    ] {
        let mut payload: super::AiRequest = serde_json::from_value(serde_json::json!({
            "provider_kind": provider, "url": "https://example.test/v1", "api_key": "",
            "model": "fixture", "messages": [{"role":"user","content":"Summary"}], "temperature":0.6,
            "request_parameter_config": {"reasoningDialect":dialect,"reasoningLevel":"high",
                "maxTokensEnabled":true,"thinkingBudgetEnabled":provider == "llama_cpp",
                "maxTokens":4000,"thinkingBudget":6000,
                "additionalParameters":{"reasoning":{"effort":"low"},"reasoning_effort":"low",
                    "chat_template_kwargs":{"enable_thinking":false,"custom":true}}}
        })).unwrap();
        let chat = super::compatible_body(&payload).unwrap();
        payload.request_parameter_config.purpose = Some(super::RequestPurpose::Summary);
        let summary = super::compatible_body(&payload).unwrap();
        assert_eq!(summary, chat, "{provider}");
        assert_eq!(summary["reasoning"]["effort"], "low");
        assert_eq!(summary["reasoning_effort"], "low");
        assert_eq!(summary["chat_template_kwargs"]["enable_thinking"], false);
        if provider == "llama_cpp" {
            assert_eq!(summary["thinking_budget_tokens"], 6000);
            assert_eq!(summary["max_tokens"], 10000);
        }
    }
}

#[test]
fn legacy_stop_matches_the_active_request() {
    assert!(cancellation_matches(&Some("current".into()), &None));
    assert!(cancellation_matches(&None, &None));
}

#[test]
fn scoped_stop_only_matches_its_generation() {
    assert!(cancellation_matches(
        &Some("current".into()),
        &Some("current".into()),
    ));
    assert!(!cancellation_matches(
        &Some("newer".into()),
        &Some("older".into()),
    ));
    assert!(!cancellation_matches(&None, &Some("multiplayer".into())));
}

#[test]
fn preserves_openrouter_provider_error_metadata() {
    let error = api_error_from_body(
        429,
        r#"{"error":{"message":"Upstream quota exceeded","code":429,"metadata":{"provider_name":"ExampleAI"}}}"#,
        "secret-key",
        "example/model",
        &[],
    );
    let value: serde_json::Value = serde_json::from_str(&error).unwrap();
    assert_eq!(value["message"], "Upstream quota exceeded");
    assert_eq!(value["provider"], "ExampleAI");
    assert_eq!(value["model"], "example/model");
    assert_eq!(value["status"], 429);
    assert_eq!(value["code"], "429");
}

#[test]
fn redacts_keys_and_prompts_from_api_messages() {
    let messages = vec![serde_json::json!({"role":"user", "content":"private prompt"})];
    let error = api_error_from_body(
        400,
        r#"{"error":{"message":"private prompt Authorization: Bearer secret-key"}}"#,
        "secret-key",
        "example/model",
        &messages,
    );
    assert!(!error.contains("private prompt"));
    assert!(!error.contains("secret-key"));
}

#[test]
fn additional_parameters_preserve_nested_json_values() {
    let parameters = parse_additional_api_parameters(
        r#"{"provider":{"only":["deepinfra"]},"reasoning":{"enabled":true,"effort":2.5},"temperature":0.2,"tag":"custom"}"#,
    )
    .unwrap();
    let mut body = serde_json::json!({
        "model": "controlled-model",
        "messages": [],
        "stream": true,
        "temperature": 0.8
    });

    merge_additional_api_parameters(&mut body, parameters);

    assert_eq!(body["provider"]["only"], serde_json::json!(["deepinfra"]));
    assert_eq!(body["reasoning"]["enabled"], true);
    assert_eq!(body["reasoning"]["effort"], 2.5);
    assert_eq!(body["temperature"], 0.2);
    assert_eq!(body["tag"], "custom");
}

#[test]
fn additional_parameters_reject_non_objects_and_invalid_json() {
    assert!(parse_additional_api_parameters("[").is_err());
    assert!(parse_additional_api_parameters("[]").is_err());
    assert!(parse_additional_api_parameters("null").is_err());
}

#[test]
fn empty_additional_parameters_leave_the_request_unchanged() {
    let mut body = serde_json::json!({
        "model": "controlled-model",
        "messages": [{"role": "user", "content": "Hello"}],
        "stream": true
    });
    let original = body.clone();

    merge_additional_api_parameters(&mut body, parse_additional_api_parameters("  ").unwrap());

    assert_eq!(body, original);
}

#[test]
fn additional_parameters_reject_every_protected_field() {
    for field in ["messages", "model", "stream"] {
        let raw = format!(r#"{{"{field}":null,"provider":{{"sort":"price"}}}}"#);
        assert!(parse_additional_api_parameters(&raw).is_err(), "{field}");
    }
}
