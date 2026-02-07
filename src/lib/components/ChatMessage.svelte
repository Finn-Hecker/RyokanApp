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

<div class="flex flex-col {msg.isUser ? 'items-end' : 'items-start'} animate-fade-in group mb-6">
  
  {#if !msg.isUser}
    <span class="text-[10px] text-gray-600 mb-1 ml-2 uppercase tracking-wide">
      {msg.senderName}
    </span>
  {/if}

  <div class="max-w-[85%] sm:max-w-[70%] px-5 py-3 shadow-sm text-[15px] leading-relaxed break-words
    {msg.isUser
      ? 'bg-ryokan-surface text-gray-200 rounded-2xl rounded-tr-sm border border-white/5'
      : 'bg-transparent text-gray-300 pl-4 border-l-2 border-ryokan-accent markdown-content' 
    }">
    
    {#if msg.isUser}
      {msg.text}
    {:else}
      <div class="prose-custom">
        {@html cleanHtml}
      </div>
      
      {#if isLast && isGenerating}
        <span class="animate-pulse text-ryokan-accent inline-block ml-1">|</span>
      {:else if !msg.text}
        <span class="animate-pulse text-ryokan-accent text-xs">schreibt...</span>
      {/if}
    {/if}
  </div>
</div>

<style>
  .animate-fade-in {
    animation: fadeIn 0.4s cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
  }
  @keyframes fadeIn {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }

  :global(.prose-custom p) { margin-bottom: 0.5em; }
  :global(.prose-custom p:last-child) { margin-bottom: 0; }
  :global(.prose-custom strong) { color: white; font-weight: 700; }
  :global(.prose-custom em) { color: #9ca3af; font-style: italic; }
  :global(.prose-custom ul) { list-style-type: disc; padding-left: 1.5em; margin-bottom: 0.5em; }
  :global(.prose-custom ol) { list-style-type: decimal; padding-left: 1.5em; margin-bottom: 0.5em; }
  :global(.prose-custom code) { 
    background-color: rgba(255,255,255,0.1); 
    padding: 0.1em 0.3em; 
    border-radius: 0.2em; 
    font-family: monospace; 
    font-size: 0.9em;
  }
  :global(.prose-custom pre) {
    background-color: rgba(0,0,0,0.3);
    padding: 0.8em;
    border-radius: 0.5em;
    overflow-x: auto;
    margin-bottom: 0.5em;
  }
</style>