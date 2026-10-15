import { createHash } from 'node:crypto';
import type { ErrorCode, SchoolDate, StudentMergeField, StudentStatus } from '@sodiq/shared';

/**
 * The rules of the merge of two student records (task 3.3d, pull request
 * #98) that need no database: the joined life (decision 4), what becomes of
 * each dated row, the kept record (decision 3) and the digest of a preview
 * (correction 3).
 */

/** The record a row belongs to before the merge. */
export type Side = 'kept' | 'merged';

/** A dated row of either record: half-open, `until` null for open. */
export interface DatedRow {
  id: string;
  side: Side;
  from: SchoolDate;
  until: SchoolDate | null;
}

export interface MergeStatusRow extends DatedRow {
  status: StudentStatus;
}

/** One stretch of the joined life: the record whose row holds it and its status. */
export interface Stretch {
  from: SchoolDate;
  until: SchoolDate | null;
  side: Side;
  status: StudentStatus;
}

/** What becomes of a dated row. */
export type Fate =
  | { action: 'carried' }
  | { action: 'cut'; at: SchoolDate }
  | { action: 'left' }
  | { action: 'refused'; day: SchoolDate };

/** Active beats graduated beats inactive (decision 4). */
const RANK: Readonly<Record<StudentStatus, number>> = { active: 3, graduated: 2, inactive: 1 };

const holdsDays = (row: { from: SchoolDate; until: SchoolDate | null }): boolean =>
  row.until === null || row.from < row.until;

const covers = (row: { from: SchoolDate; until: SchoolDate | null }, day: SchoolDate): boolean =>
  row.from <= day && (row.until === null || day < row.until);

const before = (a: SchoolDate | null, b: SchoolDate | null): boolean =>
  a !== null && (b === null || a < b);

/**
 * The status rows of both records laid on one line, day by day (decision 4):
 * on each day the row of higher rank holds it, the kept record's between two
 * of one rank; a day of one record only is that record's. Adjacent days of
 * one record and one status are one stretch.
 */
export function joinedLife(rows: readonly MergeStatusRow[]): Stretch[] {
  const live = rows.filter(holdsDays);
  const bounds = [
    ...new Set(live.flatMap((row) => (row.until === null ? [row.from] : [row.from, row.until]))),
  ].sort();
  const stretches: Stretch[] = [];
  for (const [index, day] of bounds.entries()) {
    const next = bounds[index + 1] ?? null;
    const kept = live.find((row) => row.side === 'kept' && covers(row, day));
    const merged = live.find((row) => row.side === 'merged' && covers(row, day));
    const winner =
      kept === undefined
        ? merged
        : merged === undefined
          ? kept
          : RANK[merged.status] > RANK[kept.status]
            ? merged
            : kept;
    if (winner === undefined) {
      continue;
    }
    // The last bound is held only by an open row: the stretch is open.
    const until = next;
    const last = stretches.at(-1);
    if (
      last !== undefined &&
      last.until === day &&
      last.side === winner.side &&
      last.status === winner.status
    ) {
      last.until = until;
    } else {
      stretches.push({ from: day, until, side: winner.side, status: winner.status });
    }
  }
  return stretches;
}

/**
 * What becomes of a dated row of one record given the joined life (decision
 * 4): a row that loses no day is carried whole; one that loses a tail is cut
 * at its first lost day; a row of the merged record that loses every day is
 * left behind whole; anything else (a lost start or middle, a kept row that
 * loses every day, an ended row that would need a further cut) refuses, with
 * the first lost day. A row with no day is carried.
 */
