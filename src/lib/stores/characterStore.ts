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
}

export const allCharacters = writable<Character[]>([...STATIC_CHARACTERS]);

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
                avatarUrl
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

        setTimeout(() => {
            loadCharacters();
        }, 600);
        
    } catch (e) {
        console.error("Error creating character:", e);
        
        allCharacters.update(chars => chars.filter(c => c.id !== tempId));
        
        throw e;
    }
}