import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { compile } from 'svelte/compiler';

const source = readFileSync(new URL('./PageLayout.svelte', import.meta.url), 'utf8');
function layout(wide) {
  const ast = ts.createSourceFile('layout.ts', source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1], ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
    .map(statement => statement.getText(ast)).join('\n');
  const timers = new Map();
  let mount, destroyed, change;
  const context = vm.createContext({
    $state: value => value, $props: () => ({ pageTitle: 'Test', showSidebar: true }), $effect() {},
    onMount: callback => { mount = callback; }, onDestroy: callback => { destroyed = callback; },
    window: { matchMedia: () => ({ matches: wide, addEventListener: (_, callback) => { change = callback; }, removeEventListener() {} }) },
    setTimeout: callback => { timers.set(1, callback); return 1; }, clearTimeout: id => timers.delete(id), tick: async () => {},
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  mount();
  return { context, timers, read: expression => vm.runInContext(expression, context), change: () => change(), destroy: () => destroyed() };
}

test('drawer closing retains its component and hides it only after settling; reopening cancels that hide', async () => {
  const h = layout(false);
  await h.context.openSidebar();
  h.context.closeSidebar();
  assert.equal(h.read('isMobileSidebarOpen'), false);
  assert.equal(h.read('isMobileSidebarVisible'), true);
  await h.context.openSidebar();
  assert.equal(h.timers.size, 0);
  assert.equal(h.read('sidebarProgress'), 1);
  h.context.closeSidebar(); h.timers.get(1)();
  assert.equal(h.read('isMobileSidebarVisible'), false);
  assert.equal(h.read('wideLayout'), false);
});

test('layout compiles with one responsive sidebar branch and an inert retained drawer', () => {
  const ast = compile(source, { generate: 'client', modernAst: true }).ast;
  const shell = ast.fragment.nodes.find(node => node.type === 'RegularElement' && node.name === 'div');
  const sidebar = shell.fragment.nodes.find(node => node.type === 'IfBlock');
  const responsive = sidebar.consequent.nodes.find(node => node.type === 'IfBlock');
  assert.equal(responsive.test.name, 'wideLayout');
  assert.ok(responsive.alternate);
  assert.ok(!responsive.alternate.nodes.some(node => node.type === 'RegularElement' && node.name === 'button'),
    'no fixed backdrop outside the hidden/inert drawer layer can intercept page clicks');
  const drawer = responsive.alternate.nodes.find(node => node.type === 'RegularElement' && node.name === 'div');
  assert.ok(drawer.attributes.some(attribute => attribute.name === 'inert'));
  assert.ok(drawer.fragment.nodes.some(node => node.type === 'RenderTag'));
});
