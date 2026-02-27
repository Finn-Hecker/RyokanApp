<script lang="ts">
  import { currentView, activeCharacter, editingCharacter } from '$lib/stores/appState';
  import { allCharacters, loadCharacters, hiddenCharacterIds, toggleHideCharacter, loadHiddenIds } from '$lib/stores/characterStore';
  import { startNewChat } from '$lib/stores/chatStore';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import * as m from '$lib/paraglide/messages';
  import { onMount } from 'svelte';

  let searchQuery = '';
  let viewMode: 'grid' | 'compact' | 'list' = 'grid';
  let showHidden = false;

  onMount(async () => {
    await loadHiddenIds();
    await loadCharacters();
    const saved = localStorage.getItem('ryokan-view-mode');
    if (saved === 'grid' || saved === 'compact' || saved === 'list') {
      viewMode = saved;
    }
  });

  function setViewMode(mode: 'grid' | 'compact' | 'list') {
    viewMode = mode;
    localStorage.setItem('ryokan-view-mode', mode);
  }

  async function onSelectChar(char: any) {
    activeCharacter.set(char);
    await startNewChat(char);
    currentView.set('chat');
  }

  function onOpenCreate() {
    editingCharacter.set(null);
    currentView.set('create');
  }

  function onOpenSettings() { currentView.set('settings'); }

  function onEditChar(e: MouseEvent, char: any) {
    e.stopPropagation();
    editingCharacter.set(char);
    currentView.set('create');
  }

  function onToggleHide(e: MouseEvent, char: any) {
    e.stopPropagation();
    toggleHideCharacter(char.id);
  }

  // Filters by visibility and search query
  $: filtered = ($allCharacters ?? [])
    .filter(Boolean)
    .filter((c: any) => showHidden || !$hiddenCharacterIds.has(c.id))
    .filter((c: any) =>
      searchQuery.trim() === '' ||
      c.name?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.desc?.toLowerCase().includes(searchQuery.toLowerCase())
    );

  // Controls whether the "show hidden" toggle is rendered at all
  $: hasHidden = ($allCharacters ?? []).some((c: any) => $hiddenCharacterIds.has(c.id));

</script>

<PageLayout 
  pageTitle={m.welcome_title()}
  showSidebar={true}
  maxContentWidth="max-w-7xl"