export function fateOf(row: DatedRow, life: readonly Stretch[], cuttable: boolean): Fate {
  if (!holdsDays(row)) {
    return { action: 'carried' };
  }
  const lost = life
    .filter((stretch) => stretch.side !== row.side)
    .map((stretch) => ({
      from: stretch.from > row.from ? stretch.from : row.from,
      until: before(row.until, stretch.until) ? row.until : stretch.until,
    }))
    .filter((part) => holdsDays(part) && before(part.from, row.until))
    .sort((a, b) => (a.from < b.from ? -1 : a.from > b.from ? 1 : 0));
  const first = lost[0];
  if (first === undefined) {
    return { action: 'carried' };
  }
  // The lost days from the first one: one run to the row's end, or not.
  let reach: SchoolDate | null = first.until;
  for (const part of lost.slice(1)) {
    if (reach === null || part.from > reach) {
      break;
    }
    if (part.until === null || part.until > reach) {
      reach = part.until;
    }
  }
  const toEnd = row.until === null ? reach === null : reach === null || reach >= row.until;
  if (!toEnd) {
    return { action: 'refused', day: first.from };
  }
  if (first.from === row.from) {
    return row.side === 'merged' ? { action: 'left' } : { action: 'refused', day: first.from };
  }
  return cuttable ? { action: 'cut', at: first.from } : { action: 'refused', day: first.from };
}

/** The record that keeps its UID (decision 3): its first UID held first, ties by id. */
export function keptOf<T extends { id: string; firstHeld: Date }>(a: T, b: T): [T, T] {
  const order =
    a.firstHeld.getTime() - b.firstHeld.getTime() ||
    (a.id.toLowerCase() < b.id.toLowerCase() ? -1 : 1);
  return order < 0 ? [a, b] : [b, a];
}

/** Plain JSON with the keys of every object in order: one state, one text. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`;
  }
  if (value instanceof Date) {
    return JSON.stringify(value.toISOString());
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/**
 * The digest of what a preview shows (correction 3): SHA-256 over a
 * canonical text of the state, the rows ordered by id by the caller. The
 * text itself is never answered.
 */
export function digestOf(state: unknown): string {
  return createHash('sha256').update(canonical(state)).digest('hex');
}

/**
 * The refusals of the database for a merge (db/migrations/0054). The service
 * checks each rule first; these answer two requests that race past those
 * checks, a closed year met by a cut, and the faults of the service.
 */
export const MERGE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  student_merges_merged_uid_idx: 'student_merge_not_found',
  student_merges_merged_idx: 'student_merge_not_found',
  student_statuses_closed_year: 'year_closed',
  class_year_closed: 'year_closed',
  student_statuses_no_overlap: 'student_merge_overlap',
  class_memberships_no_overlap: 'student_merge_overlap',
  group_memberships_no_overlap: 'student_merge_overlap',
  class_memberships_active: 'student_merge_overlap',
  group_memberships_in_class: 'student_merge_overlap',
  students_grade_class: 'student_grade_class',
  student_branch_moves_open_idx: 'branch_move_open',
  // Faults of the service.
  student_merges_state: 'request_refused',
  students_starts_on: 'request_refused',
  students_branch_move: 'request_refused',
  students_delete_guard: 'request_refused',
  dated_rows_only_shrink: 'request_refused',
  student_contracts_student: 'request_refused',
  student_moves_state: 'request_refused',
  student_branch_moves_state: 'request_refused',
  memberships_merge: 'request_refused',
  class_memberships_only_shrink: 'request_refused',
  group_memberships_only_shrink: 'request_refused',
  student_statuses_before_branch_move: 'request_refused',
};

/** The personal fields of a record (decision 7) and their columns. */
export const FIELD_COLUMNS: Readonly<Record<StudentMergeField, readonly string[]>> = {
  firstName: ['first_name'],
  lastName: ['last_name'],
  paternalName: ['paternal_name'],
  sex: ['sex'],
  birthDate: ['birth_date'],
  document: ['document_type', 'document_number'],
  jshshir: ['jshshir'],
  phone: ['phone'],
  email: ['email'],
  address: ['address'],
  region: ['region'],
  previousSchool: ['previous_school'],
  diagnosticScore: ['diagnostic_score'],
  consentSignedOn: ['consent_signed_on'],
};

/** A value of a row read whole, as text: a string, a number or a boolean; `null` for anything else. */
export const scalarText = (value: unknown): string | null =>
  typeof value === 'string'
    ? value
    : typeof value === 'number' || typeof value === 'boolean'
      ? String(value)
      : null;

export const textOf = (row: Record<string, unknown>, columns: readonly string[]): string | null => {
  const values = columns.map((column) => row[column]);
  if (values.every((value) => value === null || value === undefined)) {
    return null;
  }
  return values.map((value) => scalarText(value) ?? '').join(' ');
};
