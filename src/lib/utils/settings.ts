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
    console.log(`Saved setting '${key}' = ${stringValue}`);
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
export async function fetchModels(url: string, apiKey: string): Promise<string[]> {
  return await invoke<string[]>("fetch_models", { url, apiKey });
}