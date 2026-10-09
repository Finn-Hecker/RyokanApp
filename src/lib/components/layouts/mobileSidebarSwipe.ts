import type { Action } from 'svelte/action';

type SwipeOptions = {
  enabled: boolean;
  getWidth: () => number;
  onDrag: (progress: number) => void;
  onRelease: (open: boolean) => void;
};
type Swipe = { id: number; x: number; y: number; width: number; horizontal: boolean; target: Element };

/** Track right swipes anywhere on the page, leaving vertical scrolling native. */
export const mobileSidebarSwipe: Action<HTMLDivElement, SwipeOptions> = (node, options) => {
  let swipe: Swipe | null = null;
  let suppressClickUntil = 0;

  function progress(active: Swipe, x: number) {
    return Math.max(0, Math.min(1, (x - active.x) / active.width));
  }

  function cancel() {
    const wasDragging = swipe?.horizontal;
    swipe = null;
    if (wasDragging) options.onRelease(false);
  }

  function start(event: TouchEvent) {
    cancel();
    if (!options.enabled || !window.matchMedia('(max-width: 1023px)').matches
      || event.touches.length !== 1 || !(event.target instanceof Element) || !node.contains(event.target)) return;
    suppressClickUntil = 0;
    const touch = event.touches[0];
    swipe = { id: touch.identifier, x: touch.clientX, y: touch.clientY,
      width: Math.max(1, options.getWidth()), horizontal: false, target: event.target };
  }

  function additionalTouch(event: TouchEvent) {
    if (event.touches.length > 1) cancel();
  }

  function move(event: TouchEvent) {
    if (!swipe) return;
    if (!options.enabled || event.touches.length !== 1 || !event.cancelable) { cancel(); return; }
    const touch = Array.from(event.touches).find(touch => touch.identifier === swipe?.id);
    if (!touch) { cancel(); return; }
    const dx = touch.clientX - swipe.x;
    const dy = touch.clientY - swipe.y;
    if (!swipe.horizontal) {
      if (Math.hypot(dx, dy) <= 4) return;
      if (dx <= 0 || dx <= Math.abs(dy) * 1.2) { cancel(); return; }
      swipe.horizontal = true;
      // A small sidebar drag must also cancel a card's pending long press.
      swipe.target.dispatchEvent(new Event('sidebar-swipe-start', { bubbles: true }));
    }
    event.preventDefault();
    suppressClickUntil = Date.now() + 700;
    options.onDrag(progress(swipe, touch.clientX));
  }

  function end(event: TouchEvent) {
    const active = swipe;
    swipe = null;
    if (!active?.horizontal) return;
    const touch = Array.from(event.changedTouches).find(touch => touch.identifier === active.id);
    if (event.cancelable) event.preventDefault();
    suppressClickUntil = Date.now() + 700;
    if (touch && options.enabled && event.touches.length === 0) options.onDrag(progress(active, touch.clientX));
    options.onRelease(!!touch && options.enabled && event.touches.length === 0 && progress(active, touch.clientX) >= 0.3);
  }

  function click(event: MouseEvent) {
    if (event.detail === 0 || Date.now() >= suppressClickUntil) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClickUntil = 0;
  }

  node.addEventListener('touchstart', start, { passive: true, capture: true });
  document.addEventListener('touchmove', move, { passive: false, capture: true });
  document.addEventListener('touchend', end, { passive: false, capture: true });
  document.addEventListener('touchcancel', cancel, true);
  node.addEventListener('click', click, true);
  document.addEventListener('touchstart', additionalTouch, { passive: true, capture: true });

  return {
    update(nextOptions) {
      if (!nextOptions.enabled) cancel();
      options = nextOptions;
    },
    destroy() {
      swipe = null;
      node.removeEventListener('touchstart', start, true);
      document.removeEventListener('touchmove', move, true);
      document.removeEventListener('touchend', end, true);
      document.removeEventListener('touchcancel', cancel, true);
      node.removeEventListener('click', click, true);
      document.removeEventListener('touchstart', additionalTouch, true);
    },
  };
};
