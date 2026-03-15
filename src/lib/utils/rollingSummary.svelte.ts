import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appState } from '$lib/stores/appState.svelte';
import { chatState } from '$lib/stores/chatStore.svelte';
import type { Message } from '$lib/stores/chatStore.svelte';
import { buildApiMessages } from '$lib/utils/chatApi';
import type { GenerationOptions } from '$lib/utils/chatApi';
import { processThinkingOutput } from '$lib/utils/chatApi';

const DEFAULT_CONTEXT_LIMIT = 4096;

/** Extra buffer on top of max_tokens to cover estimation imprecision. */
const RESPONSE_RESERVE_EXTRA = 50;

/** Recent messages kept verbatim; reduced dynamically for very long messages. */
const TAIL_COUNT = 4;

/** Re-compress the rolling summary if it grows beyond this limit. */
const MAX_SUMMARY_TOKENS = 800;

// Token estimation

const encoder = new TextEncoder();

/**
 * Byte-based fallback estimator (3.35 bytes/token, matches SillyTavern).
 * Only used when the Rust tokenizer is unavailable.
 */
export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(encoder.encode(text).byteLength / 3.35);
}

/**
 * Accurate token count via the bundled Rust tokenizer.
 * Auto-selects vocabulary (Mistral / Llama 3 / Qwen 2) from the model name.
 * Falls back to estimateTokens() on failure.
 */
async function countTokens(text: string): Promise<number> {
    if (!text) return 0;
    try {
        return await invoke<number>('count_tokens', {
            text,
            modelName: appState.apiSettings?.model ?? '',
        });
    } catch {
        return estimateTokens(text);
    }
}

/** Token count for a messages array, including ~4 tokens/message framing overhead. */
async function countMessagesTokens(messages: { role: string; content: string }[]): Promise<number> {
    const framingOverhead = messages.length * 4;
    return (await countTokens(messages.map(m => m.content).join(' '))) + framingOverhead;
}

/**
 * Returns the token budget available for compressible middle messages.
 *
 * Builds the full prompt prefix (system + world info + summary + tail) and
 * measures it directly instead of using a static overhead constant.
 */
async function computeAvailableMiddleBudget(
    options: GenerationOptions,
    tail:    Message[],
): Promise<number> {
    const contextLimit = appState.apiSettings?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;

    // userPrompt is omitted. it's either already in the tail or appended later by runGeneration.
    const probeMessages = buildApiMessages({
        ...options,
        recentMessages: tail,
        userPrompt:     undefined,
    });
console.debug('[RollingSummary] probeMessages count=%d, contents:', 
    probeMessages.length, 
    probeMessages.map(m => `${m.role}(${m.content.length}chars)`)
);
    const fixedTokens     = await countMessagesTokens(probeMessages);
    const responseReserve = (appState.apiSettings?.maxTokens ?? 300) + RESPONSE_RESERVE_EXTRA;
    const budget          = contextLimit - responseReserve - fixedTokens;

    console.debug(
        '[RollingSummary] Budget probe: limit=%d  fixed(sys+summary+tail)=%d  ' +
        'response_reserve=%d  → middle_budget=%d',
        contextLimit, fixedTokens, responseReserve, budget,
    );

    return Math.max(budget, 0);
}

export const summaryState = $state({ isSummarizing: false });

/**
 * Strips thinking-model reasoning from any stored or generated text.
 *
 * Handles all three variants that models produce:
 *  (a) <think>…</think>actual text   → full block stripped
 *  (b) …thoughts…</think>actual text → orphaned closing tag (no opening tag)
 *  (c) <think>…                      → orphaned opening tag (stream truncated)
 */
function stripThinkingContent(content: string): string {
    if (!content) return content;
    // (a) Complete <think>…</think> blocks
    let result = content.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // (b) Orphaned </think> — keep only what comes after
    const closeIdx = result.indexOf('</think>');
    if (closeIdx !== -1) {
        result = result.slice(closeIdx + '</think>'.length);
    }
    // (c) Orphaned <think> — keep only what comes before
    const openIdx = result.indexOf('<think>');
    if (openIdx !== -1) {
        result = result.slice(0, openIdx);
    }
    return result.trimStart();
}

/**
 * Calls the AI to condense messagesToCompress into a compact narrative.
 *
 * NOTE: role:'system' must not appear in the messages array — call_ai_api
 * silently produces no output when it does. The instruction is prepended into
 * the user message instead.
 */
