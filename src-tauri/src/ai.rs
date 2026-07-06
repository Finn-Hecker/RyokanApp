use futures::stream::StreamExt;
use eventsource_stream::Eventsource;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{Emitter, Window};
use tokio_util::sync::CancellationToken;

// Reusing a single HTTP client across the entire app lifecycle prevents connection 
// exhaustion and takes advantage of internal connection pooling.
pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);

// Mutex allows swapping the token on each new request.
static CANCEL_TOKEN: Lazy<Mutex<CancellationToken>> =
    Lazy::new(|| Mutex::new(CancellationToken::new()));

/// Called from the frontend to hard-stop the current stream.
/// Cancels the active token, which makes the running select! arm resolve to None
/// and drops the underlying TCP connection.
#[tauri::command]
pub fn stop_generation() {
    CANCEL_TOKEN.lock().unwrap().cancel();
}

/// OpenAI-compatible SSE (Server-Sent Events) streaming structs.
#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    delta: Delta,
}

#[derive(Deserialize)]
struct Delta {
    content: Option<String>,
    reasoning_content: Option<String>,
}

/// Payload received from the frontend to initiate an AI generation request.
/// New fields carry a camelCase alias in addition to their snake_case name, since it's
/// unclear which casing convention the caller uses for them yet — existing fields are
/// left untouched to avoid breaking whatever already works.
#[derive(Deserialize)]
pub(crate) struct AiRequest {
    url: String,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: f32,
    max_tokens: Option<u32>,
    // NOTE: historically named `presence_penalty` but intentionally mapped below to the
    // JSON key "repetition_penalty" — that's the llama.cpp/koboldcpp sampler local models
    // (LM Studio included) actually understand and it's the more effective anti-repeat
    // knob for roleplay. Kept as-is to avoid breaking existing saved settings; true
    // OpenAI-style presence/frequency penalties are added separately below.
    presence_penalty: Option<f32>,

    // --- Additional roleplay-relevant sampling params ---
    #[serde(alias = "topP")]
    top_p: Option<f32>,
    #[serde(alias = "topK")]
    top_k: Option<u32>,
    #[serde(alias = "minP")]
    min_p: Option<f32>,
    #[serde(alias = "frequencyPenalty")]
    frequency_penalty: Option<f32>,

    // --- Thinking / reasoning model support (Gemma 4, Qwen3, ...) ---
    #[serde(alias = "isThinkingModel")]
    is_thinking_model: bool,
    // Token budget for the reasoning phase. Forwarded to llama.cpp's
    // `thinking_budget_tokens` request field. 0 = end reasoning immediately,
    // omitted/None = let the server default (usually unrestricted) apply.
    #[serde(alias = "thinkingBudget")]
    thinking_budget: Option<u32>,
}

/// Payload emitted back to the frontend containing the generated text.
#[derive(Serialize, Clone)]
struct TokenPayload {
    token: String,
}

/// Payload emitted back to the frontend containing reasoning/"thinking" text.
#[derive(Serialize, Clone)]
struct ThinkingTokenPayload {
    token: String,
}

/// OpenAI-compatible /models response structs.
#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
}

/// Fetches available models from an OpenAI-compatible /models endpoint.
/// Uses the shared CLIENT with an optional Bearer token for providers like OpenRouter.
/// Running the HTTP call on the Rust side avoids CORS issues in the Tauri WebView.
#[tauri::command]
pub async fn fetch_models(url: String, api_key: String) -> Result<Vec<String>, String> {
    let mut req = CLIENT.get(format!("{}/models", url));

    if !api_key.is_empty() {
        req = req.bearer_auth(&api_key);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API error: Status {}", res.status()));
    }

    let body_text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let body: ModelsResponse = serde_json::from_str(&body_text)
        .map_err(|e| format!("Failed to parse models response: {}. Raw body: {}", e, &body_text[..body_text.len().min(500)]))?;

    let ids = body.data.into_iter().map(|m| m.id).collect();
    Ok(ids)
}

