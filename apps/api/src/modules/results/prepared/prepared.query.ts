import { sql } from 'kysely';
import type { Transaction } from '../../../database/transactions.js';
import { decode, encode } from './codec.js';
import type { PreparedLesson } from './units.js';

/**
 * The store of the prepared report totals (task 9.3b-1; db/migrations/0140): which units are
 * fresh, their values, and their preparation. A unit is fresh while every change row that
 * concerns it was visible in the snapshot of its preparation (`seen`), the moment it depends on
 * has not come (`next_change_at`), every school-wide change row was visible in that snapshot too
 * (task 10.1b, db/migrations/0143) and its value has the shape of this release
 * (`school_inputs` holds `PREPARED_SHAPE`); anything else is behind, and the reader calculates
 * it from source.
 */

// Task 9.3b-2 adds `attendance` (db/migrations/0141): a quarter and a journal. Task 10.1b adds
// `closing` (a quarter and a subject), 0143, and `plan_progress` (a quarter and a journal), 0146.
// The kind `class_figures` that 0143 allows is not prepared: the ratings read their units fast
// enough as they are (plan decision 11).
export const UNIT_KINDS = [
  'outcomes',
  'figures',
  'statuses',
  'attendance',
  'closing',
  'plan_progress',
] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/**
 * The school-wide tables the preparation reads (no branch column, so no change row of a branch).
 * A write of any of them writes a row of `report_school_changes` (0143), which puts every unit of
 * every branch behind until a preparation sees it (task 10.1b, decision 3, Look first: in place of
 * the fingerprint of every row that 9.3b-1 read on each request). Held complete by the inputs
 * check of the speed run (`speed.database.test.ts`, `testing/prepared-kit.ts`), and the triggers of
 * 0143 by `prepared.database.test.ts`.
 */
export const SCHOOL_INPUTS = [
  'absences',
  'account_lock_spans',
  'branches',
  'staff',
  'staff_status_moments',
  'staff_statuses',
  'subject_switches',
  'subjects',
] as const;

/**
 * The shape of the stored values of this release, kept in `school_inputs`: raised whenever a
 * kind's value changes shape, so the rows prepared by an older release are behind at once and
 * prepared again by the job, with no migration touching them (task 10.1b, decision 5).
 */
export const PREPARED_SHAPE = 'shape:4';

/**
 * The snapshot of this transaction as text: taken before the preparation reads anything (review
 * correction 2), so every change it reads was committed by then or later.
 */
export async function snapshotOf(transaction: Transaction): Promise<string> {
  const found = await sql<{ seen: string }>`
    select pg_current_snapshot()::text as seen
  `.execute(transaction);
  const seen = found.rows[0]?.seen;
  if (seen === undefined) throw new Error('No snapshot was read.');
  return seen;
}

/** The condition "this preparation row is fresh" for a row named `p`. */
//
// A change row whose transaction is older than the snapshot's oldest running one was committed
// before the snapshot and is visible in it, so only the newer ones are tested (task 10.1b: the
// test reads the index of `xid`, not every change row of the branch).
const freshCondition = (now: Date, schoolInputs: string) => sql<boolean>`
  (p.next_change_at is null or p.next_change_at > ${now})
  and p.school_inputs = ${schoolInputs}
  and not exists (
    select from report_school_changes s
    where s.xid >= pg_snapshot_xmin(p.seen) and not pg_visible_in_snapshot(s.xid, p.seen)
  )
  and not exists (
    select from report_changes c
    where c.branch_id = p.branch_id
      and c.xid >= pg_snapshot_xmin(p.seen)
      and (c.quarter_id is null or c.quarter_id = p.quarter_id)
      and (c.journal_id is null or c.journal_id = any (p.journal_ids))
      and not pg_visible_in_snapshot(c.xid, p.seen)
  )
`;

export interface FreshUnit {
  readonly value: unknown;
  readonly preparedAt: Date;
}

