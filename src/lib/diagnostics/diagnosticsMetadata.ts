import { PROVIDERS } from '../ai/connections/providers.ts';
const providers = new Set<string>(PROVIDERS.map(provider => provider.kind));

/** Explicit projection: do not spread settings or serialize arbitrary model IDs/URLs. */
export function diagnosticsMetadata(connection: { providerKind?: unknown; model?: unknown }, summaryEnabled: boolean) {
  return {
    provider: typeof connection.providerKind === 'string' && providers.has(connection.providerKind) ? connection.providerKind : 'unknown',
    modelConfigured: typeof connection.model === 'string' && connection.model.trim().length > 0,
    summaryEnabled: summaryEnabled === true,
  };
}