/// Streams completions from an OpenAI-compatible API endpoint.
/// Batches incoming tokens before emitting them to the frontend to prevent 
/// overwhelming the Tauri IPC bridge and freezing the Svelte UI.
/// Uses a CancellationToken so stop_generation() drops the TCP connection immediately.
#[tauri::command]
pub async fn call_ai_api(window: Window, payload: AiRequest) -> Result<(), String> {
    // Replace the global token so stop_generation() targets this request.
    let token = CancellationToken::new();
    *CANCEL_TOKEN.lock().unwrap() = token.clone();

    let mut body = serde_json::json!({
        "model": payload.model,
        "messages": payload.messages,
        "temperature": payload.temperature,
        "stream": true
    });

    if let Some(max_tokens) = payload.max_tokens {
        body["max_tokens"] = serde_json::json!(max_tokens);
    }
    // Mapped to "repetition_penalty" (llama.cpp/koboldcpp sampler), not the OpenAI
    // "presence_penalty" semantics — see the doc comment on AiRequest::presence_penalty.
    if let Some(penalty) = payload.presence_penalty {
        body["repetition_penalty"] = serde_json::json!(penalty);
    }
    if let Some(top_p) = payload.top_p {
        body["top_p"] = serde_json::json!(top_p);
    }
    if let Some(top_k) = payload.top_k {
        body["top_k"] = serde_json::json!(top_k);
    }
    if let Some(min_p) = payload.min_p {
        body["min_p"] = serde_json::json!(min_p);
    }
    if let Some(freq_penalty) = payload.frequency_penalty {
        body["frequency_penalty"] = serde_json::json!(freq_penalty);
    }

    // Thinking / reasoning models (Gemma 4, Qwen3, ...) are toggled per-request via
    // llama.cpp's chat_template_kwargs. Sending this even when disabled is intentional,
    // so switching a character/model between thinking and non-thinking mid-session
    // doesn't leak the previous request's state.
    body["chat_template_kwargs"] = serde_json::json!({ "enable_thinking": payload.is_thinking_model });
    if payload.is_thinking_model {
        if let Some(budget) = payload.thinking_budget {
            // 0 = end reasoning immediately, N>0 = token budget, omit for server default (usually unrestricted).
            body["thinking_budget_tokens"] = serde_json::json!(budget);
        }
    }

    let mut req = CLIENT
        .post(format!("{}/chat/completions", payload.url))
        .json(&body);

    if !payload.api_key.is_empty() {
        req = req.bearer_auth(&payload.api_key);
    }

    let res = req
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API error: Status {}", res.status()));
    }

    let mut stream = res.bytes_stream().eventsource();

    let mut token_batch = String::new();
    let mut thinking_batch = String::new();
    let mut last_emit = Instant::now();
    let batch_delay = Duration::from_millis(25);

    loop {
        // Cancelled arm resolves to None, breaking the loop and dropping the TCP socket.
        let event_result = tokio::select! {
            result = stream.next() => result,
            _ = token.cancelled() => None,
        };

        let Some(event_result) = event_result else {
            break;
        };

        match event_result {
            Ok(event) => {
                if event.data == "[DONE]" {
                    break;
                }
                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(&event.data) {
                    if let Some(delta) = chunk.choices.first().map(|c| &c.delta) {
                        if let Some(content) = delta.content.as_ref() {
                            token_batch.push_str(content);
                        }
                        if let Some(reasoning) = delta.reasoning_content.as_ref() {
                            thinking_batch.push_str(reasoning);
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("SSE Error: {}", e);
            }
        }

        if (!token_batch.is_empty() || !thinking_batch.is_empty()) && last_emit.elapsed() > batch_delay {
            if !token_batch.is_empty() {
                let batch = std::mem::take(&mut token_batch);
                window.emit("ai-token", TokenPayload { token: batch }).map_err(|e| e.to_string())?;
            }
            if !thinking_batch.is_empty() {
                let batch = std::mem::take(&mut thinking_batch);
                window.emit("ai-thinking-token", ThinkingTokenPayload { token: batch }).map_err(|e| e.to_string())?;
            }
            last_emit = Instant::now();
        }
    }

    // Flush whatever was buffered when the stream stopped (or was cancelled).
    if !token_batch.is_empty() {
        window.emit("ai-token", TokenPayload { token: token_batch }).map_err(|e| e.to_string())?;
    }
    if !thinking_batch.is_empty() {
        window.emit("ai-thinking-token", ThinkingTokenPayload { token: thinking_batch }).map_err(|e| e.to_string())?;
    }

    Ok(())
}