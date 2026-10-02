import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { deriveEffectiveTokenBudget } from './rollingSummaryCore.ts';
import { supportedServiceTiers } from './generationCapabilities.ts';
import { PROVIDERS } from './providers.ts';

const contracts = JSON.parse(await readFile(new URL('../../../tests/fixtures/provider-contracts.json', import.meta.url), 'utf8'));
test('shared Rust/TypeScript fixtures reserve the exact final wire output cap', () => {
  for (const contract of contracts) {
    const budget = deriveEffectiveTokenBudget(contract.config);
    assert.equal(budget.reserveTokens, contract.reserveTokens, contract.name);
    assert.equal(budget.hasKnownTotalLimit, true, contract.name);
    if (contract.expectedBody.service_tier) {
      assert.ok(supportedServiceTiers({ providerKind: contract.kind, url: contract.url }).includes(contract.config.serviceTier), contract.name);
    }
    if (['anthropic', 'gemini', 'nanogpt'].includes(contract.kind)) {
      assert.equal(PROVIDERS.find(provider => provider.kind === contract.kind).url, contract.url);
    }
  }
});
