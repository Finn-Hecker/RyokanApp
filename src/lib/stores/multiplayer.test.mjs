import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

async function snapshotRoom(messages) {
  const keys = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const sent = [], persisted = [];
  let timer;
  const context = vm.createContext({
    crypto: webcrypto, TextEncoder, Uint8Array,
    b64u: { encode: value => Buffer.from(value).toString('base64url'), decode: value => Buffer.from(value, 'base64url') },
    mpState: { roomId: 'ROOM', role: 'host', characterName: 'Host', sessionCharacter: null, messages, everyoneCanGenerate: true },
    signingPrivateKey: keys.privateKey, signingPublicKey: keys.publicKey,
    hostSequence: 0, lastVerifiedHostSequence: 0, hostStateInitialized: false, hostRelayChain: Promise.resolve(),
    snapshotTimer: null, ws: { readyState: 1 }, WebSocket: { OPEN: 1 },
    sendRelay: async frame => sent.push(frame), seenIds: new Set(),
    applySessionCharacter() {}, persistMessageOnce: async message => persisted.push(message.id),
    setTimeout: callback => { timer = callback; return 1; }, clearTimeout() {},
  });
  const source = readFileSync(new URL('./multiplayer.svelte.ts', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('multiplayer.ts', source, ts.ScriptTarget.Latest, true);
  const names = ['scheduleSnapshot', 'safeTimestamp', 'handleDecrypted', 'sendHostRelay', 'hostSignatureInput', 'verifyHostEnvelope'];
  const body = ast.statements.filter(node =>
    ts.isFunctionDeclaration(node) && names.includes(node.name?.text)
    || ts.isVariableStatement(node) && /^(MAX_|SNAPSHOT_DEBOUNCE_MS)/.test(node.declarationList.declarations[0].name.getText(ast)),
  ).map(node => node.getText(ast)).join('\n');
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  context.scheduleSnapshot();
  timer();
  await context.hostRelayChain;
  context.mpState = { roomId: 'ROOM', role: 'guest', characterName: '', messages: [] };
  return { context, sent, persisted, fire: () => timer() };
}

const messages = count => Array.from({ length: count }, (_, index) => ({
  id: `m${index}`, kind: index % 2 ? 'llm' : 'chat', author: 'User', text: `message ${index}`, ts: index,
}));

for (const count of [0, 1000, 1001, 2501]) {
  test(`signed snapshots deliver all ${count} messages within the existing frame limit`, async () => {
    const source = messages(count);
    const h = await snapshotRoom(source);
    const snapshots = h.sent.filter(frame => frame.body.k === 'snap');
    assert.equal(snapshots.length, Math.max(1, Math.ceil(count / 1000)));
    assert.ok(snapshots.every(frame => frame.body.msgs.length <= 1000));
    assert.equal(h.sent.at(-1).body.k, 'policy');
    for (const frame of h.sent) await h.context.handleDecrypted(frame, 1);
    assert.deepEqual(Array.from(h.context.mpState.messages, message => message.id), source.map(message => message.id));
    assert.equal(h.persisted.length, count);
    assert.equal(h.context.mpState.everyoneCanGenerate, true, 'even an empty snapshot initializes host authentication');
  });
}

test('repeated snapshots deduplicate history and exclude system and unfinished messages', async () => {
  const source = messages(1001);
  const h = await snapshotRoom([...source, { id: 'system', kind: 'system' }, { id: 'stream', kind: 'llm', streaming: true }]);
  for (const frame of h.sent) await h.context.handleDecrypted(frame, 1);
  h.context.mpState.role = 'host';
  h.context.scheduleSnapshot();
  h.fire();
  await h.context.hostRelayChain;
  h.context.mpState.role = 'guest';
  for (const frame of h.sent) await h.context.handleDecrypted(frame, 1);
  assert.equal(h.context.mpState.messages.length, 1001);
  assert.equal(h.persisted.length, 1001);
  assert.ok(h.context.mpState.messages.every(message => message.id !== 'system' && message.id !== 'stream'));
});

test('unauthenticated and oversized incoming snapshots remain rejected', async () => {
  const h = await snapshotRoom(messages(1001));
  await h.context.handleDecrypted({ k: 'snap', msgs: messages(1001) }, 1);
  assert.equal(h.context.mpState.messages.length, 0);
  // Valid signature and sequence, but an invalid oversized frame is still rejected.
  h.context.mpState.role = 'host';
  await h.context.sendHostRelay({ k: 'snap', msgs: messages(1001) });
  h.context.mpState.role = 'guest';
  await h.context.handleDecrypted(h.sent.at(-1), 1);
  assert.equal(h.context.mpState.messages.length, 0);
});
