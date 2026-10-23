import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { SubjectRounds } from './subject-weights.js';

/**
 * The switches of a subject in a quarter (task 8.2, decision 1, Look first;
 * `edge/calculation`: "These switches are stored per quarter"): the newest
 * change of the subject's log (`subject_switches`, 0120) that reaches the
 * quarter, read by `subject_quarter_switches`, the one place the rule is
 * written. Every reader of the journal type, the rating exam switch and the
 * rounds of a quarter goes through here.
 */
export interface QuarterSwitches extends SubjectRounds {
  readonly journal_type: 'graded' | 'attendance_only';
}

/** The key of a subject and quarter in the map `switchesOf` answers. */
export const switchKey = (subjectId: string, quarterId: string): string =>
  `${subjectId}|${quarterId}`;

/** An id no row has, for an `any` over an empty list. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

/** The switches of each subject in each quarter named, by `switchKey`. */
export async function switchesOf(
  transaction: Transaction,
  subjectIds: readonly string[],
  quarterIds: readonly string[],
): Promise<ReadonlyMap<string, QuarterSwitches>> {
  if (subjectIds.length === 0 || quarterIds.length === 0) return new Map();
  const { rows } = await sql<{
    subject_id: string;
    quarter_id: string;
    journal_type: string;
    rating_exam: boolean;
    weights_round: number;
    rating_round: number;
  }>`
    select s.id as subject_id, q.id as quarter_id, w.journal_type, w.rating_exam,
      w.weights_round, w.rating_round
    from unnest(${[...subjectIds, NO_ID]}::uuid[]) as s(id)
    cross join unnest(${[...quarterIds, NO_ID]}::uuid[]) as q(id)
    cross join lateral subject_quarter_switches(s.id, q.id) w
  `.execute(transaction);
  return new Map(
    rows.map((row) => [
      switchKey(row.subject_id, row.quarter_id),
      {
        journal_type: row.journal_type === 'attendance_only' ? 'attendance_only' : 'graded',
        rating_exam: row.rating_exam,
        weights_round: row.weights_round,
        rating_round: row.rating_round,
      },
    ]),
  );
}

/** The switches of one subject in one quarter; `undefined` for an unknown pair. */
export async function quarterSwitchesOf(
  transaction: Transaction,
  subjectId: string,
  quarterId: string,
): Promise<QuarterSwitches | undefined> {
  return (await switchesOf(transaction, [subjectId], [quarterId])).get(
    switchKey(subjectId, quarterId),
  );
}

/** The quarter of the journal's year that holds `date`, or `undefined`. */
export async function quarterOnDate(
  transaction: Transaction,
  yearId: string,
  date: string,
): Promise<{ readonly id: string; readonly number: number } | undefined> {
  return transaction
    .selectFrom('quarters')
    .select(['id', 'number'])
    .where('academic_year_id', '=', yearId)
    .where('start_date', '<=', date)
    .where('end_date', '>=', date)
    .executeTakeFirst();
}

/**
 * Holds the subject row FOR SHARE before a write of a score of the subject
 * (task 8.2, item 8 of the plan, review must-fix 3): a rating entry or "not
 * held", a number, a total or a "not held" work. The edit of the subject takes
 * it FOR UPDATE before it asks `subject_switch_blocked`, so a change of the
 * switches and a score written for the old switches never both commit. In a
 * statement of its own, before the write (`.claude/rules/database.md`).
 */
export async function holdSubjectSwitches(
  transaction: Transaction,
  subjectId: string,
): Promise<void> {
  await transaction
    .selectFrom('subjects')
    .select('id')
    .where('id', '=', subjectId)
    .forShare()
    .execute();
}
