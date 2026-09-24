import test from 'node:test';
import assert from 'node:assert/strict';
import { makeConfig } from './updater-config.mjs';
// Format fixture only. Never used to sign an artifact or configure a build.
const key = Buffer.from(`untrusted comment: test\n${Buffer.alloc(42).toString('base64')}\n`).toString('base64');
test('production config never changes version or identity', () => {
  const config = makeConfig('stable', key, '0.6.0');
  assert.deepEqual(config, { plugins: { updater: { pubkey: key } } });
});
test('both test builds share isolated identity and fixed HTTPS test feed', () => {
  const a = makeConfig('test', key, '0.5.1', '0.5.2');
  const b = makeConfig('test', key, '0.5.2', '0.5.2');
  assert.equal(a.identifier, 'ryokan.updater-test');
  assert.equal(a.identifier, b.identifier);
  assert.equal(a.productName, b.productName);
  assert.deepEqual(a.plugins, b.plugins);
  assert.match(a.plugins.updater.endpoints[0], /\/download\/updater-test-v0.5.2\/latest.json$/);
  assert.equal(a.version, '0.5.1'); assert.equal(b.version, '0.5.2');
});
test('missing keys, invalid versions, channels, and injected URLs fail closed', () => {
  for (const args of [['stable', '', '0.6.0'], ['nightly', key, '0.6.0'], ['stable', key, '0.6.0-rc.1'], ['test', key, '0.5.1', 'https://example.com']]) {
    assert.throws(() => makeConfig(...args));
  }
});
