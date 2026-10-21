import { describe, expect, it } from 'vitest';
import { viewAxisOf, viewDates } from './timetable-views.js';

describe('viewDates', () => {
  it('is the date alone for a day', () => {
    expect(viewDates('2026-10-21', 'day')).toEqual(['2026-10-21']);
  });

  it('is Monday to Sunday of the week (decision 6)', () => {
    expect(viewDates('2026-10-21', 'week')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
    ]);
  });

  it('puts a Sunday at the end of its own week, and a Monday at the start', () => {
    expect(viewDates('2026-10-25', 'week')[0]).toBe('2026-10-19');
    expect(viewDates('2026-10-19', 'week')[6]).toBe('2026-10-25');
  });

  it('crosses a month and a year', () => {
    expect(viewDates('2027-01-01', 'week')).toEqual([
      '2026-12-28',
      '2026-12-29',
      '2026-12-30',
      '2026-12-31',
      '2027-01-01',
      '2027-01-02',
      '2027-01-03',
    ]);
  });
});

describe('viewAxisOf (decision 9)', () => {
  const junior = [
    { start: 480, end: 520 },
    { start: 530, end: 570 },
  ];
  const senior = [
    { start: 480, end: 525 },
    { start: 535, end: 580 },
  ];

  it('is lesson numbers for one template', () => {
    expect(viewAxisOf([junior, junior], false)).toBe('slots');
  });

  it('is clock time for two templates with different times', () => {
    expect(viewAxisOf([junior, senior], false)).toBe('clock');
  });

  it('is lesson numbers for two templates with equal times', () => {
    expect(viewAxisOf([senior, [...senior]], false)).toBe('slots');
  });

  it('is clock time for one template and a busy block of another branch', () => {
    expect(viewAxisOf([junior], true)).toBe('clock');
  });

  it('is lesson numbers for a day with nothing', () => {
    expect(viewAxisOf([], false)).toBe('slots');
  });
});
