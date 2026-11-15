import { LOAD_IMPORT_COLUMNS, LOAD_IMPORT_LISTS_SHEET, LOAD_IMPORT_SHEET } from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { ApiException } from '../../http/api-exception.js';
import { filledLoadTemplate } from '../../testing/load-import-kit.js';
import {
  RecordIndex,
  indexesOf,
  loadFileRepeats,
  parseLoadImportRow,
  readLoadImportWorkbook,
} from './load-import-read.js';
import { writeLoadImportTemplate } from './load-import-template.js';

const VERSION = '0199a000-0000-7000-8000-000000000501';

const lists = {
  units: ['7 Oxford', '7-E-1'],
  groupClasses: [['7-E-1', '7 Oxford, 7 Princeton']] as const,
  subjects: ['Algebra Lime'],
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
    { id: 'g1', kind: 'group', labels: ['7-E-1'], live: true },
  ],
  subjects: [
    { id: 's1', labels: ['Algebra Lime'], live: true },
    { id: 's0', labels: ['Algebra Lime'], live: false },
  ],
  teachers: [{ id: 't1', labels: ['Karimova Dilnoza (S-000101)'], live: true }],
  rooms: [{ id: 'r1', labels: ['Room 12'], live: true }],
});

// All names are invented. Task 5.13: the template and its reading (`06`, Importing the load and
// the timetable: the template, its headings in three languages, chosen never created).
describe('the load import template and its reader', () => {
  it('writes the keys, the headings in three languages and the hidden draft id and language', async () => {
    const bytes = await writeLoadImportTemplate('ru', VERSION, lists);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    const sheet = workbook.getWorksheet(LOAD_IMPORT_SHEET);
    expect(sheet?.getRow(1).hidden).toBe(true);
    expect(sheet?.getCell(1, 1).value).toBe(LOAD_IMPORT_COLUMNS[0]);
    expect(sheet?.getCell(2, 1).value).toBe('Sinf yoki guruh / Класс или группа / Class or group');
    const listSheet = workbook.getWorksheet(LOAD_IMPORT_LISTS_SHEET);
    expect(listSheet?.getCell('A1').value).toBe('Классы и группы');
    expect(listSheet?.getColumn('Z').hidden).toBe(true);
    const read = await readLoadImportWorkbook(
      await filledLoadTemplate(bytes, [{ unit: '7 Oxford', lessonsPerWeek: '3' }]),
    );
    expect(read.versionId).toBe(VERSION);
    expect(read.language).toBe('ru');
    expect(read.rows).toEqual([{ rowNumber: 3, cells: { unit: '7 Oxford', lessonsPerWeek: '3' } }]);
  });

  it('refuses a workbook that is not the template, an empty one and one too long', async () => {
    expect(await codeOf(readLoadImportWorkbook(Buffer.from('no')))).toBe('import_not_template');
    const other = new ExcelJS.Workbook();
    other.addWorksheet(LOAD_IMPORT_SHEET).addRow(['unit', 'subject']);
    expect(await codeOf(readLoadImportWorkbook(Buffer.from(await other.xlsx.writeBuffer())))).toBe(
      'import_not_template',
    );
    const bytes = await writeLoadImportTemplate('en', VERSION, lists);
    expect(await codeOf(readLoadImportWorkbook(bytes))).toBe('import_empty');
    const long = await filledLoadTemplate(
      bytes,
      Array.from({ length: 1001 }, () => ({ unit: '7 Oxford' })),
    );
    expect(await codeOf(readLoadImportWorkbook(long))).toBe('import_too_many_rows');
  });

  it('matches live records first: an archived namesake is not ambiguous', () => {
    const index = new RecordIndex([
      { id: 'a', labels: ['Algebra Lime'], live: false },
      { id: 'b', labels: ['Algebra Lime'], live: true },
    ]);
    expect(index.match('algebra  lime')).toMatchObject({ id: 'b' });
    const twins = new RecordIndex([
      { id: 'a', labels: ['Wanted'], live: true },
      { id: 'b', labels: ['Wanted'], live: true },
    ]);
    expect(twins.match('Wanted')).toBe('name_ambiguous');
    expect(twins.match('Nobody')).toBe('load_import_unknown');
    const out = new RecordIndex([{ id: 'a', labels: ['Gone'], live: false }]);
    expect(out.match('Gone')).toMatchObject({ id: 'a' });
  });

  it('reads every cell, the lists in any language, and lists every problem of a row', () => {
    const parsed = parseLoadImportRow(
      {
        rowNumber: 3,
        cells: {
          unit: '7 Oxford',
          subject: 'Algebra Lime',
          teacher: 'Karimova Dilnoza (S-000101)',
          lessonsPerWeek: '4',
          roomType: 'Лаборатория',
          doubleLessons: 'Ha',
          shortReason: 'Exam week',
        },
      },
      records,
    );
    expect(parsed.problems).toEqual([]);
    expect(parsed.record).toEqual({
      unitKind: 'class',
      unitId: 'c1',
      subjectId: 's1',
      teacherId: 't1',
      lessonsPerWeek: 4,
      roomId: null,
      roomType: 'laboratory',
      doubleLessons: true,
      mixedBlock: false,
      shortReason: 'Exam week',
    });
    const bad = parseLoadImportRow(
      {
        rowNumber: 4,
        cells: {
          subject: 'Nothing',
          lessonsPerWeek: '0',
          room: 'Room 12',
          roomType: 'Hall',
          mixedBlock: '?',
        },
      },
      records,
    );
    expect(bad.problems).toEqual([
      { column: 'unit', code: 'required' },
      { column: 'subject', code: 'load_import_unknown' },
      { column: 'lessonsPerWeek', code: 'invalid' },
      { column: 'room', code: 'load_import_room_and_type' },
      { column: 'mixedBlock', code: 'invalid' },
    ]);
    expect(bad.record).toBeNull();
  });

  it('tells rows of one class and subject, or one group, repeated in the file', () => {
    const row = (rowNumber: number, unit: string) =>
      parseLoadImportRow(
        {
          rowNumber,
          cells: {
            unit,
            subject: 'Algebra Lime',
            teacher: 'Karimova Dilnoza (S-000101)',
            lessonsPerWeek: '2',
          },
        },
        records,
      );
    const repeats = loadFileRepeats([row(3, '7 Oxford'), row(4, '7-E-1'), row(5, '7 oxford')]);
    expect(repeats.get(3)).toEqual({ column: 'unit', code: 'load_import_row_twice', rows: [5] });
    expect(repeats.get(5)?.rows).toEqual([3]);
    expect(repeats.has(4)).toBe(false);
  });
});
