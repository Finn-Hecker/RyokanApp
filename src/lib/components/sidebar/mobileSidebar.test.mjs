import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Exercise the component controllers with deterministic DOM, lifecycle and IPC
// boundaries. Derived getters stay live as shared drag previews change state.
function controller(filename, globals = {}) {
  const source = readFileSync(new URL(filename, import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile(filename + '.ts', source, ts.ScriptTarget.Latest, true);
  const statements = ast.statements.map(statement => {
    if (ts.isImportDeclaration(statement)) return '';
    if (ts.isVariableStatement(statement)) {
      const declaration = statement.declarationList.declarations[0];
      if (declaration.initializer && ts.isCallExpression(declaration.initializer)
        && declaration.initializer.expression.getText(ast) === '$derived') {
        return `Object.defineProperty(globalThis, '${declaration.name.getText(ast)}', { get: () => (${declaration.initializer.arguments[0].getText(ast)}) });`;
      }
    }
    return statement.getText(ast).replace(/^export /, '');
  }).join('\n');
  const timers = new Map();
  let nextTimer = 0;
  const context = vm.createContext({
    console, $state: value => value, $props: () => ({ isOpen: true, mode: 'singleplayer', interactionMode: 'mobile' }),
    $effect: () => {}, onMount: () => {}, onDestroy: () => {},
    setTimeout: (callback, delay) => { const id = ++nextTimer; timers.set(id, { callback, delay }); return id; },
    clearTimeout: id => timers.delete(id), cancelAnimationFrame: () => {}, requestAnimationFrame: () => 1,
    m: new Proxy({}, { get: () => () => '' }), ...globals,
  });
  vm.runInContext(ts.transpile(statements, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), context);
  return {
    context,
    run: code => vm.runInContext(code, context),
    longPress() {
      for (const [id, timer] of timers) if (timer.delay === 525) { timers.delete(id); timer.callback(); }
    },
  };
}

function element(type, id, parent = null) {
  const listeners = new Map();
  return {
    dataset: type === 'chat' ? { chatId: id } : type === 'folder' ? { folderId: id } : {},
    style: { removeProperty() {} }, listeners,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
    closest(selector) {
      if (type === 'chat' && selector.includes('[data-chat-row]')) return this;
      if (type === 'folder' && (selector.includes('[data-folder-row]') || selector.includes('[data-folder-section]'))) return this;
      if (type === 'loose' && selector === '[data-loose-chats]') return this;
      if (selector === '[data-sidebar-list]') return list;
      return parent?.closest(selector) ?? null;
    },
    getBoundingClientRect: () => ({ top: 0, left: 0, bottom: 54, height: 54, width: 280 }),
  };
}
const list = {
  contains: target => target !== outside,
  getBoundingClientRect: () => ({ top: 0, bottom: 800 }),
  // Simulate the reconciliation frame after a cross-folder preview.
  querySelectorAll: () => [],
};
const outside = element('outside');
function mobile(type = 'chat') {
  const calls = [];
  let captured = false;
  const root = {
    ...element('root'),
    setPointerCapture() { captured = true; calls.push(['capture']); },
    hasPointerCapture: () => captured,
    releasePointerCapture() { captured = false; },
  };
  const sidebar = new Proxy({}, { get: (_, name) => (...args) => calls.push([name, ...args]) });
  const document = element('document');
  const harness = controller('./MobileSidebar.svelte', { handle: sidebar, root, document });
  harness.run('sidebar = handle; gestureRoot = root; touchGestures(root);');
  const row = element(type, 'a');
  const dispatch = (name, x = 100, y = 100, overrides = {}) => {
    const touch = { identifier: 1, clientX: x, clientY: y };
    const event = { target: row, cancelable: true, touches: [touch], changedTouches: [touch], preventDefault() { this.prevented = true; }, ...overrides };
    const names = { handlePointerDown: 'touchstart', handlePointerMove: 'touchmove', handlePointerUp: 'touchend', handlePointerCancel: 'touchcancel' };
    (name === 'handlePointerDown' ? root : document).listeners.get(names[name])(event);
    return event;
  };
  return { ...harness, calls, row, dispatch, document };
}

for (const type of ['chat', 'folder']) {
  test(`${type}: swipe opens shared actions, never starts a drag`, () => {
    const h = mobile(type);
    h.dispatch('handlePointerDown');
    h.dispatch('handlePointerMove', 45, 102);
    h.longPress();
    h.dispatch('handlePointerUp', 45, 102);
    assert.deepEqual(h.calls.filter(call => call[0] === 'openMobileActions'), [['openMobileActions', type, 'a']]);
    assert.equal(h.calls.some(call => call[0] === 'beginMobileDrag'), false);
    assert.equal(h.row.listeners.has('touchmove'), false);
  });
  test(`${type}: tap, scroll, short swipe, right swipe and cancellation never open actions`, () => {
    for (const move of [null, [101, 140], [75, 100], [160, 100], 'cancel']) {
      const h = mobile(type);
      h.dispatch('handlePointerDown');
      if (Array.isArray(move)) h.dispatch('handlePointerMove', ...move);
      h.dispatch(move === 'cancel' ? 'handlePointerCancel' : 'handlePointerUp');
      h.longPress();
      assert.equal(h.calls.some(call => ['openMobileActions', 'beginMobileDrag', 'completeMobileDrag'].includes(call[0])), false);
      if (move === null) assert.equal(h.calls.some(call => call[0] === 'suppressMobileActivation'), false);
    }
  });
}

test('touch long press prevents native scroll, completes once and blocks another drag during save', async () => {
  const h = mobile();
  h.dispatch('handlePointerDown');
  assert.equal(h.dispatch('handlePointerMove').prevented, undefined);
  h.longPress();
  assert.equal(h.calls.some(call => call[0] === 'capture'), false);
  assert.equal(h.dispatch('handlePointerMove', 90, 300).prevented, true);
  h.dispatch('handlePointerUp', 90, 300);
  h.dispatch('handlePointerDown');
  h.longPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.filter(call => call[0] === 'beginMobileDrag').length, 1);
  assert.deepEqual(h.calls.filter(call => call[0] === 'completeMobileDrag'), [['completeMobileDrag', 90, 300]]);
  assert.equal(h.calls.some(call => call[0] === 'openMobileActions'), false);
});

test('cancelled long press never persists', () => {
  const h = mobile();
  h.dispatch('handlePointerDown');
  h.longPress();
  h.dispatch('handlePointerCancel');
  h.dispatch('handlePointerUp');
  assert.equal(h.calls.some(call => call[0] === 'completeMobileDrag'), false);
  assert.equal(h.row.listeners.has('touchmove'), false);
});

for (const destination of ['folder', 'folder-chat', 'loose', 'loose-chat', 'outside']) {
  test(`mobile drop onto ${destination} uses shared persistence`, async () => {
    const sourceFolder = destination.startsWith('loose') ? 'f' : null;
    const chatState = {
      folders: [{ id: 'f', mode: 'singleplayer', chat_count: sourceFolder ? 1 : 0 }],
      conversations: [
        { id: 'a', mode: 'singleplayer', folder_id: sourceFolder, updated_at: '2026-09-22', created_at: '2026-09-22' },
        { id: 'b', mode: 'singleplayer', folder_id: destination === 'folder-chat' ? 'f' : null, updated_at: '2026-09-21', created_at: '2026-09-21' },
      ],
    };
    const target = destination === 'outside' ? outside : destination.endsWith('-chat')
      ? element('chat', 'b') : element(destination, 'f');
    const saves = [];
    const h = controller('./SidebarBase.svelte', {
      chatState, source: element('chat', 'a'),
      document: { elementFromPoint: () => target },
      persistSidebarOrganization: async mode => saves.push({ mode, folderId: chatState.conversations.find(chat => chat.id === 'a').folder_id }),
    });
    h.run("beginMobileDrag(source, 'chat', 'a', 27); updateMobileDrag(100, 27);");
    // Preview must not reparent the original row or move the drop zones.
    assert.equal(h.run("renderedFolderId(chatState.conversations[0])"), sourceFolder);
    assert.equal(h.run('renderedConversations'), chatState.conversations);
    if (destination === 'folder') assert.equal(h.run("displayedFolderCount('f', 0, true)"), 1);
    if (destination === 'loose') assert.equal(h.run("displayedFolderCount('f', 1, true)"), 0);
    await h.run('completeMobileDrag(100, 27)');
    assert.deepEqual(saves, destination === 'outside' ? [] : [{ mode: 'singleplayer', folderId: destination.startsWith('loose') ? null : 'f' }]);
    assert.equal(h.run('dragging'), null);
  });
}

test('a second finger cancels a drag without saving', async () => {
  const h = mobile();
  h.dispatch('handlePointerDown');
  h.longPress();
  h.document.listeners.get('touchstart')({ touches: [{ identifier: 1 }, { identifier: 2 }] });
  h.dispatch('handlePointerUp');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.some(call => call[0] === 'completeMobileDrag'), false);
});

