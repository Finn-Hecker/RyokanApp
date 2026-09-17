import { invoke } from '@tauri-apps/api/core';
import { selectInitialGreeting } from '$lib/utils/characterGreeting';
import { appState } from './appState.svelte';
import { characterState, loadCharacters } from './characterStore.svelte';
import { getLocale } from '$lib/paraglide/runtime';
import { isMessageCoveredBySummary } from '$lib/utils/rollingSummaryCore';

export interface Message {
    id?: string;
    conversation_id: string;
    role: 'user' | 'assistant';
    content: string;
    author?: string | null;
    swipe_variants: string[];
    swipe_index: number;
}

export interface Conversation {
    id: string;
    title: string;
    character_id: string | null;
    mode: 'singleplayer' | 'multiplayer';
    created_at: string;
    updated_at: string;
    is_pinned: boolean;
    formattedDate?: string;
    /** Set if this chat was branched off another chat via "start new chat from here". */
    cloned_from_id?: string | null;
    /** Title of the source chat at the time it was cloned. */
    cloned_from_title?: string | null;
    folder_id: string | null;
    sort_order: number;
    role_snapshot: ChatRoleSnapshot | null;
}

export interface ChatRoleSnapshot {
    name: string;
    prompt: string;
}

export interface RoleSelection {
    source: 'global' | 'bundled';
    id: string;
}

export type ConversationMode = Conversation['mode'];

export interface ChatFolder {
    id: string;
    name: string;
    mode: ConversationMode;
    sort_order: number;
    is_collapsed: boolean;
}

export interface DisplayMessage {
    id: string;
    text: string;
    isUser: boolean;
    senderName: string;
    swipeVariants: string[];
    swipeIndex: number;
    generationError?: import('$lib/utils/generationError').GenerationErrorInfo;
}

/** Persisted rolling-summary metadata for the active chat session. */
export interface SummaryMeta {
    currentSummary:          string | null;
    lastSummarizedMessageId: string | null;
}

export const chatState = $state({
    conversations:   [] as Conversation[],
    folders:         [] as ChatFolder[],
    currentMessages: [] as Message[],
    activeChatId:    null as string | null,
    hasMoreMessages: false,
    summaryMeta: {
        currentSummary:          null,
        lastSummarizedMessageId: null,
    } as SummaryMeta,
    activeRoleSnapshot: null as ChatRoleSnapshot | null,
});

const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
});

const PAGE_SIZE = 2_147_483_647;
let loadedConversationMode: ConversationMode = 'singleplayer';

export async function loadAllConversations(mode: ConversationMode = loadedConversationMode) {
    loadedConversationMode = mode;
    try {
        const [result, folders] = await Promise.all([
            invoke<Conversation[]>('get_conversations_page', { limit: PAGE_SIZE, offset: 0, mode }),
            invoke<ChatFolder[]>('get_chat_folders', { mode }),
        ]);
        chatState.folders = folders;
        chatState.conversations = result.map(chat => ({
            ...chat,
            formattedDate: dateFormatter.format(new Date(chat.created_at))
        }));
    } catch (e) {
        console.error(e);
    }
}

