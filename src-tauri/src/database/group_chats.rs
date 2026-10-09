use rusqlite::{Connection, Row};
use serde::{Deserialize, Serialize};

/// Independent of the singleplayer/multiplayer transport mode.
#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ChatKind {
    #[default]
    Single,
    Group,
}

impl rusqlite::types::FromSql for ChatKind {
    fn column_result(value: rusqlite::types::ValueRef<'_>) -> rusqlite::types::FromSqlResult<Self> {
        match value.as_str()? {
            "single" => Ok(Self::Single),
            "group" => Ok(Self::Group),
            _ => Err(rusqlite::types::FromSqlError::Other(
                "Invalid conversation chat_kind".into(),
            )),
        }
    }
}

/// Same snapshot fields as the existing chat-owned character, without a
/// runtime dependency on the character library. Library deletion cannot erase it.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct ChatCharacterSnapshot {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub greeting: String,
    pub initials: String,
    pub color: String,
    #[serde(rename = "avatarUrl", default, skip_serializing_if = "Option::is_none")]
    pub avatar_url: Option<String>,
    #[serde(default)]
    pub world_info_ids: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
pub struct GroupParticipant {
    /// Globally unique, chat-local identity; also the stable speaker ID.
    pub id: String,
    pub conversation_id: String,
    /// Informational source ID, deliberately not a foreign key to the library.
    pub character_id: Option<String>,
    pub character_snapshot: ChatCharacterSnapshot,
    pub sort_order: i64,
    #[serde(default = "participant_active_by_default")]
    pub is_active: bool,
    pub created_at: String,
}

fn participant_active_by_default() -> bool { true }

impl GroupParticipant {
    /// Decode named SQLite columns; malformed snapshots fail rather than
    /// silently resolving against a possibly changed library character.
    pub fn from_row(row: &Row<'_>) -> rusqlite::Result<Self> {
        let raw: String = row.get("character_snapshot")?;
        let character_snapshot = serde_json::from_str(&raw).map_err(|error| {
            rusqlite::Error::FromSqlConversionFailure(
                row.as_ref().column_index("character_snapshot").unwrap_or(0),
                rusqlite::types::Type::Text,
                Box::new(error),
            )
        })?;
        Ok(Self {
            id: row.get("id")?,
            conversation_id: row.get("conversation_id")?,
            character_id: row.get("character_id")?,
            character_snapshot,
            sort_order: row.get("sort_order")?,
            is_active: row.get("is_active")?,
            created_at: row.get("created_at")?,
        })
    }
}

