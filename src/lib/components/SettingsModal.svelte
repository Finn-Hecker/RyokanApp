<script lang="ts">
  import { onMount } from "svelte";
  import { fade, scale, slide } from "svelte/transition";

  import { apiSettings } from "$lib/stores/appState";
  import { getAllSettings, saveSetting } from "$lib/db/settings";
  import { getLocale, setLocale } from "$lib/paraglide/runtime";

  import LanguageSelect from "$lib/components/ui/LanguageSelect.svelte";
  import * as m from "$lib/paraglide/messages";

  export let isOpen: boolean;
  export let close: () => void;

  let showAdvanced = false;

  const uiLanguages = [
    { code: "de", label: "Deutsch" },
    { code: "en", label: "English" },
  ];

  const aiLanguages = [
    { code: "German", label: "Deutsch" },
    { code: "English", label: "English" },
  ];

  function handleUiLanguageChange(event: CustomEvent<string>) {
    setLocale(event.detail as any);
  }

  function handleAiLanguageChange(event: CustomEvent<string>) {
    $apiSettings.aiLanguage = event.detail;
  }

  const DEFAULT_AI_LANGUAGE = "English";

  const DEFAULT_PROMPT_TEMPLATE = `You are playing the role of {{char}}.
  
    Description:
    {{desc}}

    Personality:
    {{personality}}

    Scenario:
    {{scenario}}

    Example Dialog:
    {{mes_example}}

    CRITICAL RULES:
    1. Always answer in {{lang}}.
    2. You are the character, NOT an AI assistant.`;

  const SETTINGS_MAP: Record<string, (value: string) => void> = {
    api_url: (v) => ($apiSettings.url = v),
    api_key: (v) => ($apiSettings.apiKey = v),
    thinking_mode: (v) => ($apiSettings.isThinkingModel = v === "true"),
    ai_language: (v) => ($apiSettings.aiLanguage = v),
    system_prompt: (v) => ($apiSettings.systemPrompt = v),
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
        saveSetting("api_url", $apiSettings.url),
        saveSetting("api_key", $apiSettings.apiKey),
        saveSetting("thinking_mode", $apiSettings.isThinkingModel),
        saveSetting("ai_language", $apiSettings.aiLanguage),
        saveSetting("system_prompt", $apiSettings.systemPrompt),
      ]);

      console.info("[Settings] Saved successfully.");
      close();
    } catch (error) {
      console.error("[Settings] Failed to save settings:", error);
    }
  }

  function resetPrompt() {
    $apiSettings.systemPrompt = DEFAULT_PROMPT_TEMPLATE;
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
        <!-- Language Select -->
        <div>
          <label
            for="ui-language-select"
            class="text-sm text-gray-400 block mb-2"
            >{m.settings_language_label()}</label
          >
          <LanguageSelect
            id="ui-language-select"
            items={uiLanguages}
            selectedCode={getLocale()}
            on:select={handleUiLanguageChange}
          />
        </div>

        <!-- API URL -->
        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-url"
            >{m.settings_api_url_label()}</label
          >
          <input
            id="api-url"
            type="text"
            bind:value={$apiSettings.url}
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none"
          />
        </div>

        <!-- API Key -->
        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-key"
            >{m.settings_api_key_label()}</label
          >
          <input
            id="api-key"
            type="password"
            bind:value={$apiSettings.apiKey}
            placeholder="sk-or-..."
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none"
          />
        </div>

        <!-- Thinking Model Toggle -->
        <div class="pt-2 border-t border-white/5">
          <label class="flex items-center justify-between cursor-pointer group">
            <span class="flex flex-col">
              <span class="text-sm text-gray-200"
                >{m.settings_thinking_label()}</span
              >
              <span class="text-xs text-gray-500"
                >{m.settings_thinking_sub()}</span
              >
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

      <!-- AI Language Selection -->
      <div class="pt-4 border-t border-white/5">
        <label for="ai-language-select" class="text-sm text-gray-400 block mb-2"
          >{m.settings_ai_lang_label()}</label
        >
        <LanguageSelect
          id="ai-language-select"
          items={aiLanguages}
          selectedCode={$apiSettings.aiLanguage}
          on:select={handleAiLanguageChange}
        />
      </div>

      <!-- Advanced Settings -->
      <div class="pt-4 mt-4 border-t border-white/5">
        <button
          on:click={() => (showAdvanced = !showAdvanced)}
          class="flex items-center text-xs text-ryokan-accent hover:underline focus:outline-none"
        >
          {showAdvanced
            ? m.settings_advanced_hide()
            : m.settings_advanced_show()}
        </button>
      </div>

      <!-- Save Button -->
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
