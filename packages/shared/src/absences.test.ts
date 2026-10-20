import { describe, expect, it } from 'vitest';
import { ABSENCE_REASON_MAX, absenceEditSchema, absenceRecordSchema } from './absences.js';

const STAFF = '0199a000-0000-7000-8000-000000000001';

// Task 5.7a-1: the bounds of an absence (`absences_reason_check`, 0096) and
// the days a save may send (decision 5 with review correction 1).
describe('absenceRecordSchema', () => {
  const record = (fields: object) =>
    absenceRecordSchema.safeParse({
      staffId: STAFF,
      startsOn: '2026-10-19',
      endsOn: null,
      reason: 'Ill',
      ...fields,
    }).success;

  it('takes an open-ended absence and one whose last day is its first', () => {
    expect(record({})).toBe(true);
    expect(record({ endsOn: '2026-10-19' })).toBe(true);
  });

  it('refuses a last day before the first', () => {
    expect(record({ endsOn: '2026-10-18' })).toBe(false);
  });

  it('keeps the reason to 1 to 500 characters, trimmed', () => {
    expect(ABSENCE_REASON_MAX).toBe(500);
    expect(record({ reason: 'a'.repeat(500) })).toBe(true);
    expect(record({ reason: 'a'.repeat(501) })).toBe(false);
    expect(record({ reason: '   ' })).toBe(false);
  });
});

describe('absenceEditSchema', () => {
  const edit = (endsOn: string | null) =>
    absenceEditSchema.safeParse({ startsOn: '2026-10-19', endsOn }).success;

  it('takes the day before the first, which ends an absence of today at the save (review correction 1)', () => {
    expect(edit('2026-10-18')).toBe(true);
    expect(edit(null)).toBe(true);
  });

  it('refuses a last day two days before the first', () => {
    expect(edit('2026-10-17')).toBe(false);
  });
});
