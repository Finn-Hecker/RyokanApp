//! Closed diagnostic vocabulary. No application values or raw errors are retained.
use serde::{Deserialize, Serialize};

macro_rules! codes {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    };
}

codes!(FrontendStage { Prepare, SnapshotIpc, ExportIpc });
codes!(Phase { Entered, Completed, Failed });
codes!(Command { Snapshot, Export });
codes!(Reason {
    Unexpected, Connection, Transaction,
    SnapshotRead, SnapshotJson, SnapshotResolveCharacter, SnapshotWrite, SnapshotCommit,
    ConversationRead, CharacterIdRead, CharacterSnapshotMissing, CharacterSnapshotShape,
    AvatarUnrecognized, RoleSnapshotShape,
    MessageQuery, MessageRead, MessageSwipeIndexRead, SwipesJson, UsageJson,
    LorebookRead, LorebookJson,
    SchemaVersion, ConversationMode, ConversationCreatedAt, ConversationUpdatedAt,
    MessageIdEmpty, MessageIdDuplicate, MessageRole, MessageCreatedAt, MessageOrder,
    EmptySwipesIndex, SwipeContentMismatch, UsageLength, UsageCost,
    SummaryBoundary, LorebookIdEmpty, LorebookIdDuplicate, LorebookCreatedAt,
    LoreEntryIdEmpty, LoreEntryIdDuplicate, LoreEntryPosition, LorebookUnlinked,
    CharacterIdEmpty, CharacterNameEmpty,
    AvatarEncoding, AvatarBase64, AvatarImage, AvatarFormat, AvatarMime,
    Serialization, OutputLimit
});
codes!(AvatarRepresentation {
    RelativeSourceAsset, RelativeProductionAsset, ProductionAppAsset,
    AbsoluteDevAsset, FilesystemAsset, DataImage, Other
});

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
pub struct AvatarClassification {
    representation: AvatarRepresentation,
    query_present: bool,
    known_bundled_filename: bool,
}

/// Classification never authorizes a URL or reads/fetches its target.
pub fn classify_avatar(value: &str) -> AvatarClassification {
    use AvatarRepresentation::*;
    let production_path = ["http://tauri.localhost", "https://tauri.localhost", "tauri://localhost"]
        .iter()
        .find_map(|origin| value.strip_prefix(origin).filter(|path| path.starts_with('/')));
    let is_asset = |path: &str| path.starts_with("/src/lib/assets/avatars/")
        || path.starts_with("/_app/immutable/assets/");
    let representation = if value.starts_with("data:image/") {
        DataImage
    } else if value.starts_with("/@fs/") || value.starts_with("file:") {
        FilesystemAsset
    } else if production_path.is_some_and(is_asset) {
        ProductionAppAsset
    } else if value.starts_with("/src/lib/assets/avatars/") {
        RelativeSourceAsset
    } else if value.starts_with("/_app/immutable/assets/") || value.starts_with("./_app/immutable/assets/") {
        RelativeProductionAsset
    } else if tauri::Url::parse(value).ok().is_some_and(|url| {
        matches!(url.scheme(), "http" | "https") && url.port() == Some(1420) && is_asset(url.path())
    }) {
        AbsoluteDevAsset
    } else {
        Other
    };
    let path = value.split(['?', '#']).next().unwrap_or("");
    let filename = path.rsplit('/').next().unwrap_or("");
    AvatarClassification {
        representation,
        query_present: value.contains('?'),
        known_bundled_filename: (filename.starts_with("lyvee.") || filename.starts_with("klea."))
            && filename.ends_with(".webp"),
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize)]
#[serde(tag = "source", rename_all = "snake_case", deny_unknown_fields)]
pub enum Trace {
    Frontend { stage: FrontendStage, phase: Phase },
    Native {
        command: Command,
        phase: Phase,
        reason: Option<Reason>,
        avatar: Option<AvatarClassification>,
    },
    Throttled,
}

// Export-specific records deliberately contain no timestamps or identifiers.
codes!(RecordKind { ChatExport });
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub(super) struct Record {
    event: RecordKind,
    chat_export: Trace,
}

impl Record {
    pub(super) fn new(trace: Trace) -> Self {
        Self { event: RecordKind::ChatExport, chat_export: trace }
    }
}

