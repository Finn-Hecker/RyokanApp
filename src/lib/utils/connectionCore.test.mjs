import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptDetectedContext, adaptiveSummaryOutputCap, CONSERVATIVE_CONTEXT_FALLBACK, connectionIdentity, deleteConnectionSafely, deriveWorkingContextTarget, normalizeSummaryConnectionId, resolveMemorySettings, resolveSummaryConnection, resolvedHardContextLimit, resolvedWorkingContextTarget, SAME_AS_CHAT_CONNECTION, shouldTriggerSummary, summaryCompressionGoal } from './connectionCore.ts';

test('hard context precedence uses detection, caps it manually, and falls back conservatively', () => {
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 131072, provenance: 'provider_advertised' }, manualContextCap: null }), 131072);
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 131072, provenance: 'provider_advertised' }, manualContextCap: 16384 }), 16384);
  assert.equal(resolvedHardContextLimit({ detectedContext: null, manualContextCap: 32768 }), 32768);
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 1048576, provenance: 'theoretical' }, manualContextCap: null }), CONSERVATIVE_CONTEXT_FALLBACK);
  assert.equal(resolvedHardContextLimit({ detectedContext: { tokens: 0, provenance: 'runtime' }, manualContextCap: null }), CONSERVATIVE_CONTEXT_FALLBACK);
});

test('cost strategies remain bounded while Maximum uses the full request window', () => {
  const limits = [1024, 4096, 8192, 16384, 32768, 131072, 524288, 1048576];
  for (const limit of limits) {
    const economy = deriveWorkingContextTarget(limit, 'economy');
    const balanced = deriveWorkingContextTarget(limit, 'balanced');
    const maximum = deriveWorkingContextTarget(limit, 'maximum');
    assert.ok(economy <= balanced, `${limit}: economy <= balanced`);
    assert.ok(balanced <= maximum, `${limit}: balanced <= maximum`);
    assert.equal(maximum, limit, `${limit}: Maximum includes the full request window`);
  }
  assert.equal(deriveWorkingContextTarget(1048576, 'maximum'), 1048576);
  assert.equal(deriveWorkingContextTarget(1048576, 'balanced'), 98304);
});

test('shared displayed/runtime working budget reacts to strategy, manual cap, and model detection', () => {
  const connection = { detectedContext: { tokens: 524288, provenance: 'runtime' }, manualContextCap: null, contextStrategy: 'economy' };
  assert.equal(resolvedWorkingContextTarget(connection), 32768);
  connection.contextStrategy = 'balanced';
  assert.equal(resolvedWorkingContextTarget(connection), 82944);
  connection.contextStrategy = 'maximum';
  assert.equal(resolvedWorkingContextTarget(connection), 524288);
  assert.equal(connection.detectedContext.tokens, 524288);
  connection.manualContextCap = 8192;
  assert.equal(resolvedWorkingContextTarget(connection), 8192);
  connection.contextStrategy = 'balanced';
  assert.equal(resolvedWorkingContextTarget(connection), 6963);
  connection.contextStrategy = 'economy';
  assert.equal(resolvedWorkingContextTarget(connection), 4096);
  connection.manualContextCap = 1048576;
  assert.equal(resolvedHardContextLimit(connection), 524288);
  connection.detectedContext = { tokens: 4096, provenance: 'runtime' };
  assert.equal(resolvedWorkingContextTarget(connection), 2048);
  connection.manualContextCap = null;
  connection.detectedContext = null;
  assert.equal(resolvedWorkingContextTarget(connection), 4096);
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

test('memory settings default on, persist off, and safely fall back after deletion', () => {
  const connections = [{ id: 'chat' }, { id: 'summary' }];
  assert.deepEqual(resolveMemorySettings(connections, undefined, undefined), {
    longTermMemory: true,
    summaryConnectionId: SAME_AS_CHAT_CONNECTION,
  });
  assert.deepEqual(resolveMemorySettings(connections, 'false', 'summary'), {
    longTermMemory: false,
    summaryConnectionId: 'summary',
  });
  assert.equal(normalizeSummaryConnectionId([{ id: 'chat' }], 'summary'), SAME_AS_CHAT_CONNECTION);
});

test('summary caps are modest and strategy-aware', () => {
  assert.equal(adaptiveSummaryOutputCap('economy'), 512);
  assert.equal(adaptiveSummaryOutputCap('balanced'), 1024);
  assert.equal(adaptiveSummaryOutputCap('maximum'), 2048);
});

test('summary selection supports same-as-chat and separate connection limits', () => {
  const chat = { id: 'chat', contextLimit: 131072 };
  const summary = { id: 'summary', contextLimit: 8192 };
  assert.equal(resolveSummaryConnection([chat, summary], SAME_AS_CHAT_CONNECTION, chat), chat);
  assert.equal(resolveSummaryConnection([chat, summary], 'summary', chat), summary);
  assert.equal(resolveSummaryConnection([chat], 'deleted', chat), chat);
});

test('summary trigger uses the working target and compression adds hysteresis', () => {
  assert.equal(shouldTriggerSummary(7999, 8000), false);
  assert.equal(shouldTriggerSummary(8000, 8000), false);
  assert.equal(shouldTriggerSummary(8001, 8000), true);
  assert.equal(summaryCompressionGoal(8000), 6400);
  assert.equal(shouldTriggerSummary(summaryCompressionGoal(8000) + 100, 8000), false);
});
