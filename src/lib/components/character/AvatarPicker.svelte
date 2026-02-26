<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  export let avatarPreview: string | null = null;

  const dispatch = createEventDispatcher<{
    fileSelected: File;
  }>();

  let avatarInput: HTMLInputElement;

  function onFileChange(e: Event) {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) dispatch('fileSelected', file);
  }

  export function triggerClick() {
    avatarInput.click();
  }
</script>

<input
  type="file"
  bind:this={avatarInput}
  on:change={onFileChange}
  accept="image/*"
  hidden
/>

<div class="flex flex-col items-center gap-4 py-4">
  <button
    on:click={triggerClick}
    aria-label={m.create_page_aria_avatar()}
    class="relative w-32 h-32 md:w-40 md:h-40 rounded-full bg-white/5 border border-white/10 overflow-hidden group hover:border-ryokan-accent transition-all active:scale-95 shadow-2xl"
  >
    {#if avatarPreview}
      <img src={avatarPreview} alt={m.create_page_alt_avatar()} class="w-full h-full object-cover" />
    {:else}
      <div class="w-full h-full flex items-center justify-center text-gray-600 group-hover:text-gray-400">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/>
          <circle cx="12" cy="7" r="4"/>
        </svg>
      </div>
    {/if}

    <div class="absolute bottom-0 inset-x-0 h-8 bg-black/60 flex items-center justify-center">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2">
        <path d="M12 5v14M5 12h14"/>
      </svg>
    </div>
  </button>

  <p class="text-xs text-gray-500">{m.create_page_avatar_hint()}</p>
</div>