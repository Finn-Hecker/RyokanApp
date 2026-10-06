import assert from 'node:assert/strict';
import test from 'node:test';
import { capturePreset, resolvePreset } from '../presets/presetCore.ts';

import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolvedWorkingContextTarget, resolvedHardContextLimit, SAME_AS_CHAT_CONNECTION } from '../connections/connectionCore.ts';
import { contextSafetyMargin, deriveEffectiveTokenBudget, summarySafetyMargin } from './rollingSummaryCore.ts';
import { estimateBudgetTokens } from '../tokens/tokenEstimate.ts';

// Execute the production orchestrator and connection resolver with only the
// desktop boundary and Svelte state creation replaced. No real provider calls.
const listeners = new Map();
const harness = {};
globalThis.__summaryTest = harness;
const asModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const mock = source => asModule(`const h = globalThis.__summaryTest;\n${source}`);
const modules = new Map([
  ['@tauri-apps/plugin-dialog', mock('export const save = () => { throw new Error("Unexpected export dialog in summary tests"); };')],
  ['@tauri-apps/api/core', mock('export const invoke = (...args) => h.invoke(...args);')],
  ['@tauri-apps/api/event', mock('export const listen = (...args) => h.listen(...args);')],
  ['$lib/stores/chatStore.svelte', mock('export const chatState = h.chatState;')],
  ['$lib/stores/worldInfoStore.svelte', mock('export const worldInfoState = { allWorldInfos: [] };')],
  ['$lib/utils/clientLanguage', mock('export const getClientLanguageName = () => "English";')],
]);
const libRoot = new URL('../../', import.meta.url);
function relativeProductionSpecifier(file, specifier) {
  const target = new URL(specifier, file);
  return '$lib/' + relative(fileURLToPath(libRoot), fileURLToPath(target))
    .replaceAll('\\', '/').replace(/\.ts$/, '');
}
harness.chatState = { activeChatId: null, summaryMeta: null };
harness.listen = async (name, callback) => {
  listeners.set(name, callback);
  return () => listeners.delete(name);
};
async function loadProduction(specifier) {
  if (modules.has(specifier)) return modules.get(specifier);
  if (!specifier.startsWith('$lib/')) return new URL(specifier, import.meta.url).href;
  const path = new URL(`${specifier.slice('$lib/'.length)}.ts`, libRoot);
  let source = ts.transpileModule(await readFile(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  if (specifier.endsWith('appState.svelte') || specifier.endsWith('rollingSummary.svelte')) {
    source = 'const $state = Object.assign(value => value, { snapshot: value => structuredClone(value) });\n' + source;
  }
  for (const match of [...source.matchAll(/from ['"]([^'"]+)['"]/g)]) {
    const dependency = match[1].startsWith('.')
      ? relativeProductionSpecifier(path, match[1]) : match[1];
    source = source.replace(match[0], `from '${await loadProduction(dependency)}'`);
  }
  source = source.replace("import('@tauri-apps/api/event')", `import('${modules.get('@tauri-apps/api/event')}')`);
  const url = asModule(source);
  modules.set(specifier, url);
  return url;
}
const state = await import(await loadProduction('$lib/stores/appState.svelte'));
const runtime = await import(await loadProduction('$lib/ai/summary/rollingSummary.svelte'));
const connections = await import(await loadProduction('$lib/ai/connections/apiConnections'));
const chatApi = await import(await loadProduction('$lib/ai/generation/chatApi'));
const parameters = await import(await loadProduction('$lib/ai/connections/apiParameters'));
const revisions = await import(await loadProduction('$lib/ai/summary/rollingSummaryCore'));
let serial = 0;

test('per-connection applied preset IDs survive persistence and hydration alongside legacy profiles', async () => {
  const first = { ...state.createDefaultConnection('preset-a'), appliedPresetId: 'first', temperature: 1.2 };
  const second = { ...state.createDefaultConnection('preset-b'), appliedPresetId: 'second', temperature: 1.2 };
  const legacy = state.createDefaultConnection('legacy');
  delete legacy.appliedPresetId;
  state.replaceApiConnections([first, second, legacy], second.id);
  const request = state.snapshotActiveApiConnection();
  let saved;
  harness.invoke = async (command, args) => { assert.equal(command, 'save_api_connections'); saved = args; };
  await connections.persistApiConnections();
  connections.hydrateApiConnections([{ key: connections.API_CONNECTIONS_KEY, value: saved.connectionsJson },
    { key: connections.ACTIVE_API_CONNECTION_KEY, value: saved.activeConnectionId }]);
  assert.deepEqual(state.appState.apiConnections.map(profile => profile.appliedPresetId), ['first', 'second', null]);
  assert.equal(state.appState.apiSettings.appliedPresetId, 'second');
  state.activateApiConnection(first.id);
  assert.equal(state.appState.apiSettings.appliedPresetId, 'first');
  state.appState.apiSettings.appliedPresetId = null;
  state.appState.apiSettings.temperature = 0.3;
  assert.equal(request.appliedPresetId, 'second'); assert.equal(request.temperature, 1.2);
});

test('manual summary editing preserves coverage, persists and feeds the next generation prompt', async () => {
  const f = fixture({ chatLimit: 32768, same: true, lengths: [20, 20, 20] });
  f.setMeta({ summary: 'Old facts', last_id: f.messages[0].id });
  const expected = { currentSummary: 'Old facts', lastSummarizedMessageId: f.messages[0].id };
  harness.chatState.summaryMeta = expected;
  const revision = revisions.currentConversationRevision(harness.chatState.activeChatId);
  await runtime.updateRollingSummary(harness.chatState.activeChatId, expected, '  Manually corrected facts  ');
  assert.deepEqual(f.meta(), { summary: 'Manually corrected facts', last_id: f.messages[0].id });
  assert.deepEqual(harness.chatState.summaryMeta, { ...expected, currentSummary: 'Manually corrected facts' });
  assert.ok(revisions.currentConversationRevision(harness.chatState.activeChatId) > revision);
  const { options, prepared } = await f.run();
  const prompt = chatApi.buildApiMessages({ ...options, ...prepared });
  assert.ok(prompt.some(message => message.content.includes('Manually corrected facts')));
  assert.ok(prompt.every(message => !message.content.includes('Old facts')));
  assert.equal(f.calls.length, 0);
});

test('manual summary CAS rejects a stale editor and refreshes the shared state', async () => {
  const f = fixture({ same: true });
  f.setMeta({ summary: 'New automatic facts', last_id: f.messages[1].id });
  await assert.rejects(runtime.updateRollingSummary(harness.chatState.activeChatId,
    { currentSummary: 'Old facts', lastSummarizedMessageId: f.messages[0].id }, 'Manual facts'), /inzwischen geändert/);
  assert.equal(f.meta().summary, 'New automatic facts');
  assert.deepEqual(harness.chatState.summaryMeta,
    { currentSummary: 'New automatic facts', lastSummarizedMessageId: f.messages[1].id });
});

test('manual save failure leaves the committed shared summary untouched', async () => {
  fixture({ same: true });
  const expected = { currentSummary: 'Old facts', lastSummarizedMessageId: 'marker' };
  harness.chatState.summaryMeta = expected;
  harness.invoke = async () => { throw new Error('Persistence failed'); };
  await assert.rejects(runtime.updateRollingSummary(harness.chatState.activeChatId, expected, 'Manual facts'), /Persistence failed/);
  assert.equal(harness.chatState.summaryMeta, expected);
});

test('clearing a summary clears its coverage marker and does not publish into another chat', async () => {
  const f = fixture({ same: true });
  f.setMeta({ summary: 'Old facts', last_id: f.messages[0].id });
  const chatId = harness.chatState.activeChatId;
  const saved = runtime.updateRollingSummary(chatId,
    { currentSummary: 'Old facts', lastSummarizedMessageId: f.messages[0].id }, '  ');
  const otherMeta = { currentSummary: 'Other chat', lastSummarizedMessageId: 'other-marker' };
  harness.chatState.activeChatId = 'other-chat';
  harness.chatState.summaryMeta = otherMeta;
  await saved;
  assert.deepEqual(f.meta(), { summary: null, last_id: null });
  assert.equal(harness.chatState.summaryMeta, otherMeta);
});

test('manual edit cancels an in-flight automatic summary before committing its own text', async () => {
  const f = fixture({ chatLimit: 8192, same: true, lengths: [18000, 40000, 40] });
  const expected = { currentSummary: 'Old facts', lastSummarizedMessageId: f.messages[0].id };
  f.setMeta({ summary: expected.currentSummary, last_id: expected.lastSummarizedMessageId });
  const invoke = harness.invoke;
  let stopped = false;
  harness.invoke = async (command, args) => {
    if (command === 'stop_generation') { stopped = true; return; }
    return invoke(command, args);
  };
  let saved;
  f.beforeResponse = () => {
    saved = runtime.updateRollingSummary(harness.chatState.activeChatId, expected, 'Manual facts');
  };
  await assert.rejects(f.run(), runtime.SummaryCancelledError);
  await saved;
  assert.equal(stopped, true);
  assert.deepEqual(f.meta(), { summary: 'Manual facts', last_id: expected.lastSummarizedMessageId });
  assert.equal(harness.chatState.summaryMeta.currentSummary, 'Manual facts');
});

test('manual edit waits for an automatic CAS rollback without losing its original marker', async () => {
  const f = fixture({ chatLimit: 8192, same: true, lengths: [18000, 40000, 40] });
  const expected = { currentSummary: 'Old facts', lastSummarizedMessageId: f.messages[0].id };
  f.setMeta({ summary: expected.currentSummary, last_id: expected.lastSummarizedMessageId });
  const invoke = harness.invoke;
  let saved;
  const swaps = [];
  harness.invoke = async (command, args) => {
    if (command === 'stop_generation') return;
    const result = await invoke(command, args);
    if (command === 'compare_and_swap_summary_meta') {
      swaps.push({ ...f.meta() });
      if (!saved) saved = runtime.updateRollingSummary(harness.chatState.activeChatId, expected, 'Manual facts');
    }
    return result;
  };
  await assert.rejects(f.run(), runtime.SummaryCancelledError);
  await saved;
  assert.ok(swaps.length >= 3, 'automatic candidate, cancelled rollback, manual commit');
  assert.deepEqual(swaps.at(-2), { summary: 'Old facts', last_id: expected.lastSummarizedMessageId });
  assert.deepEqual(f.meta(), { summary: 'Manual facts', last_id: expected.lastSummarizedMessageId });
});

test('native and NanoGPT profiles round-trip without migration or a persisted budget discriminator', async () => {
  const profiles = ['nanogpt', 'anthropic', 'gemini'].map((providerKind, index) => ({
    ...state.createDefaultConnection(`cloud-${index}`), providerKind, apiKey: 'fixture-key', model: 'fixture-model',
    parameterEnabled: { ...state.createDefaultConnection().parameterEnabled, maxTokens: true, thinkingBudget: true },
    maxTokens: 4096, thinkingBudget: 2048,
  }));
  let saved;
  harness.invoke = async (command, args) => { assert.equal(command, 'save_api_connections'); saved = args; };
  state.replaceApiConnections(profiles, 'cloud-1');
  await connections.persistApiConnections();
  assert.ok(JSON.parse(saved.connectionsJson).every(profile => !Object.hasOwn(profile, 'budgetProvider')));
  connections.hydrateApiConnections([{ key: connections.API_CONNECTIONS_KEY, value: saved.connectionsJson },
    { key: connections.ACTIVE_API_CONNECTION_KEY, value: saved.activeConnectionId }]);
  assert.deepEqual(state.appState.apiConnections.map(profile => profile.providerKind), ['nanogpt', 'anthropic', 'gemini']);
  assert.equal(state.appState.activeApiConnectionId, 'cloud-1');
  assert.equal(state.appState.apiSettings.thinkingBudget, 2048);
});

test('native normal and manual-thinking generations use the same total cap in planning and IPC', async () => {
  for (const providerKind of ['anthropic', 'gemini']) {
    for (const thinkingBudgetEnabled of [false, true]) {
      const profile = { ...state.createDefaultConnection(), providerKind, model: 'fixture-model', maxTokens: 4096, thinkingBudget: 2048,
        parameterEnabled: { ...state.createDefaultConnection().parameterEnabled, maxTokens: true, thinkingBudget: thinkingBudgetEnabled } };
      let payload;
      harness.chatState.summaryMeta = { currentSummary: null, lastSummarizedMessageId: null };
      harness.invoke = async (command, args) => {
        if (command !== 'call_ai_api') return;
        payload = args.payload;
        listeners.get('ai-thinking-token')?.({ payload: { generationId: payload.generation_id, token: 'Thought summary' } });
        listeners.get('ai-token')?.({ payload: { generationId: payload.generation_id, token: 'Answer' } });
        return { inputTokens: 100, outputTokens: 200, reasoningTokens: 150 };
      };
      const result = await chatApi.runGeneration({ apiSettings: profile, character: null, recentMessages: [], userPrompt: 'Hello' },
        { onStreamUpdate() {}, onThinkingPhaseChange() {} });
      assert.equal(payload.request_parameter_config.budgetProvider, providerKind);
      assert.equal(payload.request_parameter_config.maxTokens, 4096);
      assert.equal(payload.request_parameter_config.thinkingBudget, 2048);
      assert.equal(payload.request_parameter_config.thinkingBudgetEnabled, thinkingBudgetEnabled);
      assert.equal(Object.hasOwn(payload, 'max_tokens'), false);
      assert.equal(Object.hasOwn(payload, 'thinking_budget'), false);
      assert.equal(deriveEffectiveTokenBudget(payload.request_parameter_config).reserveTokens, 4096);
      assert.equal(result.text, 'Answer'); assert.equal(result.usage.reasoningTokens, 150);
    }
  }
});

test('native limits trigger the existing final context guard before any provider call', async () => {
  for (const providerKind of ['anthropic', 'gemini']) {
    const f = fixture({ chatLimit: 8192, same: true, lengths: [18000] });
    f.chat.providerKind = providerKind;
    f.chat.manualContextCap = 8192;
    f.chat.parameterEnabled.maxTokens = true;
    f.chat.maxTokens = 4096;
    f.chat.additionalApiParameters = JSON.stringify(providerKind === 'anthropic'
      ? { max_tokens: 6000, thinking: { type: 'adaptive' } }
      : { generationConfig: { maxOutputTokens: 6000, thinkingConfig: { thinkingBudget: -1 } } });
    const requestParameterConfig = parameters.requestParameterConfig(f.chat);
    assert.equal(deriveEffectiveTokenBudget(requestParameterConfig).reserveTokens, 6000);
    const options = { apiSettings: f.chat, character: null, recentMessages: f.messages, requestParameterConfig };
    await assert.rejects(runtime.assertPreparedGenerationFits(options), runtime.ContextBudgetError);
    assert.equal(f.calls.length, 0);
  }
});

test('service tiers survive persistence, profile switching and immutable snapshots; old records use Auto', async () => {
  const profiles = ['auto', 'standard', 'flex', undefined, null, 'invalid'].map((serviceTier, index) => ({
    ...state.createDefaultConnection(`tier-${index}`), serviceTier,
  }));
  let saved;
  harness.invoke = async (command, args) => {
    assert.equal(command, 'save_api_connections');
    saved = args;
  };
  state.replaceApiConnections(profiles, 'tier-2');
  await connections.persistApiConnections();
  connections.hydrateApiConnections([
    { key: connections.API_CONNECTIONS_KEY, value: saved.connectionsJson },
    { key: connections.ACTIVE_API_CONNECTION_KEY, value: saved.activeConnectionId },
  ]);
  assert.deepEqual(state.appState.apiConnections.map(c => c.serviceTier), ['auto', 'standard', 'flex', 'auto', 'auto', 'auto']);
  const snapshot = state.snapshotActiveApiConnection();
  state.appState.apiSettings.serviceTier = 'standard';
  state.activateApiConnection('tier-0');
  assert.equal(snapshot.serviceTier, 'flex');
  assert.equal(state.appState.apiSettings.serviceTier, 'auto');
  assert.equal(state.createDefaultConnection().serviceTier, 'auto');
});

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
  const count = estimateBudgetTokens;
  const f = { chat, summary, messages, calls, detections, decisions, reportedUsage: null, responseText: 'Established facts.', beforeResponse: null, count,
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
        + (Object.keys(p.request_parameter_config.additionalParameters).length ? count(JSON.stringify(p.request_parameter_config.additionalParameters)) : 0);
      const capacity = resolvedHardContextLimit(summary);
      assert.ok(input + deriveEffectiveTokenBudget(p.request_parameter_config).payloadMaxTokens + summarySafetyMargin(capacity) <= capacity, 'every complete provider-bound request must fit');
      assert.equal(p.model, summary.model);
      assert.equal(p.provider_kind, summary.providerKind);
      calls.push({ ...p, input });
      await f.beforeResponse?.();
      listeners.get('ai-token')?.({ payload: { generationId: p.generation_id, token: f.responseText } });
      return f.reportedUsage;
    }
    throw new Error(`Unexpected command: ${command}`);
  };
  return f;
}

