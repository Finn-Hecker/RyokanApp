import type { TextRule } from '$lib/ai/prompt/textRules';
import { invoke } from '@tauri-apps/api/core';
import { recordModelUse } from '$lib/ai/connections/modelPickerData';
import { traceDecision, diagnosticOperation, diagnosticConnection } from '$lib/diagnostics/diagnosticDecisions';
import { worldInfoState } from '$lib/stores/worldInfoStore.svelte';
import { chatState } from '$lib/stores/chatStore.svelte';
import { buildPromptMessages } from '$lib/ai/prompt/chatPromptBuilder';
import { appState, snapshotApiConnection, type ApiConnection } from '$lib/stores/appState.svelte';
import { requestParameterConfig } from '$lib/ai/connections/apiParameters';
import type { Message } from '$lib/stores/chatStore.svelte';
import {
    deriveEffectiveTokenBudget,
    type ApiRequestParameterConfig,
    type SummaryMarkerState,
} from '$lib/ai/summary/rollingSummaryCore';
import { processThinkingOutput, stripThinkingContent } from '$lib/ai/generation/thinkingOutput';
import type { TokenUsage } from '$lib/ai/tokens/tokenUsage';
import { withConnection } from '$lib/ai/tokens/tokenUsage';

export { processThinkingOutput, stripThinkingContent } from '$lib/ai/generation/thinkingOutput';

export class GenerationCancelledError extends Error {
    constructor() { super('Generation cancelled'); this.name = 'GenerationCancelledError'; }
}

export interface GenerationCallbacks {
    onStreamUpdate:        (text: string) => void;
    onThinkingPhaseChange: (isThinking: boolean) => void;
}

export interface GenerationOptions {
    /** Bound to the same rules during budgeting, summarization and generation. */
    textRules?: readonly TextRule[];
    /** Persisted conversation ID, shared by chat and summary requests. */
    chatId?: string;
    /** Ephemeral diagnostic correlation/counts only; never part of provider requests. */
    diagnosticOperation?: number;
    diagnosticLocalInput?: number;
    diagnosticReserve?: number;
    character: {
        name?: string;
        prompt?: string;
        world_info_ids?: string[];
    } | null;
    /** Persisted, chat-owned player Role snapshot. Defaults to the active chat. */
    role?: { name: string; prompt: string } | null;
    apiSettings:    ApiConnection;
    recentMessages: Message[];
    /** Include a new user prompt at the end (normal send). Omit for retry. */
    userPrompt?:    string;
    /** Stable summary snapshot used for this request. */
    summaryMeta?:   SummaryMarkerState;
    /** Scopes global Tauri stream events and cancellation to this request. */
    generationId?: string;
    /** Prevents a stopped request from starting while stream listeners are being installed. */
    shouldCancel?: () => boolean;
    /** Bound switches, token values, and custom fields for this exact request. */
    requestParameterConfig?: ApiRequestParameterConfig;
}

type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
    role:    ChatRole;
    content: string;
}

export function buildApiMessages(options: GenerationOptions): ChatMessage[] {
    return buildPromptMessages({
        systemPrompt: options.apiSettings.systemPrompt,
        postHistoryPrompt: options.apiSettings.postHistoryPrompt,
        textRules: options.textRules ?? appState.textRules,
        character: options.character,
        role: options.role === undefined ? chatState.activeRoleSnapshot : options.role,
        recentMessages: options.recentMessages,
        userPrompt: options.userPrompt,
        summaryMeta: options.summaryMeta ?? chatState.summaryMeta,
        worldInfos: worldInfoState.allWorldInfos,
    });
}

export interface GenerationPromptSnapshot {
    messages: ChatMessage[];
    historyFingerprint: string[];
    summaryFingerprint: string;
    configurationFingerprint: string;
}

export function messageFingerprint(message: Message): string {
    return JSON.stringify([message.id, message.role, message.content, message.swipe_index]);
}

export function generationConfigurationFingerprint(options: GenerationOptions): string {
    // Detection timestamps/errors do not change the provider prompt. Automatic
    // refreshes must not discard a valid provider input-usage anchor.
    const { detectedContext, contextDetectionError, ...requestSettings } = options.apiSettings;
    return JSON.stringify([
        options.apiSettings.providerKind,
        options.apiSettings.url,
        options.apiSettings.model,
        requestSettings,
        options.requestParameterConfig,
        options.character,
        options.role === undefined ? chatState.activeRoleSnapshot : options.role,
        worldInfoState.allWorldInfos,
        (options.textRules ?? appState.textRules).filter(rule => rule.enabled && rule.targets.includes('send')),
    ]);
}

