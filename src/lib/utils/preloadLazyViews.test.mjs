import assert from 'node:assert/strict';
import test from 'node:test';
import { createLazyView } from './lazyView.ts';
import { preloadLazyViews } from './preloadLazyViews.ts';

const flush = () => new Promise(resolve => setImmediate(resolve));
const immediate = async () => {};

test('desktop starts all six imports immediately and waits for every module without mounting', async () => {
  const releases = [], calls = [];
  let mounts = 0, ready = false;
  const Component = () => { mounts++; };
  const views = Array.from({ length: 6 }, (_, index) => createLazyView(() => {
    calls.push(index);
    return new Promise(resolve => { releases[index] = () => resolve({ default: Component }); });
  }));
  const pending = preloadLazyViews(views).then(() => { ready = true; });
  assert.deepEqual(calls, [0, 1, 2, 3, 4, 5]);
  for (const release of releases.slice(0, 5)) release();
  await flush();
  assert.equal(ready, false);
  releases[5]();
  await pending;
  assert.equal(ready, true);
  assert.ok(views.every(view => view.component === Component));
  assert.equal(mounts, 0);
});

test('Android limits imports to two and yields before starting subsequent modules', async () => {
  const calls = [], releases = [], yields = [];
  const views = Array.from({ length: 6 }, (_, index) => createLazyView(() => {
    calls.push(index);
    return new Promise(resolve => { releases[index] = () => resolve({ default: () => {} }); });
  }));
  const pending = preloadLazyViews(views, 2, () => new Promise(resolve => yields.push(resolve)));
  assert.deepEqual(calls, [0, 1]);
  releases[0](); releases[1]();
  await flush();
  assert.deepEqual(calls, [0, 1]);
  assert.equal(yields.length, 2);
  yields.shift()(); yields.shift()();
  await flush();
  assert.deepEqual(calls, [0, 1, 2, 3]);
  releases[2](); releases[3]();
  await flush();
  yields.shift()(); yields.shift()();
  await flush();
  assert.deepEqual(calls, [0, 1, 2, 3, 4, 5]);
  releases[4](); releases[5]();
  await pending;
});

test('navigation shares a pending preload and can synchronously reuse the cached component', async () => {
  let release, calls = 0;
  const Component = () => {};
  const view = createLazyView(() => {
    calls++;
    return new Promise(resolve => { release = () => resolve({ default: Component }); });
  });
  const pending = preloadLazyViews([view]);
  const navigation = view.load();
  release();
  await pending;
  assert.equal(await navigation, Component);
  assert.equal(view.component, Component);
  await preloadLazyViews([view]);
  assert.equal(calls, 1);
});

test('failure waits for the whole queue and retry retains successful caches', async () => {
  const calls = [0, 0, 0];
  const views = calls.map((_, index) => createLazyView(async () => {
    calls[index]++;
    if (index === 0 && calls[index] === 1) throw new Error('failed import');
    return { default: () => {} };
  }));
  await assert.rejects(preloadLazyViews(views, 1, immediate), /Could not preload/);
  assert.deepEqual(calls, [1, 1, 1]);
  assert.equal(views[0].component, undefined);
  await preloadLazyViews(views, 1, immediate);
  assert.deepEqual(calls, [2, 1, 1]);
  assert.ok(views.every(view => view.component));
});

test('an empty queue resolves without scheduling work', async () => {
  await preloadLazyViews([], 0, () => { throw new Error('must not yield'); });
});
