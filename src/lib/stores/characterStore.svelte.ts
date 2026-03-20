import { invoke } from '@tauri-apps/api/core';
import { CHARACTERS as STATIC_CHARACTERS } from '$lib/data/characters';

function bytesToUrl(bytes: number[]): string {
    const uint8 = new Uint8Array(bytes);
    const blob = new Blob([uint8], { type: 'image/webp' });
    return URL.createObjectURL(blob);
}

export interface Character {
    id: string | number;
    name: string;
    desc: string;
    greeting: string;
    initials: string;
    color: string;
    isCustom?: boolean;
    avatar?: number[];
    avatarUrl?: string;
    personality?: string;
    scenario?: string;
    mes_example?: string;
    creator_notes?: string;
    hidden?: boolean;
    alternate_greetings?: string[];
    world_info_ids?: string[];
}

export const characterState = $state({
    allCharacters: [...STATIC_CHARACTERS] as Character[],
    hiddenCharacterIds: new Set<string | number>()
});

export async function loadHiddenIds() {
    try {
        const ids = await invoke<string[]>('get_hidden_character_ids');
        characterState.hiddenCharacterIds = new Set(ids.map(String));
    } catch (e) {
        console.error('Error loading hidden character ids:', e);
    }
}

export async function loadCharacters() {
    try {
        const dbChars = await invoke<Character[]>('get_custom_characters');

        const customChars = dbChars.map(c => {
            let avatarUrl: string | undefined = undefined;
            if (c.avatar && c.avatar.length > 0) {
                avatarUrl = bytesToUrl(c.avatar);
            }
            return {
                ...c,
                isCustom: true,
                avatarUrl,
                alternate_greetings: typeof c.alternate_greetings === 'string'
                    ? JSON.parse(c.alternate_greetings)
                    : (c.alternate_greetings ?? []),
                world_info_ids: Array.isArray(c.world_info_ids)
                    ? c.world_info_ids
                    : [],
            };
        });

        characterState.allCharacters = [...STATIC_CHARACTERS, ...customChars];

    } catch (e) {
        console.error("Error loading characters:", e);
    }
}

export async function createCharacter(charData: any) {
    const tempId = `temp-${Date.now()}`;
    const tempChar: Character = {
        id: tempId,
        name: charData.name,
        desc: charData.desc,
        greeting: charData.greeting || "",
        initials: charData.initials,
        color: charData.color,
        isCustom: true,
        avatarUrl: charData.avatar || undefined,
        world_info_ids: charData.world_info_ids ?? [],
    };

    characterState.allCharacters = [
        ...STATIC_CHARACTERS, 
        tempChar, 
        ...characterState.allCharacters.slice(STATIC_CHARACTERS.length)
    ];

    try {
        const realId = await invoke<string>('create_character', {
            payload: {
                name: charData.name,
                desc: charData.desc,
                personality: charData.personality || "",
                scenario: charData.scenario || "",
                greeting: charData.greeting || "",
                alternate_greetings: charData.alternate_greetings || [],
                mes_example: charData.mes_example || "",
                creator_notes: charData.creator_notes || "",
                tags: charData.tags || [],
                avatar: charData.avatar || null,
                v3_spec: charData.v3_spec || false,
                initials: charData.initials,
                color: charData.color,
                world_info_ids: charData.world_info_ids ?? [],
            }
        });

        characterState.allCharacters = characterState.allCharacters.map(c => 
            c.id === tempId ? { ...c, id: realId } : c
        );

        setTimeout(() => loadCharacters(), 800);

    } catch (e) {
        console.error("Error creating character:", e);
        characterState.allCharacters = characterState.allCharacters.filter(c => c.id !== tempId);
        throw e;
    }
}

export async function updateCharacter(id: string, charData: any) {
    try {
        await invoke('update_character', {
            id,
            payload: {
                name: charData.name,
                desc: charData.desc,
                personality: charData.personality || "",
                scenario: charData.scenario || "",
                greeting: charData.greeting || "",
                alternate_greetings: charData.alternate_greetings || [],
                mes_example: charData.mes_example || "",
                creator_notes: charData.creator_notes || "",
                tags: charData.tags || [],
                avatar: charData.avatar || null,
                v3_spec: charData.v3_spec || false,
                initials: charData.initials,
                color: charData.color,
                world_info_ids: charData.world_info_ids ?? [],
            }
        });

        characterState.allCharacters = characterState.allCharacters.map(c =>
            c.id === id ? { ...c, ...charData, id, isCustom: true } : c
        );

        setTimeout(() => loadCharacters(), 800);

    } catch (e) {
        console.error("Error updating character:", e);
        throw e;
    }
}

export async function deleteCharacter(id: string) {
    try {
        await invoke('delete_character', { id });
        
        characterState.allCharacters = characterState.allCharacters.filter(c => c.id !== id);
        
        const newSet = new Set(characterState.hiddenCharacterIds);
        newSet.delete(id);
        characterState.hiddenCharacterIds = newSet;
        
    } catch (e) {
        console.error("Error deleting character:", e);
        throw e;
    }
}

export async function toggleHideCharacter(id: string | number): Promise<boolean> {
    const normalizedId = String(id);
    const isNowHidden = !characterState.hiddenCharacterIds.has(normalizedId);

    try {
        await invoke('set_character_hidden', { id: normalizedId, hidden: isNowHidden });
        
        const newSet = new Set(characterState.hiddenCharacterIds);
        isNowHidden ? newSet.add(normalizedId) : newSet.delete(normalizedId);
        characterState.hiddenCharacterIds = newSet;
    } catch (e) {
        console.error('Error toggling hidden state:', e);
        throw e;
    }

    return isNowHidden;
}