import { invoke } from '@tauri-apps/api/core';

export type DiagnosticArea = 'runtime' | 'settings' | 'chat' | 'character' | 'role' | 'world_info' | 'editor' | 'sidebar' | 'multiplayer' | 'summary';
const lastEvents = new Map<string, number>();

/** Only fixed categories cross IPC. Never pass an error, message or application data. */
export function reportDiagnostic(area: DiagnosticArea, warning = false): void {
  const key = `${area}:${warning}`;
  const now = Date.now();
  const last = lastEvents.get(key);
  if (last !== undefined && now >= last && now - last < 60_000) return;
  lastEvents.set(key, now);
  try {
    void invoke('record_frontend_event', { area, warning }).catch(() => {});
  } catch { /* Diagnostics must never affect the calling operation. */ }
}

export async function downloadDiagnostics(metadata: { provider: string; modelConfigured: boolean; summaryEnabled: boolean }): Promise<void> {
  const content = await invoke<string>('export_diagnostics', { metadata });
  const url = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
  const link = document.createElement('a');
  try {
    link.href = url;
    link.download = 'ryokan-diagnostics.json';
    document.body.appendChild(link);
    link.click();
  } finally {
    link.remove();
    // Allow WebViews time to consume the download before revoking its URL.
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  }
}
