import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { CHARACTERS as STATIC_CHARACTERS } from '$lib/data/characters';

export type PlayMode = 'solo' | 'multiplayer';
export type RolePolicy = 'open' | 'restricted';

export interface BundledRoleSnapshot {
    id: string;
    source_role_id: string | null;
    name: string;
    prompt: string;
    has_avatar: boolean;
    avatarUrl?: string;
}

export interface PortableBundledRoleSnapshot {
    id: string;
    source_role_id: string | null;
    name: string;
    prompt: string;
    /** Base64 image bytes returned only while importing a portable card. */
    avatar?: string | null;
}

export interface Character {
    id: string | number;
    name: string;
    /** Short, card-friendly summary. Static characters localize this separately
     *  from their full prompt; custom characters fall back to their prompt. */
    description?: string;
    prompt: string;
    greeting: string;
    initials: string;
    color: string;
    play_mode: PlayMode;
    isCustom?: boolean;
    /** Whether the DB has an avatar stored for this character. The bytes
     *  themselves are no longer part of the list payload — see loadCharacterAvatar. */
    has_avatar?: boolean;
    avatarUrl?: string;
    hidden?: boolean;
    alternate_greetings?: string[];
    world_info_ids?: string[];
    role_policy: RolePolicy;
    bundled_roles: BundledRoleSnapshot[];
}

export type CharacterInput = Pick<Character, 'name' | 'prompt' | 'greeting' | 'initials' | 'color' | 'play_mode' | 'alternate_greetings' | 'world_info_ids'> & {
    avatar?: string | null;
    role_policy?: RolePolicy;
    bundled_roles?: PortableBundledRoleSnapshot[];
};

export const characterState = $state({
    allCharacters: [] as Character[],
    hiddenCharacterIds: new Set<string | number>(),
    pinnedCharacterIds: new Set<string | number>(),
});

let charactersLoaded = false;
let hiddenIdsLoaded = false;
let pinnedIdsLoaded = false;
let lobbyLoad: Promise<void> | undefined;
const invalidatedAvatars = new Set<string>();
const avatarRevisions = new Map<string, number>();
let avatarUpdateListener: Promise<void> | undefined;

function ensureAvatarUpdateListener(): Promise<void> {
    if (!avatarUpdateListener) {
        avatarUpdateListener = listen<string>('character-avatar-updated', event => {
            const id = event.payload;
            const character = characterState.allCharacters.find(c => String(c.id) === id);
            if (!character) return;
            // Native processing can outlast the existing delayed metadata refresh.
            // Retire both old bytes and in-flight reads only after SQLite commits.
            avatarRevisions.set(id, (avatarRevisions.get(id) ?? 0) + 1);
            avatarFetchesInFlight.delete(id);
            invalidatedAvatars.delete(id);
            character.has_avatar = true;
            character.avatarUrl = undefined;
        }).then(() => undefined).catch(() => {
            avatarUpdateListener = undefined;
            reportDiagnostic('character');
        });
    }
    return avatarUpdateListener;
}

/** Library writes already update state; only the first lobby mount needs hydration. */
export function ensureLobbyCharactersLoaded(): Promise<void> {
    if (charactersLoaded && hiddenIdsLoaded && pinnedIdsLoaded) return Promise.resolve();
    if (!lobbyLoad) {
        lobbyLoad = (async () => {
            await Promise.all([
                hiddenIdsLoaded ? Promise.resolve() : loadHiddenIds(),
                pinnedIdsLoaded ? Promise.resolve() : loadPinnedIds(),
            ]);
            // Publish cards after visibility/pin flags, avoiding a flash of hidden cards.
            if (!charactersLoaded) await loadCharacters();
        })().finally(() => { lobbyLoad = undefined; });
    }
    return lobbyLoad;
}

export function normalizePlayMode(playMode: unknown): PlayMode {
    return playMode === 'multiplayer' ? 'multiplayer' : 'solo';
}

export async function loadHiddenIds() {
    try {
        const ids = await invoke<string[]>('get_hidden_character_ids');
        characterState.hiddenCharacterIds = new Set(ids.map(String));
        hiddenIdsLoaded = true;
    } catch (e) {
        reportDiagnostic('character');
    }
}

export async function loadPinnedIds() {
    try {
        const ids = await invoke<string[]>('get_pinned_character_ids');
        characterState.pinnedCharacterIds = new Set(ids.map(String));
        pinnedIdsLoaded = true;
    } catch (e) {
        reportDiagnostic('character');
    }
}

