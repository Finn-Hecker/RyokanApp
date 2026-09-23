import assert from 'node:assert/strict';
import test from 'node:test';
import {
  commitOrRollback,
  deriveEffectiveTokenBudget,
  fitsContextBudget,
  isMessageCoveredBySummary,
  isSummaryCommitCurrent,
  resolveSummaryMarker,
  selectRecentTurnSuffix,
  shouldRecompressExistingSummary,
  summaryWorkKey,
  TOKEN_ESTIMATION_MARGIN,
  unicodeCodePointBoundaries,
  withRequestTokenValues,
} from './rollingSummaryCore.ts';

const messages = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

test('a valid marker resumes immediately after the summarized prefix', () => {
  assert.deepEqual(
    resolveSummaryMarker(messages, {
      currentSummary: 'summary',
      lastSummarizedMessageId: 'c',
    }),
    { startIndex: 3, markerIndex: 2, mustReset: false },
  );
});

test('recent retention is token-based and keeps complete newest turns where practical', () => {
  const tokenized = [
    { id: 'u1', role: 'user', tokens: 40 },
    { id: 'a1', role: 'assistant', tokens: 50 },
    { id: 'u2', role: 'user', tokens: 30 },
    { id: 'a2', role: 'assistant', tokens: 35 },
    { id: 'u3', role: 'user', tokens: 20 },
    { id: 'a3', role: 'assistant', tokens: 25 },
  ];
  assert.deepEqual(
    selectRecentTurnSuffix(tokenized, 110).retained.map(message => message.id),
    ['u2', 'a2', 'u3', 'a3'],
  );
  assert.deepEqual(
    selectRecentTurnSuffix(tokenized, 50).retained.map(message => message.id),
    ['u3', 'a3'],
  );
});

test('missing and internally inconsistent markers reset to full history', () => {
  assert.equal(resolveSummaryMarker(messages, {
    currentSummary: 'summary',
    lastSummarizedMessageId: 'missing',
  }).mustReset, true);
  assert.equal(resolveSummaryMarker(messages, {
    currentSummary: null,
    lastSummarizedMessageId: 'c',
  }).mustReset, true);
});

test('covered-message detection is conservative when the marker is stale', () => {
  assert.equal(isMessageCoveredBySummary(messages, 'c', 'b'), true);
  assert.equal(isMessageCoveredBySummary(messages, 'c', 'd'), false);
  assert.equal(isMessageCoveredBySummary(messages, 'missing', 'd'), true);
});

const config = (
  maxTokensEnabled,
  thinkingBudgetEnabled,
  additionalParameters = {},
  maxTokens = 300,
  thinkingBudget = 2500,
) => ({
  maxTokensEnabled,
  thinkingBudgetEnabled,
  maxTokens,
  thinkingBudget,
  additionalParameters,
});

test('4096-token budgets respect disabled and enabled forwarding switches', () => {
  const disabled = deriveEffectiveTokenBudget(config(false, false));
  assert.deepEqual(disabled, {
    payloadMaxTokens: 300,
    payloadThinkingBudget: 0,
    reserveTokens: 1024,
    hasKnownTotalLimit: false,
  });
  assert.equal(4096 - disabled.reserveTokens - TOKEN_ESTIMATION_MARGIN, 2944);

  const outputOnly = deriveEffectiveTokenBudget(config(true, false));
  assert.deepEqual(outputOnly, {
    payloadMaxTokens: 300,
    payloadThinkingBudget: 0,
    reserveTokens: 300,
    hasKnownTotalLimit: true,
  });

  const thinkingOnly = deriveEffectiveTokenBudget(config(false, true));
  assert.deepEqual(thinkingOnly, {
    payloadMaxTokens: 2800,
    payloadThinkingBudget: 2500,
    reserveTokens: 3012,
    hasKnownTotalLimit: false,
  });

  const both = deriveEffectiveTokenBudget(config(true, true));
  assert.deepEqual(both, {
    payloadMaxTokens: 2800,
    payloadThinkingBudget: 2500,
    reserveTokens: 2800,
    hasKnownTotalLimit: true,
  });
});

test('strict custom output limits override or augment the final merged request', () => {
  assert.equal(
    deriveEffectiveTokenBudget(config(true, true, { max_tokens: 900 }))
      .reserveTokens,
    900,
  );
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      max_completion_tokens: 1200,
    })).reserveTokens,
    1200,
  );
});

test('invalid custom output limits are never coerced to numbers', () => {
  for (const invalid of [null, false, true, '900', {}, []]) {
    for (const field of ['max_tokens', 'max_completion_tokens']) {
      const budget = deriveEffectiveTokenBudget(
        config(false, false, { [field]: invalid }),
      );
      assert.equal(budget.reserveTokens, 1024);
      assert.equal(budget.hasKnownTotalLimit, false);
    }
  }
});

