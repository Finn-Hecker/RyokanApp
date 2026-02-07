<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { currentView, activeCharacter, apiSettings } from '$lib/stores/appState';
  import { listen, type UnlistenFn } from '@tauri-apps/api/event';
  import { tick, onMount, onDestroy } from 'svelte';
  
  import ChatMessage from './ChatMessage.svelte';

  type Message = {
    id: string;
    text: string;
    isUser: boolean;
    senderName: string;
  };

  const uuid = () => crypto.randomUUID();

  let chatHistory: Message[] = [
    { 
      id: uuid(), 
      isUser: false, 
      senderName: $activeCharacter?.name || "Begleiter", 
      text: "Schön, dass du hier bist. Worüber möchtest du sprechen?" 
    }
  ];

  let inputText = "";
  let chatContainer: HTMLDivElement;
  let autoscroll = true;
  let isGenerating = false;
  let unlisten: UnlistenFn;

  onMount(async () => {
    unlisten = await listen<{token: string}>('ai-token', (event) => {
      if (chatHistory.length > 0) {
        chatHistory[chatHistory.length - 1].text += event.payload.token;
        chatHistory = chatHistory;
        if (autoscroll) smoothScroll();
      }
    });
  });

  onDestroy(() => { if (unlisten) unlisten(); });

  let scheduledScroll = false;
  function smoothScroll() {
    if (!chatContainer || scheduledScroll) return;
    scheduledScroll = true;
    requestAnimationFrame(async () => {
      await tick();
      chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
      scheduledScroll = false;
    });
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
    isGenerating = true;
    autoscroll = true;

    chatHistory = [
      ...chatHistory, 
      { id: uuid(), isUser: true, senderName: "Du", text: prompt }, 
      { id: uuid(), isUser: false, senderName: $activeCharacter?.name || "AI", text: "" }
    ];
    
    smoothScroll();

    const apiMessages = [
      {
        role: "system",
        content: `### Roleplay Instructions:
You are ${$activeCharacter?.name}. ${$activeCharacter?.desc}.
Rules: Stay in character. No commentary. German only. Keep it immersive.`
      },
      ...chatHistory.slice(0, -1).map(msg => ({ 
          role: msg.isUser ? "user" : "assistant", 
          content: msg.text 
      }))
    ];

    try {
      await invoke("call_ai_api", { payload: { url: $apiSettings.url, messages: apiMessages } });
    } catch (err) {
      console.error(err);
      chatHistory[chatHistory.length - 1].text = "Verbindung unterbrochen.";
    } finally {
      isGenerating = false;
    }
  }

  async function handleKeydown(e: KeyboardEvent) {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); await sendMessage(); }
  }

  function goBack() { currentView.set("lobby"); }
</script>

<div class="flex flex-col h-full font-sans overflow-hidden bg-ryokan-bg relative">
  <div class="flex items-center pt-20 pb-4 px-6 shrink-0 z-10">
    <button on:click={goBack} class="text-gray-500 hover:text-white mr-4 transition-colors" aria-label="Zurück">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M19 12H5M12 19l-7-7 7-7"/></svg>
    </button>
    <div>
      <h2 class="text-lg font-medium text-gray-200">{$activeCharacter?.name}</h2>
      <p class="text-xs text-ryokan-accent opacity-80">Online</p>
    </div>
  </div>

  <div 
    bind:this={chatContainer}
    on:scroll={handleScroll}
    class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 pt-4 scroll-smooth pb-4"
  >
    {#each chatHistory as msg (msg.id)}
      <ChatMessage 
        {msg} 
        isLast={chatHistory[chatHistory.length - 1] === msg}
        {isGenerating}
      />
    {/each}
  </div>

  <div class="p-4 sm:p-6 shrink-0">
    <div class="max-w-3xl mx-auto bg-ryokan-surface rounded-3xl flex items-end p-2 shadow-xl border border-white/5 focus-within:border-ryokan-accent/50 transition-colors">
      <textarea
        bind:value={inputText}
        on:keydown={handleKeydown}
        placeholder="Antworte..."
        rows="1"
        class="bg-transparent flex-1 min-w-0 text-gray-200 px-4 py-3 outline-none placeholder-gray-600 resize-none max-h-32 text-sm"
      ></textarea>

      <button
        on:click={sendMessage}
        disabled={isGenerating}
        class="shrink-0 w-10 h-10 flex items-center justify-center rounded-full bg-ryokan-accent text-ryokan-bg hover:opacity-90 transition-all active:scale-95 disabled:opacity-50 disabled:grayscale"
      >
        {#if isGenerating}
          <div class="w-3 h-3 border-2 border-ryokan-bg border-t-transparent rounded-full animate-spin"></div>
        {:else}
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"></line><polygon points="22 2 15 22 11 13 2 9 22 2"></polygon></svg>
        {/if}
      </button>
    </div>
    <div class="text-center mt-2">
      <p class="text-[10px] text-gray-700">Ryokan AI kann Fehler machen.</p>
    </div>
  </div>
</div>