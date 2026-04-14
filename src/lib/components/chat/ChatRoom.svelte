<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { appState } from '$lib/stores/appState.svelte';
  import { tick, onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { roleState } from '$lib/stores/roleStore.svelte';
  import { chatState, addMessage, addSwipeVariant, loadMessages, updateMessage, deleteMessage, setSwipeIndex, loadMoreMessages } from '$lib/stores/chatStore.svelte';
  import { runGeneration } from '$lib/utils/chatApi';
  import { summaryState, checkAndSummarizeIfNeeded } from '$lib/utils/rollingSummary.svelte';
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
  let retryingMsgId = $state<string | null>(null);
  let isLoadingMore = $state(false);

  let isBlocked = $derived(isGenerating || summaryState.isSummarizing);

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

    window.addEventListener('keydown', handleArrowKey);
  });

  onDestroy(() => {
    if (isGenerating) invoke('stop_generation');
    unlistenClose?.();
    window.removeEventListener('keydown', handleArrowKey);
  });

  function handleArrowKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || isBlocked) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

    e.preventDefault();

    const firstAiMsg = chatState.currentMessages.find(msg => msg.role === 'assistant');
    const lastAiMsg  = [...chatState.currentMessages].reverse().find(msg => msg.role === 'assistant');

    if (!lastAiMsg?.id || lastAiMsg.id === firstAiMsg?.id) return;

    const msgId        = lastAiMsg.id.toString();
    const totalVariants = lastAiMsg.swipe_variants?.length ?? 1;
    const currentIndex  = lastAiMsg.swipe_index ?? 0;

    if (e.key === 'ArrowLeft') {
      if (currentIndex > 0) setSwipeIndex(msgId, currentIndex - 1);
    } else {
      if (currentIndex < totalVariants - 1) {
        setSwipeIndex(msgId, currentIndex + 1);
      } else {
        handleRetry({ msgId });
      }
    }
  }

  let displayMessages = $derived((() => {
    const msgs = chatState.currentMessages.map(msg => {
      const isBeingRetried = isGenerating && retryingMsgId !== null && msg.id?.toString() === retryingMsgId;
      return {
        id: msg.id?.toString() || Math.random().toString(),
        text: isBeingRetried && streamingText ? streamingText : msg.content,
        isUser: msg.role === 'user',
        senderName: msg.role === 'user'
          ? m.chat_sender_you()
          : (appState.activeCharacter?.name || m.chat_sender_ai()),
        swipeVariants: msg.swipe_variants ?? [msg.content],
        swipeIndex: msg.swipe_index ?? 0,
      };
    });

    if (isGenerating && !isThinkingPhase && !retryingMsgId) {
      msgs.push({
        id: 'temp-stream',
        text: streamingText,
        isUser: false,
        senderName: appState.activeCharacter?.name || m.chat_sender_ai(),
        swipeVariants: [streamingText],
        swipeIndex: 0,
      });
    }

    return msgs;
  })());

  let firstAiMsgId = $derived(displayMessages.find(msg => !msg.isUser)?.id ?? null);

  let lastAiMsgId = $derived((() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i];
      if (!msg.isUser && msg.id !== 'temp-stream') return msg.id;
    }
    return null;
  })());

  let lastUserMsgId = $derived((() => {
    for (let i = displayMessages.length - 1; i >= 0; i--) {
      const msg = displayMessages[i];
      if (msg.isUser) return msg.id;
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
    if (count === 0) { 
      lastFirstMsgId = ''; 
      lastMsgCount = 0; 
      return; 
    }

    const currentFirstId = displayMessages[0].id;
    const currentLastId = displayMessages[count - 1].id;

    // CASE 1: The chat was just loaded (initial switch)
    // We check whether the activeChatId changed or if we don't have any previous message state
    if (lastFirstMsgId === '') {
      scrollToBottom('auto');
    } 
    // CASE 2: A NEW message was added at the bottom
    else if (count > lastMsgCount && autoscroll) {
      // We no longer rely on firstId comparison here, instead we trust 'autoscroll'
      // which is calculated in handleScroll() (user is near the bottom)
      scrollToBottom('smooth');
    }

    lastMsgCount = count;
    lastFirstMsgId = currentFirstId;
  }

  async function handleScroll() {
    if (!chatContainer || isProgrammaticScroll) return;
    const { scrollTop, scrollHeight, clientHeight } = chatContainer;
    autoscroll = scrollHeight - scrollTop - clientHeight <= 50;

    // INFINITE SCROLL: Load more when we're near the top (< 100px)
    if (scrollTop < 100 && chatState.hasMoreMessages && !isLoadingMore) {
      isLoadingMore = true;
      
      // Store the exact height and scroll position BEFORE loading
      const oldScrollHeight = scrollHeight;
      const oldScrollTop = scrollTop;

      await loadMoreMessages();
      
      // Important: wait until Svelte has rendered the new messages into the DOM
      await tick();

      if (chatContainer) {
        // Calculate the difference between old and new height and adjust
        // the scroll position by that amount so the view stays stable
        const newScrollHeight = chatContainer.scrollHeight;
        chatContainer.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
      }
      
      isLoadingMore = false;
    }
  }

  function resetStreamState() {
    streamingText = '';
    isThinkingPhase = false;
  }

  async function generate(prompt: string, saveUserMessage: boolean) {
    isGenerating = true;
    resetStreamState();
    if (autoscroll) scrollToBottom();

    if (saveUserMessage) await addMessage('user', prompt);

    const generationOptions = {
      character:      appState.activeCharacter,
      apiSettings:    appState.apiSettings,
      recentMessages: chatState.currentMessages,
      userPrompt:     undefined as string | undefined,
      role: activeRole ? {
        name:      activeRole.name,
        bio:       activeRole.bio,
        pronouns:  activeRole.pronouns
      } : null,
    };

    await checkAndSummarizeIfNeeded(chatState.currentMessages, generationOptions);

    generationOptions.recentMessages = chatState.currentMessages;

    try {
      const result = await runGeneration(
        generationOptions,
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
    if (!inputText.trim() || isBlocked) return;
    const rawPrompt = inputText;
    inputText = '';

    const prompt = isOOC ? `[OOC: ${rawPrompt}]` : rawPrompt;
    isOOC = false;

    pendingUserMessage = prompt;
    autoscroll = true;
    await generate(prompt, true);
  }

  async function handleRetry({ msgId }: { msgId: string }) {
    if (isBlocked) return;

    const msgs = chatState.currentMessages;
    const idx = msgs.findIndex(msg => msg.id?.toString() === msgId);
    if (idx < 0) return;

    let precedingUserMsg: typeof msgs[0] | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (msgs[i].role === 'user') {
        precedingUserMsg = msgs[i];
        break;
      }
    }
    if (!precedingUserMsg) return;

    retryingMsgId = msgId;
    isGenerating = true;
    resetStreamState();
    if (autoscroll) scrollToBottom();

    const historySlice = msgs.slice(0, idx);

    try {
      const result = await runGeneration(
        {
          character: appState.activeCharacter,
          apiSettings: appState.apiSettings,
          recentMessages: historySlice,
          userPrompt: undefined,
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
      await addSwipeVariant(msgId, result);
    } catch (err) {
      console.error(err);
      errorMessage = m.chat_error_connection();
      showErrorModal = true;
    } finally {
      retryingMsgId = null;
      isGenerating = false;
      streamingText = '';
      isThinkingPhase = false;
      await tick();
      if (autoscroll) await scrollToBottom('auto');
    }
  }

  async function handleEditSave({ msgId, newContent }: { msgId: string; newContent: string }) {
    const msgs = chatState.currentMessages;
    const idx  = msgs.findIndex(msg => msg.id?.toString() === msgId);
    if (idx < 0) return;

    const editedMsg = msgs[idx];

    if (editedMsg.role === 'user') {
      await updateMessage(msgId, newContent);

      // Delete every message that came after it (the AI reply and any further turns)
      const toDelete = msgs.slice(idx + 1);
      for (const msg of toDelete) {
        if (msg.id) await deleteMessage(msg.id);
      }

      // history is already up-to-date in chatState after the deletes
      autoscroll = true;
      pendingUserMessage = newContent;
      await generate(newContent, false);
    } else {
      await updateMessage(msgId, newContent);
    }
  }

  async function retryAfterError() {
    showErrorModal = false;
    if (pendingUserMessage) await generate(pendingUserMessage, false);
  }

  async function closeErrorModal() {
    showErrorModal = false;
    if (pendingUserMessage) {
      const lastUserMsg = [...chatState.currentMessages].reverse().find(msg => msg.role === 'user');
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
      chatState.activeChatId = null;
      chatState.currentMessages = [];
      chatState.hasMoreMessages = false;
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
      {#if isLoadingMore}
        <div class="flex justify-center py-6 opacity-70">
          <span class="breathe-dots" aria-label="Lade ältere Nachrichten…">
            <span class="breathe-dot"></span>
            <span class="breathe-dot" style="animation-delay: 0.22s"></span>
            <span class="breathe-dot" style="animation-delay: 0.44s"></span>
          </span>
        </div>
      {/if}

      {#each displayMessages as msg, i (msg.id)}
        <ChatMessage
          {msg}
          character={appState.activeCharacter}
          isLast={i === displayMessages.length - 1}
          isGenerating={isGenerating && (
            (retryingMsgId !== null && msg.id === retryingMsgId) ||
            (retryingMsgId === null && i === displayMessages.length - 1)
          )}
          canSwipe={!isBlocked && !msg.isUser && msg.id === lastAiMsgId && msg.id !== firstAiMsgId}
          canRetry={!isBlocked && !msg.isUser && msg.id === lastAiMsgId && msg.id !== firstAiMsgId}
          canEdit={!isBlocked && msg.id !== 'temp-stream' && (
            msg.isUser
              ? msg.id === lastUserMsgId
              : msg.id !== firstAiMsgId
          )}
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
    isGenerating={isBlocked}
    isSummarizing={summaryState.isSummarizing}
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