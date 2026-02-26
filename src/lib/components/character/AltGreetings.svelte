<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import { slide } from 'svelte/transition';
  import * as m from '$lib/paraglide/messages';

  export let greetings: string[] = [];

  const dispatch = createEventDispatcher<{
    change: string[];
    add: void;
    remove: number;
  }>();

  function onInput(index: number, value: string) {
    const updated = [...greetings];
    updated[index] = value;
    dispatch('change', updated);
  }

  // Grows the textarea to fit its content instead of scrolling.
  function autoResize(node: HTMLTextAreaElement) {
    function resize() {
      node.style.height = 'auto';
      node.style.height = node.scrollHeight + 'px';
    }
    node.addEventListener('input', resize);
    resize();
    return { destroy: () => node.removeEventListener('input', resize) };
  }
</script>

<div class="alt-greetings">
  {#if greetings.length > 0}
    <div class="greeting-list">
      {#each greetings as greeting, i (i)}
        <div class="greeting-item" transition:slide={{ duration: 180 }}>
          <div class="greeting-header">
            <label for="alt-greeting-{i}" class="greeting-label">
              {m.create_page_label_alt_greeting({ index: i + 1 })}
            </label>
            <button
              type="button"
              on:click={() => dispatch('remove', i)}
              aria-label={m.create_page_title_delete()}
              class="remove-btn"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <line x1="18" y1="6" x2="6" y2="18"/>
                <line x1="6" y1="6" x2="18" y2="18"/>
              </svg>
            </button>
          </div>
          <textarea
            id="alt-greeting-{i}"
            value={greeting}
            on:input={(e) => onInput(i, (e.target as HTMLTextAreaElement).value)}
            rows="2"
            use:autoResize
            class="greeting-textarea"
            placeholder={m.create_page_placeholder_alt_greeting()}
          ></textarea>
        </div>
      {/each}
    </div>
  {/if}

  <button type="button" on:click={() => dispatch('add')} class="add-btn">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    {m.create_page_btn_add_alt()}
  </button>
</div>

<style>
  .alt-greetings {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .greeting-list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .greeting-item {
    background: rgba(255,255,255,0.025);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px;
    overflow: hidden;
    transition: border-color 0.2s;
  }

  .greeting-item:focus-within {
    border-color: rgba(var(--accent-rgb, 167 139 250) / 0.45);
    background: rgba(255,255,255,0.04);
  }

  .greeting-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 10px 14px 4px;
  }

  .greeting-label {
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.1em;
    color: rgba(255,255,255,0.3);
    font-weight: 600;
  }

  .remove-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 8px;
    color: rgba(255,255,255,0.3);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 0.15s, background 0.15s;
    min-width: 44px;
    min-height: 36px;
  }

  .remove-btn:hover {
    color: #f87171;
    background: rgba(248,113,113,0.1);
  }

  .greeting-textarea {
    width: 100%;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.8);
    padding: 4px 14px 12px;
    font-size: 13.5px;
    line-height: 1.6;
    resize: none;
    outline: none;
    overflow: hidden;
    min-height: 60px;
    font-family: inherit;
  }

  .greeting-textarea::placeholder {
    color: rgba(255,255,255,0.2);
  }

  .add-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 9px 14px;
    border-radius: 10px;
    background: rgba(255,255,255,0.04);
    border: 1px dashed rgba(255,255,255,0.12);
    color: rgba(255,255,255,0.45);
    font-size: 12.5px;
    font-weight: 500;
    cursor: pointer;
    transition: color 0.15s, background 0.15s, border-color 0.15s;
    align-self: flex-start;
    min-height: 40px;
  }

  .add-btn:hover {
    color: rgba(255,255,255,0.75);
    background: rgba(255,255,255,0.07);
    border-color: rgba(255,255,255,0.2);
  }

  .add-btn:active {
    transform: scale(0.98);
  }
</style>