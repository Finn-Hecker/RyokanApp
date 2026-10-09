import type { ChatCharacterSnapshot } from '../stores/chatStore.svelte';

/** Character count and transport mode are independent dimensions. */
export type ChatKind = 'single' | 'group';

export type GroupCharacterSnapshot = Omit<ChatCharacterSnapshot, 'id'> & { id: string };

export interface GroupParticipant {
    /** Globally unique, chat-local ID; used as the stable speaker ID. */
    id: string;
    conversation_id: string;
    /** Informational library reference; the snapshot survives library deletion. */
    character_id: string | null;
    character_snapshot: GroupCharacterSnapshot;
    sort_order: number;
    created_at: string;
}

export interface PersistedGroupParticipantRow extends Omit<GroupParticipant, 'character_snapshot'> {
    character_snapshot: GroupCharacterSnapshot | string;
}

/** Older IPC payloads predate chat_kind; unknown kinds must not become solo chats. */
export function decodeChatKind(value: unknown): ChatKind {
    if (value === undefined || value === null) return 'single';
    if (value === 'single' || value === 'group') return value;
    throw new Error('Invalid conversation chat_kind');
}

/** Decode SQLite JSON or a Rust-decoded IPC snapshot without library lookups. */
export function decodeGroupParticipant(row: PersistedGroupParticipantRow): GroupParticipant {
    const snapshot: unknown = typeof row.character_snapshot === 'string'
        ? JSON.parse(row.character_snapshot) : row.character_snapshot;
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Invalid participant character snapshot');
    }
    const fields = snapshot as Record<string, unknown>;
    for (const key of ['id', 'name', 'prompt', 'greeting', 'initials', 'color']) {
        if (typeof fields[key] !== 'string') throw new Error('Invalid participant character snapshot');
    }
    if (fields.avatarUrl != null && typeof fields.avatarUrl !== 'string') {
        throw new Error('Invalid participant character snapshot');
    }
    const worldInfoIds = fields.world_info_ids === undefined ? [] : fields.world_info_ids;
    if (!Array.isArray(worldInfoIds) || !worldInfoIds.every(id => typeof id === 'string')) {
        throw new Error('Invalid participant character snapshot');
    }
    if (typeof row.id !== 'string' || !row.id.trim()
        || typeof row.conversation_id !== 'string' || !row.conversation_id.trim()
        || (row.character_id !== null && typeof row.character_id !== 'string')
        || !Number.isSafeInteger(row.sort_order) || row.sort_order < 0
        || typeof row.created_at !== 'string') {
        throw new Error('Invalid group participant');
    }
    return {
        ...row,
        character_snapshot: {
            id: fields.id as string,
            name: fields.name as string,
            prompt: fields.prompt as string,
            greeting: fields.greeting as string,
            initials: fields.initials as string,
            color: fields.color as string,
            avatarUrl: fields.avatarUrl == null ? undefined : fields.avatarUrl as string,
            world_info_ids: [...worldInfoIds],
        },
    };
}