test('chat identity survives normal generation, reroll, edit retry and chat reload', async () => {
  const profile = { ...state.createDefaultConnection(), providerKind: 'openrouter' };
  const calls = [];
  harness.invoke = async (command, args) => {
    if (command === 'call_ai_api') { calls.push(args.payload); return null; }
  };
  const callbacks = { onStreamUpdate() {}, onThinkingPhaseChange() {} };
  for (const options of [
    { userPrompt: 'Hello', recentMessages: [] },
    { recentMessages: [{ id: 'user', role: 'user', content: 'Hello', swipe_index: 1 }] },
    { recentMessages: [{ id: 'user', role: 'user', content: 'Edited', swipe_index: 0 }] },
  ]) {
    harness.chatState.activeChatId = 'other-active-chat';
    await chatApi.runGeneration({ ...options, chatId: 'persisted-chat', apiSettings: profile, character: null }, callbacks);
  }
  // Reloaded chats reuse their database ID, including the active-chat fallback.
  harness.chatState.activeChatId = 'persisted-chat';
  await chatApi.runGeneration({ apiSettings: profile, character: null, recentMessages: [] }, callbacks);
  harness.chatState.activeChatId = 'different-chat';
  await chatApi.runGeneration({ apiSettings: profile, character: null, recentMessages: [] }, callbacks);
  assert.deepEqual(calls.map(p => p.chat_id), ['persisted-chat', 'persisted-chat', 'persisted-chat', 'persisted-chat', 'different-chat']);
  assert.equal(new Set(calls.map(p => p.generation_id)).size, calls.length);
});

