import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSystemPrompt } from './promptBuilder.ts';
import { buildPromptMessages } from './chatPromptBuilder.ts';

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

test('production prompt path injects exactly the matching World Info entries once', () => {
  const worldInfos = [
    {
      id: 'selected-b',
      entries: [{
        id: 'second-book', keys: ['Markt'], enabled: true, position: 'after',
        content: 'SECOND_BOOK_MATCH: The market closes at dusk.',
      }],
    },
    {
      id: 'selected-a',
      entries: [
        {
          id: 'history-match', keys: ['Bergdorf'], enabled: true, position: 'before',
          content: 'HISTORY_MATCH: The mountain village has an old observatory.',
        },
        {
          id: 'duplicate-key-match', keys: ['straße', 'Straße', 'STRASSE'], enabled: true, position: 'after',
          content: 'CURRENT_MATCH: The Straße leads to the market.',
        },
        {
          id: 'unicode-match', keys: ['Cafe\u0301'], enabled: true, position: 'after',
          content: 'UNICODE_MATCH: The café serves plum cake.',
        },
        {
          id: 'disabled', keys: ['Straße'], enabled: false, position: 'after',
          content: 'DISABLED_ENTRY_MUST_NOT_APPEAR',
        },
        {
          id: 'unrelated', keys: ['Raumschiff'], enabled: true, position: 'after',
          content: 'UNRELATED_ENTRY_MUST_NOT_APPEAR',
        },
      ],
    },
    {
      id: 'not-selected',
      entries: [{
        id: 'not-selected-entry', keys: ['Straße'], enabled: true, position: 'after',
        content: 'UNSELECTED_BOOK_MUST_NOT_APPEAR',
      }],
    },
  ];

  const messages = buildPromptMessages({
    character: {
      name: 'Klea',
      prompt: 'Character card',
      world_info_ids: ['selected-a', 'selected-a', 'selected-b'],
    },
    role: null,
    recentMessages: [
      { id: '1', role: 'user', content: 'Wir kamen gestern im Bergdorf an.' },
      { id: '2', role: 'assistant', content: '<think>private</think>Der Regen hörte auf.' },
    ],
    userPrompt: 'Gehen wir die Straße entlang zum Markt und besuchen das Café?',
    summaryMeta: { currentSummary: null, lastSummarizedMessageId: null },
    worldInfos,
  });

  const finalUserPrompt = messages.at(-1);
  assert.equal(finalUserPrompt.role, 'user');
  for (const marker of ['HISTORY_MATCH', 'CURRENT_MATCH', 'UNICODE_MATCH', 'SECOND_BOOK_MATCH']) {
    assert.equal(finalUserPrompt.content.split(marker).length - 1, 1, `${marker} should appear once`);
  }
  for (const marker of [
    'DISABLED_ENTRY_MUST_NOT_APPEAR',
    'UNRELATED_ENTRY_MUST_NOT_APPEAR',
    'UNSELECTED_BOOK_MUST_NOT_APPEAR',
  ]) {
    assert.doesNotMatch(finalUserPrompt.content, new RegExp(marker));
  }
  assert.ok(finalUserPrompt.content.indexOf('World Info Before') < finalUserPrompt.content.indexOf('World Info After'));
  assert.ok(finalUserPrompt.content.indexOf('CURRENT_MATCH') < finalUserPrompt.content.indexOf('SECOND_BOOK_MATCH'));
  assert.ok(finalUserPrompt.content.indexOf('World Info After') < finalUserPrompt.content.indexOf('Gehen wir'));
  assert.doesNotMatch(messages[0].content, /HISTORY_MATCH|CURRENT_MATCH|UNICODE_MATCH|SECOND_BOOK_MATCH/);
});

test('World Info can trigger from summarized conversation history', () => {
  const messages = buildPromptMessages({
    character: { name: 'Klea', prompt: 'Card', world_info_ids: ['book'] },
    recentMessages: [{ id: 'covered', role: 'user', content: 'old turn' }],
    userPrompt: 'What now?',
    summaryMeta: {
      currentSummary: 'They previously discovered the Überwald.',
      lastSummarizedMessageId: 'covered',
    },
    worldInfos: [{
      id: 'book',
      entries: [{
        id: 'summary', keys: ['überwald'], enabled: true, position: 'after',
        content: 'SUMMARY_MATCH: The Überwald is protected.',
      }],
    }],
  });
  assert.equal(messages.at(-1).content.split('SUMMARY_MATCH').length - 1, 1);
});
