import type { ApiConnection } from '../../stores/appState.svelte';
import { PROVIDERS, type ProviderKind } from '../connections/providers.ts';
import type { ReasoningLevel, ServiceTier } from '../connections/generationCapabilities';
import { validateAdditionalApiParameters } from '../connections/additionalApiParameters.ts';

export const PRESETS_KEY = 'generation_presets_v1';
export const MAX_PRESET_BYTES = 1_000_000;
export const SAMPLING_KEYS = ['temperature', 'repetitionPenalty', 'topP', 'topK', 'minP', 'frequencyPenalty'] as const;
type SamplingKey = typeof SAMPLING_KEYS[number];
const RESTORE_KEYS = [...SAMPLING_KEYS, 'maxTokens', 'thinkingBudget', 'reasoningLevel', 'serviceTier',
  'additionalApiParameters', 'systemPrompt', 'postHistoryPrompt'] as const;
const RESTORE_PARAMETER_KEYS = [...SAMPLING_KEYS, 'maxTokens', 'thinkingBudget'] as const;
const PROVIDER_RESTORE_KEYS = ['maxTokens', 'thinkingBudget', 'reasoningLevel', 'serviceTier', 'additionalApiParameters'] as const;
export type PresetRestoreSnapshot = Pick<ApiConnection, typeof RESTORE_KEYS[number]> & {
  parameterEnabled: Pick<ApiConnection['parameterEnabled'], typeof RESTORE_PARAMETER_KEYS[number]>;
};

/** Profile-local manual baseline. Keep original custom JSON formatting and disabled values. */
export function capturePresetRestore(connection: ApiConnection): PresetRestoreSnapshot {
  // Private profile data is not a portable preset. Preserve raw custom JSON,
  // including URLs, formatting and unfinished editor drafts.
  return {
    ...Object.fromEntries(RESTORE_KEYS.map(key => [key, connection[key]])),
    parameterEnabled: Object.fromEntries(RESTORE_PARAMETER_KEYS.map(key => [key, connection.parameterEnabled[key]])),
  } as PresetRestoreSnapshot;
}

