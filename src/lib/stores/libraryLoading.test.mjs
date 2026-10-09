import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function store(filename, globals) {
  const ast = ts.createSourceFile(filename, readFileSync(new URL(filename, import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const context = vm.createContext({ $state: value => value, reportDiagnostic() {}, ...globals });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, read: expression => vm.runInContext(expression, context) };
}

test('World Info readiness shares the startup request, caches success and explicit refresh stays fresh', async () => {
  let finish, calls = 0;
  const c = store('./worldInfoStore.svelte.ts', { DEFAULT_WORLD_INFOS: [], invoke: () => { calls++; return new Promise(resolve => { finish = resolve; }); } });
  const first = c.context.loadWorldInfos();
  assert.equal(c.context.ensureWorldInfosLoaded(), first);
  assert.equal(c.context.loadWorldInfos(), first);
  finish([{ id: 'first', entries: [] }]); await first;
  const state = c.read('worldInfoState');
  const entries = state.allWorldInfos;
  await c.context.ensureWorldInfosLoaded();
  assert.equal(calls, 1);
  assert.equal(state.allWorldInfos, entries);
  const refresh = c.context.loadWorldInfos();
  assert.equal(c.context.ensureWorldInfosLoaded(), refresh);
  finish([{ id: 'updated', entries: [] }]); await refresh;
  assert.equal(calls, 2);
  assert.equal(state.allWorldInfos[0].id, 'updated');
});

test('World Info failure does not poison readiness or discard the previous library', async () => {
  let fail = true, calls = 0;
  const c = store('./worldInfoStore.svelte.ts', { DEFAULT_WORLD_INFOS: [{ id: 'bundled' }], invoke: async () => {
    calls++; if (fail) throw new Error('Database error'); return [{ id: 'custom' }];
  } });
  await c.context.ensureWorldInfosLoaded();
  assert.equal(c.read('worldInfoState.allWorldInfos.length'), 1);
  fail = false;
  await c.context.ensureWorldInfosLoaded();
  assert.equal(calls, 2);
  assert.equal(c.read('worldInfoState.allWorldInfos.length'), 2);
});

test('role hydration waits for the default selection, avoids remount IPC and explicit loads still refresh', async () => {
  let finish, calls = 0, settingCalls = 0;
  const c = store('./roleStore.svelte.ts', {
    invoke: async () => { calls++; return [{ id: 'role', name: 'Player' }]; },
    getSetting: () => { settingCalls++; return new Promise(resolve => { finish = resolve; }); },
  });
  const first = c.context.ensureRolesLoaded();
  assert.equal(c.context.ensureRolesLoaded(), first);
  finish('role'); await first;
  assert.equal(c.read('roleState.defaultRoleId'), 'role');
  await c.context.ensureRolesLoaded();
  assert.equal(calls, 1); assert.equal(settingCalls, 1);
  const refresh = c.context.loadRoles(); finish('missing'); await refresh;
  assert.equal(c.read('roleState.defaultRoleId'), null);
  assert.equal(calls, 2);
});

test('failed role hydration propagates and can be retried', async () => {
  let fail = true;
  const c = store('./roleStore.svelte.ts', { invoke: async () => {
    if (fail) throw new Error('Database error'); return [];
  }, getSetting: async () => null });
  await assert.rejects(c.context.ensureRolesLoaded(), /Database error/);
  fail = false;
  await c.context.ensureRolesLoaded();
});

const conversation = (id, mode = 'singleplayer', folderId = null) => ({
  id, title: id, mode, folder_id: folderId, created_at: '2026-01-01', updated_at: '2026-01-01',
});

test('role images share pending reads and keep cached row/list identities on remount and refresh', async () => {
  let resolve, avatarReads = 0;
  const c = store('./roleStore.svelte.ts', {
    getSetting: async () => null,
    invoke: async command => command === 'get_roles' ? [{ id: 'r', has_avatar: true, name: 'Player' }]
      : (avatarReads++, new Promise(done => { resolve = done; })),
  });
  await c.context.ensureRolesLoaded();
  const state = c.read('roleState'), list = state.roles, role = list[0];
  const first = c.context.loadRoleAvatar('r');
  assert.equal(c.context.loadRoleAvatar('r'), first);
  resolve('data:image'); await first;
  await c.context.loadRoles();
  await c.context.loadRoleAvatar('r');
  assert.equal(avatarReads, 1);
  assert.equal(state.roles, list);
  assert.equal(state.roles[0], role);
  assert.equal(role.avatarUrl, 'data:image');
});

test('role thumbnails remain separate from originals and are reused after metadata refresh', async () => {
  const calls = [];
  const c = store('./roleStore.svelte.ts', {
    getSetting: async () => null,
    invoke: async command => {
      calls.push(command);
      return command === 'get_roles' ? [{ id: 'r', has_avatar: true }] : 'data:thumbnail';
    },
  });
  await c.context.ensureRolesLoaded();
  await c.context.loadRoleThumbnail('r');
  await c.context.loadRoles();
  await c.context.loadRoleThumbnail('r');
  assert.equal(c.read('roleState.roles[0].thumbnailUrl'), 'data:thumbnail');
  assert.equal(c.read('roleState.roles[0].avatarUrl'), undefined);
  assert.equal(calls.filter(command => command === 'get_role_thumbnail').length, 1);
  assert.equal(calls.includes('get_role_avatar'), false);
});

test('a replaced role image rejects old in-flight bytes and a deleted role cannot be revived', async () => {
  let resolve, reads = 0;
  const c = store('./roleStore.svelte.ts', {
    getSetting: async () => null,
    invoke: async command => command === 'get_roles' ? [{ id: 'r', has_avatar: true }]
      : command === 'get_role_avatar' ? ++reads === 1 ? new Promise(done => { resolve = done; }) : 'data:new' : undefined,
  });
  await c.context.ensureRolesLoaded();
  const first = c.context.loadRoleAvatar('r');
  await c.context.updateRole('r', { avatar: 'data:upload' });
  resolve('data:old'); await first;
  assert.equal(c.read('roleState.roles[0].avatarUrl'), 'data:new');
  await c.context.deleteRole('r');
  await c.context.loadRoleAvatar('r');
  assert.equal(c.read('roleState.roles.length'), 0);
  assert.equal(reads, 2);
});
const folder = (id, isCollapsed = false) => ({
  id, name: id, mode: 'singleplayer', is_collapsed: isCollapsed, chat_count: 1, sort_order: 0,
});
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((ok, fail) => { resolve = ok; reject = fail; });
  return { promise, resolve, reject };
};
const flush = () => new Promise(resolve => setImmediate(resolve));

function chatLibrary(handler = () => []) {
  const calls = [], diagnostics = [];
  const c = store('./chatStore.svelte.ts', {
    getLocale: () => 'en', forgetPromptUsageAnchor() {}, loadWorldInfos: async () => {},
    reportDiagnostic: area => diagnostics.push(area),
    invoke: async (command, params) => {
      calls.push({ command, params });
      return handler(command, params);
    },
  });
  return { ...c, calls, diagnostics, state: c.read('chatState') };
}

test('sidebar prefetch shares its promise, caches empty results and explicit loads still refresh', async () => {
  const page = deferred();
  const c = chatLibrary(command => command === 'get_conversations_page' ? page.promise : []);
  const prefetch = c.context.ensureConversationsLoaded('singleplayer');
  assert.equal(c.context.ensureConversationsLoaded('singleplayer'), prefetch);
  assert.equal(c.context.loadAllConversations('singleplayer'), prefetch);
  assert.equal(c.calls.length, 2);
  page.resolve([]); await prefetch;
  const conversations = c.state.conversations, folders = c.state.folders;
  await c.context.ensureConversationsLoaded('singleplayer');
  assert.equal(c.calls.length, 2);
  assert.equal(c.state.conversations, conversations);
  assert.equal(c.state.folders, folders);
  await c.context.loadAllConversations('singleplayer');
  assert.equal(c.calls.length, 4);
});

test('prefetch loads only the first loose page and metadata for expanded folders, publishing them together', async () => {
  const expandedPage = deferred();
  const c = chatLibrary((command, params) => command === 'get_chat_folders'
    ? [folder('expanded'), folder('collapsed', true)]
    : params.folderId ? expandedPage.promise : [conversation('loose')]);
  const prefetch = c.context.ensureConversationsLoaded('singleplayer');
  await flush();
  assert.equal(c.state.folders.length, 0);
  assert.equal(c.state.conversations.length, 0);
  assert.deepEqual(c.calls.map(call => call.command), [
    'get_conversations_page', 'get_chat_folders', 'get_conversations_page',
  ]);
  assert.equal(c.calls[0].params.limit, 10);
  assert.equal(c.calls[0].params.offset, 0);
  assert.equal(c.calls[2].params.folderId, 'expanded');
  expandedPage.resolve([conversation('nested', 'singleplayer', 'expanded')]); await prefetch;
  assert.deepEqual(Array.from(c.state.conversations, chat => chat.id), ['nested', 'loose']);
  assert.equal(c.state.folders.length, 2);
  assert.equal(c.state.currentMessages.length, 0);
  await c.context.ensureConversationsLoaded('singleplayer');
  assert.equal(c.calls.length, 3);
});

test('library loads are scoped by mode and cannot overwrite the other sidebar', async () => {
  const solo = deferred(), multi = deferred();
  const c = chatLibrary((command, params) => command === 'get_chat_folders'
    ? [] : params.mode === 'singleplayer' ? solo.promise : multi.promise);
  const first = c.context.ensureConversationsLoaded('singleplayer');
  const second = c.context.loadAllConversations('multiplayer');
  multi.resolve([conversation('multi', 'multiplayer')]); await second;
  solo.resolve([conversation('solo')]); await first;
  assert.deepEqual(Array.from(c.state.conversations, chat => chat.id).sort(), ['multi', 'solo']);
  await c.context.ensureConversationsLoaded('singleplayer');
  assert.equal(c.calls.length, 4);
});

for (const failingCommand of ['get_conversations_page', 'get_chat_folders']) {
  test(`failed ${failingCommand} prefetch retains old data and allows a retry`, async () => {
    let fail = true;
    const c = chatLibrary(command => {
      if (command === failingCommand && fail) throw new Error('Read failure');
      return command === 'get_chat_folders' ? [] : [conversation('fresh')];
    });
    c.state.conversations = [conversation('previous')];
    const previous = c.state.conversations;
    await c.context.ensureConversationsLoaded('singleplayer');
    assert.equal(c.state.conversations, previous);
    assert.deepEqual(c.diagnostics, ['chat']);
    fail = false;
    await c.context.ensureConversationsLoaded('singleplayer');
    assert.equal(c.state.conversations[0].id, 'fresh');
    assert.equal(c.calls.length, 4);
  });
}

for (const method of ['renameConversation', 'togglePinConversation', 'deleteConversation']) {
  test(`${method} during prefetch retries serially and never publishes the stale snapshot`, async () => {
    const stale = deferred(), fresh = deferred();
    let reads = 0;
    const c = chatLibrary(command => command === 'get_conversations_page'
      ? ++reads === 1 ? stale.promise : fresh.promise : []);
    c.state.conversations = [conversation('visible')];
    const prefetch = c.context.ensureConversationsLoaded('singleplayer');
    const mutation = c.context[method]('visible', 'renamed');
    await flush();
    assert.equal(reads, 1, 'no concurrent duplicate read after the write');
    assert.equal(c.context.ensureConversationsLoaded('singleplayer'), prefetch);
    stale.resolve([conversation('stale')]); await flush();
    assert.equal(reads, 2, 'one fresh read after the stale request completes');
    assert.equal(c.state.conversations[0].id, 'visible', 'stale data was never published');
    fresh.resolve([conversation('fresh')]); await Promise.all([prefetch, mutation]);
    await c.context.ensureConversationsLoaded('singleplayer');
    assert.equal(reads, 2);
    assert.equal(c.state.conversations[0].id, 'fresh');
  });
}

test('a folder edit during expanded-folder prefetch prevents stale chats and folders from committing', async () => {
  const nested = deferred();
  let name = 'original', nestedReads = 0;
  const c = chatLibrary((command, params) => {
    if (command === 'get_chat_folders') return [{ ...folder('f'), name }];
    if (command === 'rename_chat_folder') { name = params.name; return; }
    return params.folderId ? ++nestedReads === 1 ? nested.promise : [conversation('fresh', 'singleplayer', 'f')] : [];
  });
  c.state.folders = [{ ...folder('f'), name }];
  const prefetch = c.context.ensureConversationsLoaded('singleplayer');
  await flush();
  await c.context.renameChatFolder('f', 'renamed');
  nested.resolve([conversation('stale', 'singleplayer', 'f')]); await prefetch;
  assert.equal(c.state.folders[0].name, 'renamed');
  assert.equal(c.state.conversations[0].id, 'fresh');
  assert.equal(nestedReads, 2);
});

test('a locally created folder invalidates cached metadata without touching chat history', async () => {
  const folders = [];
  const c = chatLibrary(command => {
    if (command === 'create_chat_folder') { const saved = folder('created'); folders.push(saved); return saved; }
    return command === 'get_chat_folders' ? [...folders] : [];
  });
  await c.context.ensureConversationsLoaded('singleplayer');
  const messages = c.state.currentMessages = [{ id: 'active-message' }];
  await c.context.createChatFolder('created', 'singleplayer');
  await c.context.ensureConversationsLoaded('singleplayer');
  assert.deepEqual(Array.from(c.state.folders, item => item.id), ['created']);
  assert.equal(c.state.currentMessages, messages);
  assert.equal(c.calls.filter(call => call.command === 'get_chat_folders').length, 2);
});

test('a rejected write keeps the successful prefetch cache valid', async () => {
  const c = chatLibrary(command => {
    if (command === 'rename_chat_folder') throw new Error('Write failure');
    return command === 'get_chat_folders' ? [folder('f')] : [];
  });
  await c.context.ensureConversationsLoaded('singleplayer');
  await assert.rejects(c.context.renameChatFolder('f', 'new'), /Write failure/);
  await c.context.ensureConversationsLoaded('singleplayer');
  assert.equal(c.calls.filter(call => call.command === 'get_chat_folders').length, 1);
  assert.equal(c.state.folders[0].name, 'f');
});

for (const folderId of [null, 'f']) {
  test(`a late ${folderId ? 'folder' : 'loose'} page cannot restore chats after a library refresh`, async () => {
    const stale = deferred();
    let paging = false;
    const c = chatLibrary((command, params) => {
      if (command === 'get_chat_folders') return [folder('f')];
      if (paging) return stale.promise;
      return [conversation(params.folderId ? 'nested' : 'loose', 'singleplayer', params.folderId)];
    });
    await c.context.ensureConversationsLoaded('singleplayer');
    paging = true;
    const pagination = folderId ? c.context.loadMoreFolderConversations(folderId, true)
      : c.context.loadMoreConversations('singleplayer');
    paging = false;
    await c.context.loadAllConversations('singleplayer');
    const fresh = c.state.conversations;
    stale.resolve([conversation('stale', 'singleplayer', folderId)]); await pagination;
    assert.equal(c.state.conversations, fresh);
    await c.context.ensureConversationsLoaded('singleplayer');
    assert.equal(c.state.conversations, fresh);
  });
}

test('a saved message invalidates prefetch even when its targeted metadata refresh fails', async () => {
  const stale = deferred();
  let reads = 0;
  const c = chatLibrary(command => {
    if (command === 'get_conversations_page') return ++reads === 1 ? stale.promise : [conversation('fresh')];
    if (command === 'get_chat_message_update') throw new Error('Read failure after saving');
    return [];
  });
  c.context.crypto = { randomUUID: () => 'message' };
  c.state.activeChatId = 'chat';
  const prefetch = c.context.ensureConversationsLoaded('singleplayer');
  const saved = c.context.addMessage('user', 'hello');
  await flush();
  assert.equal(reads, 1);
  stale.resolve([conversation('stale')]); await Promise.all([prefetch, saved]);
  assert.equal(reads, 2);
  assert.equal(c.state.conversations[0].id, 'fresh');
});
