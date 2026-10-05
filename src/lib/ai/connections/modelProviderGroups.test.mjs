import assert from 'node:assert/strict';
import test from 'node:test';
import {
  curatedProviderGroupForModel,
  curatedProviderGroups,
} from './modelProviderGroups.ts';

const group = (id, architecture) => curatedProviderGroupForModel({ id, architecture })?.id ?? null;

test('keeps the curated provider order stable', () => {
  assert.deepEqual(curatedProviderGroups.map(({ id }) => id), [
    'google', 'anthropic', 'openai', 'deepseek', 'z-ai', 'qwen',
    'meta', 'mistral', 'moonshot-ai', 'minimax', 'xai',
  ]);
});

test('matches the organization identifiers used by the catalog', () => {
  assert.equal(group('google/gemini-2.5-pro'), 'google');
  assert.equal(group('anthropic/claude-sonnet-4'), 'anthropic');
  assert.equal(group('openai/gpt-5'), 'openai');
  assert.equal(group('~deepseek/deepseek-chat-latest'), 'deepseek');
  assert.equal(group('z-ai/glm-5'), 'z-ai');
  assert.equal(group('qwen/qwen3-235b'), 'qwen');
  assert.equal(group('meta-llama/llama-4-maverick'), 'meta');
  assert.equal(group('mistralai/mistral-large'), 'mistral');
  assert.equal(group('moonshotai/kimi-k2'), 'moonshot-ai');
  assert.equal(group('minimax/minimax-m2'), 'minimax');
  assert.equal(group('x-ai/grok-4'), 'xai');
});

test('uses family aliases and retained catalog metadata without changing the model', () => {
  assert.equal(group('alibaba-cloud/qwen3-coder'), 'qwen');
  assert.equal(group('local/glm-4.5-air'), 'z-ai');
  assert.equal(group('local/kimi-k2'), 'moonshot-ai');
  assert.equal(group('uploader/custom-model', { tokenizer: 'Llama3' }), 'meta');
  assert.equal(group('uploader/custom-model', { tokenizer: 'Qwen3' }), 'qwen');
  assert.equal(group('small-creator/original-model'), null);
});

test('prefers an explicit organization over another family name', () => {
  assert.equal(group('deepseek/deepseek-r1-distill-qwen-32b'), 'deepseek');
  assert.equal(group('qwen/deepseek-r1-distill-qwen-32b'), 'qwen');
});
