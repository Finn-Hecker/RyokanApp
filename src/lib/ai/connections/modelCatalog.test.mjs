import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function catalog(fetchModels) {
  const source = readFileSync(new URL('./modelCatalog.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('catalog.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const context = vm.createContext({ fetchModels, structuredClone });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return context;
}

test('catalog survives remounts, deduplicates pending requests and isolates consumers', async () => {
  let resolve, calls = 0;
  const c = catalog(() => { calls++; return new Promise(done => { resolve = done; }); });
  const first = c.ensureModelsLoaded('url', 'key', 'provider');
  const second = c.ensureModelsLoaded('url', 'key', 'provider');
  resolve([{ id: 'model', architecture: { inputModalities: ['text'] } }]);
  const [a, b] = await Promise.all([first, second]);
  a[0].id = 'changed'; b[0].architecture.inputModalities.push('image');
  assert.equal(c.cachedModels('url', 'key', 'provider')[0].id, 'model');
  assert.deepEqual((await c.ensureModelsLoaded('url', 'key', 'provider'))[0].architecture.inputModalities, ['text']);
  assert.equal(calls, 1);
});

test('catalog scopes credentials and providers, refreshes on retry and retries failures', async () => {
  let calls = 0, fail = false;
  const c = catalog(async () => { calls++; if (fail) throw new Error('Offline'); return [{ id: String(calls) }]; });
  await c.ensureModelsLoaded('url', 'key', 'provider');
  await c.ensureModelsLoaded('url', 'other-key', 'provider');
  await c.ensureModelsLoaded('url', 'key', 'other-provider');
  assert.equal(calls, 3);
  fail = true;
  await assert.rejects(c.ensureModelsLoaded('url', 'key', 'provider', true));
  assert.equal(c.cachedModels('url', 'key', 'provider')[0].id, '1');
  await assert.rejects(c.ensureModelsLoaded('new', 'key', 'provider'));
  fail = false;
  assert.equal((await c.ensureModelsLoaded('new', 'key', 'provider'))[0].id, '6');
});
