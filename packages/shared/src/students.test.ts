import { describe, expect, it } from 'vitest';
import {
  scholarshipSchema,
  spellingKey,
  studentCreateSchema,
  studentNameKey,
  studentNameSchema,
  studentRecordSchema,
  studentRestoreSchema,
  studentReturnSchema,
  studentUidCorrectionSchema,
  studentUidKey,
  studentUidSchema,
  studentYearOf,
  STUDENT_UID_MAX_LENGTH,
} from './students.js';
import { errorCodeSchema } from './errors.js';

const record = {
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
  contract: { number: ' SQ-2026/017 ', signedOn: '2026-08-20' },
};

/** Task 2.5a: a student is created with a relative. */
const relatives = [
  {
    kind: 'new',
    relative: { fullName: 'Dilfuza Saidova', phone: '+998901234567', workplace: '', email: '' },
    relationship: 'mother',
    mainContact: true,
    portalAccess: true,
    receivesNotices: true,
  },
];

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
    expect(spellingKey('Ҳамид')).toBe(spellingKey('Hamid'));
    expect(spellingKey('Шоҳруҳ')).toBe('shoxrux');
    // Russian writes Uzbek h and x both as х.
    expect(spellingKey('Рахимов')).toBe(spellingKey('Rahimov'));
    expect(spellingKey('Хасан')).toBe(spellingKey('Hasan'));
    expect(spellingKey('Чори')).toBe('chori');
    expect(spellingKey('Хуршид')).toBe(spellingKey('Khurshid'));
  });

  it('keeps names apart that differ in more than spelling', () => {
    expect(spellingKey('Otabek')).not.toBe(spellingKey('Otkir'));
    // The Russian у of an Uzbek ў is not folded (decided in the build).
    expect(spellingKey('Уткир')).not.toBe(spellingKey('Ўткир'));
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

describe('a UID typed in any form (04, UID sets, Release 1; task 9.4c)', () => {
  it('takes digits, letters or both, up to 20 characters, as typed', () => {
    for (const uid of ['SI2607001', 'A15', '2607001', 'si2607001', 'ЎТ001', 'SI-26/07', '7']) {
      expect(studentUidSchema.parse(uid)).toBe(uid);
    }
    expect(studentUidSchema.parse('A'.repeat(STUDENT_UID_MAX_LENGTH))).toHaveLength(20);
  });

  it('removes spaces and invisible characters before it counts (decision 4)', () => {
    expect(studentUidSchema.parse(' si 2607 001 ')).toBe('si2607001');
    // A no-break space, a next-line control, a zero-width space and a byte-order
    // mark: none is left for the database's check to refuse (decision 4).
    expect(studentUidSchema.parse('A\u00a01\u00855\u200b\ufeff')).toBe('A15');
    expect(studentUidSchema.parse(`${'A'.repeat(20)}  `)).toHaveLength(20);
  });

  it('refuses an empty UID and one longer than 20 characters', () => {
    for (const uid of ['', '   ', '\u200b', 'A'.repeat(21), `${'A'.repeat(20)} B`]) {
      expect(studentUidSchema.safeParse(uid).success, JSON.stringify(uid)).toBe(false);
    }
  });

  it('compares without spaces and ignoring upper and lower case', () => {
    expect(studentUidKey('si 2607001')).toBe(studentUidKey('SI2607001'));
    expect(studentUidKey('ўт001')).toBe('ЎТ001');
    expect(studentUidKey('A\u200b15')).toBe('A15');
    expect(studentUidKey('A15')).not.toBe(studentUidKey('A16'));
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
    expect(studentRecordSchema.safeParse({ ...record, startsOn: '2026-09-03' }).success).toBe(
      false,
    );
  });

  it('takes a UID in any form on the create, and no set confirmation (task 9.4c)', () => {
    for (const uid of ['2607001', 'SI2607001', 'A15']) {
      expect(
        studentCreateSchema.safeParse({ ...record, startsOn: '2026-09-02', uid, relatives })
          .success,
        uid,
      ).toBe(true);
    }
    for (const uid of ['', 'A'.repeat(21)]) {
      expect(
        studentCreateSchema.safeParse({ ...record, startsOn: '2026-09-02', uid, relatives })
          .success,
        uid,
      ).toBe(false);
    }
    // The set warning is gone (docs/spec-changes.md, 26 October 2026): the
    // strict schema refuses its confirmation.
    expect(
      studentCreateSchema.safeParse({
        ...record,
        startsOn: '2026-09-02',
        uid: '2607001',
        confirmUidSet: true,
        relatives,
      }).success,
    ).toBe(false);
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

  it('wants a reason for a UID correction, and takes a UID in any form', () => {
    expect(studentUidCorrectionSchema.safeParse({ uid: '2607002', reason: '  ' }).success).toBe(
      false,
    );
    expect(studentUidCorrectionSchema.parse({ uid: 'si 26', reason: 'Typo.' }).uid).toBe('si26');
    expect(
      studentUidCorrectionSchema.safeParse({ uid: 'A15', reason: 'Typo.', confirmUidSet: false })
        .success,
    ).toBe(false);
  });
});

describe('studentYearOf (task 2.7b-1, decision 7; task 9.4c, decision 2)', () => {
  const years = [
    { startDate: '2027-09-01', endDate: '2028-05-31' },
    { startDate: '2026-09-01', endDate: '2027-05-31' },
  ];

  it('takes the year that holds the start date', () => {
    expect(studentYearOf('2026-10-13', years)?.startDate).toBe('2026-09-01');
  });

  it('takes the first year after a date between years', () => {
    expect(studentYearOf('2027-07-01', years)?.startDate).toBe('2027-09-01');
  });

  it('finds none after the last year', () => {
    expect(studentYearOf('2028-07-01', years)).toBeUndefined();
  });
});

describe('the return and the restore name a class (task 3.3b, decision 13)', () => {
  const classId = '0192e0a4-0000-7000-8000-000000000001';
  const returning = {
    from: '2026-10-08',
    grade: 7,
    classId,
    contract: { number: 'SQ-2026/100', signedOn: '2026-10-08' },
    reason: null,
    version: 3,
  };

  it('needs the class of a return, with an optional confirmation of the language', () => {
    expect(studentReturnSchema.parse(returning)).toEqual(returning);
    expect(studentReturnSchema.parse({ ...returning, confirmLanguage: true }).confirmLanguage).toBe(
      true,
    );
    expect(studentReturnSchema.safeParse({ ...returning, classId: undefined }).success).toBe(false);
    expect(studentReturnSchema.safeParse({ ...returning, classId: 'oxford' }).success).toBe(false);
    expect(studentReturnSchema.safeParse({ ...returning, confirmLanguage: 'yes' }).success).toBe(
      false,
    );
  });

  it('needs the class of a restore and takes no grade', () => {
    const restoring = { from: '2026-10-01', classId, reason: 'Graduated by mistake.', version: 3 };
    expect(studentRestoreSchema.parse(restoring)).toEqual(restoring);
    expect(studentRestoreSchema.safeParse({ ...restoring, classId: undefined }).success).toBe(
      false,
    );
    expect(studentRestoreSchema.safeParse({ ...restoring, grade: 8 }).success).toBe(false);
  });

  it('has the codes of its two refusals', () => {
    expect(errorCodeSchema.parse('return_language_differs')).toBe('return_language_differs');
    expect(errorCodeSchema.parse('return_outside_year')).toBe('return_outside_year');
  });
});
