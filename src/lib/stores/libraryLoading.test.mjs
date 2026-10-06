import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function store(filename, globals) {
  const ast = ts.createSourceFile(filename, readFileSync(new URL(filename, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const context = vm.createContext({ $state: value => value, reportDiagnostic() {}, ...globals });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, read: expression => vm.runInContext(expression, context) };
}

test('World Info readiness shares the startup request, caches success and explicit refresh stays fresh', async () => {
  let finish, calls = 0;
  const c = store('./worldInfoStore.svelte.ts', { DEFAULT_WORLD_INFOS: [], invoke: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = c.context.loadWorldInfos();
  assert.equal(c.context.ensureWorldInfosLoaded(), first);
  assert.equal(c.context.loadWorldInfos(), first);
  finish([{ id: 'first', entries: [] }]); await first;
  const state = c.read('worldInfoState');
  const entries = state.allWorldInfos;
  await c.context.ensureWorldInfosLoaded();
  assert.equal(calls, 1);
  assert.equal(state.allWorldInfos, entries);
  const refresh = c.context.loadWorldInfos();
  assert.equal(c.context.ensureWorldInfosLoaded(), refresh);
  finish([{ id: 'updated', entries: [] }]); await refresh;
  assert.equal(calls, 2);
  assert.equal(state.allWorldInfos[0].id, 'updated');
});

test('World Info failure does not poison readiness or discard the previous library', async () => {
  let fail = true, calls = 0;
  const c = store('./worldInfoStore.svelte.ts', { DEFAULT_WORLD_INFOS: [{ id: 'bundled' }], invoke: async () => {
    calls++; if (fail) throw new Error('Database error'); return [{ id: 'custom' }];
  } });
  await c.context.ensureWorldInfosLoaded();
  assert.equal(c.read('worldInfoState.allWorldInfos.length'), 1);
  fail = false;
  await c.context.ensureWorldInfosLoaded();
  assert.equal(calls, 2);
  assert.equal(c.read('worldInfoState.allWorldInfos.length'), 2);
});

test('role hydration waits for the default selection, avoids remount IPC and explicit loads still refresh', async () => {
  let finish, calls = 0, settingCalls = 0;
  const c = store('./roleStore.svelte.ts', {
    invoke: async () => { calls++; return [{ id: 'role', name: 'Player' }]; },
    getSetting: () => { settingCalls++; return new Promise(resolve => { finish = resolve; }); },
  });
  const first = c.context.ensureRolesLoaded();
  assert.equal(c.context.ensureRolesLoaded(), first);
  finish('role'); await first;
  assert.equal(c.read('roleState.defaultRoleId'), 'role');
  await c.context.ensureRolesLoaded();
  assert.equal(calls, 1); assert.equal(settingCalls, 1);
  const refresh = c.context.loadRoles(); finish('missing'); await refresh;
  assert.equal(c.read('roleState.defaultRoleId'), null);
  assert.equal(calls, 2);
});

test('failed role hydration propagates and can be retried', async () => {
  let fail = true;
  const c = store('./roleStore.svelte.ts', { invoke: async () => {
    if (fail) throw new Error('Database error'); return [];
  }, getSetting: async () => null });
  await assert.rejects(c.context.ensureRolesLoaded(), /Database error/);
  fail = false;
  await c.context.ensureRolesLoaded();
});
