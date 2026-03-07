<script lang="ts">
  import { onMount } from 'svelte';
  import { fade } from 'svelte/transition';
  import { appState } from '$lib/stores/appState.svelte';
  import { characterState, toggleHideCharacter } from '$lib/stores/characterStore.svelte';
  import * as m from '$lib/paraglide/messages';

  import SimpleFormPage from '$lib/components/layouts/SimpleFormPage.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ExportToast from '$lib/components/editor/shared/ExportToast.svelte';
  import DeleteConfirmDialog from '$lib/components/editor/shared/DeleteConfirmDialog.svelte';

  import CharacterTab from '$lib/components/editor/character/CharacterTab.svelte';
  import RoleTab from '$lib/components/editor/roles/RolesTab.svelte';
  import WorldInfoTab from '$lib/components/editor/worldinfo/WorldInfoTab.svelte';
  import type { WorldInfoEntry } from '$lib/components/editor/worldinfo/worldInfoLogic';
  import { createWorldInfo, updateWorldInfo } from '$lib/components/editor/worldinfo/worldInfoLogic';
  import { type Role } from '$lib/stores/roleStore.svelte';
  import { saveNewRole, saveExistingRole, removeRole } from '$lib/components/editor/roles/rolesLogic';

  import {
    saveCharacter,
    removeCharacter,
    exportCharacterCard,
    importCharacterFromFile,
    readImageAsDataUrl
  } from '$lib/components/editor/character/characterLogic';

  type Tab = 'character' | 'role' | 'worldinfo';

  let activeTab = $state<Tab>('character');
  let editRole = $state<Role | null>(null);

  const tabs: { id: Tab; label: string; icon: string }[] = [
    {
      id: 'character',
      label: m.creator_tab_character(),
      icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2 M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'
    },
    {
      id: 'role',
      label: m.creator_tab_role(),
      icon: 'M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z M8 14s1.5 2 4 2 4-2 4-2 M9 9h.01 M15 9h.01'
    },
    {
      id: 'worldinfo',
      label: m.creator_tab_lorebook(),
      icon: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20 M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z'
    },
  ];

  let editChar = $state<any>(null);
  
  let isEditMode = $derived(!!editChar);
  let isHidden = $derived(editChar?.id != null ? characterState.hiddenCharacterIds.has(editChar.id) : false);
  let isAnyEditMode = $derived(isEditMode || !!editRole);

  // Character States
  let charName = $state('');
  let charDescription = $state('');
  let charPersonality = $state('');
  let charScenario = $state('');
  let charGreeting = $state('');
  let charMesExample = $state('');
  let charCreatorNotes = $state('');
  let charAltGreetings = $state<string[]>([]);
  let worldInfoIds = $state<string[]>([]);
  let avatarPreview = $state<string | null>(null);
  let avatarChanged = $state(true);

  // Role States
  let roleName = $state('');
  let roleDescription = $state('');
  let rolePronouns = $state('');
  let roleAvatar = $state<string | null>(null);
  let roleAvatarChanged = $state(true);

  // WorldInfo States
  let worldInfoName = $state('');
  let worldInfoDescription = $state('');
  let worldInfoEntries = $state<WorldInfoEntry[]>([]);

  // UI States
  let isSaving = $state(false);
  let isDeleting = $state(false);
  let isExporting = $state(false);
  let showDeleteConfirm = $state(false);
  let menuOpen = $state(false);
  
  let menuRef = $state<HTMLDivElement | null>(null);
  let importInput = $state<HTMLInputElement | null>(null);
  
  let exportToast = $state<'success' | 'error' | null>(null);
  let toastTimeout: ReturnType<typeof setTimeout>;
  let fromRoleManager = $state(false);

  onMount(() => {
    if (appState.currentView === 'roleEditor') {
      activeTab = 'role';
      fromRoleManager = true;
    }
    if (appState.currentView === 'worldInfoEditor') {
      activeTab = 'worldinfo';
      fromRoleManager = true;
    }

    const current = appState.editingCharacter;
    if (!current) return;

    editChar = current;

    charName = current.name ?? '';
    charDescription = current.desc ?? '';
    charPersonality = current.personality ?? '';
    charScenario = current.scenario ?? '';
    charGreeting = current.greeting ?? '';
    charMesExample = current.mes_example ?? '';
    charCreatorNotes = current.creator_notes ?? '';
    charAltGreetings = Array.isArray(current.alternate_greetings) ? current.alternate_greetings : [];
    worldInfoIds = Array.isArray(current.world_info_ids) ? current.world_info_ids : [];

    if (current.avatarUrl) {
      avatarPreview = current.avatarUrl;
      avatarChanged = false;
    }

    if (appState.currentView === 'roleEditor') {
      editRole = current as Role;
      roleName = editRole.name ?? '';
      roleDescription = editRole.bio ?? '';
      rolePronouns = editRole.pronouns ?? '';
      roleAvatar = editRole.avatarUrl ?? null;
      roleAvatarChanged = false;
    }

    if (appState.currentView === 'worldInfoEditor') {
      activeTab = 'worldinfo';
      fromRoleManager = true;

      const wi = appState.editingCharacter;
      if (wi) {
        worldInfoName = wi.name ?? '';
        worldInfoDescription = wi.description ?? '';
        worldInfoEntries = Array.isArray(wi.entries) ? wi.entries : [];
      }
    }
  });

  let canSave = $derived(
    activeTab === 'character'
      ? !!(charName && charDescription)
      : activeTab === 'role'
        ? !!roleName
        : !!worldInfoName
  );

  let saveLabel = $derived(m.create_page_btn_done());

  function showToast(type: 'success' | 'error') {
    clearTimeout(toastTimeout);
    exportToast = type;
    toastTimeout = setTimeout(() => (exportToast = null), 2800);
  }

  function goBack() {
    appState.editingCharacter =  null;
    appState.currentView = fromRoleManager ? 'list' : 'lobby';
  }

  function toggleMenu() { menuOpen = !menuOpen; }

  function handleOutsideClick(e: MouseEvent) {
    if (menuOpen && menuRef && !menuRef.contains(e.target as Node)) {
      menuOpen = false;
    }
  }

  async function handleCharAvatarFile(file: File) {
    try {
      avatarPreview = await readImageAsDataUrl(file);
      avatarChanged = true;
    } catch { /* not an image */ }
  }

  async function handleImportFile(file: File) {
    if (!file.type.includes('image')) return;
    try {
      const result = await importCharacterFromFile(file);
      if (result.avatarDataUrl) { avatarPreview = result.avatarDataUrl; avatarChanged = true; }
      if (result.name) charName = result.name;
      if (result.description) charDescription = result.description;
      if (result.personality) charPersonality = result.personality;
      if (result.scenario) charScenario = result.scenario;
      if (result.greeting) charGreeting = result.greeting;
      if (result.mes_example) charMesExample = result.mes_example;
      if (result.creator_notes) charCreatorNotes = result.creator_notes;
      if (result.alternate_greetings) charAltGreetings = result.alternate_greetings;
    } catch (err) {
      console.warn('Import failed:', err);
    }
  }

  async function handleRoleAvatarFile(file: File) {
    try {
      roleAvatar = await readImageAsDataUrl(file);
      roleAvatarChanged = true;
    } catch { /* not an image */ }
  }

  async function handleSave() {
    if (!canSave) return;
    isSaving = true;
    try {
      if (activeTab === 'character') {
        await saveCharacter(
          {
            name: charName, description: charDescription,
            personality: charPersonality, scenario: charScenario,
            greeting: charGreeting, mes_example: charMesExample,
            creator_notes: charCreatorNotes, alternate_greetings: charAltGreetings,
            world_info_ids: worldInfoIds,
          },
          editChar, avatarPreview, avatarChanged
        );
        goBack();
      } else if (activeTab === 'role') {
        const opts = {
          name: roleName,
          bio: roleDescription,
          pronouns: rolePronouns,
          avatarDataUrl: roleAvatar,
          avatarChanged: roleAvatarChanged,
        };
        if (editRole) {
          await saveExistingRole(editRole.id, opts);
        } else {
          await saveNewRole(opts);
        }
        goBack();
      } else {
        const data = {
          name: worldInfoName,
          description: worldInfoDescription,
          entries: worldInfoEntries,
        };
        if (editChar?.id) {
          await updateWorldInfo(editChar.id, data);
        } else {
          await createWorldInfo(data);
        }
        goBack();
      }
    } finally {
      isSaving = false;
    }
  }

  async function handleDelete() {
    isDeleting = true;
    try {
      if (activeTab === 'role' && editRole) {
        await removeRole(editRole.id);
      } else if (editChar?.isCustom) {
        await removeCharacter(editChar);
      } else if (activeTab === 'worldinfo' && editChar?.id) {
        //await deleteWorldInfo(editChar.id);
      }
      goBack();
    } finally {
      isDeleting = false;
      showDeleteConfirm = false;
    }
  }

  function handleImportClick() { menuOpen = false; importInput?.click(); }
  function handleDeleteClick() { menuOpen = false; showDeleteConfirm = true; }
  function handleHideClick() { menuOpen = false; toggleHideCharacter(editChar.id); goBack(); }

  async function handleExport() {
    if (!editChar?.id) return;
    menuOpen = false;
    isExporting = true;
    try {
      await exportCharacterCard(editChar.id, charName);
      showToast('success');
    } catch (e) {
      console.error('Export failed:', e);
      showToast('error');
    } finally {
      isExporting = false;
    }
  }
