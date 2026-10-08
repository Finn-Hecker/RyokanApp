import { reportDiagnostic, reportChatExportStage, type ChatExportStage } from '$lib/diagnostics/diagnostics';
import { invoke } from '@tauri-apps/api/core';
import { loadWorldInfos } from './worldInfoStore.svelte';
import { selectInitialGreeting } from '$lib/chat/characterGreeting';
import { appState } from './appState.svelte';
import { characterState, loadCharacters, type Character } from './characterStore.svelte';
import { getLocale } from '$lib/paraglide/runtime';
import { bumpConversationRevision, isMessageCoveredBySummary } from '$lib/ai/summary/rollingSummaryCore';
import type { TokenUsage } from '$lib/ai/tokens/tokenUsage';

import { decodeMessage, type Message, type PersistedMessageRow } from '$lib/chat/messageData';
export type { Message } from '$lib/chat/messageData';

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

export type ChatCharacterSnapshot = Pick<Character,
    'id' | 'name' | 'prompt' | 'greeting' | 'initials' | 'color' | 'avatarUrl' | 'world_info_ids'>;

function characterSnapshot(character: Character): ChatCharacterSnapshot {
    return {
        id: String(character.id), name: character.name, prompt: character.prompt,
        greeting: character.greeting, initials: character.initials, color: character.color,
        avatarUrl: character.avatarUrl, world_info_ids: [...(character.world_info_ids ?? [])],
    };
}

/** Backfill legacy bundled cards through the existing snapshot path. */
export async function exportConversationJson(chat: Conversation): Promise<string> {
    let stage: ChatExportStage = 'prepare';
    reportChatExportStage(stage, 'entered');
    try {
    if (chat.mode !== 'singleplayer') throw new Error('Only solo chats can be exported');
    if (characterState.allCharacters.length === 0) await loadCharacters();
    const character = characterState.allCharacters.find(item => String(item.id) === chat.character_id);
    const fallback = character ? characterSnapshot(character) : null;
    reportChatExportStage(stage, 'completed');
    stage = 'snapshot_ipc';
    reportChatExportStage(stage, 'entered');
    await invoke('get_chat_character_snapshot', {
        chatId: chat.id, fallback,
        traceExport: true,
    });
    reportChatExportStage(stage, 'completed');
    stage = 'export_ipc';
    reportChatExportStage(stage, 'entered');
    const json = await invoke<string>('export_chat_json', { chatId: chat.id });
    reportChatExportStage(stage, 'completed');
    return json;
    } catch (error) {
        reportChatExportStage(stage, 'failed');
        throw error;
    }
}

export async function importConversationJson(json: string): Promise<string> {
    const conversation = await invoke<Conversation>('import_chat_json', { json });
    await loadWorldInfos();
    await loadAllConversations('singleplayer');
    // Retain the committed row even if the library refresh failed or omitted it.
    if (!chatState.conversations.some(chat => chat.id === conversation.id)) {
        chatState.conversations.push(...formatConversations([conversation]));
        supplementalConversationIds.add(conversation.id);
    }
    return conversation.id;
}

/** Save only the chat-owned card, and publish it after persistence succeeds. */
export async function updateChatCharacterSnapshot(chatId: string, snapshot: ChatCharacterSnapshot): Promise<void> {
    const saved = await invoke<ChatCharacterSnapshot>('update_chat_character_snapshot', {
        chatId,
        snapshot: { ...snapshot, world_info_ids: [...(snapshot.world_info_ids ?? [])] },
    });
    if (chatState.activeChatId === chatId) {
        appState.activeCharacter = saved;
    }
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
    chat_count: number;
}

