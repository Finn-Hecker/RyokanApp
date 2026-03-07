<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { getLocale } from "$lib/paraglide/runtime";
  import LanguageSelect from "$lib/components/ui/LanguageSelect.svelte";
  import * as m from "$lib/paraglide/messages";
  import { fade } from "svelte/transition";

  export let powerUser: boolean = false;
  export let behaviorOnly: boolean = false;
  export let languageOnly: boolean = false;

  const uiLanguages = [
    { code: "de", label: "Deutsch" },
    { code: "en", label: "English" },
  ];

  const aiLanguages = [
    { code: "German",  label: "Deutsch" },
    { code: "English", label: "English" },
  ];

  $: TEMPERATURES = [
    { label: m.settings_temp_precise(), value: 0.4, hint: m.settings_temp_hint_precise() },
    { label: m.settings_temp_balanced(), value: 0.8, hint: m.settings_temp_hint_balanced() },
    { label: m.settings_temp_creative(), value: 1.0, hint: m.settings_temp_hint_creative() },
  ];

  $: MAX_TOKENS_PRESETS = [
    { label: m.settings_tokens_preset_chat(),   value: 150,  hint: m.settings_tokens_preset_chat_hint() },
    { label: m.settings_tokens_preset_paragraph(), value: 300,  hint: m.settings_tokens_preset_paragraph_hint() },
    { label: m.settings_tokens_preset_novel(),  value: 800,  hint: m.settings_tokens_preset_novel_hint() },
  ];

  $: PENALTY_PRESETS = [
    { label: m.settings_penalty_preset_tolerant(), value: 1.0,  hint: m.settings_penalty_preset_tolerant_hint() },
    { label: m.settings_penalty_preset_normal(),   value: 1.12, hint: m.settings_penalty_preset_normal_hint() },
    { label: m.settings_penalty_preset_strict(),   value: 1.25, hint: m.settings_penalty_preset_strict_hint() },
  ];

  function closestPreset(presets: {value: number}[], current: number): number | null {
    const match = presets.find(p => Math.abs(p.value - current) < 0.001);
    return match ? match.value : null;
  }

  function handleUiLanguageChange(code: string) {
    appState.pendingUiLocale = code;
  }

  function handleAiLanguageChange(code: string) {
    appState.apiSettings.aiLanguage = code;
  }

  function clampTokens(v: number) {
    return Math.max(50, Math.min(4000, Math.round(v)));
  }
  function clampPenalty(v: number) {
    return Math.max(0.8, Math.min(2.0, Math.round(v * 100) / 100));
  }
</script>

