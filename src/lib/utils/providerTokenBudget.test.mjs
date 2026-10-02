import assert from 'node:assert/strict';
import test from 'node:test';
import { deriveEffectiveTokenBudget, fitsContextBudget, contextSafetyMargin } from './rollingSummaryCore.ts';
import { createDefaultApiParameterEnabled, requestParameterConfig } from './apiParameters.ts';
import { modelGenerationCapabilities, reasoningCapability } from './generationCapabilities.ts';

const config = (budgetProvider, patch = {}) => ({ budgetProvider,
  maxTokensEnabled: true, thinkingBudgetEnabled: false, maxTokens: 4096, thinkingBudget: 2048,
  additionalParameters: {}, ...patch });
const reserve = (provider, patch) => deriveEffectiveTokenBudget(config(provider, patch));

test('existing providers retain the complete legacy budget calculation and parameter snapshot', () => {
  const cases = [
    [{}, 4096, 4096, 0, true],
    [{ thinkingBudgetEnabled: true }, 6144, 6144, 2048, true],
    [{ maxTokensEnabled: false }, 1024, 4096, 0, false],
    [{ maxTokensEnabled: false, thinkingBudgetEnabled: true }, 2560, 6144, 2048, false],
    [{ additionalParameters: { max_tokens: 8000 } }, 8000, 4096, 0, true],
    [{ additionalParameters: { max_tokens: '9000' } }, 1024, 4096, 0, false],
    [{ additionalParameters: { max_tokens: 0 } }, 0, 4096, 0, true],
    [{ additionalParameters: { max_tokens: 2000, max_completion_tokens: 3000 } }, 3000, 4096, 0, true],
    [{ maxTokensEnabled: false, additionalParameters: { chat_template_kwargs: { enable_thinking: false }, reasoning: false } }, 512, 4096, 0, false],
  ];
  for (const providerKind of ['openrouter', 'openai', 'xai', 'generic_openai', 'lm_studio', 'llama_cpp', 'koboldcpp', 'ollama']) {
    const profile = { providerKind, url: 'http://fixture.invalid/v1', model: 'fixture',
      parameterEnabled: createDefaultApiParameterEnabled(), maxTokens: 4096, thinkingBudget: 2048 };
    assert.equal(Object.hasOwn(requestParameterConfig(profile), 'budgetProvider'), false);
    for (const [patch, expectedReserve, max, thinking, known] of cases) {
      const before = config(undefined, patch);
      const result = deriveEffectiveTokenBudget(before);
      assert.equal(result.reserveTokens, expectedReserve, providerKind);
      assert.equal(result.payloadMaxTokens, max);
      assert.equal(result.payloadThinkingBudget, thinking);
      assert.equal(result.hasKnownTotalLimit, known);
      // Even unknown/new discriminators cannot change the legacy branch.
      assert.deepEqual(deriveEffectiveTokenBudget({ ...before, budgetProvider: providerKind }), result);
    }
  }
});

test('Anthropic normal/manual/adaptive output caps include thinking, never add it twice', () => {
  assert.equal(reserve('anthropic').reserveTokens, 4096);
  const manual = reserve('anthropic', { thinkingBudgetEnabled: true });
  assert.equal(manual.payloadMaxTokens, 4096);
  assert.equal(manual.payloadThinkingBudget, 2048);
  assert.equal(manual.reserveTokens, 4096);
  assert.equal(manual.calculation.reasoning_limit, 2048);
  const adaptive = reserve('anthropic', { additionalParameters: { max_tokens: 6000, thinking: { type: 'adaptive' }, output_config: { effort: 'high' } } });
  assert.equal(adaptive.reserveTokens, 6000);
  assert.equal(adaptive.calculation.reasoning_limit, null);
  assert.equal(reserve('anthropic', { maxTokensEnabled: false }).reserveTokens, 4096);
});

test('Anthropic custom thinking replaces the switch; disabled thinking reserves no separate budget', () => {
  const disabled = reserve('anthropic', { thinkingBudgetEnabled: true, additionalParameters: { thinking: { type: 'disabled' } } });
  assert.equal(disabled.calculation.reasoning_enabled, false);
  assert.equal(disabled.calculation.reasoning_limit, null);
  const custom = reserve('anthropic', { additionalParameters: { thinking: { type: 'enabled', budget_tokens: 1024 } } });
  assert.equal(custom.calculation.reasoning_limit, 1024);
  assert.equal(custom.reserveTokens, 4096);
  assert.equal(reserve('anthropic', { thinkingBudgetEnabled: true, thinkingBudget: 1000 }).calculation.invalid_reasoning_limit, true);
  for (const thinkingBudget of [4096, 5000]) {
    assert.equal(reserve('anthropic', { thinkingBudgetEnabled: true, thinkingBudget }).calculation.invalid_reasoning_limit, true);
  }
});

