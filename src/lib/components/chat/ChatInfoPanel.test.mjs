import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./ChatInfoPanel.svelte', import.meta.url), 'utf8');
function panel(overrides = {}) {
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('ChatInfoPanel.ts', script, ts.ScriptTarget.Latest, true);
  const body = ast.statements.map(statement => {
    if (ts.isImportDeclaration(statement)) return '';
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations[0];
      if (declaration.initializer && ts.isCallExpression(declaration.initializer)
        && declaration.initializer.expression.getText(ast) === '$derived') {
        return `Object.defineProperty(globalThis, '${declaration.name.getText(ast)}', { get: () => (${declaration.initializer.arguments[0].getText(ast)}) });`;
      }
    }
    return statement.getText(ast);
  }).join('\n');
  const effects = [];
  const context = vm.createContext({
    $state: value => value, $effect: callback => effects.push(callback),
    $props: () => ({ onClose() {} }), $bindable: value => value,
    getLocale: () => 'de',
    chatState: { activeChatId: 'chat', conversations: [{ id: 'chat', mode: 'singleplayer' }],
      currentMessages: [], summaryMeta: { currentSummary: 'Saved facts', lastSummarizedMessageId: 'marker' } },
    ...overrides,
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, effects, run: code => vm.runInContext(code, context) };
}

test('summary editor keeps unsaved text local and publishes via the existing coordinator', async () => {
  let saved;
  const p = panel({ updateRollingSummary: async (...args) => { saved = args; } });
  p.context.beginSummaryEdit();
  p.run('summaryDraft.text = "Corrected facts"');
  assert.equal(p.context.chatState.summaryMeta.currentSummary, 'Saved facts');
  await p.context.saveSummary();
  assert.deepEqual(JSON.parse(JSON.stringify(saved)), ['chat',
    { currentSummary: 'Saved facts', lastSummarizedMessageId: 'marker' }, 'Corrected facts']);
  assert.equal(p.run('summaryDraft'), null);
});

test('save failure keeps the editable draft and exposes an error', async () => {
  const p = panel({ updateRollingSummary: async () => { throw new Error('Save failed'); }, Error });
  p.context.beginSummaryEdit();
  await p.context.saveSummary();
  assert.equal(p.run('summaryDraft.text'), 'Saved facts');
  assert.equal(p.run('summaryError'), 'Save failed');
  assert.equal(p.run('isSavingSummary'), false);
});

test('changing chats discards a summary draft and a delayed save cannot clear the new draft', async () => {
  let finish;
  const p = panel({ updateRollingSummary: () => new Promise(resolve => { finish = resolve; }) });
  p.context.beginSummaryEdit();
  const saving = p.context.saveSummary();
  p.context.chatState.activeChatId = 'other';
  p.context.chatState.conversations.push({ id: 'other', mode: 'singleplayer' });
  p.effects.forEach(effect => effect());
  assert.equal(p.run('summaryDraft'), null);
  p.context.beginSummaryEdit();
  finish();
  await saving;
  assert.equal(p.run('summaryDraft.chatId'), 'other');
});

test('empty summary has an empty state and mobile sheet height is independent of the selected tab', () => {
  const p = panel();
  p.context.chatState.summaryMeta = { currentSummary: null, lastSummarizedMessageId: null };
  p.context.beginSummaryEdit();
  assert.equal(p.run('summaryDraft'), null);
  assert.match(source, /Noch keine Summary vorhanden/);
  assert.match(source, /mobileHeight="calc\(var\(--app-visible-height, 100dvh\) \* \.8\)"/);
  assert.match(source, /activeTab === 'summary'/);
});
