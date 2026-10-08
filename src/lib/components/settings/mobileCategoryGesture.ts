type Options = {
  onHolding: (holding: boolean) => void;
  onPreview: (id: string | null) => void;
  onSelect: (id: string) => void;
};

/** Match the existing mobile gestures: 350ms hold, 10px scroll tolerance. */
export function mobileCategoryGesture(node: HTMLElement, options: Options) {
  let touch: { id: number; x: number; y: number } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let holding = false;
  let suppressUntil = 0;

  function categoryAt(x: number, y: number) {
    const row = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-category-id]');
    return row && node.contains(row) ? row.dataset.categoryId ?? null : null;
  }

  function reset() {
    if (timer) clearTimeout(timer);
    timer = undefined;
    if (holding) suppressUntil = Date.now() + 400;
    holding = false;
    options.onHolding(false);
    touch = null;
    options.onPreview(null);
  }

  function start(event: TouchEvent) {
    if (event.touches.length !== 1) return reset();
    if (!(event.target instanceof Element)) return;
    const row = event.target.closest<HTMLElement>('[data-category-id]');
    if (!row || !node.contains(row)) return;
    reset();
    const finger = event.changedTouches[0];
    touch = { id: finger.identifier, x: finger.clientX, y: finger.clientY };
    timer = setTimeout(() => {
      timer = undefined;
      if (!touch || !node.isConnected) return reset();
      holding = true;
      options.onHolding(true);
      options.onPreview(categoryAt(touch.x, touch.y));
    }, 350);
  }

  function move(event: TouchEvent) {
    if (!touch) return;
    const finger = Array.from(event.changedTouches).find(item => item.identifier === touch?.id);
    if (!finger) return;
    if (!holding) {
      // Leave ordinary scrolling untouched before the hold activates.
      if (Math.hypot(finger.clientX - touch.x, finger.clientY - touch.y) > 10) reset();
      return;
    }
    if (!event.cancelable) return reset();
    event.preventDefault();
    options.onPreview(categoryAt(finger.clientX, finger.clientY));
  }

  function end(event: TouchEvent) {
    if (!touch) return;
    const finger = Array.from(event.changedTouches).find(item => item.identifier === touch?.id);
    if (!finger) return;
    const selected = holding ? categoryAt(finger.clientX, finger.clientY) : null;
    if (holding && event.cancelable) event.preventDefault();
    reset();
    if (selected) options.onSelect(selected);
  }

  const additionalTouch = (event: TouchEvent) => { if (event.touches.length > 1) reset(); };
  const cancel = () => reset();
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape') reset(); };
  const contextMenu = (event: Event) => { if (touch) event.preventDefault(); };
  const click = (event: MouseEvent) => {
    if (event.detail !== 0 && Date.now() < suppressUntil) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  };

  node.addEventListener('touchstart', start, { passive: true });
  node.addEventListener('click', click, true);
  node.addEventListener('contextmenu', contextMenu);
  // Touch listeners survive native pointercancel after a held finger starts moving.
  document.addEventListener('touchstart', additionalTouch, { passive: true, capture: true });
  document.addEventListener('touchmove', move, { passive: false, capture: true });
  document.addEventListener('touchend', end, { passive: false, capture: true });
  document.addEventListener('touchcancel', cancel, true);
  document.addEventListener('scroll', cancel, true);
  document.addEventListener('keydown', keydown);
  window.addEventListener('blur', cancel);

  return {
    update(next: Options) { options = next; },
    destroy() {
      reset();
      node.removeEventListener('touchstart', start);
      node.removeEventListener('click', click, true);
      node.removeEventListener('contextmenu', contextMenu);
      document.removeEventListener('touchstart', additionalTouch, true);
      document.removeEventListener('touchmove', move, true);
      document.removeEventListener('touchend', end, true);
      document.removeEventListener('touchcancel', cancel, true);
      document.removeEventListener('scroll', cancel, true);
      document.removeEventListener('keydown', keydown);
      window.removeEventListener('blur', cancel);
    },
  };
}
