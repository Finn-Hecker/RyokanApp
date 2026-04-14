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
    /// JSON array of all generated content variants (including the active one).
    pub swipe_variants: String,
    /// Zero-based index pointing to the currently displayed variant.
    pub swipe_index: i64,
}

/// Retrieves the full, chronological message history for a specific conversation.
#[tauri::command]
pub fn get_messages(app: AppHandle, chat_id: String) -> Result<Vec<DbMessage>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, swipe_variants, swipe_index \
         FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![chat_id], |row| {
        Ok(DbMessage {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            swipe_variants: row.get(4)?,
            swipe_index: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Appends a new message to the chat log.
/// Automatically updates the conversation title based on the user's first input.
/// The initial content is stored both in `content` and as the first entry in `swipe_variants`.
#[tauri::command]
pub fn add_message(app: AppHandle, chat_id: String, role: String, content: String) -> Result<(), String> {
    let conn = crate::database::get_connection(&app)?;

    let msg_id = Uuid::new_v4().to_string();
    // Store the initial content as the first (and only) swipe variant.
    let initial_variants = serde_json::to_string(&vec![&content])
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO messages (id, conversation_id, role, content, swipe_variants, swipe_index) \
         VALUES (?1, ?2, ?3, ?4, ?5, 0)",
        rusqlite::params![msg_id, chat_id, role, content, initial_variants],
    ).map_err(|e| e.to_string())?;

    // Auto-titling logic: use the first user message as the conversation title.
    if role == "user" {
        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM messages WHERE conversation_id = ?1 AND role = 'user'",
            rusqlite::params![chat_id],
            |row| row.get(0),
        ).map_err(|e| e.to_string())?;

        if count == 1 {
            let display_content = if content.starts_with("[OOC: ") {
                content
                    .trim_start_matches("[OOC: ")
                    .trim_end_matches(']')
                    .to_string()
            } else {
                content.clone()
            };

            let mut title: String = display_content.chars().take(27).collect();
            if display_content.chars().count() > 27 {
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

/// Appends a new generated variant to an existing assistant message.
/// The new variant is added to the `swipe_variants` array and becomes the active one.
/// Returns the new swipe_index so the frontend can update its local state.
#[tauri::command]
pub fn add_swipe_variant(app: AppHandle, message_id: String, content: String) -> Result<i64, String> {
    let conn = get_connection(&app)?;

    // Fetch current variants JSON.
    let current_variants_json: String = conn.query_row(
        "SELECT swipe_variants FROM messages WHERE id = ?1",
        params![message_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    let mut variants: Vec<String> = serde_json::from_str(&current_variants_json)
        .unwrap_or_default();

    variants.push(content.clone());
    let new_index = (variants.len() as i64) - 1;

    let updated_json = serde_json::to_string(&variants)
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE messages SET content = ?1, swipe_variants = ?2, swipe_index = ?3 WHERE id = ?4",
        params![content, updated_json, new_index, message_id],
    ).map_err(|e| e.to_string())?;

    Ok(new_index)
}

/// Navigates to a specific variant by index without creating a new one.
/// Updates both `swipe_index` and `content` (so the rest of the app always reads the active text).
#[tauri::command]
pub fn set_swipe_index(app: AppHandle, message_id: String, index: i64) -> Result<(), String> {
    let conn = get_connection(&app)?;

    let variants_json: String = conn.query_row(
        "SELECT swipe_variants FROM messages WHERE id = ?1",
        params![message_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    let variants: Vec<String> = serde_json::from_str(&variants_json)
        .unwrap_or_default();

    let clamped = index.max(0).min((variants.len() as i64) - 1);
    let active_content = variants.get(clamped as usize)
        .cloned()
        .unwrap_or_default();

    conn.execute(
        "UPDATE messages SET content = ?1, swipe_index = ?2 WHERE id = ?3",
        params![active_content, clamped, message_id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Updates the text content of an existing message (manual inline edit).
/// Also patches the active variant slot so the two stay in sync.
#[tauri::command]
pub fn update_message(app: AppHandle, id: String, content: String) -> Result<(), String> {
    let conn = get_connection(&app)?;

    let (variants_json, swipe_index): (String, i64) = conn.query_row(
        "SELECT swipe_variants, swipe_index FROM messages WHERE id = ?1",
        params![id],
        |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;

    let mut variants: Vec<String> = serde_json::from_str(&variants_json)
        .unwrap_or_default();

    if let Some(slot) = variants.get_mut(swipe_index as usize) {
        *slot = content.clone();
    }

    let updated_json = serde_json::to_string(&variants)
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE messages SET content = ?1, swipe_variants = ?2 WHERE id = ?3",
        params![content, updated_json, id],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Deletes a single message by its ID.
#[tauri::command]
pub fn delete_message(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "DELETE FROM messages WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Fetches a specific page of messages (for infinite scroll).
#[tauri::command]
pub fn get_messages_page(app: AppHandle, chat_id: String, limit: i64, offset: i64) -> Result<Vec<DbMessage>, String> {
    let conn = get_connection(&app)?;
    
    // Sort by newest first, use limit/offset to fetch the chunk
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, swipe_variants, swipe_index \
         FROM messages WHERE conversation_id = ?1 \
         ORDER BY created_at DESC \
         LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![chat_id, limit, offset], |row| {
        Ok(DbMessage {
            id: row.get(0)?,
            conversation_id: row.get(1)?,
            role: row.get(2)?,
            content: row.get(3)?,
            swipe_variants: row.get(4)?,
            swipe_index: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    
    // IMPORTANT: Reverse the list so the oldest messages in this chunk are at the top
    list.reverse();
    
    Ok(list)
}