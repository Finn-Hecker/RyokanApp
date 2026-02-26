<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView, editingCharacter } from '$lib/stores/appState';
  import { toggleHideCharacter } from '$lib/stores/characterStore';
  import * as m from '$lib/paraglide/messages';

  import SimpleFormPage from '$lib/components/layouts/SimpleFormPage.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  import ExportToast        from './ExportToast.svelte';
  import DeleteConfirmDialog from './DeleteConfirmDialog.svelte';
  import AvatarPicker       from './AvatarPicker.svelte';
  import CharacterFormFields from './CharacterFormFields.svelte';

  import {
    saveCharacter,
    removeCharacter,
    exportCharacterCard,
    importCharacterFromFile,
    readImageAsDataUrl
  } from './characterLogic';

  let editChar: any = null;
  $: isEditMode = !!editChar;
  $: isHidden = editChar?.hidden ?? false;

  onMount(() => {
    const current = $editingCharacter;
    if (!current) return;

    editChar            = current;
    name                = current.name            ?? '';
    description         = current.desc            ?? '';
    personality         = current.personality     ?? '';
    scenario            = current.scenario        ?? '';
    greeting            = current.greeting        ?? '';
    mes_example         = current.mes_example     ?? '';
    creator_notes       = current.creator_notes   ?? '';
    alternate_greetings = Array.isArray(current.alternate_greetings)
      ? current.alternate_greetings
      : [];

    if (current.avatarUrl) {
      avatarPreview = current.avatarUrl;
      avatarChanged = false;
    }
  });

  let name = '';
  let description = '';
  let personality = '';
  let scenario = '';
  let greeting = '';
  let mes_example = '';
  let creator_notes = '';
  let alternate_greetings: string[] = [];

  let isSaving    = false;
  let isDeleting  = false;
  let isExporting = false;
  let showDeleteConfirm = false;
  let menuOpen = false;

  let avatarPreview: string | null = null;
  let avatarChanged = true;

  let exportToast: 'success' | 'error' | null = null;
  let toastTimeout: ReturnType<typeof setTimeout>;

  let importInput: HTMLInputElement;
  let menuRef: HTMLDivElement;

  function showToast(type: 'success' | 'error') {
    clearTimeout(toastTimeout);
    exportToast = type;
    toastTimeout = setTimeout(() => (exportToast = null), 2800);
  }

  function goBack() {
    editingCharacter.set(null);
    currentView.set('lobby');
  }

  async function handleAvatarFile(file: File) {
    try {
      avatarPreview = await readImageAsDataUrl(file);
      avatarChanged = true;
    } catch { /* invalid or non-image file — silently ignored */ }
  }

  async function handleImportFile(file: File) {
    if (!file.type.includes('image')) return;
    try {
      const result = await importCharacterFromFile(file);
      if (result.avatarDataUrl)       { avatarPreview = result.avatarDataUrl; avatarChanged = true; }
      if (result.name)                name                = result.name;
      if (result.description)         description         = result.description;
      if (result.personality)         personality         = result.personality;
      if (result.scenario)            scenario            = result.scenario;
      if (result.greeting)            greeting            = result.greeting;
      if (result.mes_example)         mes_example         = result.mes_example;
      if (result.creator_notes)       creator_notes       = result.creator_notes;
      if (result.alternate_greetings) alternate_greetings = result.alternate_greetings;
    } catch (err) {
      console.warn('Import failed:', err);
    }
  }

  async function handleSave() {
    if (!name || !description) return;
    isSaving = true;
    try {
      await saveCharacter(
        { name, description, personality, scenario, greeting, mes_example, creator_notes, alternate_greetings },
        editChar,
        avatarPreview,
        avatarChanged
      );
      goBack();
    } finally {
      isSaving = false;
    }
  }

  async function handleDelete() {
    if (!editChar?.isCustom) return;
    isDeleting = true;
    try {
      await removeCharacter(editChar);
      goBack();
    } finally {
      isDeleting  = false;
      showDeleteConfirm = false;
    }
  }

  function handleToggleHide() {
    if (!editChar) return;
    toggleHideCharacter(editChar.id);
    goBack();
  }

  async function handleExport() {
    if (!editChar?.id) return;
    menuOpen    = false;
    isExporting = true;
    try {
      await exportCharacterCard(editChar.id, name);
      showToast('success');
    } catch (e) {
      console.error('Export failed:', e);
      showToast('error');
    } finally {
      isExporting = false;
    }
  }

  function toggleMenu() { menuOpen = !menuOpen; }

  function handleImportClick() {
    menuOpen = false;
    importInput.click();
  }

  function handleDeleteClick() {
    menuOpen = false;
    showDeleteConfirm = true;
  }

  function handleHideClick() {
    menuOpen = false;
    handleToggleHide();
  }

  // Close the menu when the user clicks outside of it.
  function handleOutsideClick(e: MouseEvent) {
    if (menuOpen && menuRef && !menuRef.contains(e.target as Node)) {
      menuOpen = false;
    }
  }
