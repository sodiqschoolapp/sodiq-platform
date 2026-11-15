import {
  LANGUAGES,
  LOAD_IMPORT_LISTS_SHEET,
  LOAD_IMPORT_META_COLUMN,
  PATTERN_IMPORT_COLUMNS,
  PATTERN_IMPORT_MAX_ROWS,
  PATTERN_IMPORT_SHEET,
  PATTERN_IMPORT_WEEKDAYS,
  PATTERN_IMPORT_WORDS,
  type PatternImportColumn,
  type PatternImportFile,
  type PatternImportProblem,
  type PatternImportRow,
  type PatternImportWeekday,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { ApiException } from '../../http/api-exception.js';
import { cellText, FIRST_DATA_ROW } from '../people/student-import-read.js';
import type { ImportRecord, ImportUnit, MatchIndexes, RecordIndex } from './load-import-read.js';

/**
 * Reading the system's template of the timetable import (task 5.14; `06`, Importing the load and
 * the timetable): only the system's template (its own row of keys, so the load template of 5.13
 * is not it); every value naming a record matched among the branch's records of the draft with
 * the matching of the load import (`RecordIndex`), never created. Pure: the service hands in the
 * records.
 */

const notTemplate = () => new ApiException('import_not_template', 422);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rows of an upload, with the draft and language the template was made for. */
export async function readPatternImportWorkbook(bytes: Buffer): Promise<PatternImportFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types its own Buffer; a Node Buffer is one.
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw notTemplate();
  }
  const sheet = workbook.getWorksheet(PATTERN_IMPORT_SHEET);
  if (sheet === undefined) {
    throw notTemplate();
  }
  const keys = sheet.getRow(1);
  const marked = PATTERN_IMPORT_COLUMNS.every(
    (column, index) => cellText(keys.getCell(index + 1).value) === column,
  );
  if (!marked || cellText(keys.getCell(PATTERN_IMPORT_COLUMNS.length + 1).value) !== undefined) {
    throw notTemplate();
  }
  const lists = workbook.getWorksheet(LOAD_IMPORT_LISTS_SHEET);
  const versionText = cellText(lists?.getCell(`${LOAD_IMPORT_META_COLUMN}1`).value ?? null);
  const languageText = cellText(lists?.getCell(`${LOAD_IMPORT_META_COLUMN}2`).value ?? null);
  const language = LANGUAGES.find((one) => one === languageText) ?? null;
  const rows: PatternImportRow[] = [];
  for (let number = FIRST_DATA_ROW; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const cells: Partial<Record<PatternImportColumn, string>> = {};
    PATTERN_IMPORT_COLUMNS.forEach((column, index) => {
      const text = cellText(row.getCell(index + 1).value)?.trim();
      if (text !== undefined && text !== '') {
        cells[column] = text;
      }
    });
    if (Object.keys(cells).length > 0) {
      rows.push({ rowNumber: number, cells });
      if (rows.length > PATTERN_IMPORT_MAX_ROWS) {
        throw new ApiException('import_too_many_rows', 422);
      }
    }
  }
  if (rows.length === 0) {
    throw new ApiException('import_empty', 422);
  }
  return {
    versionId:
      versionText !== undefined && UUID.test(versionText) ? versionText.toLowerCase() : null,
    language,
    rows,
  };
}

/** A weekday compared as typed: case, outer and repeated spaces and apostrophes ignored. */
const listKey = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[ʻʼ'`‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

const WEEKDAY_VALUES: ReadonlyMap<string, PatternImportWeekday> = new Map(
  PATTERN_IMPORT_WEEKDAYS.flatMap((weekday) => [
    [String(weekday), weekday] as const,
    ...LANGUAGES.map(
      (language) => [listKey(PATTERN_IMPORT_WORDS[language].weekdays[weekday]), weekday] as const,
    ),
  ]),
);

/** A row as read and matched, before its load row is found. */
export interface ParsedPatternRow {
  readonly rowNumber: number;
  readonly cells: PatternImportRow['cells'];
  readonly problems: PatternImportProblem[];
  readonly weekday: number | null;
  readonly lessonNumber: number | null;
  /** The class or group, when its cell was matched (even out of service). */
  readonly unit: ImportUnit | null;
  readonly subject: ImportRecord | null;
  /** `null` for an empty cell or one not matched (`teacherGiven` tells them apart). */
  readonly teacher: ImportRecord | null;
  readonly teacherGiven: boolean;
  /** `null` for an empty cell or one not matched. */
  readonly room: ImportRecord | null;
}

/** One row read: each cell parsed and each name matched; every problem found is listed. */
export function parsePatternImportRow(
  row: PatternImportRow,
  indexes: MatchIndexes,
): ParsedPatternRow {
  const problems: PatternImportProblem[] = [];
  const cells = row.cells;
  const matched = <T extends ImportRecord>(
    column: PatternImportColumn,
    index: RecordIndex<T>,
    required: boolean,
  ): T | null => {
    const text = cells[column];
    if (text === undefined) {
      if (required) problems.push({ column, code: 'required' });
      return null;
    }
    const found = index.match(text);
    if (typeof found === 'string') {
      problems.push({ column, code: found });
      return null;
    }
    return found;
  };
  let weekday: number | null = null;
  if (cells.weekday === undefined) {
    problems.push({ column: 'weekday', code: 'required' });
  } else {
    weekday = WEEKDAY_VALUES.get(listKey(cells.weekday)) ?? null;
    if (weekday === null) problems.push({ column: 'weekday', code: 'invalid' });
  }
  let lessonNumber: number | null = null;
  const numberText = cells.lessonNumber;
  if (numberText === undefined) {
    problems.push({ column: 'lessonNumber', code: 'required' });
  } else if (/^\d+$/.test(numberText) && Number(numberText) >= 1 && Number(numberText) <= 99) {
    lessonNumber = Number(numberText);
  } else {
    problems.push({ column: 'lessonNumber', code: 'invalid' });
  }
  const unit = matched('unit', indexes.units, true);
  const subject = matched('subject', indexes.subjects, true);
  const teacher = matched('teacher', indexes.teachers, false);
  const room = matched('room', indexes.rooms, false);
  if (unit !== null && !unit.live) {
    problems.push({ column: 'unit', code: 'pattern_import_out_of_service' });
  }
  return {
    rowNumber: row.rowNumber,
    cells,
    problems,
    weekday,
    lessonNumber,
    unit,
    subject,
    teacher,
    teacherGiven: cells.teacher !== undefined,
    room,
  };
}

/**
 * The repeats inside a file: rows of one class or group and subject at one weekday and lesson
 * number, each told `pattern_import_row_twice` with the others.
 */
export function patternFileRepeats(
  rows: readonly ParsedPatternRow[],
): Map<number, PatternImportProblem> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    if (
      row.unit === null ||
      row.subject === null ||
      row.weekday === null ||
      row.lessonNumber === null
    ) {
      continue;
    }
    const key = `${row.unit.id}|${row.subject.id}|${String(row.weekday)}|${String(row.lessonNumber)}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row.rowNumber]);
  }
  const found = new Map<number, PatternImportProblem>();
  for (const numbers of byKey.values()) {
    if (numbers.length < 2) continue;
    for (const number of numbers) {
      found.set(number, {
        column: 'unit',
        code: 'pattern_import_row_twice',
        rows: numbers.filter((other) => other !== number),
      });
    }
  }
  return found;
}
