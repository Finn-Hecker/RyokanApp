import { invoke } from '@tauri-apps/api/core';
import { appState, snapshotApiConnection, type ApiConnection } from '$lib/stores/appState.svelte';
import { chatState, addMessage, loadMessages } from '$lib/stores/chatStore.svelte';
import { getGroupChat, type GroupChatSnapshot } from '$lib/stores/groupChatStore.svelte';
import { ensureWorldInfosLoaded, worldInfoState } from '$lib/stores/worldInfoStore.svelte';
import { snapshotTextRules } from '$lib/ai/prompt/textRules';
import { runGeneration, GenerationCancelledError, type GenerationOptions } from './chatApi';
import { describeGenerationError, type GenerationErrorInfo } from './generationError';
import { selectGroupSpeakers } from './groupSpeakerSelection';
import { beginGroupGeneration, finishGroupGeneration } from './groupGenerationLifecycle';
import { checkAndSummarizeIfNeeded, assertPreparedGenerationFits, cancelActiveSummary,
    SummaryCancelledError, rememberGenerationAnchor } from '$lib/ai/summary/rollingSummary.svelte';
import { currentConversationRevision, bumpConversationRevision } from '$lib/ai/summary/rollingSummaryCore';
import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
import type { Message } from '$lib/chat/messageData';

export { stopGroupGeneration } from './groupGenerationLifecycle';

export const groupGenerationState = $state({
    chatId: null as string | null,
    phase: 'idle' as 'idle' | 'preparing' | 'generating' | 'saving',
    participantId: null as string | null,
    streamingText: '',
    isThinking: false,
    completedMessageIds: [] as string[],
    error: null as GenerationErrorInfo | null,
});

export interface GroupGenerationRequest {
    chatId: string;
    /** Persisted once before the first character request. Omit to continue. */
    userPrompt?: string;
    /** Manual order, or bounded deterministic rotation with maxResponses. */
    participantIds?: readonly string[];
    maxResponses?: number;
    /** Retry an assistant reply using its preceding history and original speaker. */
    swipeMessageId?: string;
    apiSettings?: ApiConnection;
    signal?: AbortSignal;
    onStreamUpdate?: (participantId: string, text: string, isThinking: boolean) => void;
}

export interface GroupGenerationResult {
    status: 'completed' | 'cancelled';
    messageIds: string[];
}

/** Excludes summary changes made by preparation; includes the complete raw history. */
function sourceFingerprint(group: GroupChatSnapshot): string {
    return JSON.stringify([group.participants, group.conversation.role_snapshot, group.messages]);
}

