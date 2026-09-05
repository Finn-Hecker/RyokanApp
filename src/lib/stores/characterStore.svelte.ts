import { invoke } from '@tauri-apps/api/core';
import { CHARACTERS as STATIC_CHARACTERS } from '$lib/data/characters';

export interface Character {
    id: string | number;
    name: string;
    prompt: string;
    greeting: string;
    initials: string;
    color: string;
    play_mode: 'solo' | 'multiplayer' | 'both';
    isCustom?: boolean;
    /** Whether the DB has an avatar stored for this character. The bytes
     *  themselves are no longer part of the list payload — see loadCharacterAvatar. */
    has_avatar?: boolean;
    avatarUrl?: string;
    hidden?: boolean;
    alternate_greetings?: string[];
    world_info_ids?: string[];
}

export type CharacterInput = Pick<Character, 'name' | 'prompt' | 'greeting' | 'initials' | 'color' | 'play_mode' | 'alternate_greetings' | 'world_info_ids'> & { avatar?: string | null };

export const characterState = $state({
    allCharacters: [] as Character[],
    hiddenCharacterIds: new Set<string | number>(),
    pinnedCharacterIds: new Set<string | number>(),
});

export async function loadHiddenIds() {
    try {
        const ids = await invoke<string[]>('get_hidden_character_ids');
        characterState.hiddenCharacterIds = new Set(ids.map(String));
    } catch (e) {
        console.error('Error loading hidden character ids:', e);
    }
}

export async function loadPinnedIds() {
    try {
        const ids = await invoke<string[]>('get_pinned_character_ids');
        characterState.pinnedCharacterIds = new Set(ids.map(String));
    } catch (e) {
        console.error('Error loading pinned character ids:', e);
    }
}

export async function loadCharacters() {
    try {
        const dbChars = await invoke<Character[]>('get_custom_characters');

        const customChars = dbChars.map(c => ({
            ...c,
            isCustom: true,
            play_mode: c.play_mode ?? 'both',
            alternate_greetings: typeof c.alternate_greetings === 'string'
                ? JSON.parse(c.alternate_greetings)
                : (c.alternate_greetings ?? []),
            world_info_ids: Array.isArray(c.world_info_ids)
                ? c.world_info_ids
                : [],
        }));

        characterState.allCharacters = [...customChars, ...STATIC_CHARACTERS];

        // Avatars are intentionally NOT fetched here. Each view (grid/list/compact)
        // renders a <CharacterAvatar> that lazily calls loadCharacterAvatar() via an
        // IntersectionObserver once a card actually scrolls into view - fetching
        // eagerly for every character here would defeat that.

    } catch (e) {
        console.error("Error loading characters:", e);
    }
}

/**
 * Fetches a single character's avatar (as a ready-to-use data URL) and merges
 * it into state once it resolves. Called by <CharacterAvatar> when a card
 * scrolls into view. Deduplicated against concurrent calls for the same id,
 * since switching between grid/list/compact view can mount a new
 * <CharacterAvatar> for the same character before the first fetch lands.
 */
const avatarFetchesInFlight = new Set<string>();

export async function loadCharacterAvatar(id: string): Promise<void> {
    if (avatarFetchesInFlight.has(id)) return;
    avatarFetchesInFlight.add(id);

    try {
        const avatarUrl = await invoke<string | null>('get_character_avatar', { id });
        if (!avatarUrl) return;
        characterState.allCharacters = characterState.allCharacters.map(c =>
            String(c.id) === id ? { ...c, avatarUrl } : c
        );
    } catch (e) {
        console.error('Error loading character avatar:', id, e);
    } finally {
        avatarFetchesInFlight.delete(id);
    }
}

export async function createCharacter(charData: CharacterInput) {
    const tempId = `temp-${Date.now()}`;
    const tempChar: Character = {
        id: tempId,
        name: charData.name,
        prompt: charData.prompt,
        greeting: charData.greeting || "",
        initials: charData.initials,
        color: charData.color,
        play_mode: charData.play_mode,
        isCustom: true,
        avatarUrl: charData.avatar || undefined,
        world_info_ids: charData.world_info_ids ?? [],
    };

    characterState.allCharacters = [
        tempChar,
        ...characterState.allCharacters.filter(c => c.isCustom),
        ...STATIC_CHARACTERS
    ];

    try {
        const realId = await invoke<string>('create_character', {
            payload: {
                name: charData.name,
                prompt: charData.prompt,
                greeting: charData.greeting || "",
                alternate_greetings: charData.alternate_greetings || [],
                avatar: charData.avatar || null,
                initials: charData.initials,
                color: charData.color,
                play_mode: charData.play_mode,
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

export async function updateCharacter(id: string, charData: CharacterInput) {
    try {
        await invoke('update_character', {
            id,
            payload: {
                name: charData.name,
                prompt: charData.prompt,
                greeting: charData.greeting || "",
                alternate_greetings: charData.alternate_greetings || [],
                avatar: charData.avatar || null,
                initials: charData.initials,
                color: charData.color,
                play_mode: charData.play_mode,
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
        
        const newHidden = new Set(characterState.hiddenCharacterIds);
        newHidden.delete(id);
        characterState.hiddenCharacterIds = newHidden;

        const newPinned = new Set(characterState.pinnedCharacterIds);
        newPinned.delete(id);
        characterState.pinnedCharacterIds = newPinned;
        
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

export async function togglePinCharacter(id: string | number): Promise<boolean> {
    const normalizedId = String(id);
    const isNowPinned = !characterState.pinnedCharacterIds.has(normalizedId);

    try {
        await invoke('set_character_pinned', { id: normalizedId, pinned: isNowPinned });

        const newSet = new Set(characterState.pinnedCharacterIds);
        isNowPinned ? newSet.add(normalizedId) : newSet.delete(normalizedId);
        characterState.pinnedCharacterIds = newSet;
    } catch (e) {
        console.error('Error toggling pinned state:', e);
        throw e;
    }

    return isNowPinned;
}
