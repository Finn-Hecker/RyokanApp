<script lang="ts">
  import { scale } from 'svelte/transition';
  import { chatState, openHistoryChat, loadAllConversations, loadMoreConversations, deleteConversation, renameConversation, togglePinConversation } from '$lib/stores/chatStore.svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { onMount, onDestroy, untrack } from 'svelte';

  let {
    isOpen,
    close,
    alwaysVisible = false,
    onRolesClick,
    onWorldInfoClick
  }: {
    isOpen: boolean;
    close: () => void;
    alwaysVisible?: boolean;
    onRolesClick?: () => void;
    onWorldInfoClick?: () => void;
  } = $props();

  let chatToDelete      = $state<string | null>(null);
  let openMenuId        = $state<string | null>(null);
  let chatToRename      = $state<string | null>(null);
  let renameValue       = $state('');
  let isConfirmingRename = false;

  let hasMore  = $state(true);
  let isLoading = $state(false);
  let sentinel = $state<HTMLDivElement | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);

  let observer: IntersectionObserver | null = null;

  onMount(() => {
    if (alwaysVisible) initializeChats();
    document.addEventListener('click', closeMenuOnOutsideClick);
  });

  onDestroy(() => {
    if (observer) observer.disconnect();
    document.removeEventListener('click', closeMenuOnOutsideClick);
  });

  $effect(() => {
    if (!alwaysVisible && isOpen) untrack(() => initializeChats());
  });

  $effect(() => {
    if (!alwaysVisible && !isOpen && observer) observer.disconnect();
  });

  // Focus the rename input whenever it appears
  $effect(() => {
    if (chatToRename && renameInput) {
      renameInput.focus();
      renameInput.select();
    }
  });

  async function initializeChats() {
    if (isLoading) return;
    if (observer) observer.disconnect();
    isLoading = true;
    hasMore = true;
    try {
      await loadAllConversations();
    } catch (error) {
      console.error("[Sidebar] Error loading chats:", error);
    } finally {
      isLoading = false;
      setTimeout(setupObserver, 0);
    }
  }

  function setupObserver() {
    if (observer) observer.disconnect();
    if (!sentinel) return;
    observer = new IntersectionObserver(async (entries) => {
      if (!entries[0].isIntersecting || isLoading || !hasMore) return;
      isLoading = true;
      try {
        hasMore = await loadMoreConversations();
      } catch (error) {
        console.error("[Sidebar] Error loading more chats:", error);
      } finally {
        isLoading = false;
      }
    }, { threshold: 0.1 });
    observer.observe(sentinel);
  }

  async function loadChat(id: string) {
    await openHistoryChat(id);
    appState.currentView = 'chat';
    if (!alwaysVisible) close();
  }

  function toggleMenu(id: string, event: Event) {
    event.stopPropagation();
    openMenuId = openMenuId === id ? null : id;
  }

  function closeMenuOnOutsideClick() {
    openMenuId = null;
  }

  async function handlePin(id: string, event: Event) {
    event.stopPropagation();
    openMenuId = null;
    await togglePinConversation(id);
  }

  function startRename(id: string, currentTitle: string, event: Event) {
    event.stopPropagation();
    openMenuId = null;
    chatToRename = id;
    renameValue = currentTitle;
  }

  async function confirmRename() {
    if (chatToRename && renameValue.trim()) {
      await renameConversation(chatToRename, renameValue.trim());
    }
    isConfirmingRename = false;
    chatToRename = null;
  }

  function cancelRename() {
    isConfirmingRename = false;
    chatToRename = null;
  }

  async function handleRenameBlur() {
    if (isConfirmingRename) return;
    await confirmRename();
  }

  function handleConfirmMousedown() {
    isConfirmingRename = true;
  }

  function handleRenameKeydown(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.key === 'Enter')  { e.preventDefault(); confirmRename(); }
    if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
  }

  function promptDelete(id: string, event: Event) {
    event.stopPropagation();
    openMenuId = null;
    chatToDelete = id;
  }

  async function confirmDelete() {
    if (chatToDelete) {
      await deleteConversation(chatToDelete);
      chatToDelete = null;
    }
  }

  function cancelDelete() {
    chatToDelete = null;
  }

  function handleRolesClick() {
    if (onRolesClick) { onRolesClick(); return; }
    appState.listInitialTab = 'roles';
    appState.currentView = 'list';
    if (!alwaysVisible) close();
  }

  function handleWorldInfoClick() {
    if (onWorldInfoClick) { onWorldInfoClick(); return; }
    appState.listInitialTab = 'worldinfo';
    appState.currentView = 'list';
    if (!alwaysVisible) close();
  }
