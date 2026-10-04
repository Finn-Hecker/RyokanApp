use super::*;
use crate::ai::RequestPurpose;
use std::io::{Read, Write};

fn request(kind: &str) -> AiRequest {
    serde_json::from_value(json!({"provider_kind":kind,"url":"https://fixture.invalid/v1",
        "api_key":"test-key","model":"claude-sonnet-4-5","temperature":0.7,
        "messages":[{"role":"system","content":"First instruction"},{"role":"system","content":"Second instruction"},
          {"role":"user","content":"Hello"},{"role":"assistant","content":"Previous answer"},{"role":"user","content":"Next"}],
        "top_p":0.99,"top_k":40,"min_p":0.1,"frequency_penalty":0.3,"presence_penalty":1.12,
        "request_parameter_config":{"temperatureEnabled":true,"maxTokensEnabled":true,"thinkingBudgetEnabled":false,
          "topPEnabled":true,"topKEnabled":true,"minPEnabled":true,"presencePenaltyEnabled":true,"frequencyPenaltyEnabled":true,
          "maxTokens":4096,"thinkingBudget":2048,"additionalParameters":{}}})).unwrap()
}

#[test]
fn openrouter_claude_automatic_cache_preserves_overrides_and_chat_identity() {
    for model in ["anthropic/claude-sonnet-4.5", "anthropic/claude-opus-4.6", "anthropic/claude-haiku-4.5", "~anthropic/claude-sonnet-latest"] {
        for purpose in [None, Some(RequestPurpose::Summary)] {
            let mut payload = request("openrouter");
            payload.model = model.into();
            payload.chat_id = Some("chat-a".into());
            payload.request_parameter_config.purpose = purpose;
            let body = super::super::compatible_body(&payload).unwrap();
            assert_eq!(body["cache_control"], json!({"type":"ephemeral"}));
            assert_eq!(body["session_id"], "chat-a");
            assert_eq!(body["messages"], json!(payload.messages));
            for custom in [json!({"type":"ephemeral","ttl":"1h"}), json!(null), json!(false)] {
                payload.request_parameter_config.additional_parameters.insert("cache_control".into(), custom.clone());
                let body = super::super::compatible_body(&payload).unwrap();
                assert_eq!(body["cache_control"], custom);
                assert_eq!(body["session_id"], "chat-a");
                assert_eq!(body["messages"], json!(payload.messages));
            }
        }
    }
}

#[test]
fn automatic_cache_does_not_affect_other_models_or_providers() {
    for (kind, model) in [("openrouter", "openai/gpt-4.1"), ("openrouter", "anthropic/other"),
        ("openrouter", "claude-sonnet-4.5"), ("openrouter", "other/claude-sonnet-4.5"),
        ("openai", "anthropic/claude-sonnet-4.5"), ("generic_openai", "anthropic/claude-sonnet-4.5")] {
        let mut payload = request(kind);
        payload.model = model.into();
        assert!(super::super::compatible_body(&payload).unwrap().get("cache_control").is_none());
        let custom = json!({"type":"ephemeral","ttl":"1h"});
        payload.request_parameter_config.additional_parameters.insert("cache_control".into(), custom.clone());
        assert_eq!(super::super::compatible_body(&payload).unwrap()["cache_control"], custom);
    }
}

