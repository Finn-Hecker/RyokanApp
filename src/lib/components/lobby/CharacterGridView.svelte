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

<div style="display:grid; grid-template-columns:repeat(auto-fill, minmax(300px, 1fr)); gap:1rem;">
  {#each characters as char (char.id)}
    <div class="group relative w-full bg-white/[0.03] hover:bg-white/[0.07] border border-white/[0.06] hover:border-ryokan-accent/40 rounded-2xl overflow-hidden transition-all duration-200 active:scale-[0.98] {showHidden && characterState.hiddenCharacterIds.has(char.id) ? 'opacity-40' : ''}">
      <button onclick={() => onSelect(char)} aria-label={m.lobby_aria_start_chat()} class="absolute inset-0 z-0 w-full h-full cursor-pointer"></button>

      <div class="relative z-10 w-full aspect-[3/4] bg-white/5 overflow-hidden pointer-events-none">
        {#if char.avatarUrl}
          <img src={char.avatarUrl} alt={char.name} class="w-full h-full object-cover transition-transform duration-300 group-hover:scale-105" />
          <div class="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent"></div>
        {:else}
          <div class="w-full h-full {char.color} flex items-center justify-center text-white font-bold text-4xl opacity-80">{char.initials}</div>
        {/if}

        <div class="absolute top-2.5 right-2.5 z-20 pointer-events-auto transition-all duration-200 {showHidden && characterState.hiddenCharacterIds.has(char.id) ? 'opacity-100 translate-y-0' : 'opacity-0 group-hover:opacity-100 translate-y-1 group-hover:translate-y-0'}">
          {#if !char.isCustom}
            <button
              onclick={(e) => onToggleHide(e, char)}
              aria-label={characterState.hiddenCharacterIds.has(char.id) ? m.lobby_aria_show_char() : m.lobby_aria_hide_char()}
              title={characterState.hiddenCharacterIds.has(char.id) ? m.lobby_aria_show_char() : m.lobby_aria_hide_char()}
              class="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md border border-white/10 hover:border-white/25 text-gray-300 hover:text-white transition-all duration-150 active:scale-90"
            >
              {#if characterState.hiddenCharacterIds.has(char.id)}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              {:else}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
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
              class="w-8 h-8 flex items-center justify-center rounded-full bg-black/40 hover:bg-black/70 backdrop-blur-md border border-white/10 hover:border-white/25 text-gray-300 hover:text-white transition-all duration-150 active:scale-90"
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
          {/if}
        </div>
      </div>

      <div class="relative z-10 px-4 py-3 pointer-events-none">
        <h3 class="text-sm font-semibold text-gray-100 truncate group-hover:text-ryokan-accent transition-colors">{char.name}</h3>
        <p class="text-xs text-gray-500 mt-0.5 line-clamp-2 leading-snug">{resolveDesc(char)}</p>
      </div>
    </div>
  {/each}
</div>