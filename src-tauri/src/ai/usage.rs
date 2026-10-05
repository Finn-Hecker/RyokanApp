//! Reported token usage and sparse stream metadata accumulation.
use serde::{Deserialize, Serialize};

/// Counts reported by the backend for this request, independent of model capacity.
#[derive(Debug, Default, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsage {
    pub input_tokens: Option<u64>,
    pub cached_input_tokens: Option<u64>,
    pub cache_write_tokens: Option<u64>,
    pub output_tokens: Option<u64>,
    pub reasoning_tokens: Option<u64>,
    pub cost_usd: Option<f64>,
    pub actual_model: Option<String>,
    pub service_tier: Option<String>,
    pub connection_name: Option<String>,
}

impl TokenUsage {
    pub(super) fn is_empty(&self) -> bool {
        self.input_tokens.is_none()
            && self.cached_input_tokens.is_none()
            && self.cache_write_tokens.is_none()
            && self.output_tokens.is_none()
            && self.reasoning_tokens.is_none()
            && self.cost_usd.is_none()
            && self.actual_model.is_none()
            && self.service_tier.is_none()
    }
}

pub(super) fn count_at(value: &serde_json::Value, path: &[&str]) -> Option<u64> {
    path.iter()
        .try_fold(value, |node, key| node.get(*key))?
        .as_u64()
}

fn first_count(value: &serde_json::Value, paths: &[&[&str]]) -> Option<u64> {
    paths.iter().find_map(|path| count_at(value, path))
}

pub(super) fn parse_token_usage(value: &serde_json::Value) -> Option<TokenUsage> {
    // OpenAI-compatible usage includes OpenRouter, llama.cpp, LM Studio and
    // KoboldCpp. Native Ollama final responses use the eval_count keys.
    let usage = value.get("usage").unwrap_or(value);
    let result = TokenUsage {
        input_tokens: first_count(
            usage,
            &[
                &["prompt_tokens"],
                &["input_tokens"],
                &["prompt_eval_count"],
            ],
        ),
        cached_input_tokens: first_count(
            usage,
            &[
                &["prompt_tokens_details", "cached_tokens"],
                &["input_tokens_details", "cached_tokens"],
                &["prompt_tokens_details", "cache_read_tokens"],
                &["cache_read_input_tokens"],
            ],
        ),
        output_tokens: first_count(
            usage,
            &[&["completion_tokens"], &["output_tokens"], &["eval_count"]],
        ),
        reasoning_tokens: first_count(
            usage,
            &[
                &["completion_tokens_details", "reasoning_tokens"],
                &["output_tokens_details", "reasoning_tokens"],
            ],
        ),
        actual_model: response_text(value, "model"),
        service_tier: response_text(value, "service_tier"),
        ..Default::default()
    };
    (!result.is_empty()).then_some(result)
}

pub(super) fn stream_token_usage(
    value: &serde_json::Value,
    provider_kind: Option<&str>,
) -> Option<TokenUsage> {
    let mut usage = parse_token_usage(value).unwrap_or_default();
    // OpenRouter usage.cost is the account charge, not upstream_inference_cost.
    // https://openrouter.ai/docs/cookbook/administration/usage-accounting
    if provider_kind == Some("openrouter") {
        usage.cache_write_tokens = count_at(
            value,
            &["usage", "prompt_tokens_details", "cache_write_tokens"],
        );
        usage.cost_usd = value
            .pointer("/usage/cost")
            .and_then(|v| v.as_f64())
            .filter(|cost| cost.is_finite() && *cost >= 0.0);
    }
    // Unit conversion of the billed amount, not a token-price estimate.
    // https://docs.x.ai/developers/cost-tracking (10^10 ticks = 1 USD)
    if provider_kind == Some("xai") {
        usage.cost_usd = count_at(value, &["usage", "cost_in_usd_ticks"])
            .map(|ticks| ticks as f64 / 10_000_000_000.0);
    }
    if provider_kind == Some("llama_cpp") && usage.cached_input_tokens.is_none() {
        usage.cached_input_tokens = count_at(value, &["timings", "cache_n"]);
    }
    (!usage.is_empty()).then_some(usage)
}

pub(super) fn response_text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get(key)?
        .as_str()
        .filter(|text| !text.trim().is_empty())
        .map(str::to_owned)
}

pub(super) fn merge_token_usage(previous: Option<TokenUsage>, incoming: TokenUsage) -> TokenUsage {
    let previous = previous.unwrap_or_default();
    TokenUsage {
        input_tokens: incoming.input_tokens.or(previous.input_tokens),
        cached_input_tokens: incoming
            .cached_input_tokens
            .or(previous.cached_input_tokens),
        cache_write_tokens: incoming.cache_write_tokens.or(previous.cache_write_tokens),
        output_tokens: incoming.output_tokens.or(previous.output_tokens),
        reasoning_tokens: incoming.reasoning_tokens.or(previous.reasoning_tokens),
        cost_usd: incoming.cost_usd.or(previous.cost_usd),
        actual_model: incoming.actual_model.or(previous.actual_model),
        service_tier: incoming.service_tier.or(previous.service_tier),
        connection_name: incoming.connection_name.or(previous.connection_name),
    }
}
