use tauri::AppHandle;
use rusqlite::{params};
use uuid::Uuid;
use serde::Serialize;
use crate::database::get_connection;

/// Represents a chat session with an AI character in the database.
#[derive(Serialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub character_id: Option<String>,
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
}

/// Retrieves all chat sessions, ordered by the most recently active.
#[tauri::command]
pub fn get_conversations(app: AppHandle) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, title, character_id, created_at, updated_at, is_pinned
         FROM conversations
         ORDER BY is_pinned DESC, updated_at DESC"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(Conversation {
            id: row.get(0)?,
            title: row.get(1)?,
            character_id: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            is_pinned: row.get::<_, i64>(5)? != 0,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Retrieves a page of chat sessions, ordered by pinned first, then most recently active.
#[tauri::command]
pub fn get_conversations_page(app: AppHandle, limit: i64, offset: i64) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, title, character_id, created_at, updated_at, is_pinned
         FROM conversations
         ORDER BY is_pinned DESC, updated_at DESC
         LIMIT ?1 OFFSET ?2"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![limit, offset], |row| {
        Ok(Conversation {
            id: row.get(0)?,
            title: row.get(1)?,
            character_id: row.get(2)?,
            created_at: row.get(3)?,
            updated_at: row.get(4)?,
            is_pinned: row.get::<_, i64>(5)? != 0,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Initializes a new chat session and automatically inserts the character's opening message.
/// Uses an SQLite transaction to guarantee that either both records are created, or neither is.
#[tauri::command]
pub fn create_chat(app: AppHandle, character_id: String, character_name: String, initial_message: Option<String>) -> Result<String, String> {
    let mut conn = get_connection(&app)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let new_id = Uuid::new_v4().to_string();
    let title = format!("💬 {}", character_name);

    tx.execute(
        "INSERT INTO conversations (id, title, character_id) VALUES (?1, ?2, ?3)",
        params![new_id, title, character_id],
    ).map_err(|e| e.to_string())?;
    
    if let Some(msg) = initial_message {
        if !msg.trim().is_empty() {
            let msg_id = Uuid::new_v4().to_string();
            // The trigger will automatically update updated_at on the conversation.
            tx.execute(
                "INSERT INTO messages (id, conversation_id, role, content) VALUES (?1, ?2, ?3, ?4)",
                params![msg_id, new_id, "assistant", msg],
            ).map_err(|e| e.to_string())?;
        }
    }
    
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok(new_id)
}

/// Renames an existing conversation.
#[tauri::command]
pub fn rename_chat(app: AppHandle, id: String, title: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "UPDATE conversations SET title = ?1 WHERE id = ?2",
        params![title.trim(), id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggles the pinned state of a conversation.
#[tauri::command]
pub fn toggle_pin_chat(app: AppHandle, id: String) -> Result<bool, String> {
    let conn = get_connection(&app)?;
    // Flip the current value and return the new state.
    conn.execute(
        "UPDATE conversations SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    let new_val: i64 = conn.query_row(
        "SELECT is_pinned FROM conversations WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(new_val != 0)
}

/// Deletes a conversation and all its associated messages.
/// Wrapped in a transaction to enforce referential integrity and prevent orphaned messages.
#[tauri::command]
pub fn delete_chat(app: AppHandle, id: String) -> Result<(), String> {
    let mut conn = get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    
    // Explicitly delete messages first to avoid foreign key constraint violations
    tx.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM conversations WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists the rolling-summary metadata for a conversation so it survives app restarts.
/// Called by the frontend after every successful compression pass.
#[tauri::command]
pub fn save_summary_meta(
    app: AppHandle,
    chat_id: String,
    summary: Option<String>,
    last_summarized_message_id: Option<String>,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "UPDATE conversations
         SET summary_text = ?1, summary_last_message_id = ?2
         WHERE id = ?3",
        params![summary, last_summarized_message_id, chat_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Loads the persisted rolling-summary metadata for a conversation.
/// Returns null fields when no summary has been generated yet.
#[derive(Serialize)]
pub struct SummaryMeta {
    pub summary: Option<String>,
    pub last_id: Option<String>,
}

#[tauri::command]
pub fn get_summary_meta(app: AppHandle, chat_id: String) -> Result<SummaryMeta, String> {
    let conn = get_connection(&app)?;
    let result = conn.query_row(
        "SELECT summary_text, summary_last_message_id FROM conversations WHERE id = ?1",
        params![chat_id],
        |row| Ok(SummaryMeta {
            summary: row.get(0)?,
            last_id: row.get(1)?,
        }),
    ).map_err(|e| e.to_string())?;
    Ok(result)
}