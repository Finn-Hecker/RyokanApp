import { invoke } from '@tauri-apps/api/core';
import { buildSystemPrompt, buildWiString } from '$lib/utils/promptBuilder';
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

/**
 * Pure function — strips thinking/channel tags and returns the visible
 * response text.
 *
 * Handles two tag families:
 *   • <think>…</think>        (reasoning models)
 *   • <|channel>…<channel|>   (channel-style inner monologue)
 *
 * For each family the same three cases are handled:
 *   (a) Complete block present  → everything inside is stripped
 *   (b) Only closing tag found  → keep only what comes after it
 *   (c) Only opening tag found  → keep only what comes before it
 *       (stream was cut off mid-block)
 */
export function processThinkingOutput(raw: string, isFinished: boolean): {
    text:       string;
    isThinking: boolean;
} {
    // <think>…</think> 
    const thinkEnd = '</think>';
    if (raw.includes(thinkEnd)) {
        const parts = raw.split(thinkEnd);
        const afterThink = parts[parts.length - 1].trimStart();

        // <|channel>…<channel|> within the visible part
        return { text: stripChannelTags(afterThink, isFinished), isThinking: false };
    }

    // Still inside a <think> block (no closing tag yet)
    if (raw.includes('<think>')) {
        if (isFinished) {
            // Stream ended without </think> discard the orphaned block
            const before = raw.slice(0, raw.indexOf('<think>')).trimStart();
            return { text: stripChannelTags(before, isFinished), isThinking: false };
        }
        return { text: '', isThinking: true };
    }

    // No <think> tags at all. check for <|channel> only
    const text = stripChannelTags(raw, isFinished);

    if (isFinished) return { text, isThinking: false };

    // Still streaming: if we're inside a channel block signal thinking
    if (raw.includes('<|channel>') && !raw.includes('<channel|>')) {
        return { text: '', isThinking: true };
    }

    return { text, isThinking: false };
}

/**
 * Strips <|channel>…<channel|> blocks from a string.
 *
 * (a) Complete blocks          → removed entirely
 * (b) Orphaned <channel|>      → keep only what comes after
 * (c) Orphaned <|channel>      → keep only what comes before
 */
function stripChannelTags(content: string, isFinished: boolean): string {
    if (!content) return content;

    // (a) Complete blocks
    let result = content.replace(/<\|channel>[\s\S]*?<channel\|>/g, '');

    // (b) Orphaned closing tag
    const closeIdx = result.indexOf('<channel|>');
    if (closeIdx !== -1) {
        result = result.slice(closeIdx + '<channel|>'.length);
    }

    // (c) Orphaned opening tag (only strip when stream is finished; while
    //     streaming the closing tag may still be on its way)
    if (isFinished) {
        const openIdx = result.indexOf('<|channel>');
        if (openIdx !== -1) {
            result = result.slice(0, openIdx);
        }
    }

    return result.trimStart();
}

/**
 * Builds the message array for the AI API using the Soft Summary approach.
 *
 * Layout:
 *   [0]  system prompt (with optional summary appended at the end)
 *   [1…] messages newer than lastSummarizedMessageId
 *
 * The summary is merged into the single system message instead of being a
 * separate system turn — multiple consecutive system messages break the Jinja
 * template of many models (e.g. Qwen via LM Studio).
 *
 * checkAndSummarizeIfNeeded() must be called (and awaited) before this so
 * summaryMeta is already up-to-date for this turn.
 */
export function buildApiMessages(options: GenerationOptions): { role: string; content: string }[] {
    const { character, apiSettings, recentMessages, userPrompt, role } = options;

    const baseSystemPrompt = buildSystemPrompt({
        charName:     character?.name || 'Unknown',
        desc:         character?.desc,
        personality:  character?.personality,
        scenario:     character?.scenario,
        example:      character?.mes_example,
        lang:         apiSettings.aiLanguage || 'English',
        userName:     role?.name || 'User',
        userBio:      role?.bio,
        userPronouns: role?.pronouns,
        modelType:    'ollama',
        wiBefore: buildWiString(
            worldInfoState.allWorldInfos
                .filter(wi => (character?.world_info_ids ?? []).includes(wi.id))
                .flatMap(wi => wi.entries),
            'before',
            recentMessages.slice(-10).map(m => m.content).join(' '),
        ),
        wiAfter: buildWiString(
            worldInfoState.allWorldInfos
                .filter(wi => (character?.world_info_ids ?? []).includes(wi.id))
                .flatMap(wi => wi.entries),
            'after',
            recentMessages.slice(-10).map(m => m.content).join(' '),
        ),
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

    const messages: { role: string; content: string }[] = [
        { role: 'system', content: fullSystemContent },
    ];

    messages.push(...newMessages.map(msg => ({ role: msg.role, content: msg.content })));

    if (userPrompt) {
        messages.push({ role: 'user', content: userPrompt });
    }

    // Some model templates (e.g. Qwen via LM Studio) require the first
    // non-system turn to be a user message.
    const firstNonSystem = messages.find(m => m.role !== 'system');
    if (firstNonSystem?.role === 'assistant') {
        const systemIndex = messages.findLastIndex(m => m.role === 'system');
        messages.splice(systemIndex + 1, 0, { role: 'user', content: '[Start Roleplay]' });
    }

    return messages;
}

/**
 * Calls the AI API and streams the response.
 *
 * Important: call checkAndSummarizeIfNeeded() and await it BEFORE calling
 * this function. The two invoke('call_ai_api') calls must never overlap —
 * both share the Tauri 'ai-token' SSE channel.
 */
export async function runGeneration(
    options:   GenerationOptions,
    callbacks: GenerationCallbacks,
): Promise<string> {
    const { apiSettings } = options;

    const messages = buildApiMessages(options);

    console.log('[runGeneration] messages:', messages);

    let rawBuffer = '';

    const { listen } = await import('@tauri-apps/api/event');
    const unlisten = await listen<{ token: string }>('ai-token', (event) => {
        rawBuffer += event.payload.token;

        if (apiSettings.isThinkingModel) {
            const { text, isThinking } = processThinkingOutput(rawBuffer, false);
            callbacks.onThinkingPhaseChange(isThinking);
            callbacks.onStreamUpdate(text);
        } else {
            callbacks.onStreamUpdate(rawBuffer);
        }
    });

    try {
        const effectiveMaxTokens = apiSettings.isThinkingModel
            ? apiSettings.maxTokens + (apiSettings.thinkingBudget ?? 2500)
            : apiSettings.maxTokens;

        await invoke('call_ai_api', {
            payload: {
                url:              apiSettings.url,
                api_key:          apiSettings.apiKey,
                model:            apiSettings.model,
                messages,
                temperature:      apiSettings.temperature,
                max_tokens:       effectiveMaxTokens,
                presence_penalty: apiSettings.presencePenalty,
            },
        });

        if (apiSettings.isThinkingModel) {
            const { text } = processThinkingOutput(rawBuffer, true);
            callbacks.onThinkingPhaseChange(false);
            callbacks.onStreamUpdate(text);
            return text || rawBuffer;
        }

        callbacks.onStreamUpdate(rawBuffer);
        return rawBuffer;
    } finally {
        unlisten();
    }
}