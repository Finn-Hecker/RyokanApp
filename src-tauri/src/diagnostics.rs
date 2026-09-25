//! Local, content-free diagnostics. Never accept messages, errors, URLs or payloads.
//! Deliberately not a global log subscriber: dependency logs may contain secrets.
mod decisions;
use decisions::Decision;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::{
    collections::HashMap,
    fs::{self, File, OpenOptions},
    io::{self, Read, Write},
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Manager};

const DAY: u64 = 86_400;
const RETENTION: u64 = 7 * DAY;
const SEGMENT_BYTES: u64 = 1024 * 1024;
const SEGMENTS: usize = 48; // Hard cap: 48 MiB, including the active segment.
const EXPORT_SEGMENTS: usize = 2;
static LOGGER: Lazy<Mutex<Option<Store>>> = Lazy::new(|| Mutex::new(None));
static BUSY_DROPS: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Event {
    AppStarted,
    DatabaseReady,
    DatabaseFailed,
    ParametersLoadFailed,
    ParametersInvalid,
    StreamInvalid,
    StreamFailed,
    TransportFailed,
    ProviderFailed,
    GenerationStarted,
    AvatarFailed,
    TokenizerFailed,
    FrontendError,
    FrontendWarning,
    ContextDecision,
    DecisionsThrottled,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq, Hash)]
#[serde(rename_all = "snake_case")]
pub enum Area {
    Runtime,
    Settings,
    Chat,
    Character,
    Role,
    WorldInfo,
    Editor,
    Sidebar,
    Multiplayer,
    Summary,
}

impl Event {
    fn level(self) -> &'static str {
        match self {
            Self::AppStarted
            | Self::DatabaseReady
            | Self::GenerationStarted
            | Self::ContextDecision => "info",
            Self::DatabaseFailed
            | Self::TransportFailed
            | Self::ProviderFailed
            | Self::FrontendError => "error",
            _ => "warn",
        }
    }
}