/// Additive and atomic for both fresh and existing databases. Do not rewrite
/// legacy messages or infer participants from character_id/author.
pub(super) fn migrate(conn: &Connection) -> rusqlite::Result<()> {
    let tx = conn.unchecked_transaction()?;
    let has_column = |table: &str, column: &str| -> rusqlite::Result<bool> {
        let mut statement = tx.prepare(&format!("PRAGMA table_info({table})"))?;
        let columns = statement.query_map([], |row| row.get::<_, String>(1))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(columns.iter().any(|name| name == column))
    };
    if !has_column("conversations", "chat_kind")? {
        tx.execute_batch(
            "ALTER TABLE conversations ADD COLUMN chat_kind TEXT NOT NULL DEFAULT 'single'
             CHECK (chat_kind IN ('single', 'group'));",
        )?;
    }
    tx.execute_batch(
        "CREATE TABLE IF NOT EXISTS group_participants (
            id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) > 0),
            conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
            character_id TEXT,
            character_snapshot TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0 CHECK (sort_order >= 0),
            created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         );
         CREATE INDEX IF NOT EXISTS idx_group_participants_conversation_order
             ON group_participants(conversation_id, sort_order, id);",
    )?;
    if !has_column("group_participants", "is_active")? {
        tx.execute_batch(
            "ALTER TABLE group_participants ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1));",
        )?;
    }
    if !has_column("messages", "participant_id")? {
        // NO ACTION preserves referenced speakers but allows deleting the
        // entire conversation (both messages and participants cascade).
        tx.execute_batch(
            "ALTER TABLE messages ADD COLUMN participant_id TEXT REFERENCES group_participants(id);",
        )?;
    }
    tx.execute_batch(
        "CREATE INDEX IF NOT EXISTS idx_messages_participant ON messages(participant_id);
         CREATE TRIGGER IF NOT EXISTS group_participant_insert_guard
         BEFORE INSERT ON group_participants
         WHEN NOT EXISTS (SELECT 1 FROM conversations
                          WHERE id = NEW.conversation_id AND chat_kind = 'group')
         BEGIN SELECT RAISE(ABORT, 'Participants require a group conversation'); END;

         CREATE TRIGGER IF NOT EXISTS group_participant_identity_guard
         BEFORE UPDATE OF id, conversation_id ON group_participants
         WHEN NEW.id IS NOT OLD.id OR NEW.conversation_id IS NOT OLD.conversation_id
         BEGIN SELECT RAISE(ABORT, 'Participant identity is immutable'); END;

         CREATE TRIGGER IF NOT EXISTS conversation_chat_kind_guard
         BEFORE UPDATE OF chat_kind ON conversations
         WHEN (NEW.chat_kind = 'single' AND EXISTS
               (SELECT 1 FROM group_participants WHERE conversation_id = OLD.id))
           OR (NEW.chat_kind = 'group' AND EXISTS
               (SELECT 1 FROM messages WHERE conversation_id = OLD.id
                AND role = 'assistant' AND participant_id IS NULL))
         BEGIN SELECT RAISE(ABORT, 'Chat kind conflicts with existing participants or messages'); END;",
    )?;
    // The FK checks existence; these guards also check role and chat ownership.
    for (name, operation) in [
        ("message_participant_insert_guard", "INSERT"),
        ("message_participant_update_guard", "UPDATE OF participant_id, conversation_id, role"),
    ] {
        tx.execute_batch(&format!(
            "CREATE TRIGGER IF NOT EXISTS {name}
             BEFORE {operation} ON messages
             WHEN (NEW.participant_id IS NOT NULL AND
                   (NEW.role IS NOT 'assistant' OR NOT EXISTS (
                       SELECT 1 FROM group_participants AS participant
                       JOIN conversations AS chat ON chat.id = participant.conversation_id
                       WHERE participant.id = NEW.participant_id
                         AND participant.conversation_id = NEW.conversation_id
                         AND chat.chat_kind = 'group')))
               OR (NEW.role = 'assistant' AND NEW.participant_id IS NULL AND EXISTS (
                       SELECT 1 FROM conversations
                       WHERE id = NEW.conversation_id AND chat_kind = 'group'))
             BEGIN SELECT RAISE(ABORT, 'Invalid message participant'); END;"
        ))?;
    }
    tx.commit()
}

#[derive(Deserialize)]
pub struct GroupParticipantInput {
    pub character_id: String,
    pub character_snapshot: Option<ChatCharacterSnapshot>,
    /// Each card validates its own restrictions; all selections must resolve
    /// to the same shared persona (name and prompt).
    pub role_selection: Option<super::chats::RoleSelection>,
    pub initial_message: Option<String>,
}

#[derive(Serialize)]
pub struct GroupChat {
    pub conversation: super::chats::Conversation,
    pub participants: Vec<GroupParticipant>,
    pub messages: Vec<super::messages::DbMessage>,
    pub summary: Option<String>,
    pub summary_last_message_id: Option<String>,
    /// Opaque compare-and-swap value. Never send this to an AI provider.
    pub version: String,
}

fn require_group(conn: &Connection, chat_id: &str) -> Result<super::chats::Conversation, String> {
    let chat = super::chats::read_conversation(conn, chat_id)?;
    if chat.chat_kind != ChatKind::Group || chat.mode != "singleplayer" {
        return Err("Expected a local group conversation".into());
    }
    Ok(chat)
}

