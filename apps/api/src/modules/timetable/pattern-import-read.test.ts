import {
  LOAD_IMPORT_LISTS_SHEET,
  PATTERN_IMPORT_COLUMNS,
  PATTERN_IMPORT_MAX_ROWS,
  PATTERN_IMPORT_SHEET,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../../http/api-exception.js';
import { filledPatternTemplate } from '../../testing/pattern-import-kit.js';
import { indexesOf } from './load-import-read.js';
import { writeLoadImportTemplate } from './load-import-template.js';
import {
  parsePatternImportRow,
  patternFileRepeats,
  readPatternImportWorkbook,
} from './pattern-import-read.js';
import { writePatternImportTemplate } from './pattern-import-template.js';

const VERSION = '0199a000-0000-7000-8000-000000000514';

const lists = {
  units: ['7 Oxford', '7-E-1'],
  groupClasses: [['7-E-1', '7 Oxford, 7 Princeton']] as const,
  subjects: ['Algebra Plum'],
  teachers: ['Karimova Dilnoza (S-000101)'],
  rooms: ['Room 12'],
};

const codeOf = async (work: Promise<unknown>): Promise<string> => {
  try {
    await work;
  } catch (error) {
    if (error instanceof ApiException) return error.code;
  }
  return 'none';
};

const records = indexesOf({
  units: [
    { id: 'c1', kind: 'class', labels: ['7 Oxford'], live: true },
    { id: 'c0', kind: 'class', labels: ['7 Gone'], live: false },
    { id: 'g1', kind: 'group', labels: ['7-E-1'], live: true },
  ],
  subjects: [{ id: 's1', labels: ['Algebra Plum'], live: true }],
  teachers: [{ id: 't1', labels: ['Karimova Dilnoza (S-000101)'], live: true }],
  rooms: [{ id: 'r1', labels: ['Room 12'], live: true }],
});

const parse = (cells: Record<string, string>) =>
  parsePatternImportRow({ rowNumber: 3, cells }, records);

// All names are invented. Task 5.14: the timetable template and its reading (`06`, Importing the
// load and the timetable: the template, its headings in three languages, chosen never created).
describe('the timetable import template and its reader', () => {
  it('writes the keys, the headings in three languages, the weekdays and the hidden draft id', async () => {
    const bytes = await writePatternImportTemplate('ru', VERSION, lists);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(PATTERN_IMPORT_SHEET);
    expect(sheet?.getRow(1).hidden).toBe(true);
    expect(sheet?.getCell(1, 1).value).toBe(PATTERN_IMPORT_COLUMNS[0]);
    expect(sheet?.getCell(2, 1).value).toBe('Hafta kuni / День недели / Weekday');
    const listSheet = workbook.getWorksheet(LOAD_IMPORT_LISTS_SHEET);
    expect(listSheet?.getCell('A1').value).toBe('Дни недели');
    expect(listSheet?.getCell('A2').value).toBe('Понедельник');
    expect(listSheet?.getCell('Z1').value).toBe(VERSION);
    expect(listSheet?.getCell('Z2').value).toBe('ru');
    const read = await readPatternImportWorkbook(
      await filledPatternTemplate(bytes, [{ weekday: 'Понедельник', lessonNumber: '1' }]),
    );
    expect(read).toEqual({
      versionId: VERSION,
      language: 'ru',
      rows: [{ rowNumber: 3, cells: { weekday: 'Понедельник', lessonNumber: '1' } }],
    });
  });

  it('refuses a file that is not this template: not a workbook, the load template, no rows, too many', async () => {
    expect(await codeOf(readPatternImportWorkbook(Buffer.from('text')))).toBe(
      'import_not_template',
    );
    const loadTemplate = await writeLoadImportTemplate('en', VERSION, lists);
    expect(await codeOf(readPatternImportWorkbook(loadTemplate))).toBe('import_not_template');
    const empty = await writePatternImportTemplate('en', VERSION, lists);
    expect(await codeOf(readPatternImportWorkbook(empty))).toBe('import_empty');
    const many = await filledPatternTemplate(
      empty,
      Array.from({ length: PATTERN_IMPORT_MAX_ROWS + 1 }, () => ({ weekday: 'Monday' })),
    );
    expect(await codeOf(readPatternImportWorkbook(many))).toBe('import_too_many_rows');
  });

  it('reads a weekday by its name in any of the three languages, or as a number', () => {
    for (const text of ['Wednesday', 'chorshanba', 'СРЕДА', '3']) {
      expect(parse({ weekday: text }).weekday).toBe(3);
    }
    expect(parse({ weekday: 'Funday' }).problems).toContainEqual({
      column: 'weekday',
      code: 'invalid',
    });
  });

  it('reads a lesson number as a whole number from 1', () => {
    expect(parse({ lessonNumber: '2' }).lessonNumber).toBe(2);
    for (const text of ['0', '2.5', 'two']) {
      expect(parse({ lessonNumber: text }).problems).toContainEqual({
        column: 'lessonNumber',
        code: 'invalid',
      });
    }
  });

  it('matches the records, tells an unknown one and an archived class', () => {
    const row = parse({
      weekday: 'Monday',
      lessonNumber: '1',
      unit: '7 OXFORD',
      subject: 'Algebra Plum',
      teacher: 'Karimova Dilnoza (S-000101)',
      room: 'Room 12',
    });
    expect(row.problems).toEqual([]);
    expect([row.unit?.id, row.subject?.id, row.teacher?.id, row.room?.id]).toEqual([
      'c1',
      's1',
      't1',
      'r1',
    ]);
    expect(
      parse({ weekday: 'Monday', lessonNumber: '1', unit: '7 Gone', subject: 'Nothing' }).problems,
    ).toEqual([
      { column: 'subject', code: 'load_import_unknown' },
      { column: 'unit', code: 'pattern_import_out_of_service' },
    ]);
  });

  it('tells the same lesson twice in the file on both rows', () => {
    const cells = { weekday: 'Monday', lessonNumber: '1', unit: '7-E-1', subject: 'Algebra Plum' };
    const repeats = patternFileRepeats([
      parsePatternImportRow({ rowNumber: 3, cells }, records),
      parsePatternImportRow({ rowNumber: 4, cells: { ...cells, lessonNumber: '2' } }, records),
      parsePatternImportRow({ rowNumber: 5, cells }, records),
    ]);
    expect([...repeats.entries()]).toEqual([
      [3, { column: 'unit', code: 'pattern_import_row_twice', rows: [5] }],
      [5, { column: 'unit', code: 'pattern_import_row_twice', rows: [3] }],
    ]);
  });
});
