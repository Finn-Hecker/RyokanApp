<script lang="ts">
  import type { ApiConnection } from '$lib/stores/appState.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import * as m from '$lib/paraglide/messages';
  import { resolveGenerationCapabilities } from '$lib/ai/connections/generationCapabilities';
  import { getLocale } from '$lib/paraglide/runtime';

  let { connection, powerUser = false, onChange = () => {} }: { connection: ApiConnection; powerUser?: boolean; onChange?: () => void } = $props();
  const presets = $derived([
    { value: connection.providerKind === 'anthropic' ? 1024 : 1000, label: m.settings_thinking_budget_fast(), hint: m.settings_thinking_budget_fast_hint() },
    { value: 2500, label: m.settings_thinking_budget_balanced(), hint: m.settings_thinking_budget_balanced_hint() },
    { value: 5000, label: m.settings_thinking_budget_deep(), hint: m.settings_thinking_budget_deep_hint() },
  ]);
  function toggle() {
    connection.parameterEnabled.thinkingBudget = !connection.parameterEnabled.thinkingBudget;
    onChange();
  }
  function select(value: number) {
    connection.thinkingBudget = value;
    onChange();
  }
  function selectCustom(value: number) {
    select(Math.max(connection.providerKind === 'anthropic' ? 1024 : 500, Math.min(10000, Math.round(value / 100) * 100)));
  }
</script>

{#if connection.providerKind === 'llama_cpp' || (['anthropic', 'gemini'].includes(connection.providerKind)
  && resolveGenerationCapabilities(connection).supportedParameters.includes('thinking_budget_tokens'))}
  <div>
    {#if connection.providerKind === 'anthropic' || connection.providerKind === 'gemini'}
      <p class="budget-value">{getLocale() === 'de'
        ? 'Das Ausgabe-Limit umfasst Thinking und Antwort zusammen. Der Thinking-Wert erhöht dieses Limit nicht.'
        : 'The output limit includes thinking and the answer together. The thinking budget does not increase this limit.'}</p>
    {/if}
    <div class="budget-header">
      <div class="budget-label"><span class="settings-label">{m.settings_thinking_budget_label()}</span><Tooltip>{#if connection.providerKind === 'llama_cpp'}{m.settings_thinking_budget_tooltip_p1()}<br><br>{m.settings_thinking_budget_tooltip_p2()}<br><br>{m.settings_thinking_budget_tooltip_hint()}{:else}{getLocale() === 'de' ? 'Thinking wird innerhalb des gemeinsamen Ausgabe-Limits gezählt. Unterstützung und erlaubte Werte hängen vom Modell ab.' : 'Thinking counts within the combined output limit. Support and allowed values depend on the model.'}{/if}</Tooltip></div>
      <button type="button" class="parameter-switch" class:parameter-switch--on={connection.parameterEnabled.thinkingBudget}
        aria-pressed={connection.parameterEnabled.thinkingBudget} aria-label={m.settings_thinking_budget_label()} onclick={toggle}>
        <span class="parameter-switch-thumb" class:parameter-switch-thumb--on={connection.parameterEnabled.thinkingBudget}></span>
      </button>
    </div>
    {#if powerUser}
      <div class="budget-value">{connection.thinkingBudget} Tokens</div>
      <input type="range" min={connection.providerKind === 'anthropic' ? 1024 : 500} max="10000" step={connection.providerKind === 'anthropic' ? 1 : 100} class="power-slider"
        aria-label={m.settings_thinking_budget_label()} value={connection.thinkingBudget}
        disabled={!connection.parameterEnabled.thinkingBudget} oninput={(event) => selectCustom(+event.currentTarget.value)} />
      <div class="slider-bounds"><span>{connection.providerKind === 'anthropic' ? 1024 : 500}</span><span>10 000</span></div>
    {:else}
    <div class="budget-options" role="group" aria-label={m.settings_thinking_budget_label()}>
      {#each presets as preset}
        <button type="button" class="preset-btn" class:preset-btn--active={connection.thinkingBudget === preset.value}
          disabled={!connection.parameterEnabled.thinkingBudget} onclick={() => select(preset.value)}>
          <span class="preset-label">{preset.label}</span><span class="preset-hint">{preset.hint}</span>
        </button>
      {/each}
    </div>
    {/if}
  </div>
  <div class="settings-divider"></div>
{/if}

<style>
  .budget-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:8px; }
  .budget-label { display:flex; align-items:center; gap:8px; }
  .settings-label { margin:0; color:#d1d1d6; font-size:13px; font-weight:600; }
  .budget-options { display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:8px; }
  .preset-btn { min-width:0; display:flex; flex-direction:column; align-items:center; gap:2px; padding:10px 6px; border-radius:12px; border:1px solid rgba(255,255,255,.06); background:rgba(255,255,255,.02); color:#6b6b6e; cursor:pointer; }
  .preset-btn:hover:not(:disabled) { border-color:rgba(255,255,255,.12); color:#d1d1d6; background:rgba(255,255,255,.04); }
  .preset-btn--active { background:rgba(255,255,255,.07); border-color:rgba(212,180,131,.4); color:#d4b483; }
  .preset-btn:disabled { opacity:.4; cursor:default; }
  .preset-label { font-size:13px; font-weight:600; }
  .preset-hint { font-size:11px; }
  .settings-divider { height:1px; margin:20px 0; background:rgba(255,255,255,.06); }
  .parameter-switch { width:34px; height:20px; border:0; border-radius:999px; background:#36363b; padding:2px; cursor:pointer; transition:background .15s; }
  .parameter-switch--on { background:#a88a60; }
  .parameter-switch-thumb { display:block; width:16px; height:16px; border-radius:50%; background:#fff; transition:transform .15s; }
  .parameter-switch-thumb--on { transform:translateX(14px); }
  .power-slider { width:100%; accent-color:#d4b483; }
  .budget-value { color:#d4b483; font-size:12px; text-align:right; margin-bottom:4px; }
  .slider-bounds { display:flex; justify-content:space-between; color:#77777b; font-size:11px; }
</style>
