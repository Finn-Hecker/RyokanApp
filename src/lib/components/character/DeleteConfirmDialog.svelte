<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { createEventDispatcher } from 'svelte';
  import { fade } from 'svelte/transition';
  import Button from '$lib/components/ui/Button.svelte';

  export let characterName: string = '';
  export let isDeleting: boolean = false;

  const dispatch = createEventDispatcher<{
    confirm: void;
    cancel: void;
  }>();
</script>

<div
  class="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
  transition:fade
>
  <div class="bg-[#1a1a1a] border border-white/10 rounded-2xl p-6 mx-4 max-w-sm w-full shadow-2xl">
    <h3 class="text-white font-semibold text-lg mb-2">{m.delete_confirm_title({ name: characterName })}</h3>
    <p class="text-gray-400 text-sm mb-6">{m.delete_confirm_desc()}</p>
    <div class="flex gap-3">
      <Button variant="ghost" on:click={() => dispatch('cancel')}>
        {m.delete_confirm_cancel()}
      </Button>
      <button
        on:click={() => dispatch('confirm')}
        disabled={isDeleting}
        class="flex-1 h-10 px-4 rounded-xl bg-red-600 hover:bg-red-500 text-white text-sm font-medium transition-colors disabled:opacity-50"
      >
        {isDeleting ? '...' : m.delete_confirm_delete()}
      </button>
    </div>
  </div>
</div>