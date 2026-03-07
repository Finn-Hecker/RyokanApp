import { invoke } from '@tauri-apps/api/core';

export type WiPosition = 'before' | 'after';

export interface WorldInfoEntry {
  id:       string;
  keys:     string[];
  content:  string;
  enabled:  boolean;
  comment:  string;
  position: WiPosition;
}

export interface WorldInfoFormData {
  name:        string;
  description: string;
  entries:     WorldInfoEntry[];
}

export function createEmptyEntry(): WorldInfoEntry {
  return {
    id:       crypto.randomUUID(),
    keys:     [],
    content:  '',
    enabled:  true,
    comment:  '',
    position: 'before',
  };
}

export async function createWorldInfo(data: WorldInfoFormData): Promise<string> {
  return invoke<string>('create_world_info', { payload: data });
}

export async function updateWorldInfo(id: string, data: WorldInfoFormData): Promise<void> {
  return invoke('update_world_info', { id, payload: data });
}

export async function deleteWorldInfo(id: string): Promise<void> {
  return invoke('delete_world_info', { id });
}