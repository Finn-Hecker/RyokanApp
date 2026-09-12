<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import AltGreetings from './AltGreetings.svelte';
  import WorldInfoPicker from './WorldInfoPicker.svelte';
  import TokenBadge from '$lib/components/TokenBadge.svelte';
  import { countCoreCharacterTokens } from '$lib/utils/tokenCount';
  import type { PlayMode } from '$lib/stores/characterStore.svelte';

  let {
    name = $bindable(''),
    prompt = $bindable(''),
    greeting = $bindable(''),
    alternate_greetings = $bindable([]),
    playMode = $bindable('solo'),
    worldInfoIds = $bindable([]),
    onAltGreetingsChange,
    onAltGreetingsAdd,
    onAltGreetingsRemove
  }: {
    name?: string;
    prompt?: string;
    greeting?: string;
    alternate_greetings?: string[];
    playMode?: PlayMode;
    worldInfoIds?: string[];
    onAltGreetingsChange?: (updated: string[]) => void;
    onAltGreetingsAdd?: () => void;
    onAltGreetingsRemove?: (index: number) => void;
  } = $props();

  let totalTokens = $derived(
    countCoreCharacterTokens({ name, prompt, greeting })
  );
</script>

<div class="space-y-4">

  <div class="total-tokens-bar">
    <span class="total-tokens-label">Gesamt-Kontext</span>
    <TokenBadge
      count={totalTokens}
      />
  </div>

  <div class="field-wrap">
    <div class="field-label-row">
      <label for="character-name" class="field-label">{m.create_page_label_name()}</label>
      <TokenBadge text={name} />
    </div>
    <input
      id="character-name"
      type="text"
      bind:value={name}
      class="field-input field-input--lg"
      placeholder={m.create_page_placeholder_name()}
    />
  </div>

  <div class="field-wrap">
    <div class="field-label-row">
      <label for="character-play-mode" class="field-label">{m.create_page_label_play_mode()}</label>
    </div>
    <select id="character-play-mode" bind:value={playMode} class="field-input">
      <option value="solo">{m.create_page_play_mode_solo()}</option>
      <option value="multiplayer">{m.create_page_play_mode_multiplayer()}</option>
    </select>
  </div>

  <div class="field-wrap">
    <div class="field-label-row">
      <label for="character-prompt" class="field-label">{m.create_page_label_prompt()}</label>
      <TokenBadge text={prompt} />
    </div>
    <textarea
      id="character-prompt"
      bind:value={prompt}
      rows="14"
      class="field-textarea"
      placeholder={m.create_page_placeholder_prompt()}
    ></textarea>
  </div>

  <div class="field-wrap">
    <div class="field-label-row">
      <label for="character-greeting" class="field-label">{m.create_page_label_greeting()}</label>
      <TokenBadge text={greeting} />
    </div>
    <textarea
      id="character-greeting"
      bind:value={greeting}
      rows="4"
      class="field-textarea"
      placeholder={m.create_page_placeholder_greeting()}
    ></textarea>
  </div>

  <AltGreetings
    greetings={alternate_greetings}
    onChange={onAltGreetingsChange}
    onAdd={onAltGreetingsAdd}
    onRemove={onAltGreetingsRemove}
  />

  <WorldInfoPicker bind:selectedIds={worldInfoIds} />

</div>

<style>
  .field-wrap {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 4px;
    transition: border-color 0.18s, background 0.18s;
  }

  .field-wrap:focus-within {
    border-color: rgba(var(--accent-rgb, 167 139 250) / 0.4);
    background: rgba(255, 255, 255, 0.04);
  }

  .field-wrap:hover:not(:focus-within) {
    border-color: rgba(255, 255, 255, 0.09);
  }

  .field-label {
    display: block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.12em;
    color: #6b7280;
  }

  .field-label-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 10px 14px 0;
  }

  .total-tokens-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 2px 4px;
  }

  .total-tokens-label {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.14em;
    color: rgba(var(--accent-rgb, 167 139 250) / 0.6);
  }

  .field-input {
    width: 100%;
    background: transparent;
    border: none;
    color: #f9fafb;
    padding: 4px 14px 10px;
    font-family: inherit;
    font-size: 0.9375rem;
    outline: none;
  }

  .field-input--lg {
    font-size: 1.0625rem;
  }

  .field-input::placeholder { color: #374151; }

  .field-textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: #d1d5db;
    padding: 4px 14px 10px;
    font-size: 0.875rem;
    line-height: 1.65;
    resize: vertical;
    font-family: inherit;
    outline: none;
  }

  .field-textarea::placeholder { color: #374151; }

</style>
