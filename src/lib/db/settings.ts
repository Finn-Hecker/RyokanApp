import Database from "@tauri-apps/plugin-sql";

const DB_PATH = "sqlite:ryokan.db";

export interface SettingRow {
  key: string;
  value: string;
}

export async function getSetting(key: string): Promise<string | null> {
  const db = await Database.load(DB_PATH);
  const result = await db.select<SettingRow[]>(
    "SELECT value FROM settings WHERE key = $1", 
    [key]
  );
  return result.length > 0 ? result[0].value : null;
}

export async function getAllSettings(): Promise<SettingRow[]> {
  const db = await Database.load(DB_PATH);
  return await db.select<SettingRow[]>("SELECT key, value FROM settings");
}

export async function saveSetting(key: string, value: string | boolean) {
  const db = await Database.load(DB_PATH);
  const stringValue = String(value);
  
  await db.execute(
    "INSERT OR REPLACE INTO settings (key, value) VALUES ($1, $2)",
    [key, stringValue]
  );
}