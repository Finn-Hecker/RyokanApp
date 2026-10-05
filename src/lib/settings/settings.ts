import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
import { invoke } from "@tauri-apps/api/core";

export interface SettingRow {
  key: string;
  value: string;
}

export async function getAllSettings(): Promise<SettingRow[]> {
  try {
    return await invoke<SettingRow[]>("get_all_settings");
  } catch (e) {
    reportDiagnostic('settings');
    return [];
  }
}

export async function saveSetting(key: string, value: string | boolean | number) {
  try {
    const stringValue = String(value);
    await invoke("save_setting", { key, value: stringValue });
  } catch (e) {
    reportDiagnostic('settings');
  }
}

export async function getSetting(key: string): Promise<string | null> {
  const all = await getAllSettings();
  const found = all.find(s => s.key === key);
  return found ? found.value : null;
}

// Does NOT catch — throws the real Rust error string so the UI can display it directly.
export interface ModelInfo {
  id: string;
  supportedParameters?: string[] | null;
  reasoning?: { supported?: boolean | null; allowedOptions?: string[] | null } | null;
  contextLength?: number | null;
  inputTokenLimit?: number | null;
  outputTokenLimit?: number | null;
  parameterSource?: 'model_metadata' | 'api_contract' | 'unknown' | null;
  thinkingSupported?: boolean | null;
  architecture?: {
    inputModalities: string[];
    outputModalities: string[];
    modality?: string | null;
    tokenizer?: string | null;
    instructType?: string | null;
  } | null;
  pricing?: {
    prompt?: string | null;
    completion?: string | null;
    source?: string | null;
    tiered?: boolean;
  } | null;
}

export async function fetchModels(url: string, apiKey: string, providerKind?: string): Promise<ModelInfo[]> {
  return await invoke<ModelInfo[]>("fetch_models", { url, apiKey, providerKind });
}
