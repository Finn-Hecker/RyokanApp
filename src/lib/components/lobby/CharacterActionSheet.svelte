<script lang="ts">
  import BottomSheet from '$lib/components/ui/BottomSheet.svelte';
  import * as m from '$lib/paraglide/messages';
  import CharacterAvatar from './CharacterAvatar.svelte';
  import CharacterContextMenu from './CharacterContextMenu.svelte';

  let {
    char,
    isHidden,
    isPinned,
    menuMode = 'full',
    onClose,
    onEdit,
    onTogglePin,
    onToggleHide,
    onDelete,
    onStartAs
  }: {
    char: any;
    isHidden: boolean;
    isPinned: boolean;
    menuMode?: 'full' | 'manage';
    onClose: () => void;
    onEdit: (event: MouseEvent, char: any) => void;
    onTogglePin: (event: MouseEvent, char: any) => void;
    onToggleHide: (event: MouseEvent, char: any) => void;
    onDelete: (event: MouseEvent, char: any) => void;
    onStartAs: (event: MouseEvent, char: any) => void;
  } = $props();
</script>

<BottomSheet {onClose} label={m.lobby_aria_character_options()} breakpoint={768} mobileOnly>
  {#snippet children(close)}
  <div class="px-4 pb-4 select-none">
    {#if char}
      <div class="mb-4 flex items-center gap-3 px-1">
        <div class="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <CharacterAvatar {char} fallbackTextClass="text-base" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 id="character-action-title" class="truncate text-base font-semibold text-ryokan-text">{char.name}</h2>
          <p class="mt-0.5 text-xs text-gray-500">{m.lobby_aria_character_options()}</p>
        </div>
        <button
          type="button"
          aria-label={m.create_char_close_aria()}
          onclick={close}
          class="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-white/[0.06] bg-white/[0.04] text-gray-400 transition-all hover:border-ryokan-accent/30 hover:bg-white/[0.08] hover:text-white active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ryokan-accent"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
            <path d="M5 5l14 14M19 5 5 19"/>
          </svg>
        </button>
      </div>
      <CharacterContextMenu
        {char}
        {isHidden}
        {isPinned}
        {menuMode}
        sheet
        onClose={close}
        {onEdit}
        {onTogglePin}
        {onToggleHide}
        {onDelete}
        {onStartAs}
      />
    {/if}
  </div>
  {/snippet}
</BottomSheet>
