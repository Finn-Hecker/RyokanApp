<script lang="ts">
  import { onMount } from "svelte";
  import { fade, scale } from "svelte/transition";

  import { apiSettings } from "$lib/stores/appState";
  import { getAllSettings, saveSetting, fetchModels } from "$lib/db/settings";
  import { getLocale, setLocale } from "$lib/paraglide/runtime";

  import LanguageSelect from "$lib/components/ui/LanguageSelect.svelte";
  import * as m from "$lib/paraglide/messages";

  export let isOpen: boolean;
  export let close: () => void;

  const PROVIDERS = [
    { label: "LM Studio",   url: "http://127.0.0.1:1234/v1" },
    { label: "OpenRouter",  url: "https://openrouter.ai/api/v1" },
  ];

  const uiLanguages = [
    { code: "de", label: "Deutsch" },
    { code: "en", label: "English" },
  ];

  const aiLanguages = [
    { code: "German",  label: "Deutsch" },
    { code: "English", label: "English" },
  ];

  // Model fetching state
  let availableModels: string[] = [];
  let modelsLoading = false;
  let modelsError = "";

  // Derive which provider button (if any) matches the current URL
  $: activeProvider = PROVIDERS.find(p => p.url === $apiSettings.url) ?? null;

  function selectProvider(url: string) {
    $apiSettings.url = url;
    // Clear model selection when switching providers since IDs differ
    $apiSettings.model = "";
    availableModels = [];
    modelsError = "";
  }

  async function loadModels() {
    modelsLoading = true;
    modelsError = "";
    availableModels = [];

    try {
      const models = await fetchModels($apiSettings.url, $apiSettings.apiKey);
      if (models.length === 0) {
        modelsError = m.settings_model_error_no_models();
      } else {
        availableModels = models;
        if (!availableModels.includes($apiSettings.model)) {
          $apiSettings.model = availableModels[0];
        }
      }
    } catch (e: any) {
      modelsError = m.settings_model_error_fetch({ error: e.message || String(e) });
    }

    modelsLoading = false;
  }

  function handleUiLanguageChange(event: CustomEvent<string>) {
    setLocale(event.detail as any);
  }

  function handleAiLanguageChange(event: CustomEvent<string>) {
    $apiSettings.aiLanguage = event.detail;
  }

  const DEFAULT_AI_LANGUAGE = "English";

  const SETTINGS_MAP: Record<string, (value: string) => void> = {
    api_url:      (v) => ($apiSettings.url = v),
    api_key:      (v) => ($apiSettings.apiKey = v),
    api_model:    (v) => ($apiSettings.model = v),
    thinking_mode:(v) => ($apiSettings.isThinkingModel = v === "true"),
    ai_language:  (v) => ($apiSettings.aiLanguage = v),
    system_prompt:(v) => ($apiSettings.systemPrompt = v),
  };

  onMount(loadSettings);

  async function loadSettings() {
    try {
      const settings = await getAllSettings();
      for (const row of settings) {
        SETTINGS_MAP[row.key]?.(row.value);
      }
      if (!$apiSettings.aiLanguage) {
        $apiSettings.aiLanguage = DEFAULT_AI_LANGUAGE;
      }
    } catch (error) {
      console.error("[Settings] Failed to load settings:", error);
    }
  }

  async function saveAndClose() {
    try {
      await Promise.all([
        saveSetting("api_url",       $apiSettings.url),
        saveSetting("api_key",       $apiSettings.apiKey),
        saveSetting("api_model",     $apiSettings.model),
        saveSetting("thinking_mode", $apiSettings.isThinkingModel),
        saveSetting("ai_language",   $apiSettings.aiLanguage),
        saveSetting("system_prompt", $apiSettings.systemPrompt),
      ]);
      console.info("[Settings] Saved successfully.");
      close();
    } catch (error) {
      console.error("[Settings] Failed to save settings:", error);
    }
  }
</script>

