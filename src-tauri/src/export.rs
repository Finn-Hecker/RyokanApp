use tauri::AppHandle;
use rusqlite::params;
use crate::database::get_connection;
use base64::{engine::general_purpose, Engine as _};
use image::ImageFormat;
use std::io::Cursor;

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

/// Exports a character as a SillyTavern-compatible V2 character card (PNG).
///
/// Loads character data and avatar from SQLite, builds a V2-spec JSON payload,
/// re-encodes the avatar to PNG, and injects the Base64 JSON as a tEXt chunk.
#[tauri::command]
pub fn export_character_card(app: AppHandle, id: String) -> Result<Vec<u8>, String> {
    let conn = get_connection(&app)?;

    let row: (String, String, String, String, String, String, String, String, String, Option<Vec<u8>>) =
        conn.query_row(
            "SELECT name, desc, personality, scenario, greeting, \
                    alternate_greetings, mes_example, creator_notes, tags, avatar \
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
                ))
            },
        )
        .map_err(|e| format!("Database error: {}", e))?;

    let (name, desc, personality, scenario, greeting,
         alt_greetings_json, mes_example, creator_notes, tags_json, avatar_blob) = row;

    let alternate_greetings: Vec<String> =
        serde_json::from_str(&alt_greetings_json).unwrap_or_default();
    let tags: Vec<String> =
        serde_json::from_str(&tags_json).unwrap_or_default();

    let card_json = serde_json::json!({
        "spec": "chara_card_v2",
        "spec_version": "2.0",
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
            "extensions": {}
        }
    });

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

    inject_png_text_chunk(png_bytes, b"chara", base64_payload.as_bytes())
}