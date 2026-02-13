use tauri::AppHandle;
use rusqlite::params;
use serde::Serialize;
use uuid::Uuid;
use crate::database::get_connection;

#[derive(Serialize)]
pub struct DbCharacter {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub greeting: String,
    pub initials: String,
    pub color: String,
}

#[tauri::command]
pub fn get_custom_characters(app: AppHandle) -> Result<Vec<DbCharacter>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare("SELECT id, name, desc, greeting, initials, color FROM characters ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(DbCharacter {
            id: row.get(0)?,
            name: row.get(1)?,
            desc: row.get(2)?,
            greeting: row.get(3)?,
            initials: row.get(4)?,
            color: row.get(5)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        list.push(row.unwrap());
    }
    Ok(list)
}

#[tauri::command]
pub fn create_character(
    app: AppHandle, 
    name: String, 
    desc: String, 
    greeting: String, 
    initials: String, 
    color: String
) -> Result<String, String> {
    let conn = get_connection(&app)?;
    let new_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO characters (id, name, desc, greeting, initials, color) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![new_id, name, desc, greeting, initials, color],
    ).map_err(|e| e.to_string())?;

    Ok(new_id)
}