>
  <!-- Slot: sidebar -->
  <div slot="sidebar" let:isMobileSidebarOpen let:close class="h-full flex flex-col overflow-hidden">
    <Sidebar 
      isOpen={isMobileSidebarOpen} 
      close={close} 
      alwaysVisible={!isMobileSidebarOpen} 
    />
  </div>

  <!-- Slot: header actions (create + settings buttons) -->
  <div slot="header" class="flex items-center gap-3">
    <Button variant="secondary" on:click={onOpenCreate}>
      <svg class="shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
      </svg>
      <span class="truncate max-w-[70px] hidden md:block">{m.lobby_btn_open_create_char()}</span>
    </Button>
    <Button variant="icon" ariaLabel={m.lobby_btn_open_settings()} on:click={onOpenSettings}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="3"/>
        <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
      </svg>
    </Button>
  </div>

  <header class="mb-6">
    <h1 class="text-4xl font-medium text-gray-100 mb-3 tracking-tight">{m.welcome_title()}</h1>
    <p class="text-gray-500 text-lg">
      {m.lobby_subtitle_pre()} <span class="text-ryokan-accent">{m.lobby_subtitle_highlight()}</span> {m.lobby_subtitle_post()}
    </p>
  </header>

  <!-- Toolbar: search input, view mode toggle, show-hidden toggle -->
  <div class="flex items-center gap-3 mb-6">
    <div class="relative flex-1 max-w-sm">
      <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
      </svg>
      <input type="text" bind:value={searchQuery} placeholder={m.lobby_search_placeholder()}
        class="w-full h-9 pl-8 pr-4 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-ryokan-accent/30 focus:bg-white/[0.06] transition-all" />
    </div>
    <div class="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-xl p-1">
      <button on:click={() => setViewMode('grid')} title={m.lobby_view_grid()}
        class="w-7 h-7 flex items-center justify-center rounded-lg transition-all {viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
          <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
        </svg>
      </button>
      <button on:click={() => setViewMode('compact')} title={m.lobby_view_compact()}
        class="w-7 h-7 flex items-center justify-center rounded-lg transition-all {viewMode === 'compact' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="4" height="4"/><rect x="10" y="3" width="4" height="4"/><rect x="17" y="3" width="4" height="4"/>
          <rect x="3" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="17" y="10" width="4" height="4"/>
          <rect x="3" y="17" width="4" height="4"/><rect x="10" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/>
        </svg>
      </button>
      <button on:click={() => setViewMode('list')} title={m.lobby_view_list()}
        class="w-7 h-7 flex items-center justify-center rounded-lg transition-all {viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
        </svg>
      </button>
    </div>
    {#if hasHidden}
      <button on:click={() => (showHidden = !showHidden)}
        title={showHidden ? m.lobby_toggle_hide_hidden() : m.lobby_toggle_show_hidden()}
        class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] transition-all {showHidden ? 'text-white border-ryokan-accent/40 bg-white/[0.08]' : 'text-gray-600 hover:text-gray-400 hover:bg-white/[0.07]'}">
        {#if showHidden}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
          </svg>
        {:else}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
            <line x1="1" y1="1" x2="23" y2="23"/>
          </svg>
        {/if}
      </button>
    {/if}
  </div>

  <!-- Grid view -->
  {#if viewMode === 'grid'}
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:1rem;">
      {#each filtered as char (char.id)}
        <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-2xl overflow-hidden transition-all duration-200 active:scale-[0.98] {showHidden && $hiddenCharacterIds.has(char.id) ? 'opacity-40' : ''}">
          <button on:click={() => onSelectChar(char)} aria-label={m.lobby_aria_start_chat()} class="absolute inset-0 z-0 w-full h-full cursor-pointer"></button>
          <div class="relative z-10 w-full aspect-[3/4] bg-white/5 overflow-hidden pointer-events-none">
            {#if char.avatarUrl}
              <img src={char.avatarUrl} alt={char.name} class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
            {:else}
              <div class="w-full h-full {char.color} flex items-center justify-center text-white font-bold text-4xl opacity-80">{char.initials}</div>
            {/if}
            <div class="absolute top-2.5 right-2.5 z-20 pointer-events-auto transition-all duration-200 {showHidden && $hiddenCharacterIds.has(char.id) ? 'opacity-100 translate-y-0' : 'opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0'}">
              {#if !char.isCustom}
                <button on:click={(e) => onToggleHide(e, char)}
                  aria-label={$hiddenCharacterIds.has(char.id) ? m.lobby_aria_show_char() : m.lobby_aria_hide_char()}
                  title={$hiddenCharacterIds.has(char.id) ? m.lobby_aria_show_char() : m.lobby_aria_hide_char()}
                  class="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md border border-white/10 hover:border-white/25 text-gray-300 hover:text-white transition-all duration-150 active:scale-90">
                  {#if $hiddenCharacterIds.has(char.id)}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  {:else}
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  {/if}
                </button>
              {:else}
                <button on:click={(e) => onEditChar(e, char)} aria-label={m.lobby_aria_edit_char()} title={m.lobby_aria_edit_char()}
                  class="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md border border-white/10 hover:border-white/25 text-gray-300 hover:text-white transition-all duration-150 active:scale-90">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
          <div class="relative z-10 px-4 py-3 pointer-events-none">
            <h3 class="text-sm font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
            <p class="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-snug">{char.desc}</p>
          </div>
        </div>
      {/each}
    </div>

  <!-- Compact view -->
  {:else if viewMode === 'compact'}
    <div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:0.75rem;">
      {#each filtered as char (char.id)}
        <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-xl overflow-hidden transition-all duration-200 active:scale-[0.98] {showHidden && $hiddenCharacterIds.has(char.id) ? 'opacity-40' : ''}">
          <button on:click={() => onSelectChar(char)} aria-label="Start chat" class="absolute inset-0 z-0 w-full h-full cursor-pointer"></button>
          <div class="relative z-10 w-full aspect-square bg-white/5 overflow-hidden pointer-events-none">
            {#if char.avatarUrl}
              <img src={char.avatarUrl} alt={char.name} class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
              <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
            {:else}
              <div class="w-full h-full {char.color} flex items-center justify-center text-white font-bold text-2xl opacity-80">{char.initials}</div>
            {/if}
            <div class="absolute top-1.5 right-1.5 z-20 pointer-events-auto transition-all duration-200 {showHidden && $hiddenCharacterIds.has(char.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
              {#if !char.isCustom}
                <button on:click={(e) => onToggleHide(e, char)}
                  aria-label={$hiddenCharacterIds.has(char.id) ? 'Show' : 'Hide'}
                  class="w-6 h-6 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/10 text-gray-300 hover:text-white transition-all active:scale-90">
                  {#if $hiddenCharacterIds.has(char.id)}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  {:else}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  {/if}
                </button>
              {:else}
                <button on:click={(e) => onEditChar(e, char)} aria-label={m.lobby_aria_edit_char()}
                  class="w-6 h-6 flex items-center justify-center rounded-full bg-black/50 hover:bg-black/80 backdrop-blur-md border border-white/10 text-gray-300 hover:text-white transition-all active:scale-90">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
          <div class="relative z-10 px-2.5 py-2 pointer-events-none">
            <h3 class="text-xs font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
          </div>
        </div>
      {/each}
    </div>

  <!-- List view -->
  {:else if viewMode === 'list'}
    <div class="flex flex-col gap-2">
      {#each filtered as char (char.id)}
        <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-xl overflow-hidden transition-all duration-200 active:scale-[0.995] {showHidden && $hiddenCharacterIds.has(char.id) ? 'opacity-40' : ''}">
          <button on:click={() => onSelectChar(char)} aria-label="Start chat" class="absolute inset-0 z-0 w-full h-full cursor-pointer"></button>
          <div class="relative z-10 flex items-center gap-4 px-4 py-3 pointer-events-none">
            <div class="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-white/5">
              {#if char.avatarUrl}
                <img src={char.avatarUrl} alt={char.name} class="w-full h-full object-cover" />
              {:else}
                <div class="w-full h-full {char.color} flex items-center justify-center text-white font-bold text-sm opacity-80">{char.initials}</div>
              {/if}
            </div>
            <div class="flex-1 min-w-0">
              <h3 class="text-sm font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
              <p class="text-xs text-gray-500 truncate">{char.desc}</p>
            </div>
            <div class="pointer-events-auto transition-opacity duration-150 shrink-0 {showHidden && $hiddenCharacterIds.has(char.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
              {#if !char.isCustom}
                <button on:click={(e) => onToggleHide(e, char)}
                  aria-label={$hiddenCharacterIds.has(char.id) ? 'Show' : 'Hide'}
                  title={$hiddenCharacterIds.has(char.id) ? 'Show' : 'Hide'}
                  class="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-500 hover:text-white transition-all active:scale-90">
                  {#if $hiddenCharacterIds.has(char.id)}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                      <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                      <line x1="1" y1="1" x2="23" y2="23"/>
                    </svg>
                  {:else}
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                      <circle cx="12" cy="12" r="3"/>
                    </svg>
                  {/if}
                </button>
              {:else}
                <button on:click={(e) => onEditChar(e, char)} aria-label={m.lobby_aria_edit_char()} title={m.lobby_aria_edit_char()}
                  class="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-500 hover:text-white transition-all active:scale-90">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                  </svg>
                </button>
              {/if}
            </div>
          </div>
        </div>
      {/each}
    </div>
  {/if}

  <!-- Empty State -->
  {#if filtered.length === 0}
    <div class="flex flex-col items-center justify-center py-24 text-center">
      {#if searchQuery.trim() !== ''}
        <p class="text-gray-600 text-sm">{m.lobby_empty_search({query: searchQuery})}</p>
        <Button variant="ghost" size="sm" on:click={() => (searchQuery = '')}>{m.lobby_reset_search()}</Button>
      {:else}
        <p class="text-gray-600 text-sm">{m.lobby_empty_state()}</p>
      {/if}
    </div>
  {/if}

</PageLayout>