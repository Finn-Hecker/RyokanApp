import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function store() {
  const ast = ts.createSourceFile('characterStore.ts', readFileSync(new URL('./characterStore.svelte.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement) && !ts.isExportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const rows = [{ id: 'card', name: 'Rin', prompt: 'Prompt', greeting: 'Hello', initials: 'R', color: 'blue', has_avatar: true, play_mode: 'solo', bundled_roles: [], world_info_ids: [] }];
  const calls = [], timers = [], handlers = {};
  let avatarListener;
  const context = vm.createContext({
    $state: value => value, STATIC_CHARACTERS: [], reportDiagnostic() {},
    setTimeout: callback => timers.push(callback),
    listen: async (name, callback) => {
      assert.equal(name, 'character-avatar-updated'); avatarListener = callback; return () => {};
    },
    invoke: async (command, args) => {
      calls.push({ command, args });
      if (handlers[command]) return handlers[command](args);
      if (command === 'get_custom_characters') return structuredClone(rows);
      if (command === 'get_character_avatar') return 'data:original';
      if (command === 'get_character_thumbnail') return 'data:thumbnail';
      return [];
    },
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, state: vm.runInContext('characterState', context), rows, calls, timers, handlers,
    avatarUpdated: id => avatarListener({ payload: id }) };
}

test('avatar loading and metadata refresh retain character/list identities and cache image bytes', async () => {
  const c = store();
  await c.context.loadCharacters();
  const list = c.state.allCharacters, character = list[0];
  await c.context.loadCharacterAvatar('card');
  assert.equal(c.state.allCharacters, list);
  assert.equal(c.state.allCharacters[0], character);
  assert.equal(character.avatarUrl, 'data:original');
  c.rows[0].name = 'Edited name';
  await c.context.loadCharacters();
  await c.context.loadCharacterAvatar('card');
  assert.equal(c.state.allCharacters, list);
  assert.equal(character.name, 'Edited name');
  assert.equal(character.avatarUrl, 'data:original');
  assert.equal(c.calls.filter(call => call.command === 'get_character_avatar').length, 1);
});

test('thumbnail caching is independent from original bytes and survives metadata refresh', async () => {
  const c = store();
  await c.context.loadCharacters();
  const character = c.state.allCharacters[0];
  await c.context.loadCharacterThumbnail('card');
  await c.context.loadCharacters();
  await c.context.loadCharacterThumbnail('card');
  assert.equal(character.thumbnailUrl, 'data:thumbnail');
  assert.equal(character.avatarUrl, undefined);
  assert.equal(c.calls.filter(call => call.command === 'get_character_thumbnail').length, 1);
  await c.context.loadCharacterAvatar('card');
  assert.equal(character.avatarUrl, 'data:original');
  assert.equal(character.thumbnailUrl, 'data:thumbnail');
});

test('an avatar edit retires an old thumbnail response and its cached preview', async () => {
  const c = store();
  await c.context.loadCharacters();
  const pending = deferred();
  c.handlers.get_character_thumbnail = () => pending.promise;
  const first = c.context.loadCharacterThumbnail('card');
  assert.equal(c.context.loadCharacterThumbnail('card'), first);
  await c.context.updateCharacter('card', { ...c.rows[0], avatar: 'data:upload' });
  pending.resolve('data:stale'); await first;
  assert.equal(c.state.allCharacters[0].thumbnailUrl, undefined);
  c.avatarUpdated('card');
  c.handlers.get_character_thumbnail = () => 'data:new-thumbnail';
  await c.context.loadCharacterThumbnail('card');
  await c.context.loadCharacters();
  assert.equal(c.state.allCharacters[0].thumbnailUrl, 'data:new-thumbnail');
});

test('avatar changes invalidate the cache and reject an old in-flight image response', async () => {
  const c = store();
  await c.context.loadCharacters();
  const pending = deferred();
  c.handlers.get_character_avatar = () => pending.promise;
  const fetching = c.context.loadCharacterAvatar('card');
  await c.context.updateCharacter('card', { ...c.rows[0], avatar: 'data:new-upload' });
  pending.resolve('data:stale');
  await fetching;
  assert.equal(c.state.allCharacters[0].avatarUrl, 'data:new-upload');
  assert.equal(Object.hasOwn(c.state.allCharacters[0], 'avatar'), false, 'do not retain unused original upload bytes');
  await c.timers[0]();
  assert.equal(c.state.allCharacters[0].avatarUrl, undefined);
  c.handlers.get_character_avatar = () => 'data:processed-new';
  await c.context.loadCharacterAvatar('card');
  await c.context.loadCharacters();
  assert.equal(c.state.allCharacters[0].avatarUrl, 'data:processed-new');
});

test('metadata-only edits keep avatar bytes, and a removed avatar or deleted card cannot retain them', async () => {
  const c = store();
  await c.context.loadCharacters();
  await c.context.loadCharacterAvatar('card');
  await c.context.updateCharacter('card', { ...c.rows[0], avatar: null });
  await c.timers[0]();
  assert.equal(c.state.allCharacters[0].avatarUrl, 'data:original');
  c.rows[0].has_avatar = false;
  await c.context.loadCharacters();
  assert.equal(c.state.allCharacters[0].avatarUrl, undefined);
  c.rows[0].has_avatar = true;
  await c.context.loadCharacters();
  const pending = deferred();
  c.handlers.get_character_avatar = () => pending.promise;
  const fetching = c.context.loadCharacterAvatar('card');
  await c.context.deleteCharacter('card');
  pending.resolve('data:deleted');
  await fetching;
  assert.equal(c.state.allCharacters.length, 0);
});

test('lobby hydration shares in-flight work, waits for hidden flags and performs no remount IPC', async () => {
  const c = store();
  const hidden = deferred();
  c.handlers.get_hidden_character_ids = () => hidden.promise;
  const first = c.context.ensureLobbyCharactersLoaded();
  assert.equal(c.context.ensureLobbyCharactersLoaded(), first);
  await Promise.resolve();
  assert.equal(c.calls.some(call => call.command === 'get_custom_characters'), false);
  hidden.resolve(['card']);
  await first;
  assert.equal(c.state.hiddenCharacterIds.has('card'), true);
  const count = c.calls.length;
  await c.context.ensureLobbyCharactersLoaded();
  assert.equal(c.calls.length, count);
  // Explicit refresh still observes database changes rather than using hydration cache.
  c.rows[0].name = 'New database name';
  await c.context.loadCharacters();
  assert.equal(c.state.allCharacters[0].name, 'New database name');
});

test('failed initial hydration remains retryable', async () => {
  const c = store();
  c.handlers.get_custom_characters = () => { throw new Error('Database unavailable'); };
  await c.context.ensureLobbyCharactersLoaded();
  assert.equal(c.state.allCharacters.length, 0);
  delete c.handlers.get_custom_characters;
  await c.context.ensureLobbyCharactersLoaded();
  assert.equal(c.state.allCharacters.length, 1);
  assert.equal(c.calls.filter(call => call.command === 'get_hidden_character_ids').length, 1);
});

test('a stale list refresh cannot clear a newer avatar edit or replace its preview', async () => {
  const c = store();
  await c.context.loadCharacters();
  const list = deferred();
  c.handlers.get_custom_characters = () => list.promise;
  const refreshing = c.context.loadCharacters();
  await c.context.updateCharacter('card', { ...c.rows[0], name: 'New name', avatar: 'data:new-upload' });
  list.resolve(structuredClone(c.rows)); await refreshing;
  assert.equal(c.state.allCharacters[0].name, 'New name');
  assert.equal(c.state.allCharacters[0].avatarUrl, 'data:new-upload');
  await c.context.loadCharacterAvatar('card');
  assert.equal(c.calls.some(call => call.command === 'get_character_avatar'), false);
  delete c.handlers.get_custom_characters;
  await c.timers[0]();
  assert.equal(c.state.allCharacters[0].avatarUrl, undefined);
});

test('an invalidated slow image request does not block or retire a newer image request', async () => {
  const c = store();
  await c.context.loadCharacters();
  const old = deferred(), current = deferred();
  c.handlers.get_character_avatar = () => old.promise;
  const fetchingOld = c.context.loadCharacterAvatar('card');
  assert.equal(c.context.loadCharacterAvatar('card'), fetchingOld);
  await c.context.updateCharacter('card', { ...c.rows[0], avatar: 'data:new-upload' });
  await c.timers[0]();
  c.handlers.get_character_avatar = () => current.promise;
  const fetchingCurrent = c.context.loadCharacterAvatar('card');
  old.resolve('data:stale'); await fetchingOld;
  assert.equal(c.context.loadCharacterAvatar('card'), fetchingCurrent);
  current.resolve('data:new'); await fetchingCurrent;
  assert.equal(c.state.allCharacters[0].avatarUrl, 'data:new');
});

test('new character previews are replaced with processed database images rather than cached as final images', async () => {
  const c = store();
  await c.context.loadCharacters();
  c.handlers.create_character = () => 'created-card';
  const id = await c.context.createCharacter({ ...c.rows[0], avatar: 'data:large-original-upload' });
  const created = c.state.allCharacters.find(character => character.id === id);
  assert.equal(created.avatarUrl, 'data:large-original-upload');
  c.rows.unshift({ ...c.rows[0], id });
  await c.timers[0]();
  assert.equal(c.state.allCharacters.find(character => character.id === id).avatarUrl, undefined);
  c.handlers.get_character_avatar = () => 'data:processed';
  await c.context.loadCharacterAvatar(id);
  await c.context.loadCharacters();
  assert.equal(c.state.allCharacters.find(character => character.id === id).avatarUrl, 'data:processed');
});

test('native image completion after the 800ms refresh retires stale bytes and old in-flight reads', async () => {
  const c = store();
  await c.context.loadCharacters();
  await c.context.loadCharacterAvatar('card');
  await c.context.updateCharacter('card', { ...c.rows[0], avatar: 'data:new-upload' });
  await c.timers[0]();
  await c.context.loadCharacterAvatar('card');
  assert.equal(c.state.allCharacters[0].avatarUrl, 'data:original', 'processing can still be pending');
  c.avatarUpdated('card');
  assert.equal(c.state.allCharacters[0].avatarUrl, undefined);
  const stale = deferred();
  c.handlers.get_character_avatar = () => stale.promise;
  const fetchingStale = c.context.loadCharacterAvatar('card');
  c.avatarUpdated('card');
  c.handlers.get_character_avatar = () => 'data:processed';
  await c.context.loadCharacterAvatar('card');
  stale.resolve('data:original'); await fetchingStale;
  await c.context.loadCharacters();
  assert.equal(c.state.allCharacters[0].avatarUrl, 'data:processed');
});

test('native completion marks a newly created avatar available even if the delayed refresh ran too early', async () => {
  const c = store();
  await c.context.loadCharacters();
  c.handlers.create_character = () => 'created-card';
  const id = await c.context.createCharacter({ ...c.rows[0], avatar: 'data:upload' });
  c.rows.unshift({ ...c.rows[0], id, has_avatar: false });
  await c.timers[0]();
  const character = c.state.allCharacters.find(item => item.id === id);
  assert.equal(character.has_avatar, false);
  c.avatarUpdated(id);
  assert.equal(character.has_avatar, true);
  c.handlers.get_character_avatar = () => 'data:processed';
  await c.context.loadCharacterAvatar(id);
  assert.equal(character.avatarUrl, 'data:processed');
});
