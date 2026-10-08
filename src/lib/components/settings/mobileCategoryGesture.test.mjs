import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileCategoryGesture } from './mobileCategoryGesture.ts';

function harness() {
  class Element {
    listeners = new Map();
    isConnected = true;
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name) { this.listeners.delete(name); }
    closest() { return this; }
  }
  const node = new Element();
  const doc = new Element();
  const win = new Element();
  const rows = ['provider', 'presets', 'language'].map(id => Object.assign(new Element(), { dataset: { categoryId: id } }));
  node.contains = row => rows.includes(row);
  doc.elementFromPoint = (x, y) => x >= 0 && x < 300 ? rows[Math.floor(y / 64)] ?? null : null;
  let timer;
  const globals = { Element, document: doc, window: win, setTimeout: callback => { timer = callback; return 1; }, clearTimeout: () => { timer = null; } };
  const originals = new Map(Object.keys(globals).map(key => [key, globalThis[key]]));
  Object.assign(globalThis, globals);
  const previews = [];
  const holding = [];
  const selected = [];
  const action = mobileCategoryGesture(node, { onHolding: value => holding.push(value), onPreview: id => previews.push(id), onSelect: id => selected.push(id) });
  function touch(name, y, extra = {}) {
    const finger = { identifier: 1, clientX: 20, clientY: y };
    const event = { target: rows[0], touches: name === 'touchend' ? [] : [finger], changedTouches: [finger], cancelable: true,
      preventDefault() { this.prevented = true; }, ...extra };
    (name === 'touchstart' ? node : doc).listeners.get(name)(event);
    return event;
  }
  return { node, doc, win, previews, holding, selected, touch, hold: () => timer?.(), close() {
    action.destroy();
    for (const [key, value] of originals) {
      if (value === undefined) delete globalThis[key]; else globalThis[key] = value;
    }
  } };
}

test('hold and slide previews the touched category and opens only the release target', () => {
  const h = harness();
  try {
    h.touch('touchstart', 20);
    h.hold();
    assert.equal(h.holding.at(-1), true);
    assert.equal(h.previews.at(-1), 'provider');
    assert.equal(h.touch('touchmove', 90).prevented, true);
    assert.equal(h.previews.at(-1), 'presets');
    h.touch('touchmove', 20);
    assert.equal(h.previews.at(-1), 'provider');
    h.touch('touchmove', 90);
    assert.equal(h.previews.at(-1), 'presets');
    assert.deepEqual(h.selected, []);
    assert.equal(h.touch('touchend', 150).prevented, true);
    assert.deepEqual(h.selected, ['language']);
    assert.equal(h.previews.at(-1), null);
    assert.equal(h.holding.at(-1), false);
  } finally { h.close(); }
});

test('normal tap and scrolling before the hold leave native behavior untouched', () => {
  const h = harness();
  try {
    h.touch('touchstart', 20);
    assert.equal(h.touch('touchend', 20).prevented, undefined);
    h.touch('touchstart', 20);
    assert.equal(h.touch('touchmove', 40).prevented, undefined);
    h.hold();
    assert.equal(h.touch('touchend', 90).prevented, undefined);
    assert.deepEqual(h.selected, []);
  } finally { h.close(); }
});

test('release outside the list cancels; moving back inside restores the preview', () => {
  const h = harness();
  try {
    h.touch('touchstart', 20); h.hold();
    h.touch('touchmove', 400);
    assert.equal(h.previews.at(-1), null);
    assert.equal(h.holding.at(-1), true);
    h.touch('touchmove', 90);
    assert.equal(h.previews.at(-1), 'presets');
    h.touch('touchend', 90, { changedTouches: [{ identifier: 1, clientX: -5, clientY: 90 }] });
    assert.deepEqual(h.selected, []);
  } finally { h.close(); }
});

for (const reason of ['touchcancel', 'scroll', 'blur', 'Escape', 'second finger', 'uncancelable move', 'destroy']) {
  test(`${reason} cancels without opening a category`, () => {
    const h = harness();
    try {
      h.touch('touchstart', 20); h.hold();
      if (reason === 'second finger') h.doc.listeners.get('touchstart')({ touches: [{}, {}] });
      else if (reason === 'uncancelable move') h.touch('touchmove', 90, { cancelable: false });
      else if (reason === 'Escape') h.doc.listeners.get('keydown')({ key: 'Escape' });
      else if (reason === 'destroy') { h.close(); assert.equal(h.doc.listeners.size, 0); return; }
      else (reason === 'blur' ? h.win : h.doc).listeners.get(reason)();
      h.touch('touchend', 90);
      assert.deepEqual(h.selected, []);
      assert.equal(h.previews.at(-1), null);
    } finally { if (reason !== 'destroy') h.close(); }
  });
}

test('held selection suppresses the generated click while keyboard activation remains available', () => {
  const h = harness();
  try {
    h.touch('touchstart', 20); h.hold(); h.touch('touchend', 90);
    const click = { detail: 1, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
    h.node.listeners.get('click')(click);
    assert.equal(click.prevented, true);
    assert.equal(click.stopped, true);
    const keyboard = { ...click, detail: 0, prevented: false, stopped: false };
    h.node.listeners.get('click')(keyboard);
    assert.equal(keyboard.prevented, false);
    assert.deepEqual(h.selected, ['presets']);
  } finally { h.close(); }
});
