<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { fetchModels, saveSetting } from "$lib/utils/settings";
  import * as m from "$lib/paraglide/messages";
  import Button from '$lib/components/ui/Button.svelte';

  let { powerUser = false }: { powerUser?: boolean } = $props();

  type ProviderTab = 'local' | 'cloud';

  type Provider = {
    label: string;
    url: string;
    badge: () => string;
    icon: 'desktop' | 'cloud' | 'terminal' | 'ollama' | 'kobold' | 'openai' | 'grok';
    tab: ProviderTab;
    keyPlaceholder?: string;
  };

  const PROVIDERS: Provider[] = [
    { label: "LM Studio",  url: "http://127.0.0.1:1234/v1",    badge: () => m.settings_provider_badge_local(), icon: 'desktop',  tab: 'local' },
    { label: "Ollama",     url: "http://127.0.0.1:11434/v1",   badge: () => m.settings_provider_badge_local(), icon: 'ollama',   tab: 'local' },
    { label: "KoboldCPP",  url: "http://127.0.0.1:5001/v1",    badge: () => m.settings_provider_badge_local(), icon: 'kobold',   tab: 'local' },
    { label: "llama.cpp",  url: "http://127.0.0.1:8080/v1",    badge: () => m.settings_provider_badge_local(), icon: 'terminal', tab: 'local' },

    { label: "OpenRouter", url: "https://openrouter.ai/api/v1", badge: () => m.settings_provider_badge_cloud(), icon: 'cloud',   tab: 'cloud', keyPlaceholder: "sk-or-..." },
    { label: "OpenAI",     url: "https://api.openai.com/v1",   badge: () => m.settings_provider_badge_cloud(), icon: 'openai',  tab: 'cloud', keyPlaceholder: "sk-..." },
    { label: "Grok",       url: "https://api.x.ai/v1",         badge: () => m.settings_provider_badge_cloud(), icon: 'grok',    tab: 'cloud', keyPlaceholder: "xai-..." },
  ];

  let customMode      = $state(false);
  let availableModels = $state<string[]>([]);
  let modelsLoading   = $state(false);
  let modelsError     = $state("");

  const CONTEXT_STEPS = [
    { label: "4K",   value: 4096   },
    { label: "8K",   value: 8192   },
    { label: "16K",  value: 16384  },
    { label: "32K",  value: 32768  },
    { label: "64K",  value: 65536  },
    { label: "128K", value: 131072 },
  ];

  const activeProvider = $derived(
    PROVIDERS.find(p => p.url === appState.apiSettings.url) ?? null
  );

  const activeTab = $derived<ProviderTab>(
    customMode
      ? 'cloud'
      : (activeProvider?.tab ?? (
          appState.apiSettings.url.includes('127.0.0.1') ||
          appState.apiSettings.url.includes('localhost') ? 'local' : 'cloud'
        ))
  );

  const filteredProviders = $derived(PROVIDERS.filter(p => p.tab === activeTab));

  const showUrl = $derived(powerUser || customMode);
  const showKey = $derived(powerUser || activeTab === 'cloud' || customMode);

  const keyPlaceholder = $derived(activeProvider?.keyPlaceholder ?? "sk-...");

  function switchTab(tab: ProviderTab) {
    if (activeTab === tab) return;
    customMode = false;
    const first = PROVIDERS.find(p => p.tab === tab);
    if (first) selectProvider(first);
  }

  function selectProvider(provider: Provider) {
    customMode = false;
    appState.apiSettings.url   = provider.url;
    appState.apiSettings.model = "";
    availableModels = [];
    modelsError     = "";
  }

  function selectCustom() {
    customMode = true;
    appState.apiSettings.url   = "";
    appState.apiSettings.model = "";
    availableModels = [];
    modelsError     = "";
  }

  async function loadModels() {
    modelsLoading = true;
    modelsError   = "";
    availableModels = [];
    try {
      const models = await fetchModels(appState.apiSettings.url, appState.apiSettings.apiKey);
      if (models.length === 0) {
        modelsError = m.settings_model_error_no_models();
      } else {
        availableModels = models;
        if (!availableModels.includes(appState.apiSettings.model)) {
          appState.apiSettings.model = availableModels[0];
        }
        await saveSetting("api_model", appState.apiSettings.model);
      }
    } catch (e: any) {
      modelsError = m.settings_model_error_fetch({ error: e.message || String(e) });
    }
    modelsLoading = false;
  }
</script>