/**
 * Calls the AI API and streams the response.
 *
 * Important: call checkAndSummarizeIfNeeded() and await it BEFORE calling
 * this function. The two invoke('call_ai_api') calls must never overlap —
 * both share the Tauri 'ai-token' / 'ai-thinking-token' SSE channels.
 */
export async function runGeneration(
    options:   GenerationOptions,
    callbacks: GenerationCallbacks,
): Promise<{ text: string; usage: TokenUsage | null; promptSnapshot: GenerationPromptSnapshot }> {
    // Defensive copy: every network payload is bound to one immutable settings
    // snapshot even if a caller accidentally passes the live Svelte object.
    const apiSettings = snapshotApiConnection(options.apiSettings);
    const parameters = options.requestParameterConfig ?? requestParameterConfig(apiSettings);
    const generationId = options.generationId ?? crypto.randomUUID();
    const chatId = options.chatId ?? chatState.activeChatId;

    const messages = buildApiMessages(options);
    const promptSnapshot: GenerationPromptSnapshot = {
        messages,
        historyFingerprint: options.recentMessages.map(messageFingerprint),
        summaryFingerprint: JSON.stringify(options.summaryMeta ?? chatState.summaryMeta),
        configurationFingerprint: generationConfigurationFingerprint({ ...options, apiSettings }),
    };

    let rawBuffer      = '';
    let nativeThinking = false;
    let unlistenToken: (() => void) | undefined;
    let unlistenThinking: (() => void) | undefined;

    const { listen } = await import('@tauri-apps/api/event');

    try {
        unlistenToken = await listen<{ token: string; generationId?: string }>('ai-token', (event) => {
            if (event.payload.generationId !== generationId) return;
            rawBuffer += event.payload.token;

            const { text, isThinking } = processThinkingOutput(rawBuffer, false);
            // Native thinking ends when visible answer text arrives. Tag parsing
            // remains the fallback for models that encode thinking in content.
            if (text) nativeThinking = false;
            callbacks.onThinkingPhaseChange(nativeThinking || isThinking);
            callbacks.onStreamUpdate(text);
        });

        // Backend emits reasoning tokens (delta.reasoning_content) on their own
        // event so the UI can know it's "thinking" without relying on tag-parsing.
        unlistenThinking = await listen<{ token: string; generationId?: string }>('ai-thinking-token', (event) => {
            if (event.payload.generationId !== generationId) return;
            if (!event.payload.token) return;
            nativeThinking = true;
            callbacks.onThinkingPhaseChange(true);
        });

        if (options.shouldCancel?.()) throw new GenerationCancelledError();
        const effectiveBudget = deriveEffectiveTokenBudget(parameters);

        recordModelUse(apiSettings.model);
        const usage = await invoke<TokenUsage | null>('call_ai_api', {
            payload: {
                generation_id:      generationId,
                chat_id:            chatId,
                provider_kind:     apiSettings.providerKind,
                request_parameter_config: parameters,
                url:                apiSettings.url,
                api_key:            apiSettings.apiKey,
                model:              apiSettings.model,
                messages,
                temperature:        apiSettings.temperature,
                presence_penalty:   apiSettings.repetitionPenalty,
                top_p:              apiSettings.topP,
                top_k:              apiSettings.topK,
                min_p:              apiSettings.minP,
                frequency_penalty:  apiSettings.frequencyPenalty,
            },
        });

        traceDecision({ kind: 'usage', operation: options.diagnosticOperation ?? diagnosticOperation(), request: diagnosticOperation(),
            connection: diagnosticConnection(apiSettings), purpose: 'chat', local_input_tokens: options.diagnosticLocalInput ?? null,
            input_tokens: usage?.inputTokens ?? null, cached_input_tokens: usage?.cachedInputTokens ?? null,
            output_tokens: usage?.outputTokens ?? null, reasoning_tokens: usage?.reasoningTokens ?? null,
            reserve_tokens: options.diagnosticReserve ?? effectiveBudget?.reserveTokens ?? null,
        });
        const { text } = processThinkingOutput(rawBuffer, true);
        callbacks.onStreamUpdate(text);
        return { text, usage: withConnection(usage, apiSettings), promptSnapshot };
    } finally {
        // Always cleared, even on error — otherwise the UI can get stuck
        // showing a "thinking" state after a failed request.
        callbacks.onThinkingPhaseChange(false);
        unlistenToken?.();
        unlistenThinking?.();
    }
}
