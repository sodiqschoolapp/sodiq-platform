import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { ChildSpan } from './portal-scope.js';

/**
 * The class and groups of a child on each date of a span, read in the span's branch (task
 * 11.2): a lesson, an exam or a homework is the child's only when its unit is one of these on
 * its date (decision 6; `06`, Views: "students and parents their own week").
 */
export interface ChildUnits {
  readonly classOn: (date: string) => string | undefined;
  readonly groupsOn: (date: string) => ReadonlySet<string>;
  /** Every class and group the child had in the span. */
  readonly classIds: readonly string[];
  readonly groupIds: readonly string[];
}

interface Range {
  readonly unitId: string;
  readonly from: string;
  readonly until: string;
}

export async function childUnits(
  transaction: Transaction,
  studentId: string,
  span: ChildSpan,
): Promise<ChildUnits> {
  const overlapping = (table: 'class_memberships' | 'group_memberships') =>
    transaction
      .selectFrom(table)
      .select([
        sql<string>`valid_from::text`.as('valid_from'),
        sql<string>`valid_until::text`.as('valid_until'),
      ])
      .where('student_id', '=', studentId)
      .where('branch_id', '=', span.branchId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<', span.until)
      .where('valid_until', '>', span.from);
  const [classes, groups] = await Promise.all([
    overlapping('class_memberships').select('class_id as unit_id').execute(),
    overlapping('group_memberships').select('group_id as unit_id').execute(),
  ]);
  const rangesOf = (
    rows: readonly { unit_id: string; valid_from: string; valid_until: string }[],
  ) =>
    rows.map((row): Range => ({
      unitId: row.unit_id,
      from: row.valid_from,
      until: row.valid_until,
    }));
  const classRanges = rangesOf(classes);
  const groupRanges = rangesOf(groups);
  const on = (ranges: readonly Range[], date: string) =>
    ranges.filter(
      (one) => one.from <= date && date < one.until && span.from <= date && date < span.until,
    );
  return {
    classOn: (date) => on(classRanges, date)[0]?.unitId,
    groupsOn: (date) => new Set(on(groupRanges, date).map((one) => one.unitId)),
    classIds: [...new Set(classRanges.map((one) => one.unitId))],
    groupIds: [...new Set(groupRanges.map((one) => one.unitId))],
  };
}
