<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { loadRoles, roleState } from '$lib/stores/roleStore.svelte';
  import type { BundledRoleSnapshot, RolePolicy } from '$lib/stores/characterStore.svelte';

  let { rolePolicy = $bindable('open'), bundledRoles = [], onAdd, onRemove }: {
    rolePolicy?: RolePolicy; bundledRoles?: BundledRoleSnapshot[];
    onAdd?: (roleId: string) => Promise<void> | void;
    onRemove?: (snapshotId: string) => Promise<void> | void;
  } = $props();

  let pickerOpen = $state(false);
  let busy = $state(false);
  onMount(() => loadRoles());

  async function add(roleId: string) {
    if (busy) return;
    busy = true;
    try { await onAdd?.(roleId); pickerOpen = false; } finally { busy = false; }
  }

  async function remove(snapshotId: string) {
    if (busy) return;
    busy = true;
    try { await onRemove?.(snapshotId); } finally { busy = false; }
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && (pickerOpen = false)} />

<section class="roles-section">
  <div class="section-heading">
    <div class="min-w-0">
      <h3>{m.character_roles_title()}</h3>
      <p>{m.character_roles_subtitle()}</p>
    </div>
    <label class="policy-select">
      <span class="sr-only">{m.character_roles_title()}</span>
      <select bind:value={rolePolicy}>
        <option value="open">{m.character_roles_open()}</option>
        <option value="restricted">{m.character_roles_restricted()}</option>
      </select>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </label>
  </div>

  {#if bundledRoles.length > 0}
    <div class="role-list">
      {#each bundledRoles as role (role.id)}
        <div class="role-row">
          <div class="role-avatar">
            {#if role.avatarUrl}<img src={role.avatarUrl} alt="" />{:else}{role.name.slice(0, 1).toUpperCase()}{/if}
          </div>
          <p>{role.name}</p>
          <button type="button" aria-label={m.character_roles_remove()} onclick={() => remove(role.id)} disabled={busy}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" /></svg>
          </button>
        </div>
      {/each}
    </div>
  {/if}

  <button type="button" class="add-role" onclick={() => (pickerOpen = true)}><span aria-hidden="true">+</span> {m.character_roles_add()}</button>

  {#if rolePolicy === 'restricted' && bundledRoles.length === 0}
    <p class="validation-message">{m.character_roles_restricted_error()}</p>
  {/if}
</section>

{#if pickerOpen}
  <div class="picker-backdrop">
    <button class="backdrop-dismiss" type="button" aria-label={m.create_char_close_aria()} onclick={() => (pickerOpen = false)}></button>
    <div class="role-picker" role="dialog" aria-modal="true" aria-labelledby="role-picker-title" tabindex="-1">
      <div class="picker-heading">
        <div><h3 id="role-picker-title">{m.character_roles_add()}</h3><p>{m.character_roles_choose()}</p></div>
        <button type="button" class="picker-close" aria-label={m.create_char_close_aria()} onclick={() => (pickerOpen = false)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round" /></svg>
        </button>
      </div>
      {#if roleState.roles.length > 0}
        <div class="picker-list">
          {#each roleState.roles as role (role.id)}
            <button type="button" class="picker-role" disabled={busy} onclick={() => add(role.id)}>
              <div class="role-avatar role-avatar--large">{#if role.avatarUrl}<img src={role.avatarUrl} alt="" />{:else}{role.name.slice(0, 1).toUpperCase()}{/if}</div>
              <span>{role.name}</span>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </button>
          {/each}
        </div>
      {:else}
        <p class="picker-empty">{m.character_roles_no_global()}</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  .roles-section { margin-top:8px; padding:18px; border:1px solid rgba(255,255,255,.06); border-radius:16px; background:rgba(255,255,255,.02); }
  .section-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; }
  .section-heading h3 { color:#d1d5db; font-size:14px; font-weight:600; }
  .section-heading p { margin-top:4px; color:#5f6570; font-size:12px; line-height:1.5; }
  .policy-select { position:relative; flex:none; color:#aeb3bc; }
  .policy-select select { min-width:112px; height:36px; appearance:none; border:1px solid rgba(255,255,255,.09); border-radius:9px; padding:0 32px 0 11px; color:#d1d5db; background:#202024; font:inherit; font-size:12px; font-weight:600; cursor:pointer; }
  .policy-select svg { position:absolute; top:12px; right:10px; pointer-events:none; }
  .role-list { display:flex; flex-direction:column; gap:7px; margin-top:15px; }
  .role-row { display:flex; align-items:center; gap:10px; min-width:0; padding:8px 9px; border:1px solid rgba(255,255,255,.05); border-radius:11px; background:rgba(255,255,255,.025); }
  .role-row p { min-width:0; flex:1; overflow:hidden; color:#d1d5db; font-size:13px; font-weight:500; text-overflow:ellipsis; white-space:nowrap; }
  .role-avatar { width:32px; height:32px; flex:none; display:flex; align-items:center; justify-content:center; overflow:hidden; border-radius:9px; color:#d4b483; background:rgba(212,180,131,.09); font-size:12px; font-weight:700; }
  .role-avatar img { width:100%; height:100%; object-fit:cover; }
  .role-avatar--large { width:38px; height:38px; }
  .role-row button, .picker-close { display:flex; align-items:center; justify-content:center; width:36px; height:36px; flex:none; border:0; border-radius:9px; color:#6b7280; background:transparent; cursor:pointer; }
  .role-row button:hover, .picker-close:hover { color:#f3f4f6; background:rgba(255,255,255,.06); }
  .add-role { display:inline-flex; align-items:center; gap:7px; min-height:38px; margin-top:13px; border:1px solid rgba(212,180,131,.22); border-radius:9px; padding:8px 13px; color:#d4b483; background:rgba(212,180,131,.065); font:inherit; font-size:12px; font-weight:600; cursor:pointer; }
  .add-role:hover { border-color:rgba(212,180,131,.38); background:rgba(212,180,131,.1); }
  .add-role span { font-size:17px; font-weight:400; line-height:1; }
  .validation-message { margin-top:10px; color:#fbbf24; font-size:12px; font-weight:500; }
  .picker-backdrop { position:fixed; inset:0; z-index:100; display:flex; align-items:center; justify-content:center; padding:20px; background:rgba(0,0,0,.58); backdrop-filter:blur(3px); }
  .backdrop-dismiss { position:absolute; inset:0; width:100%; height:100%; border:0; background:transparent; cursor:default; }
  .role-picker { position:relative; width:min(420px,100%); max-height:min(560px,calc(100dvh - 40px)); display:flex; flex-direction:column; overflow:hidden; border:1px solid rgba(255,255,255,.09); border-radius:16px; background:#19191c; box-shadow:0 20px 60px rgba(0,0,0,.55); }
  .picker-heading { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding:18px 18px 14px; border-bottom:1px solid rgba(255,255,255,.06); }
  .picker-heading h3 { color:#e5e7eb; font-size:15px; font-weight:600; }
  .picker-heading p { margin-top:3px; color:#626873; font-size:12px; line-height:1.45; }
  .picker-close { margin:-6px -6px 0 0; }
  .picker-list { min-height:0; overflow-y:auto; padding:7px; }
  .picker-role { width:100%; min-height:52px; display:flex; align-items:center; gap:11px; border:0; border-radius:10px; padding:7px 9px; color:#d1d5db; background:transparent; font:inherit; font-size:13px; font-weight:500; text-align:left; cursor:pointer; }
  .picker-role:hover { color:#f3f4f6; background:rgba(255,255,255,.055); }
  .picker-role span { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .picker-role > svg { flex:none; color:#555b65; }
  .picker-empty { padding:28px 20px; color:#6b7280; font-size:13px; line-height:1.5; text-align:center; }
  button:disabled { opacity:.45; cursor:default; }
  @media(max-width:520px) {
    .roles-section { padding:16px; }
    .section-heading { flex-direction:column; gap:12px; }
    .policy-select, .policy-select select { width:100%; }
    .add-role { width:100%; justify-content:center; min-height:44px; }
    .picker-backdrop { align-items:flex-end; padding:12px; }
    .role-picker { max-height:calc(100dvh - 24px); border-radius:18px; }
    .picker-role { min-height:56px; }
  }
</style>
