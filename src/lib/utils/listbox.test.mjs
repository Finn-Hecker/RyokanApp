import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import vm from 'node:vm';

// Run the production controller with only Svelte's lifecycle/state boundary replaced.
const source = ts.transpileModule(await readFile(new URL('./listbox.svelte.ts', import.meta.url), 'utf8'), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText.replace(/import .* from 'svelte';/, '').replace('export function', 'function');

function setup(modal = null) {
  const events = () => ({
    listeners: new Map(),
    addEventListener(type, callback) { this.listeners.set(type, callback); },
    removeEventListener(type, callback) { assert.equal(this.listeners.get(type), callback); this.listeners.delete(type); },
  });
  const query = { matches: false, ...events() };
  const viewport = { offsetLeft: 20, offsetTop: 30, width: 800, height: 600, ...events() };
  const window = { matchMedia: () => query, visualViewport: viewport, ...events() };
  let mount, cleanup, focused, attached;
  const context = vm.createContext({
    window, document: { body: { appendChild(node) { attached = node; } } },
    $state: value => value, tick: async () => {}, onMount: callback => { mount = callback; },
  });
  vm.runInContext(`${source}\nglobalThis.createListbox = createListbox;`, context);
  const trigger = { closest: () => modal, focus: () => { focused = 'trigger'; }, getBoundingClientRect: () => ({ left: 750, top: 500, bottom: 540, width: 180 }) };
  const buttons = [0, 1, 2].map(index => ({ focus: () => { focused = index; } }));
  const listbox = context.createListbox({
    trigger: () => trigger, optionCount: () => buttons.length,
    optionList: () => ({ querySelector: () => buttons[1], querySelectorAll: () => buttons }),
  });
  cleanup = mount();
  return { listbox, query, viewport, window, cleanup, get focused() { return focused; }, get attached() { return attached; } };
}

const key = value => ({ key: value, preventDefault() { this.prevented = true; } });

test('listbox preserves selected focus, wrapping navigation and Escape focus restoration', async () => {
  const h = setup();
  const event = key('ArrowDown');
  h.listbox.handleTriggerKeydown(event);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(event.prevented, true);
  assert.equal(h.listbox.open, true);
  assert.equal(h.focused, 1);
  h.listbox.handleOptionKeydown(key('ArrowDown'), 2);
  assert.equal(h.focused, 0);
  h.listbox.handleOptionKeydown(key('ArrowUp'), 0);
  assert.equal(h.focused, 2);
  h.listbox.handleOptionKeydown(key('Home'), 1);
  assert.equal(h.focused, 0);
  h.listbox.handleOptionKeydown(key('End'), 1);
  assert.equal(h.focused, 2);
  h.listbox.handleOptionKeydown(key('Escape'), 2);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.listbox.open, false);
  assert.equal(h.focused, 'trigger');
  h.listbox.toggle({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  h.listbox.handleWindowKeydown(key('Escape'));
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.listbox.open, false);
  assert.equal(h.focused, 'trigger');
  h.cleanup();
});

test('listbox places desktop popups within the visual viewport and releases portal/listeners', async () => {
  const h = setup();
  h.listbox.toggle({ stopPropagation() {} });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.listbox.popupStyle, 'left:588px;top:347px;width:220px');
  h.viewport.height = 1000;
  h.viewport.listeners.get('resize')();
  assert.equal(h.listbox.popupStyle, 'left:588px;top:547px;width:220px');
  h.query.matches = true;
  h.query.listeners.get('change')();
  assert.equal(h.listbox.mobile, true);
  let removed = false;
  const node = { remove() { removed = true; } };
  const portal = h.listbox.portal(node);
  assert.equal(h.attached, node);
  portal.destroy();
  assert.equal(removed, true);
  h.cleanup();
  for (const target of [h.query, h.viewport, h.window]) assert.equal(target.listeners.size, 0);
});


test('desktop listboxes inside a sheet stay in the native dialog layer', () => {
  let attached;
  const modal = { appendChild(node) { attached = node; } };
  const h = setup(modal);
  let removed = false;
  const node = { remove() { removed = true; } };
  const portal = h.listbox.portal(node);
  assert.equal(attached, node);
  assert.equal(h.attached, undefined, 'it must not be placed behind the modal at document.body');
  portal.destroy(); assert.equal(removed, true);
});
