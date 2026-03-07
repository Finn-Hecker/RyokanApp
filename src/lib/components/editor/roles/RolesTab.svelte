<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import AvatarPicker from '../character/AvatarPicker.svelte';

  let {
    name = $bindable(''),
    description = $bindable(''),
    pronouns = $bindable(''),
    avatarPreview = null,
    onAvatarFile
  }: {
    name?: string;
    description?: string;
    pronouns?: string;
    avatarPreview?: string | null;
    onAvatarFile?: (file: File) => void;
  } = $props();

  const locale = getLocale();
  const isEnglish = locale === 'en';

  let PRONOUN_OPTIONS = $derived([
    { value: '',          label: '-' },
    { value: 'he/him',    label: m.role_pronoun_he() },
    { value: 'she/her',   label: m.role_pronoun_she() },
    { value: 'they/them', label: m.role_pronoun_they() },
    { value: 'it/its',    label: m.role_pronoun_it() },
  ]);
</script>

<AvatarPicker
  {avatarPreview}
  onFileSelected={(file) => onAvatarFile?.(file)}
/>

<div class="space-y-4">

  <div class="field-wrap">
    <label for="role-name" class="field-label">{m.role_label_name()}</label>
    <input
      id="role-name"
      type="text"
      bind:value={name}
      class="field-input field-input--lg"
      placeholder={m.role_placeholder_name()}
    />
  </div>

  <div class="field-wrap">
    <label for="role-description" class="field-label">{m.role_label_desc()}</label>
    <textarea
      id="role-description"
      bind:value={description}
      rows="6"
      class="field-textarea"
      placeholder={m.role_placeholder_desc()}
    ></textarea>
  </div>

  <div class="field-wrap">
    <label for="role-pronouns" class="field-label">{m.role_label_pronouns()}</label>
    <div class="select-wrap">
      <select id="role-pronouns" bind:value={pronouns} class="field-select">
        {#each PRONOUN_OPTIONS as opt}
          <option value={opt.value}>{opt.label}</option>
        {/each}
      </select>
      <svg class="select-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <polyline points="6 9 12 15 18 9"/>
      </svg>
    </div>

    {#if !isEnglish}
      <p class="pronouns-hint">
        <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor"
             stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="flex-shrink:0;margin-top:1px">
          <circle cx="12" cy="12" r="10"/>
          <line x1="12" y1="8" x2="12" y2="12"/>
          <line x1="12" y1="16" x2="12.01" y2="16"/>
        </svg>
        {m.role_pronouns_hint()}
      </p>
    {/if}
  </div>

  <div class="callout">
    <svg class="callout-icon" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="8" x2="12" y2="12"/>
      <line x1="12" y1="16" x2="12.01" y2="16"/>
    </svg>
    <p>{m.role_info_callout()}</p>
  </div>

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

  .field-input--lg { font-size: 1.0625rem; }
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

  .field-textarea::placeholder { color: #374151; }

  .select-wrap {
    position: relative;
    display: flex;
    align-items: center;
  }

  .field-select {
    width: 100%;
    background: transparent;
    border: none;
    color: #f9fafb;
    padding: 4px 36px 10px 14px;
    font-family: inherit;
    font-size: 0.9375rem;
    outline: none;
    appearance: none;
    cursor: pointer;
  }

  .field-select option {
    background: #1c1c1e;
    color: #f9fafb;
  }

  .select-chevron {
    position: absolute;
    right: 14px;
    pointer-events: none;
    color: #4b5563;
  }

  .pronouns-hint {
    display: flex;
    align-items: flex-start;
    gap: 6px;
    margin: 0;
    padding: 8px 14px 10px;
    font-size: 11.5px;
    color: #6b7280;
    line-height: 1.55;
  }

  .callout {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 13px 15px;
    border-radius: 14px;
    background: rgba(99, 102, 241, 0.06);
    border: 1px solid rgba(99, 102, 241, 0.15);
    color: rgba(165, 168, 255, 0.65);
    font-size: 12.5px;
    line-height: 1.6;
  }

  .callout p { margin: 0; }

  .callout-icon {
    flex-shrink: 0;
    margin-top: 1px;
    color: rgba(165, 168, 255, 0.4);
  }
</style>