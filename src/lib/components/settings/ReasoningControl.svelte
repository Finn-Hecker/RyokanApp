<script lang="ts">
  import { onMount, tick } from 'svelte';
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
  const selectedLevel = $derived(capability?.levels.includes(connection.reasoningLevel) ? connection.reasoningLevel : 'auto');

  let open = $state(false);
  let mobile = $state(false);
  let trigger = $state<HTMLButtonElement | null>(null);
  let optionList = $state<HTMLDivElement | null>(null);
  let popupStyle = $state('');

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function updatePopupPosition() {
    if (!trigger || mobile) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = Math.max(220, rect.width);
    const left = Math.min(Math.max(rect.left, viewportLeft + 12), viewportLeft + viewportWidth - width - 12);
    const estimatedHeight = (capability?.levels.length ?? 1) * 44 + 14;
    const roomBelow = viewportTop + viewportHeight - rect.bottom;
    const top = roomBelow >= estimatedHeight + 12
      ? rect.bottom + 7
      : Math.max(viewportTop + 12, rect.top - estimatedHeight - 7);
    popupStyle = `left:${left}px;top:${top}px;width:${width}px`;
  }

  async function show() {
    open = true;
    updatePopupPosition();
    await tick();
    updatePopupPosition();
    optionList?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    if (open) open = false;
    else void show();
  }

  function select(level: ReasoningLevel) {
    connection.reasoningLevel = level;
    onChange();
    open = false;
    void tick().then(() => trigger?.focus());
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) void show();
    }
  }

  function handleOptionKeydown(event: KeyboardEvent, index: number) {
    if (!capability) return;
    const options = Array.from(optionList?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      options[(index + offset + options.length) % options.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
      void tick().then(() => trigger?.focus());
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      open = false;
      void tick().then(() => trigger?.focus());
    }
  }

  onMount(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const syncViewport = () => {
      mobile = query.matches;
      if (open) updatePopupPosition();
    };
    syncViewport();
    query.addEventListener('change', syncViewport);
    window.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('resize', syncViewport);
    return () => {
      query.removeEventListener('change', syncViewport);
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
    };
  });
</script>

<svelte:window onclick={() => (open = false)} onkeydown={handleWindowKeydown} />

