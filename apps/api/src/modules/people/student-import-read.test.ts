import {
  STUDENT_IMPORT_COLUMNS,
  STUDENT_IMPORT_LISTS_SHEET,
  STUDENT_IMPORT_SHEET,
  importHeadingRow,
  type StudentImportRow,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../../http/api-exception.js';
import { filledTemplate, studentRow, type TemplateRow } from '../../testing/student-import-kit.js';
import {
  cellText,
  dottedDateOf,
  fileChecks,
  parseImportRow,
  readImportWorkbook,
} from './student-import-read.js';
import { writeImportTemplate } from './student-import-template.js';

// All names are invented. Task 9.4g; docs/spec/04-people.md, Student record:
// Excel import; docs/spec/edge-cases/students-classes-groups.md: "An import
// file with mixed date formats, phones as 9.989E+11, a class name typed with a
// Cyrillic letter, and the same student twice" and "The same relative phone
// appears in an import file under two names".

const rowsOf = async (rows: readonly TemplateRow[]) =>
  readImportWorkbook(await filledTemplate(rows));

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiException) {
      return error.code;
    }
    throw error;
  }
  return 'no refusal';
};

const one = async (row: TemplateRow) => {
  const [read] = await rowsOf([row]);
  if (read === undefined) {
    throw new Error('One row was read.');
  }
  return parseImportRow(read);
};

const problemsOf = (parsed: { problems: { column: string | null; code: string }[] }) =>
  parsed.problems.map((problem) => `${String(problem.column)}:${problem.code}`);

describe('the template', () => {
  it('holds the keys in a hidden first row, the three-language headings, and drop-downs of the lists', async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load((await writeImportTemplate('ru')) as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(STUDENT_IMPORT_SHEET);
    if (sheet === undefined) {
      throw new Error('The sheet of the template.');
    }
    expect(sheet.getRow(1).hidden).toBe(true);
    expect(
      STUDENT_IMPORT_COLUMNS.map((_, index) => sheet.getRow(1).getCell(index + 1).value),
    ).toEqual([...STUDENT_IMPORT_COLUMNS]);
    const headings = STUDENT_IMPORT_COLUMNS.map(
      (_, index) => sheet.getRow(2).getCell(index + 1).value,
    );
    expect(headings).toEqual(importHeadingRow());
    expect(headings[1]).toBe('Familiya / Фамилия / Surname');
    // No data in the template.
    expect(sheet.getRow(3).cellCount).toBe(0);
    // The sex column offers the values in the language of the file.
    const sexColumn = STUDENT_IMPORT_COLUMNS.indexOf('sex') + 1;
    const validation = sheet.getRow(3).getCell(sexColumn).dataValidation;
    expect(validation.type).toBe('list');
    const lists = workbook.getWorksheet(STUDENT_IMPORT_LISTS_SHEET);
    const values: unknown[] = [];
    lists?.getColumn(1).eachCell((cell) => values.push(cell.value));
    expect(values.slice(1).filter((value) => value !== null)).toEqual(['Мужской', 'Женский']);
  });
});

