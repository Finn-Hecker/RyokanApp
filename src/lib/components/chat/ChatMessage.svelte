<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import { createEventDispatcher, tick } from 'svelte';
  import type { DisplayMessage } from '$lib/stores/chatStore';

  export let msg: DisplayMessage;
  export let isGenerating: boolean = false;
  export let isLast: boolean = false;
  export let canRetry: boolean = false;
  export let canEdit: boolean = false;

  const dispatch = createEventDispatcher<{
    retry: { msgId: string };
    editSave: { msgId: string; newContent: string };
  }>();

  $: rawHtml = marked.parse(msg.text || '') as string;
  $: cleanHtml = DOMPurify.sanitize(rawHtml);

  $: showActions = (canRetry || canEdit) && !msg.isUser && !isGenerating;

  let editMode = false;
  let editValue = '';
  let msgEl: HTMLDivElement;
  let editWidth = 0;
  let editHeight = 0;

  async function handleEditOpen() {
    // Capture exact dimensions of the message before switching to edit mode
    if (msgEl) {
      editWidth  = msgEl.offsetWidth;
      editHeight = msgEl.offsetHeight;
    }
    editValue = msg.text;
    editMode  = true;
  }

  function handleEditSave() {
    if (editValue.trim()) {
      dispatch('editSave', { msgId: msg.id, newContent: editValue.trim() });
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

<!-- svelte-ignore a11y-click-events-have-key-events -->
<div class="flex {msg.isUser ? 'justify-end mb-4' : 'justify-start mb-1'}">

  {#if msg.isUser}
    <div class="max-w-[75%] sm:max-w-[60%] px-4 py-2.5 rounded-2xl rounded-tr-sm
      bg-ryokan-surface border border-white/[0.07] text-gray-200 text-sm leading-relaxed break-words shadow-sm">
      {msg.text}
    </div>

  {:else}
    <div class="relative group/message max-w-[90%] sm:max-w-[75%]">

      {#if editMode}
        <!-- Flowing border wrapper — conic gradient rotates around the textarea -->
        <div
          class="edit-border-wrap rounded-xl p-[1.5px]"
          style="width: {editWidth}px;"
        >
          <div class="rounded-[10px] bg-ryokan-bg overflow-hidden">
            <textarea
              bind:value={editValue}
              on:keydown={handleEditKeydown}
              class="w-full bg-transparent text-gray-200 text-sm leading-relaxed
                     resize-none outline-none px-3 py-2.5 block"
              style="height: {editHeight}px;"
            ></textarea>

            <!-- Save / Cancel bar -->
            <div class="flex items-center justify-between px-3 pb-2.5">
              <p class="text-[10px] text-gray-600">Ctrl+Enter · Esc</p>
              <div class="flex gap-2">
                <button
                  on:click={handleEditCancel}
                  class="px-3 py-1 text-xs text-gray-400 hover:text-gray-200 hover:bg-white/5 rounded-lg transition-all"
                >
                  Cancel
                </button>
                <button
                  on:click={handleEditSave}
                  class="px-3 py-1 text-xs bg-ryokan-accent text-ryokan-bg font-medium rounded-lg hover:opacity-90 transition-all"
                >
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>

      {:else}
        <!-- Normal message — bind:this to capture size on edit -->
        <div
          bind:this={msgEl}
          class="text-gray-300 text-sm leading-relaxed break-words prose-custom"
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

        <!-- Inline action icons -->
        {#if showActions}
          <div class="absolute top-full left-0 pt-1 flex items-center gap-2
            opacity-0 group-hover/message:opacity-100 transition-opacity duration-200">

            {#if canRetry}
              <button
                on:click={() => dispatch('retry', { msgId: msg.id })}
                class="text-gray-400 hover:text-ryokan-accent transition-colors"
                aria-label="Retry" title="Retry"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                  <path d="M3 3v5h5"/>
                </svg>
              </button>
            {/if}

            {#if canEdit}
              <button
                on:click={handleEditOpen}
                class="text-gray-400 hover:text-gray-100 transition-colors"
                aria-label="Edit" title="Edit"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                </svg>
              </button>
            {/if}

          </div>
        {/if}
      {/if}

    </div>
  {/if}

</div>

<style>
  /* ── Flowing border animation ─────────────────────────────────────────── */
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

  /* ── Prose styles ─────────────────────────────────────────────────────── */
  :global(.prose-custom p)            { margin-bottom: 0.8em; line-height: 1.75rem; }
  :global(.prose-custom p:last-child) { margin-bottom: 0; }
  :global(.prose-custom strong)       { color: #f3f3f3; font-weight: 600; }
  :global(.prose-custom em)           { color: #a0a0a8; font-style: italic; }
  :global(.prose-custom ul)           { list-style-type: disc; padding-left: 1.4em; margin-bottom: 0.5em; }
  :global(.prose-custom ol)           { list-style-type: decimal; padding-left: 1.4em; margin-bottom: 0.5em; }
  :global(.prose-custom li)           { margin-bottom: 0.25em; }
  :global(.prose-custom code) {
    background-color: rgba(255,255,255,0.08);
    padding: 0.15em 0.4em;
    border-radius: 0.25em;
    font-family: monospace;
    font-size: 0.875em;
    color: #d4b483;
  }
  :global(.prose-custom pre) {
    background-color: rgba(0,0,0,0.35);
    padding: 0.9em 1em;
    border-radius: 0.6em;
    overflow-x: auto;
    margin-bottom: 0.6em;
    border: 1px solid rgba(255,255,255,0.06);
  }
  :global(.prose-custom pre code) { background: none; padding: 0; color: #e5e5ea; font-size: 0.85em; }
  :global(.prose-custom blockquote) {
    border-left: 2px solid #d4b483;
    padding-left: 0.9em;
    margin-left: 0;
    color: #9ca3af;
    font-style: italic;
  }

  /* ── Typing dots ──────────────────────────────────────────────────────── */
  :global(.typing-dot) {
    display: inline-block;
    width: 4px;
    height: 4px;
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