<script module lang="ts">
  import type { Action } from 'svelte/action';

  let activeMenuId = $state<string | null>(null);
  let menuPosition = $state({ x: 0, y: 0 });

  export const desktopCharacterContextMenu: Action<HTMLButtonElement, { id: string; enabled: boolean }> = (node, options) => {
    function contextMenu(event: MouseEvent) {
      if (!options.enabled || !window.matchMedia('(min-width: 768px)').matches) return;
      event.preventDefault();
      event.stopPropagation();
      menuPosition = { x: event.clientX, y: event.clientY };
      activeMenuId = options.id;
    }

    node.addEventListener('contextmenu', contextMenu);
    return {
      update(nextOptions) {
        if (activeMenuId === options.id && (!nextOptions.enabled || nextOptions.id !== options.id)) activeMenuId = null;
        options = nextOptions;
      },
      destroy() {
        node.removeEventListener('contextmenu', contextMenu);
        if (activeMenuId === options.id) activeMenuId = null;
      }
    };
  };
</script>

<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  let {
    char,
    isHidden,
    isPinned,
    menuMode = 'full',
    sheet = false,
    onClose = () => {},
    onEdit,
    onTogglePin,
    onToggleHide,
    onDelete,
    onStartAs
  }: {
    char: any;
    isHidden: boolean;
    isPinned: boolean;
    size?: 'sm' | 'md' | 'lg';
    menuMode?: 'full' | 'manage';
    sheet?: boolean;
    onClose?: (after?: () => void) => void;
    onEdit: (e: MouseEvent, char: any) => void;
    onTogglePin: (e: MouseEvent, char: any) => void;
    onToggleHide: (e: MouseEvent, char: any) => void;
    onDelete: (e: MouseEvent, char: any) => void;
    onStartAs: (e: MouseEvent, char: any) => void;
  } = $props();

  let menuId = $derived(String(char?.id));
  let open = $derived(activeMenuId === menuId);

  function close() {
    if (sheet) {
      onClose();
      return;
    }
    if (open) activeMenuId = null;
  }

  function runAction(event: MouseEvent, action: (event: MouseEvent, character: any) => void) {
    const character = char;
    if (sheet) onClose(() => action(event, character));
    else { close(); action(event, character); }
  }

  function stopProp(e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
  }

  function positionMenu(node: HTMLDivElement) {
    // Keep viewport coordinates independent of card transforms and clipping.
    if (!sheet) document.body.appendChild(node);
    $effect(() => {
      if (sheet) return;
      const { x, y } = menuPosition;
      const { width, height } = node.getBoundingClientRect();
      node.style.left = `${Math.max(8, Math.min(x, window.innerWidth - width - 8))}px`;
      node.style.top = `${Math.max(8, Math.min(y, window.innerHeight - height - 8))}px`;
      node.style.visibility = 'visible';
    });
    return { destroy() { if (!sheet) node.remove(); } };
  }
</script>

<svelte:window
  onclick={() => { if (!sheet) close(); }}
  onresize={() => { if (!sheet) close(); }}
  onscroll={() => { if (!sheet) close(); }}
  onkeydown={(event) => { if (!sheet && event.key === 'Escape') close(); }}
/>

