<script lang="ts">
  import { apiSettings } from '$lib/stores/appState';
  import { fade, fly } from 'svelte/transition';

  export let isOpen: boolean;
  export let close: () => void;
</script>

{#if isOpen}
  <button
    type="button"
    transition:fade={{ duration: 200 }}
    on:click={close}
    on:keydown={(e) => e.key === 'Escape' && close()}
    class="fixed inset-0 w-full h-full bg-black/60 z-40 backdrop-blur-sm cursor-default border-none p-0 m-0"
    aria-label="Menü schließen"
  ></button>

  <aside 
    transition:fly={{ x: -300, duration: 300, opacity: 1 }}
    class="fixed left-0 top-0 bottom-0 w-72 bg-ryokan-surface border-r border-white/5 shadow-2xl z-50 flex flex-col p-6"
  >
    <div class="flex items-center justify-between mb-8">
      <h2 class="text-xl font-medium tracking-wide text-ryokan-accent">Einstellungen</h2>
      <button on:click={close} class="text-gray-500 hover:text-white transition p-2">
        ✕
      </button>
    </div>

    <div class="space-y-8 flex-1 overflow-y-auto">
      
      <div class="space-y-4">
        <h3 class="text-xs font-bold text-gray-500 uppercase tracking-widest mb-2">Verbindung</h3>
        
        <div class="space-y-2">
          <label class="text-sm text-gray-400 block" for="api-url">API Endpoint</label>
          <input 
            id="api-url"
            type="text" 
            bind:value={$apiSettings.url} 
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent focus:ring-1 focus:ring-ryokan-accent outline-none transition-all"
            placeholder="http://localhost:5001/v1"
          />
        </div>

        <div class="space-y-2">
          <label class="text-sm text-gray-400 block" for="api-key">API Key (Optional)</label>
          <input 
            id="api-key"
            type="password" 
            bind:value={$apiSettings.apiKey} 
            class="w-full bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-200 focus:border-ryokan-accent focus:ring-1 focus:ring-ryokan-accent outline-none transition-all"
            placeholder="sk-..."
          />
        </div>
      </div>

    </div>

    <div class="pt-6 border-t border-white/5 text-center">
      <p class="text-xs text-gray-600">Ryokan.io Client v0.2</p>
    </div>

  </aside>
{/if}