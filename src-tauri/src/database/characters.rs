use tauri::AppHandle;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::database::get_connection;
use base64::{engine::general_purpose, Engine as _};
use image::{ImageFormat};
use webp::{Encoder, WebPMemory};
use std::io::Cursor;

/// Database representation of a character.
/// Avatar is stored as a raw WebP BLOB to minimize database footprint and RAM overhead.
#[derive(Serialize)]
pub struct DbCharacter {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub personality: String,
    pub scenario: String,
    pub greeting: String,
    pub alternate_greetings: String,
    pub mes_example: String,
    pub creator_notes: String,
    pub tags: String,
    pub v3_spec: bool,
    pub initials: String,
    pub color: String,
    pub avatar: Option<Vec<u8>>,
}

/// Incoming payload from the frontend.
/// Arrays are received natively from Svelte and converted to JSON strings before SQLite insertion.
#[derive(Deserialize)]
pub struct CreateCharacterPayload {
    pub name: String,
    pub desc: String,
    pub personality: String,
    pub scenario: String,
    pub greeting: String,
    pub alternate_greetings: Vec<String>,
    pub mes_example: String,
    pub creator_notes: String,
    pub tags: Vec<String>,
    pub v3_spec: bool,
    pub initials: String,
    pub color: String,
    pub avatar: Option<String>,
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

/// Returns all saved characters. Avatars are returned as raw bytes.
#[tauri::command]
pub fn get_custom_characters(app: AppHandle) -> Result<Vec<DbCharacter>, String> {
    let conn = get_connection(&app)?;

    let mut stmt = conn.prepare("SELECT id, name, desc, personality, scenario, greeting, alternate_greetings, mes_example, creator_notes, tags, v3_spec, initials, color, avatar FROM characters ORDER BY created_at DESC")
        .map_err(|e| e.to_string())?;

    let rows = stmt.query_map([], |row| {
        let avatar_blob: Option<Vec<u8>> = row.get(13)?;

        Ok(DbCharacter {
            id: row.get(0)?,
            name: row.get(1)?,
            desc: row.get(2)?,
            personality: row.get(3)?,
            scenario: row.get(4)?,
            greeting: row.get(5)?,
            alternate_greetings: row.get(6)?,
            mes_example: row.get(7)?,
            creator_notes: row.get(8)?,
            tags: row.get(9)?,
            v3_spec: row.get(10)?,
            initials: row.get(11)?,
            color: row.get(12)?,
            avatar: avatar_blob,
        })
    }).map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows { list.push(row.unwrap()); }
    Ok(list)
}

/// Inserts a new character. Avatar processing runs on a background thread.
#[tauri::command]
pub fn create_character(app: AppHandle, payload: CreateCharacterPayload) -> Result<String, String> {
    let conn = get_connection(&app)?;
    let new_id = Uuid::new_v4().to_string();

    let alt_greetings_json = serde_json::to_string(&payload.alternate_greetings)
        .unwrap_or_else(|_| "[]".to_string());
    let tags_json = serde_json::to_string(&payload.tags)
        .unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "INSERT INTO characters (id, name, desc, personality, scenario, greeting, alternate_greetings, mes_example, creator_notes, tags, v3_spec, initials, color, avatar) 
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, NULL)",
        params![
            new_id, payload.name, payload.desc, payload.personality, payload.scenario,
            payload.greeting, alt_greetings_json, payload.mes_example, payload.creator_notes,
            tags_json, payload.v3_spec, payload.initials, payload.color
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
pub fn update_character(app: AppHandle, id: String, payload: CreateCharacterPayload) -> Result<(), String> {
    let conn = get_connection(&app)?;

    let alt_greetings_json = serde_json::to_string(&payload.alternate_greetings)
        .unwrap_or_else(|_| "[]".to_string());
    let tags_json = serde_json::to_string(&payload.tags)
        .unwrap_or_else(|_| "[]".to_string());

    conn.execute(
        "UPDATE characters SET 
            name = ?1, desc = ?2, personality = ?3, scenario = ?4, greeting = ?5,
            alternate_greetings = ?6, mes_example = ?7, creator_notes = ?8,
            tags = ?9, v3_spec = ?10, initials = ?11, color = ?12
         WHERE id = ?13",
        params![
            payload.name, payload.desc, payload.personality, payload.scenario,
            payload.greeting, alt_greetings_json, payload.mes_example, payload.creator_notes,
            tags_json, payload.v3_spec, payload.initials, payload.color,
            id
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

/// Permanently deletes a character. Associated chats are removed via ON DELETE CASCADE.
/// Also cleans up the character's ID from the hidden_character_ids setting.
#[tauri::command]
pub fn delete_character(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app)?;

    conn.execute("DELETE FROM characters WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;

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

    Ok(())
}

/// Returns all hidden character IDs. Applies to both custom and static characters.
#[tauri::command]
pub fn get_hidden_character_ids(app: AppHandle) -> Result<Vec<String>, String> {
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
pub fn set_character_hidden(app: AppHandle, id: String, hidden: bool) -> Result<(), String> {
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