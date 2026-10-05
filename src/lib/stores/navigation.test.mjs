import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

function evaluate(source, context) {
  const ast = ts.createSourceFile('controller.ts', source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(statement => !ts.isImportDeclaration(statement))
    .map(statement => statement.getText(ast).replace(/^export /, '')).join('\n');
  vm.runInContext(ts.transpile(body, { target: ts.ScriptTarget.ES2022 }), context);
}

function navigation() {
  const context = vm.createContext({ appState: { currentView: 'lobby' } });
  evaluate(readFileSync(new URL('./navigation.ts', import.meta.url), 'utf8'), context);
  return context;
}

test('back unwinds views, then leaves the lobby; direct home navigation clears history', () => {
  const n = navigation();
  n.navigateTo('chat');
  n.navigateTo('settings');
  assert.equal(n.handleBackNavigation(), true);
  assert.equal(n.appState.currentView, 'chat');
  n.handleBackNavigation();
  assert.equal(n.appState.currentView, 'lobby');
  assert.equal(n.handleBackNavigation(), false);
  n.navigateTo('settings');
  n.navigateTo('lobby');
  assert.equal(n.handleBackNavigation(), false);
  n.navigateTo('play');
  n.handleBackNavigation();
  assert.equal(n.appState.currentView, 'lobby');
});

test('dialogs consume back before the root exits, newest handler first', () => {
  const n = navigation();
  const calls = [];
  const removeFirst = n.registerBackHandler(() => { calls.push('first'); return true; });
  const removeLast = n.registerBackHandler(() => { calls.push('last'); return true; });
  assert.equal(n.handleBackNavigation(), true);
  assert.deepEqual(calls, ['last']);
  removeLast();
  assert.equal(n.handleBackNavigation(), true);
  assert.deepEqual(calls, ['last', 'first']);
  removeFirst();
  assert.equal(n.handleBackNavigation(), false);
});

test('a view without recorded history returns home before exiting', () => {
  const n = navigation();
  n.appState.currentView = 'settings';
  assert.equal(n.handleBackNavigation(), true);
  assert.equal(n.appState.currentView, 'lobby');
});

function page({ reducedMotion = false, deferredListener = false, userAgent = 'Android WebView' } = {}) {
  const context = navigation();
  const invocations = [];
  const animations = [];
  let mount, back, resolveListener;
  let unregistered = 0;
  let prefetchEffect;
  const prefetchCalls = [];
  Object.assign(context, {
    console, $state: value => value, $derived: value => value, $effect: callback => { prefetchEffect = callback; }, tick: async () => {},
    prefetchLazyViews: views => { prefetchCalls.push(views); return () => {}; },
    createLazyView: () => ({ component: undefined, load: () => { throw new Error('views must not load during page setup'); } }),
    window: { matchMedia: () => ({ matches: reducedMotion }) },
    navigator: { userAgent },
    onMount: callback => { mount = callback; },
    invoke: async command => { invocations.push(command); return 'mobile'; },
    onBackButtonPress: callback => {
      back = callback;
      const listener = { unregister: async () => { unregistered++; } };
      return deferredListener ? new Promise(resolve => { resolveListener = () => resolve(listener); }) : Promise.resolve(listener);
    },
    getAllSettings: async () => [], loadWorldInfos: async () => {},
    parseTextRules: () => [], TEXT_RULES_KEY: "text_rules_v1", hydrateApiConnections: () => {}, updater: { initialize: async () => {} },
    container: { animate: (...args) => { animations.push(args); return { cancel() {} }; } },
  });
  const source = readFileSync(new URL('../../routes/+page.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  evaluate(source, context);
  vm.runInContext('viewContainer = container', context);
  return { context, invocations, animations, mount: () => mount(), back: payload => back(payload),
    resolveListener: () => resolveListener(), unregistered: () => unregistered,
    runPrefetchEffect: () => prefetchEffect(), prefetchCalls };
}

test('background prefetch starts only in the ready app, follows priority and excludes onboarding', () => {
  const h = page();
  assert.equal(h.runPrefetchEffect(), undefined);
  assert.equal(h.prefetchCalls.length, 0);
  vm.runInContext('loaded = true; appState.isOnboarding = true', h.context);
  assert.equal(h.runPrefetchEffect(), undefined);
  assert.equal(h.prefetchCalls.length, 0);
  vm.runInContext('appState.isOnboarding = false', h.context);
  assert.equal(typeof h.runPrefetchEffect(), 'function');
  const expected = vm.runInContext('[chat, settings, editor, multiplayer, play]', h.context);
  assert.deepEqual(Array.from(h.prefetchCalls[0]), Array.from(expected));
  assert.ok(!h.prefetchCalls[0].includes(vm.runInContext('onboarding', h.context)));
});

for (const view of ['lobby', 'play']) {
  test(`back closes the sidebar before leaving ${view}`, () => {
    const n = navigation();
    n.navigateTo(view);
    let effect;
    Object.assign(n, {
      $state: value => value,
      $props: () => ({ pageTitle: 'Test', showSidebar: true }),
      $effect: callback => { effect = callback; },
    });
    const source = readFileSync(new URL('../components/layouts/PageLayout.svelte', import.meta.url), 'utf8')
      .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
    evaluate(source, n);
    assert.equal(effect(), undefined, 'closed sidebar does not register a handler');
    vm.runInContext('isMobileSidebarOpen = true', n);
    const cleanup = effect();
    assert.equal(n.handleBackNavigation(), true);
    assert.equal(vm.runInContext('isMobileSidebarOpen', n), false);
    assert.equal(n.appState.currentView, view);
    // Even before Svelte runs effect cleanup, another back can navigate normally.
    assert.equal(n.handleBackNavigation(), view !== 'lobby');
    assert.equal(n.appState.currentView, 'lobby');
    cleanup();
    assert.equal(n.handleBackNavigation(), false);
  });
}

test('desktop loads the app without registering an Android back listener', async () => {
  const h = page({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' });
  const dispose = h.mount();
  await new Promise(resolve => setImmediate(resolve));
  assert.throws(() => h.back(), TypeError);
  assert.deepEqual(h.invocations, ['get_interaction_mode']);
  assert.equal(h.unregistered(), 0);
  dispose();
});

test('Android root back finishes the activity even when the WebView has history', async () => {
  const h = page();
  const dispose = h.mount();
  await new Promise(resolve => setImmediate(resolve));
  h.invocations.length = 0;
  h.back({ canGoBack: true });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(h.invocations, ['finish_android_activity']);
  assert.equal(h.animations.length, 0);
  dispose();
});

for (const reducedMotion of [false, true]) {
  test(`in-app back stays in the app and respects reduced motion (${reducedMotion})`, async () => {
    const h = page({ reducedMotion });
    h.context.navigateTo('settings');
    await h.context.handleAndroidBack();
    assert.equal(h.context.appState.currentView, 'lobby');
    assert.deepEqual(h.invocations, []);
    assert.equal(h.animations.length, reducedMotion ? 0 : 1);
  });
}

test('a listener registered after unmount is removed and ignores back events', async () => {
  const h = page({ deferredListener: true });
  const dispose = h.mount();
  dispose();
  h.resolveListener();
  await new Promise(resolve => setImmediate(resolve));
  h.invocations.length = 0;
  h.back({ canGoBack: false });
  assert.equal(h.unregistered(), 1);
  assert.deepEqual(h.invocations, []);
});
