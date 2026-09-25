use tauri::AppHandle;
use rusqlite::params;
use crate::database::get_connection;
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::io::Cursor;
use serde_json::{json, Value};
use crate::database::characters::{parse_bundled_roles, StoredBundledRoleSnapshot};
use crate::database::world_info::WorldInfoEntry;

const RYOKAN_EXTENSION_KEY: &str = "ryokan";

static CRC_TABLE: [u32; 256] = generate_crc32_table();

const fn generate_crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut j = 0;
        while j < 8 {
            if c & 1 != 0 { c = 0xedb88320 ^ (c >> 1); }
            else { c >>= 1; }
            j += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

/// CRC-32 per ISO 3309, as required by the PNG spec.
fn png_crc32(data: &[u8]) -> u32 {
    let mut crc = 0xffffffff_u32;
    for &byte in data {
        let idx = ((crc ^ byte as u32) & 0xff) as usize;
        crc = CRC_TABLE[idx] ^ (crc >> 8);
    }
    crc ^ 0xffffffff
}

/// Inserts a tEXt chunk immediately after the IHDR chunk.
fn inject_png_text_chunk(png: Vec<u8>, keyword: &[u8], payload: &[u8]) -> Result<Vec<u8>, String> {
    const PNG_SIGNATURE: &[u8] = &[137, 80, 78, 71, 13, 10, 26, 10];
    if png.len() < 8 || &png[0..8] != PNG_SIGNATURE {
        return Err("Invalid PNG signature".to_string());
    }

    let ihdr_data_len = u32::from_be_bytes([png[8], png[9], png[10], png[11]]) as usize;
    let insert_at = 8 + 4 + 4 + ihdr_data_len + 4;

    let mut chunk_data: Vec<u8> = Vec::new();
    chunk_data.extend_from_slice(keyword);
    chunk_data.push(0); // null separator per PNG spec
    chunk_data.extend_from_slice(payload);

    let chunk_type = b"tEXt";
    let mut crc_input: Vec<u8> = Vec::with_capacity(4 + chunk_data.len());
    crc_input.extend_from_slice(chunk_type);
    crc_input.extend_from_slice(&chunk_data);
    let crc = png_crc32(&crc_input);

    let mut text_chunk: Vec<u8> = Vec::with_capacity(12 + chunk_data.len());
    text_chunk.extend_from_slice(&(chunk_data.len() as u32).to_be_bytes());
    text_chunk.extend_from_slice(chunk_type);
    text_chunk.extend_from_slice(&chunk_data);
    text_chunk.extend_from_slice(&crc.to_be_bytes());

    let mut result = Vec::with_capacity(png.len() + text_chunk.len());
    result.extend_from_slice(&png[..insert_at]);
    result.extend_from_slice(&text_chunk);
    result.extend_from_slice(&png[insert_at..]);

    Ok(result)
}

fn role_avatar_data_url(encoded: &str) -> String {
    let mime = general_purpose::STANDARD.decode(encoded)
        .ok()
        .and_then(|bytes| image::guess_format(&bytes).ok())
        .map(|format| match format {
            ImageFormat::Png => "image/png",
            ImageFormat::Jpeg => "image/jpeg",
            ImageFormat::WebP => "image/webp",
            ImageFormat::Gif => "image/gif",
            _ => "application/octet-stream",
        })
        .unwrap_or("application/octet-stream");
    format!("data:{mime};base64,{encoded}")
}

fn portable_roles(roles: &[StoredBundledRoleSnapshot]) -> Value {
    Value::Array(roles.iter().map(|role| {
        let mut value = json!({
            "id": role.id,
            "name": role.name,
            "prompt": role.prompt,
        });
        let object = value.as_object_mut().expect("role JSON is an object");
        if let Some(source_role_id) = role.source_role_id.as_ref() {
            object.insert("source_role_id".into(), json!(source_role_id));
        }
        if let Some(avatar) = role.avatar.as_deref().filter(|avatar| !avatar.is_empty()) {
            object.insert("avatar".into(), json!(role_avatar_data_url(avatar)));
        }
        value
    }).collect())
}

pub(crate) fn build_card_json(
    name: &str, desc: &str, personality: &str, scenario: &str, greeting: &str,
    alternate_greetings: Vec<String>, mes_example: &str, creator_notes: &str,
    tags: Vec<String>, role_policy: &str, bundled_roles: &[StoredBundledRoleSnapshot],
    character_book: Option<Value>,
) -> Value {
    let mut card = json!({
        "spec": "chara_card_v3",
        "spec_version": "3.0",
        "data": {
            "name": name,
            "description": desc,
            "personality": personality,
            "scenario": scenario,
            "first_mes": greeting,
            "mes_example": mes_example,
            "creator_notes": creator_notes,
            "alternate_greetings": alternate_greetings,
            "tags": tags,
            "character_version": "",
            "creator": "",
            "system_prompt": "",
            "post_history_instructions": "",
            "group_only_greetings": [],
            "assets": [{ "type": "icon", "uri": "ccdefault:", "name": "main", "ext": "png" }],
            "extensions": {
                (RYOKAN_EXTENSION_KEY): {
                    "version": 1,
                    "role_policy": role_policy,
                    "bundled_roles": portable_roles(bundled_roles)
                }
            }
        }
    });
    if let Some(character_book) = character_book {
        card["data"].as_object_mut().expect("card data is an object")
            .insert("character_book".into(), character_book);
    }
    card
}

pub(crate) fn build_character_book(name: &str, books: Vec<(String, String, Vec<WorldInfoEntry>)>) -> Option<Value> {
    if books.is_empty() { return None; }
    let is_merged_book = books.len() > 1;
    let book_name = if books.len() == 1 { books[0].0.clone() } else { format!("{name} World Info") };
    let description = books.iter().filter_map(|(_, description, _)| {
        let description = description.trim();
        (!description.is_empty()).then_some(description)
    }).collect::<Vec<_>>().join("\n\n");
    let mut insertion_index = 0_i64;
    let entries = books.into_iter().flat_map(|(_, _, entries)| entries).map(|entry| {
        let constant = entry.constant.unwrap_or(entry.keys.is_empty());
        let mut value = json!({
            "id": entry.id,
            "keys": entry.keys,
            "content": entry.content,
            "extensions": entry.extensions.unwrap_or_else(|| json!({})),
            "enabled": entry.enabled,
            "insertion_order": if is_merged_book { insertion_index } else { entry.insertion_order.unwrap_or(insertion_index) },
            "case_sensitive": entry.case_sensitive.unwrap_or(false),
            "use_regex": entry.use_regex.unwrap_or(false),
            "constant": constant,
            "comment": entry.comment,
            "position": if entry.position == "before" { "before_char" } else { "after_char" },
        });
        insertion_index += 1;
        let object = value.as_object_mut().expect("lorebook entry is an object");
        if let Some(priority) = entry.priority { object.insert("priority".into(), json!(priority)); }
        if let Some(selective) = entry.selective { object.insert("selective".into(), json!(selective)); }
        if !entry.secondary_keys.is_empty() {
            object.insert("secondary_keys".into(), json!(entry.secondary_keys));
        }
        value
    }).collect::<Vec<_>>();
    Some(json!({
        "name": book_name,
        "description": description,
        "extensions": {},
        "entries": entries,
    }))
}

/// Exports a character as a standards-compatible Character Card V3 PNG.
///
/// Loads character data and avatar from SQLite, builds a V3-spec JSON payload,
/// re-encodes the avatar to PNG, and injects the Base64 JSON as a tEXt chunk.
#[tauri::command]
pub async fn export_character_card(app: AppHandle, id: String) -> Result<Vec<u8>, String> {
    let conn = get_connection(&app)?;

    let row: (String, String, String, String, String, String, String, String, String, Option<Vec<u8>>, String, String, String) =
        conn.query_row(
            "SELECT name, desc, personality, scenario, greeting, \
                    alternate_greetings, mes_example, creator_notes, tags, avatar, role_policy, bundled_roles, world_info_ids \
             FROM characters WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, Option<Vec<u8>>>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, String>(12)?,
                ))
            },
        )
        .map_err(|e| format!("Database error: {}", e))?;

    let (name, desc, personality, scenario, greeting,
         alt_greetings_json, mes_example, creator_notes, tags_json, avatar_blob,
         role_policy, bundled_roles_json, world_info_ids_json) = row;

    let alternate_greetings: Vec<String> =
        serde_json::from_str(&alt_greetings_json).unwrap_or_default();
    let tags: Vec<String> =
        serde_json::from_str(&tags_json).unwrap_or_default();

    let bundled_roles = parse_bundled_roles(&bundled_roles_json)?;
    let world_info_ids: Vec<String> = serde_json::from_str(&world_info_ids_json).unwrap_or_default();
    let mut books = Vec::new();
    for world_info_id in world_info_ids {
        let result = conn.query_row(
            "SELECT name, description, entries FROM world_infos WHERE id = ?1",
            params![world_info_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?)),
        );
        if let Ok((book_name, description, entries_json)) = result {
            if let Ok(entries) = serde_json::from_str::<Vec<WorldInfoEntry>>(&entries_json) {
                books.push((book_name, description, entries));
            }
        }
    }
    let character_book = build_character_book(&name, books);
    let card_json = build_card_json(
        &name, &desc, &personality, &scenario, &greeting, alternate_greetings,
        &mes_example, &creator_notes, tags, &role_policy, &bundled_roles, character_book,
    );

    let json_str = serde_json::to_string(&card_json)
        .map_err(|e| format!("JSON serialization error: {}", e))?;

    let base64_payload = general_purpose::STANDARD.encode(json_str.as_bytes());

    let png_bytes = match avatar_blob {
        Some(ref blob) if !blob.is_empty() => {
            let img = image::load_from_memory(blob)
                .map_err(|e| format!("Avatar decode error: {}", e))?;
            let mut buf = Cursor::new(Vec::new());
            img.write_to(&mut buf, ImageFormat::Png)
                .map_err(|e| format!("PNG encode error: {}", e))?;
            buf.into_inner()
        }
        _ => {
            // No avatar — fall back to a 256×256 transparent placeholder
            let img = image::DynamicImage::new_rgba8(256, 256);
            let mut buf = Cursor::new(Vec::new());
            img.write_to(&mut buf, ImageFormat::Png)
                .map_err(|e| format!("Placeholder PNG error: {}", e))?;
            buf.into_inner()
        }
    };

    inject_png_text_chunk(png_bytes, b"ccv3", base64_payload.as_bytes())
}