fn read_participants(conn: &Connection, chat_id: &str) -> Result<Vec<GroupParticipant>, String> {
    let mut stmt = conn.prepare(
        "SELECT * FROM group_participants WHERE conversation_id = ?1 ORDER BY sort_order, id"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([chat_id], GroupParticipant::from_row).map_err(|e| e.to_string())?;
    rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())
}

fn read_group(conn: &Connection, chat_id: &str) -> Result<GroupChat, String> {
    let conversation = require_group(conn, chat_id)?;
    let participants = read_participants(conn, chat_id)?;
    if participants.iter().filter(|item| item.is_active).count() < 2 { return Err("Group chats require at least two active characters".into()); }
    let mut stmt = conn.prepare(
        "SELECT id, conversation_id, role, content, author, swipe_variants, swipe_index,
                created_at, usage_variants, participant_id
         FROM messages WHERE conversation_id = ?1 ORDER BY created_at, rowid"
    ).map_err(|e| e.to_string())?;
    let rows = stmt.query_map([chat_id], super::messages::message_from_row).map_err(|e| e.to_string())?;
    let messages = rows.collect::<rusqlite::Result<Vec<_>>>().map_err(|e| e.to_string())?;
    let (summary, summary_last_message_id): (Option<String>, Option<String>) = conn.query_row(
        "SELECT summary_text, summary_last_message_id FROM conversations WHERE id = ?1",
        [chat_id], |row| Ok((row.get(0)?, row.get(1)?)),
    ).map_err(|e| e.to_string())?;
    let version = serde_json::to_string(&(
        &participants, &conversation.role_snapshot, &messages, &summary, &summary_last_message_id,
    )).map_err(|e| e.to_string())?;
    Ok(GroupChat { conversation, participants, messages, summary, summary_last_message_id, version })
}

fn resolve_input(conn: &Connection, input: &GroupParticipantInput)
    -> Result<(ChatCharacterSnapshot, Option<super::chats::ChatRoleSnapshot>), String>
{
    if input.character_id.trim().is_empty() { return Err("Character ID is required".into()); }
    let fallback = input.character_snapshot.as_ref().map(serde_json::to_value)
        .transpose().map_err(|e| e.to_string())?;
    let value = super::chats::resolve_character_snapshot(conn, Some(&input.character_id), fallback)?
        .ok_or_else(|| "Character snapshot is unavailable".to_string())?;
    let mut snapshot: ChatCharacterSnapshot = serde_json::from_value(value).map_err(|e| e.to_string())?;
    if snapshot.id != input.character_id || snapshot.name.trim().is_empty() {
        return Err("Invalid character snapshot identity or name".into());
    }
    if let Some(greeting) = &input.initial_message { snapshot.greeting = greeting.clone(); }
    let persona = super::chats::resolve_role_snapshot(conn, Some(&input.character_id), input.role_selection.as_ref())?;
    Ok((snapshot, persona))
}

