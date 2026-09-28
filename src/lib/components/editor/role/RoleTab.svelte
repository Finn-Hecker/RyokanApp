<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import AvatarPicker from '$lib/components/editor/character/AvatarPicker.svelte';

  let {
    name = $bindable(''),
    prompt = $bindable(''),
    avatarPreview = null,
    onAvatarFile,
  }: {
    name?: string;
    prompt?: string;
    avatarPreview?: string | null;
    onAvatarFile?: (file: File) => void;
  } = $props();
</script>

<AvatarPicker {avatarPreview} onFileSelected={(file) => onAvatarFile?.(file)} />

<div class="space-y-4">
  <div class="field-wrap">
    <div class="field-label-row">
      <label for="role-name" class="field-label">{m.role_editor_name()}</label>
    </div>
    <input id="role-name" bind:value={name} class="field-input field-input--lg" placeholder={m.role_editor_name_placeholder()} />
  </div>

  <div class="field-wrap">
    <div class="field-label-row">
      <label for="role-prompt" class="field-label">{m.role_editor_prompt()}</label>
    </div>
    <textarea id="role-prompt" bind:value={prompt} rows="12" class="field-textarea" placeholder={m.role_editor_prompt_placeholder()}></textarea>
  </div>

  <p class="px-1 text-xs leading-relaxed text-gray-500">{m.role_editor_hint()}</p>
</div>

<style>
  .field-wrap { background: rgba(255,255,255,.025); border: 1px solid rgba(255,255,255,.08); border-radius: 14px; padding: 4px; transition: border-color .18s, background .18s; }
  .field-wrap:focus-within { border-color: rgba(var(--accent-rgb),.4); background: rgba(var(--accent-rgb),.035); box-shadow: 0 0 0 3px rgba(var(--accent-rgb),.045); }
  .field-label-row { display:flex; align-items:center; justify-content:space-between; padding:10px 14px 0; }
  .field-label { font-size:11px; font-weight:650; text-transform:uppercase; letter-spacing:.07em; color:#929299; }
  .field-input, .field-textarea { width:100%; background:transparent; border:0; outline:0; color:#e5e5ea; padding:7px 14px 12px; font-family:inherit; font-size:14px; }
  .field-input { min-height:44px; padding-bottom:11px; }
  .field-textarea { line-height:1.6; resize:vertical; }
  .field-input::placeholder, .field-textarea::placeholder { color:#77777c; font-size:14px; opacity:1; }
</style>
