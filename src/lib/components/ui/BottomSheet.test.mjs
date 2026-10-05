import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';
import { compile } from 'svelte/compiler';
import postcss from 'postcss';
import { createRawSnippet } from 'svelte';
import { render } from 'svelte/server';
import { SheetVelocity, shouldDismissSheet } from '../../utils/bottomSheetGesture.ts';

// Render the real component so structural regressions are checked independently
// of gesture mocks. onMount is intentionally inert in the server render.
async function renderSheet(props = {}) {
  const source = readFileSync(new URL('./BottomSheet.svelte', import.meta.url), 'utf8')
    .replace(/^\s*import .*;$/gm, '')
    .replace('<script lang="ts">', '<script lang="ts">\nconst onMount = () => {};');
  const { js } = compile(source, { generate: 'server' });
  const code = js.code.replace("'svelte/internal/server'", JSON.stringify(import.meta.resolve('svelte/internal/server')));
  const { default: Component } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  const snippet = html => createRawSnippet(() => ({ render: () => html }));
  return render(Component, { props: {
    label: 'Sheet title', closeLabel: 'Close', onClose() {},
    children: snippet('<p data-part="body">Body</p>'),
    header: snippet('<h2 data-part="heading">Custom title</h2>'),
    toolbar: snippet('<p data-part="toolbar">Search</p>'),
    footer: snippet('<button data-part="footer">Continue</button>'),
    ...props,
  } }).body;
}

test('required sheets have neither a misleading drag handle nor a close control', async () => {
  const html = await renderSheet({ dismissible: false });
  assert.doesNotMatch(html, /class="handle[" ]/);
  assert.doesNotMatch(html, /class="sheet-close[" ]/);
  assert.match(html, /data-part="heading"/);
  assert.match(html, /data-part="footer"/);
});

test('custom header, toolbar and footer are siblings of the single scroll body', async () => {
  const html = await renderSheet();
  assert.match(html, /class="sheet-close[" ]/);
  const body = html.match(/<div[^>]*data-sheet-body[^>]*>([\s\S]*?)<\/div>/)[1];
  assert.match(body, /data-part="body"/);
  assert.doesNotMatch(body, /data-part="(?:heading|toolbar|footer)"/);
  assert.ok(html.indexOf('data-part="toolbar"') < html.indexOf('data-sheet-body'));
  assert.ok(html.indexOf('data-part="footer"') > html.indexOf('data-sheet-body'));
});

test('scrollbar and selection rules stay inside sheets without disabling scrolling or editing', () => {
  const source = readFileSync(new URL('./BottomSheet.svelte', import.meta.url), 'utf8');
  const { css } = compile(source, { generate: 'client' });
  const tree = postcss.parse(css.code);
  const scrolling = [], hiddenBars = [], unselectable = [], editable = [];
  tree.walkDecls(declaration => {
    const selector = declaration.parent.selector;
    if (declaration.prop === 'overflow-y' && declaration.value === 'auto') scrolling.push(selector);
    if (declaration.prop === 'scrollbar-width' && declaration.value === 'none') hiddenBars.push(selector);
    if (declaration.prop === 'user-select' && declaration.value === 'none') unselectable.push(selector);
    if (declaration.prop === 'user-select' && declaration.value === 'text') editable.push(selector);
  });
  assert.equal(scrolling.length, 1);
  assert.match(scrolling[0], /^\.content\./);
  assert.ok(hiddenBars.length && hiddenBars.every(selector => selector.startsWith('.panel.')));
  assert.ok(unselectable.some(selector => selector.startsWith('.panel.')));
  assert.ok(editable.some(selector => selector.includes('input') && selector.includes('textarea')));
});

test('initial modal focus outline is suppressed only on the full-screen backdrop', () => {
  const source = readFileSync(new URL('./BottomSheet.svelte', import.meta.url), 'utf8');
  const { css } = compile(source, { filename: 'BottomSheet.svelte', generate: 'client' });
  const suppressed = [];
  postcss.parse(css.code).walkDecls('outline', declaration => {
    if (declaration.value === 'none' || declaration.value === '0') suppressed.push(declaration.parent.selector);
  });
  // Check the emitted selector, so a global or descendant reset cannot silently
  // remove keyboard indicators from actual controls inside (or outside) the sheet.
  assert.equal(suppressed.length, 1);
  assert.match(suppressed[0], /^\.backdrop\.svelte-[\w-]+$/);
});

