<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { getAllSettings, saveSetting } from "$lib/utils/settings";
  import * as m from "$lib/paraglide/messages";
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { fade } from "svelte/transition";
  import { onMount } from "svelte";

  let { onClose }: { onClose: () => void } = $props();

  // The power-user flag isn't part of appState, so it's loaded/persisted
  // the same way SettingsPage.svelte does it (via the settings_power_user key).
  let powerUser = $state(false);

  onMount(async () => {
    try {
      const settings = await getAllSettings();
      const row = settings.find(r => r.key === "settings_power_user");
      if (row) powerUser = row.value === "true";
    } catch (err) {
      console.error("[ChatSettingsPanel] Failed to load power user flag:", err);
    }
  });

  function persist(key: string, value: unknown) {
    saveSetting(key, value as any).catch(err =>
      console.error(`[ChatSettingsPanel] Failed to save "${key}":`, err)
    );
  }

  function togglePowerUser() {
    powerUser = !powerUser;
    persist("settings_power_user", powerUser);
  }

  const TEMPERATURES = $derived([
    { label: m.settings_temp_precise(), value: 0.4, hint: m.settings_temp_hint_precise() },
    { label: m.settings_temp_balanced(), value: 0.8, hint: m.settings_temp_hint_balanced() },
    { label: m.settings_temp_creative(), value: 1.0, hint: m.settings_temp_hint_creative() },
  ]);

  const MAX_TOKENS_PRESETS = $derived([
    { label: m.settings_tokens_preset_chat(),      value: 150, hint: m.settings_tokens_preset_chat_hint() },
    { label: m.settings_tokens_preset_paragraph(), value: 300, hint: m.settings_tokens_preset_paragraph_hint() },
    { label: m.settings_tokens_preset_novel(),     value: 800, hint: m.settings_tokens_preset_novel_hint() },
  ]);

  const THINKING_BUDGET_PRESETS = $derived([
    { label: m.settings_thinking_budget_fast(),     value: 1000, hint: m.settings_thinking_budget_fast_hint() },
    { label: m.settings_thinking_budget_balanced(), value: 2500, hint: m.settings_thinking_budget_balanced_hint() },
    { label: m.settings_thinking_budget_deep(),     value: 5000, hint: m.settings_thinking_budget_deep_hint() },
  ]);

  const PENALTY_PRESETS = $derived([
    { label: m.settings_penalty_preset_tolerant(), value: 1.0,  hint: m.settings_penalty_preset_tolerant_hint() },
    { label: m.settings_penalty_preset_normal(),   value: 1.12, hint: m.settings_penalty_preset_normal_hint() },
    { label: m.settings_penalty_preset_strict(),   value: 1.25, hint: m.settings_penalty_preset_strict_hint() },
  ]);

  const TOP_P_PRESETS = $derived([
    { label: m.settings_topp_preset_focused(),  value: 0.5, hint: m.settings_topp_preset_focused_hint() },
    { label: m.settings_topp_preset_balanced(), value: 0.9, hint: m.settings_topp_preset_balanced_hint() },
    { label: m.settings_topp_preset_diverse(),  value: 1.0, hint: m.settings_topp_preset_diverse_hint() },
  ]);

  const TOP_K_PRESETS = $derived([
    { label: m.settings_topk_preset_narrow(),   value: 20, hint: m.settings_topk_preset_narrow_hint() },
    { label: m.settings_topk_preset_balanced(), value: 40, hint: m.settings_topk_preset_balanced_hint() },
    { label: m.settings_topk_preset_wide(),     value: 80, hint: m.settings_topk_preset_wide_hint() },
  ]);

  const MIN_P_PRESETS = $derived([
    { label: m.settings_minp_preset_off(),  value: 0,    hint: m.settings_minp_preset_off_hint() },
    { label: m.settings_minp_preset_low(),  value: 0.05, hint: m.settings_minp_preset_low_hint() },
    { label: m.settings_minp_preset_high(), value: 0.1,  hint: m.settings_minp_preset_high_hint() },
  ]);

  const FREQ_PENALTY_PRESETS = $derived([
    { label: m.settings_freqpenalty_preset_off(),    value: 0,   hint: m.settings_freqpenalty_preset_off_hint() },
    { label: m.settings_freqpenalty_preset_light(),  value: 0.3, hint: m.settings_freqpenalty_preset_light_hint() },
    { label: m.settings_freqpenalty_preset_strong(), value: 0.6, hint: m.settings_freqpenalty_preset_strong_hint() },
  ]);

  function closestPreset(presets: {value: number}[], current: number): number | null {
    const match = presets.find(p => Math.abs(p.value - current) < 0.001);
    return match ? match.value : null;
  }

  function clampTokens(v: number) { return Math.max(50, Math.min(4000, Math.round(v))); }
  function clampPenalty(v: number) { return Math.max(0.8, Math.min(2.0, Math.round(v * 100) / 100)); }
  function clampThinkingBudget(v: number) { return Math.max(500, Math.min(10000, Math.round(v / 100) * 100)); }
  function clampTopP(v: number) { return Math.max(0, Math.min(1, Math.round(v * 100) / 100)); }
  function clampTopK(v: number) { return Math.max(0, Math.min(200, Math.round(v))); }
  function clampMinP(v: number) { return Math.max(0, Math.min(0.5, Math.round(v * 100) / 100)); }
  function clampFreqPenalty(v: number) { return Math.max(0, Math.min(2, Math.round(v * 100) / 100)); }

  // Every setter updates the live appState (so the next message picks it up
  // immediately) and persists it, since this panel has no separate "Save" button.
  function setTemperature(v: number) { appState.apiSettings.temperature = v; persist("api_temperature", v); }
  function setMaxTokens(v: number) { appState.apiSettings.maxTokens = v; persist("api_max_tokens", v); }
  function setPresencePenalty(v: number) { appState.apiSettings.presencePenalty = v; persist("api_presence_penalty", v); }
  function setThinkingBudget(v: number) { appState.apiSettings.thinkingBudget = v; }
  function setTopP(v: number) { appState.apiSettings.topP = v; persist("api_top_p", v); }
  function setTopK(v: number) { appState.apiSettings.topK = v; persist("api_top_k", v); }
  function setMinP(v: number) { appState.apiSettings.minP = v; persist("api_min_p", v); }
  function setFreqPenalty(v: number) { appState.apiSettings.frequencyPenalty = v; persist("api_frequency_penalty", v); }

  function toggleThinkingModel() {
    appState.apiSettings.isThinkingModel = !appState.apiSettings.isThinkingModel;
    persist("thinking_mode", appState.apiSettings.isThinkingModel);
  }

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  // Closes only when the backdrop itself is clicked, so no
  // stopPropagation handler on the panel is needed (a11y warnings).
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="settings-overlay"
  role="presentation"
  onclick={handleOverlayClick}
  onkeydown={handleWindowKeydown}
