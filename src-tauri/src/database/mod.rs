use rusqlite::Connection;
use std::fs;
use tauri::{AppHandle, Manager};

pub mod chats;
pub mod messages;
pub mod settings;
pub mod characters;

const DB_FILENAME: &str = "ryokan.db";

/// Establishes a connection to the local SQLite database.
/// Foreign keys are enabled per-connection, as SQLite disables them by default.
pub fn get_connection(app: &AppHandle) -> Result<Connection, String> {
    let app_dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Failed to get app local data dir: {}", e))?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir)
            .map_err(|e| format!("Failed to create app data directory: {}", e))?;
    }

    let db_path = app_dir.join(DB_FILENAME);
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open database: {}", e))?;

    conn.execute_batch("PRAGMA foreign_keys = ON;")
        .map_err(|e| format!("Failed to enable foreign keys: {}", e))?;

    Ok(conn)
}

/// Initializes the database schema on app startup.
pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let conn = get_connection(app)?;

    let schema = r#"
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT,
            character_id TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            role TEXT,
            content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        -- Keeps updated_at current so conversations are sorted by latest activity.
        CREATE TRIGGER IF NOT EXISTS update_conversation_timestamp
        AFTER INSERT ON messages
        BEGIN
            UPDATE conversations SET updated_at = CURRENT_TIMESTAMP
            WHERE id = NEW.conversation_id;
        END;

        CREATE TABLE IF NOT EXISTS settings (
            key TEXT PRIMARY KEY,
            value TEXT
        );

        CREATE TABLE IF NOT EXISTS characters (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            desc TEXT,
            personality TEXT,
            scenario TEXT,
            greeting TEXT,
            alternate_greetings TEXT,
            mes_example TEXT,
            creator_notes TEXT,
            tags TEXT,
            v3_spec BOOLEAN,
            initials TEXT,
            color TEXT,
            avatar BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    "#;

    conn.execute_batch(schema)
        .map_err(|e| format!("Failed to initialize database schema: {}", e))?;

    Ok(())
}