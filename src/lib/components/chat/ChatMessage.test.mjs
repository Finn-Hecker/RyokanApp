import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('clipboard fallback remains focusable in a modal after the async clipboard API fails', async () => {
  const source = readFileSync(new URL('./ChatMessage.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('ChatMessage.ts', source, ts.ScriptTarget.Latest, true);
  const copy = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name.text === 'copyMessage').getText(ast);
  let root, copied = false, removed = false, closed = 0;
  const dialog = { appendChild: () => root = 'dialog' };
  class HTMLElement { closest() { return dialog; } }
  const event = { currentTarget: new HTMLElement() };
  const context = vm.createContext({
    HTMLElement, msg: { text: 'Message to copy' }, closeMobileActions: () => closed++,
    navigator: { clipboard: { async writeText() { event.currentTarget = null; throw new Error('unavailable'); } } },
    document: {
      body: { appendChild: () => root = 'inert body' },
      createElement: () => ({ style: {}, select() { copied = root === 'dialog'; }, remove() { removed = true; } }),
      execCommand: () => copied,
    },
  });
  vm.runInContext(ts.transpile(copy, { target: ts.ScriptTarget.ES2022 }), context);
  await context.copyMessage(event);
  assert.equal(root, 'dialog');
  assert.equal(copied, true);
  assert.equal(removed, true);
  assert.equal(closed, 1);
});