</script>

<svelte:window on:mousedown={handleOutsideClick} />

<div class="relative h-full w-full">

  {#if showDeleteConfirm}
    <DeleteConfirmDialog
      characterName={editChar?.name ?? ''}
      {isDeleting}
      on:confirm={handleDelete}
      on:cancel={() => (showDeleteConfirm = false)}
    />
  {/if}

  <ExportToast type={exportToast} />

  <input
    type="file"
    bind:this={importInput}
    on:change={(e: any) => e.target.files?.[0] && handleImportFile(e.target.files[0])}
    accept="image/png,image/webp"
    hidden
  />

  <SimpleFormPage>

    <div slot="actions" class="flex items-center gap-2">

      <Button variant="icon" ariaLabel={m.create_page_aria_back()} on:click={goBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </Button>

      <div class="relative" bind:this={menuRef}>
        <Button variant="icon" ariaLabel={m.create_page_aria_more_options()} on:click={toggleMenu}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="5"  r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
            <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>
          </svg>
        </Button>

        {#if menuOpen}
          <div class="dropdown-menu">

            {#if !isEditMode}
              <button class="menu-item" on:click={handleImportClick}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                <span>{m.create_page_import_card()}</span>
              </button>
            {/if}

            {#if isEditMode && editChar?.isCustom}
              <button class="menu-item" on:click={handleExport} disabled={isExporting}>
                {#if isExporting}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="animate-spin">
                    <path d="M21 12a9 9 0 1 1-6.219-8.56"/>
                  </svg>
                {:else}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="7 10 12 15 17 10"/>
                    <line x1="12" y1="15" x2="12" y2="3"/>
                  </svg>
                {/if}
                <span>{m.create_page_export_card()}</span>
              </button>

              <div class="menu-divider"></div>

              <button class="menu-item" on:click={handleHideClick}>
                {#if isHidden}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  <span>{m.create_page_show_in_lobby()}</span>
                {:else}
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                    <line x1="1" y1="1" x2="23" y2="23"/>
                  </svg>
                  <span>{m.create_page_hide_from_lobby()}</span>
                {/if}
              </button>

              <button class="menu-item menu-item--danger" on:click={handleDeleteClick}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                </svg>
                <span>{m.create_page_delete()}</span>
              </button>
            {/if}
          </div>
        {/if}
      </div>

      <Button variant="secondary" disabled={!name || !description || isSaving} on:click={handleSave}>
        {#if isSaving}
          <span class="save-spinner"></span>
        {:else}
          {isEditMode ? m.create_page_btn_save() : m.create_page_btn_done()}
        {/if}
      </Button>

    </div>

    <AvatarPicker
      {avatarPreview}
      on:fileSelected={(e) => handleAvatarFile(e.detail)}
    />

    <CharacterFormFields
      bind:name
      bind:description
      bind:personality
      bind:scenario
      bind:greeting
      bind:mes_example
      {alternate_greetings}
      on:altGreetingsChange={(e)  => (alternate_greetings = e.detail)}
      on:altGreetingsAdd={()      => (alternate_greetings = [...alternate_greetings, ''])}
      on:altGreetingsRemove={(e)  => (alternate_greetings = alternate_greetings.filter((_, i) => i !== e.detail))}
    />

  </SimpleFormPage>
</div>

<style>
  /* Dropdown menu */
  .dropdown-menu {
    position: absolute;
    top: calc(100% + 8px);
    right: 0;
    z-index: 50;
    min-width: 210px;
    background: #1c1c1e;
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 14px;
    padding: 6px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.5), 0 2px 8px rgba(0, 0, 0, 0.3);
    animation: menu-in 0.15s ease;
  }

  @keyframes menu-in {
    from { opacity: 0; transform: translateY(-6px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0)    scale(1); }
  }

  .menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 9px 12px;
    border-radius: 9px;
    border: none;
    background: transparent;
    color: #c0c0c8;
    font-size: 13px;
    font-family: inherit;
    cursor: pointer;
    text-align: left;
    transition: background 0.12s, color 0.12s;
  }

  .menu-item:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.06);
    color: #ffffff;
  }

  .menu-item:disabled {
    opacity: 0.4;
    cursor: default;
  }

  .menu-item--danger {
    color: #ff453a;
  }

  .menu-item--danger:hover:not(:disabled) {
    background: rgba(255, 69, 58, 0.1);
    color: #ff6b63;
  }

  .menu-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.06);
    margin: 5px 6px;
  }

  /* Save spinner */
  .save-spinner {
    display: inline-block;
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.6);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }

  @keyframes spin { to { transform: rotate(360deg); } }

  .animate-spin {
    animation: spin 0.6s linear infinite;
  }
</style>