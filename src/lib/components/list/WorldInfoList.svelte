<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount }    from 'svelte';
  import { fade }       from 'svelte/transition';
  import { worldInfoState, loadWorldInfos, type WorldInfo } from '$lib/stores/worldInfoStore.svelte';
  import { deleteWorldInfo }  from '$lib/components/editor/worldinfo/worldInfoLogic';
  import { appState } from '$lib/stores/appState.svelte';
  import { navigateTo } from '$lib/stores/navigation';
  import { DEFAULT_WORLD_INFOS } from '$lib/data/worldInfo';

  let deletingId = $state<string | null>(null);

  let userWorldInfos = $derived(
    worldInfoState.allWorldInfos.filter(w => !DEFAULT_WORLD_INFOS.some(d => d.id === w.id))
  );

  onMount(() => loadWorldInfos());

  function openEdit(wi: WorldInfo) {
    appState.editingCharacter = (wi as any);
    navigateTo('worldInfoEditor');
  }

  async function handleDelete(id: string, e: MouseEvent) {
    e.stopPropagation();
    deletingId = id;
    try {
      await deleteWorldInfo(id);
      worldInfoState.allWorldInfos = worldInfoState.allWorldInfos.filter(w => w.id !== id);
    } finally {
      deletingId = null;
    }
  }

  function counts(wi: WorldInfo) {
    const active = wi.entries.filter(e => e.enabled);
    return {
      before: active.filter(e => e.position === 'before').length,
      after:  active.filter(e => e.position === 'after').length,
      total:  wi.entries.length,
    };
  }
</script>

<div class="list">

  {#each DEFAULT_WORLD_INFOS as wi (wi.id)}
    {@const c = counts(wi)}
    <div class="wi-card wi-card--readonly">
      <div class="wi-card__inner">

        <div class="wi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>

        <div class="wi-info">
          <h3 class="wi-name">{wi.name}</h3>
          {#if wi.description}
            <p class="wi-desc">{wi.description}</p>
          {/if}
          {#if c.total > 0}
            <div class="wi-stats">
              <span class="stat-pill stat-pill--total">
                {c.total} {c.total === 1 ? m.wi_list_entry_singular() : m.wi_list_entry_plural()}
              </span>
              {#if c.before > 0}
                <span class="stat-pill stat-pill--before">↑ {c.before} Before</span>
              {/if}
              {#if c.after > 0}
                <span class="stat-pill stat-pill--after">↓ {c.after} After</span>
              {/if}
            </div>
          {:else}
            <p class="wi-empty-hint">{m.wi_list_empty_hint()}</p>
          {/if}
        </div>

        <div class="wi-card__right">
          <span class="badge-standard">{m.roles_list_badge_standard()}</span>
        </div>

      </div>
    </div>
  {/each}

  {#if userWorldInfos.length > 0}
    <div class="section-divider">
      <span class="section-label">{m.wi_list_custom_section()}</span>
    </div>
  {/if}

  {#each userWorldInfos as wi (wi.id)}
    {@const c = counts(wi)}
    <div class="wi-card" role="button" tabindex="0"
         onclick={() => openEdit(wi)}
         onkeydown={e => { if (e.target !== e.currentTarget) return; if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openEdit(wi); } }}>
      <div class="wi-card__inner">

        <div class="wi-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
               stroke="currentColor" stroke-width="1.8"
               stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="2" y1="12" x2="22" y2="12"/>
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
          </svg>
        </div>

        <div class="wi-info">
          <h3 class="wi-name">{wi.name}</h3>
          {#if wi.description}
            <p class="wi-desc">{wi.description}</p>
          {/if}
          {#if c.total > 0}
            <div class="wi-stats">
              <span class="stat-pill stat-pill--total">
                {c.total} {c.total === 1 ? m.wi_list_entry_singular() : m.wi_list_entry_plural()}
              </span>
              {#if c.before > 0}
                <span class="stat-pill stat-pill--before">↑ {c.before} Before</span>
              {/if}
              {#if c.after > 0}
                <span class="stat-pill stat-pill--after">↓ {c.after} After</span>
              {/if}
            </div>
          {:else}
            <p class="wi-empty-hint">{m.wi_list_empty_hint()}</p>
          {/if}
        </div>

        <div class="wi-card__right">
          <div class="actions">
            <button class="action-btn" aria-label={m.list_btn_edit()} title={m.list_btn_edit()}
              onclick={(e) => { e.stopPropagation(); openEdit(wi); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="action-btn action-btn--danger" aria-label={m.list_btn_delete()} title={m.list_btn_delete()}
              disabled={deletingId === wi.id}
              onclick={e => handleDelete(wi.id, e)}>
              {#if deletingId === wi.id}
                <svg class="spin" width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.5">
                  <path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round"/>
                </svg>
              {:else}
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" stroke-width="2.2"
                     stroke-linecap="round" stroke-linejoin="round">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                  <path d="M10 11v6M14 11v6"/>
                  <path d="M9 6V4h6v2"/>
                </svg>
              {/if}
            </button>
          </div>
        </div>

      </div>
    </div>
  {/each}

  {#if worldInfoState.allWorldInfos.length === 0}
    <div class="empty-state" in:fade={{ duration: 200 }}>
      <div class="empty-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
             stroke="currentColor" stroke-width="1.4"
             stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="10"/>
          <line x1="2" y1="12" x2="22" y2="12"/>
          <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
        </svg>
      </div>
      <p class="empty-title">{m.wi_list_empty_state_title()}</p>
      <p class="empty-sub">{m.wi_list_empty_state_sub()}</p>
    </div>
  {/if}
</div>
