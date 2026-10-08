import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./CharacterContextMenu.svelte', import.meta.url), 'utf8');

function controller({ desktop = true, sheet = false, onClose = () => {} } = {}) {
  const context = vm.createContext({
    $state: value => value,
    $effect: callback => callback(),
    $props: () => ({ char: { id: 'first' }, sheet, onClose }),
    document: { body: { appendChild() {} } },
    window: { matchMedia: () => ({ matches: desktop }), innerWidth: 800, innerHeight: 600 },
  });
  const module = source.match(/<script module lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/import .*?;\s*/g, '')
    .replace('export const', 'const');
  const instance = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1]
    .replace(/import .*?;\s*/g, '')
    .replace('let menuId = $derived(String(char?.id));', "Object.defineProperty(globalThis, 'menuId', { get: () => String(char?.id) });")
    .replace('let open = $derived(activeMenuId === menuId);', "Object.defineProperty(globalThis, 'open', { get: () => activeMenuId === menuId });");
  vm.runInContext(ts.transpile(module + instance, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None }), context);
  return { context, run: code => vm.runInContext(code, context) };
}

function button() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  };
}

function rightClick(node, x = 100, y = 200) {
  const event = {
    clientX: x, clientY: y, prevented: false, stopped: false,
    preventDefault() { this.prevented = true; },
    stopPropagation() { this.stopped = true; },
  };
  node.listeners.get('contextmenu')(event);
  return event;
}

test('desktop right-click opens one menu, relocates it and leaves click handlers untouched', () => {
  const h = controller();
  const first = button();
  const second = button();
  h.context.first = first;
  h.context.second = second;
  h.run("desktopCharacterContextMenu(first, { id: 'first', enabled: true }); desktopCharacterContextMenu(second, { id: 'second', enabled: true })");
  const event = rightClick(first);
  assert.equal(event.prevented, true);
  assert.equal(event.stopped, true);
  assert.equal(h.run('open'), true);
  assert.deepEqual([...first.listeners.keys()], ['contextmenu']);
  rightClick(second, 300, 400);
  assert.equal(h.run('activeMenuId'), 'second');
  assert.equal(h.run('open'), false);
  assert.equal(h.run('menuPosition.x'), 300);
  rightClick(second, 350, 450);
  assert.equal(h.run('activeMenuId'), 'second');
  assert.equal(h.run('menuPosition.y'), 450);
});

test('mobile and disabled cards retain their existing interaction', () => {
  for (const options of [{ desktop: false, enabled: true }, { desktop: true, enabled: false }]) {
    const h = controller(options);
    h.context.node = button();
    h.context.enabled = options.enabled;
    h.run("desktopCharacterContextMenu(node, { id: 'first', enabled })");
    assert.equal(rightClick(h.context.node).prevented, false);
    assert.equal(h.run('activeMenuId'), null);
  }
});

test('updating and removing a card close its active menu and release the listener', () => {
  const h = controller();
  h.context.node = button();
  h.run("const action = desktopCharacterContextMenu(node, { id: 'first', enabled: true })");
  rightClick(h.context.node);
  h.run("action.update({ id: 'first', enabled: false })");
  assert.equal(h.run('activeMenuId'), null);
  h.run("action.update({ id: 'first', enabled: true })");
  rightClick(h.context.node);
  h.run('action.destroy()');
  assert.equal(h.run('activeMenuId'), null);
  assert.equal(h.context.node.listeners.size, 0);
});

test('menu placement stays within the viewport at its edges', () => {
  const h = controller();
  h.context.menu = { style: {}, getBoundingClientRect: () => ({ width: 176, height: 240 }) };
  h.run('menuPosition = { x: 799, y: 599 }; positionMenu(menu)');
  assert.deepEqual(h.context.menu.style, { left: '616px', top: '352px', visibility: 'visible' });
  h.run('menuPosition = { x: 0, y: 0 }; positionMenu(menu)');
  assert.deepEqual(h.context.menu.style, { left: '8px', top: '8px', visibility: 'visible' });
});

test('desktop menu escapes card transforms and is removed on teardown; mobile stays in its sheet', () => {
  for (const sheet of [false, true]) {
    const h = controller({ sheet });
    let mounted = 0;
    let removed = 0;
    h.context.document.body.appendChild = () => mounted++;
    h.context.menu = {
      style: {}, remove: () => removed++,
      getBoundingClientRect: () => ({ width: 176, height: 240 }),
    };
    h.run('const placement = positionMenu(menu)');
    assert.equal(mounted, sheet ? 0 : 1);
    assert.equal(h.context.menu.style.visibility, sheet ? undefined : 'visible');
    h.run('placement.destroy()');
    assert.equal(removed, sheet ? 0 : 1);
  }
});

test('desktop actions close before execution and mobile sheet actions remain deferred', () => {
  const h = controller();
  let calls = 0;
  h.context.actionCallback = (event, char) => {
    assert.equal(h.run('activeMenuId'), null);
    assert.equal(char.id, 'first');
    calls++;
  };
  h.run("activeMenuId = 'first'; runAction({}, actionCallback)");
  assert.equal(calls, 1);
  let deferred;
  const mobile = controller({ sheet: true, onClose: after => { deferred = after; } });
  mobile.context.actionCallback = () => calls++;
  mobile.run('runAction({}, actionCallback)');
  assert.equal(calls, 1);
  deferred();
  assert.equal(calls, 2);
});
