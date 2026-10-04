import type { Component } from 'svelte';

/** Cache code, not component instances: views retain their existing mount lifecycle. */
export function createLazyView(importView: () => Promise<{ default: Component }>) {
  let component: Component | undefined;
  let pending: Promise<Component> | undefined;

  return {
    get component() { return component; },
    load(): Promise<Component> {
      if (component) return Promise.resolve(component);
      if (!pending) {
        pending = importView().then(module => {
          component = module.default;
          return component;
        }).finally(() => { pending = undefined; });
      }
      return pending;
    },
  };
}

export type LazyViewLoader = ReturnType<typeof createLazyView>;
