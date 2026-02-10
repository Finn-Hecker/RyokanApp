#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use futures::stream::StreamExt;
use eventsource_stream::Eventsource;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::time::{Duration, Instant};
use tauri::{Emitter, Window};
use tauri_plugin_sql::{Migration, MigrationKind};

static CLIENT: Lazy<reqwest::Client> = Lazy::new(reqwest::Client::new);

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

#[derive(Deserialize)]
struct AiRequest {
    url: String,
    messages: Vec<serde_json::Value>,
}

#[derive(Serialize, Clone)]
struct TokenPayload {
    token: String,
}

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
        return Err(format!("API Fehler: Status {}", res.status()));
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

fn main() {
    let migrations = vec![
        Migration {
            version: 1,
            description: "create conversations and messages tables",
            sql: "
                CREATE TABLE conversations (
                    id TEXT PRIMARY KEY,
                    title TEXT,
                    character_id TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
                );
                CREATE TABLE messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    conversation_id TEXT,
                    role TEXT,
                    content TEXT,
                    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                    FOREIGN KEY (conversation_id) REFERENCES conversations(id)
                );
            ",
            kind: MigrationKind::Up,
        },
        Migration {
            version: 2,
            description: "create settings table",
            sql: "
                CREATE TABLE settings (
                    key TEXT PRIMARY KEY,
                    value TEXT
                );
            ",
            kind: MigrationKind::Up,
        }
    ];

    tauri::Builder::default()
        .plugin(
            tauri_plugin_sql::Builder::default()
                .add_migrations("sqlite:ryokan.db", migrations)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![call_ai_api])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}