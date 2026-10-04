import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { buildPromptMessages } from '../utils/chatPromptBuilder.ts';

function store(overrides = {}) {
  const source = readFileSync(new URL('./chatStore.svelte.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('chatStore.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const libraryCard = { id: 'card', name: 'Original', prompt: 'Original prompt', greeting: 'Hello',
    initials: 'OR', color: 'blue', world_info_ids: ['world'] };
  const snapshots = new Map();
  const chats = [];
  const calls = [];
  const context = vm.createContext({
    $state: value => value, getLocale: () => 'en', reportDiagnostic() {},
    appState: { activeCharacter: libraryCard }, characterState: { allCharacters: [libraryCard] },
    loadCharacters: async () => {}, selectInitialGreeting: character => character.greeting,
    decodeMessage: row => row,
    invoke: async (command, params) => {
      calls.push({ command, params });
      if (overrides.invoke) await overrides.invoke(command, params);
      if (command === 'update_chat_character_snapshot') {
        snapshots.set(params.chatId, structuredClone(params.snapshot));
        return structuredClone(params.snapshot);
      }
      if (command === 'create_chat') {
        const id = `chat-${chats.length}`;
        snapshots.set(id, structuredClone(params.characterSnapshot));
        chats.push({ id, character_id: 'card', mode: 'singleplayer', created_at: '2026-01-01', role_snapshot: null });
        return id;
      }
      if (command === 'clone_chat_from_message') {
        const id = 'branch';
        snapshots.set(id, structuredClone(snapshots.get(params.chatId)));
        chats.push({ ...chats[0], id });
        return id;
      }
      if (command === 'get_chat_character_snapshot') return structuredClone(snapshots.get(params.chatId));
      if (command === 'get_conversations_page') return chats;
      if (command === 'get_summary_meta') return { summary: null, last_id: null };
      return [];
    },
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, libraryCard, calls, state: vm.runInContext('chatState', context) };
}

test('reopened chat uses its original character for info and generation after library edits or deletion', async () => {
  const c = store();
  await c.context.startNewChat(c.libraryCard);
  assert.notEqual(c.context.appState.activeCharacter, c.libraryCard);
  c.libraryCard.prompt = 'Edited prompt';
  c.libraryCard.name = 'Edited';
  c.libraryCard.world_info_ids.push('another-world');
  await c.context.startNewChat(c.libraryCard);
  assert.equal(c.context.appState.activeCharacter.prompt, 'Edited prompt');
  c.context.characterState.allCharacters = [];
  await c.context.openHistoryChat('chat-0');
  const character = c.context.appState.activeCharacter;
  assert.equal(character.name, 'Original');
  assert.equal(character.prompt, 'Original prompt');
  assert.deepEqual(character.world_info_ids, ['world']);
  const messages = buildPromptMessages({ character, recentMessages: [], worldInfos: [] });
  assert.match(messages[0].content, /Original prompt/);
  assert.doesNotMatch(messages[0].content, /Edited prompt/);
});

test('opening a branch resolves the copied snapshot instead of the current lobby card', async () => {
  const c = store();
  await c.context.startNewChat(c.libraryCard);
  c.libraryCard.prompt = 'Edited prompt';
  const branch = await c.context.cloneChatFromMessage('message');
  await c.context.loadMessages(branch);
  assert.equal(c.state.activeChatId, 'branch');
  assert.equal(c.context.appState.activeCharacter.prompt, 'Original prompt');
});

test('multiplayer keeps its separate session character restoration', async () => {
  const c = store();
  c.state.conversations.push({ id: 'multiplayer', character_id: 'card', mode: 'multiplayer' });
  await c.context.openHistoryChat('multiplayer');
  assert.equal(c.context.appState.activeCharacter, c.libraryCard);
  assert.equal(c.calls.some(call => call.command === 'get_chat_character_snapshot'), false);
});

test('editing a snapshot immediately updates generation and survives reopening without changing sibling chats or the library', async () => {
  const c = store();
  await c.context.startNewChat(c.libraryCard);
  await c.context.startNewChat(c.libraryCard);
  await c.context.openHistoryChat('chat-0');
  const draft = structuredClone(c.context.appState.activeCharacter);
  draft.name = 'Chat character';
  draft.prompt = 'Chat-specific prompt';
  draft.greeting = 'Chat greeting';
  draft.avatarUrl = 'data:image/png;base64,test';
  draft.world_info_ids = ['new-world'];
  // Editing the detached draft must not change the live chat before saving.
  assert.equal(c.context.appState.activeCharacter.prompt, 'Original prompt');
  await c.context.updateChatCharacterSnapshot('chat-0', draft);
  assert.equal(c.context.appState.activeCharacter.name, 'Chat character');
  const messages = buildPromptMessages({ character: c.context.appState.activeCharacter, recentMessages: [], worldInfos: [] });
  assert.match(messages[0].content, /Chat-specific prompt/);
  assert.doesNotMatch(messages[0].content, /Original prompt/);
  assert.equal(c.libraryCard.prompt, 'Original prompt');
  assert.deepEqual(c.libraryCard.world_info_ids, ['world']);
  await c.context.openHistoryChat('chat-1');
  assert.equal(c.context.appState.activeCharacter.prompt, 'Original prompt');
  await c.context.openHistoryChat('chat-0');
  assert.deepEqual(c.context.appState.activeCharacter, draft);
  const branch = await c.context.cloneChatFromMessage('message');
  await c.context.openHistoryChat(branch);
  assert.equal(c.context.appState.activeCharacter.prompt, 'Chat-specific prompt');
  draft.prompt = 'Later edit';
  await c.context.updateChatCharacterSnapshot('chat-0', draft);
  assert.equal(c.context.appState.activeCharacter.prompt, 'Chat-specific prompt');
});

test('failed snapshot persistence leaves the active character untouched', async () => {
  const c = store({ invoke: async command => {
    if (command === 'update_chat_character_snapshot') throw new Error('Disk error');
  } });
  await c.context.startNewChat(c.libraryCard);
  const original = c.context.appState.activeCharacter;
  await assert.rejects(c.context.updateChatCharacterSnapshot('chat-0', { ...original, prompt: 'Edited' }), /Disk error/);
  assert.equal(c.context.appState.activeCharacter, original);
});

test('a save finishing after switching chats cannot replace the new active character', async () => {
  let finish;
  const c = store({ invoke: command => {
    if (command === 'update_chat_character_snapshot') return new Promise(resolve => { finish = resolve; });
  } });
  await c.context.startNewChat(c.libraryCard);
  const saving = c.context.updateChatCharacterSnapshot('chat-0', { ...c.context.appState.activeCharacter, prompt: 'Edited' });
  await c.context.startNewChat(c.libraryCard);
  const original = c.context.appState.activeCharacter;
  finish();
  await saving;
  assert.equal(c.context.appState.activeCharacter, original);
  await c.context.openHistoryChat('chat-0');
  assert.equal(c.context.appState.activeCharacter.prompt, 'Edited');
});
