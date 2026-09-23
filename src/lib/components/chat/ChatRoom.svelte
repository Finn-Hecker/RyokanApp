<script lang="ts">
  import { invoke } from '@tauri-apps/api/core';
  import { appState, snapshotActiveApiConnection } from '$lib/stores/appState.svelte';
  import { registerBackHandler, returnTo } from '$lib/stores/navigation';
  import { tick, onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { chatState, addMessage, addSwipeVariant, loadMessages, updateMessage, deleteMessage, setSwipeIndex, loadMoreMessages, cloneChatFromMessage, type DisplayMessage } from '$lib/stores/chatStore.svelte';
  import { runGeneration, type GenerationOptions } from '$lib/utils/chatApi';
  import { describeGenerationError, type GenerationErrorInfo } from '$lib/utils/generationError';
  import { positionSentChatMessage } from '$lib/utils/chatScroll';
  import { summaryState, checkAndSummarizeIfNeeded, assertPreparedGenerationFits, rememberGenerationAnchor, cancelActiveSummary, SummaryCancelledError } from '$lib/utils/rollingSummary.svelte';
  import * as m from '$lib/paraglide/messages';
  import ChatHeader from './ChatHeader.svelte';
  import ChatInput from './ChatInput.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';
  import ErrorModal from './ErrorModal.svelte';

  let inputText = $state('');
  let isOOC = $state(false);
  let chatContainer = $state<HTMLDivElement | null>(null);
  let isGenerating = $state(false);
  let isThinkingPhase = $state(false);
  let streamingText = $state('');
  let showErrorModal = $state(false);
  let errorMessage = $state('');
  let pendingUserMessage = $state('');
  let retryingMsgId = $state<string | null>(null);
  let generationError = $state<GenerationErrorInfo | null>(null);
  let failedRetryMsgId = $state<string | null>(null);
  let activeGenerationId = $state<string | null>(null);
  let isLoadingMore = $state(false);
  let cloneCooldown = $state(false);
  let cloneCooldownTimer: ReturnType<typeof setTimeout> | undefined;
  let mobileActionMessageId = $state<string | null>(null);

  let isBlocked = $derived(isGenerating || summaryState.isSummarizing);

  // The active conversation's own record — used to show a "cloned chat" badge.
  let activeConversation = $derived(
    chatState.conversations.find(c => c.id === chatState.activeChatId) ?? null
  );
  let clonedFromTitle = $derived(activeConversation?.cloned_from_title ?? null);

  let unlistenClose: (() => void) | undefined;

  $effect(() => {
    if (!showErrorModal) return;
    return registerBackHandler(() => {
      void closeErrorModal();
      return true;
    });
  });

  $effect(() => {
    if (!mobileActionMessageId) return;
    return registerBackHandler(() => {
      mobileActionMessageId = null;
      return true;
    });
  });

  onMount(async () => {
    if (chatState.activeChatId) await loadMessages(chatState.activeChatId);

    const win = getCurrentWindow();
    unlistenClose = await win.onCloseRequested(async (event) => {
      event.preventDefault();
      await stopGeneration();
      await win.destroy();
    });

    window.addEventListener('keydown', handleArrowKey);
  });

  onDestroy(() => {
    if (isGenerating) {
      void cancelActiveSummary();
      if (activeGenerationId) {
        void invoke('stop_generation', { generationId: activeGenerationId });
      }
    }
    unlistenClose?.();
    window.removeEventListener('keydown', handleArrowKey);
    if (cloneCooldownTimer) clearTimeout(cloneCooldownTimer);
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
      if (currentIndex > 0) {
        void setSwipeIndex(msgId, currentIndex - 1).catch(() => undefined);
      }
    } else {
      if (currentIndex < totalVariants - 1) {
        void setSwipeIndex(msgId, currentIndex + 1).catch(() => undefined);
      } else {
        handleRetry({ msgId });
      }
    }
  }

  let displayMessages = $derived((() => {
    const msgs: DisplayMessage[] = chatState.currentMessages.map(msg => {
      const isBeingRetried = isGenerating && retryingMsgId !== null && msg.id?.toString() === retryingMsgId;
      return {
        id: msg.id?.toString() || Math.random().toString(),
        text: isBeingRetried && streamingText ? streamingText : msg.content,
        isUser: msg.role === 'user',
        senderName: msg.role === 'user'
          ? (msg.author || m.chat_sender_you())
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

    if (generationError) {
      msgs.push({
        id: 'temp-generation-error', text: '', isUser: false,
        senderName: appState.activeCharacter?.name || m.chat_sender_ai(),
        swipeVariants: [''], swipeIndex: 0, generationError,
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

  async function handleScroll() {
    if (!chatContainer) return;
    const { scrollTop, scrollHeight } = chatContainer;

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
    const chatId = chatState.activeChatId;
    if (!chatId) return;
    isGenerating = true;
    generationError = null;
    failedRetryMsgId = null;
    resetStreamState();

    if (saveUserMessage) {
      const existingMessageIds = new Set(
        chatState.currentMessages.map((message) => message.id?.toString()),
      );
      await addMessage('user', prompt);

      const sentMessage = chatState.currentMessages.find(
        (message) => message.role === 'user'
          && message.id != null
          && !existingMessageIds.has(message.id.toString()),
      );
      if (sentMessage?.id != null) {
        await tick();
        positionSentChatMessage(chatContainer, sentMessage.id.toString());
      }
    }

    const generationOptions: GenerationOptions = {
      character:      appState.activeCharacter,
      apiSettings:    snapshotActiveApiConnection(),
      recentMessages: chatState.currentMessages,
      userPrompt:     undefined as string | undefined,
    };

    try {
      const prepared = await checkAndSummarizeIfNeeded(chatId, generationOptions);
      if (chatState.activeChatId !== chatId) throw new SummaryCancelledError();
      generationOptions.recentMessages = prepared.recentMessages;
      generationOptions.summaryMeta = prepared.summaryMeta;
      generationOptions.requestParameterConfig = prepared.requestParameterConfig;
      activeGenerationId = crypto.randomUUID();
      generationOptions.generationId = activeGenerationId;
      await assertPreparedGenerationFits(generationOptions);
      const result = await runGeneration(
        generationOptions,
        {
          onStreamUpdate: (text) => { streamingText = text; },
          onThinkingPhaseChange: (v) => { isThinkingPhase = v; },
        }
      );
      if (chatState.activeChatId !== chatId) return;
      await addMessage('assistant', result.text, result.usage);
      rememberGenerationAnchor(chatId, result.promptSnapshot, chatState.currentMessages.at(-1));
    } catch (err) {
      if (err instanceof SummaryCancelledError) return;
      console.error(err);
      generationError = describeGenerationError(err);
    } finally {
      isGenerating = false;
      streamingText = '';
      isThinkingPhase = false;
      activeGenerationId = null;
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || isBlocked) return;
    const rawPrompt = inputText;
    inputText = '';

    const prompt = isOOC ? `[OOC: ${rawPrompt}]` : rawPrompt;
    isOOC = false;

    pendingUserMessage = prompt;
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
    generationError = null;
    failedRetryMsgId = null;
    resetStreamState();
    const chatId = chatState.activeChatId;
    if (!chatId) return;

    try {
      const generationOptions: GenerationOptions = {
        character: appState.activeCharacter,
        apiSettings: snapshotActiveApiConnection(),
        recentMessages: msgs.slice(0, idx),
        userPrompt: undefined,
        generationId: crypto.randomUUID(),
      };
      const prepared = await checkAndSummarizeIfNeeded(chatId, generationOptions, msgId);
      if (chatState.activeChatId !== chatId) throw new SummaryCancelledError();
      generationOptions.recentMessages = prepared.recentMessages;
      generationOptions.summaryMeta = prepared.summaryMeta;
      generationOptions.requestParameterConfig = prepared.requestParameterConfig;
      activeGenerationId = generationOptions.generationId ?? null;
      await assertPreparedGenerationFits(generationOptions);
      const result = await runGeneration(
        generationOptions,
        {
          onStreamUpdate: (text) => { streamingText = text; },
          onThinkingPhaseChange: (v) => { isThinkingPhase = v; },
        }
      );
      if (chatState.activeChatId !== chatId) return;
      await addSwipeVariant(msgId, result.text, result.usage);
      rememberGenerationAnchor(
        chatId,
        result.promptSnapshot,
        chatState.currentMessages.at(-1)?.id === msgId
          ? chatState.currentMessages.at(-1)
          : undefined,
      );
    } catch (err) {
      if (err instanceof SummaryCancelledError) return;
      console.error(err);
      generationError = describeGenerationError(err);
      failedRetryMsgId = msgId;
    } finally {
      retryingMsgId = null;
      isGenerating = false;
      streamingText = '';
      isThinkingPhase = false;
      activeGenerationId = null;
    }
  }

  async function handleEditSave({ msgId, newContent }: { msgId: string; newContent: string }) {
    const msgs = chatState.currentMessages;
    const idx  = msgs.findIndex(msg => msg.id?.toString() === msgId);
    if (idx < 0) return;

    const editedMsg = msgs[idx];

    try {
      if (editedMsg.role === 'user') {
        await updateMessage(msgId, newContent);

        // Delete every message that came after it (the AI reply and any further turns)
        const toDelete = msgs.slice(idx + 1);
        for (const msg of toDelete) {
          if (msg.id) await deleteMessage(msg.id);
        }

        // history is already up-to-date in chatState after the deletes
        pendingUserMessage = newContent;
        await generate(newContent, false);
      } else {
        await updateMessage(msgId, newContent);
      }
    } catch {
      // Store operations already log their concrete persistence error. Most
      // importantly, do not continue deleting/regenerating after invalidation fails.
    }
  }

  async function handleCloneFromMessage({ msgId }: { msgId: string }) {
    if (isBlocked || cloneCooldown) return;

    cloneCooldown = true;
    if (cloneCooldownTimer) clearTimeout(cloneCooldownTimer);
    cloneCooldownTimer = setTimeout(() => { cloneCooldown = false; }, 5000);

    const newChatId = await cloneChatFromMessage(msgId);
    if (!newChatId) {
      errorMessage = m.chat_clone_error();
      showErrorModal = true;
      return;
    }

    // Jump straight into the freshly cloned chat.
    await loadMessages(newChatId);
  }

  async function retryAfterError() {
    showErrorModal = false;
    if (pendingUserMessage) await generate(pendingUserMessage, false);
  }

  function showMobileActions(msgId: string) {
    mobileActionMessageId = msgId;
  }

  function closeMobileActions() {
    mobileActionMessageId = null;
  }

  async function retryGenerationError() {
    const msgId = failedRetryMsgId;
    generationError = null;
    if (msgId) await handleRetry({ msgId });
    else if (pendingUserMessage) await generate(pendingUserMessage, false);
  }

  async function dismissGenerationError() {
    generationError = null;
    failedRetryMsgId = null;
  }

  async function closeErrorModal() {
    showErrorModal = false;
    if (pendingUserMessage) {
      const lastUserMsg = [...chatState.currentMessages].reverse().find(msg => msg.role === 'user');
      if (lastUserMsg?.id) {
        try {
          await deleteMessage(lastUserMsg.id);
        } catch {
          return;
        }
      }
    }
    pendingUserMessage = '';
  }

  async function stopGeneration() {
    if (await cancelActiveSummary(chatState.activeChatId ?? undefined)) return;
    if (activeGenerationId) {
      await invoke('stop_generation', { generationId: activeGenerationId });
    }
  }
</script>

<div class="flex flex-col h-full overflow-hidden bg-ryokan-bg relative">

  <ChatHeader
    character={appState.activeCharacter}
    isTyping={isGenerating}
    {clonedFromTitle}
    onBack={() => {
      chatState.activeChatId = null;
      chatState.currentMessages = [];
      chatState.hasMoreMessages = false;
      appState.activeCharacter = null;
      returnTo('lobby');
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
          canCloneFrom={!isBlocked && !msg.isUser && msg.id !== 'temp-stream'}
          cloneDisabled={cloneCooldown}
          interactionMode={appState.interactionMode}
          mobileActionsOpen={mobileActionMessageId === msg.id}
          onMobileActionsOpen={showMobileActions}
          onMobileActionsClose={closeMobileActions}
          onRetry={handleRetry}
          onGenerationRetry={retryGenerationError}
          onGenerationDismiss={dismissGenerationError}
          onEditSave={handleEditSave}
          onCloneFrom={handleCloneFromMessage}
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
