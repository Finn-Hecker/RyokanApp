use crate::database::get_connection;
use eventsource_stream::Eventsource;
use futures::stream::StreamExt;
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;
use tauri::{Emitter, Manager, Window};
use tokio_util::sync::CancellationToken;

const ADDITIONAL_API_PARAMETERS_SETTING: &str = "api_additional_parameters";
const PROTECTED_API_PARAMETER_KEYS: [&str; 3] = ["messages", "model", "stream"];

// Reusing a single HTTP client across the entire app lifecycle prevents connection
// exhaustion and takes advantage of internal connection pooling.
// connect_timeout only bounds how long we wait to establish the TCP/TLS connection -
// it does NOT bound the overall response time, so long-running generations are unaffected.
pub static CLIENT: Lazy<reqwest::Client> = Lazy::new(|| {
    reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .build()
        .expect("failed to build reqwest client")
});

// parking_lot::Mutex instead of std::sync::Mutex: no poisoning, so a panic on some
// other thread while holding the lock can never propagate into this one via an
// unwrap(), and lock() returns the guard directly (no Result to unwrap).
struct ActiveCancellation {
    request_id: u64,
    generation_id: Option<String>,
    token: CancellationToken,
}

static ACTIVE_CANCELLATION: Lazy<Mutex<Option<ActiveCancellation>>> =
    Lazy::new(|| Mutex::new(None));
static NEXT_REQUEST_ID: AtomicU64 = AtomicU64::new(1);

struct ActiveCancellationGuard {
    request_id: u64,
}

impl Drop for ActiveCancellationGuard {
    fn drop(&mut self) {
        let mut active = ACTIVE_CANCELLATION.lock();
        if active.as_ref().map(|entry| entry.request_id) == Some(self.request_id) {
            *active = None;
        }
    }
}

fn cancellation_matches(active_id: &Option<String>, requested_id: &Option<String>) -> bool {
    requested_id.is_none() || active_id == requested_id
}

#[derive(Debug, Clone, Copy)]
struct ApiParameterFlags {
    temperature: bool,
    max_tokens: bool,
    presence_penalty: bool,
    thinking_budget: bool,
    top_p: bool,
    top_k: bool,
    min_p: bool,
    frequency_penalty: bool,
}

impl Default for ApiParameterFlags {
    fn default() -> Self {
        Self {
            temperature: false,
            max_tokens: false,
            presence_penalty: false,
            thinking_budget: false,
            top_p: false,
            top_k: false,
            min_p: false,
            frequency_penalty: false,
        }
    }
}

/// Reads the persisted per-parameter switches. Missing keys default to disabled so
/// generation parameters stay opt-in, matching the settings UI.
fn load_api_parameter_flags(window: &Window) -> ApiParameterFlags {
    let mut flags = ApiParameterFlags::default();

    let Ok(conn) = get_connection(window.app_handle()) else {
        return flags;
    };

    let mut stmt =
        match conn.prepare("SELECT key, value FROM settings WHERE key LIKE 'api_%_enabled'") {
            Ok(stmt) => stmt,
            Err(_) => return flags,
        };

    let rows = match stmt.query_map([], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
    }) {
        Ok(rows) => rows,
        Err(_) => return flags,
    };

    for row in rows.flatten() {
        let (key, value) = row;
        let enabled = value != "false";

        match key.as_str() {
            "api_temperature_enabled" => flags.temperature = enabled,
            "api_max_tokens_enabled" => flags.max_tokens = enabled,
            "api_presence_penalty_enabled" => flags.presence_penalty = enabled,
            "api_thinking_budget_enabled" => flags.thinking_budget = enabled,
            "api_top_p_enabled" => flags.top_p = enabled,
            "api_top_k_enabled" => flags.top_k = enabled,
            "api_min_p_enabled" => flags.min_p = enabled,
            "api_frequency_penalty_enabled" => flags.frequency_penalty = enabled,
            _ => {}
        }
    }

    flags
}

