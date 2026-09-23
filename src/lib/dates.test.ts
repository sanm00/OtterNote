import { describe, expect, it } from 'vitest';
import {
  addDays,
  coversDay,
  daysBetween,
  eachDay,
  endOfWeek,
  formatMonthTitle,
  isWithinRange,
  monthGrid,
  rangeForPreset,
  spanRange,
  startOfWeek,
  weekdayIndex,
} from './dates';

// 2026-09-20 is a Sunday.
const SUNDAY = '2026-09-20';

describe('date keys', () => {
  it('adds and subtracts days across month boundaries', () => {
    expect(addDays('2026-09-30', 1)).toBe('2026-10-01');
    expect(addDays('2026-09-01', -1)).toBe('2026-08-31');
  });

  it('measures whole days between keys', () => {
    expect(daysBetween('2026-09-18', '2026-09-22')).toBe(4);
    expect(daysBetween('2026-09-22', '2026-09-18')).toBe(-4);
  });
});

describe('weeks', () => {
  it('treats Monday as the first day', () => {
    expect(weekdayIndex(SUNDAY)).toBe(6);
    expect(startOfWeek(SUNDAY)).toBe('2026-09-14');
    expect(endOfWeek(SUNDAY)).toBe(SUNDAY);
  });
});

describe('monthGrid', () => {
  it('returns six Monday-first weeks covering the month', () => {
    const grid = monthGrid(SUNDAY);
    expect(grid).toHaveLength(42);
    expect(grid[0]).toBe('2026-08-31');
    expect(grid[41]).toBe('2026-10-11');
    expect(weekdayIndex(grid[0])).toBe(0);
  });
});

describe('rangeForPreset', () => {
  it('resolves the previous week', () => {
    const range = rangeForPreset('lastWeek', SUNDAY);
    expect(range.start).toBe('2026-09-07');
    expect(range.end).toBe('2026-09-13');
  });

  it('resolves the previous month', () => {
    const range = rangeForPreset('lastMonth', SUNDAY);
    expect(range.start).toBe('2026-08-01');
    expect(range.end).toBe('2026-08-31');
  });

  it('includes both ends for today', () => {
    const range = rangeForPreset('today', SUNDAY);
    expect(range.start).toBe(SUNDAY);
    expect(range.end).toBe(SUNDAY);
  });

  it('resolves yesterday', () => {
    const range = rangeForPreset('yesterday', SUNDAY);
    expect(range.start).toBe('2026-09-19');
    expect(range.end).toBe('2026-09-19');
  });
});

describe('spans', () => {
  it('includes the start day for a one-day task', () => {
    expect(spanRange('2026-09-18', undefined)).toEqual({
      start: '2026-09-18',
      end: '2026-09-18',
      preset: 'custom',
    });
  });

  it('covers every day of a multi-day task', () => {
    expect(coversDay('2026-09-18', 5, '2026-09-18')).toBe(true);
    expect(coversDay('2026-09-18', 5, '2026-09-22')).toBe(true);
    expect(coversDay('2026-09-18', 5, '2026-09-23')).toBe(false);
  });

  it('never spans fewer than one day', () => {
    expect(spanRange('2026-09-18', 0).end).toBe('2026-09-18');
  });
});

describe('eachDay / isWithinRange', () => {
  it('expands a range inclusively', () => {
    expect(eachDay({ start: '2026-09-18', end: '2026-09-20' })).toEqual([
      '2026-09-18',
      '2026-09-19',
      '2026-09-20',
    ]);
  });

  it('handles an inverted range', () => {
    expect(eachDay({ start: '2026-09-20', end: '2026-09-18' })).toEqual([]);
  });

  it('checks membership inclusively', () => {
    const range = { start: '2026-09-07', end: '2026-09-13' };
    expect(isWithinRange('2026-09-07', range)).toBe(true);
    expect(isWithinRange('2026-09-13', range)).toBe(true);
    expect(isWithinRange('2026-09-14', range)).toBe(false);
  });
});

describe('formatMonthTitle', () => {
  it('localises the month name', () => {
    expect(formatMonthTitle(SUNDAY, 'en')).toContain('2026');
    expect(formatMonthTitle(SUNDAY, 'zh')).toContain('2026');
    expect(formatMonthTitle(SUNDAY, 'en')).not.toBe(formatMonthTitle(SUNDAY, 'zh'));
  });
});
