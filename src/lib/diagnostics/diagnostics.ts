import { exportFile } from '../utils/fileExport.ts';
import { invoke } from '@tauri-apps/api/core';

export type DiagnosticArea = 'runtime' | 'settings' | 'chat' | 'character' | 'role' | 'world_info' | 'editor' | 'sidebar' | 'multiplayer' | 'summary';
const lastEvents = new Map<string, number>();

export type ChatExportStage = 'prepare' | 'snapshot_ipc' | 'export_ipc';
export type ChatExportPhase = 'entered' | 'completed' | 'failed';

/** Closed codes only; never accept an error or application values. */
export function reportChatExportStage(stage: ChatExportStage, phase: ChatExportPhase): void {
  // Enforce the boundary even for untyped callers. Native enums validate again.
  if (!['prepare', 'snapshot_ipc', 'export_ipc'].includes(stage)
    || !['entered', 'completed', 'failed'].includes(phase)) return;
  try {
    void invoke('record_chat_export_frontend', { stage, phase }).catch(() => {});
  } catch { /* Diagnostics must never affect export. */ }
}

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

export async function downloadDiagnostics(
  metadata: { provider: string; modelConfigured: boolean; summaryEnabled: boolean },
  interactionMode: 'desktop' | 'mobile' = 'desktop'
): Promise<boolean> {
  const content = await invoke<string>('export_diagnostics', { metadata });
  return exportFile(new TextEncoder().encode(content), 'ryokan-diagnostics.json', 'application/json',
    { name: 'JSON', extensions: ['json'] }, interactionMode === 'mobile');
}
