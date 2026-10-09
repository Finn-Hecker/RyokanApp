import { invoke } from '@tauri-apps/api/core';
import { chatState, loadAllConversations, loadMessages, type Conversation, type RoleSelection } from './chatStore.svelte';
import { decodeGroupParticipant, type GroupParticipant, type GroupCharacterSnapshot, type PersistedGroupParticipantRow } from '$lib/chat/groupChatData';
import { decodeMessage, type Message, type PersistedMessageRow } from '$lib/chat/messageData';
import { stopGroupGeneration } from '$lib/ai/generation/groupGenerationLifecycle';
import { cancelActiveSummary } from '$lib/ai/summary/rollingSummary.svelte';
import { bumpConversationRevision, forgetPromptUsageAnchor } from '$lib/ai/summary/rollingSummaryCore';

export interface GroupParticipantInput {
    character_id: string;
    character_snapshot?: GroupCharacterSnapshot;
    role_selection?: RoleSelection | null;
    initial_message?: string;
}

export interface GroupChatSnapshot {
    conversation: Conversation;
    participants: GroupParticipant[];
    messages: Message[];
    summary: string | null;
    summary_last_message_id: string | null;
    version: string;
}

type GroupChatRow = Omit<GroupChatSnapshot, 'participants' | 'messages'> & {
    participants: PersistedGroupParticipantRow[];
    messages: PersistedMessageRow[];
};

/** Authoritative, complete snapshot, including an opaque SQLite CAS token. */
export async function getGroupChat(chatId: string): Promise<GroupChatSnapshot> {
    const row = await invoke<GroupChatRow>('get_group_chat', { chatId });
    return { ...row, participants: row.participants.map(decodeGroupParticipant), messages: row.messages.map(decodeMessage) };
}

export async function openGroupChat(chatId: string): Promise<void> {
    const snapshot = await getGroupChat(chatId);
    const existing = chatState.conversations.find(item => item.id === chatId);
    if (existing) Object.assign(existing, snapshot.conversation);
    else chatState.conversations.push(snapshot.conversation);
    await loadMessages(chatId);
}

export async function createGroupChat(participants: GroupParticipantInput[], title = ''): Promise<string> {
    const chatId = await invoke<string>('create_group_chat', { title, participants });
    await loadAllConversations('singleplayer');
    await openGroupChat(chatId);
    return chatId;
}

async function changeParticipants(chatId: string, command: string, args: Record<string, unknown>): Promise<void> {
    stopGroupGeneration(chatId);
    bumpConversationRevision(chatId);
    await cancelActiveSummary(chatId);
    await invoke(command, { chatId, ...args });
    forgetPromptUsageAnchor(chatId);
    if (chatState.activeChatId === chatId) {
        const saved = await getGroupChat(chatId);
        if (chatState.activeChatId === chatId) {
            chatState.activeGroupParticipants = saved.participants;
            chatState.summaryMeta = { currentSummary: saved.summary, lastSummarizedMessageId: saved.summary_last_message_id };
        }
    }
}

export async function addGroupParticipant(chatId: string, participant: GroupParticipantInput): Promise<void> {
    await changeParticipants(chatId, 'add_group_participant', { participant });
}

export async function removeGroupParticipant(chatId: string, participantId: string): Promise<void> {
    await changeParticipants(chatId, 'remove_group_participant', { participantId });
}

export async function setGroupParticipantActive(chatId: string, participantId: string, isActive: boolean): Promise<void> {
    await changeParticipants(chatId, 'set_group_participant_active', { participantId, isActive });
}

export async function updateGroupParticipant(chatId: string, participantId: string, snapshot: GroupCharacterSnapshot): Promise<void> {
    await changeParticipants(chatId, 'update_group_participant', { participantId, snapshot });
}

export async function reorderGroupParticipants(chatId: string, participantIds: string[]): Promise<void> {
    await changeParticipants(chatId, 'reorder_group_participants', { participantIds });
}