/** Reconstruct the persisted allowlist; unrelated profile data cannot enter the snapshot. */
export function normalizePresetRestore(value: unknown): PresetRestoreSnapshot | undefined {
  if (!value) return undefined;
  try {
    const data = object(value);
    const enabled = object(data.parameterEnabled);
    for (const key of RESTORE_PARAMETER_KEYS) {
      if (typeof data[key] !== 'number' || !Number.isFinite(data[key]) || typeof enabled[key] !== 'boolean') fail();
    }
    for (const key of ['additionalApiParameters', 'systemPrompt', 'postHistoryPrompt']) {
      if (typeof data[key] !== 'string') fail();
    }
    if (!['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(data.reasoningLevel))
      || !['auto', 'standard', 'flex'].includes(String(data.serviceTier))) fail();
    return capturePresetRestore(data as unknown as ApiConnection);
  } catch { return undefined; }
}

export function deactivateConnectionPreset(connection: ApiConnection): ApiConnection {
  const restore = connection.presetRestoreSnapshot;
  return { ...connection, ...restore,
    parameterEnabled: { ...connection.parameterEnabled, ...restore?.parameterEnabled },
    appliedPresetId: null, presetRestoreSnapshot: undefined };
}

export function activateConnectionPreset(connection: ApiConnection, preset: RyokanPreset, id: string): ApiConnection {
  // Legacy associations without a baseline can only preserve their current settings.
  const restore = connection.presetRestoreSnapshot
    ? capturePresetRestore({ ...connection, ...connection.presetRestoreSnapshot } as ApiConnection)
    : capturePresetRestore(connection);
  const baseline = { ...connection, ...restore,
    parameterEnabled: { ...connection.parameterEnabled, ...restore.parameterEnabled } };
  return { ...resolvePreset(baseline, preset), appliedPresetId: id, presetRestoreSnapshot: restore };
}

/** End the restore session in its old context before entering another provider. */
export function transitionPresetProvider(connection: ApiConnection, providerKind: ProviderKind,
  customMode: boolean, defaults: ApiConnection): ApiConnection {
  if ((connection.providerKind === providerKind && connection.customMode === customMode)
    || (!connection.appliedPresetId && !connection.presetRestoreSnapshot)) return connection;
  const restored = deactivateConnectionPreset(connection);
  return { ...restored,
    ...Object.fromEntries(PROVIDER_RESTORE_KEYS.map(key => [key, defaults[key]])),
    parameterEnabled: { ...restored.parameterEnabled,
      maxTokens: defaults.parameterEnabled.maxTokens, thinkingBudget: defaults.parameterEnabled.thinkingBudget },
  };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`).join(',')}}`;
  return JSON.stringify(value);
}
function sameAdditionalParameters(left: string, right: string): boolean {
  if (left === right) return true;
  const a = validateAdditionalApiParameters(left), b = validateAdditionalApiParameters(right);
  return a.valid && b.valid && canonicalJson(a.value ?? {}) === canonicalJson(b.value ?? {});
}

/** The ID owns a restore session. Active status additionally requires a match
 * with the library entry's effective configuration in this provider context.
 * Library edits never mutate profiles or already captured request snapshots. */
export function connectionPresetIsActive(connection: ApiConnection, item: StoredPreset): boolean {
  if (connection.appliedPresetId !== item.id || !connection.presetRestoreSnapshot) return false;
  const expected = resolvePreset(deactivateConnectionPreset(connection), item.preset);
  return RESTORE_KEYS.every(key => key === 'additionalApiParameters'
    ? sameAdditionalParameters(connection[key], expected[key]) : connection[key] === expected[key])
    && RESTORE_PARAMETER_KEYS.every(key => connection.parameterEnabled[key] === expected.parameterEnabled[key]);
}

export interface ParameterValue { enabled: boolean; value: number }
export interface ProviderPresetSettings {
  maxTokens: ParameterValue;
  thinkingBudget: ParameterValue;
  reasoningLevel: ReasoningLevel;
  serviceTier: ServiceTier;
  additionalParameters: Record<string, unknown>;
}
export interface RyokanPreset {
  format: 'ryokan.preset';
  version: 1;
  name: string;
  generation: Record<SamplingKey, ParameterValue>;
  prompt: { system: string; postHistory: string };
  providers: Partial<Record<ProviderKind, ProviderPresetSettings>>;
}
export interface StoredPreset { id: string; preset: RyokanPreset }
export type PresetErrorCode = 'invalidPreset' | 'unsupportedVersion' | 'sensitiveParameters';
export class PresetError extends Error {
  code: PresetErrorCode;
  constructor(code: PresetErrorCode) { super(code); this.code = code; }
}
function fail(code: PresetErrorCode = 'invalidPreset'): never { throw new PresetError(code); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail();
  return value as Record<string, unknown>;
}
function keys(value: Record<string, unknown>, allowed: readonly string[]): void {
  if (Object.keys(value).some(key => !allowed.includes(key))) fail();
}
function text(value: unknown, max = 100_000): string {
  if (typeof value !== 'string' || value.length > max) fail();
  return value;
}
function parameter(value: unknown, min: number, max: number, integer = false): ParameterValue {
  const data = object(value);
  keys(data, ['enabled', 'value']);
  if (typeof data.enabled !== 'boolean' || typeof data.value !== 'number' || !Number.isFinite(data.value)
    || data.value < min || data.value > max || integer && !Number.isSafeInteger(data.value)) fail();
  return { enabled: data.enabled, value: data.value };
}
// Custom request bodies are reusable only when they contain no transport/auth/session data.
// Match credential keys without banning legitimate max_tokens/thinking_budget_tokens.
const PRIVATE_KEY = /api[_-]?key|private[_-]?key|authorization|password|secret|credential|cookie|endpoint|url$|headers?$|connection[_-]?id$|session[_-]?id$|^baseUrl$|^(?:(?:access|refresh|auth|bearer|id)[_-]?)?token$/i;
function safeJson(value: unknown, depth = 0): void {
  if (depth > 20) fail();
  if (typeof value === 'string') {
    if (/\b(?:https?:\/\/|Bearer\s|sk-(?:or-|ant-)?[a-z0-9]{8})/i.test(value)) fail('sensitiveParameters');
  } else if (Array.isArray(value)) {
    for (const item of value) safeJson(item, depth + 1);
  } else if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      if (PRIVATE_KEY.test(key)) fail('sensitiveParameters');
      if (['__proto__', 'constructor', 'prototype'].includes(key)) fail();
      safeJson(child, depth + 1);
    }
  } else if (value !== null && typeof value !== 'boolean' && (typeof value !== 'number' || !Number.isFinite(value))) fail();
}
function providerSettings(value: unknown, provider: ProviderKind): ProviderPresetSettings {
  const data = object(value);
  keys(data, ['maxTokens', 'thinkingBudget', 'reasoningLevel', 'serviceTier', 'additionalParameters']);
  if (!['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'].includes(String(data.reasoningLevel))
    || !['auto', 'standard', 'flex'].includes(String(data.serviceTier))) fail();
  const additional = object(data.additionalParameters);
  safeJson(additional);
  if (!validateAdditionalApiParameters(JSON.stringify(additional)).valid) fail();
  const protectedNative = provider === 'anthropic' ? ['system', 'tools']
    : provider === 'gemini' ? ['contents', 'systemInstruction', 'system_instruction', 'generation_config', 'tools', 'cachedContent', 'cached_content'] : [];
  if (protectedNative.some(key => Object.hasOwn(additional, key))) fail();
  return { maxTokens: parameter(data.maxTokens, 1, 2_147_483_647, true),
    thinkingBudget: parameter(data.thinkingBudget, 0, 2_147_483_647, true),
    reasoningLevel: data.reasoningLevel as ReasoningLevel, serviceTier: data.serviceTier as ServiceTier,
    additionalParameters: structuredClone(additional) };
}
/** Validates and reconstructs an allowlisted native document. No connection fields survive. */
export function validatePreset(value: unknown): RyokanPreset {
  const data = object(value);
  if (data.format !== 'ryokan.preset') fail();
  if (data.version !== 1) fail('unsupportedVersion');
  keys(data, ['format', 'version', 'name', 'generation', 'prompt', 'providers']);
  const name = text(data.name, 120).trim();
  if (!name) fail();
  const generation = object(data.generation);
  keys(generation, SAMPLING_KEYS);
  const prompt = object(data.prompt);
  keys(prompt, ['system', 'postHistory']);
  const providers = object(data.providers);
  keys(providers, PROVIDERS.map(provider => provider.kind));
  const result: RyokanPreset = { format: 'ryokan.preset', version: 1, name,
    generation: {
      temperature: parameter(generation.temperature, 0, 10),
      repetitionPenalty: parameter(generation.repetitionPenalty, 0, 10),
      topP: parameter(generation.topP, 0, 1), topK: parameter(generation.topK, 0, 2_147_483_647, true),
      minP: parameter(generation.minP, 0, 1), frequencyPenalty: parameter(generation.frequencyPenalty, -2, 2),
    },
    prompt: { system: text(prompt.system), postHistory: text(prompt.postHistory) }, providers: {} };
  for (const [kind, settings] of Object.entries(providers)) result.providers[kind as ProviderKind] = providerSettings(settings, kind as ProviderKind);
  return result;
}
export function importPreset(json: string): RyokanPreset {
  if (new TextEncoder().encode(json).length > MAX_PRESET_BYTES) fail();
  let value: unknown;
  try { value = JSON.parse(json); } catch { fail(); }
  return validatePreset(value);
}
export function exportPreset(preset: RyokanPreset): string {
  const json = JSON.stringify(validatePreset(preset), null, 2);
  if (new TextEncoder().encode(json).length > MAX_PRESET_BYTES) fail();
  return json;
}
/** Capture only reusable settings. Keep other provider blocks when editing a preset. */
export function capturePreset(connection: ApiConnection, name: string, previous?: RyokanPreset): RyokanPreset {
  const additional = validateAdditionalApiParameters(connection.additionalApiParameters || '');
  if (!additional.valid) fail();
  const setting = (key: SamplingKey | 'maxTokens' | 'thinkingBudget'): ParameterValue =>
    ({ enabled: connection.parameterEnabled[key], value: connection[key] });
  return validatePreset({ format: 'ryokan.preset', version: 1, name,
    generation: Object.fromEntries(SAMPLING_KEYS.map(key => [key, setting(key)])),
    prompt: { system: connection.systemPrompt || '', postHistory: connection.postHistoryPrompt || '' },
    providers: { ...previous?.providers, [connection.providerKind]: {
      maxTokens: setting('maxTokens'), thinkingBudget: setting('thinkingBudget'),
      reasoningLevel: connection.reasoningLevel, serviceTier: connection.serviceTier,
      additionalParameters: additional.value ?? {},
    } } });
}
/** Materialize before snapshots; later library edits never affect this connection or request. */
export function resolvePreset(connection: ApiConnection, input: RyokanPreset): ApiConnection {
  const preset = validatePreset(input);
  const result = { ...connection, parameterEnabled: { ...connection.parameterEnabled },
    systemPrompt: preset.prompt.system, postHistoryPrompt: preset.prompt.postHistory };
  for (const key of SAMPLING_KEYS) {
    result[key] = preset.generation[key].value;
    result.parameterEnabled[key] = preset.generation[key].enabled;
  }
  const provider = preset.providers[connection.providerKind];
  if (provider) {
    for (const key of ['maxTokens', 'thinkingBudget'] as const) {
      result[key] = provider[key].value;
      result.parameterEnabled[key] = provider[key].enabled;
    }
    result.reasoningLevel = provider.reasoningLevel;
    result.serviceTier = provider.serviceTier;
    result.additionalApiParameters = Object.keys(provider.additionalParameters).length ? JSON.stringify(provider.additionalParameters, null, 2) : '';
  }
  return result;
}
export function parsePresetLibrary(json: string): StoredPreset[] {
  let value: unknown;
  try { value = JSON.parse(json); } catch { fail(); }
  if (!Array.isArray(value) || value.length > 500) fail();
  const ids = new Set<string>();
  return value.map(item => {
    const data = object(item);
    keys(data, ['id', 'preset']);
    const id = text(data.id, 120);
    if (!id || ids.has(id)) fail();
    ids.add(id);
    return { id, preset: validatePreset(data.preset) };
  });
}
