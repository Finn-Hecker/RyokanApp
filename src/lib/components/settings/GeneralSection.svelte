<script lang="ts">
  import { appState } from "$lib/stores/appState.svelte";
  import { getLocale } from "$lib/paraglide/runtime";
  import ChatMessage from '$lib/components/chat/ChatMessage.svelte';
  import * as m from "$lib/paraglide/messages";
  import {
    createDefaultApiParameterEnabled,
    type ApiParameterKey,
  } from "$lib/ai/connections/apiParameters";
  import { validateAdditionalApiParameters } from "$lib/ai/connections/additionalApiParameters";
  import ParameterControl from '$lib/components/settings/ParameterControl.svelte';
  import ReasoningControl from './ReasoningControl.svelte';
  import ThinkingBudgetControl from './ThinkingBudgetControl.svelte';
  import PromptControls from './PromptControls.svelte';
  import { ANTHROPIC_DEFAULT_OUTPUT_CAP, GEMINI_DEFAULT_OUTPUT_CAP } from '$lib/ai/tokens/providerTokenBudget';

  export let connection: import("$lib/stores/appState.svelte").ApiConnection = appState.apiSettings;
  export let promptPrefix = 'connection';
  export let powerUser: boolean = false;
  export let category: "parameters" | "advanced" | "appearance" | "language" = "parameters";

  export let parameterEnabled: Record<ApiParameterKey, boolean> =
    createDefaultApiParameterEnabled();

  $: additionalApiParametersValidation = validateAdditionalApiParameters(
    connection.additionalApiParameters,
  );

  $: additionalApiParametersError = additionalApiParametersValidation.valid
    ? ""
    : additionalApiParametersValidation.error === "invalidJson"
      ? m.settings_additional_api_parameters_error_invalid_json()
      : additionalApiParametersValidation.error === "rootMustBeObject"
        ? m.settings_additional_api_parameters_error_object()
        : m.settings_additional_api_parameters_error_protected({
            fields: additionalApiParametersValidation.fields?.join(", ") ?? "",
          });

  function toggleParameter(key: ApiParameterKey) {
    parameterEnabled = {
      ...parameterEnabled,
      [key]: !parameterEnabled[key],
    };
  }

  const uiLanguages = [
    { code: "de", label: "Deutsch", country: "de" as const },
    { code: "en", label: "English", country: "gb" as const },
  ];

  function handleUiLanguageChange(code: string) {
    appState.pendingUiLocale = code;
  }

</script>

