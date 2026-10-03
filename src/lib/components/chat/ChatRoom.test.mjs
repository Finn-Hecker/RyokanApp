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
    $state: value => value, $effect() {}, onMount() {}, onDestroy() {},
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
