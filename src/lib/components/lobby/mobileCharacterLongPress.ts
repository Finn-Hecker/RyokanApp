import type { Action } from 'svelte/action';

type LongPressOptions = { enabled: boolean; onLongPress: () => void };

export const mobileCharacterLongPress: Action<HTMLButtonElement, LongPressOptions> = (node, options) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let start: { x: number; y: number } | undefined;
  let suppressClick = false;
  let suppressTimeout: ReturnType<typeof setTimeout> | undefined;

  function cancel() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    start = undefined;
  }

  function pointerDown(event: PointerEvent) {
    if (!options.enabled || event.pointerType !== 'touch' || !window.matchMedia('(max-width: 767px)').matches) return;
    cancel();
    suppressClick = false;
    if (suppressTimeout) clearTimeout(suppressTimeout);
    start = { x: event.clientX, y: event.clientY };
    timer = setTimeout(() => {
      timer = undefined;
      start = undefined;
      suppressClick = true;
      if (suppressTimeout) clearTimeout(suppressTimeout);
      suppressTimeout = setTimeout(() => (suppressClick = false), 3000);
      options.onLongPress();
    }, 350);
  }

  function pointerMove(event: PointerEvent) {
    if (start && Math.hypot(event.clientX - start.x, event.clientY - start.y) > 10) cancel();
  }

  function click(event: MouseEvent) {
    if (!suppressClick) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    suppressClick = false;
    if (suppressTimeout) clearTimeout(suppressTimeout);
  }

  function pointerUp() {
    cancel();
    if (suppressClick) {
      if (suppressTimeout) clearTimeout(suppressTimeout);
      suppressTimeout = setTimeout(() => (suppressClick = false), 700);
    }
  }

  function contextMenu(event: MouseEvent) {
    if (suppressClick) event.preventDefault();
  }

  node.addEventListener('pointerdown', pointerDown);
  node.addEventListener('pointermove', pointerMove);
  node.addEventListener('pointerup', pointerUp);
  node.addEventListener('pointercancel', cancel);
  node.addEventListener('pointerleave', cancel);
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', contextMenu);

  return {
    update(nextOptions) { options = nextOptions; },
    destroy() {
      cancel();
      if (suppressTimeout) clearTimeout(suppressTimeout);
      node.removeEventListener('pointerdown', pointerDown);
      node.removeEventListener('pointermove', pointerMove);
      node.removeEventListener('pointerup', pointerUp);
      node.removeEventListener('pointercancel', cancel);
      node.removeEventListener('pointerleave', cancel);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', contextMenu);
    }
  };
};
