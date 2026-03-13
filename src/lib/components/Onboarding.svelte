<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { appState } from '$lib/stores/appState.svelte';
  import { saveSetting, fetchModels } from '$lib/utils/settings';
  import { setLocale } from '$lib/paraglide/runtime';

  let selectedLanguage = $state<'English' | 'German'>('English');

  function selectLanguage(lang: 'English' | 'German') {
    selectedLanguage = lang;
  }

  let apiUrl        = $state('');
  let apiKey        = $state('');
  let models        = $state<string[]>([]);
  let selectedModel = $state('');
  let loadingModels = $state(false);
  let modelError    = $state('');
  let saving        = $state(false);

  type ProviderTab = 'local' | 'cloud';

  type Preset = {
    label: string;
    url: string;
    needsKey: boolean;
    tab: ProviderTab;
    keyPlaceholder?: string;
    icon: 'desktop' | 'ollama' | 'terminal' | 'kobold' | 'openrouter' | 'openai' | 'grok' | 'custom';
  };

  const presets: Preset[] = [
    { label: 'LM Studio',  url: 'http://127.0.0.1:1234/v1',    needsKey: false, tab: 'local', icon: 'desktop'    },
    { label: 'Ollama',     url: 'http://127.0.0.1:11434/v1',   needsKey: false, tab: 'local', icon: 'ollama'     },
    { label: 'KoboldCPP',  url: 'http://127.0.0.1:5001/v1',    needsKey: false, tab: 'local', icon: 'kobold'     },
    { label: 'llama.cpp',  url: 'http://127.0.0.1:8080/v1',    needsKey: false, tab: 'local', icon: 'terminal'   },
    { label: 'OpenRouter', url: 'https://openrouter.ai/api/v1', needsKey: true,  tab: 'cloud', icon: 'openrouter', keyPlaceholder: 'sk-or-...' },
    { label: 'OpenAI',     url: 'https://api.openai.com/v1',   needsKey: true,  tab: 'cloud', icon: 'openai',     keyPlaceholder: 'sk-...'    },
    { label: 'Grok',       url: 'https://api.x.ai/v1',         needsKey: true,  tab: 'cloud', icon: 'grok',       keyPlaceholder: 'xai-...'   },
    { label: 'Custom',     url: '',                             needsKey: false, tab: 'cloud', icon: 'custom' },
  ];

  let activeTab    = $state<ProviderTab>('local');
  let activePreset = $state<string | null>(null);

  const filteredPresets = $derived(presets.filter(p => p.tab === activeTab));
  const currentPreset   = $derived(presets.find(p => p.label === activePreset) ?? null);
  const needsKey        = $derived(!!currentPreset?.needsKey);
  const keyPlaceholder  = $derived(currentPreset?.keyPlaceholder ?? 'sk-...');
  const canFinish       = $derived(!!selectedModel && !saving);
  const isCustom        = $derived(activePreset === 'Custom');

  function switchTab(tab: ProviderTab) {
    activeTab = tab;
    // Reset if the active preset is on the other tab
    if (currentPreset && currentPreset.tab !== tab) {
      activePreset  = null;
      apiUrl        = '';
      apiKey        = '';
      models        = [];
      selectedModel = '';
      modelError    = '';
    }
  }

  async function selectPreset(preset: Preset) {
    activePreset  = preset.label;
    apiUrl        = preset.url;
    apiKey        = '';
    models        = [];
    selectedModel = '';
    modelError    = '';
    if (!preset.needsKey && preset.label !== 'Custom') await loadModels();
  }

  async function loadModels() {
    if (!apiUrl) return;
    loadingModels = true;
    modelError    = '';
    models        = [];
    selectedModel = '';

    try {
      if (needsKey) {
        if (!apiKey || apiKey.trim().length < 10) {
          throw new Error('Please enter a valid API key.');
        }

        if (activePreset === 'OpenRouter') {
          const authCheck = await fetch(`${apiUrl}/auth/key`, {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${apiKey}` }
          });
          if (!authCheck.ok) throw new Error('Invalid API key! Please check OpenRouter.');
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

  async function finish() {
    saving     = true;
    modelError = '';

    try {
      await saveSetting('ai_language', selectedLanguage);
      await saveSetting('api_url', apiUrl);
      await saveSetting('api_key', apiKey);
      await saveSetting('api_model', selectedModel);
      await saveSetting('onboarding_completed', 'true');

      setLocale(selectedLanguage === 'English' ? 'en' : 'de');

      appState.apiSettings = {
        ...appState.apiSettings,
        aiLanguage: selectedLanguage,
        url:        apiUrl,
        apiKey:     apiKey,
        model:      selectedModel
      };

      appState.isOnboarding = false;

    } catch (error) {
      console.error('Failed to save settings:', error);
      modelError = 'Database error while saving. Please try again.';
    } finally {
      saving = false;
    }
  }
</script>

<div
  class="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm overflow-hidden"
  in:fade={{ duration: 250 }}
>
  <div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[500px] h-[500px] bg-ryokan-accent/10 rounded-full blur-[140px] pointer-events-none"></div>

  <div
    class="w-full sm:max-w-[360px] mx-0 sm:mx-4 bg-[#1c1c1e]/95 backdrop-blur-xl sm:rounded-3xl rounded-t-3xl shadow-2xl overflow-hidden border border-white/[0.06]"
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

        <div class="flex gap-1 p-1 rounded-xl bg-black/20 border border-white/[0.06]">
          {#each (['local', 'cloud'] as ProviderTab[]) as tab}
            <button
              type="button"
              onclick={() => switchTab(tab)}
              class="
                flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded-[10px] border
                text-[12px] font-semibold tracking-wide transition-all duration-150
                {activeTab === tab
                  ? 'border-ryokan-accent/25 bg-white/[0.07] text-ryokan-accent'
                  : 'border-transparent bg-transparent text-white/30 hover:text-white/55'}
              "
            >
              {#if tab === 'local'}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <rect x="3" y="12" width="18" height="9" rx="2"/>
                  <path d="M3 8h18M7 4h10M12 12v9" stroke-linecap="round"/>
                </svg>
                Local
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
                Cloud
              {/if}
            </button>
          {/each}
        </div>

        <div class="grid grid-cols-4 gap-2">
          {#each filteredPresets as preset (preset.url)}
            <button
              type="button"
              onclick={() => selectPreset(preset)}
              disabled={loadingModels}
              class="
                flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl border
                text-[11px] font-semibold transition-all duration-150 active:scale-[0.97] disabled:opacity-50
                {activePreset === preset.label
                  ? 'border-ryokan-accent/50 bg-ryokan-accent/12 text-white'
                  : 'border-white/[0.08] bg-white/[0.04] text-white/40 hover:text-white/70 hover:border-white/15'}
              "
            >
              <span class="opacity-80">
                {#if preset.icon === 'desktop'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <rect x="2" y="4" width="20" height="13" rx="2"/>
                    <path d="M1 20h22" stroke-linecap="round"/>
                    <circle cx="12" cy="17" r="0.8" fill="currentColor"/>
                  </svg>
                {:else if preset.icon === 'ollama'}
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 640 640" aria-hidden="true"><path d="M64 528L64 380.9C64 272.5 132.3 175.8 234.5 139.6L404.2 79.5C425.6 71.9 448 87.8 448 110.4C448 121.4 442.5 131.6 433.4 137.7L400 160C448.1 160 491.2 189.8 508.1 234.9L556.7 364.4C568.5 395.8 560.8 431.2 537.1 454.9C521.1 470.9 499.3 480 476.6 480L473.2 480C447.1 480 422.3 468.4 405.6 448.3L373.3 409.6C361.6 413.7 349.1 416 336 416L335.9 416C329.6 416 323.4 415.5 317.3 414.5C313.7 413.9 310.1 413.1 306.6 412.2L306.6 412.2C277.7 404.4 253.5 385.4 238.8 360C234.4 352.3 224.6 349.7 216.9 354.2C209.2 358.7 206.6 368.4 211.1 376.1C235.1 417.6 279.4 446.1 330.4 448L377.6 518.8C381.6 524.9 383.8 532 383.8 539.2C383.8 559.5 367.3 576 347 576L112 576C85.5 576 64 554.5 64 528zM392 288C405.3 288 416 277.3 416 264C416 250.7 405.3 240 392 240C378.7 240 368 250.7 368 264C368 277.3 378.7 288 392 288z"/></svg>
                {:else if preset.icon === 'terminal'}
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 640 640" aria-hidden="true"><path d="M64 160C64 124.7 92.7 96 128 96L512 96C547.3 96 576 124.7 576 160L576 400L512 400L512 160L128 160L128 400L64 400L64 160zM0 467.2C0 456.6 8.6 448 19.2 448L620.8 448C631.4 448 640 456.6 640 467.2C640 509.6 605.6 544 563.2 544L76.8 544C34.4 544 0 509.6 0 467.2zM281 273L250 304L281 335C290.4 344.4 290.4 359.6 281 368.9C271.6 378.2 256.4 378.3 247.1 368.9L199.1 320.9C189.7 311.5 189.7 296.3 199.1 287L247.1 239C256.5 229.6 271.7 229.6 281 239C290.3 248.4 290.4 263.6 281 272.9zM393 239L441 287C450.4 296.4 450.4 311.6 441 320.9L393 368.9C383.6 378.3 368.4 378.3 359.1 368.9C349.8 359.5 349.7 344.3 359.1 335L390.1 304L359.1 273C349.7 263.6 349.7 248.4 359.1 239.1C368.5 229.8 383.7 229.7 393 239.1z"/></svg>
                {:else if preset.icon === 'kobold'}
                  <svg width="18" height="18" fill="currentColor" viewBox="0 0 640 640" aria-hidden="true"><path d="M352 188.5L300.1 175.5C293.6 173.9 288.8 168.4 288.1 161.7C287.4 155 290.9 148.6 296.8 145.6L337.6 125.2L294.3 92.7C288.8 88.6 286.5 81.4 288.7 74.8C290.9 68.2 297.1 64 304 64L464 64C494.2 64 522.7 78.2 540.8 102.4L598.4 179.2C604.6 187.5 608 197.6 608 208C608 234.5 586.5 256 560 256L538.5 256C521.5 256 505.2 249.3 493.2 237.3L479.9 224L447.9 224L447.9 245.5C447.9 270.3 460.7 293.4 481.7 306.6L588.3 373.2C620.4 393.3 639.9 428.4 639.9 466.3C639.9 526.9 590.8 576.1 530.1 576.1L32.3 576C29 576 25.7 575.6 22.7 574.6C13.5 571.8 6 565 2.3 556C1 552.7 .1 549.1 0 545.3C-.2 541.6 .3 538 1.3 534.6C4.1 525.4 10.9 517.9 19.9 514.2C22.9 513 26.1 512.2 29.4 512L433.3 476C441.6 475.3 448 468.3 448 459.9C448 455.6 446.3 451.5 443.3 448.5L398.9 404.1C368.9 374.1 352 333.4 352 291L352 188.5zM512 136.3C512 136.2 512 136.1 512 136C512 135.9 512 135.8 512 135.7L512 136.3zM510.7 143.7L464.3 132.1C464.1 133.4 464 134.7 464 136C464 149.3 474.7 160 488 160C498.6 160 507.5 153.2 510.7 143.7zM130.9 180.5C147.2 166 171.3 164.3 189.4 176.4L320 263.4L320 290.9C320 323.7 328.4 355.7 344 383.9L112 383.9C105.3 383.9 99.3 379.7 97 373.5C94.7 367.3 96.5 360.2 101.6 355.8L171 296.3L18.4 319.8C11.4 320.9 4.5 317.2 1.5 310.8C-1.5 304.4 .1 296.8 5.4 292L130.9 180.5z"/></svg>
                {:else if preset.icon === 'openrouter'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" stroke-linecap="round" stroke-linejoin="round"/>
                  </svg>
                {:else if preset.icon === 'openai'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.04 14.11A4.501 4.501 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.778 2.758a4.5 4.5 0 0 1-.676 8.116v-5.678a.79.79 0 0 0-.395-.645zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.78-2.758a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
                  </svg>
                {:else if preset.icon === 'grok'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
                  </svg>
                {:else if preset.icon === 'custom'}
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <circle cx="12" cy="12" r="3"/>
                    <path d="M12 2v3M12 19v3M4.22 4.22l2.12 2.12M17.66 17.66l2.12 2.12M2 12h3M19 12h3M4.22 19.78l2.12-2.12M17.66 6.34l2.12-2.12" stroke-linecap="round"/>
                  </svg>
                {/if}
              </span>

              {#if loadingModels && activePreset === preset.label}
                <span class="w-3 h-3 rounded-full border-[1.5px] border-ryokan-accent border-t-transparent animate-spin"></span>
              {:else}
                {preset.label}
              {/if}
            </button>
          {/each}
        </div>
      </div>

      {#if isCustom}
        <div class="space-y-2" in:fly={{ y: 8, duration: 200 }}>
          <div class="rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
            <input
              type="url"
              bind:value={apiUrl}
              placeholder="https://your-api.example.com/v1"
              class="w-full px-3.5 py-2.5 bg-transparent text-white text-[13px] placeholder-white/20 focus:outline-none"
            />
          </div>
          <div class="flex gap-2">
            <div class="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
              <input
                type="password"
                bind:value={apiKey}
                placeholder="API Key (optional)"
                class="w-full px-3.5 py-2.5 bg-transparent text-white text-[13px] placeholder-white/20 focus:outline-none"
              />
            </div>
            <button
              type="button"
              onclick={loadModels}
              disabled={loadingModels || !apiUrl}
              class="
                px-4 py-2.5 rounded-xl border border-ryokan-accent/30 text-ryokan-accent
                text-[13px] font-medium hover:bg-ryokan-accent/8 active:scale-[0.97]
                disabled:opacity-25 transition-all whitespace-nowrap
              "
            >
              {loadingModels ? '…' : 'Connect'}
            </button>
          </div>
        </div>
      {:else if activePreset && needsKey}
        <div class="space-y-2.5" in:fly={{ y: 8, duration: 200 }}>
          <div class="flex gap-2">
            <div class="flex-1 rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
              <input
                type="password"
                bind:value={apiKey}
                placeholder={keyPlaceholder}
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
        </div>
      {/if}

      {#if activePreset}
        <div class="space-y-2" in:fly={{ y: 6, duration: 180 }}>
          {#if models.length > 0}
            <div class="rounded-xl bg-white/[0.04] border border-white/[0.08] overflow-hidden">
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

          {#if modelError}
            <p class="text-[12px] text-red-400/80">{modelError}</p>
          {:else if !loadingModels && models.length === 0 && !needsKey}
            <p class="text-[12px] text-white/25">No models found — is your local API server running?</p>
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