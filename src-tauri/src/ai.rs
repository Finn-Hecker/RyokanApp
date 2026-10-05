use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Emitter, Window};
use tokio_util::sync::CancellationToken;

mod cloud;
mod context;
mod models;
mod parameters;
mod pricing;
#[cfg(test)]
mod tests;
mod usage;

pub use context::DetectedContextMetadata;
pub use models::{ModelInfo, ModelPricing, ModelReasoningInfo};
use parameters::{
    apply_compatible_sampling, compatible_body, merge_additional_api_parameters,
    parse_additional_api_parameters, request_stream_usage, RequestApiParameterConfig,
};
#[cfg(test)]
use parameters::{apply_reasoning_level, apply_service_tier, RequestPurpose};
pub use usage::TokenUsage;
use usage::{count_at, merge_token_usage, parse_token_usage, response_text, stream_token_usage};

/// Stable Tauri boundary for model catalogs; protocols live in the model module.
#[tauri::command]
pub async fn fetch_models(
    url: String,
    api_key: String,
    provider_kind: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    models::fetch_models(url, api_key, provider_kind).await
}

/// Stable Tauri boundary for context detection, independent of generation.
#[tauri::command]
pub async fn detect_context(
    provider_kind: String,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<DetectedContextMetadata, String> {
    context::detect_context(provider_kind, base_url, model, api_key).await
}

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
struct ActiveCancellation {
    request_id: u64,
    generation_id: Option<String>,
    token: CancellationToken,
}

static ACTIVE_CANCELLATION: Lazy<Mutex<Option<ActiveCancellation>>> =
    Lazy::new(|| Mutex::new(None));
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

struct ActiveCancellationGuard {
    request_id: u64,
}

impl Drop for ActiveCancellationGuard {
    fn drop(&mut self) {
        let mut active = ACTIVE_CANCELLATION.lock();
        if active.as_ref().map(|entry| entry.request_id) == Some(self.request_id) {
            *active = None;
        }
    }
}

fn cancellation_matches(active_id: &Option<String>, requested_id: &Option<String>) -> bool {
    requested_id.is_none() || active_id == requested_id
}

/// Called from the frontend to hard-stop the current stream.
/// Cancels the active token, which makes the running select! arm resolve to None
/// and drops the underlying TCP connection.
#[tauri::command]
pub fn stop_generation(generation_id: Option<String>) {
    let active = ACTIVE_CANCELLATION.lock();
    let Some(active) = active.as_ref() else {
        return;
    };

    // Calls without an id are the legacy singleplayer path and retain their
    // existing "stop the current request" behaviour. Multiplayer supplies an
    // id so a late Stop from an older stream cannot cancel a newer request.
    if cancellation_matches(&active.generation_id, &generation_id) {
        active.token.cancel();
    }
}

/// OpenAI-compatible SSE (Server-Sent Events) streaming structs.
#[derive(Deserialize)]
struct StreamChunk {
    #[serde(default)]
    choices: Vec<Choice>,
}

#[derive(Debug)]
enum StreamFailure {
    Transport(String),
    Protocol(String),
    Provider(String),
    Delivery(String),
}

impl StreamFailure {
    fn into_ipc(self, payload: &AiRequest) -> String {
        use crate::diagnostics::{record, Event};
        let (kind, message) = match self {
            Self::Provider(body) => {
                record(Event::ProviderFailed);
                return api_error_from_body(
                    0,
                    &body,
                    &payload.api_key,
                    &payload.model,
                    &payload.messages,
                );
            }
            Self::Transport(message) => {
                record(Event::StreamFailed);
                ("network", message)
            }
            Self::Protocol(message) => {
                record(Event::StreamInvalid);
                ("protocol", message)
            }
            Self::Delivery(message) => ("ipc", message),
        };
        serde_json::to_string(&AiApiError {
            kind,
            message: sanitize_api_error_message(&message, &payload.api_key, &payload.messages),
            status: None,
            code: None,
            provider: None,
            model: Some(payload.model.clone()),
        })
        .unwrap()
    }
}

#[derive(Deserialize)]
struct Choice {
    #[serde(default)]
    delta: Delta,
    finish_reason: Option<String>,
}

#[derive(Deserialize, Default)]
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
    /// Persisted conversation identity; only OpenRouter receives it as session_id.
    #[serde(alias = "chatId")]
    chat_id: Option<String>,
    #[serde(alias = "generationId")]
    generation_id: Option<String>,
    #[serde(alias = "providerKind")]
    provider_kind: Option<String>,
    #[serde(alias = "requestParameterConfig")]
    request_parameter_config: RequestApiParameterConfig,
    url: String,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: f32,
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
}

