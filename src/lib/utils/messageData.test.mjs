import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeMessage } from './messageData.ts';
import { selectedUsage } from './tokenUsage.ts';

test('persisted swipe content and usage decode together without changing the IPC row', () => {
  const usage = [{ inputTokens: 100 }, null, { inputTokens: 300, serviceTier: 'flex' }];
  const row = {
    id: 'reply', conversation_id: 'chat', role: 'assistant', content: 'third', author: null,
    swipe_variants: JSON.stringify(['first', 'second', 'third']), swipe_index: 2,
    usage_variants: JSON.stringify(usage),
  };
  const decoded = decodeMessage(row);
  assert.deepEqual(decoded.swipe_variants, ['first', 'second', 'third']);
  assert.deepEqual(decoded.usage_variants, usage);
  assert.deepEqual(selectedUsage(decoded), usage[2]);
  assert.equal(selectedUsage({ ...decoded, swipe_index: 1 }), null);
  assert.equal(typeof row.swipe_variants, 'string');
  assert.equal(decoded.author, null);
});

test('legacy message defaults preserve content, explicit empty variants and invalid-JSON failures', () => {
  const row = { conversation_id: 'chat', role: 'user', content: 'hello' };
  assert.deepEqual(decodeMessage(row), { ...row, swipe_variants: ['hello'], swipe_index: 0, usage_variants: [] });
  assert.deepEqual(decodeMessage({ ...row, swipe_variants: [], usage_variants: [], swipe_index: 0 }).swipe_variants, []);
  assert.throws(() => decodeMessage({ ...row, swipe_variants: '[' }), SyntaxError);
  assert.throws(() => decodeMessage({ ...row, usage_variants: '[' }), SyntaxError);
});
