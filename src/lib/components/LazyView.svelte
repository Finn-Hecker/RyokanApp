<script lang="ts">
  import { untrack, type Component } from 'svelte';
  import type { LazyViewLoader } from '$lib/utils/lazyView';
  import { reportDiagnostic } from '$lib/utils/diagnostics';
  import * as m from '$lib/paraglide/messages';

  let { view }: { view: LazyViewLoader } = $props();
  let View = $state.raw<Component | undefined>(untrack(() => view.component));
  let failed = $state(false);
  let attempt = $state(0);

  $effect(() => {
    const loader = view;
    attempt;
    let active = true;
    View = loader.component;
    failed = false;
    if (!loader.component) {
      void loader.load().then(component => {
        if (active) View = component;
      }).catch(() => {
        if (active) {
          failed = true;
          reportDiagnostic('runtime');
        }
      });
    }
    return () => { active = false; };
  });
</script>

{#if View}
  <View />
{:else if failed}
  <div class="flex h-full min-h-32 items-center justify-center bg-ryokan-bg text-sm text-gray-400" role="alert">
    <div class="text-center">
      <p>{m.view_load_failed()}</p>
      <button class="mt-3 text-ryokan-accent" onclick={() => attempt += 1}>{m.chat_retry()}</button>
    </div>
  </div>
{:else}
  <div class="view-loading flex h-full min-h-32 items-center justify-center bg-ryokan-bg text-sm text-gray-500" role="status" aria-busy="true">
    <span>{m.settings_model_loading()}</span>
  </div>
{/if}

<style>
  .view-loading span {
    animation: reveal 0s 350ms both;
  }
  @keyframes reveal {
    from { opacity: 0; }
    to { opacity: 1; }
  }
</style>
