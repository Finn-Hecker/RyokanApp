<script lang="ts">
  import type { Character } from '$lib/stores/characterStore.svelte';
  import CharacterAvatar from '$lib/components/lobby/CharacterAvatar.svelte';
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    characters,
    hiddenIds,
    selectedId,
    onSelect,
    onManage,
    onClose
  }: {
    characters: Character[];
    hiddenIds: Set<string | number>;
    selectedId: string;
    onSelect: (character: Character) => void;
    onManage: (character: Character) => void;
    onClose: () => void;
  } = $props();

  let dialogElement = $state<HTMLDivElement>();

  onMount(() => dialogElement?.focus());

  function closeOnBackdrop(event: MouseEvent) {
    if (event.target === event.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={(event) => event.key === 'Escape' && onClose()} />

<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
  role="presentation"
  onclick={closeOnBackdrop}
>
  <div
    bind:this={dialogElement}
    role="dialog"
    aria-modal="true"
    aria-labelledby="multiplayer-character-picker-title"
    tabindex="-1"
    class="flex max-h-[min(720px,calc(100vh-2rem))] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#12121a] shadow-2xl"
  >
    <header class="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
      <div>
        <h2 id="multiplayer-character-picker-title" class="font-medium text-gray-100">
          {m.play_mp_picker_title()}
        </h2>
        <p class="mt-1 text-sm text-gray-500">{m.play_mp_picker_desc()}</p>
      </div>
      <button
        type="button"
        aria-label={m.create_char_close_aria()}
        onclick={onClose}
        class="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-white/[0.06] hover:text-gray-200"
      >
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6 6 18M6 6l12 12"/>
        </svg>
      </button>
    </header>

    <div class="overflow-y-auto p-4 sm:p-5">
      {#if characters.length === 0}
        <div class="flex min-h-48 items-center justify-center rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-6 text-center text-sm text-gray-500">
          {m.play_mp_picker_empty()}
        </div>
      {:else}
        <div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {#each characters as character (character.id)}
            {@const isSelected = String(character.id) === selectedId}
            {@const isHidden = hiddenIds.has(String(character.id))}
            <article class="group relative overflow-hidden rounded-xl border transition-colors {isSelected ? 'border-ryokan-accent/60 bg-ryokan-accent/[0.08]' : 'border-white/[0.07] bg-white/[0.03] hover:border-white/15 hover:bg-white/[0.05]'} {isHidden ? 'opacity-60' : ''}">
              <button
                type="button"
                onclick={() => onSelect(character)}
                aria-pressed={isSelected}
                disabled={isHidden}
                class="flex w-full items-center gap-3 p-3 pr-20 text-left"
              >
                <span class="relative h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-white/5">
                  <CharacterAvatar char={character} fallbackTextClass="text-base" />
                </span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-sm font-medium text-gray-100">{character.name}</span>
                  <span class="mt-0.5 block text-xs {isSelected ? 'text-ryokan-accent' : 'text-gray-500'}">
                    {isHidden ? m.play_mp_picker_hidden() : isSelected ? m.play_mp_picker_selected() : m.play_mp_picker_select()}
                  </span>
                </span>
              </button>

              {#if character.isCustom}
                <button
                  type="button"
                  onclick={() => onManage(character)}
                  class="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-lg border border-white/[0.07] bg-black/20 px-2.5 py-1.5 text-xs text-gray-400 transition-colors hover:border-white/15 hover:bg-white/[0.07] hover:text-gray-100"
                >
                  {m.play_mp_picker_manage()}
                </button>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</div>
