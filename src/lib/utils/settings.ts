import { invoke } from "@tauri-apps/api/core";

export interface SettingRow {
  key: string;
  value: string;
}

export async function getAllSettings(): Promise<SettingRow[]> {
  try {
    return await invoke<SettingRow[]>("get_all_settings");
  } catch (e) {
    console.error("Failed to load settings:", e);
    return [];
  }
}

export async function saveSetting(key: string, value: string | boolean | number) {
  try {
    const stringValue = String(value);
    await invoke("save_setting", { key, value: stringValue });
    // Values can contain credentials (legacy api_key and canonical connection JSON).
    // Log only the setting identity, never its contents.
    console.log(`Saved setting '${key}'`);
  } catch (e) {
    console.error(`Failed to save setting '${key}':`, e);
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
  contextLength?: number | null;
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
  } | null;
}

export async function fetchModels(url: string, apiKey: string): Promise<ModelInfo[]> {
  return await invoke<ModelInfo[]>("fetch_models", { url, apiKey });
}
