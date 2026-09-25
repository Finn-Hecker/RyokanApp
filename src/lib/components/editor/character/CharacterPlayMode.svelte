<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { PlayMode } from '$lib/stores/characterStore.svelte';

  let { playMode = $bindable('solo') }: { playMode?: PlayMode } = $props();
</script>

<div class="play-mode-field">
  <label for="character-play-mode">{m.create_page_label_play_mode()}</label>
  <div class="select-wrap">
    <select id="character-play-mode" bind:value={playMode}>
      <option value="solo">{m.create_page_play_mode_solo()}</option>
      <option value="multiplayer">{m.create_page_play_mode_multiplayer()}</option>
    </select>
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
      <path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  </div>
</div>

<style>
  .play-mode-field {
    margin-top: 16px;
    padding: 14px 18px;
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    background: rgba(255, 255, 255, 0.03);
  }

  label {
    display: block;
    margin-bottom: 8px;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #9ca3af;
  }

  .select-wrap { position: relative; }

  select {
    width: 100%;
    min-height: 44px;
    appearance: none;
    color-scheme: dark;
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 9px;
    padding: 10px 38px 10px 12px;
    background: #202024;
    color: #e5e7eb;
    font: inherit;
    font-size: 0.875rem;
    cursor: pointer;
    transition: border-color 0.18s;
  }

  select:hover { border-color: rgba(255, 255, 255, 0.18); }

  select:focus-visible {
    outline: 2px solid rgba(var(--accent-rgb, 167 139 250) / 0.6);
    outline-offset: 2px;
  }

  option { background: #202024; color: #e5e7eb; }

  svg {
    position: absolute;
    top: 50%;
    right: 14px;
    transform: translateY(-50%);
    color: #9ca3af;
    pointer-events: none;
  }
</style>
