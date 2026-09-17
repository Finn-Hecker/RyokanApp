<script lang="ts">
  import { appState } from '$lib/stores/appState.svelte';
  import { navigateTo, registerBackHandler } from '$lib/stores/navigation';
  import { characterState, loadCharacters, toggleHideCharacter, togglePinCharacter, deleteCharacter, loadHiddenIds, loadPinnedIds } from '$lib/stores/characterStore.svelte';
  import { startNewChat } from '$lib/stores/chatStore.svelte';
  import type { RoleSelection } from '$lib/stores/chatStore.svelte';
  import { loadRoles, roleState } from '$lib/stores/roleStore.svelte';
  import { onMount } from 'svelte';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import * as m from '$lib/paraglide/messages';

  import LobbyToolbar from './LobbyToolbar.svelte';
  import CharacterGridView from './CharacterGridView.svelte';
  import CharacterCompactView from './CharacterCompactView.svelte';
  import CharacterListView from './CharacterListView.svelte';
  import LobbyEmptyState from './LobbyEmptyState.svelte';
  import DeleteConfirmModal from './DeleteConfirmModal.svelte';

  let searchQuery = $state('');
  let viewMode = $state<'grid' | 'compact' | 'list'>('grid');
  let showHidden = $state(false);

  let deleteTarget = $state<{ id: string; name: string } | null>(null);
  let startTarget = $state<any | null>(null);
  let selectedRole = $state('none');
  let isStarting = $state(false);
  let startError = $state('');

  $effect(() => {
    if (!deleteTarget && !startTarget) return;
    return registerBackHandler(() => {
      if (deleteTarget) deleteTarget = null;
      else startTarget = null;
      return true;
    });
  });

  onMount(async () => {
    await loadHiddenIds();
    await loadPinnedIds();
    await loadCharacters();
    await loadRoles();
    const saved = localStorage.getItem('ryokan-view-mode');
    if (saved === 'grid' || saved === 'compact' || saved === 'list') {
      viewMode = saved;
    }
  });

  async function onSelectChar(char: any) {
    const bundledRoles = char.bundled_roles ?? [];
    if (char.role_policy === 'restricted') {
      if (bundledRoles.length === 1) {
        await beginChat(char, { source: 'bundled', id: bundledRoles[0].id });
        return;
      }
      openRoleChooser(char);
      return;
    }

    const defaultSelection: RoleSelection | null = roleState.defaultRoleId
      ? { source: 'global', id: roleState.defaultRoleId }
      : null;
    await beginChat(char, defaultSelection);
  }

  function openRoleChooser(char: any) {
    startTarget = char;
    selectedRole = char.role_policy === 'restricted' && char.bundled_roles?.length
      ? `bundled:${char.bundled_roles[0].id}`
      : 'none';
    startError = '';
  }

  function onStartAs(e: MouseEvent, char: any) {
    e.stopPropagation();
    openRoleChooser(char);
  }

  function selectionFromValue(): RoleSelection | null {
    if (selectedRole === 'none') return null;
    const [source, id] = selectedRole.split(':', 2);
    return { source: source as RoleSelection['source'], id };
  }

  async function beginChat(char = startTarget, selection = selectionFromValue()) {
    if (!char || isStarting) return;
    isStarting = true;
    startError = '';
    appState.activeCharacter = char;
    try {
      await startNewChat(char, selection);
      startTarget = null;
      navigateTo('chat');
    } catch {
      startError = m.role_start_error();
    } finally { isStarting = false; }
  }

  function onOpenCreate() {
    appState.editingCharacter = null;
    navigateTo('create');
  }

  function onOpenGroups() {
    navigateTo('play');
  }

  function onOpenSettings() {
    navigateTo('settings');
  }

  function onEditChar(e: MouseEvent, char: any) {
    e.stopPropagation();
    appState.editingCharacter = char;
    navigateTo('create');
  }

  function onToggleHide(e: MouseEvent, char: any) {
    e.stopPropagation();
    toggleHideCharacter(char.id);
  }

  function onTogglePin(e: MouseEvent, char: any) {
    e.stopPropagation();
    togglePinCharacter(char.id);
  }

  function onDeleteChar(e: MouseEvent, char: any) {
    e.stopPropagation();
    deleteTarget = { id: String(char.id), name: char.name };
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    try {
      await deleteCharacter(deleteTarget.id);
    } catch (err) {
      console.error('Delete failed:', err);
    } finally {
      deleteTarget = null;
    }
  }

  function resolveDesc(char: any): string {
    return (char.description?.trim() || char.prompt || '')
      .replace(/\{\{char\}\}/g, char.name);
  }

  let filtered = $derived(
    (characterState.allCharacters ?? [])
      .filter(Boolean)
      .filter((c: any) => c.play_mode === 'solo')
      .filter((c: any) => showHidden || !characterState.hiddenCharacterIds.has(String(c.id)))
      .filter((c: any) =>
        searchQuery.trim() === '' ||
        c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.prompt?.toLowerCase().includes(searchQuery.toLowerCase())
      )
      .sort((a: any, b: any) => {
        const aPinned = characterState.pinnedCharacterIds.has(String(a.id));
        const bPinned = characterState.pinnedCharacterIds.has(String(b.id));
        if (aPinned && !bPinned) return -1;
        if (!aPinned && bPinned) return 1;
        return 0;
      })
  );

  let hasHidden = $derived(
    (characterState.allCharacters ?? []).some((c: any) => characterState.hiddenCharacterIds.has(String(c.id)))
  );
