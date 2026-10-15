import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function lobby() {
  const script = readFileSync(new URL('./CharacterLobby.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('CharacterLobby.ts', script, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement)).map(statement => statement.getText(ast)).join('\n');
  const starts = [];
  const context = vm.createContext({
    $state: value => value, $derived: value => value, $effect() {}, onMount() {},
    m: new Proxy({}, { get: () => () => '' }), appState: {},
    roleState: { defaultRoleId: 'default-persona' },
    characterState: { allCharacters: [], hiddenCharacterIds: new Set(), pinnedCharacterIds: new Set() },
    startNewChat: async (card, role) => starts.push({ card, role }), navigateTo() {},
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, starts };
}

test('story selection bypasses default and restricted personas while character selection retains them', async () => {
  const l = lobby();
  await l.context.onSelectChar({ id: 'story', mode: 'story', role_policy: 'restricted' });
  assert.equal(l.starts.length, 1);
  assert.equal(l.starts[0].role, null);
  await l.context.onSelectChar({ id: 'legacy', role_policy: 'open' });
  assert.equal(l.starts[1].role.id, 'default-persona');
  await l.context.onSelectChar({ id: 'restricted', mode: 'character', role_policy: 'restricted', bundled_roles: [{ id: 'local' }] });
  assert.equal(l.starts[2].role.id, 'local');
  assert.equal(l.starts[2].role.source, 'bundled');
});
