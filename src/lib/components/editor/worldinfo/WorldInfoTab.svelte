<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { slide } from 'svelte/transition';
  import { createEmptyEntry, type WorldInfoEntry, type WiPosition } from './worldInfoLogic';

  let {
    name = $bindable(''),
    description = $bindable(''),
    entries = $bindable([])
  }: {
    name?: string;
    description?: string;
    entries?: WorldInfoEntry[];
  } = $props();

  function addEntry()              { entries = [...entries, createEmptyEntry()]; }
  function removeEntry(id: string) { entries = entries.filter(e => e.id !== id); }
  function toggleEntry(id: string) { entries = entries.map(e => e.id === id ? { ...e, enabled: !e.enabled } : e); }
  function setPosition(id: string, pos: WiPosition) {
    entries = entries.map(e => e.id === id ? { ...e, position: pos } : e);
  }
  function updateKeys(id: string, raw: string) {
    const keys = raw.split(',').map(k => k.trim()).filter(Boolean);
    entries = entries.map(e => e.id === id ? { ...e, keys } : e);
  }
  function updateContent(id: string, content: string) {
    entries = entries.map(e => e.id === id ? { ...e, content } : e);
  }
  function updateComment(id: string, comment: string) {
    entries = entries.map(e => e.id === id ? { ...e, comment } : e);
  }

  let beforeCount = $derived(entries.filter(e => e.position === 'before' && e.enabled).length);
  let afterCount  = $derived(entries.filter(e => e.position === 'after'  && e.enabled).length);
</script>

