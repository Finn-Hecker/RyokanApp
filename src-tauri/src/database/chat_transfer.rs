//! Native single-conversation interchange. Database writes are atomic and never
//! reuse external identities. This intentionally does not read application settings.
use super::{chats::ChatRoleSnapshot, get_connection, world_info::WorldInfoEntry};
use crate::ai::TokenUsage;
use base64::{engine::general_purpose::STANDARD, Engine as _};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use tauri::AppHandle;
use uuid::Uuid;
use crate::diagnostics::chat_export::{Command, Probe, Reason};

const SCHEMA: &str = "ryokan.chat";
const MAX_BYTES: usize = 64 * 1024 * 1024;

#[derive(Serialize, Deserialize)]
struct ChatFile {
    schema: String,
    version: u32,
    conversation: Chat,
    messages: Vec<Message>,
    world_infos: Vec<Lorebook>,
}

#[derive(Serialize, Deserialize)]
struct Chat {
    title: String,
    mode: String,
    created_at: String,
    updated_at: String,
    is_pinned: bool,
    cloned_from_title: Option<String>,
    character: Option<Character>,
    role: Option<ChatRoleSnapshot>,
    summary: Summary,
}

#[derive(Serialize, Deserialize)]
struct Character {
    id: String,
    name: String,
    prompt: String,
    greeting: String,
    initials: String,
    color: String,
    #[serde(rename = "avatarUrl")]
    avatar_url: Option<String>,
    world_info_ids: Vec<String>,
}

#[derive(Serialize, Deserialize)]
struct Summary {
    text: Option<String>,
    last_message_id: Option<String>,
}

#[derive(Serialize, Deserialize)]
struct Message {
    id: String,
    role: String,
    content: String,
    author: Option<String>,
    swipe_variants: Vec<String>,
    swipe_index: usize,
    usage_variants: Vec<Option<TokenUsage>>,
    created_at: String,
}

#[derive(Serialize, Deserialize)]
struct Lorebook {
    id: String,
    name: String,
    description: String,
    entries: Vec<WorldInfoEntry>,
    created_at: String,
}

fn timestamp_valid(conn: &Connection, value: &str) -> bool {
    conn.query_row("SELECT julianday(?1) IS NOT NULL", [value], |row| {
        row.get(0)
    })
    .unwrap_or(false)
}

// Bundled characters persist Vite asset URLs rather than image bytes. Embed
// those two known local assets so exports survive another build/installation.
// Never fetch arbitrary paths or remote URLs supplied by a snapshot.
fn portable_avatar(avatar: &str) -> Option<String> {
    // Production Vite assets use new URL(..., import.meta.url).href. Native
    // WebViews therefore persist an absolute app URL, including on Android.
    // Strip only exact bundled-app origins; never resolve or fetch a URL.
    let avatar = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]
        .iter()
        .find_map(|origin| avatar.strip_prefix(origin).filter(|path| path.starts_with('/')))
        .unwrap_or(avatar);
    if !(avatar.starts_with("/_app/immutable/assets/")
        || avatar.starts_with("./_app/immutable/assets/")
        || avatar.starts_with("/src/lib/assets/avatars/"))
    {
        return None;
    }
    let filename = avatar.rsplit('/').next()?;
    let bytes: &[u8] = if filename.starts_with("lyvee.") && filename.ends_with(".webp") {
        include_bytes!("../../../src/lib/assets/avatars/lyvee.webp")
    } else if filename.starts_with("klea.") && filename.ends_with(".webp") {
        include_bytes!("../../../src/lib/assets/avatars/klea.webp")
    } else {
        return None;
    };
    Some(format!("data:image/webp;base64,{}", STANDARD.encode(bytes)))
}

fn validate(conn: &Connection, file: &ChatFile) -> Result<(), String> {
    validate_with_probe(conn, file, &mut Probe::default())
}

