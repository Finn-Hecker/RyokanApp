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
#[derive(Serialize)]
pub struct DbRole {
    pub id: String,
    pub name: String,
    pub prompt: String,
    pub has_avatar: bool,
    pub created_at: String,
}

/// Payload sent from the frontend when creating or updating a role.
#[derive(Deserialize)]
pub struct RolePayload {
    pub name: String,
    #[serde(default)]
    pub prompt: String,
    /// Base64 data-URL or null if no avatar was set / changed.
    pub avatar: Option<String>,
}

fn validate_role_name(name: &str) -> Result<(), String> {
    if name.trim().is_empty() {
        Err("Role name must not be empty".into())
    } else {
        Ok(())
    }
}

fn list_roles(conn: &rusqlite::Connection) -> rusqlite::Result<Vec<DbRole>> {
    let mut stmt = conn.prepare(
        "SELECT id, name, prompt, LENGTH(avatar) > 0, created_at
         FROM roles
         ORDER BY created_at DESC",
    )?;
    let rows = stmt.query_map([], |row| {
        let has_avatar: Option<bool> = row.get(3)?;
        Ok(DbRole {
            id: row.get(0)?,
            name: row.get(1)?,
            prompt: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
            has_avatar: has_avatar.unwrap_or(false),
            created_at: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
        })
    })?;

    rows.collect()
}

