import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { resolvedWorkingContextTarget, resolvedHardContextLimit, SAME_AS_CHAT_CONNECTION } from './connectionCore.ts';
import { contextSafetyMargin, deriveEffectiveTokenBudget, summarySafetyMargin } from './rollingSummaryCore.ts';

// Execute the production orchestrator and connection resolver with only the
// desktop boundary and Svelte state creation replaced. No real provider calls.
const listeners = new Map();
const harness = {};
globalThis.__summaryTest = harness;
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const mock = source => asModule(`const h = globalThis.__summaryTest;\n${source}`);
const modules = new Map([
  ['@tauri-apps/api/core', mock('export const invoke = (...args) => h.invoke(...args);')],
  ['@tauri-apps/api/event', mock('export const listen = (...args) => h.listen(...args);')],
  ['$lib/stores/chatStore.svelte', mock('export const chatState = h.chatState;')],
  ['$lib/stores/worldInfoStore.svelte', mock('export const worldInfoState = { allWorldInfos: [] };')],
  ['$lib/utils/clientLanguage', mock('export const getClientLanguageName = () => "English";')],
]);
harness.chatState = { activeChatId: null, summaryMeta: null };
harness.listen = async (name, callback) => {
  listeners.set(name, callback);
  return () => listeners.delete(name);
};
async function loadProduction(specifier) {
  if (modules.has(specifier)) return modules.get(specifier);
  if (!specifier.startsWith('$lib/')) return new URL(specifier, import.meta.url).href;
  const path = new URL(`../${specifier.slice('$lib/'.length)}.ts`, import.meta.url);
  let source = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  if (specifier.endsWith('appState.svelte') || specifier.endsWith('rollingSummary.svelte')) {
    source = 'const $state = Object.assign(value => value, { snapshot: value => structuredClone(value) });\n' + source;
  }
  for (const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    source = source.replace(match[0], `from '${await loadProduction(match[1])}'`);
  }
  source = source.replace("import('@tauri-apps/api/event')", `import('${modules.get('@tauri-apps/api/event')}')`);
  const url = asModule(source);
  modules.set(specifier, url);
  return url;
}
const state = await import(await loadProduction('$lib/stores/appState.svelte'));
const runtime = await import(await loadProduction('$lib/utils/rollingSummary.svelte'));
const connections = await import(await loadProduction('$lib/utils/apiConnections'));
const chatApi = await import(await loadProduction('$lib/utils/chatApi'));
let serial = 0;

