use futures::stream::StreamExt;
use eventsource_stream::Eventsource;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{Emitter, Window};

// Reusing a single HTTP client across the entire app lifecycle prevents connection 
// exhaustion and takes advantage of internal connection pooling.
pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);

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
}

/// Payload received from the frontend to initiate an AI generation request.
#[derive(Deserialize)]
pub(crate) struct AiRequest {
    url: String,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: f32,
}

/// Payload emitted back to the frontend containing the generated text.
#[derive(Serialize, Clone)]
struct TokenPayload {
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
#[tauri::command]
pub async fn call_ai_api(window: Window, payload: AiRequest) -> Result<(), String> {
    let mut req = CLIENT
        .post(format!("{}/chat/completions", payload.url))
        .json(&serde_json::json!({
            "model": payload.model,
            "messages": payload.messages,
            "temperature": payload.temperature,
            "stream": true
        }));

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
    let mut last_emit = Instant::now();
    let batch_delay = Duration::from_millis(25);

    while let Some(event_result) = stream.next().await {
        match event_result {
            Ok(event) => {
                if event.data == "[DONE]" {
                    break;
                }
                if let Ok(chunk) = serde_json::from_str::<StreamChunk>(&event.data) {
                    if let Some(content) = chunk.choices.first().and_then(|c| c.delta.content.as_ref()) {
                        token_batch.push_str(content);
                    }
                }
            }
            Err(e) => {
                eprintln!("SSE Error: {}", e);
            }
        }

        if !token_batch.is_empty() && last_emit.elapsed() > batch_delay {
            let batch = std::mem::take(&mut token_batch);
            window.emit("ai-token", TokenPayload { token: batch }).map_err(|e| e.to_string())?;
            last_emit = Instant::now();
        }
    }

    if !token_batch.is_empty() {
        window.emit("ai-token", TokenPayload { token: token_batch }).map_err(|e| e.to_string())?;
    }

    Ok(())
}