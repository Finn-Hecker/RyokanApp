use tauri::AppHandle;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::database::get_connection;
use base64::{engine::general_purpose, Engine as _};
use image::{ImageFormat};
use webp::{Encoder, WebPMemory};
use std::io::Cursor;

const ROLE_POLICY_OPEN: &str = "open";

#[derive(Clone, Debug, Deserialize, Serialize)]
pub(crate) struct StoredBundledRoleSnapshot {
    pub(crate) id: String,
    pub(crate) source_role_id: Option<String>,
    pub(crate) name: String,
    pub(crate) prompt: String,
    /// Base64-encoded persisted image bytes. Kept inside the Card JSON so the
    /// snapshot owns the avatar even after its source Role is deleted.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) avatar: Option<String>,
}

/// Lightweight representation used by normal Character reads. Avatar bytes
/// are fetched lazily through get_bundled_role_avatar.
#[derive(Clone, Debug, Serialize)]
pub struct BundledRoleSnapshot {
    pub id: String,
    pub source_role_id: Option<String>,
    pub name: String,
    pub prompt: String,
    pub has_avatar: bool,
}

impl From<&StoredBundledRoleSnapshot> for BundledRoleSnapshot {
    fn from(snapshot: &StoredBundledRoleSnapshot) -> Self {
        Self {
            id: snapshot.id.clone(),
            source_role_id: snapshot.source_role_id.clone(),
            name: snapshot.name.clone(),
            prompt: snapshot.prompt.clone(),
            has_avatar: snapshot.avatar.as_ref().is_some_and(|avatar| !avatar.is_empty()),
        }
    }
}

fn validate_role_policy(policy: &str) -> Result<(), String> {
    match policy {
        "open" | "restricted" => Ok(()),
        _ => Err("role_policy must be 'open' or 'restricted'".into()),
    }
}

pub(crate) fn parse_bundled_roles(raw: &str) -> Result<Vec<StoredBundledRoleSnapshot>, String> {
    serde_json::from_str(raw).map_err(|e| format!("Invalid bundled_roles data: {e}"))
}

