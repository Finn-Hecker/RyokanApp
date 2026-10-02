import { onMount, tick } from 'svelte';

/** Shared focus, portal and viewport behavior for settings listboxes. */
export function createListbox(options: {
  trigger: () => HTMLButtonElement | null;
  optionList: () => HTMLDivElement | null;
  optionCount: () => number;
}) {
  let open = $state(false);
  let mobile = $state(false);
  let popupStyle = $state('');

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  function updatePopupPosition() {
    const trigger = options.trigger();
    if (!trigger || mobile) return;
    const rect = trigger.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const width = Math.max(220, rect.width);
    const left = Math.min(Math.max(rect.left, viewportLeft + 12), viewportLeft + viewportWidth - width - 12);
    const estimatedHeight = options.optionCount() * 44 + 14;
    const roomBelow = viewportTop + viewportHeight - rect.bottom;
    const top = roomBelow >= estimatedHeight + 12
      ? rect.bottom + 7
      : Math.max(viewportTop + 12, rect.top - estimatedHeight - 7);
    popupStyle = `left:${left}px;top:${top}px;width:${width}px`;
  }

  async function show() {
    open = true;
    updatePopupPosition();
    await tick();
    updatePopupPosition();
    options.optionList()?.querySelector<HTMLElement>('[aria-selected="true"]')?.focus();
  }

  function toggle(event: MouseEvent) {
    event.stopPropagation();
    if (open) open = false;
    else void show();
  }

  function close(restoreFocus = false) {
    open = false;
    if (restoreFocus) void tick().then(() => options.trigger()?.focus());
  }

  function handleTriggerKeydown(event: KeyboardEvent) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      if (!open) void show();
    }
  }

  function handleOptionKeydown(event: KeyboardEvent, index: number) {
    if (!options.optionCount()) return;
    const buttons = Array.from(options.optionList()?.querySelectorAll<HTMLElement>('[role="option"]') ?? []);
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const offset = event.key === 'ArrowDown' ? 1 : -1;
      buttons[(index + offset + buttons.length) % buttons.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      buttons[event.key === 'Home' ? 0 : buttons.length - 1]?.focus();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      open = false;
      void tick().then(() => options.trigger()?.focus());
    }
  }

  function handleWindowKeydown(event: KeyboardEvent) {
    if (open && event.key === 'Escape') {
      open = false;
      void tick().then(() => options.trigger()?.focus());
    }
  }

  onMount(() => {
    const query = window.matchMedia('(max-width: 767px)');
    const syncViewport = () => {
      mobile = query.matches;
      if (open) updatePopupPosition();
    };
    syncViewport();
    query.addEventListener('change', syncViewport);
    window.addEventListener('resize', syncViewport);
    window.visualViewport?.addEventListener('resize', syncViewport);
    return () => {
      query.removeEventListener('change', syncViewport);
      window.removeEventListener('resize', syncViewport);
      window.visualViewport?.removeEventListener('resize', syncViewport);
    };
  });

  return {
    get open() { return open; },
    get mobile() { return mobile; },
    get popupStyle() { return popupStyle; },
    close, portal, toggle, handleTriggerKeydown, handleOptionKeydown, handleWindowKeydown,
  };
}
