import type { ErrorDetail } from '@sodiq/shared';
import { departmentChangeKind, schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/**
 * Any fixed number: a department move of a teacher or a subject takes it as
 * the first statement of its edit, before any row lock (task 3.4c, decision 6
 * of pull request #101), so that two moves at the same moment, which read
 * both departments of a load row, run one after the other.
 */
export const DEPARTMENT_MOVE_LOCK = 60_734;

/** Waits for, then holds until the end of the transaction, the lock of department moves. */
export async function lockDepartmentMoves(transaction: Transaction): Promise<void> {
  await sql`select pg_advisory_xact_lock(${DEPARTMENT_MOVE_LOCK})`.execute(transaction);
}

/**
 * The start date of a move against today in the time zone of the branch of
 * the request, at the moment of the transaction, and the end of the branch's
 * latest academic year (task 3.4c, decision 2 and correction 5): with no year
 * in the branch, only today bounds it.
 */
export async function checkMoveStart(
  transaction: Transaction,
  branchId: string,
  startsOn: string,
): Promise<void> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  const latest = await transaction
    .selectFrom('academic_years')
    .select((eb) => eb.fn.max('end_date').as('end_date'))
    .where('branch_id', '=', branchId)
    .executeTakeFirst();
  const end = latest?.end_date ?? null;
  if (startsOn < today || (end !== null && startsOn > dateText(end))) {
    throw new ApiException('department_move_start_outside', 422, undefined, [
      {
        path: 'departmentStartsOn',
        code: 'outside',
        message: "Today or later, and no later than the end of the branch's latest year.",
      },
    ]);
  }
}

