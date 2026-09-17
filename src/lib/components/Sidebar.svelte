<script lang="ts">
  import { flip } from 'svelte/animate';
  import { scale } from 'svelte/transition';
  import { chatState, openHistoryChat, loadAllConversations, loadMoreConversations, deleteConversation, renameConversation, togglePinConversation, createChatFolder, renameChatFolder, setChatFolderCollapsed, deleteChatFolder, persistSidebarOrganization, type Conversation, type ConversationMode } from '$lib/stores/chatStore.svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import { navigateTo, registerBackHandler } from '$lib/stores/navigation';
  import { openPersistentSession } from '$lib/stores/multiplayer.svelte';
  import * as m from '$lib/paraglide/messages';
  import { onMount, onDestroy, untrack } from 'svelte';

  let {
    isOpen,
    close,
    layout,
    interactionMode,
    onWorldInfoClick,
    mode = 'singleplayer'
  }: {
    isOpen: boolean;
    close: () => void;
    layout: 'inline' | 'drawer';
    interactionMode: 'desktop' | 'mobile';
    onWorldInfoClick?: () => void;
    mode?: ConversationMode;
  } = $props();

  let chatToDelete      = $state<string | null>(null);
  let openMenuId        = $state<string | null>(null);
  let chatMenuPosition  = $state<{ x: number; y: number } | null>(null);
  let revealedChatId    = $state<string | null>(null);
  let suppressChatClick = $state<string | null>(null);
  let chatSwipe = $state<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    direction: 'none' | 'left' | 'right';
  } | null>(null);
  let chatToRename      = $state<string | null>(null);
  let renameValue       = $state('');
  let isConfirmingRename = false;

  $effect(() => {
    if (!chatToDelete && !chatToRename && !openMenuId && !revealedChatId) return;
    return registerBackHandler(() => {
      if (chatToDelete) chatToDelete = null;
      else if (chatToRename) cancelRename();
      else closeChatMenu();
      revealedChatId = null;
      return true;
    });
  });

  let hasMore  = $state(true);
  let isLoading = $state(false);
  let sentinel = $state<HTMLDivElement | null>(null);
  let renameInput = $state<HTMLInputElement | null>(null);
  let newFolderName = $state('');
  let isCreatingFolder = $state(false);
  let folderToRename = $state<string | null>(null);
  let folderRenameValue = $state('');
  let dragging = $state<{ type: 'chat' | 'folder'; id: string } | null>(null);
  let chatDrop = $state<{ id: string; position: 'before' | 'after' } | null>(null);
  let folderDrop = $state<{ id: string; position: 'before' | 'after' } | null>(null);
  let highlightedFolder = $state<string | null>(null);
  let looseHighlighted = $state(false);
  let dragImageElement = $state<HTMLDivElement | null>(null);
  let dragGhostElement = $state<HTMLDivElement | null>(null);
  let previewConversationOrder = $state<Conversation[] | null>(null);
  let previewFolderId = $state<string | null | undefined>(undefined);
  let dragGhost = $state<{
    top: number;
    left: number;
    width: number;
    height: number;
    offsetY: number;
    minTop: number;
    maxTop: number;
    title: string;
    detail: string;
  } | null>(null);

  let folders = $derived(chatState.folders.filter(folder => folder.mode === mode));
  let displayedConversations = $derived(previewConversationOrder ?? chatState.conversations);
  let looseChats = $derived(displayedConversations
    .filter(chat => chat.mode === mode && effectiveFolderId(chat) === null)
    .sort(compareRecentActivity));
  let openMenuChat = $derived(openMenuId
    ? chatState.conversations.find(chat => chat.id === openMenuId && chat.mode === mode) ?? null
    : null);

  let observer: IntersectionObserver | null = null;
  let ghostFrame: number | null = null;
  let pendingGhostTop = 0;
  let chatPreviewFrame: number | null = null;
  let dragListElement: HTMLElement | null = null;
  let lastPreviewFolderId: string | null | undefined = undefined;
  let lastPreviewIndex = -1;
  let pendingChatPreview: {
    folderId: string | null;
    clientY: number;
  } | null = null;
  const CHAT_INSERTION_DEAD_ZONE = 6;

  type ChatRowGeometry = {
    chat: Conversation;
    top: number;
    bottom: number;
    midpoint: number;
  };

  onMount(() => {
    if (layout === 'inline') initializeChats();
    document.addEventListener('click', closeMenuOnOutsideClick);
  });

  onDestroy(() => {
    if (observer) observer.disconnect();
    if (ghostFrame !== null) cancelAnimationFrame(ghostFrame);
    if (chatPreviewFrame !== null) cancelAnimationFrame(chatPreviewFrame);
    document.removeEventListener('click', closeMenuOnOutsideClick);
  });

  $effect(() => {
    if (layout === 'drawer' && isOpen) untrack(() => initializeChats());
  });

  $effect(() => {
    if (layout === 'drawer' && !isOpen && observer) observer.disconnect();
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
      await loadAllConversations(mode);
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
        hasMore = await loadMoreConversations(mode);
      } catch (error) {
        console.error("[Sidebar] Error loading more chats:", error);
      } finally {
        isLoading = false;
      }
    }, { threshold: 0.1 });
    observer.observe(sentinel);
  }

  async function loadChat(id: string) {
    const conversation = chatState.conversations.find((chat) => chat.id === id);
    if (!conversation || conversation.mode !== mode) return;
    await openHistoryChat(id);
    if (conversation?.mode === 'multiplayer') {
      await openPersistentSession(id, appState.activeCharacter);
      navigateTo('multiplayerRoom');
    } else {
      navigateTo('chat');
    }
    if (layout === 'drawer') close();
  }

  function toggleMenu(id: string, event: Event) {
    if (interactionMode !== 'mobile') return;
    event.stopPropagation();
    revealedChatId = null;
    if (openMenuId === id) {
      closeChatMenu();
      return;
    }
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    openMenuId = id;
    chatMenuPosition = {
      x: Math.max(8, Math.min(rect.right - 148, window.innerWidth - 156)),
      y: Math.min(rect.bottom + 6, window.innerHeight - 190),
    };
  }

  function closeMenuOnOutsideClick() {
    closeChatMenu();
    revealedChatId = null;
  }

  function closeChatMenu() {
    openMenuId = null;
    chatMenuPosition = null;
  }

  function openChatMenuFromContext(id: string, event: MouseEvent) {
    if (interactionMode !== 'desktop') return;
    event.preventDefault();
    event.stopPropagation();
    revealedChatId = null;
    openMenuId = id;
    chatMenuPosition = {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 156)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 190)),
    };
  }

  function beginChatSwipe(id: string, event: PointerEvent) {
    if (interactionMode !== 'mobile' || event.pointerType !== 'touch') return;
    chatSwipe = {
      id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      direction: 'none',
    };
  }

  function updateChatSwipe(id: string, event: PointerEvent) {
    const swipe = chatSwipe;
    if (!swipe || swipe.id !== id || swipe.pointerId !== event.pointerId) return;

    const horizontal = event.clientX - swipe.startX;
    const vertical = event.clientY - swipe.startY;
    if (swipe.direction === 'none') {
      // Let the drawer and normal vertical scrolling own ambiguous gestures.
      if (Math.abs(horizontal) < 24 || Math.abs(horizontal) <= Math.abs(vertical) * 1.35) return;
      // A rightward gesture belongs to the drawer unless this row is already
      // open and the gesture is explicitly closing its action reveal.
      if (horizontal > 0 && revealedChatId !== id) return;
      swipe.direction = horizontal < 0 ? 'left' : 'right';
      (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    }

    event.preventDefault();
    event.stopPropagation();
    if (swipe.direction === 'left') revealedChatId = id;
    else if (revealedChatId === id) revealedChatId = null;
  }

  function endChatSwipe(id: string, event: PointerEvent) {
    const swipe = chatSwipe;
    if (!swipe || swipe.id !== id || swipe.pointerId !== event.pointerId) return;
    if (swipe.direction !== 'none') {
      event.preventDefault();
      suppressChatClick = id;
      setTimeout(() => { if (suppressChatClick === id) suppressChatClick = null; }, 0);
    }
    const row = event.currentTarget as HTMLElement;
    if (row.hasPointerCapture(event.pointerId)) row.releasePointerCapture(event.pointerId);
    chatSwipe = null;
  }

  function handleChatClick(id: string) {
    if (suppressChatClick === id) return;
    if (revealedChatId !== null) {
      revealedChatId = null;
      return;
    }
    void loadChat(id);
  }

  async function handlePin(id: string, event: Event) {
    event.stopPropagation();
    closeChatMenu();
    await togglePinConversation(id);
  }

  function startRename(id: string, currentTitle: string, event: Event) {
    event.stopPropagation();
    closeChatMenu();
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
    closeChatMenu();
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

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return {
      destroy() {
        node.remove();
      },
    };
  }

  function handleWorldInfoClick() {
    if (onWorldInfoClick) { onWorldInfoClick(); return; }
    appState.listTab = 'worldinfo';
    navigateTo('list');
    if (layout === 'drawer') close();
  }

  function handleRolesClick() {
    appState.listTab = 'roles';
    navigateTo('list');
    if (layout === 'drawer') close();
  }

  function chatsInFolder(folderId: string) {
    return displayedConversations.filter(
      chat => chat.mode === mode && effectiveFolderId(chat) === folderId,
    );
  }

  function compareRecentActivity(a: Conversation, b: Conversation) {
    const activityDifference = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
    return activityDifference || b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);
  }

  function effectiveFolderId(chat: Conversation) {
    return dragging?.type === 'chat' && chat.id === dragging.id && previewFolderId !== undefined
      ? previewFolderId
      : chat.folder_id;
  }

  function chatCountInFolder(folderId: string | null, excludedId: string) {
    let count = 0;
    for (const chat of displayedConversations) {
      if (chat.mode === mode && chat.id !== excludedId && effectiveFolderId(chat) === folderId) count += 1;
    }
    return count;
  }

  function focusInput(node: HTMLInputElement) {
    node.focus();
  }

  async function addFolder() {
    const name = newFolderName.trim();
    if (!name) { isCreatingFolder = false; return; }
    try {
      await createChatFolder(name, mode);
      newFolderName = '';
      isCreatingFolder = false;
    } catch (error) { console.error('[Sidebar] Could not create folder:', error); }
  }

  async function finishFolderRename() {
    const id = folderToRename;
    const name = folderRenameValue.trim();
    folderToRename = null;
    if (!id || !name) return;
    try { await renameChatFolder(id, name); }
    catch (error) { console.error('[Sidebar] Could not rename folder:', error); }
  }

  async function toggleFolderCollapse(id: string, isCollapsed: boolean) {
    try { await setChatFolderCollapsed(id, !isCollapsed); }
    catch (error) { console.error('[Sidebar] Could not update folder state:', error); }
  }

  function beginDrag(event: DragEvent, type: 'chat' | 'folder', id: string) {
    if (chatToRename || folderToRename) { event.preventDefault(); return; }
    const source = event.currentTarget as HTMLElement;
    const list = source.closest('[data-sidebar-list]') as HTMLElement | null;
    const sourceRect = source.getBoundingClientRect();
    const listRect = list?.getBoundingClientRect() ?? sourceRect;
    const chatItem = type === 'chat'
      ? chatState.conversations.find(chat => chat.id === id)
      : undefined;
    const folderItem = type === 'folder'
      ? folders.find(folder => folder.id === id)
      : undefined;

    previewConversationOrder = null;
    previewFolderId = undefined;
    dragListElement = list;
    lastPreviewFolderId = chatItem?.folder_id;
    lastPreviewIndex = chatItem
      ? chatState.conversations
          .filter(chat => chat.mode === mode && chat.folder_id === chatItem.folder_id)
          .findIndex(chat => chat.id === chatItem.id)
      : -1;
    dragging = { type, id };
    dragGhost = {
      top: sourceRect.top,
      left: sourceRect.left,
      width: sourceRect.width,
      height: sourceRect.height,
      offsetY: event.clientY - sourceRect.top,
      minTop: listRect.top,
      maxTop: Math.max(listRect.top, listRect.bottom - sourceRect.height),
      title: chatItem?.title ?? folderItem?.name ?? '',
      detail: chatItem?.formattedDate ?? (folderItem ? m.sidebar_folders() : ''),
    };
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.clearData();
      event.dataTransfer.setData('application/x-ryokan-sidebar-item', JSON.stringify({ type, id }));
      event.dataTransfer.setData('text/plain', `${type}:${id}`);
      if (dragImageElement) event.dataTransfer.setDragImage(dragImageElement, 0, 0);
    }
  }

  function updateDragGhost(event: DragEvent) {
    if (!dragGhost || event.clientY <= 0) return;
    pendingGhostTop = Math.max(
      dragGhost.minTop,
      Math.min(event.clientY - dragGhost.offsetY, dragGhost.maxTop),
    );
    if (ghostFrame !== null) return;
    ghostFrame = requestAnimationFrame(() => {
      ghostFrame = null;
      if (!dragGhost || !dragGhostElement) return;
      const delta = pendingGhostTop - dragGhost.top;
      dragGhostElement.style.transform = `translate3d(0, ${delta}px, 0)`;
    });
  }

  function acceptMove(event: DragEvent) {
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    updateDragGhost(event);
  }

  function clearDragState() {
    if (ghostFrame !== null) cancelAnimationFrame(ghostFrame);
    if (chatPreviewFrame !== null) cancelAnimationFrame(chatPreviewFrame);
    ghostFrame = null;
    chatPreviewFrame = null;
    pendingChatPreview = null;
    dragListElement = null;
    lastPreviewFolderId = undefined;
    lastPreviewIndex = -1;
    dragging = null;
    chatDrop = null;
    folderDrop = null;
    highlightedFolder = null;
    looseHighlighted = false;
    dragGhost = null;
    previewConversationOrder = null;
    previewFolderId = undefined;
  }

  function endDrag() {
    clearDragState();
  }

  function leaveDropTarget(event: DragEvent, clear: () => void) {
    const current = event.currentTarget as HTMLElement;
    if (!(event.relatedTarget instanceof Node) || !current.contains(event.relatedTarget)) clear();
  }

  function insertionPosition(event: DragEvent): 'before' | 'after' {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    return event.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
  }

  function previewChatPosition(folderId: string | null, index: number) {
    if (dragging?.type !== 'chat') return;
    if (lastPreviewFolderId === folderId && lastPreviewIndex === index) return;
    const currentOrder = previewConversationOrder ?? chatState.conversations;
    const moved = currentOrder.find(chat => chat.id === dragging?.id);
    if (!moved) return;

    const currentFolderId = effectiveFolderId(moved);
    const currentGroup = currentOrder.filter(
      chat => chat.mode === mode && effectiveFolderId(chat) === currentFolderId,
    );
    const currentIndex = currentGroup.findIndex(chat => chat.id === moved.id);
    const remaining = currentOrder.filter(chat => chat.mode === mode && chat.id !== moved.id);
    const destination = remaining.filter(chat => chat.folder_id === folderId);
    const insertionIndex = folderId === null
      ? [...destination, moved].sort(compareRecentActivity).findIndex(chat => chat.id === moved.id)
      : Math.max(0, Math.min(index, destination.length));
    lastPreviewFolderId = folderId;
    lastPreviewIndex = insertionIndex;
    if (currentFolderId === folderId && currentIndex === insertionIndex) return;

    destination.splice(insertionIndex, 0, moved);

    const ordered = folders.flatMap(folder =>
      folder.id === folderId
        ? destination
        : remaining.filter(chat => chat.folder_id === folder.id)
    );
    const nextLoose = folderId === null
      ? destination
      : remaining.filter(chat => chat.folder_id === null);
    previewFolderId = folderId;
    previewConversationOrder = [
      ...currentOrder.filter(chat => chat.mode !== mode),
      ...ordered,
      ...nextLoose,
    ];
  }

  function stableRowGeometry(folderId: string | null): ChatRowGeometry[] {
    if (dragging?.type !== 'chat' || !dragListElement) return [];
    const rows: ChatRowGeometry[] = [];

    for (const element of dragListElement.querySelectorAll<HTMLElement>('[data-chat-row][data-chat-id]')) {
      const id = element.dataset.chatId;
      if (!id || id === dragging.id || !element.isConnected) continue;
      const chat = displayedConversations.find(candidate => candidate.id === id);
      if (!chat || chat.mode !== mode || effectiveFolderId(chat) !== folderId) continue;

      const rect = element.getBoundingClientRect();
      if (!Number.isFinite(rect.top) || rect.height <= 0) continue;

      // Svelte's FLIP animation temporarily translates row wrappers. Remove those
      // visual translations so hit-testing uses the settled layout positions.
      let translateY = 0;
      let ancestor = element.closest<HTMLElement>('[data-chat-row-layout]');
      while (ancestor) {
        const transform = getComputedStyle(ancestor).transform;
        if (transform !== 'none') {
          try { translateY += new DOMMatrixReadOnly(transform).m42; }
          catch { /* Ignore a transient/unparseable transform for this ancestor. */ }
        }
        ancestor = ancestor.parentElement?.closest<HTMLElement>('[data-chat-row-layout]') ?? null;
      }

      const top = rect.top - translateY;
      rows.push({ chat, top, bottom: top + rect.height, midpoint: top + rect.height / 2 });
    }

    return rows.sort((a, b) => a.top - b.top);
  }

  function resolveChatPreview(folderId: string | null, clientY: number) {
    if (dragging?.type !== 'chat') return;
    const rows = stableRowGeometry(folderId);
    const expectedRows = chatCountInFolder(folderId, dragging.id);
    // DOM reconciliation can leave a row detached for one frame. A partial
    // snapshot cannot safely distinguish that miss from the end of the list.
    if (rows.length !== expectedRows) return;
    if (rows.length === 0) return;

    const hitIndex = rows.findIndex(row => clientY >= row.top && clientY <= row.bottom);
    let rawIndex: number;

    if (hitIndex >= 0) {
      const distanceFromMidpoint = clientY - rows[hitIndex].midpoint;
      if (Math.abs(distanceFromMidpoint) <= CHAT_INSERTION_DEAD_ZONE) return;
      rawIndex = hitIndex + (distanceFromMidpoint > 0 ? 1 : 0);
    } else if (clientY > rows[rows.length - 1].bottom + CHAT_INSERTION_DEAD_ZONE) {
      // A miss is not an append. Only the real area below the final row is.
      rawIndex = rows.length;
    } else {
      return;
    }

    let nextIndex = rawIndex;
    if (lastPreviewFolderId === folderId && lastPreviewIndex >= 0) {
      nextIndex = Math.min(lastPreviewIndex, rows.length);
      while (nextIndex < rawIndex) {
        if (clientY <= rows[nextIndex].midpoint + CHAT_INSERTION_DEAD_ZONE) break;
        nextIndex += 1;
      }
      while (nextIndex > rawIndex) {
        if (clientY >= rows[nextIndex - 1].midpoint - CHAT_INSERTION_DEAD_ZONE) break;
        nextIndex -= 1;
      }
    }

    if (lastPreviewFolderId === folderId && lastPreviewIndex === nextIndex) return;
    const indicator = nextIndex === 0
      ? { id: rows[0].chat.id, position: 'before' as const }
      : { id: rows[nextIndex - 1].chat.id, position: 'after' as const };
    chatDrop = indicator;
    previewChatPosition(folderId, nextIndex);
    highlightedFolder = null;
    looseHighlighted = false;
  }

  function scheduleChatPreview(folderId: string | null, event: DragEvent) {
    pendingChatPreview = {
      folderId,
      clientY: event.clientY,
    };
    if (chatPreviewFrame !== null) return;
    chatPreviewFrame = requestAnimationFrame(() => {
      chatPreviewFrame = null;
      const pending = pendingChatPreview;
      pendingChatPreview = null;
      if (pending) resolveChatPreview(pending.folderId, pending.clientY);
    });
  }

  function flushChatPreview(folderId: string | null, event: DragEvent) {
    if (chatPreviewFrame !== null) cancelAnimationFrame(chatPreviewFrame);
    chatPreviewFrame = null;
    pendingChatPreview = null;
    resolveChatPreview(folderId, event.clientY);
  }

  function commitChatPreview() {
    if (dragging?.type !== 'chat' || !previewConversationOrder || previewFolderId === undefined) return;
    const moved = chatState.conversations.find(chat => chat.id === dragging?.id);
    if (!moved) return;
    moved.folder_id = previewFolderId;
    chatState.conversations = previewConversationOrder;
  }

  async function persistDrop() {
    commitChatPreview();
    try { await persistSidebarOrganization(mode); }
    catch (error) {
      console.error('[Sidebar] Could not save organization:', error);
      await loadAllConversations(mode);
    } finally { clearDragState(); }
  }

  async function dropChatInto(folderId: string | null, index: number) {
    if (dragging?.type !== 'chat') return;
    previewChatPosition(folderId, index);
    await persistDrop();
  }

  async function dropOnChat() {
    if (dragging?.type !== 'chat') return;
    await persistDrop();
  }

  async function dropFolder(targetId: string) {
    if (dragging?.type !== 'folder' || !folderDrop || dragging.id === targetId) return clearDragState();
    const moved = folders.find(folder => folder.id === dragging?.id);
    if (!moved) return;
    const ordered = folders.filter(folder => folder.id !== moved.id);
    const targetIndex = ordered.findIndex(folder => folder.id === targetId);
    ordered.splice(targetIndex + (folderDrop.position === 'after' ? 1 : 0), 0, moved);
    chatState.folders = ordered;
    await persistDrop();
  }
