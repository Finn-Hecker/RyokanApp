<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import type { ProviderKind } from '$lib/stores/appState.svelte';
  import type { ModelInfo } from '$lib/utils/settings';
  import { curatedProviderGroupForModel, curatedProviderGroups } from '$lib/utils/modelProviderGroups';

  let {
    models, metadata, selectedModel, providerKind, loading, error, onSelect, onRetry, onClose,
  }: {
    models: string[];
    metadata: Record<string, ModelInfo>;
    selectedModel: string;
    providerKind: ProviderKind;
    loading: boolean;
    error: string;
    onSelect: (model: string) => void;
    onRetry: () => void;
    onClose: () => void;
  } = $props();

  const FAVORITES_KEY = 'ryokan-favorite-models';
  let favorites = $state<string[]>([]);
  let search = $state('');
  let category = $state('all');
  let shown = $state(50);

  onMount(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITES_KEY) ?? '[]');
      if (Array.isArray(stored)) favorites = stored.filter((value): value is string => typeof value === 'string');
    } catch { favorites = []; }
  });

  function isFree(model: string): boolean {
    const price = metadata[model]?.pricing;
    const prompt = price?.prompt?.trim();
    const completion = price?.completion?.trim();
    return Boolean(prompt && completion) && Number(prompt) === 0 && Number(completion) === 0;
  }

  const categories = $derived.by(() => {
    const groups = new Set(models.map(model => curatedProviderGroupForModel(metadata[model] ?? { id: model })?.id));
    return [
      { id: 'all', label: m.settings_model_category_all() },
      ...(models.some(isFree) ? [{ id: 'free', label: m.settings_model_category_free() }] : []),
      ...(models.some(model => favorites.includes(model)) ? [{ id: 'favorites', label: m.settings_model_category_favorites() }] : []),
      ...curatedProviderGroups.filter(group => groups.has(group.id)).map(group => ({ id: group.id, label: group.label })),
      ...(groups.has(undefined) ? [{ id: 'others', label: m.settings_model_category_others() }] : []),
    ];
  });

  const filtered = $derived(models.filter(model => {
    if (search && !model.toLowerCase().includes(search.trim().toLowerCase())) return false;
    if (search || category === 'all') return true;
    if (category === 'free') return isFree(model);
    if (category === 'favorites') return favorites.includes(model);
    const group = curatedProviderGroupForModel(metadata[model] ?? { id: model })?.id;
    return category === 'others' ? !group : group === category;
  }));

  function toggleFavorite(model: string) {
    favorites = favorites.includes(model) ? favorites.filter(id => id !== model) : [...favorites, model];
    if (category === 'favorites' && !models.some(id => favorites.includes(id))) category = 'all';
    try { localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites)); } catch { /* Session-only favorites. */ }
  }

  function providerLabel(model: string): string {
    const group = curatedProviderGroupForModel(metadata[model] ?? { id: model });
    return group?.label ?? model.split('/')[0];
  }

  function contextLabel(model: string): string {
    if (providerKind !== 'openrouter') return '';
    const context = metadata[model]?.contextLength;
    return context ? `${Math.round(context / 1024)}K context` : '';
  }

  function priceLabel(model: string): string {
    if (providerKind !== 'openrouter' || isFree(model)) return '';
    const price = metadata[model]?.pricing;
    if (!price?.prompt || !price?.completion) return '';
    const input = Number(price.prompt) * 1_000_000;
    const output = Number(price.completion) * 1_000_000;
    return Number.isFinite(input) && Number.isFinite(output)
      ? `$${input.toFixed(2)}/M input · $${output.toFixed(2)}/M output` : '';
  }

  function scrollList(event: Event) {
    const node = event.currentTarget as HTMLElement;
    if (node.scrollTop + node.clientHeight >= node.scrollHeight - 240) shown = Math.min(shown + 50, filtered.length);
  }
</script>

