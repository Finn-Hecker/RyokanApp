import { writable } from 'svelte/store';

export const exportFeedback = writable<{ type: 'success' | 'error'; message: string } | null>(null);
let timeout: ReturnType<typeof setTimeout> | undefined;

export function clearExportFeedback(): void {
  clearTimeout(timeout);
  exportFeedback.set(null);
}

export function showExportFeedback(type: 'success' | 'error', message: string): void {
  clearExportFeedback();
  exportFeedback.set({ type, message });
  timeout = setTimeout(clearExportFeedback, type === 'error' ? 5000 : 2800);
}
