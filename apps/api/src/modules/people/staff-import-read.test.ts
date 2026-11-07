import { describe, expect, it } from 'vitest';
import { filledStaffTemplate, staffRow } from '../../testing/staff-import-kit.js';
import {
  gradesOf,
  hoursOf,
  parseStaffImportRow,
  readStaffImportWorkbook,
  staffFileChecks,
  type SchoolLists,
} from './staff-import-read.js';

// All names are invented. Task 9.4h: reading the system's staff template
// (`edge/students-classes-groups`, the import row, applied to both imports by
// the spec change of 3 November 2026; `edge/people-roles-accounts`, the staff
// import row: "an import can create only Teachers and Tutors").
const ACADEMIC = '01960000-0000-7000-8000-000000000001';
const MANAGEMENT = '01960000-0000-7000-8000-000000000002';
const STEAM = '01960000-0000-7000-8000-000000000011';
const FINANCE = '01960000-0000-7000-8000-000000000012';
const MATHEMATICS = '01960000-0000-7000-8000-000000000021';
const PHYSICS = '01960000-0000-7000-8000-000000000022';

const LISTS: SchoolLists = {
  divisions: [
    { id: ACADEMIC, builtIn: true, names: ['Akademik', 'Академический', 'Academic'] },
    { id: MANAGEMENT, builtIn: false, names: ['Boshqaruv', 'Управление', 'Management'] },
  ],
  departments: [
    { id: STEAM, divisionId: ACADEMIC, names: ['STEAM', 'STEAM', 'STEAM'] },
    { id: FINANCE, divisionId: MANAGEMENT, names: ['Moliya', 'Финансы', 'Finance'] },
  ],
  subjects: [
    { id: MATHEMATICS, names: ['Matematika', 'Математика', 'Mathematics'] },
    { id: PHYSICS, names: ['Fizika', 'Физика', 'Physics'] },
  ],
};

/** A row as the workbook gives it: every cell as text. */
async function readRows(rows: Parameters<typeof filledStaffTemplate>[0]) {
  return readStaffImportWorkbook(await filledStaffTemplate(rows));
}

async function parsed(overrides: Parameters<typeof staffRow>[0] = {}) {
  const [row] = await readRows([staffRow(overrides)]);
  if (row === undefined) {
    throw new Error('One row read.');
  }
  return parseStaffImportRow(row, LISTS);
}

const codes = (row: { problems: { column: string | null; code: string }[] }) =>
  row.problems.map((one) => `${String(one.column)}:${one.code}`);

