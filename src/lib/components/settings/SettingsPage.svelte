<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { registerBackHandler, returnTo } from '$lib/stores/navigation';
  import { getAllSettings, saveSetting } from "$lib/utils/settings";
  import { onMount } from "svelte";
  import { setLocale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import ApiSection from "./ApiSection.svelte";
  import GeneralSection from "./GeneralSection.svelte";
  import Button from "$lib/components/ui/Button.svelte";
  import { API_PARAMETER_SETTING_KEYS, createDefaultApiParameterEnabled, readApiParameterEnabled, type ApiParameterKey } from "$lib/utils/apiParameters";

  type SettingsCategory = "provider" | "parameters" | "language" | "advanced";
  type Category = { id: SettingsCategory; label: string; description: string; mobileDescription: string; icon: string };

  let powerUser = $state(false);
  let parameterEnabled = $state<Record<ApiParameterKey, boolean>>(createDefaultApiParameterEnabled());

  const CATEGORIES: Category[] = [
    { id: "provider", label: m.settings_category_provider(), description: m.settings_category_provider_description(), mobileDescription: m.settings_category_provider_mobile_description(), icon: "M4 7h16M6 3h12v18H6zM9 11h6M9 15h6" },
    { id: "parameters", label: m.settings_section_ai_behavior(), description: m.settings_category_parameters_description(), mobileDescription: m.settings_category_parameters_mobile_description(), icon: "M4 6h10M18 6h2M4 12h2M10 12h10M4 18h7M15 18h5M14 4v4M6 10v4M11 16v4" },
    { id: "language", label: m.settings_section_language(), description: m.settings_category_language_description(), mobileDescription: m.settings_category_language_description(), icon: "M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.21 0 4-4.03 4-9s-1.79-9-4-9-4 4.03-4 9 1.79 9 4 9zM3.5 12h17" },
    { id: "advanced", label: m.settings_category_advanced(), description: m.settings_category_advanced_description(), mobileDescription: m.settings_category_advanced_mobile_description(), icon: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19 12h2M3 12h2M12 3v2M12 19v2M5.64 5.64l1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42" },
  ];

  let activeSection = $state<SettingsCategory>("provider");
  let mobileCategoryOpen = $state(false);
  let isSaving = $state(false);
  let settingsReady = $state(false);
  let settingsContentEl: HTMLDivElement;
  const activeCategory = $derived(CATEGORIES.find((item) => item.id === activeSection) ?? CATEGORIES[0]);
  const generalCategory = $derived(activeSection === "language" ? "language" : activeSection === "advanced" ? "advanced" : "parameters");

  function selectCategory(id: SettingsCategory, mobile = false) {
    activeSection = id;
    if (settingsContentEl) settingsContentEl.scrollTop = 0;
    if (mobile) mobileCategoryOpen = true;
  }

  const SETTINGS_MAP: Record<string, (value: string) => void> = {
    api_url: (v) => (appState.apiSettings.url = v),
    api_key: (v) => (appState.apiSettings.apiKey = v),
    api_model: (v) => (appState.apiSettings.model = v),
    api_custom_mode: (v) => (appState.apiSettings.customMode = v === "true"),
    system_prompt: (v) => (appState.apiSettings.systemPrompt = v),
    api_temperature: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.temperature = n; },
    api_max_tokens: (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.maxTokens = n; },
    api_thinking_budget: (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.thinkingBudget = n; },
    api_presence_penalty: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.presencePenalty = n; },
    api_context_limit: (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.contextLimit = n; },
    api_top_p: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.topP = n; },
    api_top_k: (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.topK = n; },
    api_min_p: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.minP = n; },
    api_frequency_penalty: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.frequencyPenalty = n; },
    settings_power_user: (v) => { powerUser = v === "true"; },
  };

  onMount(loadSettings);

  async function loadSettings() {
    try {
      const settings = await getAllSettings();
      parameterEnabled = readApiParameterEnabled(settings);
      for (const row of settings) SETTINGS_MAP[row.key]?.(row.value);
      if (appState.apiSettings.maxTokens == null) appState.apiSettings.maxTokens = 300;
      if (appState.apiSettings.presencePenalty == null) appState.apiSettings.presencePenalty = 1.1;
      if (appState.apiSettings.thinkingBudget == null) appState.apiSettings.thinkingBudget = 2500;
      if (appState.apiSettings.contextLimit == null) appState.apiSettings.contextLimit = 4096;
      if (appState.apiSettings.topP == null) appState.apiSettings.topP = 0.9;
      if (appState.apiSettings.topK == null) appState.apiSettings.topK = 40;
      if (appState.apiSettings.minP == null) appState.apiSettings.minP = 0.05;
      if (appState.apiSettings.frequencyPenalty == null) appState.apiSettings.frequencyPenalty = 0;

      console.log("[Settings] Loaded values:", {
        url: appState.apiSettings.url,
        apiKeyConfigured: Boolean(appState.apiSettings.apiKey),
        model: appState.apiSettings.model,
        systemPrompt: appState.apiSettings.systemPrompt,
        temperature: appState.apiSettings.temperature,
        maxTokens: appState.apiSettings.maxTokens,
        presencePenalty: appState.apiSettings.presencePenalty,
        thinkingBudget: appState.apiSettings.thinkingBudget,
        contextLimit: appState.apiSettings.contextLimit,
        topP: appState.apiSettings.topP,
        topK: appState.apiSettings.topK,
        minP: appState.apiSettings.minP,
        frequencyPenalty: appState.apiSettings.frequencyPenalty,
        parameterEnabled: { ...parameterEnabled },
        powerUser,
      });
    } catch (err) { console.error("[Settings] Failed to load:", err); }
    finally { settingsReady = true; }
  }

  async function saveSettings() {
    isSaving = true;
    try {
      await Promise.all([
        saveSetting("api_url", appState.apiSettings.url), saveSetting("api_key", appState.apiSettings.apiKey),
        saveSetting("api_model", appState.apiSettings.model), saveSetting("api_custom_mode", appState.apiSettings.customMode),
        saveSetting("system_prompt", appState.apiSettings.systemPrompt),
        saveSetting("api_temperature", appState.apiSettings.temperature ?? 0.7), saveSetting("api_max_tokens", appState.apiSettings.maxTokens ?? 300),
        saveSetting("api_thinking_budget", appState.apiSettings.thinkingBudget ?? 2500), saveSetting("api_presence_penalty", appState.apiSettings.presencePenalty ?? 1.1),
        saveSetting("api_context_limit", appState.apiSettings.contextLimit ?? 4096), saveSetting("api_top_p", appState.apiSettings.topP ?? 0.9),
        saveSetting("api_top_k", appState.apiSettings.topK ?? 40), saveSetting("api_min_p", appState.apiSettings.minP ?? 0.05),
        saveSetting("api_frequency_penalty", appState.apiSettings.frequencyPenalty ?? 0),
        ...Object.entries(API_PARAMETER_SETTING_KEYS).map(([parameter, key]) => saveSetting(key, parameterEnabled[parameter as ApiParameterKey])),
        saveSetting("settings_power_user", powerUser),
      ]);
      const locale = appState.pendingUiLocale;
      if (locale) setLocale(locale as any);
      goBack();
    } catch (err) { console.error("[Settings] Save failed:", err); }
    finally { isSaving = false; }
  }

  function goBack() { returnTo('lobby'); }

  $effect(() => {
    if (!mobileCategoryOpen) return;
    return registerBackHandler(() => {
      mobileCategoryOpen = false;
      return true;
    });
  });
