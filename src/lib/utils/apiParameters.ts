import type { ApiConnection } from "../stores/appState.svelte";
import type { ApiRequestParameterConfig } from "./rollingSummaryCore";
import { validateAdditionalApiParameters } from "./additionalApiParameters.ts";

export type ApiParameterKey =
  | "temperature"
  | "maxTokens"
  | "presencePenalty"
  | "thinkingBudget"
  | "topP"
  | "topK"
  | "minP"
  | "frequencyPenalty";

export function createDefaultApiParameterEnabled(): Record<ApiParameterKey, boolean> {
  return {
    temperature: false,
    maxTokens: false,
    presencePenalty: false,
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
  return {
    temperatureEnabled: enabled.temperature, maxTokensEnabled: enabled.maxTokens,
    presencePenaltyEnabled: enabled.presencePenalty, thinkingBudgetEnabled: enabled.thinkingBudget,
    topPEnabled: enabled.topP, topKEnabled: enabled.topK, minPEnabled: enabled.minP,
    frequencyPenaltyEnabled: enabled.frequencyPenalty,
    maxTokens: connection.maxTokens, thinkingBudget: connection.thinkingBudget,
    additionalParameters,
  };
}
