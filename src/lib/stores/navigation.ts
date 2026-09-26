import { appState } from './appState.svelte';

export type RyokanView = typeof appState.currentView;

// This is intentionally small: views still live in appState, while this module
// records the route that led there and gives transient UI a single back hook.
const history: RyokanView[] = [];
const backHandlers = new Map<number, () => boolean>();
let nextHandlerId = 0;

export function navigateTo(view: RyokanView) {
  if (view === appState.currentView) return;
  if (view === 'lobby') history.length = 0;
  else history.push(appState.currentView);
  appState.currentView = view;
}

export function returnTo(view: RyokanView) {
  const index = history.lastIndexOf(view);
  history.splice(index < 0 ? 0 : index);
  appState.currentView = view;
}

export function registerBackHandler(handler: () => boolean) {
  const id = nextHandlerId++;
  backHandlers.set(id, handler);
  return () => backHandlers.delete(id);
}

export function handleBackNavigation(): boolean {
  const handlers = [...backHandlers.values()];
  for (let index = handlers.length - 1; index >= 0; index--) {
    if (handlers[index]()) return true;
  }

  if (appState.currentView === 'lobby') {
    history.length = 0;
    return false;
  }

  appState.currentView = history.pop() ?? 'lobby';
  return true;
}
