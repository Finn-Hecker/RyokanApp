import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { supportedImageFormat } from '../../../utils/imageFormats.ts';

function editor(metadata = {}) {
  const ast = ts.createSourceFile('characterLogic.ts', readFileSync(new URL('./characterLogic.ts', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  const writes = [];
  const context = vm.createContext({
    supportedImageFormat,
    createCharacter: async data => { writes.push({ command: 'create', data }); return 'new'; },
    updateCharacter: async (id, data) => { writes.push({ command: 'update', id, data }); return id; },
    invoke: async () => ({ prompt: 'Imported prompt', alternate_greetings: [], role_policy: 'open', bundled_roles: [], ...metadata }),
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  return { context, writes };
}

const form = { name: 'Card', prompt: 'Prompt', greeting: 'Opening', alternate_greetings: [], play_mode: 'solo' };

test('new editor cards default to stories, explicit characters and legacy edits retain character mode', async () => {
  const e = editor();
  await e.context.saveCharacter(form, null, null, false);
  assert.equal(e.writes[0].data.mode, 'story');
  await e.context.saveCharacter({ ...form, mode: 'character' }, null, null, false);
  assert.equal(e.writes[1].data.mode, 'character');
  await e.context.saveCharacter(form, { id: 'old', isCustom: true }, null, false);
  assert.equal(e.writes[2].data.mode, 'character');
  assert.equal(e.writes[2].command, 'update');
  await e.context.saveCharacter(form, { id: 'story', isCustom: true, mode: 'story' }, null, false);
  assert.equal(e.writes[3].data.mode, 'story');
  await e.context.saveCharacter({ ...form, mode: 'story', play_mode: 'multiplayer' }, null, null, false);
  assert.equal(e.writes[4].data.mode, 'character');
});

test('community card imports default to characters and explicit Ryokan stories retain their type', async () => {
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const file = { slice: () => ({ arrayBuffer: async () => bytes.buffer }), arrayBuffer: async () => bytes.buffer };
  for (const [mode, expected] of [[undefined, 'character'], ['character', 'character'], ['story', 'story']]) {
    const e = editor({ mode });
    const imported = await e.context.importCharacterFromFile(file);
    assert.equal(imported.mode, expected);
    await e.context.saveCharacter({ ...form, ...imported }, null, null, false);
    assert.equal(e.writes[0].data.mode, expected);
  }
});
