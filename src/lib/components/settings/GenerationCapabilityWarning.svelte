<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import type { ApiParameterKey } from '$lib/utils/apiParameters';
  import { generationParameterStatus, type GenerationConnection } from '$lib/utils/generationCapabilities';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  let { connection, parameter }: { connection: GenerationConnection; parameter: ApiParameterKey } = $props();
  const warning = $derived(generationParameterStatus(connection, parameter) === 'unreported');
  const message = $derived(m.settings_generation_capability_unreported());
</script>

{#if warning}
  <Tooltip variant="warning" ariaLabel={message} width={260}>{message}</Tooltip>
{/if}
