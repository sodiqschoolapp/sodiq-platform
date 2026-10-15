import { describe, expect, it } from 'vitest';
import {
  STAFF_CATEGORY_ROLES,
  STAFF_NAME_MAX_LENGTH,
  staffBranchesSchema,
  staffCheckSchema,
  staffDivisionsSchema,
  staffIdSchema,
  staffNameSchema,
  staffPhoneSchema,
  staffRecordSchema,
  staffStatusChangeSchema,
  staffTeachingSchema,
  storedName,
} from './staff.js';

const DIVISION = '0199e4a0-0000-7000-8000-000000000001';
const OTHER_DIVISION = '0199e4a0-0000-7000-8000-000000000002';
const DEPARTMENT = '0199e4a0-0000-7000-8000-000000000003';
const SUBJECT = '0199e4a0-0000-7000-8000-000000000004';
const BRANCH = '0199e4a0-0000-7000-8000-000000000005';

const RECORD = {
  firstName: 'Akmal',
  lastName: 'Karimov',
  fatherName: '',
  sex: 'male',
  birthDate: '1990-01-01',
  educationLevel: null,
  phone: '+998 90 123-45-67',
  email: '',
  jshshir: '',
  admissionDate: '2026-09-01',
  contractType: null,
  contractDate: null,
  weeklyLessons: null,
  dailyLessons: null,
  divisions: [{ divisionId: DIVISION, departmentId: DEPARTMENT, main: true }],
};

describe('staff records', () => {
  // Answer 13 and correction 9 of the review of pull request #53: one stored
  // form per letter, so the typed variants are one name.
  it.each([
    ["O'tkir", 'Oʻtkir'],
    ['O’tkir', 'Oʻtkir'],
    ['O‘tkir', 'Oʻtkir'],
    ['O`tkir', 'Oʻtkir'],
    ['Oʻtkir', 'Oʻtkir'],
    ["G'ayrat", 'Gʻayrat'],
    ["Ma'ruf", 'Maʼruf'],
    ['Maʼruf', 'Maʼruf'],
    ['  Abdul   Aziz ', 'Abdul Aziz'],
  ])('stores %s as %s', (typed, stored) => {
    expect(storedName(typed)).toBe(stored);
    expect(staffNameSchema.parse(typed)).toBe(stored);
  });

  it.each(['', 'Ўткир', 'Akmal1', 'A'.repeat(STAFF_NAME_MAX_LENGTH + 1), '-Akmal'])(
    'refuses the name %s',
    (name) => {
      expect(staffNameSchema.safeParse(name).success).toBe(false);
    },
  );

  it('takes a phone with its country code and drops spaces, hyphens and brackets', () => {
    expect(staffPhoneSchema.parse('+998 (90) 123-45-67')).toBe('+998901234567');
    // Nine digits alone are an Uzbek number since task 3.5b (H25, decision 7); "+998" needs exactly nine.
    expect(staffPhoneSchema.parse('901234567')).toBe('+998901234567');
    expect(staffPhoneSchema.safeParse('+99890123456').success).toBe(false);
    expect(staffPhoneSchema.safeParse('+998 ').success).toBe(false);
    expect(staffPhoneSchema.safeParse('+99890').success).toBe(false);
  });

  it('reads a record: empty optional fields become none, the email lower case', () => {
    const parsed = staffRecordSchema.parse({ ...RECORD, email: ' Teacher@School.UZ ' });
    expect(parsed.fatherName).toBeNull();
    expect(parsed.jshshir).toBeNull();
    expect(parsed.email).toBe('teacher@school.uz');
    expect(parsed.phone).toBe('+998901234567');
    expect(staffRecordSchema.safeParse({ ...RECORD, jshshir: '1234' }).success).toBe(false);
    expect(staffRecordSchema.safeParse({ ...RECORD, weeklyLessons: 61 }).success).toBe(false);
    expect(staffRecordSchema.safeParse({ ...RECORD, dailyLessons: 0 }).success).toBe(false);
  });

  it('wants exactly one main division, each division once', () => {
    const division = (id: string, main: boolean) => ({
      divisionId: id,
      departmentId: null,
      main,
    });
    expect(staffDivisionsSchema.safeParse([division(DIVISION, false)]).success).toBe(false);
    expect(
      staffDivisionsSchema.safeParse([division(DIVISION, true), division(OTHER_DIVISION, true)])
        .success,
    ).toBe(false);
    expect(
      staffDivisionsSchema.safeParse([division(DIVISION, true), division(DIVISION, false)]).success,
    ).toBe(false);
    expect(
      staffDivisionsSchema.safeParse([division(DIVISION, true), division(OTHER_DIVISION, false)])
        .success,
    ).toBe(true);
  });

  it('wants a language once there is a subject, each subject and language once', () => {
    const subject = { subjectId: SUBJECT, grades: [5, 6] };
    expect(staffTeachingSchema.safeParse({ subjects: [subject], languages: [] }).success).toBe(
      false,
    );
    expect(staffTeachingSchema.safeParse({ subjects: [], languages: [] }).success).toBe(true);
    expect(
      staffTeachingSchema.safeParse({ subjects: [subject, subject], languages: ['uz'] }).success,
    ).toBe(false);
    expect(
      staffTeachingSchema.safeParse({ subjects: [subject], languages: ['uz', 'uz'] }).success,
    ).toBe(false);
    expect(
      staffTeachingSchema.safeParse({ subjects: [subject], languages: ['uz', 'ru'] }).success,
    ).toBe(true);
  });

  it('wants the main branch outside the further ones, each once', () => {
    expect(
      staffBranchesSchema.safeParse({ mainBranchId: BRANCH, furtherBranchIds: [BRANCH] }).success,
    ).toBe(false);
    expect(
      staffBranchesSchema.safeParse({ mainBranchId: BRANCH, furtherBranchIds: [] }).success,
    ).toBe(true);
  });

  it('knows the staff ID and the statuses', () => {
    expect(staffIdSchema.safeParse('S-260001').success).toBe(true);
    expect(staffIdSchema.safeParse('S-26001').success).toBe(false);
    expect(staffStatusChangeSchema.safeParse({ status: 'left', from: '2026-10-30' }).success).toBe(
      true,
    );
    expect(staffStatusChangeSchema.safeParse({ status: 'open', from: '2026-10-30' }).success).toBe(
      false,
    );
    expect(
      staffCheckSchema.safeParse({
        firstName: "O'tkir",
        lastName: 'Karimov',
        birthDate: '1990-01-01',
        phone: '+998901234567',
        staffRecordId: null,
      }).data?.firstName,
    ).toBe('Oʻtkir');
  });
});

describe('STAFF_CATEGORY_ROLES', () => {
  // 04, Teacher and staff record, Personal (spec change of 13 October 2026,
  // item A2): the category is any of the nine roles, in the order of 04.
  it('is the nine roles of 04, in their order', () => {
    expect(STAFF_CATEGORY_ROLES).toEqual([
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
      'tutor',
      'senior_head_teacher',
      'head_teacher',
      'teacher',
    ]);
  });
});
