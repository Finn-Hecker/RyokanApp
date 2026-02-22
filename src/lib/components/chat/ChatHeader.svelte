<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  // Loose type so it's compatible with however activeCharacter is typed in appState
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export let character: any = null;

  const dispatch = createEventDispatcher<{ back: void }>();
</script>

<div class="flex items-center gap-4 px-5 py-4 shrink-0 border-b border-white/[0.06] bg-ryokan-bg/80 backdrop-blur-md z-10">
  <button
    on:click={() => dispatch('back')}
    class="w-9 h-9 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-white/8 transition-all shrink-0"
    aria-label={m.chat_aria_back()}
  >
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  </button>

  <div class="shrink-0 w-10 h-10 rounded-full overflow-hidden ring-2 ring-white/10">
    {#if character?.avatarUrl}
      <img src={character.avatarUrl} alt={character.name} class="w-full h-full object-cover" />
    {:else}
      <div class="w-full h-full {character?.color ?? 'bg-ryokan-surface'} flex items-center justify-center text-white font-bold text-base">
        {character?.initials ?? (character?.name?.[0]?.toUpperCase() ?? '?')}
      </div>
    {/if}
  </div>

  <div class="flex-1 min-w-0">
    <h2 class="text-sm font-semibold text-gray-100 truncate leading-tight">{character?.name}</h2>
    <p class="text-xs text-ryokan-accent opacity-80 leading-tight mt-0.5">{m.chat_status_online()}</p>
  </div>
</div>