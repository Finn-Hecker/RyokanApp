<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  let {
    character = null,
    isTyping = false,
    onBack
  }: {
    character?: any;
    isTyping?: boolean;
    onBack?: () => void;
  } = $props();

</script>

<div class="chat-header">
  <button
    onclick={onBack}
    class="icon-btn"
    aria-label={m.chat_aria_back()}
  >
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M19 12H5M12 19l-7-7 7-7"/>
    </svg>
  </button>

  <div class="avatar-wrap" style="--char-color: {character?.colorHex ?? '#6366f1'}">
    <div class="avatar-ring">
      {#if character?.avatarUrl}
        <img src={character.avatarUrl} alt={character?.name} class="avatar-img" />
      {:else}
        <div class="avatar-fallback {character?.color ?? 'bg-ryokan-surface'}">
          <span>{character?.initials ?? (character?.name?.[0]?.toUpperCase() ?? '?')}</span>
        </div>
      {/if}
    </div>
    <div class="online-dot" aria-hidden="true"></div>
  </div>

  <div class="meta">
    <h2 class="char-name">{character?.name ?? '—'}</h2>
    <div class="status-row" aria-live="polite">
      {#if isTyping}
        <span class="status-text">{m.chat_typing_indicator()}</span>
      {:else}
        <span class="status-text">{m.chat_status_online()}</span>
      {/if}
    </div>
  </div>

  <div class="actions">
    <button
      class="icon-btn"
      aria-label={m.chat_header_aria_info()}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="8.5"/>
        <line x1="12" y1="11" x2="12" y2="17"/>
      </svg>
    </button>

    <div class="menu-wrap">
      <button
        class="icon-btn"
        aria-label={m.chat_header_aria_options()}
      >
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
          <circle cx="12" cy="5" r="1.2" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none"/>
          <circle cx="12" cy="19" r="1.2" fill="currentColor" stroke="none"/>
        </svg>
      </button>
    </div>
  </div>
</div>

<style>
  .chat-header {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 16px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    background: rgba(var(--ryokan-bg-rgb, 15 15 20), 0.85);
    backdrop-filter: blur(20px) saturate(1.4);
    -webkit-backdrop-filter: blur(20px) saturate(1.4);
    position: relative;
    z-index: 10;
    box-shadow:
      0 1px 0 0 rgba(255,255,255,0.04) inset,
      0 1px 12px 0 rgba(0,0,0,0.2);
  }

  .icon-btn {
    flex-shrink: 0;
    width: 34px;
    height: 34px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 10px;
    color: rgba(255,255,255,0.4);
    background: transparent;
    border: none;
    cursor: pointer;
    transition: color 150ms ease, background 150ms ease;
  }
  .icon-btn:hover {
    color: rgba(255,255,255,0.9);
    background: rgba(255,255,255,0.07);
  }
  .icon-btn:active {
    background: rgba(255,255,255,0.12);
  }

  .avatar-wrap {
    position: relative;
    flex-shrink: 0;
  }

  .avatar-ring {
    width: 38px;
    height: 38px;
    border-radius: 50%;
    overflow: hidden;
    box-shadow:
      0 0 0 2px rgba(255,255,255,0.08),
      0 0 0 4px rgba(255,255,255,0.03),
      0 0 10px 2px color-mix(in srgb, var(--char-color) 30%, transparent);
  }

  .avatar-img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }

  .avatar-fallback {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 700;
    font-size: 15px;
    color: #fff;
    letter-spacing: -0.02em;
    background: var(--char-color);
  }

  .online-dot {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 9px;
    height: 9px;
    border-radius: 50%;
    background: #34d399;
    border: 2px solid rgba(15,15,20,1);
    animation: pulse-ring 2.4s ease-out infinite;
  }

  @keyframes pulse-ring {
    0%   { box-shadow: 0 0 0 0 rgba(52,211,153,0.5); }
    60%  { box-shadow: 0 0 0 4px rgba(52,211,153,0); }
    100% { box-shadow: 0 0 0 0 rgba(52,211,153,0); }
  }

  .meta {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .char-name {
    font-size: 13.5px;
    font-weight: 600;
    color: rgba(255,255,255,0.92);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    line-height: 1.2;
    letter-spacing: -0.01em;
    margin: 0;
  }

  .status-row {
    display: flex;
    align-items: center;
    gap: 5px;
    line-height: 1;
  }

  .status-dot {
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: #34d399;
    flex-shrink: 0;
  }

  .status-text {
    font-size: 11px;
    color: rgba(255,255,255,0.38);
    letter-spacing: 0.01em;
  }

  .status-text.typing {
    color: rgba(255,255,255,0.5);
    font-style: italic;
  }

  .actions {
    display: flex;
    align-items: center;
    gap: 2px;
    flex-shrink: 0;
  }

  .menu-wrap {
    position: relative;
  }

  .dropdown {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    min-width: 160px;
    background: rgba(22, 22, 30, 0.96);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: 12px;
    overflow: hidden;
    box-shadow: 0 8px 32px rgba(0,0,0,0.5), 0 2px 8px rgba(0,0,0,0.3);
    backdrop-filter: blur(16px);
    animation: dropdown-in 120ms ease;
    z-index: 100;
  }

  @keyframes dropdown-in {
    from { opacity: 0; transform: translateY(-4px) scale(0.97); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
  }

  .dropdown-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 9px 13px;
    font-size: 12.5px;
    color: rgba(255,255,255,0.7);
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    transition: background 100ms ease, color 100ms ease;
    letter-spacing: 0.01em;
  }

  .dropdown-item:hover {
    background: rgba(255,255,255,0.07);
    color: rgba(255,255,255,0.95);
  }

  .dropdown-item.danger:hover {
    background: rgba(239, 68, 68, 0.12);
    color: #f87171;
  }
</style>