/// Payload emitted back to the frontend containing the generated text.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TokenPayload {
    token: String,
    generation_id: Option<String>,
}

/// Payload emitted back to the frontend containing reasoning/"thinking" text.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThinkingTokenPayload {
    token: String,
    generation_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiApiError {
    kind: &'static str,
    message: String,
    status: Option<u16>,
    code: Option<String>,
    provider: Option<String>,
    model: Option<String>,
}

fn sanitize_api_error_message(
    message: &str,
    api_key: &str,
    messages: &[serde_json::Value],
) -> String {
    let mut safe = if api_key.is_empty() {
        message.to_string()
    } else {
        message.replace(api_key, "[redacted]")
    };
    for prompt in messages
        .iter()
        .filter_map(|message| message.get("content").and_then(|value| value.as_str()))
    {
        if !prompt.is_empty() {
            safe = safe.replace(prompt, "[prompt redacted]");
        }
    }
    for marker in ["authorization:", "authorization\"", "bearer "] {
        if let Some(index) = safe.to_ascii_lowercase().find(marker) {
            safe.truncate(index);
            safe.push_str("[redacted]");
        }
    }
    safe.chars()
        .take(1000)
        .collect::<String>()
        .trim()
        .to_string()
}

fn api_error_from_body(
    status: u16,
    body: &str,
    api_key: &str,
    model: &str,
    messages: &[serde_json::Value],
) -> String {
    let value = serde_json::from_str::<serde_json::Value>(body).unwrap_or_default();
    let error = value.get("error").unwrap_or(&value);
    let raw_message = error
        .get("message")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("message").and_then(|v| v.as_str()))
        .unwrap_or_else(|| {
            if body.trim().is_empty() {
                "The API returned an error."
            } else {
                body.trim()
            }
        });
    let code = error
        .get("code")
        .or_else(|| value.get("code"))
        .and_then(|v| {
            v.as_str()
                .map(String::from)
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        });
    let provider = error
        .pointer("/metadata/provider_name")
        .and_then(|v| v.as_str())
        .or_else(|| error.pointer("/metadata/provider").and_then(|v| v.as_str()))
        .or_else(|| value.get("provider").and_then(|v| v.as_str()))
        .map(String::from);
    serde_json::to_string(&AiApiError {
        kind: "api",
        message: sanitize_api_error_message(raw_message, api_key, messages),
        status: (status != 0).then_some(status),
        code,
        provider,
        model: Some(model.to_string()),
    })
    .unwrap_or_else(|_| "{\"kind\":\"api\",\"message\":\"The API returned an error.\"}".into())
}

fn transport_error(error: &reqwest::Error, model: &str) -> String {
    serde_json::to_string(&AiApiError {
        kind: if error.is_timeout() {
            "timeout"
        } else {
            "network"
        },
        message: if error.is_timeout() {
            "The request timed out.".into()
        } else {
            "The API could not be reached.".into()
        },
        status: error.status().map(|status| status.as_u16()),
        code: None,
        provider: None,
        model: Some(model.to_string()),
    })
    .unwrap()
}

