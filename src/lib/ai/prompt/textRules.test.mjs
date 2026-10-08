import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { applyTextRules, previewTextRule, transformMessageText, parseTextRules, serializeTextRules, snapshotTextRules, TEXT_RULES_KEY, TEXT_RULE_TEMPLATES } from './textRules.ts';
import { buildPromptMessages } from './chatPromptBuilder.ts';

const rule = (overrides = {}) => ({ id: 'one', name: 'Test', pattern: 'old', replacement: 'new', flags: 'g', enabled: true, scopes: ['user', 'assistant', 'reasoning', 'lorebook'], targets: ['display', 'send'], ...overrides });

test('native regex supports captures, named groups, lookarounds, replacement tokens and flags', () => {
  assert.deepEqual(previewTextRule('Ada: HELLO\nBen: WORLD', rule({ pattern: '^(?<name>\\w+): (\\w+)$', replacement: '$2 ($<name>) $$ $&', flags: 'gm' })),
    { text: 'HELLO (Ada) $ Ada: HELLO\nWORLD (Ben) $ Ben: WORLD', matches: 2, error: null });
  assert.equal(previewTextRule('OLD old', rule({ flags: 'i' })).text, 'new old');
  assert.equal(previewTextRule('OLD old', rule({ flags: 'gi' })).matches, 2);
  assert.equal(previewTextRule('a\nb', rule({ pattern: 'a.b', flags: 's' })).matches, 1);
  assert.equal(previewTextRule('a1 b2', rule({ pattern: '(?<=a)\\d', replacement: 'X' })).text, 'aX b2');
  assert.equal(previewTextRule('🦊', rule({ pattern: '\\p{Emoji}', flags: 'gu', replacement: 'fox' })).text, 'fox');
  assert.equal(previewTextRule('old old', rule({ flags: 'y' })).text, 'new old');
});

test('preview counts empty matches safely and does not reuse regex lastIndex', () => {
  assert.deepEqual(previewTextRule('🦊', rule({ pattern: '(?:)', flags: 'gu', replacement: '|' })), { text: '|🦊|', matches: 2, error: null });
  const r = rule();
  assert.equal(previewTextRule('old old', r).matches, 2);
  assert.equal(previewTextRule('old old', r).matches, 2);
  assert.equal(previewTextRule('nothing', r).matches, 0);
});

test('rules execute in list order and skip disabled, invalid and unrelated rules', () => {
  const rules = [rule({ enabled: false, replacement: 'disabled' }), rule({ pattern: '[' }), rule({ flags: 'gg' }), rule({ targets: ['display'], replacement: 'display' }), rule({ scopes: ['lorebook'], replacement: 'lore' }), rule(), rule({ id: 'two', pattern: 'new', replacement: 'final' })];
  assert.equal(applyTextRules('old old', rules, 'user', 'send'), 'final final');
  assert.equal(applyTextRules('old', [rules.at(-1), rule()], 'user', 'send'), 'new');
  assert.equal(previewTextRule('old', rule({ pattern: '[' })).text, 'old');
  assert.ok(previewTextRule('old', rule({ flags: 'uv' })).error);
});

test('all four scopes and both targets are independent', () => {
  for (const scope of ['user', 'assistant', 'reasoning', 'lorebook']) {
    for (const target of ['display', 'send']) {
      const r = rule({ scopes: [scope], targets: [target] });
      for (const testedScope of ['user', 'assistant', 'reasoning', 'lorebook']) {
        for (const testedTarget of ['display', 'send']) assert.equal(applyTextRules('old', [r], testedScope, testedTarget), testedScope === scope && testedTarget === target ? 'new' : 'old');
      }
    }
  }
});

test('AI and reasoning scopes apply to separate segments, including unfinished reasoning', () => {
  const text = '<think>old</think>old<|channel>old<channel|>old';
  assert.equal(transformMessageText(text, [rule({ scopes: ['assistant'] })], 'assistant', 'display'), '<think>old</think>new<|channel>old<channel|>new');
  assert.equal(transformMessageText(text, [rule({ scopes: ['reasoning'] })], 'assistant', 'display'), '<think>new</think>old<|channel>new<channel|>old');
  assert.equal(transformMessageText('old<think>old', [rule({ scopes: ['reasoning'] })], 'assistant', 'send'), 'old<think>new');
  assert.equal(transformMessageText('<think>old</think>', [rule({ scopes: ['user'] })], 'user', 'display'), '<think>new</think>');
});

