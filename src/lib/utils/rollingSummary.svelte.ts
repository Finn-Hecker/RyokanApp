import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appState } from '$lib/stores/appState.svelte';
import { getClientLanguageName } from '$lib/utils/clientLanguage';
import { chatState } from '$lib/stores/chatStore.svelte';
import type { Message } from '$lib/stores/chatStore.svelte';
import { buildApiMessages } from '$lib/utils/chatApi';
import type { GenerationOptions } from '$lib/utils/chatApi';
import { processThinkingOutput, stripThinkingContent } from '$lib/utils/chatApi';
import {
    commitOrRollback,
    deriveEffectiveTokenBudget,
    fitsContextBudget,
    isSummaryCommitCurrent,
    resolveSummaryMarker,
    selectCompressionWindow,
    shouldRecompressExistingSummary,
    summaryWorkKey,
    TOKEN_ESTIMATION_MARGIN,
    unicodeCodePointBoundaries,
    withRequestTokenValues,
    type ApiRequestParameterConfig,
    type SummaryMarkerState,
} from '$lib/utils/rollingSummaryCore';

const DEFAULT_CONTEXT_LIMIT = 4096;
const TAIL_COUNT = 4;
const MAX_SUMMARY_TOKENS = 800;
const THINKING_OVERHEAD = 2000;
const MESSAGE_FRAMING_TOKENS = 4;
const REQUEST_PRIMING_TOKENS = 3;

const encoder = new TextEncoder();

export interface PreparedGenerationContext {
    recentMessages: Message[];
    summaryMeta: SummaryMarkerState;
    requestParameterConfig: ApiRequestParameterConfig;
}

interface SummaryOperation {
    chatId: string;
    generationId: string | null;
    cancelled: boolean;
    requestParameterConfig: ApiRequestParameterConfig;
    contextLimit: number;
    apiSettings: GenerationOptions['apiSettings'];
}

interface PersistedMessageRow extends Omit<Message, 'swipe_variants'> {
    swipe_variants: string[] | string;
}

export class SummaryCancelledError extends Error {
    constructor() {
        super('Summary generation was cancelled.');
        this.name = 'SummaryCancelledError';
    }
}

export class ContextBudgetError extends Error {
    constructor(message = 'The assembled prompt exceeds the configured context token limit.') {
        super(message);
        this.name = 'ContextBudgetError';
    }
}

export function estimateTokens(text: string): number {
    if (!text) return 0;
    return Math.ceil(encoder.encode(text).byteLength / 3.35);
}

async function countTokens(text: string): Promise<number> {
    if (!text) return 0;
    const model = appState.apiSettings?.model ?? '';
    const cacheKey = `${model}\u0000${text}`;
    const cached = tokenCountCache.get(cacheKey);
    if (cached !== undefined) return cached;
    try {
        const count = await invoke<number>('count_tokens', {
            text,
            modelName: model,
        });
        if (tokenCountCache.size >= TOKEN_COUNT_CACHE_SIZE) {
            tokenCountCache.delete(tokenCountCache.keys().next().value!);
        }
        tokenCountCache.set(cacheKey, count);
        return count;
    } catch {
        return estimateTokens(text);
    }
}

async function countMessagesTokens(messages: { role: string; content: string }[]): Promise<number> {
    if (messages.length === 0) return REQUEST_PRIMING_TOKENS;
    const serialized = messages
        .map((message) => `${message.role}\n${message.content}`)
        .join('\n');
    return await countTokens(serialized)
        + (messages.length * MESSAGE_FRAMING_TOKENS)
        + REQUEST_PRIMING_TOKENS;
}

function contextLimit(configured = appState.apiSettings?.contextLimit ?? DEFAULT_CONTEXT_LIMIT): number {
    return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_CONTEXT_LIMIT;
}

