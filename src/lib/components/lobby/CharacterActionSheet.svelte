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
  {#snippet header()}
    {#if char}<div class="flex items-center gap-3">
        <div class="h-12 w-12 shrink-0 overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <CharacterAvatar {char} fallbackTextClass="text-base" />
        </div>
        <div class="min-w-0 flex-1">
          <h2 id="character-action-title" class="truncate">{char.name}</h2>
          <p>{m.lobby_aria_character_options()}</p>
        </div></div>{/if}
  {/snippet}
  {#snippet children(close)}
    {#if char}
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
  {/snippet}
</BottomSheet>
