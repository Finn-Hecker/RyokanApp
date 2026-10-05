//! Provider-specific list prices. Normalize all quotes to USD/token for the UI.
//! NanoGPT: https://docs.nano-gpt.com/api-reference/endpoint/models
//! Other native cloud providers: https://models.dev/api.json
use super::{ModelInfo, ModelPricing, CLIENT};
use once_cell::sync::Lazy;
use parking_lot::Mutex;
use serde_json::Value;
use std::time::{Duration, Instant};

const CATALOG_URL: &str = "https://models.dev/api.json";
const CACHE_TTL: Duration = Duration::from_secs(3600);
const RETRY_DELAY: Duration = Duration::from_secs(60);

#[derive(Default)]
struct CatalogCache {
    data: Option<Value>,
    fetched: Option<Instant>,
    attempted: Option<Instant>,
}
static CACHE: Lazy<Mutex<CatalogCache>> = Lazy::new(|| Mutex::new(CatalogCache::default()));

fn amount(value: &Value) -> Option<f64> {
    let number = value.as_f64().or_else(|| value.as_str()?.parse().ok())?;
    (number.is_finite() && number >= 0.0).then_some(number)
}

fn per_million_price(
    input: &Value,
    output: &Value,
    source: &str,
    tiered: bool,
) -> Option<ModelPricing> {
    let input = amount(input)? / 1_000_000.0;
    let output = amount(output)? / 1_000_000.0;
    // Same sentinel/plausibility guard as modelPickerData.ts.
    if input >= 1.0 || output >= 1.0 {
        return None;
    }
    Some(ModelPricing {
        prompt: Some(input.to_string()),
        completion: Some(output.to_string()),
        source: Some(source.into()),
        tiered,
    })
}

pub(super) fn nanogpt_price(value: &Value) -> Option<ModelPricing> {
    // Never assume OpenRouter's per-token unit for NanoGPT's per-million quotes.
    if value.get("unit")?.as_str()? != "per_million_tokens"
        || value
            .get("currency")
            .and_then(Value::as_str)
            .is_some_and(|currency| currency != "USD")
    {
        return None;
    }
    per_million_price(
        value.get("prompt")?,
        value.get("completion")?,
        "NanoGPT",
        false,
    )
}

fn catalog_provider(url: &str, kind: Option<&str>) -> Option<&'static str> {
    let parsed = reqwest::Url::parse(url).ok()?;
    if parsed.scheme() != "https" {
        return None;
    }
    // Custom gateways may charge different prices even with identical model IDs.
    match (kind?, parsed.host_str()?) {
        ("openai", "api.openai.com") => Some("openai"),
        ("gemini", "generativelanguage.googleapis.com") => Some("google"),
        ("anthropic", "api.anthropic.com") => Some("anthropic"),
        ("xai", "api.x.ai") => Some("xai"),
        _ => None,
    }
}

fn attach_catalog(models: &mut [ModelInfo], catalog: &Value, provider: &str) {
    let Some(entries) = catalog.get(provider).and_then(|entry| entry.get("models")) else {
        return;
    };
    for model in models {
        if model.pricing.is_some() {
            continue;
        }
        // Exact IDs only: no guessed aliases, snapshots, or prices from another provider.
        let Some(cost) = entries.get(&model.id).and_then(|entry| entry.get("cost")) else {
            continue;
        };
        let (Some(input), Some(output)) = (cost.get("input"), cost.get("output")) else {
            continue;
        };
        let tiered = cost
            .get("tiers")
            .and_then(Value::as_array)
            .is_some_and(|tiers| !tiers.is_empty())
            || cost.get("context_over_200k").is_some();
        model.pricing = per_million_price(input, output, "Models.dev", tiered);
    }
}

