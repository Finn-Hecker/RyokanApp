import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { stripTypeScriptTypes } from 'node:module';
import { PROVIDERS } from './providers.ts';
import { modelGenerationCapabilities } from './generationCapabilities.ts';

const source = await readFile(new URL('../components/Onboarding.svelte', import.meta.url), 'utf8');
const finishSource = stripTypeScriptTypes(source.slice(source.indexOf('  async function finish()'), source.indexOf('</script>')));

function setup({ ready = true, failConnection = false, failCompletion = false, provider = 'openai' } = {}) {
  const preset = PROVIDERS.find(item => item.kind === provider);
  const connection = { id: 'first', providerKind: provider, url: preset.url, apiKey: 'fixture-key', model: 'fixture-model', customMode: provider === 'generic_openai' };
  connection.generationCapabilities = modelGenerationCapabilities(connection, ['max_tokens', 'thinking_budget_tokens']);
  const state = { apiSettings: connection, apiConnections: [connection], isOnboarding: true, pendingUiLocale: 'de' };
  const calls = [];
  const run = new Function('appState', 'persistApiConnections', 'invoke', 'getLocale', 'setLocale', 'reportDiagnostic', `
    let connectionReady = ${ready}, saving = false, saveError = false;
    ${finishSource}
    return { finish, status: () => ({ saving, saveError }) };`);
  const harness = run(state, async () => {
    calls.push({ type: 'connection', value: structuredClone(state.apiConnections) });
    if (failConnection) throw new Error('Connection storage failed');
  }, async (command, args) => {
    calls.push({ type: command, args });
    if (failCompletion) throw new Error('Completion storage failed');
  }, () => 'en', locale => calls.push({ type: 'locale', locale }), () => {});
  return { ...harness, state, calls };
}

test('onboarding persists the shared Settings connection and its model capabilities before completion', async () => {
  for (const provider of ['openai', 'xai', 'anthropic', 'gemini', 'generic_openai']) {
    const harness = setup({ provider });
    await harness.finish();
    assert.deepEqual(harness.calls.map(call => call.type), ['connection', 'save_setting', 'locale']);
    assert.deepEqual(harness.calls[0].value[0], harness.state.apiSettings);
    assert.equal(harness.calls[0].value[0].providerKind, provider);
    assert.equal(harness.calls[1].args.key, 'onboarding_completed');
    assert.equal(harness.calls[1].args.value, 'true');
    assert.equal(harness.state.isOnboarding, false);
    assert.equal(harness.state.currentView, 'lobby');
    assert.equal(harness.state.pendingUiLocale, '');
  }
});

test('onboarding cannot finish an unvalidated connection or save twice concurrently', async () => {
  const unready = setup({ ready: false });
  await unready.finish();
  assert.deepEqual(unready.calls, []);
  assert.equal(unready.state.isOnboarding, true);
  const harness = setup();
  await Promise.all([harness.finish(), harness.finish()]);
  assert.equal(harness.calls.filter(call => call.type === 'connection').length, 1);
});

test('failed connection or completion persistence keeps onboarding open and permits retry', async () => {
  for (const options of [{ failConnection: true }, { failCompletion: true }]) {
    const harness = setup(options);
    await harness.finish();
    assert.equal(harness.state.isOnboarding, true);
    assert.equal(harness.state.pendingUiLocale, 'de');
    assert.deepEqual(harness.status(), { saving: false, saveError: true });
    assert.equal(harness.calls.some(call => call.type === 'locale'), false);
    if (options.failConnection) assert.equal(harness.calls.some(call => call.type === 'save_setting'), false);
  }
});
