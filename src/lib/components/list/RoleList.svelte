<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { appState } from '$lib/stores/appState.svelte';
  import { navigateTo } from '$lib/stores/navigation';
  import { deleteRole, loadRoleAvatar, loadRoles, roleState, setDefaultRole, type Role } from '$lib/stores/roleStore.svelte';

  let deletingId = $state<string | null>(null);

  onMount(async () => {
    await loadRoles();
    await Promise.all(roleState.roles.filter((role) => role.has_avatar).map((role) => loadRoleAvatar(role.id)));
  });

  function openEdit(role: Role) {
    appState.editingCharacter = role;
    navigateTo('roleEditor');
  }

  async function handleDelete(id: string, event: MouseEvent) {
    event.stopPropagation();
    deletingId = id;
    try { await deleteRole(id); } finally { deletingId = null; }
  }
</script>

<div class="hero">
  <div class="hero-icon">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg>
  </div>
  <div class="min-w-0 flex-1">
    <h1 class="text-[1.75rem] font-medium leading-tight tracking-tight text-gray-100">{m.roles_list_title()}</h1>
    <p class="mt-1 text-sm leading-relaxed text-gray-500">{m.roles_list_subtitle()}</p>
  </div>
  {#if roleState.roles.length}<span class="count-badge">{roleState.roles.length}</span>{/if}
</div>

<div class="flex flex-col gap-2">
  {#each roleState.roles as role (role.id)}
    {@const avatar = role.avatarUrl}
    <div class="role-card" role="button" tabindex="0" onclick={() => openEdit(role)} onkeydown={(event) => event.key === 'Enter' && openEdit(role)}>
      <div class="avatar" class:avatar--image={!!avatar}>
        {#if avatar}
          <img src={avatar} alt="" />
        {:else}
          <span>{role.name.slice(0, 1).toUpperCase()}</span>
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="truncate text-sm font-semibold text-gray-200">{role.name}</h3>
        <p class="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-600">{role.prompt || m.role_editor_empty_prompt()}</p>
      </div>
      <div class="actions">
        <button
          class="action-btn action-btn--star"
          class:active={roleState.defaultRoleId === role.id}
          title={roleState.defaultRoleId === role.id ? m.roles_default_current() : m.roles_default_set()}
          aria-label={roleState.defaultRoleId === role.id ? m.roles_default_current() : m.roles_default_set()}
          aria-pressed={roleState.defaultRoleId === role.id}
          onclick={(event) => { event.stopPropagation(); void setDefaultRole(role.id); }}
        >{roleState.defaultRoleId === role.id ? '★' : '☆'}</button>
        <button class="action-btn" title={m.list_btn_edit()} onclick={(event) => { event.stopPropagation(); openEdit(role); }}>✎</button>
        <button class="action-btn action-btn--danger" title={m.list_btn_delete()} disabled={deletingId === role.id} onclick={(event) => handleDelete(role.id, event)}>{deletingId === role.id ? '…' : '×'}</button>
      </div>
    </div>
  {/each}

  {#if roleState.roles.length === 0}
    <div class="rounded-2xl border border-dashed border-white/[.07] bg-white/[.02] px-6 py-12 text-center">
      <p class="text-sm font-medium text-gray-400">{m.roles_list_empty_title()}</p>
      <p class="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-gray-600">{m.roles_list_empty_sub()}</p>
    </div>
  {/if}
</div>

<style>
  .hero { display:flex; align-items:flex-start; gap:16px; margin-bottom:32px; }
  .hero-icon { width:52px; height:52px; flex:none; border-radius:16px; display:flex; align-items:center; justify-content:center; color:#d4b483; background:linear-gradient(135deg,rgba(212,180,131,.16),rgba(212,180,131,.07)); border:1px solid rgba(212,180,131,.2); }
  .count-badge { margin-top:6px; border:1px solid rgba(212,180,131,.2); border-radius:20px; padding:3px 10px; color:#d4b483; background:rgba(212,180,131,.1); font-size:11px; font-weight:700; }
  .role-card { display:flex; align-items:center; gap:14px; padding:14px 18px; border:1px solid rgba(255,255,255,.06); border-radius:14px; background:rgba(255,255,255,.03); cursor:pointer; transition:.18s; }
  .role-card:hover { transform:translateY(-1px); border-color:rgba(212,180,131,.22); background:rgba(255,255,255,.055); }
  .avatar { width:46px; height:46px; flex:none; overflow:hidden; border-radius:13px; display:flex; align-items:center; justify-content:center; color:#d4b483; background:rgba(212,180,131,.08); border:1px solid rgba(212,180,131,.16); font-weight:700; }
  .avatar img { width:100%; height:100%; object-fit:cover; }
  .actions { display:flex; gap:5px; opacity:0; transition:opacity .15s; }
  .role-card:hover .actions, .role-card:focus-within .actions { opacity:1; }
  .action-btn { width:30px; height:30px; border-radius:8px; border:1px solid rgba(255,255,255,.08); background:rgba(255,255,255,.05); color:#6b7280; cursor:pointer; }
  .action-btn:hover { color:#e5e7eb; background:rgba(255,255,255,.1); }
  .action-btn--star { font-size:17px; }
  .action-btn--star.active { color:#d4b483; }
  .action-btn--danger:hover { color:#f87171; background:rgba(239,68,68,.12); }
  @media (max-width: 640px) { .actions { opacity:1; } .role-card { padding:12px; } }
</style>
