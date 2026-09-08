<script lang="ts">
  import { tick } from 'svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import { loadAllConversations } from '$lib/stores/chatStore.svelte';
  import { positionSentChatMessage } from '$lib/utils/chatScroll';
  import {
    mpState,
    enterRoom,
    leaveRoom,
    sendChat,
    requestGeneration,
    abortGeneration,
    setPolicy,
    prepareResume,
  } from '$lib/stores/multiplayer.svelte';
  import * as m from '$lib/paraglide/messages';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  let nameInput = $state('');
  let chatInput = $state('');
  let copied = $state(false);
  let roomMenuOpen = $state(false);
  let messagesEl = $state<HTMLDivElement | null>(null);
  let loadedSessionId = '';

  const locked = $derived(mpState.lockedBy !== null);
  const inMultiplayerChat = $derived(mpState.connected || mpState.viewingHistory);
  const canGenerate = $derived(
    mpState.connected && !mpState.viewingHistory && !locked && (mpState.role === 'host' || mpState.everyoneCanGenerate)
  );
  const canEnter = $derived(nameInput.trim().length >= 1 && !mpState.connecting);

  const closedText = $derived.by(() => {
    switch (mpState.closedReason) {
      case 'host_left': return m.mp_closed_host_left();
      case 'expired': return m.mp_closed_expired();
      case 'not_found': return m.mp_closed_not_found();
      case 'bad_token': return m.mp_closed_bad_token();
      case 'host_taken': return m.mp_closed_host_taken();
      case 'idle': return m.mp_closed_idle();
      case 'slow': return m.mp_closed_slow();
      case 'left': return '';
      default: return m.mp_closed_error();
    }
  });

  // Replace the old room-ready card with a one-time compact invite popover.
  $effect(() => {
    if (mpState.showLinks) {
      roomMenuOpen = true;
      mpState.showLinks = false;
    }
  });

  $effect(() => {
    const sessionId = mpState.conversationId;
    if (sessionId && sessionId !== loadedSessionId) {
      loadedSessionId = sessionId;
      void loadAllConversations('multiplayer');
    }
  });

  function systemText(text: string): string {
    if (text.startsWith('__joined:')) return m.mp_sys_joined({ id: text.slice(9) });
    if (text.startsWith('__left:')) return m.mp_sys_left({ id: text.slice(7) });
    return text;
  }

  async function copyInvite() {
    try {
      await navigator.clipboard.writeText(mpState.shareLink);
      copied = true;
      setTimeout(() => (copied = false), 1500);
    } catch { }
  }

  async function submitChat() {
    const text = chatInput;
    if (!text.trim() || locked) return;

    const existingMessageIds = new Set(mpState.messages.map((message) => message.id));
    chatInput = '';
    void sendChat(text);

    const sentMessage = mpState.messages.find(
      (message) => message.kind === 'chat'
        && message.author === mpState.displayName
        && !existingMessageIds.has(message.id),
    );
    if (!sentMessage) return;

    await tick();
    positionSentChatMessage(messagesEl, sentMessage.id);
  }

  function handleComposerKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      submitChat();
    }
  }

  function closeRoomMenu(event: MouseEvent) {
    const target = event.target as HTMLElement;
    if (!target.closest('[data-room-menu]')) roomMenuOpen = false;
  }
</script>

<svelte:window onclick={closeRoomMenu} />

