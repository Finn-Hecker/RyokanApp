import type { Character } from '$lib/stores/characterStore.svelte';
import type { ChatRoleSnapshot, RoleSelection } from '$lib/stores/chatStore.svelte';

interface PersonaRole extends ChatRoleSnapshot { id: string }
export interface GroupPersonaOption {
    key: string;
    persona: ChatRoleSnapshot | null;
    selections: (RoleSelection | null)[];
}

/** A shared persona can have a different bundled-role ID on each card. */
export function groupPersonaOptions(characters: readonly Character[], roles: readonly PersonaRole[]): GroupPersonaOption[] {
    if (!characters.length) return [];
    const candidates: (ChatRoleSnapshot | null)[] = [null, ...roles, ...characters.flatMap(card => card.bundled_roles)];
    const seen = new Set<string>();
    const options: GroupPersonaOption[] = [];
    for (const persona of candidates) {
        const key = JSON.stringify(persona ? [persona.name, persona.prompt] : null);
        if (seen.has(key)) continue;
        seen.add(key);
        const selections: (RoleSelection | null)[] = [];
        let allowed = true;
        for (const card of characters) {
            if (!persona) {
                if (card.role_policy === 'restricted') { allowed = false; break; }
                selections.push(null);
                continue;
            }
            const bundled = card.bundled_roles.find(role => role.name === persona.name && role.prompt === persona.prompt);
            const global = card.role_policy === 'restricted' ? undefined
                : roles.find(role => role.name === persona.name && role.prompt === persona.prompt);
            if (global) selections.push({ source: 'global', id: global.id });
            else if (bundled) selections.push({ source: 'bundled', id: bundled.id });
            else { allowed = false; break; }
        }
        if (allowed) options.push({ key, persona: persona ? { name: persona.name, prompt: persona.prompt } : null, selections });
    }
    return options;
}
