import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function store() {
  const source = readFileSync(new URL('./chatStore.svelte.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('chatStore.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  let resolve, reject;
  const calls = [];
  const context = vm.createContext({
    $state: value => value, getLocale: () => 'en', reportDiagnostic() {},
    crypto: { randomUUID: () => 'stable-id' }, decodeMessage: row => row,
    invoke: (command, params) => {
      calls.push({ command, params });
      if (command === 'add_message') return new Promise((ok, fail) => { resolve = ok; reject = fail; });
      if (command === 'get_messages_page') return Promise.resolve([
        { id: 'stable-id', conversation_id: 'chat', role: 'user', content: 'hello', swipe_variants: ['hello'], swipe_index: 0 },
      ]);
      return Promise.resolve([]);
    },
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  const state = vm.runInContext('chatState', context);
  state.activeChatId = 'chat';
  return { context, state, calls, save: () => resolve(), fail: () => reject(new Error('Disk error')) };
}

test('user message is visible before persistence and keeps the same ID after reload', async () => {
  const c = store();
  const saving = c.context.addMessage('user', 'hello');
  assert.equal(c.state.currentMessages.length, 1);
  assert.equal(c.state.currentMessages[0].id, 'stable-id');
  assert.equal(c.calls[0].params.messageId, 'stable-id');
  c.save(); await saving;
  assert.equal(c.state.currentMessages.length, 1);
  assert.equal(c.state.currentMessages[0].id, 'stable-id');
});

test('persistence failure removes only the optimistic row and propagates to the composer', async () => {
  const c = store();
  c.state.currentMessages.push({ id: 'existing', content: 'previous' });
  const saving = c.context.addMessage('user', 'hello');
  c.fail();
  await assert.rejects(saving, /Disk error/);
  assert.equal(c.state.currentMessages.length, 1);
  assert.equal(c.state.currentMessages[0].id, 'existing');
});

test('saving an old chat does not reload it over the newly active conversation', async () => {
  const c = store();
  const saving = c.context.addMessage('user', 'hello');
  c.state.activeChatId = 'other'; c.state.currentMessages = [{ id: 'other-message' }];
  c.save(); await saving;
  assert.equal(c.state.activeChatId, 'other');
  assert.equal(c.state.currentMessages[0].id, 'other-message');
  assert.equal(c.calls.some(call => call.command === 'get_messages_page'), false);
});