export async function loadMoreConversations(mode: ConversationMode = loadedConversationMode): Promise<boolean> {
    if (mode !== loadedConversationMode) {
        await loadAllConversations(mode);
        return chatState.conversations.length === PAGE_SIZE;
    }
    try {
        const currentLength = chatState.conversations.length;
        const result = await invoke<Conversation[]>('get_conversations_page', {
            limit: PAGE_SIZE,
            offset: currentLength,
            mode,
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

export async function startNewChat(character: any, roleSelection: RoleSelection | null = null) {
    try {
        const selectedGreeting = selectInitialGreeting(character);
        const newId = await invoke<string>('create_chat', {
            characterId: character.id.toString(),
            characterName: character.name,
            initialMessage: selectedGreeting,
            mode: 'singleplayer',
            roleSelection,
        });
        await loadAllConversations('singleplayer');
        await loadMessages(newId);
    } catch (e) {
        console.error(e);
        throw e;
    }
}

export async function openHistoryChat(chatId: string) {
    await loadMessages(chatId);
    const currentChat = chatState.conversations.find(c => c.id === chatId);
    appState.activeCharacter = null;
    if (currentChat?.character_id) {
        if (characterState.allCharacters.length === 0) await loadCharacters();
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

/**
 * Clones the currently active chat up to and including a specific AI
 * message, creating a brand-new, independent conversation. The original
 * chat is left untouched. Returns the new chat's id, or null on failure.
 */
export async function cloneChatFromMessage(messageId: string): Promise<string | null> {
    const chatId = chatState.activeChatId;
    if (!chatId) return null;
    try {
        const newChatId = await invoke<string>('clone_chat_from_message', {
            chatId,
            upToMessageId: messageId,
        });
        await loadAllConversations('singleplayer');
        return newChatId;
    } catch (e) {
        console.error(e);
        return null;
    }
}

export async function loadMessages(chatId: string) {
    if (chatState.activeChatId !== chatId) {
        // Chat was switched: clear local history to avoid flickering
        chatState.currentMessages = [];
        chatState.hasMoreMessages = false;
        chatState.activeRoleSnapshot = chatState.conversations.find(
            (conversation) => conversation.id === chatId
        )?.role_snapshot ?? null;
        
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
        await invoke('add_message', {
            chatId,
            role,
            content,
            author: null,
            messageId: null,
            createdAt: null,
        });
        await loadAllConversations();
        await loadMessages(chatId);
    } catch (e) { console.error(e); }
}

async function invalidateSummaryIfCovered(chatId: string, messageId: string): Promise<void> {
    const meta = await invoke<{ summary: string | null; last_id: string | null }>(
        'get_summary_meta',
        { chatId },
    );
    if (!meta.summary && !meta.last_id) return;

    const messages = await invoke<Array<{ id: string }>>('get_messages', { chatId });
    const inconsistent = Boolean(meta.summary) !== Boolean(meta.last_id);
    if (!inconsistent && !isMessageCoveredBySummary(messages, meta.last_id, messageId)) return;

    await invoke('save_summary_meta', {
        chatId,
        summary: null,
        lastSummarizedMessageId: null,
    });
    if (chatState.activeChatId === chatId) {
        chatState.summaryMeta = {
            currentSummary: null,
            lastSummarizedMessageId: null,
        };
    }
}

export async function addSwipeVariant(messageId: string, content: string): Promise<void> {
    const chatId = chatState.activeChatId;
    try {
        if (chatId) await invalidateSummaryIfCovered(chatId, messageId);
        await invoke('add_swipe_variant', { messageId, content });
        if (chatId) await loadMessages(chatId);
    } catch (e) {
        console.error(e);
        throw e;
    }
}

export async function setSwipeIndex(messageId: string, index: number): Promise<void> {
    const msg = chatState.currentMessages.find(m => m.id === messageId);
    const chatId = chatState.activeChatId;
    try {
        if (chatId) await invalidateSummaryIfCovered(chatId, messageId);
        await invoke('set_swipe_index', { messageId, index });
        if (msg) {
            const clamped = Math.max(0, Math.min(index, msg.swipe_variants.length - 1));
            msg.swipe_index = clamped;
            msg.content = msg.swipe_variants[clamped];
        }
    } catch (e) {
        console.error(e);
        throw e;
    }
}

export async function updateMessage(id: string, content: string) {
    const chatId = chatState.activeChatId;
    try {
        if (chatId) await invalidateSummaryIfCovered(chatId, id);
        await invoke('update_message', { id, content });
        if (chatId) await loadMessages(chatId);
    } catch (e) {
        console.error(e);
        throw e;
    }
}

export async function deleteMessage(id: string) {
    const chatId = chatState.activeChatId;
    try {
        if (chatId) await invalidateSummaryIfCovered(chatId, id);
        await invoke('delete_message', { id });
        if (chatId) await loadMessages(chatId);
    } catch (e) {
        console.error(e);
        throw e;
    }
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

export async function createChatFolder(name: string, mode: ConversationMode) {
    const folder = await invoke<ChatFolder>('create_chat_folder', { name, mode });
    chatState.folders = [...chatState.folders, folder];
}

export async function renameChatFolder(id: string, name: string) {
    await invoke('rename_chat_folder', { id, name });
    const folder = chatState.folders.find(item => item.id === id);
    if (folder) folder.name = name.trim();
}

export async function setChatFolderCollapsed(id: string, isCollapsed: boolean) {
    await invoke('set_chat_folder_collapsed', { id, isCollapsed });
    const folder = chatState.folders.find(item => item.id === id);
    if (folder) folder.is_collapsed = isCollapsed;
}

export async function deleteChatFolder(id: string) {
    await invoke('delete_chat_folder', { id });
    chatState.folders = chatState.folders.filter(folder => folder.id !== id);
    for (const chat of chatState.conversations) {
        if (chat.folder_id === id) chat.folder_id = null;
    }
    await persistSidebarOrganization(loadedConversationMode);
}

export async function persistSidebarOrganization(mode: ConversationMode) {
    const folders = chatState.folders
        .filter(folder => folder.mode === mode)
        .map((folder, index) => ({ ...folder, sort_order: index }));
    chatState.folders = folders;

    const grouped = new Map<string | null, Conversation[]>();
    for (const chat of chatState.conversations.filter(chat => chat.mode === mode)) {
        const items = grouped.get(chat.folder_id) ?? [];
        items.push(chat);
        grouped.set(chat.folder_id, items);
    }
    const chats = [...grouped.entries()].flatMap(([folderId, items]) => {
        const orderedItems = folderId === null
            ? [...items].sort((a, b) => {
                const activityDifference = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
                return activityDifference || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
            })
            : items;
        return orderedItems.map((chat, index) => {
            chat.sort_order = index;
            return { id: chat.id, folder_id: chat.folder_id, sort_order: index };
        });
    });
    await invoke('save_sidebar_organization', {
        mode,
        folderIds: folders.map(folder => folder.id),
        chats,
    });
}
