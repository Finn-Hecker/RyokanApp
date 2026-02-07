<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import { conversations, openHistoryChat, loadAllConversations } from '$lib/stores/chatStore';
  import { currentView } from '$lib/stores/appState';
  import { onMount } from 'svelte';

  export let isOpen: boolean;
  export let close: () => void;

  $: if (isOpen) {
    loadAllConversations();
  }

  async function loadChat(id: string) {
    await openHistoryChat(id);
    currentView.set('chat');
    close();
  }
</script>

{#if isOpen}
  <button
    type="button"
    transition:fade={{ duration: 200 }}
    aria-label="Sidebar schließen"
    on:click={close}
    class="fixed inset-0 w-full h-full bg-black/60 z-40 backdrop-blur-sm cursor-pointer border-none"
  ></button>

  <aside 
    transition:fly={{ x: -300, duration: 300 }}
    class="fixed left-0 top-0 bottom-0 w-72 bg-ryokan-surface border-r border-white/5 shadow-2xl z-50 flex flex-col"
  >
    <div class="p-6 border-b border-white/5 flex justify-between items-center">
      <h2 class="text-lg font-medium text-ryokan-accent">Deine Reisen</h2>
      <button on:click={close} class="text-gray-500 hover:text-white">✕</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-2">
      {#if $conversations.length === 0}
        <p class="text-gray-600 text-sm text-center mt-10">Noch keine Gespräche.</p>
      {/if}

      {#each $conversations as chat}
        <button 
          on:click={() => loadChat(chat.id)}
          class="w-full text-left p-3 rounded-lg hover:bg-white/5 group transition-all border border-transparent hover:border-white/5"
        >
          <div class="text-gray-200 text-sm font-medium group-hover:text-ryokan-accent truncate">
            {chat.title}
          </div>
          <div class="text-gray-600 text-xs mt-1">
            {new Date(chat.created_at).toLocaleString()}
          </div>
        </button>
      {/each}
    </div>
  </aside>
{/if}