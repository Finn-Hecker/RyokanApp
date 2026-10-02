<script lang="ts">
  import type { Snippet } from 'svelte';
  import { fade } from 'svelte/transition';
  import type { ApiConnection } from '$lib/stores/appState.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import GenerationCapabilityWarning from './GenerationCapabilityWarning.svelte';
  import { parameterSettings, clampParameter, closestPreset, type SamplingParameter } from '$lib/utils/parameterSettings';

  let { connection, parameter, enabled, powerUser, onToggle, onValue, tooltip, note, chat = false }: {
    connection: ApiConnection; parameter: SamplingParameter; enabled: boolean; powerUser: boolean;
    onToggle: () => void; onValue: (value: number) => void;
    tooltip: Snippet; note?: Snippet; chat?: boolean;
  } = $props();
  const settings = $derived(parameterSettings(parameter));
  const value = $derived(connection[parameter] ?? settings.fallback);
  const formattedValue = $derived(settings.decimals ? value.toFixed(settings.decimals) : String(value));
</script>

<div class:chat-control={chat}>
  <div class="flex items-center justify-between mb-2">
    <div style="display:flex;align-items:center;gap:8px;">
      <span class="settings-label" style="margin-bottom:0">{settings.label}</span>
      <Tooltip>{@render tooltip()}</Tooltip>
    </div>
    <div class="parameter-actions">
      {#if powerUser}
        <span class="power-value" class:power-value--disabled={!enabled}>{formattedValue}{parameter === 'maxTokens' ? ' Tokens' : ''}</span>
      {/if}
      <GenerationCapabilityWarning {connection} {parameter} />
      <button type="button" class="parameter-switch" class:parameter-switch--on={enabled}
        aria-pressed={enabled} aria-label={enabled ? 'Parameter enabled' : 'Parameter disabled'} onclick={onToggle}>
        <span class="parameter-switch-thumb" class:parameter-switch-thumb--on={enabled}></span>
      </button>
    </div>
  </div>
  {@render note?.()}
  {#if powerUser}
    <div in:fade={{ duration: 250, delay: 30 }}>
      <input type="range" min={settings.min} max={settings.max} step={settings.step} {value}
        oninput={(event) => onValue(clampParameter(parameter, +event.currentTarget.value))}
        class="power-slider" disabled={!enabled} aria-label={settings.label} />
      <div class="slider-bounds"><span>{settings.low}</span><span>{settings.high}</span></div>
    </div>
  {:else}
    <div class="grid grid-cols-3 gap-2" in:fade={{ duration: 250, delay: 30 }}>
      {#each settings.presets as preset}
        <button onclick={() => onValue(preset.value)} disabled={!enabled}
          class="preset-btn" class:preset-btn--active={parameter === 'temperature' ? value === preset.value : closestPreset(settings.presets, value) === preset.value}>
          <span class="preset-label">{preset.label}</span><span class="preset-hint">{preset.hint}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .chat-control .settings-label { display:block; font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase; color:#68686d; }
  @media (max-width:639px) { .chat-control .preset-btn { padding:8px 3px; } }
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

</style>
