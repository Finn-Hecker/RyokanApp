use rusqlite::Connection;
use std::fs;
use tauri::{AppHandle, Manager};

pub mod chats;
pub mod messages;
pub mod settings;
pub mod characters;
pub mod world_info;
pub mod roles;

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

    conn.execute_batch(
        "PRAGMA foreign_keys = ON;
         PRAGMA journal_mode = WAL;
         PRAGMA synchronous = NORMAL;
         PRAGMA busy_timeout = 5000;"
    ).map_err(|e| format!("Failed to configure connection pragmas: {}", e))?;

    Ok(conn)
}

/// Initializes the database schema on app startup.
/// Also runs lightweight migrations (e.g. adding new columns to existing tables).
pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let conn = get_connection(app)?;

    // All timestamp columns default to this instead of bare CURRENT_TIMESTAMP.
    // SQLite's CURRENT_TIMESTAMP returns UTC but formatted as
    // "2026-07-08 19:32:00" — a space instead of "T" and no "Z"/offset.
    // JS's `Date` constructor doesn't recognize that as UTC and silently
    // reads it as local time instead, which made a chat that was just
    // started already look hours old for anyone outside UTC. This produces
    // a proper ISO-8601 UTC string ("2026-07-08T19:32:00.123Z") that every
    // consumer parses unambiguously.
    const UTC_NOW: &str = "(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))";

    let schema = format!(
        r#"
        CREATE TABLE IF NOT EXISTS conversations (
            id TEXT PRIMARY KEY,
            title TEXT,
            character_id TEXT,
            created_at DATETIME DEFAULT {utc_now},
            updated_at DATETIME DEFAULT {utc_now},
            is_pinned INTEGER NOT NULL DEFAULT 0,
            cloned_from_id TEXT,
            cloned_from_title TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_conversations_pinned_updated
            ON conversations(is_pinned DESC, updated_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            role TEXT,
            content TEXT,
            swipe_variants TEXT NOT NULL DEFAULT '[]',
            swipe_index INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT {utc_now},
            FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_messages_conversation
            ON messages(conversation_id, created_at);

        -- Keeps updated_at current so conversations are sorted by latest activity.
        CREATE TRIGGER IF NOT EXISTS update_conversation_timestamp
        AFTER INSERT ON messages
        BEGIN
            UPDATE conversations SET updated_at = {utc_now}
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
            world_info_ids TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT {utc_now}
        );

        CREATE TABLE IF NOT EXISTS roles (
            id       TEXT PRIMARY KEY,
            name     TEXT NOT NULL,
            bio      TEXT NOT NULL DEFAULT '',
            pronouns TEXT NOT NULL DEFAULT '',
            avatar   BLOB,
            created_at DATETIME DEFAULT {utc_now}
        );
        CREATE TABLE IF NOT EXISTS world_infos (
            id          TEXT PRIMARY KEY,
            name        TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            entries     TEXT NOT NULL DEFAULT '[]',
            created_at  DATETIME DEFAULT {utc_now}
        );
    "#,
        utc_now = UTC_NOW
    );

    conn.execute_batch(&schema)
        .map_err(|e| format!("Failed to initialize database schema: {}", e))?;

    // ── Migration: add is_pinned to existing databases that pre-date this column ──
    // We use a try-ignore pattern to stay compatible with older SQLite versions.
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;"
    );

    // ── Migration: add rolling-summary columns ──
    // These store the in-memory summaryMeta persistently so it survives restarts.
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN summary_text TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN summary_last_message_id TEXT;"
    );

    // ── Migration: add "start new chat from here" clone-tracking columns ──
    // cloned_from_id points at the source conversation; cloned_from_title is a
    // snapshot of its title so the UI badge still works if that chat gets deleted.
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN cloned_from_id TEXT;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN cloned_from_title TEXT;"
    );

    Ok(())
}