test('rolling summary uses the same persisted chat identity with shared or separate connections', async () => {
  for (const same of [true, false]) {
    const f = fixture({ same, chatLimit: 8192, lengths: [16000, 16000, 20] });
    f.chat.providerKind = 'openrouter';
    f.summary.providerKind = 'openrouter';
    const chatId = harness.chatState.activeChatId;
    const { options, prepared } = await f.run();
    assert.ok(f.calls.length > 0);
    assert.ok(f.calls.every(p => p.chat_id === chatId));
    const invoke = harness.invoke;
    let chatPayload;
    harness.invoke = async (command, args) => {
      if (command !== 'call_ai_api') return invoke(command, args);
      chatPayload = args.payload;
      return null;
    };
    await chatApi.runGeneration({ ...options, ...prepared, chatId }, { onStreamUpdate() {}, onThinkingPhaseChange() {} });
    assert.equal(chatPayload.chat_id, chatId);
    assert.notEqual(chatPayload.generation_id, f.calls[0].generation_id);
  }
});

test('summary uses the selected profile snapshot, including overrides, without leaking chat settings', async () => {
  for (const same of [false, true]) {
    const f = fixture({ same, chatLimit: 8192, lengths: [16000, 16000, 20] });
    f.chat.additionalApiParameters = '{"reasoning_effort":"low"}';
    f.chat.temperature = 0.8;
    const selected = same ? f.chat : f.summary;
    selected.additionalApiParameters = '{"reasoning_effort":"high","max_tokens":99,"max_completion_tokens":99}';
    selected.temperature = 0.6;
    selected.parameterEnabled.temperature = true;
    f.beforeResponse = () => {
      selected.additionalApiParameters = '{"reasoning_effort":"none"}';
      selected.temperature = 0.1;
    };
    await f.run();
    assert.ok(f.calls.length > 0);
    for (const p of f.calls) {
      assert.equal(p.temperature, 0.6);
      assert.equal(p.request_parameter_config.temperatureEnabled, true);
      assert.deepEqual(p.request_parameter_config.additionalParameters, { reasoning_effort: 'high' });
      assert.ok(p.request_parameter_config.maxTokens > 99);
    }
  }
});

