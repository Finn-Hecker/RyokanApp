<script lang="ts">
  import { reportDiagnostic } from '$lib/utils/diagnostics';
  import { activateApiConnection, appState } from "$lib/stores/appState.svelte";
  import { fetchModels, getAllSettings, saveSetting, type ModelInfo } from "$lib/utils/settings";
  import * as m from "$lib/paraglide/messages";
  import { onMount } from "svelte";
  import {
    createDefaultApiParameterEnabled,
    type ApiParameterKey,
  } from "$lib/utils/apiParameters";
  import { ensureContextDetection, invalidateDetectedContext, persistApiConnections } from '$lib/utils/apiConnections';
  import { modelGenerationCapabilities } from '$lib/utils/generationCapabilities';
  import ParameterControl from '$lib/components/settings/ParameterControl.svelte';
  import ReasoningControl from '$lib/components/settings/ReasoningControl.svelte';
  import ThinkingBudgetControl from '$lib/components/settings/ThinkingBudgetControl.svelte';
  import ChatModelPicker from './ChatModelPicker.svelte';

  let { onClose }: { onClose: () => void } = $props();

  // The power-user flag isn't part of appState, so it's loaded/persisted
  // the same way SettingsPage.svelte does it (via the settings_power_user key).
  let powerUser = $state(false);
  let parameterEnabled = $state<Record<ApiParameterKey, boolean>>(
    createDefaultApiParameterEnabled(),
  );
  let availableModels = $state<string[]>([]);
  let modelMetadata = $state<Record<string, ModelInfo>>({});
  let modelsLoading = $state(false);
  let modelsError = $state('');
  let modelPickerOpen = $state(false);
  let modelRequest = 0;

  async function loadModels() {
    const connection = appState.apiSettings;
    const request = ++modelRequest;
    availableModels = [];
    modelMetadata = {};
    modelsError = '';
    modelsLoading = false;
    if (!connection.url.trim()) return;
    modelsLoading = true;
    try {
      const models = await fetchModels(connection.url, connection.apiKey, connection.providerKind);
      if (request !== modelRequest || appState.apiSettings !== connection) return;
      availableModels = models.map(model => model.id);
      modelMetadata = Object.fromEntries(models.map(model => [model.id, model]));
      connection.generationCapabilities = modelGenerationCapabilities(connection, modelMetadata[connection.model]?.supportedParameters, modelMetadata[connection.model]?.reasoning);
      void persistApiConnections().catch(() => reportDiagnostic('settings'));
      if (!models.length) modelsError = m.settings_model_error_no_models();
    } catch (error) {
      if (request !== modelRequest || appState.apiSettings !== connection) return;
      modelsError = m.settings_model_error_fetch({ error: error instanceof Error ? error.message : String(error) });
    } finally {
      if (request === modelRequest) modelsLoading = false;
    }
  }

  function selectConnection(id: string) {
    if (id === appState.activeApiConnectionId || !activateApiConnection(id)) return;
    parameterEnabled = { ...appState.apiSettings.parameterEnabled };
    modelPickerOpen = false;
    void persistApiConnections().catch(() => reportDiagnostic('settings'));
    void loadModels();
  }

  function selectModel(value: string) {
    const model = value.trim();
    modelPickerOpen = false;
    if (!model || model === appState.apiSettings.model) return;
    const connection = appState.apiSettings;
    invalidateDetectedContext(connection);
    connection.model = model;
    connection.generationCapabilities = modelGenerationCapabilities(connection, modelMetadata[model]?.supportedParameters, modelMetadata[model]?.reasoning);
    void persistApiConnections().catch(() => reportDiagnostic('settings'));
    void ensureContextDetection(connection).then(() => persistApiConnections()).catch(() => reportDiagnostic('settings'));
  }

  onMount(async () => {
    try {
      const settings = await getAllSettings();
      const row = settings.find(r => r.key === "settings_power_user");
      if (row) powerUser = row.value === "true";
      parameterEnabled = { ...appState.apiSettings.parameterEnabled };
      void loadModels();
    } catch (err) {
      reportDiagnostic('settings');
    }
  });

  function persist(key: string, value: unknown) {
    saveSetting(key, value as any).catch(err =>
      reportDiagnostic('settings')
    );
  }

  function togglePowerUser() {
    powerUser = !powerUser;
    persist("settings_power_user", powerUser);
  }

  function toggleParameter(key: ApiParameterKey) {
    parameterEnabled[key] = !parameterEnabled[key];
    appState.apiSettings.parameterEnabled = { ...parameterEnabled };
    void persistApiConnections();
  }

  // Every setter updates the live appState (so the next message picks it up
  // immediately) and persists it, since this panel has no separate "Save" button.
  function persistActive() { void persistApiConnections(); }
  function handleWindowKeydown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      if (modelPickerOpen) modelPickerOpen = false;
      else onClose();
    }
  }

  // Closes only when the backdrop itself is clicked, so no
  // stopPropagation handler on the panel is needed (a11y warnings).
  function handleOverlayClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

