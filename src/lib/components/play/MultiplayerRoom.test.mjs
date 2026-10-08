import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function room() {
  const effects = [], closed = [], commands = [], cleared = [];
  let unlistened = 0;
  const socket = { readyState: 1, send() {}, close: code => closed.push(code) };
  const context = vm.createContext({
    appState: { currentView: 'play', activeCharacter: { name: 'host' } },
    mpState: { closedReason: '', messages: [], generating: true },
    roomMenuOpen: false, ws: socket, reconnectTimer: 7,
    activeGeneration: { id: 'generation', messageId: 'reply', buffer: 'partial', flushTimer: 8,
      unlisten: () => { unlistened++; }, aborted: false, releaseLock: false, discardPartial: false },
    WebSocket: { OPEN: 1 }, clearTimeout: id => cleared.push(id), clearInterval: id => cleared.push(id),
    invoke: async (command, args) => commands.push({ command, args }), reportDiagnostic() {},
    $effect: callback => effects.push(callback),
  });
  function evaluate(path, select) {
    let source = readFileSync(new URL(path, import.meta.url), 'utf8');
    if (path.endsWith('.svelte')) source = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
    const body = ast.statements.filter(select).map(node => node.getText(ast).replace(/^export /, '')).join('\n');
    vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  }
  evaluate('../../stores/navigation.ts', node => !ts.isImportDeclaration(node));
  evaluate('../../stores/multiplayer.svelte.ts', node => ts.isFunctionDeclaration(node)
    && ['leaveRoom', 'cancelActiveGeneration', 'cleanupGenerationResources'].includes(node.name?.text));
  evaluate('./MultiplayerRoom.svelte', node => ts.isExpressionStatement(node) && node.getText().includes('registerBackHandler'));
  context.navigateTo('multiplayerRoom');
  const cleanup = effects[0]();
  return { context, effects, cleanup, closed, commands, cleared, unlistened: () => unlistened };
}

test('room back runs the normal leave path and releases socket, reconnect and generation resources', () => {
  const h = room();
  assert.equal(h.context.handleBackNavigation(), true);
  assert.equal(h.context.appState.currentView, 'play');
  assert.equal(h.context.appState.activeCharacter, null);
  assert.equal(h.context.mpState.closedReason, 'left');
  assert.equal(h.context.ws, null);
  assert.equal(h.context.activeGeneration, null);
  assert.equal(h.context.mpState.generating, false);
  assert.deepEqual(h.closed, [1000]);
  assert.deepEqual(h.cleared, [7, 8]);
  assert.equal(h.unlistened(), 1);
  assert.equal(h.commands[0].command, 'stop_generation');
  assert.equal(h.commands[0].args.generationId, 'generation');
  h.cleanup();
});

test('room menu consumes back before leaving, even before its effect cleanup runs', () => {
  const h = room();
  h.context.roomMenuOpen = true;
  const cleanupMenu = h.effects[1]();
  h.context.handleBackNavigation();
  assert.equal(h.context.roomMenuOpen, false);
  assert.equal(h.context.appState.currentView, 'multiplayerRoom');
  assert.deepEqual(h.closed, []);
  h.context.handleBackNavigation();
  assert.equal(h.context.appState.currentView, 'play');
  assert.deepEqual(h.closed, [1000]);
  cleanupMenu();
  h.cleanup();
});

test('the room back handler is unregistered when the component is destroyed', () => {
  const h = room();
  h.cleanup();
  h.context.handleBackNavigation();
  assert.equal(h.context.appState.currentView, 'play');
  assert.deepEqual(h.closed, [], 'a disposed room cannot intercept navigation');
});