export interface DisplayMessage {
    usage?: TokenUsage | null;
    id: string;
    text: string;
    isUser: boolean;
    senderName: string;
    swipeVariants: string[];
    swipeIndex: number;
    generationError?: import('$lib/ai/generation/generationError').GenerationErrorInfo;
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

const PAGE_SIZE = 10;
let loadedConversationMode: ConversationMode = 'singleplayer';
// Imported rows supplied outside loaded pages must not advance pagination.
const supplementalConversationIds = new Set<string>();

function formatConversations(conversations: Conversation[]) {
    return conversations.map(chat => ({
        ...chat,
        formattedDate: dateFormatter.format(new Date(chat.created_at))
    }));
}

function replaceModeConversations(mode: ConversationMode, conversations: Conversation[]) {
    for (const chat of chatState.conversations) {
        if (chat.mode === mode) supplementalConversationIds.delete(chat.id);
    }
    chatState.conversations = [
        ...chatState.conversations.filter(chat => chat.mode !== mode),
        ...formatConversations(conversations),
    ];
}

export async function loadAllConversations(mode: ConversationMode = loadedConversationMode) {
    loadedConversationMode = mode;
    try {
        const [looseChats, folders] = await Promise.all([
            invoke<Conversation[]>('get_conversations_page', {
                limit: PAGE_SIZE,
                offset: 0,
                mode,
                folderId: null,
            }),
            invoke<ChatFolder[]>('get_chat_folders', { mode }),
        ]);
        const openFolderPages = await Promise.all(
            folders
                .filter(folder => !folder.is_collapsed)
                .map(folder => invoke<Conversation[]>('get_conversations_page', {
                    limit: Math.max(folder.chat_count, PAGE_SIZE),
                    offset: 0,
                    mode,
                    folderId: folder.id,
                })),
        );
        // Commit the folder metadata and its visible conversations together. Updating
        // the folders first briefly rendered expanded folders without their rows.
        chatState.folders = [
            ...chatState.folders.filter(folder => folder.mode !== mode),
            ...folders,
        ];
        replaceModeConversations(mode, [...openFolderPages.flat(), ...looseChats]);
    } catch (e) {
        reportDiagnostic('chat');
    }
}

export async function loadMoreConversations(mode: ConversationMode = loadedConversationMode): Promise<boolean> {
    if (mode !== loadedConversationMode) {
        await loadAllConversations(mode);
        return chatState.conversations.filter(
            chat => chat.mode === mode && chat.folder_id === null,
        ).length === PAGE_SIZE;
    }
    try {
        const currentLength = chatState.conversations.filter(
            chat => chat.mode === mode && chat.folder_id === null && !supplementalConversationIds.has(chat.id),
        ).length;
        const result = await invoke<Conversation[]>('get_conversations_page', {
            limit: PAGE_SIZE,
            offset: currentLength,
            mode,
            folderId: null,
        });
        if (result.length === 0) return false;
        const knownIds = new Set(chatState.conversations.map(chat => chat.id));
        for (const chat of result) supplementalConversationIds.delete(chat.id);
        chatState.conversations = [
            ...chatState.conversations,
            ...formatConversations(result).filter(chat => !knownIds.has(chat.id))
        ];
        return result.length === PAGE_SIZE;
    } catch (e) {
        reportDiagnostic('chat');
        return false;
    }
}

export async function loadMoreFolderConversations(folderId: string, reset = false): Promise<boolean> {
    const folder = chatState.folders.find(item => item.id === folderId);
    if (!folder) return false;
    const loaded = chatState.conversations.filter(chat => chat.folder_id === folderId);
    const offset = reset ? 0 : loaded.length;
    const result = await invoke<Conversation[]>('get_conversations_page', {
        limit: Math.max(folder.chat_count, PAGE_SIZE),
        offset,
        mode: folder.mode,
        folderId,
    });
    const otherChats = reset
        ? chatState.conversations.filter(chat => chat.folder_id !== folderId)
        : chatState.conversations;
    const knownIds = new Set(otherChats.map(chat => chat.id));
    chatState.conversations = [
        ...otherChats,
        ...formatConversations(result).filter(chat => !knownIds.has(chat.id)),
    ];
    return false;
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
            characterSnapshot: characterSnapshot(character),
        });
        await loadAllConversations('singleplayer');
        await loadMessages(newId);
    } catch (e) {
        reportDiagnostic('chat');
        throw e;
    }
}