test('templates compile, produce normal editable rules and transform their examples', () => {
  for (const template of TEXT_RULE_TEMPLATES) {
    const result = previewTextRule(template.example, template);
    assert.equal(result.error, null, template.id);
    assert.ok(result.matches > 0, template.id);
    assert.notEqual(result.text, template.example, template.id);
  }
});

test('versioned persistence preserves order, disabled state, scopes, targets and arbitrary regex strings', () => {
  const rules = [rule({ replacement: '$<name>\n\\$1', pattern: '(?<name>\\p{L}+)', flags: 'gu' }), rule({ id: 'two', enabled: false, pattern: '[', scopes: ['reasoning'], targets: ['send'] })];
  assert.deepEqual(parseTextRules(serializeTextRules(rules)), rules);
  for (const invalid of [null, '', '{', '[]', '{"version":2,"rules":[]}', '{"version":1,"rules":{}}']) assert.deepEqual(parseTextRules(invalid), []);
  assert.deepEqual(parseTextRules(JSON.stringify({ version: 1, rules: [null, {}, rule({ scopes: ['system'] }), rule(), rule()] })), [rule()]);
  const snapshot = snapshotTextRules(rules);
  rules[0].replacement = 'changed'; rules[0].scopes.push('lorebook');
  assert.notEqual(snapshot[0].replacement, rules[0].replacement);
  assert.equal(snapshot[0].scopes.length, 4);
});

test('production prompt transforms history, new messages and selected lore without changing originals or system text', () => {
  const options = {
    character: { name: 'old', prompt: 'old system', world_info_ids: ['book'] },
    recentMessages: [{ id: 'u', role: 'user', content: 'old user' }, { id: 'a', role: 'assistant', content: '<think>old private</think>old AI' }],
    userPrompt: 'old latest', worldInfos: [{ id: 'book', entries: [{ keys: ['new latest'], content: 'old lore', enabled: true, position: 'after' }, { keys: ['never'], content: 'old hidden', enabled: true, position: 'before' }] }],
    textRules: [rule({ targets: ['display'], replacement: 'screen' }), rule({ scopes: ['user', 'assistant'], targets: ['send'] }), rule({ id: 'lore', scopes: ['lorebook'], targets: ['send'], replacement: 'lore-new' })],
  };
  const original = JSON.stringify(options);
  const messages = buildPromptMessages(options);
  assert.match(messages[0].content, /old system/);
  assert.equal(messages[1].content, 'new user');
  assert.equal(messages[2].content, 'new AI');
  assert.match(messages[3].content, /lore-new lore/);
  assert.ok(messages[3].content.endsWith('new latest'));
  assert.ok(messages.every(message => !message.content.includes('screen') && !message.content.includes('private') && !message.content.includes('old hidden')));
  assert.equal(JSON.stringify(options), original);
  assert.equal(transformMessageText(options.recentMessages[0].content, options.textRules, 'user', 'display'), 'screen user');
});