export async function loadCharacters() {
    try {
        const revisionsAtLoad = new Map(avatarRevisions);
        const dbChars = await invoke<Character[]>('get_custom_characters');

        const customChars = dbChars.map(c => ({
            ...c,
            isCustom: true,
            play_mode: normalizePlayMode(c.play_mode),
            alternate_greetings: typeof c.alternate_greetings === 'string'
                ? JSON.parse(c.alternate_greetings)
                : (c.alternate_greetings ?? []),
            world_info_ids: Array.isArray(c.world_info_ids)
                ? c.world_info_ids
                : [],
            role_policy: c.role_policy ?? 'open',
            bundled_roles: Array.isArray(c.bundled_roles) ? c.bundled_roles : [],
        }));

        const existing = new Map(characterState.allCharacters.map(c => [String(c.id), c]));
        const nextCharacters = customChars.map(character => {
            const id = String(character.id);
            const previous = existing.get(id);
            // A list request started before an avatar edit cannot retire that
            // edit's invalidation or replace its preview with older DB metadata.
            if (previous && (revisionsAtLoad.get(id) ?? 0) !== (avatarRevisions.get(id) ?? 0)) return previous;
            const avatarUrl = character.has_avatar && !invalidatedAvatars.has(id)
                ? previous?.avatarUrl : undefined;
            invalidatedAvatars.delete(id);
            if (!previous) return character;
            Object.assign(previous, character, { avatarUrl });
            return previous;
        });
        nextCharacters.push(...STATIC_CHARACTERS);
        if (nextCharacters.length !== characterState.allCharacters.length
            || nextCharacters.some((character, index) => character !== characterState.allCharacters[index])) {
            characterState.allCharacters = nextCharacters;
        }
        charactersLoaded = true;

        // Avatars are intentionally NOT fetched here. Each view (grid/list/compact)
        // renders a <CharacterAvatar> that lazily calls loadCharacterAvatar() via an
        // IntersectionObserver once a card actually scrolls into view - fetching
        // eagerly for every character here would defeat that.

    } catch (e) {
        reportDiagnostic('character');
    }
}

/**
 * Fetches a single character's avatar (as a ready-to-use data URL) and merges
 * it into state once it resolves. Called by <CharacterAvatar> when a card
 * scrolls into view. Deduplicated against concurrent calls for the same id,
 * since switching between grid/list/compact view can mount a new
 * <CharacterAvatar> for the same character before the first fetch lands.
 */
const avatarFetchesInFlight = new Map<string, Promise<void>>();

export function loadCharacterAvatar(id: string): Promise<void> {
    const current = characterState.allCharacters.find(c => String(c.id) === id);
    if (!current?.has_avatar || current.avatarUrl || invalidatedAvatars.has(id)) return Promise.resolve();
    const pending = avatarFetchesInFlight.get(id);
    if (pending) return pending;
    const revision = avatarRevisions.get(id) ?? 0;
    const request = (async () => {
        try {
            const avatarUrl = await invoke<string | null>('get_character_avatar', { id });
            if (!avatarUrl || revision !== (avatarRevisions.get(id) ?? 0) || invalidatedAvatars.has(id)) return;
            const character = characterState.allCharacters.find(c => String(c.id) === id);
            if (character?.has_avatar) character.avatarUrl = avatarUrl;
        } catch (e) {
            reportDiagnostic('character');
        }
    })().finally(() => {
        if (avatarFetchesInFlight.get(id) === request) avatarFetchesInFlight.delete(id);
    });
    avatarFetchesInFlight.set(id, request);
    return request;
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
        role_policy: charData.role_policy ?? 'open',
        bundled_roles: (charData.bundled_roles ?? []).map(role => ({
            ...role,
            has_avatar: !!role.avatar,
        })),
    };

    characterState.allCharacters = [
        tempChar,
        ...characterState.allCharacters.filter(c => c.isCustom),
        ...STATIC_CHARACTERS
    ];

    try {
        if (charData.avatar) await ensureAvatarUpdateListener();
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
                role_policy: charData.role_policy ?? 'open',
                bundled_roles: charData.bundled_roles ?? [],
            }
        });

        characterState.allCharacters = characterState.allCharacters.map(c => 
            c.id === tempId ? { ...c, id: realId } : c
        );

        // The optimistic preview is the upload, not the processed DB image.
        // Let the existing delayed refresh replace it once native processing finishes.
        if (charData.avatar) invalidatedAvatars.add(realId);

        setTimeout(() => loadCharacters(), 800);
        return realId;

    } catch (e) {
        reportDiagnostic('character');
        characterState.allCharacters = characterState.allCharacters.filter(c => c.id !== tempId);
        throw e;
    }
}

