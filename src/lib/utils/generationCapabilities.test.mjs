import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultApiParameterEnabled, requestParameterConfig } from './apiParameters.ts';
import { generationParameterStatus, modelGenerationCapabilities, reasoningCapability, reasoningDialect, resolveGenerationCapabilities } from './generationCapabilities.ts';

test('OpenRouter exposes only advertised efforts in UI order for each model', () => {
  const connection = { providerKind: 'openrouter', url: 'https://openrouter.ai/api/v1', model: 'a' };
  for (const [allowedOptions, expected] of [
    [['max', 'xhigh', 'high', 'medium', 'low'], ['auto', 'low', 'medium', 'high', 'xhigh', 'max']],
    [['high', 'minimal', 'none', 'high'], ['auto', 'none', 'minimal', 'high']],
    [['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'], ['auto', 'none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']],
    [[], ['auto']],
    [['future', 'auto', 42], ['auto']],
  ]) {
    connection.generationCapabilities = modelGenerationCapabilities(connection, ['reasoning'], { supported: true, allowedOptions });
    assert.deepEqual(reasoningCapability(connection), { dialect: 'openrouter', levels: expected, certainty: 'model_metadata' });
  }
  connection.generationCapabilities = modelGenerationCapabilities(connection, null, { supported: true, allowedOptions: ['max'] });
  assert.deepEqual(reasoningCapability(connection).levels, ['auto', 'max']);
  for (const allowedOptions of [undefined, null, 'invalid']) {
    connection.generationCapabilities = modelGenerationCapabilities(connection, ['reasoning'], { supported: true, allowedOptions });
    assert.deepEqual(reasoningCapability(connection), { dialect: 'openrouter', levels: ['auto', 'low', 'medium', 'high'], certainty: 'unknown_levels' });
  }
});

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

test('reasoning levels come from matching provider metadata, never the model name', () => {
  const router = { providerKind: 'openrouter', url: 'https://openrouter.ai/api/v1', model: 'vendor/reasoner' };
  assert.equal(reasoningDialect(router), null);
  router.generationCapabilities = modelGenerationCapabilities(router, ['temperature']);
  assert.equal(reasoningDialect(router), null);
  router.generationCapabilities = modelGenerationCapabilities(router, ['reasoning']);
  assert.equal(reasoningDialect(router), 'openrouter');
  assert.deepEqual(reasoningCapability(router).levels, ['auto', 'low', 'medium', 'high']);
  assert.equal(reasoningCapability(router).certainty, 'unknown_levels');
  router.model = 'vendor/other';
  assert.equal(reasoningDialect(router), null);
  for (const providerKind of ['openai', 'xai', 'generic_openai', 'llama_cpp']) {
    assert.equal(reasoningDialect({ providerKind, url: 'http://localhost/v1', model: 'arbitrary' }), null);
  }
  const llama = { providerKind: 'llama_cpp', url: 'http://localhost:8080/v1', model: 'arbitrary' };
  llama.generationCapabilities = modelGenerationCapabilities(llama, null, { supported: true });
  assert.deepEqual(reasoningCapability(llama).levels, ['auto', 'low', 'medium', 'high']);
  assert.equal(reasoningCapability(llama).certainty, 'unknown_levels');
  const studio = { providerKind: 'lm_studio', url: 'http://localhost:1234/v1', model: 'arbitrary' };
  studio.generationCapabilities = modelGenerationCapabilities(studio, null,
    { supported: true, allowedOptions: ['off', 'low', 'medium', 'high', 'on'] });
  assert.deepEqual(reasoningCapability(studio).levels, ['auto', 'low', 'medium', 'high']);
  assert.equal(generationParameterStatus(studio, 'temperature'), 'supported');
  studio.model = 'another';
  assert.equal(reasoningCapability(studio), null);
  studio.generationCapabilities = modelGenerationCapabilities(studio, null, { supported: true });
  assert.deepEqual(reasoningCapability(studio).levels, ['auto', 'low', 'medium', 'high']);
  assert.equal(reasoningCapability(studio).certainty, 'unknown_levels');
});
