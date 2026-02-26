<script lang="ts">
  import { fade } from 'svelte/transition';
  
  export let pageTitle: string;
  export let showSidebar = false;
  export let sidebarWidth = "w-64";
  export let maxContentWidth = "max-w-7xl";
  export let contentPadding = "px-8";

  let isMobileSidebarOpen = false;
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
        <slot name="sidebar" />
      </aside>
    </div>

    {#if isMobileSidebarOpen}
      <button
        type="button"
        transition:fade={{ duration: 200 }}
        aria-label="Close sidebar"
        on:click={() => isMobileSidebarOpen = false}
        class="lg:hidden fixed inset-0 w-full h-full bg-black/60 z-40 backdrop-blur-sm cursor-pointer"
      ></button>
      
      <aside
        class="lg:hidden fixed left-0 top-0 bottom-0 w-72 border-r border-white/5 shadow-2xl z-50 flex flex-col"
      >
        <slot name="sidebar" {isMobileSidebarOpen} close={() => isMobileSidebarOpen = false} />
      </aside>
    {/if}
  {/if}

  <div class="flex-1 overflow-y-auto min-w-0">
    <div class="{maxContentWidth} mx-auto w-full {contentPadding}">
      
      <div class="flex items-center justify-between pt-6 mb-6">
        {#if showSidebar}
          <button
            on:click={() => isMobileSidebarOpen = true}
            aria-label="Open menu"
            class="lg:hidden w-10 h-10 flex items-center justify-center text-gray-500 hover:text-white transition bg-white/5 rounded-full hover:bg-white/10 border border-white/5 hover:border-ryokan-accent/30 active:scale-95"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="3" y1="12" x2="21" y2="12"/>
              <line x1="3" y1="6" x2="21" y2="6"/>
              <line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
          </button>
          <div class="hidden lg:block" ></div>
        {:else}
          <div></div>
        {/if}

        <slot name="header" />
      </div>

      <slot />

      <div class="h-8"></div>
    </div>
  </div>
</div>