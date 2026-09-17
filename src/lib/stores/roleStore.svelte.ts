import { invoke } from '@tauri-apps/api/core';

export interface Role {
    id: string;
    name: string;
    prompt: string;
    has_avatar: boolean;
    created_at: string;
    avatarUrl?: string;
}

export type RoleInput = Pick<Role, 'name' | 'prompt'> & {
    avatar?: string | null;
};

export const roleState = $state({
    roles: [] as Role[],
});

export async function loadRoles(): Promise<void> {
    try {
        const avatarUrls = new Map(
            roleState.roles
                .filter((role) => role.avatarUrl)
                .map((role) => [role.id, role.avatarUrl] as const)
        );
        const roles = await invoke<Role[]>('get_roles');
        roleState.roles = roles.map((role) => {
            const avatarUrl = avatarUrls.get(role.id);
            return avatarUrl ? { ...role, avatarUrl } : role;
        });
    } catch (error) {
        console.error('Error loading roles:', error);
        throw error;
    }
}

const avatarFetchesInFlight = new Set<string>();

export async function loadRoleAvatar(id: string): Promise<void> {
    if (avatarFetchesInFlight.has(id)) return;
    avatarFetchesInFlight.add(id);

    try {
        const avatarUrl = await invoke<string | null>('get_role_avatar', { id });
        if (!avatarUrl) return;
        roleState.roles = roleState.roles.map((role) =>
            role.id === id ? { ...role, avatarUrl } : role
        );
    } catch (error) {
        console.error('Error loading role avatar:', id, error);
        throw error;
    } finally {
        avatarFetchesInFlight.delete(id);
    }
}

export async function createRole(input: RoleInput): Promise<string> {
    try {
        const id = await invoke<string>('create_role', { payload: input });
        await loadRoles();
        if (input.avatar) {
            roleState.roles = roleState.roles.map((role) =>
                role.id === id
                    ? { ...role, has_avatar: true, avatarUrl: input.avatar ?? undefined }
                    : role
            );
            setTimeout(() => void loadRoles(), 800);
        }
        return id;
    } catch (error) {
        console.error('Error creating role:', error);
        throw error;
    }
}

export async function updateRole(id: string, input: RoleInput): Promise<void> {
    try {
        await invoke('update_role', { id, payload: input });
        await loadRoles();
        if (input.avatar) {
            roleState.roles = roleState.roles.map((role) =>
                role.id === id
                    ? { ...role, has_avatar: true, avatarUrl: input.avatar ?? undefined }
                    : role
            );
            setTimeout(() => void loadRoles(), 800);
        }
    } catch (error) {
        console.error('Error updating role:', error);
        throw error;
    }
}

export async function deleteRole(id: string): Promise<void> {
    try {
        await invoke('delete_role', { id });
        roleState.roles = roleState.roles.filter((role) => role.id !== id);
    } catch (error) {
        console.error('Error deleting role:', error);
        throw error;
    }
}
