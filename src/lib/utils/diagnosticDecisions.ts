import { invoke } from '@tauri-apps/api/core';

// Correlation is local to this WebView session. Raw identities never leave this map.
let serial = Math.floor(Math.random() * 0x4000_0000);
const scopes = new Map<string, number>();
export function diagnosticScope(identity: string): number {
  const previous = scopes.get(identity);
  if (previous !== undefined) return previous;
  if (scopes.size >= 256) scopes.delete(scopes.keys().next().value!);
  const next = ++serial;
  scopes.set(identity, next);
  return next;
}
export function diagnosticOperation(): number { return ++serial; }
export function diagnosticConnection(connection: { id: string; providerKind: string; url: string; model: string }): number {
  return diagnosticScope(JSON.stringify([connection.id, connection.providerKind, connection.url, connection.model]));
}

export interface DiagnosticMeasurement {
  budget_details: {
    total_limit: number | null; reasoning_limit: number | null;
    invalid_total_limit: boolean; invalid_reasoning_limit: boolean;
    reasoning_enabled: boolean; reasoning_ambiguous: boolean;
  };
  prompt_tokens: number;
  local_tokens: number;
  additional_tokens: number;
  reserve_tokens: number;
  safety_tokens: number;
  total: number;
  hard_limit: number;
  known_total_limit: boolean;
  max_tokens_enabled: boolean;
  thinking_budget_enabled: boolean;
  payload_max_tokens: number;
  payload_thinking_budget: number;
  anchor: 'none' | 'history_changed' | 'summary_changed' | 'configuration_changed' | 'revision_changed' | 'response_changed' | 'usage_unavailable' | 'no_common_prefix' | 'reused';
}

export type DiagnosticDecision =
  | { kind: 'summary_capacity'; operation: number; connection: number; stage: 'pressure' | 'request'; input_tokens: number; output_reserve: number; safety_tokens: number; hard_limit: number; output_cap: number; fits: boolean }
  | { kind: 'detection'; connection: number; provider: 'openrouter' | 'lm_studio' | 'llama_cpp' | 'koboldcpp' | 'ollama' | 'openai' | 'xai' | 'generic_openai' | 'unknown'; outcome: 'applied' | 'failed' | 'stale' | 'invalidated' | 'no_model'; cached: boolean; detected_tokens: number | null; manual_cap: number | null; hard_limit: number; provenance: 'runtime' | 'provider_advertised' | 'theoretical' | 'kobold_true_max' | 'kobold_config_fallback' | 'unknown' }
  | { kind: 'budget'; operation: number; conversation: number; connection: number; strategy: 'economy' | 'balanced' | 'maximum'; compression_goal: number; stage: 'decision' | 'memory_disabled' | 'irreducible' | 'final_guard' | 'after_compression' | 'fallback'; measurement: DiagnosticMeasurement; working_target: number; summary_limit: number; summary_pressure: boolean; trigger: 'none' | 'chat' | 'summary' | 'both' | 'disabled'; history_count: number; marker_index: number; has_summary: boolean; revision: number; retry: boolean }
  | { kind: 'summary_state'; operation: number; conversation: number; connection: number; state: 'started' | 'marker_reset' | 'compression_plan' | 'recompress' | 'result' | 'committed' | 'rolled_back' | 'conflict' | 'cancelled' | 'failed' | 'fallback_accepted' | 'fallback_rejected' | 'ready'; reason: 'none' | 'marker_invalid' | 'retry_boundary' | 'selection_changed' | 'context_shrunk' | 'revision_changed' | 'chat_changed' | 'explicit_cancel' | 'budget' | 'request_failed'; message_count: number; retained_count: number; summary_tokens: number | null; output_cap: number; revision: number }
  | { kind: 'usage'; operation: number; request: number; connection: number; purpose: 'chat' | 'summary'; local_input_tokens: number | null; input_tokens: number | null; cached_input_tokens: number | null; output_tokens: number | null; reasoning_tokens: number | null; reserve_tokens: number | null };

/** Fixed schemas only. Rust validates every field again before persistence/export.
 * Do not pass errors, settings, fingerprints or request/response objects here.
 * Decision events are not deduplicated: two quick generations may decide differently.
 */
export function traceDecision(decision: DiagnosticDecision): void {
  try { void invoke('record_diagnostic_decision', { decision }).catch(() => {}); }
  catch { /* Optional diagnostics never affect generation. */ }
}