test('custom reasoning controls affect only an otherwise unbounded reserve', () => {
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      reasoning: { max_tokens: 1800 },
    })).reserveTokens,
    2312,
  );
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      reasoning: { enabled: false },
    })).reserveTokens,
    1024,
    'disabling one reasoning control does not override the enabled chat-template path',
  );
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      chat_template_kwargs: { enable_thinking: false },
      reasoning: { enabled: false },
    })).reserveTokens,
    512,
    'reasoning is treated as disabled only when every supplied path is disabled',
  );
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      chat_template_kwargs: { enable_thinking: false },
      reasoning: { enabled: true, max_tokens: 1800 },
    })).reserveTokens,
    2312,
  );
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      reasoning: { enabled: false, max_tokens: 100 },
    })).reserveTokens,
    1024,
    'a small limit on a conflicting disabled path cannot shrink the unknown enabled path',
  );
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      max_completion_tokens: 1000,
      reasoning: { max_tokens: 1800 },
    })).reserveTokens,
    1000,
    'a total completion cap already includes reasoning and must not be double-counted',
  );
  assert.equal(
    deriveEffectiveTokenBudget(config(false, false, {
      thinking_budget_tokens: '2500',
    })).reserveTokens,
    1024,
    'invalid reasoning limits are not coerced either',
  );
});

test('request token values are immutable snapshots used by budgeting', () => {
  const original = config(true, true, {}, 300, 2500);
  const summary = withRequestTokenValues(original, 800, 2000);
  assert.equal(deriveEffectiveTokenBudget(original).payloadMaxTokens, 2800);
  assert.equal(deriveEffectiveTokenBudget(summary).payloadMaxTokens, 2800);
  assert.equal(deriveEffectiveTokenBudget(original).payloadThinkingBudget, 2500);
  assert.equal(deriveEffectiveTokenBudget(summary).payloadThinkingBudget, 2000);
  assert.equal(original.maxTokens, 300);
  assert.equal(original.thinkingBudget, 2500);
  assert.equal(summary.maxTokens, 800);
  assert.equal(summary.thinkingBudget, 2000);
});

test('mixed valid and invalid reasoning limits keep the larger safe reserve', () => {
  const budget = deriveEffectiveTokenBudget(config(false, true, {
    reasoning: { max_tokens: 'unbounded' },
  }, 300, 2500));
  assert.equal(budget.reserveTokens, 3012);
  assert.equal(budget.hasKnownTotalLimit, false);
});

test('fixed content that exceeds the remaining context is rejected', () => {
  assert.equal(fitsContextBudget(2944, 1152, 4096), true);
  assert.equal(fitsContextBudget(2945, 1152, 4096), false);
});

test('oversized summaries, cancellation, and retry boundaries are explicit', () => {
  assert.equal(shouldRecompressExistingSummary(801, 800), true);
  assert.equal(shouldRecompressExistingSummary(800, 800), false);
  assert.equal(isSummaryCommitCurrent('chat-a', 'chat-a', false), true);
  assert.equal(isSummaryCommitCurrent('chat-a', 'chat-a', true), false);
  assert.equal(isSummaryCommitCurrent('chat-a', 'chat-b', false), false);
  assert.notEqual(summaryWorkKey('chat-a'), summaryWorkKey('chat-a', 'retry-1'));
  assert.notEqual(
    summaryWorkKey('chat-a', 'retry-1'),
    summaryWorkKey('chat-a', 'retry-2'),
  );
});

test('cancellation during persistence rolls the candidate back', async () => {
  let stored = 'previous';
  let current = true;
  const result = await commitOrRollback(
    async (expected, next) => {
      if (stored !== expected) return false;
      stored = next;
      if (next === 'candidate') current = false;
      return true;
    },
    'previous',
    'candidate',
    () => current,
  );
  assert.equal(result, 'rolled-back');
  assert.equal(stored, 'previous');
});

test('cancellation rollback never overwrites a newer persisted summary', async () => {
  let stored = 'previous';
  let current = true;
  const result = await commitOrRollback(
    async (expected, next) => {
      if (stored !== expected) return false;
      stored = next;
      if (next === 'candidate') {
        stored = 'newer-summary';
        current = false;
      }
      return true;
    },
    'previous',
    'candidate',
    () => current,
  );
  assert.equal(result, 'conflict');
  assert.equal(stored, 'newer-summary');
});

test('oversized message boundaries never split UTF-16 surrogate pairs', () => {
  const text = 'A😀B𐐷C';
  const boundaries = unicodeCodePointBoundaries(text);
  assert.deepEqual(boundaries, [0, 1, 3, 4, 6, 7]);
  assert.equal(boundaries.includes(2), false);
  assert.equal(boundaries.includes(5), false);
  assert.equal(
    boundaries.slice(1).map((end, index) => text.slice(boundaries[index], end)).join(''),
    text,
  );
});