function settingsFunctions() {
  const source = readFileSync(new URL('../../components/settings/SettingsPage.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('SettingsPage.ts', source, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(node => ts.isFunctionDeclaration(node) && ['loadSettings', 'saveSettings'].includes(node.name.text)).map(node => node.getText(ast)).join('\n');
}

test('Settings saves the ordered payload via existing settings persistence and reloads it', async () => {
  const saved = new Map();
  const rules = [rule({ id: 'second', enabled: false }), rule()];
  const appState = { textRules: rules, apiSettings: { parameterEnabled: {}, contextLimit: 100 }, pendingUiLocale: '' };
  const context = vm.createContext({
    appState, TEXT_RULES_KEY, parseTextRules, serializeTextRules, parameterEnabled: {}, powerUser: false,
    LONG_TERM_MEMORY_KEY: 'memory', SUMMARY_CONNECTION_KEY: 'summary', isSaving: false, settingsReady: false,
    additionalApiParametersValidation: { valid: true }, persistApiConnections: async () => {},
    saveSetting: async (key, value) => saved.set(key, value), getAllSettings: async () => [...saved].map(([key, value]) => ({ key, value })),
    hydrateApiConnections: () => {}, resolvedHardContextLimit: () => 100, goBack: () => {}, reportDiagnostic: () => assert.fail('Unexpected diagnostic'),
  });
  vm.runInContext(ts.transpile(settingsFunctions(), { target: ts.ScriptTarget.ES2022 }), context);
  await context.loadSettings();
  appState.textRules = rules;
  await context.saveSettings();
  assert.deepEqual(parseTextRules(saved.get(TEXT_RULES_KEY)), rules);
  appState.textRules = [];
  await context.loadSettings();
  assert.deepEqual(appState.textRules, rules);
  assert.equal(context.settingsReady, true);
});

test('editor keeps drafts isolated, supports creation, replacement and drag previews', () => {
  const source = readFileSync(new URL('../../components/settings/TextRulesSection.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('TextRulesSection.ts', source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const appState = { textRules: [rule(), rule({ id: 'two', name: 'Second' })] };
  const context = vm.createContext({ appState, crypto: { randomUUID: () => 'created' }, templates: { name: 'Remove name' }, draft: null, sample: '', choosingTemplate: false, mobile: false, sampleOpen: true, preview: { error: null }, validSelection: true, previewOrder: null, draggingId: null });
  vm.runInContext(ts.transpile(functions, { target: ts.ScriptTarget.ES2022 }), context);
  context.edit(appState.textRules[0]);
  context.draft.scopes.push('user'); context.draft.name = 'Edited';
  assert.equal(appState.textRules[0].name, 'Test');
  assert.equal(appState.textRules[0].scopes.length, 4);
  context.commit();
  assert.equal(appState.textRules[0].id, 'one');
  assert.equal(appState.textRules[0].name, 'Edited');
  context.previewMove('two', 0);
  assert.equal(appState.textRules[0].id, 'one');
  context.finishMove(true);
  assert.deepEqual(Array.from(appState.textRules, r => r.id), ['two', 'one']);
  context.previewMove('two', -1);
  context.finishMove(true);
  assert.equal(appState.textRules[0].id, 'two');
  context.create(TEXT_RULE_TEMPLATES.find(template => template.id === 'name'));
  context.commit();
  assert.equal(appState.textRules.at(-1).id, 'created');
  assert.deepEqual(Array.from(appState.textRules.at(-1).targets), ['display']);
  context.draft.name = 'Invalid'; context.preview.error = 'Invalid regex';
  context.commit();
  assert.equal(appState.textRules.at(-1).name, 'Remove name');
});


test('drag cancellation keeps execution order; committed order survives persistence and reaches display/send prompts', () => {
  const source = readFileSync(new URL('../../components/settings/TextRulesSection.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('rules.ts', source, ts.ScriptTarget.Latest, true);
  const functions = ast.statements.filter(node => ts.isFunctionDeclaration(node)).map(node => node.getText(ast)).join('\n');
  const appState = { textRules: [rule(), rule({ id: 'two', pattern: 'new', replacement: 'final' }), rule({ id: 'three', enabled: false })] };
  const context = vm.createContext({ appState, previewOrder: null, draggingId: null });
  vm.runInContext(ts.transpile(functions, { target: ts.ScriptTarget.ES2022 }), context);
  context.previewMove('one', 2);
  context.finishMove(false);
  assert.deepEqual(appState.textRules.map(r => r.id), ['one', 'two', 'three']);
  context.previewMove('two', 0);
  context.finishMove(true);
  const reloaded = parseTextRules(serializeTextRules(appState.textRules));
  assert.deepEqual(reloaded.map(r => r.id), ['two', 'one', 'three']);
  for (const target of ['display', 'send']) assert.equal(transformMessageText('old', reloaded, 'user', target), 'new');
  const messages = buildPromptMessages({ character: null, worldInfos: [], recentMessages: [{ role: 'user', content: 'old' }], userPrompt: 'old', textRules: reloaded });
  assert.equal(messages.at(-1).content, 'new');
  assert.equal(messages.find(message => message.role === 'user').content, 'new');
  context.previewMove('one', 999);
  context.finishMove(true);
  assert.equal(appState.textRules.at(-1).id, 'one');
});
