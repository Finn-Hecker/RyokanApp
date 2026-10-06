import * as m from '$lib/paraglide/messages';

export type SamplingParameter = 'temperature' | 'maxTokens' | 'repetitionPenalty' | 'topP' | 'topK' | 'minP' | 'frequencyPenalty';

/** Shared presets and input bounds; persistence belongs to the caller. */
export function parameterSettings(parameter: SamplingParameter) {
  const TEMPERATURES = [
    { label: m.settings_temp_precise(), value: 0.4, hint: m.settings_temp_hint_precise() },
    { label: m.settings_temp_balanced(), value: 0.8, hint: m.settings_temp_hint_balanced() },
    { label: m.settings_temp_creative(), value: 1.0, hint: m.settings_temp_hint_creative() },
  ];

  const MAX_TOKENS_PRESETS = [
    { label: m.settings_tokens_preset_chat(),   value: 150,  hint: m.settings_tokens_preset_chat_hint() },
    { label: m.settings_tokens_preset_paragraph(), value: 300,  hint: m.settings_tokens_preset_paragraph_hint() },
    { label: m.settings_tokens_preset_novel(),  value: 800,  hint: m.settings_tokens_preset_novel_hint() },
  ];

  const PENALTY_PRESETS = [
    { label: m.settings_penalty_preset_tolerant(), value: 1.0,  hint: m.settings_penalty_preset_tolerant_hint() },
    { label: m.settings_penalty_preset_normal(),   value: 1.12, hint: m.settings_penalty_preset_normal_hint() },
    { label: m.settings_penalty_preset_strict(),   value: 1.25, hint: m.settings_penalty_preset_strict_hint() },
  ];

  const TOP_P_PRESETS = [
    { label: m.settings_topp_preset_focused(),  value: 0.5, hint: m.settings_topp_preset_focused_hint() },
    { label: m.settings_topp_preset_balanced(), value: 0.9, hint: m.settings_topp_preset_balanced_hint() },
    { label: m.settings_topp_preset_diverse(),  value: 1.0, hint: m.settings_topp_preset_diverse_hint() },
  ];

  const TOP_K_PRESETS = [
    { label: m.settings_topk_preset_narrow(),   value: 20, hint: m.settings_topk_preset_narrow_hint() },
    { label: m.settings_topk_preset_balanced(), value: 40, hint: m.settings_topk_preset_balanced_hint() },
    { label: m.settings_topk_preset_wide(),     value: 80, hint: m.settings_topk_preset_wide_hint() },
  ];

  const MIN_P_PRESETS = [
    { label: m.settings_minp_preset_off(),  value: 0,    hint: m.settings_minp_preset_off_hint() },
    { label: m.settings_minp_preset_low(),  value: 0.05, hint: m.settings_minp_preset_low_hint() },
    { label: m.settings_minp_preset_high(), value: 0.1,  hint: m.settings_minp_preset_high_hint() },
  ];

  const FREQ_PENALTY_PRESETS = [
    { label: m.settings_freqpenalty_preset_off(),    value: 0,   hint: m.settings_freqpenalty_preset_off_hint() },
    { label: m.settings_freqpenalty_preset_light(),  value: 0.3, hint: m.settings_freqpenalty_preset_light_hint() },
    { label: m.settings_freqpenalty_preset_strong(), value: 0.6, hint: m.settings_freqpenalty_preset_strong_hint() },
  ];

  const settings = {
    temperature: { label: m.settings_creativity_label(), presets: TEMPERATURES, fallback: 0.8, min: 0, max: 2, step: 0.01, low: m.settings_slider_precise(), high: m.settings_slider_creative(), decimals: 2 },
    maxTokens: { label: m.settings_tokens_label(), presets: MAX_TOKENS_PRESETS, fallback: 300, min: 50, max: 4000, step: 10, low: m.settings_slider_short(), high: m.settings_slider_long(), decimals: 0 },
    repetitionPenalty: { label: m.settings_penalty_label(), presets: PENALTY_PRESETS, fallback: 1.12, min: 0.8, max: 2, step: 0.01, low: m.settings_slider_tolerant(), high: m.settings_slider_strict(), decimals: 2 },
    topP: { label: m.settings_topp_label(), presets: TOP_P_PRESETS, fallback: 0.9, min: 0, max: 1, step: 0.01, low: m.settings_slider_focused(), high: m.settings_slider_diverse(), decimals: 2 },
    topK: { label: m.settings_topk_label(), presets: TOP_K_PRESETS, fallback: 40, min: 0, max: 200, step: 1, low: m.settings_slider_narrow(), high: m.settings_slider_wide(), decimals: 0 },
    minP: { label: m.settings_minp_label(), presets: MIN_P_PRESETS, fallback: 0.05, min: 0, max: 0.5, step: 0.01, low: m.settings_slider_off(), high: m.settings_slider_strict(), decimals: 2 },
    frequencyPenalty: { label: m.settings_freqpenalty_label(), presets: FREQ_PENALTY_PRESETS, fallback: 0, min: 0, max: 2, step: 0.01, low: m.settings_slider_off(), high: m.settings_slider_strict(), decimals: 2 },
  };
  return settings[parameter];
}

export function clampParameter(parameter: SamplingParameter, value: number): number {
  // Temperature already comes from a bounded range input.
  if (parameter === 'temperature') return value;
  const bounds = { maxTokens: [50, 4000, 1], repetitionPenalty: [0.8, 2, 100], topP: [0, 1, 100], topK: [0, 200, 1], minP: [0, 0.5, 100], frequencyPenalty: [0, 2, 100] } as const;
  const [min, max, precision] = bounds[parameter];
  return Math.max(min, Math.min(max, Math.round(value * precision) / precision));
}

export function closestPreset(presets: { value: number }[], current: number): number | null {
  return presets.find(preset => Math.abs(preset.value - current) < 0.001)?.value ?? null;
}
