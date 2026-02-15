use tauri::AppHandle;
use rusqlite::params;
use serde::{Serialize, Deserialize};
use crate::database::get_connection;

/// Represents a single configuration key-value pair. 
/// Using a flat key-value schema for settings allows us to easily add new 
/// app preferences in the future without requiring database migrations.
#[derive(Serialize, Deserialize)]
pub struct SettingRow {
    pub key: String,
    pub value: String,
}

/// Retrieves all user preferences from the database.
/// Typically called once during app initialization to hydrate the frontend state.
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

/// Upserts a configuration value.
/// Uses `INSERT OR REPLACE` to cleanly handle both the creation of new settings 
/// and the updating of existing ones in a single, atomic query.
#[tauri::command]
pub fn save_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}