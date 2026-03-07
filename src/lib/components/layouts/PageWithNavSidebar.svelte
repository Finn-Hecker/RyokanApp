<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Snippet } from 'svelte';
  
  let {
    pageTitle,
    navItems = [],
    activeSection = "",
    onSectionClick = () => {},
    children,
    navHeader,
    navFooter,
    actions,
    mobileNav
  }: {
    pageTitle: string;
    navItems?: Array<{ id: string; label: string; icon?: string }>;
    activeSection?: string;
    onSectionClick?: (id: string) => void;
    children?: Snippet;
    navHeader?: Snippet<[{ mobile: boolean }]>;
    navFooter?: Snippet;
    actions?: Snippet;
    mobileNav?: Snippet;
  } = $props();
</script>

<div
  class="h-full w-full flex overflow-hidden bg-ryokan-bg"
  in:fade={{ duration: 200 }}
  role="region"
  aria-label={pageTitle}
>
  <nav class="hidden md:flex flex-col w-64 shrink-0 border-r border-white/[0.06] bg-ryokan-sidebar" aria-label="Page navigation">
    <div class="p-6 border-b border-white/5 flex items-center gap-3">
      {@render navHeader?.({ mobile: false })}
    </div>

    <div class="flex-1 overflow-y-auto p-4 space-y-1">
      {#each navItems as item}
        <button
          onclick={() => onSectionClick(item.id)}
          class="relative w-full text-left p-3 rounded-lg group transition-all border cursor-pointer flex items-center gap-3 {activeSection === item.id ? 'bg-white/5 border-white/10' : 'border-transparent hover:border-white/5 hover:bg-white/5'}"
        >
          {#if item.icon}
            <svg class="shrink-0 transition-colors {activeSection === item.id ? 'text-ryokan-accent' : 'text-gray-600 group-hover:text-ryokan-accent'}" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
              {#each item.icon.split(' M').filter(Boolean) as d, i}
                <path d="{i === 0 ? '' : 'M'}{d}" stroke-linecap="round" stroke-linejoin="round"/>
              {/each}
            </svg>
          {/if}
          <div class="text-sm font-medium truncate transition-colors {activeSection === item.id ? 'text-ryokan-accent' : 'text-gray-200 group-hover:text-ryokan-accent'}">
            {item.label}
          </div>
        </button>
      {/each}
    </div>

    <div class="p-4">
      {@render navFooter?.()}
    </div>
  </nav>

  <div class="flex flex-col flex-1 min-w-0 overflow-hidden">
    <div class="flex items-center justify-between px-8 pt-6 pb-4">
      <div class="md:hidden flex items-center gap-3">
        {@render navHeader?.({ mobile: true })}
      </div>
      <div class="hidden md:block"></div>
      {@render actions?.()}
    </div>

    <div class="md:hidden flex gap-2 px-8 py-3 overflow-x-auto no-scrollbar shrink-0 border-b border-white/5">
      {@render mobileNav?.()}
    </div>

    <div class="flex-1 overflow-y-auto overflow-x-hidden">
      {@render children?.()}
    </div>
  </div>
</div>

<style>
  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }
</style>