test('Gemini native output cap overrides match shallow generationConfig merges', () => {
  for (const thinkingConfig of [{ thinkingBudget: 2048 }, { thinkingBudget: -1 }, { thinkingBudget: 0 }, { thinkingLevel: 'HIGH' }]) {
    const result = reserve('gemini', { additionalParameters: { generationConfig: { maxOutputTokens: 6000, thinkingConfig } } });
    assert.equal(result.reserveTokens, 6000);
    assert.equal(result.payloadMaxTokens, 4096);
    assert.equal(result.calculation.invalid_reasoning_limit, false);
    assert.equal(result.calculation.reasoning_limit, thinkingConfig.thinkingBudget >= 0 ? thinkingConfig.thinkingBudget : null);
  }
  assert.equal(reserve('gemini', { thinkingBudgetEnabled: true }).payloadMaxTokens, 4096);
  assert.equal(reserve('gemini', { thinkingBudgetEnabled: true,
    additionalParameters: { generationConfig: { thinkingConfig: { thinkingLevel: 'HIGH' } } } }).calculation.reasoning_limit, null);
  assert.equal(reserve('gemini', { maxTokensEnabled: false }).reserveTokens, 8192);
  assert.equal(reserve('gemini', { additionalParameters: { max_tokens: 99999 } }).reserveTokens, 4096);
});

test('native malformed limits are not coerced or reported as known caps', () => {
  for (const value of ['8192', null, true, -1, 0, 2.5]) {
    for (const provider of ['anthropic', 'gemini']) {
      const additionalParameters = provider === 'anthropic' ? { max_tokens: value } : { generationConfig: { maxOutputTokens: value } };
      const result = reserve(provider, { additionalParameters });
      assert.equal(result.hasKnownTotalLimit, false);
      assert.equal(result.calculation.invalid_total_limit, true);
    }
  }
  assert.equal(reserve('gemini', { additionalParameters: { generationConfig: { thinkingConfig: { thinkingBudget: -2 } } } }).calculation.invalid_reasoning_limit, true);
});

test('native normal, manual and adaptive requests fit exactly at the context boundary', () => {
  for (const provider of ['anthropic', 'gemini']) {
    for (const patch of [{}, { thinkingBudgetEnabled: true },
      { additionalParameters: provider === 'anthropic' ? { max_tokens: 6144, thinking: { type: 'adaptive' } }
        : { generationConfig: { maxOutputTokens: 6144, thinkingConfig: { thinkingBudget: -1 } } } }]) {
      const result = reserve(provider, patch);
      const capacity = 8192;
      const reserved = result.reserveTokens + contextSafetyMargin(capacity);
      assert.equal(fitsContextBudget(capacity - reserved, reserved, capacity), true);
      assert.equal(fitsContextBudget(capacity - reserved + 1, reserved, capacity), false);
    }
  }
});

test('new provider metadata stays scoped to its model and exposes only reported efforts', () => {
  const connection = { providerKind: 'anthropic', url: 'https://api.anthropic.com/v1', model: 'model',
    parameterEnabled: { ...createDefaultApiParameterEnabled(), thinkingBudget: true }, maxTokens: 4096, thinkingBudget: 2048 };
  connection.generationCapabilities = modelGenerationCapabilities(connection, ['max_tokens', 'thinking_budget_tokens'], { supported: true, allowedOptions: ['low', 'high'] });
  assert.deepEqual(reasoningCapability(connection).levels, ['auto', 'low', 'high']);
  assert.equal(requestParameterConfig(connection).budgetProvider, 'anthropic');
  assert.equal(requestParameterConfig(connection).thinkingBudgetEnabled, true);
  assert.equal(reasoningCapability({ ...connection, model: 'different' }), null);
  assert.equal(requestParameterConfig({ ...connection, providerKind: 'nanogpt' }).budgetProvider, undefined);
});
