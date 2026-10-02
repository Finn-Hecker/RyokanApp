import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { PROVIDERS } from './providers.ts';
import { modelGenerationCapabilities } from './generationCapabilities.ts';

test('onboarding persists provider identity and selected model capabilities', async () => {
  const source = await readFile(new URL('../components/Onboarding.svelte', import.meta.url), 'utf8');
  const finish = source.slice(source.indexOf('  async function finish()'), source.indexOf('</script>'));
  for (const kind of ['openai', 'xai', 'anthropic', 'gemini', 'generic_openai']) {
    const preset = PROVIDERS.find(provider => provider.kind === kind);
    const state = { apiSettings: {}, isOnboarding: true };
    let saved;
    const run = new Function('appState', 'currentPreset', 'modelMetadata', 'modelGenerationCapabilities',
      'persistApiConnections', 'saveSetting', 'setLocale', 'reportDiagnostic', `
      let saving, modelError, apiUrl = ${JSON.stringify(preset.url)}, apiKey = 'fixture-key',
        selectedModel = 'fixture-model', activePreset = ${JSON.stringify(preset.label)}, selectedLanguage = 'English';
      ${finish}
      return finish();`);
    await run(state, preset, { 'fixture-model': { supportedParameters: ['max_tokens', 'thinking_budget_tokens'] } },
      modelGenerationCapabilities, async () => { saved = structuredClone(state.apiSettings); }, async () => {}, () => {},
      () => { throw new Error('Onboarding failed'); });
    assert.equal(saved.providerKind, kind);
    assert.equal(saved.customMode, kind === 'generic_openai');
    assert.equal(state.isOnboarding, false);
    if (kind === 'anthropic' || kind === 'gemini') {
      assert.deepEqual(saved.generationCapabilities.supportedParameters, ['max_tokens', 'thinking_budget_tokens']);
      assert.equal(saved.generationCapabilities.model, 'fixture-model');
    }
  }
});