{#if behaviorOnly}
<section>
  <span class="settings-section-title">{m.settings_section_ai_behavior()}</span>
  <div class="settings-card space-y-4">

    <div>
      <div class="flex items-center justify-between mb-2">
        <span class="settings-label" style="margin-bottom:0">{m.settings_creativity_label()}</span>
        {#if powerUser}
          <span class="power-value">{appState.apiSettings.temperature?.toFixed(2) ?? "0.80"}</span>
        {/if}
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 50 }} out:fade={{ duration: 0 }}>
          <input
            type="range" min="0" max="2" step="0.01"
            bind:value={appState.apiSettings.temperature}
            class="power-slider"
            aria-label={m.settings_creativity_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_precise()}</span><span>{m.settings_slider_creative()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 50 }} out:fade={{ duration: 0 }}>
          {#each TEMPERATURES as temp}
            <button
              on:click={() => (appState.apiSettings.temperature = temp.value)}
              class="preset-btn {appState.apiSettings.temperature === temp.value ? 'preset-btn--active' : ''}"
            >
              <span class="preset-label">{temp.label}</span>
              <span class="preset-hint">{temp.hint}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="settings-divider"></div>

    <div>
      <div class="flex items-center justify-between mb-2">
        <span class="settings-label" style="margin-bottom:0">{m.settings_tokens_label()}</span>
        {#if powerUser}
          <span class="power-value">{appState.apiSettings.maxTokens ?? 300} Tokens</span>
        {/if}
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 50 }} out:fade={{ duration: 0 }}>
          <input
            type="range" min="50" max="4000" step="10"
            value={appState.apiSettings.maxTokens ?? 300}
            on:input={(e) => { appState.apiSettings.maxTokens = clampTokens(+e.currentTarget.value); }}
            class="power-slider"
            aria-label={m.settings_tokens_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_short()}</span><span>{m.settings_slider_long()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 50 }} out:fade={{ duration: 0 }}>
          {#each MAX_TOKENS_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.maxTokens = preset.value)}
              class="preset-btn {closestPreset(MAX_TOKENS_PRESETS, appState.apiSettings.maxTokens ?? 300) === preset.value ? 'preset-btn--active' : ''}"
            >
              <span class="preset-label">{preset.label}</span>
              <span class="preset-hint">{preset.hint}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="settings-divider"></div>

    <div>
      <div class="flex items-center justify-between mb-2">
        <span class="settings-label" style="margin-bottom:0">{m.settings_penalty_label()}</span>
        {#if powerUser}
          <span class="power-value">{(appState.apiSettings.presencePenalty ?? 1.12).toFixed(2)}</span>
        {/if}
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 50 }} out:fade={{ duration: 0 }}>
          <input
            type="range" min="0.8" max="2.0" step="0.01"
            value={appState.apiSettings.presencePenalty ?? 1.12}
            on:input={(e) => { appState.apiSettings.presencePenalty = clampPenalty(+e.currentTarget.value); }}
            class="power-slider"
            aria-label={m.settings_penalty_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_tolerant()}</span><span>{m.settings_slider_strict()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 50 }} out:fade={{ duration: 0 }}>
          {#each PENALTY_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.presencePenalty = preset.value)}
              class="preset-btn {closestPreset(PENALTY_PRESETS, appState.apiSettings.presencePenalty ?? 1.12) === preset.value ? 'preset-btn--active' : ''}"
            >
              <span class="preset-label">{preset.label}</span>
              <span class="preset-hint">{preset.hint}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

    <div class="settings-divider"></div>

    <div
      role="switch"
      aria-checked={appState.apiSettings.isThinkingModel}
      tabindex="0"
      on:click={() => (appState.apiSettings.isThinkingModel = !appState.apiSettings.isThinkingModel)}
      on:keydown={(e) => (e.key === " " || e.key === "Enter") && (appState.apiSettings.isThinkingModel = !appState.apiSettings.isThinkingModel)}
      class="flex items-center justify-between gap-4 cursor-pointer group select-none"
    >
      <div class="flex flex-col gap-0.5">
        <span class="text-sm text-gray-200">{m.settings_thinking_label()}</span>
        <span class="text-xs text-gray-600 leading-relaxed">{m.settings_thinking_sub()}</span>
      </div>
      <div class="toggle-track" class:toggle-track--on={appState.apiSettings.isThinkingModel}>
        <div class="toggle-thumb" class:toggle-thumb--on={appState.apiSettings.isThinkingModel}></div>
      </div>
    </div>

  </div>
</section>
{/if}

{#if languageOnly}
<section>
  <span class="settings-section-title">{m.settings_section_language()}</span>
  <div class="settings-card space-y-4">

    <div>
      <label for="ui-language-select" class="settings-label">{m.settings_language_label()}</label>
      <LanguageSelect
        id="ui-language-select"
        items={uiLanguages}
        selectedCode={appState.pendingUiLocale || getLocale()}
        onSelect={(code) => handleUiLanguageChange(code)}
      />
    </div>

    <div class="settings-divider"></div>

    <div>
      <label for="ai-language-select" class="settings-label">{m.settings_ai_lang_label()}</label>
      <LanguageSelect
        id="ai-language-select"
        items={aiLanguages}
        selectedCode={appState.apiSettings.aiLanguage}
        onSelect={(code) => handleAiLanguageChange(code)}
      />
    </div>

  </div>
</section>
{/if}


<style>
  .preset-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    padding: 10px 6px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    color: #6b6b6e;
    transition: all 0.15s ease;
    cursor: pointer;
  }
  .preset-btn:hover {
    border-color: rgba(255,255,255,0.12);
    color: #d1d1d6;
    background: rgba(255,255,255,0.04);
  }
  .preset-btn:active { transform: scale(0.97); }
  .preset-btn--active {
    background: rgba(255,255,255,0.07);
    border-color: rgba(212,180,131,0.4);
    color: #d4b483;
  }
  .preset-label {
    font-size: 13px;
    font-weight: 600;
  }
  .preset-hint {
    font-size: 9px;
    opacity: 0.5;
    text-align: center;
    line-height: 1.3;
  }
  .preset-btn--active .preset-hint { opacity: 0.65; }

  .power-value {
    font-size: 11px;
    font-weight: 700;
    color: #d4b483;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
  }

  .power-slider {
    width: 100%;
    appearance: none;
    height: 4px;
    border-radius: 4px;
    background: rgba(255,255,255,0.1);
    outline: none;
    cursor: pointer;
    display: block;
    margin-top: 4px;
  }
  .power-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #d4b483;
    border: 2px solid rgba(0,0,0,0.4);
    cursor: pointer;
    transition: transform 0.1s;
  }
  .power-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
  .power-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #d4b483;
    border: 2px solid rgba(0,0,0,0.4);
    cursor: pointer;
  }
  .slider-bounds {
    display: flex;
    justify-content: space-between;
    margin-top: 5px;
    font-size: 9px;
    color: #3a3a3c;
    letter-spacing: 0.04em;
  }

  .toggle-track {
    position: relative;
    flex-shrink: 0;
    width: 44px;
    height: 24px;
    border-radius: 9999px;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.08);
    transition: background 0.2s, border-color 0.2s;
  }
  .toggle-track--on {
    background: rgba(212,180,131,0.2);
    border-color: rgba(212,180,131,0.4);
  }
  .toggle-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #5a5a5e;
    transition: transform 0.2s, background 0.2s;
  }
  .toggle-thumb--on {
    transform: translateX(20px);
    background: #d4b483;
  }
</style>