describe('reading an upload', () => {
  it('refuses a file that is not the template: another sheet name, a moved key, a key added, not a workbook', async () => {
    const row = studentRow('Oxford');
    expect(
      await codeOf(
        readImportWorkbook(
          await filledTemplate([row], (sheet) => {
            sheet.name = 'Pupils';
          }),
        ),
      ),
    ).toBe('import_not_template');
    expect(
      await codeOf(
        readImportWorkbook(
          await filledTemplate([row], (sheet) => {
            sheet.getRow(1).getCell(1).value = 'lastName';
            sheet.getRow(1).getCell(2).value = 'uid';
          }),
        ),
      ),
    ).toBe('import_not_template');
    expect(
      await codeOf(
        readImportWorkbook(
          await filledTemplate([row], (sheet) => {
            sheet.getRow(1).getCell(STUDENT_IMPORT_COLUMNS.length + 1).value = 'extra';
          }),
        ),
      ),
    ).toBe('import_not_template');
    expect(await codeOf(readImportWorkbook(Buffer.from('uid,lastName\n1,Aliyev')))).toBe(
      'import_not_template',
    );
  });

  it('refuses a template without rows and one of more than 1000 rows; skips empty rows', async () => {
    expect(await codeOf(readImportWorkbook(await filledTemplate([])))).toBe('import_empty');
    const many = Array.from({ length: 1001 }, () => ({ uid: 'X' }));
    expect(await codeOf(readImportWorkbook(await filledTemplate(many)))).toBe(
      'import_too_many_rows',
    );
    const rows = await rowsOf([studentRow('Oxford'), {}, studentRow('Oxford')]);
    expect(rows.map((row) => row.rowNumber)).toEqual([3, 5]);
  });

  it('reads a date cell as dd.mm.yyyy, a phone kept as a number (9.989E+11) as its digits, rich text and a link as their text', () => {
    expect(cellText(new Date(Date.UTC(2013, 2, 4)))).toBe('04.03.2013');
    expect(cellText(998901234567)).toBe('998901234567');
    expect(cellText({ richText: [{ text: 'Ali' }, { text: 'yev' }] })).toBe('Aliyev');
    expect(cellText({ text: 'ona@example.com', hyperlink: 'mailto:ona@example.com' })).toBe(
      'ona@example.com',
    );
    expect(cellText({ formula: 'A1', result: 'Oxford' } as ExcelJS.CellValue)).toBe('Oxford');
    expect(cellText('   ')).toBeUndefined();
  });

  it('takes real dates and dd.mm.yyyy only', () => {
    expect(dottedDateOf('2.9.2026')).toBe('2026-09-02');
    expect(dottedDateOf('31.02.2026')).toBeUndefined();
    expect(dottedDateOf('2026-09-02')).toBeUndefined();
    expect(dottedDateOf('09/02/2026')).toBeUndefined();
  });
});

describe('one row', () => {
  it('reads a complete row into the create the hand form sends', async () => {
    const parsed = await one(
      studentRow('Oxford', {
        uid: ' imp 9 ',
        sex: 'Ayol',
        region: 'Город Ташкент',
        scholarshipType: 'merit',
        scholarshipCoverage: 'Partial',
        scholarshipAmount: 1500000,
        consentSignedOn: '20.08.2026',
        phone: '90 111 22 33',
        relative2FullName: 'Akmal Toshmatov',
        relative2Relationship: 'Отец',
        relative2Workplace: 'Zavod',
      }),
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.input).toMatchObject({
      uid: 'imp9',
      sex: 'female',
      grade: 7,
      startsOn: '2026-09-02',
      phone: '+998901112233',
      scholarship: { type: 'merit', coverage: 'partial', amount: 1500000 },
      consentSignedOn: '2026-08-20',
      classId: null,
    });
    expect(parsed.className).toBe('Oxford');
    expect(parsed.relatives.map((relative) => relative.link)).toEqual([
      expect.objectContaining({
        kind: 'new',
        relationship: 'mother',
        mainContact: true,
        portalAccess: true,
        receivesNotices: true,
        relative: expect.objectContaining({ phone: expect.stringMatching(/^\+99893/) }),
      }),
      expect.objectContaining({
        relationship: 'father',
        mainContact: false,
        // No phone of their own, as by hand.
        relative: expect.objectContaining({ phone: null, workplace: 'Zavod' }),
      }),
    ]);
  });

  it('a relative without a phone may be the main contact, as by hand', async () => {
    const parsed = await one(studentRow('Oxford', { relative1Phone: undefined }));
    expect(parsed.problems).toEqual([]);
    expect(parsed.relatives[0]?.link).toMatchObject({
      mainContact: true,
      relative: { phone: null },
    });
  });

  it('names each problem with its column: a row without a relative, wrong dates and lists, a bad phone, empty required cells', async () => {
    const parsed = await one({
      ...studentRow('Oxford'),
      relative1FullName: undefined,
      relative1Relationship: undefined,
      relative1Phone: undefined,
      birthDate: '2013-03-04',
      sex: 'Robot',
      phone: '12',
      uid: undefined,
      contractNumber: undefined,
    });
    expect(parsed.input).toBeNull();
    expect(problemsOf(parsed).sort()).toEqual(
      [
        'relative1FullName:needs_relative',
        'birthDate:date_invalid',
        'sex:value_unknown',
        'phone:phone_invalid',
        'uid:required',
        'contractNumber:required',
      ].sort(),
    );
  });

  it('refuses a relative phone that is not a phone, and a relative without a name or a relationship', async () => {
    const parsed = await one(
      studentRow('Oxford', {
        relative1Phone: 'call the office',
        relative2Phone: '+998901234567',
      }),
    );
    expect(problemsOf(parsed).sort()).toEqual(
      [
        'relative1Phone:phone_invalid',
        'relative2FullName:required',
        'relative2Relationship:required',
      ].sort(),
    );
  });
});

