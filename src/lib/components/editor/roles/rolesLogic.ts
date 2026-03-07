import { createRole, updateRole, deleteRole } from '$lib/stores/roleStore.svelte';

export interface SaveRoleOptions {
    name:          string;
    bio?:          string;
    pronouns?:     string;
    avatarDataUrl: string | null;
    avatarChanged: boolean;
}

export async function saveNewRole(opts: SaveRoleOptions): Promise<void> {
    await createRole({
        name:     opts.name,
        bio:      opts.bio      ?? '',
        pronouns: opts.pronouns ?? '',
        avatar:   opts.avatarChanged ? (opts.avatarDataUrl ?? undefined) : undefined,
    });
}

export async function saveExistingRole(
    id:   string,
    opts: SaveRoleOptions,
): Promise<void> {
    await updateRole(id, {
        name:     opts.name,
        bio:      opts.bio      ?? '',
        pronouns: opts.pronouns ?? '',
        ...(opts.avatarChanged && { avatar: opts.avatarDataUrl ?? undefined }),
    });
}

export async function removeRole(id: string): Promise<void> {
    await deleteRole(id);
}