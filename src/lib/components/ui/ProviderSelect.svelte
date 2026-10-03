<script lang="ts">
  import BottomSheet from './BottomSheet.svelte';
  import { onMount, tick, type Snippet } from 'svelte';
  import { registerBackHandler } from '$lib/stores/navigation';
  import * as m from '$lib/paraglide/messages';

  type Item = { id: string; label: string; badge: string };
  let { items, selectedId, icon, onSelect }: {
    items: Item[]; selectedId: string; icon: Snippet<[string]>; onSelect: (id: string) => void;
  } = $props();
  const uid = $props.id();
  let open = $state(false);
  let mobile = $state(false);
  onMount(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const sync = () => mobile = query.matches;
    sync(); query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });
  let trigger: HTMLButtonElement;
  let panel = $state<HTMLDivElement>();
  let list = $state<HTMLDivElement>();
  let focused = $state(0);
  let position = $state('');
  const selected = $derived(items.find(item => item.id === selectedId) ?? items[items.length - 1]);

  async function show(index = items.findIndex(item => item.id === selectedId)) {
    const bounds = trigger.getBoundingClientRect();
    const height = Math.min(396, window.innerHeight - 24);
    const below = window.innerHeight - bounds.bottom - 12;
    const top = below >= height ? bounds.bottom + 6 : Math.max(12, bounds.top - height - 6);
    position = `left:${bounds.left}px;top:${top}px;width:${bounds.width}px;max-height:${height}px`;
    focused = Math.max(0, index);
    open = true;
    await tick();
    focusOption();
  }

  function focusOption() {
    const option = list?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focused];
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  }
  function close(restore = true) { open = false; if (restore) trigger?.focus({ preventScroll: true }); }
  function choose(id: string) { onSelect(id); close(); }
  function keydown(event: KeyboardEvent) {
    if (!open) return;
    if (!mobile && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') { if (!mobile) close(false); return; }
    if (!list?.contains(event.target as Node)) return;
    let next = focused;
    if (event.key === 'ArrowDown') next = (focused + 1) % items.length;
    else if (event.key === 'ArrowUp') next = (focused + items.length - 1) % items.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = items.length - 1;
    else if (event.key.length === 1 && /\S/.test(event.key)) {
      const match = items.findIndex((_, offset) => items[(focused + offset + 1) % items.length].label.toLowerCase().startsWith(event.key.toLowerCase()));
      if (match < 0) return;
      next = (focused + match + 1) % items.length;
    } else return;
    event.preventDefault(); focused = next; focusOption();
  }
  function outside(event: PointerEvent) {
    if (open && !mobile && !panel?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close(false);
  }
  $effect(() => {
    if (!open || mobile) return;
    const unregister = registerBackHandler(() => { close(); return true; });
    const scroll = (event: Event) => {
      if (!window.matchMedia('(max-width: 767px)').matches && event.target instanceof Node && !panel?.contains(event.target)) close(false);
    };
    window.addEventListener('scroll', scroll, true);
    return () => { unregister(); window.removeEventListener('scroll', scroll, true); };
  });
</script>

<svelte:window onpointerdown={outside} onkeydown={keydown} onresize={() => !mobile && open && close()} />

<button bind:this={trigger} type="button" class="settings-input provider-trigger" class:expanded={open}
  aria-label={`${m.settings_provider_label()}: ${selected.label}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-list` : undefined}
  onclick={() => open ? close() : show()} onkeydown={(event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void show(); }
  }}>
  <span class="provider-icon">{@render icon(selected.id)}</span>
  <span class="provider-name">{selected.label}</span><span class="provider-badge">{selected.badge}</span>
  <svg class:rotated={open} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
</button>
{#snippet options(chooseItem: (id: string) => void = choose)}
    <div bind:this={list} id={`${uid}-list`} class="provider-list" role="listbox" aria-label={m.settings_provider_label()}>
      {#each items as item, index (item.id)}
        <button type="button" role="option" aria-selected={item.id === selectedId} tabindex={index === focused ? 0 : -1}
          class="provider-option" class:selected={item.id === selectedId} onfocus={() => focused = index} onclick={() => chooseItem(item.id)}>
          <span class="provider-icon">{@render icon(item.id)}</span><span class="provider-name">{item.label}</span><span class="provider-badge">{item.badge}</span>
          <span class="provider-check">{#if item.id === selectedId}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>{/if}</span>
        </button>
      {/each}
    </div>
{/snippet}
{#if open}
  {#if mobile}
    <BottomSheet onClose={() => close()} label={m.settings_provider_label()} breakpoint={768}>
      {#snippet children(dismiss)}
        <div bind:this={panel} class="provider-sheet-content">
          {@render options(id => dismiss(() => choose(id)))}
        </div>
      {/snippet}
    </BottomSheet>
  {:else}
    <div bind:this={panel} class="provider-panel" style={position}>{@render options()}</div>
  {/if}
{/if}

<style>
  .provider-trigger { display:flex; align-items:center; gap:12px; min-height:46px; text-align:left; cursor:pointer; }
  .provider-trigger:hover,.provider-trigger.expanded { border-color:rgba(212,180,131,.35); background:rgba(212,180,131,.04); }
  .provider-icon { width:30px; height:30px; flex:0 0 auto; display:grid; place-items:center; border-radius:8px; background:rgba(212,180,131,.075); color:#c3ac8a; }
  .provider-name { flex:1; min-width:0; font-size:13px; font-weight:600; }
  .provider-badge { flex:0 0 auto; color:#85858b; font-size:11px; }
  .provider-trigger > svg { flex:0 0 auto; color:#8d8b87; transition:transform .15s; }
  .rotated { transform:rotate(180deg); }
  .provider-panel { position:fixed; z-index:81; display:flex; flex-direction:column; padding:5px; overflow:hidden; border:1px solid rgba(255,255,255,.1); border-radius:14px; background:#1c1c1e; box-shadow:0 12px 32px rgba(0,0,0,.4); }
  .provider-panel .provider-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#494540 transparent; }
  .provider-option { width:100%; min-height:46px; display:flex; align-items:center; gap:12px; padding:7px 10px; border-radius:9px; text-align:left; color:var(--sheet-text); cursor:pointer; transition:background .14s,color .14s; }
  .provider-option:hover { background:var(--sheet-surface-hover); color:#eeeae4; }
  .provider-option.selected { background:var(--sheet-selected); color:#dfc69f; }
  .provider-check { width:16px; flex:0 0 auto; color:#d4b483; }
  .provider-trigger:focus-visible,.provider-option:focus-visible { outline:2px solid #d4b483; outline-offset:-2px; }
  @media (max-width:767px) {
    .provider-trigger { min-height:54px; }
    .provider-option { min-height:62px; padding:12px; border-radius:14px; }
    .provider-option .provider-icon { width:36px; height:36px; border-radius:11px; }
    .provider-list { display:grid; gap:4px; }
    .provider-option:active { background:rgba(212,180,131,.15); }
    .provider-option .provider-name { font-size:14px; }
  }
</style>
