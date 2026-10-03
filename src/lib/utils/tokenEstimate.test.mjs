import assert from 'node:assert/strict';
import test from 'node:test';
import { estimateTokens, estimateBudgetTokens } from './tokenEstimate.ts';
import { countCoreCharacterTokens } from './tokenCount.ts';

test('empty editor values and empty budgets consume no text tokens', () => {
  for (const text of ['', null, undefined]) {
    assert.equal(estimateTokens(text), 0);
    assert.equal(estimateBudgetTokens(text), 0);
  }
  assert.equal(countCoreCharacterTokens({}), 0);
});

test('planning adds allowance for prose, Unicode, code and numeric inputs', () => {
  for (const text of ['A quiet garden.', 'Grüße aus Köln', '日本語の会話🙂',
    'const value = { nested: [1, 2, 3] };', '12345678901234567890 '.repeat(100)]) {
    assert.ok(estimateTokens(text) > 0);
    assert.ok(estimateBudgetTokens(text) > estimateTokens(text));
  }
  // Regression: UTF-16 length / 4 severely undercounts non-Latin text.
  assert.ok(estimateTokens('日本語🙂'.repeat(100)) > Math.ceil('日本語🙂'.repeat(100).length / 4));
  // Numeric runs need a different ratio from prose; 3.35 bytes/token undercounts them.
  assert.ok(estimateTokens('12345678901234567890 '.repeat(100)) >= 700);
});
