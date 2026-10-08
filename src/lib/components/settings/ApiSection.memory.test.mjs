import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'svelte/compiler';
import { CONSERVATIVE_CONTEXT_FALLBACK, resolvedHardContextLimit } from '../../ai/connections/connectionCore.ts';

const source = readFileSync(new URL('./ApiSection.svelte', import.meta.url), 'utf8');
const nodes = [];
function walk(value) {
  if (!value || typeof value !== 'object') return;
  if (value.type) nodes.push(value);
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) child.forEach(walk);
    else if (child && typeof child === 'object') walk(child);
  }
}
walk(parse(source, { modern: true }).fragment);
const attribute = (node, name) => node.attributes.find(item => item.name === name);
const attributeExpression = (node, name) => {
  const item = attribute(node, name);
  return item?.expression ?? item?.value?.expression ?? item?.value?.[0]?.expression;
};
const manualInput = nodes.find(node => node.type === 'RegularElement' && node.name === 'input'
  && attributeExpression(node, 'value')?.left?.property?.name === 'manualContextCap');
const manualSwitch = nodes.find(node => node.type === 'RegularElement' && node.name === 'input'
  && attributeExpression(node, 'checked')?.left?.property?.name === 'manualContextCap');
const strategy = nodes.find(node => node.type === 'Component' && node.name === 'Select'
  && attributeExpression(node, 'value')?.property?.name === 'contextStrategy');

test('clearing the manual limit keeps its switch and strategy lock active until explicitly switched off', () => {
  assert.ok(manualInput && manualSwitch && strategy);
  const connection = { manualContextCap: 8192, contextLimit: 8192, detectedContext: null, contextStrategy: 'economy' };
  const context = vm.createContext({ appState: { apiSettings: connection }, resolvedHardContextLimit, CONSERVATIVE_CONTEXT_FALLBACK });
  function expression(node, name) {
    const ast = attributeExpression(node, name);
    return vm.runInContext(`(${source.slice(ast.start, ast.end)})`, context);
  }
  const input = expression(manualInput, 'oninput');
  input({ currentTarget: { value: '', valueAsNumber: NaN } });
  assert.equal(connection.manualContextCap, 8192);
  assert.equal(connection.contextLimit, 8192);
  assert.equal(expression(manualSwitch, 'checked'), true);
  assert.equal(expression(strategy, 'disabled'), true);
  input({ currentTarget: { value: '16384', valueAsNumber: 16384 } });
  assert.equal(connection.manualContextCap, 16384);
  assert.equal(connection.contextLimit, 16384);
  expression(manualSwitch, 'onchange')({ currentTarget: { checked: false } });
  assert.equal(connection.manualContextCap, null);
  assert.equal(expression(strategy, 'disabled'), false);
  assert.equal(connection.contextStrategy, 'economy');
});
