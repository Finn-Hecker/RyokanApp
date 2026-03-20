<script lang="ts">
  import { appState } from '$lib/stores/appState.svelte';
  import { characterState, loadCharacters, toggleHideCharacter, loadHiddenIds } from '$lib/stores/characterStore.svelte';
  import { startNewChat } from '$lib/stores/chatStore.svelte';
  import { loadRoles } from '$lib/stores/roleStore.svelte';
  import { onMount } from 'svelte';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import UserDropdown from '$lib/components/UserDropdown.svelte';
  import * as m from '$lib/paraglide/messages';

  import LobbyToolbar from './LobbyToolbar.svelte';
  import CharacterGridView from './CharacterGridView.svelte';
  import CharacterCompactView from './CharacterCompactView.svelte';
  import CharacterListView from './CharacterListView.svelte';
  import LobbyEmptyState from './LobbyEmptyState.svelte';

  let searchQuery = $state('');
  let viewMode = $state<'grid' | 'compact' | 'list'>('grid');
  let showHidden = $state(false);

  onMount(async () => {
    await loadHiddenIds();
    await loadCharacters();
    await loadRoles();
    const saved = localStorage.getItem('ryokan-view-mode');
    if (saved === 'grid' || saved === 'compact' || saved === 'list') {
      viewMode = saved;
    }
  });

  async function onSelectChar(char: any) {
    appState.activeCharacter = char;
    await startNewChat(char);
    appState.currentView = 'chat';
  }

  function onOpenCreate() {
    appState.editingCharacter = null;
    appState.currentView = 'create';
  }

  function onOpenSettings() {
    appState.currentView = 'settings';
  }

  function onEditChar(e: MouseEvent, char: any) {
    e.stopPropagation();
    appState.editingCharacter = char;
    appState.currentView = 'create';
  }

  function onToggleHide(e: MouseEvent, char: any) {
    e.stopPropagation();
    toggleHideCharacter(char.id);
  }

  function resolveDesc(char: any): string {
    return char.desc?.replace(/\{\{char\}\}/g, char.name) ?? '';
  }

  let filtered = $derived(
    (characterState.allCharacters ?? [])
      .filter(Boolean)
      .filter((c: any) => showHidden || !characterState.hiddenCharacterIds.has(String(c.id)))
      .filter((c: any) =>
        searchQuery.trim() === '' ||
        c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
        c.desc?.toLowerCase().includes(searchQuery.toLowerCase())
      )
  );

  let hasHidden = $derived(
    (characterState.allCharacters ?? []).some((c: any) => characterState.hiddenCharacterIds.has(String(c.id)))
  );
</script>

{#snippet sidebar({ isMobileSidebarOpen, close }: { isMobileSidebarOpen: boolean, close: () => void })}
  <div class="h-full flex flex-col overflow-hidden">
    <Sidebar isOpen={isMobileSidebarOpen} {close} alwaysVisible={!isMobileSidebarOpen} />
  </div>
{/snippet}

{#snippet header()}
  <div class="flex items-center gap-3">
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
    <UserDropdown />
  </div>
{/snippet}

<PageLayout
  pageTitle={m.welcome_title()}
  showSidebar={true}
  maxContentWidth="max-w-7xl"
  {sidebar}
  {header}
>
  <header class="mb-6">
    <h1 class="text-4xl font-medium text-gray-100 mb-3 tracking-tight">{m.welcome_title()}</h1>
    <p class="text-gray-500 text-lg">
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
      {onToggleHide}
      {resolveDesc}
    />
  {:else if viewMode === 'compact'}
    <CharacterCompactView
      characters={filtered}
      {showHidden}
      onSelect={onSelectChar}
      onEdit={onEditChar}
      {onToggleHide}
    />
  {:else if viewMode === 'list'}
    <CharacterListView
      characters={filtered}
      {showHidden}
      onSelect={onSelectChar}
      onEdit={onEditChar}
      {onToggleHide}
      {resolveDesc}
    />
  {/if}

  {#if filtered.length === 0}
    <LobbyEmptyState {searchQuery} onResetSearch={() => (searchQuery = '')} />
  {/if}
</PageLayout>