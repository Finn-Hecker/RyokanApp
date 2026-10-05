import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { createUpdater } from './updater.ts';

function fixture(overrides = {}) {
  const calls = [];
  const handle = {
    version: '0.6.0',
    async download(event) { calls.push('download'); event({ event: 'Started', data: {} }); event({ event: 'Progress', data: { chunkLength: 10 } }); event({ event: 'Finished' }); },
    async install() { calls.push('install'); },
    async close() { calls.push('close'); },
  };
  const updater = createUpdater({ getVersion: async () => '0.5.0', supported: async () => true,
    check: async () => { calls.push('check'); return handle; }, ...overrides });
  return { updater, handle, calls, state: () => get(updater) };
}

test('checks once at startup, downloads only on request, installs only after verification', async () => {
  const f = fixture();
  await Promise.all([f.updater.initialize(), f.updater.initialize()]);
  assert.equal(f.state().currentVersion, '0.5.0');
  assert.equal(f.state().phase, 'available');
  await f.updater.install();
  assert.deepEqual(f.calls, ['check']);
  await f.updater.download();
  assert.equal(f.state().phase, 'ready');
  assert.equal(f.state().downloaded, 10);
  assert.equal(f.state().total, undefined);
  await f.updater.check();
  assert.deepEqual(f.calls, ['check', 'download']);
  await f.updater.install();
  assert.equal(f.state().phase, 'installing');
  assert.deepEqual(f.calls, ['check', 'download', 'install']);
});

test('unsupported platforms never call the native updater', async () => {
  const f = fixture({ supported: async () => false });
  await f.updater.initialize(); await f.updater.check(); await f.updater.download(); await f.updater.install();
  assert.deepEqual(f.calls, []);
  assert.equal(f.state().initialized, true);
});

test('unavailable, malformed manifests and network errors are retryable, not reported as current', async () => {
  let fail = true;
  const f = fixture({ check: async () => { if (fail) throw new Error('404 or invalid JSON'); return null; } });
  await f.updater.initialize();
  assert.equal(f.state().error, 'check');
  assert.equal(f.state().phase, 'idle');
  fail = false; await f.updater.check();
  assert.equal(f.state().phase, 'current');
  assert.equal(f.state().error, '');
});

test('a prerelease returned by a misconfigured stable feed is discarded', async () => {
  const f = fixture(); f.handle.version = '0.6.0-rc.1';
  await f.updater.initialize();
  assert.equal(f.state().phase, 'current');
  assert.ok(f.calls.includes('close'));
});

test('Finished does not authorize install when signature verification then fails', async () => {
  const f = fixture();
  f.handle.download = async event => {
    event({ event: 'Finished' });
    assert.equal(f.state().phase, 'downloading');
    await f.updater.install();
    throw new Error('invalid signature');
  };
  await f.updater.initialize(); await f.updater.download(); await f.updater.install();
  assert.equal(f.state().error, 'download');
  assert.deepEqual(f.calls, ['check', 'close']);
  await f.updater.check(); assert.equal(f.state().phase, 'available');
});

test('installer launch failures discard native resources and allow a fresh attempt', async () => {
  const f = fixture(); f.handle.install = async () => { throw new Error('access denied'); };
  await f.updater.initialize(); await f.updater.download(); await f.updater.install();
  assert.equal(f.state().error, 'install'); assert.equal(f.state().phase, 'idle');
  assert.ok(f.calls.includes('close'));
});

test('concurrent actions cannot replace an in-flight update', async () => {
  const f = fixture(); let finish;
  f.handle.download = () => new Promise(resolve => { finish = resolve; });
  await f.updater.initialize();
  const downloading = f.updater.download();
  await f.updater.check(); await f.updater.download(); await f.updater.install();
  assert.equal(f.state().phase, 'downloading'); assert.deepEqual(f.calls, ['check']);
  finish(); await downloading;
  assert.equal(f.state().phase, 'ready');
});

test('native initialization failures can be retried', async () => {
  let fail = true;
  const f = fixture({ getVersion: async () => { if (fail) throw new Error('IPC'); return '0.6.0'; } });
  await f.updater.initialize(); assert.equal(f.state().error, 'init');
  fail = false; await f.updater.initialize();
  assert.equal(f.state().currentVersion, '0.6.0'); assert.equal(f.state().error, '');
});
