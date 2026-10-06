import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePreset, capturePresetRestore, normalizePresetRestore, activateConnectionPreset, deactivateConnectionPreset, resolvePreset, importPreset, exportPreset, parsePresetLibrary, MAX_PRESET_BYTES } from './presetCore.ts';
import { createDefaultApiParameterEnabled, requestParameterConfig } from '../connections/apiParameters.ts';
import { buildPromptMessages } from '../prompt/chatPromptBuilder.ts';

function connection(providerKind = 'llama_cpp') {
  return { id: 'PRIVATE_CONNECTION', name: 'PRIVATE_NAME', apiKey: 'PRIVATE_KEY', url: 'https://private.example/v1', model: 'PRIVATE_MODEL',
    providerKind, temperature: 0.8, repetitionPenalty: 1.12, topP: 0.9, topK: 40, minP: 0.05, frequencyPenalty: 0,
    maxTokens: 300, thinkingBudget: 2500, reasoningLevel: 'auto', serviceTier: 'auto',
    systemPrompt: '', postHistoryPrompt: '', additionalApiParameters: '',
    parameterEnabled: createDefaultApiParameterEnabled(), manualContextCap: 8192, detectedContext: null };
}

test('restore allowlist excludes independent profile data and preserves exact provider settings', () => {
  for (const kind of ['anthropic', 'gemini', 'openrouter', 'nanogpt', 'llama_cpp']) {
    const manual = { ...connection(kind), reasoningLevel: 'max', serviceTier: 'flex',
      additionalApiParameters: ' { "thinking": {"type": "adaptive"}, "stop": ["END"], "nullable": null } ' };
    manual.parameterEnabled.thinkingBudget = true;
    const restore = capturePresetRestore(manual);
    for (const key of ['id', 'name', 'apiKey', 'url', 'model', 'providerKind', 'manualContextCap', 'detectedContext', 'customMode']) {
      assert.equal(Object.hasOwn(restore, key), false, key);
    }
    assert.deepEqual(normalizePresetRestore({ ...restore, apiKey: 'secret', model: 'private' }), restore);
    const preset = capturePreset({ ...connection(kind), additionalApiParameters: '' }, 'A');
    const active = activateConnectionPreset(manual, preset, 'A');
    const restored = deactivateConnectionPreset(JSON.parse(JSON.stringify(active)));
    assert.deepEqual(restored, { ...manual, appliedPresetId: null, presetRestoreSnapshot: undefined });
    assert.deepEqual(manual.parameterEnabled, restore.parameterEnabled);
    assert.throws(() => capturePresetRestore({ ...manual, additionalApiParameters: '{"apiKey":"secret"}' }));
    assert.equal(normalizePresetRestore({ ...restore, additionalApiParameters: '{"endpoint":"private"}' }), undefined);
  }
});
test('native export captures explicit zero/false/empty settings and excludes all connection metadata', () => {
  const source = connection(); source.topK = 0; source.parameterEnabled.topK = true;
  const preset = capturePreset(source, ' Native ');
  const json = exportPreset(preset);
  assert.deepEqual(importPreset(json), preset);
  assert.equal(preset.name, 'Native');
  assert.deepEqual(preset.generation.topK, { value: 0, enabled: true });
  assert.equal(preset.prompt.system, '');
  assert.equal(preset.generation.temperature.enabled, false);
  for (const secret of ['PRIVATE_CONNECTION', 'PRIVATE_NAME', 'PRIVATE_KEY', 'PRIVATE_MODEL', 'private.example', 'manualContextCap', 'presencePenalty']) assert.ok(!json.includes(secret), secret);
  assert.deepEqual(Object.keys(preset.providers), ['llama_cpp']);
});
test('applying a preset preserves identity, endpoint, capabilities and context policy', () => {
  const source = connection(); source.repetitionPenalty = 1.7; source.parameterEnabled.repetitionPenalty = true;
  source.systemPrompt = 'Use concise replies'; source.postHistoryPrompt = 'End with a question';
  const destination = { ...connection(), id: 'destination', model: 'local-model', apiKey: 'destination-key', manualContextCap: 4096, generationCapabilities: { source: 'unknown' } };
  const before = structuredClone(destination);
  const preset = capturePreset(source, 'Reusable');
  const result = resolvePreset(destination, preset);
  for (const key of ['id', 'model', 'apiKey', 'url', 'manualContextCap', 'generationCapabilities']) assert.deepEqual(result[key], before[key], key);
  assert.equal(result.repetitionPenalty, 1.7);
  assert.equal(requestParameterConfig(result).presencePenaltyEnabled, true, 'legacy IPC switch still controls repetition penalty');
  assert.deepEqual(destination, before);
  preset.generation.repetitionPenalty.value = 2;
  preset.providers.llama_cpp.additionalParameters.reasoning = { effort: 'high' };
  assert.equal(result.repetitionPenalty, 1.7);
  assert.equal(result.additionalApiParameters, '');
  const messages = buildPromptMessages({ systemPrompt: result.systemPrompt, postHistoryPrompt: result.postHistoryPrompt, character: { name: 'Rin', prompt: 'Character context' }, recentMessages: [], userPrompt: 'Hi', worldInfos: [] });
  assert.ok(messages[0].content.startsWith('Use concise replies'));
  assert.deepEqual(messages.at(-1), { role: 'system', content: 'End with a question' });
});
test('provider blocks never cross providers and editing retains other provider configurations', () => {
  const source = connection('gemini'); source.additionalApiParameters = JSON.stringify({ generationConfig: { thinkingConfig: { thinkingBudget: -1, includeThoughts: false }, maxOutputTokens: 7000 } });
  const original = capturePreset(source, 'Mixed');
  const claude = connection('anthropic'); claude.maxTokens = 6000; claude.thinkingBudget = 2048; claude.parameterEnabled.thinkingBudget = true;
  claude.additionalApiParameters = '{"thinking":{"type":"adaptive"},"output_config":{"effort":"max"}}';
  const edited = capturePreset(claude, 'Renamed', original);
  assert.deepEqual(edited.providers.gemini, original.providers.gemini);
  assert.equal(edited.providers.anthropic.maxTokens.value, 6000);
  const foreign = connection('openrouter'); foreign.additionalApiParameters = '{"provider":{"order":["chosen"]}}'; foreign.reasoningLevel = 'high';
  const applied = resolvePreset(foreign, edited);
  assert.equal(applied.additionalApiParameters, foreign.additionalApiParameters);
  assert.equal(applied.reasoningLevel, 'high');
  const gemini = resolvePreset(connection('gemini'), edited);
  assert.deepEqual(JSON.parse(gemini.additionalApiParameters), JSON.parse(source.additionalApiParameters));
});
test('provider-specific reasoning, budget, tier and custom objects survive a native round-trip', () => {
  for (const provider of ['anthropic', 'gemini', 'openrouter', 'nanogpt', 'llama_cpp']) {
    const source = connection(provider); source.reasoningLevel = 'max'; source.serviceTier = 'flex'; source.thinkingBudget = 7000;
    source.parameterEnabled.thinkingBudget = true;
    source.additionalApiParameters = '{"reasoning":{"effort":"low","max_tokens":0,"exclude":false},"thinking":{"type":"adaptive"},"generationConfig":{"thinkingConfig":{"thinkingBudget":-1}},"stop":["END"],"nullable":null}';
    const preset = importPreset(exportPreset(capturePreset(source, provider)));
    const result = resolvePreset(connection(provider), preset);
    assert.equal(result.reasoningLevel, 'max'); assert.equal(result.serviceTier, 'flex');
    assert.equal(result.thinkingBudget, 7000); assert.equal(result.parameterEnabled.thinkingBudget, true);
    assert.deepEqual(JSON.parse(result.additionalApiParameters), JSON.parse(source.additionalApiParameters));
  }
});
test('invalid, unknown and future formats fail without accepting connection fields', () => {
  const valid = capturePreset(connection(), 'Valid');
  for (const value of [null, [], {}, { ...valid, format: 'sillytavern' }, { ...valid, version: 2 }, { ...valid, name: ' ' },
    { ...valid, apiKey: 'secret' }, { ...valid, endpoint: 'https://example.com' }, { ...valid, connectionId: 'local' },
    { ...valid, generation: { ...valid.generation, presencePenalty: { enabled: true, value: 1 } } }]) {
    assert.throws(() => importPreset(JSON.stringify(value)));
  }
  assert.throws(() => importPreset('{'));
  assert.throws(() => importPreset(' '.repeat(MAX_PRESET_BYTES + 1)));
  assert.throws(() => importPreset(JSON.stringify({ ...valid, version: 2 })), error => error.code === 'unsupportedVersion');
});
test('custom authentication/transport fields are rejected recursively without banning token budgets', () => {
  for (const parameters of [
    { apiKey: 'private' }, { api_key: 'private' }, { Authorization: 'Bearer private' }, { nested: { password: 'private' } },
    { access_token: 'private' }, { refreshToken: 'private' }, { auth_token: 'private' }, { token: 'private' }, { private_key: 'private' },
    { endpoint: 'localhost' }, { baseUrl: 'localhost' }, { url: 'localhost' }, { connectionId: 'local' }, { session_id: 'local' },
    { headers: {} }, { nested: [{ credential: 'private' }] }, { value: 'https://private.example/v1' }, { messages: [] }, { model: 'override' }, { stream: false },
  ]) {
    const source = connection(); source.additionalApiParameters = JSON.stringify(parameters);
    assert.throws(() => capturePreset(source, 'Unsafe'));
  }
  assert.doesNotThrow(() => capturePreset({ ...connection(), additionalApiParameters: '{"thinking_budget_tokens":2048,"max_tokens":4096}' }, 'Safe'));
});
test('numeric validation preserves legal values outside old UI limits and rejects lossy coercion', () => {
  const source = connection(); source.frequencyPenalty = -1; source.maxTokens = 64000; source.minP = 0.8;
  const preset = importPreset(exportPreset(capturePreset(source, 'Large')));
  assert.equal(preset.providers.llama_cpp.maxTokens.value, 64000); assert.equal(preset.generation.frequencyPenalty.value, -1);
  for (const value of ['0.8', null, -1, 11]) {
    const bad = structuredClone(preset); bad.generation.temperature.value = value;
    assert.throws(() => importPreset(JSON.stringify(bad)));
  }
  const fractional = structuredClone(preset); fractional.generation.topK.value = 1.5;
  assert.throws(() => importPreset(JSON.stringify(fractional)));
});
test('library identities are local and validated independently of exported documents', () => {
  const preset = capturePreset(connection(), 'Same name');
  const items = [{ id: 'a', preset }, { id: 'b', preset }];
  assert.deepEqual(parsePresetLibrary(JSON.stringify(items)), items);
  assert.throws(() => parsePresetLibrary(JSON.stringify([items[0], items[0]])));
  assert.throws(() => parsePresetLibrary('{}'));
  assert.throws(() => parsePresetLibrary(JSON.stringify([{ id: 'a', preset: { ...preset, version: 2 } }])));
  assert.ok(!exportPreset(preset).includes('"id"'));
});