/** The fresh units of one kind and quarter among those named, with their values. */
export async function freshUnits(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly kind: Exclude<UnitKind, 'statuses'>;
    readonly quarterId: string;
    readonly unitIds: readonly string[];
    readonly now: Date;
    readonly schoolInputs: string;
    /**
     * Task 10.1b: one field of the stored object only (the early-warning list reads the `work`
     * of the previous quarter's figures), never the whole value decoded.
     */
    readonly part?: string;
  },
): Promise<Map<string, FreshUnit>> {
  if (input.unitIds.length === 0) return new Map();
  const value =
    input.part === undefined ? sql`p.value` : sql`p.value -> '$o' -> ${input.part}::text`;
  const found = await sql<{ unit_id: string; prepared_at: Date; value: unknown }>`
    select p.unit_id, p.prepared_at, ${value} as value
    from report_prepared p
    where p.branch_id = ${input.branchId}
      and p.kind = ${input.kind}
      and p.quarter_id = ${input.quarterId}
      and p.unit_id = any (${[...input.unitIds]}::uuid[])
      and ${freshCondition(input.now, input.schoolInputs)}
  `.execute(transaction);
  return new Map(
    found.rows.map((row) => [
      row.unit_id,
      { value: decode(row.value), preparedAt: new Date(row.prepared_at) },
    ]),
  );
}

/**
 * The prepared facts of the lessons named whose `statuses` unit is fresh; with `part: 'counts'`
 * only each lesson's `row` and `counts` (`PreparedLesson`, the column `summary`), not the facts
 * (task 10.1b).
 */
export async function freshLessons(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly lessonIds: readonly string[];
    readonly now: Date;
    readonly schoolInputs: string;
    readonly part?: 'counts';
  },
): Promise<Map<string, FreshUnit>> {
  if (input.lessonIds.length === 0) return new Map();
  // `summary` (0148): read apart from `value`, whose facts are large.
  const value = input.part === undefined ? sql`l.value` : sql`l.summary`;
  const found = await sql<{ lesson_id: string; prepared_at: Date; value: unknown }>`
    -- Task 10.1b: each unit decided once, not once per lesson.
    with fresh as materialized (
      select p.quarter_id, p.unit_id, p.prepared_at
      from report_prepared p
      where p.branch_id = ${input.branchId} and p.kind = 'statuses'
        and ${freshCondition(input.now, input.schoolInputs)}
    )
    select l.lesson_id, f.prepared_at, ${value} as value
    from report_prepared_lessons l
    join fresh f on f.quarter_id = l.quarter_id and f.unit_id = l.journal_id
    where l.branch_id = ${input.branchId}
      and l.lesson_id = any (${[...new Set(input.lessonIds)]}::uuid[])
  `.execute(transaction);
  return new Map(
    found.rows.map((row) => [
      row.lesson_id,
      { value: decode(row.value), preparedAt: new Date(row.prepared_at) },
    ]),
  );
}

export interface UnitKey {
  readonly kind: UnitKind;
  readonly quarterId: string;
  readonly unitId: string;
}

/** Whether one unit has a fresh preparation now. */
export async function isFresh(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly unit: UnitKey;
    readonly now: Date;
    readonly schoolInputs: string;
  },
): Promise<boolean> {
  const found = await sql<{ fresh: boolean }>`
    select true as fresh
    from report_prepared p
    where p.branch_id = ${input.branchId} and p.kind = ${input.unit.kind}
      and p.quarter_id = ${input.unit.quarterId} and p.unit_id = ${input.unit.unitId}
      and ${freshCondition(input.now, input.schoolInputs)}
  `.execute(transaction);
  return found.rows.length > 0;
}

/** The prepared units of the branch that are behind (the job prepares them again). */
export async function behindUnits(
  transaction: Transaction,
  branchId: string,
  now: Date,
  schoolInputs: string,
): Promise<UnitKey[]> {
  const found = await sql<{ kind: UnitKind; quarter_id: string; unit_id: string }>`
    select p.kind, p.quarter_id, p.unit_id
    from report_prepared p
    where p.branch_id = ${branchId}
      and not (${freshCondition(now, schoolInputs)})
    order by p.kind, p.quarter_id, p.unit_id
  `.execute(transaction);
  return found.rows.map((row) => ({
    kind: row.kind,
    quarterId: row.quarter_id,
    unitId: row.unit_id,
  }));
}

/** The units of the branch that have a preparation. */
export async function preparedKeys(
  transaction: Transaction,
  branchId: string,
): Promise<Set<string>> {
  const found = await sql<{ key: string }>`
    select p.kind || '|' || p.quarter_id || '|' || p.unit_id as key
    from report_prepared p
    where p.branch_id = ${branchId}
  `.execute(transaction);
  return new Set(found.rows.map((row) => row.key));
}

export const unitKeyOf = (unit: UnitKey) => `${unit.kind}|${unit.quarterId}|${unit.unitId}`;

