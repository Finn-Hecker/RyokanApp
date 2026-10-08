<script lang="ts">
  import { selectedUsage } from '$lib/ai/tokens/tokenUsage';
  import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
  import { invoke } from '@tauri-apps/api/core';
  import { snapshotTextRules } from '$lib/ai/prompt/textRules';
  import { appState, snapshotActiveApiConnection } from '$lib/stores/appState.svelte';
  import { registerBackHandler, returnTo } from '$lib/stores/navigation';
  import { tick, flushSync, onMount, onDestroy } from 'svelte';
  import { getCurrentWindow } from '@tauri-apps/api/window';
  import { chatState, addMessage, addSwipeVariant, loadMessages, updateMessage, deleteMessage, setSwipeIndex, loadMoreMessages, cloneChatFromMessage, type DisplayMessage } from '$lib/stores/chatStore.svelte';
  import { runGeneration, type GenerationOptions } from '$lib/ai/generation/chatApi';
  import { describeGenerationError, type GenerationErrorInfo } from '$lib/ai/generation/generationError';
  import { positionSentChatMessage } from '$lib/chat/chatScroll';
  import { summaryState, checkAndSummarizeIfNeeded, assertPreparedGenerationFits, rememberGenerationAnchor, cancelActiveSummary, SummaryCancelledError } from '$lib/ai/summary/rollingSummary.svelte';
  import * as m from '$lib/paraglide/messages';
  import ChatHeader from './ChatHeader.svelte';
  import ChatInput from './ChatInput.svelte';
  import ChatMessage from './ChatMessage.svelte';
  import ThinkingIndicator from './ThinkingIndicator.svelte';
  import ErrorModal from './ErrorModal.svelte';

  let inputText = $state('');
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
  let retryCancelled = false;
  let sendCancelled = false;
  let isLoadingMore = $state(false);
  let cloneCooldown = $state(false);
  let cloneCooldownTimer: ReturnType<typeof setTimeout> | undefined;
  let mobileActionMessageId = $state<string | null>(null);
  let composerHeight = $state(96);
  let activeEditMessageId = $state<string | null>(null);
  let draftBeforeEdit = '';
  let isSavingEdit = $state(false);

  let editingUserMessage = $derived(
    activeEditMessageId !== null && chatState.currentMessages.some(
      msg => msg.id?.toString() === activeEditMessageId && msg.role === 'user'
    )
  );

  let isBlocked = $derived(isGenerating || summaryState.isSummarizing);

  // The active conversation's own record — used to show a "cloned chat" badge.
  let activeConversation = $derived(
    chatState.conversations.find(c => c.id === chatState.activeChatId) ?? null
  );
  let clonedFromTitle = $derived(activeConversation?.cloned_from_title ?? null);

  let unlistenClose: (() => void) | undefined;
  let chatResizeObserver: ResizeObserver | undefined;
  let previousChatHeight = 0;
  let bottomGap = Number.POSITIVE_INFINITY;
  let chatReady = $state(false);

  // Only opening or switching conversations should move to the newest message.
  // Wait for the loaded history to reach the DOM before measuring its height.
  $effect(() => {
    const chatId = chatState.activeChatId;
    if (!chatReady || !chatId || !chatContainer) return;
    let cancelled = false;
    void tick().then(() => {
      if (cancelled || chatState.activeChatId !== chatId || !chatContainer) return;
      chatContainer.scrollTop = chatContainer.scrollHeight - chatContainer.clientHeight;
      measureBottomGap();
    });
    return () => { cancelled = true; };
  });

  function measureBottomGap() {
    if (!chatContainer) return;
    bottomGap = chatContainer.scrollHeight - chatContainer.clientHeight - chatContainer.scrollTop;
  }

  function handleChatResize() {
    if (!chatContainer) return;
    const height = chatContainer.clientHeight;
    // A resize changes the scroll viewport, not the user's chosen position.
    // Keep the last message visible when the conversation was already at its end.
    if (previousChatHeight && height !== previousChatHeight && bottomGap <= 48) {
      chatContainer.scrollTop = chatContainer.scrollHeight - height;
    }
    previousChatHeight = height;
    measureBottomGap();
  }

  function handleComposerResize(height: number) {
    if (height === composerHeight) return;
    measureBottomGap();
    const wasAtEnd = bottomGap <= 48;
    // Apply the new padding before restoring the end position. This only runs
    // for composer geometry changes, never for incoming text or streaming.
    flushSync(() => { composerHeight = height; });
    if (chatContainer && wasAtEnd) {
      chatContainer.scrollTop = chatContainer.scrollHeight - chatContainer.clientHeight;
    }
    measureBottomGap();
  }

  $effect(() => {
    if (!showErrorModal) return;
    return registerBackHandler(() => {
      void closeErrorModal();
      return true;
    });
  });


  onMount(async () => {
    // New/history navigation already loads this chat before mounting the room.
    if (chatState.activeChatId && chatState.currentMessages.length === 0) await loadMessages(chatState.activeChatId);
    await tick();
    if (chatContainer) {
      previousChatHeight = chatContainer.clientHeight;
      measureBottomGap();
      chatResizeObserver = new ResizeObserver(handleChatResize);
      chatResizeObserver.observe(chatContainer);
    }
    chatReady = true;

    const win = getCurrentWindow();
    unlistenClose = await win.onCloseRequested(async (event) => {
      event.preventDefault();
      await stopGeneration();
      await win.destroy();
    });

    window.addEventListener('keydown', handleArrowKey);
  });

  onDestroy(() => {
    retryCancelled = true;
    sendCancelled = true;
    if (isGenerating) {
      void cancelActiveSummary();
      if (activeGenerationId) {
        void invoke('stop_generation', { generationId: activeGenerationId });
      }
    }
    unlistenClose?.();
    chatResizeObserver?.disconnect();
    window.removeEventListener('keydown', handleArrowKey);
    if (cloneCooldownTimer) clearTimeout(cloneCooldownTimer);
  });

  function handleArrowKey(e: KeyboardEvent) {
    const tag = (e.target as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (e.target as HTMLElement)?.isContentEditable || isBlocked) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    if (e.shiftKey || e.ctrlKey || e.metaKey || e.altKey || !window.getSelection()?.isCollapsed) return;

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

  // Persisted rows do not depend on streaming state. Keep their display objects
  // stable while only the new reply (or the retried row) changes.
  let persistedDisplayMessages = $derived(chatState.currentMessages.map(msg => ({
    id: msg.id?.toString() || Math.random().toString(),
    text: msg.content,
    usage: selectedUsage(msg),
    isUser: msg.role === 'user',
    senderName: msg.role === 'user'
      ? (msg.author || m.chat_sender_you())
      : (appState.activeCharacter?.name || m.chat_sender_ai()),
    swipeVariants: msg.swipe_variants ?? [msg.content],
    swipeIndex: msg.swipe_index ?? 0,
  })));

  let displayMessages = $derived((() => {
    const msgs: DisplayMessage[] = isGenerating && retryingMsgId !== null
      ? persistedDisplayMessages.map(msg => msg.id === retryingMsgId ? {
          ...msg, text: streamingText, usage: null,
          swipeVariants: [...msg.swipeVariants, streamingText],
          swipeIndex: msg.swipeVariants.length,
        } : msg)
      : [...persistedDisplayMessages];

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
    measureBottomGap();
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
    sendCancelled = false;
    generationError = null;
    failedRetryMsgId = null;
    resetStreamState();

    if (saveUserMessage) {
      const existingMessageIds = new Set(
        chatState.currentMessages.map((message) => message.id?.toString()),
      );
      try {
        // addMessage inserts the local user row synchronously, then persists it.
        const saving = addMessage('user', prompt);
        const sentMessage = chatState.currentMessages.find(
          (message) => message.role === 'user'
            && message.id != null
            && !existingMessageIds.has(message.id.toString()),
        );
        await tick();
        if (sentMessage?.id != null && chatState.activeChatId === chatId && !sendCancelled) {
          positionSentChatMessage(chatContainer, sentMessage.id.toString());
        }
        await saving;
      } catch (err) {
        isGenerating = false;
        if (chatState.activeChatId !== chatId || sendCancelled) return;
        // Keep a newer draft intact; otherwise restore the failed send verbatim.
        if (!inputText) inputText = prompt;
        pendingUserMessage = '';
        errorMessage = describeGenerationError(err).message;
        showErrorModal = true;
        return;
      }
    }

    if (sendCancelled || chatState.activeChatId !== chatId) {
      isGenerating = false;
      return;
    }

    const generationOptions: GenerationOptions = {
      chatId,
      character:      appState.activeCharacter,
      apiSettings:    snapshotActiveApiConnection(),
      textRules: snapshotTextRules(appState.textRules),
      recentMessages: chatState.currentMessages,
      userPrompt:     undefined as string | undefined,
      shouldCancel: () => sendCancelled || chatState.activeChatId !== chatId,
    };

    try {
      const prepared = await checkAndSummarizeIfNeeded(chatId, generationOptions);
      if (sendCancelled || chatState.activeChatId !== chatId) throw new SummaryCancelledError();
      generationOptions.recentMessages = prepared.recentMessages;
      generationOptions.summaryMeta = prepared.summaryMeta;
      generationOptions.requestParameterConfig = prepared.requestParameterConfig;
      activeGenerationId = crypto.randomUUID();
      generationOptions.generationId = activeGenerationId;
      await assertPreparedGenerationFits(generationOptions);
      if (sendCancelled || chatState.activeChatId !== chatId) throw new SummaryCancelledError();
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
      pendingUserMessage = '';
    } catch (err) {
      if (err instanceof SummaryCancelledError || sendCancelled) return;
      reportDiagnostic('chat');
      generationError = describeGenerationError(err);
    } finally {
      isGenerating = false;
      streamingText = '';
      isThinkingPhase = false;
      activeGenerationId = null;
    }
  }

  async function sendMessage() {
    if (!inputText.trim() || isBlocked || isSavingEdit) return;
    if (editingUserMessage && activeEditMessageId) {
      const msgId = activeEditMessageId;
      const editedText = inputText;
      const newContent = editedText.trim();
      const previousDraft = draftBeforeEdit;
      isSavingEdit = true;
      activeEditMessageId = null;
      inputText = '';
      try {
        const saved = await handleEditSave({ msgId, newContent });
        if (saved) {
          if (!inputText) inputText = previousDraft;
          draftBeforeEdit = '';
        } else {
          activeEditMessageId = msgId;
          inputText = editedText;
        }
      } finally {
        isSavingEdit = false;
      }
      return;
    }
    if (activeEditMessageId) handleEditCancel();
    const rawPrompt = inputText;
    inputText = '';

    pendingUserMessage = rawPrompt;
    await generate(rawPrompt, true);
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

    const chatId = chatState.activeChatId;
    if (!chatId) return;
    retryCancelled = false;
    const generationId = crypto.randomUUID();
    activeGenerationId = generationId;
    retryingMsgId = msgId;
    isGenerating = true;
    generationError = null;
    failedRetryMsgId = null;
    resetStreamState();
    try {
      const generationOptions: GenerationOptions = {
        chatId,
        character: appState.activeCharacter,
        apiSettings: snapshotActiveApiConnection(),
        textRules: snapshotTextRules(appState.textRules),
        recentMessages: msgs.slice(0, idx),
        userPrompt: undefined,
        generationId,
        shouldCancel: () => retryCancelled,
      };
      const prepared = await checkAndSummarizeIfNeeded(chatId, generationOptions, msgId);
      if (retryCancelled || chatState.activeChatId !== chatId) throw new SummaryCancelledError();
      generationOptions.recentMessages = prepared.recentMessages;
      generationOptions.summaryMeta = prepared.summaryMeta;
      generationOptions.requestParameterConfig = prepared.requestParameterConfig;
      await assertPreparedGenerationFits(generationOptions);
      if (retryCancelled || chatState.activeChatId !== chatId) throw new SummaryCancelledError();
      const result = await runGeneration(
        generationOptions,
        {
          onStreamUpdate: (text) => { streamingText = text; },
          onThinkingPhaseChange: (v) => { isThinkingPhase = v; },
        }
      );
      if (retryCancelled || chatState.activeChatId !== chatId || !result.text) return;
      await addSwipeVariant(msgId, result.text, result.usage);
      rememberGenerationAnchor(
        chatId,
        result.promptSnapshot,
        chatState.currentMessages.at(-1)?.id === msgId
          ? chatState.currentMessages.at(-1)
          : undefined,
      );
    } catch (err) {
      if (retryCancelled || err instanceof SummaryCancelledError) return;
      reportDiagnostic('chat');
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

  function handleEditOpen({ msgId, isUser, content }: { msgId: string; isUser: boolean; content: string }) {
    if (isBlocked || isSavingEdit) return;
    if (editingUserMessage) inputText = draftBeforeEdit;
    flushSync(() => {
      activeEditMessageId = msgId;
      if (isUser) {
        draftBeforeEdit = inputText;
        inputText = content;
      }
    });
    if (isUser) {
      const input = document.getElementById('chat-input-textarea') as HTMLTextAreaElement | null;
      input?.focus();
      input?.setSelectionRange(input.value.length, input.value.length);
      input?.dispatchEvent(new Event('input'));
    }
  }

  function handleEditCancel() {
    if (editingUserMessage) inputText = draftBeforeEdit;
    activeEditMessageId = null;
    draftBeforeEdit = '';
  }

  async function handleEditSave({ msgId, newContent }: { msgId: string; newContent: string }): Promise<boolean> {
    const msgs = chatState.currentMessages;
    const idx  = msgs.findIndex(msg => msg.id?.toString() === msgId);
    if (idx < 0) return false;

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
      return true;
    } catch {
      // Store operations already log their concrete persistence error. Most
      // importantly, do not continue deleting/regenerating after invalidation fails.
      return false;
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
    handleEditCancel();
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
    pendingUserMessage = '';
  }

  async function stopGeneration() {
    sendCancelled = true;
    if (retryingMsgId) retryCancelled = true;
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
      handleEditCancel();
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
    class="chat-scroll chat-content flex-1 min-h-0 overflow-y-auto px-4 sm:px-8 pt-4"
    style:--chat-font-scale={appState.chatFontScale / 100}
    style:padding-bottom={`${composerHeight + 16}px`}
    style="overflow-anchor: none; overscroll-behavior: contain;"
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
          {activeEditMessageId}
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
          onEditOpen={handleEditOpen}
          onEditCancel={handleEditCancel}
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
    interactionMode={appState.interactionMode}
    isGenerating={isBlocked}
    isSummarizing={summaryState.isSummarizing}
    isEditing={editingUserMessage}
    isSavingEdit={isSavingEdit}
    onSend={sendMessage}
    onCancelEdit={handleEditCancel}
    onStop={stopGeneration}
    onResize={handleComposerResize}
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

<style>
  .chat-scroll {
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .chat-scroll::-webkit-scrollbar {
    display: none;
  }

</style>
