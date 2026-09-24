import { traceDecision, diagnosticOperation, diagnosticScope, diagnosticConnection, type DiagnosticMeasurement, type DiagnosticDecision } from '$lib/utils/diagnosticDecisions';
import type { TokenUsage } from '$lib/utils/tokenUsage';
import { reportDiagnostic } from '$lib/utils/diagnostics';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { appState, snapshotSummaryApiConnection } from '$lib/stores/appState.svelte';
import { getClientLanguageName } from '$lib/utils/clientLanguage';
import { chatState } from '$lib/stores/chatStore.svelte';
import type { Message } from '$lib/stores/chatStore.svelte';
import { buildApiMessages, generationConfigurationFingerprint, messageFingerprint } from '$lib/utils/chatApi';
import type { GenerationOptions, GenerationPromptSnapshot } from '$lib/utils/chatApi';
import { processThinkingOutput, stripThinkingContent } from '$lib/utils/chatApi';
import {
    commitOrRollback,
    boundedSummaryOutputCap,
    canReusePromptAnchor,
    currentConversationRevision,
    deriveEffectiveTokenBudget,
    fitsContextBudget,
    isSummaryCommitCurrent,
    resolveSummaryMarker,
    reconcilePromptTokens,
    shouldRecompressExistingSummary,
    summaryWorkKey,
    summarySafetyMargin,
    contextSafetyMargin,
    unicodeCodePointBoundaries,
    withRequestTokenValues,
    type ApiRequestParameterConfig,
    type SummaryMarkerState,
    type PromptUsageAnchor,
} from '$lib/utils/rollingSummaryCore';
import { adaptiveSummaryOutputCap, resolvedHardContextLimit, resolvedWorkingContextTarget, shouldTriggerSummary, summaryCompressionGoal } from '$lib/utils/connectionCore';
import { ensureContextDetection } from '$lib/utils/apiConnections';

const DEFAULT_CONTEXT_LIMIT = 4096;
const DEFAULT_SUMMARY_TOKENS = 1024;
const MESSAGE_FRAMING_TOKENS = 4;
const REQUEST_PRIMING_TOKENS = 3;

const encoder = new TextEncoder();

export interface PreparedGenerationContext {
    recentMessages: Message[];
    summaryMeta: SummaryMarkerState;
    requestParameterConfig: ApiRequestParameterConfig;
}

interface SummaryOperation {
    diagnosticId: number;
    chatId: string;
    generationId: string | null;
    cancelled: boolean;
    requestParameterConfig: ApiRequestParameterConfig;
    contextLimit: number;
    apiSettings: GenerationOptions['apiSettings'];
    maximumSummaryTokens: number;
    selectionFingerprint: string;
    revision: number;
}

function summarySelectionFingerprint(): string {
    const connection = snapshotSummaryApiConnection(appState.apiSettings);
    return JSON.stringify([appState.summaryConnectionId, appState.longTermMemory,
        connection.id, connection.providerKind, connection.url, connection.model,
        connection.apiKey, connection.manualContextCap, appState.apiSettings.contextStrategy]);
}

