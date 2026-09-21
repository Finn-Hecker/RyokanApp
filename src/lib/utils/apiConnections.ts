import { invoke } from '@tauri-apps/api/core';
import { appState, createDefaultConnection, replaceApiConnections, type ApiConnection, type DetectedContextMetadata, type ProviderKind } from '$lib/stores/appState.svelte';
import type { SettingRow } from '$lib/utils/settings';
import { acceptDetectedContext, connectionIdentity, resolvedHardContextLimit, validContextSize } from '$lib/utils/connectionCore';
export { acceptDetectedContext, connectionIdentity, CONSERVATIVE_CONTEXT_FALLBACK, deleteConnectionSafely, deriveWorkingContextTarget, resolvedHardContextLimit, validContextSize } from '$lib/utils/connectionCore';

export const API_CONNECTIONS_KEY = 'api_connections';
export const ACTIVE_API_CONNECTION_KEY = 'active_api_connection_id';
function normalizeConnection(value: Partial<ApiConnection>): ApiConnection {
  const fallback = createDefaultConnection(value.id || crypto.randomUUID(), value.name || 'Connection');
  const connection = { ...fallback, ...value, parameterEnabled: { ...fallback.parameterEnabled, ...value.parameterEnabled } };
  if (!validContextSize(connection.manualContextCap)) connection.manualContextCap = null;
  if (!connection.detectedContext || !validContextSize(connection.detectedContext.tokens)) connection.detectedContext = null;
  connection.contextLimit = resolvedHardContextLimit(connection);
  return connection;
}

export function hydrateApiConnections(settings: SettingRow[]): void {
  const values = new Map(settings.map(row => [row.key, row.value]));
  try {
    const parsed = JSON.parse(values.get(API_CONNECTIONS_KEY) ?? '[]');
    replaceApiConnections(Array.isArray(parsed) ? parsed.map(normalizeConnection) : [], values.get(ACTIVE_API_CONNECTION_KEY) ?? '');
  } catch {
    replaceApiConnections([createDefaultConnection()], 'default');
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

export async function refreshContextDetection(connection: ApiConnection): Promise<DetectedContextMetadata | null> {
  const identity = connectionIdentity(connection.providerKind, connection.url, connection.model);
  try {
    const result = await invoke<DetectedContextMetadata>('detect_context', { providerKind: connection.providerKind, baseUrl: connection.url, model: connection.model, apiKey: connection.apiKey });
    if (identity !== connectionIdentity(connection.providerKind, connection.url, connection.model)) return null;
    const accepted = acceptDetectedContext(connection.detectedContext, result);
    if (accepted !== result) throw new Error('Provider returned an invalid context size.');
    connection.detectedContext = accepted;
    connection.contextDetectionError = null;
    connection.contextLimit = resolvedHardContextLimit(connection);
    return result;
  } catch (error) {
    if (identity === connectionIdentity(connection.providerKind, connection.url, connection.model)) {
      connection.contextDetectionError = error instanceof Error ? error.message : String(error);
      connection.contextLimit = resolvedHardContextLimit(connection);
    }
    return null;
  }
}

export const PROVIDER_LABELS: Record<ProviderKind, string> = {
  openrouter: 'OpenRouter', lm_studio: 'LM Studio', llama_cpp: 'llama.cpp', koboldcpp: 'KoboldCpp',
  ollama: 'Ollama', openai: 'OpenAI', xai: 'xAI / Grok', generic_openai: 'Generic OpenAI-compatible',
};
