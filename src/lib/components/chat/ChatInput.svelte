<script lang="ts">
  import { onMount } from 'svelte';
  import type { InteractionMode } from '$lib/stores/appState.svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    isGenerating = false,
    isSummarizing = false,
    isEditing = false,
    isSavingEdit = false,
    interactionMode = 'desktop',
    value = $bindable(''),
    placeholder = undefined,
    onSend,
    onStop,
    onCancelEdit,
    onResize
  }: {
    isGenerating?: boolean;
    isSummarizing?: boolean;
    isEditing?: boolean;
    isSavingEdit?: boolean;
    interactionMode?: InteractionMode;
    value?: string;
    placeholder?: string;
    onSend?: () => void;
    onStop?: () => void;
    onCancelEdit?: () => void;
    onResize?: (height: number) => void;
  } = $props();

  let inputLayer: HTMLDivElement;
  let textarea = $state<HTMLTextAreaElement>();
  let resizeFrame = 0;
  let isTouchDevice = $state(false);

  function usesMobileInput() {
    return interactionMode === 'mobile' || isTouchDevice;
  }

  // Also resize when sending, opening/cancelling an edit or restoring a draft
  // changes the bound value without a native input event.
  $effect(() => {
    void value;
    void interactionMode;
    void isTouchDevice;
    if (textarea) scheduleResize();
  });

  function scheduleResize() {
    if (resizeFrame) return;
    resizeFrame = requestAnimationFrame(() => {
      resizeFrame = 0;
      if (!textarea) return;
      const visibleHeight = Math.min(
        window.visualViewport?.height ?? window.innerHeight,
        inputLayer.parentElement?.clientHeight ?? window.innerHeight,
      );
      // Reserve a full mobile line, including padding and font rounding, even
      // while empty so the first character cannot change the composer height.
      const minHeight = usesMobileInput() ? 48 : 44;
      const maxHeight = usesMobileInput()
        ? Math.max(minHeight, Math.min(240, Math.floor(visibleHeight * 0.4)))
        : 400;
      textarea.style.maxHeight = `${maxHeight}px`;
      // One measurement per frame; no animation or forced offsetHeight read.
      textarea.style.height = `${minHeight}px`;
      if (textarea.value) {
        textarea.style.height = `${Math.max(minHeight, Math.min(textarea.scrollHeight, maxHeight))}px`;
      }
    });
  }

  onMount(() => {
    const touchQuery = window.matchMedia('(pointer: coarse)');
    const syncTouch = () => { isTouchDevice = touchQuery.matches; scheduleResize(); };
    syncTouch();
    touchQuery.addEventListener('change', syncTouch);
    const viewport = window.visualViewport;
    viewport?.addEventListener('resize', scheduleResize);
    window.addEventListener('resize', scheduleResize);
    let previousWidth = 0;
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === inputLayer) {
          onResize?.(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
        } else if (entry.contentRect.width !== previousWidth) {
          previousWidth = entry.contentRect.width;
          scheduleResize();
        }
      }
    });
    resizeObserver.observe(inputLayer);
    if (textarea) resizeObserver.observe(textarea);
    return () => {
      resizeObserver.disconnect();
      touchQuery.removeEventListener('change', syncTouch);
      viewport?.removeEventListener('resize', scheduleResize);
      window.removeEventListener('resize', scheduleResize);
      if (resizeFrame) cancelAnimationFrame(resizeFrame);
    };
  });

  function handleSend() {
    if (!isGenerating && !isSavingEdit && value.trim().length > 0) {
      onSend?.();
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.keyCode === 229) return;
    // Native mobile mode is independent of viewport width (e.g. landscape).
    // A coarse primary pointer also covers touch devices using a virtual keyboard.
    if (usesMobileInput()) return;
    e.preventDefault();
    if (!isGenerating && !isSavingEdit) {
      handleSend();
    }
  }
  function keepInputFocus(e: PointerEvent) {
    // Keep an already-open keyboard connected while tapping composer actions.
    if (usesMobileInput() && document.activeElement === textarea && e.isPrimary && e.button === 0) {
      e.preventDefault();
    }
  }
</script>

<div
  bind:this={inputLayer}
  class:mobile-input={interactionMode === 'mobile' || isTouchDevice}
  class="composer-shell absolute inset-x-0 bottom-0 z-20 w-full px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] pointer-events-none sm:px-6 sm:pt-3 sm:pb-4"
