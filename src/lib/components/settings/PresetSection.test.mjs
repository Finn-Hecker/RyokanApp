import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { proxy, snapshot } from 'svelte/internal/client';
import { capturePreset, resolvePreset, importPreset, exportPreset, PresetError, MAX_PRESET_BYTES } from '../../ai/presets/presetCore.ts';
import { createDefaultApiParameterEnabled } from '../../ai/connections/apiParameters.ts';

const source = readFileSync(new URL('./PresetSection.svelte', import.meta.url), 'utf8');
const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('PresetSection.ts', script, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n');
function fixture() {
  const connection = { providerKind: 'llama_cpp', temperature: 0.8, repetitionPenalty: 1.12, topP: 0.9, topK: 40,
    minP: 0.05, frequencyPenalty: 0, maxTokens: 300, thinkingBudget: 2500, reasoningLevel: 'auto', serviceTier: 'auto',
    systemPrompt: '', postHistoryPrompt: '', parameterEnabled: createDefaultApiParameterEnabled(), additionalApiParameters: '' };
  const writes = [];
  const effects = [];
  const context = vm.createContext({ appState: { apiSettings: connection }, parameterEnabled: { ...connection.parameterEnabled },
    items: [], ready: false, busy: false, status: '', error: '', draft: null, deletingId: '',
    crypto: { randomUUID: () => `new-${writes.length}` }, structuredClone, $state: { snapshot },
    snapshotApiConnection: snapshot, capturePreset, resolvePreset, importPreset, PresetError, MAX_PRESET_BYTES,
    reportDiagnostic() {}, clearExportFeedback() {}, showExportFeedback() {}, m: new Proxy({}, { get: (_, key) => () => key }),
    savePresetLibrary: async items => { writes.push(structuredClone(snapshot(items))); },
    loadPresetLibrary: async () => [], onApply: async () => {}, onDeactivate: async () => {}, onDeleted: () => {},
    deletePreset: async (items, id) => { const next = items.filter(item => item.id !== id); writes.push(structuredClone(next)); return next; },
    $effect: effect => effects.push(effect),
  });
  vm.runInContext(ts.transpile(functions, { target: ts.ScriptTarget.ES2022 }), context);
  const effectCode = ast.statements.filter(node => ts.isExpressionStatement(node) && node.expression.expression?.getText(ast) === '$effect')
    .map(node => node.getText(ast)).join('\n');
  vm.runInContext(ts.transpile(effectCode, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, connection, writes, syncConnection: () => effects.forEach(effect => effect()) };
}
test('editor create, rename, cancel and delete keep the active connection and saved drafts isolated', async () => {
  const { context, connection, writes } = fixture();
  await context.load(); assert.equal(context.ready, true);
  context.edit(); context.name = 'First'; context.draft.temperature = 1.2;
  context.draft.parameterEnabled.thinkingBudget = true;
  // GeneralSection binds the thinking toggle back to the editor's switch collection.
  context.draftEnabled.thinkingBudget = true;
  await context.save();
  assert.equal(connection.temperature, 0.8); assert.equal(connection.parameterEnabled.thinkingBudget, false);
  assert.equal(context.items[0].preset.providers.llama_cpp.thinkingBudget.enabled, true);
  assert.equal(context.draft, null);
  const saved = context.items[0];
  context.edit(saved); context.name = 'Renamed'; await context.save();
  assert.equal(context.items.length, 1); assert.equal(context.items[0].id, saved.id);
  assert.equal(context.items[0].preset.name, 'Renamed');
  context.edit(context.items[0]); context.draft.temperature = 2; context.draft = null;
  assert.equal(context.items[0].preset.generation.temperature.value, 1.2);
  context.deletingId = saved.id; await context.remove();
  assert.equal(context.items.length, 0); assert.equal(writes.length, 3); assert.equal(connection.temperature, 0.8);
});

test('reactive library entries cross edit, save, apply and export boundaries as isolated plain data', async () => {
  const { context, connection } = fixture();
  const saved = capturePreset(connection, 'Reactive');
  saved.providers.llama_cpp.additionalParameters = { reasoning: { effort: 'high', exclude: false }, stop: ['END'], nullable: null };
  saved.providers.gemini = structuredClone(saved.providers.llama_cpp);
  context.items = proxy([{ id: 'reactive', preset: saved }]);
  const item = context.items[0];
  // This is the exact nested $state value that crashed structuredClone in providerSettings.
  assert.throws(() => structuredClone(item.preset.providers.llama_cpp.additionalParameters), { name: 'DataCloneError' });
  context.resolvePreset = (current, preset) => { structuredClone(preset); return resolvePreset(current, preset); };
  context.edit(item);
  assert.equal(context.error, '');
  assert.equal(JSON.parse(context.draft.additionalApiParameters).reasoning.effort, 'high');
  context.previous = proxy(context.previous); // Assignment to the component's $state re-wraps the snapshot.
  context.draft = proxy(context.draft);
  context.capturePreset = (current, name, previous) => { structuredClone(current); structuredClone(previous); return capturePreset(current, name, previous); };
  context.draft.additionalApiParameters = '{"reasoning":{"effort":"low"}}';
  context.name = 'Edited';
  await context.save();
  assert.equal(context.error, ''); assert.equal(context.draft, null);
  assert.equal(saved.providers.llama_cpp.additionalParameters.reasoning.effort, 'high');
  assert.deepEqual(context.items[0].preset.providers.gemini, saved.providers.gemini);
  const edited = proxy(context.items[0]);
  context.onApply = async (preset, id) => {
    assert.equal(id, 'reactive');
    structuredClone(preset);
    const resolved = resolvePreset(connection, preset);
    assert.equal(JSON.parse(resolved.additionalApiParameters).reasoning.effort, 'low');
  };
  await context.apply(edited); assert.equal(context.status, 'preset_applied'); assert.equal(context.error, '');
  let exported;
  context.downloadPreset = async item => { structuredClone(item); exported = exportPreset(item.preset); };
  await context.exportFile(edited); assert.equal(context.error, '');
  assert.deepEqual(importPreset(exported), snapshot(edited.preset));
  assert.equal(connection.additionalApiParameters, '');
});
test('failed persistence keeps the previous library and editable draft; retry publishes only after saving', async () => {
  const { context } = fixture(); context.edit(); context.name = 'Unsaved';
  context.savePresetLibrary = async () => { throw new Error('Storage failed'); };
  await context.save();
  assert.equal(context.items.length, 0); assert.ok(context.draft); assert.equal(context.busy, false);
  assert.equal(context.error, 'preset_error_storage');
  context.savePresetLibrary = async () => {};
  await context.save(); assert.equal(context.items.length, 1); assert.equal(context.draft, null);
});
test('failed library load never enables writes over unreadable persisted data', async () => {
  const { context } = fixture();
  context.loadPresetLibrary = async () => { throw new PresetError('unsupportedVersion'); };
  await context.load(); assert.equal(context.ready, false); assert.equal(context.error, 'preset_error_version');
});
test('native import adds an isolated library entry without applying it or replacing matching names', async () => {
  const { context, connection } = fixture();
  const original = capturePreset(connection, 'Imported');
  context.items = [{ id: 'existing', preset: original }];
  connection.appliedPresetId = 'existing';
  original.generation.temperature.value = 1.8;
  const json = JSON.stringify(original);
  let applies = 0; context.onApply = async () => applies++;
  const input = { files: [{ size: json.length, text: async () => json }], value: 'file' };
  await context.importFile({ currentTarget: input });
  assert.equal(input.value, ''); assert.equal(context.items.length, 2); assert.equal(applies, 0);
  assert.equal(connection.temperature, 0.8);
  assert.equal(connection.appliedPresetId, 'existing');
  const before = context.items;
  await context.importFile({ currentTarget: { files: [{ size: 2, text: async () => '{}' }], value: 'file' } });
  assert.equal(context.items, before); assert.equal(context.error, 'preset_error_invalid');
});

test('active badge follows the current connection association without a management selection', () => {
  const { context, connection, syncConnection } = fixture();
  const badgeCondition = source.match(/\{#if (appState\.apiSettings\.appliedPresetId === item\.id)\}/)[1];
  context.item = { id: 'first' };
  const isActive = () => vm.runInContext(badgeCondition, context);
  connection.appliedPresetId = 'first'; connection.id = 'a';
  syncConnection(); assert.equal(isActive(), true);
  context.appState.apiSettings = { ...connection, id: 'b', appliedPresetId: 'second' };
  syncConnection(); assert.equal(isActive(), false);
  context.item.id = 'second'; assert.equal(isActive(), true);
  context.appState.apiSettings = connection;
  context.item.id = 'first'; syncConnection(); assert.equal(isActive(), true);
  delete connection.appliedPresetId;
  syncConnection(); assert.equal(isActive(), false);
  assert.doesNotMatch(source, /selectedId|const selected\b/);
});

test('creating and editing library entries retain the applied association and settings', async () => {
  const { context, connection } = fixture();
  connection.appliedPresetId = 'applied';
  context.edit(); context.name = 'New'; await context.save();
  assert.equal(connection.appliedPresetId, 'applied'); assert.equal(connection.temperature, 0.8);
  context.edit(context.items[0]); context.name = 'Renamed'; await context.save();
  assert.equal(connection.appliedPresetId, 'applied'); assert.equal(connection.temperature, 0.8);
});

test('library shows every preset with direct accessible actions and row-local deletion confirmation', () => {
  assert.doesNotMatch(source, /<Select\b|<select\b/);
  assert.match(source, /<ul class="presets-list"[\s\S]*?\{#each items as item \(item.id\)\}/);
  assert.match(source, /<strong title=\{item.preset.name\}>\{item.preset.name\}/);
  assert.match(source, /Object.keys\(item.preset.providers\)/);
  for (const action of ['apply(item)', 'edit(item)', 'exportFile(item)', 'deletingId = item.id']) assert.ok(source.includes(action));
  for (const action of ['edit', 'export', 'delete']) assert.ok(source.includes('`${item.preset.name}: ${m.preset_' + action + '()}`'));
  assert.match(source, /disabled=\{busy \|\| !!draft\}/);
  assert.match(source, /class="apply-label">\{appState.apiSettings.appliedPresetId === item.id \? m.preset_deactivate\(\) : m.preset_apply\(\)\}/);
  assert.match(source, /\{#if deletingId === item.id\}[\s\S]*?onclick=\{remove\}/);
  const mobile = source.slice(source.indexOf('@media(max-width:767px)'));
  assert.match(mobile, /\.preset-row \{ grid-template-columns:minmax\(0,1fr\) auto;/);
  assert.match(mobile, /\.preset-action \{ width:34px; height:44px;/);
  assert.match(mobile, /\.apply-icon \{ display:grid;/);
  assert.doesNotMatch(mobile, /\.(?:row-actions|preset-action|preset-meta)\s*\{[^}]*display:none/);
});

test('deactivate action restores through its callback, keeps the library and handles failures', async () => {
  const { context, connection } = fixture();
  connection.appliedPresetId = 'active';
  context.items = [{ id: 'active', preset: capturePreset(connection, 'Active') }];
  let calls = 0;
  context.onDeactivate = async () => { calls++; connection.appliedPresetId = null; };
  context.busy = true; await context.deactivate(); assert.equal(calls, 0);
  context.busy = false; context.draft = {}; await context.deactivate(); assert.equal(calls, 0);
  context.draft = null; await context.deactivate();
  assert.equal(calls, 1); assert.equal(context.items.length, 1);
  assert.equal(context.status, 'preset_deactivated');
  connection.appliedPresetId = 'active';
  context.onDeactivate = async () => { throw new Error('Write failed'); };
  await context.deactivate();
  assert.equal(context.error, 'preset_error_storage'); assert.equal(context.busy, false);
  assert.equal(connection.appliedPresetId, 'active');
});

test('deletion synchronizes parameter controls only when the current connection was restored', async () => {
  const { context, connection } = fixture();
  connection.appliedPresetId = 'active';
  let synchronized = 0;
  context.onDeleted = () => synchronized++;
  context.deletingId = 'other'; await context.remove();
  assert.equal(synchronized, 0);
  context.deletingId = 'active'; await context.remove();
  assert.equal(synchronized, 1);
});

test('row actions operate on the requested item and never change the association during export', async () => {
  const { context, connection } = fixture();
  const first = { id: 'first', preset: capturePreset(connection, 'First') };
  const second = { id: 'second', preset: capturePreset(connection, 'Second') };
  context.items = [first, second]; connection.appliedPresetId = first.id;
  const applied = []; const exported = [];
  context.onApply = async (preset, id) => { applied.push([preset.name, id]); connection.appliedPresetId = id; };
  context.downloadPreset = async item => exported.push(item.id);
  await context.exportFile(second);
  assert.deepEqual(exported, ['second']); assert.equal(connection.appliedPresetId, first.id);
  await context.apply(second);
  assert.deepEqual(applied, [['Second', 'second']]); assert.equal(connection.appliedPresetId, second.id);
  await context.apply(second); assert.equal(applied.length, 1);
  context.busy = true; await context.apply(first); await context.exportFile(first);
  context.busy = false; context.edit(first); await context.apply(first); await context.exportFile(first);
  assert.equal(applied.length, 1); assert.equal(exported.length, 1);
});
