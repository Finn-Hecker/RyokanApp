<script lang="ts">
  import { fade } from 'svelte/transition';
  
  export let maxWidth = "max-w-xl";
  
</script>

<div 
  class="h-full w-full bg-ryokan-bg text-gray-200 flex flex-col"
  in:fade={{ duration: 200 }}
  role="region"
>
  
  <header class="border-b border-white/5 flex items-center justify-between px-8 pt-6 pb-4 shrink-0 bg-ryokan-bg/95 backdrop-blur z-20 sticky top-0">
    <div></div>
    <div class="flex items-center gap-3">
      <slot name="actions" />
    </div>
  </header>

  <div class="flex-1 overflow-y-auto overflow-x-hidden">
    <div class="{maxWidth} mx-auto p-4 md:p-8 space-y-8 pb-32">
      <slot />
    </div>
  </div>
</div>