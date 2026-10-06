import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
import { invoke } from '@tauri-apps/api/core';
import type { WorldInfoEntry } from '$lib/components/editor/worldinfo/worldInfoLogic';
import { DEFAULT_WORLD_INFOS } from '$lib/data/worldInfo';

export interface WorldInfo {
  id:          string;
  name:        string;
  description: string;
  entries:     WorldInfoEntry[];
  created_at?: string;
}

export const worldInfoState = $state({
  allWorldInfos: [...DEFAULT_WORLD_INFOS] as WorldInfo[]
});

let worldInfosLoaded = false;
let pendingLoad: Promise<void> | undefined;

export function ensureWorldInfosLoaded(): Promise<void> {
  return pendingLoad ?? (worldInfosLoaded ? Promise.resolve() : loadWorldInfos());
}

export function loadWorldInfos(): Promise<void> {
  if (!pendingLoad) {
    pendingLoad = (async () => {
      try {
        const rows = await invoke<WorldInfo[]>('get_world_infos');
        worldInfoState.allWorldInfos = [...DEFAULT_WORLD_INFOS, ...rows];
        worldInfosLoaded = true;
      } catch (e) {
        reportDiagnostic('world_info');
      }
    })().finally(() => { pendingLoad = undefined; });
  }
  return pendingLoad;
}