/// Emits whatever is currently buffered in either batch, then clears both buffers.
/// Shared by the periodic flush tick and the final flush after the loop ends, so the
/// emit logic only lives in one place.
fn flush_batches(
    window: &Window,
    token_batch: &mut String,
    thinking_batch: &mut String,
    generation_id: &Option<String>,
) -> Result<(), String> {
    if !token_batch.is_empty() {
        let batch = std::mem::take(token_batch);
        window
            .emit(
                "ai-token",
                TokenPayload {
                    token: batch,
                    generation_id: generation_id.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
    }
    if !thinking_batch.is_empty() {
        let batch = std::mem::take(thinking_batch);
        window
            .emit(
                "ai-thinking-token",
                ThinkingTokenPayload {
                    token: batch,
                    generation_id: generation_id.clone(),
                },
            )
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
pub async fn call_ai_api(window: Window, payload: AiRequest) -> Result<Option<TokenUsage>, String> {
    crate::diagnostics::record(crate::diagnostics::Event::GenerationStarted);
    // Replace the active token so stop_generation() targets this request.
    let token = CancellationToken::new();
    let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    *ACTIVE_CANCELLATION.lock() = Some(ActiveCancellation {
        request_id,
        generation_id: payload.generation_id.clone(),
        token: token.clone(),
    });
    // Every return path (success, error, or cancellation) clears this request's
    // handle, but never a newer request that replaced it in the meantime.
    let _active_guard = ActiveCancellationGuard { request_id };

    if cloud::is_provider(payload.provider_kind.as_deref()) {
        return cloud::generate(&window, &payload, &token).await;
    }

    let body = compatible_body(&payload)?;

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
        result = req.send() => result.map_err(|e| {
            crate::diagnostics::record(crate::diagnostics::Event::TransportFailed);
            transport_error(&e, &payload.model)
        })?,
        _ = token.cancelled() => return Ok(None),
    };

    if !res.status().is_success() {
        crate::diagnostics::record(crate::diagnostics::Event::ProviderFailed);
        let status = res.status().as_u16();
        let Some(response_body) = read_error_body(res, &token).await else {
            return Ok(None);
        };
        return Err(api_error_from_body(
            status,
            &response_body,
            &payload.api_key,
            &payload.model,
            &payload.messages,
        ));
    }

    consume_compatible(res, &payload, &token, |text, thinking| {
        flush_batches(&window, text, thinking, &payload.generation_id)
    })
    .await
    .map_err(|error| error.into_ipc(&payload))
}

async fn read_error_body(response: reqwest::Response, token: &CancellationToken) -> Option<String> {
    tokio::select! {
        biased;
        _ = token.cancelled() => None,
        body = response.text() => Some(body.unwrap_or_default()),
    }
}

// Kept separate from native streaming: compatible servers use finish_reason or DONE.
async fn consume_compatible<F>(
    response: reqwest::Response,
    payload: &AiRequest,
    token: &CancellationToken,
    mut flush: F,
) -> Result<Option<TokenUsage>, StreamFailure>
where
    F: FnMut(&mut String, &mut String) -> Result<(), String>,
{
    let mut stream = response.bytes_stream().eventsource();
    let mut reported_usage = None;
    let mut finished = false;

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
                        if event.data.trim() == "[DONE]" {
                            finished = true;
                            break;
                        }
                        let value: serde_json::Value = serde_json::from_str(&event.data)
                            .map_err(|_| StreamFailure::Protocol("The provider sent malformed streaming JSON.".into()))?;
                        if value.get("error").is_some() {
                            return Err(StreamFailure::Provider(event.data));
                        }
                        if let Some(usage) = stream_token_usage(&value, payload.provider_kind.as_deref()) {
                            reported_usage = Some(merge_token_usage(reported_usage, usage));
                        }
                        match serde_json::from_value::<StreamChunk>(value) {
                            Ok(chunk) => {
                                finished |= chunk.choices.iter().any(|choice| choice.finish_reason.is_some());
                                if let Some(delta) = chunk.choices.first().map(|c| &c.delta) {
                                    if let Some(content) = delta.content.as_ref() {
                                        token_batch.push_str(content);
                                    }
                                    if let Some(reasoning) = delta.reasoning_content.as_ref() {
                                        thinking_batch.push_str(reasoning);
                                    }
                                }
                            }
                            Err(_) => {
                                return Err(StreamFailure::Protocol("The provider sent an invalid completion event.".into()));
                            }
                        }
                    }
                    Err(_) => {
                        return Err(StreamFailure::Transport("The provider stream was interrupted.".into()));
                    }
                }
            }

            _ = flush_tick.tick() => {
                flush(&mut token_batch, &mut thinking_batch).map_err(StreamFailure::Delivery)?;
            }
        }
    }

    // Flush whatever was buffered when the stream stopped (DONE, cancel, or close).
    flush(&mut token_batch, &mut thinking_batch).map_err(StreamFailure::Delivery)?;

    if !finished && !token.is_cancelled() {
        return Err(StreamFailure::Protocol(
            "The provider stream ended before completion.".into(),
        ));
    }
    Ok(reported_usage)
}
