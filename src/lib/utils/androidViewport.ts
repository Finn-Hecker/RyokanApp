// The Android WebView can resize or pan its visual viewport independently of
// the layout viewport while the IME opens, closes, or changes input fields.
export function androidViewport(node: HTMLElement) {
  if (!/Android/i.test(navigator.userAgent)) return;

  node.classList.add('android-viewport');
  let frame = 0;
  let constrainedTextarea: { element: HTMLTextAreaElement; maxHeight: string; overflowY: string } | undefined;

  function restoreTextarea() {
    if (!constrainedTextarea) return;
    const { element, maxHeight, overflowY } = constrainedTextarea;
    element.style.maxHeight = maxHeight;
    element.style.overflowY = overflowY;
    constrainedTextarea = undefined;
  }

  function keepFocusedFieldVisible() {
    restoreTextarea();
    const focused = document.activeElement;
    if (!(focused instanceof HTMLElement) || !node.contains(focused)) return;
    if (!focused.matches('input:not([type="hidden"]), textarea, [contenteditable="true"]')) return;
    // The bottom-anchored chat composer limits itself to the visible viewport.
    // Avoid competing constraints and ancestor layout reads during IME animation.
    if (focused.id === 'chat-input-textarea') return;

    const viewport = node.getBoundingClientRect();
    for (let parent = focused.parentElement; parent && node.contains(parent); parent = parent.parentElement) {
      if (parent.scrollHeight <= parent.clientHeight || !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) continue;
      const bounds = parent.getBoundingClientRect();
      const top = Math.max(bounds.top, viewport.top);
      const bottom = Math.min(bounds.bottom, viewport.bottom);
      if (bottom <= top) continue;
      if (focused instanceof HTMLTextAreaElement) {
        const field = focused.getBoundingClientRect();
        if (field.height > bottom - top) {
          constrainedTextarea = { element: focused, maxHeight: focused.style.maxHeight, overflowY: focused.style.overflowY };
          focused.style.maxHeight = `${bottom - top}px`;
          focused.style.overflowY = 'auto';
        }
      }
      const field = focused.getBoundingClientRect();
      if (field.top < top) parent.scrollTop += field.top - top;
      else if (field.bottom > bottom && field.height <= bottom - top) parent.scrollTop += field.bottom - bottom;
    }
  }

  function update() {
    frame = 0;
    const viewport = window.visualViewport;
    const height = `${viewport?.height ?? window.innerHeight}px`;
    if (node.style.height !== height) {
      node.style.height = height;
      node.style.setProperty('--app-visible-height', height);
    }
    const top = `${viewport?.offsetTop ?? 0}px`;
    if (node.style.top !== top) node.style.top = top;
    keepFocusedFieldVisible();
  }

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  update();
  window.visualViewport?.addEventListener('resize', schedule);
  window.visualViewport?.addEventListener('scroll', schedule);
  window.addEventListener('resize', schedule);
  document.addEventListener('focusin', schedule);
  document.addEventListener('focusout', schedule);

  return {
    destroy() {
      if (frame) cancelAnimationFrame(frame);
      restoreTextarea();
      window.visualViewport?.removeEventListener('resize', schedule);
      window.visualViewport?.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      document.removeEventListener('focusin', schedule);
      document.removeEventListener('focusout', schedule);
      node.classList.remove('android-viewport');
      node.style.removeProperty('height');
      node.style.removeProperty('top');
      node.style.removeProperty('--app-visible-height');
    }
  };
}
