<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { getLocale } from '$lib/paraglide/runtime';
  import { roleState } from '$lib/stores/roleStore.svelte';
  import { chatState } from '$lib/stores/chatStore.svelte';
  import Tooltip from '$lib/components/ui/Tooltip.svelte';

  let {
    character = null,
    activeTab = $bindable('character'),
    onClose
  }: {
    character?: any;
    activeTab?: 'character' | 'role' | 'chat';
    onClose: () => void;
  } = $props();

  let activeRole = $derived(
    roleState.allRoles.find(p => p.id === roleState.activeRoleId) ?? null
  );

  let activeConversation = $derived(
    chatState.conversations.find(c => c.id === chatState.activeChatId) ?? null
  );

  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') onClose();
  }

  // Closes only when the backdrop itself is clicked, so no
  // stopPropagation handler on the panel is needed (a11y warnings).
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }

  const dateFormatter = new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short'
  });

  function parseServerDate(dateStr: string): Date {
    const hasTimezone = /Z$|[+-]\d{2}:?\d{2}$/.test(dateStr);
    return new Date(hasTimezone ? dateStr : `${dateStr}Z`);
  }

  function formatDate(dateStr?: string | null): string {
    if (!dateStr) return '–';
    try {
      return dateFormatter.format(parseServerDate(dateStr));
    } catch {
      return '–';
    }
  }

  const numberFormatter = new Intl.NumberFormat(getLocale(), {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });

  function formatRelativeTime(dateStr?: string | null): string {
    if (!dateStr) return '';
    const diffMs = Date.now() - parseServerDate(dateStr).getTime();
    const diffMin = Math.floor(diffMs / 60000);

    if (diffMin < 1) return m.chat_time_just_now();
    if (diffMin < 60) {
      return diffMin === 1 ? m.chat_time_minute_ago() : m.chat_time_minutes_ago({ count: diffMin });
    }

    const diffHours = Math.floor(diffMin / 60);
    if (diffHours < 24) {
      return diffHours === 1 ? m.chat_time_hour_ago() : m.chat_time_hours_ago({ count: diffHours });
    }

    const diffDays = Math.floor(diffHours / 24);
    return diffDays === 1 ? m.chat_time_day_ago() : m.chat_time_days_ago({ count: diffDays });
  }

  function wordCount(text: string): number {
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  let chatStats = $derived((() => {
    const msgs = chatState.currentMessages;
    const userMsgs = msgs.filter(msg => msg.role === 'user');
    const aiMsgs = msgs.filter(msg => msg.role === 'assistant');
    const total = msgs.length;

    const userWords = userMsgs.reduce((sum, msg) => sum + wordCount(msg.content), 0);
    const aiWords = aiMsgs.reduce((sum, msg) => sum + wordCount(msg.content), 0);
    const totalVariants = aiMsgs.reduce(
      (sum, msg) => sum + Math.max(0, (msg.swipe_variants?.length ?? 1) - 1),
      0
    );

    const userAvgWords = userMsgs.length > 0 ? userWords / userMsgs.length : 0;

    const promptLever = userWords > 0 ? aiWords / userWords : 0;

    return {
      total,
      userCount: userMsgs.length,
      aiCount: aiMsgs.length,
      userWords,
      aiWords,
      totalVariants,
      userAvgWords: Math.round(userAvgWords),
      promptLever,
    };
  })());
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="info-overlay"
  role="presentation"
  onclick={handleOverlayClick}
  onkeydown={handleWindowKeydown}
>
  <div class="info-panel" role="dialog" aria-modal="true" aria-label="Info">
    <div class="info-panel-header">
      <div class="info-tabs">
        <button
          class="info-tab"
          class:active={activeTab === 'character'}
          onclick={() => (activeTab = 'character')}
        >
          Character
        </button>
        <button
          class="info-tab"
          class:active={activeTab === 'role'}
          onclick={() => (activeTab = 'role')}
        >
          Rolle
        </button>
        <button
          class="info-tab"
          class:active={activeTab === 'chat'}
          onclick={() => (activeTab = 'chat')}
        >
          Chat
        </button>
      </div>
      <button class="info-close-btn" onclick={onClose} aria-label="Schließen">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="info-body">
      {#if activeTab === 'character'}
        {#if character}
          <div class="info-head">
            <div class="info-avatar" style="--char-color: {character?.colorHex ?? '#6366f1'}">
              {#if character.avatarUrl}
                <img src={character.avatarUrl} alt={character.name} />
              {:else}
                <div class="info-avatar-fallback {character.color ?? 'bg-ryokan-surface'}">
                  <span>{character.initials ?? (character.name?.[0]?.toUpperCase() ?? '?')}</span>
                </div>
              {/if}
            </div>
            <div class="info-head-text">
              <h3>{character.name}</h3>
            </div>
          </div>

          <div class="info-fields">
            {#if character.desc}
              <div class="info-field">
                <span class="info-label">Beschreibung</span>
                <p class="info-value">{character.desc}</p>
              </div>
            {/if}
            {#if character.personality}
              <div class="info-field">
                <span class="info-label">Persönlichkeit</span>
                <p class="info-value">{character.personality}</p>
              </div>
            {/if}
            {#if character.scenario}
              <div class="info-field">
                <span class="info-label">Szenario</span>
                <p class="info-value">{character.scenario}</p>
              </div>
            {/if}
            {#if character.greeting}
              <div class="info-field">
                <span class="info-label">Begrüßung</span>
                <p class="info-value">{character.greeting}</p>
              </div>
            {/if}
            {#if character.creator_notes}
              <div class="info-field">
                <span class="info-label">Notizen</span>
                <p class="info-value">{character.creator_notes}</p>
              </div>
            {/if}

            {#if !character.personality && !character.scenario && !character.greeting && !character.creator_notes && !character.desc}
              <p class="info-empty">Keine weiteren Informationen hinterlegt.</p>
            {/if}
          </div>
        {:else}
          <p class="info-empty">Kein Charakter ausgewählt.</p>
        {/if}

      {:else if activeTab === 'role'}
        {#if activeRole}
          <div class="info-head">
            <div class="info-avatar" style="--char-color: #6366f1">
              {#if activeRole.avatarUrl}
                <img src={activeRole.avatarUrl} alt={activeRole.name} />
              {:else}
                <div class="info-avatar-fallback bg-ryokan-surface">
                  <span>{activeRole.name?.[0]?.toUpperCase() ?? '?'}</span>
                </div>
              {/if}
            </div>
            <div class="info-head-text">
              <h3>{activeRole.name}</h3>
              {#if activeRole.pronouns}
                <p class="info-subtitle">{activeRole.pronouns}</p>
              {/if}
            </div>
          </div>

          <div class="info-fields">
            {#if activeRole.bio}
              <div class="info-field">
                <span class="info-label">Bio</span>
                <p class="info-value">{activeRole.bio}</p>
              </div>
            {:else}
              <p class="info-empty">Keine Bio hinterlegt.</p>
            {/if}
          </div>
        {:else}
          <p class="info-empty">Keine Rolle ausgewählt.</p>
        {/if}

      {:else}
        <div class="info-head">
          <div class="info-avatar info-avatar--icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
          </div>
          <div class="info-head-text">
            <h3>{activeConversation?.title ?? m.chat_info_default_title()}</h3>
            {#if activeConversation}
              <p class="info-subtitle">{m.chat_started_label({ time: formatRelativeTime(activeConversation.created_at) })}</p>
            {/if}
          </div>
        </div>

        {#if chatStats.total > 0}
          <div class="stat-grid">
            <div class="stat-card">
              <span class="stat-value">{chatStats.total}</span>
              <span class="stat-label">
                {m.chat_stats_messages_label()}
                <Tooltip width={190} align="left">{m.chat_stats_messages_tooltip()}</Tooltip>
              </span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{chatStats.userCount}</span>
              <span class="stat-label">
                {m.chat_stats_from_you_label()}
                <Tooltip width={190} align="center">{m.chat_stats_from_you_tooltip()}</Tooltip>
              </span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{chatStats.aiCount}</span>
              <span class="stat-label">
                {m.chat_stats_from_ai_label()}
                <Tooltip width={190} align="right">{m.chat_stats_from_ai_tooltip()}</Tooltip>
              </span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{chatStats.totalVariants}</span>
              <span class="stat-label">
                {m.chat_stats_regenerated_label()}
                <Tooltip width={190} align="left">{m.chat_stats_regenerated_tooltip()}</Tooltip>
              </span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{chatStats.userWords > 0 ? `${numberFormatter.format(chatStats.promptLever)}×` : '–'}</span>
              <span class="stat-label">
                {m.chat_stats_lever_label()}
                <Tooltip width={210} align="center">{m.chat_stats_lever_tooltip()}</Tooltip>
              </span>
            </div>
            <div class="stat-card">
              <span class="stat-value">{chatStats.userCount > 0 ? chatStats.userAvgWords : '–'}</span>
              <span class="stat-label">
                {m.chat_stats_depth_label()}
                <Tooltip width={210} align="right">{m.chat_stats_depth_tooltip()}</Tooltip>
              </span>
            </div>
          </div>

          <div class="info-fields">
            {#if activeConversation}
              <div class="info-field">
                <span class="info-label">{m.chat_stats_created_label()}</span>
                <p class="info-value">{formatDate(activeConversation.created_at)}</p>
              </div>
              <div class="info-field">
                <span class="info-label">{m.chat_stats_last_active_label()}</span>
                <p class="info-value">{formatDate(activeConversation.updated_at)}</p>
              </div>
            {/if}
          </div>

          {#if chatState.hasMoreMessages}
            <p class="info-hint">{m.chat_stats_older_messages_hint()}</p>
          {/if}
        {:else}
          <p class="info-empty">{m.chat_stats_empty()}</p>
        {/if}
      {/if}
    </div>
  </div>
</div>

<style>
  .info-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(8, 8, 12, 0.6);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
    animation: overlay-in 160ms ease;
  }

  @keyframes overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  /* Mobile: full-width bottom sheet with a fixed height */
  @media (max-width: 639px) {
    .info-overlay {
      padding: 0;
      align-items: flex-end;
    }

    .info-panel {
      width: 100%;
      height: min(640px, 88dvh);
      border-radius: 20px 20px 0 0;
      border-left: none;
      border-right: none;
      border-bottom: none;
      animation: sheet-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .info-body {
      padding: 16px 16px calc(18px + env(safe-area-inset-bottom));
    }

    .info-tab {
      padding: 12px 8px;
      font-size: 13px;
    }

    .info-close-btn {
      width: 36px;
      height: 36px;
    }
  }

  @keyframes sheet-in {
    from { opacity: 0.6; transform: translateY(40px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .info-panel,
    .info-overlay {
      animation: none;
    }
  }

  .info-panel {
    position: relative;
    width: min(560px, 100%);
    /* Fixed height: the panel keeps its size regardless of tab content */
    height: min(640px, 85dvh);
    display: flex;
    flex-direction: column;
    background: rgba(20, 20, 26, 0.98);
    border: 1px solid rgba(255,255,255,0.09);
    border-radius: 18px;
    overflow: hidden;
    box-shadow: 0 24px 70px rgba(0,0,0,0.6), 0 4px 16px rgba(0,0,0,0.4);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    animation: panel-in 180ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes panel-in {
    from { opacity: 0; transform: scale(0.95) translateY(6px); }
    to   { opacity: 1; transform: scale(1) translateY(0); }
  }

  .info-panel-header {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 10px 10px 0 14px;
    flex-shrink: 0;
  }

  .info-tabs {
    display: flex;
    gap: 4px;
    flex: 1;
    min-width: 0;
  }

  .info-tab {
    flex: 1;
    padding: 10px 8px;
    border-radius: 10px 10px 0 0;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.42);
    font-size: 12.5px;
    font-weight: 600;
    letter-spacing: 0.02em;
    cursor: pointer;
    transition: color 140ms ease, background 140ms ease;
    white-space: nowrap;
  }

  .info-tab:hover {
    color: rgba(255,255,255,0.75);
  }

  .info-tab.active {
    color: #d4b483;
    background: rgba(212, 180, 131, 0.10);
  }

  .info-close-btn {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
    margin-bottom: 6px;
  }

  .info-close-btn:hover {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.9);
  }

  .info-body {
    flex: 1;
    min-height: 0;
    padding: 18px 22px 22px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
  }

  .info-head {
    display: flex;
    align-items: center;
    gap: 13px;
    padding-bottom: 16px;
    margin-bottom: 16px;
    border-bottom: 1px solid rgba(255,255,255,0.07);
  }

  .info-avatar {
    width: 52px;
    height: 52px;
    border-radius: 14px;
    overflow: hidden;
    flex-shrink: 0;
    box-shadow: 0 0 0 1px rgba(255,255,255,0.08);
  }

  .info-avatar--icon {
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(212, 180, 131, 0.14);
    border: 1px solid rgba(212, 180, 131, 0.28);
    color: #d4b483;
  }

  .info-avatar img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .info-avatar-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 18px;
    color: #fff;
    background: var(--char-color);
  }

  .info-head-text {
    min-width: 0;
  }

  .info-head-text h3 {
    margin: 0;
    font-size: 17px;
    font-weight: 650;
    color: rgba(255,255,255,0.95);
    letter-spacing: -0.01em;
  }

  .info-subtitle {
    margin: 3px 0 0;
    font-size: 12.5px;
    color: rgba(255,255,255,0.45);
    line-height: 1.4;
  }

  .info-fields {
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .info-field {
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .info-label {
    font-size: 10.5px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #d4b483;
    opacity: 0.85;
  }

  .info-value {
    margin: 0;
    font-size: 13.5px;
    line-height: 1.65;
    color: rgba(255,255,255,0.76);
    white-space: pre-wrap;
  }

  .info-empty {
    margin: 0;
    font-size: 12.5px;
    color: rgba(255,255,255,0.35);
    font-style: italic;
    padding: 4px 0;
  }

  .info-hint {
    margin: 16px 0 0;
    font-size: 11px;
    color: rgba(255,255,255,0.4);
    font-style: italic;
    line-height: 1.5;
    padding-top: 12px;
    border-top: 1px dashed rgba(255,255,255,0.1);
  }

  /* ---------- Chat stats ---------- */

  .stat-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 8px;
    margin-bottom: 16px;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 12px 11px;
    background: #1e1e22;
    border: 1px solid rgba(255,255,255,0.05);
    border-radius: 12px;
  }

  .stat-value {
    font-size: 20px;
    font-weight: 700;
    color: #fff;
    letter-spacing: -0.02em;
    line-height: 1;
    font-variant-numeric: tabular-nums;
  }

  .stat-label {
    display: flex;
    align-items: center;
    gap: 4px;
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: rgba(255,255,255,0.42);
  }

  @media (max-width: 639px) {
    .stat-grid {
      grid-template-columns: repeat(2, 1fr);
      gap: 8px;
    }

    .stat-card {
      padding: 11px 10px;
    }

    .stat-value {
      font-size: 19px;
    }

    .info-body {
      padding: 16px 16px 18px;
    }
  }
</style>