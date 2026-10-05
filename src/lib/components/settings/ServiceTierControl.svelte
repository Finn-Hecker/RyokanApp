<script lang="ts">
  import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
  import { createListbox } from '$lib/utils/listbox.svelte';
  import type { ApiConnection } from '$lib/stores/appState.svelte';
  import { supportedServiceTiers, type ServiceTier } from '$lib/utils/generationCapabilities';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import * as m from '$lib/paraglide/messages';

  let { connection }: { connection: ApiConnection } = $props();

  const tiers: ServiceTier[] = ['auto', 'standard', 'flex'];
  const labels: Record<ServiceTier, string> = {
    auto: 'Auto',
    standard: 'Standard',
    flex: 'Flex',
  };
  const supportedTiers = $derived(supportedServiceTiers(connection));

  let trigger = $state<HTMLButtonElement | null>(null);
  let optionList = $state<HTMLDivElement | null>(null);
  const listbox = createListbox({
    trigger: () => trigger, optionList: () => optionList,
    optionCount: () => tiers.length,
  });
  const open = $derived(listbox.open);
  const mobile = $derived(listbox.mobile);
  const popupStyle = $derived(listbox.popupStyle);
  const { portal, toggle, handleTriggerKeydown, handleOptionKeydown, handleWindowKeydown } = listbox;

  function select(tier: ServiceTier) {
    connection.serviceTier = tier;
    listbox.close(true);
  }

</script>

{#snippet options(choose: (value: ServiceTier) => void = select)}
        <div class="tier-options">
          {#each tiers as tier, index}
            <button
              type="button"
              class="tier-option"
              class:tier-option--selected={connection.serviceTier === tier}
              role="option"
              aria-selected={connection.serviceTier === tier}
              tabindex={connection.serviceTier === tier ? 0 : -1}
              onclick={() => choose(tier)}
              onkeydown={(event) => handleOptionKeydown(event, index)}
            >
              <span>{labels[tier]}</span>
              {#if connection.serviceTier === tier}
                <span class="selected-mark" aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round" /></svg></span>
              {/if}
            </button>
          {/each}
        </div>

{/snippet}


<svelte:window onclick={() => { if (!mobile) listbox.close(); }} onkeydown={handleWindowKeydown} />

<div class="tier-control">
  <div class="tier-header">
    <span class="settings-label">{m.settings_service_tier_label()}</span>
    <Tooltip width={300}>{m.settings_service_tier_hint()}</Tooltip>
  </div>

  <button
    bind:this={trigger}
    type="button"
    class="tier-trigger"
    class:tier-trigger--open={open}
    aria-haspopup="listbox"
    aria-expanded={open}
    onclick={toggle}
    onkeydown={handleTriggerKeydown}
  >
    <span class="trigger-value">{labels[connection.serviceTier]}</span>
    <span class="trigger-icon" class:trigger-icon--open={open} aria-hidden="true">
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>
  </button>

  {#if !supportedTiers.includes(connection.serviceTier)}
    <p class="tier-warning" role="status">{m.settings_service_tier_unsupported()}</p>
  {/if}

  {#if open}
      {#if mobile}
        <BottomSheet onClose={() => listbox.close(true)} label={m.settings_service_tier_label()} breakpoint={768}>
          {#snippet children(dismiss)}
            <div bind:this={optionList}  role="listbox" aria-label={m.settings_service_tier_label()} tabindex="-1">
              {@render options(value => dismiss(() => select(value)))}
            </div>
          {/snippet}
        </BottomSheet>
      {:else}
        <div use:portal class="tier-layer">
          <div bind:this={optionList} class="tier-popup" style={popupStyle} role="listbox" aria-label={m.settings_service_tier_label()} tabindex="-1">
            {@render options()}
          </div>
        </div>
      {/if}

  {/if}
</div>

<style>
  .tier-header { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
  .tier-header .settings-label { display:block; margin:0; color:#68686d; font-size:11px; font-weight:650; letter-spacing:.055em; text-transform:uppercase; }
  .tier-trigger { width:100%; min-height:52px; display:flex; align-items:center; justify-content:space-between; gap:14px; padding:9px 11px 9px 14px; border:1px solid rgba(255,255,255,.07); border-radius:12px; background:rgba(255,255,255,.025); color:#d1d1d6; font:inherit; text-align:left; cursor:pointer; transition:border-color .15s ease,background .15s ease,box-shadow .15s ease; }
  .tier-trigger:hover { border-color:rgba(255,255,255,.13); background:rgba(255,255,255,.04); }
  .tier-trigger:focus-visible { outline:2px solid rgba(212,180,131,.5); outline-offset:2px; }
  .tier-trigger--open { border-color:rgba(212,180,131,.36); background:rgba(212,180,131,.055); box-shadow:0 0 0 3px rgba(212,180,131,.045); }
  .trigger-value { overflow:hidden; color:#e0e0e4; font-size:13.5px; font-weight:620; text-overflow:ellipsis; white-space:nowrap; }
  .trigger-icon { width:30px; height:30px; display:grid; place-items:center; flex:0 0 auto; border-radius:9px; background:rgba(255,255,255,.04); color:#737378; transition:transform .16s ease,color .16s ease,background .16s ease; }
  .trigger-icon--open { transform:rotate(180deg); background:rgba(212,180,131,.09); color:#d4b483; }
  .tier-warning { margin:8px 2px 0; color:#d19a67; font-size:11px; line-height:1.45; }
  :global(.tier-layer) { position:fixed; z-index:1100; inset:0; pointer-events:none; }
  :global(.tier-popup) { position:fixed; pointer-events:auto; overflow:hidden; padding:6px; border:1px solid rgba(255,255,255,.09); border-radius:13px; background:#242426; box-shadow:0 16px 40px rgba(0,0,0,.42),0 0 0 1px rgba(0,0,0,.2); animation:tier-pop-in .14s cubic-bezier(.22,.8,.3,1); transform-origin:top center; }
  :global(.tier-options) { display:grid; gap:2px; }
  :global(.tier-option) { width:100%; min-height:42px; display:flex; align-items:center; justify-content:space-between; gap:16px; padding:9px 11px; border:0; border-radius:9px; background:transparent; color:var(--sheet-text-muted); font:inherit; font-size:13px; font-weight:570; text-align:left; cursor:pointer; transition:background .12s ease,color .12s ease; }
  :global(.tier-option:hover), :global(.tier-option:focus-visible) { outline:0; background:var(--sheet-surface-hover); color:#e7e7ea; }
  :global(.tier-option--selected) { background:var(--sheet-selected); color:#dfc69f; }
  :global(.tier-option--selected:hover), :global(.tier-option--selected:focus-visible) { background:rgba(212,180,131,.14); color:#ead3b0; }
  :global(.selected-mark) { display:grid; place-items:center; color:#d4b483; }
  @keyframes tier-pop-in { from { opacity:.65; transform:translateY(-4px) scale(.98); } }

  @media (max-width:767px) {
    .tier-trigger { min-height:48px; padding:8px 10px; border-radius:12px; }
    .trigger-value { font-size:14px; }
    .trigger-icon { width:34px; height:34px; border-radius:10px; }
    :global(.tier-options) { gap:4px; }
    :global(.tier-option) { min-height:44px; padding:9px 10px; border-radius:10px; font-size:14px; }
  }

  @media (prefers-reduced-motion:reduce) {
    :global(.tier-popup) { animation-duration:.01ms; }
    .trigger-icon { transition-duration:.01ms; }
  }
</style>
