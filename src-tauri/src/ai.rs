use futures::stream::StreamExt;
use eventsource_stream::Eventsource;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::{Emitter, Manager, Window};
use tokio_util::sync::CancellationToken;
use crate::database::get_connection;

// Reusing a single HTTP client across the entire app lifecycle prevents connection
// exhaustion and takes advantage of internal connection pooling.
// connect_timeout only bounds how long we wait to establish the TCP/TLS connection -
// it does NOT bound the overall response time, so long-running generations are unaffected.
pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("failed to build reqwest client")
});

// parking_lot::Mutex instead of std::sync::Mutex: no poisoning, so a panic on some
// other thread while holding the lock can never propagate into this one via an
// unwrap(), and lock() returns the guard directly (no Result to unwrap).
static CANCEL_TOKEN: Lazy<Mutex<CancellationToken>> =
    Lazy::new(|| Mutex::new(CancellationToken::new()));

#[derive(Debug, Clone, Copy)]
struct ApiParameterFlags {
    temperature: bool,
    max_tokens: bool,
    presence_penalty: bool,
    thinking_budget: bool,
    top_p: bool,
    top_k: bool,
    min_p: bool,
    frequency_penalty: bool,
}

impl Default for ApiParameterFlags {
    fn default() -> Self {
        Self {
            temperature: true,
            max_tokens: true,
            presence_penalty: true,
            thinking_budget: true,
            top_p: true,
            top_k: true,
            min_p: true,
            frequency_penalty: true,
        }
    }
}

/// Reads the persisted per-parameter switches. Missing keys default to enabled so
/// existing installations keep their current request behavior after updating.
fn load_api_parameter_flags(window: &Window) -> ApiParameterFlags {
    let mut flags = ApiParameterFlags::default();

    let Ok(conn) = get_connection(window.app_handle()) else {
        return flags;
    };

    let mut stmt = match conn.prepare(
        "SELECT key, value FROM settings WHERE key LIKE 'api_%_enabled'"
    ) {
        Ok(stmt) => stmt,
        Err(_) => return flags,
    };

    let rows = match stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        Ok(rows) => rows,
        Err(_) => return flags,
    };

    for row in rows.flatten() {
        let (key, value) = row;
        let enabled = value != "false";

        match key.as_str() {
            "api_temperature_enabled" => flags.temperature = enabled,
            "api_max_tokens_enabled" => flags.max_tokens = enabled,
            "api_presence_penalty_enabled" => flags.presence_penalty = enabled,
            "api_thinking_budget_enabled" => flags.thinking_budget = enabled,
            "api_top_p_enabled" => flags.top_p = enabled,
            "api_top_k_enabled" => flags.top_k = enabled,
            "api_min_p_enabled" => flags.min_p = enabled,
            "api_frequency_penalty_enabled" => flags.frequency_penalty = enabled,
            _ => {}
        }
    }

    flags
}

/// Called from the frontend to hard-stop the current stream.
/// Cancels the active token, which makes the running select! arm resolve to None
/// and drops the underlying TCP connection.
#[tauri::command]
pub fn stop_generation() {
    CANCEL_TOKEN.lock().cancel();
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

    let body: ModelsResponse = serde_json::from_str(&body_text).map_err(|e| {
        // chars().take(n) instead of byte-slicing: slicing a &str at an arbitrary byte
        // index panics if that index falls inside a multi-byte UTF-8 character (e.g. an
        // umlaut or emoji in the server's error message). This is char-boundary safe.
        let preview: String = body_text.chars().take(500).collect();
        format!("Failed to parse models response: {}. Raw body: {}", e, preview)
    })?;

    let ids = body.data.into_iter().map(|m| m.id).collect();
    Ok(ids)
}

