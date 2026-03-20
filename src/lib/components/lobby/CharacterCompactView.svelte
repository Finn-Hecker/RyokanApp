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
    onTogglePin
  }: {
    characters: any[];
    showHidden: boolean;
    onSelect: (char: any) => void;
    onEdit: (e: MouseEvent, char: any) => void;
    onDelete: (e: MouseEvent, char: any) => void;
    onToggleHide: (e: MouseEvent, char: any) => void;
    onTogglePin: (e: MouseEvent, char: any) => void;
  } = $props();
</script>

<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(150px, 1fr)); gap:0.75rem;">
  {#each characters as char (char.id)}
    {@const isHidden = characterState.hiddenCharacterIds.has(String(char.id))}
    {@const isPinned = characterState.pinnedCharacterIds.has(String(char.id))}

    <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-xl transition-all duration-200 active:scale-[0.98] {showHidden && isHidden ? 'opacity-40' : ''}">
      <button onclick={() => onSelect(char)} aria-label={m.lobby_aria_start_chat()} class="absolute inset-0 z-0 w-full h-full cursor-pointer rounded-xl"></button>

      <div class="relative z-10 w-full aspect-square bg-white/5 overflow-hidden rounded-t-xl pointer-events-none">
        {#if char.avatarUrl}
          <img src={char.avatarUrl} alt={char.name} class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent"></div>
        {:else}
          <div class="w-full h-full {char.color} flex items-center justify-center text-white font-bold text-2xl opacity-80">{char.initials}</div>
        {/if}

        {#if isPinned}
          <div class="absolute top-1.5 left-1.5 z-20 pointer-events-none">
            <div class="w-4 h-4 flex items-center justify-center rounded-full bg-ryokan-accent/80 backdrop-blur-sm">
              <svg width="7" height="7" viewBox="0 0 24 24" fill="white">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
          </div>
        {/if}
      </div>

      <div class="absolute top-1.5 right-1.5 z-20 pointer-events-auto transition-all duration-200 opacity-0 group-hover:opacity-100">
        <CharacterContextMenu
          {char} {isHidden} {isPinned}
          size="sm"
          {onEdit} {onTogglePin} {onToggleHide} {onDelete}
        />
      </div>

      <div class="relative z-10 px-2.5 py-2 pointer-events-none">
        <h3 class="text-xs font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
      </div>
    </div>
  {/each}
</div>