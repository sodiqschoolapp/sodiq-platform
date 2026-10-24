import { describe, expect, it } from 'vitest';
import {
  EXEMPTION_CATEGORIES,
  exemptionCreateSchema,
  exemptionEditSchema,
  exemptionVoidSchema,
} from './exemptions.js';

const student = '019a0000-0000-7000-8000-000000000001';
const subject = '019a0000-0000-7000-8000-000000000002';

const base = {
  studentIds: [student],
  kind: 'temporary' as const,
  subjectIds: null,
  startDate: '2026-10-20',
  endDate: '2026-10-22',
  slots: null,
  category: 'illness' as const,
  detail: 'A certificate from the clinic',
  choices: [],
};

const pathsOf = (value: unknown) => {
  const parsed = exemptionCreateSchema.safeParse(value);
  return parsed.success ? [] : parsed.error.issues.map((issue) => issue.path.join('.'));
};

// The schemas of exemptions (task 8.5) are never wider than the checks of 0123.
describe('exemption schemas', () => {
  it('takes a temporary exemption of whole days', () => {
    expect(pathsOf(base)).toEqual([]);
  });

  it('names the reason categories of edge/exemptions', () => {
    expect(EXEMPTION_CATEGORIES).toEqual([
      'illness',
      'competition',
      'family',
      'school_event',
      'other',
    ]);
  });

  it('leaves the end of a full exemption to the server (07, Kind)', () => {
    expect(pathsOf({ ...base, kind: 'full' })).toEqual(['endDate']);
    expect(pathsOf({ ...base, kind: 'full', endDate: null })).toEqual([]);
  });

  it('refuses slots of a full exemption, of chosen subjects or of two days (edge/exemptions, row 2)', () => {
    const slots = { start: '11:00', end: '13:00' };
    expect(pathsOf({ ...base, kind: 'full', endDate: null, slots })).toContain('slots');
    expect(pathsOf({ ...base, endDate: '2026-10-20', slots, subjectIds: [subject] })).toContain(
      'subjectIds',
    );
    expect(pathsOf({ ...base, slots })).toContain('endDate');
    expect(pathsOf({ ...base, endDate: '2026-10-20', slots })).toEqual([]);
  });

  it('refuses slots that end before they start', () => {
    expect(
      pathsOf({ ...base, endDate: '2026-10-20', slots: { start: '13:00', end: '11:00' } }),
    ).toContain('slots.end');
  });

  it('refuses an end before the start, a student twice and a choice twice', () => {
    expect(pathsOf({ ...base, endDate: '2026-10-19' })).toContain('endDate');
    expect(pathsOf({ ...base, studentIds: [student, student] })).toContain('studentIds.1');
    const lessonId = '019a0000-0000-7000-8000-000000000003';
    expect(
      pathsOf({
        ...base,
        choices: [
          { studentId: student, lessonId, choice: 'keep' },
          { studentId: student, lessonId, choice: 'exempt' },
        ],
      }),
    ).toContain('choices.1.lessonId');
  });

  it('refuses a detail longer than the check of the database, and an empty one', () => {
    expect(pathsOf({ ...base, detail: 'x'.repeat(1001) })).toContain('detail');
    expect(pathsOf({ ...base, detail: '   ' })).toContain('detail');
  });

  it('takes no student list in an edit, and a void needs its reason', () => {
    const fields = Object.fromEntries(Object.entries(base).filter(([key]) => key !== 'studentIds'));
    expect(exemptionEditSchema.safeParse({ ...fields, version: 1 }).success).toBe(true);
    expect(
      exemptionEditSchema.safeParse({ ...fields, version: 1, studentIds: [student] }).success,
    ).toBe(false);
    expect(exemptionVoidSchema.safeParse({ reason: '', version: 1 }).success).toBe(false);
  });
});
