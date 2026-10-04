import type { LazyViewLoader } from './lazyView';

type Scheduler = Pick<Window, 'requestAnimationFrame' | 'cancelAnimationFrame' | 'setTimeout' | 'clearTimeout'>
  & Partial<Pick<Window, 'requestIdleCallback' | 'cancelIdleCallback'>>;

/** Yield through a paint, then load one view per idle period in priority order. */
export function prefetchLazyViews(views: readonly LazyViewLoader[], scheduler: Scheduler = window) {
  let stopped = false;
  let index = 0;
  let frame: number | undefined;
  let idle: number | undefined;
  let timer: number | undefined;

  function scheduleNext() {
    if (stopped || index >= views.length) return;
    if (scheduler.requestIdleCallback && scheduler.cancelIdleCallback) {
      // No deadline: background imports must not be forced onto a busy startup.
      idle = scheduler.requestIdleCallback(loadNext);
    } else {
      // Older WebViews still yield to rendering and input between imports.
      timer = scheduler.setTimeout(loadNext, 250);
    }
  }

  function loadNext() {
    idle = timer = undefined;
    if (stopped) return;
    const view = views[index++];
    // The loader shares both pending imports and cached components with navigation.
    void view.load().catch(() => {
      // Speculative failures stay silent; opening the view can retry normally.
    }).then(scheduleNext);
  }

  frame = scheduler.requestAnimationFrame(() => {
    frame = scheduler.requestAnimationFrame(() => {
      frame = undefined;
      scheduleNext();
    });
  });

  return () => {
    stopped = true;
    if (frame !== undefined) scheduler.cancelAnimationFrame(frame);
    if (idle !== undefined) scheduler.cancelIdleCallback?.(idle);
    if (timer !== undefined) scheduler.clearTimeout(timer);
  };
}
