<script lang="ts">
  import { scale } from "svelte/transition";
  import { onMount, createEventDispatcher } from "svelte";

  export let items: { code: string; label: string }[] = [];
  export let selectedCode: string = "";
  
  export let className: string = "min-w-[140px]";

  export let id: string = "";

  const dispatch = createEventDispatcher();
  let open = false;
  let rootEl: HTMLDivElement;

  function toggle() { open = !open; }

  function selectLang(code: string) {
    dispatch("select", code);
    open = false;
  }

  function handleClickOutside(e: MouseEvent) {
    if (rootEl && !rootEl.contains(e.target as Node)) open = false;
  }

  function handleKey(e: KeyboardEvent) {
    if (e.key === "Escape") open = false;
  }

  onMount(() => {
    window.addEventListener("click", handleClickOutside);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("click", handleClickOutside);
      window.removeEventListener("keydown", handleKey);
    };
  });

  $: selectedLabel = items.find(l => l.code === selectedCode)?.label || selectedCode;
</script>

<div class="relative w-full {className}" bind:this={rootEl}>
  <button
    {id} 
    type="button"
    aria-haspopup="listbox"
    aria-expanded={open}
    on:click={toggle}
    class="w-full flex items-center justify-between border px-3 py-3 text-sm text-gray-200 transition-all duration-200 backdrop-blur-md
    {open 
      ? 'bg-ryokan-surface border-white/10 border-b-transparent rounded-t-lg rounded-b-none' 
      : 'bg-black/20 border-white/10 hover:border-ryokan-accent/40 rounded-lg'}"
  >
    <span class="font-medium">
      {selectedLabel}
    </span>

    <svg
      class="w-4 h-4 text-gray-400 transition-transform duration-200 {open ? 'rotate-180' : ''}"
      viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    >
      <path d="M6 9l6 6 6-6"/>
    </svg>
  </button>

  {#if open}
    <div
      transition:scale={{ duration: 150, start: 0.95, opacity: 0 }}
      class="absolute top-full left-0 w-full bg-ryokan-surface border border-t-0 border-white/10 rounded-b-lg shadow-xl overflow-hidden z-50 origin-top max-h-60 overflow-y-auto"
    >
      {#each items as item}
        <button
          type="button"
          on:click={() => selectLang(item.code)}
          class="w-full text-left px-3 py-2.5 text-sm text-gray-300 hover:text-white hover:bg-white/5 transition flex justify-between items-center group"
        >
          <span>{item.label}</span>

          {#if item.code === selectedCode}
            <svg class="text-ryokan-accent" width="14" height="14" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3" fill="none">
              <path d="M5 13l4 4L19 7"/>
            </svg>
          {/if}
        </button>
      {/each}
    </div>
  {/if}
</div>