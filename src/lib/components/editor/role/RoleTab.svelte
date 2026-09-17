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
  .field-wrap { background: rgba(255,255,255,.03); border: 1px solid rgba(255,255,255,.06); border-radius: 16px; padding: 4px; transition: border-color .18s, background .18s; }
  .field-wrap:focus-within { border-color: rgba(var(--accent-rgb, 167 139 250) / .4); background: rgba(255,255,255,.04); }
  .field-label-row { display:flex; align-items:center; justify-content:space-between; padding:10px 14px 0; }
  .field-label { font-size:10px; font-weight:700; text-transform:uppercase; letter-spacing:.12em; color:#6b7280; }
  .field-input, .field-textarea { width:100%; background:transparent; border:0; outline:0; color:#d1d5db; padding:4px 14px 10px; font-family:inherit; }
  .field-input { font-size:1.0625rem; color:#f9fafb; }
  .field-textarea { font-size:.875rem; line-height:1.65; resize:vertical; }
  .field-input::placeholder, .field-textarea::placeholder { color:#374151; }
</style>
