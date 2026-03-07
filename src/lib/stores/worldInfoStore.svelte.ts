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

export async function loadWorldInfos(): Promise<void> {
  try {
    const rows = await invoke<WorldInfo[]>('get_world_infos');
    worldInfoState.allWorldInfos = [...DEFAULT_WORLD_INFOS, ...rows];
  } catch (e) {
    console.error('worldInfoStore – loadWorldInfos:', e);
  }
}