async function loadRequestParameterConfig(
    options: GenerationOptions,
): Promise<ApiRequestParameterConfig> {
    let additionalParameters: Record<string, unknown> = {};
    try {
        const parsed = JSON.parse(options.apiSettings.additionalApiParameters || '{}');
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) additionalParameters = parsed;
    } catch { /* Settings validation normally prevents invalid JSON. */ }
    const enabled = options.apiSettings.parameterEnabled;
    return {
        temperatureEnabled: enabled?.temperature ?? false,
        maxTokensEnabled: enabled?.maxTokens ?? false,
        presencePenaltyEnabled: enabled?.presencePenalty ?? false,
        thinkingBudgetEnabled: enabled?.thinkingBudget ?? false,
        topPEnabled: enabled?.topP ?? false,
        topKEnabled: enabled?.topK ?? false,
        minPEnabled: enabled?.minP ?? false,
        frequencyPenaltyEnabled: enabled?.frequencyPenalty ?? false,
        maxTokens: options.apiSettings.maxTokens,
        thinkingBudget: options.apiSettings.thinkingBudget,
        additionalParameters,
    };
}

async function countAdditionalParameterTokens(
    requestParameterConfig: ApiRequestParameterConfig,
): Promise<number> {
    const additional = requestParameterConfig.additionalParameters;
    if (!additional || Object.keys(additional).length === 0) return 0;
    // Tool schemas, response schemas, and provider-specific prompt fields can
    // consume context even though they are outside `messages`. Counting the
    // whole custom object is intentionally conservative for unknown providers.
    return await countTokens(JSON.stringify(additional));
}

function responseReserve(requestParameterConfig: ApiRequestParameterConfig): number {
    return deriveEffectiveTokenBudget(requestParameterConfig).reserveTokens
        + TOKEN_ESTIMATION_MARGIN;
}

async function measureNormalRequest(
    options: GenerationOptions,
    recentMessages: Message[],
    summaryMeta: SummaryMarkerState,
    requestParameterConfig: ApiRequestParameterConfig,
): Promise<{ fits: boolean; promptTokens: number; reserve: number; limit: number }> {
    const apiMessages = buildApiMessages({
        ...options,
        recentMessages,
        userPrompt: undefined,
        summaryMeta,
    });
    const [messageTokens, additionalParameterTokens] = await Promise.all([
        countMessagesTokens(apiMessages),
        countAdditionalParameterTokens(requestParameterConfig),
    ]);
    const promptTokens = messageTokens + additionalParameterTokens;
    const reserve = responseReserve(requestParameterConfig);
    const limit = contextLimit(options.apiSettings.contextLimit);
    return {
        fits: fitsContextBudget(promptTokens, reserve, limit),
        promptTokens,
        reserve,
        limit,
    };
}

export const summaryState = $state({ isSummarizing: false });

let activeSummaryOperation: SummaryOperation | null = null;
const summaryWorkByBoundary = new Map<string, Promise<PreparedGenerationContext>>();
const pendingSummaryOperations = new Set<SummaryOperation>();
let summarySerial: Promise<void> = Promise.resolve();
const TOKEN_COUNT_CACHE_SIZE = 256;
const tokenCountCache = new Map<string, number>();

function assertOperationCurrent(operation: SummaryOperation): void {
    if (!isSummaryCommitCurrent(
        operation.chatId,
        chatState.activeChatId,
        operation.cancelled,
    )) {
        operation.cancelled = true;
        throw new SummaryCancelledError();
    }
}

export async function cancelActiveSummary(chatId?: string): Promise<boolean> {
    const operations = [...pendingSummaryOperations].filter(
        (operation) => !chatId || operation.chatId === chatId,
    );
    if (operations.length === 0) return false;
    for (const operation of operations) operation.cancelled = true;

    const active = activeSummaryOperation;
    if (active?.generationId && operations.includes(active)) {
        try {
            await invoke('stop_generation', { generationId: active.generationId });
        } catch (error) {
            console.error('Failed to cancel summary generation.', error);
        }
    }
    return true;
}

