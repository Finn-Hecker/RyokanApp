use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::command;

/// Extracted metadata from AI character cards, mapping to community formats (e.g., V2/V3).
#[derive(Serialize, Deserialize, Debug, Default)]
pub struct CharacterMetadata {
    pub name: Option<String>,
    pub description: Option<String>,
    pub personality: Option<String>,
    pub scenario: Option<String>,
    pub first_mes: Option<String>,
    pub alternate_greetings: Vec<String>,
    pub mes_example: Option<String>,
    pub creator_notes: Option<String>,
    pub tags: Vec<String>,
    pub v3_spec: bool,
    pub prompt: String,
}

// Manually parses PNG chunks to avoid heavy image dependencies and ensure zero-lag extraction.
fn extract_text_chunks_from_png(data: &[u8]) -> Vec<String> {
    let mut texts = Vec::new();
    
    if data.len() < 8 || &data[0..8] != &[137, 80, 78, 71, 13, 10, 26, 10] {
        return texts;
    }
    
    let mut i = 8;
    while i + 8 <= data.len() {
        let length = u32::from_be_bytes([data[i], data[i+1], data[i+2], data[i+3]]) as usize;
        let chunk_type = &data[i+4..i+8];
        i += 8; 
        
        // tEXt and iTXt chunks contain the actual JSON payloads in character cards.
        if chunk_type == b"tEXt" || chunk_type == b"iTXt" {
            if i + length <= data.len() {
                let chunk_data = &data[i..i+length];
                texts.push(String::from_utf8_lossy(chunk_data).to_string());
            }
        }
        
        i += length + 4; 
    }
    
    texts
}

/// Scans a raw PNG byte stream for hidden JSON metadata and maps it to the internal struct.
#[command]
pub async fn parse_character_card(image_data: Vec<u8>) -> Result<CharacterMetadata, String> {
    let text_chunks = extract_text_chunks_from_png(&image_data);

    if text_chunks.is_empty() {
        return Err("No text data found in the PNG.".to_string());
    }

    // Keywords used by V2/V3 character card standards to prefix the payload.
    let keywords = ["chara\0", "chara", "ccv3\0", "ccv3", "character", "data", "json", "persona"];

    for text in text_chunks {
        for keyword in keywords.iter() {
            if text.to_lowercase().starts_with(keyword) {
                let raw_data = text[keyword.len()..].trim_matches('\0');

                // Older cards encode the JSON in Base64 within the text chunk.
                let json_str = if let Ok(decoded) = general_purpose::STANDARD.decode(raw_data) {
                     String::from_utf8_lossy(&decoded).to_string()
                } else {
                     raw_data.to_string()
                };

                if let Ok(json) = serde_json::from_str::<Value>(&json_str) {
                    if let Some(meta) = map_json_to_metadata(&json) {
                        return Ok(meta);
                    }
                }
            }
        }
    }

    Err("Data found, but format not recognized.".to_string())
}

// Maps JSON fields to CharacterMetadata, handling legacy and nested formats.
fn map_json_to_metadata(json: &Value) -> Option<CharacterMetadata> {
    let mut meta = CharacterMetadata::default();
    let mut found_any = false;

    // V2 cards often wrap the actual metadata inside a "data" object.
    let root = if let Some(data_obj) = json.get("data") {
        if data_obj.is_object() { data_obj } else { json }
    } else {
        json
    };

    let get_str = |key: &str| -> Option<String> {
        root.get(key).and_then(|v| v.as_str()).map(|s| s.to_string())
    };

    if let Some(name) = get_str("name") { meta.name = Some(name); found_any = true; }
    if let Some(desc) = get_str("description") { meta.description = Some(desc); found_any = true; }
    if let Some(pers) = get_str("personality") { meta.personality = Some(pers); }
    if let Some(scen) = get_str("scenario") { meta.scenario = Some(scen); }

    // Fallbacks for older formats that use different keys for the greeting.
    meta.first_mes = get_str("first_mes")
        .or_else(|| get_str("first_message"))
        .or_else(|| get_str("greeting"));

    if let Some(alt_greetings) = root.get("alternate_greetings") {
        if let Some(arr) = alt_greetings.as_array() {
            meta.alternate_greetings = arr.iter()
                .filter_map(|v| v.as_str().map(String::from))
                .collect();
        }
    }

    meta.mes_example = get_str("mes_example")
        .or_else(|| get_str("example_dialogue"));

    meta.creator_notes = get_str("creator_notes")
        .or_else(|| get_str("creator"));

    if let Some(tags) = root.get("tags") {
        if let Some(arr) = tags.as_array() {
            meta.tags = arr.iter().filter_map(|v| v.as_str().map(String::from)).collect();
        }
    }

    if root.get("spec").is_some() || root.get("spec_version").is_some() {
        meta.v3_spec = true;
    }

    meta.prompt = combine_legacy_prompt(
        meta.description.as_deref().unwrap_or_default(),
        meta.personality.as_deref().unwrap_or_default(),
        meta.scenario.as_deref().unwrap_or_default(),
        meta.mes_example.as_deref().unwrap_or_default(),
    );
    found_any |= !meta.prompt.is_empty();

    // Preserve the existing parser response for personality-only legacy cards.
    if meta.description.is_none() && meta.personality.is_some() {
        meta.description = meta.personality.clone();
    }

    if found_any { Some(meta) } else { None }
}