async function generateSummary(
    previousSummary: string | null,
    messagesToCompress: { role: string; content: string }[],
): Promise<string> {
    const { apiSettings } = appState;

    const transcript = messagesToCompress
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

    const contextBlock = previousSummary
        ? `EXISTING SUMMARY (rewrite this from scratch, do not copy it):\n${previousSummary}\n\n` +
        `NEW EVENTS TO MERGE IN:\n${transcript}\n\n` +
        `Write a single new summary that replaces the existing one entirely.`
        : `Session excerpt to summarize:\n${transcript}`;

    const systemInstruction =
        `You are a compression engine for roleplay session logs. ` +
        `Your only job: merge the previous summary (if any) with the new excerpt ` +
        `into one updated summary. ` +
        `Rules: ` +
        `(1) Never repeat information — if a fact is already in the previous summary, do not restate it unless it changed. ` +
        `(2) Drop filler, small talk, and anything with no lasting plot relevance. ` +
        `(3) Keep: character names, relationships, locations, key decisions, unresolved tensions. ` +
        `(4) Use short, dense sentences — no prose padding. ` +
        `(5) Hard limit: ${MAX_SUMMARY_TOKENS} tokens total. Cut low-priority details before exceeding it. ` +
        `(6) Write in ${apiSettings.aiLanguage || 'English'}. ` +
        `Output only the summary — no intro, no labels, no commentary.`;

    const summarizeMessages = [
        {
            role:    'user',
            content: `${systemInstruction}\n\n${contextBlock}`,
        },
    ];

    let rawBuffer = '';
    const unlisten = await listen<{ token: string }>('ai-token', (event) => {
        rawBuffer += event.payload.token;
    });

    try {
        await invoke('call_ai_api', {
            payload: {
                url:              apiSettings.url,
                api_key:          apiSettings.apiKey,
                model:            apiSettings.model,
                messages:         summarizeMessages,
                temperature:      0.3,
                max_tokens:       MAX_SUMMARY_TOKENS,
                presence_penalty: 0,
            },
        });
    } finally {
        unlisten();
    }

    // processThinkingOutput handles the </think> split; stripThinkingContent
    // catches the remaining cases (full <think>…</think> blocks, or a truncated
    // stream where </think> never arrived and processThinkingOutput returns the
    // raw buffer verbatim).
    const { text: processed } = processThinkingOutput(rawBuffer.trim(), true);
    const result = stripThinkingContent(processed);
    if (!result) {
        console.warn('[RollingSummary] Empty summary returned.');
        throw new Error('Summary generation returned empty.');
    }

    console.debug('[RollingSummary] Generated summary (%d chars, ~%d tokens).',
        result.length, estimateTokens(result));
    return result;
}

/** Re-compress the summary if it grew beyond MAX_SUMMARY_TOKENS. */
async function compressSummaryIfNeeded(summary: string): Promise<string> {
    if ((await countTokens(summary)) <= MAX_SUMMARY_TOKENS) return summary;
    console.warn('[RollingSummary] Summary exceeded token ceiling — re-compressing once.');
    const recompressed = await generateSummary(null, [{ role: 'assistant', content: summary }]);
    if ((await countTokens(recompressed)) > MAX_SUMMARY_TOKENS) {
        console.warn('[RollingSummary] Re-compression insufficient — using as-is.');
    }
    return recompressed;
}

/**
 * Checks whether the unsummarized conversation segment exceeds the token
 * budget and compresses it if needed.
 *
 * Must be fully awaited before runGeneration() — both functions invoke
 * call_ai_api and must not run concurrently on the same SSE channel.
 *
 * @param rawMessages  chatState.currentMessages (needed for ID tracking)
 * @param options      Same GenerationOptions passed to runGeneration
 */
export async function checkAndSummarizeIfNeeded(
    rawMessages: Message[],
    options:     GenerationOptions,
): Promise<void> {
    const { lastSummarizedMessageId } = chatState.summaryMeta;

    const lastSumIdx  = lastSummarizedMessageId
        ? rawMessages.findIndex(m => m.id === lastSummarizedMessageId)
        : -1;
    const newMessages = rawMessages.slice(lastSumIdx + 1);

    if (newMessages.length === 0) return;

    // Shrink tail until at least one message remains available for compression.
    let effectiveTailCount = Math.min(TAIL_COUNT, newMessages.length);
    while (effectiveTailCount > 1) {
        const candidateMiddle = newMessages.slice(0, newMessages.length - effectiveTailCount);
        if (candidateMiddle.length > 0) break;
        effectiveTailCount -= 1;
    }

    const tail   = newMessages.slice(-effectiveTailCount);
    const middle = newMessages.slice(0, newMessages.length - effectiveTailCount);

    const middleBudget     = await computeAvailableMiddleBudget(options, tail);
    const middleTokens     = await countTokens(middle.map(m => m.content).join(' '));
    const needsCompression = middleBudget < middleTokens;

    if (!needsCompression) {
        const contextLimit     = appState.apiSettings?.contextLimit ?? DEFAULT_CONTEXT_LIMIT;
        const responseReserve2 = (appState.apiSettings?.maxTokens ?? 300) + RESPONSE_RESERVE_EXTRA;
        const totalFixed       = (contextLimit - responseReserve2) - middleBudget;
        const totalUsed        = totalFixed + middleTokens;
        if (totalUsed / contextLimit > 0.9) {
            console.warn(
                '[RollingSummary] Context at %d%% capacity (~%d / %d tokens).',
                Math.round((totalUsed / contextLimit) * 100),
                totalUsed,
                contextLimit,
            );
        }
        return;
    }

    if (middle.length === 0) {
        // A single message fills the entire context window — nothing to compress.
        // The user needs to increase contextLimit in settings.
        console.warn(
            '[RollingSummary] Cannot compress — a single message already fills ' +
            'the context window. Increase contextLimit in settings.',
        );
        return;
    }

    summaryState.isSummarizing = true;

    try {
        const { currentSummary } = chatState.summaryMeta;
        const middleForApi       = middle.map(m => ({
            role:    m.role,
            content: stripThinkingContent(m.content),
        }));

        let newSummary = await generateSummary(currentSummary, middleForApi);
        newSummary     = await compressSummaryIfNeeded(newSummary);

        const lastCompressedId = middle[middle.length - 1]?.id ?? null;

        chatState.summaryMeta = {
            currentSummary:          newSummary,
            lastSummarizedMessageId: lastCompressedId,
        };

        console.debug(
            '[RollingSummary] Compressed %d messages (tail=%d). ' +
            'Summary ~%d tokens. Remaining middle budget ~%d tokens.',
            middle.length,
            effectiveTailCount,
            await countTokens(newSummary),
            await computeAvailableMiddleBudget(options, tail),
        );
    } catch (err) {
        console.error('[RollingSummary] Summarization failed — will retry next turn.', err);
    } finally {
        summaryState.isSummarizing = false;
    }
}