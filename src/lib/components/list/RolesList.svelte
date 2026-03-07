<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount }    from 'svelte';
  import { fade }       from 'svelte/transition';
  import {
    roleState,
    loadRoles, deleteRole, setActiveRole,
    type Role,
  } from '$lib/stores/roleStore.svelte';
  import { DEFAULT_ROLES }        from '$lib/data/roles';
  import { appState } from '$lib/stores/appState.svelte';

  const defaultRole = DEFAULT_ROLES[0];
  
  let userRoles = $derived(roleState.allRoles.filter(r => !DEFAULT_ROLES.some(d => d.id === r.id)));

  let deletingId = $state<string | null>(null);

  onMount(() => loadRoles());

  function openEditInEditor(role: Role) {
    appState.editingCharacter = (role as any);
    appState.currentView = 'roleEditor';
  }

  async function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    deletingId = id;
    try   { await deleteRole(id); }
    finally { deletingId = null; }
  }
</script>

<div class="hero">
  <div class="hero-icon">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
      <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
      <line x1="9" y1="9" x2="9.01" y2="9"/>
      <line x1="15" y1="9" x2="15.01" y2="9"/>
    </svg>
  </div>
  <div class="hero-text">
    <h1 class="page-title">{m.roles_list_title()}</h1>
    <p class="page-subtitle">{m.roles_list_subtitle()}</p>
  </div>
  {#if userRoles.length > 0}
    <span class="count-badge">{userRoles.length}</span>
  {/if}
</div>

<div class="list">

  <div
    class="role-card"
    class:role-card--active={roleState.activeRoleId === defaultRole.id}
    role="button" tabindex="0"
    onclick={() => setActiveRole(defaultRole.id)}
    onkeydown={e => e.key === 'Enter' && setActiveRole(defaultRole.id)}
  >
    <div class="role-card__inner">
      <div class="avatar">
        {#if defaultRole.avatarUrl}
          <img src={defaultRole.avatarUrl} alt={defaultRole.name} class="w-full h-full object-cover"/>
        {:else}
          <div class="avatar-initial">{defaultRole.name[0]}</div>
        {/if}
      </div>
      <div class="role-info">
        <h3 class="role-name">{defaultRole.name}</h3>
      </div>
      <div class="role-card__right">
        <span class="badge-standard">{m.roles_list_badge_standard()}</span>
        {#if roleState.activeRoleId === defaultRole.id}
          <div class="active-dot"></div>
        {/if}
      </div>
    </div>
  </div>

  {#if userRoles.length > 0}
    <div class="section-divider">
      <span class="section-label">{m.roles_list_custom_roles()}</span>
      <div class="section-line"></div>
    </div>
  {/if}

  {#each userRoles as role (role.id)}
    <div
      class="role-card"
      class:role-card--active={roleState.activeRoleId === role.id}
      role="button" tabindex="0"
      onclick={() => setActiveRole(role.id)}
      onkeydown={e => e.key === 'Enter' && setActiveRole(role.id)}
    >
      <div class="role-card__inner">
        <div class="avatar">
          {#if role.avatarUrl}
            <img src={role.avatarUrl} alt={role.name} class="w-full h-full object-cover"/>
          {:else}
            <div class="avatar-initial avatar-initial--accent">{role.name[0]}</div>
          {/if}
        </div>
        <div class="role-info">
          <h3 class="role-name">{role.name}</h3>
          {#if role.pronouns}<p class="role-meta">{role.pronouns}</p>{/if}
          {#if role.bio}<p class="role-bio">{role.bio}</p>{/if}
        </div>
        <div class="role-card__right">
          {#if roleState.activeRoleId === role.id}
            <div class="active-dot"></div>
          {/if}
          <div class="actions">
            <button class="action-btn" title={m.list_btn_edit()}
              onclick={(e) => { e.stopPropagation(); openEditInEditor(role); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="action-btn action-btn--danger" title={m.list_btn_delete()}
              disabled={deletingId === role.id}
              onclick={e => handleDelete(role.id, e)}>
              {#if deletingId === role.id}
                <svg class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round"/>
                </svg>
              {:else}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4h6v2"/>
                </svg>
              {/if}
            </button>
          </div>
        </div>
      </div>
    </div>
  {/each}

  {#if userRoles.length === 0}
    <div class="empty-state" in:fade={{ duration: 200 }}>
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.4"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
          <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
          <line x1="9" y1="9" x2="9.01" y2="9"/>
          <line x1="15" y1="9" x2="15.01" y2="9"/>
        </svg>
      </div>
      <p class="empty-title">{m.roles_list_empty_title()}</p>
      <p class="empty-sub">{m.roles_list_empty_sub()}</p>
    </div>
  {/if}
</div>

<style>
  .hero {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 32px;
  }

  .hero-icon {
    flex-shrink: 0;
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(212,180,131,.16) 0%, rgba(212,180,131,.07) 100%);
    border: 1px solid rgba(212,180,131,.20);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #d4b483;
    margin-top: 2px;
  }

  .hero-text { flex: 1; min-width: 0; }

  .count-badge {
    margin-left: auto;
    align-self: flex-start;
    margin-top: 6px;
    font-size: 11px;
    font-weight: 700;
    color: #d4b483;
    background: rgba(212,180,131,.10);
    border: 1px solid rgba(212,180,131,.20);
    border-radius: 20px;
    padding: 3px 10px;
    letter-spacing: .03em;
  }

  .page-title {
    font-size: 1.75rem;
    font-weight: 500;
    color: #f3f4f6;
    letter-spacing: -.02em;
    line-height: 1.2;
    margin-bottom: 5px;
  }

  .page-subtitle {
    font-size: .875rem;
    color: #6b7280;
    line-height: 1.55;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0 4px;
  }

  .section-label {
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .10em;
    color: #4b5563;
  }

  .section-line {
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,.05);
  }

  .role-card {
    width: 100%;
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.06);
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    transition: background .18s, border-color .18s, box-shadow .18s, transform .12s;
  }

  .role-card:hover {
    background: rgba(255,255,255,.055);
    border-color: rgba(212,180,131,.22);
    box-shadow: 0 4px 24px rgba(0,0,0,.22);
    transform: translateY(-1px);
  }

  .role-card:active { transform: translateY(0); }

  .role-card--active {
    background: rgba(212,180,131,.06) !important;
    border-color: rgba(212,180,131,.28) !important;
    box-shadow:
      0 0 0 1px rgba(212,180,131,.08) inset,
      0 4px 16px rgba(0,0,0,.18) !important;
  }

  .role-card__inner {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
  }

  .avatar {
    width: 46px;
    height: 46px;
    border-radius: 13px;
    overflow: hidden;
    flex-shrink: 0;
    background: rgba(255,255,255,.05);
    border: 1px solid rgba(255,255,255,.08);
  }

  .avatar-initial {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 16px;
    font-weight: 700;
    color: rgba(255,255,255,.38);
  }

  .avatar-initial--accent {
    background: linear-gradient(135deg, rgba(212,180,131,.20) 0%, rgba(212,180,131,.10) 100%);
    color: #d4b483;
  }

  .role-info { flex: 1; min-width: 0; }

  .role-name {
    font-size: 14px;
    font-weight: 600;
    color: #e5e7eb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color .15s;
  }

  .role-card:hover .role-name { color: #f9fafb; }
  .role-card--active .role-name { color: #d4b483; }

  .role-meta {
    font-size: 12px;
    color: #6b7280;
    margin-top: 2px;
  }

  .role-bio {
    font-size: 12px;
    color: #4b5563;
    margin-top: 3px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .role-card__right {
    display: flex;
    align-items: center;
    gap: 10px;
    flex-shrink: 0;
  }

  .badge-standard {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: .08em;
    color: #4b5563;
    padding: 3px 9px;
    border-radius: 6px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.07);
  }

  .active-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: #d4b483;
    box-shadow: 0 0 8px rgba(212,180,131,.6);
    flex-shrink: 0;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 5px;
    opacity: 0;
    transition: opacity .15s;
  }

  .role-card:hover .actions { opacity: 1; }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.05);
    color: #6b7280;
    cursor: pointer;
    font-family: inherit;
    transition: background .12s, color .12s, border-color .12s;
  }

  .action-btn:hover {
    background: rgba(255,255,255,.10);
    border-color: rgba(255,255,255,.14);
    color: #e5e7eb;
  }

  .action-btn--danger:hover {
    background: rgba(239,68,68,.12);
    border-color: rgba(239,68,68,.20);
    color: #f87171;
  }

  .action-btn:disabled { opacity: .4; cursor: not-allowed; }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 48px 24px;
    text-align: center;
    background: rgba(255,255,255,.02);
    border: 1px dashed rgba(255,255,255,.07);
    border-radius: 16px;
    margin-top: 4px;
  }

  .empty-icon {
    width: 60px;
    height: 60px;
    border-radius: 18px;
    background: linear-gradient(135deg, rgba(212,180,131,.12) 0%, rgba(212,180,131,.06) 100%);
    border: 1px solid rgba(212,180,131,.16);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(212,180,131,.55);
    margin-bottom: 4px;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 500;
    color: #9ca3af;
  }

  .empty-sub {
    font-size: 13px;
    color: #4b5563;
    line-height: 1.6;
    max-width: 300px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  :global(.spin) { animation: spin .6s linear infinite; }
</style>