fn insert_role(
    conn: &rusqlite::Connection,
    id: &str,
    name: &str,
    prompt: &str,
) -> Result<(), String> {
    validate_role_name(name)?;
    conn.execute(
        "INSERT INTO roles (id, name, prompt) VALUES (?1, ?2, ?3)",
        params![id, name, prompt],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn update_role_fields(
    conn: &rusqlite::Connection,
    id: &str,
    name: &str,
    prompt: &str,
) -> Result<(), String> {
    validate_role_name(name)?;
    conn.execute(
        "UPDATE roles SET name = ?1, prompt = ?2 WHERE id = ?3",
        params![name, prompt, id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn delete_role_by_id(conn: &rusqlite::Connection, id: &str) -> rusqlite::Result<usize> {
    let deleted = conn.execute("DELETE FROM roles WHERE id = ?1", params![id])?;
    conn.execute(
        "DELETE FROM settings WHERE key = 'default_role_id' AND value = ?1",
        params![id],
    )?;
    Ok(deleted)
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
pub async fn get_roles(app: AppHandle) -> Result<Vec<DbRole>, String> {
    let conn = get_connection(&app)?;
    list_roles(&conn).map_err(|e| e.to_string())
}

/// Lazily fetches a single role's avatar as a Base64 data URL.
/// Same rationale as characters.rs::get_character_avatar.
#[tauri::command]
pub async fn get_role_avatar(app: AppHandle, id: String) -> Result<Option<String>, String> {
    let conn = get_connection(&app)?;

    let avatar_blob: Option<Vec<u8>> = conn.query_row(
        "SELECT avatar FROM roles WHERE id = ?1",
        params![id],
        |row| row.get(0),
    ).map_err(|e| e.to_string())?;

    Ok(avatar_blob.filter(|b| !b.is_empty()).map(|bytes| {
        format!("data:image/webp;base64,{}", general_purpose::STANDARD.encode(bytes))
    }))
}

/// Inserts a new role. Avatar processing completes before this command returns,
/// so a subsequent Card snapshot can always copy the persisted bytes.
/// Returns the new UUID so the frontend can update its optimistic entry.
#[tauri::command]
pub async fn create_role(app: AppHandle, payload: RolePayload) -> Result<String, String> {
    let conn = get_connection(&app)?;
    let new_id = Uuid::new_v4().to_string();

    insert_role(&conn, &new_id, &payload.name, &payload.prompt)?;

    if let Some(avatar_b64) = payload.avatar.filter(|avatar| !avatar.is_empty()) {
        let bytes = process_avatar(&avatar_b64)?;
        conn.execute(
            "UPDATE roles SET avatar = ?1 WHERE id = ?2",
            params![bytes, new_id],
        ).map_err(|e| e.to_string())?;
    }

    Ok(new_id)
}

/// Updates name and prompt. If a new avatar is supplied it is re-processed
/// before the command returns; blob:-URLs (existing avatar) are skipped.
#[tauri::command]
pub async fn update_role(app: AppHandle, id: String, payload: RolePayload) -> Result<(), String> {
    let conn = get_connection(&app)?;

    update_role_fields(&conn, &id, &payload.name, &payload.prompt)?;

    if let Some(avatar_b64) = payload.avatar.filter(|avatar| {
        !avatar.is_empty() && !avatar.starts_with("blob:")
    }) {
        let bytes = process_avatar(&avatar_b64)?;
        conn.execute(
            "UPDATE roles SET avatar = ?1 WHERE id = ?2",
            params![bytes, id],
        ).map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// Permanently deletes a role.
#[tauri::command]
pub async fn delete_role(app: AppHandle, id: String) -> Result<(), String> {
    let conn = get_connection(&app)?;
    delete_role_by_id(&conn, &id).map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{delete_role_by_id, insert_role, list_roles, update_role_fields};
    use rusqlite::{params, Connection};
    use uuid::Uuid;

    fn roles_db() -> Connection {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
             CREATE TABLE roles (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                prompt TEXT NOT NULL DEFAULT '',
                bio TEXT NOT NULL DEFAULT '',
                pronouns TEXT NOT NULL DEFAULT '',
                avatar BLOB,
                created_at TEXT NOT NULL DEFAULT 'now'
             );",
        )
        .unwrap();
        conn
    }

    #[test]
    fn role_crud_uses_prompt_and_keeps_uuid_identity_stable() {
        let conn = roles_db();
        let id = Uuid::new_v4().to_string();

        insert_role(&conn, &id, "Traveler", "").unwrap();
        let created = list_roles(&conn).unwrap();
        assert_eq!(created.len(), 1);
        assert_eq!(created[0].id, id);
        assert_eq!(created[0].prompt, "");

        update_role_fields(&conn, &id, "Traveler", "Seeks lost places").unwrap();
        let updated = list_roles(&conn).unwrap();
        assert_eq!(updated[0].id, id);
        assert_eq!(updated[0].prompt, "Seeks lost places");

        let legacy_bio: String = conn
            .query_row("SELECT bio FROM roles WHERE id = ?1", params![id], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(legacy_bio, "");

        assert_eq!(delete_role_by_id(&conn, &id).unwrap(), 1);
        assert!(list_roles(&conn).unwrap().is_empty());
    }

    #[test]
    fn duplicate_names_are_allowed_and_empty_names_are_rejected() {
        let conn = roles_db();
        insert_role(&conn, "first", "Traveler", "First prompt").unwrap();
        insert_role(&conn, "second", "Traveler", "Second prompt").unwrap();
        assert_eq!(list_roles(&conn).unwrap().len(), 2);

        assert_eq!(
            insert_role(&conn, "third", "   ", "Prompt").unwrap_err(),
            "Role name must not be empty"
        );
    }

    #[test]
    fn deleting_the_default_role_clears_its_preference() {
        let conn = roles_db();
        insert_role(&conn, "default-id", "Traveler", "Prompt").unwrap();
        conn.execute(
            "INSERT INTO settings (key, value) VALUES ('default_role_id', 'default-id')",
            [],
        ).unwrap();

        delete_role_by_id(&conn, "default-id").unwrap();

        let count: i64 = conn.query_row(
            "SELECT COUNT(*) FROM settings WHERE key = 'default_role_id'",
            [],
            |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn role_avatar_metadata_survives_prompt_updates() {
        let conn = roles_db();
        insert_role(&conn, "with-avatar", "Portrait role", "Old prompt").unwrap();
        conn.execute(
            "UPDATE roles SET avatar = ?1 WHERE id = 'with-avatar'",
            params![vec![1_u8, 2, 3]],
        )
        .unwrap();

        update_role_fields(&conn, "with-avatar", "Portrait role", "New prompt").unwrap();
        let role = list_roles(&conn).unwrap().pop().unwrap();
        assert!(role.has_avatar);
        let avatar: Vec<u8> = conn
            .query_row(
                "SELECT avatar FROM roles WHERE id = 'with-avatar'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(avatar, vec![1, 2, 3]);
    }
}
