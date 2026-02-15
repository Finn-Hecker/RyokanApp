use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::command;

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
}

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

#[command]
pub async fn parse_character_card(image_data: Vec<u8>) -> Result<CharacterMetadata, String> {
    
    let text_chunks = extract_text_chunks_from_png(&image_data);

    if text_chunks.is_empty() {
        return Err("No text data found in the PNG.".to_string());
    }

    let keywords = ["chara\0", "chara", "ccv3\0", "ccv3", "character", "data", "json", "persona"];

    for text in text_chunks {
        for keyword in keywords.iter() {
            if text.to_lowercase().starts_with(keyword) {
                
                let raw_data = text[keyword.len()..].trim_matches('\0');

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

fn map_json_to_metadata(json: &Value) -> Option<CharacterMetadata> {
    let mut meta = CharacterMetadata::default();
    let mut found_any = false;

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

    if meta.description.is_none() && meta.personality.is_some() {
        meta.description = meta.personality.clone();
    }

    if found_any { Some(meta) } else { None }
}