test('native summary keeps manual and custom thinking budgets and reserves visible output', async () => {
  for (const providerKind of ['anthropic', 'gemini', 'llama_cpp']) {
    for (const custom of [false, true]) {
      const f = fixture({ chatLimit: 8192, lengths: [16000, 16000, 20] });
      f.summary.providerKind = providerKind;
      f.summary.parameterEnabled.thinkingBudget = true;
      f.summary.thinkingBudget = 6000;
      const additional = providerKind === 'anthropic' ? { thinking: { type: 'enabled', budget_tokens: 9000 } }
        : providerKind === 'gemini' ? { generationConfig: { thinkingConfig: { thinkingBudget: 9000 }, maxOutputTokens: 99 } }
        : { thinking_budget_tokens: 9000, chat_template_kwargs: { enable_thinking: true } };
      if (custom) f.summary.additionalApiParameters = JSON.stringify(additional);
      await f.run();
      assert.ok(f.calls.length > 0);
      for (const p of f.calls) {
        const config = p.request_parameter_config;
        const budget = deriveEffectiveTokenBudget(config);
        assert.equal(config.thinkingBudget, 6000);
        assert.equal(config.thinkingBudgetEnabled, true);
        assert.equal(budget.calculation.reasoning_limit, custom ? 9000 : 6000);
        assert.equal(budget.calculation.invalid_reasoning_limit, false);
        assert.ok(budget.reserveTokens > (custom ? 9000 : 6000));
      }
    }
  }
});

test('a summary thinking budget that exceeds context never sends or commits a reduced budget', async () => {
  const f = fixture({ chatLimit: 8192, summaryLimit: 8192, lengths: [16000, 40000, 20] });
  f.summary.additionalApiParameters = '{"reasoning":{"max_tokens":12000}}';
  f.setMeta({ summary: 'Existing facts', last_id: f.messages[0].id });
  await assert.rejects(f.run(), error => {
    assert.ok(error instanceof runtime.ContextBudgetError);
    assert.match(error.message, /thinking budget/);
    return true;
  });
  assert.equal(f.calls.length, 0);
  assert.deepEqual(f.meta(), { summary: 'Existing facts', last_id: f.messages[0].id });
  assert.equal(JSON.parse(f.summary.additionalApiParameters).reasoning.max_tokens, 12000);
});

