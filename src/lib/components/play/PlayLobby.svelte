<script lang="ts">
  import { appState } from '$lib/stores/appState.svelte';
  import { mpState, prepareCreate, prepareJoin } from '$lib/stores/multiplayer.svelte';
  import { characterState, loadCharacters } from '$lib/stores/characterStore.svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CharacterAvatar from '$lib/components/lobby/CharacterAvatar.svelte';
  import MultiplayerCharacterPicker from './MultiplayerCharacterPicker.svelte';

  let joinCode = $state('');
  let joinError = $state('');
  let selectedCharacterId = $state('');
  let characterPickerOpen = $state(false);
  let multiplayerCharacters = $derived(
    characterState.allCharacters.filter((character) => character.play_mode === 'multiplayer')
  );
  let availableCharacters = $derived(
    multiplayerCharacters.filter(
      (character) => !characterState.hiddenCharacterIds.has(String(character.id))
    )
  );
  let selectedCharacter = $derived(
    availableCharacters.find((character) => String(character.id) === selectedCharacterId)
  );
  let canJoin = $derived(joinCode.trim().length >= 4);

  onMount(async () => {
    if (characterState.allCharacters.length === 0) await loadCharacters();
  });

  function createRoom() {
    joinError = '';
    if (selectedCharacter) prepareCreate(selectedCharacter);
  }

  function selectCharacter(character: (typeof availableCharacters)[number]) {
    selectedCharacterId = String(character.id);
    characterPickerOpen = false;
  }

  function manageCharacter(character: (typeof availableCharacters)[number]) {
    characterPickerOpen = false;
    appState.editingCharacter = character;
    appState.currentView = 'create';
  }

  function joinRoom() {
    joinError = '';
    if (!prepareJoin(joinCode)) {
      joinError = mpState.error === 'missing_key' ? m.mp_error_missing_key() : m.mp_error_invalid_link();
    }
  }
</script>

{#snippet sidebar({ isMobileSidebarOpen, close }: { isMobileSidebarOpen: boolean, close: () => void })}
  <div class="h-full flex flex-col overflow-hidden">
    <Sidebar isOpen={isMobileSidebarOpen} {close} alwaysVisible={!isMobileSidebarOpen} mode="multiplayer" />
  </div>
{/snippet}

{#snippet header()}
  <div class="flex items-center gap-3">
    <Button variant="icon" ariaLabel={m.play_btn_back()} onclick={() => (appState.currentView = 'lobby')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
      </svg>
    </Button>
    <div class="w-px h-6 bg-white/10"></div>
    <Button variant="icon" ariaLabel={m.lobby_btn_open_settings()} onclick={() => (appState.currentView = 'settings')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.18V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7.1 19.73l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.09 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.27 7.1l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.9 1.18l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>
      </svg>
    </Button>
  </div>
{/snippet}

<PageLayout pageTitle={m.play_title()} showSidebar={true} maxContentWidth="max-w-7xl" {sidebar} {header}>
  <header class="mb-6 md:mb-8">
    <h1 class="mb-2 text-2xl font-medium tracking-tight text-gray-100 sm:text-3xl md:text-4xl">{m.play_title()}</h1>
    <p class="text-base text-gray-500 md:text-lg">
      {m.play_subtitle_pre()} <span class="text-ryokan-accent">{m.play_subtitle_highlight()}</span> {m.play_subtitle_post()}
    </p>
  </header>

  <div class="grid max-w-3xl grid-cols-1 gap-4 md:grid-cols-2 md:gap-5">
    <section class="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-ryokan-accent">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
      </div>
      <h2 class="mb-1 font-medium text-gray-100">{m.play_mp_create_title()}</h2>
      <p class="mb-5 flex-1 text-sm text-gray-500">{m.play_mp_create_desc()}</p>
      <span class="mb-1.5 text-xs text-gray-400">{m.play_mp_character_label()}</span>
      <button
        type="button"
        onclick={() => (characterPickerOpen = true)}
        class="group mb-3 flex min-h-14 w-full items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 text-left transition-colors hover:border-white/20 hover:bg-white/[0.06] focus:border-ryokan-accent/50 focus:outline-none"
      >
        {#if selectedCharacter}
          <span class="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg bg-white/5">
            <CharacterAvatar char={selectedCharacter} fallbackTextClass="text-sm" />
          </span>
          <span class="min-w-0 flex-1">
            <span class="block truncate text-sm font-medium text-gray-100">{selectedCharacter.name}</span>
            <span class="block text-xs text-gray-500">{m.play_mp_character_change()}</span>
          </span>
        {:else}
          <span class="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/5 text-gray-500">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>
            </svg>
          </span>
          <span class="flex-1 text-sm text-gray-400">{m.play_mp_character_placeholder()}</span>
        {/if}
        <svg class="shrink-0 text-gray-600 transition-colors group-hover:text-gray-400" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="m9 18 6-6-6-6"/>
        </svg>
      </button>
      <Button variant="secondary" disabled={!selectedCharacter} onclick={createRoom}>{m.play_mp_create_btn()}</Button>
    </section>

    <section class="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6">
      <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-ryokan-accent">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>
        </svg>
      </div>
      <h2 class="mb-1 font-medium text-gray-100">{m.play_mp_join_title()}</h2>
      <p class="mb-5 flex-1 text-sm text-gray-500">{m.play_mp_join_desc()}</p>
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={joinCode}
          placeholder={m.play_mp_join_placeholder()}
          autocomplete="off"
          spellcheck="false"
          class="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-white/25 focus:outline-none"
          onkeydown={(e) => e.key === 'Enter' && canJoin && joinRoom()}
        />
        <button
          class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canJoin}
          onclick={joinRoom}
        >{m.play_mp_join_btn()}</button>
      </div>
      {#if joinError}<p class="mt-3 text-sm text-red-400">{joinError}</p>{/if}
    </section>
  </div>
</PageLayout>

{#if characterPickerOpen}
  <MultiplayerCharacterPicker
    characters={multiplayerCharacters}
    hiddenIds={characterState.hiddenCharacterIds}
    selectedId={selectedCharacterId}
    onSelect={selectCharacter}
    onManage={manageCharacter}
    onClose={() => (characterPickerOpen = false)}
  />
{/if}
