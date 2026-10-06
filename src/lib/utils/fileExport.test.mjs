import assert from 'node:assert/strict';
import test from 'node:test';
import { exportFile } from './fileExport.ts';

const bytes = new TextEncoder().encode('Grüße 🌸');
const filter = { name: 'JSON', extensions: ['json'] };

test('Android waits for the native write and preserves UTF-8 bytes', async () => {
  let finish;
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: (command, args) => {
    calls.push({ command, args });
    if (command === 'plugin:dialog|save') return Promise.resolve('content://document');
    return new Promise(resolve => { finish = resolve; });
  } } };
  try {
    let completed = false;
    const pending = exportFile(bytes, 'preset.json', 'application/json', filter, true).then(result => { completed = true; return result; });
    while (!finish) await Promise.resolve();
    assert.equal(completed, false);
    assert.deepEqual(calls, [
      { command: 'plugin:dialog|save', args: { options: { defaultPath: 'preset.json', filters: [filter] } } },
      { command: 'write_android_export', args: { uri: 'content://document', bytes: Array.from(bytes) } }
    ]);
    finish();
    assert.equal(await pending, true);
  } finally { delete globalThis.window; }
});

test('Android cancellation skips writing; dialog and write errors propagate', async () => {
  for (const outcome of ['cancel', 'dialog-error', 'write-error']) {
    const calls = [];
    globalThis.window = { __TAURI_INTERNALS__: { invoke: async command => {
      calls.push(command);
      if (outcome === 'dialog-error' || command === 'write_android_export') throw new Error(outcome);
      return outcome === 'cancel' ? null : 'content://document';
    } } };
    try {
      const result = exportFile(bytes, 'preset.json', 'application/json', filter, true);
      if (outcome === 'cancel') assert.equal(await result, false);
      else await assert.rejects(result, new RegExp(outcome));
      assert.equal(calls.length, outcome === 'write-error' ? 2 : 1);
    } finally { delete globalThis.window; }
  }
});

test('desktop dispatch errors propagate and still release the link and URL', async t => {
  let removed = false;
  let revoke;
  globalThis.document = { createElement: () => ({ click() { throw new Error('download failed'); }, remove() { removed = true; } }), body: { appendChild() {} } };
  t.mock.method(URL, 'createObjectURL', () => 'blob:export');
  t.mock.method(URL, 'revokeObjectURL');
  t.mock.method(globalThis, 'setTimeout', callback => { revoke = callback; });
  try {
    await assert.rejects(exportFile(bytes, 'preset.json', 'application/json', filter, false), /download failed/);
    assert.equal(removed, true);
    revoke();
    assert.equal(URL.revokeObjectURL.mock.callCount(), 1);
  } finally { delete globalThis.document; }
});
