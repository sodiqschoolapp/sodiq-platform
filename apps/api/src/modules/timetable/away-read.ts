import { AWAY_CAUSES, type AwayCause } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';

/**
 * The persons who cannot teach, as every reader of a lesson's state sees them
 * (tasks 5.7a-1 and 5.7a-2a, pull requests #185 and #186): read through
 * `teachers_away` (0097), ids, causes and moments only, so that a branch
 * whose link to the person was removed while it holds the person's lessons
 * reads the same state as every other. A lesson is away when its teacher has
 * a span holding its start, `[applies_from, applies_until)`: a live absence,
 * an inactive or left status, a lock of the account. A status or a lock
 * writes no lesson (decision 2): the lesson keeps its teacher.
 */

/** A span of a person away, half-open; `until` `null` for open-ended. */
export interface AwaySpan {
  readonly staffId: string;
  readonly cause: AwayCause;
  /** The absence of an `absence` span; `null` for the others. */
  readonly absenceId: string | null;
  readonly from: Date;
  readonly until: Date | null;
}

/**
 * The causes that the person recorded as having taught the lesson after all
 * settles (`lesson_absence_taught`, decision 7): an absence and a lock. An
 * inactive or left person is not offered by the correction on the date.
 */
const SETTLED_BY_TAUGHT: readonly AwayCause[] = ['absence', 'locked'];

const rank = (cause: AwayCause): number => AWAY_CAUSES.indexOf(cause);

/** The spans of the persons that meet `[from, until)`, by person. */
export async function awaySpans(
  transaction: Transaction,
  staffIds: readonly string[],
  from: Date,
  until: Date | null,
): Promise<Map<string, AwaySpan[]>> {
  const spans = new Map<string, AwaySpan[]>();
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return spans;
  const { rows } = await sql<{
    staff_id: string;
    cause: AwayCause;
    absence_id: string | null;
    applies_from: Date;
    applies_until: Date | null;
  }>`select * from teachers_away(${ids}::uuid[], ${from}, ${until})`.execute(transaction);
  for (const row of rows) {
    spans.set(row.staff_id, [
      ...(spans.get(row.staff_id) ?? []),
      {
        staffId: row.staff_id,
        cause: row.cause,
        absenceId: row.absence_id,
        from: row.applies_from,
        until: row.applies_until,
      },
    ]);
  }
  return spans;
}

/**
 * The span of the person holding `at` that names the cause (decision 6: the
 * most lasting first), leaving out the causes `taught` settles; `null` when
 * none holds.
 */
export function awayAt(
  spans: ReadonlyMap<string, readonly AwaySpan[]>,
  staffId: string | null,
  at: Date,
  taught = false,
): AwaySpan | null {
  if (staffId === null) return null;
  const holding = (spans.get(staffId) ?? []).filter(
    (one) =>
      one.from.getTime() <= at.getTime() &&
      (one.until === null || at.getTime() < one.until.getTime()) &&
      !(taught && SETTLED_BY_TAUGHT.includes(one.cause)),
  );
  return holding.sort((a, b) => rank(a.cause) - rank(b.cause))[0] ?? null;
}

/** A stored lesson as the state readers name it. */
export interface StateLesson {
  readonly id: string;
  readonly teacherId: string | null;
  readonly startsAt: Date;
}

/**
 * The stored lessons whose teacher is away at their start, each with the span
 * that names the cause; a lesson recorded as taught after all
 * (`lesson_absence_taught`) is away only by an inactive or left status.
 */
export async function awayLessons(
  transaction: Transaction,
  lessons: readonly StateLesson[],
): Promise<Map<string, AwaySpan>> {
  const away = new Map<string, AwaySpan>();
  const withTeacher = lessons.filter((one) => one.teacherId !== null);
  if (withTeacher.length === 0) return away;
  const times = withTeacher.map((one) => one.startsAt.getTime());
  const spans = await awaySpans(
    transaction,
    withTeacher.map((one) => one.teacherId ?? ''),
    new Date(Math.min(...times)),
    new Date(Math.max(...times) + 1),
  );
  if (spans.size === 0) return away;
  const candidates = withTeacher.filter(
    (one) => awayAt(spans, one.teacherId, one.startsAt) !== null,
  );
  if (candidates.length === 0) return away;
  const taught = new Set(
    (
      await transaction
        .selectFrom('lesson_absence_taught')
        .select('lesson_id')
        // One array parameter, not one per lesson (65,535 parameters a statement).
        .where(sql<boolean>`lesson_id = any(${candidates.map((one) => one.id)}::uuid[])`)
        .execute()
    ).map((row) => row.lesson_id),
  );
  for (const one of candidates) {
    const span = awayAt(spans, one.teacherId, one.startsAt, taught.has(one.id));
    if (span !== null) away.set(one.id, span);
  }
  return away;
}

/** Whether the correction may record the same person on the lesson: away by a cause it settles. */
export const settledByTaught = (span: AwaySpan | undefined): boolean =>
  span !== undefined && SETTLED_BY_TAUGHT.includes(span.cause);