</script>

<svelte:window onmousedown={handleOutsideClick} />

<div class="relative h-full w-full">

  {#if showDeleteConfirm}
    <DeleteConfirmDialog
      characterName={editChar?.name ?? ''}
      {isDeleting}
      onConfirm={handleDelete}
      onCancel={() => (showDeleteConfirm = false)}
    />
  {/if}

  <ExportToast type={exportToast} />

  <input
    type="file"
    bind:this={importInput}
    onchange={(e: any) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
    accept="image/png,image/webp"
    hidden
  />

  {#snippet actions()}
    <div class="flex items-center gap-2">
      <Button variant="icon" ariaLabel={m.create_page_aria_back()} onclick={goBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </Button>

      <div class="relative" bind:this={menuRef}>
        <Button variant="icon" ariaLabel={m.create_page_aria_more_options()} onclick={toggleMenu}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>
          </svg>
        </Button>

        {#if menuOpen}
          <div class="dropdown-menu">

            {#if activeTab === 'character'}
              {#if !isEditMode}
                <button class="menu-item" onclick={handleImportClick}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span>{m.create_page_import_card()}</span>
                </button>
              {/if}

              {#if isEditMode && editChar?.isCustom}
                <button class="menu-item" onclick={handleExport} disabled={isExporting}>
                  {#if isExporting}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="spin">
                      <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                    </svg>
                  {:else}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                      <polyline points="7 10 12 15 17 10"/>
                      <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                  {/if}
                  <span>{m.create_page_export_card()}</span>
                </button>

                <div class="menu-divider"></div>

                <button class="menu-item" onclick={handleHideClick}>
                  {#if isHidden}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                    <span>{m.create_page_show_in_lobby()}</span>
                  {:else}
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                    <span>{m.create_page_hide_from_lobby()}</span>
                  {/if}
                </button>

                <button class="menu-item menu-item--danger" onclick={handleDeleteClick}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="3 6 5 6 21 6"/>
                    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                    <path d="M10 11v6M14 11v6"/>
                    <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                  </svg>
                  <span>{m.create_page_delete()}</span>
                </button>
              {/if}
            {/if}

            {#if activeTab === 'role' || activeTab === 'worldinfo'}
              <button class="menu-item menu-item--danger" onclick={handleDeleteClick}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                <span>Delete {activeTab === 'role' ? 'Role' : 'World Info'}</span>
              </button>
            {/if}

          </div>
        {/if}
      </div>

      <Button variant="secondary" disabled={!canSave || isSaving} onclick={handleSave}>
        {#if isSaving}
          <span class="save-spinner"></span>
        {:else}
          {saveLabel}
        {/if}
      </Button>
    </div>
  {/snippet}

  <SimpleFormPage {actions}>

    {#if !isAnyEditMode}
      <div class="page-heading text-center">
        <h1 class="page-title">
          {activeTab === 'character'
            ? (isEditMode ? m.creator_title_edit_character() : m.creator_title_new_character())
            : activeTab === 'role'
              ? m.creator_title_new_role()
              : m.creator_title_new_lorebook()}
        </h1>
        <p class="page-subtitle">
            {activeTab === 'character'
              ? m.creator_subtitle_character()
              : activeTab === 'role'
                ? m.creator_subtitle_role()
                : m.creator_subtitle_lorebook()}
        </p>
      </div>

      <div class="tab-row">
        <div class="tab-bar">
          {#each tabs as tab}
            <button
              class="tab-btn"
              class:tab-btn--active={activeTab === tab.id}
              onclick={() => (activeTab = tab.id)}
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d={tab.icon}/>
              </svg>
              {tab.label}
            </button>
          {/each}
        </div>
      </div>
    {/if}

    <div class="tab-content">
      {#key activeTab}
        <div in:fade={{ duration: 160, delay: 40 }} out:fade={{ duration: 80 }}>
          {#if activeTab === 'character'}
            <CharacterTab
              bind:name={charName}
              bind:description={charDescription}
              bind:personality={charPersonality}
              bind:scenario={charScenario}
              bind:greeting={charGreeting}
              bind:mes_example={charMesExample}
              bind:alternate_greetings={charAltGreetings}
              bind:worldInfoIds={worldInfoIds}
              {avatarPreview}
              onAvatarFile={handleCharAvatarFile}
            />
          {:else if activeTab === 'role'}
            <RoleTab
              bind:name={roleName}
              bind:description={roleDescription}
              bind:pronouns={rolePronouns}
              avatarPreview={roleAvatar}
              onAvatarFile={handleRoleAvatarFile}
            />
          {:else}
            <WorldInfoTab
              bind:name={worldInfoName}
              bind:description={worldInfoDescription}
              bind:entries={worldInfoEntries}
            />
          {/if}
        </div>
      {/key}
    </div>

  </SimpleFormPage>
</div>

<style>
  .page-heading { margin-bottom: 28px; }
  .page-title {
    font-size: 1.75rem; font-weight: 500; color: #f3f4f6;
    letter-spacing: -0.02em; line-height: 1.2; margin-bottom: 6px;
  }
  .page-subtitle { font-size: 0.9375rem; color: #6b7280; line-height: 1.5; }
  .tab-row { display: flex; justify-content: center; margin-bottom: 32px; }
  .tab-bar {
    display: inline-flex; align-items: center; gap: 2px;
    background: rgba(255, 255, 255, 0.04);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 14px; padding: 4px;
  }
  .tab-btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 7px 18px; border-radius: 10px; border: none;
    background: transparent; color: rgba(255, 255, 255, 0.3);
    font-size: 13px; font-weight: 500; font-family: inherit;
    cursor: pointer; transition: color 0.18s, background 0.18s;
    white-space: nowrap; min-height: 34px; letter-spacing: 0.01em;
  }
  .tab-btn:hover:not(.tab-btn--active) {
    color: rgba(255, 255, 255, 0.6); background: rgba(255, 255, 255, 0.04);
  }
  .tab-btn--active {
    background: rgba(255, 255, 255, 0.09); color: #f9fafb;
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.35), inset 0 1px 0 rgba(255,255,255,0.06);
  }
  .tab-content { position: relative; }
  .dropdown-menu {
    position: absolute; top: calc(100% + 8px); right: 0; z-index: 50;
    min-width: 210px; background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 14px;
    padding: 6px; box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
    animation: menu-in 0.15s ease;
  }
  @keyframes menu-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }
  .menu-item {
    display: flex; align-items: center; gap: 10px; width: 100%;
    padding: 9px 12px; border-radius: 9px; border: none;
    background: transparent; color: #a1a1aa; font-size: 13px;
    font-family: inherit; cursor: pointer; text-align: left;
    transition: background 0.12s, color 0.12s; letter-spacing: 0.01em;
  }
  .menu-item:hover:not(:disabled) { background: rgba(255, 255, 255, 0.06); color: #f9fafb; }
  .menu-item:disabled          { opacity: 0.4; cursor: default; }
  .menu-item--danger           { color: #f87171; }
  .menu-item--danger:hover:not(:disabled) { background: rgba(248, 113, 113, 0.1); color: #fca5a5; }
  .menu-divider { height: 1px; background: rgba(255, 255, 255, 0.06); margin: 5px 6px; }
  .save-spinner {
    display: inline-block; width: 12px; height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.6);
    border-radius: 50%; animation: spin 0.6s linear infinite;
  }
  :global(.spin) { animation: spin 0.6s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>