import type { ApiRequestParameterConfig, EffectiveTokenBudget } from '../summary/rollingSummaryCore';

// Native contracts only. Existing providers never enter this policy.
// Anthropic Messages: max_tokens includes thinking; manual budgets must be >=1024.
// Gemini generateContent: maxOutputTokens caps thoughts + candidate output;
// thinkingBudget=-1 is dynamic, and thinkingLevel is not a token count.
// Sources: platform.claude.com/docs/en/api/messages/create;
// ai.google.dev/api/generate-content; ai.google.dev/gemini-api/docs/generate-content/thinking.
export type NativeBudgetProvider = 'anthropic' | 'gemini';
export const ANTHROPIC_DEFAULT_OUTPUT_CAP = 4096;
// Ryokan sets this explicit cap when Gemini's output switch is off. This is an
// application policy, not a guessed provider/model default.
export const GEMINI_DEFAULT_OUTPUT_CAP = 8192;

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function count(value: unknown, minimum = 0): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= minimum ? value : null;
}

export function nativeTokenBudget(config: ApiRequestParameterConfig): EffectiveTokenBudget | null {
  const provider = config.budgetProvider;
  if (provider !== 'anthropic' && provider !== 'gemini') return null;
  const additional = config.additionalParameters ?? {};
  const generation = object(additional.generationConfig);
  const thinking = provider === 'anthropic' ? object(additional.thinking) : object(generation?.thinkingConfig);
  const manual = config.thinkingBudgetEnabled ? config.thinkingBudget : 0;
  // The UI's output setting is the TOTAL native cap, never visible output plus thinking.
  const payloadMaxTokens = config.maxTokens;
  let total: unknown = config.maxTokensEnabled ? payloadMaxTokens
    : provider === 'anthropic' ? ANTHROPIC_DEFAULT_OUTPUT_CAP : GEMINI_DEFAULT_OUTPUT_CAP;
  if (provider === 'anthropic' && Object.hasOwn(additional, 'max_tokens')) total = additional.max_tokens;
  if (provider === 'gemini' && generation && Object.hasOwn(generation, 'maxOutputTokens')) total = generation.maxOutputTokens;
  let thinkingValue: unknown = config.thinkingBudgetEnabled ? manual : undefined;
  if (provider === 'anthropic' && thinking) thinkingValue = thinking.type === 'enabled' ? thinking.budget_tokens : undefined;
  if (provider === 'gemini' && thinking) thinkingValue = thinking.thinkingBudget;
  const dynamic = provider === 'gemini' && thinkingValue === -1;
  const reasoningLimit = dynamic ? null : count(thinkingValue);
  const knownTotal = count(total, 1);
  const invalidTotal = total !== undefined && knownTotal === null;
  const invalidThinking = thinkingValue !== undefined && !dynamic && (reasoningLimit === null
    || provider === 'anthropic' && (reasoningLimit < 1024 || knownTotal !== null && reasoningLimit >= knownTotal));
  const reasoningEnabled = provider === 'anthropic'
    ? thinking ? thinking.type !== 'disabled' : config.thinkingBudgetEnabled || config.reasoningLevel !== 'none'
    : thinkingValue !== 0; // Gemini defaults can think even without an explicit setting.
  return {
    payloadMaxTokens, payloadThinkingBudget: manual,
    reserveTokens: knownTotal ?? (512 + (reasoningEnabled ? Math.max(reasoningLimit ?? 512, 512) : 0)),
    hasKnownTotalLimit: knownTotal !== null && !invalidTotal,
    calculation: { total_limit: knownTotal, reasoning_limit: reasoningLimit,
      invalid_total_limit: invalidTotal, invalid_reasoning_limit: invalidThinking,
      reasoning_enabled: reasoningEnabled, reasoning_ambiguous: reasoningEnabled && thinkingValue === undefined },
  };
}
