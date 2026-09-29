<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { registerBackHandler } from '$lib/stores/navigation';
  import { formatCachedUsage, formatUsageCount, formatUsageCost, type TokenUsage } from '$lib/utils/tokenUsage';

  let { usage, swipeIndex, totalVariants, onClose }: {
    usage?: TokenUsage | null;
    swipeIndex: number;
    totalVariants: number;
    onClose: () => void;
  } = $props();

  let dialog: HTMLDialogElement;

  $effect(() => {
    dialog.showModal();
    return registerBackHandler(() => {
      dialog.close();
      return true;
    });
  });

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

  function closeOnBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) dialog.close();
  }
</script>

<dialog
  bind:this={dialog}
  onclose={onClose}
  onclick={closeOnBackdrop}
  aria-labelledby="usage-title"
  aria-describedby="usage-note"
>
  <div class="sheet-handle" aria-hidden="true"></div>

  <header>
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
    <button class="close-button" type="button" onclick={() => dialog.close()} aria-label={m.chat_cancel()}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
        <path d="M6 6l12 12M18 6 6 18"/>
      </svg>
    </button>
  </header>

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
</dialog>

<style>
  dialog {
    width: min(520px, calc(100vw - 32px));
    max-height: min(720px, calc(var(--app-visible-height, 100dvh) - 32px));
    margin: auto;
    padding: 0;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, .09);
    border-radius: 20px;
    background: #18181b;
    color: #e5e5ea;
    box-shadow: 0 24px 80px rgba(0, 0, 0, .58), inset 0 1px 0 rgba(255, 255, 255, .025);
    animation: dialog-in .18s cubic-bezier(.22, .8, .3, 1);
  }

  dialog::backdrop {
    background: rgba(0, 0, 0, .64);
    backdrop-filter: blur(4px);
    animation: backdrop-in .16s ease-out;
  }

  .sheet-handle { display: none; }

  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
    padding: 20px 20px 17px;
    border-bottom: 1px solid rgba(255, 255, 255, .06);
  }

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
  h2 { margin: 0; color: #eeeae4; font-size: 18px; font-weight: 650; letter-spacing: -.01em; }
  .variant-label { margin: 3px 0 0; color: #77777d; font-size: 11px; line-height: 1.35; }

  .close-button {
    display: grid;
    width: 38px;
    height: 38px;
    flex: 0 0 auto;
    place-items: center;
    border: 0;
    border-radius: 11px;
    background: rgba(255, 255, 255, .045);
    color: #929298;
    cursor: pointer;
    transition: background 140ms, color 140ms, transform 100ms;
  }
  .close-button svg { width: 18px; height: 18px; }
  .close-button:hover { background: rgba(255, 255, 255, .08); color: #e5e5ea; }
  .close-button:active { transform: scale(.94); }
  .close-button:focus-visible { outline: 2px solid rgba(212, 180, 131, .55); outline-offset: 2px; }

  .content {
    max-height: calc(min(720px, var(--app-visible-height, 100dvh) - 32px) - 76px);
    padding: 18px 20px 20px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

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
  .metric-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
  .metric-card {
    min-width: 0;
    padding: 12px 13px 13px;
    border: 1px solid rgba(255, 255, 255, .055);
    border-radius: 12px;
    background: rgba(255, 255, 255, .025);
  }
  .metric-card dt { display: flex; min-width: 0; align-items: center; gap: 7px; color: #85858c; font-size: 11px; line-height: 1.3; }
  .metric-card dt > span:last-child { min-width: 0; overflow-wrap: anywhere; }
  .metric-icon { display: grid; width: 17px; height: 17px; flex: 0 0 auto; place-items: center; color: rgba(212, 180, 131, .8); }
  .metric-icon svg { width: 15px; height: 15px; }
  .metric-card dd { margin: 8px 0 0; color: #f0eee9; font-size: 19px; font-weight: 620; line-height: 1.15; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }

  .detail-list {
    margin-top: 14px;
    overflow: hidden;
    border: 1px solid rgba(255, 255, 255, .055);
    border-radius: 12px;
    background: rgba(255, 255, 255, .018);
  }
  .detail-list > div { display: grid; grid-template-columns: minmax(130px, .8fr) minmax(0, 1.2fr); align-items: baseline; gap: 16px; padding: 11px 13px; }
  .detail-list > div + div { border-top: 1px solid rgba(255, 255, 255, .05); }
  .detail-list dt { color: #85858c; font-size: 11px; line-height: 1.4; }
  .detail-list dd { margin: 0; color: #dedee2; font-size: 12px; font-weight: 500; line-height: 1.45; text-align: right; overflow-wrap: anywhere; font-variant-numeric: tabular-nums; }
  dd.unavailable { color: #64646a; font-weight: 450; }
  .metric-card dd.unavailable { font-size: 12px; line-height: 22px; }

  .usage-note {
    display: flex;
    align-items: flex-start;
    gap: 8px;
    margin: 14px 2px 0;
    color: #68686e;
    font-size: 10.5px;
    line-height: 1.55;
  }
  .usage-note svg { width: 14px; height: 14px; flex: 0 0 auto; margin-top: 1px; }

  @keyframes backdrop-in { from { opacity: 0; } }
  @keyframes dialog-in { from { opacity: 0; transform: translateY(6px) scale(.98); } }

  @media (max-width: 639px) {
    dialog {
      width: 100%;
      max-width: none;
      max-height: min(82dvh, calc(var(--app-visible-height, 100dvh) - env(safe-area-inset-top) - 8px));
      margin: auto 0 0;
      border-width: 1px 0 0;
      border-radius: 22px 22px 0 0;
      animation-name: sheet-in;
    }
    .sheet-handle { display: block; width: 36px; height: 4px; margin: 9px auto 1px; border-radius: 999px; background: rgba(255, 255, 255, .15); }
    header { padding: 9px 14px 12px 16px; }
    .title-group { gap: 10px; }
    .title-icon { width: 34px; height: 34px; border-radius: 10px; }
    .title-icon svg { width: 17px; height: 17px; }
    h2 { font-size: 17px; }
    .close-button { width: 40px; height: 40px; }
    .content {
      max-height: calc(min(82dvh, var(--app-visible-height, 100dvh) - env(safe-area-inset-top) - 8px) - 66px);
      padding: 14px 14px calc(14px + env(safe-area-inset-bottom));
    }
    .metric-card { padding: 11px 11px 12px; }
    .metric-card dt { gap: 5px; font-size: 10px; }
    .metric-card dd { margin-top: 7px; font-size: 17px; }
    .detail-list { margin-top: 11px; }
    .detail-list > div { grid-template-columns: minmax(100px, .85fr) minmax(0, 1.15fr); gap: 10px; padding: 10px 11px; }
    .usage-note { margin-top: 11px; }
  }

  @media (max-width: 359px) {
    .metric-grid { grid-template-columns: 1fr; }
  }

  @media (prefers-reduced-motion: reduce) {
    dialog, dialog::backdrop { animation-duration: .01ms; }
  }

  @keyframes sheet-in { from { opacity: .78; transform: translateY(24px); } }
</style>
