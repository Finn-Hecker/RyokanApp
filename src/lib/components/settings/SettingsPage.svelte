<script lang="ts">
  import { fade } from "svelte/transition";
  import { currentView, apiSettings, pendingUiLocale } from "$lib/stores/appState";
  import { getAllSettings, saveSetting } from "$lib/db/settings";
  import { onMount } from "svelte";
  import { get } from "svelte/store";
  import { setLocale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";

  import ApiSection from "./ApiSection.svelte";
  import GeneralSection from "./GeneralSection.svelte";

  const NAV_ITEMS = [
    { id: "general", label: () => m.settings_nav_general() },
    { id: "api",     label: () => m.settings_nav_api() },
  ] as const;

  type SectionId = typeof NAV_ITEMS[number]["id"];
  let activeSection: SectionId = "general";

  let isSaving = false;

  let scrollContainer: HTMLElement;
  let sectionEls: Record<string, HTMLElement> = {};

  function scrollToSection(id: string) {
    activeSection = id as SectionId;
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

<div
  class="h-full w-full flex overflow-hidden"
  in:fade={{ duration: 200 }}
  role="region"
  aria-label={m.settings_title()}
>

  <!-- Sidebar (desktop) -->
  <nav
    class="hidden md:flex flex-col w-52 shrink-0 border-r border-white/[0.06] pt-6 px-4 pb-8 gap-1"
    aria-label="Settings navigation"
  >
    <!-- Back button -->
    <button
      on:click={goBack}
      aria-label={m.create_page_aria_back()}
      class="flex items-center justify-center w-10 h-10 mb-5
             bg-white/5 hover:bg-white/10 border border-white/5
             hover:border-ryokan-accent/30 text-gray-400 hover:text-white
             transition-all rounded-full active:scale-95"
    >
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
        <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>
    </button>

    <p class="text-[10px] font-semibold uppercase tracking-widest text-gray-600 px-3 mb-1">
      {m.settings_title()}
    </p>

    {#each NAV_ITEMS as item}
      <button
        on:click={() => scrollToSection(item.id)}
        class="text-left px-3 py-2.5 rounded-xl text-sm transition-all
          {activeSection === item.id
            ? 'bg-white/[0.07] text-white font-medium border border-white/[0.08]'
            : 'text-gray-400 hover:text-white hover:bg-white/[0.04]'}"
      >
        {item.label()}
      </button>
    {/each}
  </nav>

  <!-- Main area -->
  <div class="flex flex-col flex-1 min-w-0 overflow-hidden">

    <!-- Top bar -->
    <div class="flex items-center justify-between px-8 pt-6 pb-4 shrink-0">

      <!-- Mobile-only back button -->
      <button
        on:click={goBack}
        aria-label={m.create_page_aria_back()}
        class="md:hidden flex items-center justify-center w-10 h-10
               bg-white/5 hover:bg-white/10 border border-white/5
               hover:border-ryokan-accent/30 text-gray-400 hover:text-white
               transition-all rounded-full active:scale-95"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true">
          <path d="M15 18l-6-6 6-6" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>

      <!-- Desktop spacer -->
      <div class="hidden md:block w-10" aria-hidden="true"></div>

      <span class="text-sm font-medium text-gray-400 tracking-wide">
        {m.settings_title()}
      </span>

      <!-- Save button -->
      <button
        on:click={saveSettings}
        disabled={isSaving}
        class="group flex items-center gap-2 h-10 px-4
               border transition-all rounded-full active:scale-95
               text-sm font-medium tracking-wide
               disabled:opacity-50 disabled:cursor-not-allowed
               bg-white/5 hover:bg-white/10 border-white/5 hover:border-ryokan-accent/30 text-gray-400 hover:text-white"
      >
        {#if isSaving}
          <span class="save-spinner" aria-hidden="true"></span>
        {:else}
          {m.settings_btn_save()}
        {/if}
      </button>
    </div>

    <!-- Mobile section pills -->
    <div class="md:hidden flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar shrink-0">
      {#each NAV_ITEMS as item}
        <button
          on:click={() => scrollToSection(item.id)}
          class="shrink-0 px-4 py-1.5 rounded-full text-xs font-semibold border transition-all
            {activeSection === item.id
              ? 'bg-white/[0.07] border-white/[0.12] text-white'
              : 'bg-transparent border-white/[0.06] text-gray-500 hover:text-white'}"
        >
          {item.label()}
        </button>
      {/each}
    </div>

    <!-- Scrollable sections -->
    <div bind:this={scrollContainer} class="flex-1 overflow-y-auto overflow-x-hidden">
      <div class="max-w-xl mx-auto px-8 pb-32 space-y-10">

        <div bind:this={sectionEls["general"]}>
          <GeneralSection />
        </div>

        <div bind:this={sectionEls["api"]}>
          <ApiSection />
        </div>

      </div>
    </div>

  </div>
</div>

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

  .no-scrollbar::-webkit-scrollbar { display: none; }
  .no-scrollbar { -ms-overflow-style: none; scrollbar-width: none; }

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