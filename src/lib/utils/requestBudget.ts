import { contextSafetyMargin, deriveEffectiveTokenBudget, fitsContextBudget, type ApiRequestParameterConfig } from './rollingSummaryCore.ts';

export type RequestMessage = { role: string; content: string };
export type TokenCounter = (text: string) => Promise<number>;

/** Shared planning estimate, including framing and non-message custom fields. */
export async function countRequestMessages(messages: RequestMessage[], count: TokenCounter): Promise<number> {
  if (messages.length === 0) return 3;
  return await count(messages.map(message => `${message.role}\n${message.content}`).join('\n'))
    + messages.length * 4 + 3;
}

export async function countRequestAdditional(config: ApiRequestParameterConfig, count: TokenCounter): Promise<number> {
  return Object.keys(config.additionalParameters).length ? count(JSON.stringify(config.additionalParameters)) : 0;
}

export async function measureRequestBudget(messages: RequestMessage[], config: ApiRequestParameterConfig,
  hardLimit: number, count: TokenCounter) {
  const [messageTokens, additionalTokens] = await Promise.all([
    countRequestMessages(messages, count), countRequestAdditional(config, count),
  ]);
  const inputTokens = messageTokens + additionalTokens;
  const reserve = deriveEffectiveTokenBudget(config).reserveTokens + contextSafetyMargin(hardLimit);
  return { inputTokens, reserve, fits: fitsContextBudget(inputTokens, reserve, hardLimit) };
}
