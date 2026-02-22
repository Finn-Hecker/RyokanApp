<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  export let message: string = '';
  export let pendingMessage: string = '';

  const dispatch = createEventDispatcher<{ retry: void; close: void }>();
</script>

<div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
  <div class="bg-ryokan-surface rounded-2xl shadow-2xl border border-red-500/20 max-w-md w-full p-6 animate-scale-in">
    <div class="flex items-start mb-4">
      <div class="flex-shrink-0 w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center mr-3">
        <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <div class="flex-1">
        <h3 class="text-lg font-semibold text-gray-100 mb-1">{m.chat_error_title()}</h3>
        <p class="text-sm text-gray-400">{message}</p>
      </div>
    </div>

    {#if pendingMessage}
      <div class="mb-4 p-3 bg-white/5 rounded-lg border border-white/10">
        <p class="text-xs text-gray-500 mb-1 uppercase tracking-wide">{m.chat_error_your_message()}</p>
        <p class="text-sm text-gray-300 line-clamp-3">{pendingMessage}</p>
      </div>
    {/if}

    <div class="flex gap-3">
      <button
        on:click={() => dispatch('retry')}
        class="flex-1 bg-ryokan-accent text-ryokan-bg px-4 py-2.5 rounded-xl font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2"
      >
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
        </svg>
        {m.chat_error_retry()}
      </button>
      <button
        on:click={() => dispatch('close')}
        class="px-4 py-2.5 rounded-xl font-medium text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all"
      >
        {m.chat_error_cancel()}
      </button>
    </div>
  </div>
</div>