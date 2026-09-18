use tauri::AppHandle;
use rusqlite::{params};
use uuid::Uuid;
use serde::{Deserialize, Serialize};
use crate::database::get_connection;

/// Represents a chat session with an AI character in the database.
#[derive(Serialize)]
pub struct Conversation {
    pub id: String,
    pub title: String,
    pub character_id: Option<String>,
    pub mode: String,
    pub created_at: String,
    pub updated_at: String,
    pub is_pinned: bool,
    /// Set if this conversation was created via "start new chat from here" —
    /// points at the conversation it was branched off of.
    pub cloned_from_id: Option<String>,
    /// Snapshot of the source conversation's title at clone time, so the
    /// badge in the UI still works even if the source chat is later deleted.
    pub cloned_from_title: Option<String>,
    pub folder_id: Option<String>,
    pub sort_order: i64,
    pub role_snapshot: Option<ChatRoleSnapshot>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ChatRoleSnapshot {
    pub name: String,
    pub prompt: String,
}

#[derive(Deserialize)]
pub struct RoleSelection {
    pub source: String,
    pub id: String,
}

#[derive(Deserialize)]
struct BundledRoleRecord {
    id: String,
    name: String,
    prompt: String,
}

fn deserialize_role_snapshot(raw: Option<String>) -> Option<ChatRoleSnapshot> {
    raw.and_then(|value| serde_json::from_str(&value).ok())
}

fn resolve_role_snapshot(
    conn: &rusqlite::Connection,
    character_id: Option<&str>,
    selection: Option<&RoleSelection>,
) -> Result<Option<ChatRoleSnapshot>, String> {
    let character_roles: Option<(String, String)> = character_id.and_then(|id| {
        conn.query_row(
            "SELECT role_policy, bundled_roles FROM characters WHERE id = ?1",
            params![id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        ).ok()
    });
    let policy = character_roles.as_ref().map(|value| value.0.as_str()).unwrap_or("open");

    let Some(selection) = selection else {
        return if policy == "restricted" {
            Err("Restricted Characters require a bundled Role".into())
        } else {
            Ok(None)
        };
    };

    match selection.source.as_str() {
        "bundled" => {
            let (_, raw) = character_roles
                .ok_or_else(|| "Bundled Role is not available for this Character".to_string())?;
            let roles: Vec<BundledRoleRecord> = serde_json::from_str(&raw)
                .map_err(|e| format!("Invalid bundled_roles data: {e}"))?;
            let role = roles.into_iter().find(|role| role.id == selection.id)
                .ok_or_else(|| "Bundled Role snapshot not found".to_string())?;
            Ok(Some(ChatRoleSnapshot { name: role.name, prompt: role.prompt }))
        }
        "global" => {
            if policy == "restricted" {
                return Err("Restricted Characters only allow bundled Roles".into());
            }
            conn.query_row(
                "SELECT name, prompt FROM roles WHERE id = ?1",
                params![selection.id],
                |row| Ok(ChatRoleSnapshot { name: row.get(0)?, prompt: row.get(1)? }),
            ).map(Some).map_err(|e| e.to_string())
        }
        _ => Err("Role source must be 'global' or 'bundled'".into()),
    }
}

/// Retrieves all chat sessions, ordered by the most recently active.
#[tauri::command]
pub async fn get_conversations(app: AppHandle) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app)?;
    let mut stmt = conn.prepare(
        "SELECT id, title, character_id, mode, created_at, updated_at, is_pinned,
                cloned_from_id, cloned_from_title, folder_id, sort_order, role_snapshot
         FROM conversations
         ORDER BY CASE WHEN folder_id IS NULL THEN 1 ELSE 0 END,
                  CASE WHEN folder_id IS NOT NULL THEN folder_id END ASC,
                  CASE WHEN folder_id IS NOT NULL THEN sort_order END ASC,
                  CASE WHEN folder_id IS NULL THEN updated_at END DESC,
                  CASE WHEN folder_id IS NULL THEN rowid END DESC,
                  rowid ASC"
    ).map_err(|e| e.to_string())?;
    
