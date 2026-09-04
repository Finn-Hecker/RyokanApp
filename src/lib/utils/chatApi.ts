import { invoke } from '@tauri-apps/api/core';
import { buildSystemPrompt, buildWiString, buildWorldInfoBlock } from '$lib/utils/promptBuilder';
import { worldInfoState } from '$lib/stores/worldInfoStore.svelte';
import { chatState } from '$lib/stores/chatStore.svelte';
import type { ApiSettings } from '$lib/stores/appState.svelte';
import type { Message } from '$lib/stores/chatStore.svelte';

export interface GenerationCallbacks {
    onStreamUpdate:        (text: string) => void;
    onThinkingPhaseChange: (isThinking: boolean) => void;
}

export interface GenerationOptions {
    character: {
        name?:           string;
        desc?:           string;
        personality?:    string;
        scenario?:       string;
        mes_example?:    string;
        world_info_ids?: string[];
    } | null;
    apiSettings:    ApiSettings;
    recentMessages: Message[];
    /** Include a new user prompt at the end (normal send). Omit for retry. */
    userPrompt?:    string;
    role?: {
        name?:     string;
        bio?:      string;
        pronouns?: string;
    } | null;
}

type ChatRole = 'system' | 'user' | 'assistant';
export interface ChatMessage {
    role:    ChatRole;
    content: string;
}

const START_ROLEPLAY_MARKER = '[Start Roleplay]';
const DEFAULT_THINKING_BUDGET = 2500;

/**
 * Escapes a string for safe use inside a RegExp.
 */
function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Removes a tag-delimited block from content. Handles three cases:
 * complete blocks, an orphaned closing tag (keep text after it), and an
 * orphaned opening tag (keep text before it).
 */
function stripTagBlock(content: string, openTag: string, closeTag: string): string {
    if (!content || !content.includes(openTag.charAt(0))) return content;

    let result = content.replace(
        new RegExp(`${escapeRegExp(openTag)}[\\s\\S]*?${escapeRegExp(closeTag)}`, 'gi'),
        '',
    );

    const closeIdx = result.indexOf(closeTag);
    if (closeIdx !== -1) {
        result = result.slice(closeIdx + closeTag.length);
    }

    const openIdx = result.indexOf(openTag);
    if (openIdx !== -1) {
        result = result.slice(0, openIdx);
    }

    return result;
}

/**
 * Pure function — strips thinking/channel tags and returns the visible
 * response text.
 *
 * Handles two tag families:
 *   • <think>…</think>        (reasoning models)
 *   • <|channel>…<channel|>   (channel-style inner monologue)
 *
 * NOTE: with the backend now splitting reasoning into a dedicated
 * "ai-thinking-token" event (delta.reasoning_content), `raw` here will
 * usually already be clean. This function remains as a fallback for
 * backends/models that inline reasoning into the content stream instead.
 */
export function processThinkingOutput(raw: string, isFinished: boolean): {
    text:       string;
    isThinking: boolean;
} {
    const thinkEnd = '</think>';
    if (raw.includes(thinkEnd)) {
        const parts = raw.split(thinkEnd);
        const afterThink = parts[parts.length - 1].trimStart();
        return { text: stripChannelTags(afterThink, isFinished), isThinking: false };
    }

    // Still inside a <think> block (no closing tag yet)
    if (raw.includes('<think>')) {
        if (isFinished) {
            // Stream ended without </think> — discard the orphaned block
            const before = raw.slice(0, raw.indexOf('<think>')).trimStart();
            return { text: stripChannelTags(before, isFinished), isThinking: false };
        }
        return { text: '', isThinking: true };
    }

    const text = stripChannelTags(raw, isFinished);

    if (isFinished) return { text, isThinking: false };

    if (raw.includes('<|channel>') && !raw.includes('<channel|>')) {
        return { text: '', isThinking: true };
    }

    return { text, isThinking: false };
}

/**
 * Strips <|channel>…<channel|> blocks from a string. While streaming, an
 * orphaned opening tag is left untouched since the closing tag may still
 * be on its way.
 */
