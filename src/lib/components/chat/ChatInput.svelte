<script lang="ts">
  import { onMount } from 'svelte';
  import * as m from '$lib/paraglide/messages';

  let {
    isGenerating = false,
    isSummarizing = false,
    isEditing = false,
    isSavingEdit = false,
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
    value?: string;
    placeholder?: string;
    onSend?: () => void;
    onStop?: () => void;
    onCancelEdit?: () => void;
    onResize?: (height: number) => void;
  } = $props();

  let inputLayer: HTMLDivElement;

  onMount(() => {
    const resizeObserver = new ResizeObserver(([entry]) => {
      onResize?.(entry.borderBoxSize?.[0]?.blockSize ?? entry.contentRect.height);
    });
    resizeObserver.observe(inputLayer);
    return () => resizeObserver.disconnect();
  });

  function handleSend() {
    if (value.trim().length > 0) {
      onSend?.();
      setTimeout(() => {
        const ta = document.getElementById('chat-input-textarea');
        if (ta) ta.style.height = '44px';
      }, 10);
    }
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  function handleInput(e: Event) {
    const target = e.target as HTMLTextAreaElement;
    const currentHeight = target.style.height;
    target.style.transition = 'none';
    target.style.height = '44px';
    const newHeight = Math.min(target.scrollHeight, 400);
    target.style.height = currentHeight || '44px';
    void target.offsetHeight;
    target.style.transition = 'height 0.2s cubic-bezier(0.2, 0, 0, 1)';
    target.style.height = newHeight + 'px';
  }
</script>

<div
  bind:this={inputLayer}
  class="composer-shell absolute inset-x-0 bottom-0 z-20 w-full px-4 pt-2 pb-[calc(1rem+env(safe-area-inset-bottom))] pointer-events-none sm:px-6 sm:pt-3 sm:pb-4"
>
  <div class="max-w-3xl mx-auto">

    <div class="composer-frame pointer-events-auto rounded-2xl p-px {isSummarizing ? 'bg-white/[0.04]' : 'bg-white/10'}"
    >
      <div class="flex flex-col rounded-[15px] overflow-hidden bg-ryokan-sidebar">

        <textarea
          id="chat-input-textarea"
          bind:value
          onkeydown={handleKeydown}
          oninput={handleInput}
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
            min-height: 44px;
            max-height: 400px;
            overflow-y: auto;
            scrollbar-width: none;
            transition: height 0.2s cubic-bezier(0.2, 0, 0, 1);
          "
        ></textarea>

        <div class="flex items-center justify-end gap-2 px-2.5 pb-2 pt-0.5">
          {#if isEditing}
            <span class="mr-auto pl-1 text-xs text-ryokan-accent">{m.chat_edit()}</span>
            <button type="button" onclick={onCancelEdit} disabled={isSavingEdit}
              class="text-xs text-gray-400 hover:text-gray-200 disabled:opacity-40">
              {m.chat_cancel()}
            </button>
          {/if}
          <button
            type="button"
            onclick={() => isGenerating ? onStop?.() : handleSend()}
            disabled={!isGenerating && (value.trim().length === 0 || isSavingEdit)}
            aria-label={isGenerating ? m.chat_stop_generating() : isEditing ? m.chat_save() : m.chat_send_message()}
            class="send-btn"
            class:send-btn--active={!isGenerating && !isSavingEdit && value.trim().length > 0}
            class:send-btn--stop={isGenerating}
            class:send-btn--disabled={!isGenerating && (value.trim().length === 0 || isSavingEdit)}
          >
            {#if isGenerating}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <rect x="5" y="6" width="5" height="12" rx="1.5"/>
                <rect x="14" y="6" width="4" height="12" rx="1.5"/>
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
  @media (max-width: 639px) {
    .composer-frame {
      padding: 0;
      background: transparent;
    }

    .composer-shell::before {
      content: '';
      position: absolute;
      left: 50%;
      bottom: 0;
      z-index: -1;
      width: 100vw;
      height: calc(100% + 1.25rem);
      transform: translateX(-50%);
      pointer-events: none;
      background: linear-gradient(
        to bottom,
        transparent 0,
        rgb(0 0 0 / 10%) 1.25rem,
        rgb(0 0 0 / 82%) 100%
      );
    }
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
