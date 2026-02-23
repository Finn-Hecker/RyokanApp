<script lang="ts">
  import { apiSettings, pendingUiLocale } from "$lib/stores/appState";
  import { getLocale } from "$lib/paraglide/runtime";
  import LanguageSelect from "$lib/components/ui/LanguageSelect.svelte";
  import * as m from "$lib/paraglide/messages";

  const uiLanguages = [
    { code: "de", label: "Deutsch" },
    { code: "en", label: "English" },
  ];

  const aiLanguages = [
    { code: "German",  label: "Deutsch" },
    { code: "English", label: "English" },
  ];

  const TEMPERATURES = [
    { label: m.settings_temp_precise(), value: 0.4, hint: () => m.settings_temp_hint_precise() },
    { label: m.settings_temp_balanced(), value: 0.8, hint: () => m.settings_temp_hint_balanced() },
    { label: m.settings_temp_creative(), value: 1.0, hint: () => m.settings_temp_hint_creative() },
  ];

  function handleUiLanguageChange(event: CustomEvent<string>) {
    pendingUiLocale.set(event.detail);
  }

  function handleAiLanguageChange(event: CustomEvent<string>) {
    $apiSettings.aiLanguage = event.detail;
  }
</script>

<!-- Section: Language -->
<section>
  <span class="settings-section-title">{m.settings_section_language()}</span>
  <div class="settings-card space-y-4">

    <div>
      <label for="ui-language-select" class="settings-label">{m.settings_language_label()}</label>
      <LanguageSelect
        id="ui-language-select"
        items={uiLanguages}
        selectedCode={$pendingUiLocale || getLocale()}
        on:select={handleUiLanguageChange}
      />
    </div>

    <div class="settings-divider"></div>

    <div>
      <label for="ai-language-select" class="settings-label">{m.settings_ai_lang_label()}</label>
      <LanguageSelect
        id="ai-language-select"
        items={aiLanguages}
        selectedCode={$apiSettings.aiLanguage}
        on:select={handleAiLanguageChange}
      />
    </div>

  </div>
</section>

<!-- Section: AI behavior -->
<section>
  <span class="settings-section-title">{m.settings_section_ai_behavior()}</span>
  <div class="settings-card space-y-4">

    <!-- Temperature -->
    <div>
      <span class="settings-label">{m.settings_creativity_label()}</span>
      <div class="grid grid-cols-3 gap-2">
        {#each TEMPERATURES as temp}
          <button
            on:click={() => ($apiSettings.temperature = temp.value)}
            class="flex flex-col items-center gap-1 py-3 px-2 rounded-xl border
                   transition-all duration-150 active:scale-[0.97]
                   {$apiSettings.temperature === temp.value
                     ? 'bg-white/[0.07] border-ryokan-accent/40 text-ryokan-accent'
                     : 'bg-white/[0.02] border-white/[0.06] text-gray-400 hover:border-white/[0.12] hover:text-gray-200'}"
          >
            <span class="text-[13px] font-semibold">{temp.label}</span>
            <span class="text-[10px] opacity-55 leading-snug text-center">{temp.hint()}</span>
          </button>
        {/each}
      </div>
    </div>

    <div class="settings-divider"></div>

    <!-- Thinking model toggle -->
    <label class="flex items-center justify-between gap-4 cursor-pointer group">
      <div class="flex flex-col gap-0.5">
        <span class="text-sm text-gray-200">{m.settings_thinking_label()}</span>
        <span class="text-xs text-gray-600 leading-relaxed">{m.settings_thinking_sub()}</span>
      </div>
      <input
        type="checkbox"
        bind:checked={$apiSettings.isThinkingModel}
        class="sr-only peer"
      />
      <!-- Track -->
      <div class="relative shrink-0 w-11 h-6 rounded-full transition-colors
                  bg-white/[0.07] border border-white/[0.08]
                  peer-checked:bg-ryokan-accent/20 peer-checked:border-ryokan-accent/40
                  after:content-[''] after:absolute after:top-[3px] after:start-[3px]
                  after:bg-[#5a5a5e] after:rounded-full
                  after:h-[16px] after:w-[16px] after:transition-all
                  peer-checked:after:translate-x-[20px] peer-checked:after:bg-ryokan-accent">
      </div>
    </label>

  </div>
</section>