import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('./Tooltip.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
const ast = ts.createSourceFile('Tooltip.ts', source, ts.ScriptTarget.Latest, true);
const portal = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'portal').getText(ast);

for (const modal of [false, true]) {
  test(`tooltips use the ${modal ? 'native dialog' : 'document'} layer and clean up`, () => {
    const attached = [];
    const body = { appendChild: node => attached.push(['body', node]) };
    const dialog = { appendChild: node => attached.push(['dialog', node]) };
    const context = vm.createContext({ document: { body } });
    vm.runInContext(ts.transpile(portal, { target: ts.ScriptTarget.ES2022 }), context);
    let removed = false;
    const node = { closest: selector => { assert.equal(selector, 'dialog'); return modal ? dialog : null; }, remove: () => removed = true };
    const action = context.portal(node);
    assert.deepEqual(attached, [[modal ? 'dialog' : 'body', node]]);
    action.destroy();
    assert.equal(removed, true);
  });
}