/** One provider request per speaker, with summary preparation between replies. */
export async function generateGroupReplies(request: GroupGenerationRequest): Promise<GroupGenerationResult> {
    request = { ...request, participantIds: request.participantIds ? [...request.participantIds] : undefined };
    const { chatId } = request;
    if (chatState.activeChatId !== chatId) throw new Error('Open the group chat before generating');
    const controller = beginGroupGeneration(chatId);
    let generationId: string | null = null;
    let revision = currentConversationRevision(chatId);
    const completed: string[] = [];
    const cancelled = () => controller.signal.aborted || chatState.activeChatId !== chatId;
    const assertCurrent = () => {
        if (cancelled()) throw new GenerationCancelledError();
        if (currentConversationRevision(chatId) !== revision) throw new Error('Group chat changed during generation');
    };
    const stopNative = () => {
        void cancelActiveSummary(chatId).catch(() => reportDiagnostic('summary'));
        if (generationId) void invoke('stop_generation', { generationId }).catch(() => reportDiagnostic('chat'));
    };
    const disposeChatWatch = $effect.root(() => {
        $effect(() => {
            if (chatState.activeChatId !== chatId) controller.abort();
        });
    });
    const externalStop = () => controller.abort();
    controller.signal.addEventListener('abort', stopNative);
    request.signal?.addEventListener('abort', externalStop);
    if (request.signal?.aborted) controller.abort();
    Object.assign(groupGenerationState, { chatId, phase: 'preparing', participantId: null,
        streamingText: '', isThinking: false, completedMessageIds: [], error: null });

    try {
        // Freeze settings and transforms for the whole round, before any asynchronous work.
        const apiSettings = snapshotApiConnection(request.apiSettings ?? appState.apiSettings);
        const textRules = snapshotTextRules(appState.textRules);
        assertCurrent();
        let group = await getGroupChat(chatId);
        assertCurrent();
        let speakers: string[];
        if (request.swipeMessageId) {
            if (request.userPrompt !== undefined || request.participantIds !== undefined || request.maxResponses !== undefined) {
                throw new Error('A swipe cannot send a new prompt or select other speakers');
            }
            const target = group.messages.find(message => message.id === request.swipeMessageId);
            if (!target || target.role !== 'assistant' || !target.participant_id) {
                throw new Error('Retry requires a group character reply');
            }
            if (!group.participants.some(item => item.id === target.participant_id && item.is_active)) {
                throw new Error('Reactivate the character before retrying its reply');
            }
            speakers = [target.participant_id];
        } else {
            speakers = selectGroupSpeakers(group.participants, group.messages, request);
            if (request.userPrompt !== undefined) {
                if (!request.userPrompt.trim()) throw new Error('User prompt must not be empty');
                await addMessage('user', request.userPrompt);
                assertCurrent();
                group = await getGroupChat(chatId);
                assertCurrent();
            }
        }
        await ensureWorldInfosLoaded();
        assertCurrent();
        const worldInfos = $state.snapshot(worldInfoState.allWorldInfos);

        for (const participantId of speakers) {
            assertCurrent();
            const participant = group.participants.find(item => item.id === participantId);
            if (!participant) throw new Error('Selected participant no longer exists');
            Object.assign(groupGenerationState, { phase: 'preparing', participantId, streamingText: '', isThinking: false });
            const source = sourceFingerprint(group);
            const options: GenerationOptions = {
                chatId, apiSettings, textRules, worldInfos,
                character: participant.character_snapshot,
                role: group.conversation.role_snapshot,
                group: { participantId, participants: group.participants },
                recentMessages: group.messages,
                shouldCancel: cancelled,
            };
            const prepared = await checkAndSummarizeIfNeeded(chatId, options, request.swipeMessageId);
            assertCurrent();
            const preparedGroup = await getGroupChat(chatId);
            assertCurrent();
            if (sourceFingerprint(preparedGroup) !== source) throw new Error('Group chat changed during context preparation');
            Object.assign(options, prepared);
            await assertPreparedGenerationFits(options);
            assertCurrent();
            generationId = crypto.randomUUID();
            options.generationId = generationId;
            groupGenerationState.phase = 'generating';
            const publish = () => {
                if (!cancelled()) request.onStreamUpdate?.(participantId, groupGenerationState.streamingText, groupGenerationState.isThinking);
            };
            const response = await runGeneration(options, {
                onStreamUpdate: text => { if (!cancelled()) { groupGenerationState.streamingText = text; publish(); } },
                onThinkingPhaseChange: thinking => { if (!cancelled()) { groupGenerationState.isThinking = thinking; publish(); } },
            });
            generationId = null;
            assertCurrent();
            if (!response.text.trim()) throw new Error('The provider returned an empty character reply');
            groupGenerationState.phase = 'saving';
            const messageId = await invoke<string>('commit_group_reply', {
                chatId, participantId, expectedVersion: preparedGroup.version,
                content: response.text, usage: response.usage,
                swipeMessageId: request.swipeMessageId ?? null,
            });
            completed.push(messageId);
            groupGenerationState.completedMessageIds = [...completed];
            assertCurrent();
            // Append-only history can reuse usage anchors; changing a variant cannot.
            if (request.swipeMessageId) bumpConversationRevision(chatId);
            revision = currentConversationRevision(chatId);
            group = await getGroupChat(chatId);
            assertCurrent();
            chatState.summaryMeta = { currentSummary: group.summary, lastSummarizedMessageId: group.summary_last_message_id };
            await loadMessages(chatId);
            assertCurrent();
            const saved: Message | undefined = group.messages.find(item => item.id === messageId);
            if (!request.swipeMessageId) rememberGenerationAnchor(chatId, response.promptSnapshot, saved, participantId);
        }
        return { status: 'completed', messageIds: completed };
    } catch (error) {
        if (cancelled() || error instanceof GenerationCancelledError || error instanceof SummaryCancelledError) {
            return { status: 'cancelled', messageIds: completed };
        }
        groupGenerationState.error = describeGenerationError(error);
        throw error;
    } finally {
        disposeChatWatch();
        controller.signal.removeEventListener('abort', stopNative);
        request.signal?.removeEventListener('abort', externalStop);
        groupGenerationState.phase = 'idle';
        groupGenerationState.isThinking = false;
        groupGenerationState.streamingText = '';
        finishGroupGeneration(controller);
    }
}