function fixture({ chatLimit = 524288, summaryLimit = 131072, same = false, manual = null, strategy = 'maximum', lengths = [100, 100, 100] } = {}) {
  const id = `fixture-${++serial}`;
  const connection = (name, capacity) => ({
    ...state.createDefaultConnection(`${id}-${name}`, name),
    model: `${id}-${name}`, providerKind: 'generic_openai',
    url: 'http://fixture.invalid/v1', contextStrategy: strategy,
    detectedContext: capacity ? { tokens: capacity, provenance: 'provider_advertised', model: `${id}-${name}`, providerKind: 'generic_openai' } : null,
  });
  const chat = connection('chat', chatLimit);
  const summary = same ? chat : connection('summary', summaryLimit);
  chat.manualContextCap = manual;
  state.replaceApiConnections(same ? [chat] : [chat, summary], chat.id);
  state.appState.longTermMemory = true;
  state.appState.summaryConnectionId = same ? SAME_AS_CHAT_CONNECTION : summary.id;
  harness.chatState.activeChatId = id;
  let meta = { summary: null, last_id: null };
  const messages = lengths.map((length, index) => ({
    id: `${id}-${index}`, role: index % 2 ? 'assistant' : 'user',
    content: 'x'.repeat(length), swipe_index: 0, swipe_variants: [], usage_variants: [],
  }));
  const calls = [];
  const detections = [];
  const decisions = [];
  const count = text => Math.ceil(text.length / 4);
  const f = { chat, summary, messages, calls, detections, decisions, reportedUsage: null, beforeResponse: null, count,
    meta: () => meta,
    setMeta: value => { meta = value; },
    async run() {
      const options = { apiSettings: state.snapshotActiveApiConnection(), character: null, recentMessages: messages };
      const prepared = await runtime.checkAndSummarizeIfNeeded(id, options);
      await runtime.assertPreparedGenerationFits({ ...options, ...prepared });
      return { options, prepared };
    },
  };
  harness.invoke = async (command, args) => {
    if (command === 'record_diagnostic_decision') { decisions.push(args.decision); return; }
    if (command === 'record_frontend_event') return;
    if (command === 'count_tokens') return count(args.text);
    if (command === 'detect_context') {
      detections.push(args.model);
      const capacity = args.model === chat.model ? chatLimit : summaryLimit;
      if (!capacity) throw new Error('Context unavailable');
      return { tokens: capacity, provenance: 'provider_advertised', model: args.model, providerKind: 'generic_openai' };
    }
    if (command === 'get_messages') return messages;
    if (command === 'get_summary_meta') return { ...meta };
    if (command === 'compare_and_swap_summary_meta') {
      if (meta.summary !== args.expectedSummary || meta.last_id !== args.expectedLastSummarizedMessageId) return false;
      meta = { summary: args.summary, last_id: args.lastSummarizedMessageId };
      return true;
    }
    if (command === 'call_ai_api') {
      const p = args.payload;
      const input = count(p.messages.map(m => `${m.role}\n${m.content}`).join('\n')) + p.messages.length * 4 + 3
        + count(JSON.stringify(p.request_parameter_config.additionalParameters));
      const capacity = resolvedHardContextLimit(summary);
      assert.ok(input + p.max_tokens + summarySafetyMargin(capacity) <= capacity, 'every complete provider-bound request must fit');
      assert.equal(p.model, summary.model);
      assert.equal(p.provider_kind, summary.providerKind);
      calls.push({ ...p, input });
      await f.beforeResponse?.();
      listeners.get('ai-token')?.({ payload: { generationId: p.generation_id, token: 'Established facts.' } });
      return f.reportedUsage;
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  return f;
}

test('512K chat and 128K summary: early summary pressure, bounded chunks, independent chat target', async () => {
  const f = fixture({ lengths: [260000, 260000, 20] });
  const { options } = await f.run();
  assert.ok(f.calls.length > 0);
  assert.equal(options.apiSettings.contextLimit, 524288);
  assert.equal(resolvedWorkingContextTarget(options.apiSettings), 524288);
  assert.equal(f.detections.length, 2);
  assert.ok(f.meta().summary);
});

test('smaller chat and larger summary: chat strategy triggers compression', async () => {
  const f = fixture({ chatLimit: 8192, summaryLimit: 131072, lengths: [16000, 16000, 20] });
  const { options } = await f.run();
  assert.ok(f.calls.length > 0);
  assert.equal(options.apiSettings.contextLimit, 8192);
});

test('same-as-chat and explicitly selected chat reuse capacity and one detection', async () => {
  for (const explicit of [false, true]) {
    const f = fixture({ chatLimit: 8192, same: true, lengths: [16000, 16000, 20] });
    if (explicit) state.appState.summaryConnectionId = f.chat.id;
    await f.run();
    assert.ok(f.calls.length > 0);
    assert.deepEqual(f.detections, [f.chat.model]);
  }
});

test('unknown summary capacity uses 8K fallback and chunks an oversized individual message', async () => {
  const f = fixture({ summaryLimit: null, lengths: [100000, 20] });
  await f.run();
  assert.equal(f.summary.detectedContext, null);
  assert.equal(resolvedHardContextLimit(f.summary), 8192);
  assert.ok(f.calls.length > 1);
});

test('manual chat cap constrains chat but does not leak into a separate summary connection', async () => {
  const f = fixture({ manual: 8192, lengths: [16000, 16000, 20] });
  const { options } = await f.run();
  assert.equal(options.apiSettings.contextLimit, 8192);
  assert.equal(resolvedHardContextLimit(f.summary), 131072);
  assert.ok(f.calls.length > 0);
});

test('summary model selection change cancels in-flight work before persistence', async () => {
  const f = fixture({ summaryLimit: 8192, lengths: [30000, 20] });
  f.beforeResponse = () => { state.appState.summaryConnectionId = SAME_AS_CHAT_CONNECTION; };
  await assert.rejects(f.run(), runtime.SummaryCancelledError);
  assert.equal(f.meta().summary, null);
});

test('small summary window sizes its output reserve and near-limit chunks safely', async () => {
  const f = fixture({ summaryLimit: 2048, lengths: [30000, 20] });
  await f.run();
  assert.ok(f.calls.length > 1);
  assert.ok(f.calls.every(p => p.max_tokens < 2048));
  assert.ok(f.calls.some(p => p.input + p.max_tokens + summarySafetyMargin(2048) >= 2040));
});

test('restored oversized summary is reprocessed for a smaller summary model', async () => {
  const f = fixture({ summaryLimit: 2048, lengths: [20, 40000, 20] });
  f.setMeta({ summary: 'old facts '.repeat(2000), last_id: f.messages[0].id });
  await f.run();
  assert.ok(f.calls.length > 1);
  assert.equal(f.meta().summary, 'Established facts.');
});

test('normal chat below both working budgets does not invoke summary generation', async () => {
  const f = fixture();
  await f.run();
  assert.equal(f.calls.length, 0);
});

test('Maximum retains near-capacity history across small and large same-model windows', async () => {
  for (const capacity of [8192, 16384, 32768, 524288, 1048576]) {
    // Reserve both generation and measured summary instructions; unlike the old
    // 80% pressure threshold, no extra fraction of the window is withheld.
    const historyTokens = capacity - 2048 - contextSafetyMargin(capacity) - 1000;
    const f = fixture({ chatLimit: capacity, same: true,
      lengths: [historyTokens * 2, historyTokens * 2, 20] });
    f.chat.parameterEnabled.maxTokens = true;
    f.chat.maxTokens = 2048;
    await f.run();
    assert.equal(f.calls.length, 0, `${capacity}: usable history must be retained`);
    assert.equal(f.meta().summary, null);
  }
});

test('Maximum compresses before prompt plus generation and safety reserves exceed the cap', async () => {
  for (const capacity of [8192, 16384, 32768, 524288, 1048576]) {
    const historyTokens = capacity - 2048;
    const f = fixture({ chatLimit: capacity, same: true,
      lengths: [historyTokens * 2, historyTokens * 2, 20] });
    f.chat.parameterEnabled.maxTokens = true;
    f.chat.maxTokens = 2048;
    const { options, prepared } = await f.run();
    assert.ok(f.calls.length > 0, `${capacity}: reserves must trigger compression`);
    const prompt = chatApi.buildApiMessages({ ...options, ...prepared });
    const input = f.count(prompt.map(m => `${m.role}\n${m.content}`).join('\n')) + prompt.length * 4 + 3;
    const reserve = deriveEffectiveTokenBudget(prepared.requestParameterConfig).reserveTokens;
    assert.equal(reserve, 2048);
    assert.ok(input + reserve + contextSafetyMargin(capacity) <= capacity);
  }
});

test('Maximum final guard includes custom completion limits and proportional safety', async () => {
  const f = fixture({ chatLimit: 32768, same: true, lengths: [110000] });
  f.chat.additionalApiParameters = JSON.stringify({ max_completion_tokens: 8192 });
  await assert.rejects(f.run(), runtime.ContextBudgetError);
  assert.equal(f.calls.length, 0, 'irreducible prompt must fail before spending a summary call');
});

test('changing strategy changes the actual pre-request trigger without changing model maximum', async () => {
  const f = fixture({ lengths: [80000, 80000, 20], strategy: 'balanced' });
  await f.run();
  assert.equal(f.calls.length, 0);
  f.chat.contextStrategy = 'economy';
  await f.run();
  assert.ok(f.calls.length > 0);
  assert.equal(f.chat.detectedContext.tokens, 524288);
});

test('strategy with a manual cap uses the same runtime target as settings', async () => {
  const f = fixture({ manual: 8192, strategy: 'maximum', lengths: [8000, 8000, 20] });
  await f.run();
  assert.equal(f.calls.length, 0);
  f.chat.contextStrategy = 'economy';
  await f.run();
  assert.ok(f.calls.length > 0);
  assert.equal(resolvedWorkingContextTarget(f.chat), 4096);
});

test('restart hydration recomputes stale limits and preserves summary selection', () => {
  const f = fixture({ manual: 8192, summaryLimit: null });
  f.chat.contextLimit = 999999;
  f.summary.contextLimit = 999999;
  connections.hydrateApiConnections([
    { key: connections.API_CONNECTIONS_KEY, value: JSON.stringify([f.chat, f.summary]) },
    { key: connections.ACTIVE_API_CONNECTION_KEY, value: f.chat.id },
    { key: connections.SUMMARY_CONNECTION_KEY, value: f.summary.id },
  ]);
  assert.equal(state.appState.apiSettings.contextLimit, 8192);
  assert.equal(state.snapshotSummaryApiConnection(state.snapshotActiveApiConnection()).contextLimit, 8192);
  assert.equal(state.appState.summaryConnectionId, f.summary.id);
});

test('changed summary model gets a fresh detection on the next generation', async () => {
  const f = fixture();
  await f.run();
  f.summary.model += '-changed';
  connections.invalidateDetectedContext(f.summary);
  await f.run();
  assert.equal(f.detections.length, 3);
  assert.equal(f.detections.at(-1), f.summary.model);
});

test('a manual summary cap is respected independently of the chat strategy', async () => {
  const f = fixture({ lengths: [40000, 20] });
  f.summary.manualContextCap = 2048;
  await f.run();
  assert.ok(f.calls.length > 1);
  assert.equal(resolvedWorkingContextTarget(f.chat), 524288);
});

test('detection refresh metadata alone does not invalidate the normal provider usage anchor', () => {
  const f = fixture();
  const options = { apiSettings: state.snapshotActiveApiConnection(), recentMessages: [], character: null };
  const original = chatApi.generationConfigurationFingerprint(options);
  options.apiSettings.detectedContext.detectedAt = 'new timestamp';
  options.apiSettings.contextDetectionError = 'temporary detection failure';
  assert.equal(chatApi.generationConfigurationFingerprint(options), original);
  options.apiSettings.model = 'different-model';
  assert.notEqual(chatApi.generationConfigurationFingerprint(options), original);
});

test('an older automatic detection cannot overwrite a newer manual refresh', async () => {
  const f = fixture();
  const completions = [];
  harness.invoke = async command => {
    assert.equal(command, 'detect_context');
    return await new Promise(resolve => completions.push(resolve));
  };
  const snapshot = state.snapshotSummaryApiConnection(state.snapshotActiveApiConnection());
  const automatic = connections.ensureContextDetection(snapshot);
  const manual = connections.refreshContextDetection(f.summary);
  completions[1]({ ...f.summary.detectedContext, tokens: 8192 });
  await manual;
  completions[0]({ ...f.summary.detectedContext, tokens: 131072 });
  await automatic;
  assert.equal(resolvedHardContextLimit(f.summary), 8192);
  assert.equal(snapshot.contextLimit, 8192);
});

test('a smaller detected summary window cancels active work before committing', async () => {
  const f = fixture({ summaryLimit: 8192, lengths: [40000, 20] });
  f.beforeResponse = () => { f.summary.detectedContext.tokens = 2048; };
  await assert.rejects(f.run(), runtime.SummaryCancelledError);
  assert.equal(f.meta().summary, null);
});

test('diagnostics explain no-trigger, chat pressure, summary pressure and memory disabled', async () => {
  for (const [settings, trigger] of [
    [{ lengths: [100, 100, 20] }, 'none'],
    [{ chatLimit: 8192, summaryLimit: 131072, lengths: [16000, 16000, 20] }, 'chat'],
    [{ chatLimit: 524288, summaryLimit: 8192, lengths: [16000, 16000, 20] }, 'summary'],
  ]) {
    const f = fixture(settings);
    await f.run();
    const decision = f.decisions.find(d => d.kind === 'budget' && d.stage === 'decision');
    assert.equal(decision.trigger, trigger);
    assert.equal(decision.measurement.total, decision.measurement.prompt_tokens + decision.measurement.reserve_tokens + decision.measurement.safety_tokens);
    assert.equal(decision.working_target, resolvedWorkingContextTarget(f.chat));
    assert.equal(decision.measurement.hard_limit, resolvedHardContextLimit(f.chat));
    if (trigger === 'summary') {
      const pressure = f.decisions.find(d => d.kind === 'summary_capacity' && d.stage === 'pressure');
      assert.equal(pressure.fits, false);
      assert.ok(pressure.input_tokens + pressure.output_reserve + pressure.safety_tokens > pressure.hard_limit);
      assert.ok(f.decisions.some(d => d.state === 'committed'));
    }
  }
  const f = fixture();
  state.appState.longTermMemory = false;
  await f.run();
  assert.ok(f.decisions.some(d => d.kind === 'budget' && d.stage === 'memory_disabled' && d.trigger === 'disabled'));
});

test('diagnostics capture reserve overrides and context detection caps without private data', async () => {
  const f = fixture({ manual: 8192, same: true });
  f.chat.apiKey = 'SECRET_API_KEY';
  f.chat.systemPrompt = 'SECRET_SYSTEM_PROMPT';
  f.chat.additionalApiParameters = JSON.stringify({ max_completion_tokens: 2048, privateTag: 'SECRET_CUSTOM_CONTENT' });
  await f.run();
  const detection = f.decisions.find(d => d.kind === 'detection');
  assert.equal(detection.manual_cap, 8192);
  assert.equal(detection.hard_limit, 8192);
  const budget = f.decisions.find(d => d.kind === 'budget');
  assert.equal(budget.measurement.reserve_tokens, 2048);
  assert.equal(budget.measurement.budget_details.total_limit, 2048);
  const serialized = JSON.stringify(f.decisions);
  for (const value of [f.chat.apiKey, f.chat.systemPrompt, 'SECRET_CUSTOM_CONTENT', f.chat.model, f.chat.url, f.chat.id, f.messages[0].id, f.messages[0].content]) {
    assert.ok(!serialized.includes(value), `diagnostics must exclude private fixture data`);
  }
});

test('diagnostics correlate API accounting and anchor reconciliation across generations', async () => {
  const f = fixture({ chatLimit: 32768, same: true });
  f.reportedUsage = { inputTokens: 1000, cachedInputTokens: 750, outputTokens: 100, reasoningTokens: 40 };
  const { options, prepared } = await f.run();
  Object.assign(options, prepared);
  const result = await chatApi.runGeneration(options, { onStreamUpdate() {}, onThinkingPhaseChange() {} });
  const usage = f.decisions.find(d => d.kind === 'usage' && d.purpose === 'chat');
  assert.equal(usage.operation, options.diagnosticOperation);
  assert.equal(usage.input_tokens, 1000);
  assert.equal(usage.cached_input_tokens, 750);
  assert.equal(usage.output_tokens, 100);
  assert.equal(usage.reasoning_tokens, 40);
  assert.ok(usage.local_input_tokens < usage.input_tokens);
  const response = { id: 'private-response-id', role: 'assistant', content: result.text, swipe_index: 0, swipe_variants: [result.text], usage_variants: [f.reportedUsage] };
  runtime.rememberGenerationAnchor(harness.chatState.activeChatId, result.promptSnapshot, response);
  f.messages.push(response, { id: 'private-next-id', role: 'user', content: 'private follow-up', swipe_index: 0, swipe_variants: [], usage_variants: [] });
  await f.run();
  const decision = f.decisions.filter(d => d.kind === 'budget' && d.stage === 'decision').at(-1);
  assert.equal(decision.measurement.anchor, 'reused');
  assert.ok(decision.measurement.prompt_tokens > decision.measurement.local_tokens);
  assert.notEqual(decision.operation, usage.operation);
  const original = f.decisions.find(d => d.kind === 'budget');
  assert.equal(decision.conversation, original.conversation);
  assert.ok(!JSON.stringify(f.decisions).includes('private follow-up'));
});

test('diagnostics identify stale markers and cancellation reasons', async () => {
  const stale = fixture();
  stale.setMeta({ summary: 'PRIVATE_SUMMARY', last_id: 'missing-private-marker' });
  await stale.run();
  assert.ok(stale.decisions.some(d => d.state === 'marker_reset' && d.reason === 'marker_invalid'));
  assert.ok(stale.decisions.some(d => d.state === 'committed'));
  assert.ok(!JSON.stringify(stale.decisions).includes('PRIVATE_SUMMARY'));
  const f = fixture({ summaryLimit: 8192, lengths: [40000, 20] });
  f.beforeResponse = () => { f.summary.detectedContext.tokens = 2048; };
  await assert.rejects(f.run(), runtime.SummaryCancelledError);
  assert.ok(f.decisions.some(d => d.state === 'cancelled' && d.reason === 'context_shrunk'));
});

test('diagnostic IPC failure never changes summary decisions', async () => {
  const f = fixture({ chatLimit: 8192, lengths: [16000, 16000, 20] });
  const invoke = harness.invoke;
  harness.invoke = (command, args) => {
    if (command === 'record_diagnostic_decision') throw new Error('diagnostics unavailable');
    return invoke(command, args);
  };
  await f.run();
  assert.ok(f.meta().summary);
});