>
  <div class="settings-panel" role="dialog" aria-modal="true" aria-label={m.settings_section_ai_behavior()}>
    <div class="settings-panel-header">
      <span class="settings-panel-title">{m.settings_section_ai_behavior()}</span>
      <button class="settings-close-btn" onclick={onClose} aria-label="Schließen">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="settings-panel-body">
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
            {#if powerUser}
              <span class="power-value">{appState.apiSettings.temperature?.toFixed(2) ?? "0.80"}</span>
            {/if}
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="0" max="2" step="0.01"
                value={appState.apiSettings.temperature ?? 0.8}
                oninput={(e) => setTemperature(+e.currentTarget.value)}
                class="power-slider"
                aria-label={m.settings_creativity_label()}
              />
              <div class="slider-bounds"><span>{m.settings_slider_precise()}</span><span>{m.settings_slider_creative()}</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each TEMPERATURES as temp}
                <button
                  onclick={() => setTemperature(temp.value)}
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
            {#if powerUser}
              <span class="power-value">{appState.apiSettings.maxTokens ?? 300} Tokens</span>
            {/if}
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="50" max="4000" step="10"
                value={appState.apiSettings.maxTokens ?? 300}
                oninput={(e) => setMaxTokens(clampTokens(+e.currentTarget.value))}
                class="power-slider"
                aria-label={m.settings_tokens_label()}
              />
              <div class="slider-bounds"><span>{m.settings_slider_short()}</span><span>{m.settings_slider_long()}</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each MAX_TOKENS_PRESETS as preset}
                <button
                  onclick={() => setMaxTokens(preset.value)}
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
            {#if powerUser}
              <span class="power-value">{(appState.apiSettings.presencePenalty ?? 1.12).toFixed(2)}</span>
            {/if}
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="0.8" max="2.0" step="0.01"
                value={appState.apiSettings.presencePenalty ?? 1.12}
                oninput={(e) => setPresencePenalty(clampPenalty(+e.currentTarget.value))}
                class="power-slider"
                aria-label={m.settings_penalty_label()}
              />
              <div class="slider-bounds"><span>{m.settings_slider_tolerant()}</span><span>{m.settings_slider_strict()}</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each PENALTY_PRESETS as preset}
                <button
                  onclick={() => setPresencePenalty(preset.value)}
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
          onclick={toggleThinkingModel}
          onkeydown={(e) => (e.key === " " || e.key === "Enter") && toggleThinkingModel()}
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
                {#if powerUser}
                  <span class="power-value">{appState.apiSettings.thinkingBudget ?? 2500} Tokens</span>
                {/if}
              </div>
              {#if powerUser}
                <div in:fade={{ duration: 250, delay: 30 }}>
                  <input
                    type="range" min="500" max="10000" step="100"
                    value={appState.apiSettings.thinkingBudget ?? 2500}
                    oninput={(e) => setThinkingBudget(clampThinkingBudget(+e.currentTarget.value))}
                    class="power-slider"
                    aria-label={m.settings_thinking_budget_label()}
                  />
                  <div class="slider-bounds"><span>500</span><span>10 000</span></div>
                </div>
              {:else}
                <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
                  {#each THINKING_BUDGET_PRESETS as preset}
                    <button
                      onclick={() => setThinkingBudget(preset.value)}
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
            {#if powerUser}
              <span class="power-value">{(appState.apiSettings.topP ?? 0.9).toFixed(2)}</span>
            {/if}
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="0" max="1" step="0.01"
                value={appState.apiSettings.topP ?? 0.9}
                oninput={(e) => setTopP(clampTopP(+e.currentTarget.value))}
                class="power-slider"
                aria-label={m.settings_topp_label()}
              />
              <div class="slider-bounds"><span>{m.settings_slider_focused()}</span><span>{m.settings_slider_diverse()}</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each TOP_P_PRESETS as preset}
                <button
                  onclick={() => setTopP(preset.value)}
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
            {#if powerUser}
              <span class="power-value">{appState.apiSettings.topK ?? 40}</span>
            {/if}
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="0" max="200" step="1"
                value={appState.apiSettings.topK ?? 40}
                oninput={(e) => setTopK(clampTopK(+e.currentTarget.value))}
                class="power-slider"
                aria-label={m.settings_topk_label()}
              />
              <div class="slider-bounds"><span>{m.settings_slider_narrow()}</span><span>{m.settings_slider_wide()}</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each TOP_K_PRESETS as preset}
                <button
                  onclick={() => setTopK(preset.value)}
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
            {#if powerUser}
              <span class="power-value">{(appState.apiSettings.minP ?? 0.05).toFixed(2)}</span>
            {/if}
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="0" max="0.5" step="0.01"
                value={appState.apiSettings.minP ?? 0.05}
                oninput={(e) => setMinP(clampMinP(+e.currentTarget.value))}
                class="power-slider"
                aria-label={m.settings_minp_label()}
              />
              <div class="slider-bounds"><span>{m.settings_slider_off()}</span><span>{m.settings_slider_strict()}</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each MIN_P_PRESETS as preset}
                <button
                  onclick={() => setMinP(preset.value)}
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
            {#if powerUser}
              <span class="power-value">{(appState.apiSettings.frequencyPenalty ?? 0).toFixed(2)}</span>
            {/if}
          </div>
          {#if powerUser}
            <div in:fade={{ duration: 250, delay: 30 }}>
              <input
                type="range" min="0" max="2" step="0.01"
                value={appState.apiSettings.frequencyPenalty ?? 0}
                oninput={(e) => setFreqPenalty(clampFreqPenalty(+e.currentTarget.value))}
                class="power-slider"
                aria-label={m.settings_freqpenalty_label()}
              />
              <div class="slider-bounds"><span>{m.settings_slider_off()}</span><span>{m.settings_slider_strict()}</span></div>
            </div>
          {:else}
            <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
              {#each FREQ_PENALTY_PRESETS as preset}
                <button
                  onclick={() => setFreqPenalty(preset.value)}
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
    </div>

    <div class="settings-panel-footer">
      <label class="power-user-toggle" title={m.settings_power_user_title()}>
        <div class="power-icon" class:active={powerUser}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <span class="power-label">{m.settings_power_user_label()}</span>
        <input type="checkbox" checked={powerUser} onchange={togglePowerUser} class="sr-only peer" />
        <div class="power-track
                    peer-checked:bg-ryokan-accent/20 peer-checked:border-ryokan-accent/40
                    after:content-[''] after:absolute after:top-[3px] after:start-[3px]
                    after:bg-[#5a5a5e] after:rounded-full
                    after:h-[14px] after:w-[14px] after:transition-all
                    peer-checked:after:translate-x-[18px] peer-checked:after:bg-ryokan-accent">
        </div>
      </label>
    </div>
  </div>
</div>

<style>
  /* ---------- Panel shell ---------- */

  .settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(8, 8, 12, 0.45);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    display: flex;
    justify-content: flex-end;
    animation: settings-overlay-in 160ms ease;
  }

  @keyframes settings-overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .settings-panel {
    position: relative;
    width: min(400px, 100%);
    height: 100%;
    display: flex;
    flex-direction: column;
    background: rgba(20, 20, 26, 0.98);
    border-left: 1px solid rgba(255,255,255,0.09);
    box-shadow: -24px 0 70px rgba(0,0,0,0.5), -4px 0 16px rgba(0,0,0,0.35);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    animation: settings-panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes settings-panel-in {
    from { opacity: 0; transform: translateX(24px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* Mobile: take over the entire screen instead of docking to the side */
  @media (max-width: 639px) {
    .settings-overlay {
      justify-content: stretch;
    }

    .settings-panel {
      width: 100%;
      border-left: none;
      animation: settings-panel-in-mobile 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .settings-panel-body {
      padding: 16px 16px calc(18px + env(safe-area-inset-bottom));
    }
  }

  @keyframes settings-panel-in-mobile {
    from { opacity: 0.6; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-panel,
    .settings-overlay {
      animation: none;
    }
  }

  .settings-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 16px 16px 14px 20px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }

  .settings-panel-title {
    font-size: 14px;
    font-weight: 650;
    color: rgba(255,255,255,0.95);
    letter-spacing: -0.01em;
  }

  .settings-close-btn {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }

  .settings-close-btn:hover {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.9);
  }

  .settings-panel-body {
    flex: 1;
    min-height: 0;
    padding: 18px 20px 22px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  .settings-panel-footer {
    flex-shrink: 0;
    padding: 8px 12px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid rgba(255,255,255,0.07);
  }

  /* ---------- Settings primitives (mirrors the main Settings page) ---------- */

  .settings-card {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 16px;
  }

  .settings-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #555;
    margin-bottom: 8px;
  }

  .settings-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 16px 0;
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
    margin: 10px 0 15px 0;
  }

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

  /* ---------- Power-user toggle (footer) ---------- */

  .power-user-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 8px 10px;
    border-radius: 10px;
    transition: background 0.15s;
    user-select: none;
  }
  .power-user-toggle:hover { background: rgba(255,255,255,0.04); }

  .power-icon {
    color: #48484a;
    transition: color 0.2s;
    display: flex;
    align-items: center;
  }
  .power-icon.active { color: #d4b483; }
  .power-label {
    font-size: 12px;
    font-weight: 600;
    color: #5a5a5e;
    flex: 1;
    letter-spacing: 0.03em;
  }
  .power-track {
    position: relative;
    flex-shrink: 0;
    width: 36px;
    height: 20px;
    border-radius: 9999px;
    transition: background 0.2s, border-color 0.2s;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.08);
  }
</style>