/** Provider-reported counts for one generation. Null means unavailable. */
export interface TokenUsage {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
    costUsd?: number | null;
    actualModel?: string | null;
    serviceTier?: string | null;
    /** Name captured from the immutable connection used for this request. */
    connectionName?: string | null;
}

/** Select only the displayed swipe; legacy messages must not borrow other usage. */
export function selectedUsage(message: { usage_variants?: (TokenUsage | null)[]; swipe_index: number }): TokenUsage | null {
    return message.usage_variants?.[message.swipe_index] ?? null;
}

export function withConnection(usage: TokenUsage | null, connection: { name: string }): TokenUsage {
    return { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null,
        ...usage, connectionName: connection.name };
}

export function formatUsageCount(value: number | null | undefined, locale: string): string | null {
    return Number.isSafeInteger(value) && value! >= 0 ? value!.toLocaleString(locale) : null;
}

/** Format cached tokens and, when it is a valid subset of input tokens, their share. */
export function formatCachedUsage(
    cachedValue: number | null | undefined,
    inputValue: number | null | undefined,
    locale: string,
): string | null {
    const cached = formatUsageCount(cachedValue, locale);
    if (cached === null) return null;
    const hasMeaningfulShare = Number.isSafeInteger(inputValue) && inputValue! > 0
        && Number.isSafeInteger(cachedValue) && cachedValue! >= 0 && cachedValue! <= inputValue!;
    if (!hasMeaningfulShare) return cached;
    const share = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 })
        .format(cachedValue! / inputValue!);
    return `${cached} · ${share}`;
}

export function formatUsageCost(value: number | null | undefined, locale: string): string | null {
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return null;
    return `${new Intl.NumberFormat(locale, { maximumSignificantDigits: 8 }).format(value)} USD`;
}

/** Whitelist relay metadata; never copy request credentials or arbitrary fields. */
export function parseUsage(value: unknown): TokenUsage | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    const record = value as Record<string, unknown>;
    const result: TokenUsage = { inputTokens: null, cachedInputTokens: null, outputTokens: null, reasoningTokens: null };
    for (const field of ['inputTokens', 'cachedInputTokens', 'outputTokens', 'reasoningTokens'] as const) {
        const count = record[field];
        if (typeof count === 'number' && Number.isSafeInteger(count) && count >= 0) result[field] = count;
    }
    if (typeof record.costUsd === 'number' && Number.isFinite(record.costUsd) && record.costUsd >= 0) result.costUsd = record.costUsd;
    for (const field of ['actualModel', 'serviceTier', 'connectionName'] as const) {
        if (typeof record[field] === 'string' && record[field].trim()) result[field] = record[field];
    }
    return Object.values(result).some(value => value != null) ? result : null;
}

export function persistedUsage(variants: unknown, index = 0): TokenUsage | null {
    try {
        const values = typeof variants === 'string' ? JSON.parse(variants) : variants;
        return Array.isArray(values) ? parseUsage(values[index]) : null;
    } catch { return null; }
}