>
  <div class="max-w-3xl mx-auto">

    <div class="composer-frame pointer-events-auto rounded-2xl p-px {isSummarizing ? 'bg-white/[0.04]' : 'bg-white/10'}"
    >
      <div class="composer-surface flex flex-col rounded-[15px] overflow-hidden bg-ryokan-sidebar">

        <textarea
          id="chat-input-textarea"
          bind:this={textarea}
          bind:value
          onkeydown={handleKeydown}
          oninput={scheduleResize}
          enterkeyhint="enter"
          maxlength="4000"
          placeholder={isSummarizing
            ? m.chat_summarizing_memories()
            : placeholder ?? m.chat_placeholder()}
          rows="1"
          class="w-full bg-transparent px-4 pt-3 pb-1 outline-none resize-none text-[14px] leading-[21px] placeholder:select-none
            {isSummarizing
              ? 'text-ryokan-text placeholder-ryokan-accent/35 italic'
              : 'text-ryokan-text placeholder-[#44444c]'}"
          style="
            min-height: var(--composer-min-height, 44px);
            max-height: 400px;
            overflow-y: auto;
            scrollbar-width: none;
          "
        ></textarea>

        <div class="composer-actions flex items-center justify-end gap-2 px-2.5 pb-2 pt-0.5">
          {#if isEditing}
            <span class="mr-auto pl-1 text-xs text-ryokan-accent">{m.chat_edit()}</span>
            <button type="button" onclick={onCancelEdit} onpointerdown={keepInputFocus} disabled={isSavingEdit}
              class="cancel-edit text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40">
              {m.chat_cancel()}
            </button>
          {/if}
          <button
            type="button"
            onclick={() => isGenerating ? onStop?.() : handleSend()}
            onpointerdown={keepInputFocus}
            disabled={!isGenerating && (value.trim().length === 0 || isSavingEdit)}
            aria-label={isGenerating ? m.chat_stop_generating() : isEditing ? m.chat_save() : m.chat_send_message()}
            class="send-btn"
            class:send-btn--active={!isGenerating && !isSavingEdit && value.trim().length > 0}
            class:send-btn--stop={isGenerating}
            class:send-btn--disabled={!isGenerating && (value.trim().length === 0 || isSavingEdit)}
          >
            {#if isGenerating}
              <svg class="stop-icon" width="12" height="12" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <rect x="5" y="6" width="5" height="12" rx="1.5"/>
                <rect x="14" y="6" width="4" height="12" rx="1.5"/>
                <rect class="mobile-stop" x="5" y="5" width="14" height="14" rx="2"/>
              </svg>
            {:else}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7"/>
              </svg>
            {/if}
          </button>

        </div>
      </div>
    </div>

  </div>
</div>

<style>
  .mobile-input {
    --composer-min-height: 48px;
    padding: 8px 12px calc(8px + env(safe-area-inset-bottom));
  }

  .mobile-input .composer-frame {
    padding: 0;
    border-radius: 28px;
    background: transparent;
  }

  .mobile-input .composer-surface {
    border: 1px solid rgb(255 255 255 / 8%);
    border-radius: 28px;
    background: #262628;
    box-shadow: 0 2px 10px rgb(0 0 0 / 12%);
  }

  .mobile-input #chat-input-textarea {
    padding: 14px 18px 6px;
    font-size: 16px;
    line-height: 24px;
    overscroll-behavior-y: contain;
  }

  .mobile-input #chat-input-textarea::placeholder { color: #a1a1a8; }

  .mobile-input .composer-actions {
    gap: 8px;
    padding: 0 8px 8px 18px;
  }

  .mobile-input .send-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    /* A 36px visible circle keeps the touch target comfortably sized. */
    border: 4px solid #262628;
    box-shadow: none;
    touch-action: manipulation;
  }

  .mobile-input .send-btn svg { width: 20px; height: 20px; }
  .mobile-input .send-btn--disabled { background: #414144; color: #929298; }
  .mobile-input .send-btn--active,
  .mobile-input .send-btn--stop { background: #f4f4f4; color: #171717; }
  .mobile-input .send-btn--active:hover,
  .mobile-input .send-btn--stop:hover { background: #fff; box-shadow: none; }
  .send-btn:focus-visible { outline: 2px solid var(--color-ryokan-accent); outline-offset: 2px; }
  .mobile-stop { display: none; }
  .mobile-input .stop-icon rect { display: none; }
  .mobile-input .stop-icon .mobile-stop { display: block; }
  .mobile-input .cancel-edit { min-width: 48px; min-height: 48px; touch-action: manipulation; }

  .mobile-input::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 0;
      z-index: -1;
      width: 100%;
      height: calc(100% + 20px);
      transform: translateX(-50%);
      pointer-events: none;
      background: linear-gradient(
        to bottom,
        transparent,
        var(--color-ryokan-bg) 20px
      );
  }

  #chat-input-textarea::-webkit-scrollbar {
    display: none;
  }

  .send-btn {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    border: 1px solid transparent;
    cursor: pointer;
    font-family: inherit;
    transition: background 0.18s, border-color 0.18s, box-shadow 0.18s, transform 0.12s, color 0.18s;
  }

  .send-btn:active { transform: scale(0.92); }

  .send-btn--disabled {
    background: rgba(255, 255, 255, 0.04);
    border-color: rgba(255, 255, 255, 0.05);
    color: rgba(255, 255, 255, 0.18);
    cursor: not-allowed;
  }

  .send-btn--active {
    background: #f0f0f2;
    border-color: rgba(255, 255, 255, 0.20);
    color: #0e0e12;
    box-shadow: 0 1px 5px rgba(0, 0, 0, 0.16);
  }

  .send-btn--active:hover {
    background: #ffffff;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.2);
  }

  .send-btn--stop {
    background: rgba(220, 80, 80, 0.12);
    border-color: rgba(220, 80, 80, 0.20);
    color: #d47070;
  }

  .send-btn--stop:hover {
    background: rgba(220, 80, 80, 0.18);
    border-color: rgba(220, 80, 80, 0.30);
    color: #e08080;
  }
</style>