describe('across the rows of the file', () => {
  const parsedOf = async (rows: TemplateRow[]) => (await rowsOf(rows)).map(parseImportRow);

  it('the same UID (another case and spacing), JSHSHIR, document or contract number on two rows: both rows', async () => {
    const first = studentRow('Oxford');
    const rows = [
      first,
      studentRow('Oxford', { uid: ` ${String(first.uid).toLowerCase()}` }),
      studentRow('Oxford', { jshshir: first.jshshir }),
      studentRow('Oxford', { contractNumber: String(first.contractNumber).toLowerCase() }),
      studentRow('Oxford', { documentNumber: first.documentNumber }),
      studentRow('Oxford'),
    ];
    const { problems } = fileChecks(await parsedOf(rows));
    const at = (row: number) =>
      (problems.get(row) ?? []).map((one) => `${String(one.column)}:${(one.rows ?? []).join(',')}`);
    expect(at(3).sort()).toEqual(
      ['contractNumber:6', 'documentNumber:7', 'jshshir:5', 'uid:4'].sort(),
    );
    expect(at(4)).toEqual(['uid:3']);
    expect(at(5)).toEqual(['jshshir:3']);
    expect(at(6)).toEqual(['contractNumber:3']);
    expect(at(7)).toEqual(['documentNumber:3']);
    expect(at(8)).toEqual([]);
  });

  it('the same name and date of birth on two rows is a warning on the later one, not an error (twins pass)', async () => {
    const first = studentRow('Oxford');
    const twin = studentRow('Oxford', {
      lastName: first.lastName,
      firstName: first.firstName,
      birthDate: first.birthDate,
    });
    const checks = fileChecks(await parsedOf([first, twin]));
    expect(checks.problems.size).toBe(0);
    expect([...checks.sameNameAndBirth]).toEqual([[4, [3]]]);
  });

  it('one relative phone under two names: both rows; under one name (siblings): no problem', async () => {
    const phone = 998977777777;
    const rows = [
      studentRow('Oxford', { relative1Phone: phone, relative1FullName: 'Gulnora Rahimova' }),
      studentRow('Oxford', { relative1Phone: phone, relative1FullName: 'Gulnora  RAHIMOVA' }),
      studentRow('Oxford', {
        relative2FullName: 'Botir Rahimov',
        relative2Relationship: 'Father',
        relative2Phone: phone,
      }),
    ];
    const { problems } = fileChecks(await parsedOf(rows));
    expect(problems.get(3)?.map((one) => [one.column, one.code, one.rows])).toEqual([
      ['relative1Phone', 'phone_two_names_in_file', [5]],
    ]);
    expect(problems.get(5)?.map((one) => [one.column, one.rows])).toEqual([
      ['relative2Phone', [3, 4]],
    ]);
    const siblings = fileChecks(await parsedOf(rows.slice(0, 2)));
    expect(siblings.problems.size).toBe(0);
  });
});

describe('the rows kept', () => {
  it('are plain texts per column', async () => {
    const rows: StudentImportRow[] = await rowsOf([studentRow('Oxford')]);
    expect(Object.values(rows[0]?.cells ?? {}).every((value) => typeof value === 'string')).toBe(
      true,
    );
  });
});
