import { invoke } from '@tauri-apps/api/core';
import { buildSystemPrompt, buildWiString, buildWorldInfoBlock } from '$lib/utils/promptBuilder';
import { worldInfoState } from '$lib/stores/worldInfoStore.svelte';
import { chatState } from '$lib/stores/chatStore.svelte';
import type { ApiSettings } from '$lib/stores/appState.svelte';
import type { Message } from '$lib/stores/chatStore.svelte';
import {
    deriveEffectiveTokenBudget,
    type ApiRequestParameterConfig,
    type SummaryMarkerState,
} from '$lib/utils/rollingSummaryCore';
import { processThinkingOutput, stripThinkingContent } from '$lib/utils/thinkingOutput';

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
    apiSettings:    ApiSettings;
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

const START_ROLEPLAY_MARKER = '[Start Roleplay]';
const DEFAULT_THINKING_BUDGET = 2500;

export function buildApiMessages(options: GenerationOptions): ChatMessage[] {
    const { character, apiSettings, recentMessages, userPrompt } = options;

    const worldInfoIds = character?.world_info_ids ?? [];
    const relevantEntries = worldInfoState.allWorldInfos
        .filter(wi => worldInfoIds.includes(wi.id))
        .flatMap(wi => wi.entries);
    const recentContext = [
        ...recentMessages.slice(-10).map(m =>
            m.role === 'assistant' ? stripThinkingContent(m.content) : m.content
        ),
        userPrompt ?? '',
    ].join(' ');

    const charName = character?.name || 'Unknown';

    // Static block: core instructions + character card.
    // No world info here — see the layout note above.
    const baseSystemPrompt = buildSystemPrompt({
        charName,
        prompt: character?.prompt,
        role: options.role === undefined ? chatState.activeRoleSnapshot : options.role,
    });

    const { currentSummary, lastSummarizedMessageId } = options.summaryMeta ?? chatState.summaryMeta;

    // Append the rolling summary to the single system message instead of
    // injecting a second system turn — avoids "No user query found" errors
    // from models that expect exactly one system message (Qwen, Mistral, …).
    const fullSystemContent = currentSummary
        ? `${baseSystemPrompt}\n\n[Previous conversation summary:\n${currentSummary}]`
        : baseSystemPrompt;

    // Only send messages that haven't been compressed into the summary yet.
    const lastSumIdx  = lastSummarizedMessageId
        ? recentMessages.findIndex(m => m.id === lastSummarizedMessageId)
        : -1;
    const newMessages = recentMessages.slice(lastSumIdx + 1);

    const messages: ChatMessage[] = [
        { role: 'system', content: fullSystemContent },
    ];

    messages.push(...newMessages.map(msg => ({
        role:    msg.role as ChatRole,
        content: msg.role === 'assistant' ? stripThinkingContent(msg.content) : msg.content,
    })));

    if (userPrompt) {
        messages.push({ role: 'user', content: userPrompt });
    }

    // Some model templates (e.g. Qwen via LM Studio) require the first
    // non-system turn to be a user message.
    const firstNonSystem = messages.find(m => m.role !== 'system');
    if (firstNonSystem?.role === 'assistant') {
        const systemIndex = messages.findLastIndex(m => m.role === 'system');
        messages.splice(systemIndex + 1, 0, { role: 'user', content: START_ROLEPLAY_MARKER });
    }

    // World info: computed last, attached only to the current turn (see
    // layout note above) instead of the cached system message.
    const worldInfoBlock = buildWorldInfoBlock(
        buildWiString(relevantEntries, 'before', recentContext),
        buildWiString(relevantEntries, 'after',  recentContext),
        charName,
        'ollama',
    );

    if (worldInfoBlock) {
        const lastUserIdx = messages.findLastIndex(m => m.role === 'user');
        if (lastUserIdx !== -1) {
            messages[lastUserIdx] = {
                ...messages[lastUserIdx],
                content: `${worldInfoBlock}\n\n${messages[lastUserIdx].content}`,
            };
        } else {
            // No user turn to attach to (shouldn't normally happen) — fall
            // back to a standalone message so the info isn't silently lost.
            messages.push({ role: 'user', content: worldInfoBlock });
        }
    }

    return messages;
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
): Promise<string> {
    const { apiSettings } = options;
    const generationId = options.generationId ?? crypto.randomUUID();

    const messages = buildApiMessages(options);

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

        await invoke('call_ai_api', {
            payload: {
                generation_id:      generationId,
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
        return text;
    } finally {
        // Always cleared, even on error — otherwise the UI can get stuck
        // showing a "thinking" state after a failed request.
        callbacks.onThinkingPhaseChange(false);
        unlistenToken();
        unlistenThinking();
    }
}
