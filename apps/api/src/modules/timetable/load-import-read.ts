import {
  LANGUAGES,
  LOAD_IMPORT_ANSWERS,
  LOAD_IMPORT_COLUMNS,
  LOAD_IMPORT_LISTS_SHEET,
  LOAD_IMPORT_MAX_ROWS,
  LOAD_IMPORT_META_COLUMN,
  LOAD_IMPORT_ROOM_TYPES,
  LOAD_IMPORT_SHEET,
  LOAD_IMPORT_WORDS,
  LOAD_LESSONS_MAX,
  SHORT_REASON_MAX,
  staffImportNameKey,
  type Language,
  type LoadImportAnswer,
  type LoadImportColumn,
  type LoadImportFile,
  type LoadImportProblem,
  type LoadImportRow,
  type RoomType,
} from '@sodiq/shared';
import ExcelJS from 'exceljs';
import { ApiException } from '../../http/api-exception.js';
import { cellText, FIRST_DATA_ROW } from '../people/student-import-read.js';

/**
 * Reading the system's template of the load import (task 5.13; `06`, Importing the load and the
 * timetable), in the way of the subject import: only the system's template; every value naming a
 * record matched among the branch's records of the draft, never created; the fixed lists in any
 * of the three languages or as codes. Pure: the service hands in the records.
 */