export async function openHistoryChat(chatId: string) {
    await loadMessages(chatId);
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
        reportDiagnostic('chat');
        return null;
    }
}

let messageLoadGeneration = 0;
let pendingMessageChatId: string | null = null;

export async function loadMessages(chatId: string) {
    // A refresh of the old chat must not supersede an intentional chat switch.
    if (chatState.activeChatId === chatId && pendingMessageChatId && pendingMessageChatId !== chatId) return;
    const generation = ++messageLoadGeneration;
    const previousChatId = chatState.activeChatId;
    const switching = previousChatId !== chatId;
    pendingMessageChatId = chatId;
    const isCurrent = () => generation === messageLoadGeneration && chatState.activeChatId === previousChatId;
    let nextCharacter: ChatCharacterSnapshot | null = null;
    let nextRole = chatState.activeRoleSnapshot;
    let nextSummary = chatState.summaryMeta;
    try {
        if (switching) {
            // Resolve the chat-owned card before exposing this conversation to the
            // composer. A deleted or edited library card must not alter its prompt.
            const conversation = chatState.conversations.find(chat => chat.id === chatId);
            if (characterState.allCharacters.length === 0) await loadCharacters();
            if (!isCurrent()) return;
            const libraryCharacter = characterState.allCharacters.find(
                character => String(character.id) === conversation?.character_id,
            );
            if (conversation?.mode === 'multiplayer') {
                // Multiplayer restores its session-owned character separately.
                nextCharacter = libraryCharacter ?? null;
            } else {
                nextCharacter = await invoke<ChatCharacterSnapshot | null>('get_chat_character_snapshot', {
                    chatId,
                    fallback: libraryCharacter ? characterSnapshot(libraryCharacter) : null,
                });
            }
            if (!isCurrent()) return;
            nextRole = chatState.conversations.find(
                (conversation) => conversation.id === chatId
            )?.role_snapshot ?? null;

            try {
                const meta = await invoke<{ summary: string | null; last_id: string | null }>(
                    'get_summary_meta', { chatId }
                );
                nextSummary = {
                    currentSummary:          meta.summary,
                    lastSummarizedMessageId: meta.last_id,
                };
            } catch {
                nextSummary = { currentSummary: null, lastSummarizedMessageId: null };
            }
            if (!isCurrent()) return;
        }

        try {
            // Smart limit: If we're still in the same chat (e.g. after sending a message),
            // we don't want to suddenly collapse the history back to 25.
            // Instead, request the currently loaded amount + 1 (for the new message).
            const limit = chatState.activeChatId === chatId && chatState.currentMessages.length >= 25
                ? chatState.currentMessages.length + 1
                : 25;

            // Use your get_messages_page function from the backend
            const result = await invoke<PersistedMessageRow[]>('get_messages_page', { chatId, limit, offset: 0 });
            if (!isCurrent()) return;
            const messages = result.map(decodeMessage);

            // Publish a complete chat snapshot together; no old load can mix its metadata in.
            if (switching) {
                appState.activeCharacter = nextCharacter;
                chatState.activeRoleSnapshot = nextRole;
                chatState.summaryMeta = nextSummary;
            }
            chatState.currentMessages = messages;
            chatState.activeChatId = chatId;

            // If we hit the limit exactly, there are probably more messages available
            chatState.hasMoreMessages = result.length === limit;
        } catch (e) { reportDiagnostic('chat'); }
    } finally {
        if (generation === messageLoadGeneration) pendingMessageChatId = null;
    }
}

// Rows shown locally while SQLite is still saving must not count as page offsets.
const pendingUserSends = new Set<string>();