</script>

{#snippet chatRow(chat: Conversation)}
  <div class="relative w-full rounded-lg {interactionMode === 'mobile' ? 'overflow-hidden' : ''}">
    {#if interactionMode === 'mobile' && revealedChatId === chat.id}
      <button
        type="button"
        onclick={(event) => toggleMenu(chat.id, event)}
        class="absolute inset-y-0 right-0 flex w-[72px] items-center justify-center rounded-r-lg border-l border-white/[0.06] bg-white/[0.035] text-xs font-medium text-gray-400 transition-colors active:bg-white/[0.08]"
        aria-label={m.sidebar_aria_options()}
      >
        {m.sidebar_action_more()}
      </button>
    {/if}
    <div
      role="button"
      tabindex="0"
      data-chat-row
      data-chat-id={chat.id}
      draggable={chatToRename !== chat.id}
      ondragstart={(event) => beginDrag(event, 'chat', chat.id)}
      ondrag={(event) => updateDragGhost(event)}
      ondragend={endDrag}
      ondragenter={(event) => {
        if (dragging?.type !== 'chat') return;
        acceptMove(event);
        event.stopPropagation();
      }}
      ondragover={(event) => {
        if (dragging?.type !== 'chat') return;
        acceptMove(event);
        event.stopPropagation();
        if (dragging.id !== chat.id) {
          const folderId = effectiveFolderId(chat);
          if (folderId === null) {
            chatDrop = null;
            previewChatPosition(null, 0);
          } else {
            scheduleChatPreview(folderId, event);
          }
        }
      }}
      ondragleave={(event) => leaveDropTarget(event, () => {
        if (chatDrop?.id === chat.id) chatDrop = null;
      })}
      ondrop={(event) => {
        if (dragging?.type !== 'chat') return;
        acceptMove(event);
        event.stopPropagation();
        if (dragging.id !== chat.id) {
          const folderId = effectiveFolderId(chat);
          if (folderId === null) previewChatPosition(null, 0);
          else flushChatPreview(folderId, event);
        }
        void dropOnChat();
      }}
      oncontextmenu={interactionMode === 'desktop' ? (event) => openChatMenuFromContext(chat.id, event) : undefined}
      onpointerdown={interactionMode === 'mobile' ? (event) => beginChatSwipe(chat.id, event) : undefined}
      onpointermove={interactionMode === 'mobile' ? (event) => updateChatSwipe(chat.id, event) : undefined}
      onpointerup={interactionMode === 'mobile' ? (event) => endChatSwipe(chat.id, event) : undefined}
      onpointercancel={interactionMode === 'mobile' ? (event) => endChatSwipe(chat.id, event) : undefined}
      onclick={() => handleChatClick(chat.id)}
      onkeydown={(e) => e.key === 'Enter' && loadChat(chat.id)}
      class="relative z-10 w-full text-left p-3 rounded-lg group transition-[transform,background-color,border-color,opacity] duration-150 border cursor-pointer
             {interactionMode === 'mobile' ? 'touch-pan-y bg-ryokan-sidebar' : 'hover:bg-white/5'}
             {interactionMode === 'mobile' && revealedChatId === chat.id ? '-translate-x-[72px]' : 'translate-x-0'}
             {dragging?.type === 'chat' && dragging.id === chat.id ? 'opacity-40 border-transparent' : ''}
             {chatDrop?.id === chat.id && chatDrop.position === 'before' ? 'border-t-ryokan-accent border-x-transparent border-b-transparent' : ''}
             {chatDrop?.id === chat.id && chatDrop.position === 'after' ? 'border-b-ryokan-accent border-x-transparent border-t-transparent' : ''}
             {chatDrop?.id !== chat.id ? 'border-transparent hover:border-white/5' : ''}"
    >
      <div class={chat.is_pinned && interactionMode === 'desktop' ? 'pr-9' : ''}>
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

      {#if chatToRename !== chat.id && chat.is_pinned && interactionMode === 'desktop'}
        <div class="absolute right-2 top-1/2 -translate-y-1/2 w-7 h-7">
          <span
            class="pointer-events-none absolute inset-0 flex items-center justify-center text-ryokan-accent opacity-70"
            title={m.sidebar_title_pinned()}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
            </svg>
          </span>
        </div>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet chatActions(chat: Conversation)}
  <button
    onclick={(e) => handlePin(chat.id, e)}
    class="w-full flex items-center gap-2.5 px-3 py-2.5 text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors text-left"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="shrink-0 text-ryokan-accent/80">
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
    </svg>
    {chat.is_pinned ? m.sidebar_action_unpin() : m.sidebar_action_pin()}
  </button>
  <button
    onclick={(e) => startRename(chat.id, chat.title, e)}
    class="w-full flex items-center gap-2.5 px-3 py-2.5 text-gray-300 hover:text-white hover:bg-white/[0.08] transition-colors text-left"
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
    class="w-full flex items-center gap-2.5 px-3 py-2.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 transition-colors text-left"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
      <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>
    {m.sidebar_action_delete()}
  </button>
{/snippet}

{#snippet chatList()}
  <div data-sidebar-list class="space-y-2">
    <div class="flex items-center justify-between px-1">
      <span class="text-[10px] font-semibold uppercase tracking-wider text-gray-600">{m.sidebar_folders()}</span>
      <button type="button" onclick={() => isCreatingFolder = true} class="w-6 h-6 rounded-md text-gray-500 hover:text-ryokan-accent hover:bg-white/5" aria-label={m.sidebar_new_folder()}>＋</button>
    </div>

    {#if isCreatingFolder}
      <input use:focusInput bind:value={newFolderName} onblur={addFolder} onkeydown={(event) => {
        if (event.key === 'Enter') addFolder();
        if (event.key === 'Escape') { newFolderName = ''; isCreatingFolder = false; }
      }} placeholder={m.sidebar_folder_name()} class="w-full rounded-lg border border-ryokan-accent/40 bg-white/10 px-3 py-2 text-sm text-gray-100 outline-none" />
    {/if}

    {#each folders as folder (folder.id)}
      <section
        role="group"
        data-chat-row-layout
        animate:flip={{ duration: 160 }}
        class="rounded-lg transition-colors duration-150 {highlightedFolder === folder.id ? 'bg-ryokan-accent/10 ring-1 ring-ryokan-accent/70' : ''}"
        ondragenter={(event) => {
          if (dragging?.type !== 'chat' || (event.target as HTMLElement).closest('[data-chat-row]')) return;
          acceptMove(event);
          highlightedFolder = folder.id;
          folderDrop = null;
        }}
        ondragover={(event) => {
          if (dragging?.type !== 'chat' || (event.target as HTMLElement).closest('[data-chat-row]')) return;
          acceptMove(event);
          highlightedFolder = folder.id;
          folderDrop = null;
        }}
        ondragleave={(event) => leaveDropTarget(event, () => {
          if (highlightedFolder === folder.id) highlightedFolder = null;
        })}
        ondrop={(event) => {
          if (dragging?.type !== 'chat' || (event.target as HTMLElement).closest('[data-chat-row]')) return;
          acceptMove(event);
          event.stopPropagation();
          void dropChatInto(folder.id, chatsInFolder(folder.id).length);
        }}
      >
        <div
          role="listitem"
          class="group/folder flex items-center gap-2 rounded-lg border px-2 py-2 text-gray-300 transition-colors
                 {folderDrop?.id === folder.id && folderDrop.position === 'before' ? 'border-t-ryokan-accent border-x-transparent border-b-transparent' : ''}
                 {folderDrop?.id === folder.id && folderDrop.position === 'after' ? 'border-b-ryokan-accent border-x-transparent border-t-transparent' : ''}
                 {folderDrop?.id !== folder.id ? 'border-transparent' : ''}"
          draggable={folderToRename !== folder.id}
          ondragstart={(event) => beginDrag(event, 'folder', folder.id)}
          ondrag={(event) => updateDragGhost(event)}
          ondragend={endDrag}
          ondragenter={(event) => {
            if (dragging?.type !== 'folder') return;
            acceptMove(event);
            event.stopPropagation();
          }}
          ondragover={(event) => {
            if (dragging?.type !== 'folder') return;
            acceptMove(event);
            event.stopPropagation();
            const position = insertionPosition(event);
            if (folderDrop?.id !== folder.id || folderDrop.position !== position) {
              folderDrop = { id: folder.id, position };
            }
            highlightedFolder = null;
          }}
          ondragleave={(event) => leaveDropTarget(event, () => {
            if (folderDrop?.id === folder.id) folderDrop = null;
          })}
          ondrop={(event) => {
            if (dragging?.type !== 'folder') return;
            acceptMove(event);
            event.stopPropagation();
            void dropFolder(folder.id);
          }}
        >
          <svg class="shrink-0 text-gray-500" width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H2v16h20V6H12l-2-2z"/></svg>
          {#if folderToRename === folder.id}
            <input use:focusInput bind:value={folderRenameValue} onblur={finishFolderRename} onclick={(event) => event.stopPropagation()} onkeydown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') finishFolderRename();
              if (event.key === 'Escape') folderToRename = null;
            }} class="min-w-0 flex-1 rounded bg-white/10 px-1.5 py-0.5 text-sm outline-none ring-1 ring-ryokan-accent/50" />
          {:else}
            <button
              type="button"
              draggable="false"
              aria-expanded={!folder.is_collapsed}
              aria-label={folder.name}
              onclick={(event) => { event.stopPropagation(); void toggleFolderCollapse(folder.id, folder.is_collapsed); }}
              ondragstart={(event) => { event.preventDefault(); event.stopPropagation(); }}
              class="flex h-5 w-5 shrink-0 items-center justify-center rounded text-gray-600 hover:bg-white/5 hover:text-gray-300"
            >
              <svg class="transition-transform duration-150 {folder.is_collapsed ? '-rotate-90' : ''}" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            <span class="min-w-0 flex-1 truncate text-sm font-medium">{folder.name}</span>
            <span class="text-[10px] text-gray-600">{chatsInFolder(folder.id).length}</span>
            <button type="button" onclick={(event) => { event.stopPropagation(); folderToRename = folder.id; folderRenameValue = folder.name; }} class="opacity-70 lg:opacity-0 lg:group-hover/folder:opacity-100 text-gray-600 hover:text-gray-300" aria-label={m.sidebar_rename_folder()}>✎</button>
            <button type="button" onclick={(event) => { event.stopPropagation(); deleteChatFolder(folder.id); }} class="opacity-70 lg:opacity-0 lg:group-hover/folder:opacity-100 text-gray-600 hover:text-red-400" aria-label={m.sidebar_delete_folder()}>×</button>
          {/if}
        </div>
        {#if !folder.is_collapsed}
          <div class="ml-3 border-l border-white/5 pl-2 space-y-1 min-h-2">
            {#each chatsInFolder(folder.id) as chat (chat.id)}
              <div data-chat-row-layout animate:flip={{ duration: 160 }}>
                {@render chatRow(chat)}
              </div>
            {/each}
          </div>
        {/if}
      </section>
    {/each}

    <div
      role="group"
      aria-label={m.sidebar_loose_chats()}
      class="mt-3 rounded-lg transition-colors {looseHighlighted ? 'bg-white/[0.04] ring-1 ring-ryokan-accent/50' : ''}"
      ondragenter={(event) => {
        if (dragging?.type !== 'chat' || (event.target as HTMLElement).closest('[data-chat-row]')) return;
        acceptMove(event);
        looseHighlighted = true;
        highlightedFolder = null;
        chatDrop = null;
      }}
      ondragover={(event) => {
        if (dragging?.type !== 'chat' || (event.target as HTMLElement).closest('[data-chat-row]')) return;
        acceptMove(event);
        looseHighlighted = true;
        highlightedFolder = null;
        previewChatPosition(null, 0);
      }}
      ondragleave={(event) => leaveDropTarget(event, () => looseHighlighted = false)}
      ondrop={(event) => {
        if (dragging?.type !== 'chat') return;
        acceptMove(event);
        previewChatPosition(null, 0);
        void dropOnChat();
      }}
    >
      <div class="px-1 py-1 text-[10px] font-semibold uppercase tracking-wider text-gray-600">{m.sidebar_loose_chats()}</div>
      <div class="space-y-1 min-h-8">
        {#each looseChats as chat (chat.id)}
          <div data-chat-row-layout animate:flip={{ duration: 160 }}>
            {@render chatRow(chat)}
          </div>
        {/each}
        {#if looseChats.length === 0 && chatState.conversations.length === 0}
          <p class="py-8 text-center text-sm text-gray-600">{m.history_no_chats()}</p>
        {/if}
      </div>
    </div>
  </div>

  <div bind:this={sentinel} class="py-2 text-center text-gray-600 text-xs h-8">
    {#if isLoading}<span>…</span>{/if}
  </div>
{/snippet}

<div bind:this={dragImageElement} class="fixed -left-[9999px] top-0 h-px w-px opacity-0" aria-hidden="true"></div>

{#if dragging && dragGhost}
  <div
    bind:this={dragGhostElement}
    class="pointer-events-none fixed z-[100] rounded-lg border border-ryokan-accent/50 bg-ryokan-surface/95 px-3 py-2 shadow-2xl ring-1 ring-black/30 will-change-transform"
    style:left={`${dragGhost.left}px`}
    style:top={`${dragGhost.top}px`}
    style:width={`${dragGhost.width}px`}
    style:min-height={`${dragGhost.height}px`}
    aria-hidden="true"
  >
    <div class="truncate text-sm font-medium text-gray-100">{dragGhost.title}</div>
    {#if dragGhost.detail}<div class="mt-1 truncate text-[10px] text-gray-500">{dragGhost.detail}</div>{/if}
  </div>
{/if}

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
        <circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>
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

{#if layout === 'inline'}
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
    <div class="p-6 pt-[calc(1.5rem+env(safe-area-inset-top))] border-b border-white/5 flex justify-between items-center shrink-0">
      <h2 class="text-lg font-medium text-ryokan-accent">{m.history_title()}</h2>
      <button onclick={close} aria-label={m.history_close_label()} class="text-gray-500 hover:text-white">✕</button>
    </div>
    <div class="flex-1 overflow-y-auto p-4 space-y-2 min-h-0">
      {@render chatList()}
    </div>
    {@render navButtons()}
  </aside>
{/if}

{#if openMenuChat && chatMenuPosition}
  <div
    use:portal
    class="fixed z-[1000] min-w-[148px] overflow-hidden rounded-lg border border-white/10 bg-ryokan-surface text-sm shadow-xl"
    style:left={`${chatMenuPosition.x}px`}
    style:top={`${chatMenuPosition.y}px`}
    transition:scale={{ duration: 100, start: 0.95 }}
  >
    {@render chatActions(openMenuChat)}
  </div>
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
