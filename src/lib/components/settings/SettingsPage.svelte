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

  const NAV_ITEMS = [
    { id: "api",      label: m.settings_nav_api(),              icon: "M12 2a10 10 0 100 20A10 10 0 0012 2zm0 3v2m0 10v2M5.22 5.22l1.42 1.42m10.72 10.72l1.42 1.42M2 12h2m16 0h2M5.22 18.78l1.42-1.42M17.36 6.64l1.42-1.42" },
    { id: "behavior", label: m.settings_section_ai_behavior(),  icon: "M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" },
    { id: "general",  label: m.settings_nav_general(),          icon: "M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z M15 12a3 3 0 11-6 0 3 3 0 016 0" },
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
    thinking_mode:        (v) => (appState.apiSettings.isThinkingModel = v === "true"),
    ai_language:          (v) => (appState.apiSettings.aiLanguage = v),
    system_prompt:        (v) => (appState.apiSettings.systemPrompt = v),
    api_temperature:      (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.temperature = n; },
    api_max_tokens:       (v) => { const n = parseInt(v); if (!isNaN(n)) appState.apiSettings.maxTokens = n; },
    api_presence_penalty: (v) => { const n = parseFloat(v); if (!isNaN(n)) appState.apiSettings.presencePenalty = n; },
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
        saveSetting("thinking_mode",        appState.apiSettings.isThinkingModel),
        saveSetting("ai_language",          appState.apiSettings.aiLanguage),
        saveSetting("system_prompt",        appState.apiSettings.systemPrompt),
        saveSetting("api_temperature",      appState.apiSettings.temperature ?? 0.7),
        saveSetting("api_max_tokens",       appState.apiSettings.maxTokens ?? 300),
        saveSetting("api_presence_penalty", appState.apiSettings.presencePenalty ?? 1.1),
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

{#snippet navFooter()}
  <div class="nav-footer-divider"></div>
  <label class="power-user-toggle" title={m.settings_power_user_title()}>
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

{#snippet actions()}
  <div class="flex items-center gap-3">
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
      class="shrink-0 px-4 py-2 rounded-full text-xs font-semibold border transition-all
        {activeSection === item.id
          ? 'bg-white/[0.07] border-white/[0.08] text-white'
          : 'bg-white/[0.03] border-white/[0.06] text-gray-500 hover:text-white hover:bg-white/[0.05]'}"
    >
      {item.label}
    </button>
  {/each}
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
>
  <div class="max-w-xl mx-auto px-8 pb-32 space-y-10 pt-8">
    <div bind:this={sectionEls["api"]}>
      <ApiSection {powerUser} />
    </div>

    <div bind:this={sectionEls["behavior"]}>
      <GeneralSection {powerUser} behaviorOnly={true} />
    </div>

    <div bind:this={sectionEls["general"]}>
      <GeneralSection {powerUser} behaviorOnly={false} languageOnly={true} />
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