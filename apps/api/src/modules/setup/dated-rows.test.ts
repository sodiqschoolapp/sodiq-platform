import { describe, expect, it } from 'vitest';
import { endFrom, scheduleFrom } from './dated-rows.js';

const row = (id: string, validFrom: string, validUntil: string | null = null) => ({
  id,
  validFrom,
  validUntil,
});

// Decision 1 of pull request #46: a change from a date cuts the row in force,
// withdraws one starting on the date, and stops before the next planned change.
describe('scheduleFrom', () => {
  it('cuts the open row in force and opens the new row', () => {
    expect(scheduleFrom([row('a', '2026-09-01')], '2026-10-12')).toEqual({
      cut: { id: 'a', validUntil: '2026-10-12' },
      validFrom: '2026-10-12',
      validUntil: null,
    });
  });

  it('keeps a change already planned after the date: the new row stops before it', () => {
    const rows = [row('a', '2026-09-01', '2026-11-01'), row('b', '2026-11-01')];
    expect(scheduleFrom(rows, '2026-10-12')).toEqual({
      cut: { id: 'a', validUntil: '2026-10-12' },
      validFrom: '2026-10-12',
      validUntil: '2026-11-01',
    });
  });

  it('withdraws a planned row that starts on the date and takes its place up to where it ran', () => {
    const rows = [
      row('a', '2026-09-01', '2026-11-01'),
      row('b', '2026-11-01', '2027-01-01'),
      row('c', '2027-01-01'),
    ];
    expect(scheduleFrom(rows, '2026-11-01')).toEqual({
      cut: { id: 'b', validUntil: '2026-11-01' },
      validFrom: '2026-11-01',
      validUntil: '2027-01-01',
    });
  });

  it('keeps a planned end: the new row ends where the row in force ended', () => {
    expect(scheduleFrom([row('a', '2026-09-01', '2026-12-01')], '2026-10-12')).toEqual({
      cut: { id: 'a', validUntil: '2026-10-12' },
      validFrom: '2026-10-12',
      validUntil: '2026-12-01',
    });
  });

  it('with nothing in force, runs up to the next later row, or stays open', () => {
    expect(scheduleFrom([], '2026-10-12')).toEqual({
      cut: null,
      validFrom: '2026-10-12',
      validUntil: null,
    });
    expect(
      scheduleFrom([row('a', '2026-09-01', '2026-10-01'), row('b', '2026-12-01')], '2026-10-12'),
    ).toEqual({
      cut: null,
      validFrom: '2026-10-12',
      validUntil: '2026-12-01',
    });
  });

  it('ignores withdrawn rows', () => {
    const rows = [
      row('a', '2026-09-01', '2026-10-12'),
      row('withdrawn', '2026-11-01', '2026-11-01'),
    ];
    expect(scheduleFrom(rows, '2026-10-20')).toEqual({
      cut: null,
      validFrom: '2026-10-20',
      validUntil: null,
    });
  });
});

describe('endFrom', () => {
  it('cuts a row in force at the date', () => {
    expect(endFrom(row('a', '2026-09-01'), '2026-10-12')).toBe('2026-10-12');
    expect(endFrom(row('a', '2026-09-01', '2026-12-01'), '2026-10-12')).toBe('2026-10-12');
  });

  // The review's correction 2: a planned row is withdrawn, never cut before its start.
  it('withdraws a planned row that starts on or after the date', () => {
    expect(endFrom(row('a', '2026-11-01'), '2026-10-12')).toBe('2026-11-01');
    expect(endFrom(row('a', '2026-10-12'), '2026-10-12')).toBe('2026-10-12');
  });

  it('finds nothing to end in a row that already ends on or before the date, or was withdrawn', () => {
    expect(endFrom(row('a', '2026-09-01', '2026-10-12'), '2026-10-12')).toBeNull();
    expect(endFrom(row('a', '2026-09-01', '2026-10-01'), '2026-10-12')).toBeNull();
    expect(endFrom(row('a', '2026-11-01', '2026-11-01'), '2026-10-12')).toBeNull();
  });
});