async function loadPersistedMessages(chatId: string): Promise<Message[]> {
    const rows = await invoke<PersistedMessageRow[]>('get_messages', { chatId });
    return rows.map((row) => ({
        ...row,
        swipe_variants: typeof row.swipe_variants === 'string'
            ? JSON.parse(row.swipe_variants)
            : (row.swipe_variants ?? [row.content]),
        swipe_index: row.swipe_index ?? 0,
    }));
}

async function loadPersistedSummary(chatId: string): Promise<SummaryMarkerState> {
    const meta = await invoke<{ summary: string | null; last_id: string | null }>(
        'get_summary_meta',
        { chatId },
    );
    return {
        currentSummary: meta.summary,
        lastSummarizedMessageId: meta.last_id,
    };
}

async function compareAndSwapPersistedSummary(
    chatId: string,
    expected: SummaryMarkerState,
    next: SummaryMarkerState,
): Promise<boolean> {
    return await invoke<boolean>('compare_and_swap_summary_meta', {
        chatId,
        expectedSummary: expected.currentSummary,
        expectedLastSummarizedMessageId: expected.lastSummarizedMessageId,
        summary: next.currentSummary,
        lastSummarizedMessageId: next.lastSummarizedMessageId,
    });
}

function applySummaryToActiveChat(chatId: string, meta: SummaryMarkerState): void {
    if (chatState.activeChatId === chatId) chatState.summaryMeta = { ...meta };
}

async function persistSummaryCorrection(
    operation: SummaryOperation,
    previousMeta: SummaryMarkerState,
    candidateMeta: SummaryMarkerState,
): Promise<void> {
    await commitSummary(operation, previousMeta, candidateMeta);
}

async function commitSummary(
    operation: SummaryOperation,
    previousMeta: SummaryMarkerState,
    candidateMeta: SummaryMarkerState,
): Promise<void> {
    assertOperationCurrent(operation);
    const result = await commitOrRollback(
        (expected, next) => compareAndSwapPersistedSummary(
            operation.chatId,
            expected,
            next,
        ),
        previousMeta,
        candidateMeta,
        () => isSummaryCommitCurrent(
            operation.chatId,
            chatState.activeChatId,
            operation.cancelled,
        ),
    );

    if (result !== 'committed') {
        const persistedMeta = await loadPersistedSummary(operation.chatId);
        applySummaryToActiveChat(operation.chatId, persistedMeta);
        if (result === 'conflict' && !operation.cancelled) {
            throw new Error('The rolling summary changed while it was being persisted.');
        }
        operation.cancelled = true;
        throw new SummaryCancelledError();
    }

    applySummaryToActiveChat(operation.chatId, candidateMeta);
}

