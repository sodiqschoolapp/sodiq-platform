import { sql } from 'kysely';
import { exemptionMarksOf } from '../../journal/exemption-read.js';
import { journalRows } from '../../journal/journal-grid.query.js';
import { lessonsCounted } from '../../journal/lesson-counted.js';
import { lessonStatusFacts } from '../../journal/lesson-status.query.js';
import type { BranchMoment } from '../branch-moment.js';
import type { QuarterRow } from '../early-warning.service.js';

/**
 * The attendance unit of the prepared report totals (task 9.3b-2; `08`, Analytics in Release 1,
 * Attendance; `07`, Effect on totals, "Attendance reports and daily percent"; `edge/journal`,
 * Attendance figures). One unit is a journal in a quarter; its value is, for each **held**
 * lesson of the journal dated in the quarter (`edge/00-definitions`, Held lesson, as the status
 * reader decides it: `lessonStatusFacts`), the counts of its attendance cells by the class of
 * each student on the lesson's date:
 *
 * - a member of the lesson's class or group on its date is one cell;
 * - a cell is exempt as the journal reads it (`exemptionMarksOf`): exempt is its own count, never
 *   absent, and out of the number expected; a lesson left "as attended" under an exemption is a
 *   marked cell, as on the home pages (9.4b review correction 1);
 * - otherwise its stored mark: 1 present, 2 late, 0 absent, 3 skipped, none unmarked.
 *
 * A lesson becomes held at its start: the unit's next moment is the next lesson start of the
 * journal (`nextChangeOf`), so the counts are never older than the lessons held. Nothing is
 * calculated here: the percents come from `packages/calc` on read.
 */

export interface AttendanceCounts {
  readonly present: number;
  readonly late: number;
  readonly absent: number;
  readonly skipped: number;
  readonly unmarked: number;
  readonly exempt: number;
}

export interface AttendanceClassCounts extends AttendanceCounts {
  /** The student's class on the lesson's date; `null` for a member of no class that day. */
  readonly classId: string | null;
}

export interface AttendanceLesson {
  readonly lessonId: string;
  readonly journalId: string;
  readonly subjectId: string;
  readonly date: string;
  /** The start in minutes of the day, branch time: the slot's clock time (build decision). */
  readonly start: number;
  readonly startsAt: Date;
  /** Who the lesson counts for (`lessonsCounted`); `null` for nobody (a vacancy). */
  readonly teacherId: string | null;
  readonly classes: readonly AttendanceClassCounts[];
}

export const NO_COUNTS: AttendanceCounts = Object.freeze({
  present: 0,
  late: 0,
  absent: 0,
  skipped: 0,
  unmarked: 0,
  exempt: 0,
});

type Category = keyof AttendanceCounts;

const categoryOf = (mark: number | null, exempt: boolean): Category => {
  if (exempt) return 'exempt';
  if (mark === 1) return 'present';
  if (mark === 2) return 'late';
  if (mark === 0) return 'absent';
  if (mark === 3) return 'skipped';
  return 'unmarked';
};

/** The held lessons of a journal in a quarter with their counts, read from source. */
export async function attendanceOfJournal(
  moment: BranchMoment,
  quarter: QuarterRow,
  journalId: string,
): Promise<AttendanceLesson[]> {
  const { transaction, branchId } = moment;
  const [journal] = await journalRows(transaction, branchId, { journalId });
  if (journal === undefined) return [];
  const lessons = (
    await sql<{
      id: string;
      lesson_date: string;
      start: number;
      starts_at: Date;
      teacher_id: string | null;
    }>`
      select l.id, l.lesson_date::text as lesson_date, l.teacher_id, l.starts_at,
        (extract(epoch from (l.starts_at at time zone ${moment.timeZone})::time) / 60)::int as start
      from lessons l
      where l.branch_id = ${branchId} and l.subject_id = ${journal.subjectId}
        and ${
          journal.classId === null
            ? sql`l.class_id is null and l.group_id = ${journal.groupId}`
            : sql`l.class_id = ${journal.classId}`
        }
        and l.lesson_date between ${quarter.startDate}::date and ${quarter.endDate}::date
        and l.starts_at <= ${moment.now}
        and l.cancel_cause is null
      order by l.starts_at, l.id
    `.execute(transaction)
  ).rows;
  if (lessons.length === 0) return [];
  const facts = await lessonStatusFacts(
    transaction,
    branchId,
    lessons.map((one) => one.id),
    moment.now,
  );
  const held = lessons.filter((one) => facts.get(one.id)?.facts?.held === true);
  if (held.length === 0) return [];
  const heldIds = held.map((one) => one.id);
  const cells = (
    await sql<{
      lesson_id: string;
      student_id: string;
      class_id: string | null;
      mark: number | null;
    }>`
      with l as (
        select id, lesson_date, class_id, group_id from lessons where id = any(${heldIds}::uuid[])
      ),
      members as (
        select l.id as lesson_id, l.lesson_date, m.student_id
        from l join class_memberships m on m.class_id = l.class_id
          and m.valid_from < m.valid_until
          and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
        union
        select l.id, l.lesson_date, m.student_id
        from l join group_memberships m on m.group_id = l.group_id
          and m.valid_from < m.valid_until
          and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
      )
      select x.lesson_id, x.student_id, c.class_id, cell.mark
      from members x
      left join class_memberships c on c.student_id = x.student_id
        and c.valid_from < c.valid_until
        and c.valid_from <= x.lesson_date and x.lesson_date < c.valid_until
      left join journal_cells cell on cell.lesson_id = x.lesson_id
        and cell.student_id = x.student_id and cell.work_id is null
      order by x.lesson_id, x.student_id
    `.execute(transaction)
  ).rows;
  const exempt = await exemptionMarksOf(transaction, heldIds);
  const counted = await lessonsCounted(
    transaction,
    branchId,
    held.map((one) => ({
      id: one.id,
      journalId,
      date: one.lesson_date,
      teacherId: one.teacher_id,
    })),
  );
  const byLesson = new Map<string, Map<string | null, Record<Category, number>>>();
  for (const cell of cells) {
    const classes =
      byLesson.get(cell.lesson_id) ?? new Map<string | null, Record<Category, number>>();
    byLesson.set(cell.lesson_id, classes);
    const counts = classes.get(cell.class_id) ?? { ...NO_COUNTS };
    classes.set(cell.class_id, counts);
    counts[categoryOf(cell.mark, exempt.get(cell.lesson_id)?.has(cell.student_id) ?? false)] += 1;
  }
  return held.map((one) => ({
    lessonId: one.id,
    journalId,
    subjectId: journal.subjectId,
    date: one.lesson_date,
    start: one.start,
    startsAt: new Date(one.starts_at),
    teacherId: counted.get(one.id) ?? null,
    classes: [...(byLesson.get(one.id) ?? new Map<string | null, Record<Category, number>>())]
      .map(([classId, counts]) => ({ classId, ...counts }))
      .sort((a, b) => (a.classId ?? '').localeCompare(b.classId ?? '')),
  }));
}