{#if capability}
  <div class="reasoning-control">
    <div class="reasoning-header">
      <span class="settings-label">{m.settings_reasoning_label()}</span>
      <Tooltip>{m.settings_reasoning_auto_hint()}</Tooltip>
      {#if capability.certainty === 'unknown_levels'}
        <Tooltip variant="warning" ariaLabel={m.settings_reasoning_uncertain()} width={280}>
          {m.settings_reasoning_uncertain()}
        </Tooltip>
      {/if}
    </div>

    <button
      bind:this={trigger}
      type="button"
      class="reasoning-trigger"
      class:reasoning-trigger--open={open}
      aria-haspopup="listbox"
      aria-expanded={open}
      onclick={toggle}
      onkeydown={handleTriggerKeydown}
    >
      <span class="trigger-copy">
        <span class="trigger-value">{labels[selectedLevel]}</span>
        {#if selectedLevel === 'auto'}<span class="trigger-hint">{m.settings_reasoning_auto_hint()}</span>{/if}
      </span>
      <span class="trigger-icon" class:trigger-icon--open={open} aria-hidden="true">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
      </span>
    </button>

    {#if open}
      <div use:portal class="reasoning-layer" class:reasoning-layer--mobile={mobile}>
        {#if mobile}<button type="button" class="reasoning-backdrop" aria-label={m.settings_reasoning_label()} onclick={() => (open = false)}></button>{/if}
        <div
          bind:this={optionList}
          class="reasoning-popup"
          class:reasoning-popup--mobile={mobile}
          style={mobile ? '' : popupStyle}
          role="listbox"
          aria-label={m.settings_reasoning_label()}
          tabindex="-1"
        >
          {#if mobile}
            <div class="sheet-handle" aria-hidden="true"></div>
            <div class="sheet-title">{m.settings_reasoning_label()}</div>
          {/if}
          <div class="reasoning-options">
            {#each capability.levels as level, index}
              <button
                type="button"
                class="reasoning-option"
                class:reasoning-option--selected={selectedLevel === level}
                role="option"
                aria-selected={selectedLevel === level}
                tabindex={selectedLevel === level ? 0 : -1}
                onclick={() => select(level)}
                onkeydown={(event) => handleOptionKeydown(event, index)}
              >
                <span>{labels[level]}</span>
                {#if selectedLevel === level}
                  <span class="selected-mark" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
                {/if}
              </button>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
  <div class="settings-divider"></div>
{/if}

<style>
  .settings-divider { height:1px; margin:20px 0; background:rgba(255,255,255,.06); }
  .reasoning-header { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .reasoning-header .settings-label { display:block; margin:0; color:#68686d; font-size:11px; font-weight:650; letter-spacing:.055em; text-transform:uppercase; }
  :global(.settings-panel) .reasoning-header .settings-label { font-weight:600; letter-spacing:.06em; }
  .reasoning-trigger { width:100%; min-height:52px; display:flex; align-items:center; justify-content:space-between; gap:14px; padding:9px 11px 9px 14px; border:1px solid rgba(255,255,255,.07); border-radius:12px; background:rgba(255,255,255,.025); color:#d1d1d6; font:inherit; text-align:left; cursor:pointer; transition:border-color .15s ease,background .15s ease,box-shadow .15s ease; }
  .reasoning-trigger:hover { border-color:rgba(255,255,255,.13); background:rgba(255,255,255,.04); }
  .reasoning-trigger:focus-visible { outline:2px solid rgba(212,180,131,.5); outline-offset:2px; }
  .reasoning-trigger--open { border-color:rgba(212,180,131,.36); background:rgba(212,180,131,.055); box-shadow:0 0 0 3px rgba(212,180,131,.045); }
  .trigger-copy { min-width:0; display:flex; flex-direction:column; gap:2px; }
  .trigger-value { overflow:hidden; color:#e0e0e4; font-size:13.5px; font-weight:620; text-overflow:ellipsis; white-space:nowrap; }
  .trigger-hint { overflow:hidden; color:#66666b; font-size:10.5px; line-height:1.3; text-overflow:ellipsis; white-space:nowrap; }
  .trigger-icon { width:30px; height:30px; display:grid; place-items:center; flex:0 0 auto; border-radius:9px; background:rgba(255,255,255,.04); color:#737378; transition:transform .16s ease,color .16s ease,background .16s ease; }
  .trigger-icon--open { transform:rotate(180deg); background:rgba(212,180,131,.09); color:#d4b483; }
  :global(.reasoning-layer) { position:fixed; z-index:1100; inset:0; pointer-events:none; }
  :global(.reasoning-popup) { position:fixed; pointer-events:auto; overflow:hidden; padding:6px; border:1px solid rgba(255,255,255,.09); border-radius:13px; background:#242426; box-shadow:0 16px 40px rgba(0,0,0,.42),0 0 0 1px rgba(0,0,0,.2); animation:reasoning-pop-in .14s cubic-bezier(.22,.8,.3,1); transform-origin:top center; }
  :global(.reasoning-options) { display:grid; gap:2px; }
  :global(.reasoning-option) { width:100%; min-height:42px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:9px 11px; border:0; border-radius:9px; background:transparent; color:#a0a0a5; font:inherit; font-size:13px; font-weight:570; text-align:left; cursor:pointer; transition:background .12s ease,color .12s ease; }
  :global(.reasoning-option:hover), :global(.reasoning-option:focus-visible) { outline:0; background:rgba(255,255,255,.055); color:#e7e7ea; }
  :global(.reasoning-option--selected) { background:rgba(212,180,131,.095); color:#dfc69f; }
  :global(.reasoning-option--selected:hover), :global(.reasoning-option--selected:focus-visible) { background:rgba(212,180,131,.14); color:#ead3b0; }
  :global(.selected-mark) { display:grid; place-items:center; color:#d4b483; }
  :global(.reasoning-backdrop) { display:none; }
  :global(.sheet-handle), :global(.sheet-title) { display:none; }
  @keyframes reasoning-pop-in { from { opacity:.65; transform:translateY(-4px) scale(.98); } }

  @media (max-width:767px) {
    .reasoning-trigger { min-height:56px; padding:10px 10px 10px 14px; border-radius:13px; }
    .trigger-value { font-size:14px; }
    .trigger-icon { width:34px; height:34px; border-radius:10px; }
    :global(.reasoning-layer--mobile) { pointer-events:auto; }
    :global(.reasoning-backdrop) { position:absolute; inset:0; display:block; width:100%; border:0; background:rgba(0,0,0,.58); backdrop-filter:blur(2px); animation:reasoning-fade-in .16s ease-out; }
    :global(.reasoning-popup--mobile) { position:absolute; right:10px; bottom:max(10px,env(safe-area-inset-bottom)); left:10px; max-height:min(72dvh,560px); overflow-y:auto; padding:7px 7px 8px; border-radius:19px; background:#202022; box-shadow:0 -10px 36px rgba(0,0,0,.38); animation:reasoning-sheet-in .2s cubic-bezier(.22,.8,.3,1); transform-origin:bottom center; }
    :global(.sheet-handle) { width:36px; height:4px; display:block; margin:2px auto 8px; border-radius:999px; background:rgba(255,255,255,.15); }
    :global(.sheet-title) { display:block; padding:5px 12px 11px; color:#79797e; font-size:11px; font-weight:650; letter-spacing:.055em; text-transform:uppercase; }
    :global(.reasoning-options) { gap:3px; }
    :global(.reasoning-option) { min-height:50px; padding:12px 13px; border-radius:12px; font-size:14px; }
    @keyframes reasoning-fade-in { from { opacity:0; } }
    @keyframes reasoning-sheet-in { from { opacity:.72; transform:translateY(24px); } }
  }

  @media (prefers-reduced-motion:reduce) {
    :global(.reasoning-popup), :global(.reasoning-backdrop) { animation-duration:.01ms; }
    .trigger-icon { transition-duration:.01ms; }
  }
</style>
