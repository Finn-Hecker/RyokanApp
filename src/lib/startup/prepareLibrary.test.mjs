import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const flush = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};

function preparation({ metadata = () => Promise.resolve(), decode = () => Promise.resolve() } = {}) {
  const source = readFileSync(new URL('./prepareLibrary.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('prepareLibrary.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const calls = [], decoded = [];
  const characterState = { allCharacters: [
    { id: 'custom', has_avatar: true, hidden: true },
    { id: 'bundled', avatarUrl: 'asset:bundled', play_mode: 'multiplayer' },
    { id: 'no-avatar' },
  ] };
  const roleState = { roles: [{ id: 'role', has_avatar: true }] };
  const context = vm.createContext({
    characterState, roleState,
    ensureLobbyCharactersLoaded: () => { calls.push('characters'); return metadata('characters'); },
    ensureRolesLoaded: () => { calls.push('roles'); return metadata('roles'); },
    ensureWorldInfosLoaded: () => { calls.push('worldinfo'); return metadata('worldinfo'); },
    ensureConversationsLoaded: mode => { calls.push(mode); return metadata(mode); },
    loadCharacterThumbnail: async id => {
      calls.push(`thumbnail:${id}`);
      characterState.allCharacters.find(character => character.id === id).thumbnailUrl = `small:${id}`;
    },
    loadRoleThumbnail: async id => {
      calls.push(`thumbnail:${id}`);
      roleState.roles.find(role => role.id === id).thumbnailUrl = `small:${id}`;
    },
    Image: class {
      decode() { decoded.push(this.src); return decode(this.src); }
    },
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, calls, decoded };
}

test('startup shares preparation, hydrates both libraries and waits for hidden, bundled and role images', async () => {
  const metadata = deferred(), first = deferred(), second = deferred(), third = deferred();
  const images = [first, second, third];
  const h = preparation({ metadata: () => metadata.promise, decode: () => images.shift().promise });
  let ready = false;
  const start = h.context.prepareLibrary();
  assert.equal(h.context.prepareLibrary(), start);
  start.then(() => { ready = true; });
  assert.deepEqual(h.calls, ['characters', 'roles', 'worldinfo', 'singleplayer', 'multiplayer']);
  assert.deepEqual(h.decoded, []);
  metadata.resolve(); await flush();
  assert.equal(h.decoded.length, 2, 'only two image preparations run concurrently');
  assert.equal(ready, false);
  first.resolve(); await flush();
  assert.equal(h.decoded.length, 3);
  second.resolve(); await flush();
  assert.equal(ready, false, 'role image still preparing');
  third.resolve(); await start;
  assert.equal(ready, true);
  assert.deepEqual(new Set(h.decoded), new Set(['small:custom', 'asset:bundled', 'small:role']));
  assert.ok(!h.calls.includes('thumbnail:no-avatar'));
  assert.ok(!h.calls.includes('thumbnail:bundled'));
  await h.context.prepareLibrary();
  assert.equal(h.decoded.length, 3, 'successful decodes are reused on retry');
});

test('failed metadata remains retryable and a corrupt image does not block other cards', async () => {
  let unavailable = true, corrupt = true;
  const h = preparation({
    metadata: async area => { if (area === 'roles' && unavailable) throw new Error('Unavailable'); },
    decode: async url => { if (url === 'small:custom' && corrupt) throw new Error('Corrupt image'); },
  });
  await assert.rejects(h.context.prepareLibrary(), /Unavailable/);
  assert.deepEqual(h.decoded, []);
  unavailable = false;
  await h.context.prepareLibrary();
  assert.ok(h.decoded.includes('small:role'));
  corrupt = false;
  await h.context.prepareLibrary();
  assert.equal(h.decoded.filter(url => url === 'small:custom').length, 2, 'failed image decodes retry');
  assert.equal(h.decoded.filter(url => url === 'small:role').length, 1, 'successful images remain warm');
});
