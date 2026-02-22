<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { currentView, activeCharacter, apiSettings } from '$lib/stores/appState';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { tick, onMount, onDestroy } from 'svelte';
  
  import { currentMessages, addMessage, loadMessages, activeChatId } from '$lib/stores/chatStore';
  import ChatMessage from './ChatMessage.svelte';
  
  import { buildSystemPrompt } from '$lib/utils/promptBuilder';

  import * as m from '$lib/paraglide/messages';

  let inputText = "";
  let chatContainer: HTMLDivElement;
  let autoscroll = true;
  let isGenerating = false;
  let unlisten: UnlistenFn;

  let rawStreamBuffer = "";
  let isThinkingPhase = false;
  let streamingText = "";
  
  let lastMsgCount = 0;
  let lastFirstMsgId = "";

  // Error handling states
  let showErrorModal = false;
  let errorMessage = "";
  let pendingUserMessage = "";
  let showTempUserMessage = false;

  let displayMessages: any[] = [];

  onMount(async () => {
    if ($activeChatId) {
      await loadMessages($activeChatId);
    }
    unlisten = await listen<{token: string}>('ai-token', (event) => {
      const token = event.payload.token;
      
      rawStreamBuffer += token;

      if ($apiSettings.isThinkingModel) {
        processThinkingStream(false);
      } else {
        streamingText = rawStreamBuffer;
      }

      if (autoscroll) scrollToBottom();
    });
  });

  function processThinkingStream(isFinished: boolean) {
    const thinkEnd = "</think>";
    
    if (rawStreamBuffer.includes(thinkEnd)) {
      isThinkingPhase = false;
      const parts = rawStreamBuffer.split(thinkEnd);
      streamingText = parts[parts.length - 1].trimStart();
    } else {
      if (isFinished) {
        isThinkingPhase = false;
        streamingText = rawStreamBuffer;
      } else {
        isThinkingPhase = true;
        streamingText = ""; 
      }
    }
  }

  onDestroy(() => { if (unlisten) unlisten(); });

  $: {
    let messages = $currentMessages.map(msg => ({
      id: msg.id?.toString() || Math.random().toString(),
      text: msg.content,
      isUser: msg.role === 'user',
      senderName: msg.role === 'user' ? m.chat_sender_you() : ($activeCharacter?.name || m.chat_sender_ai())
    }));

    if (showTempUserMessage && pendingUserMessage) {
      messages.push({
        id: 'temp-user',
        text: pendingUserMessage,
        isUser: true,
        senderName: m.chat_sender_you()
      });
    }

    displayMessages = messages;
  }

  $: if (displayMessages && chatContainer) {
      handleAutoScroll();
  }

  async function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    await tick();
    if (chatContainer) {
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior });
    }
  }

  async function handleAutoScroll() {
      await tick();
      if (!chatContainer) return;

      const count = displayMessages.length;
      
      if (count === 0) {
        lastFirstMsgId = "";
        lastMsgCount = 0;
        return;
      }

      const currentFirstId = displayMessages[0].id;

      if (currentFirstId !== lastFirstMsgId) {
          scrollToBottom('auto');
      } 
      else if (count > lastMsgCount && autoscroll) {
          scrollToBottom('smooth');
      }

      lastMsgCount = count;
      lastFirstMsgId = currentFirstId;
  }

  function handleScroll() {
    if (!chatContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainer;
    autoscroll = (scrollHeight - scrollTop - clientHeight) <= 50;
  }

  async function sendMessage() {
    if (!inputText.trim() || isGenerating) return;
    
    const prompt = inputText;
    inputText = "";
    pendingUserMessage = prompt;
    
    await performApiCall(prompt);
  }

  async function performApiCall(prompt: string) {
    isGenerating = true;
    streamingText = "";
    rawStreamBuffer = "";
    isThinkingPhase = false;
    autoscroll = true;

    showTempUserMessage = true;
    scrollToBottom();

    const systemPrompt = buildSystemPrompt({
      charName: $activeCharacter?.name || 'Unknown',
      desc: $activeCharacter?.desc,
      personality: $activeCharacter?.personality,
      scenario: $activeCharacter?.scenario,
      example: $activeCharacter?.mes_example,
      lang: $apiSettings.aiLanguage || 'English',
      userName: 'User',
      modelType: 'ollama'
    });

    const recentMessages = $currentMessages.slice(-10);

    const apiMessages = [
      {
        role: "system",
        content: systemPrompt 
      },
      ...recentMessages.map(msg => ({ 
          role: msg.role, 
          content: msg.content 
      })),
      {
        role: "user",
        content: prompt
      }
    ];

    console.log(apiMessages);

    try {
      await invoke("call_ai_api", { payload: { 
        url: $apiSettings.url, 
        api_key: $apiSettings.apiKey,
        model: $apiSettings.model,
        messages: apiMessages,
        temperature: $apiSettings.temperature
      } });
      if ($apiSettings.isThinkingModel) {
          processThinkingStream(true);
      } else {
          streamingText = rawStreamBuffer;
      }
      
      await addMessage('user', prompt);
      await addMessage('assistant', streamingText || rawStreamBuffer);
      
      showTempUserMessage = false;
      pendingUserMessage = "";
    } catch (err) {
      console.error(err);
      
      showTempUserMessage = false;
      errorMessage = m.chat_error_connection();
      showErrorModal = true;
    } finally {
      isGenerating = false;
      streamingText = "";
      rawStreamBuffer = "";
    }
  }

  async function retryLastMessage() {
    showErrorModal = false;
    if (pendingUserMessage) {
      await performApiCall(pendingUserMessage);
    }
  }

  function closeErrorModal() {
    showErrorModal = false;
    showTempUserMessage = false;
    pendingUserMessage = "";
  }

  async function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); await sendMessage(); }
  }

  function goBack() { currentView.set("lobby"); }

  async function stopGeneration() {
    await invoke("stop_generation");
  }
