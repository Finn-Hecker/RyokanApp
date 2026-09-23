import { invoke } from '@tauri-apps/api/core';
import { worldInfoState } from '$lib/stores/worldInfoStore.svelte';
import { chatState } from '$lib/stores/chatStore.svelte';
import { buildPromptMessages } from '$lib/utils/chatPromptBuilder';
import { snapshotApiConnection, type ApiConnection } from '$lib/stores/appState.svelte';
import type { Message } from '$lib/stores/chatStore.svelte';
import {
    deriveEffectiveTokenBudget,
    type ApiRequestParameterConfig,
    type SummaryMarkerState,
} from '$lib/utils/rollingSummaryCore';
import { processThinkingOutput, stripThinkingContent } from '$lib/utils/thinkingOutput';
import type { TokenUsage } from '$lib/utils/tokenUsage';

export { processThinkingOutput, stripThinkingContent } from '$lib/utils/thinkingOutput';

export interface GenerationCallbacks {
    onStreamUpdate:        (text: string) => void;
    onThinkingPhaseChange: (isThinking: boolean) => void;
}

export interface GenerationOptions {
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
    /** Bound switches, token values, and custom fields for this exact request. */
    requestParameterConfig?: ApiRequestParameterConfig;
}

type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
    role:    ChatRole;
    content: string;
}

const DEFAULT_THINKING_BUDGET = 2500;

export function buildApiMessages(options: GenerationOptions): ChatMessage[] {
    return buildPromptMessages({
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
    return JSON.stringify([
        options.apiSettings.providerKind,
        options.apiSettings.url,
        options.apiSettings.model,
        options.apiSettings,
        options.requestParameterConfig,
        options.character,
        options.role === undefined ? chatState.activeRoleSnapshot : options.role,
        worldInfoState.allWorldInfos,
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
    const generationId = options.generationId ?? crypto.randomUUID();

    const messages = buildApiMessages(options);
    const promptSnapshot: GenerationPromptSnapshot = {
        messages,
        historyFingerprint: options.recentMessages.map(messageFingerprint),
        summaryFingerprint: JSON.stringify(options.summaryMeta ?? chatState.summaryMeta),
        configurationFingerprint: generationConfigurationFingerprint({ ...options, apiSettings }),
    };

    let rawBuffer      = '';
    let thinkingBuffer = '';

    const { listen } = await import('@tauri-apps/api/event');

    const unlistenToken = await listen<{ token: string; generationId?: string }>('ai-token', (event) => {
        if (event.payload.generationId !== generationId) return;
        rawBuffer += event.payload.token;

        const { text, isThinking } = processThinkingOutput(rawBuffer, false);
        // Tag-based detection is a fallback — once the dedicated reasoning
        // channel below has fired, it takes precedence.
        if (!thinkingBuffer) callbacks.onThinkingPhaseChange(isThinking);
        callbacks.onStreamUpdate(text);
    });

    // Backend emits reasoning tokens (delta.reasoning_content) on their own
    // event so the UI can know it's "thinking" without relying on tag-parsing.
    const unlistenThinking = await listen<{ token: string; generationId?: string }>('ai-thinking-token', (event) => {
        if (event.payload.generationId !== generationId) return;
        thinkingBuffer += event.payload.token;
        callbacks.onThinkingPhaseChange(true);
    });

    try {
        const configuredThinkingBudget = apiSettings.thinkingBudget ?? DEFAULT_THINKING_BUDGET;
        const effectiveBudget = options.requestParameterConfig
            ? deriveEffectiveTokenBudget(options.requestParameterConfig)
            : null;
        const thinkingBudget = effectiveBudget?.payloadThinkingBudget
            ?? configuredThinkingBudget;
        const effectiveMaxTokens = effectiveBudget?.payloadMaxTokens
            ?? apiSettings.maxTokens + configuredThinkingBudget;

        const usage = await invoke<TokenUsage | null>('call_ai_api', {
            payload: {
                generation_id:      generationId,
                provider_kind:     apiSettings.providerKind,
                request_parameter_config: options.requestParameterConfig,
                url:                apiSettings.url,
                api_key:            apiSettings.apiKey,
                model:              apiSettings.model,
                messages,
                temperature:        apiSettings.temperature,
                max_tokens:         effectiveMaxTokens,
                presence_penalty:   apiSettings.presencePenalty,
                top_p:              apiSettings.topP,
                top_k:              apiSettings.topK,
                min_p:              apiSettings.minP,
                frequency_penalty:  apiSettings.frequencyPenalty,
                thinking_budget:    thinkingBudget,
            },
        });

        const { text } = processThinkingOutput(rawBuffer, true);
        callbacks.onStreamUpdate(text);
        return { text, usage, promptSnapshot };
    } finally {
        // Always cleared, even on error — otherwise the UI can get stuck
        // showing a "thinking" state after a failed request.
        callbacks.onThinkingPhaseChange(false);
        unlistenToken();
        unlistenThinking();
    }
}
