const providers = new Set(['openrouter', 'lm_studio', 'llama_cpp', 'koboldcpp', 'ollama', 'openai', 'xai', 'generic_openai']);

/** Explicit projection: do not spread settings or serialize arbitrary model IDs/URLs. */
export function diagnosticsMetadata(connection: { providerKind?: unknown; model?: unknown }, summaryEnabled: boolean) {
  return {
    provider: typeof connection.providerKind === 'string' && providers.has(connection.providerKind) ? connection.providerKind : 'unknown',
    modelConfigured: typeof connection.model === 'string' && connection.model.trim().length > 0,
    summaryEnabled: summaryEnabled === true,
  };
}
