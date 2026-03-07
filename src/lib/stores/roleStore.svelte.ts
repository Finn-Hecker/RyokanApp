import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_ROLES } from '$lib/data/roles';

export interface Role {
    id: string;
    name: string;
    bio?: string;
    pronouns?: 'he/him' | 'she/her' | 'they/them' | 'it/its' | string;
    avatar?: number[] | string;
    avatarUrl?: string;
    createdAt?: string;
}

interface RolePayload {
    name:      string;
    bio:       string;
    pronouns:  string;
    avatar?:   string;
}

function bytesToUrl(bytes: number[]): string {
    const uint8 = new Uint8Array(bytes);
    const blob  = new Blob([uint8], { type: 'image/webp' });
    return URL.createObjectURL(blob);
}

function hydrateRole(p: Role): Role {
    let avatarUrl = p.avatarUrl;

    if (Array.isArray(p.avatar) && p.avatar.length > 0) {
        avatarUrl = bytesToUrl(p.avatar);
    } else if (typeof p.avatar === 'string' && p.avatar.startsWith('data:')) {
        avatarUrl = p.avatar;
    }

    return { ...p, avatarUrl };
}

export const roleState = $state({
    allRoles: [...DEFAULT_ROLES] as Role[],
    activeRoleId: null as string | null
});

export async function loadRoles(): Promise<void> {
    const previousActiveId = roleState.activeRoleId;

    try {
        const rows = await invoke<Role[]>('get_roles');
        roleState.allRoles = [...DEFAULT_ROLES, ...rows.map(hydrateRole)];
    } catch (e) {
        console.error('roleStore – loadRoles:', e);
    }

    const all = roleState.allRoles;

    if (previousActiveId && all.some(p => p.id === previousActiveId)) return;

    const saved = localStorage.getItem('ryokan-active-role');
    if (saved && all.some(p => p.id === saved)) {
        roleState.activeRoleId = saved;
    } else {
        const first = all[0];
        if (first) setActiveRole(first.id);
    }
}

export function setActiveRole(id: string): void {
    roleState.activeRoleId = id;
    localStorage.setItem('ryokan-active-role', id);
}

export async function createRole(data: Omit<Role, 'id' | 'avatarUrl'>): Promise<void> {
    const tempId   = `temp-${Date.now()}`;
    const optimistic = hydrateRole({ ...data, id: tempId });

    roleState.allRoles = [
        ...DEFAULT_ROLES,
        optimistic,
        ...roleState.allRoles.slice(DEFAULT_ROLES.length),
    ];

    try {
        const realId = await invoke<string>('create_role', {
            payload: buildPayload(data),
        });

        roleState.allRoles = roleState.allRoles.map(p =>
            (p.id === tempId ? { ...p, id: realId } : p)
        );

        setActiveRole(realId);
        setTimeout(() => loadRoles(), 600);

    } catch (e) {
        console.error('roleStore – createRole:', e);
        roleState.allRoles = roleState.allRoles.filter(p => p.id !== tempId);
        throw e;
    }
}

export async function updateRole(
    id:   string,
    data: Partial<Omit<Role, 'id' | 'avatarUrl'>>
): Promise<void> {
    const snapshot = [...roleState.allRoles];

    roleState.allRoles = roleState.allRoles.map(p =>
        (p.id === id ? hydrateRole({ ...p, ...data, id }) : p)
    );

    try {
        await invoke('update_role', { id, payload: buildPayload(data) });
        setTimeout(() => loadRoles(), 600);
    } catch (e) {
        console.error('roleStore – updateRole:', e);
        roleState.allRoles = snapshot;
        throw e;
    }
}

export async function deleteRole(id: string): Promise<void> {
    try {
        await invoke('delete_role', { id });
        roleState.allRoles = roleState.allRoles.filter(p => p.id !== id);

        if (roleState.activeRoleId === id) {
            const first = roleState.allRoles[0];
            first ? setActiveRole(first.id) : (roleState.activeRoleId = null);
        }
    } catch (e) {
        console.error('roleStore – deleteRole:', e);
        throw e;
    }
}

function buildPayload(data: Partial<Omit<Role, 'id' | 'avatarUrl'>>): RolePayload {
    const avatar =
        typeof data.avatar === 'string' &&
        data.avatar.length > 0 &&
        !data.avatar.startsWith('blob:')
            ? data.avatar
            : undefined;

    return {
        name:     data.name     ?? '',
        bio:      data.bio      ?? '',
        pronouns: data.pronouns ?? '',
        ...(avatar !== undefined && { avatar }),
    };
}