fn read_stored_bundled_roles(
    conn: &rusqlite::Connection,
    character_id: &str,
) -> Result<Vec<StoredBundledRoleSnapshot>, String> {
    let raw: String = conn.query_row(
        "SELECT bundled_roles FROM characters WHERE id = ?1",
        params![character_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    parse_bundled_roles(&raw)
}

fn list_bundled_role_snapshots(
    conn: &rusqlite::Connection,
    character_id: &str,
) -> Result<Vec<BundledRoleSnapshot>, String> {
    Ok(read_stored_bundled_roles(conn, character_id)?
        .iter()
        .map(BundledRoleSnapshot::from)
        .collect())
}

fn add_snapshot_from_role(
    conn: &mut rusqlite::Connection,
    character_id: &str,
    role_id: &str,
) -> Result<BundledRoleSnapshot, String> {
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let (name, prompt, avatar): (String, String, Option<Vec<u8>>) = transaction
        .query_row(
            "SELECT name, prompt, avatar FROM roles WHERE id = ?1",
            params![role_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;
    let raw: String = transaction
        .query_row(
            "SELECT bundled_roles FROM characters WHERE id = ?1",
            params![character_id],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;
    let mut snapshots = parse_bundled_roles(&raw)?;
    let stored = StoredBundledRoleSnapshot {
        id: Uuid::new_v4().to_string(),
        source_role_id: Some(role_id.to_string()),
        name,
        prompt,
        avatar: avatar.filter(|bytes| !bytes.is_empty()).map(|bytes| {
            general_purpose::STANDARD.encode(bytes)
        }),
    };
    let result = BundledRoleSnapshot::from(&stored);
    snapshots.push(stored);
    let updated = serde_json::to_string(&snapshots).map_err(|e| e.to_string())?;
    transaction.execute(
        "UPDATE characters SET bundled_roles = ?1 WHERE id = ?2",
        params![updated, character_id],
    ).map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(result)
}

fn remove_snapshot_by_id(
    conn: &mut rusqlite::Connection,
    character_id: &str,
    snapshot_id: &str,
) -> Result<(), String> {
    let transaction = conn.transaction().map_err(|e| e.to_string())?;
    let raw: String = transaction.query_row(
        "SELECT bundled_roles FROM characters WHERE id = ?1",
        params![character_id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;
    let mut snapshots = parse_bundled_roles(&raw)?;
    let original_len = snapshots.len();
    snapshots.retain(|snapshot| snapshot.id != snapshot_id);
    if snapshots.len() == original_len {
        return Err("Bundled Role snapshot not found".into());
    }
    let updated = serde_json::to_string(&snapshots).map_err(|e| e.to_string())?;
    transaction.execute(
        "UPDATE characters SET bundled_roles = ?1 WHERE id = ?2",
        params![updated, character_id],
    ).map_err(|e| e.to_string())?;
    transaction.commit().map_err(|e| e.to_string())?;
    Ok(())
}

/// Database representation of a character.
/// Avatar is stored as a raw WebP BLOB to minimize database footprint and RAM overhead.
#[derive(Serialize)]
pub struct DbCharacter {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub greeting: String,
    pub alternate_greetings: String,
    pub tags: String,
    pub v3_spec: bool,
    pub initials: String,
    pub color: String,
    pub play_mode: String,
    pub has_avatar: bool,
    pub world_info_ids: Vec<String>,
    pub role_policy: String,
    pub bundled_roles: Vec<BundledRoleSnapshot>,
}

/// Incoming payload from the frontend.
/// Arrays are received natively from Svelte and converted to JSON strings before SQLite insertion.
#[derive(Deserialize)]
pub struct CreateCharacterPayload {
    pub name: String,
    pub prompt: String,
    pub greeting: String,
    pub alternate_greetings: Vec<String>,
    pub initials: String,
    pub color: String,
    pub play_mode: Option<String>,
    pub avatar: Option<String>,
    pub world_info_ids: Option<Vec<String>>,
    pub role_policy: Option<String>,
    /// Used by Character Card imports. These are already independent snapshots;
    /// they must not be resolved through the receiving installation's Roles.
    pub bundled_roles: Option<Vec<StoredBundledRoleSnapshot>>,
}

fn normalize_play_mode(play_mode: Option<&str>) -> &'static str {
    match play_mode {
        Some("solo") => "solo",
        Some("multiplayer") => "multiplayer",
        _ => "solo",
    }
}

/// Decodes a Base64 image from the frontend, resizes it if it exceeds 2048×2048,
/// and re-encodes it as WebP. Returns the original bytes if they are already smaller.
fn process_avatar(base64_img: &str) -> Result<Vec<u8>, String> {
    let clean_base64 = base64_img.split(',').last().unwrap_or(base64_img);
    let img_bytes = general_purpose::STANDARD.decode(clean_base64)
        .map_err(|e| format!("Base64 error: {}", e))?;

    let original_size = img_bytes.len();
    let format = image::guess_format(&img_bytes).unwrap_or(ImageFormat::Png);
    let img = image::load_from_memory(&img_bytes)
        .map_err(|e| format!("Image loading error: {}", e))?;

    let needs_resize = img.width() > 2048 || img.height() > 2048;

    if !needs_resize && matches!(format, ImageFormat::Jpeg | ImageFormat::WebP) {
        return Ok(img_bytes);
    }

    let resized = if needs_resize {
        img.thumbnail(2048, 2048)
    } else {
        img
    };

    if format == ImageFormat::Jpeg {
        for quality in [85, 80, 75, 60] {
            let mut buf = Cursor::new(Vec::new());
            let mut enc = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut buf, quality);
            if enc.encode_image(&resized).is_ok() {
                let result = buf.into_inner();
                if result.len() < original_size {
                    return Ok(result);
                }
            }
        }
    }

    let rgba = resized.to_rgba8();
    let webp: WebPMemory = Encoder::from_rgba(rgba.as_raw(), resized.width(), resized.height())
        .encode(92.0);
    let result = webp.to_vec();

    if result.len() < original_size || !needs_resize {
        Ok(result)
    } else {
        Ok(img_bytes)
    }
}

fn image_data_url(bytes: Vec<u8>) -> String {
    let mime = match image::guess_format(&bytes).ok() {
        Some(ImageFormat::Png) => "image/png",
        Some(ImageFormat::Jpeg) => "image/jpeg",
        Some(ImageFormat::Gif) => "image/gif",
        _ => "image/webp",
    };
    format!("data:{mime};base64,{}", general_purpose::STANDARD.encode(bytes))
}

/// Returns all saved characters, WITHOUT avatar bytes.
#[tauri::command]
pub async fn get_custom_characters(app: AppHandle) -> Result<Vec<DbCharacter>, String> {
    let conn = get_connection(&app)?;

    let mut stmt = conn.prepare(
        "SELECT id, name, desc, personality, scenario, greeting,
                alternate_greetings, mes_example, creator_notes, tags,
                v3_spec, initials, color, play_mode, world_info_ids,
                LENGTH(avatar) > 0, role_policy, bundled_roles
         FROM characters ORDER BY created_at DESC"
    ).map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let has_avatar: Option<bool> = row.get(15)?;
        let bundled_roles_raw = row.get::<_, Option<String>>(17)?.unwrap_or_else(|| "[]".into());
        let bundled_roles = parse_bundled_roles(&bundled_roles_raw)
            .unwrap_or_default()
            .iter()
            .map(BundledRoleSnapshot::from)
            .collect();

        Ok(DbCharacter {
            id:                 row.get(0)?,
            name:               row.get(1)?,
            prompt: crate::import::combine_legacy_prompt(
                &row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                &row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                &row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                &row.get::<_, Option<String>>(7)?.unwrap_or_default(),
            ),
            greeting:           row.get(5)?,
            alternate_greetings: row.get(6)?,
            tags:               row.get(9)?,
            v3_spec:            row.get(10)?,
            initials:           row.get(11)?,
            color:              row.get(12)?,
            play_mode:          normalize_play_mode(row.get::<_, Option<String>>(13)?.as_deref())
                .to_string(),
            world_info_ids: serde_json::from_str(
                &row.get::<_, Option<String>>(14)?.unwrap_or_default()
            ).unwrap_or_default(),
            has_avatar: has_avatar.unwrap_or(false),
            role_policy: row.get::<_, Option<String>>(16)?
                .unwrap_or_else(|| ROLE_POLICY_OPEN.to_string()),
            bundled_roles,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Lazily fetches a single character's avatar, Base64-encoded as a data URL.
/// Called on demand by the frontend (e.g. when a character card scrolls into view)
#[tauri::command]
pub async fn get_character_avatar(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let conn = get_connection(&app)?;

    let avatar_blob: Option<Vec<u8>> = conn.query_row(
        "SELECT avatar FROM characters WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(avatar_blob.filter(|b| !b.is_empty()).map(|bytes| {
        image_data_url(bytes)
    }))
}

#[tauri::command]
pub async fn get_bundled_role_avatar(
    app: AppHandle,
    character_id: String,
    snapshot_id: String,
) -> Result<Option<String>, String> {
    let conn = get_connection(&app)?;
    let snapshot = read_stored_bundled_roles(&conn, &character_id)?
        .into_iter()
        .find(|snapshot| snapshot.id == snapshot_id)
        .ok_or_else(|| "Bundled Role snapshot not found".to_string())?;
    Ok(snapshot.avatar.filter(|avatar| !avatar.is_empty()).map(|avatar| {
        general_purpose::STANDARD.decode(avatar).ok().map(image_data_url)
    }).flatten())
}

#[tauri::command]
pub async fn get_bundled_role_snapshots(
    app: AppHandle,
    character_id: String,
) -> Result<Vec<BundledRoleSnapshot>, String> {
    let conn = get_connection(&app)?;
    list_bundled_role_snapshots(&conn, &character_id)
}

/// Inserts a new character. Avatar processing runs on a background thread.
#[tauri::command]
pub async fn create_character(app: AppHandle, payload: CreateCharacterPayload) -> Result<String, String> {
    let conn = get_connection(&app)?;
    let new_id = Uuid::new_v4().to_string();

    let alt_greetings_json = serde_json::to_string(&payload.alternate_greetings)
        .unwrap_or_else(|_| "[]".to_string());
    let tags_json = "[]";
    let play_mode = normalize_play_mode(payload.play_mode.as_deref());
    let role_policy = payload.role_policy.as_deref().unwrap_or(ROLE_POLICY_OPEN);
    validate_role_policy(role_policy)?;
    let bundled_roles_json = serde_json::to_string(
        &payload.bundled_roles.unwrap_or_default()
    ).map_err(|e| format!("Invalid bundled Role snapshots: {e}"))?;
    let world_info_ids_json = serde_json::to_string(
        &payload.world_info_ids.unwrap_or_default()
    ).unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO characters
            (id, name, desc, personality, scenario, greeting,
             alternate_greetings, mes_example, creator_notes, tags,
             v3_spec, initials, color, play_mode, avatar, world_info_ids, role_policy, bundled_roles)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, NULL, ?15, ?16, ?17)",
        params![
            new_id,
            payload.name,
            payload.prompt,
            "",
            "",
            payload.greeting,
            alt_greetings_json,
            "",
            "",
            tags_json,
            false,
            payload.initials,
            payload.color,
            play_mode,
            world_info_ids_json,
            role_policy,
            bundled_roles_json,
        ],
    ).map_err(|e| e.to_string())?;

    if let Some(avatar_b64) = payload.avatar {
        if !avatar_b64.is_empty() {
            let app_clone = app.clone();
            let id_clone = new_id.clone();

            std::thread::spawn(move || {
                match process_avatar(&avatar_b64) {
                    Ok(avatar_bytes) => {
                        if let Ok(conn) = get_connection(&app_clone) {
                            let _ = conn.execute(
                                "UPDATE characters SET avatar = ?1 WHERE id = ?2",
                                params![avatar_bytes, id_clone]
                            );
                        }
                    }
                    Err(e) => eprintln!("Avatar processing failed: {}", e)
                }
            });
        }
    }

    Ok(new_id)
}

/// Updates an existing character. If no new avatar is provided, the existing one is kept.
/// Avatar processing runs on a background thread.
#[tauri::command]
pub async fn update_character(app: AppHandle, id: String, payload: CreateCharacterPayload) -> Result<(), String> {
    let conn = get_connection(&app)?;

    let alt_greetings_json = serde_json::to_string(&payload.alternate_greetings)
        .unwrap_or_else(|_| "[]".to_string());
    let world_info_ids_json = serde_json::to_string(
        &payload.world_info_ids.unwrap_or_default()
    ).unwrap_or_else(|_| "[]".to_string());
    let play_mode = normalize_play_mode(payload.play_mode.as_deref());
    if let Some(role_policy) = payload.role_policy.as_deref() {
        validate_role_policy(role_policy)?;
    }

    // Folded legacy prompt sections now live in desc. Preserve notes and metadata.
    conn.execute(
        "UPDATE characters SET
            name = ?1, desc = ?2, personality = '', scenario = '',
            greeting = ?3, alternate_greetings = ?4, mes_example = '',
            initials = ?5, color = ?6, play_mode = ?7, world_info_ids = ?8,
            role_policy = COALESCE(?9, role_policy)
         WHERE id = ?10",
        params![
            payload.name,
            payload.prompt,
            payload.greeting,
            alt_greetings_json,
            payload.initials,
            payload.color,
            play_mode,
            world_info_ids_json,
            payload.role_policy,
            id,
        ],
    ).map_err(|e| e.to_string())?;

    if let Some(avatar_b64) = payload.avatar {
        // Blob URLs indicate the existing avatar — skip reprocessing
        if !avatar_b64.is_empty() && !avatar_b64.starts_with("blob:") {
            let app_clone = app.clone();
            let id_clone = id.clone();

            std::thread::spawn(move || {
                match process_avatar(&avatar_b64) {
                    Ok(avatar_bytes) => {
                        if let Ok(conn) = get_connection(&app_clone) {
                            let _ = conn.execute(
                                "UPDATE characters SET avatar = ?1 WHERE id = ?2",
                                params![avatar_bytes, id_clone]
                            );
                        }
                    }
                    Err(e) => eprintln!("Avatar update failed: {}", e)
                }
            });
        }
    }

    Ok(())
}


#[tauri::command]
pub async fn set_character_role_policy(
    app: AppHandle,
    character_id: String,
    role_policy: String,
) -> Result<(), String> {
    validate_role_policy(&role_policy)?;
    let conn = get_connection(&app)?;
    let changed = conn.execute(
        "UPDATE characters SET role_policy = ?1 WHERE id = ?2",
        params![role_policy, character_id],
    ).map_err(|e| e.to_string())?;
    if changed == 0 {
        return Err("Character not found".into());
    }
    Ok(())
}

#[tauri::command]
pub async fn add_bundled_role_snapshot(
    app: AppHandle,
    character_id: String,
    role_id: String,
) -> Result<BundledRoleSnapshot, String> {
    let mut conn = get_connection(&app)?;
    add_snapshot_from_role(&mut conn, &character_id, &role_id)
}

#[tauri::command]
pub async fn remove_bundled_role_snapshot(
    app: AppHandle,
    character_id: String,
    snapshot_id: String,
) -> Result<(), String> {
    let mut conn = get_connection(&app)?;
    remove_snapshot_by_id(&mut conn, &character_id, &snapshot_id)
}

/// Permanently deletes a character. Associated chats are removed via ON DELETE CASCADE.
/// Also cleans up the character's ID from the hidden_character_ids and pinned_character_ids settings.
#[tauri::command]
pub async fn delete_character(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app)?;

    conn.execute("DELETE FROM characters WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

    // Clean up from hidden list
    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'hidden_character_ids'",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(json) = raw {
        let mut ids: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
        ids.retain(|x| x != &id);
        let updated = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('hidden_character_ids', ?1)",
            params![updated],
        ).map_err(|e| e.to_string())?;
    }

    // Clean up from pinned list
    let raw_pinned: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'pinned_character_ids'",
            [],
            |row| row.get(0),
        )
        .ok();

    if let Some(json) = raw_pinned {
        let mut ids: Vec<String> = serde_json::from_str(&json).unwrap_or_default();
        ids.retain(|x| x != &id);
        let updated = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT OR REPLACE INTO settings (key, value) VALUES ('pinned_character_ids', ?1)",
            params![updated],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Returns all hidden character IDs. Applies to both custom and static characters.
#[tauri::command]
pub async fn get_hidden_character_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let conn = get_connection(&app)?;

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'hidden_character_ids'",
            [],
            |row| row.get(0),
        )
        .ok();

    match raw {
        Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        None => Ok(vec![]),
    }
}

/// Hides or unhides a character by updating the hidden_character_ids list in settings.
#[tauri::command]
pub async fn set_character_hidden(app: AppHandle, id: String, hidden: bool) -> Result<(), String> {
    let conn = get_connection(&app)?;

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'hidden_character_ids'",
            [],
            |row| row.get(0),
        )
        .ok();

    let mut ids: Vec<String> = raw
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    if hidden {
        if !ids.contains(&id) {
            ids.push(id);
        }
    } else {
        ids.retain(|x| x != &id);
    }

    let updated = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('hidden_character_ids', ?1)",
        params![updated],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

/// Returns all pinned character IDs. Applies to both custom and static characters.
#[tauri::command]
pub async fn get_pinned_character_ids(app: AppHandle) -> Result<Vec<String>, String> {
    let conn = get_connection(&app)?;

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'pinned_character_ids'",
            [],
            |row| row.get(0),
        )
        .ok();

    match raw {
        Some(json) => serde_json::from_str(&json).map_err(|e| e.to_string()),
        None => Ok(vec![]),
    }
}