#[test]
fn openrouter_cache_writes_survive_sparse_streams_and_serialization() {
    let initial = json!({"usage":{"prompt_tokens":120,"prompt_tokens_details":{"cached_tokens":80,"cache_write_tokens":30}}});
    let first = super::super::stream_token_usage(&initial, Some("openrouter")).unwrap();
    assert_eq!(first.cached_input_tokens, Some(80));
    assert_eq!(first.cache_write_tokens, Some(30));
    let final_usage = super::super::stream_token_usage(&json!({"usage":{"completion_tokens":10}}), Some("openrouter")).unwrap();
    let merged = super::super::merge_token_usage(Some(first), final_usage);
    assert_eq!(merged.cache_write_tokens, Some(30));
    assert_eq!(serde_json::to_value(&merged).unwrap()["cacheWriteTokens"], 30);
    for value in [json!(0), json!(42), json!(-1), json!("42"), json!(null)] {
        let response = json!({"usage":{"prompt_tokens_details":{"cache_write_tokens":value}}});
        let usage = super::super::stream_token_usage(&response, Some("openrouter"));
        assert_eq!(usage.as_ref().and_then(|usage| usage.cache_write_tokens), value.as_u64());
        assert_eq!(super::super::stream_token_usage(&response, Some("openai")), None);
        if value == json!(0) {
            assert_eq!(super::super::merge_token_usage(Some(merged.clone()), usage.unwrap()).cache_write_tokens, Some(0));
        }
    }
    let legacy: TokenUsage = serde_json::from_value(json!({"inputTokens":10,"cachedInputTokens":5})).unwrap();
    assert_eq!(legacy.cache_write_tokens, None);
}

#[test]
fn openrouter_session_uses_persisted_chat_identity_for_chat_and_summary() {
    for chat_id in ["chat-a", "chat-b"] {
        for purpose in [None, Some(RequestPurpose::Summary)] {
            let mut payload = request("openrouter");
            payload.chat_id = Some(chat_id.into());
            payload.generation_id = Some(uuid::Uuid::new_v4().to_string());
            payload.request_parameter_config.purpose = purpose;
            payload.request_parameter_config.additional_parameters.insert("session_id".into(), json!("custom-override"));
            assert_eq!(super::super::compatible_body(&payload).unwrap()["session_id"], chat_id);
        }
    }
    // Legacy/non-chat requests remain valid without an identity.
    assert!(super::super::compatible_body(&request("openrouter")).unwrap().get("session_id").is_none());
}

#[test]
fn chat_identity_does_not_change_other_provider_bodies() {
    for kind in ["openai", "xai", "generic_openai", "llama_cpp", "lm_studio", "ollama", "koboldcpp", "nanogpt", "anthropic", "gemini"] {
        let mut payload = request(kind);
        let body = |payload: &AiRequest| match CloudProvider::parse(payload.provider_kind.as_deref()) {
            Some(CloudProvider::NanoGpt) => nanogpt::body(payload, serde_json::Map::new()).unwrap(),
            Some(CloudProvider::Anthropic) => anthropic::body(payload, serde_json::Map::new()).unwrap(),
            Some(CloudProvider::Gemini) => gemini::body(payload, serde_json::Map::new()).unwrap(),
            None => super::super::compatible_body(payload).unwrap(),
        };
        let before = body(&payload);
        payload.chat_id = Some("chat-a".into());
        let after = body(&payload);
        assert_eq!(before, after, "{kind}");
        assert!(after.get("session_id").is_none(), "{kind}");
        assert!(after.get("chat_id").is_none(), "{kind}");
    }
}

#[test]
fn only_new_provider_ids_dispatch_to_cloud_and_keys_stay_on_official_hosts() {
    for kind in [
        None,
        Some("openrouter"),
        Some("openai"),
        Some("xai"),
        Some("generic_openai"),
        Some("llama_cpp"),
        Some("lm_studio"),
        Some("ollama"),
        Some("koboldcpp"),
    ] {
        assert!(!is_provider(kind));
    }
    for (kind, base) in [
        ("nanogpt", "https://api.nano-gpt.com/api/v1"),
        ("anthropic", "https://api.anthropic.com/v1"),
        ("gemini", "https://generativelanguage.googleapis.com/v1beta"),
    ] {
        assert!(is_provider(Some(kind)));
        assert!(validate_base(&format!("{base}/"), CloudProvider::parse(Some(kind)).unwrap(), "key").is_ok());
        assert!(validate_base(base, CloudProvider::parse(Some(kind)).unwrap(), " ").is_err());
        assert!(validate_base("https://impostor.invalid/v1", CloudProvider::parse(Some(kind)).unwrap(), "key").is_err());
    }
}

