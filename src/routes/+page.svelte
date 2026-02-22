<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView, isOnboarding, apiSettings } from '$lib/stores/appState';
  import CharacterLobby from '$lib/components/CharacterLobby.svelte';
  import ChatRoom from '$lib/components/ChatRoom.svelte';
  import Sidebar from '$lib/components/Sidebar.svelte';
  import CreateCharPage from '$lib/components/CreateCharPage.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import { getAllSettings } from '$lib/db/settings';
  import * as m from '$lib/paraglide/messages';

  let isMenuOpen = false;
  let loaded = false; 

  onMount(async () => {
    const settings = await getAllSettings();
    const map = Object.fromEntries(settings.map(s => [s.key, s.value]));

    if (map.url) apiSettings.update(s => ({ ...s, url: map.url }));
    if (map.apiKey) apiSettings.update(s => ({ ...s, apiKey: map.apiKey }));
    if (map.model) apiSettings.update(s => ({ ...s, model: map.model }));
    if (map.aiLanguage) apiSettings.update(s => ({ ...s, aiLanguage: map.aiLanguage }));

    isOnboarding.set(map['onboarding_completed'] !== 'true');
    loaded = true;
  });
</script>

{#if !loaded}
  <div class="h-screen w-screen bg-ryokan-bg"></div>
{:else if $isOnboarding}
  <Onboarding />
{:else}
  <main class="h-screen w-screen flex flex-col bg-ryokan-bg text-gray-200 overflow-hidden relative">
    <Sidebar isOpen={isMenuOpen} close={() => isMenuOpen = false} />
    {#if $currentView !== 'create' && $currentView !== 'chat'}
      <header class="absolute top-0 left-0 right-0 p-4 z-10 flex items-center justify-between pointer-events-none">
        <button
          on:click={() => isMenuOpen = true}
          aria-label={m.main_menu_label()}
          class="pointer-events-auto p-3 text-gray-400 hover:text-ryokan-accent bg-ryokan-bg/50 backdrop-blur-md rounded-full hover:bg-white/10 transition-all shadow-sm border border-white/5"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
        <div class="w-10"></div>
      </header>
    {/if}
    <div class="flex-1 overflow-hidden relative z-0">
      {#if $currentView === 'lobby'}
        <CharacterLobby />
      {:else if $currentView === 'create'}
        <CreateCharPage />
      {:else}
        <ChatRoom />
      {/if}
    </div>
  </main>
{/if}