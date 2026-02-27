<script lang="ts">
  import { currentView, apiSettings, pendingUiLocale } from "$lib/stores/appState";
  import { getAllSettings, saveSetting } from "$lib/db/settings";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { setLocale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import PageWithNavSidebar from '$lib/components/layouts/PageWithNavSidebar.svelte';
  import ApiSection from "./ApiSection.svelte";
  import GeneralSection from "./GeneralSection.svelte";
  import Button from '$lib/components/ui/Button.svelte';

  const NAV_ITEMS = [
    { id: "general", label: m.settings_nav_general() },
    { id: "api",     label: m.settings_nav_api() },
  ];

  let activeSection = "general";
  let isSaving = false;
  let sectionEls: Record<string, HTMLElement> = {};

  function scrollToSection(id: string) {
    activeSection = id;
    sectionEls[id]?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  const DEFAULT_AI_LANGUAGE = "English";

  const SETTINGS_MAP: Record<string, (value: string) => void> = {
    api_url:         (v) => ($apiSettings.url = v),
    api_key:         (v) => ($apiSettings.apiKey = v),
    api_model:       (v) => ($apiSettings.model = v),
    thinking_mode:   (v) => ($apiSettings.isThinkingModel = v === "true"),
    ai_language:     (v) => ($apiSettings.aiLanguage = v),
    system_prompt:   (v) => ($apiSettings.systemPrompt = v),
    api_temperature: (v) => { const n = parseFloat(v); if (!isNaN(n)) $apiSettings.temperature = n; },
  };

  onMount(loadSettings);

  async function loadSettings() {
    try {
      const settings = await getAllSettings();
      for (const row of settings) SETTINGS_MAP[row.key]?.(row.value);
      if (!$apiSettings.aiLanguage) $apiSettings.aiLanguage = DEFAULT_AI_LANGUAGE;
    } catch (err) {
      console.error("[Settings] Failed to load:", err);
    }
  }

  async function saveSettings() {
    isSaving = true;
    try {
      await Promise.all([
        saveSetting("api_url",          $apiSettings.url),
        saveSetting("api_key",          $apiSettings.apiKey),
        saveSetting("api_model",        $apiSettings.model),
        saveSetting("thinking_mode",    $apiSettings.isThinkingModel),
        saveSetting("ai_language",      $apiSettings.aiLanguage),
        saveSetting("system_prompt",    $apiSettings.systemPrompt),
        saveSetting("api_temperature",  $apiSettings.temperature ?? 0.7),
      ]);
      const locale = get(pendingUiLocale);
      if (locale) setLocale(locale as any);
      goBack();
    } catch (err) {
      console.error("[Settings] Save failed:", err);
    }
    isSaving = false;
  }

  function goBack() {
    currentView.set("lobby");
  }
</script>

<PageWithNavSidebar
  pageTitle={m.settings_title()}
  navItems={NAV_ITEMS}
  {activeSection}
  onSectionClick={scrollToSection}
>
  <div slot="nav-header" let:mobile>
    {#if !mobile}
      <h2 class="text-lg font-medium text-ryokan-accent">{m.settings_title()}</h2>
    {/if}
  </div>

<div slot="actions" class="flex items-center gap-3">
    
    <Button variant="icon" ariaLabel={m.create_page_aria_back()} on:click={goBack}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
        <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </Button>

    <Button variant="secondary" disabled={isSaving} on:click={saveSettings}>
      {#if isSaving}
        <span class="save-spinner"></span>
      {:else}
        {m.settings_btn_save()}
      {/if}
    </Button>
    
  </div>

  <div slot="mobile-nav">
    {#each NAV_ITEMS as item}
      <button
        on:click={() => scrollToSection(item.id)}
        class="shrink-0 px-4 py-2 rounded-full text-xs font-semibold border transition-all
          {activeSection === item.id
            ? 'bg-white/[0.07] border-white/[0.08] text-white'
            : 'bg-white/[0.03] border-white/[0.06] text-gray-500 hover:text-white hover:bg-white/[0.05]'}"
      >
        {item.label}
      </button>
    {/each}
  </div>

  <div class="max-w-xl mx-auto px-8 pb-32 space-y-10 pt-8">
    <div bind:this={sectionEls["general"]}>
      <GeneralSection />
    </div>

    <div bind:this={sectionEls["api"]}>
      <ApiSection />
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

  /* Shared styles for settings sections */
  :global(.settings-card) {
    background: rgba(255, 255, 255, 0.03);
    border: 1px solid rgba(255, 255, 255, 0.06);
    border-radius: 16px;
    padding: 20px;
    transition: border-color 0.2s;
  }
  :global(.settings-card:hover) {
    border-color: rgba(255, 255, 255, 0.09);
  }
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