#[test]
fn native_authentication_uses_headers_without_query_keys() {
    for kind in ["nanogpt", "anthropic", "gemini"] {
        let request = authenticate(CLIENT.get("https://fixture.invalid/models"), CloudProvider::parse(Some(kind)).unwrap(), "key")
            .build()
            .unwrap();
        assert!(!request.url().as_str().contains("key"));
        match kind {
            "anthropic" => {
                assert_eq!(request.headers()["x-api-key"], "key");
                assert_eq!(request.headers()["anthropic-version"], "2023-06-01");
                assert!(!request.headers().contains_key("authorization"));
            }
            "gemini" => {
                assert_eq!(request.headers()["x-goog-api-key"], "key");
                assert!(!request.headers().contains_key("authorization"));
            }
            _ => assert_eq!(request.headers()["authorization"], "Bearer key"),
        }
    }
}

#[test]
fn nanogpt_request_and_usage_match_its_documented_compatible_contract() {
    let payload = request("nanogpt");
    let body = nanogpt::body(
        &payload,
        json!({"temperature":0.2}).as_object().unwrap().clone(),
    )
    .unwrap();
    assert_eq!(body["temperature"], 0.2);
    assert_eq!(body["stream_options"]["include_usage"], true);
    assert_eq!(body["repetition_penalty"], json!(payload.presence_penalty));
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["messages"], json!(payload.messages));
    assert!(body.get("thinking_budget_tokens").is_none());
    assert!(body.get("chat_template_kwargs").is_none());
    assert_eq!(
        decode(CloudProvider::NanoGpt,
            r#"{"choices":[{"delta":{"reasoning":"Thinking"}}]}"#
        )
        .unwrap()
        .thinking,
        "Thinking"
    );
    let priced = nanogpt::event(&json!({"x_nanogpt_pricing":{"cost":0.001,"paymentSource":"USD","inputTokens":12,"outputTokens":5}})).unwrap().usage.unwrap();
    assert_eq!(priced.cost_usd, Some(0.001));
    assert_eq!(priced.input_tokens, Some(12));
    assert!(
        nanogpt::event(&json!({"x_nanogpt_pricing":{"cost":1.0,"paymentSource":"NANO"}}))
            .unwrap()
            .usage
            .is_none()
    );
}

#[test]
fn anthropic_normal_generation_extracts_system_and_omits_foreign_parameters() {
    let payload = request("anthropic");
    let body = anthropic::body(&payload, serde_json::Map::new()).unwrap();
    assert_eq!(body["system"], "First instruction\n\nSecond instruction");
    assert_eq!(body["messages"].as_array().unwrap().len(), 3);
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(body["top_k"], 40);
    for field in [
        "repetition_penalty",
        "min_p",
        "frequency_penalty",
        "thinking_budget_tokens",
    ] {
        assert!(body.get(field).is_none());
    }
    let mut modern = request("anthropic");
    modern.model = "claude-opus-5".into();
    let modern = anthropic::body(&modern, serde_json::Map::new()).unwrap();
    assert!(modern.get("temperature").is_none());
    assert!(modern.get("top_k").is_none());
}

#[test]
fn anthropic_manual_and_adaptive_thinking_use_native_combined_cap() {
    let mut payload = request("anthropic");
    payload.request_parameter_config.thinking_budget_enabled = true;
    let body = anthropic::body(&payload, serde_json::Map::new()).unwrap();
    assert_eq!(body["max_tokens"], 4096);
    assert_eq!(
        body["thinking"],
        json!({"type":"enabled","budget_tokens":2048})
    );
    assert!(body.get("temperature").is_none());
    assert!(body.get("top_k").is_none());
    let adaptive = anthropic::body(
        &payload,
        json!({"thinking":{"type":"adaptive"},"output_config":{"effort":"high"},"max_tokens":6000})
            .as_object()
            .unwrap()
            .clone(),
    )
    .unwrap();
    assert_eq!(adaptive["max_tokens"], 6000);
    assert!(adaptive["thinking"].get("budget_tokens").is_none());
    for thinking in [1000, 4096, 5000] {
        payload.request_parameter_config.thinking_budget = thinking;
        assert!(anthropic::body(&payload, serde_json::Map::new()).is_err());
    }
}

