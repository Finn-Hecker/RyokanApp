import assert from 'node:assert/strict';
import test from 'node:test';
import { mobileSidebarSwipe } from './mobileSidebarSwipe.ts';
import { mobileCharacterLongPress } from '../lobby/mobileCharacterLongPress.ts';

function harness(run, { enabled = true, mobileWidth = true, width = 300 } = {}) {
  const previous = Object.fromEntries(['Element', 'document', 'window'].map(key => [key, globalThis[key]]));
  class Element {
    listeners = new Map();
    parentElement = null;
    contains(target) { return target === this || target.parentElement === this; }
    addEventListener(name, callback, options) { this.listeners.set(name, { callback, options }); }
    removeEventListener(name, callback) {
      assert.equal(this.listeners.get(name).callback, callback);
      this.listeners.delete(name);
    }
    dispatchEvent(event) { this.listeners.get(event.type)?.callback(event); }
  }
  const node = new Element();
  const card = new Element();
  card.parentElement = node;
  const document = new Element();
  const drags = [], releases = [];
  const options = { enabled, getWidth: () => width, onDrag: progress => drags.push(progress), onRelease: open => releases.push(open) };
  Object.assign(globalThis, { Element, document, window: { matchMedia: () => ({ matches: mobileWidth }) } });
  const action = mobileSidebarSwipe(node, options);
  let destroyed = false;
  function touch(x, y, identifier = 1) { return { clientX: x, clientY: y, identifier }; }
  function dispatch(name, x = 100, y = 100, extra = {}) {
    const event = {
      target: card, cancelable: true, detail: 1, prevented: false, stopped: false,
      touches: name === 'touchend' ? [] : [touch(x, y)], changedTouches: [touch(x, y)],
      preventDefault() { this.prevented = true; },
      stopImmediatePropagation() { this.stopped = true; }, ...extra,
    };
    const surface = node.listeners.has(name) ? node : document;
    surface.listeners.get(name).callback(event);
    return event;
  }
  try {
    run({ node, card, document, drags, releases, touch, dispatch,
      update: enabled => action.update({ ...options, enabled }),
      destroy: () => { action.destroy(); destroyed = true; },
    });
  } finally {
    if (!destroyed) action.destroy();
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete globalThis[key];
      else globalThis[key] = value;
    }
  }
}

test('even a light right drag immediately reveals exactly the distance travelled', () => {
  harness(h => {
    h.dispatch('touchstart');
    assert.equal(h.dispatch('touchmove', 106, 100).prevented, true);
    assert.deepEqual(h.drags, [6 / 300]);
    h.dispatch('touchmove', 175, 104);
    assert.equal(h.drags.at(-1), .25);
    assert.deepEqual(h.releases, [], 'the panel tracks the finger before release');
    h.dispatch('touchmove', 130, 103);
    assert.equal(h.drags.at(-1), .1, 'reversing the finger pulls the panel back');
    h.dispatch('touchmove', 1000, 100);
    assert.equal(h.drags.at(-1), 1, 'the drawer cannot overshoot its width');
    h.dispatch('touchmove', 80, 100);
    assert.equal(h.drags.at(-1), 0);
  });
});

test('release opens at 30 percent of the actual drawer width and closes below it', () => {
  for (const [width, distance, open] of [[300, 89, false], [300, 90, true], [300, 150, true], [400, 119, false], [400, 120, true]]) {
    harness(h => {
      h.dispatch('touchstart');
      h.dispatch('touchmove', 100 + distance, 100);
      h.dispatch('touchend', 100 + distance, 100);
      assert.deepEqual(h.releases, [open]);
      h.dispatch('touchend', 100 + distance, 100);
      assert.deepEqual(h.releases, [open], 'release happens only once');
    }, { width });
  }
});

test('a long-held drag still settles by distance and a reversal uses the final position', () => {
  const previousNow = Date.now;
  let now = 1000;
  Date.now = () => now;
  try {
    harness(h => {
      h.dispatch('touchstart');
      h.dispatch('touchmove', 220, 100);
      now += 2000;
      h.dispatch('touchend', 220, 100);
      assert.deepEqual(h.releases, [true]);
      h.dispatch('touchstart');
      h.dispatch('touchmove', 220, 100);
      h.dispatch('touchend', 130, 100);
      assert.deepEqual(h.releases, [true, false]);
    });
  } finally { Date.now = previousNow; }
});

