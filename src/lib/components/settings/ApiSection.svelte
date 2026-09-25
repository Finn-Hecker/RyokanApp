<script lang="ts">
  import { activateApiConnection, appState, createDefaultConnection, type ProviderKind } from "$lib/stores/appState.svelte";
  import { fetchModels, saveSetting, type ModelInfo } from "$lib/utils/settings";
  import * as m from "$lib/paraglide/messages";
  import Tooltip from '$lib/components/ui/Tooltip.svelte';
  import { onMount, tick, untrack } from 'svelte';
  import { registerBackHandler } from '$lib/stores/navigation';
  import {
    curatedProviderGroupForModel,
    curatedProviderGroups,
    type CuratedProviderGroupId,
  } from '$lib/utils/modelProviderGroups';
  import { deleteConnectionSafely, ensureContextDetection, invalidateDetectedContext, normalizeSummaryConnectionId, refreshContextDetection, resolvedHardContextLimit, SAME_AS_CHAT_CONNECTION } from '$lib/utils/apiConnections';
  import { resolvedWorkingContextTarget, resolveSummaryConnection } from '$lib/utils/connectionCore';

  const NEW_CONNECTION_ACTION = '__new_connection__';

  let {
    powerUser = false,
    active = false,
    section = 'provider',
    settingsReady = false,
    onConnectionChange = (_previousConnectionId: string) => {},
  }: {
    powerUser?: boolean;
    active?: boolean;
    section?: 'provider' | 'memory';
    settingsReady?: boolean;
    onConnectionChange?: (previousConnectionId: string) => void;
  } = $props();

  type ProviderTab = 'local' | 'cloud';

  type Provider = {
    label: string;
    url: string;
    badge: () => string;
    icon: 'desktop' | 'cloud' | 'terminal' | 'ollama' | 'kobold' | 'openai' | 'grok';
    tab: ProviderTab;
    keyPlaceholder?: string;
    kind: ProviderKind;
  };

  const PROVIDERS: Provider[] = [
    { label: "LM Studio",  kind: 'lm_studio', url: "http://127.0.0.1:1234/v1", badge: () => m.settings_provider_badge_local(), icon: 'desktop', tab: 'local' },
    { label: "Ollama", kind: 'ollama', url: "http://127.0.0.1:11434/v1", badge: () => m.settings_provider_badge_local(), icon: 'ollama', tab: 'local' },
    { label: "KoboldCPP", kind: 'koboldcpp', url: "http://127.0.0.1:5001/v1", badge: () => m.settings_provider_badge_local(), icon: 'kobold', tab: 'local' },
    { label: "llama.cpp", kind: 'llama_cpp', url: "http://127.0.0.1:8080/v1", badge: () => m.settings_provider_badge_local(), icon: 'terminal', tab: 'local' },

    { label: "OpenRouter", kind: 'openrouter', url: "https://openrouter.ai/api/v1", badge: () => m.settings_provider_badge_cloud(), icon: 'cloud', tab: 'cloud', keyPlaceholder: "sk-or-..." },
    { label: "OpenAI", kind: 'openai', url: "https://api.openai.com/v1", badge: () => m.settings_provider_badge_cloud(), icon: 'openai', tab: 'cloud', keyPlaceholder: "sk-..." },
    { label: "Grok", kind: 'xai', url: "https://api.x.ai/v1", badge: () => m.settings_provider_badge_cloud(), icon: 'grok', tab: 'cloud', keyPlaceholder: "xai-..." },
  ];

  let availableModels = $state<string[]>([]);
  let modelMetadata = $state<Record<string, ModelInfo>>({});
  let modelsLoading   = $state(false);
  let modelsError     = $state("");
  let modelMenuOpen   = $state(false);
  let modelSearch     = $state("");
  let activeModelCategory = $state("all");
  let favoriteModels = $state<string[]>([]);
  let modelResultsReady = $state(false);
  let lastAttemptedModelConfig = "";
  let modelLoadRequest = 0;
  let modelPreparationRequest = 0;
  let detectingContext = $state(false);
  let connectionMenuOpen = $state(false);
  let renamingConnection = $state(false);
  let renameValue = $state('');
  let confirmingConnectionDelete = $state(false);
  let renameInput = $state<HTMLInputElement>();

  const summaryConnection = $derived(resolveSummaryConnection(appState.apiConnections, appState.summaryConnectionId, appState.apiSettings));
  const workingContextBudget = $derived(resolvedWorkingContextTarget(appState.apiSettings));
  const summaryContextLimit = $derived(resolvedHardContextLimit(summaryConnection));

  $effect(() => {
    if (!settingsReady || (!active && section !== 'memory')) return;
    const chat = appState.apiSettings;
    const summary = summaryConnection;
    // Only identity changes retrigger detection, not the metadata it writes.
    const identities = [chat, summary].map(connection =>
      [connection.id, connection.providerKind, connection.url, connection.model, connection.apiKey].join('\n'));
    void identities;
    const memoryEnabled = appState.longTermMemory;
    let disposed = false;
    untrack(() => {
      detectingContext = true;
      void Promise.all([ensureContextDetection(chat),
        ...(memoryEnabled && summary.id !== chat.id ? [ensureContextDetection(summary)] : [])
      ]).finally(() => { if (!disposed) detectingContext = false; });
    });
    return () => { disposed = true; };
  });

  $effect(() => {
    if (!modelMenuOpen) return;
    return registerBackHandler(() => {
      closeModelPicker();
      return true;
    });
  });

  type ModelCategory = {
    id: string;
    label: string;
    kind: "all" | "free" | "favorites" | "provider";
    providerGroup?: CuratedProviderGroupId | null;
  };

  const SPECIAL_MODEL_CATEGORIES: ModelCategory[] = [
    { id: "all", label: m.settings_model_category_all(), kind: "all" },
  ];

  const FAVORITES_STORAGE_KEY = "ryokan-favorite-models";
  const MODEL_RENDER_BATCH_SIZE = 50;
  let renderedModelCount = $state(MODEL_RENDER_BATCH_SIZE);

  onMount(() => {
    try {
      const stored = JSON.parse(localStorage.getItem(FAVORITES_STORAGE_KEY) ?? "[]");
      if (Array.isArray(stored)) favoriteModels = stored.filter((value): value is string => typeof value === "string");
    } catch {
      favoriteModels = [];
    }
  });

  function modelProviderKey(modelId: string): string {
    const normalized = modelId.trim().toLowerCase();
    const slashPrefix = normalized.split("/", 1)[0].replace(/^~+/, "");
    if (normalized.includes("/") && slashPrefix) return slashPrefix;

    // OpenAI-compatible local APIs often return an unnamespaced model ID. In
    // that case, use its leading model-family prefix instead of inventing a vendor.
    const familyPrefix = normalized.match(/^[a-z]+/)?.[0];
    return familyPrefix || normalized;
  }

  function modelProviderLabel(providerKey: string): string {
    const label = providerKey
      .split(/[-_.]+/)
      .filter(Boolean)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
    return label.replace(/\bOpenai\b/g, "OpenAI").replace(/\bDeepseek\b/g, "DeepSeek");
  }

  function scrollDesktopCategories(event: WheelEvent) {
    if (!window.matchMedia("(min-width: 768px)").matches) return;
    const categories = event.currentTarget as HTMLElement;
    if (categories.scrollWidth <= categories.clientWidth || Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
    categories.scrollLeft += event.deltaY;
    event.preventDefault();
  }

  const availableProviderGroups = $derived.by(() => {
    const presentGroups = new Set<CuratedProviderGroupId>();
    let hasOtherModels = false;
    for (const modelId of availableModels) {
      const group = curatedProviderGroupForModel(modelMetadata[modelId] ?? { id: modelId });
      if (group) presentGroups.add(group.id);
      else hasOtherModels = true;
    }
    return {
      curated: curatedProviderGroups.filter(group => presentGroups.has(group.id)),
      hasOthers: hasOtherModels,
    };
  });

  const hasFreeModels = $derived(availableModels.some(modelId => isFreeModel(modelId)));
  const hasFavoriteModels = $derived(availableModels.some(modelId => favoriteModels.includes(modelId)));

  const modelCategoryTabs = $derived<ModelCategory[]>([
    ...SPECIAL_MODEL_CATEGORIES,
    ...(hasFreeModels ? [{ id: "free", label: m.settings_model_category_free(), kind: "free" as const }] : []),
    ...(hasFavoriteModels ? [{ id: "favorites", label: m.settings_model_category_favorites(), kind: "favorites" as const }] : []),
    ...availableProviderGroups.curated.map(group => ({
      id: `provider:${group.id}`,
      label: group.label,
      kind: "provider" as const,
      providerGroup: group.id,
    })),
    ...(availableProviderGroups.hasOthers ? [{
      id: "provider:others",
      label: m.settings_model_category_others(),
      kind: "provider" as const,
      providerGroup: null,
    }] : []),
  ]);

  // Shared by both responsive presentations so their filter behavior stays identical.
  const visibleModels = $derived.by(() => {
    const query = modelSearch.trim().toLowerCase();
    const category = modelCategoryTabs.find(item => item.id === activeModelCategory) ?? modelCategoryTabs[0];
    return availableModels.filter(modelId => {
      const matchesSearch = !query || modelId.toLowerCase().includes(query);
      const modelGroup = curatedProviderGroupForModel(modelMetadata[modelId] ?? { id: modelId });
      // Search is intentionally global, regardless of the currently selected browse group.
      const matchesCategory = Boolean(query)
        || category.kind === "all"
        || (category.kind === "free" && isFreeModel(modelId))
        || (category.kind === "favorites" && favoriteModels.includes(modelId))
        || (category.kind === "provider" && (modelGroup?.id ?? null) === category.providerGroup);
      return matchesSearch && matchesCategory;
    });
  });

  const renderedModels = $derived(visibleModels.slice(0, renderedModelCount));

  function updateModelSearch(event: Event) {
    modelSearch = (event.currentTarget as HTMLInputElement).value;
    renderedModelCount = MODEL_RENDER_BATCH_SIZE;
  }

  function selectModelCategory(categoryId: string) {
    activeModelCategory = categoryId;
    renderedModelCount = MODEL_RENDER_BATCH_SIZE;
  }

  function observeModelListEnd(node: HTMLElement) {
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      renderedModelCount = Math.min(
        renderedModelCount + MODEL_RENDER_BATCH_SIZE,
        visibleModels.length,
      );
    }, { root: node.parentElement, rootMargin: "200px 0px" });

    observer.observe(node);
    return { destroy: () => observer.disconnect() };
  }

  const activeProvider = $derived(
    PROVIDERS.find(p => p.kind === appState.apiSettings.providerKind) ?? null
  );

  const activeTab = $derived<ProviderTab>(
    appState.apiSettings.providerKind === 'generic_openai'
      ? 'cloud'
      : (activeProvider?.tab ?? (
          appState.apiSettings.url.includes('127.0.0.1') ||
          appState.apiSettings.url.includes('localhost') ? 'local' : 'cloud'
        ))
  );

  const filteredProviders = $derived(PROVIDERS.filter(p => p.tab === activeTab));

  const showUrl = $derived(powerUser || appState.apiSettings.customMode);
  const showKey = $derived(powerUser || activeTab === 'cloud' || appState.apiSettings.customMode);

  const keyPlaceholder = $derived(activeProvider?.keyPlaceholder ?? "sk-...");
  const isOpenRouter = $derived(appState.apiSettings.providerKind === 'openrouter');

  function switchTab(tab: ProviderTab) {
    if (activeTab === tab) return;
    appState.apiSettings.customMode = false;
    const first = PROVIDERS.find(p => p.tab === tab);
    if (first) selectProvider(first);
  }

  function selectProvider(provider: Provider) {
    modelLoadRequest++;
    lastAttemptedModelConfig = "";
    appState.apiSettings.customMode = false;
    appState.apiSettings.providerKind = provider.kind;
    appState.apiSettings.url   = provider.url;
    appState.apiSettings.model = "";
    invalidateDetectedContext(appState.apiSettings);
    availableModels = [];
    modelMetadata   = {};
    modelsError     = "";
    modelMenuOpen   = false;
    modelSearch     = "";
    activeModelCategory = "all";
  }

  function selectCustom() {
    modelLoadRequest++;
    lastAttemptedModelConfig = "";
    appState.apiSettings.customMode = true;
    appState.apiSettings.providerKind = 'generic_openai';
    appState.apiSettings.url   = "";
    appState.apiSettings.model = "";
    invalidateDetectedContext(appState.apiSettings);
    availableModels = [];
    modelMetadata   = {};
    modelsError     = "";
    modelMenuOpen   = false;
    modelSearch     = "";
    activeModelCategory = "all";
  }

  function modelConfigKey() {
    return `${appState.apiSettings.url.trim()}\n${appState.apiSettings.apiKey.trim()}`;
  }

  function canFetchModels() {
    if (!appState.apiSettings.url.trim()) return false;
    return appState.apiSettings.customMode || activeTab === 'local' || Boolean(appState.apiSettings.apiKey.trim());
  }

  async function loadModels() {
    if (!canFetchModels()) return;

    const config = modelConfigKey();
    const request = ++modelLoadRequest;
    lastAttemptedModelConfig = config;
    modelsLoading = true;
    modelsError   = "";
    availableModels = [];
    modelMetadata = {};
    modelSearch = "";
    activeModelCategory = "all";
    try {
      const models = await fetchModels(appState.apiSettings.url, appState.apiSettings.apiKey);
      if (request !== modelLoadRequest || config !== modelConfigKey()) return;
      if (models.length === 0) {
        modelsError = m.settings_model_error_no_models();
      } else {
        availableModels = models.map(model => model.id);
        modelMetadata = Object.fromEntries(models.map(model => [model.id, model]));
        if (!availableModels.includes(appState.apiSettings.model)) {
          invalidateDetectedContext(appState.apiSettings);
          appState.apiSettings.model = availableModels[0];
        }
        await saveSetting("api_model", appState.apiSettings.model);
      }
    } catch (e: any) {
      if (request !== modelLoadRequest || config !== modelConfigKey()) return;
      modelsError = m.settings_model_error_fetch({ error: e.message || String(e) });
    } finally {
      if (request === modelLoadRequest) modelsLoading = false;
    }
  }

  function retryModels() {
    lastAttemptedModelConfig = "";
    void loadModels();
  }

  $effect(() => {
    const config = modelConfigKey();
    if (!active || !settingsReady || !canFetchModels() || config === lastAttemptedModelConfig) return;

    const timeout = window.setTimeout(() => void loadModels(), 400);
    return () => window.clearTimeout(timeout);
  });

  async function selectModel(modelId: string) {
    if (appState.apiSettings.model !== modelId) invalidateDetectedContext(appState.apiSettings);
    appState.apiSettings.model = modelId;
    modelMenuOpen = false;
    modelSearch = "";
    await saveSetting("api_model", modelId);
  }

  function selectConnection(id: string) {
    if (id === NEW_CONNECTION_ACTION) { createConnection(); return; }
    connectionMenuOpen = false;
    renamingConnection = false;
    confirmingConnectionDelete = false;
    const previousConnectionId = appState.activeApiConnectionId;
    if (!activateApiConnection(id)) return;
    onConnectionChange(previousConnectionId);
    availableModels = [];
    modelMetadata = {};
    lastAttemptedModelConfig = '';
  }

  function createConnection() {
    connectionMenuOpen = false;
    const connection = createDefaultConnection(crypto.randomUUID(), m.settings_connection_default_name({ number: String(appState.apiConnections.length + 1) }));
    appState.apiConnections.push(connection);
    selectConnection(connection.id);
  }

  function deleteConnection() {
    confirmingConnectionDelete = false;
    const deletedId = appState.activeApiConnectionId;
    const result = deleteConnectionSafely(appState.apiConnections, deletedId, deletedId);
    appState.apiConnections = result.connections;
    appState.summaryConnectionId = normalizeSummaryConnectionId(result.connections, appState.summaryConnectionId);
    selectConnection(result.activeId);
  }

  async function startConnectionRename() {
    connectionMenuOpen = false;
    renameValue = appState.apiSettings.name;
    renamingConnection = true;
    await tick();
    renameInput?.focus();
    renameInput?.select();
  }

  function finishConnectionRename() {
    const name = renameValue.trim();
    if (name) appState.apiSettings.name = name;
    renamingConnection = false;
  }

  function handleRenameKeydown(event: KeyboardEvent) {
    if (event.key === 'Enter') { event.preventDefault(); finishConnectionRename(); }
    if (event.key === 'Escape') { event.preventDefault(); renamingConnection = false; }
  }

  function handleConnectionMenuClick(event: MouseEvent) {
    if (!(event.target as HTMLElement).closest('.connection-menu-wrap')) connectionMenuOpen = false;
  }

  function handleIdentityChange() {
    availableModels = []; modelMetadata = {}; appState.apiSettings.model = ''; modelsError = '';
    invalidateDetectedContext(appState.apiSettings);
  }

  async function detectContext() {
    detectingContext = true;
    await refreshContextDetection(appState.apiSettings);
    detectingContext = false;
  }

  function formatTokens(tokens: number): string {
    if (tokens >= 1_000_000 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
    if (tokens >= 1024 && tokens % 1024 === 0) return `${tokens / 1024}K`;
    return tokens.toLocaleString();
  }

  function toggleFavorite(modelId: string) {
    const nextFavoriteModels = favoriteModels.includes(modelId)
      ? favoriteModels.filter(id => id !== modelId)
      : [...favoriteModels, modelId];
    favoriteModels = nextFavoriteModels;
    if (
      activeModelCategory === "favorites"
      && !availableModels.some(id => nextFavoriteModels.includes(id))
    ) {
      activeModelCategory = "all";
      renderedModelCount = MODEL_RENDER_BATCH_SIZE;
    }
    try {
      localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(favoriteModels));
    } catch {
      // Favorites remain usable for the session if device storage is unavailable.
    }
  }

  function pricePerMillion(value: string | null | undefined): number | null {
    if (value == null || value.trim() === "") return null;
    const parsed = Number(value) * 1_000_000;
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  function formatPrice(value: number): string {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      minimumFractionDigits: value > 0 && value < 1 ? 2 : 0,
      maximumFractionDigits: value < 1 ? 4 : 2,
    }).format(value);
  }

  function modelPriceLabel(modelId: string): string {
    if (!isOpenRouter) return "";
    const pricing = modelMetadata[modelId]?.pricing;
    const input = pricePerMillion(pricing?.prompt);
    const output = pricePerMillion(pricing?.completion);
    if (input === null || output === null || (input === 0 && output === 0)) return "";
    return `${formatPrice(input)}/M input · ${formatPrice(output)}/M output`;
  }

  function isFreeModel(modelId: string): boolean {
    const pricing = modelMetadata[modelId]?.pricing;
    return pricePerMillion(pricing?.prompt) === 0 && pricePerMillion(pricing?.completion) === 0;
  }

  function contextLabel(modelId: string): string {
    if (!isOpenRouter) return "";
    const contextLength = modelMetadata[modelId]?.contextLength;
    if (!contextLength || contextLength <= 0) return "";
    if (contextLength >= 1_000_000 && contextLength % 1_000_000 === 0) return `${contextLength / 1_000_000}M context`;
    if (contextLength >= 1024 && contextLength % 1024 === 0) return `${contextLength / 1024}K context`;
    return `${contextLength.toLocaleString()} context`;
  }

  function afterNextPaint(): Promise<void> {
    return new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
  }

  async function prepareModelResultsAfterPaint(request: number) {
    await tick();
    await afterNextPaint();
    if (request !== modelPreparationRequest || !modelMenuOpen) return;
    modelResultsReady = true;
  }

  function toggleModelMenu() {
    modelMenuOpen = !modelMenuOpen;
    if (modelMenuOpen) {
      activeModelCategory = "all";
      renderedModelCount = MODEL_RENDER_BATCH_SIZE;
      modelResultsReady = false;
      void prepareModelResultsAfterPaint(++modelPreparationRequest);
    } else {
      modelPreparationRequest++;
      modelResultsReady = false;
    }
  }

  function closeModelPicker() {
    modelPreparationRequest++;
    modelMenuOpen = false;
    modelResultsReady = false;
    modelSearch = "";
  }

  function handleModelBackdropClick(event: MouseEvent) {
    if (event.target === event.currentTarget) closeModelPicker();
  }

  function handleModelMenuKeydown(event: KeyboardEvent) {
    if (event.key === "Escape" && modelMenuOpen) closeModelPicker();
  }

