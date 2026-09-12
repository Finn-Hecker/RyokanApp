import { getLocale } from '$lib/paraglide/runtime';

export function getClientLanguageName(): string {
  return getLocale() === 'de' ? 'German' : 'English';
}