pub(super) async fn enrich(models: &mut [ModelInfo], url: &str, kind: Option<&str>) {
    let Some(provider) = catalog_provider(url, kind) else {
        return;
    };
    if models.iter().all(|model| model.pricing.is_some()) {
        return;
    }
    let cached = {
        let mut cache = CACHE.lock();
        let fresh = cache.fetched.is_some_and(|time| time.elapsed() < CACHE_TTL);
        let retry_later = cache
            .attempted
            .is_some_and(|time| time.elapsed() < RETRY_DELAY);
        if fresh || retry_later {
            Some(cache.data.clone())
        } else {
            cache.attempted = Some(Instant::now());
            None
        }
    };
    let data = match cached {
        Some(data) => data,
        None => {
            // Public catalog only; never send provider credentials to Models.dev.
            let result = async {
                CLIENT
                    .get(CATALOG_URL)
                    .timeout(Duration::from_secs(5))
                    .send()
                    .await?
                    .error_for_status()?
                    .json::<Value>()
                    .await
            }
            .await;
            let mut cache = CACHE.lock();
            if let Ok(data) = result {
                if data
                    .get(provider)
                    .and_then(|entry| entry.get("models"))
                    .is_some_and(Value::is_object)
                {
                    cache.data = Some(data);
                    cache.fetched = Some(Instant::now());
                }
            }
            cache.data.clone()
        }
    };
    // Price lookup failure must not prevent selection of an available model.
    if let Some(data) = data {
        attach_catalog(models, &data, provider);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn nanogpt_units_and_invalid_quotes() {
        for input in [json!(2.5), json!("2.5")] {
            let price = nanogpt_price(&json!({"prompt":input,"completion":10,"unit":"per_million_tokens","currency":"USD"})).unwrap();
            assert_eq!(price.prompt.as_deref(), Some("0.0000025"));
            assert_eq!(price.completion.as_deref(), Some("0.00001"));
        }
        for value in [
            json!({"prompt":0,"completion":0}),
            json!({"prompt":2,"completion":3,"unit":"per_token"}),
            json!({"prompt":2,"completion":3,"unit":"per_million_tokens","currency":"NANO"}),
            json!({"prompt":-1,"completion":3,"unit":"per_million_tokens"}),
            json!({"prompt":2,"unit":"per_million_tokens"}),
        ] {
            assert!(nanogpt_price(&value).is_none());
        }
        assert!(
            nanogpt_price(&json!({"prompt":0,"completion":0,"unit":"per_million_tokens"}))
                .is_some()
        );
    }

    #[test]
    fn catalog_uses_exact_provider_and_model_and_preserves_native_prices() {
        let catalog = json!({"google":{"models":{
            "gemini-test":{"cost":{"input":1.25,"output":10,"tiers":[{"input":2.5,"output":15}]}},
            "missing":{"cost":{"input":1}},"invalid":{"cost":{"input":-1,"output":1}}
        }},"openai":{"models":{"gemini-test":{"cost":{"input":99,"output":99}}}}});
        let mut models = super::super::models::normalize_models(
            ["gemini-test", "gemini-test-snapshot", "missing", "invalid"]
                .into_iter()
                .map(|id| serde_json::from_value(json!({"id":id})).unwrap())
                .collect(),
            false,
        );
        attach_catalog(&mut models, &catalog, "google");
        let price = models[0].pricing.as_ref().unwrap();
        assert_eq!(price.prompt.as_deref(), Some("0.00000125"));
        assert!(price.tiered);
        assert!(models[1..].iter().all(|model| model.pricing.is_none()));
        attach_catalog(&mut models, &catalog, "openai");
        assert_eq!(
            models[0].pricing.as_ref().unwrap().prompt.as_deref(),
            Some("0.00000125")
        );
    }

    #[test]
    fn custom_and_local_hosts_do_not_get_native_provider_prices() {
        assert_eq!(
            catalog_provider("https://api.openai.com/v1", Some("openai")),
            Some("openai")
        );
        assert_eq!(
            catalog_provider(
                "https://generativelanguage.googleapis.com/v1beta",
                Some("gemini")
            ),
            Some("google")
        );
        for (url, kind) in [
            ("https://gateway.example/v1", "openai"),
            ("https://api.openai.com/v1", "generic_openai"),
            ("http://localhost:1234/v1", "lm_studio"),
            ("https://api.nano-gpt.com/api/v1", "nanogpt"),
        ] {
            assert_eq!(catalog_provider(url, Some(kind)), None);
        }
    }
}
