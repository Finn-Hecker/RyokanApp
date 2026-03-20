<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  let {
    char,
    isHidden,
    isPinned,
    size = 'md',
    onEdit,
    onTogglePin,
    onToggleHide,
    onDelete
  }: {
    char: any;
    isHidden: boolean;
    isPinned: boolean;
    size?: 'sm' | 'md' | 'lg';
    onEdit: (e: MouseEvent, char: any) => void;
    onTogglePin: (e: MouseEvent, char: any) => void;
    onToggleHide: (e: MouseEvent, char: any) => void;
    onDelete: (e: MouseEvent, char: any) => void;
  } = $props();

  let open = $state(false);

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
  }

  function close() {
    open = false;
  }

  function stopProp(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
  }

  const buttonSizes: Record<string, string> = {
    sm: 'w-6 h-6 rounded-full',
    md: 'w-7 h-7 rounded-lg',
    lg: 'w-8 h-8 rounded-full',
  };

  const iconSizes: Record<string, number> = {
    sm: 11,
    md: 13,
    lg: 14,
  };
</script>

<svelte:window onclick={close} />

<button
  type="button"
  onclick={toggle}
  aria-label={m.lobby_aria_options()}
  aria-haspopup="menu"
  aria-expanded={open}
  class="{buttonSizes[size]} flex items-center justify-center bg-black/50 hover:bg-black/70 backdrop-blur-md border border-white/10 hover:border-ryokan-accent/40 text-gray-300 hover:text-white transition-all duration-150 active:scale-90
    {size === 'md' ? 'bg-white/5 hover:bg-white/[0.07]' : ''}
    {open ? 'bg-black/70 border-ryokan-accent/50 text-white' + (size === 'md' ? ' !bg-white/[0.07]' : '') : ''}"
>
  <svg width={iconSizes[size]} height={iconSizes[size]} viewBox="0 0 24 24" fill="currentColor">
    <circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>
  </svg>
</button>

{#if open}
  <div
    role="menu"
    aria-label={m.lobby_aria_character_options()}
    tabindex="-1"
    onclick={stopProp}
    onkeydown={stopProp}
    class="absolute right-0 top-full mt-1.5 w-44 bg-[#16161f] border border-ryokan-accent/[0.22] rounded-xl z-30 py-1 overflow-hidden"
    style="box-shadow: 0 20px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,180,131,0.04) inset;"
  >
    {#if char.isCustom}
      <button
        type="button"
        role="menuitem"
        onclick={(e) => { close(); onEdit(e, char); }}
        class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        {m.lobby_aria_edit_char()}
      </button>
    {/if}

    <button
      type="button"
      role="menuitem"
      onclick={(e) => { close(); onTogglePin(e, char); }}
      class="w-full flex items-center gap-2.5 px-3 py-2 text-sm transition-colors text-left hover:bg-white/[0.06]
        {isPinned ? 'text-ryokan-accent hover:text-ryokan-accent/80' : 'text-gray-200 hover:text-white'}"
    >
      <svg width="13" height="13" viewBox="0 0 24 24" fill={isPinned ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z"/>
      </svg>
      {isPinned ? m.lobby_action_unpin() : m.lobby_action_pin()}
    </button>

    <button
      type="button"
      role="menuitem"
      onclick={(e) => { close(); onToggleHide(e, char); }}
      class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left"
    >
      {#if isHidden}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
          <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
        {m.lobby_action_show()}
      {:else}
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
        {m.lobby_action_hide()}
      {/if}
    </button>

    {#if char.isCustom}
      <div role="separator" class="my-1 border-t border-white/[0.07]"></div>
      <button
        type="button"
        role="menuitem"
        onclick={(e) => { close(); onDelete(e, char); }}
        class="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/[0.08] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="3 6 5 6 21 6"/>
          <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
          <path d="M10 11v6"/><path d="M14 11v6"/>
          <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
        </svg>
        {m.lobby_action_delete()}
      </button>
    {/if}
  </div>
{/if}