describe('reading the staff template', () => {
  it('reads a complete row into the record and the teaching the hand screens send', async () => {
    const row = await parsed({ phone: 998971234567, birthDate: '05.06.1988' });
    expect(row.problems).toEqual([]);
    expect(row.role).toBe('teacher');
    expect(row.record).toMatchObject({
      phone: '+998971234567',
      birthDate: '1988-06-05',
      sex: 'male',
      educationLevel: 'master',
      contractType: 'full_time',
      admissionDate: '2026-09-01',
      weeklyLessons: null,
      divisions: [{ divisionId: ACADEMIC, departmentId: STEAM, main: true }],
    });
    expect(row.teaching).toEqual({
      subjects: [{ subjectId: MATHEMATICS, grades: [5, 6, 7] }],
      languages: ['uz'],
    });
  });

  it('takes the values of the lists in any of the three languages or as codes', async () => {
    for (const [sex, contract, languages, role] of [
      ['Ayol', 'Yarim stavka', 'Oʻzbek va rus', 'Tyutor'],
      ['Женский', 'Неполная ставка', 'Узбекский и русский', 'Тьютор'],
      ['female', 'part_time', 'both', 'tutor'],
    ] as const) {
      const row = await parsed({ sex, contractType: contract, languages, role });
      expect(row.problems).toEqual([]);
      expect(row.record?.sex).toBe('female');
      expect(row.record?.contractType).toBe('part_time');
      expect(row.teaching?.languages).toEqual(['uz', 'ru']);
      expect(row.role).toBe('tutor');
    }
  });

  it('gives only Teachers and Tutors, tells every other role, and takes an empty role', async () => {
    for (const role of ['Super Admin', 'Суперадминистратор', 'Class teacher', 'Fan rahbari']) {
      expect(codes(await parsed({ role }))).toEqual(['role:import_role_not_allowed']);
    }
    expect(codes(await parsed({ role: 'Wizard' }))).toEqual(['role:value_unknown']);
    const none = await parsed({ role: '' });
    expect(none.problems).toEqual([]);
    expect(none.role).toBeNull();
  });

  it('finds names by any language, case and look-alike letters, and never guesses', async () => {
    // "МАТЕМАТИКА" in Cyrillic capitals, "Mаthematics" with a Cyrillic а.
    const row = await parsed({
      subject1: 'МАТЕМАТИКА: 5',
      subject2: 'fizika: 7-8',
      division: 'akademik',
    });
    expect(row.problems).toEqual([]);
    expect(codes(await parsed({ subject1: 'Mаthematics: 5' }))).toEqual([]);
    expect(codes(await parsed({ subject1: 'Chemistry: 5' }))).toEqual(['subject1:name_unknown']);
    expect(codes(await parsed({ department: 'Finance' }))).toEqual([
      'department:department_not_of_division',
    ]);
    const twice: SchoolLists = {
      ...LISTS,
      subjects: [...LISTS.subjects, { id: FINANCE, names: ['Matematika', 'Matematika', 'Maths'] }],
    };
    const [one] = await readRows([staffRow({ subject1: 'Matematika: 5' })]);
    if (one === undefined) {
      throw new Error('One row read.');
    }
    expect(codes(parseStaffImportRow(one, twice))).toEqual(['subject1:name_ambiguous']);
  });

  it('reads grades as lists and ranges, and refuses other forms', () => {
    expect(gradesOf('5, 6, 7')).toEqual([5, 6, 7]);
    expect(gradesOf('5-7; 9')).toEqual([5, 6, 7, 9]);
    expect(gradesOf('0–4')).toEqual([0, 1, 2, 3, 4]);
    expect(gradesOf('7, 5, 5')).toEqual([5, 7]);
    for (const wrong of ['', '12', '7-5', 'five', '5.5']) {
      expect(gradesOf(wrong)).toBeUndefined();
    }
  });

  it('refuses dates and phones that cannot be read, and a subject without a language', async () => {
    expect(codes(await parsed({ birthDate: '1988-06-05' }))).toEqual(['birthDate:date_invalid']);
    expect(codes(await parsed({ admissionDate: '31.02.2026' }))).toEqual([
      'admissionDate:date_invalid',
    ]);
    expect(codes(await parsed({ phone: 'call me' }))).toEqual(['phone:phone_invalid']);
    expect(codes(await parsed({ languages: '' }))).toEqual(['languages:required']);
  });

  // Owner, 7 November 2026: these three may be left empty (the requirement changed;
  // before, an empty phone was `phone:required`).
  it('takes a row without a date of birth, a phone and an admission date', async () => {
    const row = await parsed({ birthDate: '', phone: '', admissionDate: '' });
    expect(row.problems).toEqual([]);
    expect(row.record).toMatchObject({ birthDate: null, phone: null, admissionDate: null });
  });

  it('reads the hours of each weekday into the ranges the hand route takes', async () => {
    const row = await parsed({
      hoursMonday: '08:00-16:05',
      hoursWednesday: '8:00 - 12:00, 13:30-16:05',
      hoursSaturday: '09.00–13.00',
    });
    expect(row.problems).toEqual([]);
    expect(row.hours).toEqual([
      { weekday: 1, start: '08:00', end: '16:05' },
      { weekday: 3, start: '08:00', end: '12:00' },
      { weekday: 3, start: '13:30', end: '16:05' },
      { weekday: 6, start: '09:00', end: '13:00' },
    ]);
    // Until 24:00, as by hand.
    expect((await parsed({ hoursFriday: '14:00-24:00' })).hours).toEqual([
      { weekday: 5, start: '14:00', end: '24:00' },
    ]);
  });

  it('adds no hours when every hours cell is empty', async () => {
    const row = await parsed();
    expect(row.problems).toEqual([]);
    expect(row.hours).toBeNull();
  });

  it('names each wrong hours cell as a problem of its column', async () => {
    expect(codes(await parsed({ hoursMonday: 'all day' }))).toEqual(['hoursMonday:hours_invalid']);
    expect(codes(await parsed({ hoursTuesday: '08:00' }))).toEqual(['hoursTuesday:hours_invalid']);
    expect(codes(await parsed({ hoursWednesday: '08:00-25:00' }))).toEqual([
      'hoursWednesday:hours_outside_day',
    ]);
    expect(codes(await parsed({ hoursThursday: '24:00-24:30' }))).toEqual([
      'hoursThursday:hours_outside_day',
    ]);
    expect(codes(await parsed({ hoursFriday: '16:00-08:00' }))).toEqual([
      'hoursFriday:hours_end_before_start',
    ]);
    expect(codes(await parsed({ hoursSaturday: '08:00-12:00, 11:00-14:00' }))).toEqual([
      'hoursSaturday:hours_overlap',
    ]);
    // Touching ranges do not overlap, as by hand.
    expect(codes(await parsed({ hoursSaturday: '08:00-12:00, 12:00-14:00' }))).toEqual([]);
    // Two wrong cells: both named, and the row is not saved.
    const two = await parsed({ hoursMonday: 'x', hoursFriday: '16:00-08:00' });
    expect(codes(two)).toEqual(['hoursMonday:hours_invalid', 'hoursFriday:hours_end_before_start']);
    expect(two.record).toBeNull();
    expect(two.hours).toBeNull();
  });

  it('names more ranges than one entry holds as too many', async () => {
    const minute = (n: number) => `08:${String(n).padStart(2, '0')}`;
    const many = Array.from({ length: 36 }, (_, n) => `${minute(n)}-${minute(n + 1)}`).join(', ');
    const row = await parsed({ hoursMonday: many });
    expect(codes(row)).toEqual(['null:hours_over_limit']);
    expect(row.record).toBeNull();
    const enough = Array.from({ length: 35 }, (_, n) => `${minute(n)}-${minute(n + 1)}`).join(', ');
    expect(codes(await parsed({ hoursMonday: enough }))).toEqual([]);
  });

  it('reads one hours cell with the checks of the hand route', () => {
    expect(hoursOf(2, '07:30-15:00')).toEqual([{ weekday: 2, start: '07:30', end: '15:00' }]);
    expect(hoursOf(2, '08:00-08:00')).toBe('hours_end_before_start');
    expect(hoursOf(2, '08:60-09:00')).toBe('hours_outside_day');
    expect(hoursOf(2, ',')).toBe('hours_invalid');
  });

  it('finds the same phone or JSHSHIR on two rows and the same name and date of birth', async () => {
    const rows = await readRows([
      staffRow({
        phone: 998971110000,
        firstName: 'Bobur',
        lastName: 'Egizak',
        birthDate: '01.01.1990',
      }),
      staffRow({ phone: '+998 97 111 00 00', jshshir: '31111900000001' }),
      staffRow({
        jshshir: '31111900000001',
        firstName: 'BOBUR',
        lastName: 'egizak',
        birthDate: '01.01.1990',
      }),
    ]);
    const checks = staffFileChecks(rows.map((row) => parseStaffImportRow(row, LISTS)));
    expect(checks.problems.get(3)).toEqual([
      { column: 'phone', code: 'duplicate_in_file', rows: [4] },
    ]);
    expect(checks.problems.get(4)).toEqual([
      { column: 'phone', code: 'duplicate_in_file', rows: [3] },
      { column: 'jshshir', code: 'duplicate_in_file', rows: [5] },
    ]);
    expect(checks.sameNameAndBirth.get(5)).toEqual([3]);
  });

  it('warns on the same name alone when either row has no date of birth', async () => {
    const rows = await readRows([
      staffRow({ firstName: 'Dilshod', lastName: 'Sanoqulov', birthDate: '01.01.1990' }),
      staffRow({ firstName: 'Dilshod', lastName: 'Sanoqulov', birthDate: '' }),
      staffRow({ firstName: 'Dilshod', lastName: 'Sanoqulov', birthDate: '02.02.1991' }),
    ]);
    const checks = staffFileChecks(rows.map((row) => parseStaffImportRow(row, LISTS)));
    expect(checks.sameNameAndBirth.get(3)).toBeUndefined();
    expect(checks.sameNameAndBirth.get(4)).toEqual([3]);
    // Row 5 has a date: row 4 has none and matches by name; row 3 has another date.
    expect(checks.sameNameAndBirth.get(5)).toEqual([4]);
  });

  it('accepts only the system template', async () => {
    await expect(
      readStaffImportWorkbook(
        await filledStaffTemplate([staffRow()], (sheet) => {
          sheet.getRow(1).getCell(2).value = 'name';
        }),
      ),
    ).rejects.toMatchObject({ code: 'import_not_template' });
    await expect(readStaffImportWorkbook(Buffer.from('not a workbook'))).rejects.toMatchObject({
      code: 'import_not_template',
    });
    await expect(readStaffImportWorkbook(await filledStaffTemplate([]))).rejects.toMatchObject({
      code: 'import_empty',
    });
  });
});
