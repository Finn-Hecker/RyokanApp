//! Model catalogs, normalized metadata and advertised capabilities.
use super::context::server_root;
use super::{cloud, pricing, CLIENT};
use serde::{Deserialize, Serialize};
use std::time::Duration;

/// OpenAI-compatible /models response structs.
#[derive(Deserialize)]
struct ModelsResponse {
    pub(super) data: Vec<ModelEntry>,
}

#[derive(Deserialize)]
pub(super) struct ModelEntry {
    pub(super) id: String,
    #[serde(default)]
    pub(super) reasoning: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) supported_parameters: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) context_length: Option<u64>,
    #[serde(default)]
    pub(super) pricing: Option<serde_json::Value>,
    #[serde(default)]
    pub(super) architecture: Option<ModelArchitecture>,
}

#[derive(Deserialize, Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct ModelArchitecture {
    #[serde(default)]
    pub(super) input_modalities: Vec<String>,
    #[serde(default)]
    pub(super) output_modalities: Vec<String>,
    #[serde(default)]
    pub(super) modality: Option<String>,
    #[serde(default)]
    pub(super) tokenizer: Option<String>,
    #[serde(default)]
    pub(super) instruct_type: Option<String>,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ModelInfo {
    pub(super) id: String,
    /// Native input/output limits are distinct; context_length remains the planning window.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) input_token_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) output_token_limit: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) parameter_source: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(super) thinking_supported: Option<bool>,
    pub(super) supported_parameters: Option<Vec<String>>,
    pub(super) reasoning: Option<ModelReasoningInfo>,
    pub(super) context_length: Option<u64>,
    pub(super) pricing: Option<ModelPricing>,
    pub(super) architecture: Option<ModelArchitecture>,
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelReasoningInfo {
    pub(super) supported: bool,
    pub(super) allowed_options: Option<Vec<String>>,
}

#[derive(Deserialize, Serialize, Debug, PartialEq)]
pub struct ModelPricing {
    pub(super) prompt: Option<String>,
    pub(super) completion: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub(super) source: Option<String>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub(super) tiered: bool,
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

pub(super) fn normalize_models(entries: Vec<ModelEntry>, text_output_only: bool) -> Vec<ModelInfo> {
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
                input_token_limit: None,
                output_token_limit: None,
                parameter_source: None,
                thinking_supported: None,
                supported_parameters: model
                    .supported_parameters
                    .and_then(|value| serde_json::from_value::<Vec<String>>(value).ok()),
                // OpenRouter's /models metadata uses supported_efforts; expose it
                // through the same normalized field as local provider metadata.
                reasoning: model
                    .reasoning
                    .filter(|value| text_output_only && value.is_object())
                    .map(|value| ModelReasoningInfo {
                        supported: true,
                        allowed_options: value.get("supported_efforts").and_then(|options| {
                            serde_json::from_value::<Vec<String>>(options.clone()).ok()
                        }),
                    }),
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
pub(super) async fn fetch_models(
    url: String,
    api_key: String,
    provider_kind: Option<String>,
) -> Result<Vec<ModelInfo>, String> {
    if cloud::is_provider(provider_kind.as_deref()) {
        let mut models =
            cloud::fetch_models(&url, &api_key, provider_kind.as_deref().unwrap()).await?;
        pricing::enrich(&mut models, &url, provider_kind.as_deref()).await;
        return Ok(models);
    }
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

    let mut models = normalize_models(body.data, text_output_only);
    if provider_kind.as_deref() == Some("lm_studio") {
        if let Ok(base) = server_root(&url) {
            let mut native_req = CLIENT
                .get(format!("{base}/api/v1/models"))
                .timeout(Duration::from_secs(3));
            if !api_key.is_empty() {
                native_req = native_req.bearer_auth(&api_key);
            }
            if let Ok(response) = native_req.send().await {
                if let Ok(metadata) = response.json::<serde_json::Value>().await {
                    attach_lm_studio_reasoning(&mut models, &metadata);
                }
            }
        }
    }
    if provider_kind.as_deref() == Some("llama_cpp") {
        if let Ok(base) = server_root(&url) {
            let mut props_req = CLIENT
                .get(format!("{base}/props"))
                .timeout(Duration::from_secs(3));
            if !api_key.is_empty() {
                props_req = props_req.bearer_auth(&api_key);
            }
            if let Ok(response) = props_req.send().await {
                if let Ok(props) = response.json::<serde_json::Value>().await {
                    attach_llama_reasoning(&mut models, &props);
                }
            }
        }
    }
    pricing::enrich(&mut models, &url, provider_kind.as_deref()).await;
    Ok(models)
}

fn attach_llama_reasoning(models: &mut [ModelInfo], props: &serde_json::Value) {
    if props.pointer("/chat_template_caps/supports_reasoning_effort")
        != Some(&serde_json::Value::Bool(true))
    {
        return;
    }
    let Some(alias) = props.get("model_alias").and_then(serde_json::Value::as_str) else {
        return;
    };
    for model in models.iter_mut().filter(|model| model.id == alias) {
        model.reasoning = Some(ModelReasoningInfo {
            supported: true,
            allowed_options: None,
        });
    }
}

fn attach_lm_studio_reasoning(models: &mut [ModelInfo], metadata: &serde_json::Value) {
    let Some(entries) = metadata.get("models").and_then(serde_json::Value::as_array) else {
        return;
    };
    for entry in entries {
        let Some(reasoning) = entry.pointer("/capabilities/reasoning") else {
            continue;
        };
        let Some(reasoning) = reasoning.as_object() else {
            continue;
        };
        let options = reasoning
            .get("allowed_options")
            .and_then(serde_json::Value::as_array)
            .and_then(|items| {
                items
                    .iter()
                    .map(|item| item.as_str().map(str::to_owned))
                    .collect()
            });
        let key = entry.get("key").and_then(serde_json::Value::as_str);
        let instances = entry
            .get("loaded_instances")
            .and_then(serde_json::Value::as_array);
        for model in models.iter_mut() {
            let matches = key == Some(model.id.as_str())
                || instances.is_some_and(|items| {
                    items.iter().any(|item| {
                        item.get("id").and_then(serde_json::Value::as_str)
                            == Some(model.id.as_str())
                    })
                });
            if matches {
                model.reasoning = Some(ModelReasoningInfo {
                    supported: true,
                    allowed_options: options.clone(),
                });
            }
        }
    }
}

#[cfg(test)]
mod model_tests {
    use super::*;

    fn models(json: &str, text_output_only: bool) -> Vec<ModelInfo> {
        let response: ModelsResponse = serde_json::from_str(json).unwrap();
        normalize_models(response.data, text_output_only)
    }

    #[test]
    fn preserves_advertised_generation_parameters_without_inference() {
        let result = models(
            r#"{"data":[{"id":"known","supported_parameters":["temperature","top_p"]},{"id":"unknown"},{"id":"nonstandard","supported_parameters":{"temperature":true}}]}"#,
            false,
        );
        assert_eq!(
            result[0].supported_parameters,
            Some(vec!["temperature".into(), "top_p".into()])
        );
        assert_eq!(result[1].supported_parameters, None);
        assert_eq!(result[2].supported_parameters, None);
        let serialized = serde_json::to_value(&result[0]).unwrap();
        assert_eq!(
            serialized["supportedParameters"],
            serde_json::json!(["temperature", "top_p"])
        );
    }

    #[test]
    fn openrouter_reasoning_efforts_survive_normalization_and_serialization() {
        let reasoning = [
            serde_json::json!({"supported_efforts": ["max", "xhigh", "high", "medium", "low"], "default_effort": "high", "mandatory": true}),
            serde_json::json!({"supported_efforts": ["none", "minimal", "high"]}),
            serde_json::json!({"mandatory": true}),
            serde_json::json!({"supported_efforts": []}),
            serde_json::json!({"supported_efforts": "invalid"}),
            serde_json::Value::Null,
        ];
        let data: Vec<_> = reasoning
            .iter()
            .enumerate()
            .map(|(index, reasoning)| {
                serde_json::json!({
                    "id": format!("model-{index}"), "architecture": {"output_modalities": ["text"]},
                    "supported_parameters": ["reasoning"], "reasoning": reasoning,
                })
            })
            .collect();
        let json = serde_json::json!({"data": data}).to_string();
        let result = models(&json, true);
        let serialized = serde_json::to_value(&result).unwrap();
        for index in [0, 1, 3] {
            assert_eq!(
                serialized[index]["reasoning"]["allowedOptions"],
                reasoning[index]["supported_efforts"]
            );
            assert_eq!(serialized[index]["reasoning"]["supported"], true);
        }
        for index in [2, 4] {
            assert_eq!(
                result[index].reasoning,
                Some(ModelReasoningInfo {
                    supported: true,
                    allowed_options: None
                })
            );
        }
        assert_eq!(result[5].reasoning, None);
        // Other compatible providers continue to use their own capability metadata.
        assert!(models(&json, false)
            .iter()
            .all(|model| model.reasoning.is_none()));
    }

    #[test]
    fn lm_studio_reasoning_metadata_matches_only_reported_model_identity() {
        let mut result = models(r#"{"data":[{"id":"loaded-id"},{"id":"other"}]}"#, false);
        let native = serde_json::json!({ "models": [{
            "key": "model-key", "loaded_instances": [{"id": "loaded-id"}],
            "capabilities": {"reasoning": {"allowed_options": ["off", "low", "high"]}}
        }]});
        attach_lm_studio_reasoning(&mut result, &native);
        assert_eq!(
            result[0].reasoning,
            Some(ModelReasoningInfo {
                supported: true,
                allowed_options: Some(vec!["off".into(), "low".into(), "high".into()]),
            })
        );
        assert_eq!(result[1].reasoning, None);
    }

    #[test]
    fn llama_reasoning_support_requires_matching_alias_and_positive_template_capability() {
        let mut result = models(r#"{"data":[{"id":"chosen"},{"id":"other"}]}"#, false);
        attach_llama_reasoning(
            &mut result,
            &serde_json::json!({
                "model_alias": "chosen", "chat_template_caps": {"supports_reasoning_effort": true}
            }),
        );
        assert_eq!(
            result[0].reasoning.as_ref().map(|value| value.supported),
            Some(true)
        );
        assert_eq!(result[1].reasoning, None);
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
