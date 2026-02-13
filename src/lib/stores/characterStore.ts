import { writable, get } from 'svelte/store';
import { invoke } from '@tauri-apps/api/core';
import { CHARACTERS as STATIC_CHARACTERS } from '$lib/data/characters';

export interface Character {
    id: string | number;
    name: string;
    desc: string;
    greeting: string;
    initials: string;
    color: string;
    isCustom?: boolean;
}

export const allCharacters = writable<Character[]>([...STATIC_CHARACTERS]);

export async function loadCharacters() {
    try {
        const dbChars = await invoke<Character[]>('get_custom_characters');
        
        const customChars = dbChars.map(c => ({ ...c, isCustom: true }));
        
        allCharacters.set([...STATIC_CHARACTERS, ...customChars]);
        
    } catch (e) {
        console.error("Error loading characters:", e);
    }
}

export async function createCharacter(charData: any) {
    try {
        await invoke('create_character', {
            name: charData.name,
            desc: charData.desc,
            greeting: charData.greeting,
            initials: charData.initials,
            color: charData.color
        });
        
        await loadCharacters();
    } catch (e) {
        console.error("Error creating character:", e);
    }
}