{#if char && (sheet || open)}
  <div
    use:positionMenu
    role="menu"
    aria-label={m.lobby_aria_character_options()}
    tabindex="-1"
    oncontextmenu={(event) => { if (!sheet) event.preventDefault(); }}
    onclick={stopProp}
    onkeydown={stopProp}
    class={sheet
      ? 'sheet-action-list w-full'
      : 'desktop-context-menu fixed w-44 max-w-[calc(100vw-2rem)] bg-[#16161f] border border-ryokan-accent/[0.22] rounded-xl z-50 py-1 overflow-y-auto max-h-[calc(100vh-1rem)]'}
    style={sheet ? '' : 'visibility: hidden; box-shadow: 0 20px 40px rgba(0,0,0,0.7), 0 0 0 1px rgba(212,180,131,0.04) inset;'}
  >
    {#if menuMode === 'manage'}
      <button
        type="button"
        role="menuitem"
        onclick={(e) => runAction(e, onEdit)}
        class:sheet-action={sheet}
        class="w-full flex items-center gap-2.5 px-3.5 py-2.5 touch-manipulation [-webkit-tap-highlight-color:transparent] text-sm text-gray-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
        {m.play_mp_picker_manage()}
      </button>
    {:else}
    {#if char.role_policy !== 'restricted' || char.bundled_roles?.length !== 1}
      <button
        type="button"
        role="menuitem"
        onclick={(e) => runAction(e, onStartAs)}
        class:sheet-action={sheet}
        class="w-full flex items-center gap-2.5 px-3.5 py-2.5 touch-manipulation [-webkit-tap-highlight-color:transparent] text-sm text-gray-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left"
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>
        </svg>
        {m.role_start_as()}
      </button>
    {/if}

    {#if char.isCustom}
      <button
        type="button"
        role="menuitem"
        onclick={(e) => runAction(e, onEdit)}
        class:sheet-action={sheet}
        class="w-full flex items-center gap-2.5 px-3.5 py-2.5 touch-manipulation [-webkit-tap-highlight-color:transparent] text-sm text-gray-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left"
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
      onclick={(e) => runAction(e, onTogglePin)}
      class:sheet-action={sheet}
      class="w-full flex items-center gap-2.5 px-3.5 py-2.5 touch-manipulation [-webkit-tap-highlight-color:transparent] text-sm transition-colors text-left hover:bg-white/[0.06]
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
      onclick={(e) => runAction(e, onToggleHide)}
      class:sheet-action={sheet}
      class="w-full flex items-center gap-2.5 px-3.5 py-2.5 touch-manipulation [-webkit-tap-highlight-color:transparent] text-sm text-gray-200 hover:text-white hover:bg-white/[0.06] transition-colors text-left"
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
        onclick={(e) => runAction(e, onDelete)}
        class:sheet-action={sheet}
        class:sheet-danger={sheet}
        class="w-full flex items-center gap-2.5 px-3.5 py-2.5 touch-manipulation [-webkit-tap-highlight-color:transparent] text-sm text-red-400 hover:text-red-300 hover:bg-red-500/[0.08] transition-colors text-left"
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
    {/if}
  </div>
{/if}

<style>
  .desktop-context-menu {
    animation: context-menu-appear 100ms ease-out;
  }

  @keyframes context-menu-appear {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @media (prefers-reduced-motion: reduce) {
    .desktop-context-menu { animation: none; }
  }

  .sheet-action {
    min-height: 44px;
    padding: 9px 10px;
    gap: 12px;
    border: 1px solid transparent;
    border-radius: 10px;
    font-size: 14px;
    font-weight: 550;
    color: var(--sheet-text);
    line-height: 1.25;
    transition: background-color 160ms ease, border-color 160ms ease, color 160ms ease, transform 160ms ease;
  }

  .sheet-action :global(svg) {
    width: 18px;
    height: 18px;
    flex: none;
  }

  .sheet-action:hover,
  .sheet-action:focus-visible {
    background: var(--sheet-surface-hover);
    border-color: transparent;
    color: #f3e6d2;
    outline: none;
  }

  .sheet-action:active {
    background: rgba(212, 180, 131, 0.16);
    border-color: rgba(212, 180, 131, 0.3);
    transform: scale(0.99);
  }

  .sheet-danger { color:var(--sheet-danger); }

  .sheet-danger:hover,
  .sheet-danger:focus-visible {
    background: var(--sheet-danger-surface);
    border-color: rgba(239, 68, 68, 0.2);
    color: #fca5a5;
  }

  .sheet-danger:active {
    background: rgba(239, 68, 68, 0.16);
  }
</style>
