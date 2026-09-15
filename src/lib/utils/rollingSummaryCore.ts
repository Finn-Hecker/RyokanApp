export interface SummaryMarkerState {
  currentSummary: string | null;
  lastSummarizedMessageId: string | null;
}

export interface ApiRequestParameterConfig {
  readonly maxTokensEnabled: boolean;
  readonly thinkingBudgetEnabled: boolean;
  readonly maxTokens: number;
  readonly thinkingBudget: number;
  readonly additionalParameters: Readonly<Record<string, unknown>>;
}

export interface EffectiveTokenBudget {
  /** Value supplied to Rust; persisted switches still decide whether it is forwarded. */
  payloadMaxTokens: number;
  /** Value supplied to Rust; persisted switches still decide whether it is forwarded. */
  payloadThinkingBudget: number;
  /** Completion/reasoning tokens held out of the configured context window. */
  reserveTokens: number;
  /** True only when a valid outgoing total-completion limit was found. */
  hasKnownTotalLimit: boolean;
}

/** Provider defaults are unknowable when no total completion limit is sent. */
export const UNKNOWN_VISIBLE_OUTPUT_RESERVE = 512;
export const UNKNOWN_REASONING_RESERVE = 512;
/** Covers tokenizer mismatch and provider-specific chat-template framing. */
export const TOKEN_ESTIMATION_MARGIN = 128;

