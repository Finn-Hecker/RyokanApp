import { writable, get } from 'svelte/store';
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
}

export const allCharacters = writable<Character[]>([...STATIC_CHARACTERS]);
export const hiddenCharacterIds = writable<Set<string | number>>(new Set());

/// Loads hidden character IDs from SQLite. Call once on app start.
export async function loadHiddenIds() {
    try {
        const ids = await invoke<string[]>('get_hidden_character_ids');
        hiddenCharacterIds.set(new Set(ids));
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
                // alternate_greetings arrives as a JSON string from Rust
                alternate_greetings: typeof c.alternate_greetings === 'string'
                    ? JSON.parse(c.alternate_greetings)
                    : (c.alternate_greetings ?? [])
            };
        });

        allCharacters.set([...STATIC_CHARACTERS, ...customChars]);

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
        avatarUrl: charData.avatar || undefined
    };

    allCharacters.update(chars => [...STATIC_CHARACTERS, tempChar, ...chars.slice(STATIC_CHARACTERS.length)]);

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
                color: charData.color
            }
        });

        allCharacters.update(chars =>
            chars.map(c => c.id === tempId
                ? { ...c, id: realId }
                : c
            )
        );

        // Reload after delay to pick up the async-processed avatar
        setTimeout(() => loadCharacters(), 600);

    } catch (e) {
        console.error("Error creating character:", e);
        allCharacters.update(chars => chars.filter(c => c.id !== tempId));
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
                color: charData.color
            }
        });

        allCharacters.update(chars =>
            chars.map(c => c.id === id
                ? { ...c, ...charData, id, isCustom: true }
                : c
            )
        );

        // Reload after delay to pick up the async-processed avatar
        setTimeout(() => loadCharacters(), 600);

    } catch (e) {
        console.error("Error updating character:", e);
        throw e;
    }
}

export async function deleteCharacter(id: string) {
    try {
        await invoke('delete_character', { id });
        allCharacters.update(chars => chars.filter(c => c.id !== id));
        // Rust cleans up the settings table — mirror that in the store
        hiddenCharacterIds.update(set => { set.delete(id); return new Set(set); });
    } catch (e) {
        console.error("Error deleting character:", e);
        throw e;
    }
}

/// Toggles the hidden state for a character. Persists to SQLite.
export async function toggleHideCharacter(id: string | number): Promise<boolean> {
    const current = get(hiddenCharacterIds);
    const isNowHidden = !current.has(id);

    try {
        await invoke('set_character_hidden', { id: String(id), hidden: isNowHidden });
        hiddenCharacterIds.update(set => {
            isNowHidden ? set.add(id) : set.delete(id);
            return new Set(set);
        });
    } catch (e) {
        console.error('Error toggling hidden state:', e);
        throw e;
    }

    return isNowHidden;
}