import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { decodeMessage } from '../chat/messageData.ts';
import { getPromptUsageAnchor, rememberPromptUsageAnchor, forgetPromptUsageAnchor } from '../ai/summary/rollingSummaryCore.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
function deferred() {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
}
const row = (chatId, id = `${chatId}-message`) => ({ id, conversation_id: chatId, role: 'user', content: id });

function store(invoke = () => undefined) {
  const source = readFileSync(new URL('./chatStore.svelte.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('chatStore.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const calls = [];
  const context = vm.createContext({
    $state: value => value, getLocale: () => 'en', reportDiagnostic() {}, decodeMessage, forgetPromptUsageAnchor,
    appState: { activeCharacter: { name: 'initial' } }, characterState: { allCharacters: [{ id: 'card' }] },
    loadCharacters: async () => {},
    invoke: async (command, params) => {
      calls.push({ command, params });
      const custom = invoke(command, params);
      if (custom !== undefined) return custom;
      if (command === 'get_chat_character_snapshot') return { name: params.chatId };
      if (command === 'get_summary_meta') return { summary: `summary-${params.chatId}`, last_id: null };
      if (command === 'get_messages_page') return [row(params.chatId)];
      return [];
    },
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  const state = vm.runInContext('chatState', context);
  state.conversations = ['A', 'B'].map(id => ({ id, mode: 'singleplayer', role_snapshot: { name: `role-${id}` } }));
  return { context, state, calls };
}

test('a late old chat load cannot replace the latest chat or mix its metadata', async () => {
  const page = deferred();
  const h = store((command, params) => command === 'get_messages_page' && params.chatId === 'A' ? page.promise : undefined);
  const loadingA = h.context.loadMessages('A');
  await flush();
  assert.equal(h.context.appState.activeCharacter.name, 'initial', 'metadata stays staged until history is ready');
  await h.context.loadMessages('B');
  page.resolve([row('A')]);
  await loadingA;
  assert.equal(h.state.activeChatId, 'B');
  assert.equal(h.context.appState.activeCharacter.name, 'B');
  assert.equal(h.state.activeRoleSnapshot.name, 'role-B');
  assert.equal(h.state.summaryMeta.currentSummary, 'summary-B');
  assert.deepEqual(Array.from(h.state.currentMessages, message => message.id), ['B-message']);
});

test('a stale character snapshot cannot overwrite the new chat or request its history', async () => {
  const snapshot = deferred();
  const h = store((command, params) => command === 'get_chat_character_snapshot' && params.chatId === 'A' ? snapshot.promise : undefined);
  const loadingA = h.context.loadMessages('A');
  await h.context.loadMessages('B');
  snapshot.resolve({ name: 'A' });
  await loadingA;
  assert.equal(h.context.appState.activeCharacter.name, 'B');
  assert.equal(h.calls.some(call => call.command === 'get_messages_page' && call.params.chatId === 'A'), false);
});

test('old chat background refresh does not supersede a pending navigation', async () => {
  const page = deferred();
  const h = store((command, params) => command === 'get_messages_page' && params.chatId === 'B' ? page.promise : undefined);
  await h.context.loadMessages('A');
  const loadingB = h.context.loadMessages('B');
  await flush();
  await h.context.loadMessages('A');
  page.resolve([row('B')]);
  await loadingB;
  assert.equal(h.state.activeChatId, 'B');
  assert.equal(h.calls.filter(call => call.command === 'get_messages_page' && call.params.chatId === 'A').length, 1);
});

test('explicitly selecting the visible chat cancels a pending switch to another chat', async () => {
  const page = deferred();
  const h = store((command, params) => command === 'get_messages_page' && params.chatId === 'B' ? page.promise : undefined);
  await h.context.openHistoryChat('A');
  const loadingB = h.context.openHistoryChat('B');
  await flush();
  await h.context.openHistoryChat('A');
  page.resolve([row('B')]);
  await loadingB;
  assert.equal(h.state.activeChatId, 'A');
  assert.equal(h.context.appState.activeCharacter.name, 'A');
  assert.equal(h.state.summaryMeta.currentSummary, 'summary-A');
  assert.equal(h.state.currentMessages[0].id, 'A-message');
});

test('a history load failure leaves the previous complete chat snapshot intact', async () => {
  const h = store((command, params) => command === 'get_messages_page' && params.chatId === 'B'
    ? Promise.reject(new Error('Disk failure')) : undefined);
  await h.context.loadMessages('A');
  await h.context.loadMessages('B');
  assert.equal(h.state.activeChatId, 'A');
  assert.equal(h.context.appState.activeCharacter.name, 'A');
  assert.equal(h.state.summaryMeta.currentSummary, 'summary-A');
  assert.equal(h.state.currentMessages[0].id, 'A-message');
});

test('an old pagination response, including an empty page, cannot mutate a new chat', async () => {
  for (const result of [[row('A', 'A-old')], []]) {
    const page = deferred();
    const h = store((command, params) => command === 'get_messages_page' && params.offset > 0 ? page.promise : undefined);
    await h.context.loadMessages('A');
    h.state.hasMoreMessages = true;
    const paging = h.context.loadMoreMessages();
    await h.context.loadMessages('B');
    h.state.hasMoreMessages = true;
    page.resolve(result);
    await paging;
    assert.equal(h.state.hasMoreMessages, true);
    assert.deepEqual(Array.from(h.state.currentMessages, message => message.id), ['B-message']);
  }
});

test('concurrent pagination loads one page and filters overlap with existing rows', async () => {
  const page = deferred();
  const h = store((command, params) => command === 'get_messages_page' && params.offset > 0 ? page.promise : undefined);
  await h.context.loadMessages('A');
  h.state.hasMoreMessages = true;
  const first = h.context.loadMoreMessages();
  await h.context.loadMoreMessages();
  assert.equal(h.calls.filter(call => call.params.offset > 0).length, 1);
  page.resolve([row('A', 'A-old'), row('A')]);
  await first;
  assert.deepEqual(Array.from(h.state.currentMessages, message => message.id), ['A-old', 'A-message']);
});

test('pagination finishing after a same-chat refresh cannot append stale rows', async () => {
  const page = deferred();
  const h = store((command, params) => command === 'get_messages_page' && params.offset > 0 ? page.promise : undefined);
  await h.context.loadMessages('A');
  h.state.hasMoreMessages = true;
  const paging = h.context.loadMoreMessages();
  await h.context.loadMessages('A');
  page.resolve([row('A', 'A-old')]);
  await paging;
  assert.deepEqual(Array.from(h.state.currentMessages, message => message.id), ['A-message']);
});

test('failed pagination releases its pending request so the next attempt can load', async () => {
  let attempts = 0;
  const h = store((command, params) => command === 'get_messages_page' && params.offset > 0
    ? ++attempts === 1 ? Promise.reject(new Error('Read failure')) : [row('A', 'A-old')]
    : undefined);
  await h.context.loadMessages('A');
  h.state.hasMoreMessages = true;
  await h.context.loadMoreMessages();
  await h.context.loadMoreMessages();
  assert.equal(attempts, 2);
  assert.deepEqual(Array.from(h.state.currentMessages, message => message.id), ['A-old', 'A-message']);
});

test('deleting a chat releases its prompt anchor only after successful persistence', async t => {
  const anchor = { prompt: [], historyFingerprint: [], summaryFingerprint: '', configurationFingerprint: '',
    responseSwipeIndex: 0, responseFingerprint: '', revision: 0 };
  t.after(() => { forgetPromptUsageAnchor('delete-test'); forgetPromptUsageAnchor('retained-test'); });
  rememberPromptUsageAnchor('delete-test', anchor);
  rememberPromptUsageAnchor('retained-test', anchor);
  let fail = true;
  const h = store(command => command === 'delete_chat' && fail ? Promise.reject(new Error('Disk failure')) : undefined);
  await h.context.deleteConversation('delete-test');
  assert.equal(getPromptUsageAnchor('delete-test'), anchor);
  fail = false;
  await h.context.deleteConversation('delete-test');
  assert.equal(getPromptUsageAnchor('delete-test'), undefined);
  assert.equal(getPromptUsageAnchor('retained-test'), anchor);
});
