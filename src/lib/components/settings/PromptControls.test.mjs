import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { compile, parse } from 'svelte/compiler';
import { proxy } from 'svelte/internal/client';

function component(filename) {
  const source = readFileSync(new URL(filename, import.meta.url), 'utf8');
  const tree = parse(source, { modern: true });
  const nodes = [];
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    if (value.type) nodes.push(value);
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(walk);
      else if (child && typeof child === 'object') walk(child);
    }
  }
  walk(tree.fragment);
  return { source, tree, nodes };
}

test('prompt input events update parent-owned connection fields through scalar callbacks, including clearing text', () => {
  const { source, tree, nodes } = component('./PromptControls.svelte');
  const parent = component('./GeneralSection.svelte');
  const controls = parent.nodes.find(node => node.type === 'Component' && node.name === 'PromptControls');
  assert.ok(controls);
  assert.ok(!controls.attributes.some(attribute => attribute.name === 'connection'), 'no mutable connection prop crosses into the prompt child');
  const script = source.slice(tree.instance.content.start, tree.instance.content.end);
  const ast = ts.createSourceFile('PromptControls.ts', script, ts.ScriptTarget.Latest, true);
  const handlers = ast.statements.filter(ts.isFunctionDeclaration).map(node => node.getText(ast)).join('\n');
  for (const initial of [{ systemPrompt: '', postHistoryPrompt: '' }, { systemPrompt: 'Existing', postHistoryPrompt: 'Final' }]) {
    const connection = proxy({ ...initial, temperature: 0.8 });
    const context = vm.createContext({ connection });
    for (const name of ['onSystemChange', 'onPostHistoryChange']) {
      const expression = controls.attributes.find(attribute => attribute.name === name).value.expression;
      context[name] = vm.runInContext(`(${parent.source.slice(expression.start, expression.end)})`, context);
    }
    vm.runInContext(ts.transpile(handlers, { target: ts.ScriptTarget.ES2022 }), context);
    const textareas = nodes.filter(node => node.type === 'RegularElement' && node.name === 'textarea');
    assert.equal(textareas.length, 2);
    for (const [index, field] of ['systemPrompt', 'postHistoryPrompt'].entries()) {
      const textarea = textareas[index];
      assert.ok(!textarea.attributes.some(attribute => attribute.type === 'BindDirective'), 'the child must not mutate a prop via bind:value');
      const handler = textarea.attributes.find(attribute => attribute.name === 'oninput').value.expression.name;
      for (const value of ['Plain {{text}}\nSecond line', '']) {
        context[handler]({ currentTarget: { value } });
        assert.equal(connection[field], value);
      }
    }
    assert.equal(connection.temperature, 0.8);
  }
  const { js } = compile(source, { filename: 'PromptControls.svelte', generate: 'client', dev: true });
  assert.ok(!js.code.includes('$.ownership.mutation'), 'compiled prompt control has no prop mutation to trigger ownership_invalid_mutation');
});

test('both live profile and isolated preset draft bind ownership through GeneralSection', () => {
  for (const filename of ['./ApiSection.svelte', './PresetSection.svelte']) {
    const { nodes } = component(filename);
    const forms = nodes.filter(node => node.type === 'Component' && node.name === 'GeneralSection');
    assert.equal(forms.length, 2);
    for (const form of forms) assert.ok(form.attributes.some(attribute => attribute.type === 'BindDirective' && attribute.name === 'connection'));
  }
});