function buildSummaryPrompt(
    previousSummary: string | null,
    messagesToCompress: { role: string; content: string }[],
    maximumSummaryTokens = MAX_SUMMARY_TOKENS,
): string {
    const transcript = messagesToCompress
        .map((message) => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}`)
        .join('\n\n');
    const contextBlock = previousSummary
        ? `EXISTING SUMMARY:\n${previousSummary}\n\nNEW EVENTS TO MERGE IN:\n${transcript}\n\n` +
          `Write one complete replacement summary containing both the still-relevant existing facts and the new developments.`
        : `Session excerpt to summarize:\n${transcript}`;
    const instruction =
        `You are a compression engine for roleplay session logs. ` +
        `Merge the previous summary (if any) with the new excerpt into one complete replacement summary. ` +
        `Rules: ` +
        `(1) Preserve every still-relevant established fact from the previous summary; do not drop a fact merely because it is unchanged. ` +
        `(2) Incorporate changes without duplicating facts, and clearly replace facts that are no longer true. ` +
        `(3) Keep names, relationships, character development, goals, locations, inventory and state, key decisions, promises, unresolved events, and important chronology or causality. ` +
        `(4) Distinguish established facts from uncertainty, suspicion, plans, or inference; never convert uncertainty into fact. ` +
        `(5) Drop filler, small talk, and details with no lasting story relevance. ` +
        `(6) Use short, dense sentences with clear attribution and no prose padding. ` +
        `(7) Hard limit: ${maximumSummaryTokens} tokens total. Cut the lowest-priority details before exceeding it. ` +
        `(8) Write in ${getClientLanguageName()}. ` +
        `Output only the summary — no intro, labels, or commentary.`;
    return `${instruction}\n\n${contextBlock}`;
}

async function summaryRequestFits(
    previousSummary: string | null,
    messages: { role: string; content: string }[],
    requestParameterConfig: ApiRequestParameterConfig,
    maximumSummaryTokens = MAX_SUMMARY_TOKENS,
    hardContextLimit = DEFAULT_CONTEXT_LIMIT,
): Promise<boolean> {
    const prompt = buildSummaryPrompt(previousSummary, messages, maximumSummaryTokens);
    const [messageTokens, additionalParameterTokens] = await Promise.all([
        countMessagesTokens([{ role: 'user', content: prompt }]),
        countAdditionalParameterTokens(requestParameterConfig),
    ]);
    const inputTokens = messageTokens + additionalParameterTokens;
    const summaryRequestParameterConfig = withRequestTokenValues(
        requestParameterConfig,
        maximumSummaryTokens,
        THINKING_OVERHEAD,
    );
    const outputReserve = deriveEffectiveTokenBudget(
        summaryRequestParameterConfig,
    ).reserveTokens;
    return fitsContextBudget(
        inputTokens,
        outputReserve + TOKEN_ESTIMATION_MARGIN,
        contextLimit(hardContextLimit),
    );
}

async function requestSummary(
    previousSummary: string | null,
    messagesToCompress: { role: string; content: string }[],
    operation: SummaryOperation,
    maximumSummaryTokens = MAX_SUMMARY_TOKENS,
): Promise<string> {
    assertOperationCurrent(operation);
    if (!(await summaryRequestFits(
        previousSummary,
        messagesToCompress,
        operation.requestParameterConfig,
        maximumSummaryTokens,
        operation.contextLimit,
    ))) {
        throw new ContextBudgetError('A summary input segment exceeds the configured context token limit.');
    }
    assertOperationCurrent(operation);

    const apiSettings = operation.apiSettings;
    const summaryRequestParameterConfig = withRequestTokenValues(
        operation.requestParameterConfig,
        maximumSummaryTokens,
        THINKING_OVERHEAD,
    );
    const effectiveBudget = deriveEffectiveTokenBudget(summaryRequestParameterConfig);
    const generationId = crypto.randomUUID();
    operation.generationId = generationId;
    let rawBuffer = '';
    const unlisten = await listen<{ token: string; generationId?: string }>('ai-token', (event) => {
        if (event.payload.generationId === generationId) rawBuffer += event.payload.token;
    });
    const unlistenThinking = await listen<{ token: string; generationId?: string }>(
        'ai-thinking-token',
        () => {},
    );

    try {
        await invoke('call_ai_api', {
            payload: {
                generation_id: generationId,
                request_parameter_config: summaryRequestParameterConfig,
                url: apiSettings.url,
                api_key: apiSettings.apiKey,
                model: apiSettings.model,
                messages: [{
                    role: 'user',
                    content: buildSummaryPrompt(
                        previousSummary,
                        messagesToCompress,
                        maximumSummaryTokens,
                    ),
                }],
                temperature: 0.3,
                max_tokens: effectiveBudget.payloadMaxTokens,
                presence_penalty: 0,
                thinking_budget: effectiveBudget.payloadThinkingBudget,
            },
        });
    } finally {
        unlisten();
        unlistenThinking();
        if (operation.generationId === generationId) operation.generationId = null;
    }

    assertOperationCurrent(operation);
    const { text: processed } = processThinkingOutput(rawBuffer.trim(), true);
    const result = stripThinkingContent(processed);
    if (!result) throw new Error('Summary generation returned empty.');
    return result;
}

async function enforceSummaryLimit(
    summary: string,
    operation: SummaryOperation,
    maximumSummaryTokens = MAX_SUMMARY_TOKENS,
): Promise<string> {
    if ((await countTokens(summary)) <= maximumSummaryTokens) return summary;
    const recompressed = await requestSummary(
        null,
        [{ role: 'assistant', content: summary }],
        operation,
        maximumSummaryTokens,
    );
    if ((await countTokens(recompressed)) > maximumSummaryTokens) {
        throw new ContextBudgetError('The model returned a rolling summary above its token limit.');
    }
    return recompressed;
}

async function largestFittingPrefix(
    previousSummary: string | null,
    message: { role: string; content: string },
    operation: SummaryOperation,
    maximumSummaryTokens = MAX_SUMMARY_TOKENS,
): Promise<number> {
    const boundaries = unicodeCodePointBoundaries(message.content);
    let low = 0;
    let high = boundaries.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const fits = await summaryRequestFits(previousSummary, [{
            ...message,
            content: message.content.slice(0, boundaries[mid]),
        }], operation.requestParameterConfig, maximumSummaryTokens, operation.contextLimit);
        if (fits) low = mid;
        else high = mid - 1;
    }
    return boundaries[low];
}

async function generateRollingSummary(
    previousSummary: string | null,
    messages: { role: string; content: string }[],
    operation: SummaryOperation,
    maximumSummaryTokens = MAX_SUMMARY_TOKENS,
): Promise<string> {
    let summary = previousSummary;
    const pending = messages.map((message) => ({ ...message }));

    while (pending.length > 0) {
        assertOperationCurrent(operation);
        const batch: { role: string; content: string }[] = [];
        while (pending.length > 0) {
            const candidate = [...batch, pending[0]];
            if (await summaryRequestFits(
                summary,
                candidate,
                operation.requestParameterConfig,
                maximumSummaryTokens,
                operation.contextLimit,
            )) {
                batch.push(pending.shift()!);
                continue;
            }
            if (batch.length > 0) break;

            const prefixLength = await largestFittingPrefix(
                summary,
                pending[0],
                operation,
                maximumSummaryTokens,
            );
            if (prefixLength <= 0) {
                throw new ContextBudgetError(
                    'The character prompt, existing summary, and response reserve leave no room to summarize the next message.',
                );
            }
            const original = pending[0];
            batch.push({ ...original, content: original.content.slice(0, prefixLength) });
            const remainder = original.content.slice(prefixLength);
            if (remainder) original.content = remainder;
            else pending.shift();
            break;
        }

        summary = await requestSummary(summary, batch, operation, maximumSummaryTokens);
        summary = await enforceSummaryLimit(summary, operation, maximumSummaryTokens);
    }

    if (!summary) throw new Error('Summary generation returned empty.');
    return summary;
}

async function performSummaryCheck(
    operation: SummaryOperation,
    options: GenerationOptions,
    beforeMessageId?: string,
): Promise<PreparedGenerationContext> {
    const { chatId } = operation;
    activeSummaryOperation = operation;

    try {
        assertOperationCurrent(operation);
        const [allMessages, persistedMeta, requestParameterConfig] = await Promise.all([
            loadPersistedMessages(chatId),
            loadPersistedSummary(chatId),
            loadRequestParameterConfig(options),
        ]);
        operation.requestParameterConfig = requestParameterConfig;
        assertOperationCurrent(operation);

        let history = allMessages;
        if (beforeMessageId) {
            const boundary = allMessages.findIndex((message) => message.id === beforeMessageId);
            if (boundary < 0) throw new Error('The message selected for retry no longer exists.');
            history = allMessages.slice(0, boundary);
        }

        let meta = persistedMeta;
        let marker = resolveSummaryMarker(allMessages, meta);
        const boundaryExcludesMarker = Boolean(beforeMessageId) && marker.markerIndex >= history.length;
        if (marker.mustReset || boundaryExcludesMarker) {
            const invalidMeta = meta;
            meta = { currentSummary: null, lastSummarizedMessageId: null };
            await persistSummaryCorrection(operation, invalidMeta, meta);
        }
        marker = resolveSummaryMarker(history, meta);

        const initialFit = await measureNormalRequest(
            options,
            history,
            meta,
            requestParameterConfig,
        );
        assertOperationCurrent(operation);
        if (initialFit.fits) {
            return { recentMessages: history, summaryMeta: meta, requestParameterConfig };
        }

        // Test the irreducible normal request before spending a model call on a
        // summary. This retains the newest required message and still evaluates
        // World Info against the full persisted recent context.
        const messageBeforeNewest = history.at(-2);
        const irreducibleMeta: SummaryMarkerState = {
            currentSummary: null,
            lastSummarizedMessageId: messageBeforeNewest?.id?.toString() ?? null,
        };
        const irreducibleFit = await measureNormalRequest(
            options,
            history,
            irreducibleMeta,
            requestParameterConfig,
        );
        assertOperationCurrent(operation);
        if (!irreducibleFit.fits) {
            throw new ContextBudgetError(
                `The fixed prompt, World Info, newest message, and response reserve need ` +
                `${irreducibleFit.promptTokens + irreducibleFit.reserve} tokens, but the ` +
                `configured context limit is ${irreducibleFit.limit}.`,
            );
        }

        if (history.length > 1) {
            const minimalSummaryFit = await measureNormalRequest(
                options,
                history,
                { ...irreducibleMeta, currentSummary: 'x' },
                requestParameterConfig,
            );
            assertOperationCurrent(operation);
            if (!minimalSummaryFit.fits) {
                throw new ContextBudgetError(
                    'The required prompt leaves no room for even a minimal rolling summary.',
                );
            }
        }

        summaryState.isSummarizing = true;
        const clean = (message: Message) => ({
            role: message.role,
            content: message.role === 'assistant'
                ? stripThinkingContent(message.content)
                : message.content,
        });

        let workingMeta = meta;
        if (meta.currentSummary) {
            const restoredSummaryTokens = await countTokens(meta.currentSummary);
            assertOperationCurrent(operation);
            if (shouldRecompressExistingSummary(restoredSummaryTokens, MAX_SUMMARY_TOKENS)) {
                const recompressed = await generateRollingSummary(
                    null,
                    [{ role: 'assistant', content: meta.currentSummary }],
                    operation,
                );
                workingMeta = {
                    currentSummary: recompressed,
                    lastSummarizedMessageId: meta.lastSummarizedMessageId,
                };
                const recompressedFit = await measureNormalRequest(
                    options,
                    history,
                    workingMeta,
                    requestParameterConfig,
                );
                assertOperationCurrent(operation);
                if (recompressedFit.fits) {
                    await commitSummary(operation, meta, workingMeta);
                    return {
                        recentMessages: history,
                        summaryMeta: workingMeta,
                        requestParameterConfig,
                    };
                }
            }
        }

        marker = resolveSummaryMarker(history, workingMeta);
        const newMessages = history.slice(marker.startIndex);
        let { middle, tail } = selectCompressionWindow(newMessages, TAIL_COUNT);
        if (middle.length === 0) {
            if (workingMeta.currentSummary && workingMeta.lastSummarizedMessageId) {
                const withoutSummary = await measureNormalRequest(
                    options,
                    history,
                    {
                        currentSummary: null,
                        lastSummarizedMessageId: workingMeta.lastSummarizedMessageId,
                    },
                    requestParameterConfig,
                );
                const summaryAllowance = Math.min(
                    MAX_SUMMARY_TOKENS,
                    withoutSummary.limit
                        - withoutSummary.promptTokens
                        - withoutSummary.reserve
                        - 16,
                );
                if (summaryAllowance > 0) {
                    const tighterSummary = await generateRollingSummary(
                        null,
                        [{ role: 'assistant', content: workingMeta.currentSummary }],
                        operation,
                        summaryAllowance,
                    );
                    const tighterMeta: SummaryMarkerState = {
                        currentSummary: tighterSummary,
                        lastSummarizedMessageId: workingMeta.lastSummarizedMessageId,
                    };
                    const tighterFit = await measureNormalRequest(
                        options,
                        history,
                        tighterMeta,
                        requestParameterConfig,
                    );
                    assertOperationCurrent(operation);
                    if (tighterFit.fits) {
                        await commitSummary(operation, meta, tighterMeta);
                        return {
                            recentMessages: history,
                            summaryMeta: tighterMeta,
                            requestParameterConfig,
                        };
                    }
                }
            }
            throw new ContextBudgetError(
                'The existing summary cannot be compressed enough to fit the configured context token limit.',
            );
        }

        let newSummary = await generateRollingSummary(
            workingMeta.currentSummary,
            middle.map(clean),
            operation,
        );
        let lastCompressedId = middle[middle.length - 1]?.id ?? null;
        if (!lastCompressedId) throw new Error('A persisted message is missing its identifier.');
        let candidateMeta: SummaryMarkerState = {
            currentSummary: newSummary,
            lastSummarizedMessageId: lastCompressedId,
        };
        let finalFit = await measureNormalRequest(
            options,
            history,
            candidateMeta,
            requestParameterConfig,
        );

        while (!finalFit.fits && tail.length > 1) {
            const next = tail.shift()!;
            newSummary = await generateRollingSummary(newSummary, [clean(next)], operation);
            lastCompressedId = next.id ?? null;
            if (!lastCompressedId) throw new Error('A persisted message is missing its identifier.');
            candidateMeta = {
                currentSummary: newSummary,
                lastSummarizedMessageId: lastCompressedId,
            };
            finalFit = await measureNormalRequest(
                options,
                history,
                candidateMeta,
                requestParameterConfig,
            );
        }

        if (!finalFit.fits) {
            throw new ContextBudgetError(
                `The prompt still needs ${finalFit.promptTokens + finalFit.reserve} tokens ` +
                `but the configured context limit is ${finalFit.limit}.`,
            );
        }

        await commitSummary(operation, meta, candidateMeta);
        return { recentMessages: history, summaryMeta: candidateMeta, requestParameterConfig };
    } finally {
        if (activeSummaryOperation === operation) activeSummaryOperation = null;
        summaryState.isSummarizing = false;
    }
}

/** Prepares complete persisted solo-chat context and rolls its summary forward if needed. */
export function checkAndSummarizeIfNeeded(
    chatId: string,
    options: GenerationOptions,
    beforeMessageId?: string,
): Promise<PreparedGenerationContext> {
    const workKey = summaryWorkKey(chatId, beforeMessageId);
    const existing = summaryWorkByBoundary.get(workKey);
    if (existing) return existing;

    const operation: SummaryOperation = {
        chatId,
        generationId: null,
        cancelled: false,
        requestParameterConfig: {
            maxTokensEnabled: false,
            thinkingBudgetEnabled: false,
            maxTokens: options.apiSettings.maxTokens,
            thinkingBudget: options.apiSettings.thinkingBudget,
            additionalParameters: {},
        },
        contextLimit: options.apiSettings.contextLimit,
        apiSettings: structuredClone(options.apiSettings),
    };
    pendingSummaryOperations.add(operation);

    const work = summarySerial
        .catch(() => undefined)
        .then(() => performSummaryCheck(operation, options, beforeMessageId))
        .finally(() => {
            pendingSummaryOperations.delete(operation);
            if (summaryWorkByBoundary.get(workKey) === work) {
                summaryWorkByBoundary.delete(workKey);
            }
        });
    summaryWorkByBoundary.set(workKey, work);
    summarySerial = work.then(() => undefined, () => undefined);
    return work;
}
