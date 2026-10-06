import { exportFile } from '../../utils/fileExport.ts';
import { invoke } from '@tauri-apps/api/core';
import { PRESETS_KEY, parsePresetLibrary, exportPreset, deactivateConnectionPreset, type StoredPreset } from './presetCore';
import { appState, snapshotApiConnection } from '$lib/stores/appState.svelte';
import { persistApiConnections } from '$lib/ai/connections/apiConnections';

/** Persist separately from profiles; let errors reach the editor before publishing changes. */
export async function loadPresetLibrary(): Promise<StoredPreset[]> {
  const rows = await invoke<{ key: string; value: string }[]>('get_all_settings');
  return parsePresetLibrary(rows.find(row => row.key === PRESETS_KEY)?.value ?? '[]');
}
export async function savePresetLibrary(items: StoredPreset[]): Promise<void> {
  const safe = parsePresetLibrary(JSON.stringify(items));
  await invoke('save_setting', { key: PRESETS_KEY, value: JSON.stringify(safe) });
}
/** Restore all affected profiles before removing the library entry. */
export async function deletePreset(items: StoredPreset[], id: string): Promise<StoredPreset[]> {
  const next = items.filter(item => item.id !== id);
  const affected = appState.apiConnections.filter(connection => connection.appliedPresetId === id);
  const previous = affected.map(connection => snapshotApiConnection(connection));
  for (const connection of affected) Object.assign(connection, deactivateConnectionPreset(snapshotApiConnection(connection)));
  let connectionsSaved = false;
  try {
    if (affected.length) { await persistApiConnections(); connectionsSaved = true; }
    await savePresetLibrary(next);
    return next;
  } catch (cause) {
    affected.forEach((connection, index) => Object.assign(connection, previous[index]));
    if (connectionsSaved) await persistApiConnections();
    throw cause;
  }
}
export async function downloadPreset(item: StoredPreset, mobile: boolean): Promise<boolean> {
  const content = exportPreset(item.preset);
  const filename = `${item.preset.name.replace(/[^\p{L}\p{N}_-]/gu, '_').slice(0, 80) || 'preset'}.ryokan.json`;
  return exportFile(new TextEncoder().encode(content), filename, 'application/json',
    { name: 'Ryokan preset', extensions: ['json'] }, mobile);
}
