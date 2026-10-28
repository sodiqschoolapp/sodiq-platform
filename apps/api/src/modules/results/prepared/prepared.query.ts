import { sql } from 'kysely';
import type { Transaction } from '../../../database/transactions.js';
import { decode, encode } from './codec.js';

/**
 * The store of the prepared report totals (task 9.3b-1; db/migrations/0140): which units are
 * fresh, their values, and their preparation. A unit is fresh while every change row that
 * concerns it was visible in the snapshot of its preparation (`seen`), the moment it depends on
 * has not come (`next_change_at`) and the school-wide inputs are the ones it was prepared with
 * (`school_inputs`); anything else is behind, and the reader calculates it from source.
 */

export const UNIT_KINDS = ['outcomes', 'figures', 'statuses'] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

/**
 * The school-wide tables the preparation reads (no branch column, so no change row: plan
 * decision 2 cannot reach them). Each is fingerprinted by the place and the writing transaction
 * of every row, so an insert, an update and a delete each change the fingerprint. Held complete
 * by `report-inputs.database.test.ts`.
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

/** The fingerprint of the school-wide inputs, as this transaction sees them. */
export async function schoolInputsOf(transaction: Transaction): Promise<string> {
  const parts = SCHOOL_INPUTS.map(
    (table) => sql<string>`
      select ${table}::text || ':' || coalesce(
        md5(string_agg(t.ctid::text || '/' || t.xmin::text, ',' order by t.ctid)), ''
      ) as part
      from ${sql.table(table)} t
    `,
  );
  const found = await sql<{ inputs: string }>`
    select md5(string_agg(part, '|' order by part)) as inputs
    from (${sql.join(parts, sql` union all `)}) x
  `.execute(transaction);
  return found.rows[0]?.inputs ?? '';
}

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
const freshCondition = (now: Date, schoolInputs: string) => sql<boolean>`
  (p.next_change_at is null or p.next_change_at > ${now})
  and p.school_inputs = ${schoolInputs}
  and not exists (
    select from report_changes c
    where c.branch_id = p.branch_id
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
  },
): Promise<Map<string, FreshUnit>> {
  if (input.unitIds.length === 0) return new Map();
  const found = await sql<{ unit_id: string; prepared_at: Date; value: unknown }>`
    select p.unit_id, p.prepared_at, p.value
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

/** The prepared facts of the lessons named whose `statuses` unit is fresh. */
export async function freshLessons(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly lessonIds: readonly string[];
    readonly now: Date;
    readonly schoolInputs: string;
  },
): Promise<Map<string, FreshUnit>> {
  if (input.lessonIds.length === 0) return new Map();
  const found = await sql<{ lesson_id: string; prepared_at: Date; value: unknown }>`
    select l.lesson_id, p.prepared_at, l.value
    from report_prepared_lessons l
    join report_prepared p on p.branch_id = l.branch_id and p.kind = 'statuses'
      and p.quarter_id = l.quarter_id and p.unit_id = l.journal_id
    where l.branch_id = ${input.branchId}
      and l.lesson_id = any (${[...new Set(input.lessonIds)]}::uuid[])
      and ${freshCondition(input.now, input.schoolInputs)}
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
    readonly lessons?: ReadonlyMap<string, unknown>;
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
    const rows = [...(input.lessons ?? new Map<string, unknown>())];
    for (let start = 0; start < rows.length; start += 500) {
      const chunk = rows.slice(start, start + 500);
      await sql`
        insert into report_prepared_lessons (branch_id, quarter_id, journal_id, lesson_id, value)
        select ${input.branchId}::uuid, ${unit.quarterId}::uuid, ${unit.unitId}::uuid,
          x.lesson_id, x.value
        from unnest(
          ${chunk.map(([id]) => id)}::uuid[],
          ${chunk.map(([, value]) => JSON.stringify(encode(value)))}::jsonb[]
        ) as x (lesson_id, value)
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
