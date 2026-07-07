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
    /// Set if this conversation was created via "start new chat from here" —
    /// points at the conversation it was branched off of.
    pub cloned_from_id: Option<String>,
    /// Snapshot of the source conversation's title at clone time, so the
    /// badge in the UI still works even if the source chat is later deleted.
    pub cloned_from_title: Option<String>,
}

/// Retrieves all chat sessions, ordered by the most recently active.
#[tauri::command]
pub fn get_conversations(app: AppHandle) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, title, character_id, created_at, updated_at, is_pinned,
                cloned_from_id, cloned_from_title
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
            cloned_from_id: row.get(6)?,
            cloned_from_title: row.get(7)?,
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
        "SELECT id, title, character_id, created_at, updated_at, is_pinned,
                cloned_from_id, cloned_from_title
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
            cloned_from_id: row.get(6)?,
            cloned_from_title: row.get(7)?,
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

/// Clones a conversation up to and including one specific message, creating a
/// brand-new, independent chat that starts out with a full copy of the
/// history so far. Used by the "start new chat from here" action on an AI
/// message. Everything after the cut-off message is intentionally NOT
/// copied, and the original conversation is left completely untouched.
#[tauri::command]
pub fn clone_chat_from_message(
    app: AppHandle,
    chat_id: String,
    up_to_message_id: String,
) -> Result<String, String> {
    let mut conn = get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Snapshot of the source conversation (title + character).
    let (source_title, character_id): (String, Option<String>) = tx.query_row(
        "SELECT title, character_id FROM conversations WHERE id = ?1",
        params![chat_id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    // All messages in chronological order, so we can cut at the right spot.
    // rowid is a tiebreaker for messages sharing the same created_at second
    // (e.g. rapid inserts) — it always reflects true insertion order.
    let mut stmt = tx.prepare(
        "SELECT id, role, content, swipe_variants, swipe_index
         FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC"
    ).map_err(|e| e.to_string())?;

    let all_messages: Vec<(String, String, String, String, i64)> = stmt
        .query_map(params![chat_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?))
        }).map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let cut_idx = all_messages
        .iter()
        .position(|(id, ..)| *id == up_to_message_id)
        .ok_or_else(|| "Nachricht wurde nicht gefunden.".to_string())?;
    let messages_to_copy = &all_messages[..=cut_idx];

    // Create the new conversation, remembering where it came from.
    let new_chat_id = Uuid::new_v4().to_string();
    let new_title = format!("🔗 {}", source_title);

    tx.execute(
        "INSERT INTO conversations (id, title, character_id, cloned_from_id, cloned_from_title)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![new_chat_id, new_title, character_id, chat_id, source_title],
    ).map_err(|e| e.to_string())?;

    // Copy every message up to the cut-off with fresh ids, preserving role,
    // content and swipe history. Inserted in order so created_at / rowid
    // ordering matches the original conversation.
    for (_, role, content, swipe_variants, swipe_index) in messages_to_copy {
        let new_msg_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO messages (id, conversation_id, role, content, swipe_variants, swipe_index)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![new_msg_id, new_chat_id, role, content, swipe_variants, swipe_index],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(new_chat_id)
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