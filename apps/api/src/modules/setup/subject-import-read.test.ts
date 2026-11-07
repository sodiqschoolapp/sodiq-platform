import { describe, expect, it } from 'vitest';
import {
  filledSubjectTemplate,
  subjectRow,
  type SubjectTemplateRow,
} from '../../testing/subject-import-kit.js';
import {
  parseSubjectImportRow,
  readSubjectImportWorkbook,
  subjectFileChecks,
  type ImportDepartment,
} from './subject-import-read.js';

// All names are invented. The owner's change of 7 November 2026 (pull request
// #316): reading the system's subject template (`05`, "Excel import of
// subjects"; the hand form's rules, `05`, Subject and "Grading weights on a
// subject").
const STEAM = '01960000-0000-7000-8000-000000000011';
const NATURAL = '01960000-0000-7000-8000-000000000012';
const FINANCE = '01960000-0000-7000-8000-000000000013';
const LANGUAGES_ONE = '01960000-0000-7000-8000-000000000014';
const LANGUAGES_TWO = '01960000-0000-7000-8000-000000000015';

const DEPARTMENTS: ImportDepartment[] = [
  { id: STEAM, names: ['STEAM', 'STEAM', 'STEAM'], academic: true },
  {
    id: NATURAL,
    names: ['Tabiiy fanlar', 'Естественные науки', 'Natural sciences'],
    academic: true,
  },
  { id: FINANCE, names: ['Moliya', 'Финансы', 'Finance'], academic: false },
  // Two departments of Academic that share their Russian name.
  { id: LANGUAGES_ONE, names: ['Tillar 1', 'Языки', 'Languages 1'], academic: true },
  { id: LANGUAGES_TWO, names: ['Tillar 2', 'Языки', 'Languages 2'], academic: true },
];

async function readRows(rows: readonly SubjectTemplateRow[]) {
  return readSubjectImportWorkbook(await filledSubjectTemplate(rows));
}

async function parsed(overrides: SubjectTemplateRow = {}) {
  const [row] = await readRows([subjectRow(overrides)]);
  if (row === undefined) {
    throw new Error('One row read.');
  }
  return parseSubjectImportRow(row, DEPARTMENTS);
}

const codes = (row: { problems: { column: string | null; code: string }[] }) =>
  row.problems.map((one) => `${String(one.column)}:${one.code}`);

