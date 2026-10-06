import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

function handler(path, name, context) {
  const source = readFileSync(new URL(path, import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('component.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === name);
  vm.runInContext(ts.transpile(fn.getText(ast), { target: ts.ScriptTarget.ES2022 }), context);
  return context[name];
}

for (const [path, name, download, success, args] of [
  ['./PresetSection.svelte', 'exportFile', 'downloadPreset', 'toast_preset_exported', [{ id: 'preset' }]],
  ['./SettingsPage.svelte', 'exportDiagnostics', 'downloadDiagnostics', 'toast_diagnostics_exported', []],
  ['../editor/Editor.svelte', 'handleExport', 'exportCharacterCard', 'toast_export_success', []]
]) {
  for (const mobile of [true, false]) {
    test(`${name} (${mobile ? 'Android' : 'desktop'}): pending, success, cancel and failure feedback`, async () => {
      let resolve, reject;
      const feedback = [];
      const context = vm.createContext({
        appState: { interactionMode: mobile ? 'mobile' : 'desktop', apiSettings: {}, longTermMemory: false },
        busy: false, draft: null, error: '', status: 'old success', exportingDiagnostics: false,
        editChar: { id: 'character' }, charName: 'Character', menuOpen: true, isExporting: false,
        $state: { snapshot: value => structuredClone(value) }, diagnosticsMetadata: () => ({}),
        reportDiagnostic() {}, clearExportFeedback() { feedback.length = 0; },
        showExportFeedback(type, message) { feedback.push({ type, message }); },
        m: new Proxy({}, { get: (_, key) => () => key }),
        [download]: () => new Promise((done, fail) => { resolve = done; reject = fail; })
      });
      const run = handler(path, name, context);
      for (const outcome of ['success', 'cancel', 'failure']) {
        const pending = run(...args);
        assert.deepEqual(feedback, []);
        if (outcome === 'failure') reject(new Error('private write error'));
        else resolve(outcome === 'success');
        await pending;
        if (outcome === 'cancel') assert.deepEqual(feedback, []);
        else {
          assert.equal(feedback.length, 1);
          assert.equal(feedback[0].type, outcome === 'success' ? 'success' : 'error');
          if (outcome === 'success') assert.equal(feedback[0].message, mobile ? success : 'toast_download_started');
          assert.ok(!feedback[0].message.includes('private'));
        }
        assert.equal(context.busy || context.exportingDiagnostics || context.isExporting, false);
      }
    });
  }
}
