import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

test('settings hydration runs alongside local preparation and warms models without waiting for a provider', async () => {
  const script = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8').match(/<script lang="ts">([\s\S]*?)<\/script>/)[1];
  const ast = ts.createSourceFile('page.ts', script, ts.ScriptTarget.Latest, true);
  const load = ast.statements.find(statement => ts.isFunctionDeclaration(statement) && statement.name.text === 'loadApp').getText(ast);
  let hydrated = false, updateInitialized = false, preloading = false, modelWarmup;
  const connection = { url: 'configured-provider' };
  const context = vm.createContext({
    appState: { apiSettings: connection }, loaded: false, disposed: false,
    preloadMainViews: () => { preloading = true; return new Promise(() => {}); },
    warmModelCatalog: config => { modelWarmup = config; return new Promise(() => {}); },
    getAllSettings: async () => {
      assert.equal(preloading, true, 'imports already run when hydration starts');
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
  assert.equal(modelWarmup, connection);
});