pub fn record(trace: Trace) {
    if let Some(mut guard) = super::LOGGER.try_lock() {
        if let Some(store) = guard.store.as_mut() {
            let _ = store.chat_export(trace, super::now());
        }
    } else {
        super::BUSY_DROPS.fetch_add(1, std::sync::atomic::Ordering::Relaxed);
    }
}

#[tauri::command]
pub fn record_chat_export_frontend(stage: FrontendStage, phase: Phase) {
    record(Trace::Frontend { stage, phase });
}

#[derive(Default)]
pub(crate) struct Probe {
    reason: Option<Reason>,
    avatar: Option<AvatarClassification>,
}

impl Probe {
    #[cfg(test)]
    pub fn failure_reason(&self) -> Option<Reason> { self.reason }

    pub fn entered(command: Command) -> Self {
        record(Trace::Native { command, phase: Phase::Entered, reason: None, avatar: None });
        Self::default()
    }

    /// Preserve the original command error; only the fixed reason is retained.
    pub fn error(&mut self, reason: Reason, error: String) -> String {
        self.reason = Some(reason);
        error
    }

    pub fn avatar_error(&mut self, reason: Reason, value: &str, error: String) -> String {
        self.avatar = Some(classify_avatar(value));
        self.error(reason, error)
    }

    pub fn finished(&self, command: Command, success: bool) {
        record(self.outcome(command, success));
    }

    pub fn outcome(&self, command: Command, success: bool) -> Trace {
        Trace::Native {
            command,
            phase: if success { Phase::Completed } else { Phase::Failed },
            reason: if success { None } else { Some(self.reason.unwrap_or(Reason::Unexpected)) },
            avatar: if success { None } else { self.avatar },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn avatar_classes_retain_only_categories_and_flags() {
        use AvatarRepresentation::*;
        for (value, expected, query, known) in [
            ("/src/lib/assets/avatars/lyvee.webp", RelativeSourceAsset, false, true),
            ("/src/lib/assets/avatars/klea.webp?t=private", RelativeSourceAsset, true, true),
            ("./_app/immutable/assets/lyvee.hash.webp", RelativeProductionAsset, false, true),
            ("http://tauri.localhost/_app/immutable/assets/lyvee.hash.webp", ProductionAppAsset, false, true),
            ("http://192.0.2.1:1420/src/lib/assets/avatars/lyvee.webp", AbsoluteDevAsset, false, true),
            ("http://localhost:1420/src/lib/assets/avatars/klea.webp", AbsoluteDevAsset, false, true),
            ("/@fs/C:/private/lyvee.webp", FilesystemAsset, false, true),
            ("data:image/png;base64,PRIVATE", DataImage, false, false),
            ("https://tauri.localhost.evil/_app/immutable/assets/lyvee.hash.webp", Other, false, true),
            ("blob:PRIVATE", Other, false, false),
        ] {
            assert_eq!(classify_avatar(value), AvatarClassification {
                representation: expected, query_present: query, known_bundled_filename: known,
            });
        }
        let encoded = serde_json::to_value(classify_avatar("http://192.0.2.1:1420/src/lib/assets/avatars/lyvee.webp?t=PRIVATE")).unwrap();
        assert_eq!(encoded, json!({"representation":"absolute_dev_asset","query_present":true,"known_bundled_filename":true}));
    }

    #[test]
    fn schema_rejects_arbitrary_data_at_every_depth() {
        let base = json!({"event":"chat_export","chat_export":{"source":"native","command":"export",
            "phase":"failed","reason":"avatar_unrecognized","avatar":{"representation":"other",
            "query_present":false,"known_bundled_filename":false}}});
        assert!(serde_json::from_value::<Record>(base.clone()).is_ok());
        for path in ["", "/chat_export", "/chat_export/avatar"] {
            for key in ["error", "url", "host", "path", "id", "timestamp", "content", "json"] {
                let mut contaminated = base.clone();
                contaminated.pointer_mut(path).unwrap().as_object_mut().unwrap().insert(key.into(), json!("PRIVATE"));
                assert!(serde_json::from_value::<Record>(contaminated).is_err());
            }
        }
        for path in ["/chat_export/command", "/chat_export/phase", "/chat_export/reason", "/chat_export/avatar/representation"] {
            let mut contaminated = base.clone();
            *contaminated.pointer_mut(path).unwrap() = json!("PRIVATE");
            assert!(serde_json::from_value::<Record>(contaminated).is_err());
        }
    }
}
