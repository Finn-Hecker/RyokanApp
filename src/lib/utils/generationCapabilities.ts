import type { ApiParameterKey } from './apiParameters';

export type GenerationCapabilitySource = 'model_metadata' | 'api_contract' | 'unknown';
export interface GenerationCapabilities {
  source: GenerationCapabilitySource;
  /** API field names, not UI labels. An absent field is never assumed supported. */
  supportedParameters: string[];
  /** null means the provider did not disclose support; levels null means unknown. */
  reasoningSupported?: boolean | null;
  reasoningEffortLevels?: ReasoningLevel[] | null;
}
export interface SavedGenerationCapabilities extends GenerationCapabilities {
  providerKind: string;
  url: string;
  model: string;
}
export interface GenerationConnection {
  providerKind: string;
  url: string;
  model: string;
  generationCapabilities?: SavedGenerationCapabilities | null;
}

// These are endpoint contracts, not guesses based on model IDs. For services
// with model-specific restrictions and no capability metadata, stay unknown.
// Sources: llama.cpp tools/server/README.md; LM Studio
// /docs/developer/openai-compat/chat-completions; KoboldCpp's API reference;
// Ollama /api/openai-compatibility. The latter explicitly lists chat fields.
const API_CONTRACTS: Record<string, readonly string[]> = {
  llama_cpp: ['temperature', 'max_tokens', 'top_p', 'top_k', 'min_p', 'frequency_penalty'],
  lm_studio: ['temperature', 'max_tokens', 'top_p', 'top_k', 'presence_penalty', 'frequency_penalty'],
  koboldcpp: ['temperature', 'max_tokens', 'top_p', 'top_k', 'min_p'],
  ollama: ['temperature', 'top_p', 'max_tokens', 'presence_penalty', 'frequency_penalty'],
};

export const GENERATION_PARAMETER_FIELDS: Record<ApiParameterKey, string> = {
  temperature: 'temperature', maxTokens: 'max_tokens', presencePenalty: 'repetition_penalty',
  thinkingBudget: 'thinking_budget_tokens', topP: 'top_p', topK: 'top_k',
  minP: 'min_p', frequencyPenalty: 'frequency_penalty',
};
export type GenerationParameterStatus = 'supported' | 'unreported' | 'unknown';
export type ReasoningLevel = 'auto' | 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max';
export type ReasoningDialect = 'openrouter' | 'lm_studio' | 'llama_cpp_effort';
export interface ReasoningCapability {
  dialect: ReasoningDialect;
  levels: ReasoningLevel[];
  certainty: 'model_metadata' | 'unknown_levels';
}
// LM Studio's native model metadata also names "off"/"on". Those values are
// documented for /api/v1/chat, but not for this client's /v1/chat/completions.
const LM_CHAT_EFFORT_LEVELS: readonly ReasoningLevel[] = ['low', 'medium', 'high'];
const UNCONFIRMED_EFFORT_LEVELS: readonly ReasoningLevel[] = ['low', 'medium', 'high'];
const OPENROUTER_EFFORT_LEVELS: readonly ReasoningLevel[] = ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'];

/** Only provider metadata for the selected model may populate effort choices. */
export function reasoningCapability(connection: GenerationConnection): ReasoningCapability | null {
  if (!connection.model) return null;
  const metadata = resolveGenerationCapabilities(connection);
  if (connection.providerKind === 'openrouter' && isOpenRouterUrl(connection.url)
    && (metadata.reasoningSupported === true || metadata.supportedParameters.includes('reasoning'))) {
    return { dialect: 'openrouter', levels: ['auto', ...(metadata.reasoningEffortLevels == null
      ? UNCONFIRMED_EFFORT_LEVELS : OPENROUTER_EFFORT_LEVELS.filter(level => metadata.reasoningEffortLevels!.includes(level)))],
      certainty: metadata.reasoningEffortLevels == null ? 'unknown_levels' : 'model_metadata' };
  }
  if (connection.providerKind === 'lm_studio' && metadata.reasoningSupported === true) {
    const levels = (metadata.reasoningEffortLevels ?? []).filter(level => LM_CHAT_EFFORT_LEVELS.includes(level));
    return { dialect: 'lm_studio', levels: ['auto', ...(metadata.reasoningEffortLevels == null
      ? UNCONFIRMED_EFFORT_LEVELS : levels)],
      certainty: metadata.reasoningEffortLevels == null ? 'unknown_levels' : 'model_metadata' };
  }
  if (connection.providerKind === 'llama_cpp' && metadata.reasoningSupported === true) {
    return { dialect: 'llama_cpp_effort', levels: ['auto', ...UNCONFIRMED_EFFORT_LEVELS], certainty: 'unknown_levels' };
  }
  return null;
}

