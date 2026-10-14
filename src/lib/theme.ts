import { writable } from 'svelte/store';

export type ThemePreference = 'system' | 'light' | 'dark';
export const THEME_STORAGE_KEY = 'researchbench:theme';

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

function appliedPreference(): ThemePreference {
  const value = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme;
  return isThemePreference(value) ? value : 'system';
}

export const themePreference = writable<ThemePreference>(appliedPreference());

function applyPreference(value: ThemePreference): void {
  if (typeof document !== 'undefined') document.documentElement.dataset.theme = value;
  themePreference.set(value);
}

/** Adopt the pre-paint preference and listen only to this local UI preference. */
export function initializeTheme(): () => void {
  const applied = typeof document === 'undefined' ? undefined : document.documentElement.dataset.theme;
  let preference: ThemePreference = isThemePreference(applied) ? applied : 'system';
  if (!isThemePreference(applied)) {
    try {
      const saved = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
      if (isThemePreference(saved)) preference = saved;
    } catch { /* System remains available without preference storage. */ }
  }
  applyPreference(preference);
  if (typeof window === 'undefined') return () => {};

  const ownerWindow = window;
  const onStorage = (event: StorageEvent) => {
    if (event.key !== THEME_STORAGE_KEY && event.key !== null) return;
    try {
      if (event.storageArea && event.storageArea !== ownerWindow.localStorage) return;
    } catch { return; }
    applyPreference(event.key !== null && isThemePreference(event.newValue) ? event.newValue : 'system');
  };
  ownerWindow.addEventListener('storage', onStorage);
  return () => ownerWindow.removeEventListener('storage', onStorage);
}

/** Storage failures never interrupt the current page or its active work. */
export function setThemePreference(value: string): void {
  if (!isThemePreference(value)) return;
  applyPreference(value);
  try { globalThis.localStorage?.setItem(THEME_STORAGE_KEY, value); }
  catch { /* Keep the chosen appearance in memory. */ }
}