const notTemplate = () => new ApiException('import_not_template', 422);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The rows of an upload, with the draft and language the template was made for. */
export async function readLoadImportWorkbook(bytes: Buffer): Promise<LoadImportFile> {
  const workbook = new ExcelJS.Workbook();
  try {
    // ExcelJS types its own Buffer; a Node Buffer is one.
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  } catch {
    throw notTemplate();
  }
  const sheet = workbook.getWorksheet(LOAD_IMPORT_SHEET);
  if (sheet === undefined) {
    throw notTemplate();
  }
  const keys = sheet.getRow(1);
  const marked = LOAD_IMPORT_COLUMNS.every(
    (column, index) => cellText(keys.getCell(index + 1).value) === column,
  );
  if (!marked || cellText(keys.getCell(LOAD_IMPORT_COLUMNS.length + 1).value) !== undefined) {
    throw notTemplate();
  }
  const lists = workbook.getWorksheet(LOAD_IMPORT_LISTS_SHEET);
  const versionText = cellText(lists?.getCell(`${LOAD_IMPORT_META_COLUMN}1`).value ?? null);
  const languageText = cellText(lists?.getCell(`${LOAD_IMPORT_META_COLUMN}2`).value ?? null);
  const language = LANGUAGES.find((one) => one === languageText) ?? null;
  const rows: LoadImportRow[] = [];
  for (let number = FIRST_DATA_ROW; number <= sheet.rowCount; number += 1) {
    const row = sheet.getRow(number);
    const cells: Partial<Record<LoadImportColumn, string>> = {};
    LOAD_IMPORT_COLUMNS.forEach((column, index) => {
      const text = cellText(row.getCell(index + 1).value)?.trim();
      if (text !== undefined && text !== '') {
        cells[column] = text;
      }
    });
    if (Object.keys(cells).length > 0) {
      rows.push({ rowNumber: number, cells });
      if (rows.length > LOAD_IMPORT_MAX_ROWS) {
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

/** A value of a fixed list compared as typed: case, outer and repeated spaces and apostrophes ignored. */
const listKey = (text: string): string =>
  text
    .normalize('NFKC')
    .toLocaleLowerCase('en')
    .replace(/[ʻʼ'`‘’]/g, '')
    .replace(/[\s_]+/g, ' ')
    .trim();

function listOf<T extends string>(
  codes: readonly T[],
  words: (language: Language) => Record<T, string>,
): ReadonlyMap<string, T> {
  const found = new Map<string, T>();
  for (const code of codes) {
    found.set(listKey(code), code);
    for (const language of LANGUAGES) {
      found.set(listKey(words(language)[code]), code);
    }
  }
  return found;
}

const ROOM_TYPE_VALUES = listOf(
  LOAD_IMPORT_ROOM_TYPES,
  (language) => LOAD_IMPORT_WORDS[language].roomTypes,
);
const ANSWER_VALUES = listOf(
  LOAD_IMPORT_ANSWERS,
  (language) => LOAD_IMPORT_WORDS[language].answers,
);

/** A record a column may name: its label (or labels) and whether it is in service on `statusOn`. */
export interface ImportRecord {
  readonly id: string;
  readonly labels: readonly string[];
  readonly live: boolean;
}

export interface ImportUnit extends ImportRecord {
  readonly kind: 'class' | 'group';
}

/** The branch's records of the draft a file is matched against. */
export interface ImportRecords {
  readonly units: readonly ImportUnit[];
  readonly subjects: readonly ImportRecord[];
  readonly teachers: readonly ImportRecord[];
  readonly rooms: readonly ImportRecord[];
}

/** The key of a name: case, spaces and look-alike Cyrillic and Latin letters folded (`staffImportNameKey`). */
export const nameKey = (text: string): string => staffImportNameKey(text);

/** An index of records by the keys of their labels. */
export class RecordIndex<T extends ImportRecord> {
  private readonly byKey = new Map<string, T[]>();

  constructor(records: readonly T[]) {
    for (const record of records) {
      for (const key of new Set(record.labels.map(nameKey))) {
        const held = this.byKey.get(key) ?? [];
        held.push(record);
        this.byKey.set(key, held);
      }
    }
  }

  /**
   * The record a cell names: records in service first, so an archived namesake never makes a live
   * record ambiguous (review finding 11); the one out-of-service match otherwise, whose hand reason
   * the engine gives; `name_ambiguous` for two, `load_import_unknown` for none.
   */
  match(text: string): T | 'load_import_unknown' | 'name_ambiguous' {
    const found = this.byKey.get(nameKey(text)) ?? [];
    const live = found.filter((record) => record.live);
    const pool = live.length > 0 ? live : found;
    const [first] = pool;
    if (first === undefined) {
      return 'load_import_unknown';
    }
    return pool.length === 1 ? first : 'name_ambiguous';
  }
}

/** A row as read and matched, before the rules of a load row are checked. */
export interface ParsedLoadRow {
  readonly rowNumber: number;
  readonly cells: LoadImportRow['cells'];
  readonly problems: LoadImportProblem[];
  /** Set when every cell was read and matched. */
  readonly record: {
    readonly unitKind: 'class' | 'group';
    readonly unitId: string;
    readonly subjectId: string;
    /** `null` when the cell is empty (a Tutor row, or `load_teacher_needed`). */
    readonly teacherId: string | null;
    readonly lessonsPerWeek: number;
    readonly roomId: string | null;
    readonly roomType: RoomType | null;
    readonly doubleLessons: boolean;
    readonly mixedBlock: boolean;
    readonly shortReason: string | null;
  } | null;
}

export interface MatchIndexes {
  readonly units: RecordIndex<ImportUnit>;
  readonly subjects: RecordIndex<ImportRecord>;
  readonly teachers: RecordIndex<ImportRecord>;
  readonly rooms: RecordIndex<ImportRecord>;
}

export const indexesOf = (records: ImportRecords): MatchIndexes => ({
  units: new RecordIndex(records.units),
  subjects: new RecordIndex(records.subjects),
  teachers: new RecordIndex(records.teachers),
  rooms: new RecordIndex(records.rooms),
});

/** One row read: each cell parsed and each name matched; every problem found is listed. */
export function parseLoadImportRow(row: LoadImportRow, indexes: MatchIndexes): ParsedLoadRow {
  const problems: LoadImportProblem[] = [];
  const cells = row.cells;
  const problem = (column: LoadImportColumn, code: string) => {
    problems.push({ column, code });
  };
  const matched = <T extends ImportRecord>(
    column: LoadImportColumn,
    index: RecordIndex<T>,
    required: boolean,
  ): T | null | undefined => {
    const text = cells[column];
    if (text === undefined) {
      if (required) problem(column, 'required');
      return required ? undefined : null;
    }
    const found = index.match(text);
    if (typeof found === 'string') {
      problem(column, found);
      return undefined;
    }
    return found;
  };
  const unit = matched('unit', indexes.units, true);
  const subject = matched('subject', indexes.subjects, true);
  const teacher = matched('teacher', indexes.teachers, false);
  const room = matched('room', indexes.rooms, false);
  let lessonsPerWeek: number | undefined;
  const lessonsText = cells.lessonsPerWeek;
  if (lessonsText === undefined) {
    problem('lessonsPerWeek', 'required');
  } else if (
    /^\d+$/.test(lessonsText) &&
    Number(lessonsText) >= 1 &&
    Number(lessonsText) <= LOAD_LESSONS_MAX
  ) {
    lessonsPerWeek = Number(lessonsText);
  } else {
    problem('lessonsPerWeek', 'invalid');
  }
  let roomType: RoomType | null | undefined = null;
  if (cells.roomType !== undefined) {
    roomType = ROOM_TYPE_VALUES.get(listKey(cells.roomType));
    if (roomType === undefined) problem('roomType', 'invalid');
  }
  if (cells.room !== undefined && cells.roomType !== undefined) {
    problem('room', 'load_import_room_and_type');
  }
  const answer = (column: 'doubleLessons' | 'mixedBlock'): boolean | undefined => {
    const text = cells[column];
    if (text === undefined) return false;
    const found: LoadImportAnswer | undefined = ANSWER_VALUES.get(listKey(text));
    if (found === undefined) {
      problem(column, 'invalid');
      return undefined;
    }
    return found === 'yes';
  };
  const doubleLessons = answer('doubleLessons');
  const mixedBlock = answer('mixedBlock');
  const shortReason = cells.shortReason ?? null;
  if (shortReason !== null && shortReason.length > SHORT_REASON_MAX) {
    problem('shortReason', 'invalid');
  }
  const record =
    problems.length === 0 &&
    unit !== undefined &&
    unit !== null &&
    subject !== undefined &&
    subject !== null &&
    teacher !== undefined &&
    room !== undefined &&
    lessonsPerWeek !== undefined &&
    roomType !== undefined &&
    doubleLessons !== undefined &&
    mixedBlock !== undefined
      ? {
          unitKind: unit.kind,
          unitId: unit.id,
          subjectId: subject.id,
          teacherId: teacher === null ? null : teacher.id,
          lessonsPerWeek,
          roomId: room === null ? null : room.id,
          roomType,
          doubleLessons,
          mixedBlock,
          shortReason,
        }
      : null;
  return { rowNumber: row.rowNumber, cells, problems, record };
}

/**
 * The repeats inside a file (`06`: "A row that repeats a row … of the file is a problem"): rows of
 * one class and one subject, or of one group, each told `load_import_row_twice` with the others.
 */
export function loadFileRepeats(rows: readonly ParsedLoadRow[]): Map<number, LoadImportProblem> {
  const byKey = new Map<string, number[]>();
  for (const row of rows) {
    if (row.record === null) continue;
    const key =
      row.record.unitKind === 'class'
        ? `class:${row.record.unitId}:${row.record.subjectId}`
        : `group:${row.record.unitId}`;
    byKey.set(key, [...(byKey.get(key) ?? []), row.rowNumber]);
  }
  const found = new Map<number, LoadImportProblem>();
  for (const numbers of byKey.values()) {
    if (numbers.length < 2) continue;
    for (const number of numbers) {
      found.set(number, {
        column: 'unit',
        code: 'load_import_row_twice',
        rows: numbers.filter((other) => other !== number),
      });
    }
  }
  return found;
}
