<script lang="ts">
  import { fade } from 'svelte/transition';
  import type { Snippet } from 'svelte';
  
  let {
    maxWidth = "max-w-xl",
    children,
    leadingActions,
    actions
  }: {
    maxWidth?: string;
    children?: Snippet;
    leadingActions?: Snippet;
    actions?: Snippet;
  } = $props();
</script>

<div 
  class="h-full w-full bg-ryokan-bg text-gray-200 flex flex-col"
  in:fade={{ duration: 200 }}
  role="region"
>
  <header class="app-page-header border-b border-white/5 flex items-center justify-between shrink-0 bg-ryokan-bg/95 backdrop-blur z-20 sticky top-0">
    <div class="flex items-center gap-3">
      {@render leadingActions?.()}
    </div>
    <div class="flex items-center gap-3">
      {@render actions?.()}
    </div>
  </header>

  <div class="page-scroll flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]">
    <div class="app-page-content page-content {maxWidth} mx-auto space-y-8 pb-32">
      {@render children?.()}
    </div>
  </div>
</div>
