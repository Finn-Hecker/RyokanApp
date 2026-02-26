import { invoke } from '@tauri-apps/api/core';
import {
  createCharacter,
  updateCharacter,
  deleteCharacter as storeDeleteCharacter
} from '$lib/stores/characterStore';

export interface CharFormData {
  name: string;
  description: string;
  personality: string;
  scenario: string;
  greeting: string;
  mes_example: string;
  creator_notes: string;
  alternate_greetings: string[];
}

export interface ImportResult extends Partial<CharFormData> {
  avatarDataUrl?: string;
}

export async function saveCharacter(
  formData: CharFormData,
  editChar: any | null,
  avatarPreview: string | null,
  avatarChanged: boolean
): Promise<void> {
  const validAltGreetings = formData.alternate_greetings.filter(g => g.trim().length > 0);

  const charData = {
    name: formData.name,
    desc: formData.description,
    personality: formData.personality,
    scenario: formData.scenario,
    greeting: formData.greeting,
    alternate_greetings: validAltGreetings,
    mes_example: formData.mes_example,
    creator_notes: formData.creator_notes,
    initials: formData.name.substring(0, 1).toUpperCase(),
    color: editChar?.color ?? 'bg-indigo-600',
    // Pass null when unchanged so the backend retains the existing avatar.
    avatar: avatarChanged ? (avatarPreview ?? null) : null
  };

  if (editChar?.isCustom) {
    await updateCharacter(String(editChar.id), charData);
  } else {
    await createCharacter(charData);
  }
}

export async function removeCharacter(editChar: any): Promise<void> {
  await storeDeleteCharacter(String(editChar.id));
}

export async function exportCharacterCard(id: string, name: string): Promise<void> {
  const pngBytes: number[] = await invoke('export_character_card', { id: String(id) });
  const blob = new Blob([new Uint8Array(pngBytes)], { type: 'image/png' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${name.replace(/[^a-z0-9]/gi, '_')}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

export function readImageAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.includes('image')) {
      reject(new Error('Not an image file'));
      return;
    }
    const reader = new FileReader();
    reader.onload = (e) => resolve(e.target?.result as string);
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function importCharacterFromFile(file: File): Promise<ImportResult> {
  const result: ImportResult = {};

  try {
    result.avatarDataUrl = await readImageAsDataUrl(file);
  } catch {
    // Avatar is optional — importing metadata-only cards is valid.
  }

  const arrayBuffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(arrayBuffer);

  const metadata = await invoke<any>('parse_character_card', {
    imageData: Array.from(uint8Array)
  });

  if (metadata.name)              result.name = metadata.name;
  if (metadata.description)       result.description = metadata.description;
  if (metadata.personality)       result.personality = metadata.personality;
  if (metadata.scenario)          result.scenario = metadata.scenario;
  if (metadata.first_mes)         result.greeting = metadata.first_mes;
  if (metadata.mes_example)       result.mes_example = metadata.mes_example;
  if (metadata.creator_notes)     result.creator_notes = metadata.creator_notes;
  if (metadata.alternate_greetings?.length > 0) {
    result.alternate_greetings = metadata.alternate_greetings;
  }

  return result;
}