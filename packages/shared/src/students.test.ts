import { describe, expect, it } from 'vitest';
import {
  scholarshipSchema,
  spellingKey,
  studentCreateSchema,
  studentNameKey,
  studentNameSchema,
  studentRecordSchema,
  studentUidCorrectionSchema,
  uidOutsideSet,
  uidSetOf,
} from './students.js';

const record = {
  firstName: 'Oʻtkir',
  lastName: 'Saidov',
  paternalName: '',
  sex: 'male',
  birthDate: '2014-03-02',
  grade: 7,
  startsOn: '2026-09-02',
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
  contract: { number: ' SQ-2026/017 ', signedOn: '2026-08-20' },
};

describe('spellingKey (answer 18)', () => {
  it('folds the look-alike spellings of one name into one key', () => {
    const keys = ['Oʻtkir', "O'tkir", 'O’tkir', 'Otkir', 'Ўткир', 'ЎТКИР', 'oʼtkir'].map(
      spellingKey,
    );
    expect(new Set(keys)).toEqual(new Set(['otkir']));
  });

  it('writes Cyrillic in Latin, with the Uzbek letters', () => {
    expect(spellingKey('Ғулом')).toBe(spellingKey('Gʻulom'));
    expect(spellingKey('Қодиров')).toBe('qodirov');
    expect(spellingKey('Ҳамид')).toBe('hamid');
    expect(spellingKey('Шоҳруҳ')).toBe('shohruh');
    expect(spellingKey('Хуршид')).toBe(spellingKey('Khurshid'));
  });

  it('keeps names apart that differ in more than spelling', () => {
    expect(spellingKey('Otabek')).not.toBe(spellingKey('Otkir'));
  });

  it('makes the stored key of the surname and first name', () => {
    expect(studentNameKey('Саидов', 'Ўткир')).toBe('saidov otkir');
  });
});

describe('student names', () => {
  it('takes Latin or Cyrillic as on the document, one script per name', () => {
    expect(studentNameSchema.parse("  O'tkir  ")).toBe('Oʻtkir');
    expect(studentNameSchema.parse('Ўткир')).toBe('Ўткир');
    expect(studentNameSchema.parse('Анна-Мария')).toBe('Анна-Мария');
    expect(studentNameSchema.safeParse('Otkirов').success).toBe(false);
    expect(studentNameSchema.safeParse('Otkir2').success).toBe(false);
    expect(studentNameSchema.safeParse('').success).toBe(false);
    expect(studentNameSchema.safeParse('A'.repeat(61)).success).toBe(false);
  });
});

describe('UID sets (04, UID sets; decision 5)', () => {
  it('has the table of 2026–2027', () => {
    expect([1, 7, 8, 9, 10, 11].map((grade) => uidSetOf(grade, 2026))).toEqual([
      '2601',
      '2607',
      '2507',
      '2407',
      '2307',
      '2308',
    ]);
  });

  it('moves the sets up with their grades and opens a new set for grade 1', () => {
    expect(uidSetOf(8, 2027)).toBe('2607');
    expect(uidSetOf(1, 2027)).toBe('2701');
    expect(uidSetOf(2, 2028)).toBe('2701');
    expect(uidSetOf(6, 2025)).toBe('2607');
    expect(uidSetOf(11, 2025)).toBeNull();
  });

  it('warns on a UID outside the set of the grade', () => {
    expect(uidOutsideSet('2607001', 7, 2026)).toBe(false);
    expect(uidOutsideSet('2606001', 7, 2026)).toBe(true);
    expect(uidOutsideSet('2308001', 11, 2025)).toBe(false);
  });
});

describe('the student record', () => {
  it('stores what is typed in one form', () => {
    const parsed = studentRecordSchema.parse(record);
    expect(parsed.paternalName).toBeNull();
    expect(parsed.documentNumber).toBeNull();
    expect(parsed.contract.number).toBe('SQ-2026/017');
  });

  it('refuses a UID in the edit: the UID has a correction route of its own', () => {
    expect(studentRecordSchema.safeParse({ ...record, uid: '2607001' }).success).toBe(false);
  });

  it('takes a UID of seven digits on the create, and the set confirmation', () => {
    expect(
      studentCreateSchema.safeParse({ ...record, uid: '2607001', confirmUidSet: false }).success,
    ).toBe(true);
    for (const uid of ['', '260700', '26070011', 'SI26070', '26O7001']) {
      expect(
        studentCreateSchema.safeParse({ ...record, uid, confirmUidSet: false }).success,
        uid,
      ).toBe(false);
    }
  });

  it('wants a document type and its number together, upper-cased without spaces', () => {
    expect(
      studentRecordSchema.safeParse({ ...record, documentType: 'passport', documentNumber: '' })
        .success,
    ).toBe(false);
    expect(
      studentRecordSchema.parse({
        ...record,
        documentType: 'passport',
        documentNumber: 'aa 1234567',
      }).documentNumber,
    ).toBe('AA1234567');
  });

  it('couples the scholarship type, coverage and amount (answer 21)', () => {
    expect(
      scholarshipSchema.safeParse({ type: 'merit', coverage: 'full', amount: null }).success,
    ).toBe(true);
    expect(
      scholarshipSchema.safeParse({ type: 'gift', coverage: 'partial', amount: 1500000 }).success,
    ).toBe(true);
    expect(
      scholarshipSchema.safeParse({ type: 'none', coverage: 'full', amount: null }).success,
    ).toBe(false);
    expect(
      scholarshipSchema.safeParse({ type: 'merit', coverage: null, amount: null }).success,
    ).toBe(false);
    expect(
      scholarshipSchema.safeParse({ type: 'merit', coverage: 'partial', amount: null }).success,
    ).toBe(false);
    expect(
      scholarshipSchema.safeParse({ type: 'merit', coverage: 'full', amount: 100 }).success,
    ).toBe(false);
  });

  it('keeps the diagnostic score between 0 and 100 (answer 20)', () => {
    expect(studentRecordSchema.safeParse({ ...record, diagnosticScore: 101 }).success).toBe(false);
    expect(studentRecordSchema.safeParse({ ...record, diagnosticScore: 0 }).success).toBe(true);
  });

  it('wants a reason for a UID correction', () => {
    expect(
      studentUidCorrectionSchema.safeParse({ uid: '2607002', reason: '  ', confirmUidSet: false })
        .success,
    ).toBe(false);
  });
});
