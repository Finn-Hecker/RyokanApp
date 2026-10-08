import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function evaluateFunctions(file, context) {
  const input = readFileSync(new URL(file, import.meta.url), 'utf8');
  const source = file.endsWith('.svelte') ? input.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1] : input;
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(ts.isFunctionDeclaration)
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
}

function settingsPage(invoke) {
  const profile = { id: 'saved', apiKey: 'example', parameterEnabled: {} };
  const calls = [], hydrated = [], navigations = [];
  const context = vm.createContext({
    appState: { apiConnections: [profile], apiSettings: profile, textRules: [], chatFontScale: 120 },
    settingsReady: false, settingsLoadFailed: false, settingsSaveFailed: false, isSaving: false,
    parameterEnabled: {}, additionalApiParametersValidation: { valid: true }, powerUser: false,
    TEXT_RULES_KEY: 'text_rules', LONG_TERM_MEMORY_KEY: 'memory', SUMMARY_CONNECTION_KEY: 'summary',
    reportDiagnostic() {}, parseTextRules: () => [], serializeTextRules: JSON.stringify,
    resolvedHardContextLimit: () => 4096,
    hydrateApiConnections: rows => hydrated.push(rows),
    persistApiConnections: async () => { calls.push(['profiles']); },
    returnTo: view => navigations.push(view),
    invoke: async (command, args) => { calls.push([command, args]); return invoke(command, args); },
  });
  evaluateFunctions('./settings.ts', context);
  evaluateFunctions('../components/settings/SettingsPage.svelte', context);
  return { context, profile, calls, hydrated, navigations };
}

test('settings read and write failures propagate the original error', async () => {
  const error = new Error('Disk failure');
  const h = settingsPage(async () => { throw error; });
  await assert.rejects(h.context.getAllSettings(), caught => caught === error);
  await assert.rejects(h.context.saveSetting('font', 120), caught => caught === error);
});

test('failed settings loading preserves profiles and blocks all persistence until a successful retry', async () => {
  let fail = true;
  const rows = [{ key: 'settings_power_user', value: 'true' }];
  const h = settingsPage(async command => {
    if (command === 'get_all_settings') {
      if (fail) throw new Error('Read failure');
      return rows;
    }
  });
  await h.context.loadSettings();
  assert.equal(h.context.settingsReady, false);
  assert.equal(h.context.settingsLoadFailed, true);
  assert.equal(h.context.appState.apiConnections[0], h.profile);
  assert.equal(h.context.appState.chatFontScale, 120);
  assert.deepEqual(h.hydrated, []);
  await h.context.saveSettings();
  assert.deepEqual(h.calls.map(call => call[0]), ['get_all_settings']);
  assert.deepEqual(h.navigations, []);
  fail = false;
  await h.context.loadSettings();
  assert.equal(h.context.settingsReady, true);
  assert.equal(h.context.settingsLoadFailed, false);
  assert.deepEqual(h.hydrated, [rows]);
  await h.context.saveSettings();
  assert.deepEqual(h.navigations, ['lobby']);
});

test('saving is blocked while initial settings loading is still pending', async () => {
  let resolve;
  const h = settingsPage(() => new Promise(done => { resolve = done; }));
  const loading = h.context.loadSettings();
  await h.context.saveSettings();
  assert.deepEqual(h.calls.map(call => call[0]), ['get_all_settings']);
  resolve([]);
  await loading;
  assert.equal(h.context.settingsReady, true, 'a genuine empty configuration is still valid');
});

test('a partial settings write failure keeps the page open and permits retry', async () => {
  let fail = true;
  const h = settingsPage(async (command, args) => {
    if (command === 'get_all_settings') return [];
    if (command === 'save_setting' && args.key === 'text_rules' && fail) throw new Error('Write failure');
  });
  await h.context.loadSettings();
  await h.context.saveSettings();
  assert.deepEqual(h.navigations, []);
  assert.equal(h.context.settingsSaveFailed, true);
  assert.equal(h.context.isSaving, false);
  fail = false;
  await h.context.saveSettings();
  assert.deepEqual(h.navigations, ['lobby']);
  assert.equal(h.context.settingsSaveFailed, false);
});
