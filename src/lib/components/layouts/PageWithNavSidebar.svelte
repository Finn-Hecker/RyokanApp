<script lang="ts">
  import { fade } from 'svelte/transition';
  
  export let pageTitle: string;
  export let navItems: Array<{ id: string; label: string }> = [];
  export let activeSection: string = "";
  export let onSectionClick: (id: string) => void = () => {};
</script>

<div
  class="h-full w-full flex overflow-hidden bg-ryokan-bg"
  in:fade={{ duration: 200 }}
  role="region"
  aria-label={pageTitle}
>
  
  <nav
    class="hidden md:flex flex-col w-64 shrink-0 border-r border-white/[0.06] bg-ryokan-sidebar" 
    aria-label="Page navigation"
  >
    <div class="p-6 border-b border-white/5 flex items-center gap-3">
      <slot name="nav-header" />
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-2">
      {#each navItems as item}
        <button
          on:click={() => onSectionClick(item.id)}
          class="relative w-full text-left p-3 rounded-lg group transition-all border cursor-pointer
            {activeSection === item.id
              ? 'bg-white/5 border-white/10'
              : 'border-transparent hover:border-white/5 hover:bg-white/5'}"
        >
          <div class="text-sm font-medium truncate transition-colors {activeSection === item.id ? 'text-ryokan-accent' : 'text-gray-200 group-hover:text-ryokan-accent'}">
            {item.label}
          </div>
        </button>
      {/each}
    </div>
  </nav>

  <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
    
    <div class="flex items-center justify-between px-8 pt-6 pb-4">
      
      <div class="md:hidden flex items-center gap-3">
        <slot name="nav-header" mobile={true} />
      </div>

      <div class="hidden md:block"></div>

      <span class="text-sm font-medium text-gray-400 tracking-wide md:hidden">
        {pageTitle}
      </span>

      <slot name="actions" />
    </div>

    <div class="md:hidden flex gap-2 px-8 py-3 overflow-x-auto no-scrollbar shrink-0 border-b border-white/5">
      <slot name="mobile-nav" />
    </div>

    <div class="flex-1 overflow-y-auto overflow-x-hidden">
      <slot />
    </div>
  </div>
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>