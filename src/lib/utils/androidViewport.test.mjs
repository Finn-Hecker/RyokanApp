import assert from 'node:assert/strict';
import { test } from 'node:test';
import { androidViewport } from './androidViewport.ts';

test('Android root follows viewport resize, pan and keyboard close', () => {
  const originals = Object.fromEntries(
    ['navigator', 'window', 'document', 'HTMLElement', 'HTMLTextAreaElement', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']
      .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)])
  );
  const listeners = new Map();
  const events = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); }
  };
  const viewport = { height: 700, offsetTop: 0, ...events };
  const properties = new Map();
  const root = {
    classList: { add() {}, remove() {} },
    style: {
      height: '', top: '',
      setProperty(name, value) { properties.set(name, value); },
      removeProperty(name) { properties.delete(name); }
    },
    contains() { return false; },
    getBoundingClientRect() { return { top: Number.parseFloat(this.style.top), bottom: Number.parseFloat(this.style.top) + Number.parseFloat(this.style.height) }; }
  };
  let frame;
  try {
    Object.defineProperties(globalThis, {
      navigator: { configurable: true, value: { userAgent: 'Android WebView' } },
      window: { configurable: true, value: { visualViewport: viewport, innerHeight: 700, ...events } },
      document: { configurable: true, value: { activeElement: null, ...events } },
      HTMLElement: { configurable: true, value: class {} },
      HTMLTextAreaElement: { configurable: true, value: class {} },
      getComputedStyle: { configurable: true, value: () => ({ overflowY: 'auto' }) },
      requestAnimationFrame: { configurable: true, value: callback => { frame = callback; return 1; } },
      cancelAnimationFrame: { configurable: true, value: () => {} }
    });

    const action = androidViewport(root);
    assert.equal(root.style.height, '700px');
    viewport.height = 410;
    viewport.offsetTop = 35;
    listeners.get('resize')();
    frame();
    assert.equal(root.style.height, '410px');
    assert.equal(root.style.top, '35px');
    assert.equal(properties.get('--app-visible-height'), '410px');

    viewport.height = 700;
    viewport.offsetTop = 0;
    listeners.get('scroll')();
    frame();
    assert.equal(root.style.height, '700px');
    assert.equal(root.style.top, '0px');

    const parent = new globalThis.HTMLElement();
    parent.parentElement = root;
    parent.scrollHeight = 1000;
    parent.clientHeight = 400;
    parent.scrollTop = 0;
    parent.getBoundingClientRect = () => ({ top: 0, bottom: 400 });
    const field = new globalThis.HTMLElement();
    field.parentElement = parent;
    field.matches = () => true;
    field.getBoundingClientRect = () => ({ top: 450 - parent.scrollTop, bottom: 490 - parent.scrollTop, height: 40 });
    root.contains = element => element === parent || element === field;
    globalThis.document.activeElement = field;
    listeners.get('focusin')();
    frame();
    assert.equal(parent.scrollTop, 90);

    action.destroy();
    assert.equal(properties.has('--app-visible-height'), false);
  } finally {
    for (const [key, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
});
