<script lang="ts">
  import DesktopSidebar from './sidebar/DesktopSidebar.svelte';
  import MobileSidebar from './sidebar/MobileSidebar.svelte';
  import type { ConversationMode } from '$lib/stores/chatStore.svelte';

  let {
    isOpen,
    close,
    layout,
    interactionMode,
    onWorldInfoClick,
    mode = 'singleplayer',
  }: {
    isOpen: boolean;
    close: () => void;
    layout: 'inline' | 'drawer';
    interactionMode: 'desktop' | 'mobile';
    onWorldInfoClick?: () => void;
    mode?: ConversationMode;
  } = $props();
</script>

{#if interactionMode === 'desktop'}
  <DesktopSidebar {isOpen} {close} {layout} {onWorldInfoClick} {mode} />
{:else}
  <MobileSidebar {isOpen} {close} {layout} {onWorldInfoClick} {mode} />
{/if}
