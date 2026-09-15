<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { fade }       from 'svelte/transition';
  import SimpleFormPage from '$lib/components/layouts/SimpleFormPage.svelte';
  import Button         from '$lib/components/ui/Button.svelte';
  import WorldInfoList  from './WorldInfoList.svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import { navigateTo, returnTo } from '$lib/stores/navigation';

  function goBack() { returnTo('lobby'); }

  function openCreate() {
    appState.editingCharacter = null;
    navigateTo('worldInfoEditor');
  }

  let createLabel = $derived(m.list_create_wi());
</script>

<div class="h-full w-full" in:fade={{ duration: 160 }}>
  
  {#snippet actions()}
    <div class="header-row">
      <Button variant="icon" ariaLabel={m.list_aria_back()} onclick={goBack}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M15 18l-6-6 6-6"/>
        </svg>
      </Button>

      <button class="create-btn" onclick={openCreate}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="2.5"
             stroke-linecap="round" stroke-linejoin="round">
          <line x1="12" y1="5" x2="12" y2="19"/>
          <line x1="5" y1="12" x2="19" y2="12"/>
        </svg>
        {createLabel}
      </button>
    </div>
  {/snippet}

  <SimpleFormPage maxWidth="max-w-2xl" {actions}>

    <div in:fade={{ duration: 140, delay: 30 }}>
      <WorldInfoList />
    </div>

  </SimpleFormPage>
</div>

<style>
  .header-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    gap: 10px;
  }

  .create-btn {
    display: inline-flex;
    align-items: center;
    gap: 7px;
    padding: 8px 16px;
    border-radius: 10px;
    border: 1px solid rgba(212, 180, 131, 0.28);
    background: rgba(212, 180, 131, 0.08);
    color: #d4b483;
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s, border-color 0.15s, transform 0.1s;
  }

  .create-btn:hover {
    background: rgba(212, 180, 131, 0.14);
    border-color: rgba(212, 180, 131, 0.42);
    transform: translateY(-1px);
  }

  .create-btn:active { transform: translateY(0); }
</style>
