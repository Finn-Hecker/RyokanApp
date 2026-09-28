import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultApiParameterEnabled, requestParameterConfig } from './apiParameters.ts';
import { generationParameterStatus, modelGenerationCapabilities, resolveGenerationCapabilities } from './generationCapabilities.ts';

test('OpenRouter metadata warns without changing request switches or custom parameters', () => {
  const connection = {
    providerKind: 'openrouter', url: 'https://openrouter.ai/api/v1', model: 'a',
    maxTokens: 300, thinkingBudget: 2500,
    parameterEnabled: { ...createDefaultApiParameterEnabled(), temperature: true, topP: true, topK: true },
    additionalApiParameters: '{"top_k":50,"seed":7}',
  };
  connection.generationCapabilities = modelGenerationCapabilities(connection, ['temperature', 'top_p']);
  const first = requestParameterConfig(connection);
  assert.equal(generationParameterStatus(connection, 'topK'), 'unreported');
  assert.equal(generationParameterStatus(connection, 'topP'), 'supported');
  assert.equal(first.temperatureEnabled, true);
  assert.equal(first.topPEnabled, true);
  assert.equal(first.topKEnabled, true);
  assert.deepEqual(first.additionalParameters, { top_k: 50, seed: 7 });
  connection.model = 'b';
  assert.equal(resolveGenerationCapabilities(connection).source, 'unknown');
  assert.equal(generationParameterStatus(connection, 'temperature'), 'unknown');
  assert.equal(requestParameterConfig(connection).temperatureEnabled, true);
  connection.model = 'a';
  assert.equal(requestParameterConfig(connection).temperatureEnabled, true);
  assert.equal(connection.parameterEnabled.topK, true);
});

test('missing metadata is unknown, including custom APIs', () => {
  const connection = { providerKind: 'openrouter', url: 'https://openrouter.ai/api/v1', model: 'a' };
  assert.equal(modelGenerationCapabilities(connection, null), null);
  assert.deepEqual(resolveGenerationCapabilities(connection), { source: 'unknown', supportedParameters: [] });
  assert.equal(generationParameterStatus(connection, 'temperature'), 'unknown');
  assert.equal(generationParameterStatus({ providerKind: 'generic_openai', url: 'http://custom/v1', model: 'custom' }, 'topK'), 'unknown');
  assert.equal(modelGenerationCapabilities({ providerKind: 'openrouter', url: 'http://custom/v1', model: 'a' }, []), null);
});

test('documented local API contract is available without model metadata', () => {
  const connection = { providerKind: 'llama_cpp', url: 'http://localhost:8080/v1', model: 'local' };
  assert.equal(resolveGenerationCapabilities(connection).source, 'api_contract');
  assert.equal(resolveGenerationCapabilities(connection).supportedParameters.includes('min_p'), true);
  assert.equal(generationParameterStatus(connection, 'minP'), 'supported');
  assert.equal(generationParameterStatus(connection, 'thinkingBudget'), 'unknown');
});
