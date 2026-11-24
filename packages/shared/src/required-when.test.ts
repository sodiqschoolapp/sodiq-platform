import { describe, expect, it } from 'vitest';
import type { z } from 'zod';
import { leftEmpty, type RequiredKnown, type RequiredWhen } from './required-when.js';
import {
  scholarshipRequiredWhen,
  scholarshipSchema,
  studentCreateRequiredWhen,
  studentCreateSchema,
  studentRecordRequiredWhen,
  studentRecordSchema,
} from './students.js';

/**
 * Task 11.18 (`12`, No lost work: "A field without the mark may be left
 * empty"). A form marks a field from its schema's own rule for the field, and
 * from the schema's `requiredWhen` for what only a refine or the server says.
 * For each valid sample, each field is emptied in turn: when the schema then
 * refuses the record with refine issues only (the field's own rule is read
 * from the schema by the form), the map must say the field is required, and
 * when the schema takes the emptied record, the map must not.
 */
export function expectTiedTo(
  schema: z.ZodType,
  samples: readonly Record<string, unknown>[],
  map: RequiredWhen,
  known: RequiredKnown = {},
  /** Requirements the server checks outside the schema: their own test. */
  outside: readonly string[] = [],
): void {
  for (const sample of samples) {
    expect(schema.safeParse(sample).success, JSON.stringify(sample)).toBe(true);
    for (const field of Object.keys(sample)) {
      if (outside.includes(field) || leftEmpty(sample[field])) {
        continue;
      }
      // Empty as a form sends it: '' for a text, null for a field that may be none.
      const ownRule = (checked: ReturnType<typeof schema.safeParse>) =>
        !checked.success &&
        checked.error.issues.some((issue) => issue.path[0] === field && issue.code !== 'custom');
      const tries = ['', null].map((empty) => schema.safeParse({ ...sample, [field]: empty }));
      const checked = tries.find((one) => !ownRule(one));
      if (checked === undefined) {
        continue;
      }
      const byRefine = !checked.success;
      const says = map[field]?.(sample, known) ?? false;
      expect({ field, sample, required: says }).toEqual({ field, sample, required: byRefine });
    }
  }
}

const RECORD = {
  firstName: 'Oʻtkir',
  lastName: 'Saidov',
  paternalName: '',
  sex: 'male',
  birthDate: '2014-03-02',
  grade: 7,
  documentType: null,
  documentNumber: '',
  jshshir: '',
  phone: '',
  email: '',
  address: '',
  region: null,
  previousSchool: '',
  diagnosticScore: null,
  scholarship: { type: 'none', coverage: null, amount: null },
  consentSignedOn: null,
  contract: null,
};
const WITH_DOCUMENT = {
  ...RECORD,
  documentType: 'birth_certificate',
  documentNumber: 'I-TN 123456',
};

describe('requiredWhen beside its schema (task 11.18)', () => {
  it('the student record: a document type and its number, both or neither', () => {
    expectTiedTo(studentRecordSchema, [RECORD, WITH_DOCUMENT], studentRecordRequiredWhen);
  });

  it('the student create: the document pair, and the class by the branch’s today', () => {
    const create = {
      ...RECORD,
      startsOn: '2026-09-01',
      uid: '26-0001',
      relatives: [],
      classId: null,
    };
    expectTiedTo(
      studentCreateSchema,
      [
        create,
        { ...WITH_DOCUMENT, startsOn: '2026-09-01', uid: '26-0001', relatives: [], classId: null },
      ],
      studentCreateRequiredWhen,
      { today: '2026-08-20' },
      ['classId'],
    );
    // `student_needs_class` (students.service.ts): a start today or earlier needs a class.
    const needs = (startsOn: string, today: string | undefined) =>
      studentCreateRequiredWhen.classId?.({ ...create, startsOn }, { today });
    expect(needs('2026-09-01', '2026-08-31')).toBe(false);
    expect(needs('2026-09-01', '2026-09-01')).toBe(true);
    expect(needs('2026-09-01', '2026-09-02')).toBe(true);
    expect(needs('2026-09-01', undefined)).toBe(true);
    expect(needs('', '2026-09-02')).toBe(true);
  });

  it('the scholarship: its coverage, and an amount for a partial one', () => {
    expectTiedTo(
      scholarshipSchema,
      [
        { type: 'none', coverage: null, amount: null },
        { type: 'merit', coverage: 'full', amount: null },
        { type: 'merit', coverage: 'partial', amount: 500000 },
      ],
      scholarshipRequiredWhen,
    );
  });
});
