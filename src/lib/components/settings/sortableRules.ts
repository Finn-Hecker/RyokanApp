type Options = {
  preview: (id: string, index: number) => void;
  finish: (commit: boolean) => void;
};

/** Sidebar gesture conventions: 350ms long press, 10px scroll tolerance,
 * document touch listeners (non-passive move) independent of pointercancel. */
export function sortableRules(node: HTMLElement, options: Options) {
  let active: { id: string; pointerId: number; touch: boolean; x: number; y: number; row: HTMLElement } | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let ghost: HTMLElement | null = null;
  let centers: number[] = [];
  let offsetY = 0;
  let initialScroll = 0;
  let scrollRoot: HTMLElement = node;
  let frame = 0;
  let lastY = 0;
  let suppressUntil = 0;

  function reset(commit = false) {
    if (timer) clearTimeout(timer);
    timer = undefined;
    cancelAnimationFrame(frame);
    frame = 0;
    const wasDragging = Boolean(ghost);
    ghost?.remove();
    ghost = null;
    if (active && node.hasPointerCapture(active.pointerId)) node.releasePointerCapture(active.pointerId);
    active = null;
    if (wasDragging) {
      suppressUntil = Date.now() + 400;
      options.finish(commit);
    }
  }

  function update(y: number) {
    if (!active || !ghost) return;
    lastY = y;
    const shift = scrollRoot.scrollTop - initialScroll;
    const index = Math.max(0, Math.min(centers.length, centers.filter(center => y + shift > center).length));
    options.preview(active.id, index);
    ghost.style.transform = `translate3d(0, ${y - offsetY}px, 0) scale(1.015)`;
  }

  function begin() {
    if (!active || !active.row.isConnected) return reset();
    const rect = active.row.getBoundingClientRect();
    centers = Array.from(node.querySelectorAll<HTMLElement>('[data-rule-id]')).map(row => {
      const bounds = row.getBoundingClientRect();
      return bounds.top + bounds.height / 2;
    });
    // Compare against the boundaries between slots, so crossing a neighbour's
    // centre moves into its slot in either direction without oscillation.
    centers = centers.slice(0, -1).map((center, i) => (center + centers[i + 1]) / 2);
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) { scrollRoot = parent; break; }
    }
    initialScroll = scrollRoot.scrollTop;
    offsetY = active.y - rect.top;
    ghost = active.row.cloneNode(true) as HTMLElement;
    ghost.removeAttribute('data-rule-id');
    ghost.setAttribute('aria-hidden', 'true');
    ghost.inert = true;
    ghost.classList.add('rule-drag-ghost');
    ghost.style.cssText = `position:fixed;top:0;left:${rect.left}px;width:${rect.width}px;height:${rect.height}px;z-index:10000;pointer-events:none;box-sizing:border-box;`;
    node.appendChild(ghost);
    if (!active.touch) node.setPointerCapture(active.pointerId);
    update(active.y);
    const scroll = () => {
      if (!ghost) return;
      const bounds = scrollRoot.getBoundingClientRect();
      const speed = lastY < bounds.top + 40 ? -7 : lastY > bounds.bottom - 40 ? 7 : 0;
      if (speed) { scrollRoot.scrollTop += speed; update(lastY); }
      frame = requestAnimationFrame(scroll);
    };
    frame = requestAnimationFrame(scroll);
  }

  function down(target: EventTarget | null, pointerId: number, touch: boolean, x: number, y: number) {
    if (active || !(target instanceof Element) || target.closest('button,input,label,textarea,select,a')) return;
    const row = target.closest<HTMLElement>('[data-rule-id]');
    if (!row?.dataset.ruleId || !node.contains(row)) return;
    active = { id: row.dataset.ruleId, pointerId, touch, x, y, row };
    if (touch) timer = setTimeout(begin, 350);
  }
  function move(x: number, y: number, event: Event) {
    if (!active) return;
    if (ghost) { event.preventDefault(); update(y); return; }
    if (Math.hypot(x - active.x, y - active.y) <= (active.touch ? 10 : 4)) return;
    if (active.touch) reset(); // Ordinary scrolling wins before the long press.
    else { begin(); event.preventDefault(); update(y); }
  }
  const pointerDown = (event: PointerEvent) => {
    if (event.pointerType !== 'touch' && event.isPrimary && event.button === 0) down(event.target, event.pointerId, false, event.clientX, event.clientY);
  };
  const pointerMove = (event: PointerEvent) => {
    if (active && !active.touch && active.pointerId === event.pointerId) move(event.clientX, event.clientY, event);
  };
  const pointerUp = (event: PointerEvent) => {
    if (active && !active.touch && active.pointerId === event.pointerId) { if (ghost) update(event.clientY); reset(true); }
  };
  const pointerCancel = (event: PointerEvent) => {
    if (active && !active.touch && active.pointerId === event.pointerId) reset();
  };
  const touchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) { reset(); return; }
    const touch = event.changedTouches[0];
    down(event.target, touch.identifier, true, touch.clientX, touch.clientY);
  };
  const additionalTouch = (event: TouchEvent) => { if (event.touches.length > 1) reset(); };
  const touchMove = (event: TouchEvent) => {
    if (!active?.touch) return;
    const touch = Array.from(event.changedTouches).find(t => t.identifier === active?.pointerId);
    if (!touch) return;
    if (ghost && !event.cancelable) return reset();
    move(touch.clientX, touch.clientY, event);
  };
  const touchEnd = (event: TouchEvent) => {
    if (!active?.touch) return;
    const touch = Array.from(event.changedTouches).find(t => t.identifier === active?.pointerId);
    if (!touch) return;
    if (ghost) { event.preventDefault(); update(touch.clientY); }
    reset(true);
  };
  const cancel = () => reset();
  const keydown = (event: KeyboardEvent) => { if (event.key === 'Escape' && active) { event.preventDefault(); reset(); } };
  const click = (event: MouseEvent) => { if (Date.now() < suppressUntil) { event.preventDefault(); event.stopImmediatePropagation(); } };
  const select = (event: Event) => { if (active) event.preventDefault(); };
  node.addEventListener('pointerdown', pointerDown);
  node.addEventListener('touchstart', touchStart, { passive: true });
  node.addEventListener('click', click, true);
  node.addEventListener('selectstart', select);
  node.addEventListener('contextmenu', select);
  document.addEventListener('pointermove', pointerMove);
  document.addEventListener('pointerup', pointerUp);
  document.addEventListener('pointercancel', pointerCancel);
  document.addEventListener('touchstart', additionalTouch, { passive: true, capture: true });
  document.addEventListener('touchmove', touchMove, { passive: false, capture: true });
  document.addEventListener('touchend', touchEnd, { passive: false, capture: true });
  document.addEventListener('touchcancel', cancel, true);
  document.addEventListener('keydown', keydown);
  window.addEventListener('blur', cancel);
  return { destroy() {
    reset();
    node.removeEventListener('pointerdown', pointerDown);
    node.removeEventListener('touchstart', touchStart);
    node.removeEventListener('click', click, true);
    node.removeEventListener('selectstart', select);
    node.removeEventListener('contextmenu', select);
    document.removeEventListener('pointermove', pointerMove);
    document.removeEventListener('pointerup', pointerUp);
    document.removeEventListener('pointercancel', pointerCancel);
    document.removeEventListener('touchstart', additionalTouch, true);
    document.removeEventListener('touchmove', touchMove, true);
    document.removeEventListener('touchend', touchEnd, true);
    document.removeEventListener('touchcancel', cancel, true);
    document.removeEventListener('keydown', keydown);
    window.removeEventListener('blur', cancel);
  } };
}
