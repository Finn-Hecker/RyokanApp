<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount }    from 'svelte';
  import { fade }       from 'svelte/transition';
  import SimpleFormPage from '$lib/components/layouts/SimpleFormPage.svelte';
  import Button         from '$lib/components/ui/Button.svelte';
  import RolesList      from './RolesList.svelte';
  import WorldInfoList  from './WorldInfoList.svelte';
  import { appState } from '$lib/stores/appState.svelte';

  type Tab = 'roles' | 'worldinfo';
  
  let activeTab = $state<Tab>('roles');

  onMount(() => {
    activeTab = appState.listInitialTab;
  });

  function goBack() { appState.currentView = 'lobby'; }

  function openCreate() {
    appState.editingCharacter = null;
    appState.currentView = activeTab === 'roles' ? 'roleEditor' : 'worldInfoEditor';
  }

  let createLabel = $derived(activeTab === 'roles' ? m.list_create_role() : m.list_create_wi());
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

    <div class="tab-row">
      <div class="tab-switcher">
        <button
          class="tab-btn"
          class:tab-btn--active={activeTab === 'roles'}
          onclick={() => (activeTab = 'roles')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
            <path d="M8 14s1.5 2 4 2 4-2 4-2"/>
            <line x1="9" y1="9" x2="9.01" y2="9"/>
            <line x1="15" y1="9" x2="15.01" y2="9"/>
          </svg>
          {m.list_tab_roles()}
        </button>
        <button
          class="tab-btn"
          class:tab-btn--active={activeTab === 'worldinfo'}
          onclick={() => (activeTab = 'worldinfo')}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="2.2"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
          {m.list_tab_wi()}
        </button>
      </div>
    </div>

    {#key activeTab}
      <div in:fade={{ duration: 140, delay: 30 }}>
        {#if activeTab === 'roles'}
          <RolesList />
        {:else}
          <WorldInfoList />
        {/if}
      </div>
    {/key}

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

  .tab-row {
    margin-bottom: 32px;
  }

  .tab-switcher {
    display: flex;
    width: 100%;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 12px;
    padding: 4px;
    gap: 3px;
  }

  .tab-btn {
    flex: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    padding: 9px 16px;
    border-radius: 9px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.28);
    font-size: 13px;
    font-weight: 500;
    font-family: inherit;
    cursor: pointer;
    white-space: nowrap;
    min-height: 36px;
    letter-spacing: 0.01em;
    transition: color 0.16s, background 0.16s, box-shadow 0.16s;
  }

  .tab-btn:hover:not(.tab-btn--active) {
    color: rgba(255, 255, 255, 0.50);
    background: rgba(255, 255, 255, 0.04);
  }

  .tab-btn--active {
    background: rgba(255, 255, 255, 0.07);
    color: #f9fafb;
    box-shadow:
      0 1px 4px rgba(0, 0, 0, 0.4),
      inset 0 1px 0 rgba(255, 255, 255, 0.07);
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