/// Emits whatever is currently buffered in either batch, then clears both buffers.
/// Shared by the periodic flush tick and the final flush after the loop ends, so the
/// emit logic only lives in one place.
fn flush_batches(
    window: &Window,
    token_batch: &mut String,
    thinking_batch: &mut String,
) -> Result<(), String> {
    if !token_batch.is_empty() {
        let batch = std::mem::take(token_batch);
        window
            .emit("ai-token", TokenPayload { token: batch })
            .map_err(|e| e.to_string())?;
    }
    if !thinking_batch.is_empty() {
        let batch = std::mem::take(thinking_batch);
        window
            .emit("ai-thinking-token", ThinkingTokenPayload { token: batch })
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Streams completions from an OpenAI-compatible API endpoint.
/// Batches incoming tokens before emitting them to the frontend to prevent
/// overwhelming the Tauri IPC bridge and freezing the Svelte UI.
/// Uses a CancellationToken so stop_generation() drops the TCP connection immediately -
/// including during the initial connect, not just once streaming has started.
#[tauri::command]
pub async fn call_ai_api(window: Window, payload: AiRequest) -> Result<(), String> {
    // Replace the global token so stop_generation() targets this request.
    let token = CancellationToken::new();
    *CANCEL_TOKEN.lock() = token.clone();

    let parameter_flags = load_api_parameter_flags(&window);

    let mut body = serde_json::json!({
        "model": payload.model,
        "messages": payload.messages,
        "stream": true
    });

    if parameter_flags.temperature {
        body["temperature"] = serde_json::json!(payload.temperature);
    }

    if parameter_flags.max_tokens {
        if let Some(max_tokens) = payload.max_tokens {
            body["max_tokens"] = serde_json::json!(max_tokens);
        }
    }
    // Mapped to "repetition_penalty" (llama.cpp/koboldcpp sampler), not the OpenAI
    // "presence_penalty" semantics — see the doc comment on AiRequest::presence_penalty.
    if parameter_flags.presence_penalty {
        if let Some(penalty) = payload.presence_penalty {
            body["repetition_penalty"] = serde_json::json!(penalty);
        }
    }
    if parameter_flags.top_p {
        if let Some(top_p) = payload.top_p {
            body["top_p"] = serde_json::json!(top_p);
        }
    }
    if parameter_flags.top_k {
        if let Some(top_k) = payload.top_k {
            body["top_k"] = serde_json::json!(top_k);
        }
    }
    if parameter_flags.min_p {
        if let Some(min_p) = payload.min_p {
            body["min_p"] = serde_json::json!(min_p);
        }
    }
    if parameter_flags.frequency_penalty {
        if let Some(freq_penalty) = payload.frequency_penalty {
            body["frequency_penalty"] = serde_json::json!(freq_penalty);
        }
    }

    // Thinking / reasoning models (Gemma 4, Qwen3, ...) are toggled per-request via
    // llama.cpp's chat_template_kwargs. Sending this even when disabled is intentional,
    // so switching a character/model between thinking and non-thinking mid-session
    // doesn't leak the previous request's state.
    body["chat_template_kwargs"] = serde_json::json!({ "enable_thinking": payload.is_thinking_model });
    if payload.is_thinking_model && parameter_flags.thinking_budget {
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

    // Cancel-aware connect: without this, stop_generation() would do nothing until the
    // first byte arrives, since previously only the streaming loop below watched the
    // token. A server that's slow/unreachable would hang here with no way to abort.
    let res = tokio::select! {
        result = req.send() => result.map_err(|e| e.to_string())?,
        _ = token.cancelled() => return Ok(()),
    };

    if !res.status().is_success() {
        return Err(format!("API error: Status {}", res.status()));
    }

    let mut stream = res.bytes_stream().eventsource();

    let mut token_batch = String::new();
    let mut thinking_batch = String::new();
    let batch_delay = Duration::from_millis(25);

    // Ticks independently of incoming events, so a batch never sits unflushed just
    // because the server paused between chunks (which the old "flush on next event,
    // if enough time has passed" logic was prone to under bursty/uneven streaming).
    let mut flush_tick = tokio::time::interval(batch_delay);
    flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            // Checked first so a Stop click is never left waiting behind a pending
            // event or tick that happens to be ready at the same instant.
            biased;

            _ = token.cancelled() => break,

            maybe_event = stream.next() => {
                let Some(event_result) = maybe_event else {
                    break;
                };

                match event_result {
                    Ok(event) => {
                        if event.data == "[DONE]" {
                            break;
                        }
                        match serde_json::from_str::<StreamChunk>(&event.data) {
                            Ok(chunk) => {
                                if let Some(delta) = chunk.choices.first().map(|c| &c.delta) {
                                    if let Some(content) = delta.content.as_ref() {
                                        token_batch.push_str(content);
                                    }
                                    if let Some(reasoning) = delta.reasoning_content.as_ref() {
                                        thinking_batch.push_str(reasoning);
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("Failed to parse SSE chunk: {} (raw: {})", e, event.data);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("SSE Error: {}", e);
                    }
                }
            }

            _ = flush_tick.tick() => {
                flush_batches(&window, &mut token_batch, &mut thinking_batch)?;
            }
        }
    }

    // Flush whatever was buffered when the stream stopped (DONE, cancel, or close).
    flush_batches(&window, &mut token_batch, &mut thinking_batch)?;

    Ok(())
}