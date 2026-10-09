use super::*;
use serde_json::json;

#[test]
fn export_diagnostics_identify_first_validation_predicate_without_changing_errors() {
    type Mutation = fn(&mut Value);
    let cases: &[(Reason, Mutation)] = &[
        (Reason::SchemaVersion, |v| v["version"] = json!(2)),
        (Reason::ConversationMode, |v| v["conversation"]["mode"] = json!("multiplayer")),
        (Reason::ConversationCreatedAt, |v| v["conversation"]["created_at"] = json!("bad")),
        (Reason::ConversationUpdatedAt, |v| v["conversation"]["updated_at"] = json!("bad")),
        (Reason::MessageIdEmpty, |v| v["messages"][0]["id"] = json!("")),
        (Reason::MessageIdDuplicate, |v| v["messages"][1]["id"] = json!("m0")),
        (Reason::MessageRole, |v| v["messages"][0]["role"] = json!("system")),
        (Reason::MessageCreatedAt, |v| v["messages"][0]["created_at"] = json!("bad")),
        (Reason::MessageOrder, |v| v["messages"][1]["created_at"] = json!("2025-01-01")),
        (Reason::EmptySwipesIndex, |v| v["messages"][0]["swipe_index"] = json!(1)),
        (Reason::SwipeContentMismatch, |v| v["messages"][1]["content"] = json!("different")),
        (Reason::UsageLength, |v| v["messages"][1]["usage_variants"] = json!([null, null])),
        (Reason::UsageCost, |v| v["messages"][1]["usage_variants"] = json!([{"costUsd":-1.0}])),
        (Reason::SummaryBoundary, |v| v["conversation"]["summary"]["last_message_id"] = json!("absent")),
        (Reason::LorebookIdEmpty, |v| v["world_infos"][0]["id"] = json!("")),
        (Reason::LorebookIdDuplicate, |v| {
            let world_info = v["world_infos"][0].clone();
            v["world_infos"].as_array_mut().unwrap().push(world_info);
        }),
        (Reason::LorebookCreatedAt, |v| v["world_infos"][0]["created_at"] = json!("bad")),
        (Reason::LoreEntryIdEmpty, |v| v["world_infos"][0]["entries"][0]["id"] = json!("")),
        (Reason::LoreEntryIdDuplicate, |v| {
            let entry = v["world_infos"][0]["entries"][0].clone();
            v["world_infos"][0]["entries"].as_array_mut().unwrap().push(entry);
        }),
        (Reason::LoreEntryPosition, |v| v["world_infos"][0]["entries"][0]["position"] = json!("invalid")),
        (Reason::LorebookUnlinked, |v| v["world_infos"][0]["id"] = json!("unlinked")),
        (Reason::CharacterIdEmpty, |v| v["conversation"]["character"]["id"] = json!("")),
        (Reason::CharacterNameEmpty, |v| v["conversation"]["character"]["name"] = json!(" ")),
        (Reason::AvatarEncoding, |v| v["conversation"]["character"]["avatarUrl"] = json!("data:image/png,PRIVATE")),
        (Reason::AvatarBase64, |v| v["conversation"]["character"]["avatarUrl"] = json!("data:image/png;base64,!!!!")),
        (Reason::AvatarImage, |v| v["conversation"]["character"]["avatarUrl"] = json!("data:image/png;base64,UFJJVkFURQ==")),
        (Reason::AvatarMime, |v| {
            let avatar = v["conversation"]["character"]["avatarUrl"].as_str().unwrap().replace("data:image/png", "data:image/jpeg");
            v["conversation"]["character"]["avatarUrl"] = json!(avatar);
        }),
    ];
    let conn = database();
    for (reason, mutate) in cases {
        let mut value = fixture();
        mutate(&mut value);
        let file: ChatFile = serde_json::from_value(value).unwrap();
        let mut probe = Probe::default();
        let error = validate_with_probe(&conn, &file, &mut probe).unwrap_err();
        assert_eq!(probe.failure_reason(), Some(*reason));
        let expected = match reason {
            Reason::SchemaVersion => "Unsupported Ryokan chat schema or version",
            Reason::SummaryBoundary => "Invalid Rolling Summary boundary",
            Reason::AvatarEncoding => "Chat avatars must be embedded images",
            Reason::AvatarBase64 | Reason::AvatarImage => "Invalid chat avatar",
            Reason::AvatarMime => "Invalid chat avatar type",
            _ => "Invalid or incomplete Ryokan chat data",
        };
        assert_eq!(error, expected);
    }
    // A later avatar problem must not mask the earlier swipe failure.
    let mut file: ChatFile = serde_json::from_value(fixture()).unwrap();
    file.messages[1].content = "different".into();
    file.conversation.character.as_mut().unwrap().avatar_url = Some("data:PRIVATE".into());
    let mut probe = Probe::default();
    assert!(validate_with_probe(&conn, &file, &mut probe).is_err());
    assert_eq!(probe.failure_reason(), Some(Reason::SwipeContentMismatch));
    assert_eq!(serde_json::to_value(probe.outcome(Command::Export, false)).unwrap()["avatar"], Value::Null);
}

