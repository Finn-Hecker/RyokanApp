<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { createEventDispatcher } from 'svelte';
  import { slide } from 'svelte/transition';

  export let isCustom: boolean = false;

  const dispatch = createEventDispatcher<{
    hide: void;
    delete: void;
  }>();
</script>

<!-- slide transition reduces the visual impact of the section appearing/disappearing -->
<div class="danger-zone" transition:slide={{ duration: 200 }}>
  <p class="section-label">{m.danger_zone_actions()}</p>

  <div class="action-list">

    <button type="button" on:click={() => dispatch('hide')} class="action-row action-row--neutral">
      <span class="action-icon">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      </span>
      <span class="action-text">
        <span class="action-title">{m.danger_zone_hide_title()}</span>
        <span class="action-desc">{m.danger_zone_hide_desc()}</span>
      </span>
      <svg class="action-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </button>

    {#if isCustom}
      <button type="button" on:click={() => dispatch('delete')} class="action-row action-row--destructive">
        <span class="action-icon action-icon--danger">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="3 6 5 6 21 6"/>
            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
            <path d="M10 11v6M14 11v6"/>
            <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
          </svg>
        </span>
        <span class="action-text">
          <span class="action-title action-title--danger">{m.danger_zone_delete_title()}</span>
          <span class="action-desc">{m.danger_zone_delete_desc()}</span>
        </span>
        <svg class="action-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>
    {/if}

  </div>
</div>

<style>
  .danger-zone {
    padding-bottom: 32px;
  }

  .section-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: rgba(248, 113, 113, 0.55);
    padding: 20px 4px 8px;
  }

  .action-list {
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px;
    overflow: hidden;
  }

  .action-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 16px;
    background: rgba(255,255,255,0.02);
    border: none;
    cursor: pointer;
    text-align: left;
    min-height: 60px; /* comfortable touch target */
    transition: background 0.15s;
  }

  .action-row + .action-row {
    border-top: 1px solid rgba(255,255,255,0.05);
  }

  .action-row--neutral:hover {
    background: rgba(255,255,255,0.05);
  }

  .action-row--destructive:hover {
    background: rgba(248, 113, 113, 0.07);
  }

  .action-icon {
    flex-shrink: 0;
    width: 36px;
    height: 36px;
    border-radius: 10px;
    background: rgba(255,255,255,0.05);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,0.4);
    transition: color 0.15s, background 0.15s;
  }

  .action-row--neutral:hover .action-icon {
    color: rgba(255,255,255,0.75);
    background: rgba(255,255,255,0.08);
  }

  .action-icon--danger {
    background: rgba(248,113,113,0.1);
    color: rgba(248,113,113,0.55);
  }

  .action-row--destructive:hover .action-icon--danger {
    color: #f87171;
    background: rgba(248,113,113,0.15);
  }

  .action-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .action-title {
    font-size: 13.5px;
    font-weight: 500;
    color: rgba(255,255,255,0.75);
  }

  .action-title--danger {
    color: rgba(248,113,113,0.75);
  }

  .action-row--destructive:hover .action-title--danger {
    color: #f87171;
  }

  .action-desc {
    font-size: 11.5px;
    color: rgba(255,255,255,0.3);
    line-height: 1.4;
  }

  .action-chevron {
    flex-shrink: 0;
    color: rgba(255,255,255,0.2);
    transition: color 0.15s;
  }

  .action-row:hover .action-chevron {
    color: rgba(255,255,255,0.4);
  }

  .action-row--destructive:hover .action-chevron {
    color: rgba(248,113,113,0.4);
  }
</style>