</script>

<svelte:window onkeydown={handleModelMenuKeydown} onclick={handleConnectionMenuClick} />

<section>
  {#if section === 'provider'}
  <span class="settings-section-title">{m.settings_section_api()}</span>
  <div class="settings-card provider-settings">

    <div class="connection-management">
      <label class="settings-label" for="active-connection">{m.settings_connection_label()}</label>
      <div class="connection-toolbar">
        <select id="active-connection" class="settings-input" value={appState.activeApiConnectionId} onchange={(event) => selectConnection(event.currentTarget.value)}>
          {#each appState.apiConnections as connection (connection.id)}
            <option value={connection.id}>{connection.name}</option>
          {/each}
          <option disabled>──────────</option>
          <option value={NEW_CONNECTION_ACTION}>{m.settings_connection_new()}</option>
        </select>
        <div class="connection-menu-wrap">
          <button type="button" class="connection-action connection-more" aria-label={m.settings_connection_options()} aria-haspopup="menu" aria-expanded={connectionMenuOpen} onclick={() => connectionMenuOpen = !connectionMenuOpen}>⋯</button>
          {#if connectionMenuOpen}
            <div class="connection-menu" role="menu" aria-label={m.settings_connection_options()}>
              <button type="button" role="menuitem" onclick={startConnectionRename}>{m.settings_connection_rename()}</button>
              <button type="button" role="menuitem" class="danger" disabled={appState.apiConnections.length <= 1} onclick={() => { connectionMenuOpen = false; confirmingConnectionDelete = true; }}>{m.settings_connection_delete()}</button>
            </div>
          {/if}
        </div>
      </div>
      {#if renamingConnection}
        <div class="connection-inline-edit">
          <input bind:this={renameInput} class="settings-input" aria-label={m.settings_connection_name()} bind:value={renameValue} maxlength="80" onkeydown={handleRenameKeydown} />
          <button type="button" class="connection-action" onclick={finishConnectionRename}>{m.settings_btn_save()}</button>
          <button type="button" class="connection-text-action" onclick={() => renamingConnection = false}>{m.settings_connection_cancel()}</button>
        </div>
      {/if}
      {#if confirmingConnectionDelete}
        <div class="connection-delete-confirm" role="group" aria-label={m.settings_connection_confirm_delete()}>
          <span>{m.settings_connection_delete_prompt({ name: appState.apiSettings.name })}</span>
          <button type="button" class="connection-text-action" onclick={() => confirmingConnectionDelete = false}>{m.settings_connection_cancel()}</button>
          <button type="button" class="connection-action danger" onclick={deleteConnection}>{m.settings_connection_delete()}</button>
        </div>
      {/if}
    </div>

    <div class="settings-divider"></div>

    <div class="api-model-section">
    <h2 class="api-model-section-title">{m.settings_provider_label()}</h2>

    <div class="tab-switcher">
      <button
        class="tab-btn {activeTab === 'local' ? 'tab-btn--active' : ''}"
        onclick={() => switchTab('local')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <rect x="3" y="12" width="18" height="9" rx="2"/>
          <path d="M3 8h18M7 4h10M12 12v9" stroke-linecap="round"/>
        </svg>
        {m.settings_provider_badge_local()}
      </button>
      <button
        class="tab-btn {activeTab === 'cloud' ? 'tab-btn--active' : ''}"
        onclick={() => switchTab('cloud')}
      >
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        {m.settings_provider_badge_cloud()}
      </button>
    </div>

    <div>
      <div class="provider-grid" class:provider-grid--4={activeTab === 'cloud'}>

        {#each filteredProviders as provider (provider.url)}
          <button
            onclick={() => selectProvider(provider)}
            class="provider-btn {appState.apiSettings.providerKind === provider.kind ? 'provider-btn--active' : ''}"
          >
            {#if provider.icon === 'desktop'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <rect x="2" y="4" width="20" height="13" rx="2"/>
                <path d="M1 20h22" stroke-linecap="round"/>
                <circle cx="12" cy="17" r="0.8" fill="currentColor"/>
              </svg>
            {:else if provider.icon === 'cloud'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                <path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z" stroke-linecap="round" stroke-linejoin="round"/>
              </svg>
            {:else if provider.icon === 'ollama'}
              <svg class="provider-icon" height="20" width="20" fill="currentColor" viewBox="0 0 640 640"><path d="M64 528L64 380.9C64 272.5 132.3 175.8 234.5 139.6L404.2 79.5C425.6 71.9 448 87.8 448 110.4C448 121.4 442.5 131.6 433.4 137.7L400 160C448.1 160 491.2 189.8 508.1 234.9L556.7 364.4C568.5 395.8 560.8 431.2 537.1 454.9C521.1 470.9 499.3 480 476.6 480L473.2 480C447.1 480 422.3 468.4 405.6 448.3L373.3 409.6C361.6 413.7 349.1 416 336 416L335.9 416C329.6 416 323.4 415.5 317.3 414.5C313.7 413.9 310.1 413.1 306.6 412.2L306.6 412.2C277.7 404.4 253.5 385.4 238.8 360C234.4 352.3 224.6 349.7 216.9 354.2C209.2 358.7 206.6 368.4 211.1 376.1C235.1 417.6 279.4 446.1 330.4 448L377.6 518.8C381.6 524.9 383.8 532 383.8 539.2C383.8 559.5 367.3 576 347 576L112 576C85.5 576 64 554.5 64 528zM392 288C405.3 288 416 277.3 416 264C416 250.7 405.3 240 392 240C378.7 240 368 250.7 368 264C368 277.3 378.7 288 392 288z"/></svg>
            {:else if provider.icon === 'terminal'}
              <svg class="provider-icon" height="20" width="20" fill="currentColor" viewBox="0 0 640 640"><path d="M64 160C64 124.7 92.7 96 128 96L512 96C547.3 96 576 124.7 576 160L576 400L512 400L512 160L128 160L128 400L64 400L64 160zM0 467.2C0 456.6 8.6 448 19.2 448L620.8 448C631.4 448 640 456.6 640 467.2C640 509.6 605.6 544 563.2 544L76.8 544C34.4 544 0 509.6 0 467.2zM281 273L250 304L281 335C290.4 344.4 290.4 359.6 281 368.9C271.6 378.2 256.4 378.3 247.1 368.9L199.1 320.9C189.7 311.5 189.7 296.3 199.1 287L247.1 239C256.5 229.6 271.7 229.6 281 239C290.3 248.4 290.4 263.6 281 272.9zM393 239L441 287C450.4 296.4 450.4 311.6 441 320.9L393 368.9C383.6 378.3 368.4 378.3 359.1 368.9C349.8 359.5 349.7 344.3 359.1 335L390.1 304L359.1 273C349.7 263.6 349.7 248.4 359.1 239.1C368.5 229.8 383.7 229.7 393 239.1z"/></svg>
            {:else if provider.icon === 'kobold'}
              <svg class="provider-icon" height="20" width="20" fill="currentColor" viewBox="0 0 640 640"><path d="M352 188.5L300.1 175.5C293.6 173.9 288.8 168.4 288.1 161.7C287.4 155 290.9 148.6 296.8 145.6L337.6 125.2L294.3 92.7C288.8 88.6 286.5 81.4 288.7 74.8C290.9 68.2 297.1 64 304 64L464 64C494.2 64 522.7 78.2 540.8 102.4L598.4 179.2C604.6 187.5 608 197.6 608 208C608 234.5 586.5 256 560 256L538.5 256C521.5 256 505.2 249.3 493.2 237.3L479.9 224L447.9 224L447.9 245.5C447.9 270.3 460.7 293.4 481.7 306.6L588.3 373.2C620.4 393.3 639.9 428.4 639.9 466.3C639.9 526.9 590.8 576.1 530.1 576.1L32.3 576C29 576 25.7 575.6 22.7 574.6C13.5 571.8 6 565 2.3 556C1 552.7 .1 549.1 0 545.3C-.2 541.6 .3 538 1.3 534.6C4.1 525.4 10.9 517.9 19.9 514.2C22.9 513 26.1 512.2 29.4 512L433.3 476C441.6 475.3 448 468.3 448 459.9C448 455.6 446.3 451.5 443.3 448.5L398.9 404.1C368.9 374.1 352 333.4 352 291L352 188.5zM512 136.3C512 136.2 512 136.1 512 136C512 135.9 512 135.8 512 135.7L512 136.3zM510.7 143.7L464.3 132.1C464.1 133.4 464 134.7 464 136C464 149.3 474.7 160 488 160C498.6 160 507.5 153.2 510.7 143.7zM130.9 180.5C147.2 166 171.3 164.3 189.4 176.4L320 263.4L320 290.9C320 323.7 328.4 355.7 344 383.9L112 383.9C105.3 383.9 99.3 379.7 97 373.5C94.7 367.3 96.5 360.2 101.6 355.8L171 296.3L18.4 319.8C11.4 320.9 4.5 317.2 1.5 310.8C-1.5 304.4 .1 296.8 5.4 292L130.9 180.5z"/></svg>
            {:else if provider.icon === 'openai'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.985 5.985 0 0 0-3.998 2.9 6.046 6.046 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0L4.04 14.11A4.501 4.501 0 0 1 2.34 7.896zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.778 2.758a4.5 4.5 0 0 1-.676 8.116v-5.678a.79.79 0 0 0-.395-.645zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.78-2.758a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z"/>
              </svg>
            {:else if provider.icon === 'grok'}
              <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            {/if}
            <span class="provider-label">{provider.label}</span>
          </button>
        {/each}

        {#if activeTab === 'cloud'}
          <button onclick={selectCustom} class="provider-btn {appState.apiSettings.customMode ? 'provider-btn--active' : ''}">
            <svg class="provider-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
              <circle cx="12" cy="12" r="3"/>
              <path d="M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83" stroke-linecap="round"/>
            </svg>
            <span class="provider-label">{m.settings_api_custom_provider_label()}</span>
          </button>
        {/if}

      </div>
    </div>

    {#if showUrl}
      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-url">{m.settings_api_url_label()}</label>
        <input
          id="api-url"
          type="text"
          bind:value={appState.apiSettings.url}
          placeholder={appState.apiSettings.customMode ? "https://my-provider.com/v1" : undefined}
          onchange={handleIdentityChange}
          class="settings-input"
        />
      </div>
    {/if}

    {#if showKey}
      <div class="settings-divider"></div>

      <div>
        <label class="settings-label" for="api-key">
          {m.settings_api_key_label()}
          {#if activeTab === 'local' && !appState.apiSettings.customMode}
            <span class="optional-badge">{m.settings_api_key_optional()}</span>
          {/if}
        </label>
        <input
          id="api-key"
          type="password"
          bind:value={appState.apiSettings.apiKey}
          placeholder={keyPlaceholder}
          class="settings-input"
        />
      </div>
    {/if}

    </div>

    <div class="api-model-section api-model-section--model">
    <h2 class="api-model-section-title">{m.settings_category_model()}</h2>

    <div>
      <div class="flex items-center justify-between mb-2">
        <label class="settings-label" for="model-select" style="margin-bottom:0">
          {m.settings_model_label()}
        </label>
      </div>

      {#if canFetchModels() && !modelsError}
        <div class="model-picker">
          <button
            id="model-select"
            type="button"
            class="settings-input model-picker-trigger"
            aria-haspopup="listbox"
            aria-expanded={modelMenuOpen}
            onclick={toggleModelMenu}
          >
            <span>{appState.apiSettings.model || m.settings_model_loading()}</span>
            <svg class:rotated={modelMenuOpen} width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
              <path d="M6 9l6 6 6-6"/>
            </svg>
          </button>

          {#if modelMenuOpen}
            <div class="desktop-model-backdrop" role="presentation" onclick={handleModelBackdropClick}></div>
            <div class="desktop-model-browser" role="dialog" aria-modal="true" aria-labelledby="desktop-model-browser-title">
              <header class="desktop-model-header">
                <div><h3 id="desktop-model-browser-title">{m.settings_model_select_title()}</h3><p>{m.settings_model_available_count({ count: String(availableModels.length) })}</p></div>
                <button type="button" class="model-sheet-close" aria-label={m.settings_model_close()} onclick={closeModelPicker}><svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg></button>
              </header>
              <div class="desktop-model-controls">
              <div class="model-search-wrap">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5" stroke-linecap="round"/>
                </svg>
                <input
                  class="model-search"
                  type="search"
                  value={modelSearch}
                  oninput={updateModelSearch}
                  placeholder={m.settings_model_search_placeholder()}
                  aria-label={m.settings_model_search_placeholder()}
                />
              </div>
                <div class="model-category-tabs desktop-category-tabs" role="tablist" aria-label={m.settings_model_categories()} onwheel={scrollDesktopCategories}>
                  {#if modelResultsReady}
                    {#each modelCategoryTabs as category (category.id)}<button type="button" role="tab" aria-selected={activeModelCategory === category.id} class="model-category-tab" class:model-category-tab--active={activeModelCategory === category.id} onclick={() => selectModelCategory(category.id)}>{category.label}</button>{/each}
                  {/if}
                </div>
              </div>
              <div class="desktop-model-list" role="listbox" aria-label={m.settings_model_label()}>
                {#if !modelResultsReady || modelsLoading || availableModels.length === 0}
                  <div class="model-list-loading" role="status" aria-live="polite" aria-label={m.settings_model_loading()}>
                    {#each Array(6) as _}<div class="model-row-skeleton"></div>{/each}
                  </div>
                {:else}
                  {#each renderedModels as modelId (modelId)}
                    <div class="desktop-model-row" class:desktop-model-row--selected={appState.apiSettings.model === modelId}>
                      <button type="button" role="option" aria-selected={appState.apiSettings.model === modelId} class="desktop-model-select" onclick={() => selectModel(modelId)}>
                        <span class="desktop-model-identity">
                          <span class="desktop-model-name">{modelId}</span>
                          <span class="desktop-model-meta">
                            <span class="desktop-model-provider">{modelProviderLabel(modelProviderKey(modelId))}</span>
                            {#if isFreeModel(modelId)}<span class="free-badge">{m.settings_model_category_free()}</span>{/if}
                            {#if modelPriceLabel(modelId)}<span class="desktop-meta-badge">{modelPriceLabel(modelId)}</span>{/if}
                            {#if contextLabel(modelId)}<span class="desktop-meta-badge">{contextLabel(modelId)}</span>{/if}
                          </span>
                        </span>
                        {#if appState.apiSettings.model === modelId}<span class="desktop-selected-mark"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>{/if}
                      </button>
                      <button type="button" class="desktop-favorite-btn" class:desktop-favorite-btn--active={favoriteModels.includes(modelId)} aria-label={favoriteModels.includes(modelId) ? m.settings_model_unfavorite({ model: modelId }) : m.settings_model_favorite({ model: modelId })} aria-pressed={favoriteModels.includes(modelId)} onclick={() => toggleFavorite(modelId)}><svg width="19" height="19" viewBox="0 0 24 24" fill={favoriteModels.includes(modelId) ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" stroke-linejoin="round"/></svg></button>
                    </div>
                  {:else}<div class="model-no-results desktop-model-no-results">{m.settings_model_search_empty()}</div>{/each}
                  {#if renderedModels.length < visibleModels.length}
                    <div class="model-list-sentinel" use:observeModelListEnd aria-hidden="true"></div>
                  {/if}
                {/if}
              </div>
            </div>

            <div class="model-sheet-backdrop" role="presentation" onclick={handleModelBackdropClick}></div>
            <div class="mobile-model-sheet" role="dialog" aria-modal="true" aria-labelledby="mobile-model-sheet-title">
              <div class="model-sheet-handle" aria-hidden="true"></div>
              <div class="model-sheet-toolbar">
                <div class="model-sheet-heading">
                  <h3 id="mobile-model-sheet-title">{m.settings_model_select_title()}</h3>
                  <button type="button" class="model-sheet-close" aria-label={m.settings_model_close()} onclick={closeModelPicker}>
                    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12" stroke-linecap="round"/></svg>
                  </button>
                </div>

                <div class="model-search-wrap model-sheet-search">
                  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
                    <circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5" stroke-linecap="round"/>
                  </svg>
                  <input
                    class="model-search"
                    type="search"
                    value={modelSearch}
                    oninput={updateModelSearch}
                    placeholder={m.settings_model_search_placeholder()}
                    aria-label={m.settings_model_search_placeholder()}
                  />
                </div>

                <div class="model-category-tabs" role="tablist" aria-label={m.settings_model_categories()}>
                  {#if modelResultsReady}
                    {#each modelCategoryTabs as category (category.id)}
                      <button
                        type="button"
                        role="tab"
                        aria-selected={activeModelCategory === category.id}
                        class="model-category-tab"
                        class:model-category-tab--active={activeModelCategory === category.id}
                        onclick={() => selectModelCategory(category.id)}
                      >{category.label}</button>
                    {/each}
                  {/if}
                </div>
              </div>

              <div class="mobile-model-list" role="listbox" aria-label={m.settings_model_label()}>
                {#if !modelResultsReady || modelsLoading || availableModels.length === 0}
                  <div class="model-list-loading" role="status" aria-live="polite" aria-label={m.settings_model_loading()}>
                    {#each Array(6) as _}<div class="model-row-skeleton"></div>{/each}
                  </div>
                {:else}
                  {#each renderedModels as modelId (modelId)}
                    <div class="mobile-model-row" class:mobile-model-row--selected={appState.apiSettings.model === modelId}>
                      <button
                        type="button"
                        role="option"
                        aria-selected={appState.apiSettings.model === modelId}
                        class="mobile-model-select"
                        onclick={() => selectModel(modelId)}
                      >
                        <span class="mobile-model-name">{modelId}</span>
                        <span class="mobile-model-details">
                          <span class="mobile-model-provider">{modelProviderLabel(modelProviderKey(modelId))}</span>
                          {#if isFreeModel(modelId)}<span class="free-badge">{m.settings_model_category_free()}</span>{/if}
                          {#if modelPriceLabel(modelId)}<span class="mobile-model-price">{modelPriceLabel(modelId)}</span>{/if}
                          {#if contextLabel(modelId)}<span class="mobile-model-context">{contextLabel(modelId)}</span>{/if}
                        </span>
                      </button>
                      <button
                        type="button"
                        class="model-favorite-btn"
                        class:model-favorite-btn--active={favoriteModels.includes(modelId)}
                        aria-label={favoriteModels.includes(modelId) ? m.settings_model_unfavorite({ model: modelId }) : m.settings_model_favorite({ model: modelId })}
                        aria-pressed={favoriteModels.includes(modelId)}
                        onclick={() => toggleFavorite(modelId)}
                      >
                        <svg width="19" height="19" viewBox="0 0 24 24" fill={favoriteModels.includes(modelId) ? "currentColor" : "none"} stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="m12 3 2.78 5.63 6.22.9-4.5 4.39 1.06 6.2L12 17.2l-5.56 2.92 1.06-6.2L3 9.53l6.22-.9L12 3Z" stroke-linejoin="round"/></svg>
                      </button>
                      {#if appState.apiSettings.model === modelId}
                        <svg class="mobile-selected-check" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="m5 12 4 4L19 6" stroke-linecap="round" stroke-linejoin="round"/></svg>
                      {/if}
                    </div>
                  {:else}
                    <div class="model-no-results mobile-model-no-results">{m.settings_model_search_empty()}</div>
                  {/each}
                  {#if renderedModels.length < visibleModels.length}
                    <div class="model-list-sentinel" use:observeModelListEnd aria-hidden="true"></div>
                  {/if}
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {:else}
        <div class="settings-input cursor-default min-h-[42px] {modelsError ? 'error-state' : 'empty-state'}">
          {#if modelsError}
            <span class="model-error-text">{modelsError}</span>
            <button type="button" class="model-retry" onclick={retryModels}>{m.chat_retry()}</button>
          {:else if appState.apiSettings.model}
            {appState.apiSettings.model}
          {:else}
            {m.settings_model_empty_hint()}
          {/if}
        </div>
      {/if}
    </div>

    </div>

  </div>
  {:else}
  <span class="settings-section-title">{m.settings_category_memory()}</span>
  <div class="settings-card memory-settings">
    <div class="ctx-row">
      <div class="ctx-row-head">
        <span class="settings-label">{m.settings_context_label()}</span>
        <Tooltip>
          {m.settings_context_tooltip_p1()}<br><br>
          {m.settings_context_tooltip_p2()}<br><br>
          <span class="tooltip-hint">{m.settings_context_tooltip_hint()}</span>
        </Tooltip>
      </div>
      <div class="context-detection-row">
        <div class="context-amount"><strong>{formatTokens(workingContextBudget)} {m.settings_context_tokens()}</strong><span>{m.settings_context_effective()}</span></div>
      </div>
      <div class="context-secondary">
        <span>{#if appState.apiSettings.detectedContext && appState.apiSettings.detectedContext.provenance !== 'theoretical'}{m.settings_context_model_maximum({ tokens: formatTokens(appState.apiSettings.detectedContext.tokens) })}{:else}{m.settings_context_maximum_unavailable()}{/if}</span>
        {#if appState.apiSettings.detectedContext?.provenance === 'theoretical'}
          <span>· {m.settings_context_theoretical_maximum({ tokens: formatTokens(appState.apiSettings.detectedContext.tokens) })}</span>
        {/if}
        {#if appState.apiSettings.detectedContext?.theoreticalTokens}
          <span>· {m.settings_context_theoretical_maximum({ tokens: formatTokens(appState.apiSettings.detectedContext.theoreticalTokens) })}</span>
        {/if}
        <span class="context-status">· {detectingContext ? m.settings_context_detecting() : appState.apiSettings.detectedContext?.provenance !== 'theoretical' && appState.apiSettings.detectedContext ? m.settings_context_detected() : m.settings_context_not_detected()}</span>
        <button type="button" class="context-retry" aria-label={m.settings_context_refresh()} title={m.settings_context_refresh()} disabled={detectingContext || !appState.apiSettings.model} onclick={detectContext}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.3 6.7"/><path d="M20 4v7h-7"/></svg></button>
      </div>
      <div class="manual-limit">
        <label class="manual-limit-toggle">
          <span class="setting-toggle-copy"><strong>{m.settings_context_manual_limit()}</strong><small>{m.settings_context_manual_help()}</small></span>
          <input class="settings-switch-input sr-only" type="checkbox" checked={appState.apiSettings.manualContextCap !== null} onchange={(event) => {
            appState.apiSettings.manualContextCap = event.currentTarget.checked ? resolvedHardContextLimit(appState.apiSettings) : null;
            appState.apiSettings.contextLimit = resolvedHardContextLimit(appState.apiSettings);
          }} />
          <span class="settings-switch-track" aria-hidden="true"><span class="settings-switch-thumb"></span></span>
        </label>
        {#if appState.apiSettings.manualContextCap !== null}
          <label>
            <span class="settings-label">{m.settings_context_token_limit()}</span>
            <input class="settings-input" type="number" min="1024" max="16777216" step="1024"
              value={appState.apiSettings.manualContextCap ?? ''}
              oninput={(event) => {
                const value = event.currentTarget.valueAsNumber;
                appState.apiSettings.manualContextCap = Number.isFinite(value) ? Math.round(value) : null;
                appState.apiSettings.contextLimit = resolvedHardContextLimit(appState.apiSettings);
              }} />
          </label>
        {/if}
      </div>
    </div>
    <div class="settings-divider"></div>
    <div class="context-controls">
      <label>
        <span class="settings-label">{m.settings_context_strategy()}</span>
        <select class="settings-input" bind:value={appState.apiSettings.contextStrategy}>
          <option value="economy">{m.settings_context_strategy_economy()}</option>
          <option value="balanced">{m.settings_context_strategy_balanced()}</option>
          <option value="maximum">{m.settings_context_strategy_maximum()}</option>
        </select>
      </label>
    </div>
    <div class="context-strategy-help">
      {#if appState.apiSettings.contextStrategy === 'economy'}{m.settings_context_strategy_economy_help()}
      {:else if appState.apiSettings.contextStrategy === 'maximum'}{m.settings_context_strategy_maximum_help()}
      {:else}{m.settings_context_strategy_balanced_help()}{/if}
    </div>
    <span class="memory-help">{m.settings_context_working_help()}</span>

    <div class="settings-divider"></div>
    <div class="memory-controls">
      <label class="memory-toggle">
        <span class="setting-toggle-copy"><strong>{m.settings_memory_long_term()}</strong><small>{m.settings_memory_long_term_help()}</small></span>
        <input class="settings-switch-input sr-only" type="checkbox" bind:checked={appState.longTermMemory} />
        <span class="settings-switch-track" aria-hidden="true"><span class="settings-switch-thumb"></span></span>
      </label>
      <label>
        <span class="settings-label">{m.settings_memory_summary_connection()}</span>
        <select class="settings-input" bind:value={appState.summaryConnectionId} disabled={!appState.longTermMemory}>
          <option value={SAME_AS_CHAT_CONNECTION}>{m.settings_memory_same_as_chat()}</option>
          {#each appState.apiConnections as connection (connection.id)}
            <option value={connection.id}>{connection.name}</option>
          {/each}
        </select>
        <span class="memory-help">{m.settings_memory_same_as_chat_help()}</span>
        {#if appState.longTermMemory && summaryConnection.id !== appState.apiSettings.id}
          <span class="memory-help">
            {#if summaryConnection.detectedContext && summaryConnection.detectedContext.provenance !== 'theoretical'}
              {m.settings_memory_summary_context({ tokens: formatTokens(summaryContextLimit) })}
            {:else}
              {m.settings_memory_summary_context_unknown({ tokens: formatTokens(summaryContextLimit) })}
            {/if}
          </span>
          {#if summaryContextLimit < resolvedHardContextLimit(appState.apiSettings)}
            <span class="memory-help">{m.settings_memory_summary_context_smaller()}</span>
          {/if}
        {/if}
      </label>
    </div>
  </div>
  {/if}
</section>

<style>
  .api-model-section-title {
    margin: 0 0 14px;
    color: #d8c5a8;
    font-size: 13px;
    font-weight: 650;
    letter-spacing: 0.02em;
  }
  .provider-settings > .settings-divider { margin:24px 0; }
  .connection-management { min-width:0; }
  .connection-toolbar { display:flex; align-items:center; gap:8px; }
  .connection-toolbar select { min-width:0; flex:1; }
  .connection-action { min-height:40px; padding:8px 11px; border:1px solid rgba(255,255,255,.08); border-radius:9px; color:#aaa7a3; background:rgba(255,255,255,.035); font-size:11px; font-weight:650; white-space:nowrap; cursor:pointer; }
  .connection-action:hover:not(:disabled) { color:#dfd8cf; border-color:rgba(212,180,131,.25); }
  .connection-action.danger:hover:not(:disabled) { color:#e8a19b; border-color:rgba(220,90,80,.25); }
  .connection-action:disabled { opacity:.38; cursor:default; }
  .connection-menu-wrap { position:relative; flex:0 0 auto; }
  .connection-more { width:36px; min-height:38px; padding:0; border-color:rgba(255,255,255,.055); background:transparent; color:#77777c; font-size:20px; font-weight:500; line-height:1; }
  .connection-more:hover:not(:disabled) { background:rgba(255,255,255,.035); }
  .connection-menu { position:absolute; z-index:20; top:calc(100% + 5px); right:0; width:142px; padding:4px; border:1px solid rgba(255,255,255,.09); border-radius:10px; background:#252527; box-shadow:0 12px 28px rgba(0,0,0,.35); }
  .connection-menu button { display:block; width:100%; padding:9px 10px; border-radius:7px; color:#cbc8c5; text-align:left; font-size:12px; cursor:pointer; }
  .connection-menu button:hover:not(:disabled) { background:rgba(255,255,255,.06); }
  .connection-menu button.danger { color:#df938d; }
  .connection-menu button:disabled { opacity:.4; cursor:default; }
  .connection-inline-edit,.connection-delete-confirm { display:flex; align-items:center; gap:8px; margin-top:9px; }
  .connection-inline-edit input { min-width:0; flex:1; }
  @media (max-width:420px) { .connection-inline-edit { flex-wrap:wrap; } .connection-inline-edit input { flex-basis:100%; } }
  .connection-delete-confirm { flex-wrap:wrap; color:#bdb7b1; font-size:12px; }
  .connection-delete-confirm span { flex:1; min-width:150px; }
  .connection-text-action { padding:6px 8px; border-radius:7px; color:#aaa7a3; font-size:11px; font-weight:650; cursor:pointer; }
  .connection-text-action:hover:not(:disabled) { color:#e2d6c5; background:rgba(255,255,255,.045); }
  .connection-text-action:disabled { opacity:.4; cursor:default; }
  .connection-management + .settings-divider { margin-top:20px; }
  .api-model-section .tab-switcher { margin-bottom:18px; }
  .api-model-section .provider-grid { margin-top:0; }
  .api-model-section > .settings-divider { margin:22px 0; }
  .ctx-row-head { display:flex; align-items:center; gap:8px; }
  .ctx-row-head .settings-label { margin-bottom:0; }
  .context-detection-row { padding:14px 0; border-bottom:1px solid rgba(255,255,255,.05); }
  .context-amount { display:flex; flex-direction:column; gap:3px; min-width:0; }
  .context-amount strong { color:#e0dbd4; font-size:19px; font-weight:620; font-variant-numeric:tabular-nums; letter-spacing:-.02em; }
  .context-amount span { color:#65656a; font-size:11px; }
  .context-status { color:#77777c; }
  .context-secondary { display:flex; align-items:center; flex-wrap:wrap; column-gap:5px; margin-top:8px; color:#65656a; font-size:11px; line-height:1.4; }
  .context-retry { display:inline-grid; place-items:center; width:24px; height:24px; margin-left:2px; border-radius:6px; color:#77777c; cursor:pointer; }
  .context-retry:hover:not(:disabled) { color:#c7b9a5; background:rgba(255,255,255,.045); }
  .context-retry:focus-visible { outline:2px solid #d4b483; outline-offset:2px; }
  .context-retry:disabled { opacity:.4; cursor:default; }
  .manual-limit { display:grid; gap:14px; margin-top:22px; }
  .manual-limit-toggle,.memory-toggle { display:flex; align-items:center; justify-content:space-between; gap:18px; min-height:42px; cursor:pointer; }
  .setting-toggle-copy { display:flex; min-width:0; flex-direction:column; gap:4px; }
  .setting-toggle-copy strong { color:#cfcac4; font-size:13px; font-weight:620; line-height:1.35; }
  .setting-toggle-copy small { color:#65656a; font-size:11px; line-height:1.4; }
  .manual-limit > label:not(.manual-limit-toggle) { width:100%; max-width:230px; }
  .context-controls { max-width:360px; margin-top:0; }
  .context-strategy-help,.memory-help { display:block; margin-top:7px; color:#5f5f64; font-size:11px; line-height:1.4; }
  .memory-controls { display:grid; gap:22px; }
  .memory-controls > label:not(.memory-toggle) { width:100%; max-width:360px; }
  .memory-settings > .settings-divider { margin:26px 0; }
  .api-model-section--model {
    margin-top: 28px;
    padding-top: 28px;
    border-top: 1px solid rgba(255,255,255,0.055);
  }
  .tab-switcher {
    display: flex;
    gap: 4px;
    background: rgba(0, 0, 0, 0.2);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 12px;
    padding: 3px;
  }
  .tab-btn {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 6px;
    padding: 7px 12px;
    border-radius: 9px;
    border: 1px solid transparent;
    background: transparent;
    color: #5a5a5e;
    font-size: 12px;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .tab-btn:hover:not(.tab-btn--active) {
    color: #a0a0a6;
    background: rgba(255, 255, 255, 0.03);
  }
  .tab-btn--active {
    background: rgba(255, 255, 255, 0.07);
    border-color: rgba(212, 180, 131, 0.25);
    color: #d4b483;
  }

  .provider-grid {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 8px;
  }

  @media (min-width: 640px) {
    .provider-grid {
      grid-template-columns: repeat(4, 1fr);
    }
  }

  .provider-btn {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: center;
    gap: 5px;
    padding: 10px 6px;
    border-radius: 12px;
    border: 1px solid rgba(255,255,255,0.06);
    background: rgba(255,255,255,0.02);
    color: #6b6b6e;
    transition: all 0.15s ease;
    cursor: pointer;
  }
  .provider-btn:hover {
    border-color: rgba(255,255,255,0.12);
    color: #d1d1d6;
    background: rgba(255,255,255,0.04);
  }
  .provider-btn:active { transform: scale(0.97); }
  .provider-btn--active {
    background: rgba(255,255,255,0.07);
    border-color: rgba(212,180,131,0.4);
    color: #d4b483;
  }
  .provider-icon {
    flex-shrink: 0;
    opacity: 0.8;
  }
  .provider-btn--active .provider-icon { opacity: 1; }
  .provider-label {
    font-size: 12px;
    font-weight: 600;
    line-height: 1.25;
    text-align: center;
    overflow-wrap: anywhere;
  }

  .optional-badge {
    margin-left: 6px;
    font-size: 9px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #3a3a3c;
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.06);
    border-radius: 4px;
    padding: 1px 5px;
    vertical-align: middle;
  }

  .model-picker { position: relative; }
  .model-picker-trigger { display:flex; align-items:center; justify-content:space-between; gap:12px; text-align:left; cursor:pointer; }
  .model-picker-trigger span { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .model-picker-trigger svg { flex-shrink:0; transition:transform .15s ease; }
  svg.rotated { transform:rotate(180deg); }
  .model-search-wrap { display:flex; align-items:center; gap:8px; margin:8px; padding:0 10px; border:1px solid rgba(255,255,255,.07); border-radius:9px; background:rgba(0,0,0,.22); color:#66666b; }
  .model-search-wrap:focus-within { border-color:rgba(212,180,131,.35); color:#a68d68; }
  .model-search { width:100%; min-width:0; padding:9px 0; border:0; outline:0; background:transparent; color:#e5e5ea; font:inherit; font-size:12.5px; }
  .model-search::placeholder { color:#55555a; }
  .model-search::-webkit-search-cancel-button { filter:invert(.6); }
  .free-badge { display:inline-flex; align-items:center; min-height:17px; padding:1px 6px; border-radius:999px; background:rgba(87,181,119,.12); color:#76c991; font-size:9px; font-weight:750; letter-spacing:.04em; text-transform:uppercase; }
  .model-no-results { padding:20px 12px; color:#66666b; font-size:12px; text-align:center; }
  .model-list-sentinel { height:1px; }
  .model-list-loading { display:flex; flex-direction:column; gap:7px; }
  .model-row-skeleton { height:78px; border:1px solid rgba(255,255,255,.025); border-radius:14px; background:rgba(255,255,255,.018); animation:model-skeleton-pulse 1.2s ease-in-out infinite alternate; }
  @keyframes model-skeleton-pulse { to { background:rgba(255,255,255,.035); } }
  .model-sheet-backdrop, .mobile-model-sheet { display:none; }

  .desktop-model-backdrop { position:fixed; z-index:70; inset:0; background:rgba(0,0,0,.7); backdrop-filter:blur(4px); animation:sheet-fade-in .16s ease-out; }
  .desktop-model-browser { position:fixed; z-index:71; top:50%; left:50%; width:min(1080px,calc(100vw - 72px)); height:min(760px,calc(100dvh - 72px)); display:flex; flex-direction:column; overflow:hidden; transform:translate(-50%,-50%); border:1px solid rgba(255,255,255,.1); border-radius:22px; background:#18181a; box-shadow:0 12px 32px rgba(0,0,0,.22); animation:browser-pop-in .18s cubic-bezier(.22,.8,.3,1); }
  .desktop-model-header { display:flex; align-items:center; justify-content:space-between; gap:24px; padding:22px 24px 16px; border-bottom:1px solid rgba(255,255,255,.055); }
  .desktop-model-header h3 { margin:0; color:#eeeae4; font-size:22px; font-weight:680; letter-spacing:-.025em; }
  .desktop-model-header p { margin:4px 0 0; color:#626267; font-size:11.5px; }
  .model-sheet-close { width:40px; height:40px; display:grid; place-items:center; flex:0 0 auto; border:0; border-radius:12px; background:rgba(255,255,255,.045); color:#8b8b90; cursor:pointer; }
  .model-sheet-close:hover { background:rgba(255,255,255,.08); color:#e5e5e9; }
  .desktop-model-controls { flex:0 0 auto; padding:14px 18px 12px; border-bottom:1px solid rgba(255,255,255,.055); }
  .desktop-model-controls .model-search-wrap { height:44px; margin:0 0 12px; padding:0 13px; border-radius:12px; }
  .model-category-tabs { display:flex; gap:7px; overflow-x:auto; scrollbar-width:none; }
  .model-category-tabs::-webkit-scrollbar { display:none; }
  .model-category-tab { min-height:36px; flex:0 0 auto; padding:7px 14px; border:1px solid rgba(255,255,255,.065); border-radius:999px; background:rgba(255,255,255,.025); color:#77777c; font:inherit; font-size:12px; font-weight:650; white-space:nowrap; cursor:pointer; }
  .model-category-tab:hover { border-color:rgba(255,255,255,.13); color:#b5b5ba; }
  .model-category-tab--active { border-color:rgba(212,180,131,.42); background:rgba(212,180,131,.12); color:#dfc69f; }
  .desktop-category-tabs { padding:1px 25px 2px 2px; overscroll-behavior-x:contain;}
  .desktop-model-list { min-height:0; flex:1; overflow-y:auto; padding:12px 14px 18px; }
  .desktop-model-row { display:flex; align-items:stretch; border:1px solid rgba(255,255,255,.035); border-radius:14px; background:rgba(255,255,255,.012); color:#d1d1d5; transition:background .14s ease,border-color .14s ease,transform .14s ease; }
  .desktop-model-row + .desktop-model-row { margin-top:7px; }
  .desktop-model-row:hover { border-color:rgba(255,255,255,.085); background:rgba(255,255,255,.042); color:#f2f2f4; transform:translateY(-1px); }
  .desktop-model-row--selected { border-color:rgba(212,180,131,.23); background:rgba(212,180,131,.085); color:#e1c59a; }
  .desktop-model-select { min-width:0; min-height:78px; flex:1; display:flex; align-items:center; gap:18px; padding:13px 10px 13px 18px; border:0; background:transparent; color:inherit; text-align:left; cursor:pointer; }
  .desktop-model-identity { min-width:0; flex:1; display:flex; flex-direction:column; gap:8px; }
  .desktop-model-name { overflow:hidden; text-overflow:ellipsis; color:inherit; font-size:15.5px; font-weight:620; letter-spacing:-.012em; line-height:1.2; white-space:nowrap; }
  .desktop-model-meta { display:flex; align-items:center; flex-wrap:wrap; gap:6px; min-height:18px; }
  .desktop-model-provider { margin-right:2px; color:#66666b; font-size:9.5px; font-weight:750; letter-spacing:.065em; text-transform:uppercase; }
  .desktop-meta-badge { display:inline-flex; align-items:center; min-height:19px; padding:2px 7px; border:1px solid rgba(255,255,255,.055); border-radius:6px; background:rgba(0,0,0,.14); color:#77777c; font-size:10px; font-variant-numeric:tabular-nums; line-height:1.2; }
  .desktop-model-row--selected .desktop-model-provider, .desktop-model-row--selected .desktop-meta-badge { color:#9b8667; }
  .desktop-selected-mark { display:grid; place-items:center; flex:0 0 auto; color:#d4b483; }
  .desktop-favorite-btn { width:52px; flex:0 0 auto; display:grid; place-items:center; margin:8px 7px 8px 0; border:0; border-radius:11px; background:transparent; color:#4e4e53; cursor:pointer; }
  .desktop-favorite-btn:hover { background:rgba(255,255,255,.055); color:#8d8d92; }
  .desktop-favorite-btn--active { color:#d4b483; }
  .desktop-model-no-results { padding-top:70px; font-size:13px; }
  @keyframes browser-pop-in { from { transform:translate(-50%,-48%) scale(.985); opacity:.65; } }

  @media (max-width: 767px) {
    .desktop-model-backdrop, .desktop-model-browser { display:none; }
    .model-sheet-backdrop {
      position:fixed;
      z-index:70;
      inset:0;
      display:block;
      background:rgba(0,0,0,.62);
      backdrop-filter:blur(2px);
      animation:sheet-fade-in .16s ease-out;
    }
    .mobile-model-sheet {
      position:fixed;
      z-index:71;
      right:0;
      bottom:0;
      left:0;
      height:min(86dvh, 760px);
      display:flex;
      flex-direction:column;
      overflow:hidden;
      border:1px solid rgba(255,255,255,.09);
      border-bottom:0;
      border-radius:24px 24px 0 0;
      background:#18181a;
      box-shadow:0 -8px 24px rgba(0,0,0,.2);
      animation:sheet-slide-in .2s cubic-bezier(.22,.8,.3,1);
    }
    .model-sheet-handle {
      width:38px;
      height:4px;
      flex:0 0 auto;
      margin:9px auto 2px;
      border-radius:999px;
      background:rgba(255,255,255,.14);
    }
    .model-sheet-toolbar {
      position:sticky;
      z-index:1;
      top:0;
      flex:0 0 auto;
      padding:4px 0 10px;
      border-bottom:1px solid rgba(255,255,255,.055);
      background:#18181a;
    }
    .model-sheet-heading {
      min-height:47px;
      display:flex;
      align-items:center;
      justify-content:space-between;
      gap:16px;
      padding:0 16px 0 20px;
    }
    .model-sheet-heading h3 {
      margin:0;
      color:#eeeae4;
      font-size:20px;
      font-weight:680;
      letter-spacing:-.025em;
    }
    .model-sheet-close {
      width:40px;
      height:40px;
      display:grid;
      place-items:center;
      flex:0 0 auto;
      border:0;
      border-radius:12px;
      background:rgba(255,255,255,.045);
      color:#8b8b90;
      cursor:pointer;
    }
    .model-sheet-close:active { background:rgba(255,255,255,.09); color:#e5e5e9; }
    .model-sheet-search {
      height:46px;
      margin:3px 16px 11px;
      padding:0 13px;
      border-radius:13px;
      background:rgba(0,0,0,.28);
    }
    .model-sheet-search .model-search { font-size:16px; }
    .model-category-tabs {
      display:flex;
      gap:7px;
      overflow-x:auto;
      padding:0 16px 2px;
      scrollbar-width:none;
      overscroll-behavior-x:contain;
      -webkit-overflow-scrolling:touch;
    }
    .model-category-tabs::-webkit-scrollbar { display:none; }
    .model-category-tab {
      min-height:38px;
      flex:0 0 auto;
      padding:8px 14px;
      border:1px solid rgba(255,255,255,.065);
      border-radius:999px;
      background:rgba(255,255,255,.025);
      color:#77777c;
      font:inherit;
      font-size:12.5px;
      font-weight:650;
      white-space:nowrap;
      cursor:pointer;
    }
    .model-category-tab--active {
      border-color:rgba(212,180,131,.42);
      background:rgba(212,180,131,.12);
      color:#dfc69f;
    }
    .mobile-model-list {
      min-height:0;
      flex:1;
      overflow-y:auto;
      padding:8px 10px calc(14px + env(safe-area-inset-bottom));
      overscroll-behavior:contain;
      -webkit-overflow-scrolling:touch;
    }
    .mobile-model-list .model-list-loading { gap:2px; }
    .mobile-model-list .model-row-skeleton { height:58px; border-color:transparent; border-radius:13px; }
    .mobile-model-row {
      min-height:58px;
      display:flex;
      align-items:center;
      gap:2px;
      border:1px solid transparent;
      border-radius:13px;
      color:#bdbdc2;
    }
    .mobile-model-row + .mobile-model-row { margin-top:2px; }
    .mobile-model-row--selected {
      border-color:rgba(212,180,131,.23);
      background:rgba(212,180,131,.085);
      color:#e1c59a;
    }
    .mobile-model-select {
      min-width:0;
      min-height:58px;
      flex:1;
      display:flex;
      flex-direction:column;
      align-items:flex-start;
      justify-content:center;
      gap:3px;
      padding:9px 10px 9px 13px;
      border:0;
      background:transparent;
      color:inherit;
      text-align:left;
      cursor:pointer;
    }
    .mobile-model-name {
      max-width:100%;
      overflow-wrap:anywhere;
      color:inherit;
      font-size:14px;
      font-weight:570;
      line-height:1.25;
    }
    .mobile-model-provider {
      color:#5f5f64;
      font-size:10px;
      font-weight:700;
      letter-spacing:.055em;
      text-transform:uppercase;
    }
    .mobile-model-details {
      display:flex;
      align-items:center;
      flex-wrap:wrap;
      gap:4px 7px;
      color:#66666b;
      font-size:10.5px;
      line-height:1.35;
    }
    .mobile-model-price, .mobile-model-context { color:#727277; }
    .mobile-model-price::before, .mobile-model-context::before { margin-right:7px; color:#454549; content:"·"; }
    .mobile-model-details .free-badge { min-height:16px; padding:0 5px; }
    .mobile-model-row--selected .mobile-model-provider { color:#8d795c; }
    .mobile-model-row--selected .mobile-model-price,
    .mobile-model-row--selected .mobile-model-context { color:#9b8667; }
    .model-favorite-btn {
      width:44px;
      height:44px;
      display:grid;
      place-items:center;
      flex:0 0 auto;
      border:0;
      border-radius:11px;
      background:transparent;
      color:#4e4e53;
      cursor:pointer;
    }
    .model-favorite-btn:active { background:rgba(255,255,255,.055); }
    .model-favorite-btn--active { color:#d4b483; }
    .mobile-selected-check { flex:0 0 auto; margin:0 14px 0 4px; color:#d4b483; }
    .mobile-model-no-results { padding-top:48px; font-size:13px; }
    @keyframes sheet-fade-in { from { opacity:0; } }
    @keyframes sheet-slide-in { from { transform:translateY(28px); opacity:.7; } }
  }

  .empty-state { color: #3a3a3c; }
  .error-state { display:flex; align-items:center; justify-content:space-between; gap:10px; color:#f87171; border-color:rgba(248,113,113,0.2); background:rgba(248,113,113,0.04); }
  .model-error-text { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .model-retry { flex:0 0 auto; padding:3px 7px; border-radius:6px; color:#fca5a5; font-size:11px; font-weight:650; cursor:pointer; }
  .model-retry:hover,.model-retry:focus-visible { outline:none; background:rgba(248,113,113,.1); }
  .ctx-row {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 10px;
  }
  .ctx-row-head {
    display: flex;
    align-items: center;
    gap: 8px;
  }
</style>
