import { invoke } from '@tauri-apps/api/core';
import { appState } from './appState.svelte';
import { characterState } from './characterStore.svelte';
import { roleState } from './roleStore.svelte';
import { getLocale } from '$lib/paraglide/runtime';

export interface Message {
    id?: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    swipe_variants: string[];
    swipe_index: number;
}

export interface Conversation {
    id: string;
    title: string;
    character_id: string;
    created_at: string;
    updated_at: string;
    is_pinned: boolean;
    formattedDate?: string;
}

export interface DisplayMessage {
    id: string;
    text: string;
    isUser: boolean;
    senderName: string;
    swipeVariants: string[];
    swipeIndex: number;
}

/**
 * Soft-summary metadata for the active chat session.
 * Lives purely in memory — the DB is never mutated by the summarizer.
 */
export interface SummaryMeta {
    currentSummary:          string | null;
    lastSummarizedMessageId: string | null;
}

export const chatState = $state({
    conversations:   [] as Conversation[],
    currentMessages: [] as Message[],
    activeChatId:    null as string | null,
    hasMoreMessages: false,
    summaryMeta: {
        currentSummary:          null,
        lastSummarizedMessageId: null,
    } as SummaryMeta,
});

const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
});

const PAGE_SIZE = 15;

export async function loadAllConversations() {
    try {
        const result = await invoke<Conversation[]>('get_conversations_page', {
            limit: PAGE_SIZE,
            offset: 0,
        });
        chatState.conversations = result.map(chat => ({
            ...chat,
            formattedDate: dateFormatter.format(new Date(chat.created_at))
        }));
    } catch (e) {
        console.error(e);
    }
}

export async function loadMoreConversations(): Promise<boolean> {
    try {
        const currentLength = chatState.conversations.length;
        const result = await invoke<Conversation[]>('get_conversations_page', {
            limit: PAGE_SIZE,
            offset: currentLength,
        });
        if (result.length === 0) return false;
        chatState.conversations = [
            ...chatState.conversations,
            ...result.map(chat => ({
                ...chat,
                formattedDate: dateFormatter.format(new Date(chat.created_at))
            }))
        ];
        return result.length === PAGE_SIZE;
    } catch (e) {
        console.error(e);
        return false;
    }
}

export async function startNewChat(character: any) {
    try {
        let allGreetings: string[] = [];
        if (character.greeting && character.greeting.trim().length > 0) {
            allGreetings.push(character.greeting);
        }
        if (character.alternate_greetings) {
            try {
                const altGreetings = typeof character.alternate_greetings === 'string'
                    ? JSON.parse(character.alternate_greetings)
                    : character.alternate_greetings;
                if (Array.isArray(altGreetings)) {
                    allGreetings.push(...altGreetings.filter((g: unknown) =>
                        typeof g === 'string' && (g as string).trim().length > 0
                    ));
                }
            } catch (e) {
                console.warn("Could not parse alternative greetings:", e);
            }
        }
        const rawGreeting = allGreetings.length > 0
            ? allGreetings[Math.floor(Math.random() * allGreetings.length)]
            : null;
        const activeRole = roleState.allRoles.find(r => r.id === roleState.activeRoleId);
        const userName: string = activeRole?.name ?? (character as any).userName ?? 'User';
        const selectedGreeting = rawGreeting
            ? rawGreeting
                .replace(/\{\{char\}\}/gi, character.name)
                .replace(/\{\{user\}\}/gi, userName)
            : null;
        const newId = await invoke<string>('create_chat', {
            characterId: character.id.toString(),
            characterName: character.name,
            initialMessage: selectedGreeting
        });
        await loadAllConversations();
        await loadMessages(newId);
    } catch (e) { console.error(e); }
}

export async function openHistoryChat(chatId: string) {
    await loadMessages(chatId);
    const currentChat = chatState.conversations.find(c => c.id === chatId);
    if (currentChat?.character_id) {
        const char = characterState.allCharacters.find(
            c => c.id.toString() === currentChat.character_id
        );
        if (char) {
            appState.activeCharacter = char;
        } else {
            console.warn("Could not find a character for this chat.");
        }
    }
}

