<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import CharacterLobby from '$lib/components/CharacterLobby.svelte';
  import ChatRoom from '$lib/components/chat/ChatRoom.svelte';
  import Creator from '$lib/components/editor/Editor.svelte';
  import SettingsPage from '$lib/components/settings/SettingsPage.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import ListView   from '$lib/components/list/ListView.svelte';
  import { getAllSettings } from '$lib/utils/settings';

  let loaded = $state(false); 

  onMount(async () => {
    const settings = await getAllSettings();
    const map = Object.fromEntries(settings.map(s => [s.key, s.value]));

    if (map.url) appState.apiSettings.url = map.url;
    if (map.apiKey) appState.apiSettings.apiKey = map.apiKey;
    if (map.model) appState.apiSettings.model = map.model;
    if (map.aiLanguage) appState.apiSettings.aiLanguage = map.aiLanguage;

    appState.isOnboarding = map['onboarding_completed'] !== 'true';
    loaded = true;
  });
</script>

{#if !loaded}
  <div class="h-screen w-screen bg-ryokan-bg"></div>
  {:else if appState.isOnboarding}
  <Onboarding />
{:else}
  <main class="h-screen w-screen flex flex-col bg-ryokan-bg text-gray-200 overflow-hidden relative">
    <div class="flex-1 overflow-hidden relative z-0">
      {#if appState.currentView === 'lobby'}
        <CharacterLobby />
      {:else if appState.currentView === 'create' || appState.currentView === 'roleEditor' || appState.currentView === 'worldInfoEditor'}
        <Creator />
      {:else if appState.currentView === 'settings'}
        <SettingsPage /> 
      {:else if appState.currentView === 'chat'}
        <ChatRoom />
      {:else if appState.currentView === 'list'}
        <ListView  />
      {/if}
    </div>
  </main>
{/if}