<div class="picker-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) onClose(); }}></div>
<div class="picker-dialog" role="dialog" aria-modal="true" aria-labelledby="chat-model-picker-title">
  <div class="picker-handle" aria-hidden="true"></div>
  <header class="picker-header">
    <div>
      <h2 id="chat-model-picker-title">{m.settings_model_select_title()}</h2>
      <p>{m.settings_model_available_count({ count: String(models.length) })}</p>
    </div>
    <button type="button" class="close-button" aria-label={m.settings_model_close()} onclick={onClose}>×</button>
  </header>
  <div class="picker-controls">
    <input class="search-input" type="search" bind:value={search} oninput={() => shown = 50} placeholder={m.settings_model_search_placeholder()} aria-label={m.settings_model_search_placeholder()} />
    <div class="category-list" role="tablist" aria-label={m.settings_model_categories()}>
      {#each categories as item (item.id)}
        <button type="button" role="tab" aria-selected={category === item.id} class:active={category === item.id} onclick={() => { category = item.id; shown = 50; }}>{item.label}</button>
      {/each}
    </div>
  </div>
  <div class="model-list" role="listbox" aria-label={m.settings_model_label()} onscroll={scrollList}>
    {#if loading}
      <div class="empty-state">{m.settings_model_loading()}</div>
    {:else if error}
      <div class="empty-state">{error}<button type="button" onclick={onRetry}>{m.chat_retry()}</button></div>
    {:else if !filtered.length}
      <div class="empty-state">{m.settings_model_search_empty()}</div>
    {:else}
      {#each filtered.slice(0, shown) as model (model)}
        <div class="model-row" class:selected={selectedModel === model}>
          <button type="button" class="model-choice" role="option" aria-selected={selectedModel === model} onclick={() => onSelect(model)}>
            <strong>{model}</strong>
            <span class="model-meta">
              <span>{providerLabel(model)}</span>
              {#if isFree(model)}<span class="free-badge">{m.settings_model_category_free()}</span>{/if}
              {#if priceLabel(model)}<span>{priceLabel(model)}</span>{/if}
              {#if contextLabel(model)}<span>{contextLabel(model)}</span>{/if}
            </span>
          </button>
          {#if selectedModel === model}<span class="selected-check" aria-hidden="true">✓</span>{/if}
          <button type="button" class="favorite-button" class:favorite={favorites.includes(model)} aria-label={favorites.includes(model) ? m.settings_model_unfavorite({ model }) : m.settings_model_favorite({ model })} aria-pressed={favorites.includes(model)} onclick={() => toggleFavorite(model)}>{favorites.includes(model) ? '★' : '☆'}</button>
        </div>
      {/each}
    {/if}
  </div>
</div>

<style>
  .picker-backdrop { position:fixed; inset:0; z-index:1; background:rgba(0,0,0,.65); backdrop-filter:blur(4px); }
  .picker-dialog { position:fixed; z-index:2; top:50%; left:50%; transform:translate(-50%,-50%); width:min(920px,calc(100vw - 64px)); height:min(720px,calc(100dvh - 64px)); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(255,255,255,.1); border-radius:22px; background:#18181a; box-shadow:0 20px 60px rgba(0,0,0,.5); }
  .picker-handle { display:none; }
  .picker-header { display:flex; align-items:center; justify-content:space-between; gap:20px; padding:20px 22px 14px; border-bottom:1px solid rgba(255,255,255,.06); }
  .picker-header h2 { margin:0; color:#eeeae4; font-size:21px; font-weight:680; }
  .picker-header p { margin:4px 0 0; color:#77777c; font-size:11px; }
  .close-button { width:38px; height:38px; flex:0 0 auto; border:0; border-radius:11px; background:rgba(255,255,255,.045); color:#aaa; font-size:25px; line-height:1; cursor:pointer; }
  .picker-controls { padding:12px 18px; border-bottom:1px solid rgba(255,255,255,.06); }
  .search-input { width:100%; height:42px; padding:0 12px; border:1px solid rgba(255,255,255,.08); border-radius:11px; outline:none; background:rgba(0,0,0,.22); color:#eee; font:inherit; font-size:14px; }
  .search-input:focus { border-color:rgba(212,180,131,.45); }
  .category-list { display:flex; gap:7px; margin-top:11px; overflow-x:auto; scrollbar-width:none; }
  .category-list::-webkit-scrollbar { display:none; }
  .category-list button { min-height:36px; flex:0 0 auto; padding:7px 13px; border:1px solid rgba(255,255,255,.07); border-radius:999px; background:rgba(255,255,255,.025); color:#88888d; font:inherit; font-size:12px; font-weight:650; cursor:pointer; }
  .category-list button.active { border-color:rgba(212,180,131,.42); background:rgba(212,180,131,.12); color:#dfc69f; }
  .model-list { min-height:0; flex:1; overflow-y:auto; padding:10px 14px calc(16px + env(safe-area-inset-bottom)); overscroll-behavior:contain; }
  .model-row { min-height:70px; display:flex; align-items:center; gap:6px; margin-bottom:6px; border:1px solid rgba(255,255,255,.045); border-radius:13px; background:rgba(255,255,255,.015); }
  .model-row.selected { border-color:rgba(212,180,131,.3); background:rgba(212,180,131,.08); }
  .model-choice { min-width:0; flex:1; display:flex; flex-direction:column; justify-content:center; align-items:flex-start; gap:8px; padding:13px 14px; border:0; background:none; color:#ddd; text-align:left; cursor:pointer; }
  .model-choice strong { max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-size:15px; font-weight:620; }
  .model-meta { display:flex; flex-wrap:wrap; gap:8px; color:#77777c; font-size:10px; }
  .model-meta > span + span::before { content:'·'; margin-right:8px; color:#555; }
  .free-badge { color:#76c991; font-weight:700; text-transform:uppercase; }
  .selected-check { color:#d4b483; font-size:18px; }
  .favorite-button { width:40px; height:40px; flex:0 0 auto; margin-right:8px; border:0; border-radius:9px; background:none; color:#666; font-size:25px; cursor:pointer; }
  .favorite-button.favorite { color:#d4b483; }
  .empty-state { display:flex; flex-direction:column; align-items:center; gap:12px; padding:55px 12px; color:#999; font-size:13px; text-align:center; overflow-wrap:anywhere; }
  .empty-state button { padding:8px 14px; border:1px solid rgba(212,180,131,.35); border-radius:8px; color:#d4b483; }
  @media (max-width:767px) {
    .picker-dialog { top:auto; bottom:0; left:0; transform:none; width:100%; height:min(86dvh,760px); max-height:calc(100dvh - env(safe-area-inset-top) - 8px); border-radius:22px 22px 0 0; }
    .picker-handle { display:block; width:38px; height:4px; flex:0 0 auto; margin:9px auto 2px; border-radius:999px; background:rgba(255,255,255,.14); }
    .picker-header { padding:8px 16px 11px 20px; }
    .picker-header h2 { font-size:20px; }
    .picker-controls { padding:8px 16px 10px; }
    .search-input { height:46px; font-size:16px; }
    .category-list button { min-height:38px; }
    .model-list { padding:8px 10px calc(14px + env(safe-area-inset-bottom)); }
    .model-row { min-height:58px; margin-bottom:2px; border-color:transparent; }
    .model-choice { padding:10px 12px; }
    .model-choice strong { font-size:13px; }
    .model-meta { gap:6px; }
  }
</style>
