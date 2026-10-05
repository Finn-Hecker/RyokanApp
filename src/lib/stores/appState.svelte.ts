import { createDefaultApiParameterEnabled, type ApiParameterKey } from '$lib/ai/connections/apiParameters';
import type { ReasoningLevel, SavedGenerationCapabilities, ServiceTier } from '$lib/ai/connections/generationCapabilities';
import { CONSERVATIVE_CONTEXT_FALLBACK, resolvedHardContextLimit, resolveSummaryConnection, SAME_AS_CHAT_CONNECTION } from '$lib/ai/connections/connectionCore';

import type { TextRule } from '$lib/ai/prompt/textRules';
import type { ProviderKind } from '$lib/ai/connections/providers';
export type { ProviderKind } from '$lib/ai/connections/providers';
import type { ContextStrategy } from '$lib/ai/connections/connectionCore';
export type { ContextStrategy } from '$lib/ai/connections/connectionCore';
export type ContextProvenance = 'runtime' | 'provider_advertised' | 'theoretical' | 'kobold_true_max' | 'kobold_config_fallback';

export interface DetectedContextMetadata {
  tokens: number;
  provenance: ContextProvenance;
  providerKind: ProviderKind;
  model: string;
  detectedAt: string;
  theoreticalTokens?: number | null;
  error?: string | null;
}

export interface ApiSettings {
  url: string;
  apiKey: string;
  model: string;
  systemPrompt: string;
  temperature: number;
  maxTokens: number;
  presencePenalty: number;
  topP: number;
  topK: number;
  minP: number;
  frequencyPenalty: number;
  contextLimit: number;
  thinkingBudget: number;
  reasoningLevel: ReasoningLevel;
  customMode: boolean;
  additionalApiParameters: string;
}

export interface ApiConnection extends ApiSettings {
  serviceTier: ServiceTier;
  id: string;
  name: string;
  providerKind: ProviderKind;
  parameterEnabled: Record<ApiParameterKey, boolean>;
  generationCapabilities?: SavedGenerationCapabilities | null;
  manualContextCap: number | null;
  detectedContext: DetectedContextMetadata | null;
  contextDetectionError: string | null;
  contextStrategy: ContextStrategy;
}

export const DEFAULT_CONNECTION_ID = 'default';

export function createDefaultConnection(id = DEFAULT_CONNECTION_ID, name = 'Default'): ApiConnection {
  return {
    id, name, providerKind: 'lm_studio', url: 'http://127.0.0.1:1234/v1', apiKey: '', model: '', systemPrompt: '',
    temperature: 0.8, thinkingBudget: 2500, reasoningLevel: 'auto', maxTokens: 300, presencePenalty: 1.12, topP: 0.9,
    topK: 40, minP: 0.05, frequencyPenalty: 0, contextLimit: CONSERVATIVE_CONTEXT_FALLBACK, manualContextCap: null,
    detectedContext: null, contextDetectionError: null, contextStrategy: 'balanced', serviceTier: 'auto',
    parameterEnabled: createDefaultApiParameterEnabled(), customMode: false, additionalApiParameters: '',
  };
}

export type InteractionMode = 'desktop' | 'mobile';

const initialConnection = createDefaultConnection();

export const appState = $state({
  currentView: 'lobby' as 'lobby' | 'chat' | 'create' | 'settings' | 'roleEditor' | 'worldInfoEditor' | 'list' | 'play' | 'multiplayerRoom',
  activeCharacter: null as any,
  editingCharacter: null as any,
  isOnboarding: false,
  pendingUiLocale: '',
  interactionMode: 'desktop' as InteractionMode,
  chatFontScale: 100,
  listTab: 'worldinfo' as 'roles' | 'worldinfo',
  apiConnections: [initialConnection] as ApiConnection[],
  activeApiConnectionId: initialConnection.id,
  apiSettings: initialConnection as ApiConnection,
  textRules: [] as TextRule[],
  longTermMemory: true,
  summaryConnectionId: SAME_AS_CHAT_CONNECTION,
});

export function activateApiConnection(id: string): boolean {
  const connection = appState.apiConnections.find(item => item.id === id);
  if (!connection) return false;
  appState.activeApiConnectionId = id;
  appState.apiSettings = connection;
  return true;
}

export function replaceApiConnections(connections: ApiConnection[], activeId: string): void {
  const safe = connections.length ? connections : [createDefaultConnection()];
  appState.apiConnections = safe;
  activateApiConnection(safe.some(item => item.id === activeId) ? activeId : safe[0].id);
}

/** Converts a possibly reactive Svelte connection proxy into immutable plain data. */
export function snapshotApiConnection(connection: ApiConnection): ApiConnection {
  const snapshot = $state.snapshot(connection);
  return {
    ...snapshot,
    contextLimit: resolvedHardContextLimit(snapshot),
    parameterEnabled: { ...snapshot.parameterEnabled },
    detectedContext: snapshot.detectedContext ? { ...snapshot.detectedContext } : null,
  };
}

export function snapshotActiveApiConnection(): ApiConnection {
  return snapshotApiConnection(appState.apiSettings);
}

export function snapshotSummaryApiConnection(chatSnapshot: ApiConnection): ApiConnection {
  return snapshotApiConnection(resolveSummaryConnection(
    appState.apiConnections,
    appState.summaryConnectionId,
    chatSnapshot,
  ));
}
