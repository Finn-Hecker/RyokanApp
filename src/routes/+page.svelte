<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import CharacterLobby from '$lib/components/lobby/CharacterLobby.svelte';
  import ChatRoom from '$lib/components/chat/ChatRoom.svelte';
  import Creator from '$lib/components/editor/Editor.svelte';
  import SettingsPage from '$lib/components/settings/SettingsPage.svelte';
  import Onboarding from '$lib/components/Onboarding.svelte';
  import ListView   from '$lib/components/list/ListView.svelte';
  import PlayHub   from '$lib/components/play/PlayLobby.svelte';
  import Multiplayer   from '$lib/components/play/MultiplayerRoom.svelte';
  import { getAllSettings } from '$lib/utils/settings';
  import { onBackButtonPress } from '@tauri-apps/api/app';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { handleBackNavigation } from '$lib/stores/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { loadWorldInfos } from '$lib/stores/worldInfoStore.svelte';
  import { hydrateApiConnections } from '$lib/utils/apiConnections';

  let loaded = $state(false); 

  onMount(() => {
    let backButtonListener: { unregister: () => Promise<void> } | undefined;
    void onBackButtonPress(({ canGoBack }) => {
      if (handleBackNavigation()) return;
      if (canGoBack) {
        window.history.back();
      } else {
        void getCurrentWindow().destroy();
      }
    }).then(listener => { backButtonListener = listener; });

    void loadApp();
    return () => { void backButtonListener?.unregister(); };
  });

  async function loadApp() {
    const [settings, interactionMode] = await Promise.all([
      getAllSettings(),
      invoke<'desktop' | 'mobile'>('get_interaction_mode'),
      loadWorldInfos(),
    ]);
    appState.interactionMode = interactionMode;
    const map = Object.fromEntries(settings.map(s => [s.key, s.value]));

    hydrateApiConnections(settings);

    appState.isOnboarding = map['onboarding_completed'] !== 'true';
    loaded = true;

  }
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
      {:else if appState.currentView === 'play'}
        <PlayHub  />
      {:else if appState.currentView === 'multiplayerRoom'}
        <Multiplayer  />
      {:else if appState.currentView === 'list'}
        <ListView  />
      {/if}
    </div>
  </main>
{/if}
