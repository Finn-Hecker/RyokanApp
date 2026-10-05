import type { TokenUsage } from '../ai/tokens/tokenUsage.ts';

export interface Message {
    id?: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    author?: string | null;
    swipe_variants: string[];
    swipe_index: number;
    usage_variants: (TokenUsage | null)[];
}

export interface PersistedMessageRow extends Omit<Message, 'swipe_variants' | 'usage_variants' | 'swipe_index'> {
    swipe_variants?: string[] | string | null;
    swipe_index?: number | null;
    usage_variants?: Message['usage_variants'] | string | null;
}

/** Decode IPC rows identically for paginated chat and full summary history. */
export function decodeMessage(row: PersistedMessageRow): Message {
    return {
        ...row,
        swipe_variants: typeof row.swipe_variants === 'string'
            ? JSON.parse(row.swipe_variants)
            : (row.swipe_variants ?? [row.content]),
        swipe_index: row.swipe_index ?? 0,
        usage_variants: typeof row.usage_variants === 'string'
            ? JSON.parse(row.usage_variants) : (row.usage_variants ?? []),
    };
}
