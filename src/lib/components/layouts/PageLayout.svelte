<script lang="ts">
  import { fade } from 'svelte/transition';
  import { onMount, onDestroy, tick, type Snippet } from 'svelte';
  import { appState, type InteractionMode } from '$lib/stores/appState.svelte';
  import { registerBackHandler } from '$lib/stores/navigation';
  import { mobileSidebarSwipe } from './mobileSidebarSwipe';

  type SidebarLayout = 'inline' | 'drawer';
  type SidebarContext = {
    layout: SidebarLayout;
    interactionMode: InteractionMode;
    isOpen: boolean;
    close: () => void;
  };
  
  let {
    pageTitle,
    animateEntrance = true,
    stickyHeader = false,
    showSidebar = false,
    swipeToOpenSidebar = false,
    sidebarWidth = "w-64",
    maxContentWidth = "max-w-7xl",
    children,
    sidebar,
    header
  }: {
    pageTitle: string;
    animateEntrance?: boolean;
    stickyHeader?: boolean;
    showSidebar?: boolean;
    swipeToOpenSidebar?: boolean;
    sidebarWidth?: string;
    maxContentWidth?: string;
    children?: Snippet;
    sidebar?: Snippet<[SidebarContext]>;
    header?: Snippet;
  } = $props();

  let isMobileSidebarOpen = $state(false);
  let isMobileSidebarVisible = $state(false);
  let wideLayout = $state(window.matchMedia('(min-width: 1024px)').matches);
  let sidebarDragging = $state(false);
  let sidebarProgress = $state(0);
  let sidebarLayer = $state<HTMLDivElement | null>(null);
  let sidebarSettleTimer: ReturnType<typeof setTimeout> | undefined;
  let sidebarMotionRevision = 0;

  function cancelSidebarMotion() {
    sidebarMotionRevision++;
    clearTimeout(sidebarSettleTimer);
    sidebarSettleTimer = undefined;
  }

  onDestroy(cancelSidebarMotion);
  onMount(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    const sync = () => { wideLayout = query.matches; closeSidebar(); };
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  });

  function sidebarDrawerWidth() {
    return sidebarLayer?.querySelector<HTMLElement>('[data-sidebar-drawer]')?.getBoundingClientRect().width
      ?? parseFloat(getComputedStyle(document.documentElement).fontSize) * 18;
  }

  function dragSidebar(progress: number) {
    cancelSidebarMotion();
    isMobileSidebarVisible = true;
    sidebarDragging = true;
    sidebarProgress = progress;
  }

  function closeSidebar() {
    cancelSidebarMotion();
    isMobileSidebarOpen = false;
    sidebarDragging = false;
    sidebarProgress = 0;
    if (!isMobileSidebarVisible) return;
    sidebarSettleTimer = setTimeout(() => {
      isMobileSidebarVisible = false;
      sidebarSettleTimer = undefined;
    }, 180);
  }

  async function openSidebar() {
    cancelSidebarMotion();
    const revision = sidebarMotionRevision;
    isMobileSidebarVisible = true;
    isMobileSidebarOpen = true;
    sidebarDragging = false;
    await tick();
    if (revision !== sidebarMotionRevision) return;
    // Establish the closed position before the menu button starts its transition.
    sidebarLayer?.getBoundingClientRect();
    sidebarProgress = 1;
  }

  function releaseSidebar(open: boolean) {
    if (!open) { closeSidebar(); return; }
    cancelSidebarMotion();
    sidebarDragging = false;
    isMobileSidebarOpen = true;
    sidebarProgress = 1;
  }

  function enterPage(node: Element) {
    return animateEntrance ? fade(node, { duration: 200 }) : { duration: 0 };
  }

  $effect(() => {
    if (!showSidebar || !isMobileSidebarOpen) return;
    return registerBackHandler(() => {
      if (!showSidebar || !isMobileSidebarOpen) return false;
      closeSidebar();
      return true;
    });
  });
