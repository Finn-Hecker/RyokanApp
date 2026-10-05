<script lang="ts" generics="Value extends string">
  import BottomSheet from './BottomSheet.svelte';
  import { onMount, tick, type Snippet } from 'svelte';
  import { registerBackHandler } from '$lib/stores/navigation';

  type Item = { id: Value; label: string; badge?: string; separator?: boolean };
  let { items, value = $bindable(), label, id, icon, onSelect, disabled = false, compact = false }: {
    items: Item[]; value?: Value; label: string; id?: string; icon?: Snippet<[Value]>;
    onSelect?: (id: Value) => void; disabled?: boolean; compact?: boolean;
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
  const selected = $derived(items.find(item => item.id === value));

  async function show(index = items.findIndex(item => item.id === value)) {
    if (disabled || !items.length) return;
    const bounds = trigger.getBoundingClientRect();
    const height = Math.min(396, items.length * 46 + 20, window.innerHeight - 24);
    const below = window.innerHeight - bounds.bottom - 12;
    const top = below >= height ? bounds.bottom + 6 : Math.max(12, bounds.top - height - 6);
    const width = Math.min(Math.max(bounds.width, 200), window.innerWidth - 24);
    const left = Math.max(12, Math.min(bounds.left, window.innerWidth - width - 12));
    position = `left:${left}px;top:${top}px;width:${width}px;max-height:${height}px`;
    focused = Math.max(0, index);
    open = true;
    await tick();
    if (!open || disabled) return;
    if (!mobile) panel?.showPopover();
    focusOption();
  }

  function focusOption() {
    const option = list?.querySelectorAll<HTMLButtonElement>('[role="option"]')[focused];
    option?.focus({ preventScroll: true });
    option?.scrollIntoView({ block: 'nearest' });
  }
  function close(restore = true) { open = false; if (restore) trigger?.focus({ preventScroll: true }); }
  function choose(id: Value) { value = id; onSelect?.(id); close(); }
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
  $effect(() => { if (disabled && open) close(false); });
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

<button bind:this={trigger} type="button" id={id} {disabled} class="settings-input select-trigger" class:compact class:expanded={open}
  aria-label={`${label}: ${selected?.label ?? ''}`} aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? `${uid}-list` : undefined}
  onclick={() => open ? close() : show()} onkeydown={(event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); void show(); }
  }}>
  {#if icon && selected}<span class="select-icon">{@render icon(selected.id)}</span>{/if}
  <span class="select-name">{selected?.label ?? ''}</span>{#if selected?.badge}<span class="select-badge">{selected.badge}</span>{/if}
  <svg class:rotated={open} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
</button>
{#snippet options(chooseItem: (id: Value) => void = choose)}
    <div bind:this={list} id={`${uid}-list`} class="select-list" role="listbox" aria-label={label}>
      {#each items as item, index (item.id)}
        <button type="button" role="option" aria-selected={item.id === value} tabindex={index === focused ? 0 : -1}
          class="select-option" class:separated={item.separator} class:selected={item.id === value} onfocus={() => focused = index} onclick={() => chooseItem(item.id)}>
          {#if icon}<span class="select-icon">{@render icon(item.id)}</span>{/if}<span class="select-name">{item.label}</span>{#if item.badge}<span class="select-badge">{item.badge}</span>{/if}
          <span class="select-check">{#if item.id === value}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4L19 6"/></svg>{/if}</span>
        </button>
      {/each}
    </div>
{/snippet}
{#if open}
  {#if mobile}
    <BottomSheet onClose={() => close()} label={label} breakpoint={768}>
      {#snippet children(dismiss)}
        <div bind:this={panel} class="select-sheet-content">
          {@render options(id => dismiss(() => choose(id)))}
        </div>
      {/snippet}
    </BottomSheet>
  {:else}
    <div bind:this={panel} class="select-panel" popover="manual" style={position}>{@render options()}</div>
  {/if}
{/if}

<style>
  .select-trigger { display:flex; align-items:center; gap:12px; min-width:0; min-height:46px; text-align:left; cursor:pointer; }
  .select-trigger:hover:not(:disabled),.select-trigger.expanded { border-color:rgba(212,180,131,.35); background:rgba(212,180,131,.04); }
  .select-icon { width:30px; height:30px; flex:0 0 auto; display:grid; place-items:center; border-radius:8px; background:rgba(212,180,131,.075); color:#c3ac8a; }
  .select-name { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:13px; font-weight:600; }
  .select-badge { flex:0 0 auto; color:#85858b; font-size:11px; }
  .select-trigger > svg { flex:0 0 auto; color:#8d8b87; transition:transform .15s; }
  .rotated { transform:rotate(180deg); }
  .select-panel { position:fixed; inset:auto; margin:0; box-sizing:border-box; z-index:81; display:flex; flex-direction:column; padding:5px; overflow:hidden; border:1px solid rgba(255,255,255,.1); border-radius:14px; background:#1c1c1e; box-shadow:0 12px 32px rgba(0,0,0,.4); }
  .select-panel .select-list { min-height:0; overflow-y:auto; overscroll-behavior:contain; scrollbar-width:thin; scrollbar-color:#494540 transparent; }
  .select-option { width:100%; min-height:46px; display:flex; align-items:center; gap:12px; padding:7px 10px; border-radius:9px; text-align:left; color:var(--sheet-text); cursor:pointer; transition:background .14s,color .14s; }
  .select-option:hover { background:var(--sheet-surface-hover); color:#eeeae4; }
  .select-option.selected { background:var(--sheet-selected); color:#dfc69f; }
  .select-check { width:16px; flex:0 0 auto; color:#d4b483; }
  .select-trigger:focus-visible,.select-option:focus-visible { outline:2px solid #d4b483; outline-offset:-2px; }
  .select-trigger:disabled { opacity:.45; cursor:default; }
  .select-trigger.compact { min-height:36px; padding:8px 11px; font-size:12px; }
  .compact .select-name { font-size:12px; }
  .select-option.separated { border-top:1px solid var(--sheet-divider); margin-top:4px; border-top-left-radius:0; border-top-right-radius:0; }
  @media (max-width:767px) {
    .select-trigger { min-height:48px; }
    .select-trigger.compact { min-height:44px; }
    .select-option { min-height:44px; padding:8px 10px; border-radius:10px; }
    .select-option .select-icon { width:28px; height:28px; border-radius:8px; }
    .select-list { display:grid; gap:4px; }
    .select-option:active { background:rgba(212,180,131,.15); }
    .select-option .select-name { font-size:14px; }
  }
</style>
