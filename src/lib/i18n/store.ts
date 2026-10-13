import { derived, get, writable } from 'svelte/store';
import { isLocale, translate, type Locale, type MessageKey, type MessageParams } from './index';

export const LOCALE_KEY = 'researchbench:locale';
export const locale = writable<Locale>('en');
export const t = derived(locale, current => (key: MessageKey, params?: MessageParams) => translate(current, key, params));
let initialized = false;
export function initializeLocale(): void {
  if (initialized) return;
  initialized = true;
  try {
    const saved = globalThis.localStorage?.getItem(LOCALE_KEY);
    locale.set(isLocale(saved) ? saved : 'en');
  } catch { locale.set('en'); }
}
export function setLocale(value: string): void {
  if (!isLocale(value)) return;
  locale.set(value);
  try { globalThis.localStorage?.setItem(LOCALE_KEY, value); } catch { /* Language switching works with storage blocked. */ }
}
export function getLocale(): Locale { return get(locale); }
