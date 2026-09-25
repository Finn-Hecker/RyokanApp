<script lang="ts">
  import SidebarBase from './SidebarBase.svelte';
  import type { ConversationMode } from '$lib/stores/chatStore.svelte';

  let {
    isOpen,
    close,
    layout,
    onWorldInfoClick,
    mode = 'singleplayer',
  }: {
    isOpen: boolean;
    close: () => void;
    layout: 'inline' | 'drawer';
    onWorldInfoClick?: () => void;
    mode?: ConversationMode;
  } = $props();
</script>

<SidebarBase {isOpen} {close} {layout} interactionMode="desktop" {onWorldInfoClick} {mode} />