test('chat and summary requests carry their own tiers, including same-as-chat', async () => {
  for (const same of [false, true]) {
    const f = fixture({ same, chatLimit: 8192, lengths: [16000, 16000, 20] });
    for (const connection of [f.chat, f.summary]) {
      connection.providerKind = 'openai';
      connection.url = 'https://api.openai.com/v1';
    }
    f.summary.serviceTier = 'flex';
    f.chat.serviceTier = 'standard';
    const { options, prepared } = await f.run();
    assert.ok(f.calls.length > 0);
    assert.ok(f.calls.every(call => call.request_parameter_config.serviceTier === (same ? 'standard' : 'flex')));
    const invoke = harness.invoke;
    let chatPayload;
    harness.invoke = async (command, args) => {
      if (command !== 'call_ai_api') return invoke(command, args);
      chatPayload = args.payload;
      return null;
    };
    await chatApi.runGeneration({ ...options, ...prepared }, { onStreamUpdate() {}, onThinkingPhaseChange() {} });
    assert.equal(chatPayload.request_parameter_config.serviceTier, 'standard');
  }
});

test('a Flex API error propagates without a Standard retry', async () => {
  const f = fixture();
  f.chat.providerKind = 'openai';
  f.chat.url = 'https://api.openai.com/v1';
  f.chat.serviceTier = 'flex';
  let requests = 0;
  harness.invoke = async (command, args) => {
    if (command !== 'call_ai_api') return;
    requests++;
    assert.equal(args.payload.request_parameter_config.serviceTier, 'flex');
    throw new Error('429 Resource Unavailable');
  };
  await assert.rejects(chatApi.runGeneration({ apiSettings: state.snapshotActiveApiConnection(), recentMessages: [], character: null },
    { onStreamUpdate() {}, onThinkingPhaseChange() {} }), /429 Resource Unavailable/);
  assert.equal(requests, 1);
});

test('generation details bind the original profile and preserve response metadata across a settings change', async () => {
  const f = fixture({ same: true });
  f.chat.name = 'Original profile';
  const providerUsage = { inputTokens: 120, cachedInputTokens: 80, outputTokens: 30, reasoningTokens: 10,
    costUsd: 0.002, actualModel: 'resolved-model', serviceTier: 'default' };
  harness.invoke = async command => {
    assert.equal(command, 'call_ai_api');
    f.chat.name = 'Changed during generation';
    return providerUsage;
  };
  const result = await chatApi.runGeneration({ apiSettings: f.chat, recentMessages: [], character: null },
    { onStreamUpdate() {}, onThinkingPhaseChange() {} });
  assert.deepEqual(result.usage, { ...providerUsage, connectionName: 'Original profile' });
});

test('512K chat and 128K summary: summary pressure alone leaves chat history intact', async () => {
  const f = fixture({ lengths: [260000, 260000, 20] });
  const { options } = await f.run();
  assert.equal(f.calls.length, 0);
  assert.equal(options.apiSettings.contextLimit, 524288);
  assert.equal(resolvedWorkingContextTarget(options.apiSettings), 524288);
  assert.equal(f.detections.length, 2);
  assert.equal(f.meta().summary, null);
  const decision = f.decisions.find(d => d.kind === 'budget' && d.stage === 'decision');
  assert.equal(decision.summary_pressure, true);
  assert.equal(decision.trigger, 'none');
});

test('summary window chunks compression after chat capacity actually overflows', async () => {
  const f = fixture({ lengths: [800000, 800000, 20] });
  await f.run();
  assert.ok(f.calls.length > 1);
  assert.ok(f.meta().summary);
  const decision = f.decisions.find(d => d.kind === 'budget' && d.stage === 'decision');
  assert.equal(decision.measurement.total > decision.measurement.hard_limit, true);
  assert.equal(decision.summary_pressure, true);
  assert.equal(decision.trigger, 'chat');
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

test('unknown summary capacity uses 32K fallback and chunks an oversized individual message', async () => {
  const f = fixture({ summaryLimit: null, strategy: 'economy', lengths: [200000, 20] });
  await f.run();
  assert.equal(f.summary.detectedContext, null);
  assert.equal(resolvedHardContextLimit(f.summary), 32768);
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
  const f = fixture({ chatLimit: 8192, summaryLimit: 8192, lengths: [30000, 20] });
  f.beforeResponse = () => { state.appState.summaryConnectionId = SAME_AS_CHAT_CONNECTION; };
  await assert.rejects(f.run(), runtime.SummaryCancelledError);
  assert.equal(f.meta().summary, null);
});

test('small summary window sizes its output reserve and near-limit chunks safely', async () => {
  const f = fixture({ chatLimit: 8192, summaryLimit: 2048, lengths: [30000, 20] });
  await f.run();
  assert.ok(f.calls.length > 1);
  assert.ok(f.calls.every(p => deriveEffectiveTokenBudget(p.request_parameter_config).payloadMaxTokens < 2048));
  assert.ok(f.calls.some(p => p.input + deriveEffectiveTokenBudget(p.request_parameter_config).payloadMaxTokens + summarySafetyMargin(2048) >= 2040));
});

test('restored oversized summary is reprocessed for a smaller summary model', async () => {
  const f = fixture({ chatLimit: 8192, summaryLimit: 2048, lengths: [20, 40000, 20] });
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

test('32K soft input trigger is independent of 1M safety and output reserves', async () => {
  const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [14500, 14500, 100] });
  f.chat.parameterEnabled.maxTokens = true;
  f.chat.maxTokens = 8192;
  await f.run();
  const below = f.decisions.find(d => d.kind === 'budget' && d.stage === 'decision');
  assert.equal(below.working_target, 32768);
  assert.equal(below.measurement.prompt_tokens, 10946);
  assert.equal(below.measurement.safety_tokens, 20972);
  assert.equal(below.measurement.reserve_tokens, 8192);
  assert.ok(below.measurement.total > below.working_target);
  assert.equal(below.trigger, 'none');
  assert.equal(f.calls.length, 0);

  f.messages[0].content = 'x'.repeat(45000);
  f.messages[1].content = 'x'.repeat(45000);
  await f.run();
  const above = f.decisions.filter(d => d.kind === 'budget' && d.stage === 'decision').at(-1);
  assert.ok(above.measurement.prompt_tokens > above.working_target);
  assert.equal(above.trigger, 'chat');
  assert.ok(f.meta().summary);
  const compressed = f.decisions.find(d => d.kind === 'budget' && d.stage === 'after_compression');
  assert.ok(compressed.measurement.prompt_tokens <= above.compression_goal);
  assert.ok(compressed.measurement.total <= compressed.measurement.hard_limit);
});

test('hard capacity triggers below the soft input target with completion and safety reserves', async () => {
  const f = fixture({ chatLimit: 32768, same: true, lengths: [33000, 33000, 20] });
  f.chat.additionalApiParameters = JSON.stringify({ max_completion_tokens: 8192 });
  await f.run();
  const before = f.decisions.find(d => d.kind === 'budget' && d.stage === 'decision');
  assert.ok(before.measurement.prompt_tokens < before.working_target);
  assert.ok(before.measurement.total > before.measurement.hard_limit);
  assert.equal(before.trigger, 'chat');
  assert.ok(f.meta().summary);
  const after = f.decisions.find(d => d.kind === 'budget' && d.stage === 'after_compression');
  assert.ok(after.measurement.total <= after.measurement.hard_limit);
});

test('provider output usage accepts an overestimated summary and commits instead of repeating fallback', async () => {
  const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [45000, 45000, 100] });
  f.responseText = 'word '.repeat(410);
  f.reportedUsage = { inputTokens: 17000, outputTokens: 410, reasoningTokens: 0 };
  assert.ok(f.count(f.responseText) > 512);
  await f.run();
  assert.equal(f.calls.length, 1);
  assert.equal(f.meta().summary, f.responseText.trim());
  assert.ok(f.meta().last_id);
  assert.ok(f.decisions.some(d => d.state === 'result' && d.summary_tokens === 410));
  assert.ok(f.decisions.some(d => d.state === 'committed'));
  assert.ok(!f.decisions.some(d => ['recompress', 'failed', 'fallback_accepted'].includes(d.state)));
  await f.run();
  assert.equal(f.calls.length, 1, 'committed marker prevents repeating the same compression');
});