#[test]
fn export_preparation_diagnostics_distinguish_data_reads_from_validation() {
    for (sql, expected) in [
        ("UPDATE conversations SET character_snapshot = NULL", Reason::CharacterSnapshotMissing),
        ("UPDATE conversations SET character_snapshot = '{}'", Reason::CharacterSnapshotShape),
        ("UPDATE conversations SET role_snapshot = '{}'", Reason::RoleSnapshotShape),
        ("UPDATE messages SET swipe_index = -1", Reason::MessageSwipeIndexRead),
        ("UPDATE messages SET swipe_variants = 'PRIVATE'", Reason::SwipesJson),
        ("UPDATE messages SET usage_variants = '[{\"inputTokens\":-1}]'", Reason::UsageJson),
        ("UPDATE world_infos SET entries = 'PRIVATE'", Reason::LorebookJson),
    ] {
        let mut conn = database();
        let file = parse_file(&conn, &fixture().to_string()).unwrap();
        let id = import_row(&mut conn, file).unwrap();
        conn.execute_batch(sql).unwrap();
        let mut probe = Probe::default();
        assert!(export_row_with_probe(&conn, &id, &mut probe).is_err());
        assert_eq!(probe.failure_reason(), Some(expected));
        let trace = serde_json::to_string(&probe.outcome(Command::Export, false)).unwrap();
        assert!(!trace.contains("PRIVATE"));
        assert!(!trace.contains(&id));
    }
}

#[test]
fn rejected_dev_avatar_keeps_existing_error_and_records_only_classification() {
    let mut conn = database();
    let file = parse_file(&conn, &fixture().to_string()).unwrap();
    let id = import_row(&mut conn, file).unwrap();
    let mut snapshot = fixture()["conversation"]["character"].clone();
    snapshot["avatarUrl"] = json!("http://192.0.2.1:1420/src/lib/assets/avatars/lyvee.webp?t=PRIVATE");
    conn.execute("UPDATE conversations SET character_snapshot = ?1 WHERE id = ?2",
        params![snapshot.to_string(), id]).unwrap();
    let mut probe = Probe::default();
    assert_eq!(export_row_with_probe(&conn, &id, &mut probe).err().unwrap(), "Chat avatar is not a portable local image");
    assert_eq!(serde_json::to_value(probe.outcome(Command::Export, false)).unwrap(), json!({
        "source":"native", "command":"export", "phase":"failed", "reason":"avatar_unrecognized",
        "avatar":{"representation":"absolute_dev_asset", "query_present":true,"known_bundled_filename":true}
    }));
}

fn database() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    conn.execute_batch("PRAGMA foreign_keys = ON;
        CREATE TABLE conversations (id TEXT PRIMARY KEY, title TEXT, character_id TEXT,
            mode TEXT, created_at TEXT, updated_at TEXT, is_pinned INTEGER, cloned_from_id TEXT,
            cloned_from_title TEXT, folder_id TEXT, sort_order INTEGER, role_snapshot TEXT,
            character_snapshot TEXT, summary_text TEXT, summary_last_message_id TEXT);
        CREATE TABLE messages (id TEXT PRIMARY KEY, conversation_id TEXT REFERENCES conversations(id),
            role TEXT, content TEXT, author TEXT, swipe_variants TEXT, swipe_index INTEGER,
            usage_variants TEXT, created_at TEXT);
        CREATE TABLE world_infos (id TEXT PRIMARY KEY, name TEXT, description TEXT, entries TEXT, created_at TEXT);
        CREATE TABLE settings (key TEXT, value TEXT);
        INSERT INTO settings VALUES ('api_key', 'MUST NOT EXPORT');
        CREATE TRIGGER activity AFTER INSERT ON messages BEGIN
            UPDATE conversations SET updated_at = '2026-10-07T10:00:00Z' WHERE id = NEW.conversation_id;
        END;").unwrap();
    crate::database::group_chats::migrate(&conn).unwrap();
    conn
}

