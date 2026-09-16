/**
 * Localisation.
 *
 * Every user-facing string comes from here. Keys are semantic, never English
 * text, and interpolation goes through `t(key, params)` rather than template
 * concatenation — a sentence assembled from fragments cannot be translated.
 *
 * Numbers and durations format through `Intl`, so a German build gets German
 * separators without anyone writing German-specific code.
 */

import en from './en.json';

export type LocaleId = 'en';

type Table = Record<string, string>;

const tables: Record<LocaleId, Table> = { en: en as Table };

let current: LocaleId = 'en';
let table: Table = tables.en;

export function setLocale(locale: LocaleId): void {
  current = locale;
  table = tables[locale] ?? tables.en;
}

export function locale(): LocaleId {
  return current;
}

/**
 * Look up a string.
 *
 * A missing key returns the key itself rather than throwing or rendering blank —
 * an untranslated string should be visibly wrong in the UI, not invisible.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const template = table[key] ?? key;
  if (!params) return template;

  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    return value === undefined ? match : String(value);
  });
}

/** True when a key exists — used by the debug panel to spot gaps. */
export function has(key: string): boolean {
  return key in table;
}

const numberFormats = new Map<string, Intl.NumberFormat>();

function numberFormat(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${current}:${JSON.stringify(options)}`;
  let format = numberFormats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(current, options);
    numberFormats.set(key, format);
  }
  return format;
}

export function formatNumber(value: number, fractionDigits = 0): string {
  return numberFormat({
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(value);
}

export function formatGold(value: number): string {
  return `${formatNumber(Math.round(value))}g`;
}

export function formatPercent(fraction: number): string {
  return numberFormat({ style: 'percent', maximumFractionDigits: 0 }).format(fraction);
}

/**
 * Compact duration: "2h 14m", "45m", "18s".
 *
 * Deliberately not built from translated fragments — the unit letters are part of
 * the format and get replaced wholesale per locale when we add one.
 */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;

  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
  return `${seconds}s`;
}

/** Long form for the away summary: "3 days, 4 hours". */
export function formatLongDuration(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (parts.length < 2 && minutes > 0) parts.push(`${minutes}m`);
  return parts.length > 0 ? parts.join(' ') : '0m';
}
