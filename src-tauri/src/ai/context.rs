//! Runtime and provider-advertised context detection with provenance.
use super::{cloud, CLIENT};
use serde::Serialize;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const MIN_CONTEXT_TOKENS: u64 = 1024;
const MAX_CONTEXT_TOKENS: u64 = 16_777_216;

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DetectedContextMetadata {
    tokens: u64,
    provenance: &'static str,
    provider_kind: String,
    model: String,
    detected_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    theoretical_tokens: Option<u64>,
}

fn valid_context(value: Option<u64>) -> Option<u64> {
    value.filter(|value| (MIN_CONTEXT_TOKENS..=MAX_CONTEXT_TOKENS).contains(value))
}

pub(super) fn server_root(base_url: &str) -> Result<String, String> {
    let mut url =
        reqwest::Url::parse(base_url).map_err(|_| "The base URL is invalid".to_string())?;
    let path = url.path().trim_end_matches('/').to_string();
    let root_path = path
        .strip_suffix("/api/v1")
        .or_else(|| path.strip_suffix("/v1"))
        .unwrap_or(&path)
        .to_string();
    url.set_path(if root_path.is_empty() {
        "/"
    } else {
        &root_path
    });
    url.set_query(None);
    url.set_fragment(None);
    Ok(url.as_str().trim_end_matches('/').to_string())
}

fn model_matches(candidate: &str, selected: &str) -> bool {
    candidate == selected
        || candidate.strip_suffix(":latest") == Some(selected)
        || selected.strip_suffix(":latest") == Some(candidate)
}

fn parse_openai_advertised(body: &serde_json::Value, model: &str) -> Result<u64, String> {
    body.get("data")
        .and_then(|value| value.as_array())
        .and_then(|items| {
            items.iter().find(|item| {
                item.get("id")
                    .and_then(|id| id.as_str())
                    .is_some_and(|id| model_matches(id, model))
            })
        })
        .and_then(|item| valid_context(item.get("context_length").and_then(|value| value.as_u64())))
        .ok_or_else(|| "The selected model did not advertise a valid context length".to_string())
}

fn parse_lm_studio(body: &serde_json::Value, model: &str) -> Result<(u64, Option<u64>), String> {
    let items = body
        .get("data")
        .or_else(|| body.get("models"))
        .and_then(|value| value.as_array())
        .ok_or_else(|| "LM Studio returned malformed model metadata".to_string())?;
    let item = items
        .iter()
        .find(|item| {
            item.get("id")
                .and_then(|id| id.as_str())
                .is_some_and(|id| model_matches(id, model))
                || item
                    .get("loaded_instances")
                    .and_then(|value| value.as_array())
                    .is_some_and(|instances| {
                        instances.iter().any(|instance| {
                            ["id", "model", "model_key"].iter().any(|key| {
                                instance
                                    .get(*key)
                                    .and_then(|value| value.as_str())
                                    .is_some_and(|id| model_matches(id, model))
                            })
                        })
                    })
        })
        .ok_or_else(|| "The selected LM Studio model was not found".to_string())?;
    let theoretical = valid_context(
        item.get("max_context_length")
            .and_then(|value| value.as_u64()),
    );
    let loaded = item
        .get("loaded_instances")
        .and_then(|value| value.as_array())
        .cloned()
        .unwrap_or_default();
    let contexts: Vec<u64> = loaded
        .iter()
        .filter_map(|instance| {
            instance
                .pointer("/config/context_length")
                .and_then(|value| value.as_u64())
                .and_then(|value| valid_context(Some(value)))
        })
        .collect();
    match contexts.as_slice() {
        [context] => Ok((*context, theoretical)),
        [] => Err("The selected LM Studio model is not loaded".into()),
        _ if contexts.iter().all(|context| *context == contexts[0]) => {
            Ok((contexts[0], theoretical))
        }
        _ => Err("Multiple loaded LM Studio instances have different context sizes".into()),
    }
}

fn parse_llama_cpp(body: &serde_json::Value) -> Result<u64, String> {
    valid_context(
        body.pointer("/default_generation_settings/n_ctx")
            .and_then(|value| value.as_u64()),
    )
    .ok_or_else(|| "llama.cpp did not return a valid runtime context".to_string())
}

fn parse_kobold(body: &serde_json::Value) -> Result<u64, String> {
    valid_context(
        body.as_u64()
            .or_else(|| body.get("value").and_then(|value| value.as_u64()))
            .or_else(|| {
                body.get("max_context_length")
                    .and_then(|value| value.as_u64())
            }),
    )
    .ok_or_else(|| "KoboldCpp did not return a valid context length".to_string())
}

fn parse_ollama(body: &serde_json::Value, model: &str) -> Result<u64, String> {
    body.get("models")
        .and_then(|value| value.as_array())
        .and_then(|items| {
            items.iter().find(|item| {
                item.get("name")
                    .or_else(|| item.get("model"))
                    .and_then(|value| value.as_str())
                    .is_some_and(|id| model_matches(id, model))
            })
        })
        .and_then(|item| valid_context(item.get("context_length").and_then(|value| value.as_u64())))
        .ok_or_else(|| {
            "The selected Ollama model is not loaded or has no runtime context metadata".to_string()
        })
}

async fn get_context_json(url: String, api_key: &str) -> Result<serde_json::Value, String> {
    let mut request = CLIENT.get(url).timeout(Duration::from_secs(10));
    if !api_key.is_empty() {
        request = request.bearer_auth(api_key);
    }
    let response = request
        .send()
        .await
        .map_err(|_| "Context detection request failed".to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Context detection returned status {}",
            response.status()
        ));
    }
    response
        .json()
        .await
        .map_err(|_| "Context detection returned malformed JSON".to_string())
}

