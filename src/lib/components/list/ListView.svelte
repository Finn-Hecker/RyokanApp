<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { fade }       from 'svelte/transition';
  import './library.css';
  import Button         from '$lib/components/ui/Button.svelte';
  import WorldInfoList  from './WorldInfoList.svelte';
  import RoleList from './RoleList.svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import { navigateTo, returnTo } from '$lib/stores/navigation';

  function goBack() { returnTo('lobby'); }

  let activeTab = $derived(appState.listTab);

  function openCreate() {
    appState.editingCharacter = null;
    navigateTo(activeTab === 'roles' ? 'roleEditor' : 'worldInfoEditor');
  }

  let createLabel = $derived(activeTab === 'roles' ? m.list_create_role() : m.list_create_wi());
</script>


{#snippet backButton()}
  <Button variant="icon" ariaLabel={m.list_aria_back()} onclick={goBack}>
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
  </Button>
{/snippet}

<div class="library-shell" in:fade={{ duration: 160 }}>
  <header class="app-page-header library-header">
    <div class="mobile-back">{@render backButton()}</div>
    <div class="header-copy">
      <h1>{activeTab === 'roles' ? m.roles_list_title() : m.wi_list_title()}</h1>
      <p>{activeTab === 'roles' ? m.roles_list_subtitle() : m.wi_list_subtitle()}</p>
    </div>
    <div class="header-actions">
      <div class="desktop-back">{@render backButton()}</div>
      <Button variant="secondary" ariaLabel={createLabel} title={createLabel} onclick={openCreate}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 5v14M5 12h14" stroke-linecap="round" /></svg>
        <span class="create-label">{createLabel}</span>
      </Button>
    </div>
  </header>
  <main class="library-scroll">
    <div class="library-content">
      <nav class="tab-bar" aria-label={m.list_tab_roles() + ' / ' + m.list_tab_wi()}>
        <button class:active={activeTab === 'roles'} aria-current={activeTab === 'roles' ? 'page' : undefined} onclick={() => (appState.listTab = 'roles')}>{m.list_tab_roles()}</button>
        <button class:active={activeTab === 'worldinfo'} aria-current={activeTab === 'worldinfo' ? 'page' : undefined} onclick={() => (appState.listTab = 'worldinfo')}>{m.list_tab_wi()}</button>
      </nav>
      <p class="mobile-description">{activeTab === 'roles' ? m.roles_list_subtitle() : m.wi_list_subtitle()}</p>
      {#if activeTab === 'roles'}<RoleList />{:else}<WorldInfoList />{/if}
    </div>
  </main>
</div>

<style>
  .library-shell { height:100%; width:100%; display:flex; flex-direction:column; overflow:hidden; background:var(--color-ryokan-bg); }
  .library-header { flex:none; display:grid; grid-template-columns:40px minmax(0,1fr) auto; align-items:center; gap:8px; border-bottom:1px solid rgba(255,255,255,.05); }
  .header-copy { min-width:0; }
  .header-copy h1 { color:#e7e2da; font-size:17px; font-weight:650; letter-spacing:-.01em; overflow-wrap:anywhere; }
  .header-copy p { margin-top:2px; color:#5e5e63; font-size:11px; }
  .header-actions { display:flex; align-items:center; gap:10px; }
  .desktop-back,.header-copy p,.create-label { display:none; }
  .library-scroll { flex:1; min-height:0; overflow-y:auto; overflow-x:hidden; scrollbar-width:none; }
  .library-scroll::-webkit-scrollbar { display:none; }
  .library-content { max-width:724px; margin:0 auto; padding:var(--page-content-top) var(--page-gutter) calc(36px + env(safe-area-inset-bottom)); }
  .tab-bar { display:flex; gap:4px; padding:4px; margin-bottom:20px; border:1px solid rgba(255,255,255,.055); border-radius:12px; background:rgba(255,255,255,.025); }
  .tab-bar button { flex:1; min-width:0; min-height:40px; padding:8px 12px; border-radius:9px; color:#85858b; font-size:13px; font-weight:560; cursor:pointer; transition:color .15s,background .15s; }
  .tab-bar button:hover { color:#bbb8b5; background:rgba(255,255,255,.03); }
  .tab-bar button.active { color:#d8c5a8; background:rgba(212,180,131,.075); }
  .tab-bar button:focus-visible { outline:2px solid var(--accent); outline-offset:2px; }
  .mobile-description { margin-bottom:20px; color:#85858b; font-size:12px; line-height:1.55; }
  @media (min-width:768px) {
    .library-header { display:flex; justify-content:space-between; gap:24px; }
    .header-copy h1 { font-size:18px; }
    .desktop-back,.header-copy p,.create-label { display:block; }
    .mobile-back,.mobile-description { display:none; }
    .library-content { padding-bottom:72px; }
    .tab-bar { margin-bottom:24px; }
  }
</style>
