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

function page({ reducedMotion = false, deferredListener = false, userAgent = 'Android WebView', preload, settings = async () => [] } = {}) {
  const context = navigation();
  const invocations = [];
  const animations = [];
  let mount, back, resolveListener;
  let unregistered = 0;
  const preloadCalls = [], diagnostics = [];
  Object.assign(context, {
    console, $state: value => value, $derived: value => value, tick: async () => {},
    preloadLazyViews: (views, concurrency) => { preloadCalls.push({ views, concurrency }); return preload?.() ?? Promise.resolve(); },
    reportDiagnostic: area => diagnostics.push(area),
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
    getAllSettings: settings, loadWorldInfos: async () => {},
    parseTextRules: () => [], TEXT_RULES_KEY: "text_rules_v1", hydrateApiConnections: () => {}, updater: { initialize: async () => {} },
    container: { animate: (...args) => { animations.push(args); return { cancel() {} }; } },
  });
  const source = readFileSync(new URL('../../routes/+page.svelte', import.meta.url), 'utf8')
    .match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  evaluate(source, context);
  vm.runInContext('viewContainer = container', context);
  return { context, invocations, animations, mount: () => mount(), back: payload => back(payload),
    resolveListener: () => resolveListener(), unregistered: () => unregistered,
    preloadCalls, diagnostics, get: expression => vm.runInContext(expression, context) };
}

const flush = () => new Promise(resolve => setImmediate(resolve));

for (const android of [false, true]) {
  test(`startup imports all six views alongside hydration and gates normal navigation (Android=${android})`, async () => {
    let releaseViews, releaseSettings;
    const h = page({ userAgent: android ? 'Android' : 'Windows',
      preload: () => new Promise(resolve => { releaseViews = resolve; }),
      settings: () => new Promise(resolve => { releaseSettings = resolve; }) });
    assert.equal(h.preloadCalls.length, 0, 'no imports during page setup');
    const dispose = h.mount();
    assert.equal(h.preloadCalls.length, 1);
    const { views, concurrency } = h.preloadCalls[0];
    assert.deepEqual(Array.from(views), Array.from(h.get('[chat, settings, editor, list, multiplayer, play]')));
    assert.ok(!views.includes(h.get('onboarding')));
    assert.equal(concurrency, android ? 2 : 6);
    assert.equal(typeof releaseSettings, 'function', 'hydration starts without waiting for modules');
    releaseSettings([{ key: 'onboarding_completed', value: 'true' }]);
    await flush();
    assert.equal(h.get('loaded'), true);
    assert.equal(h.get('viewsReady'), false);
    releaseViews();
    await flush();
    assert.equal(h.get('viewsReady'), true);
    dispose();
  });
}

test('onboarding remains available while main views load, and completing it cannot bypass the gate', async () => {
  let release;
  const h = page({ preload: () => new Promise(resolve => { release = resolve; }) });
  const dispose = h.mount();
  await flush();
  assert.equal(h.get('loaded'), true);
  assert.equal(h.context.appState.isOnboarding, true);
  assert.equal(h.get('viewsReady'), false);
  h.context.appState.isOnboarding = false;
  assert.equal(h.get('viewsReady'), false);
  const markup = readFileSync(new URL('../../routes/+page.svelte', import.meta.url), 'utf8').split('</script>')[1];
  assert.ok(markup.indexOf('appState.isOnboarding') < markup.indexOf('!viewsReady'));
  assert.ok(markup.indexOf('!viewsReady') < markup.indexOf('<main'));
  release();
  await flush();
  assert.equal(h.get('viewsReady'), true);
  dispose();
});

test('failed startup preload reports diagnostics and retry keeps navigation gated until success', async () => {
  let calls = 0, release;
  const h = page({ preload: () => ++calls === 1 ? Promise.reject(new Error('import failed'))
    : new Promise(resolve => { release = resolve; }) });
  const dispose = h.mount();
  await flush();
  assert.equal(h.get('viewsReady'), false);
  assert.equal(h.get('preloadFailed'), true);
  assert.deepEqual(h.diagnostics, ['runtime']);
  const retry = h.context.preloadMainViews();
  assert.equal(h.context.preloadMainViews(), retry, 'deduplicate retry clicks');
  assert.equal(h.get('preloadFailed'), false);
  assert.equal(h.get('viewsReady'), false);
  release();
  await retry;
  assert.equal(h.get('viewsReady'), true);
  dispose();
});

test('a preload completing after disposal does not release the startup gate', async () => {
  let release;
  const h = page({ preload: () => new Promise(resolve => { release = resolve; }) });
  const dispose = h.mount();
  dispose();
  release();
  await flush();
  assert.equal(h.get('viewsReady'), false);
  assert.equal(h.get('loaded'), false);
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

test('a startup settings read failure preserves profiles and never enables onboarding', async () => {
  let fail = true, hydrations = 0;
  const h = page({ settings: async () => {
    if (fail) throw new Error('Read failure');
    return [{ key: 'onboarding_completed', value: 'true' }];
  } });
  const profile = { id: 'existing' };
  h.context.appState.apiConnections = [profile];
  h.context.appState.isOnboarding = false;
  h.context.hydrateApiConnections = () => { hydrations++; };
  const dispose = h.mount();
  await flush();
  assert.equal(h.get('loaded'), false);
  assert.equal(h.get('settingsLoadFailed'), true);
  assert.equal(h.context.appState.isOnboarding, false);
  assert.equal(h.context.appState.apiConnections[0], profile);
  assert.equal(hydrations, 0);
  fail = false;
  await h.context.loadApp();
  assert.equal(h.get('loaded'), true);
  assert.equal(h.get('settingsLoadFailed'), false);
  assert.equal(hydrations, 1);
  dispose();
});
