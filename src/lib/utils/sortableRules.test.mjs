import assert from 'node:assert/strict';
import test from 'node:test';
import { sortableRules } from './sortableRules.ts';

function harness() {
  const original = new Map();
  const globals = { Element: null, document: null, window: null, getComputedStyle: () => ({ overflowY: 'auto' }), requestAnimationFrame: () => 1, cancelAnimationFrame: () => {}, setTimeout: null, clearTimeout: () => {} };
  let timer;
  let frame;
  globals.requestAnimationFrame = callback => { frame = callback; return 1; };
  class Element {
    listeners = new Map();
    dataset = {};
    scrollTop = 0;
    style = {};
    classList = { add() {} };
    isConnected = true;
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    removeEventListener(name) { this.listeners.delete(name); }
    closest(selector) { return selector === '[data-rule-id]' ? this : this.control ? this : null; }
    getBoundingClientRect() { return { top: this.top ?? 0, bottom: 300, left: 0, width: 300, height: 50 }; }
    cloneNode() { return new Element(); }
    removeAttribute() {}
    setAttribute() {}
    remove() {}
    contains() { return true; }
    hasPointerCapture() { return false; }
    setPointerCapture() {}
    appendChild() {}
  }
  const node = new Element();
  const rows = ['a', 'b', 'c'].map((id, index) => { const row = new Element(); row.dataset.ruleId = id; row.top = index * 50; return row; });
  node.querySelectorAll = () => rows;
  node.parentElement = new Element();
  const doc = new Element();
  const win = new Element();
  Object.assign(globals, { Element, document: doc, window: win, setTimeout: callback => { timer = callback; return 1; } });
  for (const [key, value] of Object.entries(globals)) { original.set(key, globalThis[key]); globalThis[key] = value; }
  const previews = [];
  const finishes = [];
  const action = sortableRules(node, { preview: (id, index) => previews.push([id, index]), finish: commit => finishes.push(commit) });
  function pointer(name, y, overrides = {}) {
    const event = { target: rows[0], pointerType: 'mouse', pointerId: 1, isPrimary: true, button: 0, clientX: 20, clientY: y, preventDefault() { this.prevented = true; }, ...overrides };
    (name === 'pointerdown' ? node : doc).listeners.get(name)(event);
    return event;
  }
  function touch(name, y, overrides = {}) {
    const t = { identifier: 1, clientX: 20, clientY: y };
    const event = { target: rows[0], touches: [t], changedTouches: [t], cancelable: true, preventDefault() { this.prevented = true; }, ...overrides };
    (name === 'touchstart' ? node : doc).listeners.get(name)(event);
    return event;
  }
  return { node, doc, rows, previews, finishes, pointer, touch, longPress: () => timer(), scrollFrame: () => frame(), close() {
    action.destroy();
    for (const [key, value] of original) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  } };
}

test('desktop previews first to last and back, and commits only on release', () => {
  const h = harness();
  try {
    h.pointer('pointerdown', 25);
    h.pointer('pointermove', 130);
    assert.deepEqual(h.previews.at(-1), ['a', 2]);
    assert.deepEqual(h.finishes, []);
    h.pointer('pointermove', 25);
    assert.deepEqual(h.previews.at(-1), ['a', 0]);
    h.pointer('pointerup', 130);
    assert.deepEqual(h.finishes, [true]);
  } finally { h.close(); }
});

test('mobile scroll before long press never starts sorting', () => {
  const h = harness();
  try {
    h.touch('touchstart', 25);
    assert.equal(h.touch('touchmove', 50).prevented, undefined);
    h.longPress();
    h.touch('touchend', 50);
    assert.deepEqual(h.previews, []);
    assert.deepEqual(h.finishes, []);
  } finally { h.close(); }
});

test('mobile long press blocks scroll and finishes outside the source row despite pointercancel', () => {
  const h = harness();
  try {
    h.touch('touchstart', 25);
    h.longPress();
    h.pointer('pointercancel', 25, { pointerType: 'touch' });
    assert.equal(h.touch('touchmove', 130, { target: h.doc }).prevented, true);
    assert.deepEqual(h.previews.at(-1), ['a', 2]);
    h.touch('touchend', 130, { target: h.doc });
    h.touch('touchend', 130);
    assert.deepEqual(h.finishes, [true]);
  } finally { h.close(); }
});

for (const reason of ['touchcancel', 'second finger', 'native scroll', 'Escape', 'destroy']) {
  test(`${reason} cancels without persisting a preview`, () => {
    const h = harness();
    try {
      h.touch('touchstart', 25); h.longPress();
      if (reason === 'touchcancel') h.doc.listeners.get('touchcancel')();
      if (reason === 'second finger') h.doc.listeners.get('touchstart')({ touches: [{}, {}] });
      if (reason === 'native scroll') h.touch('touchmove', 130, { cancelable: false });
      if (reason === 'Escape') h.doc.listeners.get('keydown')({ key: 'Escape', preventDefault() {} });
      if (reason === 'destroy') h.close();
      assert.deepEqual(h.finishes, [false]);
    } finally { if (reason !== 'destroy') h.close(); }
  });
}

test('buttons and toggles keep their own gestures', () => {
  const h = harness();
  try {
    h.rows[0].control = true;
    h.pointer('pointerdown', 25); h.pointer('pointermove', 130); h.pointer('pointerup', 130);
    assert.deepEqual(h.previews, []);
  } finally { h.close(); }
});

test('last row can move to the first slot and out-of-range positions clamp', () => {
  const h = harness();
  try {
    h.pointer('pointerdown', 125, { target: h.rows[2] });
    h.pointer('pointermove', -100);
    assert.deepEqual(h.previews.at(-1), ['c', 0]);
    h.pointer('pointermove', 1000);
    assert.deepEqual(h.previews.at(-1), ['c', 2]);
    h.pointer('pointerup', -100);
    assert.deepEqual(h.previews.at(-1), ['c', 0]);
    assert.deepEqual(h.finishes, [true]);
  } finally { h.close(); }
});

test('edge scrolling updates the target even while the finger stays still', () => {
  const h = harness();
  try {
    h.touch('touchstart', 25); h.longPress();
    h.touch('touchmove', 275);
    h.scrollFrame();
    assert.equal(h.node.parentElement.scrollTop, 7);
    assert.deepEqual(h.previews.at(-1), ['a', 2]);
  } finally { h.close(); }
});