test('missing or invalid provider output usage retains conservative summary validation', async () => {
  for (const outputTokens of [undefined, null, 0, -1, 1.5, '410', Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [45000, 45000, 100] });
    f.responseText = 'word '.repeat(410);
    f.reportedUsage = { outputTokens };
    await f.run();
    assert.equal(f.calls.length, 2);
    assert.equal(f.meta().summary, null);
    assert.ok(f.decisions.some(d => d.state === 'failed' && d.reason === 'budget'));
    assert.ok(f.decisions.some(d => d.state === 'fallback_accepted'));
  }
});

test('provider output above the summary cap still requires recompression and cannot commit', async () => {
  const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [45000, 45000, 100] });
  f.reportedUsage = { outputTokens: 513, reasoningTokens: 0 };
  await f.run();
  assert.equal(f.calls.length, 2);
  assert.equal(f.meta().summary, null);
  assert.ok(f.decisions.some(d => d.state === 'recompress'));
  assert.ok(f.decisions.some(d => d.state === 'failed' && d.reason === 'budget'));
});

test('recompression also accepts provider usage instead of rejecting its local overestimate', async () => {
  const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [45000, 45000, 100] });
  f.beforeResponse = () => {
    f.reportedUsage = { outputTokens: f.calls.length === 1 ? 513 : 410, reasoningTokens: 0 };
    f.responseText = 'word '.repeat(410);
  };
  await f.run();
  assert.equal(f.calls.length, 2);
  assert.equal(f.meta().summary, f.responseText.trim());
  assert.ok(f.decisions.some(d => d.state === 'recompress'));
  assert.ok(f.decisions.some(d => d.state === 'committed'));
});

test('accepting provider output usage cannot bypass the final conservative chat capacity guard', async () => {
  const f = fixture({ chatLimit: 32768, same: true, lengths: [33000, 33000, 20] });
  f.chat.additionalApiParameters = JSON.stringify({ max_completion_tokens: 8192 });
  f.responseText = 'word '.repeat(21000);
  f.reportedUsage = { outputTokens: 410 };
  await assert.rejects(f.run(), runtime.ContextBudgetError);
  assert.equal(f.meta().summary, null);
  assert.ok(f.decisions.some(d => d.state === 'failed' && d.reason === 'budget'));
  assert.ok(f.decisions.some(d => d.state === 'fallback_rejected'));
});

