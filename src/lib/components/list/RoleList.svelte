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

<div class="list">
  {#each roleState.roles as role (role.id)}
    {@const avatar = role.avatarUrl}
    <div class="role-card" role="button" tabindex="0" onclick={() => openEdit(role)} onkeydown={(event) => { if (event.target !== event.currentTarget) return; if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openEdit(role); } }}>
      <div class="avatar">
        {#if avatar}
          <img src={avatar} alt="" />
        {:else}
          <span>{role.name.slice(0, 1).toUpperCase()}</span>
        {/if}
      </div>
      <div class="min-w-0 flex-1">
        <h3 class="wi-name">{role.name}</h3>
        <p class="wi-desc line-clamp-2">{role.prompt || m.role_editor_empty_prompt()}</p>
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
        <button class="action-btn" aria-label={m.list_btn_edit()} title={m.list_btn_edit()} onclick={(event) => { event.stopPropagation(); openEdit(role); }}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="action-btn action-btn--danger" aria-label={m.list_btn_delete()} title={m.list_btn_delete()} disabled={deletingId === role.id} onclick={(event) => handleDelete(role.id, event)}>{#if deletingId === role.id}<svg class="spin" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round"/></svg>{:else}<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 6h18M19 6l-1 14H6L5 6M10 11v6M14 11v6M9 6V4h6v2"/></svg>{/if}</button>
      </div>
    </div>
  {/each}

  {#if roleState.roles.length === 0}
    <div class="empty-state">
      <p class="empty-title">{m.roles_list_empty_title()}</p>
      <p class="empty-sub">{m.roles_list_empty_sub()}</p>
    </div>
  {/if}
</div>
