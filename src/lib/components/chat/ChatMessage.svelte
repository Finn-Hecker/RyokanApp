<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';
  import { renderMessageMarkdown } from '$lib/utils/renderMessageMarkdown';
  import { setSwipeIndex } from '$lib/stores/chatStore.svelte';
  import type { InteractionMode } from '$lib/stores/appState.svelte';
  import type { DisplayMessage } from '$lib/stores/chatStore.svelte';

  let {
    msg,
    isGenerating = false,
    isLast = false,
    canRetry = false,
    canEdit = false,
    canSwipe = false,
    canCloneFrom = false,
    cloneDisabled = false,
    mobileActionsOpen = false,
    interactionMode = 'desktop',
    character = null,
    onRetry,
    onGenerationRetry,
    onGenerationDismiss,
    onEditSave,
    onCloneFrom,
    onMobileActionsOpen,
    onMobileActionsClose
  }: {
    msg: DisplayMessage;
    isGenerating?: boolean;
    isLast?: boolean;
    canRetry?: boolean;
    canEdit?: boolean;
    canSwipe?: boolean;
    canCloneFrom?: boolean;
    cloneDisabled?: boolean;
    mobileActionsOpen?: boolean;
    interactionMode?: InteractionMode;
    character?: any;
    onRetry?: (data: { msgId: string }) => void;
    onGenerationRetry?: () => void;
    onGenerationDismiss?: () => void;
    onEditSave?: (data: { msgId: string; newContent: string }) => void;
    onCloneFrom?: (data: { msgId: string }) => void;
    onMobileActionsOpen?: (msgId: string) => void;
    onMobileActionsClose?: () => void;
  } = $props();

  let editMode = $state(false);
  let editValue = $state('');
  let msgEl = $state<HTMLDivElement | null>(null);
  let editWidth = $state(0);
  let editHeight = $state(0);
  let isCloning = $state(false);
  let longPressTimer: ReturnType<typeof setTimeout> | undefined;
  let longPressStart: { x: number; y: number } | null = null;
  let mobileLongPressPending = $state(false);
  // Keep inline controls out of the mobile DOM. Defaulting to mobile also keeps
  // them out of SSR/pre-hydration markup until the viewport is known.
  let isMobileViewport = $state(true);

  onMount(() => {
    const mobileQuery = window.matchMedia('(max-width: 639px)');
    const syncViewport = () => {
      isMobileViewport = mobileQuery.matches;
    };

    syncViewport();
    mobileQuery.addEventListener('change', syncViewport);
    return () => mobileQuery.removeEventListener('change', syncViewport);
  });

  let isMobileInteraction = $derived(interactionMode === 'mobile');

  // Swipe animation state — null means no animation (e.g. on mount or after streaming)
  let slideDir = $state<null | 'left' | 'right' | 'enter'>(null);

  let isOocMsg    = $derived(msg.isUser && /^\[OOC:\s/.test(msg.text));
  let displayText = $derived(
    isOocMsg ? msg.text.replace(/^\[OOC:\s*/, '').replace(/\]$/, '') : msg.text
  );
  let cleanHtml = $derived(renderMessageMarkdown(msg.text));

  // Swipe
  let totalVariants = $derived(msg.swipeVariants?.length ?? 1);
  let currentIndex  = $derived(msg.swipeIndex ?? 0);
  let canGoLeft     = $derived(canSwipe && currentIndex > 0);
  let canGoRight    = $derived(canSwipe && currentIndex < totalVariants - 1);

  let showControls  = $derived(canSwipe || (canEdit && !isGenerating) || (canCloneFrom && !isGenerating));
  let hasMobileActions = $derived(
    (canSwipe && (canGoLeft || canGoRight || canRetry)) ||
    (canEdit && !isGenerating) ||
    (canCloneFrom && !isGenerating && !cloneDisabled && !isCloning)
  );
  let showDots      = $derived(isLast && isGenerating && !msg.text);

  async function navigateSwipe(direction: 'left' | 'right') {
    if (!msg.id) return;
    const newIndex = direction === 'left' ? currentIndex - 1 : currentIndex + 1;

    slideDir = direction === 'left' ? 'right' : 'left';
    await new Promise(r => setTimeout(r, 130));

    // Update content, then play enter animation
    await setSwipeIndex(msg.id, newIndex);
    slideDir = 'enter';

    // Clear after animation so subsequent re-renders don't re-trigger it
    await new Promise(r => setTimeout(r, 200));
    slideDir = null;
  }

  function startSwipe(direction: 'left' | 'right') {
    void navigateSwipe(direction).catch(() => {
      slideDir = null;
    });
  }

  async function handleEditOpen() {
    if (msgEl) {
      editWidth  = msgEl.offsetWidth;
      editHeight = msgEl.offsetHeight;
    }
    editValue = msg.text;
    editMode  = true;
  }

  function handleEditSave() {
    if (editValue.trim()) {
      onEditSave?.({ msgId: msg.id, newContent: editValue.trim() });
    }
    editMode = false;
  }

  function handleEditCancel() {
    editMode  = false;
    editValue = '';
  }

  function handleEditKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleEditSave();
    if (e.key === 'Escape') handleEditCancel();
  }

  async function handleCloneFromHere() {
    if (!msg.id || isCloning || cloneDisabled) return;
    isCloning = true;
    try {
      await onCloneFrom?.({ msgId: msg.id });
    } finally {
      isCloning = false;
    }
  }

  function startMobileLongPress(event: PointerEvent) {
    if (!window.matchMedia('(max-width: 639px)').matches || event.pointerType !== 'touch' || !hasMobileActions || (event.target as HTMLElement).closest('button, input, textarea, a')) return;
    longPressStart = { x: event.clientX, y: event.clientY };
    mobileLongPressPending = true;
    longPressTimer = setTimeout(() => {
      window.getSelection()?.removeAllRanges();
      navigator.vibrate?.(8);
      onMobileActionsOpen?.(msg.id);
      mobileLongPressPending = false;
      longPressTimer = undefined;
    }, 500);
  }

  function cancelMobileLongPress(event?: PointerEvent) {
    if (event?.type === 'pointermove' && longPressStart) {
      const moved = Math.hypot(event.clientX - longPressStart.x, event.clientY - longPressStart.y) > 10;
      if (!moved) return;
    }
    if (longPressTimer) clearTimeout(longPressTimer);
    longPressTimer = undefined;
    longPressStart = null;
    mobileLongPressPending = false;
  }

  function closeMobileActions() {
    onMobileActionsClose?.();
  }

  function preventMobileTextSelection(event: MouseEvent) {
    if (window.matchMedia('(max-width: 639px)').matches) event.preventDefault();
  }

  function openMobileEdit() {
    closeMobileActions();
    void handleEditOpen();
  }

  function openMobileClone() {
    closeMobileActions();
    void handleCloneFromHere();
  }

  function openMobileSwipe(direction: 'left' | 'right') {
    closeMobileActions();
    startSwipe(direction);
  }

  function openMobileRetry() {
    closeMobileActions();
    onRetry?.({ msgId: msg.id });
  }

