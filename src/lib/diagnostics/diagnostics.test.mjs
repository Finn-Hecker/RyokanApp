import assert from 'node:assert/strict';
import test from 'node:test';
import { diagnosticsMetadata } from './diagnosticsMetadata.ts';
import { reportDiagnostic, downloadDiagnostics } from './diagnostics.ts';

test('metadata projects only fixed provider and boolean configuration flags', () => {
  const privateValue = 'sk-secret Authorization: Bearer secret /Users/private/model prompt chat summary character role lorebook encryption-key';
  const connection = Object.fromEntries(['apiKey', 'url', 'model', 'name', 'id', 'systemPrompt', 'additionalApiParameters', 'detectedContext', 'contextDetectionError'].map(key => [key, privateValue]));
  assert.deepEqual(diagnosticsMetadata({ ...connection, providerKind: 'openai' }, true), {
    provider: 'openai', modelConfigured: true, summaryEnabled: true,
  });
  const projected = diagnosticsMetadata({ ...connection, providerKind: privateValue }, false);
  assert.equal(projected.provider, 'unknown');
  assert.ok(!JSON.stringify(projected).includes(privateValue));
  assert.equal(diagnosticsMetadata({ model: null }, false).modelConfigured, false);
});

test('frontend logging sends categories only, throttles and tolerates IPC failure', async () => {
  const calls = [];
  globalThis.window = { __TAURI_INTERNALS__: { invoke: (command, args) => {
    calls.push({ command, args });
    return Promise.reject(new Error('private backend error'));
  } } };
  reportDiagnostic('settings');
  reportDiagnostic('settings');
  await Promise.resolve();
  assert.deepEqual(calls, [{ command: 'record_frontend_event', args: { area: 'settings', warning: false } }]);
  delete globalThis.window;
  assert.doesNotThrow(() => reportDiagnostic('editor'));
});

test('export failure propagates to the UI without creating a download', async () => {
  globalThis.window = { __TAURI_INTERNALS__: { invoke: () => Promise.reject(new Error('unavailable')) } };
  await assert.rejects(downloadDiagnostics(diagnosticsMetadata({}, false)), /unavailable/);
  delete globalThis.window;
});

test('export downloads the backend report locally and cleans up its URL', async (t) => {
  const metadata = diagnosticsMetadata({ providerKind: 'ollama', model: '/private/model' }, true);
  const report = '{"schemaVersion":1,"logs":[]}';
  let blob;
  let clicked = false;
  let removed = false;
  let appended = false;
  let revoke;
  const link = { click() { clicked = true; }, remove() { removed = true; } };
  globalThis.window = { __TAURI_INTERNALS__: { invoke: async (command, args) => {
    assert.equal(command, 'export_diagnostics');
    assert.deepEqual(args, { metadata });
    return report;
  } } };
  globalThis.document = { createElement: () => link, body: { appendChild: () => { appended = true; } } };
  t.mock.method(URL, 'createObjectURL', value => { blob = value; return 'blob:diagnostics'; });
  t.mock.method(URL, 'revokeObjectURL', value => { assert.equal(value, 'blob:diagnostics'); });
  t.mock.method(globalThis, 'setTimeout', callback => { revoke = callback; });
  try {
    await downloadDiagnostics(metadata);
    assert.equal(await blob.text(), report);
    assert.equal(link.download, 'ryokan-diagnostics.json');
    assert.ok(clicked && removed && appended);
    assert.equal(URL.revokeObjectURL.mock.callCount(), 0);
    revoke();
    assert.equal(URL.revokeObjectURL.mock.callCount(), 1);
  } finally {
    delete globalThis.window;
    delete globalThis.document;
  }
});