describe('reading the subject template', () => {
  it('reads a complete graded row into the record the hand form sends and the quarterly distribution', async () => {
    const row = await parsed({
      nameUz: 'Algebra',
      nameRu: 'Алгебра',
      nameEn: 'Algebra',
      grades: '5, 6, 8-9',
      colour: 'teal',
      demanding: 'Yes',
    });
    expect(row.problems).toEqual([]);
    expect(row.record).toEqual({
      names: { uz: 'Algebra', ru: 'Алгебра', en: 'Algebra' },
      departmentId: STEAM,
      grades: [5, 6, 8, 9],
      colour: 'teal',
      journalType: 'graded',
      ratingExam: true,
      groupSubject: false,
      languageRule: true,
      demanding: true,
      daily: { attendance: 10, classwork: 50, homework: 40 },
    });
    expect(row.quarterly).toEqual({
      attendance: 10,
      classwork: 30,
      homework: 20,
      ratingExam: 40,
    });
  });

  it('takes the lists in any of the three languages or as codes, and the department by any of its names', async () => {
    const russian = await parsed({
      department: 'естественные НАУКИ',
      colour: 'Сине-зелёный',
      journalType: 'С оценками',
      ratingExam: 'Да',
      groupSubject: 'Да',
      languageRule: 'Нет',
      demanding: 'Нет',
    });
    expect(russian.problems).toEqual([]);
    expect(russian.record).toMatchObject({
      departmentId: NATURAL,
      colour: 'teal',
      journalType: 'graded',
      ratingExam: true,
      groupSubject: true,
      languageRule: false,
      demanding: false,
    });
    const uzbek = await parsed({
      department: 'Tabiiy fanlar',
      colour: 'Koʻk',
      journalType: 'Baholanadi',
      ratingExam: 'Yoʻq',
      quarterRatingExam: '',
      quarterClasswork: 50,
      quarterHomework: 40,
      languageRule: 'ha',
    });
    expect(uzbek.problems).toEqual([]);
    expect(uzbek.record).toMatchObject({ colour: 'blue', ratingExam: false, languageRule: true });
    expect(uzbek.quarterly).toEqual({
      attendance: 10,
      classwork: 50,
      homework: 40,
      ratingExam: null,
    });
    const codes = await parsed({ colour: 'brown', journalType: 'graded', ratingExam: 'yes' });
    expect(codes.record).toMatchObject({ colour: 'brown', journalType: 'graded' });
  });

  it('gives an empty switch the default of the hand form: the language rule on, the others off', async () => {
    const row = await parsed({
      ratingExam: '',
      groupSubject: '',
      languageRule: '',
      demanding: '',
      quarterRatingExam: '',
      quarterClasswork: 50,
      quarterHomework: 40,
    });
    expect(row.problems).toEqual([]);
    expect(row.record).toMatchObject({
      ratingExam: false,
      groupSubject: false,
      languageRule: true,
      demanding: false,
    });
  });

  it('asks for every name, the department, the grades and the colour', async () => {
    const row = await parsed({
      nameUz: '',
      nameRu: '',
      nameEn: '',
      department: '',
      grades: '',
      colour: '',
    });
    expect(codes(row)).toEqual([
      'nameUz:required',
      'nameRu:required',
      'nameEn:required',
      'department:required',
      'grades:required',
      'colour:required',
    ]);
    expect(row.record).toBeNull();
  });

  it('refuses a name longer than the hand form takes', async () => {
    expect(codes(await parsed({ nameEn: 'x'.repeat(101) }))).toEqual(['nameEn:invalid']);
  });

  it('tells an unknown department, a name two departments share, and one outside Academic', async () => {
    expect(codes(await parsed({ department: 'Robotics' }))).toEqual(['department:name_unknown']);
    expect(codes(await parsed({ department: 'Языки' }))).toEqual(['department:name_ambiguous']);
    // Another name of one of them finds it.
    expect((await parsed({ department: 'Languages 2' })).record?.departmentId).toBe(LANGUAGES_TWO);
    expect(codes(await parsed({ department: 'Finance' }))).toEqual([
      'department:department_not_academic',
    ]);
  });

  it('reads the grades as ranges and lists, and refuses unreadable ones', async () => {
    expect((await parsed({ grades: '0-2, 11' })).record?.grades).toEqual([0, 1, 2, 11]);
    for (const grades of ['5 to 7', '7-5', '12', 'five']) {
      expect(codes(await parsed({ grades })), grades).toEqual(['grades:grades_invalid']);
    }
  });

  it('refuses a value of no list in the colour, journal type and switch columns', async () => {
    expect(codes(await parsed({ colour: 'Gold' }))).toEqual(['colour:value_unknown']);
    expect(codes(await parsed({ journalType: 'Marks' }))).toEqual(['journalType:value_unknown']);
    for (const column of ['ratingExam', 'groupSubject', 'languageRule', 'demanding'] as const) {
      expect(codes(await parsed({ [column]: 'Maybe' })), column).toEqual([
        `${column}:value_unknown`,
      ]);
    }
  });

  it('asks a graded row for its daily and quarterly cells', async () => {
    const row = await parsed({
      dailyAttendance: '',
      dailyClasswork: '',
      dailyHomework: '',
      quarterAttendance: '',
      quarterClasswork: '',
      quarterHomework: '',
    });
    expect(codes(row)).toEqual([
      'dailyAttendance:required',
      'dailyClasswork:required',
      'dailyHomework:required',
      'quarterAttendance:required',
      'quarterClasswork:required',
      'quarterHomework:required',
    ]);
  });

  it('asks for the quarterly rating exam cell exactly when the rating exam switch is on', async () => {
    // Switch on, cell empty: required.
    expect(codes(await parsed({ ratingExam: 'Yes', quarterRatingExam: '' }))).toEqual([
      'quarterRatingExam:required',
    ]);
    // Switch off, cell filled: refused.
    expect(
      codes(await parsed({ ratingExam: 'No', quarterClasswork: 30, quarterRatingExam: 40 })),
    ).toEqual(['quarterRatingExam:rating_exam_weight_unwanted']);
    // Each way right: read.
    expect((await parsed({ ratingExam: 'Yes' })).quarterly?.ratingExam).toBe(40);
    expect(
      (await parsed({ ratingExam: 'No', quarterRatingExam: '', quarterClasswork: 70 })).quarterly,
    ).toEqual({ attendance: 10, classwork: 70, homework: 20, ratingExam: null });
  });

  it('refuses a part that is no whole number from 1 to 100, and a distribution that does not total 100', async () => {
    expect(codes(await parsed({ dailyClasswork: 'fifty' }))).toEqual([
      'dailyClasswork:weight_invalid',
    ]);
    expect(codes(await parsed({ quarterHomework: 12.5 }))).toEqual([
      'quarterHomework:weight_invalid',
    ]);
    // A part of 0 is refused as by hand (decision 8 of task 2.1), even when the total is 100.
    expect(codes(await parsed({ dailyAttendance: 0, dailyClasswork: 60 }))).toEqual([
      'dailyAttendance:weight_invalid',
    ]);
    // A part over 100 is told on its own column.
    expect(codes(await parsed({ quarterClasswork: 101 }))).toEqual([
      'quarterClasswork:weight_invalid',
    ]);
    expect(codes(await parsed({ dailyHomework: 41 }))).toEqual(['dailyAttendance:weights_total']);
    expect(codes(await parsed({ quarterRatingExam: 39 }))).toEqual([
      'quarterAttendance:weights_total',
    ]);
  });

  it('takes an attendance-only row without weights, and refuses one with weights or the rating exam', async () => {
    const clean = await parsed({
      journalType: 'Attendance only',
      ratingExam: 'No',
      dailyAttendance: '',
      dailyClasswork: '',
      dailyHomework: '',
      quarterAttendance: '',
      quarterClasswork: '',
      quarterHomework: '',
      quarterRatingExam: '',
    });
    expect(clean.problems).toEqual([]);
    expect(clean.record).toMatchObject({
      journalType: 'attendance_only',
      ratingExam: false,
      daily: null,
    });
    expect(clean.quarterly).toBeNull();
    const weighted = await parsed({
      journalType: 'Attendance only',
      ratingExam: 'No',
      dailyClasswork: '',
      dailyHomework: '',
      quarterAttendance: '',
      quarterClasswork: '',
      quarterHomework: '',
      quarterRatingExam: '',
    });
    expect(codes(weighted)).toEqual(['dailyAttendance:weights_attendance_only']);
    const rated = await parsed({
      journalType: 'Attendance only',
      ratingExam: 'Yes',
      dailyAttendance: '',
      dailyClasswork: '',
      dailyHomework: '',
      quarterAttendance: '',
      quarterClasswork: '',
      quarterHomework: '',
      quarterRatingExam: '',
    });
    expect(codes(rated)).toEqual(['ratingExam:rating_exam_attendance_only']);
  });

  it('tells a name that another row has in the same language, on both rows, and not the same word in two languages', async () => {
    const rows = await readRows([
      subjectRow({ nameEn: 'Chess', nameUz: 'Shaxmat' }),
      subjectRow({ nameEn: ' chess ', nameRu: 'Шахматы' }),
      // "Shaxmat" here is an English name; the first row has it in Uzbek.
      subjectRow({ nameEn: 'Shaxmat' }),
    ]);
    const problems = subjectFileChecks(rows);
    expect(problems.get(3)).toEqual([{ column: 'nameEn', code: 'duplicate_in_file', rows: [4] }]);
    expect(problems.get(4)).toEqual([{ column: 'nameEn', code: 'duplicate_in_file', rows: [3] }]);
    expect(problems.get(5)).toBeUndefined();
  });

  it('reads only the system template', async () => {
    const changed = await filledSubjectTemplate([subjectRow()], (sheet) => {
      sheet.getRow(1).getCell(2).value = 'nameXx';
    });
    await expect(readSubjectImportWorkbook(changed)).rejects.toMatchObject({
      code: 'import_not_template',
    });
    await expect(readSubjectImportWorkbook(Buffer.from('not a workbook'))).rejects.toMatchObject({
      code: 'import_not_template',
    });
    await expect(readSubjectImportWorkbook(await filledSubjectTemplate([]))).rejects.toMatchObject({
      code: 'import_empty',
    });
  });
});
