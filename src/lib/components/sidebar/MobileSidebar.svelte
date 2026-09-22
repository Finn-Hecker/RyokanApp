<script lang="ts">
  import { onDestroy } from 'svelte';
  import SidebarBase from './SidebarBase.svelte';
  import type { ConversationMode } from '$lib/stores/chatStore.svelte';

  let {
    isOpen,
    close,
    layout,
    onWorldInfoClick,
    mode = 'singleplayer',
  }: {
    isOpen: boolean;
    close: () => void;
    layout: 'inline' | 'drawer';
    onWorldInfoClick?: () => void;
    mode?: ConversationMode;
  } = $props();

  type ItemType = 'chat' | 'folder';
  type GestureEvent = Pick<PointerEvent, 'target' | 'pointerType' | 'isPrimary' | 'pointerId' | 'clientX' | 'clientY' | 'preventDefault'>;
  type PendingGesture = {
    kind: 'pending';
    type: ItemType;
    id: string;
    pointerId: number;
    pointerType: string;
    startX: number;
    startY: number;
    source: HTMLElement;
    timer: ReturnType<typeof setTimeout>;
  };
  type MobileGesture = PendingGesture | {
    kind: 'scrolling';
    type: ItemType;
    id: string;
    pointerId: number;
  } | {
    kind: 'swiping';
    type: ItemType;
    id: string;
    pointerId: number;
    startX: number;
    currentX: number;
    source: HTMLElement;
  } | {
    kind: 'dragging';
    type: ItemType;
    id: string;
    pointerId: number;
  };

  type SidebarHandle = {
    setMobilePressed: (type: ItemType, id: string, pressed: boolean) => void;
    suppressMobileActivation: (type: ItemType, id: string) => void;
    beginMobileDrag: (source: HTMLElement, type: ItemType, id: string, clientY: number) => void;
    updateMobileDrag: (clientX: number, clientY: number) => void;
    completeMobileDrag: (clientX: number, clientY: number) => Promise<void>;
    cancelMobileDrag: () => void;
    openMobileActions: (type: ItemType, id: string) => void;
  };

  let sidebar = $state<SidebarHandle | null>(null);
  let gesture = $state<MobileGesture | null>(null);
  let gestureRoot: HTMLDivElement;
  let completingDrag = false;
  const LONG_PRESS_DURATION = 525;
  const MOVE_TOLERANCE = 10;
  const SWIPE_OPEN_THRESHOLD = 44;
  const MAX_SWIPE_TRANSLATION = 56;
  const swipeAnimationTokens = new WeakMap<HTMLElement, number>();

  $effect(() => {
    if (!isOpen) resetGesture(true);
  });

  onDestroy(() => resetGesture(true));

  function itemFromEvent(event: GestureEvent) {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('button,input,textarea,select')) return null;
    const chat = target.closest<HTMLElement>('[data-chat-row][data-chat-id]');
    if (chat?.dataset.chatId) return { type: 'chat' as const, id: chat.dataset.chatId, source: chat };
    const folder = target.closest<HTMLElement>('[data-folder-row][data-folder-id]');
    if (folder?.dataset.folderId) return { type: 'folder' as const, id: folder.dataset.folderId, source: folder };
    return null;
  }

  function handlePointerDown(event: GestureEvent) {
    if (event.pointerType === 'mouse' || !event.isPrimary || gesture || completingDrag) return;
    const item = itemFromEvent(event);
    if (!item) return;

    sidebar?.setMobilePressed(item.type, item.id, true);
    const pending: PendingGesture = {
      kind: 'pending',
      ...item,
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      startX: event.clientX,
      startY: event.clientY,
      timer: setTimeout(() => {
        if (
          gesture?.kind !== 'pending'
          || gesture.pointerId !== pending.pointerId
          || gesture.type !== pending.type
          || gesture.id !== pending.id
        ) return;
        // Rows are recreated when a chat moves between keyed folder lists.
        // Capture on the stable wrapper so move/up still reach this controller.
        if (pending.pointerType !== 'touch') {
          try { gestureRoot.setPointerCapture(pending.pointerId); } catch { /* Pointer already ended. */ }
        }
        sidebar?.beginMobileDrag(pending.source, pending.type, pending.id, pending.startY);
        gesture = {
          kind: 'dragging',
          type: pending.type,
          id: pending.id,
          pointerId: pending.pointerId,
        };
      }, LONG_PRESS_DURATION),
    };
    gesture = pending;
  }

  function handlePointerMove(event: GestureEvent) {
    const active = gesture;
    if (!active || active.pointerId !== event.pointerId) return;
    if (active.kind === 'dragging') {
      event.preventDefault();
      sidebar?.updateMobileDrag(event.clientX, event.clientY);
      return;
    }
    if (active.kind === 'scrolling') return;
    if (active.kind === 'swiping') {
      event.preventDefault();
      active.currentX = event.clientX;
      updateSwipeTranslation(active.source, active.currentX - active.startX);
      return;
    }

    const deltaX = event.clientX - active.startX;
    const deltaY = event.clientY - active.startY;
    if (Math.hypot(deltaX, deltaY) <= MOVE_TOLERANCE) return;
    clearTimeout(active.timer);
    sidebar?.setMobilePressed(active.type, active.id, false);
    sidebar?.suppressMobileActivation(active.type, active.id);
    if (Math.abs(deltaX) > Math.abs(deltaY) * 1.25) {
      event.preventDefault();
      gesture = {
        kind: 'swiping',
        type: active.type,
        id: active.id,
        pointerId: active.pointerId,
        startX: active.startX,
        currentX: event.clientX,
        source: active.source,
      };
      updateSwipeTranslation(active.source, deltaX);
    } else {
      gesture = { kind: 'scrolling', type: active.type, id: active.id, pointerId: active.pointerId };
    }
  }

  function handlePointerUp(event: GestureEvent) {
    const active = gesture;
    if (!active || active.pointerId !== event.pointerId) return;
    gesture = null;
    releaseGestureResources(active.pointerId);
    sidebar?.setMobilePressed(active.type, active.id, false);

    if (active.kind === 'pending') {
      clearTimeout(active.timer);
      return;
    }
    if (active.kind === 'swiping') {
      event.preventDefault();
      sidebar?.suppressMobileActivation(active.type, active.id);
      resetSwipeTranslation(active.source);
      if (active.currentX - active.startX <= -SWIPE_OPEN_THRESHOLD) {
        sidebar?.openMobileActions(active.type, active.id);
      }
      return;
    }
    if (active.kind === 'dragging') {
      event.preventDefault();
      sidebar?.suppressMobileActivation(active.type, active.id);
      completingDrag = true;
      void Promise.resolve()
        .then(() => sidebar?.completeMobileDrag(event.clientX, event.clientY))
        .catch(error => console.error('[MobileSidebar] Could not complete drag:', error))
        .finally(() => {
          sidebar?.cancelMobileDrag();
          completingDrag = false;
        });
    } else {
      sidebar?.suppressMobileActivation(active.type, active.id);
    }
  }

  function handlePointerCancel(event: GestureEvent) {
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    resetGesture(true);
  }

  function resetGesture(cancelDrag: boolean) {
    if (gesture?.kind === 'pending') clearTimeout(gesture.timer);
    if (gesture?.kind === 'swiping') resetSwipeTranslation(gesture.source);
    if (gesture) sidebar?.setMobilePressed(gesture.type, gesture.id, false);
    if (gesture) {
      sidebar?.suppressMobileActivation(gesture.type, gesture.id);
      releaseGestureResources(gesture.pointerId);
    }
    gesture = null;
    if (cancelDrag) sidebar?.cancelMobileDrag();
  }

  function releaseGestureResources(pointerId: number) {
    if (gestureRoot?.hasPointerCapture(pointerId)) gestureRoot.releasePointerCapture(pointerId);
  }

  function touchGestures(node: HTMLElement) {
    let touchId: number | null = null;
    const preventTextSelection = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('input, textarea, [contenteditable="true"]')) event.preventDefault();
    };
    const asGestureEvent = (event: TouchEvent, touch: Touch): GestureEvent => ({
      target: event.target, pointerType: 'touch', isPrimary: true,
      pointerId: touch.identifier, clientX: touch.clientX, clientY: touch.clientY,
      preventDefault: () => { if (event.cancelable) event.preventDefault(); },
    });
    const start = (event: TouchEvent) => {
      if (event.touches.length !== 1 || gesture || completingDrag) return;
      const touch = event.changedTouches[0];
      handlePointerDown(asGestureEvent(event, touch));
      if (gesture) touchId = touch.identifier;
    };
    const cancel = () => {
      if (touchId === null) return;
      touchId = null;
      resetGesture(true);
    };
    const additionalTouch = (event: TouchEvent) => {
      if (event.touches.length > 1) cancel();
    };
    const move = (event: TouchEvent) => {
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === touchId);
      if (!touch) return;
      // A non-passive listener is installed before the first touch. Once the
      // long press wins, touch events own the gesture even if pointercancel fires.
      if (!event.cancelable && gesture?.kind === 'dragging') { cancel(); return; }
      handlePointerMove(asGestureEvent(event, touch));
    };
    const end = (event: TouchEvent) => {
      const touch = Array.from(event.changedTouches).find(touch => touch.identifier === touchId);
      if (!touch) return;
      touchId = null;
      handlePointerUp(asGestureEvent(event, touch));
    };
    node.addEventListener('touchstart', start, { passive: true });
    node.addEventListener('selectstart', preventTextSelection);
    document.addEventListener('touchstart', additionalTouch, { passive: true, capture: true });
    document.addEventListener('touchmove', move, { passive: false, capture: true });
    document.addEventListener('touchend', end, { passive: false, capture: true });
    document.addEventListener('touchcancel', cancel, { passive: true, capture: true });
    return { destroy() {
      cancel();
      node.removeEventListener('touchstart', start);
      node.removeEventListener('selectstart', preventTextSelection);
      document.removeEventListener('touchstart', additionalTouch, true);
      document.removeEventListener('touchmove', move, true);
      document.removeEventListener('touchend', end, true);
      document.removeEventListener('touchcancel', cancel, true);
    } };
  }

  function updateSwipeTranslation(source: HTMLElement, deltaX: number) {
    swipeAnimationTokens.set(source, (swipeAnimationTokens.get(source) ?? 0) + 1);
    const translation = Math.max(-MAX_SWIPE_TRANSLATION, Math.min(0, deltaX * 0.5));
    source.style.transition = 'none';
    source.style.willChange = 'transform';
    source.style.transform = `translate3d(${translation}px, 0, 0)`;
  }

  function resetSwipeTranslation(source: HTMLElement) {
    const token = (swipeAnimationTokens.get(source) ?? 0) + 1;
    swipeAnimationTokens.set(source, token);
    source.style.transition = 'transform 160ms cubic-bezier(.22, 1, .36, 1)';
    source.style.transform = 'translate3d(0, 0, 0)';

    const cleanup = () => {
      if (swipeAnimationTokens.get(source) !== token) return;
      source.removeEventListener('transitionend', cleanup);
      source.style.removeProperty('transition');
      source.style.removeProperty('transform');
      source.style.removeProperty('will-change');
    };
    source.addEventListener('transitionend', cleanup);
    setTimeout(cleanup, 220);
  }
</script>

<div
  bind:this={gestureRoot}
  use:touchGestures
  class="mobile-sidebar h-full"
  role="presentation"
  onpointerdown={(event) => event.pointerType !== 'touch' && handlePointerDown(event)}
  onpointermove={(event) => event.pointerType !== 'touch' && handlePointerMove(event)}
  onpointerup={(event) => event.pointerType !== 'touch' && handlePointerUp(event)}
  onpointercancel={(event) => event.pointerType !== 'touch' && handlePointerCancel(event)}
>
  <SidebarBase bind:this={sidebar} {isOpen} {close} {layout} interactionMode="mobile" {onWorldInfoClick} {mode} />
</div>

<style>
  .mobile-sidebar,
  .mobile-sidebar :global(*) {
    -webkit-user-select: none;
    user-select: none;
    -webkit-touch-callout: none;
  }

  .mobile-sidebar :global(input),
  .mobile-sidebar :global(textarea),
  .mobile-sidebar :global([contenteditable="true"]),
  .mobile-sidebar :global([contenteditable="true"] *) {
    -webkit-user-select: text;
    user-select: text;
    -webkit-touch-callout: default;
  }
</style>
