import test from 'node:test';
import assert from 'node:assert/strict';
import { formatContextTokens, formatModelPrice, getRecentModels, recordModelUse, modelPrices, pricePerMillion } from './modelPickerData.ts';

test('recent models persist in use order without duplicates and stop at 20', () => {
  const values = new Map();
  globalThis.localStorage = {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  };
  assert.deepEqual(getRecentModels(), []);
  for (let i = 0; i < 25; i++) recordModelUse(`model-${i}`);
  recordModelUse('model-10');
  assert.equal(getRecentModels().length, 20);
  assert.equal(getRecentModels()[0], 'model-10');
  assert.equal(getRecentModels().filter(id => id === 'model-10').length, 1);
  assert.deepEqual(JSON.parse(values.get('ryokan-recent-models')), getRecentModels());
  delete globalThis.localStorage;
});

test('pricing requires both finite, nonnegative, plausible quotes', () => {
  for (const invalid of ['-999', '-0.01', 'NaN', 'Infinity', '1e300', '', '1']) {
    assert.equal(pricePerMillion(invalid), null);
  }
  assert.deepEqual(modelPrices({ id: 'paid', pricing: { prompt: '0.000001', completion: '0.000002' } }), { input: 1, output: 2 });
  assert.deepEqual(modelPrices({ id: 'free', pricing: { prompt: '0', completion: '0' } }), { input: 0, output: 0 });
  assert.equal(modelPrices({ id: 'bad', pricing: { prompt: '0.000001', completion: '-999' } }), null);
});

test('context sizes use consistent K and M notation', () => {
  assert.equal(formatContextTokens(36 * 1024), '36K');
  assert.equal(formatContextTokens(1024 * 1024), '1M');
  assert.equal(formatContextTokens(1_000_000), '1M');
  assert.equal(formatContextTokens(2 * 1024 * 1024), '2M');
  assert.equal(formatContextTokens(Infinity), '');
});

test('normalized provider prices retain small nonzero rates', () => {
  const prices = modelPrices({ id: 'nano', pricing: { prompt: '0.00000002', completion: '0.0000025', source: 'NanoGPT' } });
  assert.deepEqual(prices, { input: 0.02, output: 2.5 });
  assert.equal(formatModelPrice(0.001), '$0.001');
  assert.equal(formatModelPrice(2.5), '$2.50');
  assert.equal(formatModelPrice(0), '$0.00');
});