fn validate_with_probe(conn: &Connection, file: &ChatFile, probe: &mut Probe) -> Result<(), String> {
    let invalid = || "Invalid or incomplete Ryokan chat data".to_string();
    // Preserve the original short-circuit order and errors. These labels only
    // identify the first failed predicate; they do not alter acceptance rules.
    macro_rules! reject_if {
        ($condition:expr, $reason:ident) => {
            if $condition { return Err(probe.error(Reason::$reason, invalid())); }
        };
    }
    if file.schema != SCHEMA || file.version != 1 {
        return Err(probe.error(Reason::SchemaVersion, "Unsupported Ryokan chat schema or version".into()));
    }
    let chat = &file.conversation;
    reject_if!(chat.mode != "singleplayer", ConversationMode);
    reject_if!(!timestamp_valid(conn, &chat.created_at), ConversationCreatedAt);
    reject_if!(!timestamp_valid(conn, &chat.updated_at), ConversationUpdatedAt);
    let mut ids = HashSet::new();
    let mut previous = "";
    for message in &file.messages {
        reject_if!(message.id.is_empty(), MessageIdEmpty);
        reject_if!(!ids.insert(message.id.as_str()), MessageIdDuplicate);
        reject_if!(!matches!(message.role.as_str(), "user" | "assistant"), MessageRole);
        reject_if!(!timestamp_valid(conn, &message.created_at), MessageCreatedAt);
        reject_if!(message.created_at.as_str() < previous, MessageOrder);
        reject_if!(message.swipe_variants.is_empty() && message.swipe_index != 0, EmptySwipesIndex);
        reject_if!(!message.swipe_variants.is_empty()
            && message.swipe_variants.get(message.swipe_index) != Some(&message.content), SwipeContentMismatch);
        reject_if!(message.usage_variants.len() > message.swipe_variants.len().max(1), UsageLength);
        reject_if!(message.usage_variants.iter().flatten().any(|usage| {
                usage
                    .cost_usd
                    .is_some_and(|cost| !cost.is_finite() || cost < 0.0)
            }), UsageCost);
        previous = &message.created_at;
    }
    match (&chat.summary.text, &chat.summary.last_message_id) {
        (None, None) => {}
        (Some(text), Some(id)) if !text.trim().is_empty() && ids.contains(id.as_str()) => {}
        _ => return Err(probe.error(Reason::SummaryBoundary, "Invalid Rolling Summary boundary".into())),
    }
    let mut lore_ids = HashSet::new();
    for lore in &file.world_infos {
        let mut entry_ids = HashSet::new();
        reject_if!(lore.id.is_empty(), LorebookIdEmpty);
        reject_if!(!lore_ids.insert(lore.id.as_str()), LorebookIdDuplicate);
        reject_if!(!timestamp_valid(conn, &lore.created_at), LorebookCreatedAt);
        for entry in &lore.entries {
            reject_if!(entry.id.is_empty(), LoreEntryIdEmpty);
            reject_if!(!entry_ids.insert(entry.id.as_str()), LoreEntryIdDuplicate);
            reject_if!(!matches!(entry.position.as_str(), "before" | "after"), LoreEntryPosition);
        }
    }
    let selected: HashSet<&str> = chat
        .character
        .as_ref()
        .map(|character| {
            character
                .world_info_ids
                .iter()
                .map(String::as_str)
                .collect()
        })
        .unwrap_or_default();
    reject_if!(!lore_ids.is_subset(&selected), LorebookUnlinked);
    // Missing/deleted lore references are meaningful: they contribute no context.
    if let Some(character) = &chat.character {
        reject_if!(character.id.is_empty(), CharacterIdEmpty);
        reject_if!(character.name.trim().is_empty(), CharacterNameEmpty);
        if let Some(avatar) = &character.avatar_url {
            let (header, encoded) = avatar
                .split_once(";base64,")
                .ok_or_else(|| probe.avatar_error(Reason::AvatarEncoding, avatar, "Chat avatars must be embedded images".to_string()))?;
            let bytes = STANDARD
                .decode(encoded)
                .map_err(|_| probe.avatar_error(Reason::AvatarBase64, avatar, "Invalid chat avatar".into()))?;
            let format = image::guess_format(&bytes)
                .map_err(|_| probe.avatar_error(Reason::AvatarImage, avatar, "Invalid chat avatar".into()))?;
            let mime = match format {
                image::ImageFormat::Png => "data:image/png",
                image::ImageFormat::Jpeg => "data:image/jpeg",
                image::ImageFormat::WebP => "data:image/webp",
                image::ImageFormat::Gif => "data:image/gif",
                _ => return Err(probe.avatar_error(Reason::AvatarFormat, avatar, "Unsupported chat avatar format".into())),
            };
            if header != mime {
                return Err(probe.avatar_error(Reason::AvatarMime, avatar, "Invalid chat avatar type".into()));
            }
        }
    }
    Ok(())
}

