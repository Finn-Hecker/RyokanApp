<script lang="ts">
  import { characterState } from '$lib/stores/characterStore.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    characters,
    showHidden,
    onSelect,
    onEdit,
    onToggleHide,
    resolveDesc
  }: {
    characters: any[];
    showHidden: boolean;
    onSelect: (char: any) => void;
    onEdit: (e: MouseEvent, char: any) => void;
    onToggleHide: (e: MouseEvent, char: any) => void;
    resolveDesc: (char: any) => string;
  } = $props();
</script>

<div class="flex flex-col gap-2">
  {#each characters as char (char.id)}
    <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-xl overflow-hidden transition-all duration-200 active:scale-[0.995] {showHidden && characterState.hiddenCharacterIds.has(char.id) ? 'opacity-40' : ''}">
      <button onclick={() => onSelect(char)} aria-label="Start chat" class="absolute inset-0 z-0 w-full h-full cursor-pointer"></button>

      <div class="relative z-10 flex items-center gap-4 px-4 py-3 pointer-events-none">
        <div class="w-10 h-10 rounded-lg overflow-hidden shrink-0 bg-white/5">
          {#if char.avatarUrl}
            <img src={char.avatarUrl} alt={char.name} class="w-full h-full object-cover" />
          {:else}
            <div class="w-full h-full {char.color} flex items-center justify-center text-white font-bold text-sm opacity-80">{char.initials}</div>
          {/if}
        </div>

        <div class="flex-1 min-w-0">
          <h3 class="text-sm font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
          <p class="text-xs text-gray-500 truncate">{resolveDesc(char)}</p>
        </div>

        <div class="pointer-events-auto transition-opacity duration-150 shrink-0 {showHidden && characterState.hiddenCharacterIds.has(char.id) ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}">
          {#if !char.isCustom}
            <button
              onclick={(e) => onToggleHide(e, char)}
              aria-label={characterState.hiddenCharacterIds.has(char.id) ? 'Show' : 'Hide'}
              title={characterState.hiddenCharacterIds.has(char.id) ? 'Show' : 'Hide'}
              class="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-500 hover:text-white transition-all active:scale-90"
            >
              {#if characterState.hiddenCharacterIds.has(char.id)}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              {:else}
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              {/if}
            </button>
          {:else}
            <button
              onclick={(e) => onEdit(e, char)}
              aria-label={m.lobby_aria_edit_char()}
              title={m.lobby_aria_edit_char()}
              class="w-7 h-7 flex items-center justify-center rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 text-gray-500 hover:text-white transition-all active:scale-90"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          {/if}
        </div>
      </div>
    </div>
  {/each}
</div>