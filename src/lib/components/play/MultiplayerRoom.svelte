<script lang="ts">
  import { appState } from '$lib/stores/appState.svelte';
  import {
    mpState,
    enterRoom,
    leaveRoom,
    sendChat,
    requestGeneration,
    abortGeneration,
    setPolicy,
  } from '$lib/stores/multiplayer.svelte';
  import * as m from '$lib/paraglide/messages';

  import Sidebar from '$lib/components/Sidebar.svelte';
  import PageLayout from '$lib/components/layouts/PageLayout.svelte';
  import Button from '$lib/components/ui/Button.svelte';

  let nameInput = $state('');
  let chatInput = $state('');
  let copied = $state<'' | 'share' | 'host'>('');
  let messagesEl = $state<HTMLDivElement | null>(null);

  const locked = $derived(mpState.lockedBy !== null);
  const canGenerate = $derived(
    mpState.connected && !locked && (mpState.role === 'host' || mpState.everyoneCanGenerate)
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

  $effect(() => {
    void mpState.messages.length;
    void mpState.messages.at(-1)?.text;
    if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
  });

  function systemText(text: string): string {
    if (text.startsWith('__joined:')) return m.mp_sys_joined({ id: text.slice(9) });
    if (text.startsWith('__left:')) return m.mp_sys_left({ id: text.slice(7) });
    return text;
  }

  async function copy(which: 'share' | 'host') {
    const link = which === 'share' ? mpState.shareLink : mpState.hostLink;
    try {
      await navigator.clipboard.writeText(link);
      copied = which;
      setTimeout(() => (copied = ''), 1500);
    } catch { }
  }

  function submitChat() {
    const text = chatInput;
    if (!text.trim() || locked) return;
    chatInput = '';
    void sendChat(text);
  }

  function onLeave() {
    leaveRoom();
  }
</script>

{#snippet sidebar({ isMobileSidebarOpen, close }: { isMobileSidebarOpen: boolean, close: () => void })}
  <div class="h-full flex flex-col overflow-hidden">
    <Sidebar isOpen={isMobileSidebarOpen} {close} alwaysVisible={!isMobileSidebarOpen} />
  </div>
{/snippet}

{#snippet header()}
  <div class="flex items-center gap-3">
    <Button variant="icon" ariaLabel={m.play_btn_back()} onclick={onLeave}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M19 12H5"/><path d="m12 19-7-7 7-7"/>
      </svg>
    </Button>

    {#if mpState.roomId}
      <div class="w-px h-6 bg-white/10"></div>
      <span class="rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-xs tracking-widest text-gray-300 select-all">
        {mpState.roomId}
      </span>
      {#if mpState.connected}
        <span class="flex items-center gap-1.5 text-xs text-gray-400">
          <span class="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
          {m.mp_participants({ count: mpState.count })}
        </span>
      {/if}
    {/if}

    <div class="flex-1"></div>
  </div>
{/snippet}

<PageLayout
  pageTitle={m.mp_title()}
  showSidebar={true}
  maxContentWidth="max-w-4xl"
  {sidebar}
  {header}
>
  {#if mpState.closedReason && mpState.closedReason !== 'left'}
    <div class="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center">
      <div class="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-400">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
          <path d="M18.36 6.64A9 9 0 1 1 5.64 6.64"/><line x1="12" y1="2" x2="12" y2="12"/>
        </svg>
      </div>
      <p class="mb-6 text-gray-300">{closedText}</p>
      <Button variant="secondary" onclick={() => (appState.currentView = 'play')}>
        {m.mp_closed_back_btn()}
      </Button>
    </div>

  {:else if !mpState.connected}
    <div class="mx-auto mt-16 max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8">
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
          onkeydown={(e) => e.key === 'Enter' && canEnter && enterRoom(nameInput)}
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
          {:else}
            {m.mp_gate_join_btn()}
          {/if}
        </button>
      </div>
      {#if mpState.error === 'create_failed'}
        <p class="mt-3 text-sm text-red-400">{m.mp_error_create_failed()}</p>
      {/if}
    </div>

  {:else}
    <div class="flex h-[calc(100dvh-11rem)] min-h-[24rem] flex-col">

      {#if mpState.showLinks}
        <div class="mb-4 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
          <div class="mb-3 flex items-center justify-between">
            <h3 class="text-sm font-medium text-gray-100">{m.mp_links_title()}</h3>
            <button class="text-xs text-gray-500 hover:text-gray-300" onclick={() => (mpState.showLinks = false)}>
              {m.mp_links_dismiss()}
            </button>
          </div>

          <div class="mb-3">
            <p class="mb-1 text-xs text-gray-400">
              <span class="text-emerald-400">●</span> {m.mp_links_share_label()}
              <span class="text-gray-600">– {m.mp_links_share_hint()}</span>
            </p>
            <div class="flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-xs text-gray-300">{mpState.shareLink}</code>
              <button
                class="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-200 hover:bg-white/10"
                onclick={() => copy('share')}
              >{copied === 'share' ? m.mp_links_copied() : m.mp_links_copy()}</button>
            </div>
          </div>

          <div>
            <p class="mb-1 text-xs text-gray-400">
              <span class="text-red-400">●</span> {m.mp_links_host_label()}
              <span class="text-gray-600">– {m.mp_links_host_hint()}</span>
            </p>
            <div class="flex items-center gap-2">
              <code class="min-w-0 flex-1 truncate rounded-lg border border-red-400/20 bg-black/20 px-3 py-2 text-xs text-gray-300">{mpState.hostLink}</code>
              <button
                class="shrink-0 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-gray-200 hover:bg-white/10"
                onclick={() => copy('host')}
              >{copied === 'host' ? m.mp_links_copied() : m.mp_links_copy()}</button>
            </div>
          </div>
        </div>
      {/if}

      {#if mpState.role === 'host'}
        <label class="mb-3 flex w-fit cursor-pointer items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={mpState.everyoneCanGenerate}
            onchange={(e) => setPolicy(e.currentTarget.checked)}
            class="h-4 w-4 rounded border-white/20 bg-white/5 accent-current"
          />
          {m.mp_policy_toggle()}
        </label>
      {/if}

      <div bind:this={messagesEl} class="flex-1 space-y-3 overflow-y-auto rounded-2xl border border-white/10 bg-white/[0.02] p-4">
        {#each mpState.messages as msg (msg.id)}
          {#if msg.kind === 'system'}
            <p class="text-center text-xs text-gray-600">{systemText(msg.text)}</p>
          {:else}
            <div class="flex flex-col {msg.kind === 'chat' && msg.author === mpState.displayName ? 'items-end' : 'items-start'}">
              <span class="mb-0.5 px-1 text-xs {msg.kind === 'llm' ? 'text-ryokan-accent' : 'text-gray-500'}">
                {msg.author}
              </span>
              <div class="max-w-[85%] whitespace-pre-wrap rounded-xl border px-3 py-2 text-sm leading-relaxed
                {msg.kind === 'llm'
                  ? 'border-white/10 bg-white/[0.06] text-gray-200'
                  : msg.author === mpState.displayName
                    ? 'border-white/10 bg-white/10 text-gray-100'
                    : 'border-white/10 bg-white/[0.04] text-gray-200'}">
                {msg.text}{#if msg.streaming}<span class="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse rounded-sm bg-ryokan-accent align-middle"></span>{/if}
              </div>
            </div>
          {/if}
        {/each}
      </div>

      {#if locked}
        <div class="mt-3 flex items-center justify-between rounded-xl border border-white/10 bg-white/[0.04] px-4 py-2.5">
          <span class="flex items-center gap-2 text-sm text-gray-300">
            <span class="h-2 w-2 animate-pulse rounded-full bg-ryokan-accent"></span>
            {m.mp_locked_banner()}
          </span>
          {#if mpState.role === 'host'}
            <button class="text-sm text-gray-400 hover:text-gray-200" onclick={abortGeneration}>
              {m.mp_locked_abort()}
            </button>
          {/if}
        </div>
      {/if}

      <div class="mt-3 flex items-center gap-2">
        <input
          type="text"
          bind:value={chatInput}
          disabled={locked}
          placeholder={locked ? m.mp_input_locked_placeholder() : m.mp_input_placeholder()}
          class="min-w-0 flex-1 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5 text-sm text-gray-100 placeholder:text-gray-600 focus:border-white/25 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
          onkeydown={(e) => e.key === 'Enter' && submitChat()}
        />
        <button
          class="rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-gray-200 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={locked || !chatInput.trim()}
          onclick={submitChat}
        >
          {m.mp_send_btn()}
        </button>
        {#if mpState.role === 'host' || mpState.everyoneCanGenerate}
          <button
            class="flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-4 py-2.5 text-sm text-ryokan-accent transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!canGenerate}
            onclick={requestGeneration}
            title={m.mp_generate_btn()}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 3l1.9 5.7L19.6 10l-5.7 1.9L12 17.6l-1.9-5.7L4.4 10l5.7-1.9z"/>
            </svg>
            {m.mp_generate_btn()}
          </button>
        {/if}
      </div>
    </div>
  {/if}
</PageLayout>