/// Provider identity is explicit: native endpoints are only called by their matching kind.
/// Detection failures are independent from chat generation and never mutate the connection.
pub(super) async fn detect_context(
    provider_kind: String,
    base_url: String,
    model: String,
    api_key: String,
) -> Result<DetectedContextMetadata, String> {
    if model.trim().is_empty() {
        return Err("Select a model before detecting context".into());
    }
    let root = server_root(&base_url)?;
    let (tokens, provenance, theoretical_tokens) = match provider_kind.as_str() {
        "nanogpt" | "anthropic" | "gemini" => {
            let models = cloud::fetch_models(&base_url, &api_key, &provider_kind).await?;
            let tokens = models
                .iter()
                .find(|entry| entry.id == model)
                .and_then(|entry| valid_context(entry.context_length))
                .ok_or_else(|| {
                    "The provider did not advertise a context size; set a manual cap".to_string()
                })?;
            (tokens, "provider_advertised", None)
        }
        "openrouter" | "xai" | "generic_openai" => {
            let body = get_context_json(
                format!("{}/models", base_url.trim_end_matches('/')),
                &api_key,
            )
            .await?;
            (
                parse_openai_advertised(&body, &model)?,
                "provider_advertised",
                None,
            )
        }
        "lm_studio" => {
            let body = get_context_json(format!("{root}/api/v1/models"), &api_key).await?;
            let (runtime, theoretical) = parse_lm_studio(&body, &model)?;
            (runtime, "runtime", theoretical)
        }
        "llama_cpp" => {
            let body = get_context_json(format!("{root}/props"), &api_key).await?;
            (parse_llama_cpp(&body)?, "runtime", None)
        }
        "koboldcpp" => {
            match get_context_json(
                format!("{root}/api/extra/true_max_context_length"),
                &api_key,
            )
            .await
            .and_then(|body| parse_kobold(&body))
            {
                Ok(tokens) => (tokens, "kobold_true_max", None),
                Err(_) => {
                    let body = get_context_json(
                        format!("{root}/api/v1/config/max_context_length"),
                        &api_key,
                    )
                    .await?;
                    (parse_kobold(&body)?, "kobold_config_fallback", None)
                }
            }
        }
        "ollama" => {
            let body = get_context_json(format!("{root}/api/ps"), &api_key).await?;
            (parse_ollama(&body, &model)?, "runtime", None)
        }
        "openai" => {
            return Err("OpenAI does not advertise reliable context sizes; set a manual cap".into())
        }
        _ => return Err("Unsupported provider kind".into()),
    };
    let detected_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        .to_string();
    Ok(DetectedContextMetadata {
        tokens,
        provenance,
        provider_kind,
        model,
        detected_at,
        theoretical_tokens,
    })
}

#[cfg(test)]
mod context_detection_tests {
    use super::*;
    fn value(raw: &str) -> serde_json::Value {
        serde_json::from_str(raw).unwrap()
    }

    #[test]
    fn parses_openrouter_xai_and_generic_advertised_context() {
        let body = value(
            r#"{"data":[{"id":"other","context_length":1},{"id":"chosen","context_length":131072}]}"#,
        );
        assert_eq!(parse_openai_advertised(&body, "chosen").unwrap(), 131072);
    }
    #[test]
    fn parses_lm_studio_runtime_and_keeps_theoretical_separate() {
        let body = value(
            r#"{"data":[{"id":"chosen","max_context_length":131072,"loaded_instances":[{"config":{"context_length":32768}}]}]}"#,
        );
        assert_eq!(
            parse_lm_studio(&body, "chosen").unwrap(),
            (32768, Some(131072))
        );
    }
    #[test]
    fn rejects_unloaded_or_ambiguous_lm_studio_instances() {
        assert!(parse_lm_studio(
            &value(r#"{"data":[{"id":"chosen","loaded_instances":[]}]}"#),
            "chosen"
        )
        .is_err());
        assert!(parse_lm_studio(&value(r#"{"data":[{"id":"chosen","loaded_instances":[{"config":{"context_length":8192}},{"config":{"context_length":16384}}]}]}"#), "chosen").is_err());
    }
    #[test]
    fn parses_llama_cpp_runtime_context() {
        assert_eq!(
            parse_llama_cpp(&value(r#"{"default_generation_settings":{"n_ctx":16384}}"#)).unwrap(),
            16384
        );
    }
    #[test]
    fn parses_both_kobold_response_shapes() {
        assert_eq!(parse_kobold(&value(r#"{"value":32768}"#)).unwrap(), 32768);
        assert_eq!(
            parse_kobold(&value(r#"{"max_context_length":65536}"#)).unwrap(),
            65536
        );
    }
    #[test]
    fn parses_only_loaded_matching_ollama_model() {
        let body = value(r#"{"models":[{"name":"llama:latest","context_length":24576}]}"#);
        assert_eq!(parse_ollama(&body, "llama").unwrap(), 24576);
        assert!(parse_ollama(&body, "other").is_err());
    }
    #[test]
    fn malformed_or_implausible_context_is_rejected() {
        for raw in [
            r#"{"data":[{"id":"chosen","context_length":0}]}"#,
            r#"{"data":[{"id":"chosen","context_length":"huge"}]}"#,
            r#"{"data":[{"id":"chosen","context_length":999999999}]}"#,
        ] {
            assert!(parse_openai_advertised(&value(raw), "chosen").is_err());
        }
    }
    #[test]
    fn derives_native_server_root_from_compatible_base() {
        assert_eq!(
            server_root("http://localhost:1234/v1/").unwrap(),
            "http://localhost:1234"
        );
        assert_eq!(
            server_root("https://host/prefix/api/v1").unwrap(),
            "https://host/prefix"
        );
    }
}
