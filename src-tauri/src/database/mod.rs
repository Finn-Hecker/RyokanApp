use rusqlite::Connection;
use std::fs;
use tauri::{AppHandle, Manager};

pub mod chats;
pub mod messages;
pub mod settings;
pub mod characters;
pub mod world_info;
pub mod roles;
pub mod folders;

const DB_FILENAME: &str = "ryokan.db";

fn normalize_character_play_modes(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute(
        "UPDATE characters
         SET play_mode = 'solo'
         WHERE play_mode IS NULL OR play_mode NOT IN ('solo', 'multiplayer')",
        [],
    )
}

fn remove_legacy_thinking_setting(conn: &Connection) -> rusqlite::Result<usize> {
    conn.execute("DELETE FROM settings WHERE key = 'thinking_mode'", [])
}

fn migrate_roles_prompt(conn: &Connection) -> rusqlite::Result<usize> {
    let has_prompt = conn
        .prepare("PRAGMA table_info(roles)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?
        .iter()
        .any(|column| column == "prompt");

    if has_prompt {
        return Ok(0);
    }

    // Keep the legacy columns for compatibility, but make prompt the canonical
    // description for all new Role reads and writes.
    conn.execute_batch("ALTER TABLE roles ADD COLUMN prompt TEXT NOT NULL DEFAULT '';")?;

    conn.execute(
        "UPDATE roles
         SET prompt = bio
         WHERE TRIM(prompt) = '' AND TRIM(bio) <> ''",
        [],
    )
}

fn migrate_character_roles(conn: &Connection) -> rusqlite::Result<usize> {
    let columns = conn
        .prepare("PRAGMA table_info(characters)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    let mut added = 0;
    if !columns.iter().any(|column| column == "role_policy") {
        conn.execute_batch(
            "ALTER TABLE characters ADD COLUMN role_policy TEXT NOT NULL DEFAULT 'open'
                CHECK (role_policy IN ('open', 'restricted'));",
        )?;
        added += 1;
    }
    if !columns.iter().any(|column| column == "bundled_roles") {
        conn.execute_batch(
            "ALTER TABLE characters ADD COLUMN bundled_roles TEXT NOT NULL DEFAULT '[]';",
        )?;
        added += 1;
    }
    Ok(added)
}

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
            mode TEXT NOT NULL DEFAULT 'singleplayer',
            created_at DATETIME DEFAULT {utc_now},
            updated_at DATETIME DEFAULT {utc_now},
            is_pinned INTEGER NOT NULL DEFAULT 0,
            cloned_from_id TEXT,
            cloned_from_title TEXT,
            folder_id TEXT REFERENCES chat_folders(id) ON DELETE SET NULL,
            sort_order INTEGER,
            role_snapshot TEXT
        );

        CREATE TABLE IF NOT EXISTS chat_folders (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'singleplayer',
            sort_order INTEGER NOT NULL DEFAULT 0,
            is_collapsed INTEGER NOT NULL DEFAULT 0,
            created_at DATETIME DEFAULT {utc_now}
        );

        CREATE INDEX IF NOT EXISTS idx_chat_folders_mode_order
            ON chat_folders(mode, sort_order);

        CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at DESC);

        CREATE INDEX IF NOT EXISTS idx_conversations_pinned_updated
            ON conversations(is_pinned DESC, updated_at DESC);

        CREATE TABLE IF NOT EXISTS messages (
            id TEXT PRIMARY KEY,
            conversation_id TEXT,
            role TEXT,
            content TEXT,
            author TEXT,
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
            play_mode TEXT NOT NULL DEFAULT 'solo',
            avatar BLOB,
            world_info_ids TEXT NOT NULL DEFAULT '[]',
            role_policy TEXT NOT NULL DEFAULT 'open'
                CHECK (role_policy IN ('open', 'restricted')),
            bundled_roles TEXT NOT NULL DEFAULT '[]',
            created_at DATETIME DEFAULT {utc_now}
        );

        CREATE TABLE IF NOT EXISTS roles (
            id       TEXT PRIMARY KEY,
            name     TEXT NOT NULL,
            prompt   TEXT NOT NULL DEFAULT '',
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

    // Thinking support is detected from streamed output now. Remove the
    // retired preference so databases created by older versions migrate
    // cleanly without carrying an unused manual override.
    remove_legacy_thinking_setting(&conn)
        .map_err(|e| format!("Failed to remove legacy thinking setting: {}", e))?;

    // Roles are reusable global templates. Existing bio text is migrated once
    // when prompt is empty; subsequent Role writes use prompt only.
    migrate_roles_prompt(&conn)
        .map_err(|e| format!("Failed to migrate Role prompts: {}", e))?;

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

    // Multiplayer sessions reuse the normal conversation/message tables. The
    // defaults keep every pre-0.5 database and all existing rows singleplayer.
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN mode TEXT NOT NULL DEFAULT 'singleplayer';"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN folder_id TEXT REFERENCES chat_folders(id) ON DELETE SET NULL;"
    );
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN sort_order INTEGER;"
    );
    // A selected player Role is copied into the conversation at creation
    // time. Existing conversations remain NULL and keep their old prompts.
    let _ = conn.execute_batch(
        "ALTER TABLE conversations ADD COLUMN role_snapshot TEXT;"
    );
    // Folder disclosure state is local UI organization and belongs alongside
    // the folder metadata so it survives restarts.
    let _ = conn.execute_batch(
        "ALTER TABLE chat_folders ADD COLUMN is_collapsed INTEGER NOT NULL DEFAULT 0;"
    );
    conn.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_conversations_folder_order
         ON conversations(mode, folder_id, sort_order);"
    ).map_err(|e| format!("Failed to index conversation ordering: {}", e))?;
    let _ = conn.execute_batch(
        "ALTER TABLE messages ADD COLUMN author TEXT;"
    );

    // Characters created before play modes existed default to singleplayer.
    let _ = conn.execute_batch(
        "ALTER TABLE characters ADD COLUMN play_mode TEXT NOT NULL DEFAULT 'solo';"
    );

    // Card-local Role snapshots are embedded so they remain independent from
    // the reusable global Role library. Defaults preserve every existing Card.
    migrate_character_roles(&conn)
        .map_err(|e| format!("Failed to migrate Character Role snapshots: {}", e))?;

    // "both" is no longer a supported mode. Normalize it, NULLs, and any
    // unknown values so older databases remain usable with the stricter model.
    normalize_character_play_modes(&conn)
        .map_err(|e| format!("Failed to normalize character play modes: {}", e))?;

    // Preserve the legacy pinned/recent order for existing chats. Subsequent
    // drag-and-drop operations write explicit positions.
    conn.execute_batch(
        "UPDATE conversations AS conversation
         SET sort_order = (
             SELECT COUNT(*) FROM conversations AS preceding
             WHERE preceding.mode = conversation.mode
               AND (
                   preceding.is_pinned > conversation.is_pinned OR
                   (preceding.is_pinned = conversation.is_pinned AND preceding.updated_at > conversation.updated_at) OR
                   (preceding.is_pinned = conversation.is_pinned AND preceding.updated_at = conversation.updated_at AND preceding.rowid < conversation.rowid)
               )
         )
         WHERE sort_order IS NULL;"
    ).map_err(|e| format!("Failed to initialize conversation ordering: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        migrate_character_roles, migrate_roles_prompt, normalize_character_play_modes,
        remove_legacy_thinking_setting,
    };
    use rusqlite::{params, Connection};

    #[test]
    fn legacy_and_invalid_character_play_modes_migrate_to_solo() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE characters (id TEXT PRIMARY KEY, play_mode TEXT);
             INSERT INTO characters VALUES
                ('solo', 'solo'),
                ('multi', 'multiplayer'),
                ('both', 'both'),
                ('invalid', 'something-else'),
                ('missing', NULL);",
        )
        .unwrap();

        normalize_character_play_modes(&conn).unwrap();

        for id in ["solo", "both", "invalid", "missing"] {
            let mode: String = conn
                .query_row(
                    "SELECT play_mode FROM characters WHERE id = ?1",
                    params![id],
                    |row| row.get(0),
                )
                .unwrap();
            assert_eq!(mode, "solo", "{id}");
        }
        let multiplayer: String = conn
            .query_row(
                "SELECT play_mode FROM characters WHERE id = 'multi'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(multiplayer, "multiplayer");
    }

    #[test]
    fn existing_characters_get_open_policy_and_empty_bundled_roles_idempotently() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE characters (id TEXT PRIMARY KEY, name TEXT NOT NULL);
             INSERT INTO characters VALUES ('existing', 'Existing Card');",
        ).unwrap();

        assert_eq!(migrate_character_roles(&conn).unwrap(), 2);
        assert_eq!(migrate_character_roles(&conn).unwrap(), 0);

        let migrated: (String, String) = conn.query_row(
            "SELECT role_policy, bundled_roles FROM characters WHERE id = 'existing'",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).unwrap();
        assert_eq!(migrated, ("open".into(), "[]".into()));
        assert!(conn.execute(
            "UPDATE characters SET role_policy = 'invalid' WHERE id = 'existing'",
            [],
        ).is_err());
    }

    #[test]
    fn legacy_thinking_setting_is_removed_without_touching_other_settings() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT);
             INSERT INTO settings VALUES ('thinking_mode', 'true');
             INSERT INTO settings VALUES ('api_thinking_budget', '2500');",
        )
        .unwrap();

        assert_eq!(remove_legacy_thinking_setting(&conn).unwrap(), 1);
        assert_eq!(remove_legacy_thinking_setting(&conn).unwrap(), 0);

        let budget: String = conn
            .query_row(
                "SELECT value FROM settings WHERE key = 'api_thinking_budget'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(budget, "2500");
    }

    #[test]
    fn role_prompt_migration_preserves_data_and_is_idempotent() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE roles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT '',
                pronouns TEXT NOT NULL DEFAULT '',
                avatar BLOB
             );
             INSERT INTO roles (id, name, bio, pronouns, avatar)
             VALUES ('role-id', 'Detective', 'Investigates mysteries', 'they/them', X'010203');",
        )
        .unwrap();

        assert_eq!(migrate_roles_prompt(&conn).unwrap(), 1);
        assert_eq!(migrate_roles_prompt(&conn).unwrap(), 0);

        let migrated: (String, String, String, String, Vec<u8>) = conn
            .query_row(
                "SELECT id, name, prompt, pronouns, avatar FROM roles WHERE id = 'role-id'",
                [],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(
            migrated,
            (
                "role-id".into(),
                "Detective".into(),
                "Investigates mysteries".into(),
                "they/them".into(),
                vec![1, 2, 3],
            )
        );

        conn.execute("UPDATE roles SET prompt = '' WHERE id = 'role-id'", [])
            .unwrap();
        assert_eq!(migrate_roles_prompt(&conn).unwrap(), 0);
        let intentionally_empty: String = conn
            .query_row("SELECT prompt FROM roles WHERE id = 'role-id'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(intentionally_empty, "");
    }

    #[test]
    fn role_prompt_migration_does_not_overwrite_an_existing_prompt() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE roles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                bio TEXT NOT NULL DEFAULT ''
             );
             INSERT INTO roles (id, name, prompt, bio)
             VALUES ('role-id', 'Detective', 'Canonical prompt', 'Legacy bio');",
        )
        .unwrap();

        assert_eq!(migrate_roles_prompt(&conn).unwrap(), 0);
        let prompt: String = conn
            .query_row("SELECT prompt FROM roles WHERE id = 'role-id'", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(prompt, "Canonical prompt");
    }
}