// Strictly re-parse stored records on export; never copy arbitrary disk text.
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Record {
    timestamp: u64,
    event: Event,
    area: Area,
    #[serde(default)]
    session: u32,
    #[serde(default)]
    sequence: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    decision: Option<Decision>,
}

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum Provider {
    Openrouter,
    LmStudio,
    LlamaCpp,
    Koboldcpp,
    Ollama,
    Openai,
    Xai,
    GenericOpenai,
    Unknown,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Metadata {
    provider: Provider,
    model_configured: bool,
    // Model IDs may be private local paths or user-assigned names. Do not export them.
    summary_enabled: bool,
}

struct Segment {
    path: PathBuf,
    modified: u64,
    modified_at: SystemTime,
    len: u64,
}
struct Store {
    dir: PathBuf,
    _lock: File, // OS lock releases on exit/crash; second instances fail closed.
    last: HashMap<(Event, Area), u64>,
    write_failed: bool,
    session: u32,
    sequence: u64,
    decision_window: u64,
    decision_count: u32,
}

fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

impl Store {
    fn open(dir: PathBuf) -> io::Result<Self> {
        fs::create_dir_all(&dir)?;
        let lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .write(true)
            .open(dir.join("writer.lock"))?;
        lock.try_lock().map_err(io::Error::other)?;
        let store = Self {
            dir,
            _lock: lock,
            last: HashMap::new(),
            write_failed: false,
            session: uuid::Uuid::new_v4().as_u128() as u32,
            sequence: 0,
            decision_window: 0,
            decision_count: 0,
        };
        store.prune(now())?;
        Ok(store)
    }

    fn path(&self, slot: usize) -> PathBuf {
        self.dir.join(format!("events-{slot:02}.jsonl"))
    }

    fn prune(&self, time: u64) -> io::Result<Vec<Segment>> {
        let mut files = Vec::new();
        for slot in 0..SEGMENTS {
            let path = self.path(slot);
            let meta = match fs::symlink_metadata(&path) {
                Ok(meta) => meta,
                Err(e) if e.kind() == io::ErrorKind::NotFound => continue,
                Err(e) => return Err(e),
            };
            // Never follow externally substituted links or export unrelated files.
            if !meta.is_file() || meta.file_type().is_symlink() {
                return Err(io::Error::other("Invalid log file"));
            }
            let modified_at = meta.modified()?;
            let modified = modified_at
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs();
            if time.saturating_sub(modified) >= RETENTION
                || modified > time
                || meta.len() > SEGMENT_BYTES
            {
                fs::remove_file(path)?;
            } else {
                files.push(Segment {
                    path,
                    modified,
                    modified_at,
                    len: meta.len(),
                });
            }
        }
        files.sort_by(|a, b| (a.modified_at, &a.path).cmp(&(b.modified_at, &b.path)));
        Ok(files)
    }

    fn write(&mut self, event: Event, area: Area, time: u64) -> io::Result<()> {
        // At most one occurrence of an event per area per minute, including hot loops.
        if self
            .last
            .get(&(event, area))
            .is_some_and(|last| time >= *last && time - last < 60)
        {
            return Ok(());
        }
        self.last.insert((event, area), time);
        let result = self.append(event, area, time, None);
        self.write_failed = result.is_err();
        result
    }

    fn append(
        &mut self,
        event: Event,
        area: Area,
        time: u64,
        decision: Option<Decision>,
    ) -> io::Result<()> {
        self.sequence += 1;
        let mut bytes = serde_json::to_vec(&Record {
            timestamp: time,
            event,
            area,
            session: self.session,
            sequence: self.sequence,
            decision,
        })?;
        bytes.push(b'\n');
        let files = self.prune(time)?;
        let active = files.last().filter(|file| {
            file.modified / DAY == time / DAY && file.len + bytes.len() as u64 <= SEGMENT_BYTES
        });
        let path = if let Some(file) = active {
            file.path.clone()
        } else {
            let unused = (0..SEGMENTS)
                .map(|slot| self.path(slot))
                .find(|path| !files.iter().any(|file| &file.path == path));
            match unused {
                Some(path) => path,
                None => {
                    let oldest = &files[0].path;
                    fs::remove_file(oldest)?;
                    oldest.clone()
                }
            }
        };
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(path)?
            .write_all(&bytes)
    }

    fn decision(&mut self, decision: Decision, time: u64) -> io::Result<()> {
        if self.decision_window != time / 60 {
            self.decision_window = time / 60;
            self.decision_count = 0;
        }
        self.decision_count = self.decision_count.saturating_add(1);
        // Preserve normal transitions, but bound accidental loops/IPC floods.
        if self.decision_count == 601 {
            return self.append(Event::DecisionsThrottled, Area::Summary, time, None);
        }
        if self.decision_count > 600 {
            return Ok(());
        }
        let result = self.append(Event::ContextDecision, Area::Summary, time, Some(decision));
        self.write_failed = result.is_err();
        result
    }

    fn recent(&self, time: u64) -> io::Result<Vec<serde_json::Value>> {
        let files = self.prune(time)?;
        let mut records = Vec::new();
        for file in files.iter().rev().take(EXPORT_SEGMENTS).rev() {
            let mut bytes = Vec::new();
            File::open(&file.path)?
                .take(SEGMENT_BYTES)
                .read_to_end(&mut bytes)?;
            for line in bytes.split(|byte| *byte == b'\n') {
                if let Ok(record) = serde_json::from_slice::<Record>(line) {
                    if record.timestamp <= time && time - record.timestamp < RETENTION {
                        records.push(serde_json::json!({ "timestamp": record.timestamp, "level": record.event.level(), "event": record.event, "area": record.area, "session": record.session, "sequence": record.sequence, "decision": record.decision }));
                    }
                }
            }
        }
        records.sort_by_key(|record| record["timestamp"].as_u64().unwrap_or_default());
        Ok(records)
    }
}

pub fn init(app: &AppHandle) {
    if let Ok(dir) = app.path().app_log_dir() {
        *LOGGER.lock() = Store::open(dir.join("diagnostics")).ok();
    }
    record(Event::AppStarted);
    // Expire old logs even during an otherwise idle long-running session.
    let _ = std::thread::Builder::new()
        .name("diagnostics-retention".into())
        .spawn(|| loop {
            std::thread::sleep(Duration::from_secs(3600));
            if let Some(store) = LOGGER.lock().as_mut() {
                if store.prune(now()).is_err() {
                    store.write_failed = true;
                }
            }
        });
}

pub fn record(event: Event) {
    record_in(event, Area::Runtime);
}
fn record_in(event: Event, area: Area) {
    // Logging must not block generation behind an export, or propagate I/O failures.
    if let Some(mut guard) = LOGGER.try_lock() {
        if let Some(store) = guard.as_mut() {
            let _ = store.write(event, area, now());
        }
    }
}

#[tauri::command]
pub fn record_frontend_event(area: Area, warning: bool) {
    record_in(
        if warning {
            Event::FrontendWarning
        } else {
            Event::FrontendError
        },
        area,
    );
}

#[tauri::command]
pub fn record_diagnostic_decision(decision: Decision) {
    if let Some(mut guard) = LOGGER.try_lock() {
        if let Some(store) = guard.as_mut() {
            let _ = store.decision(decision, now());
        }
    } else {
        BUSY_DROPS.fetch_add(1, Ordering::Relaxed);
    }
}

#[tauri::command]
pub async fn export_diagnostics(app: AppHandle, metadata: Metadata) -> Result<String, String> {
    let version = app.package_info().version.to_string();
    tauri::async_runtime::spawn_blocking(move || {
        let time = now();
        let guard = LOGGER.lock();
        let recent = guard.as_ref().map(|store| store.recent(time));
        let available = matches!(recent, Some(Ok(_)));
        let logs = recent.and_then(Result::ok).unwrap_or_default();
        serde_json::to_string_pretty(&serde_json::json!({
            "schemaVersion": 2, "ryokanVersion": version, "exportedAt": time,
            "os": std::env::consts::OS, "architecture": std::env::consts::ARCH,
            "runtime": { "tauri": 2, "debugBuild": cfg!(debug_assertions) },
            "metadata": metadata, "logsAvailable": available,
            "loggingDegraded": guard.as_ref().is_none_or(|store| store.write_failed) || !available,
            "retentionDays": 7, "maxLogBytes": SEGMENT_BYTES * SEGMENTS as u64,
            "exportSourceLimitBytes": SEGMENT_BYTES * EXPORT_SEGMENTS as u64,
            "rateLimitSeconds": 60, "decisionLimitPerMinute": 600,
            "busyDecisionDropsThisSession": BUSY_DROPS.load(Ordering::Relaxed), "logs": logs,
        }))
        .map_err(|_| "Diagnostics export failed".to_string())
    })
    .await
    .map_err(|_| "Diagnostics export failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    struct Temp(PathBuf);
    impl Temp {
        fn new() -> Self {
            Self(std::env::temp_dir().join(format!("ryokan-diagnostics-{}", uuid::Uuid::new_v4())))
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn privacy_rejects_free_text_and_extra_fields() {
        for secret in [
            "sk-private-key",
            "Authorization: Bearer secret",
            "private prompt",
            "chat",
            "summary",
            "character",
            "role",
            "lorebook",
            "encryption key",
            "C:/Users/Private/model",
        ] {
            assert!(serde_json::from_value::<Record>(
                serde_json::json!({"timestamp": 1, "event": secret, "area": "runtime"})
            )
            .is_err());
            assert!(serde_json::from_value::<Record>(serde_json::json!({"timestamp": 1, "event": "app_started", "area": "runtime", "message": secret})).is_err());
            assert!(serde_json::from_value::<Metadata>(serde_json::json!({"provider": secret, "modelConfigured": true, "summaryEnabled": true})).is_err());
        }
        assert!(serde_json::from_value::<Metadata>(serde_json::json!({"provider":"openai", "modelConfigured":true,"summaryEnabled":false,"apiKey":"secret"})).is_err());
    }

    #[test]
    fn export_filters_corrupt_private_and_expired_records() {
        let temp = Temp::new();
        let mut store = Store::open(temp.0.clone()).unwrap();
        let time = now();
        store.write(Event::AppStarted, Area::Runtime, time).unwrap();
        let mut file = OpenOptions::new().append(true).open(store.path(0)).unwrap();
        writeln!(file, "private prompt\n{{\"timestamp\":{time},\"event\":\"app_started\",\"area\":\"runtime\",\"apiKey\":\"secret\"}}").unwrap();
        writeln!(
            file,
            "{}",
            serde_json::to_string(&Record {
                timestamp: time - RETENTION,
                event: Event::ProviderFailed,
                area: Area::Runtime,
                session: 0,
                sequence: 0,
                decision: None,
            })
            .unwrap()
        )
        .unwrap();
        let logs = store.recent(time).unwrap();
        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0]["level"], "info");
    }

    #[test]
    fn rotation_retention_size_and_rate_limit() {
        let temp = Temp::new();
        let mut store = Store::open(temp.0.clone()).unwrap();
        let time = now();
        store.write(Event::AppStarted, Area::Runtime, time).unwrap();
        store
            .write(Event::AppStarted, Area::Runtime, time + 1)
            .unwrap();
        assert_eq!(store.recent(time + 1).unwrap().len(), 1);
        for slot in 0..SEGMENTS {
            File::create(store.path(slot))
                .unwrap()
                .set_len(SEGMENT_BYTES)
                .unwrap();
        }
        store
            .write(Event::ProviderFailed, Area::Runtime, time)
            .unwrap();
        let files = store.prune(time + 1).unwrap();
        assert_eq!(files.len(), SEGMENTS);
        assert!(files.iter().map(|f| f.len).sum::<u64>() <= SEGMENT_BYTES * SEGMENTS as u64);
        assert!(store.prune(time + RETENTION + 2).unwrap().is_empty());
    }

    #[test]
    fn export_is_bounded_to_recent_segments_and_rejects_oversized_files() {
        let temp = Temp::new();
        let store = Store::open(temp.0.clone()).unwrap();
        let time = now();
        for slot in 0..3 {
            let timestamp = time - 10 + slot as u64;
            let mut file = File::create(store.path(slot)).unwrap();
            writeln!(
                file,
                "{}",
                serde_json::to_string(&Record {
                    timestamp,
                    event: Event::AppStarted,
                    area: Area::Runtime,
                    session: 0,
                    sequence: 0,
                    decision: None,
                })
                .unwrap()
            )
            .unwrap();
            file.set_modified(UNIX_EPOCH + Duration::from_secs(timestamp))
                .unwrap();
        }
        let logs = store.recent(time).unwrap();
        assert_eq!(logs.len(), EXPORT_SEGMENTS);
        assert_eq!(logs[0]["timestamp"], time - 9);
        assert_eq!(logs[1]["timestamp"], time - 8);
        File::create(store.path(3))
            .unwrap()
            .set_len(SEGMENT_BYTES + 1)
            .unwrap();
        store.prune(time).unwrap();
        assert!(!store.path(3).exists());
    }

    #[test]
    fn rapid_decisions_preserve_accounting_and_expose_flood_throttling() {
        let temp = Temp::new();
        let mut store = Store::open(temp.0.clone()).unwrap();
        let time = now() + 1;
        for request in 1..=605 {
            let decision = serde_json::from_value::<Decision>(serde_json::json!({
                "kind":"usage","operation":1,"request":request,"connection":2,"purpose":"chat",
                "local_input_tokens":800,"input_tokens":1000,"cached_input_tokens":750,
                "output_tokens":100,"reasoning_tokens":40,"reserve_tokens":1024,
            }))
            .unwrap();
            store.decision(decision, time).unwrap();
        }
        let logs = store.recent(time).unwrap();
        assert_eq!(logs.len(), 601);
        assert_eq!(logs[599]["decision"]["request"], 600);
        assert_eq!(logs[599]["decision"]["cached_input_tokens"], 750);
        assert_eq!(logs[600]["event"], "decisions_throttled");
        assert_eq!(logs[600]["sequence"], 601);
        assert_eq!(logs[0]["session"], logs[600]["session"]);
    }

    #[test]
    fn daily_rotation_and_exclusive_writer_and_io_failure() {
        let temp = Temp::new();
        let mut store = Store::open(temp.0.clone()).unwrap();
        let time = now();
        assert!(Store::open(temp.0.clone()).is_err());
        store.write(Event::AppStarted, Area::Runtime, time).unwrap();
        File::options()
            .write(true)
            .open(store.path(0))
            .unwrap()
            .set_modified(UNIX_EPOCH + Duration::from_secs(time - DAY))
            .unwrap();
        store
            .write(Event::DatabaseReady, Area::Runtime, time)
            .unwrap();
        assert_eq!(store.prune(time).unwrap().len(), 2);
        fs::remove_file(store.path(1)).unwrap();
        fs::create_dir(store.path(1)).unwrap();
        assert!(store
            .write(Event::DatabaseFailed, Area::Runtime, time)
            .is_err());
        assert!(store.write_failed);
    }
}
