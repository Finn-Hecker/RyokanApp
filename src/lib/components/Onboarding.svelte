<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { appState } from '$lib/stores/appState.svelte';
  import { saveSetting, fetchModels } from '$lib/utils/settings';
  import { setLocale } from '$lib/paraglide/runtime';

  let selectedLanguage = $state<'English' | 'German'>('English');

  function selectLanguage(lang: 'English' | 'German') {
    selectedLanguage = lang;
  }

  let apiUrl = $state('');
  let apiKey = $state('');
  let models = $state<string[]>([]);
  let selectedModel = $state('');
  let loadingModels = $state(false);
  let modelError = $state('');

  const presets = [
    { label: 'LM Studio',  url: 'http://127.0.0.1:1234/v1',       needsKey: false },
    { label: 'llama.cpp',  url: 'http://127.0.0.1:8080/v1',       needsKey: false },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1',    needsKey: true  },
  ];

  let activePreset = $state<string | null>(null);

  async function selectPreset(preset: typeof presets[number]) {
    activePreset  = preset.label;
    apiUrl        = preset.url;
    apiKey        = '';
    models        = [];
    selectedModel = '';
    modelError    = '';
    if (!preset.needsKey) await loadModels();
  }

  async function loadModels() {
    if (!apiUrl) return;
    loadingModels = true;
    modelError    = '';
    models        = [];
    selectedModel = '';

    try {
      const currentNeedsKey = presets.find(p => p.label === activePreset)?.needsKey;

      if (currentNeedsKey) {
        if (!apiKey || apiKey.trim().length < 10) {
          throw new Error("Please enter a valid API key.");
        }

        const authCheck = await fetch(`${apiUrl}/auth/key`, {
          method: 'GET',
          headers: { 'Authorization': `Bearer ${apiKey}` }
        });

        if (!authCheck.ok) {
          throw new Error("Invalid API key! Please check OpenRouter.");
        }
      }

      models = await fetchModels(apiUrl, apiKey);
      if (models.length > 0) selectedModel = models[0];

    } catch (e: any) {
      modelError = e?.message || e?.toString() || 'Connection failed.';
    } finally {
      loadingModels = false;
    }
  }

  let saving = $state(false);

  async function finish() {
    saving = true;
    modelError = '';

    try {
      await saveSetting('aiLanguage', selectedLanguage);
      await saveSetting('url', apiUrl);
      await saveSetting('apiKey', apiKey);
      await saveSetting('model', selectedModel);
      await saveSetting('onboarding_completed', 'true');

      setLocale(selectedLanguage === 'English' ? 'en' : 'de');

      appState.apiSettings = {
        ...appState.apiSettings,
        aiLanguage: selectedLanguage,
        url: apiUrl,
        apiKey: apiKey,
        model: selectedModel
      };

      appState.isOnboarding = false;

    } catch (error) {
      console.error('Failed to save settings:', error);
      modelError = 'Database error while saving. Please try again.';
    } finally {
      saving = false;
    }
  }

  // 2. Reaktive Ableitungen mit $derived()
  let needsKey  = $derived(!!activePreset && !!presets.find(p => p.label === activePreset)?.needsKey);
  let canFinish = $derived(!!selectedModel && !saving);
</script>

<div
  class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden"
  in:fade={{ duration: 250 }}
