<script lang="ts">
  import { reportDiagnostic } from '$lib/diagnostics/diagnostics';
  import { appState, snapshotApiConnection } from "$lib/stores/appState.svelte";
  import PresetSection from './PresetSection.svelte';
  import { mobileCategoryGesture } from './mobileCategoryGesture';
  import { activateConnectionPreset, deactivateConnectionPreset, type RyokanPreset } from '$lib/ai/presets/presetCore';
  import { registerBackHandler, returnTo } from '$lib/stores/navigation';
  import { getAllSettings, saveSetting } from "$lib/settings/settings";
  import { parseTextRules, serializeTextRules, TEXT_RULES_KEY } from '$lib/ai/prompt/textRules';
  import { onMount } from "svelte";
  import { openUrl } from '@tauri-apps/plugin-opener';
  import { setLocale } from "$lib/paraglide/runtime";
  import * as m from "$lib/paraglide/messages";
  import ApiSection from "./ApiSection.svelte";
  import GeneralSection from "./GeneralSection.svelte";
  import TextRulesSection from "./TextRulesSection.svelte";
  import UpdateSection from './UpdateSection.svelte';
  import { clearExportFeedback, showExportFeedback } from '$lib/stores/exportFeedback';
  import { downloadDiagnostics } from '$lib/diagnostics/diagnostics';
  import { diagnosticsMetadata } from '$lib/diagnostics/diagnosticsMetadata';
  import Button from "$lib/components/ui/Button.svelte";
  import { createDefaultApiParameterEnabled, type ApiParameterKey } from "$lib/ai/connections/apiParameters";
  import { validateAdditionalApiParameters } from "$lib/ai/connections/additionalApiParameters";
  import { hydrateApiConnections, LONG_TERM_MEMORY_KEY, persistApiConnections, resolvedHardContextLimit, SUMMARY_CONNECTION_KEY } from "$lib/ai/connections/apiConnections";

  type SettingsCategory = "provider" | "presets" | "memory" | "textRules" | "appearance" | "language" | "advanced" | "about";
  type Category = { id: SettingsCategory; label: string; description: string; mobileDescription: string; icon: string };

  let powerUser = $state(false);
  let exportingDiagnostics = $state(false);

  async function exportDiagnostics() {
    if (exportingDiagnostics) return;
    exportingDiagnostics = true;
    clearExportFeedback();
    try {
      const exported = await downloadDiagnostics(
        diagnosticsMetadata(appState.apiSettings, appState.longTermMemory),
        appState.interactionMode
      );
      if (exported) showExportFeedback('success',
        appState.interactionMode === 'mobile' ? m.toast_diagnostics_exported() : m.toast_download_started());
    } catch {
      showExportFeedback('error', m.settings_diagnostics_failed());
    } finally {
      exportingDiagnostics = false;
    }
  }
  let parameterEnabled = $state<Record<ApiParameterKey, boolean>>(createDefaultApiParameterEnabled());

  const CATEGORIES: Category[] = [
    { id: "provider", label: m.settings_category_provider(), description: m.settings_category_provider_description(), mobileDescription: m.settings_category_provider_mobile_description(), icon: "M4 7h16M6 3h12v18H6zM9 11h6M9 15h6" },
    { id: 'presets', label: m.preset_title(), description: m.preset_short_description(), mobileDescription: m.preset_short_description(), icon: 'M4 5h16v14H4zM8 9h8M8 13h5' },
    { id: "memory", label: m.settings_category_memory(), description: m.settings_category_memory_description(), mobileDescription: m.settings_category_memory_mobile_description(), icon: "M9 4.5a3 3 0 015.83-1M9 4.5A3 3 0 003.5 6v1A3.5 3.5 0 005 13.7V15a4 4 0 004 4M15 4.5A3 3 0 0120.5 6v1A3.5 3.5 0 0119 13.7V15a4 4 0 01-4 4M9 4.5V19M15 4.5V19M9 9h2M13 14h2" },
    { id: "textRules", label: m.text_rules_title(), description: m.text_rules_short_description(), mobileDescription: m.text_rules_short_description(), icon: "M4 6h16M4 12h10M4 18h16" },
    { id: "appearance", label: m.settings_category_appearance(), description: m.settings_category_appearance_description(), mobileDescription: m.settings_category_appearance_mobile_description(), icon: "M3 6h18M6 10h12M9 14h6M12 18h.01" },
    { id: "language", label: m.settings_section_language(), description: m.settings_category_language_description(), mobileDescription: m.settings_category_language_description(), icon: "M12 21a9 9 0 100-18 9 9 0 000 18zm0 0c2.21 0 4-4.03 4-9s-1.79-9-4-9-4 4.03-4 9 1.79 9 4 9zM3.5 12h17" },
    { id: "advanced", label: m.settings_category_advanced(), description: m.settings_category_advanced_description(), mobileDescription: m.settings_category_advanced_mobile_description(), icon: "M12 15.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM19 12h2M3 12h2M12 3v2M12 19v2M5.64 5.64l1.42 1.42M16.94 16.94l1.42 1.42M18.36 5.64l-1.42 1.42M7.06 16.94l-1.42 1.42" },
    { id: "about", label: m.settings_category_about(), description: m.settings_category_about_description(), mobileDescription: m.settings_category_about_description(), icon: "M12 17v-5M12 8h.01M12 22a10 10 0 110-20 10 10 0 010 20z" },
  ];

  const CATEGORY_GROUPS = [
    { id: 'ai', label: m.settings_group_ai(), items: CATEGORIES.slice(0, 4) },
    { id: 'app', label: m.settings_group_app(), items: CATEGORIES.slice(4, 7) },
    { id: 'ryokan', label: 'Ryokan', items: CATEGORIES.slice(7) },
  ];

  let activeSection = $state<SettingsCategory>("provider");
  let mobileCategoryOpen = $state(false);
  let mobileCategoryPreview = $state<string | null>(null);
  let mobileCategoryHolding = $state(false);
  let isSaving = $state(false);
  let settingsReady = $state(false);
  let settingsContentEl: HTMLDivElement;
  const activeCategory = $derived(CATEGORIES.find((item) => item.id === activeSection) ?? CATEGORIES[0]);
  const generalCategory = $derived(activeSection === "language" ? "language" : "appearance");
  const additionalApiParametersValidation = $derived(validateAdditionalApiParameters(appState.apiSettings.additionalApiParameters));

  function selectCategory(id: SettingsCategory, mobile = false) {
    activeSection = id;
    if (settingsContentEl) settingsContentEl.scrollTop = 0;
    if (mobile) mobileCategoryOpen = true;
  }

  function handleConnectionChange(previousConnectionId: string) {
    const previous = appState.apiConnections.find(connection => connection.id === previousConnectionId);
    if (previous) previous.parameterEnabled = { ...parameterEnabled };
    parameterEnabled = { ...appState.apiSettings.parameterEnabled };
  }

  async function applyPreset(preset: RyokanPreset, id: string) {
    const connection = appState.apiSettings;
    const previous = snapshotApiConnection(connection);
    previous.parameterEnabled = { ...parameterEnabled };
    // Resolve once into the profile, before any chat/summary/multiplayer snapshot.
    Object.assign(connection, activateConnectionPreset(previous, preset, id));
    parameterEnabled = { ...connection.parameterEnabled };
    try { await persistApiConnections(); }
    catch (cause) { Object.assign(connection, previous, { appliedPresetId: previous.appliedPresetId ?? null, presetRestoreSnapshot: previous.presetRestoreSnapshot }); parameterEnabled = { ...previous.parameterEnabled }; throw cause; }
  }

  async function deactivatePreset() {
    const connection = appState.apiSettings;
    const previous = snapshotApiConnection(connection);
    previous.parameterEnabled = { ...parameterEnabled };
    Object.assign(connection, deactivateConnectionPreset(previous));
    parameterEnabled = { ...connection.parameterEnabled };
    try { await persistApiConnections(); }
    catch (cause) { Object.assign(connection, previous); parameterEnabled = { ...previous.parameterEnabled }; throw cause; }
  }

  function syncPresetParameters() {
    parameterEnabled = { ...appState.apiSettings.parameterEnabled };
  }

  onMount(loadSettings);

  async function loadSettings() {
    try {
      const settings = await getAllSettings();
      hydrateApiConnections(settings);
      appState.textRules = parseTextRules(settings.find(row => row.key === TEXT_RULES_KEY)?.value);
      parameterEnabled = { ...appState.apiSettings.parameterEnabled };
      powerUser = settings.find(row => row.key === 'settings_power_user')?.value === 'true';
      const chatFontScale = Number(settings.find(row => row.key === 'chat_font_scale')?.value);
      appState.chatFontScale = Number.isFinite(chatFontScale) && chatFontScale >= 80 && chatFontScale <= 140 ? chatFontScale : 100;
    } catch (err) { reportDiagnostic('settings'); }
    finally { settingsReady = true; }
  }

  async function saveSettings() {
    if (!additionalApiParametersValidation.valid) return;
    isSaving = true;
    try {
      appState.apiSettings.parameterEnabled = { ...parameterEnabled };
      appState.apiSettings.contextLimit = resolvedHardContextLimit(appState.apiSettings);
      await Promise.all([
        persistApiConnections(),
        saveSetting(TEXT_RULES_KEY, serializeTextRules(appState.textRules)),
        saveSetting("settings_power_user", powerUser),
        saveSetting("chat_font_scale", appState.chatFontScale),
        saveSetting(LONG_TERM_MEMORY_KEY, appState.longTermMemory),
        saveSetting(SUMMARY_CONNECTION_KEY, appState.summaryConnectionId),
      ]);
      const locale = appState.pendingUiLocale;
      if (locale) setLocale(locale as any);
      goBack();
    } catch (err) { reportDiagnostic('settings'); }
    finally { isSaving = false; }
  }

  function goBack() { returnTo('lobby'); }

  async function openExternalLink(url: string) {
    try { await openUrl(url); }
    catch (error) { reportDiagnostic('settings'); }
  }

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

