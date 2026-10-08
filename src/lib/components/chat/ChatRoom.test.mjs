import { snapshotTextRules } from '../../ai/prompt/textRules.ts';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function room(overrides = {}) {
  const source = readFileSync(new URL('./ChatRoom.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('ChatRoom.ts', source, ts.ScriptTarget.Latest, true);
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
  const context = vm.createContext({
    snapshotTextRules, $state: value => value, $effect() {}, onMount() {}, onDestroy() {},
    flushSync: callback => callback(), tick: async () => {},
    chatState: { activeChatId: 'chat', currentMessages: [], conversations: [] },
    summaryState: { isSummarizing: false }, appState: { activeCharacter: null },
    selectedUsage: () => null, m: new Proxy({}, { get: () => () => '' }),
    describeGenerationError: () => ({ message: 'Save failed' }),
    ...overrides,
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, run: code => vm.runInContext(code, context) };
}

test('composer growth and shrink keep the chat end visible without moving older history', () => {
  const c = room();
  const container = {
    clientHeight: 400, scrollTop: 696,
    get scrollHeight() { return 1000 + c.run('composerHeight'); },
  };
  c.context.container = container; c.run('chatContainer = container');
  c.context.handleComposerResize(150);
  assert.equal(container.scrollTop, 750);
  c.context.handleComposerResize(96);
  assert.equal(container.scrollTop, 696);
  container.scrollTop = 200;
  c.context.handleComposerResize(180);
  assert.equal(container.scrollTop, 200);
});

test('opening and switching chats scroll to the newest message after rendering', async () => {
  const effects = [];
  let render;
  const c = room({
    $effect: callback => effects.push(callback),
    tick: () => new Promise(resolve => { render = resolve; }),
  });
  const container = { clientHeight: 400, scrollHeight: 1000, scrollTop: 0 };
  c.context.container = container;
  c.run('chatContainer = container');
  assert.equal(effects[0](), undefined, 'wait for initial history loading');
  c.run('chatReady = true');
  const cleanup = effects[0]();
  assert.equal(container.scrollTop, 0);
  container.scrollHeight = 1400;
  render();
  await Promise.resolve();
  assert.equal(container.scrollTop, 1000);
  assert.equal(c.run('bottomGap'), 0);

  cleanup();
  c.context.chatState.activeChatId = 'other-chat';
  container.scrollHeight = 2200;
  effects[0]();
  render();
  await Promise.resolve();
  assert.equal(container.scrollTop, 1800);
});

test('a pending opening scroll is cancelled when the chat view is left', async () => {
  const effects = [];
  let render;
  const c = room({
    $effect: callback => effects.push(callback),
    tick: () => new Promise(resolve => { render = resolve; }),
  });
  const container = { clientHeight: 400, scrollHeight: 1400, scrollTop: 200 };
  c.context.container = container;
  c.run('chatContainer = container; chatReady = true');
  const cleanup = effects[0]();
  cleanup();
  render();
  await Promise.resolve();
  assert.equal(container.scrollTop, 200);
});

test('a failed save restores the draft and ends generating before any API request', async () => {
  const c = room({ addMessage: async () => { throw new Error('Disk error'); } });
  c.run(`inputText = ${JSON.stringify('draft\nmessage')}`);
  await c.context.sendMessage();
  assert.equal(c.run('inputText'), 'draft\nmessage');
  assert.equal(c.run('isGenerating'), false);
  assert.equal(c.run('showErrorModal'), true);
  assert.equal(c.run('pendingUserMessage'), '');
});

test('a failed save preserves a newer draft typed during persistence', async () => {
  let reject;
  const c = room({ addMessage: () => new Promise((_, fail) => { reject = fail; }) });
  c.run("inputText = 'sent message'");
  const sending = c.context.sendMessage();
  c.run("inputText = 'next draft'");
  reject(new Error('Disk error'));
  await sending;
  assert.equal(c.run('inputText'), 'next draft');
  assert.equal(c.run('isGenerating'), false);
});

test('mounting an already prepared chat keeps history and avoids a second database load', async () => {
  let mount, loads = 0;
  const c = room({
    onMount: callback => { mount = callback; },
    loadMessages: async () => { loads++; },
    getCurrentWindow: () => ({ onCloseRequested: async () => () => {} }),
    window: { addEventListener() {} },
  });
  c.context.chatState.currentMessages.push({ id: 'prepared', content: 'history' });
  await mount();
  assert.equal(loads, 0);
  assert.equal(c.context.chatState.currentMessages[0].id, 'prepared');
  assert.equal(c.run('chatReady'), true);
  c.context.chatState.currentMessages = [];
  await mount();
  assert.equal(loads, 1, 'an unprepared empty history still loads');
});

test('a successful send followed by a clone error never deletes persisted history', async () => {
  const deleted = [];
  const messages = [];
  const c = room({
    crypto: { randomUUID: () => 'generation' },
    snapshotActiveApiConnection: () => ({}),
    checkAndSummarizeIfNeeded: async () => ({ recentMessages: messages }),
    assertPreparedGenerationFits: async () => {},
    runGeneration: async () => ({ text: 'answer', usage: null, promptSnapshot: {} }),
    rememberGenerationAnchor() {}, positionSentChatMessage() {},
    addMessage: async (role, content) => { messages.push({ id: role, role, content }); },
    cloneChatFromMessage: async () => null,
    deleteMessage: async id => { deleted.push(id); },
    setTimeout: () => 1, clearTimeout() {},
  });
  c.context.chatState.currentMessages = messages;
  c.run("inputText = 'hello'");
  await c.context.sendMessage();
  assert.equal(c.run('pendingUserMessage'), '');
  await c.context.handleCloneFromMessage({ msgId: 'assistant' });
  assert.equal(c.run('showErrorModal'), true);
  await c.context.closeErrorModal();
  assert.deepEqual(deleted, []);
  assert.deepEqual(messages.map(message => message.role), ['user', 'assistant']);
});

test('closing a clone error preserves history even with a pending generation retry', async () => {
  const deleted = [];
  const c = room({ deleteMessage: async id => { deleted.push(id); } });
  c.context.chatState.currentMessages.push({ id: 'saved-user', role: 'user', content: 'hello' });
  c.run("pendingUserMessage = 'hello'; showErrorModal = true");
  await c.context.closeErrorModal();
  assert.deepEqual(deleted, []);
  assert.equal(c.context.chatState.currentMessages[0].id, 'saved-user');
  assert.equal(c.run('showErrorModal'), false);
});
