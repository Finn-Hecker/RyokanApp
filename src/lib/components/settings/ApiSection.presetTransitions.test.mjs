import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { activateConnectionPreset, capturePreset, capturePresetRestore, transitionPresetProvider } from '../../ai/presets/presetCore.ts';
import { createDefaultApiParameterEnabled } from '../../ai/connections/apiParameters.ts';

const source = readFileSync(new URL('./ApiSection.svelte', import.meta.url), 'utf8');
const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('ApiSection.ts', script, ts.ScriptTarget.Latest, true);
const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)
  && ['preparePresetProvider', 'selectProvider', 'selectCustom', 'selectModel'].includes(node.name.text))
  .map(node => node.getText(ast)).join('\n');

function fixture(kind) {
  const defaults = { providerKind: 'lm_studio', customMode: false, temperature: 0.8, repetitionPenalty: 1.12,
    topP: 0.9, topK: 40, minP: 0.05, frequencyPenalty: 0, maxTokens: 300, thinkingBudget: 2500,
    reasoningLevel: 'auto', serviceTier: 'auto', systemPrompt: '', postHistoryPrompt: '',
    additionalApiParameters: '', parameterEnabled: createDefaultApiParameterEnabled() };
  const manual = { ...structuredClone(defaults), providerKind: kind, customMode: kind === 'generic_openai',
    url: 'https://manual.test/v1', model: 'old-model', apiKey: 'local-key', temperature: 0.5,
    maxTokens: 7000, additionalApiParameters: '{"stop":["https://manual.test/stop"]}' };
  const preset = capturePreset({ ...defaults, providerKind: kind, temperature: 2,
    maxTokens: 9000, additionalApiParameters: '{"stop":["PRESET"]}' }, 'A');
  const connection = activateConnectionPreset(manual, preset, 'A');
  const context = vm.createContext({ appState: { apiSettings: connection }, modelLoadRequest: 0,
    lastAttemptedModelConfig: 'old', availableModels: [], modelMetadata: {}, modelsError: '', modelMenuOpen: false,
    modelSearch: '', activeModelCategory: 'all', parameterEnabled: { ...connection.parameterEnabled },
    transitionPresetProvider, createDefaultConnection: () => structuredClone(defaults),
    invalidateDetectedContext: () => {}, modelGenerationCapabilities: () => null });
  vm.runInContext(ts.transpile(functions, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, manual, connection, defaults, preset };
}

test('built-in and custom provider UI transitions restore shared state and clear the old provider baseline', () => {
  for (const from of ['anthropic', 'gemini', 'generic_openai']) {
    for (const to of ['llama_cpp', 'generic_openai']) {
      if (from === to) continue;
      const { context, manual, connection, defaults } = fixture(from);
      const request = structuredClone(connection);
      if (to === 'generic_openai') context.selectCustom();
      else context.selectProvider({ kind: to, url: 'http://localhost:8080/v1' });
      assert.equal(connection.providerKind, to);
      assert.equal(connection.customMode, to === 'generic_openai');
      assert.equal(connection.model, '');
      assert.equal(connection.apiKey, manual.apiKey);
      assert.equal(connection.appliedPresetId, null);
      assert.equal(connection.presetRestoreSnapshot, undefined);
      assert.equal(connection.temperature, manual.temperature);
      assert.equal(connection.maxTokens, defaults.maxTokens);
      assert.equal(connection.additionalApiParameters, '');
      assert.deepEqual({ ...context.parameterEnabled }, connection.parameterEnabled);
      assert.equal(request.appliedPresetId, 'A');
      assert.equal(request.temperature, 2);
    }
  }
});

test('model selection within a provider retains the applied block and original baseline', () => {
  const { context, connection } = fixture('anthropic');
  const restore = structuredClone(connection.presetRestoreSnapshot);
  const controlled = capturePresetRestore(connection);
  context.selectModel('new-model');
  assert.equal(connection.model, 'new-model');
  assert.equal(connection.appliedPresetId, 'A');
  assert.deepEqual(connection.presetRestoreSnapshot, restore);
  assert.deepEqual(capturePresetRestore(connection), controlled);
});
