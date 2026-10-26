import { describe, expect, it } from 'vitest';
import {
  ratingClassesQuerySchema,
  ratingExportSchema,
  ratingSubjectQuerySchema,
} from './rating.js';

const QUARTER = '01900000-0000-7000-8000-000000000001';
const JOURNAL = '01900000-0000-7000-8000-000000000002';

describe('the rating queries', () => {
  it('takes a grade as text and refuses one outside 1 to 11', () => {
    expect(ratingClassesQuerySchema.parse({ quarterId: QUARTER, grade: '7' })).toEqual({
      quarterId: QUARTER,
      grade: 7,
    });
    expect(ratingClassesQuerySchema.safeParse({ quarterId: QUARTER, grade: '12' }).success).toBe(
      false,
    );
    expect(ratingClassesQuerySchema.safeParse({ quarterId: QUARTER, grade: '7.5' }).success).toBe(
      false,
    );
  });

  // `05`, Reports: the languages of instruction are Uzbek and Russian.
  it('takes the language of instruction only', () => {
    expect(ratingClassesQuerySchema.safeParse({ quarterId: QUARTER, language: 'ru' }).success).toBe(
      true,
    );
    expect(ratingClassesQuerySchema.safeParse({ quarterId: QUARTER, language: 'en' }).success).toBe(
      false,
    );
  });

  it('needs the quarter and the journal of a subject list', () => {
    expect(ratingSubjectQuerySchema.safeParse({ quarterId: QUARTER }).success).toBe(false);
    expect(ratingSubjectQuerySchema.safeParse({ quarterId: QUARTER, journalId: 'x' }).success).toBe(
      false,
    );
  });
});

describe('the rating export', () => {
  it('names one list, and refuses a field of another kind', () => {
    expect(
      ratingExportSchema.safeParse({ kind: 'subject', quarterId: QUARTER, journalId: JOURNAL })
        .success,
    ).toBe(true);
    expect(
      ratingExportSchema.safeParse({
        kind: 'class',
        quarterId: QUARTER,
        classId: JOURNAL,
        journalId: JOURNAL,
      }).success,
    ).toBe(false);
    expect(
      ratingExportSchema.safeParse({ kind: 'classes', quarterId: QUARTER, grade: 0 }).success,
    ).toBe(false);
  });
});
