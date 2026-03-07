use tauri::AppHandle;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::database::get_connection;

#[derive(Serialize, Deserialize, Clone)]
pub struct WorldInfoEntry {
    pub id:       String,
    pub keys:     Vec<String>,
    pub content:  String,
    pub enabled:  bool,
    pub comment:  String,
    pub position: String,
}

#[derive(Serialize)]
pub struct DbWorldInfo {
    pub id:          String,
    pub name:        String,
    pub description: String,
    pub entries:     Vec<WorldInfoEntry>,
    pub created_at:  String,
}

#[derive(Deserialize)]
pub struct WorldInfoPayload {
    pub name:        String,
    pub description: Option<String>,
    pub entries:     Vec<WorldInfoEntry>,
}

#[tauri::command]
pub fn get_world_infos(app: AppHandle) -> Result<Vec<DbWorldInfo>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, name, description, entries, created_at
         FROM world_infos ORDER BY created_at DESC",
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
            row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        ))
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        let (id, name, description, entries_json, created_at) =
            row.map_err(|e| e.to_string())?;
        let entries: Vec<WorldInfoEntry> =
            serde_json::from_str(&entries_json).unwrap_or_default();
        list.push(DbWorldInfo { id, name, description, entries, created_at });
    }
    Ok(list)
}

#[tauri::command]
pub fn create_world_info(app: AppHandle, payload: WorldInfoPayload) -> Result<String, String> {
    let conn = get_connection(&app)?;
    let new_id = Uuid::new_v4().to_string();
    let entries_json = serde_json::to_string(&payload.entries)
        .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO world_infos (id, name, description, entries)
         VALUES (?1, ?2, ?3, ?4)",
        params![
            new_id,
            payload.name,
            payload.description.unwrap_or_default(),
            entries_json,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(new_id)
}

#[tauri::command]
pub fn update_world_info(app: AppHandle, id: String, payload: WorldInfoPayload) -> Result<(), String> {
    let conn = get_connection(&app)?;
    let entries_json = serde_json::to_string(&payload.entries)
        .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE world_infos
         SET name = ?1, description = ?2, entries = ?3
         WHERE id = ?4",
        params![
            payload.name,
            payload.description.unwrap_or_default(),
            entries_json,
            id,
        ],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn delete_world_info(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app)?;

    let mut stmt = conn
        .prepare("SELECT id, world_info_ids FROM characters WHERE world_info_ids LIKE ?1")
        .map_err(|e| e.to_string())?;

    let pattern = format!("%{}%", id);

    let rows: Vec<(String, String)> = stmt
        .query_map([&pattern], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(|e| e.to_string())?
        .filter_map(|r| r.ok())
        .collect();

    for (char_id, world_info_ids_json) in rows {
        let mut ids: Vec<String> = serde_json::from_str(&world_info_ids_json)
            .unwrap_or_default();

        ids.retain(|wid| wid != &id);

        let updated = serde_json::to_string(&ids).map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE characters SET world_info_ids = ?1 WHERE id = ?2",
            params![updated, char_id],
        )
        .map_err(|e| e.to_string())?;
    }

    conn.execute("DELETE FROM world_infos WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    Ok(())
}