#[cfg(test)]
fn export_row(conn: &Connection, chat_id: &str) -> Result<ChatFile, String> {
    export_row_with_probe(conn, chat_id, &mut Probe::default())
}

fn export_row_with_probe(conn: &Connection, chat_id: &str, probe: &mut Probe) -> Result<ChatFile, String> {
    let (mut chat, snapshot, role): (Chat, Option<String>, Option<String>) = conn
        .query_row(
            "SELECT title, mode, created_at, updated_at, is_pinned, cloned_from_title,
                character_snapshot, role_snapshot, summary_text, summary_last_message_id
         FROM conversations WHERE id = ?1",
            [chat_id],
            |row| {
                Ok((
                    Chat {
                        title: row.get(0)?,
                        mode: row.get(1)?,
                        created_at: row.get(2)?,
                        updated_at: row.get(3)?,
                        is_pinned: row.get(4)?,
                        cloned_from_title: row.get(5)?,
                        character: None,
                        role: None,
                        summary: Summary {
                            text: row.get(8)?,
                            last_message_id: row.get(9)?,
                        },
                    },
                    row.get(6)?,
                    row.get(7)?,
                ))
            },
        )
        .map_err(|_| probe.error(Reason::ConversationRead, "Conversation could not be read".to_string()))?;
    let character_id: Option<String> = conn
        .query_row(
            "SELECT character_id FROM conversations WHERE id = ?1",
            [chat_id],
            |row| row.get(0),
        )
        .map_err(|e| probe.error(Reason::CharacterIdRead, e.to_string()))?;
    if snapshot.is_none() && character_id.is_some() {
        return Err(probe.error(Reason::CharacterSnapshotMissing, "Chat character snapshot is missing".into()));
    }
    chat.character = snapshot
        .map(|raw| serde_json::from_str(&raw))
        .transpose()
        .map_err(|_| probe.error(Reason::CharacterSnapshotShape, "Invalid chat character snapshot".to_string()))?;
    if let Some(character) = &mut chat.character {
        if let Some(avatar) = &character.avatar_url {
            if !avatar.starts_with("data:") {
                character.avatar_url = Some(
                    portable_avatar(avatar)
                        .ok_or_else(|| probe.avatar_error(Reason::AvatarUnrecognized, avatar, "Chat avatar is not a portable local image".to_string()))?,
                );
            }
        }
    }
    chat.role = role
        .map(|raw| serde_json::from_str(&raw))
        .transpose()
        .map_err(|_| probe.error(Reason::RoleSnapshotShape, "Invalid chat role snapshot".to_string()))?;
    let mut stmt = conn.prepare("SELECT id, role, content, author, swipe_variants, swipe_index,
        usage_variants, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at, rowid")
        .map_err(|e| probe.error(Reason::MessageQuery, e.to_string()))?;
    let rows = stmt
        .query_map([chat_id], |row| {
            Ok((
                Message {
                    id: row.get(0)?,
                    role: row.get(1)?,
                    content: row.get(2)?,
                    author: row.get(3)?,
                    swipe_variants: vec![],
                    swipe_index: row.get(5)?,
                    usage_variants: vec![],
                    created_at: row.get(7)?,
                },
                row.get::<_, String>(4)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(|e| probe.error(Reason::MessageQuery, e.to_string()))?;
    let mut messages = Vec::new();
    for row in rows {
        let (mut message, variants, usage) = row.map_err(|e| {
            let reason = match &e {
                rusqlite::Error::IntegralValueOutOfRange(5, _)
                | rusqlite::Error::InvalidColumnType(5, _, _)
                | rusqlite::Error::FromSqlConversionFailure(5, _, _) => Reason::MessageSwipeIndexRead,
                _ => Reason::MessageRead,
            };
            probe.error(reason, e.to_string())
        })?;
        message.swipe_variants =
            serde_json::from_str(&variants).map_err(|_| probe.error(Reason::SwipesJson, "Invalid saved swipes".into()))?;
        message.usage_variants = serde_json::from_str(&usage)
            .map_err(|_| probe.error(Reason::UsageJson, "Invalid saved usage".into()))?;
        messages.push(message);
    }
    let mut world_infos = Vec::new();
    let mut seen = HashSet::new();
    for id in chat
        .character
        .as_ref()
        .map(|c| c.world_info_ids.as_slice())
        .unwrap_or_default()
    {
        if !seen.insert(id) {
            continue;
        }
        let row = conn
            .query_row(
                "SELECT name, description, entries, created_at FROM world_infos WHERE id = ?1",
                [id],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, String>(1)?,
                        row.get::<_, String>(2)?,
                        row.get::<_, String>(3)?,
                    ))
                },
            )
            .optional()
            .map_err(|e| probe.error(Reason::LorebookRead, e.to_string()))?;
        if let Some((name, description, entries, created_at)) = row {
            world_infos.push(Lorebook {
                id: id.clone(),
                name,
                description,
                created_at,
                entries: serde_json::from_str(&entries)
                    .map_err(|_| probe.error(Reason::LorebookJson, "Invalid saved lorebook".into()))?,
            });
        }
    }
    let file = ChatFile {
        schema: SCHEMA.into(),
        version: 1,
        conversation: chat,
        messages,
        world_infos,
    };
    validate_with_probe(conn, &file, probe)?;
    Ok(file)
}

fn parse_file(conn: &Connection, json: &str) -> Result<ChatFile, String> {
    if json.len() > MAX_BYTES {
        return Err("Chat file exceeds the 64 MiB limit".into());
    }
    let value: Value = serde_json::from_str(json).map_err(|_| "Malformed chat JSON")?;
    if value["schema"] != SCHEMA || value["version"] != 1 {
        return Err("Unsupported Ryokan chat schema or version".into());
    }
    // Option fields must be present (explicit null is valid). Missing snapshots
    // or summary metadata must never silently become a successful partial import.
    for (object, keys) in [
        (
            &value["conversation"],
            &["character", "role", "cloned_from_title"][..],
        ),
        (
            &value["conversation"]["summary"],
            &["text", "last_message_id"][..],
        ),
    ] {
        if keys.iter().any(|key| object.get(*key).is_none()) {
            return Err("Incomplete Ryokan chat data".into());
        }
    }
    if value["messages"].as_array().is_some_and(|messages| {
        messages
            .iter()
            .any(|message| message.get("author").is_none())
    }) || (value["conversation"]["character"].is_object()
        && value["conversation"]["character"]
            .get("avatarUrl")
            .is_none())
    {
        return Err("Incomplete Ryokan chat data".into());
    }
    let file: ChatFile =
        serde_json::from_value(value).map_err(|_| "Invalid or incomplete Ryokan chat data")?;
    validate(conn, &file)?;
    Ok(file)
}

fn import_row(conn: &mut Connection, mut file: ChatFile) -> Result<String, String> {
    validate(conn, &file)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let imported_at: String = tx
        .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |row| {
            row.get(0)
        })
        .map_err(|e| e.to_string())?;
    let new_id = Uuid::new_v4().to_string();
    let message_ids: HashMap<String, String> = file
        .messages
        .iter()
        .map(|message| (message.id.clone(), Uuid::new_v4().to_string()))
        .collect();
    let mut lore_ids = HashMap::new();
    for lore in &file.world_infos {
        let id = Uuid::new_v4().to_string();
        tx.execute("INSERT INTO world_infos (id, name, description, entries, created_at) VALUES (?1, ?2, ?3, ?4, ?5)",
            params![id, lore.name, lore.description, serde_json::to_string(&lore.entries).map_err(|e| e.to_string())?, lore.created_at])
            .map_err(|e| e.to_string())?;
        lore_ids.insert(lore.id.clone(), id);
    }
    if let Some(character) = &mut file.conversation.character {
        character.id = Uuid::new_v4().to_string();
        for id in &mut character.world_info_ids {
            // Also remap dangling references so they cannot accidentally bind to
            // an unrelated library record on the receiving installation.
            *id = lore_ids
                .entry(id.clone())
                .or_insert_with(|| Uuid::new_v4().to_string())
                .clone();
        }
    }
    let chat = file.conversation;
    let snapshot = chat
        .character
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    let role = chat
        .role
        .as_ref()
        .map(serde_json::to_string)
        .transpose()
        .map_err(|e| e.to_string())?;
    tx.execute("INSERT INTO conversations (id, title, character_id, mode, created_at, updated_at,
        is_pinned, cloned_from_title, character_snapshot, role_snapshot, summary_text, summary_last_message_id, sort_order)
        VALUES (?1, ?2, ?3, 'singleplayer', ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11,
        (SELECT COALESCE(MAX(sort_order) + 1, 0) FROM conversations WHERE mode = 'singleplayer' AND folder_id IS NULL))",
        params![new_id, chat.title, chat.character.as_ref().map(|c| &c.id), imported_at, imported_at,
            false, chat.cloned_from_title, snapshot, role, chat.summary.text,
            chat.summary.last_message_id.as_ref().and_then(|id| message_ids.get(id))])
        .map_err(|e| e.to_string())?;
    for message in file.messages {
        tx.execute(
            "INSERT INTO messages (id, conversation_id, role, content, author, swipe_variants,
            swipe_index, usage_variants, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                message_ids[&message.id],
                new_id,
                message.role,
                message.content,
                message.author,
                serde_json::to_string(&message.swipe_variants).map_err(|e| e.to_string())?,
                message.swipe_index,
                serde_json::to_string(&message.usage_variants).map_err(|e| e.to_string())?,
                message.created_at
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    // Historical messages fire the activity trigger; keep the new conversation's
    // creation and list-order timestamps at the same local import time.
    tx.execute(
        "UPDATE conversations SET updated_at = ?1 WHERE id = ?2",
        params![imported_at, new_id],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(new_id)
}

#[tauri::command]
pub async fn export_chat_json(app: AppHandle, chat_id: String) -> Result<String, String> {
    let mut probe = Probe::entered(Command::Export);
    let result = (|| {
    let mut conn = get_connection(&app).map_err(|e| probe.error(Reason::Connection, e))?;
    let tx = conn.transaction().map_err(|e| probe.error(Reason::Transaction, e.to_string()))?;
    let file = export_row_with_probe(&tx, &chat_id, &mut probe)?;
    let json = serde_json::to_string_pretty(&file)
        .map_err(|e| probe.error(Reason::Serialization, e.to_string()))?;
    if json.len() > MAX_BYTES {
        return Err(probe.error(Reason::OutputLimit, "Chat file exceeds the 64 MiB limit".into()));
    }
    Ok(json)
    })();
    probe.finished(Command::Export, result.is_ok());
    result
}

#[tauri::command]
pub async fn import_chat_json(
    app: AppHandle,
    json: String,
) -> Result<super::chats::Conversation, String> {
    let mut conn = get_connection(&app)?;
    let file = parse_file(&conn, &json)?;
    let id = import_row(&mut conn, file)?;
    super::chats::read_conversation(&conn, &id)
}

#[cfg(test)]
#[path = "chat_transfer_tests.rs"]
mod tests;
