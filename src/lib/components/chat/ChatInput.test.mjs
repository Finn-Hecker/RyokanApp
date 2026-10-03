import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

// Run the component controller with deterministic layout and lifecycle boundaries.
function composer({ interactionMode = 'desktop', coarse = false, visibleHeight = 700, ...props } = {}) {
  const source = readFileSync(new URL('./ChatInput.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('ChatInput.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
    .map(statement => statement.getText(ast)).join('\n');
  const frames = new Map();
  const effects = [];
  let mount, cleanup, observer, sent = 0, measured = 0, frameId = 0;
  const field = {
    value: 'draft', style: { height: '44px' },
    get scrollHeight() { measured++; return this.contentHeight; },
    contentHeight: 65,
    get offsetHeight() { throw new Error('Unexpected extra forced layout'); },
  };
  const listeners = new Map();
  const events = {
    addEventListener: (name, callback) => listeners.set(name, callback),
    removeEventListener: name => listeners.delete(name),
  };
  const viewport = { height: visibleHeight, ...events };
  const document = { activeElement: field };
  const context = vm.createContext({
    $props: () => ({ value: 'draft', interactionMode, onSend: () => sent++, ...props }),
    $bindable: value => value, $state: value => value,
    $effect: effect => effects.push(effect), onMount: callback => { mount = callback; },
    requestAnimationFrame: callback => { frames.set(++frameId, callback); return frameId; },
    cancelAnimationFrame: id => frames.delete(id),
    window: { innerHeight: 700, visualViewport: viewport,
      matchMedia: () => ({ matches: coarse, ...events }), ...events },
    document,
    ResizeObserver: class {
      constructor(callback) { observer = this; this.callback = callback; }
      observe() {}
      disconnect() { this.disconnected = true; }
    },
    field,
  });
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
  vm.runInContext('textarea = field; inputLayer = {};', context);
  cleanup = mount();
  return {
    context, field, frames, viewport, document, listeners,
    get sent() { return sent; }, get measured() { return measured; },
    effect: () => effects.forEach(effect => effect()),
    destroy: () => cleanup(),
    get observer() { return observer; },
    frame() {
      const callbacks = [...frames.values()]; frames.clear();
      callbacks.forEach(callback => callback());
    },
    key(overrides = {}) {
      const event = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13,
        prevented: false, preventDefault() { this.prevented = true; }, ...overrides };
      context.handleKeydown(event);
      return event;
    },
  };
}

test('desktop Enter sends; Shift+Enter and IME confirmation keep native behavior', () => {
  const c = composer();
  assert.equal(c.key().prevented, true);
  assert.equal(c.sent, 1);
  for (const override of [{ shiftKey: true }, { isComposing: true }, { keyCode: 229 }, { key: 'a' }]) {
    assert.equal(c.key(override).prevented, false);
  }
  assert.equal(c.sent, 1);
});

test('mobile and touch Enter never submit or suppress the native newline', () => {
  for (const options of [{ interactionMode: 'mobile' }, { coarse: true }]) {
    const c = composer(options);
    assert.equal(c.key().prevented, false);
    assert.equal(c.key({ shiftKey: true }).prevented, false);
    assert.equal(c.sent, 0);
    c.context.handleSend();
    assert.equal(c.sent, 1); // Send button retains the same send handler.
  }
});

test('empty drafts and busy desktop composers do not send', () => {
  for (const props of [{ value: '  \n' }, { isGenerating: true }, { isSavingEdit: true }]) {
    const c = composer(props);
    assert.equal(c.key().prevented, true);
    assert.equal(c.sent, 0);
  }
});

test('rapid typing batches measurement and supports growth, shrink and the height cap', () => {
  const c = composer();
  for (let i = 0; i < 10; i++) c.context.scheduleResize();
  c.effect();
  assert.equal(c.measured, 0);
  assert.equal(c.frames.size, 1);
  c.frame();
  assert.equal(c.measured, 1);
  assert.equal(c.field.style.height, '65px');
  for (const [height, expected] of [[650, '400px'], [44, '44px']]) {
    c.field.contentHeight = height;
    c.context.scheduleResize(); c.frame();
    assert.equal(c.field.style.height, expected);
  }
});

test('programmatic clear, draft restore and width changes resize; teardown cancels work', () => {
  const c = composer();
  c.field.value = ''; c.effect(); c.frame();
  assert.equal(c.field.style.height, '44px');
  assert.equal(c.measured, 0);
  c.field.value = 'restored\ndraft'; c.effect(); c.frame();
  assert.equal(c.field.style.height, '65px');
  c.observer.callback([{ target: c.field, contentRect: { width: 300 } }]);
  c.frame();
  const count = c.measured;
  c.observer.callback([{ target: c.field, contentRect: { width: 300 } }]);
  assert.equal(c.frames.size, 0);
  assert.equal(c.measured, count);
  c.context.scheduleResize(); c.destroy();
  assert.equal(c.frames.size, 0);
  assert.equal(c.observer.disconnected, true);
});

test('mobile height follows keyboard space, landscape and keyboard dismissal', () => {
  const c = composer({ interactionMode: 'mobile', visibleHeight: 300 });
  c.field.contentHeight = 600;
  c.frame();
  assert.equal(c.field.style.height, '120px');
  assert.equal(c.field.style.maxHeight, '120px');
  c.viewport.height = 180;
  c.listeners.get('resize')(); c.frame();
  assert.equal(c.field.style.height, '72px');
  c.viewport.height = 700;
  c.listeners.get('resize')(); c.frame();
  assert.equal(c.field.style.height, '240px');
});

test('mobile action pointerdown keeps an open keyboard without capturing textarea gestures', () => {
  for (const options of [{ interactionMode: 'mobile' }, { coarse: true }, {}]) {
    const c = composer(options);
    const event = { isPrimary: true, button: 0, prevented: false,
      preventDefault() { this.prevented = true; } };
    c.context.keepInputFocus(event);
    assert.equal(event.prevented, Boolean(options.interactionMode || options.coarse));
    c.document.activeElement = null;
    event.prevented = false;
    c.context.keepInputFocus(event);
    assert.equal(event.prevented, false);
  }
});
