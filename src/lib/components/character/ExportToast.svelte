<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { fade } from 'svelte/transition';

  export let type: 'success' | 'error' | null = null;
</script>

{#if type === 'success'}
  <div
    class="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-sm font-medium pointer-events-none bg-emerald-950 border-emerald-500/30 text-emerald-300"
    transition:fade={{ duration: 200 }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <polyline points="20 6 9 17 4 12"/>
    </svg>
    {m.toast_export_success()}
  </div>

{:else if type === 'error'}
  <div
    class="absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 rounded-2xl shadow-2xl border text-sm font-medium pointer-events-none bg-red-950 border-red-500/30 text-red-300"
    transition:fade={{ duration: 200 }}
  >
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <line x1="18" y1="6" x2="6" y2="18"/>
      <line x1="6" y1="6" x2="18" y2="18"/>
    </svg>
    {m.toast_export_failed()}
  </div>
{/if}