// Exercise the actual component's event handlers, following the existing Svelte
// script harness used by ChatRoom/ChatInput, without a WebView or Tauri backend.
function sheet(props = {}, environment = {}) {
  let mount, back, now = 0, cleanup;
  const animations = [];
  class Element {
    style = {};
    listeners = {};
    scrollBlocked = false;
    clientHeight = 600;
    modalOwner;
    closest() { return this.modalOwner; }
    setAttribute(name, value) { this[name] = value; }
    close() { this.open = false; }
    getBoundingClientRect() { return { height: 600 }; }
    addEventListener(name, handler) { this.listeners[name] = handler; }
    removeEventListener(name) { delete this.listeners[name]; }
    animate(frames, options) { const animation = { playState: 'finished', finished: Promise.resolve(), cancel() { this.playState = 'idle'; } }; animations.push({ frames, options, animation }); return animation; }
    showModal() { this.open = true; }
  }
  const panel = new Element(), backdrop = new Element(), dialog = new Element();
  panel.modalOwner = backdrop.modalOwner = dialog;
  const query = { matches: environment.mobile !== false, addEventListener(_name, callback) { this.change = callback; }, removeEventListener() {} };
  const source = readFileSync(new URL('./BottomSheet.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
  const context = vm.createContext({
    $props: () => ({ label: 'test', onClose() {}, ...props }), $state: value => value,
    onMount: callback => mount = callback, Element, HTMLElement: Element,
    window: { matchMedia: value => value.includes('reduced') ? { matches: Boolean(environment.reduced) } : query },
    m: { create_char_close_aria: () => 'Close' },
    getComputedStyle: node => ({ transform: node.computedTransform ?? node.style.transform ?? 'none', opacity: node.style.opacity ?? '1' }),
    DOMMatrixReadOnly: class { constructor() { this.m42 = 12; } },
    registerBackHandler: callback => { back = callback; return () => back = null; },
    performance: { now: () => now }, setTimeout: callback => { callback(); return 1; }, clearTimeout() {},
    canDragSheet: target => !target.scrollBlocked, SheetVelocity, shouldDismissSheet,
  });
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }), context);
  Object.assign(context, { testPanel: panel, testBackdrop: backdrop, testDialog: dialog });
  vm.runInContext('panel = testPanel; backdrop = testBackdrop; dialog = testDialog;', context);
  cleanup = mount();
  function touch(name, y, target = panel, x = 0, count = 1, cancelable = true) {
    now += 30;
    let prevented = false;
    panel.listeners[name]({ touches: Array.from({ length: count }, (_, identifier) => ({ identifier, clientX: x, clientY: y })),
      changedTouches: [{ identifier: 0, clientX: x, clientY: y }], target, cancelable, preventDefault() { prevented = true; } });
    return prevented;
  }
  function dispatch(name, target = backdrop, detail = 1) {
    let prevented = false, stopped = false;
    dialog.listeners[name]?.({ target, detail, preventDefault() { prevented = true; },
      stopImmediatePropagation() { stopped = true; } });
    if (name === 'click' && !stopped && target === backdrop) vm.runInContext('close()', context);
    return { prevented, stopped };
  }
  return { panel, dialog, backdrop, animations, touch, query, makeTarget: () => new Element(), back: () => back(), cleanup,
    context, dispatch, run: code => vm.runInContext(code, context), pause: ms => now += ms };
}