function strictTokenLimit(value: unknown): number | null {
  return typeof value === 'number'
    && Number.isSafeInteger(value)
    && value >= 0
    ? value
    : null;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

/**
 * Mirrors the Rust request merge for fields that affect the completion reserve.
 * Valid numeric limits are never inferred from strings, booleans, or null.
 */
export function deriveEffectiveTokenBudget(
  config: ApiRequestParameterConfig,
): EffectiveTokenBudget {
  const payloadThinkingBudget = config.thinkingBudgetEnabled ? config.thinkingBudget : 0;
  const payloadMaxTokens = config.maxTokens + payloadThinkingBudget;
  const additional = config.additionalParameters ?? {};

  let maxTokensField: unknown = config.maxTokensEnabled ? payloadMaxTokens : undefined;
  let thinkingBudgetField: unknown = config.thinkingBudgetEnabled
    ? payloadThinkingBudget
    : undefined;

  if (Object.hasOwn(additional, 'max_tokens')) {
    maxTokensField = additional.max_tokens;
  }
  if (Object.hasOwn(additional, 'thinking_budget_tokens')) {
    thinkingBudgetField = additional.thinking_budget_tokens;
  }

  const totalFields: unknown[] = [];
  if (maxTokensField !== undefined) totalFields.push(maxTokensField);
  if (Object.hasOwn(additional, 'max_completion_tokens')) {
    totalFields.push(additional.max_completion_tokens);
  }

  const validTotalLimits = totalFields
    .map(strictTokenLimit)
    .filter((value): value is number => value !== null);
  const hasInvalidTotalLimit = totalFields.some((value) => strictTokenLimit(value) === null);

  let chatTemplateMayEnableReasoning = true;
  const chatTemplate = objectValue(additional.chat_template_kwargs);
  if (chatTemplate?.enable_thinking === false) chatTemplateMayEnableReasoning = false;

  const reasoning = objectValue(additional.reasoning);
  const hasReasoningControl = Object.hasOwn(additional, 'reasoning');
  const reasoningControlMayEnableReasoning = reasoning
    ? reasoning.enabled !== false
    : additional.reasoning !== undefined && additional.reasoning !== false;
  const reasoningEnabled = chatTemplateMayEnableReasoning
    || reasoningControlMayEnableReasoning;
  const reasoningBehaviorAmbiguous = (
    chatTemplateMayEnableReasoning !== reasoningControlMayEnableReasoning
      && hasReasoningControl
  ) || (
    hasReasoningControl
      && reasoning === null
      && additional.reasoning !== false
  );

  const reasoningFields: unknown[] = [];
  if (thinkingBudgetField !== undefined) reasoningFields.push(thinkingBudgetField);
  if (reasoning && Object.hasOwn(reasoning, 'max_tokens')) {
    reasoningFields.push(reasoning.max_tokens);
  }
  const validReasoningLimits = reasoningFields
    .map(strictTokenLimit)
    .filter((value): value is number => value !== null);
  const hasInvalidReasoningLimit = reasoningFields.some(
    (value) => strictTokenLimit(value) === null,
  );

  const knownTotal = validTotalLimits.length > 0
    ? Math.max(...validTotalLimits)
    : null;

  if (knownTotal !== null && !hasInvalidTotalLimit) {
    // OpenAI-compatible total completion caps include visible and reasoning tokens.
    return {
      payloadMaxTokens,
      payloadThinkingBudget,
      reserveTokens: knownTotal,
      hasKnownTotalLimit: true,
    };
  }

  let reasoningReserve = 0;
  if (reasoningEnabled) {
    reasoningReserve = Math.max(
      validReasoningLimits.length > 0 ? Math.max(...validReasoningLimits) : 0,
      hasInvalidReasoningLimit
        || validReasoningLimits.length === 0
        || reasoningBehaviorAmbiguous
        ? UNKNOWN_REASONING_RESERVE
        : 0,
    );
  }
  const fallback = UNKNOWN_VISIBLE_OUTPUT_RESERVE + reasoningReserve;

  return {
    payloadMaxTokens,
    payloadThinkingBudget,
    reserveTokens: Math.max(knownTotal ?? 0, fallback),
    hasKnownTotalLimit: false,
  };
}

export function withRequestTokenValues(
  config: ApiRequestParameterConfig,
  maxTokens: number,
  thinkingBudget: number,
): ApiRequestParameterConfig {
  return { ...config, maxTokens, thinkingBudget };
}

export function unicodeCodePointBoundaries(text: string): number[] {
  const boundaries = [0];
  let codeUnitIndex = 0;
  for (const character of text) {
    codeUnitIndex += character.length;
    boundaries.push(codeUnitIndex);
  }
  return boundaries;
}

export function summaryWorkKey(chatId: string, beforeMessageId?: string): string {
  return `${chatId}\u0000${beforeMessageId ?? ''}`;
}

export function shouldRecompressExistingSummary(
  summaryTokens: number,
  maximumSummaryTokens: number,
): boolean {
  return summaryTokens > maximumSummaryTokens;
}

export function isSummaryCommitCurrent(
  operationChatId: string,
  activeChatId: string | null,
  cancelled: boolean,
): boolean {
  return !cancelled && operationChatId === activeChatId;
}

export function fitsContextBudget(
  promptTokens: number,
  reserveTokens: number,
  contextLimit: number,
): boolean {
  return promptTokens + reserveTokens <= contextLimit;
}

export async function commitOrRollback<T>(
  compareAndSwap: (expectedValue: T, nextValue: T) => Promise<boolean>,
  previousValue: T,
  candidateValue: T,
  isCurrent: () => boolean,
): Promise<'committed' | 'rolled-back' | 'conflict'> {
  if (!(await compareAndSwap(previousValue, candidateValue))) return 'conflict';
  if (isCurrent()) return 'committed';

  // A single SQLite UPDATE is atomic, but cancellation can arrive immediately
  // after it. Roll back only if the candidate is still the stored value so a
  // newer summary can never be overwritten by this stale operation.
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await compareAndSwap(candidateValue, previousValue)
        ? 'rolled-back'
        : 'conflict';
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

export interface IdentifiedMessage {
  id?: string;
}

export function resolveSummaryMarker(
  messages: IdentifiedMessage[],
  meta: SummaryMarkerState,
): { startIndex: number; markerIndex: number; mustReset: boolean } {
  const hasSummary = Boolean(meta.currentSummary);
  const hasMarker = Boolean(meta.lastSummarizedMessageId);

  if (!hasSummary && !hasMarker) {
    return { startIndex: 0, markerIndex: -1, mustReset: false };
  }

  if (!hasSummary || !hasMarker) {
    return { startIndex: 0, markerIndex: -1, mustReset: true };
  }

  const markerIndex = messages.findIndex(
    (message) => message.id === meta.lastSummarizedMessageId,
  );
  if (markerIndex < 0) {
    return { startIndex: 0, markerIndex: -1, mustReset: true };
  }

  return { startIndex: markerIndex + 1, markerIndex, mustReset: false };
}

export function selectCompressionWindow<T>(
  messages: T[],
  desiredTailCount = 4,
): { middle: T[]; tail: T[] } {
  if (messages.length <= 1) return { middle: [], tail: [...messages] };

  const tailCount = Math.min(desiredTailCount, messages.length - 1);
  return {
    middle: messages.slice(0, messages.length - tailCount),
    tail: messages.slice(-tailCount),
  };
}

export function isMessageCoveredBySummary(
  messages: IdentifiedMessage[],
  markerId: string | null,
  messageId: string,
): boolean {
  if (!markerId) return false;
  const markerIndex = messages.findIndex((message) => message.id === markerId);
  const messageIndex = messages.findIndex((message) => message.id === messageId);
  return markerIndex < 0 || (messageIndex >= 0 && messageIndex <= markerIndex);
}