</script>

<div 
  class="h-full w-full flex overflow-hidden"
  use:mobileSidebarSwipe={{
    enabled: swipeToOpenSidebar && showSidebar && !isMobileSidebarOpen && appState.interactionMode === 'mobile',
    getWidth: sidebarDrawerWidth,
    onDrag: dragSidebar,
    onRelease: releaseSidebar,
  }}
  in:enterPage
  role="region"
  aria-label={pageTitle}
>
  {#if showSidebar}
    {#if wideLayout}
    <div class="hidden lg:flex shrink-0 bg-ryokan-sidebar">
      <aside class="{sidebarWidth} h-full border-r border-white/5 flex flex-col shrink-0">
        {@render sidebar?.({ layout: 'inline', interactionMode: appState.interactionMode, isOpen: true, close: () => {} })}
      </aside>
    </div>

    {:else}
      <button
        type="button"
        aria-label="Close sidebar"
        onclick={closeSidebar}
        disabled={!isMobileSidebarOpen}
        class="lg:hidden fixed inset-0 w-full h-full z-40 cursor-pointer"
      ></button>
      
      <div
        bind:this={sidebarLayer}
        class="mobile-sidebar-layer lg:hidden fixed inset-0 z-40"
        class:mobile-sidebar-layer--dragging={sidebarDragging}
        class:mobile-sidebar-layer--visible={isMobileSidebarVisible}
        inert={!isMobileSidebarOpen}
        aria-hidden={!isMobileSidebarOpen}
        style:--sidebar-progress={sidebarProgress}
      >
        {@render sidebar?.({ layout: 'drawer', interactionMode: appState.interactionMode, isOpen: isMobileSidebarOpen || sidebarDragging, close: closeSidebar })}
      </div>
    {/if}
  {/if}

  <div class="flex-1 overflow-y-auto min-w-0 scrollbar-hide">
    <div class="app-page-header flex items-center justify-between border-b border-white/5 {stickyHeader ? 'sticky top-0 z-30 bg-ryokan-bg' : ''}">
        {#if showSidebar}
          <button
            onclick={openSidebar}
            aria-label="Open menu"
            class="lg:hidden w-10 h-10 flex items-center justify-center text-gray-500 hover:text-white transition bg-white/5 rounded-full hover:bg-white/10 border border-white/5 hover:border-ryokan-accent/30 active:scale-95"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div class="hidden lg:block"></div>
        {:else}
          <div></div>
        {/if}

        {@render header?.()}
    </div>

    <div class="app-page-content {maxContentWidth} mx-auto w-full">
      {@render children?.()}

      <div class="h-8"></div>
    </div>
  </div>
</div>
<style>
  .mobile-sidebar-layer {
    --sidebar-motion-duration: 180ms;
    visibility: hidden;
    pointer-events: none;
  }
  .mobile-sidebar-layer--visible {
    visibility: visible;
    pointer-events: auto;
  }
  .mobile-sidebar-layer--dragging {
    --sidebar-motion-duration: 0ms;
  }
  .mobile-sidebar-layer :global([data-sidebar-drawer]) {
    transform: translate3d(calc((var(--sidebar-progress) - 1) * 100%), 0, 0);
    transition: transform var(--sidebar-motion-duration) cubic-bezier(.22, 1, .36, 1);
    will-change: transform;
  }
  .mobile-sidebar-layer :global(.sidebar-backdrop) {
    opacity: var(--sidebar-progress);
    transition: opacity var(--sidebar-motion-duration) ease;
  }
  @media (prefers-reduced-motion: reduce) {
    .mobile-sidebar-layer { --sidebar-motion-duration: 0ms; }
  }
  .scrollbar-hide::-webkit-scrollbar {
  display: none;
}
.scrollbar-hide {
  -ms-overflow-style: none; /* IE/Edge */
  scrollbar-width: none;    /* Firefox */
}
</style>
