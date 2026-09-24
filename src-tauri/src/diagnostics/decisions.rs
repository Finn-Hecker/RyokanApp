//! Privacy boundary for context/summary traces. No strings, maps, IDs or content.
use super::Provider;
use serde::{Deserialize, Serialize};

macro_rules! codes {
    ($name:ident { $($variant:ident),+ $(,)? }) => {
        #[derive(Deserialize, Serialize)]
        #[serde(rename_all = "snake_case")]
        pub enum $name { $($variant),+ }
    };
}
codes!(DetectionOutcome {
    Applied,
    Failed,
    Stale,
    Invalidated,
    NoModel
});
codes!(Provenance {
    Runtime,
    ProviderAdvertised,
    Theoretical,
    KoboldTrueMax,
    KoboldConfigFallback,
    Unknown
});
codes!(Stage {
    Decision,
    MemoryDisabled,
    Irreducible,
    FinalGuard,
    AfterCompression,
    Fallback
});
codes!(Trigger {
    None,
    Chat,
    Summary,
    Both,
    Disabled
});
codes!(Anchor {
    None,
    HistoryChanged,
    SummaryChanged,
    ConfigurationChanged,
    RevisionChanged,
    ResponseChanged,
    UsageUnavailable,
    NoCommonPrefix,
    Reused
});
codes!(SummaryState {
    Started,
    MarkerReset,
    CompressionPlan,
    Recompress,
    Result,
    Committed,
    RolledBack,
    Conflict,
    Cancelled,
    Failed,
    FallbackAccepted,
    FallbackRejected,
    Ready
});
codes!(Reason {
    None,
    MarkerInvalid,
    RetryBoundary,
    SelectionChanged,
    ContextShrunk,
    RevisionChanged,
    ChatChanged,
    ExplicitCancel,
    Budget,
    RequestFailed
});
codes!(Strategy {
    Economy,
    Balanced,
    Maximum
});
codes!(CapacityStage { Pressure, Request });
codes!(Purpose { Chat, Summary });

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct BudgetDetails {
    total_limit: Option<u64>,
    reasoning_limit: Option<u64>,
    invalid_total_limit: bool,
    invalid_reasoning_limit: bool,
    reasoning_enabled: bool,
    reasoning_ambiguous: bool,
}
#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Measurement {
    budget_details: BudgetDetails,
    prompt_tokens: u64,
    local_tokens: u64,
    additional_tokens: u64,
    reserve_tokens: u64,
    safety_tokens: u64,
    total: u64,
    hard_limit: u64,
    known_total_limit: bool,
    max_tokens_enabled: bool,
    thinking_budget_enabled: bool,
    payload_max_tokens: u64,
    payload_thinking_budget: u64,
    anchor: Anchor,
}

#[derive(Deserialize, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Decision {
    SummaryCapacity {
        operation: u32,
        connection: u32,
        stage: CapacityStage,
        input_tokens: u64,
        output_reserve: u64,
        safety_tokens: u64,
        hard_limit: u64,
        output_cap: u64,
        fits: bool,
    },
    Detection {
        connection: u32,
        provider: Provider,
        outcome: DetectionOutcome,
        cached: bool,
        detected_tokens: Option<u64>,
        manual_cap: Option<u64>,
        hard_limit: u64,
        provenance: Provenance,
    },
    Budget {
        operation: u32,
        conversation: u32,
        connection: u32,
        stage: Stage,
        strategy: Strategy,
        compression_goal: u64,
        measurement: Measurement,
        working_target: u64,
        summary_limit: u64,
        summary_pressure: bool,
        trigger: Trigger,
        history_count: u32,
        marker_index: i32,
        has_summary: bool,
        revision: u32,
        retry: bool,
    },
    SummaryState {
        operation: u32,
        conversation: u32,
        connection: u32,
        state: SummaryState,
        reason: Reason,
        message_count: u32,
        retained_count: u32,
        summary_tokens: Option<u64>,
        output_cap: u64,
        revision: u32,
    },
    Usage {
        operation: u32,
        request: u32,
        connection: u32,
        purpose: Purpose,
        local_input_tokens: Option<u64>,
        input_tokens: Option<u64>,
        cached_input_tokens: Option<u64>,
        output_tokens: Option<u64>,
        reasoning_tokens: Option<u64>,
        reserve_tokens: Option<u64>,
    },
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn decision_schema_rejects_content_at_every_depth() {
        let base = json!({"kind":"budget","operation":1,"conversation":2,"connection":3,
            "stage":"decision","strategy":"balanced","compression_goal":6553,
            "measurement": {"prompt_tokens":1000,"local_tokens":800,"additional_tokens":10,
                "reserve_tokens":1024,"safety_tokens":164,"total":2188,"hard_limit":8192,
                "known_total_limit":false,"max_tokens_enabled":false,"thinking_budget_enabled":false,
                "payload_max_tokens":300,"payload_thinking_budget":0,"anchor":"reused",
                "budget_details":{"total_limit":null,"reasoning_limit":null,"invalid_total_limit":false,
                    "invalid_reasoning_limit":false,"reasoning_enabled":true,"reasoning_ambiguous":false}},
            "working_target":8192,"summary_limit":4096,"summary_pressure":false,"trigger":"none",
            "history_count":10,"marker_index":-1,"has_summary":false,"revision":0,"retry":false});
        assert!(serde_json::from_value::<Decision>(base.clone()).is_ok());
        for path in ["", "/measurement", "/measurement/budget_details"] {
            for key in [
                "api_key",
                "authorization",
                "prompt",
                "chat",
                "summary",
                "character",
                "role",
                "lorebook",
                "encryption_key",
                "fingerprint",
                "model",
            ] {
                let mut private = base.clone();
                private
                    .pointer_mut(path)
                    .unwrap()
                    .as_object_mut()
                    .unwrap()
                    .insert(key.into(), json!("PRIVATE_DATA"));
                assert!(serde_json::from_value::<Decision>(private).is_err());
            }
        }
        for (path, value) in [
            ("/operation", json!("private-id")),
            ("/trigger", json!("private content")),
            ("/measurement/prompt_tokens", json!("123 secret")),
            ("/measurement/local_tokens", json!(-1)),
        ] {
            let mut private = base.clone();
            *private.pointer_mut(path).unwrap() = value;
            assert!(serde_json::from_value::<Decision>(private).is_err());
        }
    }
}
