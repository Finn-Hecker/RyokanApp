import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './promptBuilder.ts';

test('no Role preserves the previous system prompt layout', () => {
  const prompt = buildSystemPrompt({ charName: 'Klea', prompt: 'Character card' });
  assert.match(prompt, /You are Klea\./);
  assert.ok(prompt.endsWith('Character card'));
  assert.doesNotMatch(prompt, /Player Role/);
});

test('Role context follows the Character card and resolves player placeholders', () => {
  const prompt = buildSystemPrompt({
    charName: 'Klea',
    prompt: 'Character card',
    role: { name: 'Alex', prompt: '{{user}} is {{char}}\'s coworker.' },
  });
  const cardIndex = prompt.indexOf('Character card');
  const roleIndex = prompt.indexOf('[Player Role: Alex]');
  assert.ok(cardIndex > -1 && roleIndex > cardIndex);
  assert.match(prompt, /Alex is Klea's coworker\./);
});
