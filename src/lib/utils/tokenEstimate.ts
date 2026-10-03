const encoder = new TextEncoder();

/** Approximate text tokens, independent of provider and model. Never actual usage. */
export function estimateTokens(text: string | null | undefined): number {
  if (!text) return 0;
  // Long digit sequences commonly split into groups of three. Treat them
  // separately so a byte-only estimate does not undercount numeric content.
  let tokens = 0;
  for (const part of text.match(/\d+|\D+/g) ?? []) {
    tokens += /^\d/.test(part)
      ? Math.ceil(part.length / 3)
      : encoder.encode(part).byteLength / 3.35;
  }
  return Math.ceil(tokens);
}

/** Planning allowance for model/language mismatch; not a guaranteed upper bound.
 * Request framing and output reserves are added by requestBudget separately.
 */
export function estimateBudgetTokens(text: string | null | undefined): number {
  return Math.ceil(estimateTokens(text) * 1.25);
}
