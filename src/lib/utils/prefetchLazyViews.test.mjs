import assert from 'node:assert/strict';
import test from 'node:test';
import { createLazyView } from './lazyView.ts';
import { prefetchLazyViews } from './prefetchLazyViews.ts';

function scheduler(useIdle = true) {
  let id = 0;
  const frames = new Map(), idle = new Map(), timers = new Map();
  const browser = {
    requestAnimationFrame: callback => { frames.set(++id, callback); return id; },
    cancelAnimationFrame: key => frames.delete(key),
    setTimeout: (callback, delay) => { assert.equal(delay, 250); timers.set(++id, callback); return id; },
    clearTimeout: key => timers.delete(key),
    ...(useIdle ? {
      requestIdleCallback: callback => { idle.set(++id, callback); return id; },
      cancelIdleCallback: key => idle.delete(key),
    } : {}),
  };
  function run(queue) {
    assert.equal(queue.size, 1);
    const [key, callback] = queue.entries().next().value;
    queue.delete(key);
    callback();
  }
  return { browser, frames, idle, timers,
    paint: () => run(frames), work: () => run(useIdle ? idle : timers) };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

for (const useIdle of [true, false]) {
  test(`prefetch yields through paint and loads sequentially in priority order (idle=${useIdle})`, async () => {
    const s = scheduler(useIdle), calls = [];
    const views = ['chat', 'settings', 'editor', 'multiplayer'].map(name => createLazyView(async () => {
      calls.push(name); return { default: () => {} };
    }));
    prefetchLazyViews(views, s.browser);
    assert.deepEqual(calls, []);
    s.paint();
    assert.deepEqual(calls, []);
    s.paint();
    assert.deepEqual(calls, []);
    for (let index = 0; index < views.length; index++) {
      s.work();
      assert.equal(calls.length, index + 1);
      await flush();
    }
    assert.deepEqual(calls, ['chat', 'settings', 'editor', 'multiplayer']);
    assert.equal(s.idle.size + s.timers.size, 0);
  });
}

test('navigation shares an in-flight prefetch and immediately reuses its cached component', async () => {
  const s = scheduler();
  const Component = () => {};
  let resolve, calls = 0;
  const view = createLazyView(() => {
    calls++;
    return new Promise(yes => { resolve = yes; });
  });
  prefetchLazyViews([view], s.browser);
  s.paint(); s.paint(); s.work();
  const navigation = view.load();
  assert.equal(calls, 1);
  resolve({ default: Component });
  assert.equal(await navigation, Component);
  assert.equal(view.component, Component);
  assert.equal(await view.load(), Component);
  assert.equal(calls, 1);
});

test('prefetch failure stays retryable and does not stop lower priorities', async () => {
  const s = scheduler();
  let calls = 0, settingsLoaded = false;
  const chat = createLazyView(async () => {
    if (++calls === 1) throw new Error('offline');
    return { default: () => {} };
  });
  const settings = createLazyView(async () => { settingsLoaded = true; return { default: () => {} }; });
  prefetchLazyViews([chat, settings], s.browser);
  s.paint(); s.paint(); s.work();
  await flush();
  assert.equal(chat.component, undefined);
  s.work(); await flush();
  assert.equal(settingsLoaded, true);
  await chat.load();
  assert.equal(calls, 2);
});

test('cleanup cancels queued frames, idle callbacks and fallback timers', () => {
  for (const useIdle of [true, false]) {
    for (const paintCount of [0, 1, 2]) {
      const s = scheduler(useIdle);
      const stop = prefetchLazyViews([createLazyView(async () => { throw new Error('must not import'); })], s.browser);
      for (let i = 0; i < paintCount; i++) s.paint();
      stop();
      assert.equal(s.frames.size + s.idle.size + s.timers.size, 0);
    }
  }
});

test('cleanup during an import preserves its cache but stops the prefetch queue', async () => {
  const s = scheduler();
  let resolve;
  const first = createLazyView(() => new Promise(yes => { resolve = yes; }));
  const second = createLazyView(async () => { throw new Error('must not import'); });
  const stop = prefetchLazyViews([first, second], s.browser);
  s.paint(); s.paint(); s.work(); stop();
  resolve({ default: () => {} });
  await flush();
  assert.ok(first.component);
  assert.equal(s.idle.size, 0);
  assert.equal(second.component, undefined);
});