/// Pins or unpins a character by updating the pinned_character_ids list in settings.
#[tauri::command]
pub async fn set_character_pinned(app: AppHandle, id: String, pinned: bool) -> Result<(), String> {
    let conn = get_connection(&app)?;

    let raw: Option<String> = conn
        .query_row(
            "SELECT value FROM settings WHERE key = 'pinned_character_ids'",
            [],
            |row| row.get(0),
        )
        .ok();

    let mut ids: Vec<String> = raw
        .and_then(|json| serde_json::from_str(&json).ok())
        .unwrap_or_default();

    if pinned {
        if !ids.contains(&id) {
            ids.push(id);
        }
    } else {
        ids.retain(|x| x != &id);
    }

    let updated = serde_json::to_string(&ids).unwrap_or_else(|_| "[]".to_string());
    conn.execute(
        "INSERT OR REPLACE INTO settings (key, value) VALUES ('pinned_character_ids', ?1)",
        params![updated],
    ).map_err(|e| e.to_string())?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        add_snapshot_from_role, list_bundled_role_snapshots, normalize_play_mode,
        read_stored_bundled_roles, remove_snapshot_by_id, validate_role_policy,
    };
    use rusqlite::{params, Connection};
    use uuid::Uuid;

    fn snapshot_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE characters (
                id TEXT PRIMARY KEY,
                role_policy TEXT NOT NULL DEFAULT 'open'
                    CHECK (role_policy IN ('open', 'restricted')),
                bundled_roles TEXT NOT NULL DEFAULT '[]'
             );
             CREATE TABLE roles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                avatar BLOB
             );
             INSERT INTO characters (id) VALUES ('card');",
        ).unwrap();
        conn
    }

    #[test]
    fn play_mode_defaults_to_solo_and_rejects_unknown_values() {
        assert_eq!(normalize_play_mode(None), "solo");
        assert_eq!(normalize_play_mode(Some("both")), "solo");
        assert_eq!(normalize_play_mode(Some("unknown")), "solo");
        assert_eq!(normalize_play_mode(Some("solo")), "solo");
        assert_eq!(normalize_play_mode(Some("multiplayer")), "multiplayer");
    }

    #[test]
    fn role_policy_accepts_only_the_persisted_model_values() {
        assert!(validate_role_policy("open").is_ok());
        assert!(validate_role_policy("restricted").is_ok());
        assert!(validate_role_policy("invalid").is_err());
        assert!(validate_role_policy("").is_err());
    }

    #[test]
    fn bundled_snapshot_is_an_independent_copy_with_its_own_uuid_and_avatar() {
        let mut conn = snapshot_db();
        conn.execute(
            "INSERT INTO roles (id, name, prompt, avatar) VALUES (?1, ?2, ?3, ?4)",
            params!["source", "Traveler", "Original prompt", vec![1_u8, 2, 3]],
        ).unwrap();

        let snapshot = add_snapshot_from_role(&mut conn, "card", "source").unwrap();
        assert_ne!(snapshot.id, "source");
        assert!(Uuid::parse_str(&snapshot.id).is_ok());
        assert_eq!(snapshot.source_role_id.as_deref(), Some("source"));
        assert_eq!(snapshot.name, "Traveler");
        assert_eq!(snapshot.prompt, "Original prompt");
        assert!(snapshot.has_avatar);

        conn.execute(
            "UPDATE roles SET name = 'Changed', prompt = 'Changed prompt', avatar = NULL
             WHERE id = 'source'",
            [],
        ).unwrap();
        conn.execute("DELETE FROM roles WHERE id = 'source'", []).unwrap();

        let persisted = read_stored_bundled_roles(&conn, "card").unwrap();
        assert_eq!(persisted.len(), 1);
        assert_eq!(persisted[0].name, "Traveler");
        assert_eq!(persisted[0].prompt, "Original prompt");
        assert_eq!(persisted[0].source_role_id.as_deref(), Some("source"));
        assert_eq!(persisted[0].avatar.as_deref(), Some("AQID"));
    }

    #[test]
    fn duplicate_names_and_multiple_snapshots_from_one_source_are_allowed() {
        let mut conn = snapshot_db();
        conn.execute_batch(
            "INSERT INTO roles (id, name, prompt) VALUES ('first', 'Same', 'One');
             INSERT INTO roles (id, name, prompt) VALUES ('second', 'Same', 'Two');",
        ).unwrap();

        let first = add_snapshot_from_role(&mut conn, "card", "first").unwrap();
        let again = add_snapshot_from_role(&mut conn, "card", "first").unwrap();
        let same_name = add_snapshot_from_role(&mut conn, "card", "second").unwrap();
        assert_ne!(first.id, again.id);
        assert_eq!(first.name, same_name.name);
        assert_eq!(list_bundled_role_snapshots(&conn, "card").unwrap().len(), 3);

        remove_snapshot_by_id(&mut conn, "card", &first.id).unwrap();
        let remaining = list_bundled_role_snapshots(&conn, "card").unwrap();
        assert_eq!(remaining.len(), 2);
        assert!(remaining.iter().any(|snapshot| snapshot.id == again.id));
        let source_count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM roles WHERE id = 'first'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(source_count, 1);
    }
}