// Triggered when the user scrolls up
export async function loadMoreMessages() {
    const chatId = chatState.activeChatId;
    if (!chatId || !chatState.hasMoreMessages) return;

    try {
        const currentLength = chatState.currentMessages.filter(message => !pendingUserSends.has(message.id ?? '')).length;
        const result = await invoke<PersistedMessageRow[]>('get_messages_page', {
            chatId,
            limit: 25,
            offset: currentLength,
        });

        if (result.length === 0) {
            chatState.hasMoreMessages = false;
            return;
        }

        const parsed = result.map(decodeMessage);

        // Prepend older messages at the beginning
        chatState.currentMessages = [...parsed, ...chatState.currentMessages];
        chatState.hasMoreMessages = result.length === 25;
    } catch (e) { reportDiagnostic('chat'); }
}

export async function addMessage(role: 'user' | 'assistant', content: string, usage: TokenUsage | null = null) {
    const chatId = chatState.activeChatId;
    if (!chatId) return;
    // Use the same ID locally and in SQLite so the row keeps its DOM identity.
    // Assistant replies already have a streaming preview; only user sends need one.
    const messageId = crypto.randomUUID();
    if (role === 'user') {
        pendingUserSends.add(messageId);
        chatState.currentMessages.push({
            id: messageId, conversation_id: chatId, role, content,
            author: null, swipe_variants: [content], swipe_index: 0,
            usage_variants: [usage],
        });
    }
    try {
        await invoke('add_message', {
            chatId,
            role,
            content,
            author: null,
            messageId,
            createdAt: null,
            usage,
        });
        pendingUserSends.delete(messageId);
        await refreshSavedMessage(chatId, messageId);
    } catch (e) {
        if (role === 'user' && chatState.activeChatId === chatId) {
            chatState.currentMessages = chatState.currentMessages.filter(message => message.id !== messageId);
        }
        reportDiagnostic('chat');
        throw e;
    } finally {
        pendingUserSends.delete(messageId);
    }
}

