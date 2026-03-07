<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import AltGreetings from './AltGreetings.svelte';
  import WorldInfoPicker from './WorldInfoPicker.svelte';

  let {
    name = $bindable(''),
    description = $bindable(''),
    personality = $bindable(''),
    scenario = $bindable(''),
    greeting = $bindable(''),
    mes_example = $bindable(''),
    alternate_greetings = $bindable([]),
    worldInfoIds = $bindable([]),
    onAltGreetingsChange,
    onAltGreetingsAdd,
    onAltGreetingsRemove
  }: {
    name?: string;
    description?: string;
    personality?: string;
    scenario?: string;
    greeting?: string;
    mes_example?: string;
    alternate_greetings?: string[];
    worldInfoIds?: string[];
    onAltGreetingsChange?: (updated: string[]) => void;
    onAltGreetingsAdd?: () => void;
    onAltGreetingsRemove?: (index: number) => void;
  } = $props();
</script>

<div class="space-y-4">

  <div class="field-wrap">
    <label for="character-name" class="field-label">{m.create_page_label_name()}</label>
    <input
      id="character-name"
      type="text"
      bind:value={name}
      class="field-input field-input--lg"
      placeholder={m.create_page_placeholder_name()}
    />
  </div>

  <div class="field-wrap">
    <label for="character-description" class="field-label">{m.create_page_label_desc()}</label>
    <textarea
      id="character-description"
      bind:value={description}
      rows="6"
      class="field-textarea"
      placeholder={m.create_page_placeholder_desc()}
    ></textarea>
  </div>

  <div class="field-wrap">
    <label for="character-greeting" class="field-label">{m.create_page_label_greeting()}</label>
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

  <div class="section-header">
    <span class="section-title">{m.create_page_header_advanced()}</span>
  </div>

  <div class="field-wrap">
    <label for="char-personality" class="field-label">{m.create_page_label_personality()}</label>
    <textarea
      id="char-personality"
      bind:value={personality}
      rows="3"
      class="field-textarea"
      placeholder={m.create_page_placeholder_personality()}
    ></textarea>
  </div>

  <div class="field-wrap">
    <label for="char-scenario" class="field-label">{m.create_page_label_scenario()}</label>
    <textarea
      id="char-scenario"
      bind:value={scenario}
      rows="3"
      class="field-textarea"
      placeholder={m.create_page_placeholder_scenario()}
    ></textarea>
  </div>

  <div class="field-wrap">
    <label for="char-mes-example" class="field-label">{m.create_page_label_mes_example()}</label>
    <textarea
      id="char-mes-example"
      bind:value={mes_example}
      rows="4"
      class="field-textarea field-textarea--mono"
      placeholder={m.create_page_placeholder_mes_example()}
    ></textarea>
  </div>

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
    padding: 10px 14px 0;
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
    resize: none;
    font-family: inherit;
    outline: none;
  }

  .field-textarea--mono {
    font-family: ui-monospace, 'Cascadia Code', 'Source Code Pro', Menlo, monospace;
    font-size: 0.8125rem;
  }

  .field-textarea::placeholder { color: #374151; }

  .section-header {
    padding: 10px 2px 0;
  }

  .section-title {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.15em;
    color: rgba(var(--accent-rgb, 167 139 250) / 0.6);
  }
</style>