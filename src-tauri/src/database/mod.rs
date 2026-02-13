use rusqlite::{Connection};
use tauri::{AppHandle, Manager};
use std::fs;

pub mod chats;
pub mod messages;
pub mod settings;

const DB_FILENAME: &str = "ryokan.db";

pub fn get_connection(app: &AppHandle) -> Result<Connection, String> {
    let app_dir = app.path().app_local_data_dir()
        .map_err(|e| e.to_string())?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let db_path = app_dir.join(DB_FILENAME);
    Connection::open(db_path).map_err(|e| e.to_string())
}

pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let conn = get_connection(app)?;
    conn.execute_batch(
        "CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT,
            character_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            role TEXT,
            content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id)
        );
        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );"
    ).map_err(|e| e.to_string())?;
    Ok(())
}