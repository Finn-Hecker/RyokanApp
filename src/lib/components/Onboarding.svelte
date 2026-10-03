<script lang="ts">
  import { tick } from 'svelte';
  import Button from '$lib/components/ui/Button.svelte';
  import ApiSection from '$lib/components/settings/ApiSection.svelte';
  import GeneralSection from '$lib/components/settings/GeneralSection.svelte';
  import { appState } from '$lib/stores/appState.svelte';
  import { registerBackHandler } from '$lib/stores/navigation';
  import { invoke } from '@tauri-apps/api/core';
  import { persistApiConnections } from '$lib/utils/apiConnections';
  import { reportDiagnostic } from '$lib/utils/diagnostics';
  import { androidViewport } from '$lib/utils/androidViewport';
  import { getLocale, setLocale } from '$lib/paraglide/runtime';
  import { PROVIDER_LABELS } from '$lib/utils/providers';
  import * as m from '$lib/paraglide/messages';

  let step = $state(0);
  let connectionReady = $state(false);
  let saving = $state(false);
  let saveError = $state(false);
  let heading = $state<HTMLHeadingElement>();
  let content = $state<HTMLDivElement>();
  const locale = $derived({ locale: (appState.pendingUiLocale || getLocale()) as 'de' | 'en' });
  const steps = $derived([m.onboarding_welcome_step({}, locale), m.onboarding_connect_step({}, locale), m.onboarding_complete_step({}, locale)]);

  async function move(next: number) {
    if (saving || (next === 2 && !connectionReady)) return;
    step = next;
    saveError = false;
    await tick();
    content?.scrollTo({ top: 0 });
    heading?.focus();
  }

  $effect(() => registerBackHandler(() => {
    if (step > 0 && !saving) void move(step - 1);
    return true;
  }));

  async function finish() {
    if (!connectionReady || saving) return;
    saving = true;
    saveError = false;
    try {
      await persistApiConnections();
      // Mark complete only after the shared connection has been saved successfully.
      await invoke('save_setting', { key: 'onboarding_completed', value: 'true' });
      appState.currentView = 'lobby';
      appState.isOnboarding = false;
      const selectedLocale = appState.pendingUiLocale;
      appState.pendingUiLocale = '';
      if (selectedLocale && selectedLocale !== getLocale()) setLocale(selectedLocale as 'de' | 'en');
    } catch {
      reportDiagnostic('settings');
      saveError = true;
    } finally {
      saving = false;
    }
  }
</script>

