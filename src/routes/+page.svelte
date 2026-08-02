<script lang="ts">
  import { onMount } from 'svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import CharacterLobby from '$lib/components/lobby/CharacterLobby.svelte';
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

    if (map.api_url)     appState.apiSettings.url             = map.api_url;
    if (map.api_key)     appState.apiSettings.apiKey          = map.api_key;
    if (map.api_model)   appState.apiSettings.model           = map.api_model;
    if (map.ai_language) appState.apiSettings.aiLanguage      = map.ai_language;
    if (map.system_prompt)        appState.apiSettings.systemPrompt    = map.system_prompt;
    if (map.thinking_mode)        appState.apiSettings.isThinkingModel = map.thinking_mode === "true";
    if (map.api_temperature)      appState.apiSettings.temperature     = parseFloat(map.api_temperature);
    if (map.api_max_tokens)       appState.apiSettings.maxTokens       = parseInt(map.api_max_tokens);
    if (map.api_presence_penalty) appState.apiSettings.presencePenalty = parseFloat(map.api_presence_penalty);
    if (map.api_context_limit)    appState.apiSettings.contextLimit    = parseInt(map.api_context_limit);

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