    let rows = stmt.query_map([], |row| {
        Ok(Conversation {
            id: row.get(0)?,
            title: row.get(1)?,
            character_id: row.get(2)?,
            mode: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            is_pinned: row.get::<_, i64>(6)? != 0,
            cloned_from_id: row.get(7)?,
            cloned_from_title: row.get(8)?,
            folder_id: row.get(9)?,
            sort_order: row.get(10)?,
            role_snapshot: deserialize_role_snapshot(row.get(11)?),
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Retrieves a page of chat sessions for one experience, ordered by pinned first,
/// then most recently active.
#[tauri::command]
pub async fn get_conversations_page(
    app: AppHandle,
    limit: i64,
    offset: i64,
    mode: Option<String>,
    folder_id: Option<String>,
) -> Result<Vec<Conversation>, String> {
    let conn = get_connection(&app)?;
    let mode = match mode.as_deref() {
        Some("multiplayer") => "multiplayer",
        _ => "singleplayer",
    };
    let mut stmt = conn.prepare(
        "SELECT id, title, character_id, mode, created_at, updated_at, is_pinned,
                cloned_from_id, cloned_from_title, folder_id, sort_order, role_snapshot
         FROM conversations
         WHERE mode = ?1
           AND ((?4 IS NULL AND folder_id IS NULL) OR folder_id = ?4)
         ORDER BY is_pinned DESC,
                  CASE WHEN folder_id IS NOT NULL THEN sort_order END ASC,
                  CASE WHEN folder_id IS NULL THEN updated_at END DESC,
                  CASE WHEN folder_id IS NULL THEN rowid END DESC,
                  rowid ASC
         LIMIT ?2 OFFSET ?3"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map(params![mode, limit, offset, folder_id], |row| {
        Ok(Conversation {
            id: row.get(0)?,
            title: row.get(1)?,
            character_id: row.get(2)?,
            mode: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
            is_pinned: row.get::<_, i64>(6)? != 0,
            cloned_from_id: row.get(7)?,
            cloned_from_title: row.get(8)?,
            folder_id: row.get(9)?,
            sort_order: row.get(10)?,
            role_snapshot: deserialize_role_snapshot(row.get(11)?),
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Initializes a new chat session and automatically inserts the character's opening message.
/// Uses an SQLite transaction to guarantee that either both records are created, or neither is.
#[tauri::command]
pub async fn create_chat(
    app: AppHandle,
    character_id: Option<String>,
    character_name: String,
    initial_message: Option<String>,
    mode: Option<String>,
    role_selection: Option<RoleSelection>,
) -> Result<String, String> {
    let mut conn = get_connection(&app)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    let new_id = Uuid::new_v4().to_string();
    let mode = match mode.as_deref() {
        Some("multiplayer") => "multiplayer",
        _ => "singleplayer",
    };
    let title = if mode == "multiplayer" {
        format!("{}", character_name)
    } else {
        format!("{}", character_name)
    };
    let role_snapshot = if mode == "singleplayer" {
        resolve_role_snapshot(&tx, character_id.as_deref(), role_selection.as_ref())?
    } else {
        None
    };
    let role_snapshot_json = role_snapshot
        .map(|snapshot| serde_json::to_string(&snapshot))
        .transpose().map_err(|e| e.to_string())?;

    tx.execute(
        "INSERT INTO conversations (id, title, character_id, mode, sort_order, role_snapshot)
         VALUES (?1, ?2, ?3, ?4,
             (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM conversations
              WHERE mode = ?4 AND folder_id IS NULL), ?5)",
        params![new_id, title, character_id, mode, role_snapshot_json],
    ).map_err(|e| e.to_string())?;
    
    if let Some(msg) = initial_message {
        if !msg.trim().is_empty() {
            let msg_id = Uuid::new_v4().to_string();
            // The trigger will automatically update updated_at on the conversation.
            tx.execute(
                "INSERT INTO messages (id, conversation_id, role, content) VALUES (?1, ?2, ?3, ?4)",
                params![msg_id, new_id, "assistant", msg],
            ).map_err(|e| e.to_string())?;
        }
    }
    
    tx.commit().map_err(|e| e.to_string())?;
    
    Ok(new_id)
}

/// Clones a conversation up to and including one specific message, creating a
/// brand-new, independent chat that starts out with a full copy of the
/// history so far. Used by the "start new chat from here" action on an AI
/// message. Everything after the cut-off message is intentionally NOT
/// copied, and the original conversation is left completely untouched.
#[tauri::command]
pub async fn clone_chat_from_message(
    app: AppHandle,
    chat_id: String,
    up_to_message_id: String,
) -> Result<String, String> {
    let mut conn = get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // Snapshot of the source conversation (title + character).
    let (source_title, character_id, mode, role_snapshot): (String, Option<String>, String, Option<String>) = tx.query_row(
        "SELECT title, character_id, mode, role_snapshot FROM conversations WHERE id = ?1",
        params![chat_id],
        |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
    ).map_err(|e| e.to_string())?;

    // All messages in chronological order, so we can cut at the right spot.
    // rowid is a tiebreaker for messages sharing the same created_at second
    // (e.g. rapid inserts) — it always reflects true insertion order.
    let mut stmt = tx.prepare(
        "SELECT id, role, content, swipe_variants, swipe_index, author
         FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC, rowid ASC"
    ).map_err(|e| e.to_string())?;

    let all_messages: Vec<(String, String, String, String, i64, Option<String>)> = stmt
        .query_map(params![chat_id], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?))
        }).map_err(|e| e.to_string())?
        .collect::<Result<_, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);

    let cut_idx = all_messages
        .iter()
        .position(|(id, ..)| *id == up_to_message_id)
        .ok_or_else(|| "Nachricht wurde nicht gefunden.".to_string())?;
    let messages_to_copy = &all_messages[..=cut_idx];

    // Create the new conversation, remembering where it came from.
    let new_chat_id = Uuid::new_v4().to_string();
    let new_title = format!("🔗 {}", source_title);

    tx.execute(
        "INSERT INTO conversations (id, title, character_id, mode, cloned_from_id, cloned_from_title, sort_order, role_snapshot)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6,
             (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM conversations
              WHERE mode = ?4 AND folder_id IS NULL), ?7)",
        params![new_chat_id, new_title, character_id, mode, chat_id, source_title, role_snapshot],
    ).map_err(|e| e.to_string())?;

    // Copy every message up to the cut-off with fresh ids, preserving role,
    // content and swipe history. Inserted in order so created_at / rowid
    // ordering matches the original conversation.
    for (_, role, content, swipe_variants, swipe_index, author) in messages_to_copy {
        let new_msg_id = Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO messages (id, conversation_id, role, content, swipe_variants, swipe_index, author)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![new_msg_id, new_chat_id, role, content, swipe_variants, swipe_index, author],
        ).map_err(|e| e.to_string())?;
    }

    tx.commit().map_err(|e| e.to_string())?;

    Ok(new_chat_id)
}

/// Renames an existing conversation.
#[tauri::command]
pub async fn rename_chat(app: AppHandle, id: String, title: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "UPDATE conversations SET title = ?1 WHERE id = ?2",
        params![title.trim(), id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

/// Toggles the pinned state of a conversation.
#[tauri::command]
pub async fn toggle_pin_chat(app: AppHandle, id: String) -> Result<bool, String> {
    let conn = get_connection(&app)?;
    // Flip the current value and return the new state.
    conn.execute(
        "UPDATE conversations SET is_pinned = CASE WHEN is_pinned = 1 THEN 0 ELSE 1 END WHERE id = ?1",
        params![id],
    ).map_err(|e| e.to_string())?;
    let new_val: i64 = conn.query_row(
        "SELECT is_pinned FROM conversations WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    Ok(new_val != 0)
}

/// Deletes a conversation and all its associated messages.
/// Wrapped in a transaction to enforce referential integrity and prevent orphaned messages.
#[tauri::command]
pub async fn delete_chat(app: AppHandle, id: String) -> Result<(), String> {
    let mut conn = get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    // ON DELETE CASCADE on messages.conversation_id (foreign_keys=ON is set per-connection
    // in get_connection) already removes all messages for this conversation - no need to
    // do it explicitly first, that was just the same delete done twice.
    tx.execute("DELETE FROM conversations WHERE id = ?1", params![id]).map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Persists the rolling-summary metadata for a conversation so it survives app restarts.
/// Called by the frontend after every successful compression pass.
#[tauri::command]
pub async fn save_summary_meta(
    app: AppHandle,
    chat_id: String,
    summary: Option<String>,
    last_summarized_message_id: Option<String>,
) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute(
        "UPDATE conversations
         SET summary_text = ?1, summary_last_message_id = ?2
         WHERE id = ?3",
        params![summary, last_summarized_message_id, chat_id],
    ).map_err(|e| e.to_string())?;
    Ok(())
}

fn compare_and_swap_summary_meta_row(
    conn: &rusqlite::Connection,
    chat_id: &str,
    expected_summary: Option<&str>,
    expected_last_summarized_message_id: Option<&str>,
    summary: Option<&str>,
    last_summarized_message_id: Option<&str>,
) -> Result<bool, rusqlite::Error> {
    let changed = conn.execute(
        "UPDATE conversations
         SET summary_text = ?1, summary_last_message_id = ?2
         WHERE id = ?3
           AND summary_text IS ?4
           AND summary_last_message_id IS ?5",
        params![
            summary,
            last_summarized_message_id,
            chat_id,
            expected_summary,
            expected_last_summarized_message_id,
        ],
    )?;
    Ok(changed == 1)
}

/// Atomically replaces summary metadata only when the caller's previously
/// loaded value is still current. This lets cancelled frontend work roll back
/// without overwriting a newer summary from another operation.
#[tauri::command]
pub async fn compare_and_swap_summary_meta(
    app: AppHandle,
    chat_id: String,
    expected_summary: Option<String>,
    expected_last_summarized_message_id: Option<String>,
    summary: Option<String>,
    last_summarized_message_id: Option<String>,
) -> Result<bool, String> {
    let conn = get_connection(&app)?;
    compare_and_swap_summary_meta_row(
        &conn,
        &chat_id,
        expected_summary.as_deref(),
        expected_last_summarized_message_id.as_deref(),
        summary.as_deref(),
        last_summarized_message_id.as_deref(),
    ).map_err(|error| error.to_string())
}

/// Loads the persisted rolling-summary metadata for a conversation.
/// Returns null fields when no summary has been generated yet.
#[derive(Serialize)]
pub struct SummaryMeta {
    pub summary: Option<String>,
    pub last_id: Option<String>,
}

#[tauri::command]
pub async fn get_summary_meta(app: AppHandle, chat_id: String) -> Result<SummaryMeta, String> {
    let conn = get_connection(&app)?;
    let result = conn.query_row(
        "SELECT summary_text, summary_last_message_id FROM conversations WHERE id = ?1",
        params![chat_id],
        |row| Ok(SummaryMeta {
            summary: row.get(0)?,
            last_id: row.get(1)?,
        }),
    ).map_err(|e| e.to_string())?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::{
        compare_and_swap_summary_meta_row, deserialize_role_snapshot, resolve_role_snapshot,
        ChatRoleSnapshot, RoleSelection,
    };
    use rusqlite::{params, Connection};

    #[test]
    fn summary_compare_and_swap_is_null_safe_and_rejects_stale_writers() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute(
            "CREATE TABLE conversations (
                id TEXT PRIMARY KEY,
                summary_text TEXT,
                summary_last_message_id TEXT
            )",
            [],
        ).unwrap();
        conn.execute(
            "INSERT INTO conversations (id, summary_text, summary_last_message_id)
             VALUES (?1, NULL, NULL)",
            params!["chat-a"],
        ).unwrap();

        assert!(compare_and_swap_summary_meta_row(
            &conn,
            "chat-a",
            None,
            None,
            Some("candidate"),
            Some("message-a"),
        ).unwrap());
        assert!(!compare_and_swap_summary_meta_row(
            &conn,
            "chat-a",
            None,
            None,
            Some("stale"),
            Some("message-b"),
        ).unwrap());
        assert!(compare_and_swap_summary_meta_row(
            &conn,
            "chat-a",
            Some("candidate"),
            Some("message-a"),
            None,
            None,
        ).unwrap());
    }

    fn role_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE roles (id TEXT PRIMARY KEY, name TEXT NOT NULL, prompt TEXT NOT NULL);
             CREATE TABLE characters (
                id TEXT PRIMARY KEY,
                role_policy TEXT NOT NULL,
                bundled_roles TEXT NOT NULL
             );
             CREATE TABLE conversations (id TEXT PRIMARY KEY, role_snapshot TEXT);
             INSERT INTO roles VALUES ('global-id', 'Traveler', 'Global prompt');
             INSERT INTO characters VALUES (
                'open-card', 'open',
                '[{\"id\":\"bundle-id\",\"name\":\"Local\",\"prompt\":\"Bundled prompt\"}]'
             );
             INSERT INTO characters VALUES (
                'restricted-card', 'restricted',
                '[{\"id\":\"restricted-bundle\",\"name\":\"Prisoner\",\"prompt\":\"Restricted prompt\"}]'
             );",
        ).unwrap();
        conn
    }

    #[test]
    fn open_and_restricted_role_selection_rules_are_enforced_by_id() {
        let conn = role_db();
        assert_eq!(resolve_role_snapshot(&conn, Some("open-card"), None).unwrap(), None);

        let global = resolve_role_snapshot(&conn, Some("open-card"), Some(&RoleSelection {
            source: "global".into(), id: "global-id".into(),
        })).unwrap();
        assert_eq!(global, Some(ChatRoleSnapshot {
            name: "Traveler".into(), prompt: "Global prompt".into(),
        }));

        let bundled = resolve_role_snapshot(&conn, Some("open-card"), Some(&RoleSelection {
            source: "bundled".into(), id: "bundle-id".into(),
        })).unwrap();
        assert_eq!(bundled.unwrap().prompt, "Bundled prompt");

        assert!(resolve_role_snapshot(&conn, Some("restricted-card"), None).is_err());
        assert!(resolve_role_snapshot(&conn, Some("restricted-card"), Some(&RoleSelection {
            source: "global".into(), id: "global-id".into(),
        })).is_err());
        assert!(resolve_role_snapshot(&conn, Some("restricted-card"), Some(&RoleSelection {
            source: "bundled".into(), id: "restricted-bundle".into(),
        })).is_ok());
        assert!(resolve_role_snapshot(&conn, Some("open-card"), Some(&RoleSelection {
            source: "bundled".into(), id: "Local".into(),
        })).is_err(), "names must never work in place of snapshot ids");
    }

    #[test]
    fn persisted_chat_role_is_independent_from_global_and_bundled_sources() {
        let conn = role_db();
        let snapshot = resolve_role_snapshot(&conn, Some("open-card"), Some(&RoleSelection {
            source: "global".into(), id: "global-id".into(),
        })).unwrap().unwrap();
        conn.execute(
            "INSERT INTO conversations VALUES ('chat', ?1)",
            params![serde_json::to_string(&snapshot).unwrap()],
        ).unwrap();

        conn.execute("UPDATE roles SET name = 'Changed', prompt = 'Changed'", []).unwrap();
        conn.execute("DELETE FROM roles", []).unwrap();
        conn.execute("UPDATE characters SET bundled_roles = '[]'", []).unwrap();

        let raw: Option<String> = conn.query_row(
            "SELECT role_snapshot FROM conversations WHERE id = 'chat'", [], |row| row.get(0),
        ).unwrap();
        assert_eq!(deserialize_role_snapshot(raw), Some(ChatRoleSnapshot {
            name: "Traveler".into(), prompt: "Global prompt".into(),
        }));
    }
}