fn insert_participant(conn: &Connection, chat_id: &str, input: &GroupParticipantInput,
    snapshot: ChatCharacterSnapshot, sort_order: i64) -> Result<String, String>
{
    let id = uuid::Uuid::new_v4().to_string();
    conn.execute(
        "INSERT INTO group_participants (id, conversation_id, character_id, character_snapshot, sort_order)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![id, chat_id, input.character_id, serde_json::to_string(&snapshot).map_err(|e| e.to_string())?, sort_order],
    ).map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn create_group_chat(app: tauri::AppHandle, title: String, participants: Vec<GroupParticipantInput>) -> Result<String, String> {
    if participants.len() < 2 { return Err("Group chats require at least two characters".into()); }
    let mut conn = super::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let resolved = participants.iter().map(|input| resolve_input(&tx, input)).collect::<Result<Vec<_>, _>>()?;
    let persona = &resolved[0].1;
    if resolved.iter().any(|(_, role)| role != persona) {
        return Err("All characters must allow the same shared player persona".into());
    }
    let mut ids = std::collections::HashSet::new();
    if participants.iter().any(|input| !ids.insert(&input.character_id)) {
        return Err("Duplicate characters in group".into());
    }
    let id = uuid::Uuid::new_v4().to_string();
    let title = if title.trim().is_empty() {
        resolved.iter().map(|(card, _)| card.name.as_str()).collect::<Vec<_>>().join(", ")
    } else { title.trim().to_string() };
    tx.execute(
        "INSERT INTO conversations (id, title, mode, chat_kind, role_snapshot, sort_order)
         VALUES (?1, ?2, 'singleplayer', 'group', ?3,
            (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM conversations WHERE mode = 'singleplayer' AND folder_id IS NULL))",
        rusqlite::params![id, title, persona.as_ref().map(serde_json::to_string).transpose().map_err(|e| e.to_string())?],
    ).map_err(|e| e.to_string())?;
    for (index, (input, (snapshot, _))) in participants.iter().zip(resolved).enumerate() {
        let greeting = snapshot.greeting.clone();
        let participant_id = insert_participant(&tx, &id, input, snapshot, index as i64)?;
        if !greeting.trim().is_empty() {
            tx.execute(
                "INSERT INTO messages (id, conversation_id, role, content, participant_id, swipe_variants, usage_variants)
                 VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, '[null]')",
                rusqlite::params![uuid::Uuid::new_v4().to_string(), id, greeting, participant_id,
                    serde_json::to_string(&vec![&greeting]).map_err(|e| e.to_string())?],
            ).map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}

#[tauri::command]
pub async fn get_group_chat(app: tauri::AppHandle, chat_id: String) -> Result<GroupChat, String> {
    let mut conn = super::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    read_group(&tx, &chat_id)
}

fn invalidate_group_memory(conn: &Connection, chat_id: &str) -> Result<(), String> {
    conn.execute("UPDATE conversations SET summary_text = NULL, summary_last_message_id = NULL,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?1", [chat_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn add_group_participant(app: tauri::AppHandle, chat_id: String, participant: GroupParticipantInput) -> Result<GroupParticipant, String> {
    let mut conn = super::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let chat = require_group(&tx, &chat_id)?;
    let existing = read_participants(&tx, &chat_id)?;
    if existing.iter().any(|item| item.character_id.as_deref() == Some(participant.character_id.as_str())) {
        return Err("Character already participates in group".into());
    }
    let (snapshot, persona) = resolve_input(&tx, &participant)?;
    if persona != chat.role_snapshot { return Err("Character does not allow the shared player persona".into()); }
    let order = existing.iter().map(|item| item.sort_order).max().unwrap_or(-1) + 1;
    let id = insert_participant(&tx, &chat_id, &participant, snapshot, order)?;
    invalidate_group_memory(&tx, &chat_id)?;
    let saved = read_participants(&tx, &chat_id)?.into_iter().find(|item| item.id == id).unwrap();
    tx.commit().map_err(|e| e.to_string())?;
    Ok(saved)
}

fn set_participant_active(conn: &Connection, chat_id: &str, participant_id: &str, is_active: bool) -> Result<(), String> {
    require_group(conn, chat_id)?;
    let participants = read_participants(conn, chat_id)?;
    let participant = participants.iter().find(|item| item.id == participant_id)
        .ok_or_else(|| "Participant not found".to_string())?;
    if participant.is_active == is_active { return Ok(()); }
    if !is_active && participants.iter().filter(|item| item.is_active).count() <= 2 {
        return Err("Group chats require at least two active characters".into());
    }
    // Archive membership, not identity: past turns and summary speaker IDs survive.
    conn.execute("UPDATE group_participants SET is_active = ?1 WHERE conversation_id = ?2 AND id = ?3",
        rusqlite::params![is_active, chat_id, participant_id]).map_err(|e| e.to_string())?;
    invalidate_group_memory(conn, chat_id)
}

#[tauri::command]
pub async fn set_group_participant_active(app: tauri::AppHandle, chat_id: String, participant_id: String, is_active: bool) -> Result<(), String> {
    let mut conn = super::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    set_participant_active(&tx, &chat_id, &participant_id, is_active)?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn remove_group_participant(app: tauri::AppHandle, chat_id: String, participant_id: String) -> Result<(), String> {
    set_group_participant_active(app, chat_id, participant_id, false).await
}

#[tauri::command]
pub async fn update_group_participant(app: tauri::AppHandle, chat_id: String, participant_id: String, snapshot: ChatCharacterSnapshot) -> Result<(), String> {
    if snapshot.name.trim().is_empty() { return Err("Character name is required".into()); }
    let mut conn = super::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    require_group(&tx, &chat_id)?;
    let old = read_participants(&tx, &chat_id)?.into_iter().find(|item| item.id == participant_id)
        .ok_or_else(|| "Participant not found".to_string())?;
    if snapshot.id != old.character_snapshot.id { return Err("Character identity is immutable".into()); }
    tx.execute("UPDATE group_participants SET character_snapshot = ?1 WHERE id = ?2",
        rusqlite::params![serde_json::to_string(&snapshot).map_err(|e| e.to_string())?, participant_id]).map_err(|e| e.to_string())?;
    invalidate_group_memory(&tx, &chat_id)?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn reorder_group_participants(app: tauri::AppHandle, chat_id: String, participant_ids: Vec<String>) -> Result<(), String> {
    let mut conn = super::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    require_group(&tx, &chat_id)?;
    let existing = read_participants(&tx, &chat_id)?;
    let unique: std::collections::HashSet<_> = participant_ids.iter().collect();
    if unique.len() != existing.len() || participant_ids.len() != existing.len()
        || existing.iter().any(|item| !unique.contains(&item.id)) {
        return Err("Order must contain every participant exactly once".into());
    }
    for (index, id) in participant_ids.iter().enumerate() {
        tx.execute("UPDATE group_participants SET sort_order = ?1 WHERE id = ?2 AND conversation_id = ?3",
            rusqlite::params![index as i64, id, chat_id]).map_err(|e| e.to_string())?;
    }
    tx.commit().map_err(|e| e.to_string())
}

/// An answer is committed only if its complete chat snapshot still matches.
/// Swipes preserve the original speaker and use the history before that reply.
#[tauri::command]
pub async fn commit_group_reply(app: tauri::AppHandle, chat_id: String, participant_id: String,
    expected_version: String, content: String, usage: Option<crate::ai::TokenUsage>,
    swipe_message_id: Option<String>) -> Result<String, String>
{
    if content.trim().is_empty() { return Err("Empty group reply".into()); }
    let mut conn = super::get_connection(&app)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let group = read_group(&tx, &chat_id)?;
    if group.version != expected_version { return Err("Group chat changed during generation".into()); }
    if !group.participants.iter().any(|item| item.id == participant_id && item.is_active) { return Err("Participant not found".into()); }
    let id = if let Some(id) = swipe_message_id {
        let index = group.messages.iter().position(|message| message.id == id && message.role == "assistant"
            && message.participant_id.as_deref() == Some(participant_id.as_str()))
            .ok_or_else(|| "Retry requires a reply from the same speaker".to_string())?;
        let message = &group.messages[index];
        super::messages::append_swipe_variant(&tx, &message.id, content, usage)?;
        // Preparation normally excludes this reply; preserve valid older memory.
        let covered = group.summary_last_message_id.as_ref()
            .and_then(|marker| group.messages.iter().position(|item| &item.id == marker))
            .is_some_and(|marker_index| marker_index >= index);
        if covered {
            invalidate_group_memory(&tx, &chat_id)?;
        }
        id
    } else {
        let id = uuid::Uuid::new_v4().to_string();
        tx.execute(
            "INSERT INTO messages (id, conversation_id, role, content, participant_id, swipe_variants, usage_variants)
             VALUES (?1, ?2, 'assistant', ?3, ?4, ?5, ?6)",
            rusqlite::params![id, chat_id, content, participant_id,
                serde_json::to_string(&vec![&content]).map_err(|e| e.to_string())?,
                serde_json::to_string(&vec![usage]).map_err(|e| e.to_string())?],
        ).map_err(|e| e.to_string())?;
        id
    };
    tx.commit().map_err(|e| e.to_string())?;
    Ok(id)
}
