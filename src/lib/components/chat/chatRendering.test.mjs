import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';
import { compileModule } from 'svelte/compiler';

let instance = 0;
function declarations(filename, names) {
  const script = readFileSync(new URL(filename, import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile(filename + '.ts', script, ts.ScriptTarget.Latest, true);
  return ast.statements.filter(statement => ts.isVariableStatement(statement)
    && names.includes(statement.declarationList.declarations[0].name.getText(ast)))
    .map(statement => statement.getText(ast)).join('\n');
}

// Run the production derived expressions with real Svelte dependency tracking,
// without mounting a component, starting the app or creating a browser/DOM.
async function reactiveModule(source) {
  const js = ts.transpile(source, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext });
  const compiled = compileModule(js, { filename: 'rendering.svelte.js', generate: 'client', dev: false }).js.code
    .replace(/(['"])svelte\/internal\/client\1/g, JSON.stringify(import.meta.resolve('svelte/internal/client')));
  return import(`data:text/javascript;base64,${Buffer.from(compiled + `\n// instance ${++instance}`).toString('base64')}`);
}

async function room() {
  return reactiveModule(`
    export const chatState = $state({ currentMessages: Array.from({ length: 25 }, (_, i) => ({
      id: String(i), role: i % 2 ? 'user' : 'assistant', content: 'message ' + i,
      swipe_variants: ['message ' + i, 'alternative'], swipe_index: 0, usage_variants: [{ inputTokens: i }, null],
    })) });
    export const appState = $state({ activeCharacter: { name: 'Rin' } });
    const m = { chat_sender_you: () => 'You', chat_sender_ai: () => 'AI' };
    export let mappings = 0;
    const selectedUsage = msg => { mappings++; return msg.usage_variants[msg.swipe_index]; };
    ${declarations('./ChatRoom.svelte', ['isGenerating', 'isThinkingPhase', 'streamingText', 'retryingMsgId', 'generationError', 'persistedDisplayMessages', 'displayMessages'])}
    export function read() { return displayMessages; }
    export function stream(text, retry = null) { isGenerating = true; retryingMsgId = retry; streamingText = text; }
    export function thinking(value) { isThinkingPhase = value; }
    export function stop(error = null) { isGenerating = false; retryingMsgId = null; generationError = error; }
  `);
}

test('40 stream updates retain all 25 persisted display objects and map history only once', async () => {
  const c = await room();
  const original = c.read();
  for (let i = 0; i < 40; i++) {
    c.stream('answer ' + i);
    const messages = c.read();
    assert.equal(messages.length, 26);
    original.forEach((message, index) => assert.equal(messages[index], message));
    assert.equal(messages.at(-1).text, 'answer ' + i);
  }
  assert.equal(c.mappings, 25);
  c.thinking(true);
  assert.equal(c.read().length, 25);
  c.stop();
  original.forEach((message, index) => assert.equal(c.read()[index], message));
});

test('retry changes only its display row and never mutates committed variants or usage', async () => {
  const c = await room();
  const original = c.read();
  for (let i = 0; i < 40; i++) {
    c.stream('retry ' + i, '24');
    const messages = c.read();
    original.slice(0, 24).forEach((message, index) => assert.equal(messages[index], message));
    assert.equal(messages[24].text, 'retry ' + i);
    assert.equal(messages[24].usage, null);
    assert.equal(messages[24].swipeIndex, 2);
    assert.deepEqual([...messages[24].swipeVariants], ['message 24', 'alternative', 'retry ' + i]);
  }
  assert.equal(c.mappings, 25);
  assert.equal(c.chatState.currentMessages[24].content, 'message 24');
  assert.equal(c.chatState.currentMessages[24].swipe_variants.length, 2);
  c.stop({ message: 'retry failed' });
  assert.equal(c.read()[24], original[24]);
  assert.equal(c.read()[24].usage.inputTokens, 24);
  assert.equal(c.read().at(-1).generationError.message, 'retry failed');
});

test('persisted edits, swipes, usage and sender names remain reactive', async () => {
  const c = await room();
  c.read();
  c.chatState.currentMessages[24].content = 'edited';
  c.chatState.currentMessages[24].swipe_index = 1;
  c.appState.activeCharacter.name = 'Changed';
  const messages = c.read();
  assert.equal(messages[24].text, 'edited');
  assert.equal(messages[24].swipeIndex, 1);
  assert.equal(messages[24].usage, null);
  assert.equal(messages[24].senderName, 'Changed');
});

test('Markdown is cached per displayed text while rule, scope and text changes still invalidate it', async () => {
  const c = await reactiveModule(`
    import { transformMessageText } from ${JSON.stringify(new URL('../../ai/prompt/textRules.ts', import.meta.url).href)};
    let msg = $state({ text: 'old', isUser: false, usage: null });
    export const appState = $state({ textRules: [] });
    export let parses = 0;
    const renderMessageMarkdown = text => { parses++; return 'html:' + text; };
    ${declarations('./ChatMessage.svelte', ['displayText', 'cleanHtml'])}
    export function read() { return cleanHtml; }
    export function replace(row) { msg = row; }
  `);
  assert.equal(c.read(), 'html:old');
  for (let i = 0; i < 40; i++) { c.replace({ text: 'old', isUser: false, usage: { inputTokens: i } }); c.read(); }
  assert.equal(c.parses, 1);
  c.appState.textRules = [{ id: 'r', name: 'rule', pattern: 'old', replacement: 'new', flags: 'g', enabled: true, scopes: ['assistant'], targets: ['display'] }];
  assert.equal(c.read(), 'html:new');
  assert.equal(c.parses, 2);
  c.replace({ text: 'old', isUser: true });
  assert.equal(c.read(), 'html:old');
  c.replace({ text: 'edited', isUser: true });
  assert.equal(c.read(), 'html:edited');
  c.appState.textRules[0].replacement = 'irrelevant';
  c.read();
  assert.equal(c.parses, 4);
});
