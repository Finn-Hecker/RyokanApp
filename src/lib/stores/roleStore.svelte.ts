import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
import { invoke } from '@tauri-apps/api/core';
import { getSetting } from '$lib/settings/settings';

const DEFAULT_ROLE_SETTING = 'default_role_id';

export interface Role {
    id: string;
    name: string;
    prompt: string;
    has_avatar: boolean;
    created_at: string;
    avatarUrl?: string;
    thumbnailUrl?: string;
}

export type RoleInput = Pick<Role, 'name' | 'prompt'> & {
    avatar?: string | null;
};

export const roleState = $state({
    roles: [] as Role[],
    defaultRoleId: null as string | null,
});

let rolesLoaded = false;
let initialRoleLoad: Promise<void> | undefined;

export function ensureRolesLoaded(): Promise<void> {
    if (rolesLoaded) return Promise.resolve();
    if (!initialRoleLoad) initialRoleLoad = loadRoles().finally(() => { initialRoleLoad = undefined; });
    return initialRoleLoad;
}

export async function loadRoles(): Promise<void> {
    try {
        const [roles, savedDefaultId] = await Promise.all([
            invoke<Role[]>('get_roles'),
            getSetting(DEFAULT_ROLE_SETTING),
        ]);
        const existing = new Map(roleState.roles.map(role => [role.id, role]));
        const next = roles.map(role => {
            const previous = existing.get(role.id);
            if (!previous) return role;
            Object.assign(previous, role, {
                avatarUrl: role.has_avatar ? previous.avatarUrl : undefined,
                thumbnailUrl: role.has_avatar ? previous.thumbnailUrl : undefined,
            });
            return previous;
        });
        if (next.length !== roleState.roles.length || next.some((role, index) => role !== roleState.roles[index])) {
            roleState.roles = next;
        }
        roleState.defaultRoleId = roles.some((role) => role.id === savedDefaultId)
            ? savedDefaultId
            : null;
        rolesLoaded = true;
    } catch (error) {
        reportDiagnostic('role');
        throw error;
    }
}

export async function setDefaultRole(id: string | null): Promise<void> {
    await invoke('save_setting', { key: DEFAULT_ROLE_SETTING, value: id ?? '' });
    roleState.defaultRoleId = id;
}

const avatarFetchesInFlight = new Map<string, Promise<void>>();
const thumbnailFetchesInFlight = new Map<string, Promise<void>>();
const avatarRevisions = new Map<string, number>();

export function loadRoleAvatar(id: string): Promise<void> {
    return loadRoleImage(id, false);
}

export function loadRoleThumbnail(id: string): Promise<void> {
    return loadRoleImage(id, true);
}

function loadRoleImage(id: string, thumbnail: boolean): Promise<void> {
    const field = thumbnail ? 'thumbnailUrl' : 'avatarUrl';
    const requests = thumbnail ? thumbnailFetchesInFlight : avatarFetchesInFlight;
    const role = roleState.roles.find(role => role.id === id);
    if (!role?.has_avatar || role[field]) return Promise.resolve();
    const pending = requests.get(id);
    if (pending) return pending;
    const revision = avatarRevisions.get(id) ?? 0;
    const request = (async () => {
        try {
            const avatarUrl = await invoke<string | null>(thumbnail ? 'get_role_thumbnail' : 'get_role_avatar', { id });
            if (!avatarUrl || revision !== (avatarRevisions.get(id) ?? 0)) return;
            const current = roleState.roles.find(role => role.id === id);
            if (current?.has_avatar) current[field] = avatarUrl;
        } catch (error) {
            reportDiagnostic('role');
            throw error;
        }
    })().finally(() => {
        if (requests.get(id) === request) requests.delete(id);
    });
    requests.set(id, request);
    return request;
}

export async function createRole(input: RoleInput): Promise<string> {
    try {
        await ensureRolesLoaded();
        const isFirstRole = roleState.roles.length === 0;
        const id = await invoke<string>('create_role', { payload: input });
        if (isFirstRole) await setDefaultRole(id);
        await loadRoles();
        if (input.avatar) await loadRoleAvatar(id);
        return id;
    } catch (error) {
        reportDiagnostic('role');
        throw error;
    }
}

export async function updateRole(id: string, input: RoleInput): Promise<void> {
    try {
        await invoke('update_role', { id, payload: input });
        if (input.avatar && !input.avatar.startsWith('blob:')) {
            avatarRevisions.set(id, (avatarRevisions.get(id) ?? 0) + 1);
            avatarFetchesInFlight.delete(id);
            thumbnailFetchesInFlight.delete(id);
            const role = roleState.roles.find(role => role.id === id);
            if (role) { role.avatarUrl = undefined; role.thumbnailUrl = undefined; }
        }
        await loadRoles();
        if (input.avatar) await loadRoleAvatar(id);
    } catch (error) {
        reportDiagnostic('role');
        throw error;
    }
}

export async function deleteRole(id: string): Promise<void> {
    try {
        await invoke('delete_role', { id });
        avatarRevisions.set(id, (avatarRevisions.get(id) ?? 0) + 1);
        avatarFetchesInFlight.delete(id);
        thumbnailFetchesInFlight.delete(id);
        roleState.roles = roleState.roles.filter((role) => role.id !== id);
        if (roleState.defaultRoleId === id) roleState.defaultRoleId = null;
    } catch (error) {
        reportDiagnostic('role');
        throw error;
    }
}
