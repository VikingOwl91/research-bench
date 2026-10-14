import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { initializeTheme, isThemePreference, setThemePreference, THEME_STORAGE_KEY, themePreference } from '../../src/lib/theme';

const initializer = readFileSync(new URL('../../static/theme-init.js', import.meta.url), 'utf8');
const cleanups: Array<() => void> = [];

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

function browser(storage = new MemoryStorage(), initial?: string) {
  const document = { documentElement: { dataset: {} as Record<string, string> } };
  if (initial !== undefined) document.documentElement.dataset.theme = initial;
  const window = Object.assign(new EventTarget(), { localStorage: storage });
  vi.stubGlobal('window', window);
  vi.stubGlobal('document', document);
  vi.stubGlobal('localStorage', storage);
  return {
    storage, document, window,
    storageEvent(key: string | null, newValue: string | null, storageArea: Storage | null = storage) {
      const event = new Event('storage');
      Object.defineProperties(event, {
        key: { value: key }, newValue: { value: newValue }, storageArea: { value: storageArea }
      });
      window.dispatchEvent(event);
    }
  };
}

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  themePreference.set('system');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('pre-paint appearance initializer', () => {
  it.each([
    ['system', 'system'], ['light', 'light'], ['dark', 'dark'],
    [null, 'system'], ['', 'system'], ['auto', 'system'], ['Dark', 'system'], ['"dark"', 'system'],
    ['<script>dark</script>', 'system']
  ])('restores %j as %s before the application starts', (saved, expected) => {
    const read = vi.fn(() => saved), write = vi.fn();
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    runInNewContext(initializer, { window: { localStorage: { getItem: read, setItem: write } }, document });
    expect(document.documentElement.dataset).toEqual({ theme: expected });
    expect(read).toHaveBeenCalledExactlyOnceWith(THEME_STORAGE_KEY);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(['getter', 'read'] as const)('keeps System when the storage %s throws', failure => {
    const document = { documentElement: { dataset: {} as Record<string, string> } };
    const window = failure === 'getter'
      ? Object.defineProperty({}, 'localStorage', { get() { throw new DOMException('Blocked', 'SecurityError'); } })
      : { localStorage: { getItem() { throw new DOMException('Blocked', 'SecurityError'); } } };
    expect(() => runInNewContext(initializer, { window, document })).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('system');
  });

  it('remains a parser-blocking head script after the generated CSP location', () => {
    const template = readFileSync(new URL('../../src/app.html', import.meta.url), 'utf8');
    const script = template.match(/<script\b[^>]*src="\/theme-init\.js"[^>]*><\/script>/g);
    expect(script).toEqual(['<script src="/theme-init.js"></script>']);
    const index = template.indexOf(script![0]);
    expect(index).toBeGreaterThan(template.indexOf('%sveltekit.head%'));
    expect(index).toBeLessThan(template.indexOf('</head>'));
    expect(index).toBeLessThan(template.indexOf('%sveltekit.body%'));
  });
});

describe('central appearance preference', () => {
  it('adopts the initializer value without rereading unrelated storage', () => {
    const current = browser(new MemoryStorage(), 'dark');
    const read = vi.spyOn(current.storage, 'getItem');
    cleanups.push(initializeTheme());
    expect(get(themePreference)).toBe('dark');
    expect(read).not.toHaveBeenCalled();
  });

  it('restores a valid saved preference when the initializer is unavailable', () => {
    const current = browser();
    current.storage.setItem(THEME_STORAGE_KEY, 'light');
    const read = vi.spyOn(current.storage, 'getItem');
    cleanups.push(initializeTheme());
    expect(get(themePreference)).toBe('light');
    expect(current.document.documentElement.dataset.theme).toBe('light');
    expect(read).toHaveBeenCalledExactlyOnceWith(THEME_STORAGE_KEY);
  });

  it('rejects invalid saved and requested values without applying them', () => {
    const current = browser();
    current.storage.setItem(THEME_STORAGE_KEY, 'auto');
    cleanups.push(initializeTheme());
    const write = vi.spyOn(current.storage, 'setItem');
    for (const value of ['auto', 'Dark', '', '"dark"', '<script>dark</script>']) {
      expect(isThemePreference(value)).toBe(false);
      setThemePreference(value);
    }
    expect(get(themePreference)).toBe('system');
    expect(current.document.documentElement.dataset.theme).toBe('system');
    expect(write).not.toHaveBeenCalled();
  });

  it('switches and persists only the non-content appearance preference', () => {
    const current = browser();
    current.storage.setItem('researchbench:locale', 'de');
    const write = vi.spyOn(current.storage, 'setItem');
    cleanups.push(initializeTheme());
    for (const preference of ['dark', 'light', 'system'] as const) {
      setThemePreference(preference);
      expect(get(themePreference)).toBe(preference);
      expect(current.document.documentElement.dataset.theme).toBe(preference);
      expect(current.storage.getItem(THEME_STORAGE_KEY)).toBe(preference);
    }
    expect(write.mock.calls).toEqual([['researchbench:theme', 'dark'], ['researchbench:theme', 'light'], ['researchbench:theme', 'system']]);
    expect(current.storage.getItem('researchbench:locale')).toBe('de');
  });

  it('defaults safely and retains in-memory switching when reads and writes are blocked', () => {
    const current = browser();
    vi.spyOn(current.storage, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(current.storage, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    expect(() => cleanups.push(initializeTheme())).not.toThrow();
    expect(get(themePreference)).toBe('system');
    expect(() => setThemePreference('dark')).not.toThrow();
    expect(get(themePreference)).toBe('dark');
    expect(current.document.documentElement.dataset.theme).toBe('dark');
  });

  it('also handles a blocked storage property getter', () => {
    const current = browser();
    vi.stubGlobal('localStorage', undefined);
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new DOMException('Blocked', 'SecurityError'); } });
    expect(() => cleanups.push(initializeTheme())).not.toThrow();
    expect(() => setThemePreference('light')).not.toThrow();
    expect(get(themePreference)).toBe('light');
    expect(current.document.documentElement.dataset.theme).toBe('light');
  });

  it('synchronizes cross-tab changes and resets removed or cleared preferences', () => {
    const current = browser();
    cleanups.push(initializeTheme());
    current.storageEvent(THEME_STORAGE_KEY, 'dark');
    expect(get(themePreference)).toBe('dark');
    current.storageEvent(THEME_STORAGE_KEY, 'light');
    expect(current.document.documentElement.dataset.theme).toBe('light');
    current.storageEvent(THEME_STORAGE_KEY, 'invalid');
    expect(get(themePreference)).toBe('system');
    current.storageEvent(THEME_STORAGE_KEY, 'dark');
    current.storageEvent(THEME_STORAGE_KEY, null);
    expect(get(themePreference)).toBe('system');
    current.storageEvent(THEME_STORAGE_KEY, 'dark');
    current.storageEvent(null, null);
    expect(get(themePreference)).toBe('system');
  });

  it('ignores unrelated preferences and session storage without writing during synchronization', () => {
    const current = browser(new MemoryStorage(), 'dark');
    const write = vi.spyOn(current.storage, 'setItem');
    cleanups.push(initializeTheme());
    current.storageEvent('researchbench:locale', 'light');
    current.storageEvent('researchbench:key:mistral', 'light');
    current.storageEvent(THEME_STORAGE_KEY, 'light', new MemoryStorage());
    expect(get(themePreference)).toBe('dark');
    expect(write).not.toHaveBeenCalled();
  });

  it('removes the exact cross-tab listener when its owning view unmounts', () => {
    const current = browser();
    const cleanup = initializeTheme();
    current.storageEvent(THEME_STORAGE_KEY, 'dark');
    expect(get(themePreference)).toBe('dark');
    cleanup(); cleanup();
    current.storageEvent(THEME_STORAGE_KEY, 'light');
    expect(get(themePreference)).toBe('dark');
    expect(current.document.documentElement.dataset.theme).toBe('dark');
  });
});