{#snippet sidebar({ isMobileSidebarOpen, close }: { isMobileSidebarOpen: boolean, close: () => void })}
  <div class="h-full flex flex-col overflow-hidden">
    <Sidebar isOpen={isMobileSidebarOpen} {close} alwaysVisible={!isMobileSidebarOpen} mode="multiplayer" />
  </div>
{/snippet}

{#snippet header()}
  <div class="flex min-w-0 items-center gap-2 sm:gap-3">
    <Button variant="icon" size="sm" ariaLabel={m.play_btn_back()} onclick={leaveRoom}>
      <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round">
        <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
      </svg>
    </Button>

    {#if mpState.connected || mpState.viewingHistory}
      <div class="hidden min-w-0 items-center gap-2 sm:flex">
        <span class="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-white/5 text-[11px] font-bold text-white ring-1 ring-white/10">
          {#if mpState.sessionCharacter?.avatarUrl}
            <img src={mpState.sessionCharacter.avatarUrl} alt={mpState.sessionCharacter.name} class="h-full w-full object-cover" />
          {:else}
            {mpState.sessionCharacter?.initials ?? mpState.characterName?.[0]?.toUpperCase() ?? '?'}
          {/if}
        </span>
        <div class="min-w-0">
          <p class="max-w-36 truncate text-sm font-medium text-gray-200">{mpState.sessionCharacter?.name ?? mpState.characterName ?? m.mp_title()}</p>
          <p class="flex items-center gap-1.5 text-[11px] text-gray-500">
            {#if mpState.connected}<span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>{/if}
            {mpState.connected ? m.mp_participants({ count: mpState.count }) : m.mp_resume_title()}
          </p>
        </div>
      </div>

      <div class="relative" data-room-menu>
        <button
          type="button"
          class="flex h-8 items-center gap-1.5 rounded-full border border-white/[0.06] bg-white/5 px-2.5 text-xs text-gray-400 transition-colors hover:border-ryokan-accent/30 hover:bg-white/10 hover:text-gray-200 sm:px-3"
          aria-label={m.mp_links_share_label()}
          aria-expanded={roomMenuOpen}
          onclick={() => (roomMenuOpen = !roomMenuOpen)}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 10.5 6.8-4M8.6 13.5l6.8 4"/>
          </svg>
          <span class="hidden sm:inline">{m.mp_links_share_label()}</span>
        </button>

        {#if roomMenuOpen}
          <div class="absolute right-0 top-[calc(100%+0.5rem)] z-50 w-[min(20rem,calc(100vw-2rem))] overflow-hidden rounded-2xl border border-white/10 bg-ryokan-sidebar p-3 shadow-2xl">
            <div class="flex items-center justify-between gap-3 px-1 pb-2">
              <div class="min-w-0">
                <p class="text-xs font-medium text-gray-200">{m.mp_title()}</p>
              </div>
              {#if mpState.connected}
                <span class="shrink-0 text-[11px] text-gray-500">{m.mp_participants({ count: mpState.count })}</span>
              {/if}
            </div>

            {#if mpState.connected && mpState.shareLink}
              <button
                type="button"
                class="flex w-full items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2.5 text-left text-sm text-gray-300 transition-colors hover:bg-white/[0.08]"
                onclick={copyInvite}
              >
                <svg class="shrink-0 text-ryokan-accent" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                </svg>
                <span class="min-w-0 flex-1">
                  <span class="block font-medium">{copied ? m.mp_links_copied() : m.mp_links_copy()}</span>
                  <span class="block truncate text-[11px] text-gray-600">{m.mp_links_share_hint()}</span>
                </span>
              </button>
            {/if}

            {#if mpState.role === 'host' && !mpState.viewingHistory}
              <label class="mt-1 flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-gray-400 transition-colors hover:bg-white/[0.05]">
                <span>{m.mp_policy_toggle()}</span>
                <input
                  type="checkbox"
                  checked={mpState.everyoneCanGenerate}
                  onchange={(event) => setPolicy(event.currentTarget.checked)}
                  class="h-4 w-4 shrink-0 accent-ryokan-accent"
                />
              </label>
            {/if}
          </div>
        {/if}
      </div>
    {/if}
  </div>
{/snippet}

<PageLayout
  pageTitle={m.mp_title()}
  showSidebar={!inMultiplayerChat}
  maxContentWidth="max-w-5xl"
  contentPadding="px-3 sm:px-6"
  {sidebar}
  {header}
>
  {#if mpState.closedReason && mpState.closedReason !== 'left'}
    <div class="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
      <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 text-gray-400">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/>
        </svg>
      </div>
      <p class="mb-6 text-gray-300">{closedText}</p>
      <Button variant="secondary" onclick={() => (appState.currentView = 'play')}>{m.mp_closed_back_btn()}</Button>
    </div>

  {:else if !mpState.connected && !mpState.viewingHistory}
    <div class="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-6 sm:p-8">
      <h2 class="mb-1 font-medium text-gray-100">{m.mp_gate_title()}</h2>
      <p class="mb-5 text-sm text-gray-500">{m.mp_gate_desc()}</p>
      <div class="flex items-center gap-2">
        <input
          type="text"
          bind:value={nameInput}
          placeholder={m.mp_gate_placeholder()}
          maxlength="24"
          autocomplete="nickname"
          class="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-gray-100 placeholder:text-gray-600 focus:border-white/25 focus:outline-none"
          onkeydown={(event) => event.key === 'Enter' && canEnter && enterRoom(nameInput)}
        />
        <button
          class="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={!canEnter}
          onclick={() => enterRoom(nameInput)}
        >
          {#if mpState.connecting}
            {m.mp_connecting()}
          {:else if mpState.pending?.mode === 'create'}
            {m.mp_gate_create_btn()}
          {:else if mpState.pending?.mode === 'resume'}
            {m.mp_resume_btn()}
          {:else}
            {m.mp_gate_join_btn()}
          {/if}
        </button>
      </div>
      {#if mpState.error === 'create_failed'}<p class="mt-3 text-sm text-red-400">{m.mp_error_create_failed()}</p>{/if}
    </div>

  {:else}
    <div class="flex h-[calc(100dvh-7rem)] min-h-[24rem] flex-col md:h-[calc(100dvh-7.5rem)]">
      {#if mpState.viewingHistory}
        <div class="mx-auto mb-2 flex w-full max-w-3xl items-center justify-between gap-4 rounded-xl bg-white/[0.035] px-4 py-2.5">
          <div class="min-w-0">
            <p class="text-sm font-medium text-gray-200">{m.mp_resume_title()}</p>
            <p class="truncate text-xs text-gray-500">{mpState.sessionCharacter ? m.mp_resume_desc() : m.mp_resume_missing_character()}</p>
          </div>
          <Button variant="secondary" size="sm" disabled={!mpState.sessionCharacter} onclick={prepareResume}>{m.mp_resume_btn()}</Button>
        </div>
      {/if}

      <div bind:this={messagesEl} class="min-h-0 flex-1 overflow-y-auto px-1 py-3 sm:px-4 sm:py-5" style="overflow-anchor: none;">
        <div class="mx-auto w-full max-w-3xl">
          {#each mpState.messages as msg (msg.id)}
            {#if msg.kind === 'system'}
              <p class="my-4 text-center text-[11px] text-gray-600">{systemText(msg.text)}</p>
            {:else if msg.kind === 'llm'}
              <div class="mb-8 flex items-start gap-3 sm:gap-5">
                <span class="mt-0.5 hidden h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-white/5 text-sm font-bold text-white ring-1 ring-ryokan-accent/20 sm:flex">
                  {#if mpState.sessionCharacter?.avatarUrl}
                    <img src={mpState.sessionCharacter.avatarUrl} alt={mpState.sessionCharacter.name} class="h-full w-full object-cover" />
                  {:else}
                    {mpState.sessionCharacter?.initials ?? msg.author[0]?.toUpperCase() ?? 'A'}
                  {/if}
                </span>
                <div class="min-w-0 max-w-[720px] flex-1">
                  <p class="mb-1 text-[11px] font-medium text-ryokan-accent/80">{msg.author}</p>
                  <p class="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-gray-200">
                    {msg.text}{#if msg.streaming}<span class="ml-1 inline-block h-3.5 w-1 animate-pulse rounded-sm bg-ryokan-accent align-middle"></span>{/if}
                  </p>
                </div>
              </div>
            {:else}
              <div data-message-id={msg.id} class="mb-6 flex {msg.author === mpState.displayName ? 'justify-end' : 'justify-start'}">
                <div class="max-w-[82%] sm:max-w-[68%]">
                  <p class="mb-1 px-1 text-[11px] text-gray-500 {msg.author === mpState.displayName ? 'text-right' : ''}">{msg.author}</p>
                  <p class="whitespace-pre-wrap break-words rounded-2xl border border-white/[0.04] px-4 py-3 text-[15px] leading-relaxed text-gray-200 {msg.author === mpState.displayName ? 'rounded-tr-sm bg-[#1e1e22]' : 'rounded-tl-sm bg-white/[0.035]'}">{msg.text}</p>
                </div>
              </div>
            {/if}
          {/each}
        </div>
      </div>

      {#if !mpState.viewingHistory}
        <div class="shrink-0 px-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] sm:px-4">
          <div class="mx-auto w-full max-w-3xl rounded-[20px] bg-white/[0.06] p-px">
            <div class="overflow-hidden rounded-[19px] bg-ryokan-sidebar shadow-[0_0.25rem_1.25rem_rgba(0,0,0,0.12)]">
              <textarea
                bind:value={chatInput}
                disabled={locked}
                rows="1"
                maxlength="4000"
                placeholder={locked ? m.mp_input_locked_placeholder() : m.mp_input_placeholder()}
                onkeydown={handleComposerKeydown}
                class="block min-h-[56px] max-h-40 w-full resize-none bg-transparent px-5 pb-2 pt-4 text-[15px] leading-relaxed text-ryokan-text outline-none placeholder:text-[#44444c] disabled:cursor-not-allowed disabled:opacity-50"
              ></textarea>
              <div class="flex min-h-12 items-center justify-between gap-3 px-3 pb-3 pt-1">
                <span class="min-w-0 truncate px-2 text-[11px] text-gray-600">
                  {locked ? m.mp_locked_banner() : m.mp_participants({ count: mpState.count })}
                </span>
                <div class="flex shrink-0 items-center gap-2">
                  {#if locked && mpState.role === 'host'}
                    <button
                      type="button"
                      class="flex h-9 items-center gap-1.5 rounded-xl border border-red-400/20 bg-red-500/10 px-3 text-xs text-red-400 transition-colors hover:bg-red-500/20"
                      onclick={abortGeneration}
                    >
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>
                      {m.mp_locked_abort()}
                    </button>
                  {:else}
                    {#if mpState.role === 'host' || mpState.everyoneCanGenerate}
                      <button
                        type="button"
                        class="flex h-9 items-center gap-1.5 rounded-xl border border-ryokan-accent/20 bg-ryokan-accent/10 px-3 text-xs text-ryokan-accent transition-colors hover:bg-ryokan-accent/15 disabled:cursor-not-allowed disabled:opacity-35"
                        disabled={!canGenerate}
                        onclick={requestGeneration}
                      >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/></svg>
                        <span class="hidden sm:inline">{m.mp_generate_btn()}</span>
                      </button>
                    {/if}
                    <button
                      type="button"
                      class="flex h-9 w-9 items-center justify-center rounded-xl border transition-colors {chatInput.trim() ? 'border-white/20 bg-gray-100 text-ryokan-bg hover:bg-white' : 'cursor-not-allowed border-white/[0.05] bg-white/[0.04] text-white/[0.18]'}"
                      disabled={!chatInput.trim()}
                      aria-label={m.mp_send_btn()}
                      onclick={submitChat}
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5M5 12l7-7 7 7"/></svg>
                    </button>
                  {/if}
                </div>
              </div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  {/if}
</PageLayout>
