import { describe, expect, it } from 'vitest';
import { availabilityRangeSchema, availabilitySetSchema, rangesOverlap } from './availability.js';

// Task 2.2b: what a new entry of availability may hold (04, Availability;
// owner's answer 10). The database keeps the same rules (db/migrations/0025).
describe('availability', () => {
  const monday = (start: string, end: string) => ({ weekday: 1 as const, start, end });

  it('takes ranges whose end comes after the start, up to 24:00', () => {
    expect(availabilityRangeSchema.safeParse(monday('08:00', '13:00')).success).toBe(true);
    expect(availabilityRangeSchema.safeParse(monday('18:00', '24:00')).success).toBe(true);
    expect(availabilityRangeSchema.safeParse(monday('13:00', '13:00')).success).toBe(false);
    expect(availabilityRangeSchema.safeParse(monday('13:00', '08:00')).success).toBe(false);
    expect(availabilityRangeSchema.safeParse(monday('08:00', '24:30')).success).toBe(false);
    expect(availabilityRangeSchema.safeParse(monday('24:00', '24:00')).success).toBe(false);
    expect(
      availabilityRangeSchema.safeParse({ weekday: 8, start: '08:00', end: '09:00' }).success,
    ).toBe(false);
    expect(
      availabilityRangeSchema.safeParse({ weekday: 0, start: '08:00', end: '09:00' }).success,
    ).toBe(false);
  });

  it('counts ranges that touch as not overlapping', () => {
    expect(rangesOverlap(monday('08:00', '13:00'), monday('13:00', '17:00'))).toBe(false);
    expect(rangesOverlap(monday('08:00', '13:00'), monday('12:59', '17:00'))).toBe(true);
    expect(
      rangesOverlap(monday('08:00', '13:00'), {
        weekday: 2 as const,
        start: '08:00',
        end: '13:00',
      }),
    ).toBe(false);
  });

  it('refuses overlapping ranges of one weekday in one entry, and takes an empty entry', () => {
    expect(
      availabilitySetSchema.safeParse({
        from: '2026-10-13',
        ranges: [monday('08:00', '13:00'), monday('13:00', '17:00')],
      }).success,
    ).toBe(true);
    const refused = availabilitySetSchema.safeParse({
      from: '2026-10-13',
      ranges: [monday('08:00', '13:00'), monday('12:00', '14:00')],
    });
    expect(refused.success).toBe(false);
    expect(refused.error?.issues[0]?.path).toEqual(['ranges', 1, 'start']);
    expect(availabilitySetSchema.safeParse({ from: '2026-10-13', ranges: [] }).success).toBe(true);
  });
});
