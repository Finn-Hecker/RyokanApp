import { invoke } from '@tauri-apps/api/core';
import { save } from '@tauri-apps/plugin-dialog';
import { appState } from '$lib/stores/appState.svelte';
import { supportedImageFormat } from '$lib/utils/imageFormats';
import {
  createCharacter,
  updateCharacter,
  deleteCharacter as storeDeleteCharacter
} from '$lib/stores/characterStore.svelte';
import type { PlayMode, PortableBundledRoleSnapshot, RolePolicy } from '$lib/stores/characterStore.svelte';
import type { WorldInfoFormData } from '$lib/components/editor/worldinfo/worldInfoLogic';

export interface CharFormData {
  name: string;
  prompt: string;
  greeting: string;
  alternate_greetings: string[];
  play_mode: PlayMode;
  world_info_ids?: string[];
  role_policy?: RolePolicy;
  bundled_roles?: PortableBundledRoleSnapshot[];
}

export interface ImportResult extends Partial<CharFormData> {
  avatarDataUrl?: string;
  world_info?: WorldInfoFormData | null;
}

export async function saveCharacter(
  formData: CharFormData,
  editChar: any | null,
  avatarPreview: string | null,
  avatarChanged: boolean
): Promise<string> {
  const validAltGreetings = formData.alternate_greetings
    .filter(g => g.trim().length > 0);

  const charData = {
    name: formData.name,
    prompt: formData.prompt,
    greeting: formData.greeting,
    alternate_greetings: validAltGreetings,
    play_mode: formData.play_mode,
    world_info_ids: formData.world_info_ids ?? [],
    initials: formData.name.substring(0, 1).toUpperCase(),
    color: editChar?.color ?? 'bg-indigo-600',
    avatar: avatarChanged ? (avatarPreview ?? null) : null,
    role_policy: formData.role_policy ?? 'open',
    bundled_roles: formData.bundled_roles,
  };

  if (editChar?.isCustom) {
    return updateCharacter(String(editChar.id), charData);
  } else {
    return createCharacter(charData);
  }
}

export async function removeCharacter(editChar: any): Promise<void> {
  await storeDeleteCharacter(String(editChar.id));
}

export async function exportCharacterCard(id: string, name: string): Promise<boolean> {
  const pngBytes: number[] = await invoke('export_character_card', { id: String(id) });
  const filename = `${name.replace(/[^a-z0-9]/gi, '_') || 'character'}.png`;

  if (appState.interactionMode === 'mobile') {
    const uri = await save({
      defaultPath: filename,
      filters: [{ name: 'PNG', extensions: ['png'] }]
    });
    if (uri === null) return false;
    await invoke('write_android_export', { uri, bytes: pngBytes });
    return true;
  }

  const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function readImageAsDataUrl(file: File): Promise<string> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (!supportedImageFormat(header)) {
    throw new Error('Supported avatar formats: PNG, JPEG, WebP and GIF');
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function importCharacterFromFile(
  file: File
): Promise<ImportResult> {
  const header = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  if (supportedImageFormat(header) !== 'png') {
    throw new Error('Character cards must be PNG files');
  }
  const result: ImportResult = {};
  result.play_mode = 'solo';

  try {
    result.avatarDataUrl = await readImageAsDataUrl(file);
  } catch {
    // Avatar optional.
  }

  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const metadata = await invoke<{
    name: string | null;
    prompt: string;
    first_mes: string | null;
    alternate_greetings: string[];
    role_policy: RolePolicy;
    bundled_roles: PortableBundledRoleSnapshot[];
    world_info: WorldInfoFormData | null;
  }>('parse_character_card', {
    imageData: Array.from(uint8Array)
  });

  if (metadata.name) {
    result.name = metadata.name;
  }

  result.prompt = metadata.prompt;
  if (metadata.first_mes) result.greeting = metadata.first_mes;
  if (metadata.alternate_greetings.length > 0) {
    result.alternate_greetings = metadata.alternate_greetings;
  }
  result.role_policy = metadata.role_policy;
  result.bundled_roles = metadata.bundled_roles;
  result.world_info = metadata.world_info;


  return result;
}
