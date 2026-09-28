<script lang="ts">
  import type { ApiConnection } from '$lib/stores/appState.svelte';
  import { reasoningCapability, type ReasoningLevel } from '$lib/utils/generationCapabilities';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import * as m from '$lib/paraglide/messages';

  let { connection, onChange = () => {} }: { connection: ApiConnection; onChange?: () => void } = $props();
  const capability = $derived(reasoningCapability(connection));
  const labels = $derived<Record<ReasoningLevel, string>>({
    auto: m.settings_reasoning_auto(), none: m.settings_reasoning_none(), minimal: m.settings_reasoning_minimal(),
    low: m.settings_reasoning_low(), medium: m.settings_reasoning_medium(), high: m.settings_reasoning_high(),
    xhigh: m.settings_reasoning_xhigh(), max: m.settings_reasoning_max(),
  });

  function select(level: ReasoningLevel) {
    connection.reasoningLevel = level;
    onChange();
  }
</script>

{#if capability}
  <div>
    <div class="reasoning-header flex items-center gap-2 mb-2">
      <span class="settings-label">{m.settings_reasoning_label()}</span>
      <Tooltip>{m.settings_reasoning_auto_hint()}</Tooltip>
      {#if capability.certainty === 'unknown_levels'}
        <Tooltip variant="warning" ariaLabel={m.settings_reasoning_uncertain()} width={280}>
          {m.settings_reasoning_uncertain()}
        </Tooltip>
      {/if}
    </div>
    <div class="reasoning-options" role="group" aria-label={m.settings_reasoning_label()}>
      {#each capability.levels as level}
        <button type="button" class="preset-btn" class:preset-btn--active={(capability.levels.includes(connection.reasoningLevel) ? connection.reasoningLevel : 'auto') === level}
          aria-pressed={(capability.levels.includes(connection.reasoningLevel) ? connection.reasoningLevel : 'auto') === level} onclick={() => select(level)}><span class="preset-label">{labels[level]}</span></button>
      {/each}
    </div>
  </div>
  <div class="settings-divider"></div>
{/if}

<style>
  .settings-divider { height: 1px; margin: 20px 0; background: rgba(255,255,255,.06); }
  .reasoning-header .settings-label { display: block; margin: 0; color: #68686d; font-size: 11px; font-weight: 650; letter-spacing: .055em; text-transform: uppercase; }
  :global(.settings-panel) .reasoning-header .settings-label { font-weight: 600; letter-spacing: .06em; }
  .reasoning-options { display: grid; grid-template-columns: repeat(auto-fit, minmax(78px, 1fr)); gap: 8px; }
  .preset-btn { min-width: 0; display: flex; align-items: center; justify-content: center; padding: 10px 6px;
    border-radius: 12px; border: 1px solid rgba(255,255,255,.06); background: rgba(255,255,255,.02);
    color: #6b6b6e; cursor: pointer; transition: all .15s ease; }
  .preset-btn:hover { border-color: rgba(255,255,255,.12); color: #d1d1d6; background: rgba(255,255,255,.04); }
  .preset-btn:active { transform: scale(.97); }
  .preset-btn--active { background: rgba(255,255,255,.07); border-color: rgba(212,180,131,.4); color: #d4b483; }
  .preset-label { font-size: 13px; font-weight: 600; }
</style>
