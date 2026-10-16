import type { ErrorDetail } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';

/** The most stays one refusal names; the count of the rest follows (3.6b-2, decision 9). */
export const CUT_HOLDS_LISTED = 50;

type StayTable = 'class_memberships' | 'group_memberships';

/** A stay that follows the year's last day: its table, id and the ends before and after the edit. */
export interface FollowedRow {
  table: StayTable;
  id: string;
  ownUntil: string;
  validUntil: string;
}

/**
 * Takes the class and group rows that run to a year's last day `for update`,
 * class rows first, each in the order of the id, before the year row is
 * locked. A leaving or a move holds its row and then waits for the year
 * `for share`; an edit that held the year first would wait for the row
 * (`.claude/rules/database.md`, "PostgreSQL locks the row an UPDATE changes
 * before its BEFORE ROW triggers run"). Answers the rows as they stand.
 */
export async function lockFollowingRows(
  transaction: Transaction,
  yearId: string,
  endDate: string,
): Promise<FollowedRow[]> {
  const found: FollowedRow[] = [];
  for (const [table, holders, key] of [
    ['class_memberships', 'classes', 'class_id'],
    ['group_memberships', 'groups', 'group_id'],
  ] as const) {
    const rows = await sql<{ id: string; own_until: string; valid_until: string }>`
      select m.id, m.own_until::text as own_until, m.valid_until::text as valid_until
      from ${sql.table(table)} m
      join ${sql.table(holders)} h on h.id = m.${sql.ref(key)}
      where h.academic_year_id = ${yearId}
        and m.own_until = ${endDate}::date + 1
      order by m.id
      for update of m
    `.execute(transaction);
    found.push(
      ...rows.rows.map((row) => ({
        table,
        id: row.id,
        ownUntil: row.own_until,
        validUntil: row.valid_until,
      })),
    );
  }
  return found;
}

/** The ends of the given rows now, by table and id. */
export async function endsOf(
  transaction: Transaction,
  rows: readonly FollowedRow[],
): Promise<FollowedRow[]> {
  const out: FollowedRow[] = [];
  for (const table of ['class_memberships', 'group_memberships'] as const) {
    const ids = rows.filter((row) => row.table === table).map((row) => row.id);
    if (ids.length === 0) {
      continue;
    }
    const now = await transaction
      .selectFrom(table)
      .select([
        'id',
        sql<string>`own_until::text`.as('own_until'),
        sql<string>`valid_until::text`.as('valid_until'),
      ])
      .where('id', 'in', ids)
      .orderBy('id')
      .execute();
    out.push(
      ...now.map((row) => ({
        table,
        id: row.id,
        ownUntil: row.own_until,
        validUntil: row.valid_until,
      })),
    );
  }
  return out;
}

/**
 * Refuses a change of the year's dates that cuts days a stay stands in
 * (L128, `year_cut_holds` of db/migrations/0064): one detail per stay, at most
 * `CUT_HOLDS_LISTED`, then a detail `more` with the count of the rest. A
 * student the branch does not hold now is named "a student of another
 * branch" (the row filter hides the record).
 */
export async function refuseCutHolds(
  transaction: Transaction,
  yearId: string,
  startDate: string,
  endDate: string,
): Promise<void> {
  const found = await sql<{
    kind: string;
    first_name: string | null;
    last_name: string | null;
    holder_name: string | null;
    valid_from: string;
    valid_until: string;
  }>`
    select h.kind, s.first_name, s.last_name,
      coalesce(c.name, g.name) as holder_name,
      h.valid_from::text as valid_from, h.valid_until::text as valid_until
    from year_cut_holds(${yearId}, ${startDate}::date, ${endDate}::date) h
    left join students s on s.id = h.student_id
    left join classes c on h.kind = 'class' and c.id = h.holder_id
    left join groups g on h.kind = 'group' and g.id = h.holder_id
    order by h.kind, h.valid_from, h.row_id
  `.execute(transaction);
  if (found.rows.length === 0) {
    return;
  }
  const details: ErrorDetail[] = found.rows.slice(0, CUT_HOLDS_LISTED).map((row, index) => ({
    path: `rows.${String(index)}`,
    code: 'year_cut_holds',
    message: `${
      row.first_name === null
        ? 'a student of another branch'
        : `${row.first_name} ${row.last_name ?? ''}`.trim()
    } · ${row.holder_name ?? ''} · ${row.valid_from} – ${row.valid_until}`,
  }));
  if (found.rows.length > CUT_HOLDS_LISTED) {
    details.push({
      path: 'more',
      code: 'year_cut_holds',
      message: String(found.rows.length - CUT_HOLDS_LISTED),
    });
  }
  throw new ApiException('year_cut_holds', 409, undefined, details);
}
