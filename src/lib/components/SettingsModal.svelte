<script lang="ts">
  import { apiSettings } from '$lib/stores/appState';
  import { fade, scale } from 'svelte/transition';

  export let isOpen: boolean;
  export let close: () => void;
</script>

{#if isOpen}
  <div class="fixed inset-0 z-[60] flex items-center justify-center p-4">
    <button 
      on:click={close}
      transition:fade 
      aria-label="Einstellungen öffnen"
      class="absolute inset-0 bg-black/80 backdrop-blur-sm cursor-default"
    ></button>

    <div 
      transition:scale={{ start: 0.95, duration: 200 }}
      class="relative bg-ryokan-surface w-full max-w-md rounded-2xl border border-white/10 shadow-2xl p-6"
    >
      <h2 class="text-xl font-medium text-white mb-6">Einstellungen</h2>

      <div class="space-y-4">
        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-url">API Endpoint</label>
          <input 
            id="api-url"
            type="text" 
            bind:value={$apiSettings.url} 
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none"
          />
        </div>

        <div>
          <label class="text-sm text-gray-400 block mb-2" for="api-key">API Key (Optional)</label>
          <input 
            id="api-key"
            type="password" 
            bind:value={$apiSettings.apiKey} 
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent outline-none"
          />
        </div>

        <div class="pt-2 border-t border-white/5">
          <label class="flex items-center justify-between cursor-pointer group">
            <span class="flex flex-col">
              <span class="text-sm text-gray-200">Thinking Model Unterstützung</span>
              <span class="text-xs text-gray-500">Versteckt &lt;think&gt; Tags</span>
            </span>
            
            <input 
              type="checkbox" 
              bind:checked={$apiSettings.isThinkingModel} 
              class="sr-only peer"
            >
            <div class="relative w-11 h-6 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full rtl:peer-checked:after:-translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:start-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-ryokan-accent"></div>
          </label>
        </div>
      </div>

      <div class="mt-8 flex justify-end">
        <button 
          on:click={close}
          class="bg-ryokan-accent text-ryokan-bg px-4 py-2 rounded-lg font-medium hover:opacity-90 transition"
        >
          Speichern & Schließen
        </button>
      </div>
    </div>
  </div>
{/if}