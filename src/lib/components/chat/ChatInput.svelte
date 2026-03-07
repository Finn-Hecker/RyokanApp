<script lang="ts">
  import * as m from '$lib/paraglide/messages';

  let {
    isGenerating = false,
    value = $bindable(''),
    isOOC = $bindable(false),
    onSend,
    onStop
  }: {
    isGenerating?: boolean;
    value?: string;
    isOOC?: boolean;
    onSend?: () => void;
    onStop?: () => void;
  } = $props();

  function handleSend() {
    if (value.trim().length > 0) {
      onSend?.();
      setTimeout(() => {
        const ta = document.getElementById('chat-input-textarea');
        if (ta) ta.style.height = '60px';
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
    target.style.height = '60px';
    const newHeight = Math.min(target.scrollHeight, 400);
    target.style.height = currentHeight || '60px';
    void target.offsetHeight;
    target.style.transition = 'height 0.2s cubic-bezier(0.2, 0, 0, 1), color 0.3s ease';
    target.style.height = newHeight + 'px';
  }

  function toggleOOC() {
    isOOC = !isOOC;
  }
</script>

<div class="p-4 sm:p-6 shrink-0 w-full relative z-10">
  <div class="max-w-3xl mx-auto">

    <div class="rounded-[20px] transition-all duration-500 ease-out p-px
      {isOOC
        ? 'bg-gradient-to-b from-ryokan-accent/40 to-ryokan-accent/5'
        : 'bg-white/6'}"
    >
      <div class="flex flex-col rounded-[19px] transition-all duration-500 ease-out overflow-hidden bg-ryokan-sidebar custom-chat-shadow">

        <textarea
          id="chat-input-textarea"
          bind:value
          onkeydown={handleKeydown}
          oninput={handleInput}
          placeholder={isOOC ? m.chat_input_placeholder_ooc() : m.chat_placeholder()}
          rows="1"
          class="w-full bg-transparent px-5 pt-4 pb-2 outline-none resize-none text-[15px] leading-relaxed placeholder:select-none
            {isOOC
              ? 'text-ryokan-text placeholder-ryokan-accent/60 italic'
              : 'text-ryokan-text placeholder-[#44444c]'}"
          style="
            min-height: 60px;
            max-height: 400px;
            overflow-y: auto;
            scrollbar-width: none;
            transition: height 0.2s cubic-bezier(0.2, 0, 0, 1), color 0.5s ease;
          "
        ></textarea>

        <div class="flex items-center justify-between px-3 pb-3 pt-1">

          <button
            onclick={toggleOOC}
            title={isOOC ? m.chat_input_ooc_title_active() : m.chat_input_ooc_title_inactive()}
            class="ooc-btn"
            class:ooc-btn--active={isOOC}
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
            </svg>
            <span class="text-[11.5px] font-bold tracking-widest">{m.chat_input_director_button()}</span>
          </button>

          <button
            onclick={() => isGenerating ? onStop?.() : handleSend()}
            disabled={!isGenerating && value.trim().length === 0}
            class="send-btn"
            class:send-btn--active={!isGenerating && value.trim().length > 0 && !isOOC}
            class:send-btn--ooc={!isGenerating && value.trim().length > 0 && isOOC}
            class:send-btn--stop={isGenerating}
            class:send-btn--disabled={!isGenerating && value.trim().length === 0}
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
  #chat-input-textarea::-webkit-scrollbar {
    display: none;
  }

  .custom-chat-shadow {
    box-shadow:
      0 0.25rem 1.25rem hsl(var(--always-black) / 3.5%),
      0 0 0 0.5px color-mix(in srgb, var(--color-ryokan-accent) 12%, transparent);
  }

  .ooc-btn {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 12px;
    height: 38px;
    border-radius: 10px;
    border: 1px solid rgba(255, 255, 255, 0.07);
    background: rgba(255, 255, 255, 0.04);
    color: rgba(255, 255, 255, 0.32);
    font-family: inherit;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    cursor: pointer;
    transition: background 0.18s, color 0.18s, border-color 0.18s;
  }

  .ooc-btn:hover {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.60);
    border-color: rgba(255, 255, 255, 0.12);
  }

  .ooc-btn--active {
    background: rgba(212, 180, 131, 0.10);
    color: #d4b483;
    border-color: rgba(212, 180, 131, 0.28);
  }

  .ooc-btn--active:hover {
    background: rgba(212, 180, 131, 0.15);
    color: #dfc090;
    border-color: rgba(212, 180, 131, 0.38);
  }

  .send-btn {
    flex-shrink: 0;
    width: 38px;
    height: 38px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 12px;
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
    box-shadow: 0 2px 12px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255,255,255,0.08) inset;
  }

  .send-btn--active:hover {
    background: #ffffff;
    box-shadow: 0 4px 18px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(255,255,255,0.12) inset;
    transform: translateY(-1px);
  }

  .send-btn--ooc {
    background: #d4b483;
    border-color: rgba(212, 180, 131, 0.50);
    color: #0e0e12;
    box-shadow: 0 2px 14px rgba(212, 180, 131, 0.30), 0 0 0 1px rgba(255,255,255,0.08) inset;
  }

  .send-btn--ooc:hover {
    background: #dfc090;
    box-shadow: 0 4px 20px rgba(212, 180, 131, 0.42);
    transform: translateY(-1px);
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