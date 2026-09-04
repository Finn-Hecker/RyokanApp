<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { getLocale } from "$lib/paraglide/runtime";
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import * as m from "$lib/paraglide/messages";
  import { fade } from "svelte/transition";

  export let powerUser: boolean = false;
  export let behaviorOnly: boolean = false;
  export let languageOnly: boolean = false;

  type ApiParameterKey =
    | "temperature"
    | "maxTokens"
    | "presencePenalty"
    | "thinkingBudget"
    | "topP"
    | "topK"
    | "minP"
    | "frequencyPenalty";

  export let parameterEnabled: Record<ApiParameterKey, boolean> = {
    temperature: true,
    maxTokens: true,
    presencePenalty: true,
    thinkingBudget: true,
    topP: true,
    topK: true,
    minP: true,
    frequencyPenalty: true,
  };

  function toggleParameter(key: ApiParameterKey) {
    parameterEnabled = {
      ...parameterEnabled,
      [key]: !parameterEnabled[key],
    };
  }

  const uiLanguages = [
    { code: "de", label: "Deutsch", country: "de" as const },
    { code: "en", label: "English", country: "gb" as const },
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

  $: THINKING_BUDGET_PRESETS = [
    { label: m.settings_thinking_budget_fast(),     value: 1000, hint: m.settings_thinking_budget_fast_hint() },
    { label: m.settings_thinking_budget_balanced(), value: 2500, hint: m.settings_thinking_budget_balanced_hint() },
    { label: m.settings_thinking_budget_deep(),     value: 5000, hint: m.settings_thinking_budget_deep_hint() },
  ];

  $: PENALTY_PRESETS = [
    { label: m.settings_penalty_preset_tolerant(), value: 1.0,  hint: m.settings_penalty_preset_tolerant_hint() },
    { label: m.settings_penalty_preset_normal(),   value: 1.12, hint: m.settings_penalty_preset_normal_hint() },
    { label: m.settings_penalty_preset_strict(),   value: 1.25, hint: m.settings_penalty_preset_strict_hint() },
  ];

  $: TOP_P_PRESETS = [
    { label: m.settings_topp_preset_focused(),  value: 0.5, hint: m.settings_topp_preset_focused_hint() },
    { label: m.settings_topp_preset_balanced(), value: 0.9, hint: m.settings_topp_preset_balanced_hint() },
    { label: m.settings_topp_preset_diverse(),  value: 1.0, hint: m.settings_topp_preset_diverse_hint() },
  ];

  $: TOP_K_PRESETS = [
    { label: m.settings_topk_preset_narrow(),   value: 20, hint: m.settings_topk_preset_narrow_hint() },
    { label: m.settings_topk_preset_balanced(), value: 40, hint: m.settings_topk_preset_balanced_hint() },
    { label: m.settings_topk_preset_wide(),     value: 80, hint: m.settings_topk_preset_wide_hint() },
  ];

  $: MIN_P_PRESETS = [
    { label: m.settings_minp_preset_off(),  value: 0,    hint: m.settings_minp_preset_off_hint() },
    { label: m.settings_minp_preset_low(),  value: 0.05, hint: m.settings_minp_preset_low_hint() },
    { label: m.settings_minp_preset_high(), value: 0.1,  hint: m.settings_minp_preset_high_hint() },
  ];

  $: FREQ_PENALTY_PRESETS = [
    { label: m.settings_freqpenalty_preset_off(),    value: 0,   hint: m.settings_freqpenalty_preset_off_hint() },
    { label: m.settings_freqpenalty_preset_light(),  value: 0.3, hint: m.settings_freqpenalty_preset_light_hint() },
    { label: m.settings_freqpenalty_preset_strong(), value: 0.6, hint: m.settings_freqpenalty_preset_strong_hint() },
  ];

  function closestPreset(presets: {value: number}[], current: number): number | null {
    const match = presets.find(p => Math.abs(p.value - current) < 0.001);
    return match ? match.value : null;
  }

  function handleUiLanguageChange(code: string) {
    appState.pendingUiLocale = code;
  }


  function clampTokens(v: number) {
    return Math.max(50, Math.min(4000, Math.round(v)));
  }
  function clampPenalty(v: number) {
    return Math.max(0.8, Math.min(2.0, Math.round(v * 100) / 100));
  }
  function clampThinkingBudget(v: number) {
    return Math.max(500, Math.min(10000, Math.round(v / 100) * 100));
  }
  function clampTopP(v: number) {
    return Math.max(0, Math.min(1, Math.round(v * 100) / 100));
  }
  function clampTopK(v: number) {
    return Math.max(0, Math.min(200, Math.round(v)));
  }
  function clampMinP(v: number) {
    return Math.max(0, Math.min(0.5, Math.round(v * 100) / 100));
  }
  function clampFreqPenalty(v: number) {
    return Math.max(0, Math.min(2, Math.round(v * 100) / 100));
  }
</script>

{#snippet parameterToggle(key: ApiParameterKey)}
  <button
    type="button"
    class="parameter-switch"
    class:parameter-switch--on={parameterEnabled[key]}
    aria-pressed={parameterEnabled[key]}
    aria-label={parameterEnabled[key] ? "Parameter enabled" : "Parameter disabled"}
    on:click={() => toggleParameter(key)}
  >
    <span class="parameter-switch-thumb" class:parameter-switch-thumb--on={parameterEnabled[key]}></span>
  </button>
{/snippet}

{#snippet languageFlag(country: "de" | "gb")}
  <span class="language-flag" aria-hidden="true">
    {#if country === "de"}
      <svg viewBox="0 0 60 40" role="presentation">
        <rect width="60" height="13.34" y="0" fill="#111111" />
        <rect width="60" height="13.34" y="13.33" fill="#DD0000" />
        <rect width="60" height="13.34" y="26.66" fill="#FFCE00" />
      </svg>
    {:else}
      <svg viewBox="0 0 60 40" role="presentation">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#FFFFFF" stroke-width="9" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" stroke-width="4.5" />
        <path d="M30 0V40M0 20H60" stroke="#FFFFFF" stroke-width="13" />
        <path d="M30 0V40M0 20H60" stroke="#C8102E" stroke-width="7" />
      </svg>
    {/if}
  </span>
{/snippet}

{#if behaviorOnly}
<section>
  <span class="settings-section-title">{m.settings_section_ai_behavior()}</span>
  <div class="settings-card space-y-4">

    <div>
      <div class="flex items-center justify-between mb-2">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="settings-label" style="margin-bottom:0">{m.settings_creativity_label()}</span>
          <Tooltip>
            {m.settings_creativity_tooltip_p1()}<br><br>
            {m.settings_creativity_tooltip_p2a()}<br>
            {m.settings_creativity_tooltip_p2b()}<br><br>
            <span class="tooltip-hint">{m.settings_creativity_tooltip_hint()}</span>
          </Tooltip>
        </div>
        <div class="parameter-actions">
          {#if powerUser}
            <span class="power-value" class:power-value--disabled={!parameterEnabled.temperature}>{appState.apiSettings.temperature?.toFixed(2) ?? "0.80"}</span>
          {/if}
          {@render parameterToggle("temperature")}
        </div>
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 30 }}>
          <input
            type="range" min="0" max="2" step="0.01"
            bind:value={appState.apiSettings.temperature}
            class="power-slider"
            disabled={!parameterEnabled.temperature}
            aria-label={m.settings_creativity_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_precise()}</span><span>{m.settings_slider_creative()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
          {#each TEMPERATURES as temp}
            <button
              on:click={() => (appState.apiSettings.temperature = temp.value)}
              disabled={!parameterEnabled.temperature}
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
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="settings-label" style="margin-bottom:0">{m.settings_tokens_label()}</span>
          <Tooltip>
            {m.settings_tokens_tooltip_p1()}<br><br>
            {m.settings_tokens_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_tokens_tooltip_hint()}</span>
          </Tooltip>
        </div>
        <div class="parameter-actions">
          {#if powerUser}
            <span class="power-value" class:power-value--disabled={!parameterEnabled.maxTokens}>{appState.apiSettings.maxTokens ?? 300} Tokens</span>
          {/if}
          {@render parameterToggle("maxTokens")}
        </div>
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 30 }}>
          <input
            type="range" min="50" max="4000" step="10"
            value={appState.apiSettings.maxTokens ?? 300}
            on:input={(e) => { appState.apiSettings.maxTokens = clampTokens(+e.currentTarget.value); }}
            class="power-slider"
            disabled={!parameterEnabled.maxTokens}
            aria-label={m.settings_tokens_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_short()}</span><span>{m.settings_slider_long()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
          {#each MAX_TOKENS_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.maxTokens = preset.value)}
              disabled={!parameterEnabled.maxTokens}
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
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="settings-label" style="margin-bottom:0">{m.settings_penalty_label()}</span>
          <Tooltip>
            {m.settings_penalty_tooltip_p1()}<br><br>
            <span class="tooltip-warn">{m.settings_penalty_tooltip_warn()}</span><br><br>
            <span class="tooltip-hint">{m.settings_penalty_tooltip_hint()}</span>
          </Tooltip>
        </div>
        <div class="parameter-actions">
          {#if powerUser}
            <span class="power-value" class:power-value--disabled={!parameterEnabled.presencePenalty}>{(appState.apiSettings.presencePenalty ?? 1.12).toFixed(2)}</span>
          {/if}
          {@render parameterToggle("presencePenalty")}
        </div>
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 30 }}>
          <input
            type="range" min="0.8" max="2.0" step="0.01"
            value={appState.apiSettings.presencePenalty ?? 1.12}
            on:input={(e) => { appState.apiSettings.presencePenalty = clampPenalty(+e.currentTarget.value); }}
            class="power-slider"
            disabled={!parameterEnabled.presencePenalty}
            aria-label={m.settings_penalty_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_tolerant()}</span><span>{m.settings_slider_strict()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
          {#each PENALTY_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.presencePenalty = preset.value)}
              disabled={!parameterEnabled.presencePenalty}
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
      class="thinking-toggle-row"
    >
      <div class="thinking-toggle-text">
        <span class="thinking-toggle-label">{m.settings_thinking_label()}</span>
        <span class="thinking-toggle-sub">{m.settings_thinking_sub()}</span>
      </div>
      <div class="toggle-track" class:toggle-track--on={appState.apiSettings.isThinkingModel}>
        <div class="toggle-thumb" class:toggle-thumb--on={appState.apiSettings.isThinkingModel}></div>
      </div>
    </div>

    {#if appState.apiSettings.isThinkingModel}
      <div in:fade={{ duration: 250, delay: 30 }}>
        <div class="settings-divider"></div>
        <div>
          <div class="flex items-center justify-between mb-2">
            <div style="display:flex;align-items:center;gap:8px;">
              <span class="settings-label" style="margin-bottom:0">{m.settings_thinking_budget_label()}</span>
              <Tooltip>
                {m.settings_thinking_budget_tooltip_p1()}<br><br>
                {m.settings_thinking_budget_tooltip_p2()}<br><br>
                <span class="tooltip-hint">{m.settings_thinking_budget_tooltip_hint()}</span>
              </Tooltip>
            </div>
            <div class="parameter-actions">
              {#if powerUser}
                <span class="power-value" class:power-value--disabled={!parameterEnabled.thinkingBudget}>{appState.apiSettings.thinkingBudget ?? 2500} Tokens</span>
              {/if}
              {@render parameterToggle("thinkingBudget")}
            </div>
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="500" max="10000" step="100"
                value={appState.apiSettings.thinkingBudget ?? 2500}
                on:input={(e) => { appState.apiSettings.thinkingBudget = clampThinkingBudget(+e.currentTarget.value); }}
                class="power-slider"
                disabled={!parameterEnabled.thinkingBudget}
                aria-label={m.settings_thinking_budget_label()}
              />
              <div class="slider-bounds"><span>500</span><span>10 000</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each THINKING_BUDGET_PRESETS as preset}
                <button
                  on:click={() => (appState.apiSettings.thinkingBudget = preset.value)}
                  disabled={!parameterEnabled.thinkingBudget}
                  class="preset-btn {(appState.apiSettings.thinkingBudget ?? 2500) === preset.value ? 'preset-btn--active' : ''}"
                >
                  <span class="preset-label">{preset.label}</span>
                  <span class="preset-hint">{preset.hint}</span>
                </button>
              {/each}
            </div>
          {/if}
        </div>
      </div>
    {/if}

    <div class="sampling-divider" role="separator">
      <span class="sampling-divider-line"></span>
      <span class="sampling-subheading">{m.settings_section_sampling_advanced()}</span>
      <span class="sampling-divider-line"></span>
    </div>

    <div>
      <div class="flex items-center justify-between mb-2">
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="settings-label" style="margin-bottom:0">{m.settings_topp_label()}</span>
          <Tooltip>
            {m.settings_topp_tooltip_p1()}<br><br>
            {m.settings_topp_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_topp_tooltip_hint()}</span>
          </Tooltip>
        </div>
        <div class="parameter-actions">
          {#if powerUser}
            <span class="power-value" class:power-value--disabled={!parameterEnabled.topP}>{(appState.apiSettings.topP ?? 0.9).toFixed(2)}</span>
          {/if}
          {@render parameterToggle("topP")}
        </div>
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 30 }}>
          <input
            type="range" min="0" max="1" step="0.01"
            value={appState.apiSettings.topP ?? 0.9}
            on:input={(e) => { appState.apiSettings.topP = clampTopP(+e.currentTarget.value); }}
            class="power-slider"
            disabled={!parameterEnabled.topP}
            aria-label={m.settings_topp_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_focused()}</span><span>{m.settings_slider_diverse()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
          {#each TOP_P_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.topP = preset.value)}
              disabled={!parameterEnabled.topP}
              class="preset-btn {closestPreset(TOP_P_PRESETS, appState.apiSettings.topP ?? 0.9) === preset.value ? 'preset-btn--active' : ''}"
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
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="settings-label" style="margin-bottom:0">{m.settings_topk_label()}</span>
          <Tooltip>
            {m.settings_topk_tooltip_p1()}<br><br>
            {m.settings_topk_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_topk_tooltip_hint()}</span>
          </Tooltip>
        </div>
        <div class="parameter-actions">
          {#if powerUser}
            <span class="power-value" class:power-value--disabled={!parameterEnabled.topK}>{appState.apiSettings.topK ?? 40}</span>
          {/if}
          {@render parameterToggle("topK")}
        </div>
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 30 }}>
          <input
            type="range" min="0" max="200" step="1"
            value={appState.apiSettings.topK ?? 40}
            on:input={(e) => { appState.apiSettings.topK = clampTopK(+e.currentTarget.value); }}
            class="power-slider"
            disabled={!parameterEnabled.topK}
            aria-label={m.settings_topk_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_narrow()}</span><span>{m.settings_slider_wide()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
          {#each TOP_K_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.topK = preset.value)}
              disabled={!parameterEnabled.topK}
              class="preset-btn {closestPreset(TOP_K_PRESETS, appState.apiSettings.topK ?? 40) === preset.value ? 'preset-btn--active' : ''}"
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
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="settings-label" style="margin-bottom:0">{m.settings_minp_label()}</span>
          <Tooltip>
            {m.settings_minp_tooltip_p1()}<br><br>
            {m.settings_minp_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_minp_tooltip_hint()}</span>
          </Tooltip>
        </div>
        <div class="parameter-actions">
          {#if powerUser}
            <span class="power-value" class:power-value--disabled={!parameterEnabled.minP}>{(appState.apiSettings.minP ?? 0.05).toFixed(2)}</span>
          {/if}
          {@render parameterToggle("minP")}
        </div>
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 30 }}>
          <input
            type="range" min="0" max="0.5" step="0.01"
            value={appState.apiSettings.minP ?? 0.05}
            on:input={(e) => { appState.apiSettings.minP = clampMinP(+e.currentTarget.value); }}
            class="power-slider"
            disabled={!parameterEnabled.minP}
            aria-label={m.settings_minp_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_off()}</span><span>{m.settings_slider_strict()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
          {#each MIN_P_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.minP = preset.value)}
              disabled={!parameterEnabled.minP}
              class="preset-btn {closestPreset(MIN_P_PRESETS, appState.apiSettings.minP ?? 0.05) === preset.value ? 'preset-btn--active' : ''}"
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
        <div style="display:flex;align-items:center;gap:8px;">
          <span class="settings-label" style="margin-bottom:0">{m.settings_freqpenalty_label()}</span>
          <Tooltip>
            {m.settings_freqpenalty_tooltip_p1()}<br><br>
            {m.settings_freqpenalty_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_freqpenalty_tooltip_hint()}</span>
          </Tooltip>
        </div>
        <div class="parameter-actions">
          {#if powerUser}
            <span class="power-value" class:power-value--disabled={!parameterEnabled.frequencyPenalty}>{(appState.apiSettings.frequencyPenalty ?? 0).toFixed(2)}</span>
          {/if}
          {@render parameterToggle("frequencyPenalty")}
        </div>
      </div>
      {#if powerUser}
        <div in:fade={{ duration: 250, delay: 30 }}>
          <input
            type="range" min="0" max="2" step="0.01"
            value={appState.apiSettings.frequencyPenalty ?? 0}
            on:input={(e) => { appState.apiSettings.frequencyPenalty = clampFreqPenalty(+e.currentTarget.value); }}
            class="power-slider"
            disabled={!parameterEnabled.frequencyPenalty}
            aria-label={m.settings_freqpenalty_label()}
          />
          <div class="slider-bounds"><span>{m.settings_slider_off()}</span><span>{m.settings_slider_strict()}</span></div>
        </div>
      {:else}
        <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
          {#each FREQ_PENALTY_PRESETS as preset}
            <button
              on:click={() => (appState.apiSettings.frequencyPenalty = preset.value)}
              disabled={!parameterEnabled.frequencyPenalty}
              class="preset-btn {closestPreset(FREQ_PENALTY_PRESETS, appState.apiSettings.frequencyPenalty ?? 0) === preset.value ? 'preset-btn--active' : ''}"
            >
              <span class="preset-label">{preset.label}</span>
              <span class="preset-hint">{preset.hint}</span>
            </button>
          {/each}
        </div>
      {/if}
    </div>

  </div>
</section>
{/if}

{#if languageOnly}
<section>
  <span class="settings-section-title">{m.settings_section_language()}</span>
  <div class="settings-card language-settings-card">

    <div class="language-group">
      <div class="language-group-header">
        <span class="settings-label language-group-label">{m.settings_language_label()}</span>
      </div>

      <div class="language-grid" role="radiogroup" aria-label={m.settings_language_label()}>
        {#each uiLanguages as language}
          {@const selected = (appState.pendingUiLocale || getLocale()) === language.code}
          <button
            type="button"
            class:language-choice--selected={selected}
            class="language-choice"
            role="radio"
            aria-checked={selected}
            on:click={() => handleUiLanguageChange(language.code)}
          >
            {@render languageFlag(language.country)}
            <span class="language-copy">
              <span class="language-name">{language.label}</span>
            </span>
            <span class="language-state" aria-hidden="true">
              {#if selected}
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M4 8.25 6.6 10.8 12 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </div>


  </div>
</section>
{/if}

<style>
  .language-settings-card {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .language-group {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .language-group-header {
    display: flex;
    align-items: center;
    min-height: 20px;
  }
  .language-group-label {
    margin: 0;
  }
  .language-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .language-choice {
    width: 100%;
    min-height: 60px;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 12px;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px;
    background: rgba(255,255,255,0.025);
    color: #aaa9ad;
    text-align: left;
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease;
  }
  .language-choice:hover {
    background: rgba(255,255,255,0.045);
    border-color: rgba(255,255,255,0.12);
    color: #e3e2e5;
  }
  .language-choice:active {
    transform: scale(0.985);
  }
  .language-choice:focus-visible {
    outline: none;
    border-color: rgba(212,180,131,0.58);
    box-shadow: 0 0 0 3px rgba(212,180,131,0.10);
  }
  .language-choice--selected {
    background: linear-gradient(180deg, rgba(212,180,131,0.10), rgba(212,180,131,0.055));
    border-color: rgba(212,180,131,0.42);
    color: #f0e4d0;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
  }
  .language-choice--selected:hover {
    background: linear-gradient(180deg, rgba(212,180,131,0.13), rgba(212,180,131,0.07));
    border-color: rgba(212,180,131,0.52);
  }
  .language-flag {
    flex: 0 0 auto;
    width: 38px;
    height: 26px;
    display: block;
    overflow: hidden;
    border-radius: 6px;
    background: rgba(255,255,255,0.04);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.10),
      0 3px 10px rgba(0,0,0,0.16);
    transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
  }
  .language-flag svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .language-choice:hover .language-flag {
    transform: translateY(-1px);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.14),
      0 5px 14px rgba(0,0,0,0.20);
  }
  .language-choice--selected .language-flag {
    box-shadow:
      0 0 0 1px rgba(212,180,131,0.30),
      0 4px 12px rgba(0,0,0,0.20);
  }
  .language-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
  }
  .language-name {
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .language-state {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.09);
    color: transparent;
    background: rgba(255,255,255,0.018);
    transition: all 140ms ease;
  }
  .language-choice--selected .language-state {
    color: #171513;
    background: #d4b483;
    border-color: #d4b483;
    box-shadow: 0 0 0 3px rgba(212,180,131,0.08);
  }
  .language-state svg {
    width: 12px;
    height: 12px;
  }
  @media (max-width: 560px) {
    .language-grid {
      grid-template-columns: 1fr;
    }
    .language-choice {
      min-height: 56px;
    }
  }

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
  .preset-btn:disabled {
    opacity: 0.32;
    cursor: not-allowed;
  }
  .preset-btn:disabled:active { transform: none; }
  .preset-btn:hover:not(:disabled) {
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

  .sampling-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 0 2px;
  }
  .sampling-divider-line {
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.07);
  }
  .sampling-subheading {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6b6b6e;
    white-space: nowrap;
    margin: 10px 00px 15px 0px;
  }


  .parameter-actions {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 9px;
    flex-shrink: 0;
  }

  .parameter-switch {
    position: relative;
    width: 30px;
    height: 18px;
    flex-shrink: 0;
    padding: 0;
    border-radius: 999px;
    border: 1px solid rgba(255,255,255,0.08);
    background: rgba(255,255,255,0.055);
    cursor: pointer;
    transition: background 0.16s ease, border-color 0.16s ease, box-shadow 0.16s ease;
  }
  .parameter-switch:hover {
    border-color: rgba(255,255,255,0.16);
    background: rgba(255,255,255,0.08);
  }
  .parameter-switch--on {
    background: rgba(212,180,131,0.16);
    border-color: rgba(212,180,131,0.34);
  }
  .parameter-switch-thumb {
    position: absolute;
    top: 3px;
    left: 3px;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #5a5a5e;
    transition: transform 0.16s ease, background 0.16s ease;
  }
  .parameter-switch-thumb--on {
    transform: translateX(12px);
    background: #d4b483;
  }

  .power-value {
    font-size: 11px;
    font-weight: 700;
    color: #d4b483;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.16s ease, color 0.16s ease;
  }
  .power-value--disabled {
    color: #55555a;
    opacity: 0.7;
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
  .power-slider:disabled {
    opacity: 0.28;
    cursor: not-allowed;
  }
  .power-slider:disabled::-webkit-slider-thumb { cursor: not-allowed; }
  .power-slider:disabled::-moz-range-thumb { cursor: not-allowed; }
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

  .thinking-toggle-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    cursor: pointer;
    user-select: none;
    padding: 12px 14px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    transition: background 0.15s ease, border-color 0.15s ease;
  }
  .thinking-toggle-row:hover {
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.10);
  }
  .thinking-toggle-text {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }
  .thinking-toggle-label {
    font-size: 13px;
    font-weight: 600;
    color: #d1d1d6;
    line-height: 1.3;
  }
  .thinking-toggle-sub {
    font-size: 11px;
    color: #d4b483;
    opacity: 0.7;
    line-height: 1.4;
  }
</style>