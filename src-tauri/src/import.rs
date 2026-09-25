use base64::{engine::general_purpose, Engine as _};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::command;
use crate::database::characters::StoredBundledRoleSnapshot;
use std::collections::HashSet;
use crate::database::world_info::WorldInfoEntry;

const RYOKAN_EXTENSION_KEY: &str = "ryokan";

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
    pub role_policy: String,
    pub bundled_roles: Vec<StoredBundledRoleSnapshot>,
    pub world_info: Option<ImportedWorldInfo>,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
pub struct ImportedWorldInfo {
    pub name: String,
    pub description: String,
    pub entries: Vec<WorldInfoEntry>,
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

    // Prefer a V3 chunk when a compatibility V2 chunk is also present, as CCv3 requires.
    let keywords = ["ccv3\0", "ccv3", "chara\0", "chara", "character", "data", "json", "persona"];

    for keyword in keywords.iter() {
        for text in &text_chunks {
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
    let mut meta = CharacterMetadata { role_policy: "open".into(), ..Default::default() };
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

    meta.v3_spec = json.get("spec").and_then(Value::as_str) == Some("chara_card_v3")
        || json.get("spec_version").and_then(Value::as_str) == Some("3.0");

    if let Some(extension) = root.get("extensions").and_then(|value| value.get(RYOKAN_EXTENSION_KEY)) {
        if let Ok(mut role_data) = serde_json::from_value::<RyokanRoleExtension>(extension.clone()) {
            if valid_role_extension(&role_data) {
                for role in &mut role_data.bundled_roles {
                    role.avatar = role.avatar.take().and_then(normalize_role_avatar);
                }
                meta.role_policy = role_data.role_policy;
                meta.bundled_roles = role_data.bundled_roles;
            }
        }
    }

    meta.world_info = root.get("character_book").and_then(import_character_book);

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

fn import_character_book(value: &Value) -> Option<ImportedWorldInfo> {
    let raw_entries = value.get("entries")?.as_array()?;
    let mut imported_ids = HashSet::new();
    let mut entries = raw_entries.iter().enumerate().filter_map(|(index, entry)| {
        let content = entry.get("content")?.as_str()?.to_string();
        let keys = entry.get("keys").and_then(Value::as_array)
            .map(|keys| keys.iter().filter_map(Value::as_str).map(String::from).collect())
            .unwrap_or_default();
        let original_id = entry.get("id").map(|id| match id {
            Value::String(value) => value.clone(),
            other => other.to_string(),
        }).unwrap_or_else(|| index.to_string());
        let id = if !original_id.trim().is_empty() && imported_ids.insert(original_id.clone()) {
            original_id
        } else {
            format!("ccv3-{index}-{original_id}")
        };
        let comment = entry.get("comment").and_then(Value::as_str)
            .or_else(|| entry.get("name").and_then(Value::as_str))
            .unwrap_or_default().to_string();
        Some((index, WorldInfoEntry {
            id,
            keys,
            content,
            enabled: entry.get("enabled").and_then(Value::as_bool).unwrap_or(true),
            comment,
            position: match entry.get("position").and_then(Value::as_str) {
                Some("before_char") => "before".into(),
                _ => "after".into(),
            },
            insertion_order: entry.get("insertion_order").and_then(Value::as_i64),
            priority: entry.get("priority").and_then(Value::as_i64),
            constant: entry.get("constant").and_then(Value::as_bool),
            case_sensitive: entry.get("case_sensitive").and_then(Value::as_bool),
            use_regex: entry.get("use_regex").and_then(Value::as_bool),
            selective: entry.get("selective").and_then(Value::as_bool),
            secondary_keys: entry.get("secondary_keys").and_then(Value::as_array)
                .map(|keys| keys.iter().filter_map(Value::as_str).map(String::from).collect())
                .unwrap_or_default(),
            extensions: entry.get("extensions").cloned(),
        }))
    }).collect::<Vec<_>>();
    entries.sort_by_key(|(index, entry)| (entry.insertion_order.unwrap_or(*index as i64), *index));
    Some(ImportedWorldInfo {
        name: value.get("name").and_then(Value::as_str).unwrap_or("Imported World Info").to_string(),
        description: value.get("description").and_then(Value::as_str).unwrap_or_default().to_string(),
        entries: entries.into_iter().map(|(_, entry)| entry).collect(),
    })
}

#[derive(Deserialize)]
struct RyokanRoleExtension {
    version: u32,
    role_policy: String,
    #[serde(default)]
    bundled_roles: Vec<StoredBundledRoleSnapshot>,
}

fn valid_role_extension(extension: &RyokanRoleExtension) -> bool {
    if extension.version != 1
        || !matches!(extension.role_policy.as_str(), "open" | "restricted")
        || (extension.role_policy == "restricted" && extension.bundled_roles.is_empty())
    {
        return false;
    }
    let mut ids = HashSet::new();
    extension.bundled_roles.iter().all(|role| {
        !role.id.trim().is_empty() && !role.name.trim().is_empty() && ids.insert(role.id.as_str())
    })
}

fn normalize_role_avatar(avatar: String) -> Option<String> {
    let encoded = avatar.split_once(",")
        .filter(|(prefix, _)| prefix.starts_with("data:") && prefix.ends_with(";base64"))
        .map(|(_, encoded)| encoded)
        .unwrap_or(&avatar);
    general_purpose::STANDARD.decode(encoded).ok()
        .filter(|bytes| !bytes.is_empty() && image::guess_format(bytes).is_ok())
        .map(|_| encoded.to_string())
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
    use crate::database::characters::StoredBundledRoleSnapshot;
    use crate::export::{build_card_json, build_character_book};

    fn v3_card(extension: Value) -> Value {
        serde_json::json!({
            "spec": "chara_card_v3",
            "spec_version": "3.0",
            "data": {
                "name": "Rin", "description": "Free prompt", "personality": "",
                "scenario": "", "first_mes": "Hello", "mes_example": "",
                "creator_notes": "", "alternate_greetings": [], "tags": [],
                "character_version": "", "creator": "", "system_prompt": "",
                "post_history_instructions": "", "group_only_greetings": [],
                "extensions": extension
            }
        })
    }

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

    #[test]
    fn ordinary_v3_card_keeps_normal_role_defaults() {
        let meta = map_json_to_metadata(&v3_card(serde_json::json!({
            "foreign_app": { "preserved_by_that_app": true }
        }))).unwrap();
        assert!(meta.v3_spec);
        assert_eq!(meta.prompt, "Free prompt");
        assert_eq!(meta.role_policy, "open");
        assert!(meta.bundled_roles.is_empty());
    }

    #[test]
    fn open_character_without_roles_round_trips() {
        let card = build_card_json(
            "Rin", "Free prompt", "", "", "Hello", vec![], "", "", vec![],
            "open", &[], None,
        );
        let meta = map_json_to_metadata(&card).unwrap();
        assert!(meta.v3_spec);
        assert_eq!(meta.role_policy, "open");
        assert!(meta.bundled_roles.is_empty());
    }

    #[test]
    fn bundled_roles_round_trip_with_identity_duplicate_names_and_avatar() {
        let avatar = general_purpose::STANDARD.encode([
            137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82,
            0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137,
        ]);
        let roles = vec![
            StoredBundledRoleSnapshot {
                id: "snapshot-a".into(), source_role_id: Some("local-a".into()),
                name: "Guide".into(), prompt: "First prompt".into(), avatar: Some(avatar.clone()),
            },
            StoredBundledRoleSnapshot {
                id: "snapshot-b".into(), source_role_id: None,
                name: "Guide".into(), prompt: "Second prompt".into(), avatar: None,
            },
        ];
        let card = build_card_json(
            "Rin", "Free prompt", "", "", "Hello", vec![], "", "", vec![],
            "open", &roles, None,
        );
        let meta = map_json_to_metadata(&card).unwrap();
        assert_eq!(meta.role_policy, "open");
        assert_eq!(meta.bundled_roles.len(), 2);
        assert_eq!(meta.bundled_roles[0].id, "snapshot-a");
        assert_eq!(meta.bundled_roles[0].source_role_id.as_deref(), Some("local-a"));
        assert_eq!(meta.bundled_roles[0].name, "Guide");
        assert_eq!(meta.bundled_roles[0].prompt, "First prompt");
        assert_eq!(meta.bundled_roles[0].avatar.as_deref(), Some(avatar.as_str()));
        assert_eq!(meta.bundled_roles[1].id, "snapshot-b");
        assert_eq!(meta.bundled_roles[1].name, "Guide");
        assert_eq!(meta.bundled_roles[1].prompt, "Second prompt");
    }

    #[test]
    fn restricted_character_with_bundled_role_round_trips() {
        let roles = vec![StoredBundledRoleSnapshot {
            id: "standalone".into(), source_role_id: None, name: "Player".into(),
            prompt: "Act independently".into(), avatar: None,
        }];
        let card = build_card_json(
            "Rin", "Free prompt", "", "", "Hello", vec![], "", "", vec![],
            "restricted", &roles, None,
        );
        let meta = map_json_to_metadata(&card).unwrap();
        assert_eq!(meta.role_policy, "restricted");
        assert_eq!(meta.bundled_roles[0].source_role_id, None);
        assert_eq!(meta.bundled_roles[0].prompt, "Act independently");
    }

    #[test]
    fn malformed_ryokan_metadata_does_not_break_standard_card() {
        for malformed in [
            serde_json::json!({ "ryokan": "not an object" }),
            serde_json::json!({ "ryokan": { "version": 1, "role_policy": "invalid", "bundled_roles": [] } }),
            serde_json::json!({ "ryokan": { "version": 1, "role_policy": "restricted", "bundled_roles": [{ "name": "missing fields" }] } }),
        ] {
            let meta = map_json_to_metadata(&v3_card(malformed)).unwrap();
            assert_eq!(meta.name.as_deref(), Some("Rin"));
            assert_eq!(meta.role_policy, "open");
            assert!(meta.bundled_roles.is_empty());
        }
    }

    #[test]
    fn v3_lorebook_import_export_import_round_trip_preserves_activation_fields() {
        let mut original = v3_card(serde_json::json!({}));
        original["data"]["character_book"] = serde_json::json!({
            "name": "Alpenwelt",
            "description": "Orte und Bräuche",
            "extensions": {},
            "entries": [
                {
                    "id": "village", "keys": ["Bergdorf", "Dorf"],
                    "content": "Das Bergdorf besitzt eine Sternwarte.",
                    "extensions": {"source": "fixture"}, "enabled": true,
                    "insertion_order": 20, "priority": 7, "case_sensitive": false,
                    "use_regex": false, "constant": false, "position": "before_char"
                },
                {
                    "id": 2, "keys": ["Straße"], "secondary_keys": ["Markt"],
                    "content": "Der Markt schließt bei Dämmerung.",
                    "extensions": {}, "enabled": true, "insertion_order": 30,
                    "case_sensitive": false, "use_regex": false, "constant": false,
                    "selective": true, "position": "after_char"
                },
                {
                    "id": "disabled", "keys": ["Markt"], "content": "Nicht verwenden",
                    "extensions": {}, "enabled": false, "insertion_order": 40,
                    "case_sensitive": false, "use_regex": false, "constant": false
                }
            ]
        });

        let first_import = map_json_to_metadata(&original).unwrap();
        let imported_book = first_import.world_info.clone().expect("lorebook imported");
        assert_eq!(imported_book.entries.len(), 3);
        assert_eq!(imported_book.entries[0].position, "before");
        assert_eq!(imported_book.entries[1].secondary_keys, vec!["Markt"]);
        assert!(!imported_book.entries[2].enabled);

        let exported_book = build_character_book("Rin", vec![(
            imported_book.name.clone(), imported_book.description.clone(), imported_book.entries.clone(),
        )]);
        let exported_card = build_card_json(
            "Rin", "Free prompt", "", "", "Hello", vec![], "", "", vec![],
            "open", &[], exported_book,
        );
        let second_import = map_json_to_metadata(&exported_card).unwrap();
        let round_tripped = second_import.world_info.expect("round-tripped lorebook imported");

        assert_eq!(round_tripped.name, imported_book.name);
        assert_eq!(round_tripped.description, imported_book.description);
        assert_eq!(round_tripped.entries, imported_book.entries);
        assert!(exported_card["data"]["character_book"]["entries"].is_array());
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