<div class="space-y-4">

  <div class="field-wrap">
    <label for="wi-name" class="field-label">{m.wi_tab_name_label()}</label>
    <input id="wi-name" type="text" bind:value={name}
      class="field-input field-input--lg" placeholder={m.wi_tab_name_placeholder()} />
  </div>

  <div class="field-wrap">
    <label for="wi-desc" class="field-label">
      {m.wi_tab_desc_label()} <span class="field-label-optional">{m.wi_tab_desc_optional()}</span>
    </label>
    <textarea id="wi-desc" bind:value={description} rows="3"
      class="field-textarea" placeholder={m.wi_tab_desc_placeholder()}></textarea>
  </div>

  <div class="section-header">
    <span class="section-title">{m.wi_tab_entries_title()}</span>
    {#if entries.length > 0}
      <span class="section-count">{entries.length}</span>
      
      <span class="pos-summary">
        <span class="pos-dot pos-dot--before"></span>{m.wi_tab_before_count({ count: beforeCount })}
        <span class="pos-dot pos-dot--after"></span>{m.wi_tab_after_count({ count: afterCount })}
      </span>
    {/if}
  </div>

  {#if entries.length > 0}
    <div class="entry-list">
      {#each entries as entry (entry.id)}
        <div class="entry-card"
          class:entry-card--disabled={!entry.enabled}
          class:entry-card--after={entry.position === 'after'}
          transition:slide={{ duration: 180 }}>

          <div class="entry-top">
            <input type="text" value={entry.comment}
              oninput={e => updateComment(entry.id, e.currentTarget.value)}
              class="entry-label-input" placeholder={m.wi_tab_entry_label_placeholder()} />

            <div class="entry-controls">
              <div class="pos-toggle" title={m.wi_tab_injection_position()}>
                <button type="button"
                  class="pos-btn" class:pos-btn--active={entry.position === 'before'}
                  onclick={() => setPosition(entry.id, 'before')}>
                  {m.wi_tab_btn_before()}
                </button>
                <button type="button"
                  class="pos-btn" class:pos-btn--active={entry.position === 'after'}
                  onclick={() => setPosition(entry.id, 'after')}>
                  {m.wi_tab_btn_after()}
                </button>
              </div>

              <button type="button" class="toggle"
                class:toggle--on={entry.enabled}
                onclick={() => toggleEntry(entry.id)}
                aria-label={entry.enabled ? m.wi_tab_aria_disable() : m.wi_tab_aria_enable()}>
                <span class="toggle-knob"></span>
              </button>

              <button type="button" class="remove-btn"
                onclick={() => removeEntry(entry.id)} aria-label={m.wi_tab_aria_remove()}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="2.5">
                  <line x1="18" y1="6" x2="6" y2="18"/>
                  <line x1="6" y1="6" x2="18" y2="18"/>
                </svg>
              </button>
            </div>
          </div>

          <div class="entry-section">
            <span class="entry-section-label">{m.wi_tab_keys_label()}</span>
            <input type="text" value={entry.keys.join(', ')}
              onchange={e => updateKeys(entry.id, e.currentTarget.value)}
              class="entry-input" placeholder={m.wi_tab_keys_placeholder()} />
          </div>

          <div class="entry-sep"></div>

          <div class="entry-section">
            <span class="entry-section-label">{m.wi_tab_content_label()}</span>
            <textarea
              value={entry.content}
              oninput={e => updateContent(entry.id, e.currentTarget.value)}
              rows="4" class="entry-textarea"
              placeholder={m.wi_tab_content_placeholder()}></textarea>
          </div>

          <div class="pos-strip" class:pos-strip--after={entry.position === 'after'}>
            {entry.position === 'before' ? m.wi_tab_strip_before() : m.wi_tab_strip_after()}
          </div>

        </div>
      {/each}
    </div>
  {/if}

  <button type="button" class="add-btn" onclick={addEntry}>
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2.5">
      <line x1="12" y1="5" x2="12" y2="19"/>
      <line x1="5" y1="12" x2="19" y2="12"/>
    </svg>
    {m.wi_tab_btn_add_entry()}
  </button>

  <div class="callout">
    <svg class="callout-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" stroke-width="2">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <p>
      <strong>Before</strong> {m.wi_tab_callout_before_text()}<br/>
      <strong>After</strong> {m.wi_tab_callout_after_text()}
    </p>
  </div>

</div>

<style>
  .field-wrap {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 16px;
    padding: 4px;
    transition: border-color 0.18s, background 0.18s;
  }
  .field-wrap:focus-within {
    border-color: rgba(var(--accent-rgb,167 139 250)/0.4);
    background: rgba(255,255,255,0.04);
  }
  .field-wrap:hover:not(:focus-within) { border-color: rgba(255,255,255,0.09); }

  .field-label {
    display: block;
    font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.12em;
    color: #6b7280; padding: 10px 14px 0;
  }
  .field-label-optional { text-transform: none; font-weight: 400; letter-spacing: 0; opacity: 0.6; }
  .field-input {
    width: 100%; background: transparent; border: none;
    color: #f9fafb; padding: 4px 14px 10px;
    font-family: inherit; font-size: 0.9375rem; outline: none;
  }
  .field-input--lg { font-size: 1.0625rem; }
  .field-input::placeholder { color: #374151; }
  .field-textarea {
    width: 100%; background: transparent; border: none;
    color: #d1d5db; padding: 4px 14px 10px;
    font-size: 0.875rem; line-height: 1.65;
    resize: none; font-family: inherit; outline: none;
  }
  .field-textarea::placeholder { color: #374151; }

  .section-header {
    display: flex; align-items: center; gap: 8px; padding: 8px 2px 0;
  }
  .section-title {
    font-size: 10px; font-weight: 700; text-transform: uppercase;
    letter-spacing: 0.15em;
    color: rgba(var(--accent-rgb,167 139 250)/0.6);
  }
  .section-count {
    font-size: 11px; font-weight: 600;
    color: rgba(255,255,255,0.2);
    background: rgba(255,255,255,0.05);
    border-radius: 6px; padding: 1px 7px;
  }
  .pos-summary {
    display: flex; align-items: center; gap: 5px;
    font-size: 11px; color: rgba(255,255,255,0.25); margin-left: 4px;
  }
  .pos-dot {
    width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0;
  }
  .pos-dot--before { background: rgba(99,102,241,0.7); }
  .pos-dot--after  { background: rgba(251,146,60,0.7); }

  .entry-list { display: flex; flex-direction: column; gap: 8px; }

  .entry-card {
    background: rgba(255,255,255,0.03);
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 16px; overflow: hidden;
    transition: border-color 0.2s, opacity 0.2s;
  }
  .entry-card:focus-within {
    border-color: rgba(var(--accent-rgb,167 139 250)/0.3);
    background: rgba(255,255,255,0.035);
  }
  .entry-card--after:focus-within { border-color: rgba(251,146,60,0.3); }
  .entry-card--disabled { opacity: 0.38; }

  .entry-top {
    display: flex; align-items: center; gap: 8px; padding: 9px 12px 6px;
  }
  .entry-label-input {
    flex: 1; background: transparent; border: none; outline: none;
    font-size: 11.5px; font-weight: 600;
    color: rgba(255,255,255,0.45); font-family: inherit; min-width: 0;
  }
  .entry-label-input::placeholder { color: rgba(255,255,255,0.15); }

  .entry-controls { display: flex; align-items: center; gap: 6px; flex-shrink: 0; }

  /* Position pill toggle */
  .pos-toggle {
    display: flex;
    background: rgba(255,255,255,0.06);
    border-radius: 7px; padding: 2px; gap: 2px;
  }
  .pos-btn {
    padding: 3px 9px; border-radius: 5px; border: none;
    background: transparent; cursor: pointer; font-family: inherit;
    font-size: 11px; font-weight: 600; letter-spacing: 0.01em;
    color: rgba(255,255,255,0.3); transition: background 0.15s, color 0.15s;
  }
  .pos-btn--active {
    background: rgba(99,102,241,0.35); color: rgba(165,168,255,0.9);
  }
  /* "After" active state gets an orange tint */
  .entry-card--after .pos-btn--active {
    background: rgba(251,146,60,0.3); color: rgba(253,186,116,0.9);
  }

  /* Enable toggle (reused from lorebook) */
  .toggle {
    position: relative; width: 32px; height: 18px;
    border-radius: 9px; border: none;
    background: rgba(255,255,255,0.1); cursor: pointer; padding: 0;
    flex-shrink: 0; transition: background 0.2s;
  }
  .toggle--on { background: rgba(var(--accent-rgb,167 139 250)/0.55); }
  .toggle-knob {
    position: absolute; top: 3px; left: 3px;
    width: 12px; height: 12px; border-radius: 50%;
    background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,0.4);
    transition: transform 0.2s;
  }
  .toggle--on .toggle-knob { transform: translateX(14px); }

  .remove-btn {
    width: 26px; height: 26px; display: flex;
    align-items: center; justify-content: center;
    border-radius: 7px; border: none;
    background: transparent; color: rgba(255,255,255,0.2);
    cursor: pointer; transition: color 0.15s, background 0.15s;
  }
  .remove-btn:hover { color: #f87171; background: rgba(248,113,113,0.1); }

  .entry-section { padding: 2px 12px 9px; }
  .entry-section-label {
    display: block; font-size: 10px; font-weight: 700;
    text-transform: uppercase; letter-spacing: 0.1em;
    color: rgba(255,255,255,0.18); margin-bottom: 3px;
  }
  .entry-input {
    width: 100%; background: transparent; border: none; outline: none;
    color: #d1d5db; font-size: 13px; font-family: inherit; padding: 0;
  }
  .entry-input::placeholder { color: rgba(255,255,255,0.18); }
  .entry-sep { height: 1px; background: rgba(255,255,255,0.05); margin: 0 12px 4px; }
  .entry-textarea {
    width: 100%; background: transparent; border: none; outline: none;
    color: #d1d5db; font-size: 13px; line-height: 1.65;
    resize: none; font-family: inherit; padding: 0;
  }
  .entry-textarea::placeholder { color: rgba(255,255,255,0.18); }

  /* Position strip at bottom of each card */
  .pos-strip {
    padding: 5px 12px;
    font-size: 10px; font-weight: 600; letter-spacing: 0.08em;
    text-transform: uppercase;
    background: rgba(99,102,241,0.07);
    color: rgba(165,168,255,0.4);
    border-top: 1px solid rgba(99,102,241,0.1);
  }
  .pos-strip--after {
    background: rgba(251,146,60,0.06);
    color: rgba(253,186,116,0.4);
    border-top-color: rgba(251,146,60,0.1);
  }

  .add-btn {
    display: inline-flex; align-items: center; gap: 7px;
    padding: 8px 14px; border-radius: 10px;
    background: rgba(255,255,255,0.03);
    border: 1px dashed rgba(255,255,255,0.1);
    color: rgba(255,255,255,0.38);
    font-size: 12.5px; font-weight: 500; font-family: inherit;
    cursor: pointer; align-self: flex-start; min-height: 38px;
    transition: color 0.15s, background 0.15s, border-color 0.15s;
    width: 100%;
    justify-content: center;
  }
  .add-btn:hover {
    color: rgba(255,255,255,0.7);
    background: rgba(255,255,255,0.06);
    border-color: rgba(255,255,255,0.18);
  }
  .add-btn:active { transform: scale(0.98); }

  .callout {
    display: flex; gap: 10px; align-items: flex-start;
    padding: 13px 15px; border-radius: 14px;
    background: rgba(99,102,241,0.06);
    border: 1px solid rgba(99,102,241,0.15);
    color: rgba(165,168,255,0.65);
    font-size: 12.5px; line-height: 1.6;
  }
  .callout p { margin: 0; }
  .callout-icon { flex-shrink: 0; margin-top: 1px; color: rgba(165,168,255,0.4); }
  .callout strong { color: rgba(165,168,255,0.9); font-weight: 600; }
</style>