fn fixture() -> Value {
    let mut avatar = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgba8(1, 1)
        .write_to(&mut avatar, image::ImageFormat::Png)
        .unwrap();
    let avatar = format!(
        "data:image/png;base64,{}",
        STANDARD.encode(avatar.into_inner())
    );
    let mut messages: Vec<Value> = (0..80)
        .map(|i| {
            let content = format!("Turn {i}: 雨 🌧️\nA long conversation.");
            json!({"id": format!("m{i}"), "role": if i % 2 == 0 { "user" } else { "assistant" },
            "content": content, "author": null, "swipe_variants": [content], "swipe_index": 0,
            "usage_variants": [], "created_at": "2026-01-01T10:00:00.000Z"})
        })
        .collect();
    messages[21]["swipe_variants"] = json!(["First reply", "Selected reply", "Third reply"]);
    messages[21]["content"] = json!("Selected reply");
    messages[21]["swipe_index"] = json!(1);
    messages[21]["usage_variants"] = json!([null, {"inputTokens": 8400, "outputTokens": 300,
        "reasoningTokens": 100, "costUsd": 0.03, "actualModel": "model", "serviceTier": "flex"}, null]);
    // Legacy greetings have no swipe array; this persisted representation remains valid.
    messages[0]["swipe_variants"] = json!([]);
    json!({"schema": "ryokan.chat", "version": 1,
        "conversation": {"title": "Long rainy chat", "mode": "singleplayer",
            "created_at": "2026-01-01T09:00:00.000Z", "updated_at": "2026-01-01T11:00:00.000Z",
            "is_pinned": true, "cloned_from_title": "Original branch",
            "character": {"id": "card", "name": "Rain", "prompt": "Chat-local edited prompt",
                "greeting": "Hello", "initials": "RA", "color": "blue", "avatarUrl": avatar,
                "world_info_ids": ["lore", "deleted-lore", "lore"]},
            "role": {"name": "Traveller", "prompt": "Chat-local persona"},
            "summary": {"text": "They reached the inn.\nIt was raining.", "last_message_id": "m41"}},
        "messages": messages,
        "world_infos": [{"id": "lore", "name": "Inn", "description": "Linked lore only",
            "created_at": "2025-01-01T00:00:00Z",
            "entries": [{"id": "entry", "keys": ["inn"], "content": "The inn closes at midnight.",
                "enabled": true, "comment": "", "position": "before", "constant": true,
                "priority": 8, "secondary_keys": ["rain"], "selective": true,
                "extensions": {"localNote": "preserved"}}]}]})
}

// Compare history state, resolving remapped identities by their relationships.
// Local conversation pinning and creation/activity dates reset on import.
fn semantics(file: ChatFile) -> Value {
    let mut value = serde_json::to_value(file).unwrap();
    for field in ["created_at", "updated_at", "is_pinned"] {
        value["conversation"].as_object_mut().unwrap().remove(field);
    }
    let boundary = value["conversation"]["summary"]["last_message_id"]
        .as_str()
        .map(str::to_owned);
    let index = value["messages"]
        .as_array()
        .unwrap()
        .iter()
        .position(|m| m["id"].as_str() == boundary.as_deref());
    value["conversation"]["summary"]["last_message_id"] = json!(index);
    for message in value["messages"].as_array_mut().unwrap() {
        message.as_object_mut().unwrap().remove("id");
    }
    let lore: HashMap<String, String> = value["world_infos"]
        .as_array()
        .unwrap()
        .iter()
        .map(|w| {
            (
                w["id"].as_str().unwrap().to_string(),
                w["name"].as_str().unwrap().to_string(),
            )
        })
        .collect();
    if let Some(character) = value["conversation"]["character"].as_object_mut() {
        character.remove("id");
        for id in character["world_info_ids"].as_array_mut().unwrap() {
            *id = json!(lore
                .get(id.as_str().unwrap())
                .map(String::as_str)
                .unwrap_or("<missing>"));
        }
    }
    for world in value["world_infos"].as_array_mut().unwrap() {
        world.as_object_mut().unwrap().remove("id");
    }
    value
}

