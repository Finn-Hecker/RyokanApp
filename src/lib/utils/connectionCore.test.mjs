import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptDetectedContext, CONSERVATIVE_CONTEXT_FALLBACK, connectionIdentity, deleteConnectionSafely, deriveWorkingContextTarget, resolvedHardContextLimit } from './connectionCore.ts';

test('hard context precedence uses detection, caps it manually, and falls back conservatively', () => {
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 131072, provenance: 'provider_advertised' }, manualContextCap: null }), 131072);
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 131072, provenance: 'provider_advertised' }, manualContextCap: 16384 }), 16384);
  assert.equal(resolvedHardContextLimit({ detectedContext: null, manualContextCap: 32768 }), 32768);
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 1048576, provenance: 'theoretical' }, manualContextCap: null }), CONSERVATIVE_CONTEXT_FALLBACK);
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 0, provenance: 'runtime' }, manualContextCap: null }), CONSERVATIVE_CONTEXT_FALLBACK);
});

test('all strategies scale nonlinearly and never exceed hard context', () => {
  const limits = [8192, 32768, 131072, 524288, 1048576];
  for (const limit of limits) {
    const economy = deriveWorkingContextTarget(limit, 'economy');
    const balanced = deriveWorkingContextTarget(limit, 'balanced');
    const maximum = deriveWorkingContextTarget(limit, 'maximum');
    assert.ok(economy < balanced, `${limit}: economy < balanced`);
    assert.ok(balanced <= maximum, `${limit}: balanced <= maximum`);
    assert.ok(maximum <= limit, `${limit}: target <= hard limit`);
  }
  assert.equal(deriveWorkingContextTarget(1048576, 'maximum'), 262144);
  assert.equal(deriveWorkingContextTarget(1048576, 'balanced'), 98304);
});

test('provider or model identity changes invalidate the cache key', () => {
  const original = connectionIdentity('ollama', 'http://localhost:11434/v1', 'llama');
  assert.notEqual(original, connectionIdentity('llama_cpp', 'http://localhost:11434/v1', 'llama'));
  assert.notEqual(original, connectionIdentity('ollama', 'http://localhost:11434/v1', 'mistral'));
});

test('malformed detection never replaces a previously valid result', () => {
  const previous = { tokens: 32768, provenance: 'runtime' };
  assert.equal(acceptDetectedContext(previous, { tokens: 0, provenance: 'runtime' }), previous);
  assert.equal(acceptDetectedContext(previous, null), previous);
  assert.deepEqual(acceptDetectedContext(previous, { tokens: 65536, provenance: 'runtime' }), { tokens: 65536, provenance: 'runtime' });
});

test('deleting a non-active connection preserves active selection', () => {
  const result = deleteConnectionSafely([{ id: 'a' }, { id: 'b' }, { id: 'c' }], 'a', 'b');
  assert.deepEqual(result.connections.map(item => item.id), ['a', 'c']);
  assert.equal(result.activeId, 'a');
});

test('deleting the active connection selects an existing neighbor and never deletes the last one', () => {
  const result = deleteConnectionSafely([{ id: 'a' }, { id: 'b' }], 'a', 'a');
  assert.equal(result.activeId, 'b');
  assert.deepEqual(result.connections.map(item => item.id), ['b']);
  const last = deleteConnectionSafely([{ id: 'b' }], 'b', 'b');
  assert.equal(last.activeId, 'b');
  assert.equal(last.connections.length, 1);
});
