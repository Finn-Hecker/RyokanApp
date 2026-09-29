import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultApiParameterEnabled, requestParameterConfig } from './apiParameters.ts';
import { modelGenerationCapabilities } from './generationCapabilities.ts';

test('OpenRouter model changes and refreshed metadata invalidate saved efforts safely', () => {
  const connection = { providerKind: 'openrouter', url: 'https://openrouter.ai/api/v1', model: 'a',
    reasoningLevel: 'max', parameterEnabled: createDefaultApiParameterEnabled() };
  connection.generationCapabilities = modelGenerationCapabilities(connection, ['reasoning'],
    { supported: true, allowedOptions: ['max', 'xhigh', 'high'] });
  for (const level of ['max', 'xhigh', 'auto']) {
    connection.reasoningLevel = level;
    assert.equal(requestParameterConfig(connection).reasoningLevel, level);
    assert.equal(requestParameterConfig(connection).reasoningDialect, 'openrouter');
  }
  connection.reasoningLevel = 'max';
  connection.model = 'b';
  assert.equal(requestParameterConfig(connection).reasoningLevel, 'auto');
  assert.equal(requestParameterConfig(connection).reasoningDialect, null);
  connection.generationCapabilities = modelGenerationCapabilities(connection, ['reasoning'],
    { supported: true, allowedOptions: ['low', 'high'] });
  assert.equal(requestParameterConfig(connection).reasoningLevel, 'auto');
  connection.reasoningLevel = 'high';
  assert.equal(requestParameterConfig(connection).reasoningLevel, 'high');
  connection.generationCapabilities = modelGenerationCapabilities(connection, ['reasoning'],
    { supported: true, allowedOptions: ['low'] });
  assert.equal(requestParameterConfig(connection).reasoningLevel, 'auto');
  assert.equal(connection.reasoningLevel, 'high');
});

test('request parameters stay bound to their selected connection', () => {
  const first = {
    maxTokens: 300, thinkingBudget: 2500,
    additionalApiParameters: '{"seed":7}',
    parameterEnabled: { ...createDefaultApiParameterEnabled(), temperature: true, topP: true },
  };
  const second = {
    maxTokens: 800, thinkingBudget: 1000,
    additionalApiParameters: '{"seed":23}',
    parameterEnabled: { ...createDefaultApiParameterEnabled(), frequencyPenalty: true },
  };
  const firstRequest = requestParameterConfig(first);
  const secondRequest = requestParameterConfig(second);
  assert.equal(firstRequest.temperatureEnabled, true);
  assert.equal(secondRequest.temperatureEnabled, false);
  assert.equal(firstRequest.frequencyPenaltyEnabled, false);
  assert.equal(secondRequest.frequencyPenaltyEnabled, true);
  assert.deepEqual(firstRequest.additionalParameters, { seed: 7 });
  assert.deepEqual(secondRequest.additionalParameters, { seed: 23 });
  assert.equal(secondRequest.maxTokens, 800);
  second.parameterEnabled.topP = true;
  assert.equal(firstRequest.topPEnabled, true);
  assert.equal(secondRequest.topPEnabled, false);
});

test('invalid legacy custom fields cannot override request protocol fields', () => {
  const connection = {
    maxTokens: 300, thinkingBudget: 2500,
    additionalApiParameters: '{"model":"wrong","seed":7}',
    parameterEnabled: createDefaultApiParameterEnabled(),
  };
  assert.deepEqual(requestParameterConfig(connection).additionalParameters, {});
});

test('reasoning selection is scoped to the profile and API dialect', () => {
  const local = { providerKind: 'llama_cpp', url: 'http://localhost:8080/v1', model: 'reasoner',
    reasoningLevel: 'low', maxTokens: 300, thinkingBudget: 2500,
    additionalApiParameters: '', parameterEnabled: createDefaultApiParameterEnabled() };
  local.parameterEnabled.thinkingBudget = true;
  assert.equal(requestParameterConfig(local).thinkingBudgetEnabled, true);
  assert.equal(requestParameterConfig(local).thinkingBudget, 2500);
  assert.equal(requestParameterConfig(local).reasoningLevel, 'auto');
  local.generationCapabilities = modelGenerationCapabilities(local, null, { supported: true });
  assert.equal(requestParameterConfig(local).reasoningLevel, 'low');
  assert.equal(requestParameterConfig(local).reasoningDialect, 'llama_cpp_effort');
  assert.equal(requestParameterConfig(local).thinkingBudget, 2500);
  const studio = { ...local, providerKind: 'lm_studio', url: 'http://localhost:1234/v1', reasoningLevel: 'high' };
  studio.generationCapabilities = modelGenerationCapabilities(studio, null,
    { supported: true, allowedOptions: ['low', 'medium'] });
  assert.equal(requestParameterConfig(studio).reasoningLevel, 'auto');
  assert.equal(requestParameterConfig(studio).thinkingBudgetEnabled, false);
  studio.reasoningLevel = 'medium';
  assert.equal(requestParameterConfig(studio).reasoningDialect, 'lm_studio');
  assert.equal(requestParameterConfig(studio).reasoningLevel, 'medium');
});