<section>
  <span class="settings-section-title">{m.settings_section_api()}</span>
  <div class="settings-card space-y-4">

    <div class="tab-switcher">
      <button
        class="tab-btn {activeTab === 'local' ? 'tab-btn--active' : ''}"
        onclick={() => switchTab('local')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="3" y="12" width="18" height="9" rx="2"/>
          <path d="M3 8h18M7 4h10M12 12v9" stroke-linecap="round"/>
        </svg>
        {m.settings_provider_badge_local()}
      </button>
      <button
        class="tab-btn {activeTab === 'cloud' ? 'tab-btn--active' : ''}"
        onclick={() => switchTab('cloud')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {m.settings_provider_badge_cloud()}
      </button>
    </div>

    <div>
      <span class="settings-label">{m.settings_provider_label()}</span>
      <div class="provider-grid" class:provider-grid--4={activeTab === 'cloud'}>

        {#each filteredProviders as provider (provider.url)}
          <button
            onclick={() => selectProvider(provider)}
            class="provider-btn {!customMode && activeProvider?.url === provider.url ? 'provider-btn--active' : ''}"
          >
            {#if provider.icon === 'desktop'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="2" y="4" width="20" height="13" rx="2"/>
                <path d="M1 20h22" stroke-linecap="round"/>
                <circle cx="12" cy="17" r="0.8" fill="currentColor"/>
              </svg>
            {:else if provider.icon === 'cloud'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {:else if provider.icon === 'ollama'}
              <svg class="provider-icon" height="20" width="20" fill="currentColor" viewBox="0 0 640 640"><path d="M64 528L64 380.9C64 272.5 132.3 175.8 234.5 139.6L404.2 79.5C425.6 71.9 448 87.8 448 110.4C448 121.4 442.5 131.6 433.4 137.7L400 160C448.1 160 491.2 189.8 508.1 234.9L556.7 364.4C568.5 395.8 560.8 431.2 537.1 454.9C521.1 470.9 499.3 480 476.6 480L473.2 480C447.1 480 422.3 468.4 405.6 448.3L373.3 409.6C361.6 413.7 349.1 416 336 416L335.9 416C329.6 416 323.4 415.5 317.3 414.5C313.7 413.9 310.1 413.1 306.6 412.2L306.6 412.2C277.7 404.4 253.5 385.4 238.8 360C234.4 352.3 224.6 349.7 216.9 354.2C209.2 358.7 206.6 368.4 211.1 376.1C235.1 417.6 279.4 446.1 330.4 448L377.6 518.8C381.6 524.9 383.8 532 383.8 539.2C383.8 559.5 367.3 576 347 576L112 576C85.5 576 64 554.5 64 528zM392 288C405.3 288 416 277.3 416 264C416 250.7 405.3 240 392 240C378.7 240 368 250.7 368 264C368 277.3 378.7 288 392 288z"/></svg>
            {:else if provider.icon === 'terminal'}
              <svg class="provider-icon" height="20" width="20" fill="currentColor" viewBox="0 0 640 640"><path d="M64 160C64 124.7 92.7 96 128 96L512 96C547.3 96 576 124.7 576 160L576 400L512 400L512 160L128 160L128 400L64 400L64 160zM0 467.2C0 456.6 8.6 448 19.2 448L620.8 448C631.4 448 640 456.6 640 467.2C640 509.6 605.6 544 563.2 544L76.8 544C34.4 544 0 509.6 0 467.2zM281 273L250 304L281 335C290.4 344.4 290.4 359.6 281 368.9C271.6 378.2 256.4 378.3 247.1 368.9L199.1 320.9C189.7 311.5 189.7 296.3 199.1 287L247.1 239C256.5 229.6 271.7 229.6 281 239C290.3 248.4 290.4 263.6 281 272.9zM393 239L441 287C450.4 296.4 450.4 311.6 441 320.9L393 368.9C383.6 378.3 368.4 378.3 359.1 368.9C349.8 359.5 349.7 344.3 359.1 335L390.1 304L359.1 273C349.7 263.6 349.7 248.4 359.1 239.1C368.5 229.8 383.7 229.7 393 239.1z"/></svg>
            {:else if provider.icon === 'kobold'}
              <svg class="provider-icon" height="20" width="20" fill="currentColor" viewBox="0 0 640 640"><path d="M352 188.5L300.1 175.5C293.6 173.9 288.8 168.4 288.1 161.7C287.4 155 290.9 148.6 296.8 145.6L337.6 125.2L294.3 92.7C288.8 88.6 286.5 81.4 288.7 74.8C290.9 68.2 297.1 64 304 64L464 64C494.2 64 522.7 78.2 540.8 102.4L598.4 179.2C604.6 187.5 608 197.6 608 208C608 234.5 586.5 256 560 256L538.5 256C521.5 256 505.2 249.3 493.2 237.3L479.9 224L447.9 224L447.9 245.5C447.9 270.3 460.7 293.4 481.7 306.6L588.3 373.2C620.4 393.3 639.9 428.4 639.9 466.3C639.9 526.9 590.8 576.1 530.1 576.1L32.3 576C29 576 25.7 575.6 22.7 574.6C13.5 571.8 6 565 2.3 556C1 552.7 .1 549.1 0 545.3C-.2 541.6 .3 538 1.3 534.6C4.1 525.4 10.9 517.9 19.9 514.2C22.9 513 26.1 512.2 29.4 512L433.3 476C441.6 475.3 448 468.3 448 459.9C448 455.6 446.3 451.5 443.3 448.5L398.9 404.1C368.9 374.1 352 333.4 352 291L352 188.5zM512 136.3C512 136.2 512 136.1 512 136C512 135.9 512 135.8 512 135.7L512 136.3zM510.7 143.7L464.3 132.1C464.1 133.4 464 134.7 464 136C464 149.3 474.7 160 488 160C498.6 160 507.5 153.2 510.7 143.7zM130.9 180.5C147.2 166 171.3 164.3 189.4 176.4L320 263.4L320 290.9C320 323.7 328.4 355.7 344 383.9L112 383.9C105.3 383.9 99.3 379.7 97 373.5C94.7 367.3 96.5 360.2 101.6 355.8L171 296.3L18.4 319.8C11.4 320.9 4.5 317.2 1.5 310.8C-1.5 304.4 .1 296.8 5.4 292L130.9 180.5z"/></svg>
            {:else if provider.icon === 'openai'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.04 14.11A4.501 4.501 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.778 2.758a4.5 4.5 0 0 1-.676 8.116v-5.678a.79.79 0 0 0-.395-.645zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.78-2.758a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
              </svg>
            {:else if provider.icon === 'grok'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            {/if}
            <span class="provider-label">{provider.label}</span>
          </button>
        {/each}

        {#if activeTab === 'cloud'}
          <button onclick={selectCustom} class="provider-btn {customMode ? 'provider-btn--active' : ''}">
            <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke-linecap="round"/>
            </svg>
            <span class="provider-label">{m.settings_api_custom_provider_label()}</span>
          </button>
        {/if}

      </div>
    </div>

    {#if showUrl}
      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-url">{m.settings_api_url_label()}</label>
        <input
          id="api-url"
          type="text"
          bind:value={appState.apiSettings.url}
          placeholder={customMode ? "https://my-provider.com/v1" : undefined}
          onchange={() => { availableModels = []; appState.apiSettings.model = ""; modelsError = ""; }}
          class="settings-input"
        />
      </div>
    {/if}

    {#if showKey}
      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-key">
          {m.settings_api_key_label()}
          {#if activeTab === 'local' && !customMode}
            <span class="optional-badge">{m.settings_api_key_optional()}</span>
          {/if}
        </label>
        <input
          id="api-key"
          type="password"
          bind:value={appState.apiSettings.apiKey}
          placeholder={keyPlaceholder}
          class="settings-input"
        />
      </div>
    {/if}

    <div class="settings-divider"></div>

    <div>
      <div class="flex items-center justify-between mb-2">
        <label class="settings-label" for="model-select" style="margin-bottom:0">
          {m.settings_model_label()}
        </label>
        <Button variant="secondary" size="sm" disabled={modelsLoading} onclick={loadModels}>
          {#if modelsLoading}
            <span class="load-dot"></span>
            <span class="load-dot" style="animation-delay:.15s"></span>
            <span class="load-dot" style="animation-delay:.3s"></span>
          {:else}
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
                    stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
            {m.settings_model_load_btn()}
          {/if}
        </Button>
      </div>

      {#if availableModels.length > 0}
        <select id="model-select" bind:value={appState.apiSettings.model} class="settings-input select-chevron" onchange={() => saveSetting("api_model", appState.apiSettings.model)}>
          {#each availableModels as modelId}
            <option value={modelId}>{modelId}</option>
          {/each}
        </select>
      {:else}
        <div class="settings-input cursor-default h-[42px] max-h-[42px] overflow-hidden whitespace-nowrap {modelsError ? 'error-state' : 'empty-state'}">
          {#if modelsError}
            {modelsError}
          {:else if appState.apiSettings.model}
            {appState.apiSettings.model}
          {:else}
            {m.settings_model_empty_hint()}
          {/if}
        </div>
      {/if}
    </div>

<div class="settings-divider"></div>

    <div class="ctx-row">
      <div style="display: flex; align-items: center; gap: 8px; margin-bottom: 0;">
        <span class="settings-label whitespace-nowrap" style="margin-bottom:0">{m.settings_context_label()}</span>
        
        <div class="ryokan-tooltip-wrapper">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"></circle>
            <line x1="12" y1="16" x2="12" y2="12"></line>
            <line x1="12" y1="8" x2="12.01" y2="8"></line>
          </svg>
          <div class="ryokan-tooltip-text">
            {m.settings_context_tooltip_p1()}<br><br>
            {m.settings_context_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_context_tooltip_hint()}</span>
          </div>
        </div>
      </div>

      <div class="ctx-chips">
        {#each CONTEXT_STEPS as step}
          <button
            type="button"
            class="ctx-chip {(appState.apiSettings.contextLimit ?? 4096) === step.value ? 'ctx-chip--active' : ''}"
            onclick={() => { appState.apiSettings.contextLimit = step.value; }}
            title={m.settings_context_words_hint({ count: Math.round(step.value * 0.75).toLocaleString() })}
          >{step.label}</button>
        {/each}
      </div>
    </div>

    </div>
</section>

<style>
  .tab-switcher {
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 3px;
  }
  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: #5a5a5e;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tab-btn:hover:not(.tab-btn--active) {
    color: #a0a0a6;
    background: rgba(255, 255, 255, 0.03);
  }
  .tab-btn--active {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(212, 180, 131, 0.25);
    color: #d4b483;
  }

  .provider-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .provider-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 10px 6px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    color: #6b6b6e;
    transition: all 0.15s ease;
    cursor: pointer;
  }
  .provider-btn:hover {
    border-color: rgba(255,255,255,0.12);
    color: #d1d1d6;
    background: rgba(255,255,255,0.04);
  }
  .provider-btn:active { transform: scale(0.97); }
  .provider-btn--active {
    background: rgba(255,255,255,0.07);
    border-color: rgba(212,180,131,0.4);
    color: #d4b483;
  }
  .provider-icon {
    flex-shrink: 0;
    opacity: 0.8;
  }
  .provider-btn--active .provider-icon { opacity: 1; }
  .provider-label {
    font-size: 12px;
    font-weight: 600;
    line-height: 1;
  }

  .optional-badge {
    margin-left: 6px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #3a3a3c;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
    padding: 1px 5px;
    vertical-align: middle;
  }

  .select-chevron {
    appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%238a8a8e' stroke-width='2.5'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 12px center;
    padding-right: 36px;
    color-scheme: dark;
  }
  .select-chevron option { background-color: #1c1c1e; color: #e5e5ea; padding: 8px 12px; font-size: 13px; }
  .select-chevron option:checked, .select-chevron option:hover { background-color: #2c2c2e; color: #d4b483; }

  .empty-state { color: #3a3a3c; }
  .error-state { color: #f87171; border-color: rgba(248,113,113,0.2); background: rgba(248,113,113,0.04); }

  .load-dot { display: inline-block; width: 4px; height: 4px; border-radius: 50%; background: currentColor; animation: bounce 0.8s ease-in-out infinite; }
  @keyframes bounce { 0%, 100% { transform: translateY(0); opacity: 0.4; } 50% { transform: translateY(-3px); opacity: 1; } }

  .ctx-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .ctx-chips {
    display: flex;
    gap: 4px;
    background: rgba(0,0,0,0.2);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 10px;
    padding: 3px;
  }
  .ctx-chip {
    padding: 5px 10px;
    border-radius: 7px;
    border: 1px solid transparent;
    background: transparent;
    color: #5a5a5e;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: all 0.15s ease;
    white-space: nowrap;
  }
  .ctx-chip:hover:not(.ctx-chip--active) {
    color: #a0a0a6;
    background: rgba(255,255,255,0.03);
  }
  .ctx-chip--active {
    background: rgba(255,255,255,0.07);
    border-color: rgba(212,180,131,0.35);
    color: #d4b483;
  }
  .ryokan-tooltip-wrapper {
  position: relative;
  display: inline-flex;
  cursor: help;
}

.ryokan-tooltip-wrapper svg {
  transition: stroke 0.2s ease;
}
.ryokan-tooltip-wrapper:hover svg {
  stroke: #d4b483;
}

.ryokan-tooltip-text {
  visibility: hidden;
  opacity: 0;
  position: absolute;
  bottom: calc(100% + 10px);
  left: 50%;
  transform: translateX(-50%) translateY(4px);
  width: 230px;
  background: #1c1c1e;
  color: #a1a1aa;
  border: 1px solid rgba(212, 180, 131, 0.15);
  text-align: left;
  padding: 10px 12px;
  border-radius: 10px;
  font-size: 11.5px;
  font-weight: 400;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
  transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
  z-index: 50;
  pointer-events: none;
  line-height: 1.5;
}

.ryokan-tooltip-text::after {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  border: 5px solid transparent;
  border-top-color: rgba(212, 180, 131, 0.15);
}
.ryokan-tooltip-text::before {
  content: '';
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 1px;
  border: 5px solid transparent;
  border-top-color: #1c1c1e;
  z-index: 1;
}

.ryokan-tooltip-wrapper:hover .ryokan-tooltip-text {
  visibility: visible;
  opacity: 1;
  transform: translateX(-50%) translateY(0);
}

.tooltip-hint {
  color: #d4b483;
  font-weight: 500;
}
</style>