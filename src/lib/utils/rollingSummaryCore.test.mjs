import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canReusePromptAnchor,
  commitOrRollback,
  deriveEffectiveTokenBudget,
  fitsContextBudget,
  isMessageCoveredBySummary,
  isSummaryCommitCurrent,
  resolveSummaryMarker,
  reconcilePromptTokens,
  selectRecentTurnSuffix,
  shouldRecompressExistingSummary,
  summaryWorkKey,
  TOKEN_ESTIMATION_MARGIN,
  unicodeCodePointBoundaries,
  withRequestTokenValues,
} from './rollingSummaryCore.ts';
import { shouldTriggerSummary } from './connectionCore.ts';

const messages = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

const anchor = {
  historyFingerprint: ['["u1","user","hello",0]'],
  summaryFingerprint: '{"currentSummary":null,"lastSummarizedMessageId":null}',
  configurationFingerprint: 'provider/model/config',
  prompt: [{ role: 'system', content: 'character' }, { role: 'user', content: 'hello' }],
  responseSwipeIndex: 0,
  responseFingerprint: '["a1","assistant","reply",0]',
  revision: 2,
};

test('provider input is reconciled against only the prompt tail', async () => {
  const counted = [];
  const countTail = async (tail) => {
    counted.push(tail.map(message => message.content));
    return tail.reduce((sum, message) => sum + message.content.length, 0);
  };
  const next = [...anchor.prompt, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'next' }];
  assert.equal(await reconcilePromptTokens(1000, anchor.prompt, next, countTail), 1009);
  assert.deepEqual(counted, [[], ['reply', 'next']]);
  assert.equal(await reconcilePromptTokens(1080, anchor.prompt, next, countTail), 1089);
});

test('cached input is included in provider input and output is not added', async () => {
  const usage = { inputTokens: 1000, cachedInputTokens: 800, outputTokens: 400, reasoningTokens: 300 };
  const predicted = await reconcilePromptTokens(
    usage.inputTokens, anchor.prompt,
    [...anchor.prompt, { role: 'assistant', content: 'reply' }],
    async tail => tail.reduce((sum, message) => sum + message.content.length, 0),
  );
  assert.equal(predicted, 1005);
});

test('anchor requires the same branch, swipe, summary, and prompt configuration', () => {
  const current = [...anchor.historyFingerprint, anchor.responseFingerprint, '["u2","user","next",0]'];
  const valid = (history = current, summary = anchor.summaryFingerprint, config = anchor.configurationFingerprint, revision = 2) =>
    canReusePromptAnchor(anchor, history, summary, config, revision);
  assert.equal(valid(), true);
  assert.equal(valid([anchor.historyFingerprint[0], '["a1","assistant","other swipe",1]']), false);
  assert.equal(valid([anchor.historyFingerprint[0], '["a1","assistant","edited",0]']), false);
  assert.equal(valid(['["u1","user","edited",0]', ...current.slice(1)]), false);
  assert.equal(valid(current.slice(0, 1)), false);
  assert.equal(valid([...current.slice(0, 1), '["other","assistant","reply",0]']), false);
  assert.equal(valid(current, 'new summary'), false);
  assert.equal(valid(current, anchor.summaryFingerprint, 'other provider/model/config'), false);
  assert.equal(valid(current, anchor.summaryFingerprint, anchor.configurationFingerprint, 3), false);
});

test('missing provider usage falls back and predicted next input triggers before request', async () => {
  const next = [...anchor.prompt, { role: 'assistant', content: 'reply' }, { role: 'user', content: 'next' }];
  const countTail = async tail => tail.reduce((sum, message) => sum + message.content.length, 0);
  assert.equal(await reconcilePromptTokens(null, anchor.prompt, next, countTail), null);
  assert.equal(await reconcilePromptTokens(1000, [{ role: 'system', content: 'old' }], next, countTail), null);
  const predictedInput = await reconcilePromptTokens(1000, anchor.prompt, next, countTail);
  const outputReserve = 300 + TOKEN_ESTIMATION_MARGIN;
  assert.equal(shouldTriggerSummary(predictedInput + outputReserve, 1436), true);
  assert.equal(shouldTriggerSummary(predictedInput + outputReserve, 1437), false);
});

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
