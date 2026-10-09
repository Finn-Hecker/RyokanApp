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
    pub created_at: String,
}

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
