<script lang="ts">
  import { fade, fly } from 'svelte/transition';
  import type { Snippet } from 'svelte';
  
  let {
    pageTitle,
    showSidebar = false,
    sidebarWidth = "w-64",
    maxContentWidth = "max-w-7xl",
    contentPadding = "px-8",
    children,
    sidebar,
    header
  }: {
    pageTitle: string;
    showSidebar?: boolean;
    sidebarWidth?: string;
    maxContentWidth?: string;
    contentPadding?: string;
    children?: Snippet;
    sidebar?: Snippet<[{ isMobileSidebarOpen: boolean; close: () => void }]>;
    header?: Snippet;
  } = $props();

  let isMobileSidebarOpen = $state(false);
</script>

<div 
  class="h-full w-full flex overflow-hidden"
  in:fade={{ duration: 200 }}
  role="region"
  aria-label={pageTitle}
>
  {#if showSidebar}
    <div class="hidden lg:flex shrink-0 bg-ryokan-sidebar">
      <aside class="{sidebarWidth} h-full border-r border-white/5 flex flex-col shrink-0">
        {@render sidebar?.({ isMobileSidebarOpen: false, close: () => {} })}
      </aside>
    </div>

    {#if isMobileSidebarOpen}
      <button
        type="button"
        aria-label="Close sidebar"
        onclick={() => isMobileSidebarOpen = false}
        class="lg:hidden fixed w-full h-full z-40 cursor-pointer"
      ></button>
      
      <aside
        transition:fly={{ x: -500, duration: 200 }}
        class="lg:hidden fixed left-0 top-0 bottom-0 w-72 bg-ryokan-sidebar border-r border-white/5 shadow-2xl z-50 flex flex-col"
      >
        {@render sidebar?.({ isMobileSidebarOpen, close: () => isMobileSidebarOpen = false })}
      </aside>
    {/if}
  {/if}

  <div class="flex-1 overflow-y-auto min-w-0">
    <div class="{maxContentWidth} mx-auto w-full {contentPadding}">
      
      <div class="flex items-center justify-between pt-6 mb-6">
        {#if showSidebar}
          <button
            onclick={() => isMobileSidebarOpen = true}
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

      {@render children?.()}

      <div class="h-8"></div>
    </div>
  </div>
</div>