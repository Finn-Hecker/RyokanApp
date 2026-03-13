<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { setSwipeIndex } from '$lib/stores/chatStore.svelte';
  import type { DisplayMessage } from '$lib/stores/chatStore.svelte';

  let {
    msg,
    isGenerating = false,
    isLast = false,
    canRetry = false,
    canEdit = false,
    canSwipe = false,
    character = null,
    onRetry,
    onEditSave
  }: {
    msg: DisplayMessage;
    isGenerating?: boolean;
    isLast?: boolean;
    canRetry?: boolean;
    canEdit?: boolean;
    canSwipe?: boolean;
    character?: any;
    onRetry?: (data: { msgId: string }) => void;
    onEditSave?: (data: { msgId: string; newContent: string }) => void;
  } = $props();

  let editMode = $state(false);
  let editValue = $state('');
  let msgEl = $state<HTMLDivElement | null>(null);
  let editWidth = $state(0);
  let editHeight = $state(0);

  // Swipe animation state — null means no animation (e.g. on mount or after streaming)
  let slideDir = $state<null | 'left' | 'right' | 'enter'>(null);

  let isOocMsg    = $derived(msg.isUser && /^\[OOC:\s/.test(msg.text));
  let displayText = $derived(
    isOocMsg ? msg.text.replace(/^\[OOC:\s*/, '').replace(/\]$/, '') : msg.text
  );
  let rawHtml   = $derived(marked.parse(msg.text || '') as string);
  let cleanHtml = $derived(DOMPurify.sanitize(rawHtml));

  // Swipe
  let totalVariants = $derived(msg.swipeVariants?.length ?? 1);
  let currentIndex  = $derived(msg.swipeIndex ?? 0);
  let canGoLeft     = $derived(canSwipe && currentIndex > 0);
  let canGoRight    = $derived(canSwipe && currentIndex < totalVariants - 1);

  let showControls  = $derived(canSwipe || (canEdit && !isGenerating));
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
</script>

<div class="flex {msg.isUser ? 'justify-end mb-6' : 'justify-start mb-8'}">

{#if msg.isUser}
  <div class="max-w-[75%] sm:max-w-[65%]">
    <div class="px-5 py-3.5 rounded-2xl rounded-tr-sm
      {isOocMsg
        ? 'bg-ryokan-accent/[0.07] border border-ryokan-accent/25 text-ryokan-accent italic'
        : 'bg-[#1e1e22] border border-white/[0.04] text-gray-200'}
      text-[15px] leading-relaxed break-words shadow-sm transition-colors">
      {displayText}
    </div>
  </div>

{:else}
  <div class="flex items-start gap-5 max-w-full sm:max-w-2xl lg:max-w-[720px]">

    <div class="shrink-0 w-10 h-10 rounded-xl overflow-hidden ring-1 ring-ryokan-accent/20 mt-1 shadow-md">
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
          class="text-gray-200 text-sm break-words prose-custom swipe-bubble"
          class:swipe-exit-left={slideDir === 'left'}
          class:swipe-exit-right={slideDir === 'right'}
          class:swipe-enter={slideDir === 'enter'}
        >
          {@html cleanHtml}

          {#if showDots}
            <span class="inline-flex items-end ml-1.5 translate-y-[-1px]">
              <span class="pulse-tri pulse-tri--down"></span>
              <span class="pulse-tri pulse-tri--up"   style="animation-delay: 0.16s"></span>
              <span class="pulse-tri pulse-tri--down" style="animation-delay: 0.32s"></span>
              <span class="pulse-tri pulse-tri--up"   style="animation-delay: 0.48s"></span>
            </span>
          {/if}
        </div>

        {#if showControls}
          <div class="controls-bar
            opacity-0 group-hover/message:opacity-100
            translate-y-0.5 group-hover/message:translate-y-0
            transition-all duration-200 ease-out pointer-events-none group-hover/message:pointer-events-auto">

            {#if canSwipe}
              <button
                class="ctrl-btn"
                class:ctrl-btn--dim={!canGoLeft}
                disabled={!canGoLeft}
                onclick={() => navigateSwipe('left')}
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
                  onclick={() => canGoRight ? navigateSwipe('right') : onRetry?.({ msgId: msg.id })}
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

            {#if canSwipe && canEdit && !isGenerating}
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

          </div>
        {/if}

      {/if}
    </div>
  </div>
{/if}

</div>

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

  :global(.prose-custom) {
    font-size: 1rem;
    line-height: 1.8;
    color: #e5e5ea;
  }
  :global(.prose-custom p)            { margin-bottom: 1.2em; }
  :global(.prose-custom p:last-child) { margin-bottom: 0; }
  :global(.prose-custom strong)       { color: #ffffff; font-weight: 600; }
  :global(.prose-custom em)           { color: #a39887; font-style: italic; }

  :global(.pulse-tri) {
    display: inline-block;
    width: 10px;
    height: 10px;
    background-color: #d4b483;
    opacity: 0.25;
    animation: pulseTriangle 1.2s ease-in-out infinite;
    flex-shrink: 0;
  }

  :global(.pulse-tri--down) {
    clip-path: polygon(0% 0%, 100% 0%, 50% 100%);
  }

  :global(.pulse-tri--up) {
    clip-path: polygon(50% 0%, 100% 100%, 0% 100%);
  }

  @keyframes pulseTriangle {
    0%, 100% { opacity: 0.2; transform: translateY(0); }
    50%       { opacity: 0.95; transform: translateY(-4px); }
  }
</style>