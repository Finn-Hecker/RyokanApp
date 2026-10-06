import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { PRESETS_KEY, parsePresetLibrary, capturePreset, capturePresetRestore, activateConnectionPreset, deactivateConnectionPreset, normalizePresetRestore } from './presetCore.ts';
import { createDefaultApiParameterEnabled } from '../connections/apiParameters.ts';

function functions(path, component = false) {
  let source = readFileSync(new URL(path, import.meta.url), 'utf8');
  if (component) source = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('production.ts', source, ts.ScriptTarget.Latest, true);
  return ts.transpile(ast.statements.filter(ts.isFunctionDeclaration)
    .map(node => node.getText(ast).replace(/^export /, '')).join('\n'), { target: ts.ScriptTarget.ES2022 });
}
function fixture() {
  const connection = { id: 'a', providerKind: 'llama_cpp', appliedPresetId: 'old', temperature: 0.8,
    repetitionPenalty: 1.12, topP: 0.9, topK: 40, minP: 0.05, frequencyPenalty: 0, maxTokens: 300,
    thinkingBudget: 2500, reasoningLevel: 'auto', serviceTier: 'auto', systemPrompt: '', postHistoryPrompt: '',
    parameterEnabled: createDefaultApiParameterEnabled(), additionalApiParameters: '' };
  const other = { ...structuredClone(connection), id: 'b' };
  const unrelated = { ...structuredClone(connection), id: 'c', appliedPresetId: 'other' };
  for (const profile of [connection, other, unrelated]) {
    profile.presetRestoreSnapshot = capturePresetRestore({ ...profile, temperature: profile.id === 'b' ? 0.4 : 0.6 });
  }
  const items = [{ id: 'old', preset: capturePreset(connection, 'Old') },
    { id: 'other', preset: capturePreset(connection, 'Other') }];
  const disk = { profiles: structuredClone([connection, other, unrelated]), library: structuredClone(items) };
  const context = vm.createContext({ appState: { apiSettings: connection, apiConnections: [connection, other, unrelated] },
    PRESETS_KEY, parsePresetLibrary, activateConnectionPreset, deactivateConnectionPreset, snapshotApiConnection: structuredClone,
    parameterEnabled: { ...connection.parameterEnabled },
    persistApiConnections: async () => { disk.profiles = structuredClone(context.appState.apiConnections); },
    invoke: async (command, args) => {
      assert.equal(command, 'save_setting'); assert.equal(args.key, PRESETS_KEY);
      disk.library = JSON.parse(args.value);
    },
  });
  vm.runInContext(functions('./presetLibrary.ts'), context);
  vm.runInContext(functions('../../components/settings/SettingsPage.svelte', true), context);
  return { context, connection, items, disk };
}

test('applying persists an explicit association alongside settings and preserves an existing request snapshot', async () => {
  const { context, connection, items, disk } = fixture();
  const request = structuredClone(connection);
  items[1].preset.generation.temperature.value = 1.4;
  await context.applyPreset(items[1].preset, 'other');
  assert.equal(connection.appliedPresetId, 'other'); assert.equal(connection.temperature, 1.4);
  assert.equal(disk.profiles[0].appliedPresetId, 'other'); assert.equal(disk.profiles[0].temperature, 1.4);
  assert.equal(disk.profiles[1].appliedPresetId, 'old');
  assert.equal(request.appliedPresetId, 'old'); assert.equal(request.temperature, 0.8);
});

test('failed apply restores settings, parameter switches and the previous association, including legacy profiles', async () => {
  for (const legacy of [false, true]) {
    const { context, connection, items } = fixture();
    if (legacy) delete connection.appliedPresetId;
    const enabled = context.parameterEnabled.temperature;
    context.persistApiConnections = async () => { throw new Error('Write failed'); };
    items[1].preset.generation.temperature.value = 1.4;
    items[1].preset.generation.temperature.enabled = !enabled;
    await assert.rejects(context.applyPreset(items[1].preset, 'other'), /Write failed/);
    assert.equal(connection.temperature, 0.8);
    assert.equal(connection.appliedPresetId, legacy ? null : 'old');
    assert.equal(context.parameterEnabled.temperature, enabled);
  }
});

