<script lang="ts">
  import { reportDiagnostic } from '$lib/utils/diagnostics';
  import { flip } from 'svelte/animate';
  import type { AnimationConfig } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { scale, slide } from 'svelte/transition';
  import { chatState, openHistoryChat, loadAllConversations, loadMoreConversations, loadMoreFolderConversations, deleteConversation, renameConversation, togglePinConversation, createChatFolder, renameChatFolder, setChatFolderCollapsed, deleteChatFolder, persistSidebarOrganization, type Conversation, type ConversationMode } from '$lib/stores/chatStore.svelte';
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
  let contextTarget     = $state<{ type: 'chat' | 'folder'; id: string } | null>(null);
  let contextMenuPosition = $state<{ x: number; y: number } | null>(null);
  let pressedItemKey    = $state<string | null>(null);
  let suppressActivationKey = $state<string | null>(null);
  let chatToRename      = $state<string | null>(null);
  let renameValue       = $state('');
  let isConfirmingRename = false;

  $effect(() => {
    if (!chatToDelete && !chatToRename && !folderToRename && !contextTarget) return;
    return registerBackHandler(() => {
      if (chatToDelete) chatToDelete = null;
      else if (chatToRename) cancelRename();
      else if (folderToRename) folderToRename = null;
      else closeContextMenu();
      return true;
    });
  });

  let hasMore  = $state(true);
  let isLoading = $state(false);
  let folderHasMore = $state<Record<string, boolean>>({});
  let folderLoading = $state<Record<string, boolean>>({});
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
  let dragSourceFolderId = $state<string | null | undefined>(undefined);
  let mobileDropValid = $state(false);
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
  // Keep touch targets and drop zones mounted in their original positions until
  // release. Preview membership still drives the shared commit and live counts.
  let renderedConversations = $derived(interactionMode === 'mobile' && dragging
    ? chatState.conversations : displayedConversations);
  let looseChats = $derived(renderedConversations
    .filter(chat => chat.mode === mode && renderedFolderId(chat) === null)
    .sort(compareLooseChatOrder));
  let contextMenuChat = $derived(contextTarget?.type === 'chat'
    ? chatState.conversations.find(chat => chat.id === contextTarget?.id && chat.mode === mode) ?? null
    : null);
  let contextMenuFolder = $derived(contextTarget?.type === 'folder'
    ? folders.find(folder => folder.id === contextTarget?.id) ?? null
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
    document.addEventListener('keydown', closeMenuOnEscape);
  });

  onDestroy(() => {
    if (observer) observer.disconnect();
    if (ghostFrame !== null) cancelAnimationFrame(ghostFrame);
    if (chatPreviewFrame !== null) cancelAnimationFrame(chatPreviewFrame);
    clearDragState();
    document.removeEventListener('click', closeMenuOnOutsideClick);
    document.removeEventListener('keydown', closeMenuOnEscape);
  });

  $effect(() => {
    if (layout === 'drawer' && isOpen) untrack(() => initializeChats());
  });

  $effect(() => {
    if (layout !== 'drawer' || isOpen) return;
    if (observer) observer.disconnect();
    clearDragState();
    closeContextMenu();
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
      hasMore = chatState.conversations.filter(
        chat => chat.mode === mode && chat.folder_id === null,
      ).length === 10;
      folderHasMore = Object.fromEntries(
        chatState.folders
          .filter(folder => folder.mode === mode && !folder.is_collapsed)
          .map(folder => [folder.id, chatsInFolder(folder.id).length < folder.chat_count]),
      );
    } catch (error) {
      reportDiagnostic('sidebar');
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
        reportDiagnostic('sidebar');
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

  function closeMenuOnOutsideClick() {
    if (interactionMode === 'desktop') closeContextMenu();
  }

  async function loadMoreFromFolder(folderId: string) {
    if (folderLoading[folderId] || !folderHasMore[folderId]) return;
    folderLoading = { ...folderLoading, [folderId]: true };
    try {
      const moreAvailable = await loadMoreFolderConversations(folderId);
      folderHasMore = { ...folderHasMore, [folderId]: moreAvailable };
    } catch (error) {
      reportDiagnostic('sidebar');
    } finally {
      folderLoading = { ...folderLoading, [folderId]: false };
    }
  }

  function observeFolderSentinel(node: HTMLElement, folderId: string) {
    const folderObserver = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) void loadMoreFromFolder(folderId);
    }, { threshold: 0.1 });
    folderObserver.observe(node);
    return { destroy: () => folderObserver.disconnect() };
  }

  function closeMenuOnEscape(event: KeyboardEvent) {
    if (event.key === 'Escape') closeContextMenu();
  }

  function closeContextMenu() {
    contextTarget = null;
    contextMenuPosition = null;
  }

  function itemKey(type: 'chat' | 'folder', id: string) {
    return `${type}:${id}`;
  }

  function suppressItemActivation(type: 'chat' | 'folder', id: string) {
    const key = itemKey(type, id);
    suppressActivationKey = key;
    setTimeout(() => { if (suppressActivationKey === key) suppressActivationKey = null; }, 700);
  }

  function openContextMenuFromPointer(type: 'chat' | 'folder', id: string, event: MouseEvent) {
    if (interactionMode !== 'desktop') return;
    event.preventDefault();
    event.stopPropagation();
    contextTarget = { type, id };
    contextMenuPosition = {
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 176)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - (type === 'chat' ? 174 : 120))),
    };
  }

  function openContextMenuFromKeyboard(type: 'chat' | 'folder', id: string, event: KeyboardEvent) {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    contextTarget = { type, id };
    contextMenuPosition = interactionMode === 'desktop'
      ? { x: Math.min(rect.left + 24, window.innerWidth - 176), y: Math.min(rect.bottom, window.innerHeight - 174) }
      : null;
  }

  export function setMobilePressed(type: 'chat' | 'folder', id: string, pressed: boolean) {
    pressedItemKey = pressed ? itemKey(type, id) : null;
  }

  export function suppressMobileActivation(type: 'chat' | 'folder', id: string) {
    suppressItemActivation(type, id);
  }

  export function beginMobileDrag(source: HTMLElement, type: 'chat' | 'folder', id: string, clientY: number) {
    suppressItemActivation(type, id);
    pressedItemKey = null;
    startDrag(source, type, id, clientY);
  }

  export function updateMobileDrag(clientX: number, clientY: number) {
    updateDragGhostAt(clientY);
    updateMobileDropTarget(clientX, clientY);
  }

  export function completeMobileDrag(clientX: number, clientY: number) {
    return finishMobileDrag(clientX, clientY);
  }

  export function cancelMobileDrag() {
    clearDragState();
    pressedItemKey = null;
  }

  export function openMobileActions(type: 'chat' | 'folder', id: string) {
    contextTarget = { type, id };
    contextMenuPosition = null;
  }

  function handleContextBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) closeContextMenu();
  }

  function handleChatClick(id: string) {
    const key = itemKey('chat', id);
    if (suppressActivationKey === key) {
      suppressActivationKey = null;
      return;
    }
    void loadChat(id);
  }

  function handleFolderClick(id: string, isCollapsed: boolean) {
    const key = itemKey('folder', id);
    if (suppressActivationKey === key) {
      suppressActivationKey = null;
      return;
    }
    void toggleFolderCollapse(id, isCollapsed);
  }

  async function handlePin(id: string, event: Event) {
    event.stopPropagation();
    closeContextMenu();
    await togglePinConversation(id);
  }

  function startRename(id: string, currentTitle: string, event: Event) {
    event.stopPropagation();
    closeContextMenu();
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
    closeContextMenu();
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
    ).sort(comparePinnedState);
  }

  function renderedFolderId(chat: Conversation) {
    return interactionMode === 'mobile' && dragging ? chat.folder_id : effectiveFolderId(chat);
  }

  function renderedChatsInFolder(folderId: string) {
    return renderedConversations.filter(
      chat => chat.mode === mode && renderedFolderId(chat) === folderId,
    ).sort(comparePinnedState);
  }

  function animateFolder(node: Element, rects: { from: DOMRect; to: DOMRect }): AnimationConfig {
    if (interactionMode === 'desktop') return flip(node, rects, { duration: 190, easing: cubicOut });
    // A drop changes the section's height. Scaling the whole section with FLIP
    // also squashes its icon and header; on mobile animate only its position.
    const dx = rects.from.left - rects.to.left;
    const dy = rects.from.top - rects.to.top;
    return {
      duration: dx === 0 && dy === 0 ? 0 : 190,
      easing: cubicOut,
      css: (_t, u) => `transform: translate(${u * dx}px, ${u * dy}px)`,
    };
  }

  function displayedFolderCount(folderId: string, persistedCount: number, isCollapsed: boolean) {
    if (!isCollapsed) return chatsInFolder(folderId).length;
    if (dragging?.type !== 'chat' || previewFolderId === undefined || dragSourceFolderId === previewFolderId) {
      return persistedCount;
    }
    if (folderId === dragSourceFolderId) return Math.max(0, persistedCount - 1);
    if (folderId === previewFolderId) return persistedCount + 1;
    return persistedCount;
  }

  function comparePinnedState(a: Conversation, b: Conversation) {
    return Number(b.is_pinned) - Number(a.is_pinned);
  }

  function compareLooseChatOrder(a: Conversation, b: Conversation) {
    return comparePinnedState(a, b) || compareRecentActivity(a, b);
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
    } catch (error) { reportDiagnostic('sidebar'); }
  }

  async function finishFolderRename() {
    const id = folderToRename;
    const name = folderRenameValue.trim();
    folderToRename = null;
    if (!id || !name) return;
    try { await renameChatFolder(id, name); }
    catch (error) { reportDiagnostic('sidebar'); }
  }

  function startFolderRename(id: string, currentName: string, event: Event) {
    event.stopPropagation();
    closeContextMenu();
    folderToRename = id;
    folderRenameValue = currentName;
  }

  async function handleFolderDelete(id: string, event: Event) {
    event.stopPropagation();
    closeContextMenu();
    try { await deleteChatFolder(id); }
    catch (error) { reportDiagnostic('sidebar'); }
  }

  async function toggleFolderCollapse(id: string, isCollapsed: boolean) {
    if (folderLoading[id]) return;
    folderLoading = { ...folderLoading, [id]: true };
    try {
      const moreAvailable = await setChatFolderCollapsed(id, !isCollapsed);
      folderHasMore = { ...folderHasMore, [id]: moreAvailable };
    }
    catch (error) {
      const folder = folders.find(item => item.id === id);
      if (folder && !folder.is_collapsed) {
        folderHasMore = {
          ...folderHasMore,
          [id]: chatsInFolder(id).length < folder.chat_count,
        };
      }
      reportDiagnostic('sidebar');
    }
    finally { folderLoading = { ...folderLoading, [id]: false }; }
  }

  function beginDrag(event: DragEvent, type: 'chat' | 'folder', id: string) {
    if (chatToRename || folderToRename) { event.preventDefault(); return; }
    const source = event.currentTarget as HTMLElement;
    startDrag(source, type, id, event.clientY);
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.clearData();
      event.dataTransfer.setData('application/x-ryokan-sidebar-item', JSON.stringify({ type, id }));
      event.dataTransfer.setData('text/plain', `${type}:${id}`);
      if (dragImageElement) event.dataTransfer.setDragImage(dragImageElement, 0, 0);
    }
  }

  function startDrag(source: HTMLElement, type: 'chat' | 'folder', id: string, clientY: number) {
    if (chatToRename || folderToRename) return;
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
    dragSourceFolderId = chatItem?.folder_id;
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
      offsetY: clientY - sourceRect.top,
      minTop: listRect.top,
      maxTop: Math.max(listRect.top, listRect.bottom - sourceRect.height),
      title: chatItem?.title ?? folderItem?.name ?? '',
      detail: chatItem?.formattedDate ?? (folderItem ? m.sidebar_folders() : ''),
    };
  }

  function updateDragGhost(event: DragEvent) {
    updateDragGhostAt(event.clientY);
  }

  function updateDragGhostAt(clientY: number) {
    if (!dragGhost || clientY <= 0) return;
    pendingGhostTop = Math.max(
      dragGhost.minTop,
      Math.min(clientY - dragGhost.offsetY, dragGhost.maxTop),
    );
    if (ghostFrame !== null) return;
    ghostFrame = requestAnimationFrame(() => {
      ghostFrame = null;
      if (!dragGhost || !dragGhostElement) return;
      const delta = Math.round(pendingGhostTop - dragGhost.top);
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
    dragSourceFolderId = undefined;
    mobileDropValid = false;
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

  function updateMobileDropTarget(clientX: number, clientY: number) {
    if (!dragging) return;
    const hit = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    let target = hit && dragListElement?.contains(hit) ? hit : null;
    // Small layout gaps between sections should not turn a deliberate drop into
    // a cancellation. Only bridge nearby gaps inside this list, never outside it.
    const selector = dragging.type === 'folder'
      ? '[data-folder-row][data-folder-id]'
      : '[data-folder-section][data-folder-id], [data-loose-chats]';
    if (target && !target.closest(selector)) {
      let nearestDistance = 12;
      for (const zone of dragListElement!.querySelectorAll<HTMLElement>(selector)) {
        const rect = zone.getBoundingClientRect();
        if (rect.height <= 0 || clientX < rect.left || clientX > rect.right) continue;
        const distance = Math.max(rect.top - clientY, clientY - rect.bottom, 0);
        if (distance < nearestDistance) {
          target = zone;
          nearestDistance = distance;
        }
      }
    }
    mobileDropValid = false;

    if (dragging.type === 'folder') {
      const row = target?.closest<HTMLElement>('[data-folder-row][data-folder-id]');
      const id = row?.dataset.folderId;
      if (!row || !id || id === dragging.id) {
        folderDrop = null;
        return;
      }
      const rect = row.getBoundingClientRect();
      folderDrop = { id, position: clientY < rect.top + rect.height / 2 ? 'before' : 'after' };
      highlightedFolder = null;
      mobileDropValid = true;
      return;
    }

    const chatRow = target?.closest<HTMLElement>('[data-chat-row][data-chat-id]');
    const targetChat = chatRow
      ? displayedConversations.find(chat => chat.id === chatRow.dataset.chatId)
      : null;
    if (targetChat && targetChat.id !== dragging.id) {
      const folderId = effectiveFolderId(targetChat);
      if (folderId === null) previewChatPosition(null, 0);
      else {
        const destination = renderedChatsInFolder(folderId).filter(chat => chat.id !== dragging?.id);
        const index = destination.findIndex(chat => chat.id === targetChat.id);
        const rect = chatRow!.getBoundingClientRect();
        previewChatPosition(folderId, index + (clientY >= rect.top + rect.height / 2 ? 1 : 0));
      }
      highlightedFolder = folderId;
      looseHighlighted = folderId === null;
      mobileDropValid = true;
      return;
    }

    const folderSection = target?.closest<HTMLElement>('[data-folder-section][data-folder-id]');
    const folderId = folderSection?.dataset.folderId;
    if (folderId) {
      previewChatPosition(folderId, chatsInFolder(folderId).length);
      highlightedFolder = folderId;
      looseHighlighted = false;
      chatDrop = null;
      mobileDropValid = true;
      return;
    }

    if (target?.closest('[data-loose-chats]')) {
      previewChatPosition(null, 0);
      highlightedFolder = null;
      looseHighlighted = true;
      chatDrop = null;
      mobileDropValid = true;
      return;
    }

    highlightedFolder = null;
    looseHighlighted = false;
    chatDrop = null;
  }

  async function finishMobileDrag(clientX: number, clientY: number) {
    updateMobileDropTarget(clientX, clientY);
    if (!dragging || !mobileDropValid) return clearDragState();
    if (dragging.type === 'folder') {
      const targetId = folderDrop?.id;
      if (!targetId) return clearDragState();
      await dropFolder(targetId);
      return;
    }
    await persistDrop();
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
      reportDiagnostic('sidebar');
      await loadAllConversations(mode);
    } finally {
      clearDragState();
    }
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
  <div class="relative w-full rounded-[10px]">
    <div
      role="button"
      tabindex="0"
      data-chat-row
      data-chat-id={chat.id}
      draggable={interactionMode === 'desktop' && chatToRename !== chat.id}
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
      oncontextmenu={(event) => interactionMode === 'desktop' ? openContextMenuFromPointer('chat', chat.id, event) : event.preventDefault()}
      onclick={() => handleChatClick(chat.id)}
      onkeydown={(event) => {
        openContextMenuFromKeyboard('chat', chat.id, event);
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); handleChatClick(chat.id); }
      }}
      aria-current={chatState.activeChatId === chat.id ? 'page' : undefined}
      class="sidebar-item chat-row relative z-10 w-full text-left border cursor-pointer
             {chatState.activeChatId === chat.id ? 'sidebar-item--active' : ''}
             {pressedItemKey === itemKey('chat', chat.id) ? 'sidebar-item--pressed' : ''}
             {dragging?.type === 'chat' && dragging.id === chat.id ? 'sidebar-item--drag-source border-transparent' : ''}
             {chatDrop?.id === chat.id && chatDrop.position === 'before' ? 'border-t-ryokan-accent border-x-transparent border-b-transparent' : ''}
             {chatDrop?.id === chat.id && chatDrop.position === 'after' ? 'border-b-ryokan-accent border-x-transparent border-t-transparent' : ''}
             {chatDrop?.id !== chat.id ? 'border-transparent' : ''}"
    >
      <span class="chat-row-icon" class:chat-row-icon--pinned={chat.is_pinned} aria-hidden="true">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/>
        </svg>
      </span>
      <div class="chat-row-copy">
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
          <div class="chat-row-title">
            {chat.title}
          </div>
          <div class="chat-row-date">
            {chat.formattedDate}
          </div>
        {/if}
      </div>

      {#if chatToRename !== chat.id && chat.is_pinned}
        <span class="chat-pin" title={m.sidebar_title_pinned()} aria-label={m.sidebar_title_pinned()}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/></svg>
        </span>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet chatActions(chat: Conversation)}
  <button
    onclick={(e) => handlePin(chat.id, e)}
    class="context-action"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" class="shrink-0 text-ryokan-accent/80">
      <path d="M16 12V4h1V2H7v2h1v8l-2 2v2h5.2v6h1.6v-6H18v-2l-2-2z"/>
    </svg>
    {chat.is_pinned ? m.sidebar_action_unpin() : m.sidebar_action_pin()}
  </button>
  <button
    onclick={(e) => startRename(chat.id, chat.title, e)}
    class="context-action"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
    {m.sidebar_action_rename()}
  </button>
  <div class="context-separator"></div>
  <button
    onclick={(e) => promptDelete(chat.id, e)}
    class="context-action context-action--danger"
  >
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
      <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>
    {m.sidebar_action_delete()}
  </button>
{/snippet}

{#snippet folderActions(folder: { id: string; name: string })}
  <button onclick={(event) => startFolderRename(folder.id, folder.name, event)} class="context-action">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
    {m.sidebar_action_rename()}
  </button>
  <div class="context-separator"></div>
  <button onclick={(event) => handleFolderDelete(folder.id, event)} class="context-action context-action--danger">
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="shrink-0">
      <path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
    </svg>
    {m.sidebar_action_delete()}
  </button>
{/snippet}

{#snippet chatList()}
  <div
    data-sidebar-list
    class="sidebar-list"
    class:sidebar-list--dragging-chat={dragging?.type === 'chat'}
  >
    <div class="section-heading">
      <span>{m.sidebar_folders()}</span>
      <button type="button" onclick={() => isCreatingFolder = true} class="add-folder-button" aria-label={m.sidebar_new_folder()}>＋</button>
    </div>

    {#if isCreatingFolder}
      <div transition:slide={{ duration: 180, easing: cubicOut }}>
        <input use:focusInput bind:value={newFolderName} onblur={addFolder} onkeydown={(event) => {
          if (event.key === 'Enter') addFolder();
          if (event.key === 'Escape') { newFolderName = ''; isCreatingFolder = false; }
        }} placeholder={m.sidebar_folder_name()} class="w-full rounded-lg border border-ryokan-accent/40 bg-white/10 px-3 py-2 text-sm text-gray-100 outline-none" />
      </div>
    {/if}

    {#each folders as folder (folder.id)}
      <section
        role="group"
        data-folder-section
        data-folder-id={folder.id}
        data-chat-row-layout
        animate:animateFolder
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
          role="button"
          tabindex="0"
          aria-expanded={!folder.is_collapsed}
          data-folder-row
          data-folder-id={folder.id}
          class="sidebar-item folder-row border text-gray-300
                 {pressedItemKey === itemKey('folder', folder.id) ? 'sidebar-item--pressed' : ''}
                 {folderDrop?.id === folder.id && folderDrop.position === 'before' ? 'border-t-ryokan-accent border-x-transparent border-b-transparent' : ''}
                 {folderDrop?.id === folder.id && folderDrop.position === 'after' ? 'border-b-ryokan-accent border-x-transparent border-t-transparent' : ''}
                 {folderDrop?.id !== folder.id ? 'border-transparent' : ''}"
          draggable={interactionMode === 'desktop' && folderToRename !== folder.id}
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
          oncontextmenu={(event) => interactionMode === 'desktop' ? openContextMenuFromPointer('folder', folder.id, event) : event.preventDefault()}
          onclick={() => folderToRename !== folder.id && handleFolderClick(folder.id, folder.is_collapsed)}
          onkeydown={(event) => {
            openContextMenuFromKeyboard('folder', folder.id, event);
            if (folderToRename !== folder.id && (event.key === 'Enter' || event.key === ' ')) {
              event.preventDefault();
              handleFolderClick(folder.id, folder.is_collapsed);
            }
          }}
        >
          <span class="folder-row-icon" aria-hidden="true">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M10 4H2v16h20V6H12l-2-2z"/></svg>
          </span>
          {#if folderToRename === folder.id}
            <input use:focusInput bind:value={folderRenameValue} onblur={finishFolderRename} onclick={(event) => event.stopPropagation()} onkeydown={(event) => {
              event.stopPropagation();
              if (event.key === 'Enter') finishFolderRename();
              if (event.key === 'Escape') folderToRename = null;
            }} class="min-w-0 flex-1 rounded bg-white/10 px-1.5 py-0.5 text-sm outline-none ring-1 ring-ryokan-accent/50" />
          {:else}
            <span class="folder-row-name">{folder.name}</span>
            <span class="folder-row-count">{displayedFolderCount(folder.id, folder.chat_count, folder.is_collapsed)}</span>
            <svg class="folder-chevron {folder.is_collapsed ? '-rotate-90' : ''}" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.25" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>
          {/if}
        </div>
        <div
          class="folder-contents"
          class:folder-contents--expanded={!folder.is_collapsed}
          aria-hidden={folder.is_collapsed}
          inert={folder.is_collapsed}
        >
          <div class="folder-contents-inner ml-3 border-l border-white/5 pl-2">
            <div class="space-y-1 min-h-2">
            {#each renderedChatsInFolder(folder.id) as chat (chat.id)}
              <div data-chat-row-layout animate:flip={{ duration: 170, easing: cubicOut }}>
                {@render chatRow(chat)}
              </div>
            {/each}
            {#if folderLoading[folder.id] || folderHasMore[folder.id]}
              <div use:observeFolderSentinel={folder.id} class="h-6 text-center text-xs text-gray-600">
                {#if folderLoading[folder.id]}…{/if}
              </div>
            {/if}
            </div>
          </div>
        </div>
      </section>
    {/each}

    <div
      role="group"
      data-loose-chats
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
      <div class="section-heading section-heading--chats">{m.sidebar_loose_chats()}</div>
      <div class="space-y-1 min-h-8">
        {#each looseChats as chat (chat.id)}
          <div data-chat-row-layout animate:flip={{ duration: 170, easing: cubicOut }}>
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
  <div class="sidebar-footer border-t border-white/5 flex gap-2 shrink-0">
    <button
      onclick={handleRolesClick}
      class="bottom-nav-button"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>
      </svg>
      <span>{m.sidebar_roles()}</span>
    </button>
    <button
      onclick={handleWorldInfoClick}
      class="bottom-nav-button"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="2" y1="12" x2="22" y2="12"/>
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
      </svg>
      <span>{m.sidebar_worldinfo()}</span>
    </button>
  </div>
{/snippet}

{#if layout === 'inline'}
  <aside class="sidebar-shell w-64 h-full border-r border-white/5 flex flex-col shrink-0">
    <div class="sidebar-header">
      <h2 class="text-lg font-medium text-ryokan-accent">{m.history_title()}</h2>
    </div>
    <div class="sidebar-scroll flex-1 overflow-y-auto min-h-0">
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

  <aside class="sidebar-shell fixed left-0 top-0 bottom-0 w-72 border-r border-white/5 shadow-2xl z-50 flex flex-col bg-ryokan-sidebar">
    <div class="sidebar-header sidebar-header--drawer flex justify-between items-center shrink-0">
      <h2 class="text-lg font-medium text-ryokan-accent">{m.history_title()}</h2>
      <button onclick={close} aria-label={m.history_close_label()} class="sidebar-close-button">✕</button>
    </div>
    <div class="sidebar-scroll flex-1 overflow-y-auto min-h-0">
      {@render chatList()}
    </div>
    {@render navButtons()}
  </aside>
{/if}

{#if interactionMode === 'desktop' && contextMenuPosition && (contextMenuChat || contextMenuFolder)}
  <div
    use:portal
    role="menu"
    tabindex="-1"
    class="context-menu fixed z-[1000]"
    style:left={`${contextMenuPosition.x}px`}
    style:top={`${contextMenuPosition.y}px`}
    transition:scale={{ duration: 100, start: 0.95 }}
  >
    {#if contextMenuChat}{@render chatActions(contextMenuChat)}
    {:else if contextMenuFolder}{@render folderActions(contextMenuFolder)}{/if}
  </div>
{/if}

{#if interactionMode === 'mobile' && (contextMenuChat || contextMenuFolder)}
  <div use:portal class="context-sheet-backdrop" role="presentation" onclick={handleContextBackdropClick}>
    <div class="context-sheet" role="dialog" tabindex="-1" aria-modal="true" aria-label={m.sidebar_aria_options()} transition:scale={{ duration: 120, start: 0.97 }}>
      <div class="context-sheet-handle" aria-hidden="true"></div>
      <div class="context-sheet-title">{contextMenuChat?.title ?? contextMenuFolder?.name}</div>
      <div class="context-sheet-actions">
        {#if contextMenuChat}{@render chatActions(contextMenuChat)}
        {:else if contextMenuFolder}{@render folderActions(contextMenuFolder)}{/if}
      </div>
    </div>
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

<style>
  .sidebar-shell { background:var(--color-ryokan-sidebar,#1e1f20); }
  .sidebar-header { min-height:76px; display:flex; align-items:center; padding:16px 24px; border-bottom:1px solid rgba(255,255,255,.045); }
  .sidebar-header--drawer { padding-top:calc(16px + env(safe-area-inset-top)); }
  .sidebar-scroll { padding:16px 12px 22px; overflow-x:hidden; scrollbar-width:none; }
  .sidebar-scroll::-webkit-scrollbar { display:none; }
  .sidebar-list { display:flex; flex-direction:column; gap:5px; }
  .section-heading { min-height:32px; display:flex; align-items:center; justify-content:space-between; padding:0 8px; color:#626267; font-size:10px; font-weight:650; letter-spacing:.09em; text-transform:uppercase; }
  .section-heading--chats { margin-top:8px; }
  .add-folder-button,.sidebar-close-button { width:36px; height:36px; display:grid; place-items:center; border-radius:9px; color:#6d6d72; cursor:pointer; transition:color .15s,background .15s,transform .1s; }
  .add-folder-button { margin-right:-6px; font-size:18px; font-weight:350; }
  .add-folder-button:hover,.sidebar-close-button:hover { color:#d4b483; background:rgba(255,255,255,.04); }
  .add-folder-button:active,.sidebar-close-button:active { transform:scale(.96); background:rgba(255,255,255,.07); }
  .sidebar-footer { padding:8px 10px; }
  .bottom-nav-button { min-height:40px; flex:1; display:flex; align-items:center; justify-content:center; gap:8px; padding:8px 10px; border:0; border-radius:8px; background:transparent; color:#737378; font-size:12px; font-weight:550; line-height:1; cursor:pointer; transition:background .14s ease,color .14s ease; }
  .bottom-nav-button:active { background:rgba(212,180,131,.075); }
  .sidebar-item { box-sizing:border-box; border-radius:10px; user-select:none; -webkit-user-select:none; transition:background .09s ease,color .09s ease,border-color .09s ease,opacity .09s ease; }
  .sidebar-item:active,.sidebar-item--pressed { background:rgba(212,180,131,.075); }
  .sidebar-item--active { background:rgba(212,180,131,.07); }
  .sidebar-item--drag-source { opacity:0; transition:none; }
  .sidebar-item:focus-visible { outline:1px solid rgba(212,180,131,.48); outline-offset:-1px; }
  .folder-row { width:100%; min-height:44px; display:flex; align-items:center; gap:10px; padding:6px 9px; cursor:pointer; touch-action:pan-y; }
  .folder-row-icon { width:30px; height:30px; flex:0 0 auto; display:grid; place-items:center; border-radius:9px; color:#a99473; background:rgba(212,180,131,.065); }
  .folder-row-name { min-width:0; flex:1; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#d4d1ce; font-size:13px; font-weight:610; }
  .folder-row-count { min-width:16px; color:#5e5e63; font-size:10px; text-align:right; font-variant-numeric:tabular-nums; }
  .folder-chevron { flex:0 0 auto; color:#55555a; transition:transform .2s cubic-bezier(.22,1,.36,1),color .14s ease; will-change:transform; }
  .folder-row:hover .folder-chevron { color:#858589; }
  .folder-contents { display:grid; grid-template-rows:0fr; opacity:0; transition:grid-template-rows .22s cubic-bezier(.22,1,.36,1),opacity .14s ease; }
  .folder-contents--expanded { grid-template-rows:1fr; opacity:1; }
  .folder-contents-inner { min-height:0; overflow:hidden; }
  .chat-row { min-height:48px; display:flex; align-items:center; gap:10px; padding:7px 9px; touch-action:pan-y; }
  .chat-row-icon { width:30px; height:30px; flex:0 0 auto; display:grid; place-items:center; border-radius:9px; color:#64646a; background:rgba(255,255,255,.025); }
  .chat-row-icon--pinned { color:#b79b71; background:rgba(212,180,131,.055); }
  .chat-row-copy { min-width:0; flex:1; }
  .chat-row-title { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#cfcdca; font-size:13px; font-weight:570; line-height:1.25; transition:color .14s; }
  .chat-row:hover .chat-row-title,.sidebar-item--active .chat-row-title { color:#e4d8c6; }
  .sidebar-list--dragging-chat .chat-row-title { transition:none; }
  .sidebar-list--dragging-chat .chat-row:not(.sidebar-item--active):hover .chat-row-title { color:#cfcdca; }
  .chat-row-date { margin-top:3px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#5a5a60; font-size:10px; line-height:1.2; }
  .chat-pin { width:20px; height:20px; flex:0 0 auto; display:grid; place-items:center; color:#a88e67; opacity:.72; }
  :global(.context-menu) { min-width:168px; overflow:hidden; padding:5px; border:1px solid rgba(255,255,255,.085); border-radius:11px; background:#29292b; color:#d3d1d0; font-size:12px; box-shadow:0 16px 38px rgba(0,0,0,.42),0 1px 0 rgba(255,255,255,.035) inset; }
  :global(.context-action) { width:100%; min-height:36px; display:flex; align-items:center; gap:10px; padding:7px 10px; border-radius:8px; color:#c3c1c0; text-align:left; cursor:pointer; transition:color .12s,background .12s; }
  :global(.context-action:hover) { color:#f0eeeb; background:rgba(255,255,255,.065); }
  :global(.context-action--danger) { color:#dd8585; }
  :global(.context-action--danger:hover) { color:#f09a9a; background:rgba(239,68,68,.09); }
  :global(.context-separator) { height:1px; margin:4px 7px; background:rgba(255,255,255,.055); }
  :global(.context-sheet-backdrop) { position:fixed; inset:0; z-index:1000; display:flex; align-items:flex-end; padding:12px; padding-bottom:calc(12px + env(safe-area-inset-bottom)); background:rgba(0,0,0,.56); backdrop-filter:blur(2px); }
  :global(.context-sheet) { width:100%; overflow:hidden; padding:7px 7px 8px; border:1px solid rgba(255,255,255,.075); border-radius:17px; background:#262628; box-shadow:0 -12px 38px rgba(0,0,0,.36); transform-origin:bottom center; }
  :global(.context-sheet-handle) { width:34px; height:4px; margin:1px auto 8px; border-radius:99px; background:rgba(255,255,255,.14); }
  :global(.context-sheet-title) { padding:5px 12px 10px; overflow:hidden; color:#747479; font-size:11px; font-weight:600; text-overflow:ellipsis; white-space:nowrap; }
  :global(.context-sheet-actions .context-action) { min-height:48px; padding:11px 13px; border-radius:11px; font-size:14px; }
  @media (hover:hover) and (pointer:fine) {
    .sidebar-item:hover { background:rgba(255,255,255,.05); }
    .sidebar-item--active:hover { background:rgba(212,180,131,.095); }
    .bottom-nav-button:hover { background:rgba(255,255,255,.05); color:#b9a17d; }
  }
  @media (max-width:767px) {
    .sidebar-scroll { padding:15px 12px 24px; }
    .section-heading { min-height:38px; padding-left:10px; }
    .add-folder-button,.sidebar-close-button { width:44px; height:44px; }
    .add-folder-button { margin-right:-8px; }
    .folder-row { min-height:54px; gap:11px; padding:7px 10px; }
    .folder-row-icon { width:36px; height:36px; border-radius:10px; }
    .folder-row-icon svg { width:22px; height:22px; }
    .folder-row-name { font-size:14px; }
    .folder-row-count { font-size:11px; }
    .chat-row { min-height:54px; gap:11px; padding:7px 10px; }
    .chat-row-icon { width:34px; height:34px; }
    .chat-row-title { font-size:13.5px; }
    .chat-row-date { font-size:10.5px; }
    .sidebar-item--active,.sidebar-item--active:hover { background:rgba(212,180,131,.07); }
    .sidebar-item:active,.sidebar-item--pressed { background:rgba(212,180,131,.09); }
  }
  @media (prefers-reduced-motion: reduce) {
    .folder-contents,.folder-chevron { transition-duration:.01ms; }
  }
</style>