function stripChannelTags(content: string, isFinished: boolean): string {
    if (!content || !content.includes('<')) return content;

    // Complete blocks
    let result = content.replace(/<\|channel>[\s\S]*?<channel\|>/g, '');

    // Orphaned closing tag — keep only what comes after
    const closeIdx = result.indexOf('<channel|>');
    if (closeIdx !== -1) {
        result = result.slice(closeIdx + '<channel|>'.length);
    }

    // Orphaned opening tag — only strip once the stream is finished, since
    // the closing tag may still be on its way while still streaming
    if (isFinished) {
        const openIdx = result.indexOf('<|channel>');
        if (openIdx !== -1) {
            result = result.slice(0, openIdx);
        }
    }

    return result.trimStart();
}

/**
 * Removes <think>…</think> and <|channel>…<channel|> blocks from a
 * finalized message (used when feeding assistant history back to the API).
 */
export function stripThinkingContent(content: string): string {
    if (!content) return content;
    let result = stripTagBlock(content, '<think>', '</think>');
    result = stripTagBlock(result, '<|channel>', '<channel|>');
    return result.trimStart();
}

export function buildApiMessages(options: GenerationOptions): ChatMessage[] {
    const { character, apiSettings, recentMessages, userPrompt, role } = options;

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
    const userName = role?.name || 'User';

    // Static block: core instructions + character card + user role.
    // No world info here — see the layout note above.
    const baseSystemPrompt = buildSystemPrompt({
        charName,
        desc:         character?.desc,
        personality:  character?.personality,
        scenario:     character?.scenario,
        example:      character?.mes_example,
        userName,
        userBio:      role?.bio,
        userPronouns: role?.pronouns,
        modelType:    'ollama',
    });

    const { currentSummary, lastSummarizedMessageId } = chatState.summaryMeta;

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
        userName,
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

    const messages = buildApiMessages(options);

    let rawBuffer      = '';
    let thinkingBuffer = '';

    const { listen } = await import('@tauri-apps/api/event');

    const unlistenToken = await listen<{ token: string }>('ai-token', (event) => {
        rawBuffer += event.payload.token;

        if (apiSettings.isThinkingModel) {
            const { text, isThinking } = processThinkingOutput(rawBuffer, false);
            // Tag-based detection is a fallback — once the dedicated
            // reasoning channel below has fired, it takes precedence.
            if (!thinkingBuffer) callbacks.onThinkingPhaseChange(isThinking);
            callbacks.onStreamUpdate(text);
        } else {
            callbacks.onStreamUpdate(rawBuffer);
        }
    });

    // Backend emits reasoning tokens (delta.reasoning_content) on their own
    // event so the UI can know it's "thinking" without relying on tag-parsing.
    const unlistenThinking = await listen<{ token: string }>('ai-thinking-token', (event) => {
        thinkingBuffer += event.payload.token;
        callbacks.onThinkingPhaseChange(true);
    });

    try {
        const thinkingBudget = apiSettings.thinkingBudget ?? DEFAULT_THINKING_BUDGET;
        const effectiveMaxTokens = apiSettings.isThinkingModel
            ? apiSettings.maxTokens + thinkingBudget
            : apiSettings.maxTokens;

        await invoke('call_ai_api', {
            payload: {
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
                is_thinking_model:  apiSettings.isThinkingModel,
                thinking_budget:    apiSettings.isThinkingModel ? thinkingBudget : undefined,
            },
        });

        if (apiSettings.isThinkingModel) {
            const { text } = processThinkingOutput(rawBuffer, true);
            callbacks.onStreamUpdate(text);
            return text || rawBuffer;
        }

        callbacks.onStreamUpdate(rawBuffer);
        return rawBuffer;
    } finally {
        // Always cleared, even on error — otherwise the UI can get stuck
        // showing a "thinking" state after a failed request.
        callbacks.onThinkingPhaseChange(false);
        unlistenToken();
        unlistenThinking();
    }
}