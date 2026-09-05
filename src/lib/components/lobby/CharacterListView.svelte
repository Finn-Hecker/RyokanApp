<script lang="ts">
  import { characterState } from '$lib/stores/characterStore.svelte';
  import * as m from '$lib/paraglide/messages';
  import CharacterContextMenu from './CharacterContextMenu.svelte';
  import CharacterAvatar from './CharacterAvatar.svelte';

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

  // Tracks which row is currently being pressed. Driven by pointer events on
  // the row's own "select" button only, so pressing the context menu button
  // (which sits above it and intercepts its own clicks) never triggers this.
  let pressedId = $state<string | null>(null);

  function clearPress(id: string) {
    if (pressedId === id) pressedId = null;
  }
</script>

<div class="flex flex-col gap-2">
  {#each characters as char (char.id)}
    {@const isHidden = characterState.hiddenCharacterIds.has(String(char.id))}
    {@const isPinned = characterState.pinnedCharacterIds.has(String(char.id))}
    {@const isPressed = pressedId === String(char.id)}

    <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-xl overflow-visible transition-all duration-200 {isPressed ? 'scale-[0.995]' : ''} {showHidden && isHidden ? 'opacity-40' : ''}">
      <button
        onclick={() => onSelect(char)}
        onpointerdown={() => (pressedId = String(char.id))}
        onpointerup={() => clearPress(String(char.id))}
        onpointercancel={() => clearPress(String(char.id))}
        onpointerleave={() => clearPress(String(char.id))}
        aria-label={m.lobby_aria_start_chat()}
        class="absolute inset-0 z-0 w-full h-full cursor-pointer rounded-xl touch-manipulation select-none [-webkit-tap-highlight-color:transparent]"
      ></button>

      <div class="relative z-10 flex items-center gap-4 px-4 py-3 pr-12 md:pr-4 pointer-events-none">
        <div class="relative w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-white/5">
          <CharacterAvatar {char} fallbackTextClass="text-sm" />
          {#if isPinned}
            <div class="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-ryokan-accent/90">
              <svg width="7" height="7" viewBox="0 0 24 24" fill="white">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
              </svg>
            </div>
          {/if}
        </div>

        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
          <p class="text-xs text-gray-400 truncate">{resolveDesc(char)}</p>
        </div>
      </div>

      <div class="absolute right-3 top-1/2 -translate-y-1/2 z-20 pointer-events-auto transition-opacity duration-150 opacity-100 md:opacity-0 md:group-hover:opacity-100">
        <CharacterContextMenu
          {char} {isHidden} {isPinned}
          size="md"
          {onEdit} {onTogglePin} {onToggleHide} {onDelete}
        />
      </div>
    </div>
  {/each}
</div>