/// Parses a configured object without coercing any JSON values. Ryokan's core
/// protocol fields are rejected as a group so a conflict can never partially
/// apply or depend on merge order.
fn parse_additional_api_parameters(
    raw: &str,
) -> Result<serde_json::Map<String, serde_json::Value>, String> {
    if raw.trim().is_empty() {
        return Ok(serde_json::Map::new());
    }

    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|error| format!("invalid JSON: {error}"))?;
    let object = value
        .as_object()
        .ok_or_else(|| "the root value is not a JSON object".to_string())?;

    let conflicts: Vec<&str> = PROTECTED_API_PARAMETER_KEYS
        .iter()
        .copied()
        .filter(|key| object.contains_key(*key))
        .collect();
    if !conflicts.is_empty() {
        return Err(format!(
            "protected fields cannot be overridden: {}",
            conflicts.join(", ")
        ));
    }

    Ok(object.clone())
}

/// Reads custom request fields at generation time so every caller of the shared
/// OpenAI-compatible request command gets identical behavior.
fn load_additional_api_parameters(window: &Window) -> serde_json::Map<String, serde_json::Value> {
    let Ok(conn) = get_connection(window.app_handle()) else {
        return serde_json::Map::new();
    };

    let raw = match conn.query_row(
        "SELECT value FROM settings WHERE key = ?1",
        [ADDITIONAL_API_PARAMETERS_SETTING],
        |row| row.get::<_, String>(0),
    ) {
        Ok(value) => value,
        Err(rusqlite::Error::QueryReturnedNoRows) => return serde_json::Map::new(),
        Err(error) => {
            eprintln!("Failed to load additional API parameters: {error}");
            return serde_json::Map::new();
        }
    };

    match parse_additional_api_parameters(&raw) {
        Ok(parameters) => parameters,
        Err(error) => {
            // The settings UI prevents this state; this is a final safety net for
            // externally modified or legacy databases. Invalid values are omitted.
            eprintln!("Ignoring additional API parameters: {error}");
            serde_json::Map::new()
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EffectiveApiParameterConfig {
    max_tokens_enabled: bool,
    thinking_budget_enabled: bool,
    max_tokens: u32,
    thinking_budget: u32,
    additional_parameters: serde_json::Map<String, serde_json::Value>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RequestApiParameterConfig {
    max_tokens_enabled: bool,
    thinking_budget_enabled: bool,
    max_tokens: u32,
    thinking_budget: u32,
    additional_parameters: serde_json::Map<String, serde_json::Value>,
}

fn bind_request_parameter_config(
    parameter_flags: &mut ApiParameterFlags,
    forwarded_max_tokens: &mut Option<u32>,
    forwarded_thinking_budget: &mut Option<u32>,
    config: &RequestApiParameterConfig,
) {
    parameter_flags.max_tokens = config.max_tokens_enabled;
    parameter_flags.thinking_budget = config.thinking_budget_enabled;
    *forwarded_thinking_budget = Some(config.thinking_budget);
    *forwarded_max_tokens = Some(config.max_tokens.saturating_add(
        if config.thinking_budget_enabled {
            config.thinking_budget
        } else {
            0
        },
    ));
}

/// Binds the current numeric values to the same persisted switches and validated
/// custom fields that `call_ai_api` will use for this solo request.
#[tauri::command]
pub fn get_effective_api_parameter_config(
    window: Window,
    max_tokens: u32,
    thinking_budget: u32,
) -> EffectiveApiParameterConfig {
    let flags = load_api_parameter_flags(&window);
    EffectiveApiParameterConfig {
        max_tokens_enabled: flags.max_tokens,
        thinking_budget_enabled: flags.thinking_budget,
        max_tokens,
        thinking_budget,
        additional_parameters: load_additional_api_parameters(&window),
    }
}

fn merge_additional_api_parameters(
    body: &mut serde_json::Value,
    parameters: serde_json::Map<String, serde_json::Value>,
) {
    let Some(body) = body.as_object_mut() else {
        return;
    };
    // Power-user values intentionally win for non-protected keys. The parser
    // rejects protocol-critical conflicts before this deterministic merge.
    body.extend(parameters);
}

/// Called from the frontend to hard-stop the current stream.
/// Cancels the active token, which makes the running select! arm resolve to None
/// and drops the underlying TCP connection.
#[tauri::command]
pub fn stop_generation(generation_id: Option<String>) {
    let active = ACTIVE_CANCELLATION.lock();
    let Some(active) = active.as_ref() else {
        return;
    };

    // Calls without an id are the legacy singleplayer path and retain their
    // existing "stop the current request" behaviour. Multiplayer supplies an
    // id so a late Stop from an older stream cannot cancel a newer request.
    if cancellation_matches(&active.generation_id, &generation_id) {
        active.token.cancel();
    }
}

/// OpenAI-compatible SSE (Server-Sent Events) streaming structs.
#[derive(Deserialize)]
struct StreamChunk {
    choices: Vec<Choice>,
}

#[derive(Deserialize)]
struct Choice {
    delta: Delta,
}

#[derive(Deserialize)]
struct Delta {
    content: Option<String>,
    reasoning_content: Option<String>,
}

/// Payload received from the frontend to initiate an AI generation request.
/// New fields carry a camelCase alias in addition to their snake_case name, since it's
/// unclear which casing convention the caller uses for them yet — existing fields are
/// left untouched to avoid breaking whatever already works.
#[derive(Deserialize)]
pub(crate) struct AiRequest {
    #[serde(alias = "generationId")]
    generation_id: Option<String>,
    #[serde(alias = "requestParameterConfig")]
    request_parameter_config: Option<RequestApiParameterConfig>,
    url: String,
    api_key: String,
    model: String,
    messages: Vec<serde_json::Value>,
    temperature: f32,
    max_tokens: Option<u32>,
    // NOTE: historically named `presence_penalty` but intentionally mapped below to the
    // JSON key "repetition_penalty" — that's the llama.cpp/koboldcpp sampler local models
    // (LM Studio included) actually understand and it's the more effective anti-repeat
    // knob for roleplay. Kept as-is to avoid breaking existing saved settings; true
    // OpenAI-style presence/frequency penalties are added separately below.
    presence_penalty: Option<f32>,

    // --- Additional roleplay-relevant sampling params ---
    #[serde(alias = "topP")]
    top_p: Option<f32>,
    #[serde(alias = "topK")]
    top_k: Option<u32>,
    #[serde(alias = "minP")]
    min_p: Option<f32>,
    #[serde(alias = "frequencyPenalty")]
    frequency_penalty: Option<f32>,

    // Token budget for the reasoning phase. Forwarded to llama.cpp's
    // `thinking_budget_tokens` request field. 0 = end reasoning immediately,
    // omitted/None = let the server default (usually unrestricted) apply.
    #[serde(alias = "thinkingBudget")]
    thinking_budget: Option<u32>,
}

/// Payload emitted back to the frontend containing the generated text.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TokenPayload {
    token: String,
    generation_id: Option<String>,
}

/// Payload emitted back to the frontend containing reasoning/"thinking" text.
#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct ThinkingTokenPayload {
    token: String,
    generation_id: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiApiError {
    kind: &'static str,
    message: String,
    status: Option<u16>,
    code: Option<String>,
    provider: Option<String>,
    model: Option<String>,
}

fn sanitize_api_error_message(
    message: &str,
    api_key: &str,
    messages: &[serde_json::Value],
) -> String {
    let mut safe = if api_key.is_empty() {
        message.to_string()
    } else {
        message.replace(api_key, "[redacted]")
    };
    for prompt in messages
        .iter()
        .filter_map(|message| message.get("content").and_then(|value| value.as_str()))
    {
        if !prompt.is_empty() {
            safe = safe.replace(prompt, "[prompt redacted]");
        }
    }
    for marker in ["authorization:", "authorization\"", "bearer "] {
        if let Some(index) = safe.to_ascii_lowercase().find(marker) {
            safe.truncate(index);
            safe.push_str("[redacted]");
        }
    }
    safe.chars()
        .take(1000)
        .collect::<String>()
        .trim()
        .to_string()
}

fn api_error_from_body(
    status: u16,
    body: &str,
    api_key: &str,
    model: &str,
    messages: &[serde_json::Value],
) -> String {
    let value = serde_json::from_str::<serde_json::Value>(body).unwrap_or_default();
    let error = value.get("error").unwrap_or(&value);
    let raw_message = error
        .get("message")
        .and_then(|v| v.as_str())
        .or_else(|| value.get("message").and_then(|v| v.as_str()))
        .unwrap_or_else(|| {
            if body.trim().is_empty() {
                "The API returned an error."
            } else {
                body.trim()
            }
        });
    let code = error
        .get("code")
        .or_else(|| value.get("code"))
        .and_then(|v| {
            v.as_str()
                .map(String::from)
                .or_else(|| v.as_i64().map(|n| n.to_string()))
        });
    let provider = error
        .pointer("/metadata/provider_name")
        .and_then(|v| v.as_str())
        .or_else(|| error.pointer("/metadata/provider").and_then(|v| v.as_str()))
        .or_else(|| value.get("provider").and_then(|v| v.as_str()))
        .map(String::from);
    serde_json::to_string(&AiApiError {
        kind: "api",
        message: sanitize_api_error_message(raw_message, api_key, messages),
        status: (status != 0).then_some(status),
        code,
        provider,
        model: Some(model.to_string()),
    })
    .unwrap_or_else(|_| "{\"kind\":\"api\",\"message\":\"The API returned an error.\"}".into())
}

fn transport_error(error: &reqwest::Error, model: &str) -> String {
    serde_json::to_string(&AiApiError {
        kind: if error.is_timeout() {
            "timeout"
        } else {
            "network"
        },
        message: if error.is_timeout() {
            "The request timed out.".into()
        } else {
            "The API could not be reached.".into()
        },
        status: error.status().map(|status| status.as_u16()),
        code: None,
        provider: None,
        model: Some(model.to_string()),
    })
    .unwrap()
}

/// OpenAI-compatible /models response structs.
#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
struct ModelEntry {
    id: String,
    #[serde(default)]
    context_length: Option<u64>,
    #[serde(default)]
    pricing: Option<serde_json::Value>,
    #[serde(default)]
    architecture: Option<ModelArchitecture>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ModelArchitecture {
    #[serde(default)]
    input_modalities: Vec<String>,
    #[serde(default)]
    output_modalities: Vec<String>,
    #[serde(default)]
    modality: Option<String>,
    #[serde(default)]
    tokenizer: Option<String>,
    #[serde(default)]
    instruct_type: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    id: String,
    context_length: Option<u64>,
    pricing: Option<ModelPricing>,
    architecture: Option<ModelArchitecture>,
}

#[derive(Deserialize, Serialize, Debug, PartialEq)]
pub struct ModelPricing {
    prompt: Option<String>,
    completion: Option<String>,
}

fn normalize_modalities(modalities: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();
    for modality in modalities {
        let modality = modality.trim().to_ascii_lowercase();
        if !modality.is_empty() && !normalized.contains(&modality) {
            normalized.push(modality);
        }
    }
    normalized
}

fn normalize_architecture(mut architecture: ModelArchitecture) -> ModelArchitecture {
    architecture.input_modalities = normalize_modalities(architecture.input_modalities);
    architecture.output_modalities = normalize_modalities(architecture.output_modalities);

    // Older OpenRouter responses may only expose the compact `input->output`
    // form. Use it as a metadata fallback, never the model name or ID.
    if let Some((inputs, outputs)) = architecture
        .modality
        .as_deref()
        .and_then(|value| value.split_once("->"))
    {
        if architecture.input_modalities.is_empty() {
            architecture.input_modalities =
                normalize_modalities(inputs.split('+').map(String::from).collect());
        }
        if architecture.output_modalities.is_empty() {
            architecture.output_modalities =
                normalize_modalities(outputs.split('+').map(String::from).collect());
        }
    }

    architecture
}

fn is_openrouter_url(url: &str) -> bool {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|url| url.host_str().map(str::to_ascii_lowercase))
        .is_some_and(|host| host == "openrouter.ai" || host.ends_with(".openrouter.ai"))
}

fn normalize_models(entries: Vec<ModelEntry>, text_output_only: bool) -> Vec<ModelInfo> {
    entries
        .into_iter()
        .filter_map(|model| {
            let architecture = model.architecture.map(normalize_architecture);
            if text_output_only
                && !architecture
                    .as_ref()
                    .is_some_and(|value| value.output_modalities.as_slice() == ["text"])
            {
                return None;
            }

            Some(ModelInfo {
                id: model.id,
                context_length: model.context_length,
                architecture,
                // OpenRouter normally returns a pricing object. Tiered or otherwise
                // unfamiliar pricing shapes are deliberately omitted rather than
                // flattened into a potentially misleading price.
                pricing: model
                    .pricing
                    .and_then(|value| serde_json::from_value::<ModelPricing>(value).ok()),
            })
        })
        .collect()
}

/// Fetches available models from an OpenAI-compatible /models endpoint.
/// Uses the shared CLIENT with an optional Bearer token for providers like OpenRouter.
/// Running the HTTP call on the Rust side avoids CORS issues in the Tauri WebView.
#[tauri::command]
pub async fn fetch_models(url: String, api_key: String) -> Result<Vec<ModelInfo>, String> {
    let text_output_only = is_openrouter_url(&url);
    let mut req = CLIENT.get(format!("{}/models", url));

    if !api_key.is_empty() {
        req = req.bearer_auth(&api_key);
    }

    let res = req
        .send()
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!("API error: Status {}", res.status()));
    }

    let body_text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?;

    let body: ModelsResponse = serde_json::from_str(&body_text).map_err(|e| {
        // chars().take(n) instead of byte-slicing: slicing a &str at an arbitrary byte
        // index panics if that index falls inside a multi-byte UTF-8 character (e.g. an
        // umlaut or emoji in the server's error message). This is char-boundary safe.
        let preview: String = body_text.chars().take(500).collect();
        format!(
            "Failed to parse models response: {}. Raw body: {}",
            e, preview
        )
    })?;

    Ok(normalize_models(body.data, text_output_only))
}

#[cfg(test)]
mod model_tests {
    use super::*;

    fn models(json: &str, text_output_only: bool) -> Vec<ModelInfo> {
        let response: ModelsResponse = serde_json::from_str(json).unwrap();
        normalize_models(response.data, text_output_only)
    }

    #[test]
    fn openrouter_catalog_keeps_only_exclusively_text_output_models() {
        let result = models(
            r#"{"data":[
                {"id":"chat","architecture":{"input_modalities":["text"],"output_modalities":["text"]}},
                {"id":"vision","architecture":{"input_modalities":["text","image"],"output_modalities":["text"]}},
                {"id":"text-audio","architecture":{"input_modalities":["text"],"output_modalities":["text","audio"]}},
                {"id":"text-image","architecture":{"input_modalities":["text"],"output_modalities":["text","image"]}},
                {"id":"text-video","architecture":{"input_modalities":["text"],"output_modalities":["text","video"]}},
                {"id":"image-only","architecture":{"input_modalities":["text"],"output_modalities":["image"]}},
                {"id":"audio-only","architecture":{"input_modalities":["text"],"output_modalities":["audio"]}},
                {"id":"video-only","architecture":{"input_modalities":["text"],"output_modalities":["video"]}},
                {"id":"embedding","architecture":{"input_modalities":["text"],"output_modalities":["embeddings"]}},
                {"id":"unknown"}
            ]}"#,
            true,
        );

        assert_eq!(
            result
                .iter()
                .map(|model| model.id.as_str())
                .collect::<Vec<_>>(),
            vec!["chat", "vision"]
        );
        assert_eq!(
            result[1].architecture.as_ref().unwrap().input_modalities,
            vec!["text", "image"]
        );
    }

    #[test]
    fn compact_modality_is_normalized_without_inspecting_the_id() {
        let result = models(
            r#"{"data":[
                {"id":"arbitrary-a","architecture":{"modality":"text+image->text"}},
                {"id":"arbitrary-b","architecture":{"modality":"text->audio"}}
            ]}"#,
            true,
        );

        assert_eq!(result.len(), 1);
        let architecture = result[0].architecture.as_ref().unwrap();
        assert_eq!(architecture.input_modalities, vec!["text", "image"]);
        assert_eq!(architecture.output_modalities, vec!["text"]);
    }

    #[test]
    fn compatible_non_openrouter_catalogs_are_not_filtered() {
        let result = models(r#"{"data":[{"id":"model-without-metadata"}]}"#, false);
        assert_eq!(result.len(), 1);
    }

    #[test]
    fn recognizes_openrouter_hosts_without_matching_impostors() {
        assert!(is_openrouter_url("https://openrouter.ai/api/v1"));
        assert!(is_openrouter_url("https://eu.openrouter.ai/api/v1/"));
        assert!(!is_openrouter_url(
            "https://openrouter.ai.example.com/api/v1"
        ));
    }
}