test('deleting restores every affected connection independently and preserves running request snapshots', async () => {
  const { context, connection, items, disk } = fixture();
  const before = structuredClone(context.appState.apiConnections);
  const request = structuredClone(connection);
  const next = await context.deletePreset(items, 'old');
  assert.deepEqual(Array.from(next, item => item.id), ['other']);
  for (let i = 0; i < before.length; i++) {
    const expected = i < 2 ? deactivateConnectionPreset(before[i]) : before[i];
    assert.deepEqual(context.appState.apiConnections[i], expected);
    assert.deepEqual(disk.profiles[i], expected);
  }
  assert.deepEqual(disk.library.map(item => item.id), ['other']);
  assert.deepEqual(request, before[0]);
});

for (const chain of [['A'], ['A', 'B'], ['A', 'B', 'C']]) {
  test(`manual → ${chain.join(' → ')} → deactivate restores the original complete manual settings`, async () => {
    const { context, connection, disk } = fixture();
    delete connection.appliedPresetId; delete connection.presetRestoreSnapshot;
    connection.systemPrompt = 'Manual system'; connection.postHistoryPrompt = 'Manual final';
    connection.reasoningLevel = 'low'; connection.serviceTier = 'flex';
    connection.additionalApiParameters = ' { "stop": ["MANUAL"], "nullable": null } ';
    connection.parameterEnabled.thinkingBudget = true;
    context.parameterEnabled = { ...connection.parameterEnabled };
    const manual = structuredClone(connection);
    const request = structuredClone(manual);
    for (const [index, id] of chain.entries()) {
      const preset = capturePreset({ ...manual, temperature: index + 1, maxTokens: 4000 + index,
        thinkingBudget: 8000, reasoningLevel: 'high', serviceTier: 'standard', systemPrompt: id,
        postHistoryPrompt: '', additionalApiParameters: index ? '' : '{"stop":["PRESET"]}',
        parameterEnabled: { ...manual.parameterEnabled, thinkingBudget: false } }, id);
      await context.applyPreset(preset, id);
      assert.deepEqual(connection.presetRestoreSnapshot, capturePresetRestore(manual));
      assert.equal(connection.additionalApiParameters, index ? '' : '{\n  "stop": [\n    "PRESET"\n  ]\n}');
      assert.equal(connection.appliedPresetId, id);
    }
    await context.deactivatePreset();
    assert.deepEqual(connection, { ...manual, appliedPresetId: null, presetRestoreSnapshot: undefined });
    assert.deepEqual(disk.profiles[0], connection);
    assert.deepEqual(request, manual);
    assert.deepEqual(structuredClone(context.parameterEnabled), manual.parameterEnabled);
  });
}

test('missing provider block uses the manual baseline and clears previous preset values', async () => {
  const { context, connection } = fixture();
  delete connection.appliedPresetId; delete connection.presetRestoreSnapshot;
  const manual = structuredClone(connection);
  const a = capturePreset({ ...manual, maxTokens: 9000, reasoningLevel: 'high', additionalApiParameters: '{"stop":["A"]}' }, 'A');
  const b = capturePreset({ ...manual, providerKind: 'gemini', systemPrompt: 'B' }, 'B');
  await context.applyPreset(a, 'A'); await context.applyPreset(b, 'B');
  assert.equal(connection.maxTokens, manual.maxTokens);
  assert.equal(connection.reasoningLevel, manual.reasoningLevel);
  assert.equal(connection.additionalApiParameters, manual.additionalApiParameters);
  assert.equal(connection.systemPrompt, 'B');
  await context.deactivatePreset();
  assert.equal(connection.systemPrompt, manual.systemPrompt);
});

test('activating and deactivating separate connections never shares or overwrites their manual baselines', async () => {
  const { context, connection } = fixture();
  const other = context.appState.apiConnections[1];
  for (const profile of [connection, other]) {
    delete profile.appliedPresetId; delete profile.presetRestoreSnapshot;
  }
  other.temperature = 0.3; other.systemPrompt = 'Other manual prompt';
  other.additionalApiParameters = '{"stop":["OTHER"]}';
  const manuals = [connection, other].map(profile => structuredClone(profile));
  const preset = capturePreset({ ...manuals[0], temperature: 1.5, systemPrompt: 'Preset' }, 'A');
  await context.applyPreset(preset, 'A');
  context.appState.apiSettings = other;
  context.parameterEnabled = { ...other.parameterEnabled };
  await context.applyPreset(preset, 'A');
  assert.deepEqual(connection.presetRestoreSnapshot, capturePresetRestore(manuals[0]));
  assert.deepEqual(other.presetRestoreSnapshot, capturePresetRestore(manuals[1]));
  await context.deactivatePreset();
  assert.deepEqual(other, { ...manuals[1], appliedPresetId: null, presetRestoreSnapshot: undefined });
  assert.equal(connection.appliedPresetId, 'A'); assert.equal(connection.temperature, 1.5);
  context.appState.apiSettings = connection;
  context.parameterEnabled = { ...connection.parameterEnabled };
  await context.deactivatePreset();
  assert.deepEqual(connection, { ...manuals[0], appliedPresetId: null, presetRestoreSnapshot: undefined });
});

