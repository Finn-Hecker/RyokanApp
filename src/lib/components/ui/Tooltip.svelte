<script lang="ts">
  import { onMount, tick } from 'svelte';
  import type { Snippet } from 'svelte';

  const VIEWPORT_MARGIN = 12;
  const TOOLTIP_GAP = 10;

  let {
    width = 230,
    align = 'center',
    children
  }: {
    width?: number;
    align?: 'left' | 'center' | 'right';
    children?: Snippet;
  } = $props();

  let open = $state(false);
  let hovered = $state(false);
  let focused = $state(false);
  let wrapper: HTMLDivElement;
  let tooltip: HTMLDivElement;
  let tooltipStyle = $state('');
  let placement = $state<'top' | 'bottom'>('top');

  const visible = $derived(open || hovered || focused);

  async function updatePosition() {
    if (!visible) return;

    await tick();
    if (!visible || !wrapper || !tooltip) return;

    const triggerRect = wrapper.getBoundingClientRect();
    const tooltipRect = tooltip.getBoundingClientRect();
    const viewport = window.visualViewport;
    const viewportLeft = viewport?.offsetLeft ?? 0;
    const viewportTop = viewport?.offsetTop ?? 0;
    const viewportWidth = viewport?.width ?? window.innerWidth;
    const viewportHeight = viewport?.height ?? window.innerHeight;
    const viewportRight = viewportLeft + viewportWidth;
    const viewportBottom = viewportTop + viewportHeight;

    const preferredTop = triggerRect.top - TOOLTIP_GAP - tooltipRect.height;
    const preferredBottom = triggerRect.bottom + TOOLTIP_GAP;
    placement = preferredTop < viewportTop + VIEWPORT_MARGIN ? 'bottom' : 'top';

    const desiredLeft =
      align === 'left'
        ? triggerRect.left
        : align === 'right'
          ? triggerRect.right - tooltipRect.width
          : triggerRect.left + triggerRect.width / 2 - tooltipRect.width / 2;
    const maxLeft = Math.max(viewportLeft + VIEWPORT_MARGIN, viewportRight - VIEWPORT_MARGIN - tooltipRect.width);
    const maxTop = Math.max(viewportTop + VIEWPORT_MARGIN, viewportBottom - VIEWPORT_MARGIN - tooltipRect.height);
    const left = Math.min(Math.max(desiredLeft, viewportLeft + VIEWPORT_MARGIN), maxLeft);
    const desiredTop = placement === 'top' ? preferredTop : preferredBottom;
    const top = Math.min(Math.max(desiredTop, viewportTop + VIEWPORT_MARGIN), maxTop);

    tooltipStyle = `left: ${left}px; top: ${top}px;`;
  }

  $effect(() => {
    if (visible) void updatePosition();
  });

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
  }

  onMount(() => {
    const reposition = () => void updatePosition();
    window.addEventListener('resize', reposition);
    window.visualViewport?.addEventListener('resize', reposition);

    return () => {
      window.removeEventListener('resize', reposition);
      window.visualViewport?.removeEventListener('resize', reposition);
    };
  });
</script>

<svelte:window onclick={() => (open = false)} />

<div
  bind:this={wrapper}
  class="ryokan-tooltip-wrapper"
  class:ryokan-tooltip-wrapper--open={open}
>
  <button
    type="button"
    class="ryokan-tooltip-trigger"
    onclick={toggle}
    onmouseenter={() => (hovered = true)}
    onmouseleave={() => (hovered = false)}
    onfocus={() => (focused = true)}
    onblur={() => (focused = false)}
    aria-label="Mehr Infos"
    aria-expanded={open}
  >
    <svg
      width="13" height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10"/>
      <line x1="12" y1="16" x2="12" y2="12"/>
      <line x1="12" y1="8" x2="12.01" y2="8"/>
    </svg>
  </button>

  <div
    bind:this={tooltip}
    class="ryokan-tooltip-text ryokan-tooltip-text--{align} ryokan-tooltip-text--{placement}"
    class:ryokan-tooltip-text--visible={visible}
    style="width: min({width}px, calc(100vw - {VIEWPORT_MARGIN * 2}px)); {tooltipStyle}"
  >
    {@render children?.()}
  </div>
</div>


<style>
  .ryokan-tooltip-wrapper {
    position: relative;
    display: inline-flex;
  }

  .ryokan-tooltip-trigger {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    padding: 0;
    border: none;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    transition: color 0.2s ease;
  }
  .ryokan-tooltip-wrapper:hover .ryokan-tooltip-trigger,
  .ryokan-tooltip-wrapper--open .ryokan-tooltip-trigger {
    color: #d4b483;
  }

  .ryokan-tooltip-text {
    visibility: hidden;
    opacity: 0;
    position: fixed;
    background: #1c1c1e;
    color: #a1a1aa;
    border: 1px solid rgba(212, 180, 131, 0.15);
    text-align: left;
    padding: 10px 12px;
    border-radius: 10px;
    font-size: 11.5px;
    font-weight: 400;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.6);
    transition: opacity 0.2s ease, visibility 0.2s ease, transform 0.2s ease;
    z-index: 50;
    pointer-events: none;
    line-height: 1.5;
    box-sizing: border-box;
    max-height: calc(100dvh - 24px);
    overflow-y: auto;
    transform: translateY(4px);
  }

  .ryokan-tooltip-text--center::after,
  .ryokan-tooltip-text--center::before {
    left: 50%;
    transform: translateX(-50%);
  }
  .ryokan-tooltip-text--left::after,
  .ryokan-tooltip-text--left::before {
    left: 10px;
  }
  .ryokan-tooltip-text--right::after,
  .ryokan-tooltip-text--right::before {
    right: 10px;
  }

  .ryokan-tooltip-text::after {
    content: '';
    position: absolute;
    top: 100%;
    border: 5px solid transparent;
    border-top-color: rgba(212, 180, 131, 0.15);
  }
  .ryokan-tooltip-text::before {
    content: '';
    position: absolute;
    top: 100%;
    margin-top: 1px;
    border: 5px solid transparent;
    border-top-color: #1c1c1e;
    z-index: 1;
  }

  .ryokan-tooltip-text--bottom::after,
  .ryokan-tooltip-text--bottom::before {
    top: auto;
    bottom: 100%;
  }
  .ryokan-tooltip-text--bottom::after {
    border-top-color: transparent;
    border-bottom-color: rgba(212, 180, 131, 0.15);
  }
  .ryokan-tooltip-text--bottom {
    transform: translateY(-4px);
  }
  .ryokan-tooltip-text--bottom::before {
    margin-top: 0;
    margin-bottom: 1px;
    border-top-color: transparent;
    border-bottom-color: #1c1c1e;
  }

  .ryokan-tooltip-text--visible {
    visibility: visible;
    opacity: 1;
    transform: translateY(0);
  }

  :global(.tooltip-hint) {
    color: #d4b483;
    font-weight: 500;
  }
  :global(.tooltip-warn) {
    color: #f0a070;
    font-weight: 500;
  }
</style>
