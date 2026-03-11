<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { fetchModels, saveSetting } from "$lib/utils/settings";
  import * as m from "$lib/paraglide/messages";
  import Button from '$lib/components/ui/Button.svelte';

  export let powerUser: boolean = false;

  type Provider = {
    label: string;
    url: string;
    badge: () => string;
    icon: 'desktop' | 'cloud' | 'terminal';
  };

  const PROVIDERS: Provider[] = [
    { label: "LM Studio",  url: "http://127.0.0.1:1234/v1",    badge: () => m.settings_provider_badge_local(), icon: 'desktop' },
    { label: "llama.cpp",  url: "http://127.0.0.1:8080/v1",    badge: () => m.settings_provider_badge_local(), icon: 'terminal' },
    { label: "Ollama",     url: "http://127.0.0.1:11434/v1",   badge: () => m.settings_provider_badge_local(), icon: 'terminal' },
    { label: "OpenRouter", url: "https://openrouter.ai/api/v1", badge: () => m.settings_provider_badge_cloud(), icon: 'cloud' },
  ];

  let availableModels: string[] = [];
  let modelsLoading = false;
  let modelsError = "";

  $: activeProvider = PROVIDERS.find(p => p.url === appState.apiSettings.url) ?? null;

  export function selectProvider(url: string) {
    appState.apiSettings.url = url;
    appState.apiSettings.model = "";
    availableModels = [];
    modelsError = "";
  }

  export async function loadModels() {
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

    <div>
      <span class="settings-label">{m.settings_provider_label()}</span>
      <div class="grid grid-cols-4 gap-2">
        {#each PROVIDERS as provider}
          <button
            on:click={() => selectProvider(provider.url)}
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
            {:else}
              <svg class="provider-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M3 5h18v14H3z" />
                <path d="M7 9l-2 3 2 3" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M17 9l2 3-2 3" stroke-linecap="round" stroke-linejoin="round" />
              </svg>
            {/if}
            <span class="provider-label">{provider.label}</span>
            <span class="provider-hint">{provider.badge()}</span>
          </button>
        {/each}
      </div>
    </div>

    {#if powerUser || activeProvider?.icon === 'cloud'}
      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-url">{m.settings_api_url_label()}</label>
        <input
          id="api-url"
          type="text"
          bind:value={appState.apiSettings.url}
          on:change={() => { availableModels = []; appState.apiSettings.model = ""; modelsError = ""; }}
          class="settings-input"
        />
      </div>

      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-key">
          {m.settings_api_key_label()}
          <span class="optional-badge">{m.settings_api_key_optional()}</span>
        </label>
        <input
          id="api-key"
          type="password"
          bind:value={appState.apiSettings.apiKey}
          placeholder="sk-or-..."
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
        <select id="model-select" bind:value={appState.apiSettings.model} class="settings-input select-chevron" on:change={() => saveSetting("api_model", appState.apiSettings.model)}>
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
  .provider-hint {
    font-size: 9px;
    opacity: 0.5;
    text-align: center;
    line-height: 1.3;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .provider-btn--active .provider-hint { opacity: 0.65; }

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