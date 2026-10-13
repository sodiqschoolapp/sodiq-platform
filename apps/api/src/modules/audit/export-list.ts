import {
  EXPORT_TEXTS,
  gradeRanges,
  isLanguage,
  schoolDateOf,
  type Clock,
  type ExportList,
  type ExportSelection,
  type ExportTexts,
  type Language,
  type AuditAction,
} from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { writeWorkbook, XlsxFile, type Cell } from '../../http/xlsx.js';
import type { Access } from '../access/permission.guard.js';
import { notFound } from '../setup/setup-refusals.js';
import type { Audit } from './audit.service.js';

/** One column of a list's file: one heading or more (the daily distribution has three), and the cells of a row. */
export interface ExportColumn<Row> {
  headings: (texts: ExportTexts) => readonly string[];
  cells: (row: Row, texts: ExportTexts, language: Language) => readonly Cell[];
}

/** What the Export button sent, as `exportRequestSchema` checked it. */
export interface ExportRequest<Column extends string> {
  ids: readonly string[];
  columns: readonly Column[];
  selection: ExportSelection;
  search: string;
  filters: Readonly<Record<string, string>>;
}

export interface ExportInput<Row, Column extends string> {
  list: ExportList;
  /** The audit action, singular as the other actions of the record: `staff.export`, `room.export`. */
  action: AuditAction;
  request: ExportRequest<Column>;
  /** Every row the list of this reader holds, by id, read as the list route reads them. */
  rows: ReadonlyMap<string, Row>;
  /** Whether this reader may export the column (decision 4: the Principal and the staff phone). */
  allowed: (column: Column) => boolean;
  /**
   * The assignment the audit entry names when the columns written need one of
   * a narrower role than the route (`.claude/rules/api.md`: "the audit entry
   * names the assignment that allowed that part"); else `access.assignmentId`.
   */
  assignmentFor?: (columns: readonly Column[]) => string | undefined;
  columns: Readonly<Record<Column, ExportColumn<Row>>>;
}

/**
 * The Excel file of a list (task 2.2c-1; edge cases, Personal data and the
 * audit log: "An export contains only what the role may see" and "Every export
 * is logged with its filters and row count"). Runs inside the transaction that
 * read the rows, so the file never holds more than the list:
 *
 * - every id must be a row of the list, else 404 (`.claude/rules/api.md`, ids
 *   in the body): another branch's row, an unknown one, a vacancy in the staff
 *   export (decision 5);
 * - the rows in the order of `ids`, the columns in the order sent, without
 *   those the reader may not export; with none left, 403 and no audit entry;
 * - the texts in the language of the account (decision 7), the file name with
 *   today in the branch's time zone;
 * - one audit entry in the same transaction, with the search and filters as
 *   sent, the columns written and the rows counted here.
 */
export async function exportList<Row, Column extends string>(
  transaction: Transaction,
  audit: Audit,
  clock: Clock,
  access: Access,
  requestId: string,
  input: ExportInput<Row, Column>,
): Promise<XlsxFile> {
  const branchId = access.branchId;
  if (branchId === null) {
    throw new Error('An export works for the branch of the request.');
  }
  const rows = input.request.ids.map((id) => {
    const row = input.rows.get(id);
    if (row === undefined) {
      throw notFound();
    }
    return row;
  });
  const columns = input.request.columns.filter((column) => input.allowed(column));
  const leftOut = input.request.columns.filter((column) => !input.allowed(column));
  if (columns.length === 0) {
    throw new ApiException('permission_denied', 403);
  }
  const account = await transaction
    .selectFrom('accounts')
    .select('language')
    .where('id', '=', access.accountId)
    .executeTakeFirstOrThrow();
  const language: Language = isLanguage(account.language) ? account.language : 'uz';
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(clock.now(), branch.time_zone);
  const texts = EXPORT_TEXTS[language];
  const specs = columns.map((column) => input.columns[column]);
  const content = await writeWorkbook({
    name: texts[input.list].name,
    headings: specs.flatMap((spec) => spec.headings(texts)),
    rows: rows.map((row) => specs.flatMap((spec) => spec.cells(row, texts, language))),
  });
  await audit.record(transaction, {
    branchId,
    actorId: access.accountId,
    assignmentId: input.assignmentFor?.(columns) ?? access.assignmentId,
    action: input.action,
    details: {
      list: input.list,
      selection: input.request.selection,
      search: input.request.search,
      filters: { ...input.request.filters },
      columns,
      leftOut,
      rows: rows.length,
    },
    requestId,
  });
  return new XlsxFile(
    `${texts[input.list].name}-${today}.xlsx`,
    `${input.list}-${today}.xlsx`,
    columns,
    content,
  );
}

/** A column whose one cell is a text or a number. */
export function oneCell<Row>(
  heading: (texts: ExportTexts) => string,
  cell: (row: Row, texts: ExportTexts, language: Language) => Cell,
): ExportColumn<Row> {
  return {
    headings: (texts) => [heading(texts)],
    cells: (row, texts, language) => [cell(row, texts, language)],
  };
}

/** A list inside one cell, joined as the screen joins it. */
export const joined = (items: readonly string[]): string => items.join(', ');

export type Names = Readonly<Record<Language, string>>;

/** The names of the school-wide records a file shows in the language of the account. */
export interface SchoolNames {
  divisions: ReadonlyMap<string, Names>;
  departments: ReadonlyMap<string, Names>;
  subjects: ReadonlyMap<string, Names>;
  /** The built-in Academic division, whose department is the teaching one. */
  academicId: string | undefined;
}

/** Divisions, departments and subjects with their three names, archived ones too (the lists show them). */
export async function readSchoolNames(transaction: Transaction): Promise<SchoolNames> {
  const names = (row: { name_uz: string; name_ru: string; name_en: string }): Names => ({
    uz: row.name_uz,
    ru: row.name_ru,
    en: row.name_en,
  });
  const divisions = await transaction
    .selectFrom('divisions')
    .select(['id', 'name_uz', 'name_ru', 'name_en', 'built_in'])
    .execute();
  const departments = await transaction
    .selectFrom('departments')
    .select(['id', 'name_uz', 'name_ru', 'name_en'])
    .execute();
  const subjects = await transaction
    .selectFrom('subjects')
    .select(['id', 'name_uz', 'name_ru', 'name_en'])
    .execute();
  return {
    divisions: new Map(divisions.map((row) => [row.id, names(row)])),
    departments: new Map(departments.map((row) => [row.id, names(row)])),
    subjects: new Map(subjects.map((row) => [row.id, names(row)])),
    academicId: divisions.find((row) => row.built_in)?.id,
  };
}

/** The name of a record in the language, empty when the id is unknown. */
export const nameIn = (
  names: ReadonlyMap<string, Names>,
  id: string | null | undefined,
  language: Language,
): string => (id === null || id === undefined ? '' : (names.get(id)?.[language] ?? ''));

/**
 * Grades as the staff and vacancy lists name them: the grades of every
 * subject as ranges, "5–7, 9" (finding 19; task 2.7b-1, decision 2).
 */
export const gradesOf = (subjects: readonly { grades: readonly number[] }[]): string =>
  gradeRanges(subjects.flatMap((subject) => subject.grades));