</script>

<div
  data-message-id={msg.id}
  role="group"
  class="flex {msg.isUser ? 'justify-end mb-6' : 'justify-start mb-8'}"
  class:mobile-message-typography={isMobileInteraction}
  class:mobile-long-press-pending={mobileLongPressPending}
  onpointerdown={startMobileLongPress}
  onpointermove={cancelMobileLongPress}
  onpointerup={cancelMobileLongPress}
  onpointercancel={cancelMobileLongPress}
  oncontextmenu={preventMobileTextSelection}
>

{#if msg.isUser}
  <div class="max-w-[75%] sm:max-w-[65%] group/usermsg">
    {#if editMode}
      <div class="user-edit-wrap rounded-2xl rounded-tr-sm p-[1.5px]">
        <div class="rounded-[14px] rounded-tr-[3px] bg-ryokan-bg overflow-hidden">
          <textarea
            bind:value={editValue}
            onkeydown={handleEditKeydown}
            class="w-full min-w-[220px] bg-transparent text-gray-200 text-[15px] leading-relaxed
                   resize-none outline-none px-5 py-3.5 block"
            rows={Math.max(2, editValue.split('\n').length)}
          ></textarea>
          <div class="flex items-center justify-between px-4 pb-3">
            <p class="text-[10px] text-gray-600">{m.chat_edit_shortcut()}</p>
            <div class="flex gap-2">
              <button
                onclick={handleEditCancel}
                class="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-200 hover:bg-white/[0.06] rounded-xl transition-all duration-150"
              >
                {m.chat_cancel()}
              </button>
              <button
                onclick={handleEditSave}
                class="px-3 py-1.5 text-xs bg-ryokan-accent/90 hover:bg-ryokan-accent text-ryokan-bg font-medium rounded-xl transition-all duration-150"
              >
                {m.chat_save()}
              </button>
            </div>
          </div>
        </div>
      </div>
    {:else}
      <div class="relative">
        <div class="px-5 py-3.5 rounded-2xl rounded-tr-sm
          {isOocMsg
            ? 'bg-ryokan-accent/[0.07] border border-ryokan-accent/25 text-ryokan-accent italic'
            : 'bg-[#1e1e22] border border-white/[0.04] text-gray-200'}
          user-message-text text-[15px] leading-relaxed break-words shadow-sm transition-colors">
          {displayText}
        </div>
        {#if !isMobileViewport && canEdit && !isGenerating}
          <div class="user-ctrl-bar
            opacity-100 translate-y-0 pointer-events-auto
            sm:opacity-0 sm:group-hover/usermsg:opacity-100
            sm:translate-y-0.5 sm:group-hover/usermsg:translate-y-0
            transition-all duration-200 ease-out sm:pointer-events-none sm:group-hover/usermsg:pointer-events-auto">
            <button
              class="ctrl-btn ctrl-btn--label"
              onclick={handleEditOpen}
              aria-label={m.chat_edit()}
              title={m.chat_edit()}
            >
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
              </svg>
              <span>{m.chat_edit()}</span>
            </button>
          </div>
        {/if}
      </div>
    {/if}
  </div>

{:else}
  <div class="flex items-start gap-5 max-w-full sm:max-w-2xl lg:max-w-[720px]">

    <div class="hidden sm:block shrink-0 w-10 h-10 rounded-xl overflow-hidden ring-1 ring-ryokan-accent/20 mt-1 shadow-md">
      {#if character?.avatarUrl}
        <img src={character.avatarUrl} alt={character.name} class="w-full h-full object-cover select-none"/>
      {:else}
        <div class="w-full h-full {character?.color ?? 'bg-ryokan-surface'} flex items-center justify-center text-white font-bold text-sm">
          {character?.initials ?? (character?.name?.[0]?.toUpperCase() ?? 'A')}
        </div>
      {/if}
    </div>

    <div class="relative group/message flex-1 min-w-0 pb-1">

      {#if editMode}
        <div class="edit-border-wrap rounded-xl p-[1.5px]" style="width: {editWidth}px;">
          <div class="rounded-[10px] bg-ryokan-bg overflow-hidden">
            <textarea
              bind:value={editValue}
              onkeydown={handleEditKeydown}
              class="w-full bg-transparent text-gray-200 text-sm leading-relaxed
                     resize-none outline-none px-3.5 py-3 block"
              style="height: {editHeight}px;"
            ></textarea>
            <div class="flex items-center justify-between px-3.5 pb-3">
              <p class="text-[10px] text-gray-600">{m.chat_edit_shortcut()}</p>
              <div class="flex gap-2">
                <button
                  onclick={handleEditCancel}
                  class="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-200 hover:bg-white/[0.06] rounded-xl transition-all duration-150"
                >
                  {m.chat_cancel()}
                </button>
                <button
                  onclick={handleEditSave}
                  class="px-3 py-1.5 text-xs bg-ryokan-accent/90 hover:bg-ryokan-accent text-ryokan-bg font-medium rounded-xl transition-all duration-150"
                >
                  {m.chat_save()}
                </button>
              </div>
            </div>
          </div>
        </div>

      {:else}
        <div
          bind:this={msgEl}
          class="text-gray-200 break-words prose-custom swipe-bubble"
          class:swipe-exit-left={slideDir === 'left'}
          class:swipe-exit-right={slideDir === 'right'}
          class:swipe-enter={slideDir === 'enter'}
        >
          {@html cleanHtml}

          {#if msg.generationError}
            <div class="generation-error" role="alert">
              <p class="generation-error-title">{msg.generationError.title}</p>
              <details><summary>{m.chat_generation_details()}</summary><dl>
                {#if msg.generationError.status}<div><dt>{m.chat_generation_http_status()}</dt><dd>{msg.generationError.status}</dd></div>{/if}
                {#if msg.generationError.code}<div><dt>{m.chat_generation_error_code()}</dt><dd>{msg.generationError.code}</dd></div>{/if}
                {#if msg.generationError.provider}<div><dt>{m.chat_generation_provider()}</dt><dd>{msg.generationError.provider}</dd></div>{/if}
                {#if msg.generationError.model}<div><dt>{m.chat_generation_model()}</dt><dd>{msg.generationError.model}</dd></div>{/if}
                <div><dt>{m.chat_generation_api_message()}</dt><dd>{msg.generationError.message}</dd></div>
              </dl></details>
              <div class="generation-error-actions">
                <button onclick={() => onGenerationRetry?.()}>{m.chat_error_retry()}</button>
                <button onclick={() => onGenerationDismiss?.()}>{m.chat_error_cancel()}</button>
              </div>
            </div>
          {/if}

          {#if showDots}
            <span class="breathe-dots" aria-label="Generiert…" role="status">
              <span class="breathe-dot"></span>
              <span class="breathe-dot" style="animation-delay: 0.22s"></span>
              <span class="breathe-dot" style="animation-delay: 0.44s"></span>
            </span>
          {/if}
        </div>

        {#if !isMobileViewport && showControls}
          <div class="controls-bar
            opacity-100 translate-y-0 pointer-events-auto
            sm:opacity-0 sm:group-hover/message:opacity-100
            sm:translate-y-0.5 sm:group-hover/message:translate-y-0
            transition-all duration-200 ease-out sm:pointer-events-none sm:group-hover/message:pointer-events-auto">

            {#if canSwipe}
              <button
                class="ctrl-btn"
                class:ctrl-btn--dim={!canGoLeft}
                disabled={!canGoLeft}
                onclick={() => startSwipe('left')}
                aria-label="Vorherige Variante"
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M15 18l-6-6 6-6"/>
                </svg>
              </button>

              {#if totalVariants > 1}
                <span class="ctrl-counter">{currentIndex + 1} / {totalVariants}</span>
              {/if}

              {#if canGoRight || canRetry}
                <button
                  class="ctrl-btn"
                  class:ctrl-btn--accent={!canGoRight && canRetry}
                  disabled={isGenerating}
                  onclick={() => canGoRight ? startSwipe('right') : onRetry?.({ msgId: msg.id })}
                  aria-label={canGoRight ? 'Nächste Variante' : m.chat_retry()}
                  title={canGoRight ? undefined : m.chat_retry()}
                >
                  {#if canGoRight}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M9 18l6-6-6-6"/>
                    </svg>
                  {:else}
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                      <path d="M3 3v5h5"/>
                    </svg>
                  {/if}
                </button>
              {/if}
            {/if}

            {#if canSwipe && (canEdit || canCloneFrom) && !isGenerating}
              <span class="ctrl-divider"></span>
            {/if}

            {#if canEdit && !isGenerating}
              <button
                class="ctrl-btn ctrl-btn--label"
                onclick={handleEditOpen}
                aria-label={m.chat_edit()}
                title={m.chat_edit()}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
                <span>{m.chat_edit()}</span>
              </button>
            {/if}

            {#if canEdit && canCloneFrom && !isGenerating}
              <span class="ctrl-divider"></span>
            {/if}

            {#if canCloneFrom && !isGenerating}
              <button
                class="ctrl-btn ctrl-btn--label"
                disabled={isCloning || cloneDisabled}
                onclick={handleCloneFromHere}
                aria-label={m.chat_clone_from_here_label()}
                title={m.chat_clone_from_here_title()}
              >
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                  <line x1="6" y1="3" x2="6" y2="15"/>
                  <circle cx="18" cy="6" r="3"/>
                  <circle cx="6" cy="18" r="3"/>
                  <path d="M18 9a9 9 0 0 1-9 9"/>
                </svg>
                <span>{isCloning ? m.chat_clone_from_here_loading() : m.chat_clone_from_here_label()}</span>
              </button>
            {/if}

          </div>
        {/if}

      {/if}
    </div>
  </div>
{/if}

</div>

{#if mobileActionsOpen}
  <div class="mobile-action-sheet-layer">
    <button class="mobile-action-sheet-backdrop" aria-label={m.chat_cancel()} onclick={closeMobileActions}></button>
    <div class="mobile-action-sheet" role="dialog" aria-modal="true" aria-label="Message actions">
      <div class="mobile-action-sheet-handle" aria-hidden="true"></div>
      <div class="mobile-action-sheet-actions">
        {#if canSwipe && canGoLeft}
          <button class="mobile-action" onclick={() => openMobileSwipe('left')}>
            <span>{m.chat_previous_variant()}</span>
            {#if totalVariants > 1}<small>{currentIndex + 1} / {totalVariants}</small>{/if}
          </button>
        {/if}
        {#if canSwipe}
          {#if canGoRight}
            <button class="mobile-action" onclick={() => openMobileSwipe('right')}><span>{m.chat_next_variant()}</span></button>
          {:else if canRetry}
            <button class="mobile-action mobile-action--accent" onclick={openMobileRetry}><span>{m.chat_retry()}</span></button>
          {/if}
        {/if}
        {#if canEdit && !isGenerating}
          <button class="mobile-action" onclick={openMobileEdit}><span>{m.chat_edit()}</span></button>
        {/if}
        {#if canCloneFrom && !isGenerating && !cloneDisabled && !isCloning}
          <button class="mobile-action" onclick={openMobileClone}>
            <span>{isCloning ? m.chat_clone_from_here_loading() : m.chat_clone_from_here_label()}</span>
          </button>
        {/if}
      </div>
      <button class="mobile-action mobile-action--cancel" onclick={closeMobileActions}>{m.chat_cancel()}</button>
    </div>
  </div>
{/if}

<style>
  @property --border-angle {
    syntax: '<angle>';
    initial-value: 0deg;
    inherits: false;
  }

  .edit-border-wrap {
    background: conic-gradient(
      from var(--border-angle),
      transparent 60%,
      #d4b483 80%,
      #f0d49a 90%,
      #d4b483 95%,
      transparent 100%
    );
    animation: border-spin 2.4s linear infinite;
  }

  @keyframes border-spin {
    to { --border-angle: 360deg; }
  }

  .swipe-bubble {
    animation-duration: 180ms;
    animation-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
    animation-fill-mode: both;
  }

  @keyframes slideOutLeft {
    from { opacity: 1; transform: translateX(0); }
    to   { opacity: 0; transform: translateX(-14px); }
  }
  @keyframes slideOutRight {
    from { opacity: 1; transform: translateX(0); }
    to   { opacity: 0; transform: translateX(14px); }
  }
  @keyframes slideIn {
    from { opacity: 0; transform: translateX(10px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  .swipe-exit-left  { animation-name: slideOutLeft; }
  .swipe-exit-right { animation-name: slideOutRight; }
  .swipe-enter      { animation-name: slideIn; }

  .controls-bar {
    position: absolute;
    bottom: -28px;
    left: 0;
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding: 3px;
    background: rgba(18, 18, 22, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.45),
      0 1px 3px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(10px);
    white-space: nowrap;
  }

  @media (max-width: 639px) {
    .controls-bar,
    .user-ctrl-bar {
      display: none;
    }

    .mobile-long-press-pending {
      opacity: .88;
    }

    [data-message-id] {
      touch-action: pan-y;
      -webkit-touch-callout: none;
      -webkit-user-select: none;
      user-select: none;
    }
  }

  .mobile-action-sheet-layer { display: none; }

  @media (max-width: 639px) {
    .mobile-action-sheet-layer { display: block; position: fixed; z-index: 80; inset: 0; }
    .mobile-action-sheet-backdrop { position: absolute; inset: 0; width: 100%; border: 0; background: rgba(0,0,0,.52); backdrop-filter: blur(2px); animation: mobile-sheet-fade .16s ease-out; }
    .mobile-action-sheet { position: absolute; right: 10px; bottom: max(10px, env(safe-area-inset-bottom)); left: 10px; max-width: 480px; margin: auto; padding: 8px; border: 1px solid rgba(255,255,255,.09); border-radius: 18px; background: rgba(25,25,29,.98); box-shadow: 0 -8px 32px rgba(0,0,0,.32); animation: mobile-sheet-enter .2s cubic-bezier(.22,.8,.3,1); will-change: transform, opacity; }
    .mobile-action-sheet-handle { width: 34px; height: 4px; margin: 2px auto 8px; border-radius: 999px; background: rgba(255,255,255,.16); }
    .mobile-action-sheet-actions { display: grid; gap: 3px; }
    .mobile-action { display: flex; align-items: center; justify-content: space-between; width: 100%; min-height: 50px; padding: 0 14px; border: 0; border-radius: 12px; background: transparent; color: #e5e5ea; font: 500 15px/1.2 inherit; text-align: left; }
    .mobile-action:active:not(:disabled) { background: rgba(255,255,255,.08); }
    .mobile-action:disabled { color: rgba(255,255,255,.28); }
    .mobile-action small { color: rgba(255,255,255,.38); font-size: 12px; }
    .mobile-action--accent { color: #d4b483; }
    .mobile-action--cancel { justify-content: center; margin-top: 5px; background: rgba(255,255,255,.055); color: rgba(255,255,255,.66); }
    @keyframes mobile-sheet-fade { from { opacity: 0; } }
    @keyframes mobile-sheet-enter { from { opacity: .72; transform: translateY(20px); } }
    @media (prefers-reduced-motion: reduce) { .mobile-action-sheet-backdrop, .mobile-action-sheet { animation-duration: .01ms; } }
  }

  .ctrl-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    border-radius: 7px;
    border: none;
    background: transparent;
    color: rgba(255, 255, 255, 0.38);
    cursor: pointer;
    padding: 0;
    transition: background 140ms, color 140ms, transform 100ms;
    flex-shrink: 0;
  }

  .ctrl-btn:hover:not(:disabled) {
    background: rgba(255, 255, 255, 0.08);
    color: rgba(255, 255, 255, 0.82);
  }

  .ctrl-btn:active:not(:disabled) {
    transform: scale(0.9);
  }

  .ctrl-btn:disabled {
    cursor: default;
  }

  .ctrl-btn--dim {
    opacity: 0.18;
  }

  .ctrl-btn--accent {
    color: rgba(212, 180, 131, 0.55);
  }
  .ctrl-btn--accent:hover:not(:disabled) {
    background: rgba(212, 180, 131, 0.10);
    color: #d4b483;
  }

  .ctrl-btn--label {
    width: auto;
    gap: 5px;
    padding: 0 9px;
    font-size: 11px;
    font-weight: 500;
    font-family: inherit;
    letter-spacing: 0.01em;
  }

  .ctrl-counter {
    font-size: 10px;
    font-variant-numeric: tabular-nums;
    color: rgba(255, 255, 255, 0.28);
    letter-spacing: 0.03em;
    min-width: 28px;
    text-align: center;
    user-select: none;
    padding: 0 2px;
  }

  .ctrl-divider {
    display: inline-block;
    width: 1px;
    height: 14px;
    background: rgba(255, 255, 255, 0.10);
    margin: 0 3px;
    flex-shrink: 0;
  }

  .user-edit-wrap {
    background: conic-gradient(
      from var(--border-angle),
      transparent 60%,
      #d4b483 80%,
      #f0d49a 90%,
      #d4b483 95%,
      transparent 100%
    );
    animation: border-spin 2.4s linear infinite;
  }

  .user-ctrl-bar {
    position: absolute;
    bottom: -32px;
    right: 0;
    display: inline-flex;
    align-items: center;
    gap: 1px;
    padding: 3px;
    background: rgba(18, 18, 22, 0.94);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 10px;
    box-shadow:
      0 4px 16px rgba(0, 0, 0, 0.45),
      0 1px 3px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(10px);
    white-space: nowrap;
  }

  :global(.prose-custom) {
    font-size: 1rem;
    line-height: 1.8;
    color: #e5e5ea;
  }
  :global(.prose-custom p)            { margin-bottom: 1.2em; }
  :global(.prose-custom p:last-child) { margin-bottom: 0; }
  :global(.prose-custom strong)       { color: #ffffff; font-weight: 600; }
  :global(.prose-custom em)           { color: #a39887; font-style: italic; }

  /* Android WebView can inflate long text independently of its CSS font size.
     Anchor the two actual message render paths to the native interaction mode. */
  .mobile-message-typography :global(.prose-custom) {
    font-size: 14.5px;
    line-height: 1.55;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
  }

  .mobile-message-typography :global(.prose-custom p) {
    margin-bottom: 1em;
  }

  .mobile-message-typography .user-message-text {
    font-size: 17px;
    line-height: 1.5;
    -webkit-text-size-adjust: none;
    text-size-adjust: none;
  }

  .generation-error { padding: 12px 14px; border: 1px solid rgba(248,113,113,.25); border-radius: 12px; background: rgba(248,113,113,.07); color: #d1d5db; }
  .generation-error-title { margin: 0; color: #fca5a5; font-weight: 600; }
  .generation-error details { margin-top: 7px; font-size: 12px; color: #9ca3af; }
  .generation-error summary { cursor: pointer; user-select: none; }
  .generation-error dl { margin: 8px 0 0; display: grid; gap: 5px; }
  .generation-error dl div { display: grid; grid-template-columns: 90px minmax(0, 1fr); gap: 8px; }
  .generation-error dt { color: #6b7280; }
  .generation-error dd { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
  .generation-error-actions { display: flex; gap: 8px; margin-top: 10px; }
  .generation-error-actions button { padding: 4px 9px; border-radius: 7px; background: rgba(255,255,255,.06); color: #d1d5db; cursor: pointer; font-size: 12px; }
  .generation-error-actions button:first-child { color: #fca5a5; }
  .generation-error-actions button:hover { background: rgba(255,255,255,.1); }

  :global(.breathe-dots) {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    margin-left: 8px;
    vertical-align: middle;
    position: relative;
    top: -1px;
  }

  :global(.breathe-dot) {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: rgba(212, 180, 131, 0.28);
    animation: breathe 1.5s ease-in-out infinite;
    flex-shrink: 0;
    will-change: transform, background;
  }

  @keyframes breathe {
    0%, 100% { background: rgba(212, 180, 131, 0.22); transform: scale(1); }
    50%       { background: rgba(212, 180, 131, 1);    transform: scale(1.28); }
  }
</style>