/** A `date` column as `YYYY-MM-DD`, whichever way the driver gave it. */
function dateText(value: Date | string): string {
  return typeof value === 'string' ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

/** What a move is checked with: exactly one of the person and the subject. */
export type DepartmentMove =
  | { teacherId: string; departmentId: string | null; startsOn: string }
  | { subjectId: string; departmentId: string; startsOn: string };

interface MoveLine {
  row_id: string | null;
  version_id: string | null;
  branch_id: string;
  rows: number;
}

/**
 * `department_move_loads` with the person or the subject locked by the
 * caller: 409 `department_move_loads` when any row of any branch would have a
 * teacher outside the subject's department (`edge/people-roles-accounts`, row
 * 15: "those loads are listed for reassignment first"). The rows of the
 * branch of the request are named as `load.<id>` with what their line shows
 * (correction 2), read through the transaction; another branch's are the
 * count `elsewhere` (decision 3).
 */
export async function refuseMoveLoads(
  transaction: Transaction,
  branchId: string,
  move: DepartmentMove,
): Promise<void> {
  const teacherId = 'teacherId' in move ? move.teacherId : null;
  const subjectId = 'subjectId' in move ? move.subjectId : null;
  const found = await sql<MoveLine>`
    select row_id, version_id, branch_id, rows
    from department_move_loads(
      ${branchId}::uuid, ${teacherId}::uuid, ${subjectId}::uuid,
      ${move.departmentId}::uuid, ${move.startsOn}::date
    )
  `.execute(transaction);
  if (found.rows.length === 0) {
    return;
  }
  const own = found.rows.flatMap((line) => (line.row_id === null ? [] : [line.row_id]));
  const elsewhere = found.rows
    .filter((line) => line.row_id === null)
    .reduce((sum, line) => sum + line.rows, 0);
  const details: ErrorDetail[] = (await readLoadLines(transaction, own)).map((load) => ({
    path: `load.${load.id}`,
    code: 'teaches',
    message:
      "A teaching load row of this branch would have a teacher outside the subject's department.",
    load: load.line,
  }));
  if (elsewhere > 0) {
    details.push({
      path: 'elsewhere',
      code: String(elsewhere),
      message: 'The number of such rows in other branches.',
    });
  }
  throw new ApiException('department_move_loads', 409, undefined, details);
}

type LoadLine = NonNullable<ErrorDetail['load']>;

/**
 * The lines of rows of the branch of the request, by version number, then the
 * class's grade (groups after the classes), unit name and id.
 */
async function readLoadLines(
  transaction: Transaction,
  ids: readonly string[],
): Promise<{ id: string; line: LoadLine }[]> {
  if (ids.length === 0) {
    return [];
  }
  const rows = await transaction
    .selectFrom('teaching_load_rows as r')
    .innerJoin('timetable_versions as v', 'v.id', 'r.version_id')
    .leftJoin('classes as c', 'c.id', 'r.class_id')
    .leftJoin('groups as g', 'g.id', 'r.group_id')
    // A teacher no longer linked to the branch is hidden by the membership
    // filter: the row is still listed, without the name (permission review,
    // should-fix 4).
    .leftJoin('staff as s', 's.id', 'r.teacher_id')
    .select([
      'r.id',
      'r.version_id',
      'v.number',
      'v.starts_on',
      'r.class_id',
      'r.group_id',
      'c.name as class_name',
      'c.grade as class_grade',
      'g.name as group_name',
      'r.subject_id',
      'r.teacher_id',
      's.kind',
      's.first_name',
      's.last_name',
      's.vacancy_name',
    ])
    .where('r.id', 'in', [...ids])
    .orderBy('v.number')
    // PostgreSQL puts the null grade of a group after every class when ascending.
    .orderBy('c.grade')
    .orderBy((eb) => eb.fn.coalesce('c.name', 'g.name'))
    .orderBy('r.id')
    .execute();
  return rows.map((row) => {
    const vacancy = row.kind === 'vacancy';
    const unit: LoadLine['unit'] =
      row.class_id !== null
        ? {
            kind: 'class',
            id: row.class_id,
            name: row.class_name ?? '',
            grade: row.class_grade,
          }
        : { kind: 'group', id: row.group_id ?? '', name: row.group_name ?? '', grade: null };
    return {
      id: row.id,
      line: {
        versionId: row.version_id,
        versionNumber: row.number,
        versionStartsOn: dateText(row.starts_on),
        unit,
        subjectId: row.subject_id,
        teacher: {
          id: row.teacher_id,
          name:
            row.kind === null
              ? null
              : vacancy
                ? (row.vacancy_name ?? '')
                : `${row.last_name ?? ''} ${row.first_name ?? ''}`.trim(),
          vacancy,
        },
      },
    };
  });
}

/**
 * The start date a move needs, or none without a move (task 3.4c, decision
 * 2): `validation_failed` on `departmentStartsOn`, `required` for a move sent
 * without it and `no_move` for one sent without a move.
 */
export function moveStartsOn(moving: boolean, startsOn: string | null | undefined): string | null {
  if (moving && (startsOn === null || startsOn === undefined)) {
    throw new ApiException('validation_failed', 400, undefined, [
      {
        path: 'departmentStartsOn',
        code: 'required',
        message: 'A department move needs a start date.',
      },
    ]);
  }
  if (!moving && startsOn !== null && startsOn !== undefined) {
    throw new ApiException('validation_failed', 400, undefined, [
      {
        path: 'departmentStartsOn',
        code: 'no_move',
        message: 'A start date is sent with a department move only.',
      },
    ]);
  }
  return moving ? (startsOn ?? null) : null;
}

/** Today in the time zone of a branch at the moment of the transaction (task 3.6b-3, decision 5). */
export async function todayOf(transaction: Transaction, branchId: string): Promise<string> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
}

/** The four department columns of a subject or of a person's division (db/migrations/0065). */
export interface DepartmentColumns {
  department_id: string | null;
  department_since: Date | string | null;
  department_before: string | null;
  department_before_since: Date | string | null;
}

/** The department a record shows on a day, and the move planned after it. */
export interface DepartmentInForce {
  departmentId: string | null;
  since: string | null;
  move: { departmentId: string | null; startsOn: string } | null;
}