{#snippet languageFlag(country: "de" | "gb")}
  <span class="language-flag" aria-hidden="true">
    {#if country === "de"}
      <svg viewBox="0 0 60 40" role="presentation">
        <rect width="60" height="13.34" y="0" fill="#111111" />
        <rect width="60" height="13.34" y="13.33" fill="#DD0000" />
        <rect width="60" height="13.34" y="26.66" fill="#FFCE00" />
      </svg>
    {:else}
      <svg viewBox="0 0 60 40" role="presentation">
        <rect width="60" height="40" fill="#012169" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#FFFFFF" stroke-width="9" />
        <path d="M0 0L60 40M60 0L0 40" stroke="#C8102E" stroke-width="4.5" />
        <path d="M30 0V40M0 20H60" stroke="#FFFFFF" stroke-width="13" />
        <path d="M30 0V40M0 20H60" stroke="#C8102E" stroke-width="7" />
      </svg>
    {/if}
  </span>
{/snippet}

{#if category === "parameters" || category === "advanced"}
<section>
  <span class="settings-section-title">{category === "advanced" ? m.settings_category_advanced() : m.settings_section_ai_behavior()}</span>
  <div class="settings-card space-y-4">

    {#if category === "parameters"}

    <ReasoningControl connection={connection} />
    <ThinkingBudgetControl connection={connection} {powerUser} onChange={() => {
      parameterEnabled = { ...parameterEnabled, thinkingBudget: connection.parameterEnabled.thinkingBudget };
    }} />
    <ParameterControl connection={connection} parameter="temperature" enabled={parameterEnabled.temperature} {powerUser}
      onToggle={() => toggleParameter("temperature")}
      onValue={(value) => { connection.temperature = value; }}>
      {#snippet tooltip()}{m.settings_creativity_tooltip_p1()}<br><br>
        {m.settings_creativity_tooltip_p2a()}<br>
        {m.settings_creativity_tooltip_p2b()}<br><br>
        <span class="tooltip-hint">{m.settings_creativity_tooltip_hint()}</span>{/snippet}
    </ParameterControl>

    <div class="settings-divider"></div>
    <ParameterControl connection={connection} parameter="maxTokens" enabled={parameterEnabled.maxTokens} {powerUser}
      onToggle={() => toggleParameter("maxTokens")}
      onValue={(value) => { connection.maxTokens = value; }}>
      {#snippet tooltip()}{m.settings_tokens_tooltip_p1()}<br><br>
        {m.settings_tokens_tooltip_p2()}<br><br>
        <span class="tooltip-hint">{m.settings_tokens_tooltip_hint()}</span>{/snippet}
      {#snippet note()}{#if connection.providerKind === 'anthropic' || connection.providerKind === 'gemini'}
        <p class="native-token-note">{getLocale() === 'de'
        ? 'Gemeinsames Limit für Thinking und Antwort. Bei deaktiviertem Schalter: '
        : 'Combined limit for thinking and answer. With the switch off: '}{connection.providerKind === 'anthropic'
        ? ANTHROPIC_DEFAULT_OUTPUT_CAP : GEMINI_DEFAULT_OUTPUT_CAP} Tokens.</p>
        {/if}{/snippet}
    </ParameterControl>

    <div class="settings-divider"></div>
    <ParameterControl connection={connection} parameter="repetitionPenalty" enabled={parameterEnabled.repetitionPenalty} {powerUser}
      onToggle={() => toggleParameter("repetitionPenalty")}
      onValue={(value) => { connection.repetitionPenalty = value; }}>
      {#snippet tooltip()}{m.settings_penalty_tooltip_p1()}<br><br>
        <span class="tooltip-warn">{m.settings_penalty_tooltip_warn()}</span><br><br>
        <span class="tooltip-hint">{m.settings_penalty_tooltip_hint()}</span>{/snippet}
    </ParameterControl>

    <div class="settings-divider"></div>
    <PromptControls systemPrompt={connection.systemPrompt} postHistoryPrompt={connection.postHistoryPrompt}
      onSystemChange={(value) => { connection.systemPrompt = value; }}
      onPostHistoryChange={(value) => { connection.postHistoryPrompt = value; }} prefix={promptPrefix} />
    {/if}

    {#if category === "advanced"}
    <ParameterControl connection={connection} parameter="topP" enabled={parameterEnabled.topP} {powerUser}
      onToggle={() => toggleParameter("topP")}
      onValue={(value) => { connection.topP = value; }}>
      {#snippet tooltip()}{m.settings_topp_tooltip_p1()}<br><br>
        {m.settings_topp_tooltip_p2()}<br><br>
        <span class="tooltip-hint">{m.settings_topp_tooltip_hint()}</span>{/snippet}
    </ParameterControl>

    <div class="settings-divider"></div>
    <ParameterControl connection={connection} parameter="topK" enabled={parameterEnabled.topK} {powerUser}
      onToggle={() => toggleParameter("topK")}
      onValue={(value) => { connection.topK = value; }}>
      {#snippet tooltip()}{m.settings_topk_tooltip_p1()}<br><br>
        {m.settings_topk_tooltip_p2()}<br><br>
        <span class="tooltip-hint">{m.settings_topk_tooltip_hint()}</span>{/snippet}
    </ParameterControl>

    <div class="settings-divider"></div>
    <ParameterControl connection={connection} parameter="minP" enabled={parameterEnabled.minP} {powerUser}
      onToggle={() => toggleParameter("minP")}
      onValue={(value) => { connection.minP = value; }}>
      {#snippet tooltip()}{m.settings_minp_tooltip_p1()}<br><br>
        {m.settings_minp_tooltip_p2()}<br><br>
        <span class="tooltip-hint">{m.settings_minp_tooltip_hint()}</span>{/snippet}
    </ParameterControl>

    <div class="settings-divider"></div>
    <ParameterControl connection={connection} parameter="frequencyPenalty" enabled={parameterEnabled.frequencyPenalty} {powerUser}
      onToggle={() => toggleParameter("frequencyPenalty")}
      onValue={(value) => { connection.frequencyPenalty = value; }}>
      {#snippet tooltip()}{m.settings_freqpenalty_tooltip_p1()}<br><br>
        {m.settings_freqpenalty_tooltip_p2()}<br><br>
        <span class="tooltip-hint">{m.settings_freqpenalty_tooltip_hint()}</span>{/snippet}
    </ParameterControl>

    <div class="settings-divider"></div>

    <div class="additional-parameters-field">
      <div class="additional-parameters-heading">
        <label class="settings-label" for="additional-api-parameters" style="margin-bottom:0">
          {m.settings_additional_api_parameters_label()}
        </label>
        <span class="power-user-badge">{m.settings_power_user_label()}</span>
      </div>
      <p id="additional-api-parameters-description" class="additional-parameters-description">
        {m.settings_additional_api_parameters_description()}
      </p>
      <textarea
        id="additional-api-parameters"
        class="settings-input additional-parameters-input"
        class:additional-parameters-input--error={additionalApiParametersError}
        bind:value={connection.additionalApiParameters}
        placeholder={m.settings_additional_api_parameters_placeholder()}
        aria-describedby="additional-api-parameters-description additional-api-parameters-error"
        aria-invalid={additionalApiParametersError ? "true" : "false"}
        spellcheck="false"
      ></textarea>
      {#if additionalApiParametersError}
        <p id="additional-api-parameters-error" class="additional-parameters-error" role="alert">
          {additionalApiParametersError}
        </p>
      {/if}
    </div>

    {/if}

  </div>
</section>
{/if}

{#if category === "appearance"}
<section>
  <h2 class="appearance-heading">{m.settings_section_chat()}</h2>
  <div class="settings-card">
    <div class="flex items-center justify-between mb-2">
      <label class="settings-label" for="chat-font-scale" style="margin-bottom:0">{m.settings_chat_font_size_label()}</label>
      <span class="power-value">{appState.chatFontScale} %</span>
    </div>
    <input id="chat-font-scale" type="range" min="80" max="140" step="1"
      bind:value={appState.chatFontScale} class="power-slider" />
    <div class="slider-bounds"><span>80 %</span><span>140 %</span></div>
    <div class="chat-preview" role="group" aria-label={m.settings_chat_preview_label()}>
      <div class="chat-preview-heading">{m.settings_chat_preview_label()}</div>
      <div class="chat-content chat-preview-thread" style:--chat-font-scale={appState.chatFontScale / 100}>
        <ChatMessage
          msg={{ id: 'preview-ai', text: m.settings_chat_preview_ai(), isUser: false, senderName: 'Ryokan', swipeVariants: [], swipeIndex: 0 }}
          character={{ name: 'Ryokan', initials: 'R' }}
          interactionMode={appState.interactionMode}
        />
        <ChatMessage
          msg={{ id: 'preview-user', text: m.settings_chat_preview_user(), isUser: true, senderName: 'You', swipeVariants: [], swipeIndex: 0 }}
          interactionMode={appState.interactionMode}
        />
      </div>
    </div>
  </div>
</section>
{/if}

{#if category === "language"}
<section>
  <span class="settings-section-title">{m.settings_section_language()}</span>
  <div class="settings-card language-settings-card">

    <div class="language-group">
      <div class="language-group-header">
        <span class="settings-label language-group-label">{m.settings_language_label()}</span>
      </div>

      <div class="language-grid" role="radiogroup" aria-label={m.settings_language_label()}>
        {#each uiLanguages as language}
          {@const selected = (appState.pendingUiLocale || getLocale()) === language.code}
          <button
            type="button"
            class:language-choice--selected={selected}
            class="language-choice"
            role="radio"
            aria-checked={selected}
            on:click={() => handleUiLanguageChange(language.code)}
          >
            {@render languageFlag(language.country)}
            <span class="language-copy">
              <span class="language-name">{language.label}</span>
            </span>
            <span class="language-state" aria-hidden="true">
              {#if selected}
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M4 8.25 6.6 10.8 12 5.4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
                </svg>
              {/if}
            </span>
          </button>
        {/each}
      </div>
    </div>

  </div>
</section>
{/if}

<style>
  .power-value {
    font-size: 11px;
    font-weight: 700;
    color: #d4b483;
    letter-spacing: 0.04em;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.16s ease, color 0.16s ease;
  }
  .power-slider {
    width: 100%;
    appearance: none;
    height: 4px;
    border-radius: 4px;
    background: rgba(255,255,255,0.1);
    outline: none;
    cursor: pointer;
    display: block;
    margin-top: 4px;
  }
  .power-slider::-webkit-slider-thumb {
    appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #d4b483;
    border: 2px solid rgba(0,0,0,0.4);
    cursor: pointer;
    transition: transform 0.1s;
  }
  .power-slider::-webkit-slider-thumb:hover { transform: scale(1.2); }
  .power-slider::-moz-range-thumb {
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: #d4b483;
    border: 2px solid rgba(0,0,0,0.4);
    cursor: pointer;
  }
  .slider-bounds {
    display: flex;
    justify-content: space-between;
    margin-top: 5px;
    font-size: 9px;
    color: #3a3a3c;
    letter-spacing: 0.04em;
  }
  .appearance-heading { margin: 0 0 18px; padding-bottom: 12px; border-bottom: 1px solid rgba(255,255,255,.055); color: #d1cfd2; font-size: 14px; font-weight: 650; }
  .chat-preview { margin-top: 22px; padding: 14px 16px 2px; border: 1px solid rgba(255,255,255,.07); border-radius: 14px; background: rgba(255,255,255,.025); overflow: hidden; }
  .chat-preview-heading { margin-bottom: 16px; color: #68686d; font-size: 10px; font-weight: 650; letter-spacing: .06em; text-transform: uppercase; }
  .chat-preview-thread { min-width: 0; }
  :global(.chat-preview-thread [data-message-id]) { margin-bottom: 14px; }
  .additional-parameters-field {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .additional-parameters-heading {
    display: flex;
    align-items: center;
    gap: 8px;
  }
  .power-user-badge {
    padding: 2px 7px;
    border: 1px solid rgba(212,180,131,.22);
    border-radius: 999px;
    background: rgba(212,180,131,.07);
    color: #a78e69;
    font-size: 9px;
    font-weight: 700;
    letter-spacing: .05em;
    text-transform: uppercase;
  }
  .additional-parameters-description {
    margin: 0 0 2px;
    color: #66666b;
    font-size: 11px;
    line-height: 1.5;
  }
  .additional-parameters-input {
    min-height: 150px;
    resize: vertical;
    font-family: ui-monospace, SFMono-Regular, Consolas, "Liberation Mono", monospace;
    line-height: 1.5;
    tab-size: 2;
  }
  .additional-parameters-input--error {
    border-color: rgba(239, 107, 107, .55) !important;
    box-shadow: 0 0 0 3px rgba(239, 107, 107, .06);
  }
  .additional-parameters-error {
    margin: 0;
    color: #e88787;
    font-size: 11px;
    line-height: 1.4;
  }
  .language-settings-card {
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .language-group {
    display: flex;
    flex-direction: column;
    gap: 9px;
  }
  .language-group-header {
    display: flex;
    align-items: center;
    min-height: 20px;
  }
  .language-group-label {
    margin: 0;
  }
  .language-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 8px;
  }
  .language-choice {
    width: 100%;
    min-height: 60px;
    display: flex;
    align-items: center;
    gap: 11px;
    padding: 10px 12px;
    border: 1px solid rgba(255,255,255,0.07);
    border-radius: 14px;
    background: rgba(255,255,255,0.025);
    color: #aaa9ad;
    text-align: left;
    cursor: pointer;
    transition: background 140ms ease, border-color 140ms ease, color 140ms ease, transform 120ms ease, box-shadow 140ms ease;
  }
  .language-choice:hover {
    background: rgba(255,255,255,0.045);
    border-color: rgba(255,255,255,0.12);
    color: #e3e2e5;
  }
  .language-choice:active {
    transform: scale(0.985);
  }
  .language-choice:focus-visible {
    outline: none;
    border-color: rgba(212,180,131,0.58);
    box-shadow: 0 0 0 3px rgba(212,180,131,0.10);
  }
  .language-choice--selected {
    background: linear-gradient(180deg, rgba(212,180,131,0.10), rgba(212,180,131,0.055));
    border-color: rgba(212,180,131,0.42);
    color: #f0e4d0;
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.025);
  }
  .language-choice--selected:hover {
    background: linear-gradient(180deg, rgba(212,180,131,0.13), rgba(212,180,131,0.07));
    border-color: rgba(212,180,131,0.52);
  }
  .language-flag {
    flex: 0 0 auto;
    width: 38px;
    height: 26px;
    display: block;
    overflow: hidden;
    border-radius: 6px;
    background: rgba(255,255,255,0.04);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.10),
      0 3px 10px rgba(0,0,0,0.16);
    transition: transform 140ms ease, box-shadow 140ms ease, opacity 140ms ease;
  }
  .language-flag svg {
    display: block;
    width: 100%;
    height: 100%;
  }
  .language-choice:hover .language-flag {
    transform: translateY(-1px);
    box-shadow:
      0 0 0 1px rgba(255,255,255,0.14),
      0 5px 14px rgba(0,0,0,0.20);
  }
  .language-choice--selected .language-flag {
    box-shadow:
      0 0 0 1px rgba(212,180,131,0.30),
      0 4px 12px rgba(0,0,0,0.20);
  }
  .language-copy {
    min-width: 0;
    flex: 1;
    display: flex;
    align-items: center;
  }
  .language-name {
    font-size: 13px;
    font-weight: 650;
    letter-spacing: -0.01em;
    line-height: 1.2;
  }
  .language-state {
    flex: 0 0 auto;
    width: 20px;
    height: 20px;
    display: grid;
    place-items: center;
    border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.09);
    color: transparent;
    background: rgba(255,255,255,0.018);
    transition: all 140ms ease;
  }
  .language-choice--selected .language-state {
    color: #171513;
    background: #d4b483;
    border-color: #d4b483;
    box-shadow: 0 0 0 3px rgba(212,180,131,0.08);
  }
  .language-state svg {
    width: 12px;
    height: 12px;
  }
  @media (max-width: 560px) {
    .language-grid {
      grid-template-columns: 1fr;
    }
    .language-choice {
      min-height: 56px;
    }
  }

  .native-token-note { font-size:11px; font-weight:700; color:#d4b483; letter-spacing:.04em; font-variant-numeric:tabular-nums; }
</style>
