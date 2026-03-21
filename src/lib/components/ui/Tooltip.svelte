<script lang="ts">
  import type { Snippet } from 'svelte';
  let { width = 230, children }: { width?: number; children?: Snippet } = $props();
</script>

<div class="ryokan-tooltip-wrapper">
  <svg
    width="15" height="15"
    viewBox="0 0 24 24"
    fill="none"
    stroke="#6b7280"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="10"/>
    <line x1="12" y1="16" x2="12" y2="12"/>
    <line x1="12" y1="8" x2="12.01" y2="8"/>
  </svg>

  <div class="ryokan-tooltip-text" style="width: {width}px">
    {@render children?.()}
  </div>
</div>


<style>
  .ryokan-tooltip-wrapper {
    position: relative;
    display: inline-flex;
    cursor: help;
  }
  .ryokan-tooltip-wrapper svg {
    transition: stroke 0.2s ease;
  }
  .ryokan-tooltip-wrapper:hover svg {
    stroke: #d4b483;
  }

  .ryokan-tooltip-text {
    visibility: hidden;
    opacity: 0;
    position: absolute;
    bottom: calc(100% + 10px);
    left: 50%;
    transform: translateX(-50%) translateY(4px);
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

  .ryokan-tooltip-text::after {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    border: 5px solid transparent;
    border-top-color: rgba(212, 180, 131, 0.15);
  }
  .ryokan-tooltip-text::before {
    content: '';
    position: absolute;
    top: 100%;
    left: 50%;
    transform: translateX(-50%);
    margin-top: 1px;
    border: 5px solid transparent;
    border-top-color: #1c1c1e;
    z-index: 1;
  }

  .ryokan-tooltip-wrapper:hover .ryokan-tooltip-text {
    visibility: visible;
    opacity: 1;
    transform: translateX(-50%) translateY(0);
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