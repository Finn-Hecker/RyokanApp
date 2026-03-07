<script lang="ts">
  import * as m from '$lib/paraglide/messages';
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import type { DisplayMessage } from '$lib/stores/chatStore.svelte';

  let {
    msg,
    isGenerating = false,
    isLast = false,
    canRetry = false,
    canEdit = false,
    character = null,
    onRetry,
    onEditSave
  }: {
    msg: DisplayMessage;
    isGenerating?: boolean;
    isLast?: boolean;
    canRetry?: boolean;
    canEdit?: boolean;
    character?: any;
    onRetry?: (data: { msgId: string }) => void;
    onEditSave?: (data: { msgId: string; newContent: string }) => void;
  } = $props();

  let editMode = $state(false);
  let editValue = $state('');
  let msgEl = $state<HTMLDivElement | null>(null);
  let editWidth = $state(0);
  let editHeight = $state(0);

  let isOocMsg = $derived(msg.isUser && /^\[OOC:\s/.test(msg.text));
  let displayText = $derived(
    isOocMsg
      ? msg.text.replace(/^\[OOC:\s*/, '').replace(/\]$/, '')
      : msg.text
  );

  let rawHtml = $derived(marked.parse(msg.text || '') as string);
  let cleanHtml = $derived(DOMPurify.sanitize(rawHtml));
  let showActions = $derived((canRetry || canEdit) && !msg.isUser && !isGenerating);

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

<div class="flex {msg.isUser ? 'justify-end mb-6' : 'justify-start mb-5'}">

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

      <div class="relative group/message flex-1 min-w-0">

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
            class="text-gray-200 text-sm break-words prose-custom"
          >
            {@html cleanHtml}

            {#if isLast && isGenerating && !msg.text}
              <span class="inline-flex items-center gap-[3px] ml-1 translate-y-[-1px]">
                <span class="typing-dot"></span>
                <span class="typing-dot" style="animation-delay: 0.18s"></span>
                <span class="typing-dot" style="animation-delay: 0.36s"></span>
              </span>
            {/if}
          </div>

          {#if showActions}
            <div class="action-bar
              opacity-0 group-hover/message:opacity-100
              translate-y-1 group-hover/message:translate-y-0
              transition-all duration-200 ease-out">

              {#if canRetry}
                <button
                  onclick={() => onRetry?.({ msgId: msg.id })}
                  aria-label={m.chat_retry()}
                  title={m.chat_retry()}
                  class="action-btn action-btn--retry"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                  </svg>
                  <span>{m.chat_retry()}</span>
                </button>
              {/if}

              {#if canRetry && canEdit}
                <div class="action-divider"></div>
              {/if}

              {#if canEdit}
                <button
                  onclick={handleEditOpen}
                  aria-label={m.chat_edit()}
                  title={m.chat_edit()}
                  class="action-btn action-btn--edit"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
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

  .action-bar {
    display: inline-flex;
    align-items: center;
    gap: 1px;
    margin-top: 10px;
    padding: 3px;
    background: rgba(20, 20, 24, 0.92);
    border: 1px solid rgba(255, 255, 255, 0.09);
    border-radius: 10px;
    box-shadow:
      0 2px 12px rgba(0, 0, 0, 0.4),
      0 1px 3px rgba(0, 0, 0, 0.3),
      inset 0 1px 0 rgba(255, 255, 255, 0.04);
    backdrop-filter: blur(8px);
  }

  .action-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    border-radius: 7px;
    border: none;
    background: transparent;
    font-size: 11.5px;
    font-weight: 500;
    font-family: inherit;
    letter-spacing: 0.01em;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.13s, color 0.13s, transform 0.1s;
  }

  .action-btn:active {
    transform: scale(0.95);
  }

  .action-btn--retry {
    color: rgba(212, 180, 131, 0.70);
  }

  .action-btn--retry:hover {
    background: rgba(212, 180, 131, 0.10);
    color: #d4b483;
  }

  .action-btn--edit {
    color: rgba(255, 255, 255, 0.38);
  }

  .action-btn--edit:hover {
    background: rgba(255, 255, 255, 0.07);
    color: rgba(255, 255, 255, 0.80);
  }

  .action-divider {
    width: 1px;
    height: 14px;
    background: rgba(255, 255, 255, 0.08);
    margin: 0 2px;
    flex-shrink: 0;
  }

  :global(.prose-custom) {
    font-size: 1rem;
    line-height: 1.8;
    color: #e5e5ea;
  }

  :global(.prose-custom p) {
    margin-bottom: 1.2em;
  }
  :global(.prose-custom p:last-child) { margin-bottom: 0; }

  :global(.prose-custom strong) {
    color: #ffffff;
    font-weight: 600;
  }

  :global(.prose-custom em) {
    color: #a39887;
    font-style: italic;
  }

  :global(.typing-dot) {
    display: inline-block;
    width: 4px; height: 4px;
    border-radius: 50%;
    background-color: #d4b483;
    opacity: 0.3;
    animation: typingDot 1.1s ease-in-out infinite;
  }

  @keyframes typingDot {
    0%, 100% { opacity: 0.2; transform: translateY(0); }
    50%       { opacity: 0.9; transform: translateY(-3px); }
  }
</style>