use tauri::AppHandle;
use rusqlite::params;
use serde::{Serialize, Deserialize};
use crate::database::get_connection;

#[derive(Serialize, Deserialize)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
}

#[tauri::command]
pub fn get_all_settings(app: AppHandle) -> Result<Vec<SettingRow>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare("SELECT key, value FROM settings")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        Ok(SettingRow {
            key: row.get(0)?,
            value: row.get(1)?,
        })
    }).map_err(|e| e.to_string())?;

    let mut settings = Vec::new();
    for row in rows {
        settings.push(row.unwrap());
    }
    Ok(settings)
}

#[tauri::command]
pub fn save_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}