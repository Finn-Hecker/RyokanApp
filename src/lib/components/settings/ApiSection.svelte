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
    { label: "LM Studio",   url: "http://127.0.0.1:1234/v1",    badge: () => m.settings_provider_badge_local(), icon: 'desktop',  tab: 'local' },
    { label: "Ollama",      url: "http://127.0.0.1:11434/v1",   badge: () => m.settings_provider_badge_local(), icon: 'ollama',   tab: 'local' },
    { label: "KoboldCPP",   url: "http://127.0.0.1:5001/v1",    badge: () => m.settings_provider_badge_local(), icon: 'kobold',   tab: 'local' },
    { label: "llama.cpp",   url: "http://127.0.0.1:8080/v1",    badge: () => m.settings_provider_badge_local(), icon: 'terminal', tab: 'local' },

    { label: "OpenRouter",  url: "https://openrouter.ai/api/v1", badge: () => m.settings_provider_badge_cloud(), icon: 'cloud',    tab: 'cloud', keyPlaceholder: "sk-or-..." },
    { label: "OpenAI",      url: "https://api.openai.com/v1",   badge: () => m.settings_provider_badge_cloud(), icon: 'openai',   tab: 'cloud', keyPlaceholder: "sk-..." },
    { label: "Grok",        url: "https://api.x.ai/v1",         badge: () => m.settings_provider_badge_cloud(), icon: 'grok',     tab: 'cloud', keyPlaceholder: "xai-..." },
  ];

  function getTabForUrl(url: string): ProviderTab {
    const match = PROVIDERS.find(p => p.url === url);
    if (match) return match.tab;
    return url.includes('127.0.0.1') || url.includes('localhost') ? 'local' : 'cloud';
  }

  let activeTab     = $state<ProviderTab>(getTabForUrl(appState.apiSettings.url));
  let availableModels = $state<string[]>([]);
  let modelsLoading   = $state(false);
  let modelsError     = $state("");

  const filteredProviders = $derived(PROVIDERS.filter(p => p.tab === activeTab));
  const activeProvider    = $derived(PROVIDERS.find(p => p.url === appState.apiSettings.url) ?? null);
  const keyPlaceholder    = $derived(activeProvider?.keyPlaceholder ?? "sk-...");

  function switchTab(tab: ProviderTab) {
    activeTab = tab;
    if (activeProvider?.tab !== tab) {
      const first = PROVIDERS.find(p => p.tab === tab);
      if (first) selectProvider(first.url);
    }
  }

  function selectProvider(url: string) {
    appState.apiSettings.url = url;
    appState.apiSettings.model = "";
    availableModels = [];
    modelsError = "";
  }

  async function loadModels() {
    modelsLoading = true;
    modelsError = "";
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
      <div class="provider-grid" class:provider-grid--3={activeTab === 'cloud'}>
        {#each filteredProviders as provider (provider.url)}
          <button
            onclick={() => selectProvider(provider.url)}
            class="provider-btn {activeProvider?.url === provider.url ? 'provider-btn--active' : ''}"
          >
            {#if provider.icon === 'desktop'}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="2" y="4" width="20" height="13" rx="2"/>
                <path d="M1 20h22" stroke-linecap="round"/>
                <circle cx="12" cy="17" r="0.8" fill="currentColor"/>
              </svg>

            {:else if provider.icon === 'cloud'}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>

            {:else if provider.icon === 'ollama'}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="none"
                  stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M8 8 L6 3 L9.5 6"/>
                <path d="M16 8 L18 3 L14.5 6"/>
                <path d="M7 10 C7 6.5 9 5 12 5 C15 5 17 6.5 17 10 C17 13.5 15.5 15 12 15 C8.5 15 7 13.5 7 10Z"/>
                <circle cx="10" cy="10" r="1" fill="currentColor" stroke="none"/>
                <circle cx="14" cy="10" r="1" fill="currentColor" stroke="none"/>
                <path d="M10.5 12.5 Q12 13.5 13.5 12.5"/>
                <path d="M10 15 L9.5 19 M14 15 L14.5 19"/>
                <path d="M9.5 19 Q12 20 14.5 19"/>
              </svg>

            {:else if provider.icon === 'terminal'}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M3 5h18v14H3z"/>
                <path d="M7 9l-2 3 2 3" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M17 9l2 3-2 3" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>

            {:else if provider.icon === 'kobold'}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                <path d="M12 3 L12 8"/>
                <path d="M9 5.5 L15 5.5"/>
                <path d="M8 8 L7 14 L5 16 L7 18 L9 16 L12 17 L15 16 L17 18 L19 16 L17 14 L16 8 Z"/>
                <circle cx="10" cy="11" r="1" fill="currentColor" stroke="none"/>
                <circle cx="14" cy="11" r="1" fill="currentColor" stroke="none"/>
                <path d="M10 13.5 Q12 14.5 14 13.5"/>
              </svg>

            {:else if provider.icon === 'openai'}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.04 14.11A4.501 4.501 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.778 2.758a4.5 4.5 0 0 1-.676 8.116v-5.678a.79.79 0 0 0-.395-.645zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.78-2.758a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
              </svg>

            {:else if provider.icon === 'grok'}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            {/if}

            <span class="provider-label">{provider.label}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if powerUser || activeProvider?.tab === 'cloud'}
      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-url">{m.settings_api_url_label()}</label>
        <input
          id="api-url"
          type="text"
          bind:value={appState.apiSettings.url}
          onchange={() => { availableModels = []; appState.apiSettings.model = ""; modelsError = ""; }}
          class="settings-input"
        />
      </div>

      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-key">
          {m.settings_api_key_label()}
          {#if activeProvider?.tab === 'local'}
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
        <div class="settings-input cursor-default {modelsError ? 'error-state' : 'empty-state'}">
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
  .provider-grid--3 {
    grid-template-columns: repeat(3, 1fr);
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
</style>