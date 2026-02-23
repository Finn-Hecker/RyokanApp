<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { createEventDispatcher } from 'svelte';

  export let canRetry: boolean = false;
  export let canEdit: boolean = false;

  const dispatch = createEventDispatcher<{ retry: void; edit: void }>();

  let menuOpen = false;

  function handleRetry() { menuOpen = false; dispatch('retry'); }
  function handleEdit()  { menuOpen = false; dispatch('edit');  }
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="relative">
  <button
    on:click|stopPropagation={() => (menuOpen = !menuOpen)}
    class="w-6 h-6 flex flex-col items-center justify-center gap-[3px] rounded-md
      text-gray-500 hover:text-gray-300 hover:bg-white/8 transition-all
      {menuOpen ? 'bg-white/8 text-gray-300' : ''}"
    aria-label="Message options"
  >
    <span class="w-[3px] h-[3px] rounded-full bg-current"></span>
    <span class="w-[3px] h-[3px] rounded-full bg-current"></span>
    <span class="w-[3px] h-[3px] rounded-full bg-current"></span>
  </button>

  {#if menuOpen}
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div class="fixed inset-0 z-40" on:click={() => (menuOpen = false)}></div>

    <div class="absolute bottom-full mb-1.5 left-0 z-50
      bg-ryokan-surface border border-white/[0.08] rounded-xl shadow-2xl overflow-hidden
      min-w-[130px] animate-menu-in"
    >
      {#if canRetry}
        <button
          on:click={handleRetry}
          class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-300
            hover:bg-white/8 hover:text-white transition-colors text-left"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-ryokan-accent">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
            <path d="M3 3v5h5"/>
          </svg>
          {m.chat_retry()}
        </button>
      {/if}

      {#if canRetry && canEdit}
        <div class="h-px bg-white/[0.05] mx-2"></div>
      {/if}

      {#if canEdit}
        <button
          on:click={handleEdit}
          class="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-sm text-gray-300
            hover:bg-white/8 hover:text-white transition-colors text-left"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0 text-gray-400">
            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
          </svg>
          {m.chat_edit()}
        </button>
      {/if}
    </div>
  {/if}
</div>

<style>
  @keyframes menuIn {
    from { opacity: 0; transform: translateY(4px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }
  .animate-menu-in {
    animation: menuIn 0.12s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  }
</style>