<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { appState } from '$lib/stores/appState.svelte';
  import { tick, onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { roleState } from '$lib/stores/roleStore.svelte';
  import { chatState, addMessage, loadMessages, updateMessage, deleteMessage} from '$lib/stores/chatStore.svelte';
  import { runGeneration } from '$lib/utils/chatApi';
  import * as m from '$lib/paraglide/messages';
  import ChatHeader from './ChatHeader.svelte';
  import ChatInput from './ChatInput.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';
  import ErrorModal from './ErrorModal.svelte';

  let inputText = $state('');
  let isOOC = $state(false);
  let chatContainer = $state<HTMLDivElement | null>(null);
  let autoscroll = $state(true);
  let isProgrammaticScroll = $state(false);
  let isGenerating = $state(false);
  let isThinkingPhase = $state(false);
  let streamingText = $state('');
  let lastMsgCount = $state(0);
  let lastFirstMsgId = $state('');
  let showErrorModal = $state(false);
  let errorMessage = $state('');
  let pendingUserMessage = $state('');

  let activeRole = $derived(
    roleState.allRoles.find(p => p.id === roleState.activeRoleId) ?? null
  );

  let unlistenClose: (() => void) | undefined;

  onMount(async () => {
    if (chatState.activeChatId) await loadMessages(chatState.activeChatId);

    const win = getCurrentWindow();
    unlistenClose = await win.onCloseRequested(async (event) => {
      event.preventDefault();
      await invoke('stop_generation');
      await win.destroy();
    });
  });

  onDestroy(() => {
    if (isGenerating) invoke('stop_generation');
    unlistenClose?.();
  });

  let displayMessages = $derived((() => {
    const msgs = chatState.currentMessages.map(msg => ({
      id: msg.id?.toString() || Math.random().toString(),
      text: msg.content,
      isUser: msg.role === 'user',
      senderName: msg.role === 'user'
        ? m.chat_sender_you()
        : (appState.activeCharacter?.name || m.chat_sender_ai()),
    }));

    if (isGenerating && !isThinkingPhase) {
      msgs.push({
        id: 'temp-stream',
        text: streamingText,
        isUser: false,
        senderName: appState.activeCharacter?.name || m.chat_sender_ai(),
      });
    }

    return msgs;
  })());

  let firstAiMsgId = $derived(displayMessages.find(m => !m.isUser)?.id ?? null);

  let lastAiMsgId = $derived((() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i];
      if (!msg.isUser && msg.id !== 'temp-stream') return msg.id;
    }
    return null;
  })());

  $effect(() => {
    if (displayMessages && chatContainer) {
      handleAutoScroll();
    }
  });

  async function scrollToBottom(behavior: ScrollBehavior = 'smooth') {
    await tick();
    if (!chatContainer) return;
    isProgrammaticScroll = true;
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior });
    setTimeout(() => { isProgrammaticScroll = false; }, 100);
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
    if (!chatContainer || isProgrammaticScroll) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainer;
    autoscroll = scrollHeight - scrollTop - clientHeight <= 50;
  }

  function resetStreamState() {
    streamingText = '';
    isThinkingPhase = false;
  }

  async function generate(prompt: string, saveUserMessage: boolean) {
    isGenerating = true;
    resetStreamState();
    if (autoscroll) scrollToBottom();

    const messagesForApi = chatState.currentMessages.slice(-20);

    if (saveUserMessage) await addMessage('user', prompt);
    try {
      const result = await runGeneration(
        {
          character: appState.activeCharacter,
          apiSettings: appState.apiSettings,
          recentMessages: messagesForApi,
          userPrompt: saveUserMessage ? prompt : undefined,
          role: activeRole ? {
            name: activeRole.name,
            bio: activeRole.bio,
            pronouns: activeRole.pronouns
          } : null,
        },
        {
          onStreamUpdate:
            (text) => { streamingText = text; if (autoscroll) scrollToBottom(); },
          onThinkingPhaseChange: (v) => { isThinkingPhase = v; },
        }
      );
      await addMessage('assistant', result);
    } catch (err) {
      console.error(err);
      errorMessage = m.chat_error_connection();
      showErrorModal = true;
    } finally {
      isGenerating = false;
      streamingText = '';
      isThinkingPhase = false;
      await tick();
      if (autoscroll) await scrollToBottom('auto');
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || isGenerating) return;
    const rawPrompt = inputText;
    inputText = '';

    const prompt = isOOC ? `[OOC: ${rawPrompt}]` : rawPrompt;
    isOOC = false;

    pendingUserMessage = prompt;
    autoscroll = true;
    await generate(prompt, true);
  }

  async function handleRetry({ msgId }: { msgId: string }) {
    if (isGenerating) return;
    const msgs = chatState.currentMessages;
    const idx = msgs.findIndex(m => m.id?.toString() === msgId);
    if (idx < 0) return;

    let precedingUserMsg: typeof msgs[0] | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        precedingUserMsg = msgs[i];
        break;
      }
    }
    if (!precedingUserMsg) return;

    await deleteMessage(msgId);
    await tick();
    await generate(precedingUserMsg.content, false);
  }

  async function handleEditSave({ msgId, newContent }: { msgId: string; newContent: string }) {
    await updateMessage(msgId, newContent);
  }

  async function retryAfterError() {
    showErrorModal = false;
    if (pendingUserMessage) await generate(pendingUserMessage, false);
  }

  async function closeErrorModal() {
    showErrorModal = false;
    if (pendingUserMessage) {
      const lastUserMsg = [...chatState.currentMessages].reverse().find(m => m.role === 'user');
      if (lastUserMsg?.id) await deleteMessage(lastUserMsg.id);
    }
    pendingUserMessage = '';
  }

  async function stopGeneration() {
    await invoke('stop_generation');
  }
</script>

<div class="flex flex-col h-full overflow-hidden bg-ryokan-bg relative">

  <ChatHeader
    character={appState.activeCharacter}
    isTyping={isGenerating}
    onBack={() => {
      appState.activeCharacter = null; 
      appState.currentView = 'lobby';
    }}
  />

  <div
    bind:this={chatContainer}
    onscroll={handleScroll}
    class="flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 pt-4 pb-4"
    style="overflow-anchor: none;"
  >
    <div class="max-w-3xl mx-auto w-full">
      {#each displayMessages as msg, i (msg.id)}
        <ChatMessage
          {msg}
          character={appState.activeCharacter}
          isLast={i === displayMessages.length - 1}
          isGenerating={isGenerating && i === displayMessages.length - 1}
          canRetry={!isGenerating && msg.id === lastAiMsgId && msg.id !== firstAiMsgId}
          canEdit={!msg.isUser && msg.id !== 'temp-stream' && msg.id !== firstAiMsgId}
          onRetry={handleRetry}
          onEditSave={handleEditSave}
        />
      {/each}

      {#if isGenerating && isThinkingPhase}
        <ThinkingIndicator character={appState.activeCharacter} />
      {/if}
    </div>
  </div>

  <ChatInput
    bind:value={inputText}
    bind:isOOC
    {isGenerating}
    onSend={sendMessage}
    onStop={stopGeneration}
  />

</div>

{#if showErrorModal}
  <ErrorModal
    message={errorMessage}
    pendingMessage={pendingUserMessage}
    onRetry={retryAfterError}
    onClose={closeErrorModal}
  />
{/if}