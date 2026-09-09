import type { SettingRow } from "$lib/utils/settings";

export type ApiParameterKey =
  | "temperature"
  | "maxTokens"
  | "presencePenalty"
  | "thinkingBudget"
  | "topP"
  | "topK"
  | "minP"
  | "frequencyPenalty";

export const API_PARAMETER_SETTING_KEYS: Record<ApiParameterKey, string> = {
  temperature: "api_temperature_enabled",
  maxTokens: "api_max_tokens_enabled",
  presencePenalty: "api_presence_penalty_enabled",
  thinkingBudget: "api_thinking_budget_enabled",
  topP: "api_top_p_enabled",
  topK: "api_top_k_enabled",
  minP: "api_min_p_enabled",
  frequencyPenalty: "api_frequency_penalty_enabled",
};

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

export function readApiParameterEnabled(
  settings: SettingRow[],
): Record<ApiParameterKey, boolean> {
  const enabled = createDefaultApiParameterEnabled();
  const values = new Map(settings.map(({ key, value }) => [key, value]));

  for (const [parameter, settingKey] of Object.entries(API_PARAMETER_SETTING_KEYS) as [
    ApiParameterKey,
    string,
  ][]) {
    enabled[parameter] = values.get(settingKey) === "true";
  }

  return enabled;
}