#[test]
fn anthropic_sparse_cumulative_usage_includes_cache_reads_and_writes_once() {
    let initial = decode(CloudProvider::Anthropic,r#"{"type":"message_start","message":{"model":"actual","usage":{"input_tokens":10,"cache_read_input_tokens":80,"cache_creation_input_tokens":20,"output_tokens":0}}}"#).unwrap().usage;
    let final_usage = decode(CloudProvider::Anthropic,
        r#"{"type":"message_delta","usage":{"output_tokens":32}}"#,
    )
    .unwrap()
    .usage
    .unwrap();
    let usage = merge_token_usage(initial, final_usage);
    assert_eq!(usage.input_tokens, Some(110));
    assert_eq!(usage.cached_input_tokens, Some(80));
    assert_eq!(usage.output_tokens, Some(32));
    assert_eq!(usage.actual_model.as_deref(), Some("actual"));
    assert_eq!(
        decode(CloudProvider::Anthropic,
            r#"{"type":"content_block_delta","delta":{"type":"thinking_delta","thinking":"think"}}"#
        )
        .unwrap()
        .thinking,
        "think"
    );
    assert!(decode(CloudProvider::Anthropic, r#"{"type":"future_event"}"#).is_ok());
}

#[test]
fn gemini_normal_generation_maps_roles_system_and_combined_output_cap() {
    let payload = request("gemini");
    let body = gemini::body(&payload, serde_json::Map::new()).unwrap();
    assert_eq!(
        body["systemInstruction"]["parts"][0]["text"],
        "First instruction\n\nSecond instruction"
    );
    assert_eq!(body["contents"][1]["role"], "model");
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 4096);
    assert_eq!(body["generationConfig"]["topK"], 40);
    for field in ["presencePenalty", "repetition_penalty", "minP"] {
        assert!(body["generationConfig"].get(field).is_none());
    }
    assert!(body.get("model").is_none());
    assert!(body.get("stream").is_none());
    assert_eq!(gemini::endpoint("https://generativelanguage.googleapis.com/v1beta","models/gemini-2.5-flash").unwrap(),
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:streamGenerateContent?alt=sse");
    assert!(gemini::endpoint("https://example.invalid", "id?key=secret").is_err());
}

#[test]
fn gemini_manual_dynamic_and_level_thinking_do_not_increase_output_cap() {
    let mut payload = request("gemini");
    payload.request_parameter_config.thinking_budget_enabled = true;
    let body = gemini::body(&payload, serde_json::Map::new()).unwrap();
    assert_eq!(
        body["generationConfig"]["thinkingConfig"]["thinkingBudget"],
        2048
    );
    assert_eq!(body["generationConfig"]["maxOutputTokens"], 4096);
    for thinking in [
        json!({"thinkingBudget":-1}),
        json!({"thinkingBudget":0}),
        json!({"thinkingLevel":"HIGH"}),
    ] {
        let custom = json!({"generationConfig":{"thinkingConfig":thinking,"maxOutputTokens":6000}});
        let body = gemini::body(&payload, custom.as_object().unwrap().clone()).unwrap();
        assert_eq!(body["generationConfig"]["thinkingConfig"], thinking);
        assert_eq!(body["generationConfig"]["maxOutputTokens"], 6000);
    }
    for thinking in [
        json!({"thinkingBudget":-2}),
        json!({"thinkingBudget":"2048"}),
        json!({"thinkingBudget":2,"thinkingLevel":"LOW"}),
    ] {
        assert!(gemini::body(
            &payload,
            json!({"generationConfig":{"thinkingConfig":thinking}})
                .as_object()
                .unwrap()
                .clone()
        )
        .is_err());
    }
}

#[test]
fn gemini_usage_reports_full_output_and_keeps_thoughts_separate() {
    let event = decode(CloudProvider::Gemini,r#"{"candidates":[{"content":{"parts":[{"text":"thought","thought":true},{"text":"answer"}]},"finishReason":"STOP"}],"modelVersion":"actual","usageMetadata":{"promptTokenCount":100,"cachedContentTokenCount":80,"candidatesTokenCount":20,"thoughtsTokenCount":12}}"#).unwrap();
    assert_eq!(event.text, "answer");
    assert_eq!(event.thinking, "thought");
    assert!(event.finished);
    let usage = event.usage.unwrap();
    assert_eq!(usage.input_tokens, Some(100));
    assert_eq!(usage.output_tokens, Some(32));
    assert_eq!(usage.reasoning_tokens, Some(12));
    assert_eq!(usage.cached_input_tokens, Some(80));
    assert_eq!(usage.actual_model.as_deref(), Some("actual"));
    assert!(decode(CloudProvider::Gemini, r#"{"promptFeedback":{"blockReason":"SAFETY"}}"#).is_err());
    assert!(decode(CloudProvider::Gemini, r#"{"candidates":[{"finishReason":"SAFETY"}]}"#).is_err());
}

#[test]
fn model_catalogs_use_only_advertised_context_and_capabilities() {
    let nano = nanogpt::model(
        &json!({"id":"model","context_length":128000,"capabilities":{"reasoning":true}}),
    )
    .unwrap();
    assert_eq!(nano.context_length, Some(128000));
    assert!(nano.reasoning.unwrap().supported);
    let anthropic = anthropic::model(&json!({"id":"model","max_input_tokens":200000,
        "capabilities":{"thinking":{"types":{"adaptive":{"supported":true},"enabled":{"supported":false}}},
          "effort":{"low":{"supported":true},"high":{"supported":true}}}})).unwrap();
    assert_eq!(anthropic.context_length, Some(200000));
    assert_eq!(
        anthropic.reasoning.unwrap().allowed_options.unwrap(),
        vec!["low", "high"]
    );
    assert!(!anthropic
        .supported_parameters
        .unwrap()
        .contains(&"thinking_budget_tokens".into()));
    assert!(gemini::model(
        &json!({"name":"models/embedding","supportedGenerationMethods":["embedContent"]})
    )
    .is_none());
    let gemini = gemini::model(&json!({"name":"models/model","inputTokenLimit":1048576,"supportedGenerationMethods":["generateContent"],"thinking":true})).unwrap();
    assert_eq!(gemini.id, "model");
    assert_eq!(gemini.context_length, Some(1048576));
    assert!(!gemini
        .supported_parameters
        .as_ref()
        .unwrap()
        .contains(&"top_k".into()));
    assert!(gemini.reasoning.is_none());
}

#[test]
fn nanogpt_model_retains_normalized_prices() {
    let model = nanogpt::model(&json!({"id":"priced","pricing":{
        "prompt":2.5,"completion":10,"unit":"per_million_tokens","currency":"USD"
    }})).unwrap();
    let pricing = model.pricing.unwrap();
    assert_eq!(pricing.prompt.as_deref(), Some("0.0000025"));
    assert_eq!(pricing.completion.as_deref(), Some("0.00001"));
    assert_eq!(pricing.source.as_deref(), Some("NanoGPT"));
}

#[test]
fn native_defaults_and_summary_policy_stay_consistent_with_frontend_reserves() {
    let mut payload = request("anthropic");
    payload.request_parameter_config.max_tokens_enabled = false;
    assert_eq!(
        anthropic::body(&payload, serde_json::Map::new()).unwrap()["max_tokens"],
        4096
    );
    assert_eq!(
        gemini::body(&payload, serde_json::Map::new()).unwrap()["generationConfig"]
            ["maxOutputTokens"],
        8192
    );
    payload.request_parameter_config.max_tokens_enabled = true;
    payload.request_parameter_config.purpose = Some(super::super::RequestPurpose::Summary);
    let policy = serde_json::Map::new();
    for body in [
        anthropic::body(&payload, policy.clone()).unwrap(),
        gemini::body(&payload, policy).unwrap(),
    ] {
        assert!(body.get("chat_template_kwargs").is_none());
        assert!(body.get("reasoning").is_none());
    }
}

#[test]
fn native_custom_parameters_cannot_change_prompt_or_bypass_budget_accounting() {
    let payload = request("gemini");
    for custom in [
        json!({"contents":[]}),
        json!({"systemInstruction":{}}),
        json!({"generation_config":{"max_output_tokens":99000}}),
        json!({"generationConfig":{"max_output_tokens":99000}}),
        json!({"generationConfig":{"candidateCount":2}}),
    ] {
        assert!(gemini::body(&payload, custom.as_object().unwrap().clone()).is_err());
    }
    assert!(anthropic::body(
        &payload,
        json!({"system":"override"}).as_object().unwrap().clone()
    )
    .is_err());
    for cap in [json!(0), json!(-1), json!("4000"), Value::Null] {
        assert!(anthropic::body(
            &payload,
            json!({"max_tokens":cap}).as_object().unwrap().clone()
        )
        .is_err());
        assert!(gemini::body(
            &payload,
            json!({"generationConfig":{"maxOutputTokens":cap}})
                .as_object()
                .unwrap()
                .clone()
        )
        .is_err());
    }
}

fn server(body: String, status: u16) -> (String, std::thread::JoinHandle<()>) {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let thread = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        let mut bytes = [0; 1024];
        while !request.windows(4).any(|w| w == b"\r\n\r\n") {
            let length = socket.read(&mut bytes).unwrap();
            if length == 0 {
                return;
            }
            request.extend_from_slice(&bytes[..length]);
        }
        write!(socket,"HTTP/1.1 {status} Test\r\nContent-Type: text/event-stream\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",body.len()).unwrap();
        for fragment in body.as_bytes().chunks(7) {
            if socket.write_all(fragment).is_err() {
                return;
            }
            std::thread::sleep(Duration::from_millis(1));
        }
    });
    (format!("http://{address}"), thread)
}

#[tokio::test]
async fn all_new_providers_parse_fragmented_utf8_sse_and_terminal_usage() {
    for (kind,body) in [
        ("nanogpt","data: {\"choices\":[{\"delta\":{\"content\":\"日本\"}}]}\n\ndata: {\"usage\":{\"prompt_tokens\":100,\"completion_tokens\":20}}\n\ndata: [DONE]\n\n"),
        ("anthropic","event: content_block_delta\ndata: {\"type\":\"content_block_delta\",\"delta\":{\"type\":\"text_delta\",\"text\":\"日本\"}}\n\ndata: {\"type\":\"message_delta\",\"usage\":{\"output_tokens\":20}}\n\ndata: {\"type\":\"message_stop\"}\n\n"),
        ("gemini","data: {\"candidates\":[{\"content\":{\"parts\":[{\"text\":\"日本\"}]}}]}\n\ndata: {\"candidates\":[{\"finishReason\":\"STOP\"}],\"usageMetadata\":{\"candidatesTokenCount\":20}}\n\n"),
    ] {
        let (url,thread) = server(body.into(),200);
        let response = CLIENT.get(url).send().await.unwrap();
        let mut received = String::new();
        let usage = consume(response,CloudProvider::parse(Some(kind)).unwrap(),&CancellationToken::new(),|text,thinking| {
            received.push_str(&std::mem::take(text)); thinking.clear(); Ok(())
        }).await.unwrap().unwrap();
        assert_eq!(received,"日本"); assert_eq!(usage.output_tokens,Some(20));
        thread.join().unwrap();
    }
}

#[tokio::test]
async fn interrupted_and_malformed_streams_fail_instead_of_succeeding_silently() {
    for body in [
        "data: not-json\n\n",
        "data: {\"candidates\":[]}\n\n",
        "data: {\"error\":{\"message\":\"rate limited\"}}\n\n",
    ] {
        let (url, thread) = server(body.into(), 200);
        let response = CLIENT.get(url).send().await.unwrap();
        assert!(
            consume(response, CloudProvider::Gemini, &CancellationToken::new(), |_, _| Ok(()))
                .await
                .is_err()
        );
        thread.join().unwrap();
    }
}

#[tokio::test]
async fn cancellation_ends_a_native_stream_and_does_not_require_a_terminal_event() {
    let (url, thread) = server("data: {\"type\":\"ping\"}\n\n".into(), 200);
    let response = CLIENT.get(url).send().await.unwrap();
    let token = CancellationToken::new();
    token.cancel();
    assert!(consume(response, CloudProvider::Anthropic, &token, |_, _| Ok(()))
        .await
        .is_ok());
    thread.join().unwrap();
}

#[tokio::test]
async fn http_errors_preserve_status_and_redact_credentials_and_prompt() {
    let (url, thread) = server(
        json!({"error":{"message":"test-key Hello denied","code":"permission_denied"}}).to_string(),
        403,
    );
    let error = json_response(
        CLIENT.get(url),
        "test-key",
        "model",
        &[json!({"content":"Hello"})],
    )
    .await
    .unwrap_err();
    let error: Value = serde_json::from_str(&error).unwrap();
    assert_eq!(error["status"], 403);
    assert_eq!(error["code"], "permission_denied");
    assert!(!error["message"].as_str().unwrap().contains("test-key"));
    assert!(!error["message"].as_str().unwrap().contains("Hello"));
    thread.join().unwrap();
}

#[tokio::test]
async fn stop_interrupts_both_connection_and_idle_native_stream() {
    for headers_first in [false, true] {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let mut bytes = [0; 1024];
            let _ = socket.read(&mut bytes);
            if headers_first {
                let _ = socket.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: text/event-stream\r\nContent-Length: 10000\r\n\r\n");
            }
            std::thread::sleep(Duration::from_millis(250));
        });
        let token = CancellationToken::new();
        let cancellation = token.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(30)).await;
            cancellation.cancel();
        });
        let started = std::time::Instant::now();
        let response = send_cancellable(CLIENT.get(format!("http://{address}")), &token, "fixture")
            .await
            .unwrap();
        if headers_first {
            assert!(
                consume(response.unwrap(), CloudProvider::Anthropic, &token, |_, _| Ok(()))
                    .await
                    .is_ok()
            );
        } else {
            assert!(response.is_none());
        }
        assert!(started.elapsed() < Duration::from_millis(200));
        thread.join().unwrap();
    }
}


#[tokio::test]
async fn compatible_stream_requires_completion_and_preserves_usage_after_finish() {
    for (body, valid) in [
        ("data: {\"choices\":[{\"delta\":{\"content\":\"partial\"}}]}\n\n", false),
        ("data: broken\n\n", false),
        ("data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\ndata: {\"usage\":{\"completion_tokens\":7}}\n\n", true),
        ("data: [DONE]\n\n", true),
    ] {
        let (url, thread) = server(body.into(), 200);
        let response = CLIENT.get(url).send().await.unwrap();
        let result = super::super::consume_compatible(response, &request("openai"), &CancellationToken::new(), |_, _| Ok(())).await;
        assert_eq!(result.is_ok(), valid);
        if body.contains("completion_tokens") { assert_eq!(result.unwrap().unwrap().output_tokens, Some(7)); }
        thread.join().unwrap();
    }
}

#[tokio::test]
async fn compatible_cancel_accepts_partial_without_completion() {
    let (url, thread) = server("data: {}\n\n".into(), 200);
    let response = CLIENT.get(url).send().await.unwrap();
    let token = CancellationToken::new();
    token.cancel();
    assert!(super::super::consume_compatible(response, &request("openai"), &token, |_, _| Ok(())).await.is_ok());
    thread.join().unwrap();
}

#[test]
fn streaming_errors_keep_protocol_network_and_provider_categories() {
    assert!(matches!(decode(CloudProvider::Anthropic, "{}"), Err(StreamFailure::Protocol(_))));
    let payload = request("gemini");
    for (error, expected) in [
        (StreamFailure::Protocol("bad event".into()), "protocol"),
        (StreamFailure::Transport("connection lost".into()), "network"),
        (StreamFailure::Provider(json!({"error":{"message":"test-key Hello","code":429}}).to_string()), "api"),
    ] {
        let value: Value = serde_json::from_str(&error.into_ipc(&payload)).unwrap();
        assert_eq!(value["kind"], expected);
        assert!(!value["message"].as_str().unwrap().contains("test-key"));
        assert!(!value["message"].as_str().unwrap().contains("Hello"));
    }
}


#[test]
fn shared_frontend_contracts_match_final_provider_bodies() {
    let fixtures: Value = serde_json::from_str(include_str!("../../../../tests/fixtures/provider-contracts.json")).unwrap();
    for fixture in fixtures.as_array().unwrap() {
        let kind = fixture["kind"].as_str().unwrap();
        let mut payload = request(kind);
        payload.model = "fixture-model".into();
        payload.top_p = Some(0.5);
        payload.messages = vec![json!({"role":"user","content":"Hello"})];
        payload.url = fixture["url"].as_str().unwrap().into();
        payload.request_parameter_config = serde_json::from_value(fixture["config"].clone()).unwrap();
        let additional = payload.request_parameter_config.additional_parameters.clone();
        let body = match CloudProvider::parse(Some(kind)) {
            Some(CloudProvider::NanoGpt) => nanogpt::body(&payload, additional).unwrap(),
            Some(CloudProvider::Anthropic) => anthropic::body(&payload, additional).unwrap(),
            Some(CloudProvider::Gemini) => gemini::body(&payload, additional).unwrap(),
            None => super::super::compatible_body(&payload).unwrap(),
        };
        assert_eq!(body, fixture["expectedBody"], "{}", fixture["name"]);
        if let Some(kind) = CloudProvider::parse(Some(kind)) { assert!(validate_base(&payload.url, kind, "fixture-key").is_ok()); }
    }
}

#[test]
fn metadata_keeps_native_limits_thinking_and_parameter_evidence_distinct() {
    let model = gemini::model(&json!({"name":"models/fixture","supportedGenerationMethods":["generateContent"],
        "thinking":true,"inputTokenLimit":100000,"outputTokenLimit":8000})).unwrap();
    assert_eq!(model.thinking_supported, Some(true));
    assert_eq!(model.reasoning, None);
    assert_eq!(model.parameter_source, Some("api_contract"));
    assert_eq!(model.input_token_limit, Some(100000));
    assert_eq!(model.output_token_limit, Some(8000));
    let unknown = nanogpt::model(&json!({"id":"fixture"})).unwrap();
    assert_eq!(unknown.thinking_supported, None);
    assert_eq!(unknown.reasoning, None);
}


#[tokio::test]
async fn stop_interrupts_an_idle_http_error_body() {
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let (release, wait) = std::sync::mpsc::channel();
    let thread = std::thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 2048];
        socket.read(&mut request).unwrap();
        socket.write_all(b"HTTP/1.1 503 Service Unavailable\r\nContent-Length: 1000\r\n\r\n").unwrap();
        socket.flush().unwrap();
        wait.recv_timeout(Duration::from_secs(2)).unwrap();
    });
    let response = CLIENT.get(url).send().await.unwrap();
    let token = CancellationToken::new();
    let cancel = token.clone();
    tokio::spawn(async move { tokio::time::sleep(Duration::from_millis(10)).await; cancel.cancel(); });
    assert!(tokio::time::timeout(Duration::from_secs(1), read_error_body(response, &token)).await.unwrap().is_none());
    release.send(()).unwrap();
    thread.join().unwrap();
}
