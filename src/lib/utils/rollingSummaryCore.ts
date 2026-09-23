export interface SummaryMarkerState {
  currentSummary: string | null;
  lastSummarizedMessageId: string | null;
}

export interface PromptAnchorMessage {
  role: string;
  content: string;
}

export interface PromptUsageAnchor {
  /** The persisted request history, including ids and active swipe indices. */
  historyFingerprint: string[];
  summaryFingerprint: string;
  configurationFingerprint: string;
  prompt: PromptAnchorMessage[];
  responseSwipeIndex: number;
  responseFingerprint: string;
  revision: number;
}

/** Only an append to the exact anchored conversation may reuse provider usage. */
export function canReusePromptAnchor(
  anchor: PromptUsageAnchor,
  historyFingerprint: string[],
  summaryFingerprint: string,
  configurationFingerprint: string,
  revision: number,
): boolean {
  return anchor.summaryFingerprint === summaryFingerprint
    && anchor.configurationFingerprint === configurationFingerprint
    && anchor.revision === revision
    && historyFingerprint.length > anchor.historyFingerprint.length
    && anchor.historyFingerprint.every((value, index) => historyFingerprint[index] === value)
    && historyFingerprint[anchor.historyFingerprint.length] === anchor.responseFingerprint;
}

const conversationRevisions = new Map<string, number>();

export function currentConversationRevision(chatId: string): number {
  return conversationRevisions.get(chatId) ?? 0;
}

export function bumpConversationRevision(chatId: string): void {
  conversationRevisions.set(chatId, currentConversationRevision(chatId) + 1);
}

/** Provider input is the base; only the changed prompt suffix is estimated. */
export async function reconcilePromptTokens(
  inputTokens: number | null | undefined,
  previous: PromptAnchorMessage[],
  next: PromptAnchorMessage[],
  countTail: (messages: PromptAnchorMessage[]) => Promise<number>,
): Promise<number | null> {
  if (!Number.isSafeInteger(inputTokens) || inputTokens! < 0) return null;
  let common = 0;
  while (common < previous.length && common < next.length
    && previous[common].role === next[common].role
    && previous[common].content === next[common].content) common += 1;
  if (common === 0) return null;
  const [oldTail, newTail] = await Promise.all([
    countTail(previous.slice(common)),
    countTail(next.slice(common)),
  ]);
  return Math.max(0, inputTokens! + newTail - oldTail);
}

export interface ApiRequestParameterConfig {
  readonly temperatureEnabled?: boolean;
  readonly maxTokensEnabled: boolean;
  readonly presencePenaltyEnabled?: boolean;
  readonly thinkingBudgetEnabled: boolean;
  readonly topPEnabled?: boolean;
  readonly topKEnabled?: boolean;
  readonly minPEnabled?: boolean;
  readonly frequencyPenaltyEnabled?: boolean;
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

/** Allow proportional tokenizer/template mismatch, including unanchored chat requests. */
export function contextSafetyMargin(contextLimit: number): number {
  return Math.max(TOKEN_ESTIMATION_MARGIN, Math.ceil(contextLimit * 0.02));
}

export const summarySafetyMargin = contextSafetyMargin;

/** Leave room for the previous summary, output, and new events even on small models. */
export function boundedSummaryOutputCap(desired: number, contextLimit: number, promptOverhead: number): number {
  return Math.max(0, Math.min(desired,
    Math.floor((contextLimit - summarySafetyMargin(contextLimit) - promptOverhead) / 3)));
}

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

export interface TokenizedConversationMessage extends IdentifiedMessage {
  role: string;
  tokens: number;
}

/** Returns the earliest suffix boundary that fits, preferring complete user-led turns. */
export function selectRecentTurnSuffix<T extends TokenizedConversationMessage>(
  messages: T[],
  tokenBudget: number,
  minimumTurns = 2,
): { retained: T[]; retainedTokens: number } {
  if (messages.length === 0 || tokenBudget <= 0) return { retained: [], retainedTokens: 0 };
  let start = messages.length;
  let used = 0;
  while (start > 0 && used + messages[start - 1].tokens <= tokenBudget) {
    start -= 1;
    used += messages[start].tokens;
  }

  // If the suffix starts with an assistant response, include its user message
  // when affordable so ordinary conversational turns are not split.
  if (start > 0 && messages[start]?.role === 'assistant'
    && messages[start - 1]?.role === 'user'
    && used + messages[start - 1].tokens <= tokenBudget) {
    start -= 1;
    used += messages[start].tokens;
  }

  const userStarts = messages
    .map((message, index) => message.role === 'user' ? index : -1)
    .filter(index => index >= 0);
  const preferredStart = userStarts.at(-minimumTurns);
  if (preferredStart !== undefined) {
    const preferredTokens = messages.slice(preferredStart).reduce((sum, message) => sum + message.tokens, 0);
    if (preferredTokens <= tokenBudget) {
      start = Math.min(start, preferredStart);
      used = messages.slice(start).reduce((sum, message) => sum + message.tokens, 0);
    }
  }
  return { retained: messages.slice(start), retainedTokens: used };
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
