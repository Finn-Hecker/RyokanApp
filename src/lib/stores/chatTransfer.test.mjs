import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function store(failImport = false) {
  const source = readFileSync(new URL('./chatStore.svelte.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('store.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(s => !ts.isImportDeclaration(s) && !ts.isExportDeclaration(s))
    .map(s => s.getText(ast).replace(/^export /, '')).join('\n');
  const calls = [];
  const traces = [];
  const character = { id: 'card', name: 'Rain', prompt: 'Prompt', greeting: 'Hello', initials: 'RA', color: 'blue' };
  const context = vm.createContext({
    $state: value => value, getLocale: () => 'en', reportDiagnostic() {},
    reportChatExportStage: (stage, phase) => traces.push([stage, phase]),
    appState: {}, characterState: { allCharacters: [character] }, loadCharacters: async () => {},
    loadWorldInfos: async () => calls.push(['loadWorldInfos']),
    invoke: async (command, params) => {
      calls.push([command, params]);
      if (command === 'export_chat_json') return '{"schema":"ryokan.chat"}';
      if (command === 'import_chat_json') {
        if (failImport) throw new Error('Unsupported Ryokan chat schema or version');
        return { id: 'new-chat', mode: 'singleplayer', folder_id: null, created_at: '2026-01-01', updated_at: '2026-01-01' };
      }
      return [];
    },
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, calls, traces, state: vm.runInContext('chatState', context) };
}

test('export prepares the legacy character snapshot and reads native persisted history', async () => {
  const { context, calls } = store();
  assert.equal(await context.exportConversationJson({ id: 'chat', mode: 'singleplayer', character_id: 'card' }), '{"schema":"ryokan.chat"}');
  assert.deepEqual(calls.map(c => c[0]), ['get_chat_character_snapshot', 'export_chat_json']);
  assert.equal(calls[0][1].fallback.prompt, 'Prompt');
  assert.equal(calls[0][1].traceExport, true);
  await assert.rejects(context.exportConversationJson({ mode: 'multiplayer' }));
  assert.equal(calls.length, 2);
});

test('preparation diagnostics identify the failing stage and preserve the original rejection', async () => {
  for (const failingStage of ['prepare', 'snapshot_ipc', 'export_ipc', null]) {
    const { context, traces } = store();
    const originalError = new Error('PRIVATE chat content, path, and URL');
    const invoke = context.invoke;
    context.invoke = async (command, args) => {
      if ((command === 'get_chat_character_snapshot' && failingStage === 'snapshot_ipc')
        || (command === 'export_chat_json' && failingStage === 'export_ipc')) throw originalError;
      return invoke(command, args);
    };
    // Snapshot construction is local preparation, before the snapshot IPC.
    if (failingStage === 'prepare') context.characterState.allCharacters[0].world_info_ids = 7;
    const pending = context.exportConversationJson({ id: 'chat', mode: 'singleplayer', character_id: 'card' });
    if (failingStage === 'prepare') await assert.rejects(pending, vm.runInContext('TypeError', context));
    else if (failingStage) await assert.rejects(pending, error => error === originalError);
    else await pending;
    const expected = [];
    for (const stage of ['prepare', 'snapshot_ipc', 'export_ipc']) {
      expected.push([stage, 'entered'], [stage, stage === failingStage ? 'failed' : 'completed']);
      if (stage === failingStage) break;
    }
    assert.deepEqual(traces, expected);
    assert.equal(JSON.stringify(traces).includes('PRIVATE'), false);
  }
});

test('import refreshes the library while preserving the currently open conversation', async () => {
  const { context, calls, state } = store();
  state.activeChatId = 'current-chat';
  const messages = state.currentMessages = [{ id: 'current-message', content: 'Keep this history visible' }];
  const role = state.activeRoleSnapshot = { name: 'Current role', prompt: 'Keep current persona' };
  const summary = state.summaryMeta = { currentSummary: 'Current summary', lastSummarizedMessageId: 'current-message' };
  const character = context.appState.activeCharacter = { name: 'Current character' };
  assert.equal(await context.importConversationJson('native JSON'), 'new-chat');
  assert.deepEqual(calls.map(c => c[0]), ['import_chat_json', 'loadWorldInfos', 'get_conversations_page', 'get_chat_folders']);
  assert.equal(state.conversations[0].id, 'new-chat');
  assert.equal(state.activeChatId, 'current-chat');
  assert.equal(state.currentMessages, messages);
  assert.equal(state.activeRoleSnapshot, role);
  assert.equal(state.summaryMeta, summary);
  assert.equal(context.appState.activeCharacter, character);
});

test('rejected imports propagate without modifying or reloading the conversation library', async () => {
  const { context, calls, state } = store(true);
  await assert.rejects(context.importConversationJson('{}'), /Unsupported/);
  assert.deepEqual(calls.map(c => c[0]), ['import_chat_json']);
  assert.equal(state.conversations.length, 0);
});

test('an imported row outside the first page neither skips nor duplicates paginated chats', async () => {
  const { context, calls, state } = store();
  const invoke = context.invoke;
  let page = 0;
  const row = id => ({ id, mode: 'singleplayer', folder_id: null, created_at: '2026-01-01' });
  context.invoke = async (command, params) => {
    const result = await invoke(command, params);
    if (command !== 'get_conversations_page') return result;
    if (page++ === 0) return Array.from({ length: 10 }, (_, i) => row(`page1-${i}`));
    if (page === 2) return [row('new-chat'), ...Array.from({ length: 9 }, (_, i) => row(`page2-${i}`))];
    return [];
  };
  await context.importConversationJson('native JSON');
  assert.equal(state.conversations.length, 11);
  await context.loadMoreConversations('singleplayer');
  assert.equal(state.conversations.length, 20);
  assert.equal(state.conversations.filter(chat => chat.id === 'new-chat').length, 1);
  await context.loadMoreConversations('singleplayer');
  assert.deepEqual(calls.filter(c => c[0] === 'get_conversations_page').map(c => c[1].offset), [0, 10, 20]);
});

test('successful sidebar import keeps the current screen and drawer without opening the new chat', async () => {
  const source = readFileSync(new URL('../components/sidebar/SidebarBase.svelte', import.meta.url), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('sidebar.ts', script, ts.ScriptTarget.Latest, true);
  const handler = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'importChat');
  const calls = [];
  const context = vm.createContext({
    importConversationJson: async json => { calls.push(['import', json]); return 'new-chat'; },
    loadChat: async id => calls.push(['open', id]),
    navigateTo: screen => calls.push(['navigate', screen]),
    close: () => calls.push(['close']),
    m: { chat_import_error: () => 'Import error' },
  });
  vm.runInContext(`let transferBusy = false; let transferError = '';\n${ts.transpile(handler.getText(ast), { target: ts.ScriptTarget.ES2022 })}`, context);
  const input = { value: 'selected-file', files: [{ size: 10, text: async () => 'native JSON' }] };
  await context.importChat({ currentTarget: input });
  assert.deepEqual(calls, [['import', 'native JSON']]);
  assert.equal(input.value, '');
  assert.equal(vm.runInContext('transferBusy', context), false);
  assert.equal(vm.runInContext('transferError', context), '');
});

test('sidebar export selects the native save path and distinguishes preparation from save failures', async () => {
  const source = readFileSync(new URL('../components/sidebar/SidebarBase.svelte', import.meta.url), 'utf8');
  const script = source.match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('sidebar.ts', script, ts.ScriptTarget.Latest, true);
  const handler = ast.statements.find(s => ts.isFunctionDeclaration(s) && s.name?.text === 'exportChat');
  for (const interactionMode of ['mobile', 'desktop']) {
    for (const failure of ['serialize', 'save', 'cancel', 'none']) {
      const calls = [];
      const json = '{"schema":"ryokan.chat","text":"Grüße 🌸"}';
      const context = vm.createContext({
        interactionMode, TextEncoder, closeContextMenu() {},
        // A desktop-style UA must never divert an Android native export.
        navigator: { userAgent: 'Mozilla/5.0 (Linux; x86_64)' },
        exportConversationJson: async () => {
          if (failure === 'serialize') throw new Error('private conversation');
          return json;
        },
        exportFile: async (...args) => {
          calls.push(args);
          if (failure === 'save') throw new Error('content://private-document');
          return failure !== 'cancel';
        },
        m: { chat_export_error: () => 'Preparation failed', chat_export_save_error: () => 'Save failed' },
      });
      vm.runInContext(`let transferBusy = false; let transferError = '';\n${ts.transpile(handler.getText(ast), { target: ts.ScriptTarget.ES2022 })}`, context);
      await context.exportChat({ id: 'chat' });
      assert.equal(vm.runInContext('transferBusy', context), false);
      assert.equal(vm.runInContext('transferError', context),
        failure === 'serialize' ? 'Preparation failed' : failure === 'save' ? 'Save failed' : '');
      assert.equal(calls.length, failure === 'serialize' ? 0 : 1);
      if (calls.length) {
        assert.equal(new TextDecoder().decode(calls[0][0]), json);
        assert.equal(calls[0][1], 'ryokan-chat.json');
        assert.equal(calls[0][4], interactionMode === 'mobile');
      }
    }
  }
});