async function refreshSavedMessage(chatId: string, messageId: string): Promise<void> {
    try {
        const update = await invoke<{ message: PersistedMessageRow; conversation: Conversation }>(
            'get_chat_message_update', { chatId, messageId },
        );
        const conversation = chatState.conversations.find(item => item.id === chatId);
        if (conversation) Object.assign(conversation, formatConversations([update.conversation])[0]);
        // Saving an old conversation must never append into the newly active one.
        if (chatState.activeChatId !== chatId) return;
        const message = decodeMessage(update.message);
        const existing = chatState.currentMessages.find(item => item.id === messageId);
        if (existing) Object.assign(existing, message);
        else chatState.currentMessages.push(message);
    } catch {
        // Persistence already succeeded. A failed refresh must not roll back the
        // optimistic row or report a failed send; retain the previous reload path.
        reportDiagnostic('chat');
        await loadAllConversations();
        if (chatState.activeChatId === chatId) await loadMessages(chatId);
    }
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

export async function addSwipeVariant(messageId: string, content: string, usage: TokenUsage | null = null): Promise<void> {
    const chatId = chatState.activeChatId;
    try {
        if (chatId) await invalidateSummaryIfCovered(chatId, messageId);
        await invoke('add_swipe_variant', { messageId, content, usage });
        if (chatId) bumpConversationRevision(chatId);
        if (chatId) await loadMessages(chatId);
    } catch (e) {
        reportDiagnostic('chat');
        throw e;
    }
}

const pendingSwipeChanges = new Map<string, { tail: Promise<void>; committedIndex: number; revision: number }>();

export async function setSwipeIndex(messageId: string, index: number): Promise<void> {
    const msg = chatState.currentMessages.find(m => m.id === messageId);
    const chatId = chatState.activeChatId;
    if (!msg || !chatId) return;
    const clamped = Math.max(0, Math.min(index, msg.swipe_variants.length - 1));
    const key = `${chatId}:${messageId}`;
    const pending = pendingSwipeChanges.get(key) ?? {
        tail: Promise.resolve(), committedIndex: msg.swipe_index, revision: 0,
    };
    pendingSwipeChanges.set(key, pending);
    const revision = ++pending.revision;
    msg.swipe_index = clamped;
    msg.content = msg.swipe_variants[clamped];
    const task = pending.tail.catch(() => undefined).then(async () => {
    try {
        await invalidateSummaryIfCovered(chatId, messageId);
        await invoke('set_swipe_index', { messageId, index: clamped });
        bumpConversationRevision(chatId);
        pending.committedIndex = clamped;
    } catch (e) {
        reportDiagnostic('chat');
        if (pending.revision === revision && chatState.activeChatId === chatId) {
            const current = chatState.currentMessages.find(m => m.id === messageId);
            if (current) {
                current.swipe_index = pending.committedIndex;
                current.content = current.swipe_variants[pending.committedIndex];
            }
        }
        throw e;
    } finally {
        if (pending.revision === revision) pendingSwipeChanges.delete(key);
    }
    });
    pending.tail = task;
    return task;
}

export async function updateMessage(id: string, content: string) {
    const chatId = chatState.activeChatId;
    try {
        if (chatId) await invalidateSummaryIfCovered(chatId, id);
        await invoke('update_message', { id, content });
        if (chatId) bumpConversationRevision(chatId);
        if (chatId) await loadMessages(chatId);
    } catch (e) {
        reportDiagnostic('chat');
        throw e;
    }
}

export async function deleteMessage(id: string) {
    const chatId = chatState.activeChatId;
    try {
        if (chatId) await invalidateSummaryIfCovered(chatId, id);
        await invoke('delete_message', { id });
        if (chatId) bumpConversationRevision(chatId);
        if (chatId) await loadMessages(chatId);
    } catch (e) {
        reportDiagnostic('chat');
        throw e;
    }
}

export async function renameConversation(id: string, title: string) {
    try {
        await invoke('rename_chat', { id, title });
        await loadAllConversations();
    } catch (e) { reportDiagnostic('chat'); }
}

export async function togglePinConversation(id: string) {
    try {
        await invoke('toggle_pin_chat', { id });
        await loadAllConversations();
    } catch (e) { reportDiagnostic('chat'); }
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
    } catch (e) { reportDiagnostic('chat'); }
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

export async function setChatFolderCollapsed(id: string, isCollapsed: boolean): Promise<boolean> {
    const folder = chatState.folders.find(item => item.id === id);
    if (!folder) return false;
    const previousState = folder.is_collapsed;

    if (isCollapsed) {
        // Keep the rows mounted while the CSS grid closes. Removing them here used
        // to collapse the folder in one frame before an animation could run.
        folder.is_collapsed = true;
        try {
            await invoke('set_chat_folder_collapsed', { id, isCollapsed: true });
            return false;
        } catch (error) {
            folder.is_collapsed = previousState;
            throw error;
        }
    }

    // Load hidden rows before revealing the folder. This prevents it from opening
    // empty and growing a second time when its conversations arrive.
    try {
        const moreAvailable = await loadMoreFolderConversations(id, true);
        await invoke('set_chat_folder_collapsed', { id, isCollapsed: false });
        folder.is_collapsed = false;
        return moreAvailable;
    } catch (error) {
        folder.is_collapsed = previousState;
        throw error;
    }
}

export async function deleteChatFolder(id: string) {
    await invoke('delete_chat_folder', { id });
    await loadAllConversations(loadedConversationMode);
}

export async function persistSidebarOrganization(mode: ConversationMode) {
    const folders = chatState.folders
        .filter(folder => folder.mode === mode)
        .map((folder, index) => ({ ...folder, sort_order: index }));
    chatState.folders = [
        ...chatState.folders.filter(folder => folder.mode !== mode),
        ...folders,
    ];

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
    const refreshedFolders = await invoke<ChatFolder[]>('save_sidebar_organization', {
        mode,
        folderIds: folders.map(folder => folder.id),
        chats,
    });
    chatState.folders = [
        ...chatState.folders.filter(folder => folder.mode !== mode),
        ...refreshedFolders,
    ];
}