/**
 * The one rule of what a record shows (owner's answer of 15 October 2026,
 * L195: "the record shows the old department until then"; task 3.6b-3): while
 * `today` is before the start date of a move that stored the department before
 * it, that department and its date, with the move planned; otherwise the
 * department after the last move. Read on each request; nothing flips it. The
 * rules never read this: they read `department_id` (decision 1).
 */
export function departmentInForce(row: DepartmentColumns, today: string): DepartmentInForce {
  const since = row.department_since === null ? null : dateText(row.department_since);
  if (since !== null && since > today && row.department_before !== null) {
    return {
      departmentId: row.department_before,
      since: row.department_before_since === null ? null : dateText(row.department_before_since),
      move: { departmentId: row.department_id, startsOn: since },
    };
  }
  return { departmentId: row.department_id, since, move: null };
}

/**
 * What an edit asks of the department (task 3.6b-3, decisions 4 and 8):
 * - `none`: the department asked is the planned one (or, with no plan, the
 *   stored one), sent with no start date or the planned one; `stray` when a
 *   start date was sent all the same, which `moveStartsOn` refuses;
 * - `move`: another department, or the planned one with another start date
 *   (a change of the plan); the start date is required;
 * - `cancel`: the department in force while a move is planned; sent without
 *   a start date.
 * `asked` is `undefined` when the Academic division is removed: a move to no
 * department that takes effect when saved (decision 3).
 */
export type DepartmentChange =
  | { kind: 'none'; stray: boolean }
  | { kind: 'move'; departmentId: string | null }
  | { kind: 'cancel'; departmentId: string | null };

export function departmentChangeOf(
  row: DepartmentColumns,
  asked: string | null | undefined,
  startsOn: string | null | undefined,
  today: string,
): DepartmentChange {
  const sent = startsOn ?? null;
  if (asked === undefined) {
    return { kind: 'move', departmentId: null };
  }
  const shown = departmentInForce(row, today);
  const kind = departmentChangeKind(shown, asked, sent);
  if (kind === 'none') {
    // The planned date may come back with an edit that keeps the plan.
    return { kind, stray: sent !== null && sent !== shown.move?.startsOn };
  }
  return { kind, departmentId: asked };
}

/**
 * Whether the read without a lock and the locked read of one edit agree
 * (task 3.4c, decision 9; task 3.6b-3): the same kind of change to the same
 * department, from the same department in force and the same planned move.
 * Otherwise the edit was made on what another change has replaced.
 */
export function sameChange(
  unlocked: { row: DepartmentColumns | undefined; change: DepartmentChange },
  locked: { row: DepartmentColumns | undefined; change: DepartmentChange },
  today: string,
): boolean {
  const shown = (row: DepartmentColumns | undefined) =>
    row === undefined ? null : JSON.stringify(departmentInForce(row, today));
  const target = (change: DepartmentChange) =>
    change.kind === 'none' ? null : change.departmentId;
  return (
    unlocked.change.kind === locked.change.kind &&
    target(unlocked.change) === target(locked.change) &&
    shown(unlocked.row) === shown(locked.row)
  );
}

/**
 * The four columns after a move to `departmentId` from `startsOn`, or after a
 * cancel (`startsOn` null), from the stored ones: a move after today keeps
 * the department in force before it; one from today writes no before columns;
 * a cancel gives back the department in force and its date.
 */
export function departmentColumnsAfter(
  row: DepartmentColumns,
  departmentId: string | null,
  startsOn: string | null,
  today: string,
): {
  department_id: string | null;
  department_since: string | null;
  department_before: string | null;
  department_before_since: string | null;
} {
  const shown = departmentInForce(row, today);
  if (startsOn === null) {
    return {
      department_id: departmentId,
      department_since: shown.since,
      department_before: null,
      department_before_since: null,
    };
  }
  const later = startsOn > today;
  return {
    department_id: departmentId,
    department_since: startsOn,
    department_before: later ? shown.departmentId : null,
    department_before_since: later ? shown.since : null,
  };
}
