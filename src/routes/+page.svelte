<script lang="ts">
  import { onMount } from 'svelte';
  import { currentView, isOnboarding, apiSettings } from '$lib/stores/appState';
  import CharacterLobby from '$lib/components/CharacterLobby.svelte';
  import ChatRoom from '$lib/components/chat/ChatRoom.svelte';
  import CharacterPage from '$lib/components/character/CharacterEditor.svelte';
  import SettingsPage from '$lib/components/settings/SettingsPage.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import { getAllSettings } from '$lib/db/settings';

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
    <div class="flex-1 overflow-hidden relative z-0">
      {#if $currentView === 'lobby'}
        <CharacterLobby />
      {:else if $currentView === 'create'}
        <CharacterPage />
      {:else if $currentView === 'settings'}
        <SettingsPage /> 
      {:else}
        <ChatRoom />
      {/if}
    </div>
  </main>
{/if}