test('Maximum retains near-capacity history across small and large same-model windows', async () => {
  for (const capacity of [8192, 16384, 32768, 524288, 1048576]) {
    // Fill the planning budget, including the estimator's uncertainty allowance,
    // while leaving room for generation, framing and summary instructions.
    const historyTokens = capacity - 2048 - contextSafetyMargin(capacity) - 1000;
    const f = fixture({ chatLimit: capacity, same: true,
      lengths: [Math.floor(historyTokens * 3.35 / 1.25 / 2), Math.floor(historyTokens * 3.35 / 1.25 / 2), 20] });
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
  assert.equal(state.snapshotSummaryApiConnection(state.snapshotActiveApiConnection()).contextLimit, 32768);
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
  const f = fixture({ strategy: 'economy', lengths: [100000, 20] });
  f.summary.manualContextCap = 2048;
  await f.run();
  assert.ok(f.calls.length > 1);
  assert.equal(resolvedWorkingContextTarget(f.chat), 32768);
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
  const f = fixture({ chatLimit: 8192, summaryLimit: 8192, lengths: [40000, 20] });
  f.beforeResponse = () => { f.summary.detectedContext.tokens = 2048; };
  await assert.rejects(f.run(), runtime.SummaryCancelledError);
  assert.equal(f.meta().summary, null);
});

test('diagnostics explain no-trigger, chat pressure, summary pressure and memory disabled', async () => {
  for (const [settings, trigger] of [
    [{ lengths: [100, 100, 20] }, 'none'],
    [{ chatLimit: 8192, summaryLimit: 131072, lengths: [16000, 16000, 20] }, 'chat'],
    [{ chatLimit: 524288, summaryLimit: 8192, lengths: [16000, 16000, 20] }, 'none'],
  ]) {
    const f = fixture(settings);
    await f.run();
    const decision = f.decisions.find(d => d.kind === 'budget' && d.stage === 'decision');
    assert.equal(decision.trigger, trigger);
    assert.equal(decision.measurement.total, decision.measurement.prompt_tokens + decision.measurement.reserve_tokens + decision.measurement.safety_tokens);
    assert.equal(decision.working_target, resolvedWorkingContextTarget(f.chat));
    assert.equal(decision.measurement.hard_limit, resolvedHardContextLimit(f.chat));
    if (decision.summary_pressure && trigger === 'none') {
      const pressure = f.decisions.find(d => d.kind === 'summary_capacity' && d.stage === 'pressure');
      assert.equal(pressure.fits, false);
      assert.ok(pressure.input_tokens + pressure.output_reserve + pressure.safety_tokens > pressure.hard_limit);
      assert.equal(f.calls.length, 0);
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
  const f = fixture({ chatLimit: 8192, summaryLimit: 8192, lengths: [40000, 20] });
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


test('chat listener setup cleans up when the second registration fails', async () => {
  const previous = harness.listen;
  try {
    harness.listen = async (name, callback) => {
      if (name === 'ai-thinking-token') throw new Error('listener installation failed');
      return previous(name, callback);
    };
    await assert.rejects(chatApi.runGeneration({ apiSettings: state.createDefaultConnection(), character: null, recentMessages: [] },
      { onStreamUpdate() {}, onThinkingPhaseChange() {} }), /listener installation failed/);
    assert.equal(listeners.size, 0);
  } finally { harness.listen = previous; }
});

test('stop during chat listener setup prevents the provider request', async () => {
  const previous = harness.listen;
  let cancelled = false;
  let requests = 0;
  try {
    harness.listen = async (name, callback) => { cancelled = true; return previous(name, callback); };
    harness.invoke = async command => { if (command === 'call_ai_api') requests++; };
    await assert.rejects(chatApi.runGeneration({ apiSettings: state.createDefaultConnection(), character: null,
      recentMessages: [], shouldCancel: () => cancelled }, { onStreamUpdate() {}, onThinkingPhaseChange() {} }), /cancelled/);
    assert.equal(requests, 0);
    assert.equal(listeners.size, 0);
  } finally { harness.listen = previous; }
});

test('visible answer ends native thinking and a later thought can restart it', async () => {
  const phases = [];
  harness.invoke = async (command, args) => {
    if (command !== 'call_ai_api') return;
    const generationId = args.payload.generation_id;
    listeners.get('ai-thinking-token')({ payload: { generationId, token: 'thought' } });
    listeners.get('ai-token')({ payload: { generationId, token: 'answer' } });
    listeners.get('ai-thinking-token')({ payload: { generationId, token: 'more' } });
    return null;
  };
  await chatApi.runGeneration({ apiSettings: state.createDefaultConnection(), character: null, recentMessages: [] },
    { onStreamUpdate() {}, onThinkingPhaseChange(value) { phases.push(value); } });
  assert.deepEqual(phases, [true, false, true, false]);
});


test('stop during summary listener setup prevents network and persistence', async () => {
  const f = fixture({ chatLimit: 8192, summaryLimit: 4096, lengths: [100, 24000, 100] });
  const previous = harness.listen;
  try {
    harness.listen = async (name, callback) => {
      const unlisten = await previous(name, callback);
      if (name === 'ai-thinking-token') await runtime.cancelActiveSummary(harness.chatState.activeChatId);
      return unlisten;
    };
    await assert.rejects(f.run(), runtime.SummaryCancelledError);
    assert.equal(f.calls.length, 0);
    assert.deepEqual(f.meta(), { summary: null, last_id: null });
    assert.equal(listeners.size, 0);
  } finally { harness.listen = previous; }
});

test('text rules reach provider payloads while raw responses and source history remain unchanged', async () => {
  const originalRules = state.appState.textRules;
  const profile = state.createDefaultConnection();
  const source = [{ id: 'original', role: 'assistant', content: 'old', swipe_index: 0 }];
  const rule = { id: 'regex', name: 'Replace', pattern: 'old', replacement: 'sent', flags: 'g', enabled: true, scopes: ['user', 'assistant'], targets: ['send'] };
  const rules = [rule, { ...rule, id: 'screen', replacement: 'display', targets: ['display'] }];
  state.appState.textRules = rules;
  let payload;
  const updates = [];
  harness.invoke = async (command, args) => {
    if (command !== 'call_ai_api') return;
    payload = args.payload;
    listeners.get('ai-token')?.({ payload: { generationId: payload.generation_id, token: 'old response' } });
    return null;
  };
  try {
    const options = { apiSettings: profile, character: null, recentMessages: source, userPrompt: 'old prompt', summaryMeta: { currentSummary: null, lastSummarizedMessageId: null }, textRules: structuredClone(rules) };
    const before = chatApi.generationConfigurationFingerprint(options);
    const result = await chatApi.runGeneration(options, { onStreamUpdate: text => updates.push(text), onThinkingPhaseChange() {} });
    assert.equal(payload.messages.find(message => message.role === 'assistant').content, 'sent');
    assert.equal(payload.messages.at(-1).content, 'sent prompt');
    assert.equal(result.text, 'old response');
    assert.equal(updates.at(-1), 'old response');
    assert.equal(source[0].content, 'old');
    state.appState.textRules[0].replacement = 'later';
    assert.equal(chatApi.generationConfigurationFingerprint(options), before, 'an immutable request retains its rules');
    assert.notEqual(chatApi.generationConfigurationFingerprint({ ...options, textRules: undefined }), before);
  } finally { state.appState.textRules = originalRules; }
});

test('summary receives send rules, excludes display rules and leaves persisted history intact', async () => {
  const originalRules = state.appState.textRules;
  const f = fixture({ chatLimit: 8192, summaryLimit: 8192, lengths: [12000, 12000, 20] });
  f.messages.forEach(message => { message.content = 'PRIVATE ' + message.content; });
  const original = JSON.stringify(f.messages);
  const rule = { id: 'send', name: 'Private', pattern: 'PRIVATE', replacement: 'PUBLIC', flags: 'g', enabled: true, scopes: ['user', 'assistant'], targets: ['send'] };
  state.appState.textRules = [rule, { ...rule, id: 'display', pattern: 'PUBLIC', replacement: 'SCREEN', targets: ['display'] }];
  try {
    await f.run();
    assert.ok(f.calls.length > 0);
    assert.ok(f.calls.some(call => call.messages.some(message => message.content.includes('PUBLIC'))));
    assert.ok(f.calls.every(call => call.messages.every(message => !message.content.includes('PRIVATE') && !message.content.includes('SCREEN'))));
    assert.equal(JSON.stringify(f.messages), original);
  } finally { state.appState.textRules = originalRules; }
});


test('summary generation reserves reasoning separately and validates only visible usage', async () => {
  for (const provider of ['generic_openai', 'openrouter', 'nanogpt', 'anthropic', 'gemini']) {
    const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [45000, 45000, 100] });
    f.chat.providerKind = provider;
    f.summary.providerKind = provider;
    f.responseText = 'Complete summary.';
    f.reportedUsage = { outputTokens: 1800, reasoningTokens: 1400 };
    await f.run();
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].request_parameter_config.maxTokens, 2048);
    assert.equal(f.meta().summary, f.responseText);
    assert.ok(f.decisions.some(d => d.state === 'result' && d.summary_tokens === 400));
  }
});

test('failed completion after partial summary tokens preserves existing memory and coverage', async () => {
  const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [20, 45000, 45000, 100] });
  const previous = { summary: 'Existing complete memory.', last_id: f.messages[0].id };
  f.setMeta(previous);
  f.beforeResponse = () => {
    listeners.get('ai-token')?.({ payload: { generationId: f.calls.at(-1).generation_id, token: 'Cut off at a small' } });
    throw new Error('Summary generation did not finish normally');
  };
  await f.run();
  assert.deepEqual(f.meta(), previous);
  assert.ok(f.decisions.some(d => d.state === 'failed'));
  assert.ok(!f.decisions.some(d => d.state === 'committed'));
});


