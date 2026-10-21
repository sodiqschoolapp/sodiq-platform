import { describe, expect, it } from 'vitest';
import {
  absenceJournalSubstituteBodySchema,
  journalSubstitutesAnswerSchema,
  vacancyJournalSubstituteBodySchema,
  vacancyJournalSubstitutesQuerySchema,
} from './journal-substitutions.js';

const ID = '0199a000-0000-7000-8000-000000000001';
const OTHER = '0199a000-0000-7000-8000-000000000002';

// Task 5.7b-2, pull request #192: the bodies of the substitution per journal.
describe('the substitution per journal', () => {
  it('takes a journal, a teacher and a trimmed reason, and refuses an empty one or another field', () => {
    expect(
      absenceJournalSubstituteBodySchema.parse({
        journalId: ID,
        teacherId: OTHER,
        reason: '  The teacher is ill ',
      }),
    ).toEqual({ journalId: ID, teacherId: OTHER, reason: 'The teacher is ill' });
    expect(
      absenceJournalSubstituteBodySchema.safeParse({ journalId: ID, teacherId: OTHER, reason: ' ' })
        .success,
    ).toBe(false);
    expect(
      absenceJournalSubstituteBodySchema.safeParse({
        journalId: ID,
        teacherId: OTHER,
        reason: 'Ill',
        from: '2026-10-12',
      }).success,
    ).toBe(false);
  });

  it("takes a vacancy's period, open-ended or ending after it starts (decision 7)", () => {
    const body = { journalId: ID, teacherId: OTHER, reason: 'Nobody hired', from: '2026-10-12' };
    expect(vacancyJournalSubstituteBodySchema.safeParse(body).success).toBe(true);
    expect(vacancyJournalSubstituteBodySchema.safeParse({ ...body, until: null }).success).toBe(
      true,
    );
    expect(
      vacancyJournalSubstituteBodySchema.safeParse({ ...body, until: '2026-10-19' }).success,
    ).toBe(true);
    const empty = vacancyJournalSubstituteBodySchema.safeParse({ ...body, until: '2026-10-12' });
    expect(empty.success).toBe(false);
    expect(empty.error?.issues[0]?.path).toEqual(['until']);
    expect(
      vacancyJournalSubstitutesQuerySchema.safeParse({ from: '2026-10-12', until: '2026-10-11' })
        .success,
    ).toBe(false);
  });

  it('answers each teacher with the dates it can take and those it cannot', () => {
    expect(
      journalSubstitutesAnswerSchema.safeParse({
        dates: ['2026-10-12'],
        teachers: [
          {
            id: ID,
            name: 'Karimova Aziza',
            group: 'subject',
            language: false,
            acting: true,
            dates: ['2026-10-12'],
            blockedDates: [],
          },
        ],
      }).success,
    ).toBe(true);
  });
});
