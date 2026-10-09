import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('hydration does not wait for sidebar metadata, World Info or view imports and initializes settings and platform', async () => {
  const script = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.Latest, true);
  const load = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === 'loadApp').getText(ast);
  let finishWorldInfo, hydrated = false, updateInitialized = false, preloading = false, prefetchedMode;
  const worldInfo = new Promise(resolve => { finishWorldInfo = resolve; });
  const context = vm.createContext({
    appState: {}, loaded: false, disposed: false, loadWorldInfos: () => worldInfo,
    preloadMainViews: () => { preloading = true; return new Promise(() => {}); },
    ensureConversationsLoaded: mode => { prefetchedMode = mode; return new Promise(() => {}); },
    getAllSettings: async () => {
      assert.equal(preloading, true, 'imports already run when hydration starts');
      assert.equal(prefetchedMode, 'singleplayer', 'sidebar metadata loads alongside hydration');
      return [{ key: 'onboarding_completed', value: 'true' }, { key: 'chat_font_scale', value: '120' }];
    },
    invoke: async () => 'mobile', hydrateApiConnections: () => { hydrated = true; },
    parseTextRules: () => [], TEXT_RULES_KEY: 'rules', updater: { initialize: () => { updateInitialized = true; } },
  });
  vm.runInContext(ts.transpile(load, { target: ts.ScriptTarget.ES2022 }), context);
  await context.loadApp();
  assert.equal(context.loaded, true);
  assert.equal(context.appState.interactionMode, 'mobile');
  assert.equal(context.appState.chatFontScale, 120);
  assert.equal(context.appState.isOnboarding, false);
  assert.equal(hydrated, true); assert.equal(updateInitialized, true);
  finishWorldInfo();
});
