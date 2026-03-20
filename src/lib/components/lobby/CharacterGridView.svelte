<script lang="ts">
  import { characterState } from '$lib/stores/characterStore.svelte';
  import * as m from '$lib/paraglide/messages';
  import CharacterContextMenu from './CharacterContextMenu.svelte';

  let {
    characters,
    showHidden,
    onSelect,
    onEdit,
    onDelete,
    onToggleHide,
    onTogglePin,
    resolveDesc
  }: {
    characters: any[];
    showHidden: boolean;
    onSelect: (char: any) => void;
    onEdit: (e: MouseEvent, char: any) => void;
    onDelete: (e: MouseEvent, char: any) => void;
    onToggleHide: (e: MouseEvent, char: any) => void;
    onTogglePin: (e: MouseEvent, char: any) => void;
    resolveDesc: (char: any) => string;
  } = $props();
</script>

<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:1rem;">
  {#each characters as char (char.id)}
    {@const isHidden = characterState.hiddenCharacterIds.has(String(char.id))}
    {@const isPinned = characterState.pinnedCharacterIds.has(String(char.id))}

    <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-2xl transition-all duration-200 active:scale-[0.98] {showHidden && isHidden ? 'opacity-40' : ''}">
      <button onclick={() => onSelect(char)} aria-label={m.lobby_aria_start_chat()} class="absolute inset-0 z-0 w-full h-full cursor-pointer rounded-2xl"></button>

      <div class="relative z-10 w-full aspect-[3/4] bg-white/5 overflow-hidden rounded-t-2xl pointer-events-none">
        {#if char.avatarUrl}
          <img src={char.avatarUrl} alt={char.name} class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
        {:else}
          <div class="w-full h-full {char.color} flex items-center justify-center text-white font-bold text-4xl opacity-80">{char.initials}</div>
        {/if}

        {#if isPinned}
          <div class="absolute top-2.5 left-2.5 z-20 pointer-events-none">
            <div class="w-5 h-5 flex items-center justify-center rounded-full bg-ryokan-accent/80 backdrop-blur-sm">
              <svg width="9" height="9" viewBox="0 0 24 24" fill="white">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
          </div>
        {/if}
      </div>

      <div class="absolute top-2.5 right-2.5 z-20 pointer-events-auto transition-all duration-200 opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0">
        <CharacterContextMenu
          {char} {isHidden} {isPinned}
          size="lg"
          {onEdit} {onTogglePin} {onToggleHide} {onDelete}
        />
      </div>

      <div class="relative z-10 px-4 py-3 pointer-events-none">
        <h3 class="text-sm font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
        <p class="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-snug">{resolveDesc(char)}</p>
      </div>
    </div>
  {/each}
</div>