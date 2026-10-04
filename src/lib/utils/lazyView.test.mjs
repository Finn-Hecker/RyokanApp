import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createLazyView } from './lazyView.ts';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

test('imports only on demand, shares in-flight requests and caches the component', async () => {
  const module = deferred();
  const Component = () => {};
  let calls = 0;
  const view = createLazyView(() => { calls++; return module.promise; });
  assert.equal(calls, 0);
  assert.equal(view.component, undefined);
  const first = view.load();
  assert.equal(view.load(), first);
  assert.equal(calls, 1);
  module.resolve({ default: Component });
  assert.equal(await first, Component);
  assert.equal(view.component, Component);
  assert.equal(await view.load(), Component);
  assert.equal(calls, 1);
});

test('failed imports are retryable without poisoning the cache', async () => {
  const Component = () => {};
  let calls = 0;
  const view = createLazyView(async () => {
    if (++calls === 1) throw new Error('offline');
    return { default: Component };
  });
  await assert.rejects(view.load(), /offline/);
  assert.equal(view.component, undefined);
  assert.equal(await view.load(), Component);
  assert.equal(calls, 2);
});

// Exercise the real Svelte controller with controlled effect cleanup and imports.
function controller(view) {
  const source = readFileSync(new URL('../components/LazyView.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('LazyView.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(s => !ts.isImportDeclaration(s)).map(s => s.getText(ast)).join('\n');
  let effect;
  const diagnostics = [];
  const state = value => value;
  state.raw = state;
  const context = vm.createContext({
    $props: () => ({ view }), $state: state, untrack: callback => callback(),
    $effect: callback => { effect = callback; },
    reportDiagnostic: area => diagnostics.push(area),
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { run: () => effect(), get: expression => vm.runInContext(expression, context), diagnostics };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

test('leaving during an import never mounts a stale view, but preserves its code cache', async () => {
  const module = deferred();
  const Component = () => {};
  const view = createLazyView(() => module.promise);
  const first = controller(view);
  const cleanup = first.run();
  cleanup();
  module.resolve({ default: Component });
  await flush();
  assert.equal(first.get('View'), undefined);
  const returning = controller(view);
  assert.equal(returning.get('View'), Component);
  returning.run();
  assert.equal(returning.get('View'), Component);
});

test('visible failures report diagnostics and retry clears the loading error', async () => {
  let calls = 0;
  const Component = () => {};
  const view = createLazyView(async () => {
    if (++calls === 1) throw new Error('offline');
    return { default: Component };
  });
  const c = controller(view);
  const cleanup = c.run();
  await flush();
  assert.equal(c.get('failed'), true);
  assert.deepEqual(c.diagnostics, ['runtime']);
  cleanup();
  c.get('attempt += 1');
  c.run();
  assert.equal(c.get('failed'), false);
  await flush();
  assert.equal(c.get('View'), Component);
});

test('a rejected import after leaving does not update the disposed view', async () => {
  const module = deferred();
  const c = controller(createLazyView(() => module.promise));
  c.run()();
  module.reject(new Error('offline'));
  await flush();
  assert.equal(c.get('failed'), false);
  assert.deepEqual(c.diagnostics, []);
});