test('document touch events finish the drag even when the finger leaves its original row', async () => {
  const h = mobile();
  h.dispatch('handlePointerDown');
  h.longPress();
  h.dispatch('handlePointerMove', 100, 400, { target: outside });
  h.dispatch('handlePointerUp', 100, 400, { target: outside });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.calls.filter(call => call[0] === 'completeMobileDrag'), [['completeMobileDrag', 100, 400]]);
});

test('native scrolling that already won cancels the long press instead of saving', async () => {
  const h = mobile();
  h.dispatch('handlePointerDown');
  h.longPress();
  h.dispatch('handlePointerMove', 100, 400, { cancelable: false });
  h.dispatch('handlePointerUp', 100, 400);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.calls.some(call => call[0] === 'completeMobileDrag'), false);
});

test('a small gap beside a drop section is accepted without accepting drops outside the list', async () => {
  const folder = element('folder', 'f');
  folder.getBoundingClientRect = () => ({ top: 100, bottom: 154, left: 0, right: 280, height: 54 });
  const previousQuery = list.querySelectorAll;
  list.querySelectorAll = () => [folder];
  try {
    const chatState = {
      folders: [{ id: 'f', mode: 'singleplayer', chat_count: 0 }],
      conversations: [{ id: 'a', mode: 'singleplayer', folder_id: null }],
    };
    let saves = 0;
    const h = controller('./SidebarBase.svelte', {
      chatState, source: element('chat', 'a'),
      document: { elementFromPoint: () => element('gap') },
      persistSidebarOrganization: async () => { saves++; },
    });
    h.run("beginMobileDrag(source, 'chat', 'a', 27); updateMobileDrag(100, 94);");
    await h.run('completeMobileDrag(100, 94)');
    assert.equal(saves, 1);
    assert.equal(chatState.conversations[0].folder_id, 'f');
  } finally {
    list.querySelectorAll = previousQuery;
  }
});