export function reasoningDialect(connection: GenerationConnection): ReasoningDialect | null {
  return reasoningCapability(connection)?.dialect ?? null;
}

function isOpenRouterUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch { return false; }
}

export function modelGenerationCapabilities(connection: GenerationConnection, supportedParameters: unknown,
  reasoning?: { supported?: boolean | null; allowedOptions?: unknown } | null): SavedGenerationCapabilities | null {
  if (connection.providerKind === 'openrouter' && isOpenRouterUrl(connection.url)
    && (Array.isArray(supportedParameters) && supportedParameters.every(item => typeof item === 'string')
      || reasoning?.supported === true)) {
    const options = reasoning?.allowedOptions;
    const levels = Array.isArray(options)
      ? OPENROUTER_EFFORT_LEVELS.filter(level => options.includes(level)) : null;
    return { providerKind: connection.providerKind, url: connection.url, model: connection.model,
      source: 'model_metadata', supportedParameters: Array.isArray(supportedParameters)
        ? [...new Set(supportedParameters.filter((item): item is string => typeof item === 'string'))] : [],
      reasoningSupported: reasoning?.supported === true || Array.isArray(supportedParameters) && supportedParameters.includes('reasoning'),
      reasoningEffortLevels: levels };
  }
  if ((connection.providerKind === 'lm_studio' || connection.providerKind === 'llama_cpp') && reasoning?.supported === true) {
    const levels = Array.isArray(reasoning.allowedOptions)
      ? reasoning.allowedOptions.filter((item): item is ReasoningLevel => typeof item === 'string' && LM_CHAT_EFFORT_LEVELS.includes(item as ReasoningLevel))
      : null;
    return { providerKind: connection.providerKind, url: connection.url, model: connection.model,
      source: 'model_metadata', supportedParameters: [], reasoningSupported: true,
      reasoningEffortLevels: levels ? [...new Set(levels)] : null };
  }
  return null;
}

export function resolveGenerationCapabilities(connection: GenerationConnection): GenerationCapabilities {
  const saved = connection.generationCapabilities;
  if ((connection.providerKind === 'openrouter' && isOpenRouterUrl(connection.url)
    || connection.providerKind === 'lm_studio' || connection.providerKind === 'llama_cpp') && saved?.source === 'model_metadata'
    && saved.providerKind === connection.providerKind && saved.url === connection.url && saved.model === connection.model
    && Array.isArray(saved.supportedParameters)) {
    return connection.providerKind === 'lm_studio' || connection.providerKind === 'llama_cpp'
      ? { ...saved, supportedParameters: [...API_CONTRACTS[connection.providerKind]] }
      : saved;
  }
  const contract = API_CONTRACTS[connection.providerKind];
  return contract
    ? { source: 'api_contract', supportedParameters: [...contract] }
    : { source: 'unknown', supportedParameters: [] };
}

export function generationParameterStatus(connection: GenerationConnection, key: ApiParameterKey): GenerationParameterStatus {
  const capabilities = resolveGenerationCapabilities(connection);
  if (capabilities.supportedParameters.includes(GENERATION_PARAMETER_FIELDS[key])) return 'supported';
  // Only a model-specific advertised list can justify a warning. Missing
  // metadata and incomplete endpoint contracts say nothing about this model.
  return capabilities.source === 'model_metadata' && connection.providerKind === 'openrouter' ? 'unreported' : 'unknown';
}