{#snippet communityLinks()}
  <div class="community-card" role="group" aria-label={m.settings_community_links_aria()}>
    <button type="button" class="discord-link" aria-label={m.settings_discord_aria()} title="Discord" onclick={() => openExternalLink('https://discord.gg/shrZCsfGWK')}>
      <span class="discord-icon"><svg width="19" height="19" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M13.545 2.907a13.2 13.2 0 0 0-3.257-1.011.05.05 0 0 0-.052.025c-.141.25-.297.577-.406.833a12.2 12.2 0 0 0-3.658 0 8 8 0 0 0-.412-.833.05.05 0 0 0-.052-.025c-1.125.194-2.22.534-3.257 1.011a.04.04 0 0 0-.021.018C.356 6.024-.213 9.047.066 12.032q.003.022.021.037a13.3 13.3 0 0 0 3.995 2.02.05.05 0 0 0 .056-.019q.463-.63.818-1.329a.05.05 0 0 0-.01-.059l-.018-.011a9 9 0 0 1-1.248-.595.05.05 0 0 1-.02-.066l.015-.019q.127-.095.248-.195a.05.05 0 0 1 .051-.007c2.619 1.196 5.454 1.196 8.041 0a.05.05 0 0 1 .053.007q.121.1.248.195a.05.05 0 0 1-.004.085 8 8 0 0 1-1.249.594.05.05 0 0 0-.03.03.05.05 0 0 0 .003.041c.24.465.515.909.817 1.329a.05.05 0 0 0 .056.019 13.2 13.2 0 0 0 4.001-2.02.05.05 0 0 0 .021-.037c.334-3.451-.559-6.449-2.366-9.106a.03.03 0 0 0-.02-.019m-8.198 7.307c-.789 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.45.73 1.438 1.613 0 .888-.637 1.612-1.438 1.612m5.316 0c-.788 0-1.438-.724-1.438-1.612s.637-1.613 1.438-1.613c.807 0 1.451.73 1.438 1.613 0 .888-.631 1.612-1.438 1.612"/></svg></span>
      <span class="discord-label">Discord</span>
    </button>
    <button type="button" class="github-link" aria-label={m.settings_github_aria()} title="GitHub" onclick={() => openExternalLink('https://github.com/Finn-Hecker/RyokanApp')}>
      <svg width="20" height="20" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.64 0 8.13c0 3.59 2.29 6.64 5.47 7.71.4.08.55-.18.55-.39 0-.19-.01-.83-.01-1.51-2.01.38-2.53-.5-2.69-.96-.09-.23-.48-.96-.82-1.15-.28-.15-.68-.53-.01-.54.63-.01 1.08.59 1.23.83.72 1.23 1.87.88 2.33.67.07-.53.28-.88.51-1.08-1.78-.21-3.64-.91-3.64-4.02 0-.89.31-1.62.82-2.19-.08-.2-.36-1.04.08-2.16 0 0 .67-.22 2.2.84A7.5 7.5 0 0 1 8 3.9c.68 0 1.36.09 2 .28 1.53-1.06 2.2-.84 2.2-.84.44 1.12.16 1.96.08 2.16.51.57.82 1.3.82 2.19 0 3.12-1.87 3.81-3.65 4.02.29.25.54.74.54 1.5 0 1.08-.01 1.95-.01 2.22 0 .22.15.47.55.39A8.14 8.14 0 0 0 16 8.13C16 3.64 12.42 0 8 0"/></svg>
      <span class="github-label">GitHub</span>
    </button>
  </div>
{/snippet}

{#snippet categoryIcon(item: Category)}
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true">
    {#each item.icon.split("M").filter(Boolean) as d}<path d="M{d}" stroke-linecap="round" stroke-linejoin="round" />{/each}
  </svg>
{/snippet}

{#snippet saveButton()}
  <Button variant="secondary" disabled={isSaving || !additionalApiParametersValidation.valid} onclick={saveSettings}>
    {#if isSaving}<span class="save-spinner"></span>{:else}{m.settings_btn_save()}{/if}
  </Button>
{/snippet}

{#snippet powerToggle()}
  <label class="power-user-toggle" title={m.settings_power_user_title()}>
    <span class="power-icon" class:active={powerUser}><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg></span>
    <span class="power-copy"><span class="power-label">{m.settings_power_user_label()}</span><span class="power-description">{m.settings_power_user_description()}</span></span>
    <input type="checkbox" bind:checked={powerUser} class="settings-switch-input sr-only" />
    <span class="settings-switch-track"><span class="settings-switch-thumb"></span></span>
  </label>
{/snippet}

<div class="settings-shell" role="region" aria-label={m.settings_title()}>
  <aside class="desktop-sidebar" aria-label={m.settings_categories_aria()}>
    <div class="sidebar-title">{m.settings_title()}</div>
    <nav class="category-nav">
      {#each CATEGORY_GROUPS as group}
        <div class="desktop-category-group" role="group" aria-label={group.label}>
          <p class="category-group-label">{group.label}</p>
          {#each group.items as item}
            <button type="button" class="category-nav-item" class:category-nav-item--active={activeSection === item.id} aria-current={activeSection === item.id ? "page" : undefined} onclick={() => selectCategory(item.id)}>
              {@render categoryIcon(item)}<span>{item.label}</span>
            </button>
          {/each}
        </div>
      {/each}
    </nav>
    <div class="sidebar-footer">{@render communityLinks()}</div>
  </aside>

  <main class="settings-main">
    <header class="app-page-header desktop-header">
      <div><h1>{activeCategory.label}</h1><p>{activeCategory.description}</p></div>
      <div class="header-actions"><Button variant="icon" ariaLabel={m.create_page_aria_back()} onclick={goBack}>{@render backIcon()}</Button>{@render saveButton()}</div>
    </header>

    <header class="app-page-header mobile-header">
      <Button variant="icon" ariaLabel={mobileCategoryOpen ? m.settings_back_to_overview() : m.create_page_aria_back()} onclick={() => mobileCategoryOpen ? (mobileCategoryOpen = false) : goBack()}>{@render backIcon()}</Button>
      <h1>{mobileCategoryOpen ? activeCategory.label : m.settings_title()}</h1>
      {@render saveButton()}
    </header>

    <div class="mobile-overview" class:mobile-overview--hidden={mobileCategoryOpen}>
      <nav class="mobile-category-groups" class:mobile-category-groups--holding={mobileCategoryHolding} aria-label={m.settings_categories_aria()} use:mobileCategoryGesture={{
        onHolding: (holding) => { mobileCategoryHolding = holding; },
        onPreview: (id) => { mobileCategoryPreview = id; },
        onSelect: (id) => {
          const category = CATEGORIES.find(item => item.id === id);
          if (category) selectCategory(category.id, true);
        },
      }}>
        {#each CATEGORY_GROUPS as group}
          <div class="mobile-category-group" role="group" aria-label={group.label}>
            <p class="category-group-label">{group.label}</p>
            <div class="mobile-category-list">
              {#each group.items as item}
                <button type="button" class="mobile-category-row" data-category-id={item.id} class:mobile-category-row--preview={mobileCategoryPreview === item.id} onclick={() => selectCategory(item.id, true)}>
                  <span class="mobile-category-icon">{@render categoryIcon(item)}</span>
                  <span class="mobile-category-copy"><span class="mobile-category-label">{item.label}</span><span class="mobile-category-description">{item.mobileDescription}</span></span>
                  <svg class="mobile-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m9 18 6-6-6-6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                </button>
              {/each}
            </div>
          </div>
        {/each}
      </nav>
    </div>

    <div bind:this={settingsContentEl} class="settings-content" class:settings-content--mobile-hidden={!mobileCategoryOpen}>
      <div class="content-panel" hidden={activeSection !== "provider" && activeSection !== "memory"}><ApiSection powerUser={powerUser} active={activeSection === "provider"} section={activeSection === "memory" ? "memory" : "provider"} {settingsReady} bind:parameterEnabled onConnectionChange={handleConnectionChange} /></div>
      <div class="content-panel" hidden={activeSection === "provider" || activeSection === "memory"}>
        {#if activeSection === "presets" && settingsReady}<PresetSection {parameterEnabled} onApply={applyPreset} onDeactivate={deactivatePreset} onDeleted={syncPresetParameters} />{/if}
        {#if activeSection === "textRules" && settingsReady}<TextRulesSection />{/if}
        {#if activeSection === "advanced"}
          <div class="advanced-mode">{@render powerToggle()}</div>
        {/if}
        {#if activeSection === "about"}
          <UpdateSection />
          <div class="advanced-mode">
            <p class="power-label">{m.settings_diagnostics_title()}</p>
            <p class="power-description" style="margin: 8px 0 14px">{m.settings_diagnostics_description()}</p>
            <Button variant="secondary" disabled={exportingDiagnostics} onclick={exportDiagnostics}>
              {exportingDiagnostics ? m.settings_diagnostics_exporting() : m.settings_diagnostics_export()}
            </Button>
          </div>
          <div class="mobile-about-community">{@render communityLinks()}</div>
        {/if}
        {#if activeSection === "appearance" || activeSection === "language"}
          <GeneralSection powerUser={powerUser} bind:parameterEnabled category={generalCategory} />
        {/if}
      </div>
    </div>
  </main>
</div>

<style>
  .settings-shell { height:100%; width:100%; display:flex; overflow:hidden; background:var(--color-ryokan-bg,#111); }
  .desktop-sidebar,.desktop-header { display:none; }
  .settings-main { min-width:0; flex:1; display:flex; flex-direction:column; overflow:hidden; }
  .mobile-header { flex:0 0 auto; display:grid; grid-template-columns:40px minmax(0,1fr) auto; align-items:center; gap:8px; border-bottom:1px solid rgba(255,255,255,.05); }
  .mobile-header h1 { min-width:0; color:#e7e2da; font-size:17px; font-weight:650; letter-spacing:-.01em; overflow-wrap:anywhere; }
  .mobile-overview { flex:1; display:flex; flex-direction:column; overflow-y:auto; padding:var(--page-content-top) var(--page-gutter) calc(28px + env(safe-area-inset-bottom)); }
  .mobile-overview,.settings-content { -ms-overflow-style:none; scrollbar-width:none; }
  .mobile-overview::-webkit-scrollbar,.settings-content::-webkit-scrollbar { display:none; }
  .mobile-overview--hidden,.settings-content--mobile-hidden { display:none; }
  .mobile-category-groups { flex:0 0 auto; display:flex; flex-direction:column; gap:6px; }
  .category-group-label { margin:0 0 6px; padding:0 14px; color:#8d8b8f; font-size:10px; font-weight:600; }
  .mobile-category-list { overflow:hidden; border-radius:15px; background:rgba(255,255,255,.025); }
  .mobile-category-row { width:100%; min-height:64px; display:flex; align-items:center; gap:13px; padding:10px 14px; color:#c9c7ca; text-align:left; cursor:pointer; transition:background 140ms ease; }
  .mobile-category-row + .mobile-category-row { border-top:1px solid rgba(255,255,255,.055); }
  .mobile-category-row:active,.mobile-category-row--preview { background:rgba(255,255,255,.045); }
  .mobile-category-groups--holding .mobile-category-row:not(.mobile-category-row--preview) { background:transparent; }
  .mobile-category-row { user-select:none; -webkit-touch-callout:none; }
  .mobile-category-icon { width:32px; height:32px; flex:0 0 auto; display:grid; place-items:center; border-radius:9px; color:#d4b483; background:rgba(212,180,131,.09); }
  .mobile-category-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:2px; }
  .mobile-category-label { font-size:14px; font-weight:620; color:#e1dfe2; }
  .mobile-category-description { font-size:11px; line-height:1.35; color:#65656a; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .mobile-chevron { flex:0 0 auto; color:#444448; }
  .community-card { width:100%; min-height:52px; display:grid; grid-template-columns:minmax(0,1fr) minmax(0,1fr); overflow:hidden; border:1px solid rgba(255,255,255,.055); border-radius:12px; background:rgba(255,255,255,.025); transition:border-color .15s; }
  .community-card:hover { border-color:rgba(145,152,229,.18); }
  .discord-link,.github-link { width:100%; min-width:0; min-height:50px; display:flex; align-items:center; justify-content:center; gap:7px; padding:8px; font-size:12px; font-weight:600; white-space:nowrap; cursor:pointer; transition:color .15s,background .15s; }
  .discord-link { color:#aaa8ac; }
  .discord-link:hover { color:#e0dce5; background:rgba(255,255,255,.025); }
  .discord-link:active { background:rgba(145,152,229,.1); }
  .discord-icon { width:24px; height:24px; flex:0 0 auto; display:grid; place-items:center; border-radius:7px; color:#a7adeb; background:rgba(145,152,229,.12); }
  .discord-icon svg { width:16px; height:16px; }
  .discord-label,.github-label { flex:0 0 auto; overflow:visible; text-overflow:clip; }
  .github-link { border-left:1px solid rgba(255,255,255,.065); color:#8d8b8f; }
  .github-link svg { width:17px; height:17px; flex:0 0 auto; }
  .github-link:hover { color:#d8d5d1; background:rgba(255,255,255,.04); }
  .github-link:active { background:rgba(212,180,131,.08); }
  .discord-link:focus-visible,.github-link:focus-visible { position:relative; z-index:1; outline:2px solid #d4b483; outline-offset:-2px; }
  .settings-content { flex:1; overflow-y:auto; overflow-x:hidden; padding:var(--page-content-top) var(--page-gutter) calc(36px + env(safe-area-inset-bottom)); }
  .content-panel { width:100%; max-width:660px; margin:0 auto; }
  .content-panel[hidden] { display:none; }
  .advanced-mode { margin-bottom:22px; padding-bottom:22px; border-bottom:1px solid rgba(255,255,255,.055); }
  .power-user-toggle { min-height:58px; display:flex; align-items:center; gap:12px; padding:4px 2px; cursor:pointer; user-select:none; }
  .power-icon { width:34px; height:34px; flex:0 0 auto; display:grid; place-items:center; border-radius:10px; color:#57575c; background:rgba(255,255,255,.035); transition:color .18s,background .18s; }
  .power-icon.active { color:#d4b483; background:rgba(212,180,131,.09); }
  .power-copy { min-width:0; flex:1; display:flex; flex-direction:column; gap:3px; }
  .power-label { color:#d1cfd2; font-size:13px; font-weight:650; }
  .power-description { color:#5e5e63; font-size:11px; line-height:1.35; }
  :global(.settings-switch-track) { position:relative; width:42px; height:24px; flex:0 0 auto; border-radius:999px; background:rgba(255,255,255,.07); border:1px solid rgba(255,255,255,.08); transition:background .2s,border-color .2s; }
  :global(.settings-switch-thumb) { position:absolute; width:16px; height:16px; left:3px; top:3px; border-radius:50%; background:#5a5a5e; transition:transform .2s,background .2s; }
  :global(.settings-switch-input:checked + .settings-switch-track) { background:rgba(212,180,131,.2); border-color:rgba(212,180,131,.4); }
  :global(.settings-switch-input:checked + .settings-switch-track .settings-switch-thumb) { transform:translateX(18px); background:#d4b483; }
  :global(.settings-switch-input:focus-visible + .settings-switch-track) { outline:2px solid #d4b483; outline-offset:3px; }
  .save-spinner { width:12px; height:12px; border:2px solid rgba(255,255,255,.12); border-top-color:rgba(255,255,255,.6); border-radius:50%; animation:spin .6s linear infinite; }
  @keyframes spin { to { transform:rotate(360deg); } }
  @media (hover:hover) and (pointer:fine) {
    .mobile-category-row:hover { background:rgba(255,255,255,.045); }
    .mobile-category-groups--holding .mobile-category-row:not(.mobile-category-row--preview):hover { background:transparent; }
  }
  @media (min-width:768px) {
    .desktop-sidebar { width:256px; flex:0 0 auto; display:flex; flex-direction:column; border-right:1px solid rgba(255,255,255,.055); background:var(--color-ryokan-sidebar,#151515); }
    .sidebar-title { height:var(--page-header-height); display:flex; align-items:center; padding:0 24px; color:#d4b483; font-size:18px; font-weight:650; border-bottom:1px solid rgba(255,255,255,.045); }
    .category-nav { padding:14px 12px; display:flex; flex-direction:column; gap:3px; }
    .desktop-category-group { display:flex; flex-direction:column; gap:3px; }
    .desktop-category-group + .desktop-category-group { margin-top:5px; padding-top:8px; border-top:1px solid rgba(255,255,255,.055); }
    .desktop-category-group .category-group-label { padding:0 12px; margin-bottom:2px; }
    .category-nav-item { min-height:42px; width:100%; display:flex; align-items:center; gap:11px; padding:9px 12px; border-radius:10px; color:#6d6d72; text-align:left; font-size:13px; font-weight:560; cursor:pointer; transition:color .15s,background .15s; }
    .category-nav-item:hover { color:#bbb8b5; background:rgba(255,255,255,.03); }
    .category-nav-item--active { color:#d8c5a8; background:rgba(212,180,131,.075); }
    .sidebar-footer { margin-top:auto; padding:14px 12px 16px; border-top:1px solid rgba(255,255,255,.055); }
    .desktop-header { flex:0 0 auto; display:flex; align-items:center; justify-content:space-between; gap:24px; border-bottom:1px solid rgba(255,255,255,.045); }
    .desktop-header h1 { color:#e4e0da; font-size:18px; font-weight:650; letter-spacing:-.01em; }
    .desktop-header p { margin-top:2px; color:#5e5e63; font-size:11px; }
    .header-actions { display:flex; align-items:center; gap:10px; }
    .mobile-header,.mobile-overview,.mobile-about-community { display:none; }
    .settings-content,.settings-content--mobile-hidden { display:block; padding:var(--page-content-top) var(--page-gutter) 72px; }
  }
</style>
