import type { ApiConnection } from "../../stores/appState.svelte";
import type { ApiRequestParameterConfig } from "../summary/rollingSummaryCore";
import { validateAdditionalApiParameters } from "./additionalApiParameters.ts";
import { normalizeServiceTier, reasoningCapability, supportedServiceTiers, type ReasoningLevel } from './generationCapabilities.ts';

export type ApiParameterKey =
  | "temperature"
  | "maxTokens"
  | "repetitionPenalty"
  | "thinkingBudget"
  | "topP"
  | "topK"
  | "minP"
  | "frequencyPenalty";

export function createDefaultApiParameterEnabled(): Record<ApiParameterKey, boolean> {
  return {
    temperature: false,
    maxTokens: false,
    repetitionPenalty: false,
    thinkingBudget: false,
    topP: false,
    topK: false,
    minP: false,
    frequencyPenalty: false,
  };
}

/** Request switches and custom fields come from the selected profile snapshot. */
export function requestParameterConfig(connection: ApiConnection): ApiRequestParameterConfig {
  const validated = validateAdditionalApiParameters(connection.additionalApiParameters || '');
  const additionalParameters = validated.valid ? validated.value ?? {} : {};
  const enabled = connection.parameterEnabled;
  const capability = reasoningCapability(connection);
  const selected: ReasoningLevel = capability?.levels.includes(connection.reasoningLevel) ? connection.reasoningLevel : 'auto';
  const tier = normalizeServiceTier(connection.serviceTier);
  return {
    ...(['anthropic', 'gemini'].includes(connection.providerKind)
      ? { budgetProvider: connection.providerKind as 'anthropic' | 'gemini' } : {}),
    serviceTier: supportedServiceTiers(connection).includes(tier) ? tier : 'auto',
    temperatureEnabled: enabled.temperature, maxTokensEnabled: enabled.maxTokens,
    presencePenaltyEnabled: enabled.repetitionPenalty, thinkingBudgetEnabled: (connection.providerKind === 'llama_cpp'
      || connection.providerKind === 'anthropic' || connection.providerKind === 'gemini') && enabled.thinkingBudget,
    topPEnabled: enabled.topP, topKEnabled: enabled.topK, minPEnabled: enabled.minP,
    frequencyPenaltyEnabled: enabled.frequencyPenalty,
    maxTokens: connection.maxTokens, thinkingBudget: connection.thinkingBudget,
    reasoningDialect: capability?.dialect ?? null, reasoningLevel: selected,
    additionalParameters,
  };
}

/** The selected summary profile owns generation settings; only output caps are summary-owned. */
export function summaryParameterConfig(connection: ApiConnection, maximumSummaryTokens: number): ApiRequestParameterConfig {
  const profile = requestParameterConfig(connection);
  const additionalParameters = { ...profile.additionalParameters };
  delete additionalParameters.max_tokens;
  delete additionalParameters.max_completion_tokens;
  if (connection.providerKind === 'gemini' && additionalParameters.generationConfig
    && typeof additionalParameters.generationConfig === 'object' && !Array.isArray(additionalParameters.generationConfig)) {
    const generation = { ...additionalParameters.generationConfig as Record<string, unknown> };
    delete generation.maxOutputTokens;
    additionalParameters.generationConfig = generation;
  }
  return {
    ...profile, purpose: 'summary', maxTokensEnabled: true,
    maxTokens: maximumSummaryTokens, additionalParameters,
  };
}
