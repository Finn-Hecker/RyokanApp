<script lang="ts">
  import type { Snippet } from 'svelte';
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

  function toggle(e: MouseEvent) {
    e.stopPropagation();
    open = !open;
  }
</script>

<svelte:window onclick={() => (open = false)} />

<div class="ryokan-tooltip-wrapper" class:ryokan-tooltip-wrapper--open={open}>
  <button
    type="button"
    class="ryokan-tooltip-trigger"
    onclick={toggle}
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
    class="ryokan-tooltip-text ryokan-tooltip-text--{align}"
    style="width: min({width}px, calc(100vw - 48px))"
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
    position: absolute;
    bottom: calc(100% + 10px);
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
  }

  .ryokan-tooltip-text--center {
    left: 50%;
    transform: translateX(-50%) translateY(4px);
  }
  .ryokan-tooltip-text--left {
    left: 0;
    transform: translateY(4px);
  }
  .ryokan-tooltip-text--right {
    right: 0;
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

  .ryokan-tooltip-wrapper:hover .ryokan-tooltip-text,
  .ryokan-tooltip-wrapper:focus-within .ryokan-tooltip-text,
  .ryokan-tooltip-wrapper--open .ryokan-tooltip-text {
    visibility: visible;
    opacity: 1;
  }
  .ryokan-tooltip-wrapper:hover .ryokan-tooltip-text--center,
  .ryokan-tooltip-wrapper:focus-within .ryokan-tooltip-text--center,
  .ryokan-tooltip-wrapper--open .ryokan-tooltip-text--center {
    transform: translateX(-50%) translateY(0);
  }
  .ryokan-tooltip-wrapper:hover .ryokan-tooltip-text--left,
  .ryokan-tooltip-wrapper:hover .ryokan-tooltip-text--right,
  .ryokan-tooltip-wrapper:focus-within .ryokan-tooltip-text--left,
  .ryokan-tooltip-wrapper:focus-within .ryokan-tooltip-text--right,
  .ryokan-tooltip-wrapper--open .ryokan-tooltip-text--left,
  .ryokan-tooltip-wrapper--open .ryokan-tooltip-text--right {
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