<main class="onboarding" use:androidViewport aria-labelledby="onboarding-title">
  <div class="onboarding-scroll" bind:this={content}>
    <div class="onboarding-shell">
      <header class="brand"><img src="/app-icon.png" alt="" width="36" height="36" /><span>Ryokan</span></header>
      <div class="welcome-layout">
        <aside class="welcome-art" aria-hidden="true">
          <img class="brand-symbol" src="/app-icon.png" alt="" width="512" height="512" />
          <span class="art-caption">Ryokan</span>
          <p>{m.onboarding_footer({}, locale)}</p>
        </aside>
        <div class="setup">
          <nav aria-label={m.onboarding_steps({}, locale)} class="progress">
            <ol>
              {#each steps as label, index}
                <li aria-current={step === index ? 'step' : undefined} class:current={step === index} class:complete={step > index}>
                  <span class="progress-dot" aria-hidden="true"></span><span>{label}</span>
                </li>
              {/each}
            </ol>
          </nav>
          <h1 id="onboarding-title" bind:this={heading} tabindex="-1">{step === 0 ? m.onboarding_welcome({}, locale) : step === 1 ? m.onboarding_connect({}, locale) : m.onboarding_complete({}, locale)}</h1>
          <p class="introduction">{step === 0 ? m.onboarding_intro({}, locale) : step === 1 ? m.onboarding_connect_hint({}, locale) : m.onboarding_complete_hint({}, locale)}</p>

          <div class="step-content" hidden={step !== 0}>
            <h2>{m.onboarding_language({}, locale)}</h2>
            <GeneralSection category="language" />
            <p class="hint">{m.onboarding_language_hint({}, locale)}</p>
          </div>
          <div class="step-content" hidden={step !== 1}>
            <ApiSection setup active={step === 1} settingsReady bind:ready={connectionReady} />
            <p class="hint">{m.onboarding_local_hint({}, locale)}</p>
          </div>
          {#if step === 2}
            <div class="step-content">
              <dl class="connection-summary">
                <div><dt>{m.onboarding_provider({}, locale)}</dt><dd>{PROVIDER_LABELS[appState.apiSettings.providerKind]}</dd></div>
                <div><dt>{m.onboarding_model({}, locale)}</dt><dd>{appState.apiSettings.model}</dd></div>
              </dl>
              <p class="hint">{m.onboarding_change({}, locale)}</p>
            </div>
          {/if}
          {#if saveError}<p class="save-error" role="alert">{m.onboarding_error({}, locale)}</p>{/if}
          <footer class="actions">
            {#if step > 0}<Button variant="ghost" size="lg" disabled={saving} onclick={() => move(step - 1)}>{m.onboarding_back({}, locale)}</Button>{/if}
            <Button variant="primary" size="lg" disabled={saving || (step > 0 && !connectionReady)} onclick={() => step === 2 ? finish() : move(step + 1)}>
              {saving ? m.onboarding_saving({}, locale) : step === 2 ? m.onboarding_start({}, locale) : m.onboarding_continue({}, locale)}
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M5 12h14m-6-6 6 6-6 6" stroke-linecap="round" stroke-linejoin="round" /></svg>
            </Button>
          </footer>
        </div>
      </div>
    </div>
  </div>
</main>

<style>
  .onboarding { height:100dvh; width:100%; overflow:hidden; background:var(--color-ryokan-bg); color:var(--sheet-text); }
  .onboarding-scroll { height:100%; overflow-y:auto; scrollbar-width:none; }
  .onboarding-scroll::-webkit-scrollbar { display:none; }
  .onboarding-shell { min-height:100%; max-width:1240px; margin:auto; padding:calc(24px + env(safe-area-inset-top)) max(24px, env(safe-area-inset-left)) calc(32px + env(safe-area-inset-bottom)); display:flex; flex-direction:column; }
  .brand { display:flex; align-items:center; gap:10px; color:var(--color-ryokan-accent); font-size:20px; font-weight:600; letter-spacing:-.04em; }
  .brand img { border-radius:10px; }
  .welcome-layout { flex:1; display:flex; align-items:center; padding:48px 0 12px; }
  .welcome-art { display:none; }
  .setup { width:100%; max-width:560px; margin:auto; min-width:0; }
  .progress ol { display:flex; flex-wrap:wrap; gap:18px; padding:0; margin:0 0 32px; list-style:none; }
  .progress li { display:flex; align-items:center; gap:7px; font-size:11px; color:var(--sheet-text-subtle); }
  .progress li.current { color:var(--color-ryokan-accent); }
  .progress-dot { width:5px; height:5px; border-radius:50%; background:#494747; }
  .current .progress-dot,.complete .progress-dot { background:var(--color-ryokan-accent); }
  h1 { font-size:clamp(30px,4vw,43px); line-height:1.16; font-weight:500; letter-spacing:-.045em; max-width:500px; margin:0; text-wrap:balance; }
  h1:focus { outline:none; }
  .introduction { max-width:440px; margin:18px 0 0; color:var(--sheet-text-muted); font-size:14px; line-height:1.8; text-wrap:pretty; }
  .step-content { margin-top:36px; }
  .step-content[hidden] { display:none; }
  h2 { color:#d8c5a8; font-size:13px; font-weight:650; margin:0 0 18px; }
  .hint { color:var(--sheet-text-subtle); font-size:12px; line-height:1.7; margin:20px 0 0; }
  .actions { display:flex; justify-content:flex-end; gap:10px; margin-top:36px; }
  .actions :global(button:focus-visible) { outline:2px solid var(--color-ryokan-accent); outline-offset:4px; }
  .connection-summary { margin:0; border-top:1px solid var(--sheet-divider); }
  .connection-summary div { padding:18px 0; border-bottom:1px solid var(--sheet-divider); }
  dt { font-size:11px; color:var(--sheet-text-subtle); margin-bottom:6px; }
  dd { margin:0; font-size:14px; overflow-wrap:anywhere; }
  .save-error { color:var(--sheet-danger); font-size:13px; margin-top:20px; }
  @media (min-width:960px) {
    .brand { visibility:hidden; }
    .onboarding-shell { max-width:1680px; padding:40px clamp(40px,4.2vw,80px); }
    .welcome-layout { display:grid; grid-template-columns:minmax(0,.95fr) minmax(0,1.05fr); gap:clamp(48px,6vw,112px); padding:clamp(40px,7vh,88px) 0; }
    .welcome-art { display:flex; min-width:0; align-self:stretch; flex-direction:column; align-items:center; justify-content:center; border-right:1px solid var(--sheet-divider); padding-right:clamp(32px,4vw,72px); }
    .brand-symbol { display:block; width:clamp(220px,22vw,360px); max-width:100%; height:auto; aspect-ratio:1; object-fit:contain; opacity:.65; }
    .art-caption { margin-top:48px; font-size:clamp(42px,3.5vw,64px); letter-spacing:-.06em; font-weight:400; color:#d8c5a8; }
    .welcome-art p { margin-top:16px; color:var(--sheet-text-subtle); font-size:14px; text-align:center; line-height:1.7; }
    .setup { max-width:720px; margin:0; display:flex; flex-direction:column; }
    .progress ol { gap:28px; margin-bottom:40px; }
    h1 { max-width:100%; font-size:clamp(40px,3.4vw,60px); }
    .introduction { max-width:560px; margin-top:24px; font-size:16px; }
    .step-content { margin-top:48px; }
    .actions { margin-top:48px; }
  }
  @media (min-width:960px) and (min-height:800px) {
    .setup { min-height:clamp(480px,64dvh,680px); }
    .actions { margin-top:auto; padding-top:48px; }
  }
  @media (max-height:650px) { .welcome-layout { padding-top:28px; } .step-content { margin-top:24px; } .actions { margin-top:24px; } }
</style>
