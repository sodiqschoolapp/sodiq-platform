import { describe, expect, it } from 'vitest';
import { expectTiedTo } from './required-when-kit.js';
import {
  scholarshipRequiredWhen,
  scholarshipSchema,
  studentCreateRequiredWhen,
  studentCreateSchema,
  studentRecordRequiredWhen,
  studentRecordSchema,
} from './students.js';

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
