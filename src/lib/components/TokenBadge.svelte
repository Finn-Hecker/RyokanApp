<script lang="ts">
  import { countTokens } from '$lib/utils/tokenCount';

  let {
    text = '',
    count: countOverride
  }: {
    text?: string;
    count?: number;
    tooltip?: string;
  } = $props();

  let count = $derived(countOverride ?? countTokens(text));
</script>

<span class="token-badge">
  {count} {count === 1 ? 'Token' : 'Tokens'}
</span>

<style>
  .token-badge {
    display: inline-flex;
    align-items: center;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.04em;
    color: rgba(255, 255, 255, 0.35);
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 999px;
    padding: 2px 8px;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition: color 0.15s, border-color 0.15s, background 0.15s;
  }

  .token-badge:hover {
    color: rgba(255, 255, 255, 0.65);
    background: rgba(255, 255, 255, 0.08);
    border-color: rgba(255, 255, 255, 0.18);
  }
</style>