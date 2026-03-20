<script lang="ts">
  import Button from '$lib/components/ui/Button.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    searchQuery,
    onResetSearch
  }: {
    searchQuery: string;
    onResetSearch: () => void;
  } = $props();
</script>

<div class="flex flex-col items-center justify-center py-24 text-center">
  {#if searchQuery.trim() !== ''}
    <p class="text-gray-600 text-sm">{m.lobby_empty_search({ query: searchQuery })}</p>
    <Button variant="ghost" size="sm" onclick={onResetSearch}>{m.lobby_reset_search()}</Button>
  {:else}
    <p class="text-gray-600 text-sm">{m.lobby_empty_state()}</p>
  {/if}
</div>