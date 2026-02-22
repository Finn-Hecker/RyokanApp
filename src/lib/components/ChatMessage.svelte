<script lang="ts">
  import { marked } from 'marked';
  import DOMPurify from 'dompurify';
  import type { DisplayMessage } from '$lib/stores/chatStore';
  
  export let msg: DisplayMessage;
  export let isGenerating: boolean = false;
  export let isLast: boolean = false;

  $: rawHtml = marked.parse(msg.text || "") as string;
  $: cleanHtml = DOMPurify.sanitize(rawHtml);
</script>

<div class="flex {msg.isUser ? 'justify-end' : 'justify-start'} animate-fade-in mb-4">
  
  {#if msg.isUser}
    <div class="max-w-[75%] sm:max-w-[60%] px-4 py-2.5 rounded-2xl rounded-tr-sm
      bg-ryokan-surface border border-white/[0.07] text-gray-200 text-sm leading-relaxed break-words shadow-sm">
      {msg.text}
    </div>

  {:else}
    <div class="max-w-[85%] sm:max-w-[72%] text-gray-300 text-sm leading-relaxed break-words">
      <div class="prose-custom">
        {@html cleanHtml}
      </div>

      {#if (isLast && isGenerating) || !msg.text}
        <span class="inline-flex items-center gap-[3px] ml-1 translate-y-[-1px]">
          <span class="typing-dot"></span>
          <span class="typing-dot" style="animation-delay: 0.18s"></span>
          <span class="typing-dot" style="animation-delay: 0.36s"></span>
        </span>
      {/if}
    </div>
  {/if}

</div>

<style>
  .animate-fade-in {
    animation: fadeIn 0.3s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(6px); }
    to { opacity: 1; transform: translateY(0); }
  }

  :global(.prose-custom p) { margin-bottom: 0.6em; }
  :global(.prose-custom p:last-child) { margin-bottom: 0; }
  :global(.prose-custom strong) { color: #f3f3f3; font-weight: 600; }
  :global(.prose-custom em) { color: #a0a0a8; font-style: italic; }
  :global(.prose-custom ul) { list-style-type: disc; padding-left: 1.4em; margin-bottom: 0.5em; }
  :global(.prose-custom ol) { list-style-type: decimal; padding-left: 1.4em; margin-bottom: 0.5em; }
  :global(.prose-custom li) { margin-bottom: 0.25em; }
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
  :global(.prose-custom pre code) {
    background: none;
    padding: 0;
    color: #e5e5ea;
    font-size: 0.85em;
  }
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

  :global(.prose-custom blockquote) {
    border-left: 2px solid #d4b483;
    padding-left: 0.9em;
    margin-left: 0;
    color: #9ca3af;
    font-style: italic;
  }
</style>