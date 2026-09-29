import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedUsage, withConnection, formatCachedUsage, formatUsageCount, formatUsageCost, parseUsage, persistedUsage } from './tokenUsage.ts';

test('usage follows the selected swipe without borrowing legacy or other variant data', () => {
  const usage = { inputTokens: 120, cachedInputTokens: 80, outputTokens: 30, reasoningTokens: 10, costUsd: 0.001, actualModel: 'resolved-model', serviceTier: 'flex' };
  const message = { usage_variants: [null, usage], swipe_index: 0 };
  assert.equal(selectedUsage(message), null);
  message.swipe_index = 1;
  assert.equal(selectedUsage(message), usage);
  message.swipe_index = 2;
  assert.equal(selectedUsage(message), null);
  assert.equal(selectedUsage({ swipe_index: 0 }), null);
});

test('actual service tier follows the persisted swipe and never falls back to the Flex profile', () => {
  const connection = { name: 'OpenRouter', serviceTier: 'flex' };
  const usage_variants = [null, ...['flex', 'default', null].map(serviceTier =>
    withConnection({ inputTokens: 12, cachedInputTokens: null, outputTokens: 1, reasoningTokens: null, serviceTier }, connection))];
  const restored = JSON.parse(JSON.stringify(usage_variants));
  assert.deepEqual(restored.map((_, swipe_index) => selectedUsage({ usage_variants: restored, swipe_index })?.serviceTier ?? null),
    [null, 'flex', 'default', null]);
  assert.equal(withConnection(null, connection).serviceTier, undefined);
});

test('connection snapshot preserves provider truth and does not persist credentials or infer model/tier', () => {
  const profile = { name: 'Original', apiKey: 'secret', model: 'requested', serviceTier: 'flex' };
  const saved = withConnection(null, profile);
  profile.name = 'Renamed';
  assert.equal(saved.connectionName, 'Original');
  assert.equal(saved.actualModel, undefined);
  assert.equal(saved.serviceTier, undefined);
  assert.equal(saved.apiKey, undefined);
  assert.equal(saved.inputTokens, null);
  assert.equal(withConnection({ ...saved, actualModel: 'actual', costUsd: 0 }, profile).costUsd, 0);
});

test('formatting distinguishes unavailable, invalid, zero and tiny provider charges', () => {
  for (const value of [undefined, null, -1, NaN, Infinity, '20']) {
    assert.equal(formatUsageCount(value, 'en'), null);
    assert.equal(formatUsageCost(value, 'en'), null);
  }
  assert.equal(formatUsageCount(0, 'en'), '0');
  assert.equal(formatUsageCount(1200, 'de'), '1.200');
  assert.equal(formatUsageCost(0, 'en'), '0 USD');
  assert.equal(formatUsageCost(0.00000001, 'en'), '0.00000001 USD');
});

test('cached usage includes its rounded share only for meaningful input and cache values', () => {
  assert.equal(formatCachedUsage(28_500, 32_000, 'de'), `28.500 · ${new Intl.NumberFormat('de', { style: 'percent', maximumFractionDigits: 0 }).format(28_500 / 32_000)}`);
  assert.equal(formatCachedUsage(0, 1_200, 'en'), '0 · 0%');
  assert.equal(formatCachedUsage(600, 1_200, 'en'), '600 · 50%');

  assert.equal(formatCachedUsage(null, 1_200, 'en'), null);
  assert.equal(formatCachedUsage(undefined, 1_200, 'en'), null);
  assert.equal(formatCachedUsage(0, 0, 'en'), '0');
  assert.equal(formatCachedUsage(120, 0, 'en'), '120');
  assert.equal(formatCachedUsage(120, null, 'en'), '120');
  assert.equal(formatCachedUsage(1_201, 1_200, 'en'), '1,201');
  assert.equal(formatCachedUsage(-1, 1_200, 'en'), null);
});

test('relay and persisted history preserve metadata, isolate variants and reject malformed fields', () => {
  const raw = { inputTokens: 10, cachedInputTokens: 0, costUsd: 0.0001, actualModel: 'actual', serviceTier: 'default', connectionName: 'Original', apiKey: 'secret' };
  const usage = parseUsage(raw);
  assert.equal(usage.apiKey, undefined);
  assert.equal(usage.serviceTier, 'default');
  assert.equal(usage.costUsd, raw.costUsd);
  assert.equal(usage.actualModel, raw.actualModel);
  assert.equal(usage.connectionName, raw.connectionName);
  assert.equal(persistedUsage(JSON.stringify([null, raw]), 0), null);
  assert.deepEqual(persistedUsage(JSON.stringify([null, raw]), 1), usage);
  assert.deepEqual(persistedUsage([raw]), usage);
  for (const value of [null, undefined, 'broken json', '{}', '[]']) assert.equal(persistedUsage(value), null);
  assert.equal(parseUsage({ inputTokens: -1, costUsd: Infinity, actualModel: 42, serviceTier: ' ' }), null);
  assert.equal(parseUsage({ inputTokens: 12, costUsd: '0.1' }).costUsd, undefined);
});
