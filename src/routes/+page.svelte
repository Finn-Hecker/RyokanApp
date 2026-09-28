<script lang="ts">
  import { onMount, tick } from 'svelte';
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
  import { handleBackNavigation } from '$lib/stores/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { loadWorldInfos } from '$lib/stores/worldInfoStore.svelte';
  import { hydrateApiConnections } from '$lib/utils/apiConnections';
  import { updater } from '$lib/stores/updater';
  import * as m from '$lib/paraglide/messages';

  let loaded = $state(false); 
  let viewContainer = $state<HTMLDivElement>();
  let backTransition: Animation | undefined;
  let isAndroid = $state(false);
  let viewportHeight = $state<string | undefined>();
  let viewportTop = $state<string | undefined>();
  let keyboardOpen = $state(false);

  async function handleAndroidBack() {
    const previousView = appState.currentView;
    if (handleBackNavigation()) {
      if (previousView !== appState.currentView && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        await tick();
        backTransition?.cancel();
        backTransition = viewContainer?.animate(
          [{ opacity: 0.8 }, { opacity: 1 }],
          { duration: 160, easing: 'ease-out' },
        );
      }
      return;
    }

    // Views use our own navigation stack, not the WebView's browsing history.
    // Finish the Android Activity instead of destroying its WebView/window.
    await invoke('finish_android_activity');
  }

  onMount(() => {
    let disposed = false;
    let backButtonListener: { unregister: () => Promise<void> } | undefined;
    let viewportFrame = 0;
    let fullViewportHeight = 0;
    let viewportWidth = 0;
    isAndroid = /Android/i.test(navigator.userAgent);

    function updateViewportHeight() {
      viewportFrame = 0;
      // The visual viewport follows the IME animation, including edge-to-edge WebViews.
      const viewport = window.visualViewport;
      const height = viewport?.height ?? window.innerHeight;
      const width = viewport?.width ?? window.innerWidth;
      if (Math.abs(width - viewportWidth) > 1) {
        viewportWidth = width;
        fullViewportHeight = height;
      } else {
        fullViewportHeight = Math.max(fullViewportHeight, height);
      }
      viewportHeight = `${height}px`;
      keyboardOpen = fullViewportHeight - height > 120;
      // A focused field can pan the visual viewport independently of its height.
      viewportTop = keyboardOpen ? `${viewport?.offsetTop ?? 0}px` : undefined;
    }

    function scheduleViewportUpdate() {
      if (!viewportFrame) viewportFrame = requestAnimationFrame(updateViewportHeight);
    }

    if (isAndroid) {
      updateViewportHeight();
      window.visualViewport?.addEventListener('resize', scheduleViewportUpdate);
      window.visualViewport?.addEventListener('scroll', scheduleViewportUpdate);
      window.addEventListener('resize', scheduleViewportUpdate);
    }
    void onBackButtonPress(() => {
      if (!disposed) void handleAndroidBack().catch(error => console.error('Android back navigation failed', error));
    }).then(async listener => {
      if (disposed) await listener.unregister();
      else backButtonListener = listener;
    }).catch(error => console.error('Could not register Android back listener', error));

    void loadApp();
    return () => {
      disposed = true;
      if (viewportFrame) cancelAnimationFrame(viewportFrame);
      window.visualViewport?.removeEventListener('resize', scheduleViewportUpdate);
      window.visualViewport?.removeEventListener('scroll', scheduleViewportUpdate);
      window.removeEventListener('resize', scheduleViewportUpdate);
      backTransition?.cancel();
      void backButtonListener?.unregister().catch(error => console.error('Could not unregister Android back listener', error));
    };
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
    void updater.initialize();

  }
</script>

{#if !loaded}
  <div class="h-screen w-screen bg-ryokan-bg"></div>
  {:else if appState.isOnboarding}
  <Onboarding />
{:else}
  <main
    class="h-screen w-screen flex flex-col bg-ryokan-bg text-gray-200 overflow-hidden relative"
    class:android-viewport={isAndroid}
    class:android-keyboard-open={isAndroid && keyboardOpen}
    style:height={viewportHeight}
    style:top={viewportTop}
    style:--visual-viewport-height={viewportHeight}
  >
    {#if appState.currentView === 'lobby' && ['available', 'ready'].includes($updater.phase)}
      <p class="px-4 py-2 text-xs text-center text-ryokan-accent" role="status">{m.update_banner({ version: $updater.version })}</p>
    {/if}
    <div bind:this={viewContainer} class="flex-1 min-h-0 overflow-hidden relative z-0">
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

<style>
  main.android-viewport {
    position: fixed;
    inset: 0;
  }
</style>