{#if isOpen}
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
    <!-- Overlay -->
    <button
      on:click={close}
      transition:fade
      aria-label={m.settings_btn_save()}
      class="absolute inset-0 bg-black/80 backdrop-blur-sm cursor-default"
    ></button>

    <!-- Modal -->
    <div
      transition:scale={{ start: 0.95, duration: 200 }}
      class="relative bg-ryokan-surface w-full max-w-md rounded-2xl border border-white/10 shadow-2xl p-6"
    >
      <h2 class="text-xl font-medium text-white mb-6">{m.settings_title()}</h2>

      <div class="space-y-4">

        <!-- UI Language -->
        <div>
          <label for="ui-language-select" class="text-sm text-gray-400 block mb-2">
            {m.settings_language_label()}
          </label>
          <LanguageSelect
            id="ui-language-select"
            items={uiLanguages}
            selectedCode={getLocale()}
            on:select={handleUiLanguageChange}
          />
        </div>

        <!-- Provider Buttons -->
        <div>
          <span class="text-sm text-gray-400 block mb-2">{m.settings_provider_label()}</span>
          <div class="flex gap-2">
            {#each PROVIDERS as provider}
              <button
                on:click={() => selectProvider(provider.url)}
                class="flex-1 py-2 px-3 rounded-lg text-sm font-medium border transition-all
                  {activeProvider?.url === provider.url
                    ? 'bg-ryokan-accent text-ryokan-bg border-ryokan-accent'
                    : 'bg-black/20 text-gray-300 border-white/10 hover:border-white/30'}"
              >
                {provider.label}
              </button>
            {/each}
          </div>
        </div>

        <!-- API URL (always editable for custom servers) -->
        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-url">
            {m.settings_api_url_label()}
          </label>
          <input
            id="api-url"
            type="text"
            bind:value={$apiSettings.url}
            on:change={() => { availableModels = []; $apiSettings.model = ""; modelsError = ""; }}
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none"
          />
        </div>

        <!-- API Key -->
        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-key">
            {m.settings_api_key_label()}
          </label>
          <input
            id="api-key"
            type="password"
            bind:value={$apiSettings.apiKey}
            placeholder="sk-or-..."
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none"
          />
        </div>

        <!-- Model Selection -->
        <div>
          <div class="flex items-center justify-between mb-2">
            <label class="text-sm text-gray-400" for="model-select">{m.settings_model_label()}</label>
            <button
              on:click={loadModels}
              disabled={modelsLoading}
              class="text-xs text-ryokan-accent hover:opacity-80 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {modelsLoading ? m.settings_model_loading() : m.settings_model_load_btn()}
            </button>
          </div>

          {#if availableModels.length > 0}
            <select
              id="model-select"
              bind:value={$apiSettings.model}
              class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none appearance-none"
            >
              {#each availableModels as modelId}
                <option value={modelId}>{modelId}</option>
              {/each}
            </select>
          {:else}
            <div
              class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm
                {modelsError ? 'text-red-400' : 'text-gray-500'}"
            >
              {#if modelsError}
                {modelsError}
              {:else if $apiSettings.model}
                {$apiSettings.model}
              {:else}
                {m.settings_model_empty_hint()}
              {/if}
            </div>
          {/if}
        </div>

        <!-- Thinking Model Toggle -->
        <div class="pt-2 border-t border-white/5">
          <label class="flex items-center justify-between cursor-pointer group">
            <span class="flex flex-col">
              <span class="text-sm text-gray-200">{m.settings_thinking_label()}</span>
              <span class="text-xs text-gray-500">{m.settings_thinking_sub()}</span>
            </span>
            <input
              type="checkbox"
              bind:checked={$apiSettings.isThinkingModel}
              class="sr-only peer"
            />
            <div
              class="relative w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ryokan-accent"
            ></div>
          </label>
        </div>

      </div>

      <!-- AI Language -->
      <div class="pt-4 border-t border-white/5">
        <label for="ai-language-select" class="text-sm text-gray-400 block mb-2">
          {m.settings_ai_lang_label()}
        </label>
        <LanguageSelect
          id="ai-language-select"
          items={aiLanguages}
          selectedCode={$apiSettings.aiLanguage}
          on:select={handleAiLanguageChange}
        />
      </div>

      <!-- Save -->
      <div class="mt-8 flex justify-end">
        <button
          on:click={saveAndClose}
          class="bg-ryokan-accent text-ryokan-bg px-4 py-2 rounded-lg font-medium hover:opacity-90 transition"
        >
          {m.settings_btn_save()}
        </button>
      </div>
    </div>
  </div>
{/if}