<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  let {
    searchQuery = $bindable(),
    viewMode = $bindable(),
    showHidden = $bindable(),
    hasHidden
  }: {
    searchQuery: string;
    viewMode: 'grid' | 'compact' | 'list';
    showHidden: boolean;
    hasHidden: boolean;
  } = $props();

  function setViewMode(mode: 'grid' | 'compact' | 'list') {
    viewMode = mode;
    localStorage.setItem('ryokan-view-mode', mode);
  }
</script>

<div class="flex items-center gap-3 mb-6">
  <div class="relative flex-1 max-w-sm">
    <svg class="absolute left-3 top-1/2 -translate-y-1/2 text-gray-600 pointer-events-none" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input
      type="text"
      bind:value={searchQuery}
      placeholder={m.lobby_search_placeholder()}
      class="w-full h-9 pl-8 pr-4 rounded-xl bg-white/[0.04] border border-white/[0.06] text-sm text-gray-300 placeholder-gray-600 focus:outline-none focus:border-ryokan-accent/30 focus:bg-white/[0.06] transition-all"
    />
  </div>

  <div class="flex items-center gap-1 bg-white/[0.04] border border-white/[0.06] rounded-xl p-1">
    <button
      onclick={() => setViewMode('grid')}
      title={m.lobby_view_grid()}
      class="w-7 h-7 flex items-center justify-center rounded-lg transition-all {viewMode === 'grid' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/>
        <rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>
      </svg>
    </button>
    <button
      onclick={() => setViewMode('compact')}
      title={m.lobby_view_compact()}
      class="w-7 h-7 flex items-center justify-center rounded-lg transition-all {viewMode === 'compact' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <rect x="3" y="3" width="4" height="4"/><rect x="10" y="3" width="4" height="4"/><rect x="17" y="3" width="4" height="4"/>
        <rect x="3" y="10" width="4" height="4"/><rect x="10" y="10" width="4" height="4"/><rect x="17" y="10" width="4" height="4"/>
        <rect x="3" y="17" width="4" height="4"/><rect x="10" y="17" width="4" height="4"/><rect x="17" y="17" width="4" height="4"/>
      </svg>
    </button>
    <button
      onclick={() => setViewMode('list')}
      title={m.lobby_view_list()}
      class="w-7 h-7 flex items-center justify-center rounded-lg transition-all {viewMode === 'list' ? 'bg-white/10 text-white' : 'text-gray-600 hover:text-gray-400'}"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
      </svg>
    </button>
  </div>

  {#if hasHidden}
    <button
      onclick={() => (showHidden = !showHidden)}
      title={showHidden ? m.lobby_toggle_hide_hidden() : m.lobby_toggle_show_hidden()}
      class="w-9 h-9 flex items-center justify-center rounded-xl bg-white/[0.04] border border-white/[0.06] transition-all {showHidden ? 'text-white border-ryokan-accent/40 bg-white/[0.08]' : 'text-gray-600 hover:text-gray-400 hover:bg-white/[0.07]'}"
    >
      {#if showHidden}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>
        </svg>
      {:else}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      {/if}
    </button>
  {/if}
</div>