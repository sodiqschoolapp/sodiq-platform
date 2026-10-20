import { describe, expect, it } from 'vitest';
import { quartersSaveSchema } from './quarter-changes.js';

const ID = '0199a000-0000-7000-8000-000000000001';

const QUARTERS = [
  { startDate: '2026-09-01', endDate: '2026-10-31' },
  { startDate: '2026-11-09', endDate: '2026-12-28' },
  { startDate: '2027-01-11', endDate: '2027-03-20' },
  { startDate: '2027-03-30', endDate: '2027-05-31' },
];

// Task 5.6b-5a (plan test 17): the save of the quarters takes the choices of
// the dated lessons it writes again, as a template change does.
describe('quartersSaveSchema', () => {
  it('takes the four quarters with or without the choices', () => {
    expect(quartersSaveSchema.safeParse({ quarters: QUARTERS }).success).toBe(true);
    expect(
      quartersSaveSchema.safeParse({
        quarters: QUARTERS,
        days: { dayChangesKey: 'a'.repeat(64), dayDecisions: [{ key: ID, choice: 'drop' }] },
      }).success,
    ).toBe(true);
  });

  it('refuses a split group’s choice and keeps the rules of the quarters', () => {
    expect(
      quartersSaveSchema.safeParse({ quarters: QUARTERS, days: { groupBlocks: [] } }).success,
    ).toBe(false);
    const overlapping = quartersSaveSchema.safeParse({
      quarters: [
        QUARTERS[0],
        { startDate: '2026-10-20', endDate: '2026-12-28' },
        ...QUARTERS.slice(2),
      ],
    });
    expect(overlapping.success).toBe(false);
    expect(quartersSaveSchema.safeParse({ quarters: QUARTERS.slice(0, 3) }).success).toBe(false);
  });
});
