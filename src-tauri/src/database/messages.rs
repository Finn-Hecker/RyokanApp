use tauri::AppHandle;
use rusqlite::{params};
use serde::Serialize;
use uuid::Uuid;
use crate::database::get_connection;

/// Database representation of a single chat message within a conversation.
#[derive(Serialize)]
pub struct DbMessage {
    pub id: String,
    pub conversation_id: String,
    pub role: String,
    pub content: String,
}

/// Retrieves the full, chronological message history for a specific conversation.
#[tauri::command]
pub fn get_messages(app: AppHandle, chat_id: String) -> Result<Vec<DbMessage>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare("SELECT id, conversation_id, role, content FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![chat_id], |row| {
        Ok(DbMessage {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Appends a new message to the chat log. 
/// Automatically updates the conversation title based on the user's first input.
#[tauri::command]
pub fn add_message(app: AppHandle, chat_id: String, role: String, content: String) -> Result<(), String> {
    let conn = crate::database::get_connection(&app)?;

    let msg_id = Uuid::new_v4().to_string();
    
    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content) VALUES (?1, ?2, ?3, ?4)",
        rusqlite::params![msg_id, chat_id, role, content],
    ).map_err(|e| e.to_string())?;

    // Auto-titling logic: If this is the user's very first message in the chat, 
    // we use a truncated snippet of it to replace the default placeholder title.
    if role == "user" {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1 AND role = 'user'",
            rusqlite::params![chat_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        if count == 1 {
            let mut title = content.clone();
            if title.len() > 30 {
                title.truncate(27);
                title.push_str("...");
            }

            conn.execute(
                "UPDATE conversations SET title = ?1 WHERE id = ?2",
                rusqlite::params![title, chat_id],
            ).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}

/// Updates the text content of an existing message.
/// Used when the user manually edits an AI response inline.
#[tauri::command]
pub fn update_message(app: AppHandle, id: String, content: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "UPDATE messages SET content = ?1 WHERE id = ?2",
        params![content, id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Deletes a single message by its ID.
/// Used when retrying an AI response — the old response is removed before re-generating.
#[tauri::command]
pub fn delete_message(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "DELETE FROM messages WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}