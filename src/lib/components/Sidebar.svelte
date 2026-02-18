<script lang="ts">
  import { fade, fly, scale } from 'svelte/transition';
  import { conversations, openHistoryChat, loadAllConversations, deleteConversation } from '$lib/stores/chatStore';
  import { currentView } from '$lib/stores/appState';
  
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';

  export let isOpen: boolean;
  export let close: () => void;

  let chatToDelete: string | null = null;

  $: if (isOpen) {
    loadAllConversations();
  }

  async function loadChat(id: string) {
    await openHistoryChat(id);
    currentView.set('chat');
    close();
  }

  function promptDelete(id: string, event: Event) {
    event.stopPropagation();
    chatToDelete = id;
  }

  async function confirmDelete() {
    if (chatToDelete) {
      await deleteConversation(chatToDelete);
      chatToDelete = null;
    }
  }

  function cancelDelete() {
    chatToDelete = null;
  }
</script>

{#if isOpen}
  <button
    type="button"
    transition:fade={{ duration: 200 }}
    aria-label={m.history_close_label()} 
    on:click={close}
    class="fixed inset-0 w-full h-full bg-black/60 z-40 backdrop-blur-sm cursor-pointer border-none"
  ></button>

  <aside 
    transition:fly={{ x: -300, duration: 300 }}
    class="fixed left-0 top-0 bottom-0 w-72 bg-ryokan-surface border-r border-white/5 shadow-2xl z-50 flex flex-col"
  >
    <div class="p-6 border-b border-white/5 flex justify-between items-center">
      <h2 class="text-lg font-medium text-ryokan-accent">{m.history_title()}</h2>
      <button 
        on:click={close} 
        aria-label={m.history_close_label()}
        class="text-gray-500 hover:text-white"
      >✕</button>
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-2">
      {#if $conversations.length === 0}
        <p class="text-gray-600 text-sm text-center mt-10">{m.history_no_chats()}</p>
      {/if}

      {#each $conversations as chat}
        <div 
          role="button"
          tabindex="0"
          on:click={() => loadChat(chat.id)}
          on:keydown={(e) => e.key === 'Enter' && loadChat(chat.id)}
          class="relative w-full text-left p-3 rounded-lg hover:bg-white/5 group transition-all border border-transparent hover:border-white/5 cursor-pointer"
        >
          <div class="pr-8"> 
            <div class="text-gray-200 text-sm font-medium group-hover:text-ryokan-accent truncate">
              {chat.title}
            </div>
            
            <div class="flex justify-between items-center mt-1">
              <div class="text-gray-600 text-[10px]">
                {new Date(chat.created_at).toLocaleString(getLocale())}
              </div>
            </div>
          </div>

          <button
            on:click={(e) => promptDelete(chat.id, e)}
            class="absolute right-2 top-1/2 -translate-y-1/2 p-2 text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all hover:bg-white/10 rounded-md"
            aria-label={m.history_delete_label()}
            title={m.modal_btn_confirm()}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M3 6h18"></path>
              <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path>
              <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path>
            </svg>
          </button>
        </div>
      {/each}
    </div>
  </aside>

  {#if chatToDelete}
    <div 
      class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
      transition:fade={{ duration: 150 }}
      role="dialog"
      aria-modal="true"
    >
      <div 
        class="bg-ryokan-surface border border-white/10 p-6 rounded-xl shadow-2xl max-w-sm w-full"
        transition:scale={{ duration: 200, start: 0.95 }}
      >
        <h3 class="text-lg font-semibold text-white mb-2">{m.modal_delete_title()}</h3>
        <p class="text-gray-400 text-sm mb-6 leading-relaxed">
          {m.modal_delete_body()}
        </p>
        
        <div class="flex justify-end space-x-3">
          <button 
            on:click={cancelDelete}
            class="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
          >
            {m.modal_btn_cancel()}
          </button>
          
          <button 
            on:click={confirmDelete}
            class="px-4 py-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20 rounded-lg transition-colors font-medium"
          >
            {m.modal_btn_confirm()}
          </button>
        </div>
      </div>
    </div>
  {/if}
{/if}