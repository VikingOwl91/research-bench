import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { messages, translate, formatNumber, formatSize, isLocale, type MessageKey } from '../../src/lib/i18n/index';
import { pageMessages } from '../../src/lib/i18n/page';
import { componentMessages } from '../../src/lib/i18n/components';
import { runtimeMessages } from '../../src/lib/i18n/runtime';

class MemoryStorage implements Storage {
  entries = new Map<string, string>();
  get length() { return this.entries.size; }
  getItem(key: string) { return this.entries.get(key) ?? null; }
  setItem(key: string, value: string) { this.entries.set(key, value); }
  removeItem(key: string) { this.entries.delete(key); }
  clear() { this.entries.clear(); }
  key(index: number) { return [...this.entries.keys()][index] ?? null; }
}
const placeholders = (value: string) => [...new Set([...value.matchAll(/\{(\w+)\}/g)].map(match => match[1]))].sort();

describe('bilingual catalog contract', () => {
  it('has complete EN/DE entries with matching interpolation and unique section keys', () => {
    const sections = [pageMessages, componentMessages, runtimeMessages];
    const keys = sections.flatMap(section => Object.keys(section));
    expect(new Set(keys).size).toBe(keys.length);
    expect(Object.keys(messages).length).toBeGreaterThan(100);
    for (const [key, entry] of Object.entries(messages)) {
      expect(entry.en.trim(), key).not.toBe(''); expect(entry.de.trim(), key).not.toBe('');
      expect(placeholders(entry.en), key).toEqual(placeholders(entry.de));
      const params = Object.fromEntries(placeholders(entry.en).map(name => [name, `fixture-${name}`]));
      for (const lang of ['en', 'de'] as const) expect(translate(lang, key as MessageKey, params), key).not.toMatch(/\{\w+\}/);
    }
  });
  it('formats quantities and file sizes using the selected locale', () => {
    expect(formatNumber('en', 1234.5)).toBe('1,234.5');
    expect(formatNumber('de', 1234.5)).toBe('1.234,5');
    expect(formatSize('en', 1.5 * 1024 * 1024)).toBe('1.5 MB');
    expect(formatSize('de', 1.5 * 1024 * 1024)).toBe('1,5 MB');
  });
});

describe('local UI language preference', () => {
  let storage: MemoryStorage;
  beforeEach(() => { vi.resetModules(); storage = new MemoryStorage(); vi.stubGlobal('localStorage', storage); vi.stubGlobal('navigator', { language: 'de-DE' }); });
  afterEach(() => vi.unstubAllGlobals());
  it('defaults to English independently of the browser language', async () => {
    const store = await import('../../src/lib/i18n/store'); store.initializeLocale();
    expect(store.getLocale()).toBe('en');
  });
  it('persists only the validated UI preference and restores it after module reload', async () => {
    storage.setItem('unrelated', 'preserve');
    const store = await import('../../src/lib/i18n/store'); store.initializeLocale(); store.setLocale('de');
    expect(store.getLocale()).toBe('de'); expect(storage.getItem('researchbench:locale')).toBe('de');
    expect(storage.getItem('unrelated')).toBe('preserve');
    store.setLocale('fr'); expect(store.getLocale()).toBe('de');
    vi.resetModules(); const reloaded = await import('../../src/lib/i18n/store'); reloaded.initializeLocale();
    expect(reloaded.getLocale()).toBe('de');
  });
  it('rejects invalid persisted values and tolerates blocked storage', async () => {
    storage.setItem('researchbench:locale', 'en-US');
    const store = await import('../../src/lib/i18n/store'); store.initializeLocale(); expect(store.getLocale()).toBe('en');
    vi.stubGlobal('localStorage', { getItem() { throw new DOMException('Blocked', 'SecurityError'); }, setItem() { throw new DOMException('Blocked', 'SecurityError'); } });
    vi.resetModules(); const blocked = await import('../../src/lib/i18n/store');
    expect(() => blocked.initializeLocale()).not.toThrow(); expect(blocked.getLocale()).toBe('en');
    expect(() => blocked.setLocale('de')).not.toThrow(); expect(blocked.getLocale()).toBe('de');
  });
  it('publishes live translations without recreating the locale store', async () => {
    const store = await import('../../src/lib/i18n/store'); store.initializeLocale();
    const key = Object.keys(messages).find(key => messages[key as MessageKey].en !== messages[key as MessageKey].de)! as MessageKey;
    const values: string[] = [];
    const unsubscribe = store.t.subscribe(fn => values.push(fn(key)));
    store.setLocale('de'); store.setLocale('en'); unsubscribe();
    expect(values).toEqual([messages[key].en, messages[key].de, messages[key].en]);
  });
  it('accepts only the two supported languages', () => {
    expect(isLocale('en')).toBe(true); expect(isLocale('de')).toBe(true);
    expect(isLocale('fr')).toBe(false); expect(isLocale(null)).toBe(false);
  });
});
