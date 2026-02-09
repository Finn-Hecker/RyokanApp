<script lang="ts">
  import { apiSettings } from '$lib/stores/appState';
  import { fade, scale } from 'svelte/transition';
  import LanguageSelect from '$lib/components/ui/LanguageSelect.svelte';
  import * as m from '$lib/paraglide/messages';

  export let isOpen: boolean;
  export let close: () => void;
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
          <label for="language-select" class="text-sm text-gray-400 block mb-2">{m.settings_language_label()}</label>
          <LanguageSelect />
        </div>

        <!-- API URL -->
        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-url">{m.settings_api_url_label()}</label>
          <input 
            id="api-url"
            type="text" 
            bind:value={$apiSettings.url} 
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none" 
          />
        </div>

        <!-- API Key -->
        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-key">{m.settings_api_key_label()}</label>
          <input 
            id="api-key"
            type="password" 
            bind:value={$apiSettings.apiKey} 
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none" 
          />
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
            <div class="relative w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ryokan-accent"></div>
          </label>
        </div>
      </div>

      <!-- Save Button -->
      <div class="mt-8 flex justify-end">
        <button 
          on:click={close}
          class="bg-ryokan-accent text-ryokan-bg px-4 py-2 rounded-lg font-medium hover:opacity-90 transition" 
        >
          {m.settings_btn_save()}
        </button>
      </div>
    </div>
  </div>
{/if}