</script>

{#snippet sidebar({ layout, interactionMode, isOpen, close }: { layout: 'inline' | 'drawer', interactionMode: 'desktop' | 'mobile', isOpen: boolean, close: () => void })}
  <div class="h-full flex flex-col overflow-hidden">
    <Sidebar {layout} {interactionMode} {isOpen} {close} />
  </div>
{/snippet}

{#snippet header()}
  <div class="flex items-center gap-3">
    <Button variant="icon" ariaLabel={m.lobby_label_open_groups()} onclick={onOpenGroups}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="7" r="3"/>
        <path d="M6 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/>
        <circle cx="5" cy="9" r="2.2"/>
        <path d="M1.5 19.5c0-2.4 1.6-3.9 3.5-3.9"/>
        <circle cx="19" cy="9" r="2.2"/>
        <path d="M22.5 19.5c0-2.4-1.6-3.9-3.5-3.9"/>
      </svg>
    </Button>

    <div class="w-px h-6 bg-white/10"></div>

    <Button variant="secondary" onclick={onOpenCreate}>
      <svg class="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span class="truncate max-w-[70px] hidden md:block">{m.lobby_btn_open_create_char()}</span>
    </Button>
    <Button variant="icon" ariaLabel={m.lobby_btn_open_settings()} onclick={onOpenSettings}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </Button>
  </div>
{/snippet}

<PageLayout
  pageTitle={m.welcome_title()}
  showSidebar={true}
  maxContentWidth="max-w-7xl"
  {sidebar}
  {header}
>
  <header class="mb-4 md:mb-6">
    <h1 class="text-2xl sm:text-3xl md:text-4xl font-medium text-gray-100 mb-2 md:mb-3 tracking-tight">{m.welcome_title()}</h1>
    <p class="text-gray-500 text-base md:text-lg">
      {m.lobby_subtitle_pre()} <span class="text-ryokan-accent">{m.lobby_subtitle_highlight()}</span> {m.lobby_subtitle_post()}
    </p>
  </header>

  <LobbyToolbar bind:searchQuery bind:viewMode bind:showHidden {hasHidden} />

  {#if viewMode === 'grid'}
    <CharacterGridView
      characters={filtered}
      {showHidden}
      onSelect={onSelectChar}
      onEdit={onEditChar}
      onDelete={onDeleteChar}
      {onStartAs}
      {onToggleHide}
      {onTogglePin}
      {resolveDesc}
    />
  {:else if viewMode === 'compact'}
    <CharacterCompactView
      characters={filtered}
      {showHidden}
      onSelect={onSelectChar}
      onEdit={onEditChar}
      onDelete={onDeleteChar}
      {onStartAs}
      {onToggleHide}
      {onTogglePin}
    />
  {:else if viewMode === 'list'}
    <CharacterListView
      characters={filtered}
      {showHidden}
      onSelect={onSelectChar}
      onEdit={onEditChar}
      onDelete={onDeleteChar}
      {onStartAs}
      {onToggleHide}
      {onTogglePin}
      {resolveDesc}
    />
  {/if}

  {#if filtered.length === 0}
    <LobbyEmptyState {searchQuery} onResetSearch={() => (searchQuery = '')} />
  {/if}
</PageLayout>

{#if deleteTarget}
  <DeleteConfirmModal
    charName={deleteTarget.name}
    onConfirm={confirmDelete}
    onCancel={() => (deleteTarget = null)}
  />
{/if}

{#if startTarget}
  <div class="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center sm:p-4" role="presentation" onclick={(event) => event.target === event.currentTarget && (startTarget = null)}>
    <div role="dialog" aria-modal="true" aria-labelledby="role-start-title" class="max-h-[85vh] w-full max-w-md overflow-y-auto rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-2xl sm:p-6">
      <div class="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id="role-start-title" class="font-medium text-gray-100">{m.role_start_title({ character: startTarget.name })}</h2>
          <p class="mt-1 text-sm text-gray-500">{startTarget.role_policy === 'restricted' ? m.role_start_restricted_desc() : m.role_start_open_desc()}</p>
        </div>
        <button class="flex h-8 w-8 items-center justify-center rounded-lg text-gray-500 hover:bg-white/[.06] hover:text-gray-200" aria-label={m.create_char_close_aria()} onclick={() => (startTarget = null)}>×</button>
      </div>

      <div class="space-y-2">
        {#if startTarget.role_policy === 'open'}
          <label class="role-option" class:active={selectedRole === 'none'}>
            <input type="radio" bind:group={selectedRole} value="none" />
            <span><strong>{m.role_start_none()}</strong><small>{m.role_start_none_desc()}</small></span>
          </label>
        {/if}

        {#if startTarget.bundled_roles?.length}
          <p class="group-label">{m.role_start_bundled_group()}</p>
          {#each startTarget.bundled_roles as role (role.id)}
            <label class="role-option" class:active={selectedRole === `bundled:${role.id}`}>
              <input type="radio" bind:group={selectedRole} value={`bundled:${role.id}`} />
              <span><strong>{role.name}</strong><small>{role.prompt || m.role_editor_empty_prompt()}</small></span>
              <em>{m.role_start_bundled_badge()}</em>
            </label>
          {/each}
        {/if}

        {#if startTarget.role_policy === 'open' && roleState.roles.length}
          <p class="group-label">{m.role_start_global_group()}</p>
          {#each roleState.roles as role (role.id)}
            <label class="role-option" class:active={selectedRole === `global:${role.id}`}>
              <input type="radio" bind:group={selectedRole} value={`global:${role.id}`} />
              <span><strong>{role.name}</strong><small>{role.prompt || m.role_editor_empty_prompt()}</small></span>
            </label>
          {/each}
        {/if}
      </div>

      {#if startTarget.role_policy === 'restricted' && !startTarget.bundled_roles?.length}
        <p class="mt-4 text-sm text-amber-400">{m.role_start_restricted_empty()}</p>
      {/if}
      {#if startError}<p class="mt-3 text-sm text-red-400">{startError}</p>{/if}

      <div class="mt-5 flex justify-end gap-2">
        <Button variant="secondary" onclick={() => (startTarget = null)}>{m.delete_confirm_cancel()}</Button>
        <Button disabled={isStarting || (startTarget.role_policy === 'restricted' && !selectedRole.startsWith('bundled:'))} onclick={() => beginChat()}>{isStarting ? m.role_start_starting() : m.role_start_button()}</Button>
      </div>
    </div>
  </div>
{/if}

<style>
  .group-label { padding:10px 2px 2px; color:#6b7280; font-size:10px; font-weight:700; letter-spacing:.12em; text-transform:uppercase; }
  .role-option { display:flex; align-items:center; gap:10px; padding:11px 12px; border:1px solid rgba(255,255,255,.07); border-radius:11px; background:rgba(255,255,255,.025); cursor:pointer; }
  .role-option.active { border-color:rgba(212,180,131,.32); background:rgba(212,180,131,.07); }
  .role-option input { accent-color:#d4b483; }
  .role-option span { min-width:0; flex:1; display:flex; flex-direction:column; }
  .role-option strong { color:#d1d5db; font-size:13px; }
  .role-option small { overflow:hidden; color:#4b5563; font-size:11px; text-overflow:ellipsis; white-space:nowrap; }
  .role-option em { flex:none; border:1px solid rgba(212,180,131,.18); border-radius:6px; padding:2px 6px; color:rgba(212,180,131,.75); background:rgba(212,180,131,.08); font-size:9px; font-style:normal; font-weight:700; text-transform:uppercase; }
</style>
