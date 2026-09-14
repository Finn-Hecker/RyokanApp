use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use tauri::AppHandle;
use uuid::Uuid;

use crate::database::get_connection;

#[derive(Serialize)]
pub struct ChatFolder {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub sort_order: i64,
    pub is_collapsed: bool,
}

#[derive(Deserialize)]
pub struct ChatPlacement {
    pub id: String,
    pub folder_id: Option<String>,
    pub sort_order: i64,
}

fn normalized_mode(mode: &str) -> &str {
    if mode == "multiplayer" {
        "multiplayer"
    } else {
        "singleplayer"
    }
}

#[tauri::command]
pub async fn get_chat_folders(app: AppHandle, mode: String) -> Result<Vec<ChatFolder>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, mode, sort_order, is_collapsed FROM chat_folders
         WHERE mode = ?1 ORDER BY sort_order ASC, rowid ASC",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![normalized_mode(&mode)], |row| {
            Ok(ChatFolder {
                id: row.get(0)?,
                name: row.get(1)?,
                mode: row.get(2)?,
                sort_order: row.get(3)?,
                is_collapsed: row.get::<_, i64>(4)? != 0,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn create_chat_folder(
    app: AppHandle,
    name: String,
    mode: String,
) -> Result<ChatFolder, String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Folder name cannot be empty".into());
    }
    let conn = get_connection(&app)?;
    let mode = normalized_mode(&mode);
    let sort_order: i64 = conn
        .query_row(
            "SELECT COALESCE(MAX(sort_order) + 1, 0) FROM chat_folders WHERE mode = ?1",
            params![mode],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let folder = ChatFolder {
        id: Uuid::new_v4().to_string(),
        name: name.to_string(),
        mode: mode.to_string(),
        sort_order,
        is_collapsed: false,
    };
    conn.execute(
        "INSERT INTO chat_folders (id, name, mode, sort_order) VALUES (?1, ?2, ?3, ?4)",
        params![folder.id, folder.name, folder.mode, folder.sort_order],
    )
    .map_err(|e| e.to_string())?;
    Ok(folder)
}

#[tauri::command]
pub async fn rename_chat_folder(app: AppHandle, id: String, name: String) -> Result<(), String> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Folder name cannot be empty".into());
    }
    let conn = get_connection(&app)?;
    conn.execute(
        "UPDATE chat_folders SET name = ?1 WHERE id = ?2",
        params![name, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_chat_folder_collapsed(
    app: AppHandle,
    id: String,
    is_collapsed: bool,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    let changed = conn
        .execute(
            "UPDATE chat_folders SET is_collapsed = ?1 WHERE id = ?2",
            params![is_collapsed, id],
        )
        .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("Unknown chat folder".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn delete_chat_folder(app: AppHandle, id: String) -> Result<(), String> {
    let mut conn = get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    tx.execute(
        "UPDATE conversations SET folder_id = NULL WHERE folder_id = ?1",
        params![id],
    )
    .map_err(|e| e.to_string())?;
    tx.execute("DELETE FROM chat_folders WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn save_sidebar_organization(
    app: AppHandle,
    mode: String,
    folder_ids: Vec<String>,
    chats: Vec<ChatPlacement>,
) -> Result<(), String> {
    let mut conn = get_connection(&app)?;
    let mode = normalized_mode(&mode);
    let folder_set: HashSet<&str> = folder_ids.iter().map(String::as_str).collect();
    if folder_set.len() != folder_ids.len() {
        return Err("Duplicate folder id".into());
    }
    let chat_set: HashSet<&str> = chats.iter().map(|chat| chat.id.as_str()).collect();
    if chat_set.len() != chats.len() {
        return Err("Duplicate chat id".into());
    }

    let expected_folders: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM chat_folders WHERE mode = ?1",
            params![mode],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let expected_chats: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM conversations WHERE mode = ?1",
            params![mode],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    if expected_folders != folder_ids.len() as i64 || expected_chats != chats.len() as i64 {
        return Err("Sidebar changed while it was being reordered".into());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (index, id) in folder_ids.iter().enumerate() {
        let changed = tx
            .execute(
                "UPDATE chat_folders SET sort_order = ?1 WHERE id = ?2 AND mode = ?3",
                params![index as i64, id, mode],
            )
            .map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("Unknown folder in sidebar ordering".into());
        }
    }
    for chat in chats {
        if let Some(folder_id) = chat.folder_id.as_deref() {
            let folder_mode: Option<String> = tx
                .query_row(
                    "SELECT mode FROM chat_folders WHERE id = ?1",
                    params![folder_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|e| e.to_string())?;
            if folder_mode.as_deref() != Some(mode) {
                return Err("Chat cannot be moved to that folder".into());
            }
        }
        let changed = tx.execute(
            "UPDATE conversations SET folder_id = ?1, sort_order = ?2 WHERE id = ?3 AND mode = ?4",
            params![chat.folder_id, chat.sort_order, chat.id, mode],
        ).map_err(|e| e.to_string())?;
        if changed != 1 {
            return Err("Unknown chat in sidebar ordering".into());
        }
    }
    tx.commit().map_err(|e| e.to_string())
}