test('the gesture covers cards, page controls, images, text and the header', () => {
  harness(h => {
    for (const tagName of ['BUTTON', 'INPUT', 'IMG', 'SPAN', 'HEADER', 'A']) {
      h.card.tagName = tagName;
      h.dispatch('touchstart');
      h.dispatch('touchmove', 190, 100);
      assert.equal(h.drags.at(-1), .3);
      h.dispatch('touchend', 190, 100);
      assert.equal(h.releases.at(-1), true);
    }
  });
});

test('taps, left swipes and vertical scrolls remain native, including a scroll turning right', () => {
  for (const [x, y] of [[103, 101], [20, 103], [102, 180], [170, 165]]) {
    harness(h => {
      h.dispatch('touchstart');
      assert.equal(h.dispatch('touchmove', x, y).prevented, false);
      h.dispatch('touchend', x, y);
      assert.deepEqual(h.drags, []);
      assert.deepEqual(h.releases, []);
      assert.equal(h.dispatch('click').prevented, false);
    });
  }
  harness(h => {
    h.dispatch('touchstart');
    h.dispatch('touchmove', 104, 120);
    h.dispatch('touchmove', 200, 121);
    h.dispatch('touchend', 200, 121);
    assert.deepEqual(h.drags, []);
  });
});

test('dragging does not activate a card, but the next tap and keyboard activation still work', () => {
  harness(h => {
    h.dispatch('touchstart');
    h.dispatch('touchmove', 115, 100);
    h.dispatch('touchend', 115, 100);
    assert.equal(h.dispatch('click', 100, 100, { detail: 0 }).prevented, false);
    const click = h.dispatch('click');
    assert.equal(click.prevented, true);
    assert.equal(click.stopped, true);
    h.dispatch('touchstart');
    h.dispatch('touchend');
    assert.equal(h.dispatch('click').prevented, false);
  });
});

test('a light drag cancels the production character long-press timer', () => {
  harness(h => {
    const previousTimeout = globalThis.setTimeout, previousClear = globalThis.clearTimeout;
    const timers = new Map();
    let next = 0, longPresses = 0;
    globalThis.setTimeout = callback => { timers.set(++next, callback); return next; };
    globalThis.clearTimeout = id => timers.delete(id);
    const longPress = mobileCharacterLongPress(h.card, { enabled: true, onLongPress: () => { longPresses++; } });
    try {
      h.card.dispatchEvent({ type: 'pointerdown', pointerType: 'touch', clientX: 100, clientY: 100 });
      assert.equal(timers.size, 1);
      h.dispatch('touchstart');
      h.dispatch('touchmove', 106, 100);
      assert.equal(timers.size, 0);
      for (const callback of timers.values()) callback();
      assert.equal(longPresses, 0);
    } finally {
      longPress.destroy();
      globalThis.setTimeout = previousTimeout;
      globalThis.clearTimeout = previousClear;
    }
  });
});

test('disabled pages and desktop widths do not start a drag', () => {
  for (const options of [{ enabled: false }, { mobileWidth: false }]) {
    harness(h => {
      h.dispatch('touchstart');
      assert.equal(h.dispatch('touchmove', 200, 100).prevented, false);
      h.dispatch('touchend', 200, 100);
      assert.deepEqual(h.drags, []);
      assert.deepEqual(h.releases, []);
    }, options);
  }
});

test('cancellation, a dialog, native scrolling and a second finger settle the panel closed', () => {
  for (const kind of ['disabled', 'cancelled', 'multitouch', 'scrolling']) {
    harness(h => {
      h.dispatch('touchstart');
      h.dispatch('touchmove', 200, 100);
      if (kind === 'disabled') h.update(false);
      if (kind === 'cancelled') h.dispatch('touchcancel');
      if (kind === 'multitouch') h.document.listeners.get('touchstart').callback({ touches: [h.touch(200, 100), h.touch(250, 100, 2)] });
      if (kind === 'scrolling') h.dispatch('touchmove', 200, 100, { cancelable: false });
      h.dispatch('touchend', 200, 100);
      assert.deepEqual(h.releases, [false]);
    });
  }
});

test('document capture keeps dragging over child controls and listeners are released on unmount', () => {
  harness(h => {
    assert.equal(h.node.listeners.get('touchstart').options.capture, true);
    assert.deepEqual(h.document.listeners.get('touchmove').options, { passive: false, capture: true });
    assert.equal(h.node.listeners.get('click').options, true);
    h.destroy();
    assert.equal(h.node.listeners.size, 0);
    assert.equal(h.document.listeners.size, 0);
  });
});
