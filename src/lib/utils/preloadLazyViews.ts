import type { LazyViewLoader } from './lazyView';

/** Load code only. Resolve after every view is cached; failed imports remain retryable. */
export async function preloadLazyViews(
  views: readonly LazyViewLoader[],
  concurrency = views.length,
  yieldToMain: () => Promise<void> = () => new Promise(resolve => setTimeout(resolve, 0)),
): Promise<void> {
  let index = 0;
  let failed = false;

  async function worker() {
    while (index < views.length) {
      const view = views[index++];
      try {
        await view.load();
      } catch {
        failed = true;
      }
      // Bound concurrent imports on phones and let input/rendering run between loads.
      if (index < views.length) await yieldToMain();
    }
  }

  const workers = Math.min(views.length, Math.max(1, Math.floor(concurrency) || 1));
  await Promise.all(Array.from({ length: workers }, worker));
  if (failed) throw new Error('Could not preload application views');
}
