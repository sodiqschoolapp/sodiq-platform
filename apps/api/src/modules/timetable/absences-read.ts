import { listName, schoolDateOf, type DayChangesAnswer } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { dayBeginnings } from './dated-check.js';

/**
 * The absences as the absence's own readers see them (task 5.7a-1,
 * pull request #185, decisions 3, 5 and 12): read through
 * `absences_of_teachers` (0096), ids and moments only, so that a branch
 * whose link to the person was removed while it holds the person's lessons
 * reads the same state as every other. A lesson is absent when its teacher
 * has a live absence holding its start, `[applies_from, applies_until)`, and
 * the lesson has no `lesson_absence_taught` row.
 */

const MINUTE = 60_000;

/** A live absence of a person, half-open; `until` `null` for open-ended. */
export interface AbsenceSpan {
  readonly staffId: string;
  readonly absenceId: string;
  readonly from: Date;
  readonly until: Date | null;
}

/** The live absences of the persons that meet `[from, until)`, by person. */
export async function absenceSpans(
  transaction: Transaction,
  staffIds: readonly string[],
  from: Date,
  until: Date | null,
): Promise<Map<string, AbsenceSpan[]>> {
  const spans = new Map<string, AbsenceSpan[]>();
  const ids = [...new Set(staffIds)];
  if (ids.length === 0) return spans;
  const { rows } = await sql<{
    staff_id: string;
    absence_id: string;
    applies_from: Date;
    applies_until: Date | null;
  }>`select * from absences_of_teachers(${ids}::uuid[], ${from}, ${until})`.execute(transaction);
  for (const row of rows) {
    spans.set(row.staff_id, [
      ...(spans.get(row.staff_id) ?? []),
      {
        staffId: row.staff_id,
        absenceId: row.absence_id,
        from: row.applies_from,
        until: row.applies_until,
      },
    ]);
  }
  return spans;
}

/** The absence of the person holding `at`, or `null`. */
export function absenceAt(
  spans: ReadonlyMap<string, readonly AbsenceSpan[]>,
  staffId: string | null,
  at: Date,
): AbsenceSpan | null {
  if (staffId === null) return null;
  return (
    spans
      .get(staffId)
      ?.find(
        (one) =>
          one.from.getTime() <= at.getTime() &&
          (one.until === null || at.getTime() < one.until.getTime()),
      ) ?? null
  );
}

/** A lesson a publish or a withdraw writes: its date, its start in minutes of the day, its teachers. */
export interface RunLesson {
  readonly date: string;
  readonly start: number;
  readonly teacherIds: readonly string[];
}

/**
 * The live absences of the teachers of a run's new lessons that meet its
 * dates, each with the number of those lessons it puts under "needs a
 * teacher" (decision 7): always kept, nothing to settle, nothing written.
 */
export async function runAbsences(
  transaction: Transaction,
  branchId: string,
  lessons: readonly RunLesson[],
): Promise<DayChangesAnswer['absences']> {
  const withTeacher = lessons.filter((one) => one.teacherIds.length > 0);
  if (withTeacher.length === 0) return [];
  const dates = withTeacher.map((one) => one.date).sort();
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const begins = await dayBeginnings(
    transaction,
    branch.time_zone,
    dates[0] ?? '',
    dates[dates.length - 1] ?? '',
  );
  const startOf = (one: RunLesson) => new Date(begins(one.date).getTime() + one.start * MINUTE);
  const times = withTeacher.map((one) => startOf(one).getTime());
  const spans = await absenceSpans(
    transaction,
    withTeacher.flatMap((one) => one.teacherIds),
    new Date(Math.min(...times)),
    new Date(Math.max(...times) + 1),
  );
  const counts = new Map<string, { span: AbsenceSpan; lessons: number }>();
  for (const one of withTeacher) {
    for (const teacherId of one.teacherIds) {
      const span = absenceAt(spans, teacherId, startOf(one));
      if (span === null) continue;
      const found = counts.get(span.absenceId) ?? { span, lessons: 0 };
      counts.set(span.absenceId, { span, lessons: found.lessons + 1 });
    }
  }
  if (counts.size === 0) return [];
  const rows = await transaction
    .selectFrom('absences')
    .innerJoin('staff', 'staff.id', 'absences.staff_id')
    .select([
      'absences.id',
      'absences.starts_on',
      'absences.ends_on',
      'staff.first_name',
      'staff.last_name',
    ])
    .where('absences.id', 'in', [...counts.keys()])
    .execute();
  const rowOf = new Map(rows.map((row) => [row.id, row]));
  return [...counts.values()]
    .map(({ span, lessons }) => {
      const row = rowOf.get(span.absenceId);
      // A person the branch no longer sees is named by nothing, and the days
      // are read from the moments (decision 3; permission review should-fix 4).
      if (row === undefined) {
        return {
          id: span.absenceId,
          name: '',
          startsOn: schoolDateOf(span.from, branch.time_zone),
          endsOn:
            span.until === null
              ? null
              : schoolDateOf(new Date(span.until.getTime() - 1), branch.time_zone),
          lessons,
        };
      }
      return {
        id: span.absenceId,
        name: listName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' }),
        startsOn: row.starts_on,
        endsOn: row.ends_on,
        lessons,
      };
    })
    .sort((a, b) => (a.startsOn < b.startsOn ? -1 : a.startsOn > b.startsOn ? 1 : 0));
}
