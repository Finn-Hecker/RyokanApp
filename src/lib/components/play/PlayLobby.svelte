<script lang="ts">
  import { appState } from '$lib/stores/appState.svelte';
  import { mpState, enterRoom, prepareCreate, prepareJoin } from '$lib/stores/multiplayer.svelte';
  import {
    characterState,
    loadCharacters,
    loadHiddenIds,
    type Character,
  } from '$lib/stores/characterStore.svelte';
  import { onMount, tick } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import CharacterGridView from '$lib/components/lobby/CharacterGridView.svelte';

  let joinCode = $state('');
  let joinError = $state('');
  let displayName = $state('');
  let selectedScenario = $state<Character | null>(null);
  let joinModalOpen = $state(false);
  let displayNameInput = $state<HTMLInputElement>();
  let joinCodeInput = $state<HTMLInputElement>();

  let availableScenarios = $derived(
    characterState.allCharacters.filter(
      (character) =>
        character.play_mode === 'multiplayer'
        && !characterState.hiddenCharacterIds.has(String(character.id))
    )
  );
  let canJoin = $derived(joinCode.trim().length >= 4);
  let canStart = $derived(displayName.trim().length > 0 && !mpState.connecting);

  onMount(async () => {
    await loadHiddenIds();
    if (characterState.allCharacters.length === 0) await loadCharacters();
  });

  function scenarioDescription(character: Character): string {
    const source = character.description?.trim() || character.prompt?.trim() || '';
    return source.split(/\n\s*\n/, 1)[0]?.replace(/\{\{char\}\}/g, character.name) ?? '';
  }

  function chooseScenario(character: Character) {
    selectedScenario = character;
    displayName = mpState.displayName;
    joinError = '';
    void tick().then(() => displayNameInput?.focus());
  }

  function openJoinModal() {
    joinModalOpen = true;
    void tick().then(() => joinCodeInput?.focus());
  }

  function closeModal() {
    if (mpState.connecting) return;
    selectedScenario = null;
    joinModalOpen = false;
    joinError = '';
  }

  async function startScenario() {
    const scenario = selectedScenario;
    if (!scenario || !canStart) return;

    prepareCreate(scenario);
    await enterRoom(displayName);
  }

  function manageScenario(event: MouseEvent, character: Character) {
    event.stopPropagation();
    appState.editingCharacter = character;
    appState.currentView = 'create';
  }

  function ignoreScenarioAction(event: MouseEvent) {
    event.stopPropagation();
  }

  function joinRoom() {
    joinError = '';
    if (!prepareJoin(joinCode)) {
      joinError = mpState.error === 'missing_key' ? m.mp_error_missing_key() : m.mp_error_invalid_link();
    }
  }

  function closeOnBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) closeModal();
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && closeModal()} />

{#snippet sidebar({ isMobileSidebarOpen, close }: { isMobileSidebarOpen: boolean, close: () => void })}
  <div class="flex h-full flex-col overflow-hidden">
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
    <div class="h-6 w-px bg-white/10"></div>
    <Button variant="icon" ariaLabel={m.lobby_btn_open_settings()} onclick={() => (appState.currentView = 'settings')}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-2.82 1.18V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 7.1 19.73l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 3.09 14H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.27 7.1l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 10 3.09V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 2.9 1.18l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 20.91 10H21a2 2 0 0 1 0 4h-.09A1.65 1.65 0 0 0 19.4 15z"/>
      </svg>
    </Button>
  </div>
{/snippet}

<PageLayout pageTitle={m.play_title()} showSidebar={true} maxContentWidth="max-w-7xl" {sidebar} {header}>
  <header class="mb-6 flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between md:mb-8">
    <div>
      <h1 class="mb-2 text-2xl font-medium tracking-tight text-gray-100 sm:text-3xl md:text-4xl">{m.play_title()}</h1>
      <p class="text-base text-gray-500 md:text-lg">
        {m.play_subtitle_pre()} <span class="text-ryokan-accent">{m.play_subtitle_highlight()}</span> {m.play_subtitle_post()}
      </p>
    </div>
    <Button variant="secondary" onclick={openJoinModal}>
      <svg class="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>
      </svg>
      {m.play_mp_join_title()}
    </Button>
  </header>

  {#if availableScenarios.length === 0}
    <div class="flex min-h-64 max-w-2xl items-center justify-center rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-6 text-center text-sm text-gray-500">
      {m.play_mp_picker_empty()}
    </div>
  {:else}
    <CharacterGridView
      characters={availableScenarios}
      showHidden={false}
      onSelect={chooseScenario}
      onEdit={manageScenario}
      onDelete={ignoreScenarioAction}
      onToggleHide={ignoreScenarioAction}
      onTogglePin={ignoreScenarioAction}
      resolveDesc={scenarioDescription}
      menuMode="manage"
    />
  {/if}
</PageLayout>

{#if selectedScenario}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    role="presentation"
    onclick={closeOnBackdrop}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="multiplayer-name-title"
      class="w-full max-w-sm rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-2xl sm:p-6"
    >
      <div class="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id="multiplayer-name-title" class="font-medium text-gray-100">{m.mp_gate_title()}</h2>
          <p class="mt-1 text-sm text-gray-500">{m.mp_gate_desc()}</p>
        </div>
        <button
          type="button"
          aria-label={m.create_char_close_aria()}
          onclick={closeModal}
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <input
        bind:this={displayNameInput}
        type="text"
        bind:value={displayName}
        placeholder={m.mp_gate_placeholder()}
        maxlength="24"
        autocomplete="nickname"
        class="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-ryokan-accent/50 focus:outline-none"
        onkeydown={(event) => event.key === 'Enter' && canStart && startScenario()}
      />
      <div class="mt-3 [&>button]:w-full">
        <Button variant="secondary" disabled={!canStart} onclick={startScenario}>
          {m.mp_gate_create_btn()}
        </Button>
      </div>
    </div>
  </div>
{/if}

{#if joinModalOpen}
  <div
    class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
    role="presentation"
    onclick={closeOnBackdrop}
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="multiplayer-join-title"
      class="w-full max-w-md rounded-2xl border border-white/10 bg-[#12121a] p-5 shadow-2xl sm:p-6"
    >
      <div class="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 id="multiplayer-join-title" class="font-medium text-gray-100">{m.play_mp_join_title()}</h2>
          <p class="mt-1 text-sm text-gray-500">{m.play_mp_join_desc()}</p>
        </div>
        <button
          type="button"
          aria-label={m.create_char_close_aria()}
          onclick={closeModal}
          class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
        >
          <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6 6 18M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <div class="flex items-center gap-2">
        <input
          bind:this={joinCodeInput}
          type="text"
          bind:value={joinCode}
          placeholder={m.play_mp_join_placeholder()}
          autocomplete="off"
          spellcheck="false"
          class="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-ryokan-accent/50 focus:outline-none"
          onkeydown={(event) => event.key === 'Enter' && canJoin && joinRoom()}
        />
        <Button variant="secondary" disabled={!canJoin} onclick={joinRoom}>{m.play_mp_join_btn()}</Button>
      </div>
      {#if joinError}<p class="mt-3 text-sm text-red-400">{joinError}</p>{/if}
    </div>
  </div>
{/if}