export async function updateCharacter(id: string, charData: CharacterInput) {
    try {
        if (charData.avatar && !charData.avatar.startsWith('blob:')) await ensureAvatarUpdateListener();
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
                role_policy: charData.role_policy,
            }
        });

        const { bundled_roles: _portableBundledRoles, avatar: _uploadedAvatar, ...displayData } = charData;
        const character = characterState.allCharacters.find(c => String(c.id) === id);
        if (charData.avatar && !charData.avatar.startsWith('blob:')) {
            avatarRevisions.set(id, (avatarRevisions.get(id) ?? 0) + 1);
            invalidatedAvatars.add(id);
            avatarFetchesInFlight.delete(id);
        }
        if (character) {
            Object.assign(character, displayData, { role_policy: charData.role_policy ?? character.role_policy, isCustom: true });
            if (charData.avatar && !charData.avatar.startsWith('blob:')) character.avatarUrl = charData.avatar;
        }

        setTimeout(() => loadCharacters(), 800);
        return id;

    } catch (e) {
        reportDiagnostic('character');
        throw e;
    }
}

export async function setCharacterRolePolicy(id: string, rolePolicy: RolePolicy): Promise<void> {
    await invoke('set_character_role_policy', { characterId: id, rolePolicy });
    characterState.allCharacters = characterState.allCharacters.map((character) =>
        String(character.id) === id ? { ...character, role_policy: rolePolicy } : character
    );
}

export async function addBundledRoleSnapshot(
    characterId: string,
    roleId: string
): Promise<BundledRoleSnapshot> {
    const snapshot = await invoke<BundledRoleSnapshot>('add_bundled_role_snapshot', {
        characterId,
        roleId,
    });
    characterState.allCharacters = characterState.allCharacters.map((character) =>
        String(character.id) === characterId
            ? { ...character, bundled_roles: [...character.bundled_roles, snapshot] }
            : character
    );
    return snapshot;
}

export async function loadBundledRoleSnapshots(characterId: string): Promise<void> {
    const snapshots = await invoke<BundledRoleSnapshot[]>('get_bundled_role_snapshots', {
        characterId,
    });
    characterState.allCharacters = characterState.allCharacters.map((character) =>
        String(character.id) === characterId
            ? { ...character, bundled_roles: snapshots }
            : character
    );
}

export async function removeBundledRoleSnapshot(
    characterId: string,
    snapshotId: string
): Promise<void> {
    await invoke('remove_bundled_role_snapshot', { characterId, snapshotId });
    characterState.allCharacters = characterState.allCharacters.map((character) =>
        String(character.id) === characterId
            ? {
                ...character,
                bundled_roles: character.bundled_roles.filter((snapshot) => snapshot.id !== snapshotId),
            }
            : character
    );
}

export async function loadBundledRoleAvatar(
    characterId: string,
    snapshotId: string
): Promise<void> {
    const avatarUrl = await invoke<string | null>('get_bundled_role_avatar', {
        characterId,
        snapshotId,
    });
    if (!avatarUrl) return;
    characterState.allCharacters = characterState.allCharacters.map((character) =>
        String(character.id) === characterId
            ? {
                ...character,
                bundled_roles: character.bundled_roles.map((snapshot) =>
                    snapshot.id === snapshotId ? { ...snapshot, avatarUrl } : snapshot
                ),
            }
            : character
    );
}

export async function deleteCharacter(id: string) {
    try {
        await invoke('delete_character', { id });
        avatarRevisions.set(id, (avatarRevisions.get(id) ?? 0) + 1);
        invalidatedAvatars.delete(id);
        avatarFetchesInFlight.delete(id);
        
        characterState.allCharacters = characterState.allCharacters.filter(c => c.id !== id);
        
        const newHidden = new Set(characterState.hiddenCharacterIds);
        newHidden.delete(id);
        characterState.hiddenCharacterIds = newHidden;

        const newPinned = new Set(characterState.pinnedCharacterIds);
        newPinned.delete(id);
        characterState.pinnedCharacterIds = newPinned;
        
    } catch (e) {
        reportDiagnostic('character');
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
        reportDiagnostic('character');
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
        reportDiagnostic('character');
        throw e;
    }

    return isNowPinned;
}
