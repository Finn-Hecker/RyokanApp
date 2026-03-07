<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount } from 'svelte';
  import { worldInfoState, loadWorldInfos } from '$lib/stores/worldInfoStore.svelte';
  import { DEFAULT_WORLD_INFOS } from '$lib/data/worldInfo';

  let {
    selectedIds = $bindable([])
  }: {
    selectedIds?: string[];
  } = $props();

  onMount(() => loadWorldInfos());

  const defaultIds = new Set(DEFAULT_WORLD_INFOS.map(w => w.id));
  let userWorldInfos = $derived(worldInfoState.allWorldInfos.filter(w => !defaultIds.has(w.id)));

  function toggle(id: string) {
    selectedIds = selectedIds.includes(id)
      ? selectedIds.filter(x => x !== id)
      : [...selectedIds, id];
  }
</script>

<div class="wi-picker">

  <div class="wi-picker__header">
    <span class="wi-picker__label">{m.wi_picker_label()}</span>
    {#if selectedIds.length > 0}
      <span class="wi-picker__count">{m.wi_picker_active_count({ count: selectedIds.length })}</span>
    {/if}
  </div>

  {#if userWorldInfos.length === 0}
    <p class="wi-picker__empty">
      {m.wi_picker_empty_text()}
      <em>{m.wi_picker_empty_link()}</em>.
    </p>
  {:else}
    <div class="wi-picker__list">
      {#each userWorldInfos as wi (wi.id)}
        {@const active = selectedIds.includes(wi.id)}
        {@const beforeCount = wi.entries.filter(e => e.enabled && e.position === 'before').length}
        {@const afterCount  = wi.entries.filter(e => e.enabled && e.position === 'after').length}

        <button
          type="button"
          class="wi-item"
          class:wi-item--active={active}
          onclick={() => toggle(wi.id)}
        >
          <div class="wi-item__icon" class:wi-item__icon--active={active}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="2"
                 stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="2" y1="12" x2="22" y2="12"/>
              <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
            </svg>
          </div>

          <div class="wi-item__info">
            <span class="wi-item__name">{wi.name}</span>
            {#if wi.entries.length > 0}
              <div class="wi-item__pills">
                {#if beforeCount > 0}
                  <span class="entry-pill entry-pill--before">{m.wi_picker_pill_before({ count: beforeCount })}</span>
                {/if}
                {#if afterCount > 0}
                  <span class="entry-pill entry-pill--after">{m.wi_picker_pill_after({ count: afterCount })}</span>
                {/if}
              </div>
            {:else}
              <span class="wi-item__no-entries">{m.wi_picker_no_entries()}</span>
            {/if}
          </div>

          <div class="wi-item__check" class:wi-item__check--visible={active}>
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" stroke-width="3"
                 stroke-linecap="round" stroke-linejoin="round">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          </div>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .wi-picker {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px;
    padding: 4px;
    transition: border-color 0.18s, background 0.18s;
  }

  .wi-picker:focus-within {
    border-color: rgba(var(--accent-rgb,167 139 250)/0.4);
  }

  .wi-picker__header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px 8px;
  }

  .wi-picker__label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #6b7280;
  }

  .wi-picker__count {
    font-size: 10px;
    font-weight: 600;
    color: #818cf8;
    background: rgba(99,102,241,0.12);
    border: 1px solid rgba(99,102,241,0.2);
    border-radius: 8px;
    padding: 1px 7px;
  }

  .wi-picker__empty {
    font-size: 12.5px;
    color: #4b5563;
    padding: 4px 14px 12px;
    line-height: 1.55;
  }
  .wi-picker__empty em { font-style: normal; color: #6b7280; }

  .wi-picker__list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 4px 6px;
  }

  /* ── Einzelne WI-Zeile ── */
  .wi-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 8px 10px;
    border-radius: 11px;
    border: 1px solid transparent;
    background: transparent;
    cursor: pointer;
    font-family: inherit;
    text-align: left;
    transition: background 0.14s, border-color 0.14s;
  }

  .wi-item:hover {
    background: rgba(255,255,255,0.04);
    border-color: rgba(255,255,255,0.07);
  }

  .wi-item--active {
    background: rgba(99,102,241,0.08);
    border-color: rgba(99,102,241,0.20);
  }

  .wi-item__icon {
    flex-shrink: 0;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.07);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #6b7280;
    transition: background 0.14s, color 0.14s, border-color 0.14s;
  }

  .wi-item__icon--active {
    background: rgba(99,102,241,0.15);
    border-color: rgba(99,102,241,0.25);
    color: #818cf8;
  }

  .wi-item__info {
    flex: 1;
    min-width: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .wi-item__name {
    font-size: 13px;
    font-weight: 500;
    color: #d1d5db;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color 0.14s;
  }

  .wi-item--active .wi-item__name { color: #e5e7eb; }

  .wi-item__pills {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
  }

  .entry-pill {
    font-size: 10px;
    font-weight: 600;
    padding: 1px 6px;
    border-radius: 5px;
    letter-spacing: 0.02em;
  }

  .entry-pill--before {
    background: rgba(99,102,241,0.12);
    color: rgba(165,168,255,0.7);
    border: 1px solid rgba(99,102,241,0.15);
  }

  .entry-pill--after {
    background: rgba(251,146,60,0.10);
    color: rgba(253,186,116,0.7);
    border: 1px solid rgba(251,146,60,0.14);
  }

  .wi-item__no-entries {
    font-size: 11px;
    color: #374151;
    font-style: italic;
  }

  /* ── Checkmark ── */
  .wi-item__check {
    flex-shrink: 0;
    width: 18px;
    height: 18px;
    border-radius: 6px;
    border: 1px solid rgba(255,255,255,0.1);
    background: transparent;
    display: flex;
    align-items: center;
    justify-content: center;
    color: transparent;
    transition: background 0.14s, border-color 0.14s, color 0.14s;
  }

  .wi-item__check--visible {
    background: rgba(99,102,241,0.6);
    border-color: rgba(99,102,241,0.8);
    color: #fff;
  }
</style>