</script>

<div class="flex flex-col h-full font-sans overflow-hidden bg-ryokan-bg relative">

  <!-- Chat Header -->
  <div class="flex items-center gap-4 px-5 py-4 shrink-0 border-b border-white/[0.06] bg-ryokan-bg/80 backdrop-blur-md z-10">
    <!-- Back button -->
    <button
      on:click={goBack}
      class="w-9 h-9 flex items-center justify-center rounded-full text-gray-500 hover:text-white hover:bg-white/8 transition-all shrink-0"
      aria-label={m.chat_aria_back()}
    >
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5M12 19l-7-7 7-7"/>
      </svg>
    </button>

    <!-- Avatar -->
    <div class="shrink-0 w-10 h-10 rounded-full overflow-hidden ring-2 ring-white/10">
      {#if $activeCharacter?.avatarUrl}
        <img
          src={$activeCharacter.avatarUrl}
          alt={$activeCharacter.name}
          class="w-full h-full object-cover"
        />
      {:else}
        <div class="w-full h-full {$activeCharacter?.color ?? 'bg-ryokan-surface'} flex items-center justify-center text-white font-bold text-base">
          {$activeCharacter?.initials ?? ($activeCharacter?.name?.[0]?.toUpperCase() ?? '?')}
        </div>
      {/if}
    </div>

    <!-- Name + status -->
    <div class="flex-1 min-w-0">
      <h2 class="text-sm font-semibold text-gray-100 truncate leading-tight">{$activeCharacter?.name}</h2>
      <p class="text-xs text-ryokan-accent opacity-80 leading-tight mt-0.5">{m.chat_status_online()}</p>
    </div>
  </div>

  <!-- Messages -->
  <div 
    bind:this={chatContainer}
    on:scroll={handleScroll}
    class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 pt-4 pb-4"
  >
    <div class="max-w-3xl mx-auto w-full">
    {#each displayMessages as msg (msg.id)}
      <ChatMessage {msg} />
    {/each}

    {#if isGenerating}
      
      {#if isThinkingPhase}
        <div class="flex items-start mb-6 animate-fade-in pl-4">
           <div class="flex flex-col items-start">
             <span class="text-[10px] text-gray-500 mb-1 uppercase tracking-wide">
               {$activeCharacter?.name || m.chat_sender_ai()}
             </span>
             <div class="flex items-center space-x-3 text-gray-500 bg-white/5 px-4 py-2 rounded-xl border border-white/5 shadow-inner">
                <span class="relative flex h-2.5 w-2.5">
                  <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-ryokan-accent opacity-50"></span>
                  <span class="relative inline-flex rounded-full h-2.5 w-2.5 bg-ryokan-accent/80"></span>
                </span>
                <span class="text-xs font-medium italic tracking-wide">{m.chat_thinking()}</span>
             </div>
           </div>
        </div>

      {:else if streamingText}
        <ChatMessage msg={{
          id: 'streaming',
          text: streamingText,
          isUser: false,
          senderName: $activeCharacter?.name || m.chat_sender_ai()
        }} isLast={true} {isGenerating} />
      {/if}

    {/if}
    </div>
  </div>

  <!-- Input -->
  <div class="p-4 sm:p-6 shrink-0">
    <div class="max-w-3xl mx-auto bg-ryokan-surface rounded-3xl flex items-end p-2 shadow-xl border border-white/5 focus-within:border-ryokan-accent/50 transition-colors">
      <textarea
        bind:value={inputText}
        on:keydown={handleKeydown}
        placeholder={m.chat_placeholder()} 
        rows="1"
        class="bg-transparent flex-1 min-w-0 text-gray-200 px-4 py-3 outline-none placeholder-gray-600 resize-none max-h-32 text-sm"
      ></textarea>

      <button
        on:click={isGenerating ? stopGeneration : sendMessage}
        class="shrink-0 w-10 h-10 flex items-center justify-center rounded-full transition-all relative group
          {isGenerating
            ? 'bg-white/5 text-ryokan-accent/70 hover:bg-white/8 hover:text-ryokan-accent'
            : 'bg-ryokan-accent text-ryokan-bg hover:opacity-90'}"
      >
        {#if isGenerating}
          <div class="absolute bottom-full mb-2 left-1/2 -translate-x-1/2 px-2.5 py-1 bg-ryokan-surface border border-white/10 rounded-lg text-xs text-ryokan-text whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none shadow-lg">
            {m.chat_stop_generating()} 
          </div>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="5" width="13" height="14" rx="2.5" ry="3"></rect>
          </svg>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
            <line x1="22" y1="2" x2="11" y2="13"></line>
            <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
          </svg>
        {/if}
      </button>
    </div>
  </div>
</div>

<!-- Error Modal -->
{#if showErrorModal}
  <div class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 animate-fade-in">
    <div class="bg-ryokan-surface rounded-2xl shadow-2xl border border-red-500/20 max-w-md w-full p-6 animate-scale-in">
      <div class="flex items-start mb-4">
        <div class="flex-shrink-0 w-10 h-10 bg-red-500/10 rounded-full flex items-center justify-center mr-3">
          <svg class="w-5 h-5 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
        </div>
        <div class="flex-1">
          <h3 class="text-lg font-semibold text-gray-100 mb-1">{m.chat_error_title()}</h3>
          <p class="text-sm text-gray-400">{errorMessage}</p>
        </div>
      </div>

      {#if pendingUserMessage}
        <div class="mb-4 p-3 bg-white/5 rounded-lg border border-white/10">
          <p class="text-xs text-gray-500 mb-1 uppercase tracking-wide">{m.chat_error_your_message()}</p>
          <p class="text-sm text-gray-300 line-clamp-3">{pendingUserMessage}</p>
        </div>
      {/if}

      <div class="flex gap-3">
        <button
          on:click={retryLastMessage}
          class="flex-1 bg-ryokan-accent text-ryokan-bg px-4 py-2.5 rounded-xl font-medium hover:opacity-90 transition-all flex items-center justify-center gap-2"
        >
          <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          {m.chat_error_retry()}
        </button>
        <button
          on:click={closeErrorModal}
          class="px-4 py-2.5 rounded-xl font-medium text-gray-400 hover:text-gray-200 hover:bg-white/5 transition-all"
        >
          {m.chat_error_cancel()}
        </button>
      </div>
    </div>
  </div>
{/if}