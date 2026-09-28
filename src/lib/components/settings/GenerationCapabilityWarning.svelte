<script lang="ts">
  import { getLocale } from '$lib/paraglide/runtime';
  import type { ApiParameterKey } from '$lib/utils/apiParameters';
  import { generationParameterStatus, type GenerationConnection } from '$lib/utils/generationCapabilities';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  let { connection, parameter }: { connection: GenerationConnection; parameter: ApiParameterKey } = $props();
  const warning = $derived(generationParameterStatus(connection, parameter) === 'unreported');
  const message = $derived(getLocale().startsWith('de')
    ? 'Dieses Modell meldet diesen Parameter nicht als unterstützt. Der Provider kann ihn ignorieren oder die Anfrage ablehnen.'
    : 'This model does not report support for this parameter. The provider may ignore it or reject the request.');
</script>

{#if warning}
  <Tooltip variant="warning" ariaLabel={message} width={260}>{message}</Tooltip>
{/if}
