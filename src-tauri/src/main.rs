#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures::stream::StreamExt;
use eventsource_stream::Eventsource;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{Emitter, Window};

// Reusing a single HTTP client across the entire app lifecycle prevents connection 
// exhaustion and takes advantage of internal connection pooling.
static CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);

mod database;
mod import;

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
struct AiRequest {
    url: String,
    messages: Vec<serde_json::Value>,
}

/// Payload emitted back to the frontend containing the generated text.
#[derive(Serialize, Clone)]
struct TokenPayload {
    token: String,
}

/// Streams completions from an OpenAI-compatible API endpoint.
/// Batches incoming tokens before emitting them to the frontend to prevent 
/// overwhelming the Tauri IPC bridge and freezing the Svelte UI.
#[tauri::command]
async fn call_ai_api(window: Window, payload: AiRequest) -> Result<(), String> {
    let res = CLIENT
        .post(format!("{}/chat/completions", payload.url))
        .json(&serde_json::json!({
            "model": "local-model",
            "messages": payload.messages,
            "temperature": 0.7,
            "stream": true
        }))
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        return Err(format!("API error: Status {}", res.status()));
    }

    let mut stream = res.bytes_stream().eventsource();
    
    let mut token_batch = String::new();
    let mut last_emit = Instant::now();

    // 25ms batching provides a smooth visual typing effect while drastically 
    // reducing the number of expensive IPC calls to the WebView.
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

        // Emit the batch only if enough time has passed
        if !token_batch.is_empty() && last_emit.elapsed() > batch_delay {
            let batch = std::mem::take(&mut token_batch);
            window.emit("ai-token", TokenPayload { token: batch }).map_err(|e| e.to_string())?;
            last_emit = Instant::now();
        }
    }

    // Flush any remaining tokens after the stream finishes
    if !token_batch.is_empty() {
        window.emit("ai-token", TokenPayload { token: token_batch }).map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            database::init_db(app.handle())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            call_ai_api,
            database::chats::get_conversations,
            database::chats::create_chat,
            database::chats::delete_chat,
            database::messages::get_messages,
            database::messages::add_message,
            database::settings::get_all_settings,
            database::settings::save_setting,
            database::characters::get_custom_characters,
            database::characters::create_character,
            import::parse_character_card,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}