test('unreported reasoning never treats combined usage as visible summary length', async () => {
  for (const reasoningTokens of [undefined, null, -1, 1.5, 1800, 1900]) {
    const f = fixture({ chatLimit: 1048576, same: true, strategy: 'economy', lengths: [45000, 45000, 100] });
    f.responseText = 'Complete summary.';
    f.reportedUsage = { outputTokens: 1800, reasoningTokens };
    await f.run();
    assert.equal(f.calls.length, 1);
    assert.equal(f.meta().summary, f.responseText);
    assert.ok(!f.decisions.some(d => d.state === 'recompress'));
  }
});

test('legacy repetition fields hydrate, retain values and switches, and persist with the stable profile contract', async () => {
  const legacy = { ...state.createDefaultConnection('legacy'), presencePenalty: 1.6 };
  delete legacy.repetitionPenalty;
  legacy.parameterEnabled.presencePenalty = true;
  delete legacy.parameterEnabled.repetitionPenalty;
  connections.hydrateApiConnections([{ key: connections.API_CONNECTIONS_KEY, value: JSON.stringify([legacy]) }]);
  assert.equal(state.appState.apiSettings.repetitionPenalty, 1.6);
  assert.equal(state.appState.apiSettings.parameterEnabled.repetitionPenalty, true);
  assert.equal(Object.hasOwn(state.appState.apiSettings, 'presencePenalty'), false);
  let saved;
  harness.invoke = async (_, args) => { saved = args; };
  await connections.persistApiConnections();
  const stored = JSON.parse(saved.connectionsJson)[0];
  assert.equal(stored.presencePenalty, 1.6);
  assert.equal(stored.parameterEnabled.presencePenalty, true);
  assert.equal(Object.hasOwn(stored, 'repetitionPenalty'), false);
  assert.equal(parameters.requestParameterConfig(state.appState.apiSettings).presencePenaltyEnabled, true);
});

test('resolved presets reach immutable request snapshots and the production prompt path', async () => {
  const source = state.createDefaultConnection();
  source.systemPrompt = 'Preset system'; source.postHistoryPrompt = 'Preset final';
  source.repetitionPenalty = 1.5; source.parameterEnabled.repetitionPenalty = true;
  source.additionalApiParameters = '{"chat_template_kwargs":{"enable_thinking":false}}';
  const preset = capturePreset(source, 'Native');
  const applied = resolvePreset(state.createDefaultConnection(), preset);
  const snapshot = state.snapshotApiConnection(applied);
  preset.prompt.system = 'Later edit'; applied.systemPrompt = 'Later profile edit';
  let payload;
  harness.invoke = async (command, args) => { if (command === 'call_ai_api') payload = args.payload; return null; };
  await chatApi.runGeneration({ apiSettings: snapshot, character: { name: 'Rin', prompt: 'Card' }, recentMessages: [], userPrompt: 'Hi' },
    { onStreamUpdate() {}, onThinkingPhaseChange() {} });
  assert.ok(payload.messages[0].content.startsWith('Preset system'));
  assert.deepEqual(payload.messages.at(-1), { role: 'system', content: 'Preset final' });
  assert.equal(payload.presence_penalty, 1.5);
  assert.equal(payload.request_parameter_config.presencePenaltyEnabled, true);
  assert.deepEqual(payload.request_parameter_config.additionalParameters, { chat_template_kwargs: { enable_thinking: false } });
});
