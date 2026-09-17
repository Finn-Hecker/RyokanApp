<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { loadRoles, roleState } from '$lib/stores/roleStore.svelte';
  import type { BundledRoleSnapshot, RolePolicy } from '$lib/stores/characterStore.svelte';

  let {
    rolePolicy = $bindable('open'),
    bundledRoles = [],
    onAdd,
    onRemove,
  }: {
    rolePolicy?: RolePolicy;
    bundledRoles?: BundledRoleSnapshot[];
    onAdd?: (roleId: string) => Promise<void> | void;
    onRemove?: (snapshotId: string) => Promise<void> | void;
  } = $props();

  let selectedRoleId = $state('');
  let busy = $state(false);
  onMount(() => loadRoles());

  async function addSelected() {
    if (!selectedRoleId || busy) return;
    busy = true;
    try {
      await onAdd?.(selectedRoleId);
      selectedRoleId = '';
    } finally { busy = false; }
  }

  async function remove(snapshotId: string) {
    if (busy) return;
    busy = true;
    try { await onRemove?.(snapshotId); } finally { busy = false; }
  }
</script>

<section class="roles-section">
  <div class="mb-4">
    <h3 class="text-sm font-semibold text-gray-300">{m.character_roles_title()}</h3>
    <p class="mt-1 text-xs leading-relaxed text-gray-600">{m.character_roles_subtitle()}</p>
  </div>

  <div class="policy-grid">
    <label class:active={rolePolicy === 'open'}>
      <input type="radio" bind:group={rolePolicy} value="open" />
      <span><strong>{m.character_roles_open()}</strong><small>{m.character_roles_open_desc()}</small></span>
    </label>
    <label class:active={rolePolicy === 'restricted'}>
      <input type="radio" bind:group={rolePolicy} value="restricted" />
      <span><strong>{m.character_roles_restricted()}</strong><small>{m.character_roles_restricted_desc()}</small></span>
    </label>
  </div>

  {#if bundledRoles.length > 0}
    <div class="mt-4 flex flex-col gap-2">
      {#each bundledRoles as role (role.id)}
        <div class="snapshot-row">
          <div class="snapshot-avatar">{role.name.slice(0, 1).toUpperCase()}</div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-sm font-medium text-gray-300">{role.name}</p>
            <p class="truncate text-xs text-gray-600">{role.prompt || m.role_editor_empty_prompt()}</p>
          </div>
          <button type="button" aria-label={m.character_roles_remove()} onclick={() => remove(role.id)} disabled={busy}>×</button>
        </div>
      {/each}
    </div>
  {:else}
    <p class="mt-4 rounded-lg border border-dashed border-white/[.07] px-3 py-3 text-center text-xs text-gray-600">{m.character_roles_empty()}</p>
  {/if}

  {#if roleState.roles.length > 0}
    <div class="mt-3 flex flex-col gap-2 sm:flex-row">
      <select bind:value={selectedRoleId} class="role-select">
        <option value="">{m.character_roles_choose()}</option>
        {#each roleState.roles as role (role.id)}<option value={role.id}>{role.name}</option>{/each}
      </select>
      <button type="button" class="add-btn" disabled={!selectedRoleId || busy} onclick={addSelected}>{m.character_roles_add()}</button>
    </div>
  {:else}
    <p class="mt-3 text-xs text-gray-600">{m.character_roles_no_global()}</p>
  {/if}

  {#if rolePolicy === 'restricted' && bundledRoles.length === 0}
    <p class="mt-3 text-xs font-medium text-amber-400">{m.character_roles_restricted_error()}</p>
  {/if}
</section>

<style>
  .roles-section { margin-top:8px; padding:16px; border:1px solid rgba(255,255,255,.06); border-radius:16px; background:rgba(255,255,255,.02); }
  .policy-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; }
  .policy-grid label { display:flex; gap:9px; padding:11px; border:1px solid rgba(255,255,255,.07); border-radius:11px; cursor:pointer; background:rgba(255,255,255,.02); }
  .policy-grid label.active { border-color:rgba(212,180,131,.32); background:rgba(212,180,131,.07); }
  .policy-grid input { margin-top:3px; accent-color:#d4b483; }
  .policy-grid span { display:flex; flex-direction:column; min-width:0; }
  .policy-grid strong { color:#d1d5db; font-size:12px; }
  .policy-grid small { margin-top:2px; color:#4b5563; font-size:10px; line-height:1.4; }
  .snapshot-row { display:flex; align-items:center; gap:10px; padding:9px 10px; border-radius:10px; background:rgba(255,255,255,.035); }
  .snapshot-avatar { width:34px; height:34px; flex:none; display:flex; align-items:center; justify-content:center; border-radius:9px; color:#d4b483; background:rgba(212,180,131,.09); font-size:12px; font-weight:700; }
  .snapshot-row button { width:28px; height:28px; border:0; border-radius:7px; color:#6b7280; background:transparent; cursor:pointer; font-size:18px; }
  .snapshot-row button:hover { color:#f87171; background:rgba(239,68,68,.1); }
  .role-select { min-width:0; flex:1; border:1px solid rgba(255,255,255,.08); border-radius:9px; padding:8px 10px; color:#d1d5db; background:#18181b; font:inherit; font-size:12px; }
  .add-btn { border:1px solid rgba(212,180,131,.25); border-radius:9px; padding:8px 13px; color:#d4b483; background:rgba(212,180,131,.08); font-size:12px; font-weight:600; cursor:pointer; }
  .add-btn:disabled { opacity:.4; cursor:default; }
  @media(max-width:520px) { .policy-grid { grid-template-columns:1fr; } }
</style>