>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-ryokan-accent/10 rounded-full blur-[140px] pointer-events-none"></div>

  <div
    class="w-full sm:max-w-[340px] mx-0 sm:mx-4 bg-[#1c1c1e]/95 backdrop-blur-xl sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden border border-white/[0.06]"
    in:fly={{ y: 24, duration: 350, delay: 80 }}
  >
    <div class="flex justify-center pt-3 pb-1 sm:hidden">
      <div class="w-9 h-1 rounded-full bg-white/15"></div>
    </div>

    <div class="px-6 pt-6 pb-7 space-y-6">

      <div class="flex flex-col items-center text-center pt-1 pb-1">
        <div class="w-[56px] h-[56px] rounded-[16px] bg-ryokan-accent/15 border border-ryokan-accent/20 flex items-center justify-center mb-4 shadow-lg shadow-ryokan-accent/10">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M13 3C7.477 3 3 7.477 3 13s4.477 10 10 10 10-4.477 10-10S18.523 3 13 3z" class="fill-ryokan-accent/20"/>
            <path d="M9 13c0-2.21 1.79-4 4-4s4 1.79 4 4-1.79 4-4 4-4-1.79-4-4z" class="fill-ryokan-accent"/>
            <path d="M13 7v2M13 17v2M7 13H5M21 13h-2" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="stroke-ryokan-accent/60"/>
          </svg>
        </div>
        <h1 class="text-[17px] font-semibold text-white tracking-[-0.3px]">Welcome</h1>
        <p class="text-[13px] text-white/35 mt-1 leading-snug">Choose your language and connect<br>an AI provider to get started.</p>
      </div>

      <div class="h-px bg-white/[0.06] -mx-6"></div>

      <div class="space-y-2.5">
        <p class="text-[11px] font-medium text-white/30 uppercase tracking-[0.08em]">Language</p>
        <div class="flex gap-2">
          {#each [{ val: 'English', display: 'English' }, { val: 'German', display: 'Deutsch' }] as lang}
            <button
              type="button"
              onclick={() => selectLanguage(lang.val as 'English' | 'German')}
              class="
                flex-1 py-2.5 rounded-xl border text-[13px] font-medium
                transition-all duration-150 active:scale-[0.97]
                {selectedLanguage === lang.val
                  ? 'border-ryokan-accent/50 bg-ryokan-accent/12 text-white'
                  : 'border-white/[0.08] bg-white/[0.04] text-white/40 hover:text-white/70 hover:border-white/15'}
              "
            >
              {lang.display}
            </button>
          {/each}
        </div>
      </div>

      <div class="space-y-2.5">
        <p class="text-[11px] font-medium text-white/30 uppercase tracking-[0.08em]">AI Provider</p>
        <div class="flex gap-2">
          {#each presets as preset}
            <button
              type="button"
              onclick={() => selectPreset(preset)}
              disabled={loadingModels}
              class="
                flex-1 py-2.5 rounded-xl border text-[13px] font-medium
                transition-all duration-150 active:scale-[0.97] disabled:opacity-50
                {activePreset === preset.label
                  ? 'border-ryokan-accent/50 bg-ryokan-accent/12 text-white'
                  : 'border-white/[0.08] bg-white/[0.04] text-white/40 hover:text-white/70 hover:border-white/15'}
              "
            >
              {#if loadingModels && activePreset === preset.label}
                <span class="inline-flex items-center justify-center gap-1.5">
                  <span class="w-3 h-3 rounded-full border-[1.5px] border-ryokan-accent border-t-transparent animate-spin"></span>
                  Loading
                </span>
              {:else}
                {preset.label}
              {/if}
            </button>
          {/each}
        </div>
      </div>

      {#if activePreset}
        <div class="space-y-2.5" in:fly={{ y: 8, duration: 200 }}>

          {#if needsKey}
            <div class="flex gap-2">
              <div class="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
                <input
                  type="password"
                  bind:value={apiKey}
                  placeholder="sk-or-..."
                  class="w-full px-3.5 py-2.5 bg-transparent text-white text-[13px] placeholder-white/20 focus:outline-none"
                />
              </div>
              <button
                type="button"
                onclick={loadModels}
                disabled={loadingModels || !apiKey}
                class="
                  px-4 py-2.5 rounded-xl border border-ryokan-accent/30 text-ryokan-accent
                  text-[13px] font-medium hover:bg-ryokan-accent/8 active:scale-[0.97]
                  disabled:opacity-25 transition-all whitespace-nowrap
                "
              >
                {loadingModels ? '…' : 'Connect'}
              </button>
            </div>
          {/if}

          {#if models.length > 0}
            <div class="rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden" in:fly={{ y: 6, duration: 180 }}>
              <select
                bind:value={selectedModel}
                class="w-full px-3.5 py-2.5 bg-transparent text-white text-[13px] focus:outline-none appearance-none cursor-pointer"
              >
                {#each models as m}
                  <option value={m} class="bg-[#1c1c1e]">{m}</option>
                {/each}
              </select>
            </div>
          {/if}

          {#if modelError || (!loadingModels && models.length === 0 && !needsKey)}
            <p class="text-[12px] {modelError ? 'text-red-400/80' : 'text-white/25'}">
              {#if modelError}
                {modelError}
              {:else}
                No models found - is your local API server running?
              {/if}
            </p>
          {/if}

        </div>
      {/if}

      <button
        type="button"
        onclick={finish}
        disabled={!canFinish}
        class="
          w-full py-3 rounded-2xl bg-ryokan-accent text-white font-semibold text-[15px]
          tracking-[-0.2px] hover:opacity-90 active:scale-[0.98] disabled:opacity-20
          transition-all duration-150 shadow-lg shadow-ryokan-accent/25
        "
      >
        {saving ? 'Saving…' : 'Get Started'}
      </button>

    </div>
  </div>
</div>