// Use the production long-press action with a fake clock. The modal is mounted
// by its real 350ms callback, while the source pointer is still held down.
function longPressSheet() {
  let now = 0, nextId = 0, opened;
  const timers = new Map(), listeners = {};
  const source = readFileSync(new URL('../lobby/mobileCharacterLongPress.ts', import.meta.url), 'utf8')
    .replace(/^import .*;$/gm, '').replace('export const', 'const');
  const context = vm.createContext({
    node: { addEventListener(name, handler) { listeners[name] = handler; }, removeEventListener(name) { delete listeners[name]; } },
    options: { enabled: true, onLongPress() { opened = sheet(); } },
    window: { matchMedia: () => ({ matches: true }) },
    setTimeout(callback, delay) { const id = ++nextId; timers.set(id, { callback, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }) + '\nmobileCharacterLongPress(node, options);', context);
  listeners.pointerdown({ pointerType: 'touch', clientX: 0, clientY: 0 });
  return {
    get opened() { return opened; },
    advance(ms) {
      now += ms;
      for (const [id, timer] of timers) if (timer.at <= now) { timers.delete(id); timer.callback(); }
    },
  };
}

for (const releaseAt of [350, 351, 530, 1000]) {
  for (const release of ['pointerup', 'touchend']) {
    test(`opening ${release} at ${releaseAt}ms cannot click-dismiss the long-press sheet`, () => {
      const press = longPressSheet();
      press.advance(349);
      assert.equal(press.opened, undefined, 'threshold must stay at 350ms');
      press.advance(1);
      const s = press.opened;
      assert.ok(s, 'the threshold opens the sheet before release');
      press.advance(releaseAt - 350);
      s.pause(releaseAt - 350);
      s.dispatch(release);
      assert.deepEqual(s.dispatch('click'), { prevented: true, stopped: true });
      assert.equal(s.run('visible'), true, 'opening release must leave the sheet open');
      s.dispatch(release === 'pointerup' ? 'pointerdown' : 'touchstart');
      s.dispatch(release);
      assert.deepEqual(s.dispatch('click'), { prevented: false, stopped: false });
      assert.equal(s.run('visible'), false, 'the very next backdrop tap dismisses normally');
      s.cleanup();
    });
  }
}

test('opening clicks on sheet actions are blocked before reaching their handlers', () => {
  const s = sheet();
  assert.deepEqual(s.dispatch('click', s.panel), { prevented: true, stopped: true });
  s.dispatch('pointerdown', s.panel);
  assert.deepEqual(s.dispatch('click', s.panel), { prevented: false, stopped: false });
  s.cleanup();
});

test('desktop backdrop clicks and keyboard activation still dismiss normally', () => {
  const desktop = sheet({}, { mobile: false });
  desktop.dispatch('pointerdown'); desktop.dispatch('pointerup'); desktop.dispatch('click');
  assert.equal(desktop.run('visible'), false);
  desktop.cleanup();
  const keyboard = sheet();
  assert.deepEqual(keyboard.dispatch('click', keyboard.backdrop, 0), { prevented: false, stopped: false });
  assert.equal(keyboard.run('visible'), false);
  keyboard.cleanup();
});

test('cancelled and nested presses do not arm the sheet, and listeners are removed', () => {
  const s = sheet();
  for (const [start, cancel] of [['pointerdown', 'pointercancel'], ['touchstart', 'touchcancel']]) {
    s.dispatch(start); s.dispatch(cancel);
    assert.equal(s.dispatch('click').stopped, true);
  }
  const nested = s.makeTarget(); nested.modalOwner = {};
  s.dispatch('pointerdown', nested);
  assert.equal(s.dispatch('click').stopped, true);
  assert.equal(s.run('visible'), true);
  s.cleanup();
  assert.equal(Object.keys(s.dialog.listeners).length, 0);
});

test('small pull follows the finger, fades the backdrop and snaps back', () => {
  const s = sheet();
  assert.equal(s.dialog.open, true);
  s.touch('touchstart', 0);
  assert.equal(s.touch('touchmove', 30), true);
  assert.equal(s.panel.style.transform, 'translate3d(0,30px,0)');
  assert.equal(s.backdrop.style.opacity, '0.95');
  s.pause(200);
  s.touch('touchend', 30);
  assert.equal(s.run('visible'), true);
  assert.equal(s.animations.length, 2);
  assert.equal(s.panel.style.transform, 'translate3d(0,0px,0)');
});

test('a fast downward swipe dismisses; a held short pull does not', () => {
  const s = sheet();
  s.touch('touchstart', 0); s.touch('touchmove', 60); s.touch('touchend', 60);
  assert.equal(s.run('visible'), false);
});

test('scroll-to-top hands off without including the preceding scroll distance', () => {
  const s = sheet();
  s.panel.scrollBlocked = true;
  s.touch('touchstart', 0);
  assert.equal(s.touch('touchmove', 100), false);
  s.panel.scrollBlocked = false;
  assert.equal(s.touch('touchmove', 120), true);
  assert.equal(s.panel.style.transform, 'translate3d(0,20px,0)');
});

test('horizontal gestures remain native and cancellation/multitouch snap back', () => {
  const s = sheet();
  s.touch('touchstart', 0);
  assert.equal(s.touch('touchmove', 10, s.panel, 60), false);
  assert.equal(s.run('gesture'), null);
  s.touch('touchstart', 0); s.touch('touchmove', 250); s.touch('touchcancel', 250);
  assert.equal(s.run('visible'), true);
  s.touch('touchstart', 0); s.touch('touchmove', 250); s.touch('touchmove', 260, s.panel, 0, 2);
  assert.equal(s.run('visible'), true);
});

test('Back is consumed during dismissal and unregisters on destruction', () => {
  const s = sheet();
  assert.equal(s.back(), true);
  assert.equal(s.run('visible'), false);
  assert.equal(s.back(), true);
  s.cleanup();
  assert.equal(Object.keys(s.panel.listeners).length, 0);
});

test('nested state closes first; required onboarding leaves Back to the app without closing', () => {
  let nested = true;
  const s = sheet({ beforeClose: () => { if (!nested) return false; nested = false; return true; } });
  s.back(); assert.equal(s.run('visible'), true);
  s.back(); assert.equal(s.run('visible'), false);
  const mandatory = sheet({ dismissible: false });
  assert.equal(mandatory.back(), false); assert.equal(mandatory.run('visible'), true);
});


test('close completion resets the parent and repeated reopen cycles complete exactly once', async () => {
  for (let cycle = 0; cycle < 3; cycle++) {
    let open = true, closed = 0;
    const s = sheet({ onClose: () => { open = false; closed++; } });
    s.back(); s.back();
    assert.equal(open, true, 'parent stays mounted for exit animation');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(open, false, 'parent condition resets, allowing a fresh open');
    assert.equal(closed, 1);
    s.cleanup();
  }
});

test('navigation during dismissal cancels the pending close callback', async () => {
  let closed = 0;
  const s = sheet({ onClose: () => closed++ });
  s.back(); s.cleanup();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 0);
});

test('nested modal scroll locks restore the original overflow after the final outro', () => {
  const source = readFileSync(new URL('./BottomSheet.svelte', import.meta.url), 'utf8')
    .match(/<script module lang="ts">([\s\S]*?)<\/script>/)[1];
  const document = { body: { appendChild() {} }, documentElement: { style: { overflow: 'auto' } } };
  const node = { close() {}, remove() {} };
  const context = vm.createContext({ document, node });
  vm.runInContext(ts.transpile(source, { target: ts.ScriptTarget.ES2022 }), context);
  const outer = vm.runInContext('lockBackground(node)', context);
  const inner = vm.runInContext('lockBackground(node)', context);
  assert.equal(document.documentElement.style.overflow, 'hidden');
  inner.destroy(); assert.equal(document.documentElement.style.overflow, 'hidden');
  outer.destroy(); assert.equal(document.documentElement.style.overflow, 'auto');
});


test('nested dialog touches never start a drag on the containing sheet', () => {
  const s = sheet();
  const target = s.makeTarget(); target.modalOwner = {};
  s.touch('touchstart', 0, target);
  assert.equal(s.touch('touchmove', 150, target), false);
  assert.equal(s.run('gesture'), null);
});

test('selection callbacks run after native inertness is released and exactly once', async () => {
  const order = [];
  const s = sheet({ onClose: () => order.push('parent') });
  s.dialog.close = () => { s.dialog.open = false; order.push('native'); };
  s.context.testOrder = order;
  s.run('close(() => { if (dialog.open) throw new Error("still modal"); testOrder.push("selection"); })');
  s.back();
  assert.equal(s.panel.inert, true);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(order, ['native', 'parent', 'selection']);
});

test('external navigation releases focus before the visual outro finishes', () => {
  let closed = 0;
  const s = sheet({ onClose: () => closed++ });
  s.run('releaseForOutro()');
  assert.equal(s.dialog.open, false);
  assert.equal(s.dialog.inert, true);
  assert.equal(s.dialog['data-exiting'], '');
  assert.equal(closed, 0, 'the parent already owns external dismissal');
});

test('the native scroll winner cancels a drag without dismissing the sheet', () => {
  const s = sheet();
  s.touch('touchstart', 0); s.touch('touchmove', 30);
  assert.equal(s.touch('touchmove', 200, s.panel, 0, 1, false), false);
  assert.equal(s.run('visible'), true);
  assert.equal(s.run('gesture'), null);
});

test('mobile-only actions release their modal when resizing to desktop', () => {
  let closed = 0;
  const s = sheet({ mobileOnly: true, onClose: () => closed++ });
  s.query.matches = false; s.query.change();
  assert.equal(s.dialog.open, false);
  assert.equal(closed, 1);
});

test('touch sidebar actions stay bottom sheets on wide Android viewports', () => {
  const s = sheet({ forceMobile: true }, { mobile: false });
  assert.equal(s.run('mobile'), true);
  s.touch('touchstart', 0);
  assert.equal(s.touch('touchmove', 30), true);
});

test('snap-back can be grabbed again from its current visual position', () => {
  const s = sheet();
  s.touch('touchstart', 0); s.touch('touchmove', 30); s.touch('touchcancel', 30);
  s.animations.forEach(({ animation }) => animation.playState = 'running');
  s.panel.computedTransform = 'matrix(1,0,0,1,0,12)';
  s.touch('touchstart', 100); s.touch('touchmove', 120);
  assert.equal(s.panel.style.transform, 'translate3d(0,32px,0)');
});

test('reduced motion removes exit and snap-back animation duration', () => {
  const s = sheet({}, { reduced: true });
  s.touch('touchstart', 0); s.touch('touchmove', 30); s.touch('touchcancel', 30);
  assert.equal(s.animations[0].options.duration, 0);
  s.back(); assert.equal(s.animations.at(-1).options.duration, 0);
});


test('an onclick event is not mistaken for an after-close callback', async () => {
  let closed = 0;
  const s = sheet({ onClose: () => closed++ });
  s.run('close({ type: "click" })');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(closed, 1);
});
