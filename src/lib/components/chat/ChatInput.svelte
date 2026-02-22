<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  export let isGenerating: boolean = false;
  export let value: string = '';

  const dispatch = createEventDispatcher<{ send: void; stop: void }>();

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      dispatch('send');
    }
  }
</script>

<div class="p-4 sm:p-6 shrink-0">
  <div class="max-w-3xl mx-auto bg-ryokan-surface rounded-3xl flex items-end p-2 shadow-xl border border-white/5 focus-within:border-ryokan-accent/50 transition-colors">
    <textarea
      bind:value
      on:keydown={handleKeydown}
      placeholder={m.chat_placeholder()}
      rows="1"
      class="bg-transparent flex-1 min-w-0 text-gray-200 px-4 py-3 outline-none placeholder-gray-600 resize-none max-h-32 text-sm"
    ></textarea>

    <button
      on:click={() => dispatch(isGenerating ? 'stop' : 'send')}
      class="shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all relative group
        {isGenerating
          ? 'bg-white/5 text-ryokan-accent/70 hover:bg-white/8 hover:text-ryokan-accent'
          : 'bg-ryokan-accent text-ryokan-bg hover:opacity-90'}"
    >
      {#if isGenerating}
        <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-ryokan-surface border border-white/10 rounded-lg text-xs text-ryokan-text whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none shadow-lg">
          {m.chat_stop_generating()}
        </div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
          <rect x="4" y="5" width="13" height="14" rx="2.5" ry="3"></rect>
        </svg>
      {:else}
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      {/if}
    </button>
  </div>
</div>