/// Adapts legacy rows and imported cards without changing the database schema.
/// A prompt already stored alone in desc passes through unchanged.
pub fn combine_legacy_prompt(description: &str, personality: &str, scenario: &str, examples: &str) -> String {
    if [personality, scenario, examples].iter().all(|text| text.trim().is_empty()) {
        return description.to_string();
    }
    [("Description", description), ("Personality", personality),
     ("Scenario", scenario), ("Example Dialogs", examples)]
        .into_iter()
        .filter(|(_, text)| !text.trim().is_empty())
        .map(|(label, text)| format!("{}\n{}", label, text.trim()))
        .collect::<Vec<_>>()
        .join("\n\n")
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn combines_legacy_content_without_greetings_or_notes() {
        let meta = map_json_to_metadata(&serde_json::json!({"data": {
            "name": "Rin", "description": "Character", "personality": "Kind",
            "scenario": "Inn", "mes_example": "{{char}}: Hello",
            "first_mes": "Welcome", "alternate_greetings": ["Good evening"],
            "creator_notes": "Not instructions"
        }})).unwrap();
        assert_eq!(meta.prompt, "Description\nCharacter\n\nPersonality\nKind\n\nScenario\nInn\n\nExample Dialogs\n{{char}}: Hello");
        assert_eq!(meta.first_mes.as_deref(), Some("Welcome"));
        assert_eq!(meta.alternate_greetings, vec!["Good evening"]);
    }

    #[test]
    fn preserves_prompt_stored_in_description_without_duplicate_sections() {
        let prompt = "  Write freely.\n\nKeep this spacing.  ";
        let meta = map_json_to_metadata(&serde_json::json!({"data": {
            "name": "Rin", "description": prompt, "personality": "",
            "scenario": "", "mes_example": "", "first_mes": "Hi"
        }})).unwrap();
        assert_eq!(meta.prompt, prompt);
        assert_eq!(meta.first_mes.as_deref(), Some("Hi"));
        assert_eq!(combine_legacy_prompt(prompt, "", " ", ""), prompt);
        assert_eq!(combine_legacy_prompt("", "Kind", "", ""), "Personality\nKind");
    }

    #[tokio::test]
    async fn imports_v2_and_v3_png_chunks() {
        for (keyword, spec) in [("chara", "chara_card_v2"), ("ccv3", "chara_card_v3")] {
            let payload = general_purpose::STANDARD.encode(
                serde_json::to_vec(&serde_json::json!({"spec": spec, "data": {
                    "name": "Rin", "description": "Free prompt", "first_mes": "Hello",
                    "alternate_greetings": ["Hi"]
                }})).unwrap()
            );
            let mut png = std::io::Cursor::new(Vec::new());
            image::DynamicImage::new_rgba8(1, 1).write_to(&mut png, image::ImageFormat::Png).unwrap();
            let mut png = png.into_inner();
            let data = format!("{keyword}\0{payload}").into_bytes();
            let mut chunk = (data.len() as u32).to_be_bytes().to_vec();
            chunk.extend_from_slice(b"tEXt");
            chunk.extend_from_slice(&data);
            let mut crc = !0u32;
            for byte in &chunk[4..] {
                crc ^= u32::from(*byte);
                for _ in 0..8 { crc = (crc >> 1) ^ (0xedb88320 & 0u32.wrapping_sub(crc & 1)); }
            }
            chunk.extend_from_slice(&(!crc).to_be_bytes());
            png.splice(33..33, chunk);
            let meta = parse_character_card(png).await.unwrap();
            assert_eq!(meta.prompt, "Free prompt", "{spec}");
            assert_eq!(meta.first_mes.as_deref(), Some("Hello"));
            assert_eq!(meta.alternate_greetings, vec!["Hi"]);
        }
    }
}
