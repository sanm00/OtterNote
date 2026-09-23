import type { Locale } from './i18n';

export const DAY_MS = 86_400_000;

export type RangePreset = 'today' | 'yesterday' | 'week' | 'lastWeek' | 'month' | 'lastMonth' | 'custom';
export type DateRange = { start: string; end: string; preset: RangePreset };

const pad = (value: number) => String(value).padStart(2, '0');

/** Local calendar day key, e.g. `2026-09-20`. */
export function dateKey(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function todayKey(): string {
  return dateKey(new Date());
}

export function isValidDateKey(value: string | undefined | null): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

export function parseDateKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month ?? 1) - 1, day ?? 1);
}

export function addDays(key: string, amount: number): string {
  const date = parseDateKey(key);
  return dateKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + amount));
}

export function daysBetween(from: string, to: string): number {
  return Math.round((parseDateKey(to).getTime() - parseDateKey(from).getTime()) / DAY_MS);
}

/** Monday-first weekday index: 0 = Monday … 6 = Sunday. */
export function weekdayIndex(key: string): number {
  return (parseDateKey(key).getDay() + 6) % 7;
}

export function startOfWeek(key: string): string {
  return addDays(key, -weekdayIndex(key));
}

export function endOfWeek(key: string): string {
  return addDays(startOfWeek(key), 6);
}

export function startOfMonth(key: string): string {
  const date = parseDateKey(key);
  return dateKey(new Date(date.getFullYear(), date.getMonth(), 1));
}

export function endOfMonth(key: string): string {
  const date = parseDateKey(key);
  return dateKey(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function shiftMonth(key: string, delta: number): string {
  const date = parseDateKey(key);
  return dateKey(new Date(date.getFullYear(), date.getMonth() + delta, 1));
}

export function monthOf(key: string): { year: number; month: number } {
  const date = parseDateKey(key);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** 42 day keys (6 weeks, Monday-first) covering the month that contains `key`. */
export function monthGrid(key: string): string[] {
  const first = startOfMonth(key);
  const gridStart = startOfWeek(first);
  return Array.from({ length: 42 }, (_, index) => addDays(gridStart, index));
}

export function weekDays(key: string): string[] {
  const start = startOfWeek(key);
  return Array.from({ length: 7 }, (_, index) => addDays(start, index));
}

export function eachDay(range: Pick<DateRange, 'start' | 'end'>): string[] {
  const total = daysBetween(range.start, range.end);
  if (total < 0) {
    return [];
  }
  return Array.from({ length: total + 1 }, (_, index) => addDays(range.start, index));
}

export function rangeForPreset(preset: RangePreset, today = todayKey()): DateRange {
  switch (preset) {
    case 'today':
      return { start: today, end: today, preset };
    case 'yesterday':
      return { start: addDays(today, -1), end: addDays(today, -1), preset };
    case 'week':
      return { start: startOfWeek(today), end: endOfWeek(today), preset };
    case 'lastWeek':
      return { start: addDays(startOfWeek(today), -7), end: addDays(endOfWeek(today), -7), preset };
    case 'month':
      return { start: startOfMonth(today), end: endOfMonth(today), preset };
    case 'lastMonth': {
      const previous = shiftMonth(today, -1);
      return { start: startOfMonth(previous), end: endOfMonth(previous), preset };
    }
    default:
      return { start: startOfWeek(today), end: endOfWeek(today), preset: 'custom' };
  }
}

export function isWithinRange(key: string, range: Pick<DateRange, 'start' | 'end'>): boolean {
  return key >= range.start && key <= range.end;
}

/** `start` plus its span, clamped so a 1-day task spans only its start day. */
export function spanRange(start: string, days: number | undefined): DateRange {
  const normalized = Math.max(1, Math.floor(days ?? 1));
  return { start, end: addDays(start, normalized - 1), preset: 'custom' };
}

export function coversDay(start: string, days: number | undefined, key: string): boolean {
  const range = spanRange(start, days);
  return isWithinRange(key, range);
}

const intlLocale = (locale: Locale) => (locale === 'zh' ? 'zh-CN' : 'en-US');

export function formatDateFull(key: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(parseDateKey(key));
}

/** e.g. `Sep 20 · Sun` / `9月20日 · 周日` */
export function formatDayHeading(key: string, locale: Locale): string {
  const date = parseDateKey(key);
  const monthDay = new Intl.DateTimeFormat(intlLocale(locale), {
    month: locale === 'zh' ? 'numeric' : 'short',
    day: 'numeric',
  }).format(date);
  const weekday = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'short' }).format(date);
  return `${monthDay} · ${weekday}`;
}

/** Local wall-clock time of an ISO timestamp, e.g. `09:41`. */
export function formatTime(iso: string, locale: Locale): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return new Intl.DateTimeFormat(intlLocale(locale), {
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

export function formatMonthTitle(key: string, locale: Locale): string {
  return new Intl.DateTimeFormat(intlLocale(locale), { year: 'numeric', month: 'long' }).format(
    parseDateKey(key),
  );
}

export function formatWeekTitle(key: string, locale: Locale): string {
  const start = startOfWeek(key);
  const end = endOfWeek(key);
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), { month: 'short', day: 'numeric' });
  return `${formatter.format(parseDateKey(start))} – ${formatter.format(parseDateKey(end))}`;
}

/** Narrow weekday labels for the month/week header row, Monday first. */
export function weekdayLabels(locale: Locale): string[] {
  const reference = startOfWeek(todayKey());
  const formatter = new Intl.DateTimeFormat(intlLocale(locale), { weekday: 'narrow' });
  return Array.from({ length: 7 }, (_, index) => formatter.format(parseDateKey(addDays(reference, index))));
}

export function isToday(key: string, today = todayKey()): boolean {
  return key === today;
}
