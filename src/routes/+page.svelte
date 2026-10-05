<script lang="ts">
  import { parseTextRules, TEXT_RULES_KEY } from '$lib/ai/prompt/textRules';
  import { onMount, tick } from 'svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import CharacterLobby from '$lib/components/lobby/CharacterLobby.svelte';
  import LazyView from '$lib/components/LazyView.svelte';
  import { createLazyView } from '$lib/utils/lazyView';
  import { prefetchLazyViews } from '$lib/utils/prefetchLazyViews';
  import { getAllSettings } from '$lib/settings/settings';
  import { onBackButtonPress } from '@tauri-apps/api/app';
  import { handleBackNavigation } from '$lib/stores/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { loadWorldInfos } from '$lib/stores/worldInfoStore.svelte';
  import { hydrateApiConnections } from '$lib/ai/connections/apiConnections';
  import { updater } from '$lib/stores/updater';
  import * as m from '$lib/paraglide/messages';
  import { androidViewport } from '$lib/utils/androidViewport';

  const onboarding = createLazyView(() => import('$lib/components/Onboarding.svelte'));
  const editor = createLazyView(() => import('$lib/components/editor/Editor.svelte'));
  const settings = createLazyView(() => import('$lib/components/settings/SettingsPage.svelte'));
  const chat = createLazyView(() => import('$lib/components/chat/ChatRoom.svelte'));
  const play = createLazyView(() => import('$lib/components/play/PlayLobby.svelte'));
  const multiplayer = createLazyView(() => import('$lib/components/play/MultiplayerRoom.svelte'));
  const list = createLazyView(() => import('$lib/components/list/ListView.svelte'));

  const views = {
    lobby: undefined,
    create: editor,
    roleEditor: editor,
    worldInfoEditor: editor,
    settings, chat, play, multiplayerRoom: multiplayer, list,
  };
  const lazyView = $derived(views[appState.currentView]);

  let loaded = $state(false); 
  let viewContainer = $state<HTMLDivElement>();
  let backTransition: Animation | undefined;

  $effect(() => {
    if (!loaded || appState.isOnboarding) return;
    return prefetchLazyViews([chat, settings, editor, multiplayer, play]);
  });

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
    if (/Android/i.test(navigator.userAgent)) void onBackButtonPress(() => {
      if (!disposed) void handleAndroidBack().catch(error => console.error('Android back navigation failed', error));
    }).then(async listener => {
      if (disposed) await listener.unregister();
      else backButtonListener = listener;
    }).catch(error => console.error('Could not register Android back listener', error));

    void loadApp();
    return () => {
      disposed = true;
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
    const chatFontScale = Number(map['chat_font_scale']);
    appState.chatFontScale = Number.isFinite(chatFontScale) && chatFontScale >= 80 && chatFontScale <= 140 ? chatFontScale : 100;

    hydrateApiConnections(settings);
    appState.textRules = parseTextRules(settings.find(row => row.key === TEXT_RULES_KEY)?.value);

    appState.isOnboarding = map['onboarding_completed'] !== 'true';
    loaded = true;
    void updater.initialize();

  }
</script>

{#if !loaded}
  <div class="h-screen w-screen bg-ryokan-bg"></div>
  {:else if appState.isOnboarding}
  <div class="h-screen w-screen bg-ryokan-bg">
    <LazyView view={onboarding} />
  </div>
{:else}
  <main
    use:androidViewport
    class="h-screen w-screen flex flex-col bg-ryokan-bg text-gray-200 overflow-hidden relative"
  >
    {#if appState.currentView === 'lobby' && ['available', 'ready'].includes($updater.phase)}
      <p class="px-4 py-2 text-xs text-center text-ryokan-accent" role="status">{m.update_banner({ version: $updater.version })}</p>
    {/if}
    <div bind:this={viewContainer} class="flex-1 min-h-0 overflow-hidden relative z-0">
      {#if appState.currentView === 'lobby'}
        <CharacterLobby />
      {:else if lazyView}
        {#key lazyView}
          <LazyView view={lazyView} />
        {/key}
      {/if}
    </div>
  </main>
{/if}
