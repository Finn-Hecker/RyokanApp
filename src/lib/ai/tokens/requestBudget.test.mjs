import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { measureRequestBudget } from './requestBudget.ts';
import { requestParameterConfig, createDefaultApiParameterEnabled } from '../connections/apiParameters.ts';
import { resolvedHardContextLimit } from '../connections/connectionCore.ts';
import { estimateBudgetTokens } from './tokenEstimate.ts';

const source = await readFile(new URL('../../stores/multiplayer.svelte.ts', import.meta.url), 'utf8');
const body = source.slice(source.indexOf('async function buildLlmMessages('), source.indexOf('\nfunction insertSorted('));
const compiled = ts.transpileModule(body, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
function builder(messages, count) {
  return new Function('mpState', 'appState', 'getClientLanguageName', 'estimateBudgetTokens', 'requestParameterConfig',
    'measureRequestBudget', 'resolvedHardContextLimit', `${compiled}; return buildLlmMessages;`)(
    { messages }, { activeCharacter: null }, () => 'English', count,
    requestParameterConfig, measureRequestBudget, resolvedHardContextLimit);
}
function connection(kind) {
  return { providerKind: kind, url: 'https://fixture.invalid', model: 'fixture',
    systemPrompt: 'system instruction', manualContextCap: 4096, detectedContext: null,
    maxTokens: 2048, thinkingBudget: 1024, parameterEnabled: { ...createDefaultApiParameterEnabled(), maxTokens: true },
    additionalApiParameters: '' };
}

test('multiplayer reserves native output and trims a measured history suffix', async () => {
  for (const kind of ['anthropic', 'gemini', 'generic_openai']) {
    const settings = connection(kind);
    const history = [
      { kind: 'user', author: 'player', text: 'x'.repeat(3000) },
      { kind: 'llm', author: 'AI', text: 'x'.repeat(3000) },
      { kind: 'user', author: 'player', text: 'newest user message' },
    ];
    const count = text => text.length; // A deliberately expensive tokenizer catches the old character heuristic.
    const messages = await builder(history, count)(settings);
    assert.equal(messages[0].role, 'system');
    assert.ok(messages.at(-1).content.includes('newest user message'));
    assert.ok(messages.every(message => !message.content.includes('x'.repeat(3000))));
    assert.equal((await measureRequestBudget(messages, requestParameterConfig(settings), 4096, async text => count(text))).fits, true);
  }
});

test('multiplayer plans Unicode history with the production estimator without tokenizer IPC', async () => {
  const settings = connection('generic_openai');
  const messages = await builder([
    { kind: 'user', author: 'player', text: '日本語🙂'.repeat(2000) },
    { kind: 'llm', author: 'AI', text: 'older response' },
    { kind: 'user', author: 'player', text: 'latest message' },
  ], estimateBudgetTokens)(settings);
  assert.ok(messages.at(-1).content.includes('latest message'));
  assert.ok(messages.every(message => !message.content.includes('日本語')));
  assert.ok((await measureRequestBudget(messages, requestParameterConfig(settings), 4096,
    async text => estimateBudgetTokens(text))).fits);
});

test('multiplayer rejects an irreducible system prompt before a provider request', async () => {
  const settings = { ...connection('gemini'), systemPrompt: 'x'.repeat(5000) };
  await assert.rejects(builder([{ kind: 'user', text: 'Hi', author: 'player' }], text => text.length)(settings), /context token limit/);
});

test('request measurement includes custom fields and a proportional safety reserve', async () => {
  const config = requestParameterConfig({ ...connection('anthropic'), additionalApiParameters: '{"max_tokens":3000}' });
  const measured = await measureRequestBudget([{ role: 'user', content: 'Hi' }], config, 4096, async text => text.length);
  assert.equal(measured.reserve, 3000 + Math.max(128, Math.ceil(4096 * 0.02)));
  assert.equal(measured.inputTokens, 'user\nHi'.length + 7 + '{"max_tokens":3000}'.length);
});