test('failed deactivation rolls back settings and keeps a usable restore snapshot', async () => {
  const { context, connection, disk } = fixture();
  const before = structuredClone(connection);
  context.persistApiConnections = async () => { throw new Error('Write failed'); };
  await assert.rejects(context.deactivatePreset(), /Write failed/);
  assert.deepEqual(structuredClone(connection), before);
  assert.deepEqual(disk.profiles[0], before);
});

test('production persistence and hydration retain independent snapshots across an app restart', async () => {
  const { context, connection } = fixture();
  const defaults = { ...structuredClone(connection), appliedPresetId: null, presetRestoreSnapshot: undefined,
    manualContextCap: null, detectedContext: null, contextLimit: 4096 };
  const legacy = { ...structuredClone(defaults), id: 'legacy' };
  delete legacy.appliedPresetId; delete legacy.presetRestoreSnapshot;
  context.appState.apiConnections.push(legacy);
  const before = structuredClone(context.appState.apiConnections);
  let rows;
  Object.assign(context, { crypto: { randomUUID: () => 'new' },
    API_CONNECTIONS_KEY: 'api_connections', ACTIVE_API_CONNECTION_KEY: 'active_api_connection_id',
    LONG_TERM_MEMORY_KEY: 'long_term_memory_enabled', SUMMARY_CONNECTION_KEY: 'summary_api_connection_id',
    SAME_AS_CHAT_CONNECTION: 'same_as_chat', normalizePresetRestore,
    createDefaultConnection: (id, name) => ({ ...structuredClone(defaults), id, name }),
    normalizeServiceTier: value => value, validContextSize: value => Number.isFinite(value) && value > 0,
    resolvedHardContextLimit: () => 4096, resolveMemorySettings: () => ({ longTermMemory: true, summaryConnectionId: 'same_as_chat' }),
    replaceApiConnections: profiles => { context.appState.apiConnections = profiles; context.appState.apiSettings = profiles[0]; },
    invoke: async (command, args) => {
      assert.equal(command, 'save_api_connections');
      rows = [{ key: 'api_connections', value: args.connectionsJson }, { key: 'active_api_connection_id', value: args.activeConnectionId }];
    },
  });
  vm.runInContext(functions('../connections/apiConnections.ts'), context);
  await context.persistApiConnections();
  context.appState.apiConnections = [];
  context.hydrateApiConnections(rows);
  for (let i = 0; i < 3; i++) {
    const restored = context.appState.apiConnections[i];
    assert.deepEqual(restored.presetRestoreSnapshot, before[i].presetRestoreSnapshot);
    assert.equal(deactivateConnectionPreset(restored).temperature, i === 1 ? 0.4 : 0.6);
  }
  const hydratedLegacy = context.appState.apiConnections[3];
  assert.equal(hydratedLegacy.appliedPresetId, null);
  assert.equal(hydratedLegacy.presetRestoreSnapshot, undefined);
  const applied = activateConnectionPreset(hydratedLegacy, capturePreset(hydratedLegacy, 'A'), 'A');
  assert.deepEqual(structuredClone(deactivateConnectionPreset(applied)), structuredClone({ ...hydratedLegacy, appliedPresetId: null, presetRestoreSnapshot: undefined }));
  await context.deactivatePreset();
  assert.equal(context.appState.apiSettings.temperature, 0.6);
  assert.equal(JSON.parse(rows[0].value)[0].presetRestoreSnapshot, undefined);
});

test('failed deletion retains the library and restores persisted references on storage errors', async () => {
  for (const failure of ['profiles', 'library']) {
    const { context, items, disk } = fixture();
    const before = structuredClone(disk);
    if (failure === 'profiles') context.persistApiConnections = async () => { throw new Error('Write failed'); };
    else context.invoke = async () => { throw new Error('Write failed'); };
    await assert.rejects(context.deletePreset(items, 'old'), /Write failed/);
    assert.deepEqual(disk, before);
    assert.deepEqual(context.appState.apiConnections, before.profiles);
  }
});