/// Emits whatever is currently buffered in either batch, then clears both buffers.
/// Shared by the periodic flush tick and the final flush after the loop ends, so the
/// emit logic only lives in one place.
fn flush_batches(
    window: &Window,
    token_batch: &mut String,
    thinking_batch: &mut String,
    generation_id: &Option<String>,
) -> Result<(), String> {
    if !token_batch.is_empty() {
        let batch = std::mem::take(token_batch);
        window
            .emit(
                "ai-token",
                TokenPayload {
                    token: batch,
                    generation_id: generation_id.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
    }
    if !thinking_batch.is_empty() {
        let batch = std::mem::take(thinking_batch);
        window
            .emit(
                "ai-thinking-token",
                ThinkingTokenPayload {
                    token: batch,
                    generation_id: generation_id.clone(),
                },
            )
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// Streams completions from an OpenAI-compatible API endpoint.
/// Batches incoming tokens before emitting them to the frontend to prevent
/// overwhelming the Tauri IPC bridge and freezing the Svelte UI.
/// Uses a CancellationToken so stop_generation() drops the TCP connection immediately -
/// including during the initial connect, not just once streaming has started.
#[tauri::command]
pub async fn call_ai_api(window: Window, payload: AiRequest) -> Result<(), String> {
    // Replace the active token so stop_generation() targets this request.
    let token = CancellationToken::new();
    let request_id = NEXT_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    *ACTIVE_CANCELLATION.lock() = Some(ActiveCancellation {
        request_id,
        generation_id: payload.generation_id.clone(),
        token: token.clone(),
    });
    // Every return path (success, error, or cancellation) clears this request's
    // handle, but never a newer request that replaced it in the meantime.
    let _active_guard = ActiveCancellationGuard { request_id };

    let mut parameter_flags = load_api_parameter_flags(&window);
    let mut forwarded_max_tokens = payload.max_tokens;
    let mut forwarded_thinking_budget = payload.thinking_budget;
    let additional_parameters = if let Some(config) = &payload.request_parameter_config {
        let conflicts: Vec<&str> = PROTECTED_API_PARAMETER_KEYS
            .iter()
            .copied()
            .filter(|key| config.additional_parameters.contains_key(*key))
            .collect();
        if !conflicts.is_empty() {
            return Err(format!(
                "protected fields cannot be overridden: {}",
                conflicts.join(", ")
            ));
        }
        bind_request_parameter_config(
            &mut parameter_flags,
            &mut forwarded_max_tokens,
            &mut forwarded_thinking_budget,
            config,
        );
        config.additional_parameters.clone()
    } else {
        load_additional_api_parameters(&window)
    };

    let mut body = serde_json::json!({
        "model": payload.model,
        "messages": payload.messages,
        "stream": true
    });

    if parameter_flags.temperature {
        body["temperature"] = serde_json::json!(payload.temperature);
    }

    if parameter_flags.max_tokens {
        if let Some(max_tokens) = forwarded_max_tokens {
            body["max_tokens"] = serde_json::json!(max_tokens);
        }
    }
    // Mapped to "repetition_penalty" (llama.cpp/koboldcpp sampler), not the OpenAI
    // "presence_penalty" semantics — see the doc comment on AiRequest::presence_penalty.
    if parameter_flags.presence_penalty {
        if let Some(penalty) = payload.presence_penalty {
            body["repetition_penalty"] = serde_json::json!(penalty);
        }
    }
    if parameter_flags.top_p {
        if let Some(top_p) = payload.top_p {
            body["top_p"] = serde_json::json!(top_p);
        }
    }
    if parameter_flags.top_k {
        if let Some(top_k) = payload.top_k {
            body["top_k"] = serde_json::json!(top_k);
        }
    }
    if parameter_flags.min_p {
        if let Some(min_p) = payload.min_p {
            body["min_p"] = serde_json::json!(min_p);
        }
    }
    if parameter_flags.frequency_penalty {
        if let Some(freq_penalty) = payload.frequency_penalty {
            body["frequency_penalty"] = serde_json::json!(freq_penalty);
        }
    }

    // Ask capable chat templates for reasoning output. The frontend detects
    // inline <think> output automatically; non-thinking models ignore this.
    body["chat_template_kwargs"] = serde_json::json!({ "enable_thinking": true });
    if parameter_flags.thinking_budget {
        if let Some(budget) = forwarded_thinking_budget {
            // 0 = end reasoning immediately, N>0 = token budget, omit for server default (usually unrestricted).
            body["thinking_budget_tokens"] = serde_json::json!(budget);
        }
    }

    merge_additional_api_parameters(&mut body, additional_parameters);

    let mut req = CLIENT
        .post(format!("{}/chat/completions", payload.url))
        .json(&body);

    if !payload.api_key.is_empty() {
        req = req.bearer_auth(&payload.api_key);
    }

    // Cancel-aware connect: without this, stop_generation() would do nothing until the
    // first byte arrives, since previously only the streaming loop below watched the
    // token. A server that's slow/unreachable would hang here with no way to abort.
    let res = tokio::select! {
        result = req.send() => result.map_err(|e| transport_error(&e, &payload.model))?,
        _ = token.cancelled() => return Ok(()),
    };

    if !res.status().is_success() {
        let status = res.status().as_u16();
        let response_body = res.text().await.unwrap_or_default();
        return Err(api_error_from_body(
            status,
            &response_body,
            &payload.api_key,
            &payload.model,
            &payload.messages,
        ));
    }

    let mut stream = res.bytes_stream().eventsource();

    let mut token_batch = String::new();
    let mut thinking_batch = String::new();
    let batch_delay = Duration::from_millis(25);

    // Ticks independently of incoming events, so a batch never sits unflushed just
    // because the server paused between chunks (which the old "flush on next event,
    // if enough time has passed" logic was prone to under bursty/uneven streaming).
    let mut flush_tick = tokio::time::interval(batch_delay);
    flush_tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

    loop {
        tokio::select! {
            // Checked first so a Stop click is never left waiting behind a pending
            // event or tick that happens to be ready at the same instant.
            biased;

            _ = token.cancelled() => break,

            maybe_event = stream.next() => {
                let Some(event_result) = maybe_event else {
                    break;
                };

                match event_result {
                    Ok(event) => {
                        if event.data == "[DONE]" {
                            break;
                        }
                        if let Ok(value) = serde_json::from_str::<serde_json::Value>(&event.data) {
                            if value.get("error").is_some() {
                                return Err(api_error_from_body(0, &event.data, &payload.api_key, &payload.model, &payload.messages));
                            }
                        }
                        match serde_json::from_str::<StreamChunk>(&event.data) {
                            Ok(chunk) => {
                                if let Some(delta) = chunk.choices.first().map(|c| &c.delta) {
                                    if let Some(content) = delta.content.as_ref() {
                                        token_batch.push_str(content);
                                    }
                                    if let Some(reasoning) = delta.reasoning_content.as_ref() {
                                        thinking_batch.push_str(reasoning);
                                    }
                                }
                            }
                            Err(e) => {
                                eprintln!("Failed to parse SSE chunk: {} (raw: {})", e, event.data);
                            }
                        }
                    }
                    Err(e) => {
                        eprintln!("SSE Error: {}", e);
                    }
                }
            }

            _ = flush_tick.tick() => {
                flush_batches(
                    &window,
                    &mut token_batch,
                    &mut thinking_batch,
                    &payload.generation_id,
                )?;
            }
        }
    }

    // Flush whatever was buffered when the stream stopped (DONE, cancel, or close).
    flush_batches(
        &window,
        &mut token_batch,
        &mut thinking_batch,
        &payload.generation_id,
    )?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        api_error_from_body, bind_request_parameter_config, cancellation_matches,
        merge_additional_api_parameters, parse_additional_api_parameters, ApiParameterFlags,
        RequestApiParameterConfig,
    };

    #[test]
    fn bound_request_uses_snapshotted_token_values_instead_of_live_payload_values() {
        let config = RequestApiParameterConfig {
            max_tokens_enabled: true,
            thinking_budget_enabled: true,
            max_tokens: 300,
            thinking_budget: 2500,
            additional_parameters: serde_json::Map::new(),
        };
        let mut flags = ApiParameterFlags::default();
        let mut max_tokens = Some(999);
        let mut thinking_budget = Some(999);

        bind_request_parameter_config(
            &mut flags,
            &mut max_tokens,
            &mut thinking_budget,
            &config,
        );

        assert!(flags.max_tokens);
        assert!(flags.thinking_budget);
        assert_eq!(max_tokens, Some(2800));
        assert_eq!(thinking_budget, Some(2500));
    }

    #[test]
    fn bound_request_does_not_add_a_disabled_thinking_budget_to_max_tokens() {
        let config = RequestApiParameterConfig {
            max_tokens_enabled: true,
            thinking_budget_enabled: false,
            max_tokens: 300,
            thinking_budget: 2500,
            additional_parameters: serde_json::Map::new(),
        };
        let mut flags = ApiParameterFlags::default();
        let mut max_tokens = None;
        let mut thinking_budget = None;

        bind_request_parameter_config(
            &mut flags,
            &mut max_tokens,
            &mut thinking_budget,
            &config,
        );

        assert!(flags.max_tokens);
        assert!(!flags.thinking_budget);
        assert_eq!(max_tokens, Some(300));
        assert_eq!(thinking_budget, Some(2500));
    }

    #[test]
    fn legacy_stop_matches_the_active_request() {
        assert!(cancellation_matches(&Some("current".into()), &None));
        assert!(cancellation_matches(&None, &None));
    }

    #[test]
    fn scoped_stop_only_matches_its_generation() {
        assert!(cancellation_matches(
            &Some("current".into()),
            &Some("current".into()),
        ));
        assert!(!cancellation_matches(
            &Some("newer".into()),
            &Some("older".into()),
        ));
        assert!(!cancellation_matches(&None, &Some("multiplayer".into())));
    }

    #[test]
    fn preserves_openrouter_provider_error_metadata() {
        let error = api_error_from_body(
            429,
            r#"{"error":{"message":"Upstream quota exceeded","code":429,"metadata":{"provider_name":"ExampleAI"}}}"#,
            "secret-key",
            "example/model",
            &[],
        );
        let value: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(value["message"], "Upstream quota exceeded");
        assert_eq!(value["provider"], "ExampleAI");
        assert_eq!(value["model"], "example/model");
        assert_eq!(value["status"], 429);
        assert_eq!(value["code"], "429");
    }

    #[test]
    fn redacts_keys_and_prompts_from_api_messages() {
        let messages = vec![serde_json::json!({"role":"user", "content":"private prompt"})];
        let error = api_error_from_body(
            400,
            r#"{"error":{"message":"private prompt Authorization: Bearer secret-key"}}"#,
            "secret-key",
            "example/model",
            &messages,
        );
        assert!(!error.contains("private prompt"));
        assert!(!error.contains("secret-key"));
    }

    #[test]
    fn additional_parameters_preserve_nested_json_values() {
        let parameters = parse_additional_api_parameters(
            r#"{"provider":{"only":["deepinfra"]},"reasoning":{"enabled":true,"effort":2.5},"temperature":0.2,"tag":"custom"}"#,
        )
        .unwrap();
        let mut body = serde_json::json!({
            "model": "controlled-model",
            "messages": [],
            "stream": true,
            "temperature": 0.8
        });

        merge_additional_api_parameters(&mut body, parameters);

        assert_eq!(body["provider"]["only"], serde_json::json!(["deepinfra"]));
        assert_eq!(body["reasoning"]["enabled"], true);
        assert_eq!(body["reasoning"]["effort"], 2.5);
        assert_eq!(body["temperature"], 0.2);
        assert_eq!(body["tag"], "custom");
    }

    #[test]
    fn additional_parameters_reject_non_objects_and_invalid_json() {
        assert!(parse_additional_api_parameters("[").is_err());
        assert!(parse_additional_api_parameters("[]").is_err());
        assert!(parse_additional_api_parameters("null").is_err());
    }

    #[test]
    fn empty_additional_parameters_leave_the_request_unchanged() {
        let mut body = serde_json::json!({
            "model": "controlled-model",
            "messages": [{"role": "user", "content": "Hello"}],
            "stream": true
        });
        let original = body.clone();

        merge_additional_api_parameters(
            &mut body,
            parse_additional_api_parameters("  ").unwrap(),
        );

        assert_eq!(body, original);
    }

    #[test]
    fn additional_parameters_reject_every_protected_field() {
        for field in ["messages", "model", "stream"] {
            let raw = format!(r#"{{"{field}":null,"provider":{{"sort":"price"}}}}"#);
            assert!(parse_additional_api_parameters(&raw).is_err(), "{field}");
        }
    }
}
