<script lang="ts">
  import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { formatCachedUsage, formatUsageCount, formatUsageCost, type TokenUsage } from '$lib/utils/tokenUsage';

  let { usage, swipeIndex, totalVariants, onClose }: {
    usage?: TokenUsage | null;
    swipeIndex: number;
    totalVariants: number;
    onClose: () => void;
  } = $props();

  const metricRows = $derived([
    { label: m.usage_input(), value: formatUsageCount(usage?.inputTokens, getLocale()), icon: 'enter' },
    { label: m.usage_cached(), value: formatCachedUsage(usage?.cachedInputTokens, usage?.inputTokens, getLocale()), icon: 'cache' },
    { label: m.usage_output(), value: formatUsageCount(usage?.outputTokens, getLocale()), icon: 'exit' },
    { label: m.usage_reasoning(), value: formatUsageCount(usage?.reasoningTokens, getLocale()), icon: 'spark' },
  ]);

  const detailRows = $derived([
    { label: m.usage_cost(), value: formatUsageCost(usage?.costUsd, getLocale()) },
    { label: m.usage_model(), value: usage?.actualModel },
    { label: m.usage_connection(), value: usage?.connectionName },
    { label: m.usage_tier(), value: usage?.serviceTier },
  ]);

</script>

<BottomSheet {onClose} label={m.usage_title()} width="520px" maxHeight="720px" describedBy="usage-note">
  {#snippet header()}
<div class="title-group">
      <span class="title-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M4 19V9"/><path d="M10 19V5"/><path d="M16 19v-7"/><path d="M22 19H2"/>
        </svg>
      </span>
      <div>
        <h2 id="usage-title">{m.usage_title()}</h2>
        {#if totalVariants > 1}
          <p class="variant-label">{m.usage_variant({ current: swipeIndex + 1, total: totalVariants })}</p>
        {/if}
      </div>
    </div>
  {/snippet}
  {#snippet children(close)}

  <div class="content">
    {#if !usage}
      <div class="legacy-message" role="status">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>
        </svg>
        <span>{m.usage_legacy()}</span>
      </div>
    {/if}

    <dl class="metric-grid">
      {#each metricRows as row}
        <div class="metric-card">
          <dt>
            <span class="metric-icon" aria-hidden="true">
              {#if row.icon === 'enter'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 17l5-5-5-5"/><path d="M15 12H3"/><path d="M21 19V5"/></svg>
              {:else if row.icon === 'cache'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7H7a4 4 0 0 0-4 4v2a4 4 0 0 0 4 4h13"/><path d="M17 4l3 3-3 3"/><path d="M17 14l3 3-3 3"/></svg>
              {:else if row.icon === 'exit'}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 7l5 5-5 5"/><path d="M19 12H7"/><path d="M3 5v14"/></svg>
              {:else}
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.4 4.1L17 9l-3.6 1.9L12 15l-1.4-4.1L7 9l3.6-1.9L12 3z"/><path d="M19 15l.7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15z"/></svg>
              {/if}
            </span>
            <span>{row.label}</span>
          </dt>
          <dd class:unavailable={!row.value}>{row.value ?? m.usage_unavailable()}</dd>
        </div>
      {/each}
    </dl>

    <dl class="detail-list">
      {#each detailRows as row}
        <div>
          <dt>{row.label}</dt>
          <dd class:unavailable={!row.value}>{row.value ?? m.usage_unavailable()}</dd>
        </div>
      {/each}
    </dl>

    <p class="usage-note" id="usage-note">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9"/><path d="M12 11v5"/><path d="M12 8h.01"/>
      </svg>
      <span>{m.usage_note()}</span>
    </p>
  </div>
  {/snippet}
</BottomSheet>

<style>
  .title-group { display: flex; min-width: 0; align-items: center; gap: 12px; }
  .title-icon {
    display: grid;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    place-items: center;
    border: 1px solid rgba(212, 180, 131, .18);
    border-radius: 11px;
    background: linear-gradient(135deg, rgba(212, 180, 131, .14), rgba(212, 180, 131, .05));
    color: #d4b483;
  }
  .title-icon svg { width: 19px; height: 19px; }

  .legacy-message {
    display: flex;
    align-items: flex-start;
    gap: 9px;
    margin-bottom: 14px;
    padding: 10px 12px;
    border: 1px solid rgba(212, 180, 131, .15);
    border-radius: 11px;
    background: rgba(212, 180, 131, .06);
    color: #c8bda9;
    font-size: 12px;
    line-height: 1.5;
  }
  .legacy-message svg { width: 16px; height: 16px; flex: 0 0 auto; margin-top: 1px; color: #d4b483; }

  dl { margin: 0; }
  .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
  .metric-card {
    min-width: 0;
    padding: 16px;
    border: 1px solid transparent;
    border-radius: 14px;
    background: var(--sheet-surface);
  }
  .metric-card dt { display: flex; min-width: 0; align-items: center; gap: 7px; color:var(--sheet-text-muted); font-size: 12px; line-height: 1.4; }
  .metric-card dt > span:last-child { min-width: 0; overflow-wrap: anywhere; }
  .metric-icon { display: grid; width: 17px; height: 17px; flex: 0 0 auto; place-items: center; color: rgba(212, 180, 131, .8); }
  .metric-icon svg { width: 15px; height: 15px; }
  .metric-card dd { margin: 8px 0 0; color: #f0eee9; font-size: 24px; font-weight: 620; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

  .detail-list {
    margin-top: 20px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: 14px;
    background: transparent;
  }
  .detail-list > div { display: grid; grid-template-columns: minmax(130px, .8fr) minmax(0, 1.2fr); align-items: baseline; gap: 16px; padding: 13px 0; }
  .detail-list > div + div { border-top: 1px solid var(--sheet-divider); }
  .detail-list dt { color:var(--sheet-text-muted); font-size: 11px; line-height: 1.4; }
  .detail-list dd { margin: 0; color: #dedee2; font-size: 12px; font-weight: 500; line-height: 1.45; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  dd.unavailable { color: #64646a; font-weight: 450; }
  .metric-card dd.unavailable { font-size: 12px; line-height: 22px; }

  .usage-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 14px 2px 0;
    color:var(--sheet-text-muted);
    font-size: 12px;
    line-height: 1.55;
  }
  .usage-note svg { width: 14px; height: 14px; flex: 0 0 auto; margin-top: 1px; }

  @media (max-width: 639px) {
    .title-group { gap: 10px; }
    .title-icon { width: 34px; height: 34px; border-radius: 10px; }
    .title-icon svg { width: 17px; height: 17px; }
    .metric-card { padding: 14px; }
    .metric-card dt { gap: 5px; font-size: 11px; }
    .metric-card dd { margin-top: 7px; font-size: 22px; }
    .detail-list { margin-top: 11px; }
    .detail-list > div { grid-template-columns: minmax(100px, .85fr) minmax(0, 1.15fr); gap: 10px; padding: 12px 0; }
    .usage-note { margin-top: 11px; }
  }

  @media (max-width: 359px) {
    .metric-grid { grid-template-columns: 1fr; }
  }

</style>