export async function loadMessages(chatId: string) {
    if (chatState.activeChatId !== chatId) {
        // Chat was switched: clear local history to avoid flickering
        chatState.currentMessages = [];
        chatState.hasMoreMessages = false;
        
        try {
            const meta = await invoke<{ summary: string | null; last_id: string | null }>(
                'get_summary_meta', { chatId }
            );
            chatState.summaryMeta = {
                currentSummary:          meta.summary,
                lastSummarizedMessageId: meta.last_id,
            };
        } catch {
            chatState.summaryMeta = { currentSummary: null, lastSummarizedMessageId: null };
        }
    }
    
    try {
        // Smart limit: If we're still in the same chat (e.g. after sending a message),
        // we don't want to suddenly collapse the history back to 25.
        // Instead, request the currently loaded amount + 1 (for the new message).
        const limit = chatState.activeChatId === chatId && chatState.currentMessages.length >= 25
            ? chatState.currentMessages.length + 1
            : 25;

        // Use your get_messages_page function from the backend
        const result = await invoke<any[]>('get_messages_page', { chatId, limit, offset: 0 });
        
        chatState.currentMessages = result.map(row => ({
            ...row,
            swipe_variants: typeof row.swipe_variants === 'string'
                ? JSON.parse(row.swipe_variants)
                : (row.swipe_variants ?? [row.content]),
            swipe_index: row.swipe_index ?? 0,
        }));
        chatState.activeChatId = chatId;
        
        // If we hit the limit exactly, there are probably more messages available
        chatState.hasMoreMessages = result.length === limit;
    } catch (e) { console.error(e); }
}

// Triggered when the user scrolls up
export async function loadMoreMessages() {
    const chatId = chatState.activeChatId;
    if (!chatId || !chatState.hasMoreMessages) return;

    try {
        const currentLength = chatState.currentMessages.length;
        const result = await invoke<any[]>('get_messages_page', {
            chatId,
            limit: 25,
            offset: currentLength,
        });

        if (result.length === 0) {
            chatState.hasMoreMessages = false;
            return;
        }

        const parsed = result.map(row => ({
            ...row,
            swipe_variants: typeof row.swipe_variants === 'string'
                ? JSON.parse(row.swipe_variants)
                : (row.swipe_variants ?? [row.content]),
            swipe_index: row.swipe_index ?? 0,
        }));

        // Prepend older messages at the beginning
        chatState.currentMessages = [...parsed, ...chatState.currentMessages];
        chatState.hasMoreMessages = result.length === 25;
    } catch (e) { console.error(e); }
}

export async function addMessage(role: 'user' | 'assistant', content: string) {
    const chatId = chatState.activeChatId;
    if (!chatId) return;
    try {
        await invoke('add_message', { chatId, role, content });
        await loadAllConversations();
        await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

export async function addSwipeVariant(messageId: string, content: string): Promise<void> {
    const chatId = chatState.activeChatId;
    try {
        await invoke('add_swipe_variant', { messageId, content });
        if (chatId) await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

export async function setSwipeIndex(messageId: string, index: number): Promise<void> {
    const msg = chatState.currentMessages.find(m => m.id === messageId);
    if (msg) {
        const clamped = Math.max(0, Math.min(index, msg.swipe_variants.length - 1));
        msg.swipe_index = clamped;
        msg.content = msg.swipe_variants[clamped];
    }
    try {
        await invoke('set_swipe_index', { messageId, index });
    } catch (e) { console.error(e); }
}

export async function updateMessage(id: string, content: string) {
    const chatId = chatState.activeChatId;
    try {
        await invoke('update_message', { id, content });
        if (chatId) await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

export async function deleteMessage(id: string) {
    const chatId = chatState.activeChatId;
    try {
        await invoke('delete_message', { id });
        if (chatId) await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

export async function renameConversation(id: string, title: string) {
    try {
        await invoke('rename_chat', { id, title });
        await loadAllConversations();
    } catch (e) { console.error(e); }
}

export async function togglePinConversation(id: string) {
    try {
        await invoke('toggle_pin_chat', { id });
        await loadAllConversations();
    } catch (e) { console.error(e); }
}

export async function deleteConversation(id: string) {
    try {
        await invoke('delete_chat', { id });
        await loadAllConversations();
        if (chatState.activeChatId === id) {
            chatState.activeChatId    = null;
            chatState.currentMessages = [];
            chatState.summaryMeta     = {
                currentSummary:          null,
                lastSummarizedMessageId: null,
            };
        }
    } catch (e) { console.error(e); }
}