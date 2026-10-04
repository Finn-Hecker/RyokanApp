<script lang="ts">
  import Select from './Select.svelte';
  import type { Snippet } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let { items, selectedId, icon, onSelect }: {
    items: { id: string; label: string; badge: string }[];
    selectedId: string; icon: Snippet<[string]>; onSelect: (id: string) => void;
  } = $props();
</script>

<Select {items} value={selectedId} label={m.settings_provider_label()} {icon} {onSelect} />