#[test]
fn long_chat_round_trip_preserves_swipes_summary_snapshots_lore_usage_and_timestamps() {
    let mut conn = database();
    let file = parse_file(&conn, &fixture().to_string()).unwrap();
    let expected = semantics(parse_file(&conn, &fixture().to_string()).unwrap());
    let original = import_row(&mut conn, file).unwrap();
    // An unrelated lorebook and settings never become part of the export.
    conn.execute(
        "INSERT INTO world_infos VALUES ('unrelated', 'PRIVATE', '', '[]', '2026-01-01')",
        [],
    )
    .unwrap();
    let exported = serde_json::to_string(&export_row(&conn, &original).unwrap()).unwrap();
    assert!(!exported.contains("MUST NOT EXPORT"));
    assert!(!exported.contains("PRIVATE"));
    let imported_file = parse_file(&conn, &exported).unwrap();
    let copy = import_row(&mut conn, imported_file).unwrap();
    assert_ne!(original, copy);
    assert_eq!(semantics(export_row(&conn, &copy).unwrap()), expected);
    assert_eq!(semantics(export_row(&conn, &original).unwrap()), expected);
    let overlap: i64 = conn
        .query_row(
            "SELECT count(*) FROM messages a JOIN messages b ON a.id = b.id
        WHERE a.conversation_id = ?1 AND b.conversation_id = ?2",
            params![original, copy],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(overlap, 0);
    let (boundary, folder, origin): (String, Option<String>, Option<String>) = conn.query_row(
        "SELECT summary_last_message_id, folder_id, cloned_from_id FROM conversations WHERE id = ?1",
        [&copy], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap();
    let content: String = conn
        .query_row(
            "SELECT content FROM messages WHERE id = ?1 AND conversation_id = ?2",
            params![boundary, copy],
            |r| r.get(0),
        )
        .unwrap();
    assert!(content.starts_with("Turn 41"));
    assert_eq!(folder, None);
    assert_eq!(origin, None);
}

#[test]
fn rejects_invalid_versions_incomplete_data_and_broken_relationships_without_writes() {
    let conn = database();
    assert!(parse_file(&conn, "{").is_err());
    for mutation in [
        |v: &mut Value| v["version"] = json!(2),
        |v: &mut Value| v["version"] = json!(0),
        |v: &mut Value| v["schema"] = json!("other"),
        |v: &mut Value| {
            v.as_object_mut().unwrap().remove("messages");
        },
        |v: &mut Value| {
            v["conversation"]
                .as_object_mut()
                .unwrap()
                .remove("character");
        },
        |v: &mut Value| v["conversation"]["mode"] = json!("multiplayer"),
        |v: &mut Value| v["conversation"]["summary"]["last_message_id"] = json!("missing"),
        |v: &mut Value| v["conversation"]["summary"]["text"] = Value::Null,
        |v: &mut Value| v["messages"][1]["id"] = json!("m0"),
        |v: &mut Value| v["messages"][21]["swipe_index"] = json!(3),
        |v: &mut Value| v["messages"][21]["content"] = json!("wrong swipe"),
        |v: &mut Value| v["messages"][21]["usage_variants"][1]["inputTokens"] = json!(-1),
        |v: &mut Value| v["messages"][1]["role"] = json!("system"),
        |v: &mut Value| v["messages"][1]["created_at"] = json!("invalid"),
        |v: &mut Value| v["messages"][1]["created_at"] = json!("2025-01-01T00:00:00Z"),
        |v: &mut Value| v["world_infos"][0]["id"] = json!("unlinked"),
        |v: &mut Value| v["world_infos"][0]["entries"][0]["enabled"] = json!("yes"),
        |v: &mut Value| v["conversation"]["character"]["avatarUrl"] = json!("https://remote/image"),
        |v: &mut Value| {
            v["conversation"]["character"]["avatarUrl"] = json!("data:image/png;base64,broken")
        },
        |v: &mut Value| {
            v["messages"][0].as_object_mut().unwrap().remove("author");
        },
    ] {
        let mut value = fixture();
        mutation(&mut value);
        assert!(
            parse_file(&conn, &value.to_string()).is_err(),
            "accepted {value}"
        );
    }
    assert!(parse_file(&conn, &" ".repeat(MAX_BYTES + 1)).is_err());
    let count: i64 = conn
        .query_row("SELECT count(*) FROM conversations", [], |r| r.get(0))
        .unwrap();
    assert_eq!(count, 0);
}

#[test]
fn imports_reset_local_metadata_but_keep_exported_history_and_source_chat_unchanged() {
    let mut conn = database();
    let file = parse_file(&conn, &fixture().to_string()).unwrap();
    let source = import_row(&mut conn, file).unwrap();
    conn.execute(
        "UPDATE conversations SET is_pinned = 1, created_at = '2026-01-01T09:00:00.000Z',
        updated_at = '2026-01-01T11:00:00.000Z' WHERE id = ?1",
        [&source],
    )
    .unwrap();
    conn.execute(
        "INSERT INTO conversations (id, mode, is_pinned, created_at, updated_at)
        VALUES ('existing', 'singleplayer', 0, '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')",
        [],
    )
    .unwrap();
    let exported = export_row(&conn, &source).unwrap();
    assert!(exported.conversation.is_pinned);
    assert_eq!(exported.conversation.created_at, "2026-01-01T09:00:00.000Z");
    assert_eq!(exported.conversation.updated_at, "2026-01-01T11:00:00.000Z");
    let original_json = serde_json::to_string(&exported).unwrap();
    let history = semantics(exported);
    // Both historical and future exported dates must be replaced by local time.
    for exported_time in ["2000-01-01T00:00:00Z", "2099-01-01T00:00:00Z"] {
        let mut value: Value = serde_json::from_str(&original_json).unwrap();
        value["conversation"]["created_at"] = json!(exported_time);
        value["conversation"]["updated_at"] = json!(exported_time);
        let file = parse_file(&conn, &value.to_string()).unwrap();
        let before: String = conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
                r.get(0)
            })
            .unwrap();
        let imported = import_row(&mut conn, file).unwrap();
        let after: String = conn
            .query_row("SELECT strftime('%Y-%m-%dT%H:%M:%fZ', 'now')", [], |r| {
                r.get(0)
            })
            .unwrap();
        assert_ne!(imported, source);
        let copy = export_row(&conn, &imported).unwrap();
        assert!(!copy.conversation.is_pinned);
        assert!(copy.conversation.created_at >= before && copy.conversation.created_at <= after);
        assert_eq!(copy.conversation.updated_at, copy.conversation.created_at);
        assert_eq!(semantics(copy), history);
        let first_unpinned: String = conn
            .query_row(
                "SELECT id FROM conversations WHERE mode = 'singleplayer'
            AND folder_id IS NULL AND is_pinned = 0 ORDER BY updated_at DESC, rowid DESC LIMIT 1",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(first_unpinned, imported);
        assert_eq!(
            serde_json::to_string(&export_row(&conn, &source).unwrap()).unwrap(),
            original_json
        );
    }
}

#[test]
fn empty_characterless_chat_and_additive_metadata_are_supported() {
    let mut conn = database();
    let mut value = fixture();
    value["conversation"]["character"] = Value::Null;
    value["conversation"]["role"] = Value::Null;
    value["conversation"]["summary"] = json!({"text": null, "last_message_id": null});
    value["messages"] = json!([]);
    value["world_infos"] = json!([]);
    value["producer_note"] = json!("Optional metadata from a newer producer");
    let file = parse_file(&conn, &value.to_string()).unwrap();
    let id = import_row(&mut conn, file).unwrap();
    let exported = export_row(&conn, &id).unwrap();
    assert!(exported.messages.is_empty());
    assert!(exported.conversation.character.is_none());
}

#[test]
fn failed_message_insert_rolls_back_chat_and_linked_lorebooks() {
    let mut conn = database();
    conn.execute_batch("CREATE TRIGGER reject_message BEFORE INSERT ON messages BEGIN SELECT RAISE(ABORT, 'test failure'); END;").unwrap();
    let file = parse_file(&conn, &fixture().to_string()).unwrap();
    assert!(import_row(&mut conn, file).is_err());
    for table in ["conversations", "messages", "world_infos"] {
        let count: i64 = conn
            .query_row(&format!("SELECT count(*) FROM {table}"), [], |r| r.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}

#[test]
fn bundled_character_asset_urls_export_as_portable_images_without_fetching_paths() {
    let mut conn = database();
    let file = parse_file(&conn, &fixture().to_string()).unwrap();
    let id = import_row(&mut conn, file).unwrap();
    let snapshot: String = conn
        .query_row(
            "SELECT character_snapshot FROM conversations WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    let mut snapshot: Value = serde_json::from_str(&snapshot).unwrap();
    snapshot["avatarUrl"] = json!("/_app/immutable/assets/lyvee.buildhash.webp");
    conn.execute(
        "UPDATE conversations SET character_snapshot = ?1 WHERE id = ?2",
        params![snapshot.to_string(), id],
    )
    .unwrap();
    let exported = export_row(&conn, &id).unwrap();
    let avatar = exported.conversation.character.unwrap().avatar_url.unwrap();
    assert_eq!(
        STANDARD
            .decode(avatar.strip_prefix("data:image/webp;base64,").unwrap())
            .unwrap(),
        include_bytes!("../../../src/lib/assets/avatars/lyvee.webp")
    );
    assert!(portable_avatar("https://remote/lyvee.webp").is_none());
    assert!(portable_avatar("/private/lyvee.webp").is_none());
    assert!(portable_avatar("/_app/immutable/assets/other.webp").is_none());
    assert!(portable_avatar("/_app/immutable/assets/klea.buildhash.webp").is_some());
}

#[test]
fn native_webview_bundled_avatar_urls_export_and_round_trip() {
    let mut conn = database();
    let file = parse_file(&conn, &fixture().to_string()).unwrap();
    let id = import_row(&mut conn, file).unwrap();
    let snapshot: String = conn.query_row(
        "SELECT character_snapshot FROM conversations WHERE id = ?1", [&id], |r| r.get(0)
    ).unwrap();
    let mut snapshot: Value = serde_json::from_str(&snapshot).unwrap();
    // Vite emits new URL("../assets/...", import.meta.url).href in production.
    for origin in ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"] {
        snapshot["avatarUrl"] = json!(format!("{origin}/_app/immutable/assets/lyvee.buildhash.webp"));
        conn.execute("UPDATE conversations SET character_snapshot = ?1 WHERE id = ?2",
            params![snapshot.to_string(), id]).unwrap();
        let exported = export_row(&conn, &id).unwrap();
        let json = serde_json::to_string(&exported).unwrap();
        let parsed = parse_file(&conn, &json).unwrap();
        assert_eq!(parsed.schema, SCHEMA);
        assert_eq!(parsed.version, 1);
        let avatar = parsed.conversation.character.as_ref().unwrap().avatar_url.as_ref().unwrap();
        assert_eq!(STANDARD.decode(avatar.strip_prefix("data:image/webp;base64,").unwrap()).unwrap(),
            include_bytes!("../../../src/lib/assets/avatars/lyvee.webp"));
        let imported_id = import_row(&mut conn, parsed).unwrap();
        let mut original = serde_json::to_value(exported).unwrap()["messages"].take();
        let mut reexported = serde_json::to_value(export_row(&conn, &imported_id).unwrap()).unwrap()["messages"].take();
        // Import intentionally creates fresh local identities.
        for messages in [&mut original, &mut reexported] {
            for message in messages.as_array_mut().unwrap() {
                message.as_object_mut().unwrap().remove("id");
            }
        }
        assert_eq!(reexported, original);
    }
    for url in [
        "https://remote/_app/immutable/assets/lyvee.buildhash.webp",
        "http://tauri.localhost.evil/_app/immutable/assets/lyvee.buildhash.webp",
        "http://tauri.localhost@evil/_app/immutable/assets/lyvee.buildhash.webp",
        "http://tauri.localhost/private/lyvee.buildhash.webp",
        "file:///_app/immutable/assets/lyvee.buildhash.webp",
    ] {
        assert!(portable_avatar(url).is_none());
    }
}