</script>

{#snippet backIcon()}
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
{/snippet}

{#snippet categoryIcon(item: Category)}
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    {#each item.icon.split("M").filter(Boolean) as d}<path d="M{d}" stroke-linecap="round" stroke-linejoin="round" />{/each}
  </svg>
{/snippet}

{#snippet saveButton()}
  <Button variant="secondary" disabled={isSaving} onclick={saveSettings}>
    {#if isSaving}<span class="save-spinner"></span>{:else}{m.settings_btn_save()}{/if}
  </Button>
{/snippet}

{#snippet powerToggle()}
  <label class="power-user-toggle" title={m.settings_power_user_title()}>
    <span class="power-icon" class:active={powerUser}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg></span>
    <span class="power-copy"><span class="power-label">{m.settings_power_user_label()}</span><span class="power-description">{m.settings_power_user_description()}</span></span>
    <input type="checkbox" bind:checked={powerUser} class="sr-only peer" />
    <span class="power-track"><span class="power-thumb"></span></span>
  </label>
{/snippet}

<div class="settings-shell" role="region" aria-label={m.settings_title()}>
  <aside class="desktop-sidebar" aria-label={m.settings_categories_aria()}>
    <div class="sidebar-title">{m.settings_title()}</div>
    <nav class="category-nav">
      {#each CATEGORIES as item}
        <button type="button" class="category-nav-item" class:category-nav-item--active={activeSection === item.id} aria-current={activeSection === item.id ? "page" : undefined} onclick={() => selectCategory(item.id)}>
          {@render categoryIcon(item)}<span>{item.label}</span>
        </button>
      {/each}
    </nav>
  </aside>

  <main class="settings-main">
    <header class="desktop-header">
      <div><h1>{activeCategory.label}</h1><p>{activeCategory.description}</p></div>
      <div class="header-actions"><Button variant="icon" ariaLabel={m.create_page_aria_back()} onclick={goBack}>{@render backIcon()}</Button>{@render saveButton()}</div>
    </header>

    <header class="mobile-header">
      <Button variant="icon" ariaLabel={mobileCategoryOpen ? m.settings_back_to_overview() : m.create_page_aria_back()} onclick={() => mobileCategoryOpen ? (mobileCategoryOpen = false) : goBack()}>{@render backIcon()}</Button>
      <h1>{mobileCategoryOpen ? activeCategory.label : m.settings_title()}</h1>
      {@render saveButton()}
    </header>

    <div class="mobile-overview" class:mobile-overview--hidden={mobileCategoryOpen}>
      <nav class="mobile-category-list" aria-label={m.settings_categories_aria()}>
        {#each CATEGORIES as item}
          <button type="button" class="mobile-category-row" onclick={() => selectCategory(item.id, true)}>
            <span class="mobile-category-icon">{@render categoryIcon(item)}</span>
            <span class="mobile-category-copy"><span class="mobile-category-label">{item.label}</span><span class="mobile-category-description">{item.mobileDescription}</span></span>
            <svg class="mobile-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </button>
        {/each}
      </nav>
    </div>

    <div bind:this={settingsContentEl} class="settings-content" class:settings-content--mobile-hidden={!mobileCategoryOpen}>
      <div class="content-panel" hidden={activeSection !== "provider"}><ApiSection powerUser={powerUser} active={activeSection === "provider"} {settingsReady} /></div>
      <div class="content-panel" hidden={activeSection === "provider"}>
        {#if activeSection === "advanced"}<div class="advanced-mode">{@render powerToggle()}</div>{/if}
        <GeneralSection powerUser={powerUser} bind:parameterEnabled category={generalCategory} />
      </div>
    </div>
  </main>
</div>

<style>
  .settings-shell { height:100%; width:100%; display:flex; overflow:hidden; background:var(--color-ryokan-bg,#111); }
  .desktop-sidebar,.desktop-header { display:none; }
  .settings-main { min-width:0; flex:1; display:flex; flex-direction:column; overflow:hidden; }
  .mobile-header { flex:0 0 auto; min-height:68px; padding:calc(12px + env(safe-area-inset-top)) 16px 12px; display:grid; grid-template-columns:40px minmax(0,1fr) auto; align-items:center; gap:8px; border-bottom:1px solid rgba(255,255,255,.05); }
  .mobile-header h1 { min-width:0; color:#e7e2da; font-size:17px; font-weight:650; letter-spacing:-.01em; overflow-wrap:anywhere; }
  .mobile-overview { flex:1; overflow-y:auto; padding:12px 16px calc(28px + env(safe-area-inset-bottom)); }
  .mobile-overview--hidden,.settings-content--mobile-hidden { display:none; }
  .mobile-category-list { overflow:hidden; border-radius:15px; background:rgba(255,255,255,.025); }
  .mobile-category-row { width:100%; min-height:64px; display:flex; align-items:center; gap:13px; padding:10px 14px; color:#c9c7ca; text-align:left; cursor:pointer; transition:background 140ms ease; }
  .mobile-category-row + .mobile-category-row { border-top:1px solid rgba(255,255,255,.055); }
  .mobile-category-row:hover,.mobile-category-row:active { background:rgba(255,255,255,.045); }
  .mobile-category-icon { width:32px; height:32px; flex:0 0 auto; display:grid; place-items:center; border-radius:9px; color:#d4b483; background:rgba(212,180,131,.09); }
  .mobile-category-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
  .mobile-category-label { font-size:14px; font-weight:620; color:#e1dfe2; }
  .mobile-category-description { font-size:11px; line-height:1.35; color:#65656a; }
  .mobile-chevron { flex:0 0 auto; color:#444448; }
  .settings-content { flex:1; overflow-y:auto; overflow-x:hidden; padding:22px 18px calc(36px + env(safe-area-inset-bottom)); }
  .content-panel { width:100%; max-width:660px; margin:0 auto; }
  .content-panel[hidden] { display:none; }
  .advanced-mode { margin-bottom:22px; padding-bottom:22px; border-bottom:1px solid rgba(255,255,255,.055); }
  .power-user-toggle { min-height:58px; display:flex; align-items:center; gap:12px; padding:4px 2px; cursor:pointer; user-select:none; }
  .power-icon { width:34px; height:34px; flex:0 0 auto; display:grid; place-items:center; border-radius:10px; color:#57575c; background:rgba(255,255,255,.035); transition:color .18s,background .18s; }
  .power-icon.active { color:#d4b483; background:rgba(212,180,131,.09); }
  .power-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:3px; }
  .power-label { color:#d1cfd2; font-size:13px; font-weight:650; }
  .power-description { color:#5e5e63; font-size:11px; line-height:1.35; }
  .power-track { position:relative; width:42px; height:24px; flex:0 0 auto; border-radius:999px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.08); transition:background .2s,border-color .2s; }
  .power-thumb { position:absolute; width:16px; height:16px; left:3px; top:3px; border-radius:50%; background:#5a5a5e; transition:transform .2s,background .2s; }
  .peer:checked + .power-track { background:rgba(212,180,131,.2); border-color:rgba(212,180,131,.4); }
  .peer:checked + .power-track .power-thumb { transform:translateX(18px); background:#d4b483; }
  .save-spinner { width:12px; height:12px; border:2px solid rgba(255,255,255,.12); border-top-color:rgba(255,255,255,.6); border-radius:50%; animation:spin .6s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  :global(.settings-card) { padding:0; background:transparent; border:0; border-radius:0; }
  :global(.settings-section-title) { display:none; }
  :global(.settings-label) { display:block; margin-bottom:8px; color:#68686d; font-size:11px; font-weight:650; letter-spacing:.055em; text-transform:uppercase; }
  :global(.settings-input) { width:100%; box-sizing:border-box; padding:11px 14px; border:1px solid rgba(255,255,255,.07); border-radius:11px; outline:none; background:rgba(0,0,0,.2); color:#e5e5ea; color-scheme:dark; font:inherit; font-size:13px; transition:border-color .15s,background .15s,box-shadow .15s; }
  :global(select.settings-input option) { background:#1c1c1e; color:#e5e5ea; }
  :global(.settings-input:focus) { border-color:rgba(212,180,131,.4); background:rgba(212,180,131,.03); box-shadow:0 0 0 3px rgba(212,180,131,.06); }
  :global(.settings-input::placeholder) { color:#3a3a3c; }
  :global(.settings-divider) { height:1px; margin:20px 0; background:rgba(255,255,255,.05); }
  @media (min-width:768px) {
    .desktop-sidebar { width:224px; flex:0 0 auto; display:flex; flex-direction:column; border-right:1px solid rgba(255,255,255,.055); background:var(--color-ryokan-sidebar,#151515); }
    .sidebar-title { height:76px; display:flex; align-items:center; padding:0 24px; color:#d4b483; font-size:18px; font-weight:650; border-bottom:1px solid rgba(255,255,255,.045); }
    .category-nav { padding:14px 12px; display:flex; flex-direction:column; gap:3px; }
    .category-nav-item { min-height:42px; width:100%; display:flex; align-items:center; gap:11px; padding:9px 12px; border-radius:10px; color:#6d6d72; text-align:left; font-size:13px; font-weight:560; cursor:pointer; transition:color .15s,background .15s; }
    .category-nav-item:hover { color:#bbb8b5; background:rgba(255,255,255,.03); }
    .category-nav-item--active { color:#d8c5a8; background:rgba(212,180,131,.075); }
    .desktop-header { min-height:76px; flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:24px; padding:15px 32px; border-bottom:1px solid rgba(255,255,255,.045); }
    .desktop-header h1 { color:#e4e0da; font-size:18px; font-weight:650; letter-spacing:-.01em; }
    .desktop-header p { margin-top:2px; color:#5e5e63; font-size:11px; }
    .header-actions { display:flex; align-items:center; gap:10px; }
    .mobile-header,.mobile-overview { display:none; }
    .settings-content,.settings-content--mobile-hidden { display:block; padding:32px 40px 72px; }
  }
</style>
