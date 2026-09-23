import { invoke } from '@tauri-apps/api/core';
import { appState, createDefaultConnection, replaceApiConnections, type ApiConnection, type DetectedContextMetadata, type ProviderKind } from '$lib/stores/appState.svelte';
import type { SettingRow } from '$lib/utils/settings';
import { acceptDetectedContext, connectionIdentity, resolveMemorySettings, resolvedHardContextLimit, SAME_AS_CHAT_CONNECTION, validContextSize } from '$lib/utils/connectionCore';
export { acceptDetectedContext, adaptiveSummaryOutputCap, connectionIdentity, CONSERVATIVE_CONTEXT_FALLBACK, deleteConnectionSafely, deriveWorkingContextTarget, normalizeSummaryConnectionId, resolveMemorySettings, resolveSummaryConnection, resolvedHardContextLimit, SAME_AS_CHAT_CONNECTION, shouldTriggerSummary, summaryCompressionGoal, validContextSize } from '$lib/utils/connectionCore';

export const API_CONNECTIONS_KEY = 'api_connections';
export const ACTIVE_API_CONNECTION_KEY = 'active_api_connection_id';
export const LONG_TERM_MEMORY_KEY = 'long_term_memory_enabled';
export const SUMMARY_CONNECTION_KEY = 'summary_api_connection_id';
// Share automatic lookups between Memory settings, chat, and summary snapshots.
// Retry failures too; persisted runtime metadata is revalidated after restart.
const detectionRequests = new Map<string, { expires: number; result: Promise<DetectedContextMetadata> }>();
function normalizeConnection(value: Partial<ApiConnection>): ApiConnection {
  const fallback = createDefaultConnection(value.id || crypto.randomUUID(), value.name || 'Connection');
  const connection = { ...fallback, ...value, parameterEnabled: { ...fallback.parameterEnabled, ...value.parameterEnabled } };
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
    replaceApiConnections(Array.isArray(parsed) ? parsed.map(normalizeConnection) : [], values.get(ACTIVE_API_CONNECTION_KEY) ?? '');
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
}

export async function refreshContextDetection(connection: ApiConnection, force = true): Promise<DetectedContextMetadata | null> {
  const identity = connectionIdentity(connection.providerKind, connection.url, connection.model);
  const apiKey = connection.apiKey;
  const key = JSON.stringify([identity, apiKey]);
  let request = detectionRequests.get(key);
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
    if (!isCurrent()) return null;
    if (detectionRequests.get(key) !== request) return refreshContextDetection(connection, false);
    const accepted = acceptDetectedContext(connection.detectedContext, result);
    if (accepted !== result) throw new Error('Provider returned an invalid context size.');
    connection.detectedContext = accepted;
    connection.contextDetectionError = null;
    connection.contextLimit = resolvedHardContextLimit(connection);
    publish();
    return result;
  } catch (error) {
    if (isCurrent()) {
      if (detectionRequests.get(key) !== request) return refreshContextDetection(connection, false);
      connection.contextDetectionError = error instanceof Error ? error.message : String(error);
      connection.contextLimit = resolvedHardContextLimit(connection);
      publish();
    }
    return null;
  }
}

export async function ensureContextDetection(connection: ApiConnection): Promise<void> {
  if (connection.model) await refreshContextDetection(connection, false);
  connection.contextLimit = resolvedHardContextLimit(connection);
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  openrouter: 'OpenRouter', lm_studio: 'LM Studio', llama_cpp: 'llama.cpp', koboldcpp: 'KoboldCpp',
  ollama: 'Ollama', openai: 'OpenAI', xai: 'xAI / Grok', generic_openai: 'Generic OpenAI-compatible',
};
