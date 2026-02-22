<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { currentView, activeCharacter, apiSettings } from '$lib/stores/appState';
  import { tick, onMount } from 'svelte';

  import {
    currentMessages, addMessage, loadMessages,
    activeChatId, updateMessage, deleteMessage
  } from '$lib/stores/chatStore';

  import { runGeneration } from '$lib/utils/chatApi';
  import * as m from '$lib/paraglide/messages';

  import ChatHeader        from './ChatHeader.svelte';
  import ChatInput         from './ChatInput.svelte';
  import ChatMessage       from './ChatMessage.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';
  import ErrorModal        from './ErrorModal.svelte';

  // ─── State ────────────────────────────────────────────────────────────────
  let inputText        = '';
  let chatContainer: HTMLDivElement;
  let autoscroll       = true;
  let isGenerating     = false;
  let isThinkingPhase  = false;
  let streamingText    = '';

  let lastMsgCount     = 0;
  let lastFirstMsgId   = '';

  let showErrorModal      = false;
  let errorMessage        = '';
  let pendingUserMessage  = '';

  // ─── Lifecycle ────────────────────────────────────────────────────────────
  onMount(async () => {
    if ($activeChatId) await loadMessages($activeChatId);
  });

  // ─── Derived display messages ─────────────────────────────────────────────
  $: displayMessages = (() => {
    const msgs = $currentMessages.map(msg => ({
      id: msg.id?.toString() || Math.random().toString(),
      text: msg.content,
      isUser: msg.role === 'user',
      senderName: msg.role === 'user'
        ? m.chat_sender_you()
        : ($activeCharacter?.name || m.chat_sender_ai()),
    }));

    if (isGenerating && !isThinkingPhase) {
      msgs.push({
        id: 'temp-stream',
        text: streamingText,
        isUser: false,
        senderName: $activeCharacter?.name || m.chat_sender_ai(),
      });
    }

    return msgs;
  })();

  $: firstAiMsgId = displayMessages.find(m => !m.isUser)?.id ?? null;

  $: lastAiMsgId = (() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i];
      if (!msg.isUser && msg.id !== 'temp-stream') return msg.id;
    }
    return null;
  })();

  $: if (displayMessages && chatContainer) handleAutoScroll();

  // ─── Scroll helpers ───────────────────────────────────────────────────────
  async function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    await tick();
    chatContainer?.scrollTo({ top: chatContainer.scrollHeight, behavior });
  }

  async function handleAutoScroll() {
    await tick();
    if (!chatContainer) return;

    const count = displayMessages.length;
    if (count === 0) { lastFirstMsgId = ''; lastMsgCount = 0; return; }

    const currentFirstId = displayMessages[0].id;
    if (currentFirstId !== lastFirstMsgId) scrollToBottom('auto');
    else if (count > lastMsgCount && autoscroll) scrollToBottom('smooth');

    lastMsgCount = count;
    lastFirstMsgId = currentFirstId;
  }

  function handleScroll() {
    if (!chatContainer) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainer;
    autoscroll = scrollHeight - scrollTop - clientHeight <= 50;
  }

  // ─── Generation ───────────────────────────────────────────────────────────
  function resetStreamState() {
    streamingText   = '';
    isThinkingPhase = false;
    autoscroll      = true;
  }

  async function generate(prompt: string, saveUserMessage: boolean) {
    isGenerating = true;
    resetStreamState();
    scrollToBottom();

    if (saveUserMessage) await addMessage('user', prompt);

    try {
      const result = await runGeneration(
        {
          character: $activeCharacter,
          apiSettings: $apiSettings,
          recentMessages: $currentMessages.slice(-10),
          userPrompt: saveUserMessage ? prompt : undefined,
        },
        {
          onStreamUpdate:      (text) => { streamingText   = text; if (autoscroll) scrollToBottom(); },
          onThinkingPhaseChange: (v)  => { isThinkingPhase = v; },
        }
      );

      await addMessage('assistant', result);
    } catch (err) {
      console.error(err);
      errorMessage   = m.chat_error_connection();
      showErrorModal = true;
    } finally {
      isGenerating    = false;
      streamingText   = '';
      isThinkingPhase = false;
      await tick();
      await scrollToBottom('auto');
    }
  }

  // ─── User actions ─────────────────────────────────────────────────────────
  async function sendMessage() {
    if (!inputText.trim() || isGenerating) return;
    const prompt  = inputText;
    inputText     = '';
    pendingUserMessage = prompt;
    await generate(prompt, true);
  }

  async function handleRetry(event: CustomEvent<{ msgId: string }>) {
    if (isGenerating) return;

    const { msgId } = event.detail;
    const msgs = $currentMessages;
    const idx  = msgs.findIndex(m => m.id?.toString() === msgId);
    if (idx < 0) return;

    let precedingUserMsg: typeof msgs[0] | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') { precedingUserMsg = msgs[i]; break; }
    }
    if (!precedingUserMsg) return;

    await deleteMessage(msgId);
    await tick();
    await generate(precedingUserMsg.content, false);
  }

  async function handleEditSave(event: CustomEvent<{ msgId: string; newContent: string }>) {
    await updateMessage(event.detail.msgId, event.detail.newContent);
  }

  async function retryAfterError() {
    showErrorModal = false;
    if (pendingUserMessage) await generate(pendingUserMessage, false);
  }

  async function closeErrorModal() {
    showErrorModal = false;
    if (pendingUserMessage) {
      const lastUserMsg = [...$currentMessages].reverse().find(m => m.role === 'user');
      if (lastUserMsg?.id) await deleteMessage(lastUserMsg.id);
    }
    pendingUserMessage = '';
  }

  async function stopGeneration() {
    await invoke('stop_generation');
  }
</script>

<div class="flex flex-col h-full font-sans overflow-hidden bg-ryokan-bg relative">

  <ChatHeader
    character={$activeCharacter}
    on:back={() => currentView.set('lobby')}
  />

  <!-- Messages -->
  <div
    bind:this={chatContainer}
    on:scroll={handleScroll}
    class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 pt-4 pb-4"
    style="overflow-anchor: none;"
  >
    <div class="max-w-3xl mx-auto w-full">
      {#each displayMessages as msg, i (msg.id)}
        <ChatMessage
          {msg}
          isLast={i === displayMessages.length - 1}
          isGenerating={isGenerating && i === displayMessages.length - 1}
          canRetry={!isGenerating && msg.id === lastAiMsgId && msg.id !== firstAiMsgId}
          canEdit={!msg.isUser && msg.id !== 'temp-stream' && msg.id !== firstAiMsgId}
          on:retry={handleRetry}
          on:editSave={handleEditSave}
        />
      {/each}

      {#if isGenerating && isThinkingPhase}
        <ThinkingIndicator />
      {/if}
    </div>
  </div>

  <ChatInput
    bind:value={inputText}
    {isGenerating}
    on:send={sendMessage}
    on:stop={stopGeneration}
  />

</div>

{#if showErrorModal}
  <ErrorModal
    message={errorMessage}
    pendingMessage={pendingUserMessage}
    on:retry={retryAfterError}
    on:close={closeErrorModal}
  />
{/if}