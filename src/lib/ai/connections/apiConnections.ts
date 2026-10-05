import { invoke } from '@tauri-apps/api/core';
import { traceDecision, diagnosticConnection, type DiagnosticDecision } from '$lib/diagnostics/diagnosticDecisions';
import { appState, createDefaultConnection, replaceApiConnections, type ApiConnection, type DetectedContextMetadata } from '$lib/stores/appState.svelte';
import type { SettingRow } from '$lib/settings/settings';
import { normalizeServiceTier } from '$lib/ai/connections/generationCapabilities';
import { acceptDetectedContext, connectionIdentity, resolveMemorySettings, resolvedHardContextLimit, SAME_AS_CHAT_CONNECTION, validContextSize } from '$lib/ai/connections/connectionCore';
export { acceptDetectedContext, adaptiveSummaryOutputCap, connectionIdentity, CONSERVATIVE_CONTEXT_FALLBACK, deleteConnectionSafely, deriveWorkingContextTarget, normalizeSummaryConnectionId, resolveMemorySettings, resolveSummaryConnection, resolvedHardContextLimit, SAME_AS_CHAT_CONNECTION, shouldTriggerSummary, summaryCompressionGoal, validContextSize } from '$lib/ai/connections/connectionCore';

export const API_CONNECTIONS_KEY = 'api_connections';
export const ACTIVE_API_CONNECTION_KEY = 'active_api_connection_id';
export const LONG_TERM_MEMORY_KEY = 'long_term_memory_enabled';
export const SUMMARY_CONNECTION_KEY = 'summary_api_connection_id';
// Share automatic lookups between Memory settings, chat, and summary snapshots.
// Retry failures too; persisted runtime metadata is revalidated after restart.
const detectionRequests = new Map<string, { expires: number; result: Promise<DetectedContextMetadata> }>();
function traceDetection(connection: ApiConnection, outcome: Extract<DiagnosticDecision, { kind: 'detection' }>['outcome'], cached = false): void {
  traceDecision({ kind: 'detection', connection: diagnosticConnection(connection), provider: connection.providerKind, outcome, cached,
    detected_tokens: connection.detectedContext?.tokens ?? null, manual_cap: connection.manualContextCap,
    hard_limit: resolvedHardContextLimit(connection), provenance: connection.detectedContext?.provenance ?? 'unknown' });
}
function normalizeConnection(value: Partial<ApiConnection>, legacy: Map<string, string>): ApiConnection {
  const fallback = createDefaultConnection(value.id || crypto.randomUUID(), value.name || 'Connection');
  // Older profile records may predate some generation fields. Copy legacy values
  // only for missing fields; an explicit profile value always wins.
  const legacyNumbers = {
    temperature: 'api_temperature', maxTokens: 'api_max_tokens', presencePenalty: 'api_presence_penalty',
    thinkingBudget: 'api_thinking_budget', topP: 'api_top_p', topK: 'api_top_k',
    minP: 'api_min_p', frequencyPenalty: 'api_frequency_penalty',
  } as const;
  const generation = {} as Partial<ApiConnection>;
  for (const [field, key] of Object.entries(legacyNumbers) as [keyof typeof legacyNumbers, string][]) {
    if (value[field] == null) {
      const parsed = Number(legacy.get(key));
      if (legacy.has(key) && Number.isFinite(parsed)) (generation as any)[field] = parsed;
    }
  }
  if (value.additionalApiParameters == null && legacy.has('api_additional_parameters')) {
    generation.additionalApiParameters = legacy.get('api_additional_parameters') ?? '';
  }
  const enabled = { ...fallback.parameterEnabled, ...value.parameterEnabled };
  const legacySwitches = {
    temperature: 'api_temperature_enabled', maxTokens: 'api_max_tokens_enabled',
    presencePenalty: 'api_presence_penalty_enabled', thinkingBudget: 'api_thinking_budget_enabled',
    topP: 'api_top_p_enabled', topK: 'api_top_k_enabled', minP: 'api_min_p_enabled',
    frequencyPenalty: 'api_frequency_penalty_enabled',
  } as const;
  for (const [field, key] of Object.entries(legacySwitches) as [keyof typeof legacySwitches, string][]) {
    if (value.parameterEnabled?.[field] == null && legacy.has(key)) enabled[field] = legacy.get(key) === 'true';
  }
  const connection = { ...fallback, ...generation, ...value, parameterEnabled: enabled };
  connection.serviceTier = normalizeServiceTier(connection.serviceTier);
  if (!['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(connection.reasoningLevel)) connection.reasoningLevel = 'auto';
  if (!validContextSize(connection.manualContextCap)) connection.manualContextCap = null;
  if (!connection.detectedContext || !validContextSize(connection.detectedContext.tokens)) connection.detectedContext = null;
  if (connection.detectedContext && (connection.detectedContext.model !== connection.model
    || connection.detectedContext.providerKind !== connection.providerKind)) connection.detectedContext = null;
  connection.contextLimit = resolvedHardContextLimit(connection);
  return connection;
}

export function hydrateApiConnections(settings: SettingRow[]): void {
  const values = new Map(settings.map(row => [row.key, row.value]));
  try {
    const parsed = JSON.parse(values.get(API_CONNECTIONS_KEY) ?? '[]');
    const profiles = Array.isArray(parsed) ? parsed.filter(value => value && typeof value === 'object' && !Array.isArray(value)) : [];
    replaceApiConnections(profiles.map(value => normalizeConnection(value, values)), values.get(ACTIVE_API_CONNECTION_KEY) ?? '');
    const memory = resolveMemorySettings(appState.apiConnections, values.get(LONG_TERM_MEMORY_KEY), values.get(SUMMARY_CONNECTION_KEY));
    appState.longTermMemory = memory.longTermMemory;
    appState.summaryConnectionId = memory.summaryConnectionId;
  } catch {
    replaceApiConnections([createDefaultConnection()], 'default');
    appState.longTermMemory = true;
    appState.summaryConnectionId = SAME_AS_CHAT_CONNECTION;
  }
}

export async function persistApiConnections(): Promise<void> {
  await invoke('save_api_connections', { connectionsJson: JSON.stringify(appState.apiConnections), activeConnectionId: appState.activeApiConnectionId });
}

export function invalidateDetectedContext(connection: ApiConnection): void {
  connection.detectedContext = null;
  connection.contextDetectionError = null;
  connection.contextLimit = resolvedHardContextLimit(connection);
  traceDetection(connection, 'invalidated');
}

export async function refreshContextDetection(connection: ApiConnection, force = true): Promise<DetectedContextMetadata | null> {
  const identity = connectionIdentity(connection.providerKind, connection.url, connection.model);
  const apiKey = connection.apiKey;
  const key = JSON.stringify([identity, apiKey]);
  let request = detectionRequests.get(key);
  const cached = !force && Boolean(request && request.expires > Date.now());
  const isCurrent = () => identity === connectionIdentity(connection.providerKind, connection.url, connection.model)
    && apiKey === connection.apiKey;
  const publish = () => {
    const live = appState.apiConnections.find(item => item.id === connection.id);
    if (live && live !== connection && live.apiKey === apiKey
      && connectionIdentity(live.providerKind, live.url, live.model) === identity) {
      live.detectedContext = connection.detectedContext;
      live.contextDetectionError = connection.contextDetectionError;
      live.contextLimit = resolvedHardContextLimit(live);
    }
  };
  try {
    if (force || !request || request.expires <= Date.now()) {
      request = {
        expires: Date.now() + 60_000,
        result: invoke<DetectedContextMetadata>('detect_context', { providerKind: connection.providerKind, baseUrl: connection.url, model: connection.model, apiKey }),
      };
      detectionRequests.set(key, request);
    }
    const result = await request.result;
    if (!isCurrent()) { traceDetection(connection, 'stale', cached); return null; }
    if (detectionRequests.get(key) !== request) return refreshContextDetection(connection, false);
    const accepted = acceptDetectedContext(connection.detectedContext, result);
    if (accepted !== result) throw new Error('Provider returned an invalid context size.');
    connection.detectedContext = accepted;
    connection.contextDetectionError = null;
    connection.contextLimit = resolvedHardContextLimit(connection);
    publish();
    traceDetection(connection, 'applied', cached);
    return result;
  } catch (error) {
    if (isCurrent()) {
      if (detectionRequests.get(key) !== request) return refreshContextDetection(connection, false);
      connection.contextDetectionError = error instanceof Error ? error.message : String(error);
      connection.contextLimit = resolvedHardContextLimit(connection);
      publish();
      traceDetection(connection, 'failed', cached);
    }
    return null;
  }
}

export async function ensureContextDetection(connection: ApiConnection): Promise<void> {
  if (connection.model) await refreshContextDetection(connection, false);
  else traceDetection(connection, 'no_model');
  connection.contextLimit = resolvedHardContextLimit(connection);
}

export { PROVIDER_LABELS } from './providers.ts';
