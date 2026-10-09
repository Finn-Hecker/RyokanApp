import { fetchModels, type ModelInfo } from '$lib/settings/settings';
import { PROVIDERS, type ProviderKind } from './providers';

const catalogs = new Map<string, { models?: ModelInfo[]; pending?: Promise<ModelInfo[]> }>();
const MAX_CATALOGS = 8;

export async function warmModelCatalog(connection: { url: string; apiKey: string; providerKind: ProviderKind; customMode: boolean }): Promise<void> {
  const local = PROVIDERS.find(provider => provider.kind === connection.providerKind)?.tab === 'local';
  if (!connection.url.trim() || !(local || connection.customMode || connection.apiKey.trim())) return;
  try { await ensureModelsLoaded(connection.url, connection.apiKey, connection.providerKind); } catch {
    // Settings surface provider failures and retain an explicit retry action.
  }
}

function key(url: string, apiKey: string, providerKind?: string): string {
  return JSON.stringify([url, apiKey, providerKind]);
}

export function cachedModels(url: string, apiKey: string, providerKind?: string): ModelInfo[] | undefined {
  const models = catalogs.get(key(url, apiKey, providerKind))?.models;
  return models ? structuredClone(models) : undefined;
}

/** Catalogs survive settings remounts. A retry explicitly refreshes this identity. */
export function ensureModelsLoaded(url: string, apiKey: string, providerKind?: string, refresh = false): Promise<ModelInfo[]> {
  const identity = key(url, apiKey, providerKind);
  const existing = catalogs.get(identity);
  if (existing?.pending) return existing.pending.then(models => structuredClone(models));
  if (!refresh && existing?.models) return Promise.resolve(structuredClone(existing.models));
  const entry = existing ?? {};
  catalogs.delete(identity);
  catalogs.set(identity, entry);
  while (catalogs.size > MAX_CATALOGS) catalogs.delete(catalogs.keys().next().value!);
  entry.pending = fetchModels(url, apiKey, providerKind).then(models => {
    entry.models = structuredClone(models);
    return models;
  }).finally(() => { entry.pending = undefined; });
  return entry.pending.then(models => structuredClone(models));
}
