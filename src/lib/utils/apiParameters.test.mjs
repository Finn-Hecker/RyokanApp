import assert from 'node:assert/strict';
import test from 'node:test';
import { createDefaultApiParameterEnabled, requestParameterConfig } from './apiParameters.ts';

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
