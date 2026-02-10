use tauri::AppHandle;
use rusqlite::{params};
use uuid::Uuid;
use serde::Serialize;
use crate::database::get_connection;

#[derive(Serialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub character_id: Option<String>,
    pub created_at: String,
}

#[tauri::command]
pub fn get_conversations(app: AppHandle) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare("SELECT id, title, character_id, created_at FROM conversations ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(Conversation {
            id: row.get(0)?,
            title: row.get(1)?,
            character_id: row.get(2)?,
            created_at: row.get(3)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

#[tauri::command]
pub fn create_chat(app: AppHandle, character_id: String, character_name: String) -> Result<String, String> {
    let conn = get_connection(&app)?;
    let new_id = Uuid::new_v4().to_string();
    let title = format!("Chat mit {}", character_name);
    
    conn.execute(
        "INSERT INTO conversations (id, title, character_id) VALUES (?1, ?2, ?3)",
        params![new_id, title, character_id],
    ).map_err(|e| e.to_string())?;
    
    Ok(new_id)
}

#[tauri::command]
pub fn delete_chat(app: AppHandle, id: String) -> Result<(), String> {
    let mut conn = get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    
    tx.execute("DELETE FROM messages WHERE conversation_id = ?1", params![id]).map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM conversations WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;
    
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}