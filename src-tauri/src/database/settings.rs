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
pub async fn get_all_settings(app: AppHandle) -> Result<Vec<SettingRow>, String> {
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
pub async fn save_setting(app: AppHandle, key: String, value: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES (?1, ?2)",
        params![key, value],
    ).map_err(|e| e.to_string())?;
    
    Ok(())
}

fn validate_api_connections(connections_json: &str, active_connection_id: &str) -> Result<(), String> {
    let connections: serde_json::Value = serde_json::from_str(connections_json)
        .map_err(|_| "Invalid API connections data".to_string())?;
    let items = connections.as_array().filter(|items| !items.is_empty())
        .ok_or_else(|| "At least one API connection is required".to_string())?;
    if items.iter().any(|item| item.get("id").and_then(|id| id.as_str()) == Some(active_connection_id)) {
        Ok(())
    } else {
        Err("The active API connection does not exist".into())
    }
}

/// Atomically saves the canonical connection collection and active selection.
/// Validation happens before the transaction; credentials are never logged.
#[tauri::command]
pub async fn save_api_connections(
    app: AppHandle,
    connections_json: String,
    active_connection_id: String,
) -> Result<(), String> {
    validate_api_connections(&connections_json, &active_connection_id)?;

    let conn = get_connection(&app)?;
    let tx = conn.unchecked_transaction().map_err(|e| e.to_string())?;
    tx.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('api_connections', ?1)", [&connections_json]).map_err(|e| e.to_string())?;
    tx.execute("INSERT OR REPLACE INTO settings (key, value) VALUES ('active_api_connection_id', ?1)", [&active_connection_id]).map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::validate_api_connections;

    #[test]
    fn active_connection_must_exist_after_connection_edits() {
        let connections = r#"[{"id":"a","providerKind":"openai"},{"id":"c","providerKind":"ollama"}]"#;
        assert!(validate_api_connections(connections, "a").is_ok());
        assert!(validate_api_connections(connections, "b").is_err());
        assert!(validate_api_connections("[]", "a").is_err());
    }
}