/**
 * Writes a unit's preparation, replacing the one before unless that one saw a newer snapshot
 * (review of the plan, finding 8: an older preparation never replaces a newer one). `lessons`:
 * the facts of each lesson of a `statuses` unit, every row of the unit replaced in one go
 * (finding 5: the rows of lessons that are gone go with them).
 */
export async function writeUnit(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly unit: UnitKey;
    readonly journalIds: readonly string[];
    readonly seen: string;
    readonly schoolInputs: string;
    readonly preparedAt: Date;
    readonly nextChangeAt: Date | null;
    readonly value: unknown;
    readonly lessons?: ReadonlyMap<string, PreparedLesson>;
  },
): Promise<boolean> {
  const { unit } = input;
  const written = await sql<{ unit_id: string }>`
    insert into report_prepared as p (
      branch_id, kind, quarter_id, unit_id, journal_ids, seen, school_inputs, prepared_at,
      next_change_at, value
    ) values (
      ${input.branchId}, ${unit.kind}, ${unit.quarterId}, ${unit.unitId},
      ${[...input.journalIds]}::uuid[], ${input.seen}::pg_snapshot, ${input.schoolInputs},
      ${input.preparedAt}, ${input.nextChangeAt}, ${JSON.stringify(encode(input.value))}::jsonb
    )
    on conflict (branch_id, kind, quarter_id, unit_id) do update set
      journal_ids = excluded.journal_ids,
      seen = excluded.seen,
      school_inputs = excluded.school_inputs,
      prepared_at = excluded.prepared_at,
      next_change_at = excluded.next_change_at,
      value = excluded.value
    where pg_snapshot_xmin(p.seen) <= pg_snapshot_xmin(excluded.seen)
    returning p.unit_id
  `.execute(transaction);
  if (written.rows.length === 0) return false;
  if (unit.kind === 'statuses') {
    await sql`
      delete from report_prepared_lessons
      where branch_id = ${input.branchId} and quarter_id = ${unit.quarterId}
        and journal_id = ${unit.unitId}
    `.execute(transaction);
    const rows = [...(input.lessons ?? new Map<string, PreparedLesson>())];
    // A lesson that now falls in this unit (a quarter's dates changed, a lesson moved across a
    // quarter's end) leaves the unit it was in: its key is the lesson (code review, must-fix 2).
    if (rows.length > 0) {
      await sql`
        delete from report_prepared_lessons
        where branch_id = ${input.branchId}
          and lesson_id = any (${rows.map(([id]) => id)}::uuid[])
      `.execute(transaction);
    }
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      await sql`
        insert into report_prepared_lessons (
          branch_id, quarter_id, journal_id, lesson_id, value, summary
        )
        select ${input.branchId}::uuid, ${unit.quarterId}::uuid, ${unit.unitId}::uuid,
          x.lesson_id, x.value, x.summary
        from unnest(
          ${chunk.map(([id]) => id)}::uuid[],
          ${chunk.map(([, one]) => JSON.stringify(encode({ row: one.row, facts: one.facts })))}::jsonb[],
          ${chunk.map(([, one]) => JSON.stringify(encode({ row: one.row, counts: one.counts })))}::jsonb[]
        ) as x (lesson_id, value, summary)
      `.execute(transaction);
    }
  }
  return true;
}

/**
 * Removes the change rows of the branch that were visible in `seen`, a snapshot taken before the
 * units then behind were listed and prepared again: every unit such a row concerns has since
 * been prepared with a later snapshot, or has no preparation and is behind anyway.
 */
export async function pruneChanges(
  transaction: Transaction,
  branchId: string,
  seen: string,
): Promise<void> {
  await sql`
    delete from report_changes c
    where c.branch_id = ${branchId}
      and pg_visible_in_snapshot(c.xid, ${seen}::pg_snapshot)
  `.execute(transaction);
}

/**
 * Removes the school-wide change rows visible in `seen` (a snapshot taken before a run of the job
 * prepared every branch) that every prepared unit of every branch has seen: a school change
 * concerns every branch, so a row is kept while any unit anywhere was prepared before it (review
 * of the plan, correction 2). Run in a transaction that sees every branch.
 */
export async function pruneSchoolChanges(transaction: Transaction, seen: string): Promise<void> {
  await sql`
    delete from report_school_changes s
    where pg_visible_in_snapshot(s.xid, ${seen}::pg_snapshot)
      and not exists (
        select from report_prepared p
        where s.xid >= pg_snapshot_xmin(p.seen) and not pg_visible_in_snapshot(s.xid, p.seen)
      )
  `.execute(transaction);
}
