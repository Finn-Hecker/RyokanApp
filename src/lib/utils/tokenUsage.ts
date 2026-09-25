/** Provider-reported counts for one generation. Null means unavailable. */
export interface TokenUsage {
    inputTokens: number | null;
    cachedInputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
}
