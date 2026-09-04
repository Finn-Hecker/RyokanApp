<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { getAllSettings, saveSetting } from "$lib/utils/settings";
  import { onMount } from "svelte";
  import { setLocale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import PageWithNavSidebar from '$lib/components/layouts/PageWithNavSidebar.svelte';
  import ApiSection from "./ApiSection.svelte";
  import GeneralSection from "./GeneralSection.svelte";
  import Button from '$lib/components/ui/Button.svelte';

  let powerUser = $state(false);

  type ApiParameterKey =
    | "temperature"
    | "maxTokens"
    | "presencePenalty"
    | "thinkingBudget"
    | "topP"
    | "topK"
    | "minP"
    | "frequencyPenalty";

  // Keep the numeric value and the enabled state separate. This way disabling a
  // sampler does not destroy the user's tuned value, and re-enabling restores it.
  let parameterEnabled = $state<Record<ApiParameterKey, boolean>>({
    temperature: true,
    maxTokens: true,
    presencePenalty: true,
    thinkingBudget: true,
    topP: true,
    topK: true,
    minP: true,
    frequencyPenalty: true,
  });

  const NAV_ITEMS = [
    { id: "api",      label: m.settings_nav_api(),             icon: "M12 2a10 10 0 100 20A10 10 0 0012 2zm0 3v2m0 10v2M5.22 5.22l1.42 1.42m10.72 10.72l1.42 1.42M2 12h2m16 0h2M5.22 18.78l1.42-1.42M17.36 6.64l1.42-1.42" },
    { id: "language", label: m.settings_section_language(),    icon: "M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.21 0 4-4.03 4-9s-1.79-9-4-9-4 4.03-4 9 1.79 9 4 9zM3.5 12h17M5 7.5h14M5 16.5h14" },
    { id: "behavior", label: m.settings_section_ai_behavior(), icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
  ];

  let activeSection = $state("api");
  let isSaving = $state(false);
  let sectionEls: Record<string, HTMLElement> = {};

  function scrollToSection(id: string) {
    activeSection = id;
    sectionEls[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const DEFAULT_AI_LANGUAGE = "English";

  const SETTINGS_MAP: Record<string, (value: string) => void> = {
    api_url:              (v) => (appState.apiSettings.url = v),
    api_key:              (v) => (appState.apiSettings.apiKey = v),
    api_model:            (v) => (appState.apiSettings.model = v),
    api_custom_mode:      (v) => (appState.apiSettings.customMode = v === "true"),
    thinking_mode:        (v) => (appState.apiSettings.isThinkingModel = v === "true"),
    api_temperature_enabled:       (v) => (parameterEnabled.temperature = v !== "false"),
    api_max_tokens_enabled:        (v) => (parameterEnabled.maxTokens = v !== "false"),
    api_presence_penalty_enabled:  (v) => (parameterEnabled.presencePenalty = v !== "false"),
    api_thinking_budget_enabled:   (v) => (parameterEnabled.thinkingBudget = v !== "false"),
    api_top_p_enabled:             (v) => (parameterEnabled.topP = v !== "false"),
    api_top_k_enabled:             (v) => (parameterEnabled.topK = v !== "false"),
    api_min_p_enabled:             (v) => (parameterEnabled.minP = v !== "false"),
    api_frequency_penalty_enabled: (v) => (parameterEnabled.frequencyPenalty = v !== "false"),
    ai_language:          (v) => (appState.apiSettings.aiLanguage = v),
    system_prompt:        (v) => (appState.apiSettings.systemPrompt = v),
    api_temperature:      (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.temperature = n; },
    api_max_tokens:       (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.maxTokens = n; },
    api_thinking_budget:  (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.thinkingBudget = n; },
    api_presence_penalty: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.presencePenalty = n; },
    api_context_limit:    (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.contextLimit = n; },
    api_top_p:             (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.topP = n; },
    api_top_k:             (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.topK = n; },
    api_min_p:              (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.minP = n; },
    api_frequency_penalty: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.frequencyPenalty = n; },
    settings_power_user:  (v) => { powerUser = v === "true"; },
  };

  onMount(loadSettings);

  async function loadSettings() {
    try {
      const settings = await getAllSettings();
      for (const row of settings) SETTINGS_MAP[row.key]?.(row.value);
      if (!appState.apiSettings.aiLanguage) appState.apiSettings.aiLanguage = DEFAULT_AI_LANGUAGE;
      if (appState.apiSettings.maxTokens == null) appState.apiSettings.maxTokens = 300;
      if (appState.apiSettings.presencePenalty == null) appState.apiSettings.presencePenalty = 1.1;
      if (appState.apiSettings.thinkingBudget == null) appState.apiSettings.thinkingBudget = 2500;
      if (appState.apiSettings.contextLimit == null) appState.apiSettings.contextLimit = 4096;
      if (appState.apiSettings.topP == null) appState.apiSettings.topP = 0.9;
      if (appState.apiSettings.topK == null) appState.apiSettings.topK = 40;
      if (appState.apiSettings.minP == null) appState.apiSettings.minP = 0.05;
      if (appState.apiSettings.frequencyPenalty == null) appState.apiSettings.frequencyPenalty = 0;

      console.log("[Settings] Loaded values:", {
        url:             appState.apiSettings.url,
        apiKey:          appState.apiSettings.apiKey,
        model:           appState.apiSettings.model,
        isThinkingModel: appState.apiSettings.isThinkingModel,
        aiLanguage:      appState.apiSettings.aiLanguage,
        systemPrompt:    appState.apiSettings.systemPrompt,
        temperature:     appState.apiSettings.temperature,
        maxTokens:       appState.apiSettings.maxTokens,
        presencePenalty: appState.apiSettings.presencePenalty,
        thinkingBudget:  appState.apiSettings.thinkingBudget,
        contextLimit:    appState.apiSettings.contextLimit,
        topP:            appState.apiSettings.topP,
        topK:            appState.apiSettings.topK,
        minP:            appState.apiSettings.minP,
        frequencyPenalty: appState.apiSettings.frequencyPenalty,
        parameterEnabled: { ...parameterEnabled },
        powerUser,
      });
    } catch (err) {
      console.error("[Settings] Failed to load:", err);
    }
  }

  async function saveSettings() {
    isSaving = true;
    try {
      await Promise.all([
        saveSetting("api_url",              appState.apiSettings.url),
        saveSetting("api_key",              appState.apiSettings.apiKey),
        saveSetting("api_model",            appState.apiSettings.model),
        saveSetting("api_custom_mode",      appState.apiSettings.customMode),
        saveSetting("thinking_mode",        appState.apiSettings.isThinkingModel),
        saveSetting("ai_language",          appState.apiSettings.aiLanguage),
        saveSetting("system_prompt",        appState.apiSettings.systemPrompt),
        saveSetting("api_temperature",      appState.apiSettings.temperature ?? 0.7),
        saveSetting("api_max_tokens",       appState.apiSettings.maxTokens ?? 300),
        saveSetting("api_thinking_budget",  appState.apiSettings.thinkingBudget ?? 2500),
        saveSetting("api_presence_penalty", appState.apiSettings.presencePenalty ?? 1.1),
        saveSetting("api_context_limit",    appState.apiSettings.contextLimit ?? 4096),
        saveSetting("api_top_p",             appState.apiSettings.topP ?? 0.9),
        saveSetting("api_top_k",             appState.apiSettings.topK ?? 40),
        saveSetting("api_min_p",             appState.apiSettings.minP ?? 0.05),
        saveSetting("api_frequency_penalty", appState.apiSettings.frequencyPenalty ?? 0),
        saveSetting("api_temperature_enabled",       parameterEnabled.temperature),
        saveSetting("api_max_tokens_enabled",        parameterEnabled.maxTokens),
        saveSetting("api_presence_penalty_enabled",  parameterEnabled.presencePenalty),
        saveSetting("api_thinking_budget_enabled",   parameterEnabled.thinkingBudget),
        saveSetting("api_top_p_enabled",             parameterEnabled.topP),
        saveSetting("api_top_k_enabled",             parameterEnabled.topK),
        saveSetting("api_min_p_enabled",             parameterEnabled.minP),
        saveSetting("api_frequency_penalty_enabled", parameterEnabled.frequencyPenalty),
        saveSetting("settings_power_user",  powerUser),
      ]);
      const locale = appState.pendingUiLocale;
      if (locale) setLocale(locale as any);
      goBack();
    } catch (err) {
      console.error("[Settings] Save failed:", err);
    }
    isSaving = false;
  }

  function goBack() {
    appState.currentView = "lobby";
  }
</script>

{#snippet navHeader({ mobile }: { mobile: boolean })}
  {#if !mobile}
    <h2 class="text-lg font-medium text-ryokan-accent">{m.settings_title()}</h2>
  {/if}
{/snippet}

{#snippet powerToggle({ compact = false }: { compact?: boolean } = {})}
  <label class="power-user-toggle" class:compact title={m.settings_power_user_title()}>
    <div class="power-icon" class:active={powerUser}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
        <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
      </svg>
    </div>
    <span class="power-label">{m.settings_power_user_label()}</span>
    <input type="checkbox" bind:checked={powerUser} class="sr-only peer" />
    <div class="power-track
                peer-checked:bg-ryokan-accent/20 peer-checked:border-ryokan-accent/40
                after:content-[''] after:absolute after:top-[3px] after:start-[3px]
                after:bg-[#5a5a5e] after:rounded-full
                after:h-[14px] after:w-[14px] after:transition-all
                peer-checked:after:translate-x-[18px] peer-checked:after:bg-ryokan-accent">
    </div>
  </label>
{/snippet}

{#snippet navFooter()}
  <div class="nav-footer-divider"></div>
  {@render powerToggle({})}
{/snippet}

{#snippet actions()}
  <div class="flex w-full items-center justify-between gap-3 md:w-auto md:justify-start">
    <Button variant="icon" ariaLabel={m.create_page_aria_back()} onclick={goBack}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </Button>

    <Button variant="secondary" disabled={isSaving} onclick={saveSettings}>
      {#if isSaving}
        <span class="save-spinner"></span>
      {:else}
        {m.settings_btn_save()}
      {/if}
    </Button>
  </div>
{/snippet}

{#snippet mobileNav()}
  {#each NAV_ITEMS as item}
    <button
      onclick={() => scrollToSection(item.id)}
      class="flex-1 basis-0 min-w-0 px-4 py-2 rounded-full text-xs font-semibold border transition-all
        {activeSection === item.id
          ? 'bg-white/[0.07] border-white/[0.08] text-white'
          : 'bg-white/[0.03] border-white/[0.06] text-gray-500 hover:text-white hover:bg-white/[0.05]'}"
    >
      {item.label}
    </button>
  {/each}
{/snippet}

{#snippet mobileFooter()}
  {@render powerToggle({ compact: true })}
{/snippet}

<PageWithNavSidebar
  pageTitle={m.settings_title()}
  navItems={NAV_ITEMS}
  {activeSection}
  onSectionClick={scrollToSection}
  {navHeader}
  {navFooter}
  {actions}
  {mobileNav}
  {mobileFooter}
>
  <div class="max-w-xl mx-auto px-4 md:px-8 pb-32 space-y-10 pt-8">
    <div bind:this={sectionEls["api"]}>
      <ApiSection {powerUser} />
    </div>

    <div bind:this={sectionEls["language"]}>
      <GeneralSection {powerUser} behaviorOnly={false} languageOnly={true} />
    </div>

    <div bind:this={sectionEls["behavior"]}>
      <GeneralSection {powerUser} bind:parameterEnabled behaviorOnly={true} />
    </div>
  </div>
</PageWithNavSidebar>

<style>
  .save-spinner {
    width: 12px;
    height: 12px;
    border: 2px solid rgba(255, 255, 255, 0.12);
    border-top-color: rgba(255, 255, 255, 0.6);
    border-radius: 50%;
    animation: spin 0.6s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  .nav-footer-divider {
    height: 1px;
    background: rgba(255,255,255,0.05);
    margin: 12px 0;
  }
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

  /* On mobile the footer row is a standalone touch target, not tucked
     into a narrow sidebar — give it more breathing room and a slightly
     larger hit area so it's comfortable to tap. */
  .power-user-toggle.compact {
    width: 100%;
    padding: 10px 12px;
    border-radius: 12px;
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
  }
  .power-user-toggle.compact:hover,
  .power-user-toggle.compact:active {
    background: rgba(255, 255, 255, 0.05);
  }
  .power-user-toggle.compact .power-label {
    font-size: 12.5px;
  }
  .power-user-toggle.compact .power-track {
    width: 40px;
    height: 22px;
  }

  .power-icon {
    color: #48484a;
    transition: color 0.2s;
    display: flex;
    align-items: center;
  }
  .power-icon.active { color: #d4b483; }
  .power-label {
    font-size: 12px;
    font-weight: 600;
    color: #5a5a5e;
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

  :global(.settings-card) {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 20px;
    transition: border-color 0.2s;
  }
  :global(.settings-card:hover) { border-color: rgba(255, 255, 255, 0.09); }
  :global(.settings-section-title) {
    display: block;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: #48484a;
    margin-bottom: 10px;
  }
  :global(.settings-label) {
    display: block;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: #555;
    margin-bottom: 8px;
  }
  :global(.settings-input) {
    width: 100%;
    background: rgba(0, 0, 0, 0.25);
    border: 1px solid rgba(255, 255, 255, 0.07);
    border-radius: 10px;
    padding: 10px 14px;
    font-size: 13px;
    color: #e5e5ea;
    outline: none;
    transition: all 0.15s ease;
    box-sizing: border-box;
    font-family: inherit;
    color-scheme: dark;
  }
  :global(select.settings-input option) {
    background-color: #1c1c1e;
    color: #e5e5ea;
  }
  :global(select.settings-input option:checked) {
    background-color: #2c2c2e;
    color: #d4b483;
  }
  :global(.settings-input:focus) {
    border-color: rgba(212, 180, 131, 0.4);
    background: rgba(212, 180, 131, 0.03);
    box-shadow: 0 0 0 3px rgba(212, 180, 131, 0.06);
  }
  :global(.settings-input::placeholder) { color: #3a3a3c; }
  :global(.settings-divider) {
    height: 1px;
    background: rgba(255, 255, 255, 0.05);
    margin: 16px 0;
  }
</style>