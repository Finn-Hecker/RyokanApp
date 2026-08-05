<script lang="ts">
  import { appState } from '$lib/stores/appState.svelte';
  import { mpState, prepareCreate, prepareJoin } from '$lib/stores/multiplayer.svelte';
  import * as m from '$lib/paraglide/messages';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import UserDropdown from '$lib/components/UserDropdown.svelte';

  type PlayTab = 'minigames' | 'multiplayer';
  let activeTab = $state<PlayTab>('multiplayer');

  let joinCode = $state('');
  let joinError = $state('');

  type Minigame = {
    id: string;
    name: () => string;
    desc: () => string;
    icon: string;
    comingSoon?: boolean;
  };

  const minigames: Minigame[] = [
    {
      id: 'dice_adventure',
      name: m.play_game_dice_name,
      desc: m.play_game_dice_desc,
      icon: 'M4 4h16v16H4z M8.5 8.5h.01 M15.5 8.5h.01 M12 12h.01 M8.5 15.5h.01 M15.5 15.5h.01'
    },
    {
      id: 'quiz',
      name: m.play_game_quiz_name,
      desc: m.play_game_quiz_desc,
      icon: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3 M12 17h.01 M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'
    }
  ];

  function startMinigame(game: Minigame, withFriends: boolean) {
    if (game.comingSoon) return;
    console.log('start minigame', game.id, withFriends ? 'friends' : 'solo');
  }

  function createRoom() {
    joinError = '';
    prepareCreate();
  }

  function joinRoom() {
    joinError = '';
    if (!prepareJoin(joinCode)) {
      joinError =
        mpState.error === 'missing_key' ? m.mp_error_missing_key() : m.mp_error_invalid_link();
    }
  }

  function onBackToLobby() {
    appState.currentView = 'lobby';
  }

  function onOpenSettings() {
    appState.currentView = 'settings';
  }

  let canJoin = $derived(joinCode.trim().length >= 4);
</script>

{#snippet sidebar({ isMobileSidebarOpen, close }: { isMobileSidebarOpen: boolean, close: () => void })}
  <div class="h-full flex flex-col overflow-hidden">
    <Sidebar isOpen={isMobileSidebarOpen} {close} alwaysVisible={!isMobileSidebarOpen} />
  </div>
{/snippet}

{#snippet header()}
  <div class="flex items-center gap-3">
    <Button variant="icon" ariaLabel={m.play_btn_back()} onclick={onBackToLobby}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
      </svg>
    </Button>

    <div class="w-px h-6 bg-white/10"></div>

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
  pageTitle={m.play_title()}
  showSidebar={true}
  maxContentWidth="max-w-7xl"
  {sidebar}
  {header}
>
  <header class="mb-4 md:mb-6">
    <h1 class="text-2xl sm:text-3xl md:text-4xl font-medium text-gray-100 mb-2 md:mb-3 tracking-tight">{m.play_title()}</h1>
    <p class="text-gray-500 text-base md:text-lg">
      {m.play_subtitle_pre()} <span class="text-ryokan-accent">{m.play_subtitle_highlight()}</span> {m.play_subtitle_post()}
    </p>
  </header>

  <div class="inline-flex items-center gap-1 p-1 rounded-xl bg-white/5 border border-white/10 mb-6 md:mb-8" role="tablist" aria-label={m.play_title()}>
    <button
      role="tab"
      aria-selected={activeTab === 'multiplayer'}
      class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
        {activeTab === 'multiplayer' ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'}"
      onclick={() => (activeTab = 'multiplayer')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="9" cy="8" r="3"/>
        <path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/>
        <circle cx="17" cy="9" r="2.5"/>
        <path d="M16 14.6c2.7.4 4.5 2.6 4.5 5.4"/>
      </svg>
      {m.play_tab_multiplayer()}
    </button>
    <button
      role="tab"
      aria-selected={activeTab === 'minigames'}
      class="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors
        {activeTab === 'minigames' ? 'bg-white/10 text-gray-100' : 'text-gray-500 hover:text-gray-300'}"
      onclick={() => (activeTab = 'minigames')}
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="18" height="18" rx="3"/>
        <path d="M8 8h.01 M16 8h.01 M12 12h.01 M8 16h.01 M16 16h.01"/>
      </svg>
      {m.play_tab_minigames()}
    </button>
  </div>

  {#if activeTab === 'multiplayer'}
    <div class="grid grid-cols-1 md:grid-cols-2 gap-4 md:gap-5 max-w-3xl">
      <div class="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-ryokan-accent">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </div>
        <h3 class="text-gray-100 font-medium mb-1">{m.play_mp_create_title()}</h3>
        <p class="text-sm text-gray-500 mb-5 flex-1">{m.play_mp_create_desc()}</p>
        <Button variant="secondary" onclick={createRoom}>
          {m.play_mp_create_btn()}
        </Button>
      </div>

      <div class="flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-6">
        <div class="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-ryokan-accent">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/>
            <path d="m10 17 5-5-5-5"/><path d="M15 12H3"/>
          </svg>
        </div>
        <h3 class="text-gray-100 font-medium mb-1">{m.play_mp_join_title()}</h3>
        <p class="text-sm text-gray-500 mb-5 flex-1">{m.play_mp_join_desc()}</p>
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
            class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white/5"
            disabled={!canJoin}
            onclick={joinRoom}
          >
            {m.play_mp_join_btn()}
          </button>
        </div>
        {#if joinError}
          <p class="mt-3 text-sm text-red-400">{joinError}</p>
        {/if}
      </div>

    </div>
  {:else}
    <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 md:gap-5">
      {#each minigames as game (game.id)}
        <div class="group relative flex flex-col rounded-2xl border border-white/10 bg-white/[0.03] p-5 transition-colors hover:border-white/20 hover:bg-white/[0.05] {game.comingSoon ? 'opacity-60' : ''}">
          <div class="flex items-start justify-between mb-4">
            <div class="flex h-11 w-11 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-ryokan-accent">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path d={game.icon}/>
              </svg>
            </div>
            {#if game.comingSoon}
              <span class="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 text-xs text-gray-400">
                {m.play_badge_coming_soon()}
              </span>
            {/if}
          </div>

          <h3 class="text-gray-100 font-medium mb-1">{game.name()}</h3>
          <p class="text-sm text-gray-500 mb-5 flex-1">{game.desc()}</p>

          <div class="flex items-center gap-2">
            <button
              class="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:hover:bg-white/5"
              disabled={game.comingSoon}
              onclick={() => startMinigame(game, false)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.9 3.1-7 7-7s7 3.1 7 7"/>
              </svg>
              {m.play_btn_solo()}
            </button>
            <button
              class="flex-1 flex items-center justify-center gap-1.5 rounded-lg bg-white/5 border border-white/10 px-3 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:hover:bg-white/5"
              disabled={game.comingSoon}
              onclick={() => startMinigame(game, true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="9" cy="8" r="3"/><path d="M3.5 20c0-3 2.5-5.5 5.5-5.5s5.5 2.5 5.5 5.5"/>
                <circle cx="17" cy="9" r="2.5"/><path d="M16 14.6c2.7.4 4.5 2.6 4.5 5.4"/>
              </svg>
              {m.play_btn_with_friends()}
            </button>
          </div>
        </div>
      {/each}
    </div>
  {/if}
</PageLayout>
