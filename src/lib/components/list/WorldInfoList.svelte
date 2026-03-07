<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { onMount }    from 'svelte';
  import { fade }       from 'svelte/transition';
  import { worldInfoState, loadWorldInfos, type WorldInfo } from '$lib/stores/worldInfoStore.svelte';
  import { deleteWorldInfo }  from '$lib/components/editor/worldinfo/worldInfoLogic';
  import { appState } from '$lib/stores/appState.svelte';
  import { DEFAULT_WORLD_INFOS } from '$lib/data/worldInfo';

  let deletingId = $state<string | null>(null);

  let userWorldInfos = $derived(
    worldInfoState.allWorldInfos.filter(w => !DEFAULT_WORLD_INFOS.some(d => d.id === w.id))
  );

  onMount(() => loadWorldInfos());

  function openEdit(wi: WorldInfo) {
    appState.editingCharacter = (wi as any);
    appState.currentView = 'worldInfoEditor';
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

<div class="hero">
  <div class="hero-icon">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" stroke-width="1.6"
         stroke-linecap="round" stroke-linejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="2" y1="12" x2="22" y2="12"/>
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
    </svg>
  </div>
  <div class="hero-text">
    <h1 class="page-title">{m.wi_list_title()}</h1>
    <p class="page-subtitle">{m.wi_list_subtitle()}</p>
  </div>
  {#if userWorldInfos.length > 0}
    <span class="count-badge">{userWorldInfos.length}</span>
  {/if}
</div>

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
      <div class="section-line"></div>
    </div>
  {/if}

  {#each userWorldInfos as wi (wi.id)}
    {@const c = counts(wi)}
    <div class="wi-card" role="button" tabindex="0"
         onclick={() => openEdit(wi)}
         onkeydown={e => e.key === 'Enter' && openEdit(wi)}>
      <div class="wi-card__inner">

        <div class="wi-icon wi-icon--accent">
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
            <button class="action-btn" title={m.list_btn_edit()}
              onclick={(e) => { e.stopPropagation(); openEdit(wi); }}>
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                   stroke="currentColor" stroke-width="2.2"
                   stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
            </button>
            <button class="action-btn action-btn--danger" title={m.list_btn_delete()}
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

<style>
  .hero {
    display: flex;
    align-items: flex-start;
    gap: 16px;
    margin-bottom: 32px;
  }

  .hero-icon {
    flex-shrink: 0;
    width: 52px;
    height: 52px;
    border-radius: 16px;
    background: linear-gradient(135deg, rgba(212,180,131,.16) 0%, rgba(212,180,131,.07) 100%);
    border: 1px solid rgba(212,180,131,.20);
    display: flex;
    align-items: center;
    justify-content: center;
    color: #d4b483;
    margin-top: 2px;
  }

  .hero-text { flex: 1; min-width: 0; }

  .count-badge {
    margin-left: auto;
    align-self: flex-start;
    margin-top: 6px;
    font-size: 11px;
    font-weight: 700;
    color: #d4b483;
    background: rgba(212,180,131,.10);
    border: 1px solid rgba(212,180,131,.20);
    border-radius: 20px;
    padding: 3px 10px;
    letter-spacing: .03em;
  }

  .page-title {
    font-size: 1.75rem;
    font-weight: 500;
    color: #f3f4f6;
    letter-spacing: -.02em;
    line-height: 1.2;
    margin-bottom: 5px;
  }

  .page-subtitle {
    font-size: .875rem;
    color: #6b7280;
    line-height: 1.55;
  }

  .list {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }

  .section-divider {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 0 4px;
  }

  .section-label {
    flex-shrink: 0;
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: .10em;
    color: #4b5563;
  }

  .section-line {
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,.05);
  }

  .wi-card {
    width: 100%;
    background: rgba(255,255,255,.03);
    border: 1px solid rgba(255,255,255,.06);
    border-radius: 14px;
    overflow: hidden;
    cursor: pointer;
    transition: background .18s, border-color .18s, box-shadow .18s, transform .12s;
  }

  .wi-card--readonly {
    cursor: default;
    pointer-events: none;
  }

  .wi-card:hover {
    background: rgba(255,255,255,.055);
    border-color: rgba(212,180,131,.22);
    box-shadow: 0 4px 24px rgba(0,0,0,.22);
    transform: translateY(-1px);
  }

  .wi-card:active { transform: translateY(0); }

  .wi-card__inner {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 14px 18px;
  }

  .wi-icon {
    flex-shrink: 0;
    width: 46px;
    height: 46px;
    border-radius: 13px;
    background: rgba(255,255,255,.04);
    border: 1px solid rgba(255,255,255,.08);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(255,255,255,.3);
  }

  .wi-icon--accent {
    background: rgba(212,180,131,.08);
    border-color: rgba(212,180,131,.16);
    color: #d4b483;
  }

  .wi-info { flex: 1; min-width: 0; }

  .wi-name {
    font-size: 14px;
    font-weight: 600;
    color: #e5e7eb;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    transition: color .15s;
  }

  .wi-card:hover .wi-name { color: #f9fafb; }

  .wi-desc {
    font-size: 12px;
    color: #4b5563;
    margin-top: 2px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .wi-empty-hint {
    font-size: 11.5px;
    color: #374151;
    margin-top: 4px;
    font-style: italic;
  }

  .wi-stats {
    display: flex;
    align-items: center;
    gap: 5px;
    margin-top: 7px;
    flex-wrap: wrap;
  }

  .stat-pill {
    font-size: 10.5px;
    font-weight: 600;
    letter-spacing: .03em;
    padding: 2px 9px;
    border-radius: 6px;
  }

  .stat-pill--total {
    background: rgba(255,255,255,.05);
    color: rgba(255,255,255,.3);
    border: 1px solid rgba(255,255,255,.07);
  }

  .stat-pill--before {
    background: rgba(212,180,131,.10);
    color: rgba(212,180,131,.80);
    border: 1px solid rgba(212,180,131,.18);
  }

  .stat-pill--after {
    background: rgba(251,146,60,.10);
    color: rgba(253,186,116,.75);
    border: 1px solid rgba(251,146,60,.15);
  }

  .wi-card__right { flex-shrink: 0; }

  .actions {
    display: flex;
    align-items: center;
    gap: 5px;
    opacity: 0;
    transition: opacity .15s;
  }

  .wi-card:hover .actions { opacity: 1; }

  .action-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: 1px solid rgba(255,255,255,.08);
    background: rgba(255,255,255,.05);
    color: #6b7280;
    cursor: pointer;
    font-family: inherit;
    transition: background .12s, color .12s, border-color .12s;
  }

  .action-btn:hover {
    background: rgba(255,255,255,.10);
    border-color: rgba(255,255,255,.14);
    color: #e5e7eb;
  }

  .action-btn--danger:hover {
    background: rgba(239,68,68,.12);
    border-color: rgba(239,68,68,.20);
    color: #f87171;
  }

  .action-btn:disabled { opacity: .4; cursor: not-allowed; }

  .badge-standard {
    font-size: 10px;
    font-weight: 700;
    letter-spacing: .04em;
    text-transform: uppercase;
    padding: 3px 9px;
    border-radius: 6px;
    background: rgba(212,180,131,.10);
    color: rgba(212,180,131,.70);
    border: 1px solid rgba(212,180,131,.18);
    white-space: nowrap;
    flex-shrink: 0;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    padding: 48px 24px;
    text-align: center;
    background: rgba(255,255,255,.02);
    border: 1px dashed rgba(255,255,255,.07);
    border-radius: 16px;
    margin-top: 4px;
  }

  .empty-icon {
    width: 60px;
    height: 60px;
    border-radius: 18px;
    background: linear-gradient(135deg, rgba(212,180,131,.12) 0%, rgba(212,180,131,.06) 100%);
    border: 1px solid rgba(212,180,131,.16);
    display: flex;
    align-items: center;
    justify-content: center;
    color: rgba(212,180,131,.55);
    margin-bottom: 4px;
  }

  .empty-title {
    font-size: 15px;
    font-weight: 500;
    color: #9ca3af;
  }

  .empty-sub {
    font-size: 13px;
    color: #4b5563;
    line-height: 1.6;
    max-width: 300px;
  }

  @keyframes spin { to { transform: rotate(360deg); } }
  :global(.spin) { animation: spin .6s linear infinite; }
</style>