</script>

{#snippet chatList()}
  {#if chatState.conversations.length === 0}
    <p class="text-gray-600 text-sm text-center mt-10">{m.history_no_chats()}</p>
  {/if}

  {#each chatState.conversations as chat}
    <div
      role="button"
      tabindex="0"
      onclick={() => loadChat(chat.id)}
      onkeydown={(e) => e.key === 'Enter' && loadChat(chat.id)}
      class="relative w-full text-left p-3 rounded-lg hover:bg-white/5 group transition-all border border-transparent hover:border-white/5 cursor-pointer"
    >
      <div class="pr-9">
        {#if chatToRename === chat.id}
          <div class="flex items-center gap-1.5" onclick={(e) => e.stopPropagation()} onkeydown={(e) => e.stopPropagation()} role="presentation">
            <input
              bind:this={renameInput}
              bind:value={renameValue}
              onkeydown={handleRenameKeydown}
              onblur={handleRenameBlur}
              class="min-w-0 flex-1 bg-white/10 text-gray-100 text-sm font-medium rounded
                     px-1.5 py-0.5 outline-none border border-ryokan-accent/40
                     focus:border-ryokan-accent"
            />
            <button
              type="button"
              onmousedown={handleConfirmMousedown}
              onclick={(e) => { e.stopPropagation(); confirmRename(); }}
              class="shrink-0 flex items-center justify-center w-6 h-6 rounded
                     bg-ryokan-accent/20 hover:bg-ryokan-accent/40
                     text-ryokan-accent transition-colors"
              aria-label={m.sidebar_aria_confirm_rename()}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12"/>
              </svg>
            </button>
          </div>
        {:else}
          <div class="text-gray-200 text-sm font-medium group-hover:text-ryokan-accent truncate">
            {chat.title}
          </div>
          <div class="text-gray-600 text-[10px] mt-1">
            {chat.formattedDate}
          </div>
        {/if}
      </div>

      {#if chatToRename !== chat.id}
        <div class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7">

          {#if chat.is_pinned}
            <span
              class="absolute inset-0 flex items-center justify-center text-ryokan-accent
                     pointer-events-none transition-opacity duration-150
                     {openMenuId === chat.id ? 'opacity-0' : 'opacity-70 group-hover:opacity-0'}"
              title={m.sidebar_title_pinned()}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
              </svg>
            </span>
          {/if}

          <button
            onclick={(e) => toggleMenu(chat.id, e)}
            class="absolute inset-0 flex flex-col items-center justify-center gap-[3.5px]
                   text-gray-500 hover:text-gray-300 hover:bg-white/10 rounded-md
                   transition-opacity duration-150
                   {chat.is_pinned
                     ? (openMenuId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')
                     : (openMenuId === chat.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}"
            aria-label={m.sidebar_aria_options()}
          >
            <span class="block w-[3.5px] h-[3.5px] rounded-full bg-current"></span>
            <span class="block w-[3.5px] h-[3.5px] rounded-full bg-current"></span>
            <span class="block w-[3.5px] h-[3.5px] rounded-full bg-current"></span>
          </button>
        </div>

        {#if openMenuId === chat.id}
          <div
            class="absolute right-1 top-full mt-1 z-50 min-w-[148px]
                   bg-ryokan-surface border border-white/10 rounded-lg shadow-xl
                   overflow-hidden text-sm"
            transition:scale={{ duration: 100, start: 0.95 }}
          >
            <button
              onclick={(e) => handlePin(chat.id, e)}
              class="w-full flex items-center gap-2.5 px-3 py-2.5
                     text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors text-left"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="shrink-0 text-ryokan-accent/80">
                <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
              </svg>
              {chat.is_pinned ? m.sidebar_action_unpin() : m.sidebar_action_pin()}
            </button>

            <button
              onclick={(e) => startRename(chat.id, chat.title, e)}
              class="w-full flex items-center gap-2.5 px-3 py-2.5
                     text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors text-left"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              {m.sidebar_action_rename()}
            </button>

            <div class="border-t border-white/5 mx-2 my-0.5"></div>

            <button
              onclick={(e) => promptDelete(chat.id, e)}
              class="w-full flex items-center gap-2.5 px-3 py-2.5
                     text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
                <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
              </svg>
              {m.sidebar_action_delete()}
            </button>
          </div>
        {/if}
      {/if}
    </div>
  {/each}

  <div bind:this={sentinel} class="py-2 text-center text-gray-600 text-xs h-8">
    {#if isLoading}<span>…</span>{/if}
  </div>
{/snippet}

{#snippet navButtons()}
  <div class="p-3 border-t border-white/5 flex gap-2 shrink-0">
    <button
      onclick={handleRolesClick}
      class="flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl
             bg-white/[0.03] hover:bg-white/[0.07]
             border border-white/[0.06] hover:border-ryokan-accent/40
             text-gray-500 hover:text-ryokan-accent
             transition-all duration-200 active:scale-[0.97]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
        <circle cx="9" cy="7" r="4"/>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
      </svg>
      <span class="text-[10px] font-medium leading-none tracking-wide text-current opacity-70">{m.sidebar_roles()}</span>
    </button>

    <button
      onclick={handleWorldInfoClick}
      class="flex-1 flex flex-col items-center justify-center gap-1.5 py-3 rounded-xl
             bg-white/[0.03] hover:bg-white/[0.07]
             border border-white/[0.06] hover:border-ryokan-accent/40
             text-gray-500 hover:text-ryokan-accent
             transition-all duration-200 active:scale-[0.97]"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <span class="text-[10px] font-medium leading-none tracking-wide text-current opacity-70">{m.sidebar_worldinfo()}</span>
    </button>
  </div>
{/snippet}

{#if alwaysVisible}
  <aside class="w-64 h-full border-r border-white/5 flex flex-col shrink-0">
    <div class="p-6 border-b border-white/5">
      <h2 class="text-lg font-medium text-ryokan-accent">{m.history_title()}</h2>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
      {@render chatList()}
    </div>
    {@render navButtons()}
  </aside>

{:else if isOpen}
  <button
    type="button"
    aria-label={m.history_close_label()}
    onclick={close}
    class="fixed inset-0 w-full h-full bg-black/60 z-40 cursor-pointer border-none"
  ></button>

  <aside class="fixed left-0 top-0 bottom-0 w-72 border-r border-white/5 shadow-2xl z-50 flex flex-col bg-ryokan-sidebar">
    <div class="p-6 border-b border-white/5 flex justify-between items-center shrink-0">
      <h2 class="text-lg font-medium text-ryokan-accent">{m.history_title()}</h2>
      <button onclick={close} aria-label={m.history_close_label()} class="text-gray-500 hover:text-white">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
      {@render chatList()}
    </div>
    {@render navButtons()}
  </aside>
{/if}

{#if chatToDelete}
  <div
    class="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm"
    role="dialog"
    aria-modal="true"
  >
    <div
      class="bg-ryokan-surface border border-white/10 p-6 rounded-xl shadow-2xl max-w-sm w-full"
      transition:scale={{ duration: 150, start: 0.95 }}
    >
      <h3 class="text-lg font-semibold text-white mb-2">{m.modal_delete_title()}</h3>
      <p class="text-gray-400 text-sm mb-6 leading-relaxed">{m.modal_delete_body()}</p>
      <div class="flex justify-end space-x-3">
        <button
          onclick={cancelDelete}
          class="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
        >
          {m.modal_btn_cancel()}
        </button>
        <button
          onclick={confirmDelete}
          class="px-4 py-2 text-sm bg-red-500/10 text-red-400 hover:bg-red-500/20 hover:text-red-300 border border-red-500/20 rounded-lg transition-colors font-medium"
        >
          {m.modal_btn_confirm()}
        </button>
      </div>
    </div>
  </div>
{/if}