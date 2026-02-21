<script lang="ts">
  import { fade } from 'svelte/transition';
  import { apiSettings, isOnboarding } from '$lib/stores/appState';
  import { saveSetting, fetchModels } from '$lib/db/settings';
  import { setLocale } from '$lib/paraglide/runtime';

  let selectedLanguage = 'English';

  function selectLanguage(lang: 'English' | 'German') {
    selectedLanguage = lang;
  }

  let apiUrl    = '';
  let apiKey    = '';
  let models: string[] = [];
  let selectedModel = '';
  let loadingModels = false;
  let modelError    = '';

  const presets = [
    { label: 'LM Studio',  url: 'http://127.0.0.1:1234/v1',       needsKey: false },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1',    needsKey: true  },
  ];

  let activePreset: string | null = null;

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

  let saving = false;

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
      apiSettings.update(s => ({
        ...s,
        aiLanguage: selectedLanguage,
        url: apiUrl,
        apiKey: apiKey,
        model: selectedModel
      }));

      isOnboarding.set(false);

    } catch (error) {
      console.error('Failed to save settings:', error);
      modelError = 'Database error while saving. Please try again.';
    } finally {
      saving = false;
    }
  }

  $: needsKey  = !!activePreset && !!presets.find(p => p.label === activePreset)?.needsKey;
  $: canFinish = !!selectedModel && !saving;
</script>

<div
  class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-[#0a0a0c] overflow-hidden"
  in:fade={{ duration: 200 }}
>
<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-ryokan-accent/15 rounded-full blur-[120px] pointer-events-none"></div>
  <div class="w-full sm:max-w-xs mx-0 sm:mx-4 bg-[#1c1c1e] sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden">

    <!-- Mobile drag pill -->
    <div class="flex justify-center pt-3 sm:hidden">
      <div class="w-9 h-1 rounded-full bg-white/20"></div>
    </div>

    <div class="px-5 pt-5 pb-7 space-y-5">

      <!-- Header -->
      <div>
        <h1 class="text-lg font-semibold text-white">Setup</h1>
        <p class="text-[12px] text-gray-500 mt-0.5">Choose your language and AI provider.</p>
      </div>

      <!-- Language -->
      <div>
        <p class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">Language</p>
        <div class="flex gap-2">
          {#each [{ val: 'English', display: 'English' }, { val: 'German', display: 'Deutsch' }] as lang}
            <button
              type="button"
              on:click={() => selectLanguage(lang.val as 'English' | 'German')}
              class="
                flex-1 py-2.5 rounded-xl border text-sm font-medium
                transition-all duration-150 active:scale-[0.97]
                {selectedLanguage === lang.val
                  ? 'border-ryokan-accent bg-ryokan-accent/15 text-white'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-200'}
              "
            >
              {lang.display}
            </button>
          {/each}
        </div>
      </div>

      <!-- Provider -->
      <div>
        <p class="text-[10px] font-semibold text-gray-500 uppercase tracking-wider mb-2">AI Provider</p>
        <div class="flex gap-2">
          {#each presets as preset}
            <button
              type="button"
              on:click={() => selectPreset(preset)}
              disabled={loadingModels}
              class="
                flex-1 py-2.5 rounded-xl border text-sm font-medium
                transition-all duration-150 active:scale-[0.97] disabled:opacity-60
                {activePreset === preset.label
                  ? 'border-ryokan-accent bg-ryokan-accent/15 text-white'
                  : 'border-white/10 bg-white/5 text-gray-400 hover:text-gray-200'}
              "
            >
              {#if loadingModels && activePreset === preset.label}
                <span class="inline-flex items-center justify-center gap-1.5">
                  <span class="w-3 h-3 rounded-full border-2 border-ryokan-accent border-t-transparent animate-spin"></span>
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
        <div class="space-y-3">

          <!-- API Key (OpenRouter only) -->
          {#if needsKey}
            <div class="flex gap-2">
              <div class="flex-1 rounded-xl bg-white/5 border border-white/10 overflow-hidden">
                <input
                  type="password"
                  bind:value={apiKey}
                  placeholder="sk-or-..."
                  class="w-full px-3 py-2.5 bg-transparent text-white text-sm placeholder-gray-600 focus:outline-none"
                />
              </div>
              <button
                type="button"
                on:click={loadModels}
                disabled={loadingModels || !apiKey}
                class="
                  px-4 py-2.5 rounded-xl border border-ryokan-accent/40 text-ryokan-accent
                  text-sm font-medium hover:bg-ryokan-accent/10 active:scale-[0.97]
                  disabled:opacity-30 transition-colors whitespace-nowrap
                "
              >
                {loadingModels ? '…' : 'Connect'}
              </button>
            </div>
          {/if}

          <!-- Model picker -->
          {#if models.length > 0}
            <div class="rounded-xl bg-white/5 border border-white/10 overflow-hidden">
              <select
                bind:value={selectedModel}
                class="w-full px-3 py-2.5 bg-transparent text-white text-sm focus:outline-none appearance-none cursor-pointer"
              >
                {#each models as m}
                  <option value={m} class="bg-[#1c1c1e]">{m}</option>
                {/each}
              </select>
            </div>
          {/if}

          <!-- Status -->
          <p class="text-xs min-h-[1rem] {modelError ? 'text-red-400' : 'text-gray-600'}">
            {#if modelError}
              {modelError}
            {:else if !loadingModels && models.length === 0 && !needsKey}
              No models found — is LM Studio running?
            {:else if loadingModels}
              &nbsp;
            {/if}
          </p>

        </div>
      {/if}

      <!-- CTA -->
      <button
        type="button"
        on:click={finish}
        disabled={!canFinish}
        class="
          w-full py-3.5 rounded-2xl bg-ryokan-accent text-white font-semibold text-[15px]
          hover:opacity-90 active:scale-[0.98] disabled:opacity-25
          transition-all duration-150 shadow-lg shadow-ryokan-accent/20
        "
      >
        {saving ? 'Saving…' : 'Get Started'}
      </button>

    </div>
  </div>
</div>