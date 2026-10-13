import { pageMessages } from './page';
import { componentMessages } from './components';
import { runtimeMessages } from './runtime';

export type Locale = 'en' | 'de';
export type CatalogEntry = { en: string; de: string };
export const messages = { ...pageMessages, ...componentMessages, ...runtimeMessages } as const;
export type MessageKey = keyof typeof messages;
export type MessageParams = Readonly<Record<string, string | number | MessageDescriptor | readonly MessageDescriptor[]>>;
export interface MessageDescriptor { key: MessageKey; params?: MessageParams; }

export function isLocale(value: unknown): value is Locale { return value === 'en' || value === 'de'; }
export function formatNumber(locale: Locale, value: number, options?: Intl.NumberFormatOptions): string {
  return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-GB', options).format(value);
}
export function formatSize(locale: Locale, bytes: number): string {
  const megabytes = bytes >= 1024 * 1024;
  return `${formatNumber(locale, megabytes ? bytes / 1024 / 1024 : Math.round(bytes / 1024), { minimumFractionDigits: megabytes ? 1 : 0, maximumFractionDigits: megabytes ? 1 : 0 })} ${megabytes ? 'MB' : 'KB'}`;
}
export function translate(locale: Locale, key: MessageKey, params: MessageParams = {}): string {
  const entry: CatalogEntry | undefined = messages[key];
  if (!entry) throw new Error(`Unknown translation key: ${key}`);
  return entry[locale].replace(/\{(\w+)\}/g, (token, name: string) => {
    const value = params[name];
    if (value === undefined) return token;
    if (typeof value === 'number') return formatNumber(locale, value);
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return new Intl.ListFormat(locale === 'de' ? 'de-DE' : 'en-GB', { style: 'long', type: 'conjunction' }).format(value.map(item => translateMessage(locale, item)));
    return translateMessage(locale, value as MessageDescriptor);
  });
}
export function message(key: MessageKey, params?: MessageParams): MessageDescriptor { return params ? { key, params } : { key }; }
export function translateMessage(locale: Locale, descriptor: MessageDescriptor): string {
  return translate(locale, descriptor.key, descriptor.params);
}
