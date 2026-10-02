<script lang="ts">
  import { tick, type Snippet } from 'svelte';
  import { registerBackHandler } from '$lib/stores/navigation';
  import * as m from '$lib/paraglide/messages';

  type Item = { id: string; label: string; badge: string };
  let { items, selectedId, icon, onSelect }: {
    items: Item[]; selectedId: string; icon: Snippet<[string]>; onSelect: (id: string) => void;
  } = $props();
  const uid = $props.id();
  let open = $state(false);
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
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (event.key === 'Tab') {
      if (window.matchMedia('(max-width: 767px)').matches) {
        event.preventDefault();
        const targets = [...(panel?.querySelectorAll<HTMLButtonElement>('button') ?? [])];
        const index = targets.indexOf(document.activeElement as HTMLButtonElement);
        targets[(index + (event.shiftKey ? -1 : 1) + targets.length) % targets.length]?.focus();
      } else close(false);
      return;
    }
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
    if (open && !panel?.contains(event.target as Node) && !trigger?.contains(event.target as Node)) close(false);
  }
  $effect(() => {
    if (!open) return;
    const unregister = registerBackHandler(() => { close(); return true; });
    const scroll = (event: Event) => {
      if (!window.matchMedia('(max-width: 767px)').matches && event.target instanceof Node && !panel?.contains(event.target)) close(false);
    };
    window.addEventListener('scroll', scroll, true);
    return () => { unregister(); window.removeEventListener('scroll', scroll, true); };
  });
</script>

<svelte:window onpointerdown={outside} onkeydown={keydown} onresize={() => open && close()} />

<button bind:this={trigger} type="button" class="settings-input provider-trigger" class:expanded={open}
  aria-label={`${m.settings_provider_label()}: ${selected.label}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-list` : undefined}
  onclick={() => open ? close() : show()} onkeydown={(event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void show(); }
  }}>
  <span class="provider-icon">{@render icon(selected.id)}</span>
  <span class="provider-name">{selected.label}</span><span class="provider-badge">{selected.badge}</span>
  <svg class:rotated={open} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
</button>
{#if open}
  <div class="provider-backdrop" aria-hidden="true"></div>
  <div bind:this={panel} class="provider-panel" style={position}>
    <div class="provider-heading"><strong>{m.settings_provider_label()}</strong><button type="button" aria-label={m.settings_connection_cancel()} onclick={() => close()}>×</button></div>
    <div bind:this={list} id={`${uid}-list`} class="provider-list" role="listbox" aria-label={m.settings_provider_label()}>
      {#each items as item, index (item.id)}
        <button type="button" role="option" aria-selected={item.id === selectedId} tabindex={index === focused ? 0 : -1}
          class="provider-option" class:selected={item.id === selectedId} onfocus={() => focused = index} onclick={() => choose(item.id)}>
          <span class="provider-icon">{@render icon(item.id)}</span><span class="provider-name">{item.label}</span><span class="provider-badge">{item.badge}</span>
          <span class="provider-check">{#if item.id === selectedId}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>{/if}</span>
        </button>
      {/each}
    </div>
  </div>
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
  .provider-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#494540 transparent; }
  .provider-option { width:100%; min-height:46px; display:flex; align-items:center; gap:12px; padding:7px 10px; border-radius:9px; text-align:left; color:#c9c7ca; cursor:pointer; transition:background .14s,color .14s; }
  .provider-option:hover { background:rgba(255,255,255,.055); color:#eeeae4; }
  .provider-option.selected { background:rgba(212,180,131,.1); color:#dfc69f; }
  .provider-check { width:16px; flex:0 0 auto; color:#d4b483; }
  .provider-trigger:focus-visible,.provider-option:focus-visible,.provider-heading button:focus-visible { outline:2px solid #d4b483; outline-offset:-2px; }
  .provider-heading,.provider-backdrop { display:none; }
  @media (max-width:767px) {
    .provider-trigger { min-height:54px; }
    .provider-backdrop { display:block; position:fixed; z-index:80; inset:0; background:rgba(0,0,0,.62); backdrop-filter:blur(2px); }
    .provider-panel { left:0 !important; right:0; top:auto !important; bottom:0; width:auto !important; max-height:calc(var(--app-visible-height,100dvh) * .8) !important; padding:8px 10px calc(12px + env(safe-area-inset-bottom)); border-radius:24px 24px 0 0; }
    .provider-heading { display:flex; align-items:center; justify-content:space-between; flex:0 0 auto; padding:4px 6px 10px 10px; color:#eeeae4; font-size:18px; }
    .provider-heading button { width:44px; height:44px; border-radius:12px; background:rgba(255,255,255,.045); color:#a4a1a0; font-size:25px; cursor:pointer; }
    .provider-option { min-height:58px; padding:10px 12px; }
    .provider-option:active { background:rgba(212,180,131,.15); }
    .provider-option .provider-name { font-size:14px; }
  }
</style>