interface PersistedMessageRow extends Omit<Message, 'swipe_variants' | 'usage_variants'> {
    swipe_variants: string[] | string;
    usage_variants: Message['usage_variants'] | string;
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

async function countTokens(text: string, model = appState.apiSettings?.model ?? ''): Promise<number> {
    if (!text) return 0;
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

async function countMessagesTokens(messages: { role: string; content: string }[], model?: string): Promise<number> {
    if (messages.length === 0) return REQUEST_PRIMING_TOKENS;
    const serialized = messages
        .map((message) => `${message.role}\n${message.content}`)
        .join('\n');
    return await countTokens(serialized, model)
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
    model?: string,
): Promise<number> {
    const additional = requestParameterConfig.additionalParameters;
    if (!additional || Object.keys(additional).length === 0) return 0;
    // Tool schemas, response schemas, and provider-specific prompt fields can
    // consume context even though they are outside `messages`. Counting the
    // whole custom object is intentionally conservative for unknown providers.
    return await countTokens(JSON.stringify(additional), model);
}

function responseReserve(requestParameterConfig: ApiRequestParameterConfig, hardLimit: number): number {
    return deriveEffectiveTokenBudget(requestParameterConfig).reserveTokens
        + contextSafetyMargin(hardLimit);
}

async function measureNormalRequest(
    options: GenerationOptions,
    recentMessages: Message[],
    summaryMeta: SummaryMarkerState,
    requestParameterConfig: ApiRequestParameterConfig,
    anchorChatId?: string,
) {
    const apiMessages = buildApiMessages({ ...options, recentMessages, userPrompt: undefined, summaryMeta });
    let promptTokens: number | null = null;
    let anchorState: DiagnosticMeasurement['anchor'] = 'none';
    const anchor = anchorChatId && promptAnchors.get(anchorChatId);
    const response = anchor && recentMessages[anchor.historyFingerprint.length];
    if (anchor) {
        const fingerprints = recentMessages.map(messageFingerprint);
        const configuration = generationConfigurationFingerprint({ ...options, requestParameterConfig });
        const revision = currentConversationRevision(anchorChatId!);
        anchorState = anchor.summaryFingerprint !== JSON.stringify(summaryMeta) ? 'summary_changed'
            : anchor.configurationFingerprint !== configuration ? 'configuration_changed'
            : anchor.revision !== revision ? 'revision_changed'
            : !anchor.historyFingerprint.every((value, index) => fingerprints[index] === value) ? 'history_changed'
            : !response || fingerprints[anchor.historyFingerprint.length] !== anchor.responseFingerprint ? 'response_changed'
            : 'usage_unavailable';
        if (response && canReusePromptAnchor(anchor, fingerprints, JSON.stringify(summaryMeta), configuration, revision)) {
            const inputTokens = response.usage_variants?.[anchor.responseSwipeIndex]?.inputTokens;
            promptTokens = await reconcilePromptTokens(inputTokens, anchor.prompt, apiMessages,
                (tail) => countMessagesTokens(tail, options.apiSettings.model));
            anchorState = promptTokens !== null ? 'reused'
                : Number.isSafeInteger(inputTokens) && inputTokens! >= 0 ? 'no_common_prefix' : 'usage_unavailable';
        }
    }
    // Retain the full local estimate for comparison even when provider usage is reused.
    // Existing tokenizer caching bounds the additional work; no content enters diagnostics.
    const [messageTokens, additionalParameterTokens] = await Promise.all([
        countMessagesTokens(apiMessages, options.apiSettings.model),
        countAdditionalParameterTokens(requestParameterConfig, options.apiSettings.model),
    ]);
    const localTokens = messageTokens + additionalParameterTokens;
    if (promptTokens === null) promptTokens = localTokens;
    const limit = resolvedHardContextLimit(options.apiSettings);
    const effective = deriveEffectiveTokenBudget(requestParameterConfig);
    const reserve = responseReserve(requestParameterConfig, limit);
    const diagnostic: DiagnosticMeasurement = {
        budget_details: effective.calculation,
        prompt_tokens: promptTokens, local_tokens: localTokens, additional_tokens: additionalParameterTokens,
        reserve_tokens: effective.reserveTokens, safety_tokens: contextSafetyMargin(limit),
        total: promptTokens + reserve, hard_limit: limit, known_total_limit: effective.hasKnownTotalLimit,
        max_tokens_enabled: requestParameterConfig.maxTokensEnabled, thinking_budget_enabled: requestParameterConfig.thinkingBudgetEnabled,
        payload_max_tokens: effective.payloadMaxTokens, payload_thinking_budget: effective.payloadThinkingBudget,
        anchor: anchorState,
    };
    return { fits: fitsContextBudget(promptTokens, reserve, limit), promptTokens, reserve, limit, total: promptTokens + reserve, diagnostic };
}

function traceBudget(
    operation: number, options: GenerationOptions, history: Message[], meta: SummaryMarkerState,
    measurement: Awaited<ReturnType<typeof measureNormalRequest>>,
    stage: Extract<DiagnosticDecision, { kind: 'budget' }>['stage'],
    summaryLimit = 0, summaryPressure = false, retry = false,
): void {
    const working = resolvedWorkingContextTarget(options.apiSettings);
    const chatPressure = shouldTriggerSummary(measurement.total, working);
    traceDecision({ kind: 'budget', operation, conversation: diagnosticScope(chatState.activeChatId ?? 'no-active-chat'),
        connection: diagnosticConnection(options.apiSettings), strategy: options.apiSettings.contextStrategy, compression_goal: summaryCompressionGoal(working), stage, measurement: measurement.diagnostic,
        working_target: working, summary_limit: summaryLimit, summary_pressure: summaryPressure,
        trigger: !appState.longTermMemory ? 'disabled' : chatPressure && summaryPressure ? 'both' : chatPressure ? 'chat' : summaryPressure ? 'summary' : 'none',
        history_count: history.length, marker_index: resolveSummaryMarker(history, meta).markerIndex,
        has_summary: Boolean(meta.currentSummary), revision: currentConversationRevision(chatState.activeChatId ?? ''), retry,
    });
}

function traceSummaryState(operation: SummaryOperation,
    state: Extract<DiagnosticDecision, { kind: 'summary_state' }>['state'],
    reason: Extract<DiagnosticDecision, { kind: 'summary_state' }>['reason'] = 'none',
    messageCount = 0, retainedCount = 0, summaryTokens: number | null = null,
): void {
    traceDecision({ kind: 'summary_state', operation: operation.diagnosticId, conversation: diagnosticScope(operation.chatId), connection: diagnosticConnection(operation.apiSettings), state, reason,
        message_count: messageCount, retained_count: retainedCount, summary_tokens: summaryTokens,
        output_cap: operation.maximumSummaryTokens, revision: currentConversationRevision(operation.chatId) });
}

async function selectNewestRawHistory(
    options: GenerationOptions,
    history: Message[],
    requestParameterConfig: ApiRequestParameterConfig,
    budget: number,
): Promise<{ messages: Message[]; measurement: Awaited<ReturnType<typeof measureNormalRequest>> }> {
    const starts = [0, ...history.map((message, index) => message.role === 'user' ? index : -1).filter(index => index > 0)];
    const newestMeasurement = await measureNormalRequest(
        options,
        history.slice(-1),
        { currentSummary: null, lastSummarizedMessageId: null },
        requestParameterConfig,
    );
    for (const start of starts) {
        const messages = history.slice(start);
        const measurement = await measureNormalRequest(
            options,
            messages,
            { currentSummary: null, lastSummarizedMessageId: null },
            requestParameterConfig,
        );
        if (measurement.total <= budget) return { messages, measurement };
    }
    return { messages: history.slice(-1), measurement: newestMeasurement };
}

function summaryRequestPolicy(maximumSummaryTokens: number): ApiRequestParameterConfig {
    return {
        temperatureEnabled: true,
        maxTokensEnabled: true,
        presencePenaltyEnabled: false,
        thinkingBudgetEnabled: false,
        topPEnabled: false,
        topKEnabled: false,
        minPEnabled: false,
        frequencyPenaltyEnabled: false,
        maxTokens: maximumSummaryTokens,
        thinkingBudget: 0,
        additionalParameters: {
            chat_template_kwargs: { enable_thinking: false },
            reasoning: { enabled: false },
        },
    };
}

export const summaryState = $state({ isSummarizing: false });

let activeSummaryOperation: SummaryOperation | null = null;
const summaryWorkByBoundary = new Map<string, Promise<PreparedGenerationContext> & { diagnosticId?: number }>();
const pendingSummaryOperations = new Set<SummaryOperation>();
let summarySerial: Promise<void> = Promise.resolve();
const TOKEN_COUNT_CACHE_SIZE = 256;
const tokenCountCache = new Map<string, number>();
const promptAnchors = new Map<string, PromptUsageAnchor>();

/** Associates an exact pre-response request snapshot with its persisted variant. */
export function rememberGenerationAnchor(
    chatId: string,
    promptSnapshot: GenerationPromptSnapshot,
    response: Message | undefined,
): void {
    const usage = response?.usage_variants?.[response.swipe_index];
    if (!response?.id || response.role !== 'assistant'
        || !Number.isSafeInteger(usage?.inputTokens) || usage!.inputTokens! < 0) {
        promptAnchors.delete(chatId);
        return;
    }
    promptAnchors.set(chatId, {
        historyFingerprint: promptSnapshot.historyFingerprint,
        summaryFingerprint: promptSnapshot.summaryFingerprint,
        configurationFingerprint: promptSnapshot.configurationFingerprint,
        prompt: promptSnapshot.messages,
        responseSwipeIndex: response.swipe_index,
        responseFingerprint: messageFingerprint(response),
        revision: currentConversationRevision(chatId),
    });
}

function assertOperationCurrent(operation: SummaryOperation): void {
    if (!isSummaryCommitCurrent(
        operation.chatId,
        chatState.activeChatId,
        operation.cancelled,
    ) || operation.selectionFingerprint !== summarySelectionFingerprint()
      || resolvedHardContextLimit(snapshotSummaryApiConnection(appState.apiSettings)) < operation.contextLimit
      || operation.revision !== currentConversationRevision(operation.chatId)) {
        const reason = operation.cancelled ? 'explicit_cancel'
            : operation.chatId !== chatState.activeChatId ? 'chat_changed'
            : operation.selectionFingerprint !== summarySelectionFingerprint() ? 'selection_changed'
            : operation.revision !== currentConversationRevision(operation.chatId) ? 'revision_changed' : 'context_shrunk';
        traceSummaryState(operation, 'cancelled', reason);
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
            reportDiagnostic('summary');
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
        usage_variants: typeof row.usage_variants === 'string'
            ? JSON.parse(row.usage_variants) : (row.usage_variants ?? []),
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
        () => {
            try { assertOperationCurrent(operation); return true; }
            catch { return false; }
        },
    );

    traceSummaryState(operation, result === 'rolled-back' ? 'rolled_back' : result);
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
    maximumSummaryTokens = DEFAULT_SUMMARY_TOKENS,
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
    maximumSummaryTokens = DEFAULT_SUMMARY_TOKENS,
    hardContextLimit = DEFAULT_CONTEXT_LIMIT,
    model = '',
    diagnostic?: { operation: number; connection: number; stage: 'pressure' | 'request' },
): Promise<boolean> {
    const prompt = buildSummaryPrompt(previousSummary, messages, maximumSummaryTokens);
    const [messageTokens, additionalParameterTokens] = await Promise.all([
        countMessagesTokens([{ role: 'user', content: prompt }], model),
        countAdditionalParameterTokens(requestParameterConfig, model),
    ]);
    const inputTokens = messageTokens + additionalParameterTokens;
    const summaryRequestParameterConfig = withRequestTokenValues(
        requestParameterConfig,
        maximumSummaryTokens,
        0,
    );
    const outputReserve = deriveEffectiveTokenBudget(
        summaryRequestParameterConfig,
    ).reserveTokens;
    const fits = fitsContextBudget(inputTokens, outputReserve + summarySafetyMargin(hardContextLimit), contextLimit(hardContextLimit));
    if (diagnostic) traceDecision({ kind: 'summary_capacity', ...diagnostic, input_tokens: inputTokens,
        output_reserve: outputReserve, safety_tokens: summarySafetyMargin(hardContextLimit),
        hard_limit: contextLimit(hardContextLimit), output_cap: maximumSummaryTokens, fits });
    return fits;
}

async function requestSummary(
    previousSummary: string | null,
    messagesToCompress: { role: string; content: string }[],
    operation: SummaryOperation,
    maximumSummaryTokens = DEFAULT_SUMMARY_TOKENS,
): Promise<string> {
    assertOperationCurrent(operation);
    if (!(await summaryRequestFits(
        previousSummary,
        messagesToCompress,
        operation.requestParameterConfig,
        maximumSummaryTokens,
        operation.contextLimit,
        operation.apiSettings.model,
        { operation: operation.diagnosticId, connection: diagnosticConnection(operation.apiSettings), stage: 'request' },
    ))) {
        throw new ContextBudgetError('A summary input segment exceeds the configured context token limit.');
    }
    assertOperationCurrent(operation);

    const apiSettings = operation.apiSettings;
    const summaryRequestParameterConfig = withRequestTokenValues(
        operation.requestParameterConfig,
        maximumSummaryTokens,
        0,
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
        const usage = await invoke<TokenUsage | null>('call_ai_api', {
            payload: {
                generation_id: generationId,
                provider_kind: apiSettings.providerKind,
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
                top_p: 1,
                top_k: 0,
                min_p: 0,
                frequency_penalty: 0,
                thinking_budget: effectiveBudget.payloadThinkingBudget,
            },
        });
        traceDecision({ kind: 'usage', operation: operation.diagnosticId, request: diagnosticOperation(),
            connection: diagnosticConnection(apiSettings), purpose: 'summary',
            local_input_tokens: await countMessagesTokens([{ role: 'user', content: buildSummaryPrompt(previousSummary, messagesToCompress, maximumSummaryTokens) }], apiSettings.model)
                + await countAdditionalParameterTokens(summaryRequestParameterConfig, apiSettings.model),
            input_tokens: usage?.inputTokens ?? null, cached_input_tokens: usage?.cachedInputTokens ?? null,
            output_tokens: usage?.outputTokens ?? null, reasoning_tokens: usage?.reasoningTokens ?? null,
            reserve_tokens: effectiveBudget.reserveTokens,
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
    maximumSummaryTokens = DEFAULT_SUMMARY_TOKENS,
): Promise<string> {
    const summaryTokens = await countTokens(summary, operation.apiSettings.model);
    traceSummaryState(operation, 'result', 'none', 0, 0, summaryTokens);
    if (summaryTokens <= maximumSummaryTokens) return summary;
    traceSummaryState(operation, 'recompress', 'none', 0, 0, summaryTokens);
    const recompressed = await requestSummary(
        null,
        [{ role: 'assistant', content: summary }],
        operation,
        maximumSummaryTokens,
    );
    if ((await countTokens(recompressed, operation.apiSettings.model)) > maximumSummaryTokens) {
        throw new ContextBudgetError('The model returned a rolling summary above its token limit.');
    }
    return recompressed;
}

async function largestFittingPrefix(
    previousSummary: string | null,
    message: { role: string; content: string },
    operation: SummaryOperation,
    maximumSummaryTokens = DEFAULT_SUMMARY_TOKENS,
): Promise<number> {
    const boundaries = unicodeCodePointBoundaries(message.content);
    let low = 0;
    let high = boundaries.length - 1;
    while (low < high) {
        const mid = Math.ceil((low + high) / 2);
        const fits = await summaryRequestFits(previousSummary, [{
            ...message,
            content: message.content.slice(0, boundaries[mid]),
        }], operation.requestParameterConfig, maximumSummaryTokens, operation.contextLimit, operation.apiSettings.model);
        if (fits) low = mid;
        else high = mid - 1;
    }
    return boundaries[low];
}

async function generateRollingSummary(
    previousSummary: string | null,
    messages: { role: string; content: string }[],
    operation: SummaryOperation,
    maximumSummaryTokens = DEFAULT_SUMMARY_TOKENS,
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
                operation.apiSettings.model,
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
        assertOperationCurrent(operation);

        let history = allMessages;
        if (beforeMessageId) {
            const boundary = allMessages.findIndex((message) => message.id === beforeMessageId);
            if (boundary < 0) throw new Error('The message selected for retry no longer exists.');
            history = allMessages.slice(0, boundary);
        }

        const hardLimit = resolvedHardContextLimit(options.apiSettings);
        const workingTarget = resolvedWorkingContextTarget(options.apiSettings);
        if (!appState.longTermMemory) {
            const selected = await selectNewestRawHistory(
                options,
                history,
                requestParameterConfig,
                workingTarget,
            );
            traceBudget(operation.diagnosticId, options, selected.messages, { currentSummary: null, lastSummarizedMessageId: null }, selected.measurement, 'memory_disabled', operation.contextLimit, false, Boolean(beforeMessageId));
            if (selected.measurement.total > hardLimit) {
                throw new ContextBudgetError(
                    `The fixed prompt, World Info, newest message, and output reserve need ` +
                    `${selected.measurement.total} tokens, but the hard context limit is ${hardLimit}.`,
                );
            }
            return {
                recentMessages: selected.messages,
                summaryMeta: { currentSummary: null, lastSummarizedMessageId: null },
                requestParameterConfig,
            };
        }

        let meta = persistedMeta;
        let marker = resolveSummaryMarker(allMessages, meta);
        const boundaryExcludesMarker = Boolean(beforeMessageId) && marker.markerIndex >= history.length;
        if (marker.mustReset || boundaryExcludesMarker) {
            traceSummaryState(operation, 'marker_reset', marker.mustReset ? 'marker_invalid' : 'retry_boundary', history.length);
            const invalidMeta = meta;
            meta = { currentSummary: null, lastSummarizedMessageId: null };
            await persistSummaryCorrection(operation, invalidMeta, meta);
        }
        marker = resolveSummaryMarker(history, meta);

        const clean = (message: Message) => ({
            role: message.role,
            content: message.role === 'assistant'
                ? stripThinkingContent(message.content)
                : message.content,
        });
        // Keep chat capacity independent. Pressure on the summary model only
        // advances the rolling marker; large imports/pastes still use chunking.
        const summaryTailFits = (summaryMeta: SummaryMarkerState, trace = false) => summaryRequestFits(
            summaryMeta.currentSummary,
            history.slice(resolveSummaryMarker(history, summaryMeta).startIndex, -1).map(clean),
            operation.requestParameterConfig,
            operation.maximumSummaryTokens,
            operation.contextLimit,
            operation.apiSettings.model,
            trace ? { operation: operation.diagnosticId, connection: diagnosticConnection(operation.apiSettings), stage: 'pressure' } : undefined,
        );
        const summaryPressure = history.length - marker.startIndex > 1 && !(await summaryTailFits(meta, true));

        const initialFit = await measureNormalRequest(
            options,
            history,
            meta,
            requestParameterConfig,
            chatId,
        );
        assertOperationCurrent(operation);
        traceBudget(operation.diagnosticId, options, history, meta, initialFit, 'decision', operation.contextLimit, summaryPressure, Boolean(beforeMessageId));
        if (!shouldTriggerSummary(initialFit.total, workingTarget) && !summaryPressure) {
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
        traceBudget(operation.diagnosticId, options, history, irreducibleMeta, irreducibleFit, 'irreducible', operation.contextLimit);
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
        let workingMeta = meta;
        if (meta.currentSummary) {
            const restoredSummaryTokens = await countTokens(meta.currentSummary, operation.apiSettings.model);
            assertOperationCurrent(operation);
            if (shouldRecompressExistingSummary(restoredSummaryTokens, operation.maximumSummaryTokens)) {
                traceSummaryState(operation, 'recompress', 'none', 0, 0, restoredSummaryTokens);
                const recompressed = await generateRollingSummary(
                    null,
                    [{ role: 'assistant', content: meta.currentSummary }],
                    operation,
                    operation.maximumSummaryTokens,
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
                if (recompressedFit.total <= workingTarget && await summaryTailFits(workingMeta)) {
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
        const goal = summaryCompressionGoal(workingTarget);
        const userStarts = newMessages
            .map((message, index) => message.role === 'user' ? index : -1)
            .filter(index => index >= 0);
        const preferredTailStart = userStarts.at(-2) ?? Math.max(1, newMessages.length - 1);
        let compressionCount = 0;
        for (let count = 1; count < newMessages.length; count += 1) {
            const markerId = newMessages[count - 1]?.id?.toString();
            if (!markerId) continue;
            const projectedMeta = { currentSummary: workingMeta.currentSummary ?? 'summary', lastSummarizedMessageId: markerId };
            const projected = await measureNormalRequest(
                options,
                history,
                projectedMeta,
                requestParameterConfig,
            );
            compressionCount = count;
            if ((projected.total <= goal || (count === preferredTailStart && projected.total <= workingTarget))
                && await summaryTailFits(projectedMeta)) break;
        }
        const middle = newMessages.slice(0, compressionCount);
        const tail = newMessages.slice(compressionCount);
        traceSummaryState(operation, 'compression_plan', 'none', middle.length, tail.length);
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
                    operation.maximumSummaryTokens,
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
            operation.maximumSummaryTokens,
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

        while (tail.length > 1 && (finalFit.total > goal || !(await summaryTailFits(candidateMeta)))) {
            const next = tail.shift()!;
            newSummary = await generateRollingSummary(newSummary, [clean(next)], operation, operation.maximumSummaryTokens);
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

        traceBudget(operation.diagnosticId, options, history, candidateMeta, finalFit, 'after_compression', operation.contextLimit);
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

async function fallbackAfterSummaryFailure(
    operation: SummaryOperation,
    options: GenerationOptions,
    beforeMessageId?: string,
): Promise<PreparedGenerationContext | null> {
    assertOperationCurrent(operation);
    const [allMessages, persistedMeta, requestParameterConfig] = await Promise.all([
        loadPersistedMessages(operation.chatId),
        loadPersistedSummary(operation.chatId),
        loadRequestParameterConfig(options),
    ]);
    let history = allMessages;
    if (beforeMessageId) {
        const boundary = allMessages.findIndex(message => message.id === beforeMessageId);
        if (boundary < 0) return null;
        history = allMessages.slice(0, boundary);
    }
    const resolution = resolveSummaryMarker(history, persistedMeta);
    const meta = resolution.mustReset
        ? { currentSummary: null, lastSummarizedMessageId: null }
        : persistedMeta;
    const measurement = await measureNormalRequest(options, history, meta, requestParameterConfig);
    assertOperationCurrent(operation);
    traceBudget(operation.diagnosticId, options, history, meta, measurement, 'fallback', operation.contextLimit);
    traceSummaryState(operation, measurement.fits ? 'fallback_accepted' : 'fallback_rejected');
    if (!measurement.fits) return null;
    return { recentMessages: history, summaryMeta: meta, requestParameterConfig };
}

/** Prepares complete persisted solo-chat context and rolls its summary forward if needed. */
export function checkAndSummarizeIfNeeded(
    chatId: string,
    options: GenerationOptions,
    beforeMessageId?: string,
): Promise<PreparedGenerationContext> {
    const selectionFingerprint = summarySelectionFingerprint();
    const workKey = JSON.stringify([summaryWorkKey(chatId, beforeMessageId), selectionFingerprint, options.apiSettings]);
    const existing = summaryWorkByBoundary.get(workKey);
    if (existing) { options.diagnosticOperation = existing.diagnosticId; return existing; }

    const summaryConnection = snapshotSummaryApiConnection(options.apiSettings);
    const maximumSummaryTokens = adaptiveSummaryOutputCap(options.apiSettings.contextStrategy);
    const operation: SummaryOperation = {
        diagnosticId: diagnosticOperation(),
        chatId,
        generationId: null,
        cancelled: false,
        requestParameterConfig: summaryRequestPolicy(maximumSummaryTokens),
        contextLimit: summaryConnection.contextLimit,
        apiSettings: summaryConnection,
        maximumSummaryTokens,
        selectionFingerprint,
        revision: currentConversationRevision(chatId),
    };
    options.diagnosticOperation = operation.diagnosticId;
    pendingSummaryOperations.add(operation);
    traceSummaryState(operation, 'started');

    const work = summarySerial
        .catch(() => undefined)
        .then(async () => {
            try {
                await Promise.all([
                    ensureContextDetection(options.apiSettings),
                    ...(appState.longTermMemory && summaryConnection.id !== options.apiSettings.id
                        ? [ensureContextDetection(summaryConnection)] : []),
                ]);
                if (summaryConnection.id === options.apiSettings.id) {
                    operation.apiSettings = options.apiSettings;
                }
                operation.contextLimit = resolvedHardContextLimit(operation.apiSettings);
                if (appState.longTermMemory) {
                    const overhead = await countMessagesTokens([{ role: 'user', content:
                        buildSummaryPrompt('x', [], maximumSummaryTokens) }], operation.apiSettings.model)
                        + await countAdditionalParameterTokens(operation.requestParameterConfig, operation.apiSettings.model);
                    operation.maximumSummaryTokens = boundedSummaryOutputCap(maximumSummaryTokens, operation.contextLimit, overhead);
                    if (operation.maximumSummaryTokens < 1) throw new ContextBudgetError('The summary instructions exceed the summary model context limit.');
                    operation.requestParameterConfig = summaryRequestPolicy(operation.maximumSummaryTokens);
                }
                const prepared = await performSummaryCheck(operation, options, beforeMessageId);
                traceSummaryState(operation, 'ready');
                return prepared;
            } catch (error) {
                traceSummaryState(operation, error instanceof SummaryCancelledError || operation.cancelled ? 'cancelled' : 'failed',
                    error instanceof ContextBudgetError ? 'budget' : error instanceof SummaryCancelledError ? 'none' : 'request_failed');
                if (error instanceof SummaryCancelledError || operation.cancelled || !appState.longTermMemory) throw error;
                const fallback = await fallbackAfterSummaryFailure(operation, options, beforeMessageId);
                if (fallback) return fallback;
                throw new ContextBudgetError(
                    `Context compression failed and the raw request cannot fit within the chat model's hard context limit. ` +
                    `Retry the generation. ${error instanceof Error ? error.message : String(error)}`,
                );
            }
        })
        .finally(() => {
            pendingSummaryOperations.delete(operation);
            if (summaryWorkByBoundary.get(workKey) === work) {
                summaryWorkByBoundary.delete(workKey);
            }
        });
    summaryWorkByBoundary.set(workKey, Object.assign(work, { diagnosticId: operation.diagnosticId }));
    summarySerial = work.then(() => undefined, () => undefined);
    return work;
}

/** Final provider-bound guard; rebuilds the prompt so dynamic World Info is re-evaluated. */
export async function assertPreparedGenerationFits(options: GenerationOptions): Promise<void> {
    const requestParameterConfig = options.requestParameterConfig
        ?? await loadRequestParameterConfig(options);
    const measurement = await measureNormalRequest(
        options,
        options.recentMessages,
        options.summaryMeta ?? { currentSummary: null, lastSummarizedMessageId: null },
        requestParameterConfig,
        chatState.activeChatId ?? undefined,
    );
    options.diagnosticOperation ??= diagnosticOperation();
    options.diagnosticLocalInput = measurement.diagnostic.local_tokens;
    options.diagnosticReserve = measurement.diagnostic.reserve_tokens;
    traceBudget(options.diagnosticOperation, options, options.recentMessages, options.summaryMeta ?? { currentSummary: null, lastSummarizedMessageId: null }, measurement, 'final_guard');
    if (!measurement.fits) {
        throw new ContextBudgetError(
            `The final prompt changed after context preparation and now needs ${measurement.total} tokens, ` +
            `but the hard context limit is ${measurement.limit}.`,
        );
    }
}
