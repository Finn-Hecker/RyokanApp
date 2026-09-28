import type { ApiParameterKey } from './apiParameters';

export type GenerationCapabilitySource = 'model_metadata' | 'api_contract' | 'unknown';
export interface GenerationCapabilities {
  source: GenerationCapabilitySource;
  /** API field names, not UI labels. An absent field is never assumed supported. */
  supportedParameters: string[];
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

function isOpenRouterUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return host === 'openrouter.ai' || host.endsWith('.openrouter.ai');
  } catch { return false; }
}

export function modelGenerationCapabilities(connection: GenerationConnection, supportedParameters: unknown): SavedGenerationCapabilities | null {
  if (connection.providerKind !== 'openrouter' || !isOpenRouterUrl(connection.url) || !Array.isArray(supportedParameters)
    || !supportedParameters.every(item => typeof item === 'string')) return null;
  return { providerKind: connection.providerKind, url: connection.url, model: connection.model,
    source: 'model_metadata', supportedParameters: [...new Set(supportedParameters)] };
}

export function resolveGenerationCapabilities(connection: GenerationConnection): GenerationCapabilities {
  const saved = connection.generationCapabilities;
  if (connection.providerKind === 'openrouter' && isOpenRouterUrl(connection.url) && saved?.source === 'model_metadata'
    && saved.providerKind === connection.providerKind && saved.url === connection.url && saved.model === connection.model
    && Array.isArray(saved.supportedParameters)) return saved;
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
  return capabilities.source === 'model_metadata' ? 'unreported' : 'unknown';
}
