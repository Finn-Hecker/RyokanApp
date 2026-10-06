import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { decodeMessage } from '../chat/messageData.ts';

function store(overrides = {}) {
  const source = readFileSync(new URL('./chatStore.svelte.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('chatStore.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  let resolve, reject;
  let saved;
  const calls = [];
  const context = vm.createContext({
    $state: value => value, getLocale: () => 'en', reportDiagnostic() {},
    crypto: { randomUUID: () => 'stable-id' }, decodeMessage,
    invoke: (command, params) => {
      calls.push({ command, params });
      if (overrides[command]) return overrides[command](params);
      if (command === 'add_message') {
        saved = params;
        return new Promise((ok, fail) => { resolve = ok; reject = fail; });
      }
      if (command === 'get_chat_message_update') return Promise.resolve({
        message: { id: saved.messageId, conversation_id: saved.chatId, role: saved.role, content: saved.content,
          swipe_variants: JSON.stringify([saved.content]), swipe_index: 0, usage_variants: JSON.stringify([saved.usage]) },
        conversation: { id: saved.chatId, title: 'SQLite title', created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-02T00:00:00.000Z',
          mode: 'singleplayer', folder_id: 'folder', sort_order: 7, role_snapshot: null },
      });
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

test('user message is visible before persistence and keeps its ID and object after targeted refresh', async () => {
  const c = store();
  const saving = c.context.addMessage('user', 'hello');
  assert.equal(c.state.currentMessages.length, 1);
  assert.equal(c.state.currentMessages[0].id, 'stable-id');
  assert.equal(c.calls[0].params.messageId, 'stable-id');
  const optimistic = c.state.currentMessages[0];
  c.save(); await saving;
  assert.equal(c.state.currentMessages.length, 1);
  assert.equal(c.state.currentMessages[0].id, 'stable-id');
  assert.equal(c.state.currentMessages[0], optimistic);
  assert.deepEqual(c.calls.map(call => call.command), ['add_message', 'get_chat_message_update']);
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

test('saving preserves loaded history, pagination, folder state and unaffected object identities', async () => {
  const c = store();
  const previous = { id: 'older', content: 'previous', swipe_variants: ['previous'], swipe_index: 0 };
  const conversation = { id: 'chat', title: 'Before', mode: 'singleplayer', folder_id: 'folder', sort_order: 7 };
  const other = { id: 'other', title: 'Other' };
  const folder = { id: 'folder', is_collapsed: false, chat_count: 100 };
  c.state.currentMessages.push(previous);
  c.state.conversations.push(conversation, other);
  c.state.folders.push(folder);
  c.state.hasMoreMessages = true;
  const history = c.state.currentMessages, conversations = c.state.conversations, folders = c.state.folders;
  const saving = c.context.addMessage('user', 'hello');
  c.save(); await saving;
  assert.equal(c.state.currentMessages, history);
  assert.equal(c.state.currentMessages[0], previous);
  assert.equal(c.state.conversations, conversations);
  assert.equal(c.state.conversations[0], conversation);
  assert.equal(c.state.conversations[1], other);
  assert.equal(conversation.title, 'SQLite title');
  assert.equal(conversation.updated_at, '2026-01-02T00:00:00.000Z');
  assert.equal(conversation.folder_id, 'folder');
  assert.equal(conversation.sort_order, 7);
  assert.equal(c.state.folders, folders);
  assert.equal(c.state.folders[0], folder);
  assert.equal(folder.chat_count, 100);
  assert.equal(c.state.hasMoreMessages, true);
  assert.equal(c.calls.length, 2);
});

test('assistant row appears only after persistence with authoritative ID, variants and usage', async () => {
  const c = store();
  const usage = { inputTokens: 42, outputTokens: 7, serviceTier: 'flex', connectionName: 'Saved profile' };
  const saving = c.context.addMessage('assistant', 'answer', usage);
  assert.equal(c.state.currentMessages.length, 0);
  c.save(); await saving;
  const message = c.state.currentMessages[0];
  assert.equal(message.id, 'stable-id');
  assert.equal(message.role, 'assistant');
  assert.deepEqual(message.swipe_variants, ['answer']);
  assert.deepEqual(message.usage_variants, [usage]);
  assert.equal(c.state.hasMoreMessages, false);
  assert.equal(c.calls.length, 2);
});

test('a chat switch while targeted refresh is pending cannot append to the new history', async () => {
  let finish;
  const c = store({ get_chat_message_update: () => new Promise(resolve => { finish = resolve; }) });
  const saving = c.context.addMessage('assistant', 'answer');
  c.save();
  await new Promise(resolve => setImmediate(resolve));
  c.state.activeChatId = 'other';
  const history = [{ id: 'other-message' }]; c.state.currentMessages = history;
  finish({ message: { id: 'stable-id', content: 'answer' }, conversation: { id: 'chat' } });
  await saving;
  assert.equal(c.state.currentMessages, history);
  assert.equal(c.state.currentMessages.length, 1);
});

test('refresh failure after a successful save falls back without reporting a failed send', async () => {
  const c = store({ get_chat_message_update: () => Promise.reject(new Error('Refresh unavailable')) });
  const saving = c.context.addMessage('user', 'hello');
  c.save(); await saving;
  assert.equal(c.state.currentMessages[0].id, 'stable-id');
  assert.ok(c.calls.some(call => call.command === 'get_messages_page'));
});
