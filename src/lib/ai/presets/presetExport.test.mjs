import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { capturePreset, exportPreset, importPreset } from './presetCore.ts';
import { createDefaultApiParameterEnabled } from '../connections/apiParameters.ts';
import { exportFile } from '../../utils/fileExport.ts';

test('preset JSON uses the diagnostics native writer and returns success/cancel/failure faithfully', async () => {
  const source = readFileSync(new URL('./presetLibrary.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('library.ts', source, ts.ScriptTarget.Latest, true);
  const fn = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'downloadPreset');
  const context = vm.createContext({ exportPreset, exportFile, TextEncoder });
  vm.runInContext(ts.transpile(fn.getText(ast).replace(/^export /, ''), { target: ts.ScriptTarget.ES2022 }), context);
  const preset = capturePreset({ providerKind: 'llama_cpp', temperature: 0.8, repetitionPenalty: 1.12, topP: 0.9, topK: 40, minP: 0.05, frequencyPenalty: 0, maxTokens: 300, thinkingBudget: 2500, reasoningLevel: 'auto', serviceTier: 'auto', systemPrompt: '', postHistoryPrompt: '', additionalApiParameters: '', parameterEnabled: createDefaultApiParameterEnabled() }, 'Grüße / Test');
  for (const outcome of ['success', 'cancel', 'failure']) {
    const writes = [];
    globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
      if (command === 'plugin:dialog|save') {
        assert.equal(args.options.defaultPath, 'Grüße___Test.ryokan.json');
        assert.deepEqual(Array.from(args.options.filters[0].extensions), ['json']);
        return outcome === 'cancel' ? null : 'content://preset';
      }
      assert.equal(command, 'write_android_export');
      assert.equal(args.uri, 'content://preset');
      writes.push(args.bytes);
      if (outcome === 'failure') throw new Error('write failed');
    } } };
    try {
      const result = context.downloadPreset({ id: 'preset', preset }, true);
      if (outcome === 'failure') await assert.rejects(result, /write failed/);
      else assert.equal(await result, outcome === 'success');
      assert.equal(writes.length, outcome === 'cancel' ? 0 : 1);
      if (writes.length) assert.deepEqual(importPreset(new TextDecoder().decode(new Uint8Array(writes[0]))), preset);
    } finally { delete globalThis.window; }
  }
});

test('Android release bridge keeps the Activity and closes the document before JNI acknowledges success', () => {
  const activity = readFileSync(new URL('../../../../src-tauri/gen/android/app/src/main/java/io/ryokan/app/MainActivity.kt', import.meta.url), 'utf8');
  assert.match(activity, /import androidx\.annotation\.Keep/);
  assert.match(activity, /@Keep\s+class MainActivity/);
  assert.match(activity, /fun writeExportDocument\(uri: String, bytes: ByteArray\)/);
  assert.match(activity, /output\.use\s*\{\s*it\.write\(bytes\)\s*\}/);
});
