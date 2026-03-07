use tauri::AppHandle;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use uuid::Uuid;
use crate::database::get_connection;
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use webp::{Encoder, WebPMemory};
use std::io::Cursor;

/// Database representation returned to the frontend.
/// Avatar is a raw WebP BLOB — same pattern as characters.
#[derive(Serialize)]
pub struct DbRole {
    pub id: String,
    pub name: String,
    pub bio: String,
    pub pronouns: String,
    pub avatar: Option<Vec<u8>>,
    pub created_at: String,
}

/// Payload sent from the frontend when creating or updating a role.
#[derive(Deserialize)]
pub struct RolePayload {
    pub name: String,
    pub bio: Option<String>,
    pub pronouns: Option<String>,
    /// Base64 data-URL or null if no avatar was set / changed.
    pub avatar: Option<String>,
}

/// Re-uses the same resize + WebP logic as characters.rs.
fn process_avatar(base64_img: &str) -> Result<Vec<u8>, String> {
    let clean = base64_img.split(',').last().unwrap_or(base64_img);
    let img_bytes = general_purpose::STANDARD
        .decode(clean)
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
    let webp: WebPMemory =
        Encoder::from_rgba(rgba.as_raw(), resized.width(), resized.height()).encode(92.0);
    let result = webp.to_vec();

    if result.len() < original_size || !needs_resize {
        Ok(result)
    } else {
        Ok(img_bytes)
    }
}

/// Returns all user-created roles ordered by creation date (newest first).
#[tauri::command]
pub fn get_roles(app: AppHandle) -> Result<Vec<DbRole>, String> {
    let conn = get_connection(&app)?;

    let mut stmt = conn
        .prepare(
            "SELECT id, name, bio, pronouns, avatar, created_at
             FROM roles
             ORDER BY created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(DbRole {
                id: row.get(0)?,
                name: row.get(1)?,
                bio: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                pronouns: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                avatar: row.get(4)?,
                created_at: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
            })
        })
        .map_err(|e| e.to_string())?;

    let mut list = Vec::new();
    for row in rows {
        list.push(row.map_err(|e| e.to_string())?);
    }
    Ok(list)
}

/// Inserts a new role. Avatar processing runs on a background thread.
/// Returns the new UUID so the frontend can update its optimistic entry.
#[tauri::command]
pub fn create_role(app: AppHandle, payload: RolePayload) -> Result<String, String> {
    let conn = get_connection(&app)?;
    let new_id = Uuid::new_v4().to_string();

    conn.execute(
        "INSERT INTO roles (id, name, bio, pronouns, avatar)
         VALUES (?1, ?2, ?3, ?4, NULL)",
        params![
            new_id,
            payload.name,
            payload.bio.unwrap_or_default(),
            payload.pronouns.unwrap_or_default(),
        ],
    )
    .map_err(|e| e.to_string())?;

    if let Some(avatar_b64) = payload.avatar {
        if !avatar_b64.is_empty() {
            let app_clone = app.clone();
            let id_clone = new_id.clone();

            std::thread::spawn(move || {
                match process_avatar(&avatar_b64) {
                    Ok(bytes) => {
                        if let Ok(conn) = get_connection(&app_clone) {
                            let _ = conn.execute(
                                "UPDATE roles SET avatar = ?1 WHERE id = ?2",
                                params![bytes, id_clone],
                            );
                        }
                    }
                    Err(e) => eprintln!("Role avatar processing failed: {}", e),
                }
            });
        }
    }

    Ok(new_id)
}

/// Updates name, bio, pronouns. If a new avatar is supplied it is re-processed
/// asynchronously; blob:-URLs (existing avatar) are skipped.
#[tauri::command]
pub fn update_role(app: AppHandle, id: String, payload: RolePayload) -> Result<(), String> {
    let conn = get_connection(&app)?;

    conn.execute(
        "UPDATE roles
         SET name = ?1, bio = ?2, pronouns = ?3
         WHERE id = ?4",
        params![
            payload.name,
            payload.bio.unwrap_or_default(),
            payload.pronouns.unwrap_or_default(),
            id,
        ],
    )
    .map_err(|e| e.to_string())?;

    if let Some(avatar_b64) = payload.avatar {
        if !avatar_b64.is_empty() && !avatar_b64.starts_with("blob:") {
            let app_clone = app.clone();
            let id_clone = id.clone();

            std::thread::spawn(move || {
                match process_avatar(&avatar_b64) {
                    Ok(bytes) => {
                        if let Ok(conn) = get_connection(&app_clone) {
                            let _ = conn.execute(
                                "UPDATE roles SET avatar = ?1 WHERE id = ?2",
                                params![bytes, id_clone],
                            );
                        }
                    }
                    Err(e) => eprintln!("Role avatar update failed: {}", e),
                }
            });
        }
    }

    Ok(())
}

/// Permanently deletes a role.
#[tauri::command]
pub fn delete_role(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    conn.execute("DELETE FROM roles WHERE id = ?1", params![id])
        .map_err(|e| e.to_string())?;
    Ok(())
}