<svelte:window onkeydown={handleWindowKeydown} />

<div
  class="settings-overlay"
  role="presentation"
  onclick={handleOverlayClick}
  onkeydown={handleWindowKeydown}
>
  <div class="settings-panel" role="dialog" aria-modal="true" aria-label={m.settings_section_ai_behavior()}>
    <div class="settings-panel-header">
      <span class="settings-panel-title">{m.settings_section_ai_behavior()}</span>
      <button class="settings-close-btn" onclick={onClose} aria-label="Schließen">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round">
          <line x1="18" y1="6" x2="6" y2="18"/>
          <line x1="6" y1="6" x2="18" y2="18"/>
        </svg>
      </button>
    </div>

    <div class="settings-panel-body">
      <div class="connection-card">
        <div class="connection-field">
          <label class="settings-label" for="chat-active-connection">{m.settings_connection_label()}</label>
          <select id="chat-active-connection" class="connection-input" value={appState.activeApiConnectionId} onchange={(event) => selectConnection(event.currentTarget.value)}>
            {#each appState.apiConnections as connection (connection.id)}
              <option value={connection.id}>{connection.name}</option>
            {/each}
          </select>
        </div>
        <div class="connection-field">
          <label class="settings-label" for="chat-active-model">{m.settings_model_label()}</label>
          <button id="chat-active-model" type="button" class="connection-input model-trigger" aria-haspopup="dialog" aria-expanded={modelPickerOpen} onclick={() => modelPickerOpen = true}>
            <span>{appState.apiSettings.model || m.settings_model_loading()}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m6 9 6 6 6-6" /></svg>
          </button>
          {#if modelsError}<span class="model-status model-status--error">{modelsError}</span>{/if}
        </div>
      </div>
      <div class="settings-card">

        <ReasoningControl connection={appState.apiSettings} onChange={persistActive} />
        <ThinkingBudgetControl connection={appState.apiSettings} {powerUser} onChange={persistActive} />
        <ParameterControl connection={appState.apiSettings} parameter="temperature" enabled={parameterEnabled.temperature} {powerUser} chat
          onToggle={() => toggleParameter("temperature")}
          onValue={(value) => { appState.apiSettings.temperature = value; persistActive(); }}>
          {#snippet tooltip()}{m.settings_creativity_tooltip_p1()}<br><br>
            {m.settings_creativity_tooltip_p2a()}<br>
            {m.settings_creativity_tooltip_p2b()}<br><br>
            <span class="tooltip-hint">{m.settings_creativity_tooltip_hint()}</span>{/snippet}
        </ParameterControl>

        <div class="settings-divider"></div>
        <ParameterControl connection={appState.apiSettings} parameter="maxTokens" enabled={parameterEnabled.maxTokens} {powerUser} chat
          onToggle={() => toggleParameter("maxTokens")}
          onValue={(value) => { appState.apiSettings.maxTokens = value; persistActive(); }}>
          {#snippet tooltip()}{m.settings_tokens_tooltip_p1()}<br><br>
            {m.settings_tokens_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_tokens_tooltip_hint()}</span>{/snippet}
        </ParameterControl>

        <div class="settings-divider"></div>
        <ParameterControl connection={appState.apiSettings} parameter="presencePenalty" enabled={parameterEnabled.presencePenalty} {powerUser} chat
          onToggle={() => toggleParameter("presencePenalty")}
          onValue={(value) => { appState.apiSettings.presencePenalty = value; persistActive(); }}>
          {#snippet tooltip()}{m.settings_penalty_tooltip_p1()}<br><br>
            <span class="tooltip-warn">{m.settings_penalty_tooltip_warn()}</span><br><br>
            <span class="tooltip-hint">{m.settings_penalty_tooltip_hint()}</span>{/snippet}
        </ParameterControl>

        <div class="sampling-divider" role="separator">
          <span class="sampling-divider-line"></span>
          <span class="sampling-subheading">{m.settings_section_sampling_advanced()}</span>
          <span class="sampling-divider-line"></span>
        </div>
        <ParameterControl connection={appState.apiSettings} parameter="topP" enabled={parameterEnabled.topP} {powerUser} chat
          onToggle={() => toggleParameter("topP")}
          onValue={(value) => { appState.apiSettings.topP = value; persistActive(); }}>
          {#snippet tooltip()}{m.settings_topp_tooltip_p1()}<br><br>
            {m.settings_topp_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_topp_tooltip_hint()}</span>{/snippet}
        </ParameterControl>

        <div class="settings-divider"></div>
        <ParameterControl connection={appState.apiSettings} parameter="topK" enabled={parameterEnabled.topK} {powerUser} chat
          onToggle={() => toggleParameter("topK")}
          onValue={(value) => { appState.apiSettings.topK = value; persistActive(); }}>
          {#snippet tooltip()}{m.settings_topk_tooltip_p1()}<br><br>
            {m.settings_topk_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_topk_tooltip_hint()}</span>{/snippet}
        </ParameterControl>

        <div class="settings-divider"></div>
        <ParameterControl connection={appState.apiSettings} parameter="minP" enabled={parameterEnabled.minP} {powerUser} chat
          onToggle={() => toggleParameter("minP")}
          onValue={(value) => { appState.apiSettings.minP = value; persistActive(); }}>
          {#snippet tooltip()}{m.settings_minp_tooltip_p1()}<br><br>
            {m.settings_minp_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_minp_tooltip_hint()}</span>{/snippet}
        </ParameterControl>

        <div class="settings-divider"></div>
        <ParameterControl connection={appState.apiSettings} parameter="frequencyPenalty" enabled={parameterEnabled.frequencyPenalty} {powerUser} chat
          onToggle={() => toggleParameter("frequencyPenalty")}
          onValue={(value) => { appState.apiSettings.frequencyPenalty = value; persistActive(); }}>
          {#snippet tooltip()}{m.settings_freqpenalty_tooltip_p1()}<br><br>
            {m.settings_freqpenalty_tooltip_p2()}<br><br>
            <span class="tooltip-hint">{m.settings_freqpenalty_tooltip_hint()}</span>{/snippet}
        </ParameterControl>

      </div>
    </div>

    <div class="settings-panel-footer">
      <label class="power-user-toggle" title={m.settings_power_user_title()}>
        <div class="power-icon" class:active={powerUser}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
          </svg>
        </div>
        <span class="power-label">{m.settings_power_user_label()}</span>
        <input type="checkbox" checked={powerUser} onchange={togglePowerUser} class="sr-only peer" />
        <div class="power-track
                    peer-checked:bg-ryokan-accent/20 peer-checked:border-ryokan-accent/40
                    after:content-[''] after:absolute after:top-[3px] after:start-[3px]
                    after:bg-[#5a5a5e] after:rounded-full
                    after:h-[14px] after:w-[14px] after:transition-all
                    peer-checked:after:translate-x-[18px] peer-checked:after:bg-ryokan-accent">
        </div>
      </label>
    </div>
  </div>
  {#if modelPickerOpen}
    <ChatModelPicker models={availableModels} metadata={modelMetadata} selectedModel={appState.apiSettings.model} providerKind={appState.apiSettings.providerKind} loading={modelsLoading} error={modelsError} onSelect={selectModel} onRetry={loadModels} onClose={() => modelPickerOpen = false} />
  {/if}
</div>

<style>
  /* ---------- Panel shell ---------- */

  .settings-overlay {
    position: fixed;
    inset: 0;
    z-index: 200;
    background: rgba(8, 8, 12, 0.45);
    backdrop-filter: blur(2px);
    -webkit-backdrop-filter: blur(2px);
    display: flex;
    justify-content: flex-end;
    animation: settings-overlay-in 160ms ease;
  }

  @keyframes settings-overlay-in {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .settings-panel {
    position: relative;
    width: min(440px, 100%);
    height: 100%;
    display: flex;
    flex-direction: column;
    background: var(--color-ryokan-bg, #131314);
    border-left: 1px solid rgba(255,255,255,0.055);
    box-shadow: -24px 0 70px rgba(0,0,0,0.5), -4px 0 16px rgba(0,0,0,0.35);
    backdrop-filter: blur(24px);
    -webkit-backdrop-filter: blur(24px);
    animation: settings-panel-in 220ms cubic-bezier(0.16, 1, 0.3, 1);
  }

  @keyframes settings-panel-in {
    from { opacity: 0; transform: translateX(24px); }
    to   { opacity: 1; transform: translateX(0); }
  }

  /* Mobile: take over the entire screen instead of docking to the side */
  @media (max-width: 639px) {
    .settings-overlay {
      justify-content: stretch;
    }

    .settings-panel {
      width: 100%;
      border-left: none;
      animation: settings-panel-in-mobile 220ms cubic-bezier(0.16, 1, 0.3, 1);
    }

    .settings-panel-body {
      padding: 16px 16px calc(18px + env(safe-area-inset-bottom));
    }
  }

  @keyframes settings-panel-in-mobile {
    from { opacity: 0.6; transform: translateY(24px); }
    to   { opacity: 1; transform: translateY(0); }
  }

  @media (prefers-reduced-motion: reduce) {
    .settings-panel,
    .settings-overlay {
      animation: none;
    }
  }

  .settings-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 18px 20px;
    flex-shrink: 0;
    border-bottom: 1px solid rgba(255,255,255,0.055);
  }

  .settings-panel-title {
    font-size: 17px;
    font-weight: 650;
    color: #e7e2da;
    letter-spacing: -0.01em;
  }

  .settings-close-btn {
    flex-shrink: 0;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 9px;
    background: transparent;
    border: none;
    color: rgba(255,255,255,0.4);
    cursor: pointer;
    transition: background 140ms ease, color 140ms ease;
  }

  .settings-close-btn:hover {
    background: rgba(255,255,255,0.08);
    color: rgba(255,255,255,0.9);
  }

  .settings-panel-body {
    flex: 1;
    min-height: 0;
    padding: 24px 24px 36px;
    overflow-y: auto;
    overflow-x: hidden;
    -webkit-overflow-scrolling: touch;
    overscroll-behavior: contain;
    scrollbar-width: none;
    -ms-overflow-style: none;
  }

  .settings-panel-body::-webkit-scrollbar { display: none; }

  .connection-card {
    display: grid;
    gap: 12px;
    margin-bottom: 20px;
    padding-bottom: 20px;
    border-bottom: 1px solid rgba(255,255,255,0.055);
  }
  .connection-field { min-width: 0; }
  .connection-field .settings-label { margin-bottom: 6px; }
  .connection-input {
    display: block;
    width: 100%;
    min-width: 0;
    height: 38px;
    padding: 0 10px;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 11px;
    background: rgba(0,0,0,0.2);
    color: #e5e5ea;
    font: inherit;
    font-size: 13px;
  }
  select.connection-input { color-scheme: dark; }
  select.connection-input option { background: #1c1c1e; color: #e5e5ea; }
  .connection-input:focus-visible { outline: none; border-color: rgba(212,180,131,0.4); box-shadow: 0 0 0 3px rgba(212,180,131,0.06); }
  .model-trigger { display:flex; align-items:center; justify-content:space-between; gap:10px; text-align:left; cursor:pointer; }
  .model-trigger span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .model-trigger svg { flex:0 0 auto; }
  .model-status {
    display: block;
    margin-top: 6px;
    font-size: 11px;
    color: #99999f;
    overflow-wrap: anywhere;
  }
  .model-status--error { color: #e7a3a3; }

  .settings-panel-footer {
    flex-shrink: 0;
    padding: 8px 12px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid rgba(255,255,255,0.055);
  }

  /* ---------- Settings primitives (mirrors the main Settings page) ---------- */

  .settings-card {
    background: transparent;
    border: 0;
    border-radius: 0;
    padding: 0;
  }

  @media (max-width: 639px) {
    .settings-overlay { align-items: flex-end; }
    .settings-panel {
      height: min(calc(var(--app-visible-height, 100dvh) * 0.82), 720px);
      max-height: calc(var(--app-visible-height, 100dvh) - env(safe-area-inset-top) - 12px);
      border-top: 1px solid rgba(255,255,255,0.12);
      border-radius: 18px 18px 0 0;
    }
    .settings-panel-header { padding: 10px 14px 9px 16px; }
    .settings-panel-body { padding: 12px 12px 16px; }
    .settings-panel-footer { padding: 5px 10px calc(6px + env(safe-area-inset-bottom)); }
    .settings-divider { margin: 16px 0; }
    .connection-card { gap: 10px; margin-bottom: 16px; padding-bottom: 16px; }
    .sampling-subheading { margin: 7px 0 9px; }
  }

  @media (max-width: 639px) and (max-height: 500px) {
    .settings-panel { height: calc(var(--app-visible-height, 100dvh) * 0.92); }
  }

  .settings-label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #68686d;
    margin-bottom: 8px;
  }

  .settings-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 20px 0;
  }

  .sampling-divider {
    display: flex;
    align-items: center;
    gap: 10px;
    margin: 6px 0 2px;
  }
  .sampling-divider-line {
    flex: 1;
    height: 1px;
    background: rgba(255,255,255,0.07);
  }
  .sampling-subheading {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #6b6b6e;
    white-space: nowrap;
    margin: 10px 0 15px 0;
  }

  /* ---------- Power-user toggle (footer) ---------- */

  .power-user-toggle {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
    padding: 8px 10px;
    border-radius: 10px;
    transition: background 0.15s;
    user-select: none;
  }
  .power-user-toggle:hover { background: rgba(255,255,255,0.04); }

  .power-icon {
    width: 30px;
    height: 30px;
    justify-content: center;
    border-radius: 9px;
    color: #57575c;
    background: rgba(255,255,255,0.035);
    transition: color 0.2s;
    display: flex;
    align-items: center;
  }
  .power-icon.active { color: #d4b483; background: rgba(212,180,131,0.09); }
  .power-label {
    font-size: 12px;
    font-weight: 600;
    color: #d1cfd2;
    flex: 1;
    letter-spacing: 0.03em;
  }
  .power-track {
    position: relative;
    flex-shrink: 0;
    width: 36px;
    height: 20px;
    border-radius: 9999px;
    transition: background 0.2s, border-color 0.2s;
    background: rgba(255,255,255,0.07);
    border: 1px solid rgba(255,255,255,0.08);
  }
</style>
