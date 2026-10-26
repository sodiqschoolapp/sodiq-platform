import { Injectable } from '@nestjs/common';
import { absentNow, dailyAttendance, type AttendanceCell, type DailyAttendance } from '@sodiq/calc';
import {
  attendanceTodaySchema,
  schoolDateOf,
  type AttendanceFigure,
  type AttendanceToday,
  type AttendanceTodayQuery,
  type Role,
} from '@sodiq/shared';
import { mondayOf } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import { exemptionMarksOf } from './exemption-read.js';
import { lessonStatuses } from './lesson-status.query.js';

/**
 * The attendance of classes for the home pages (task 9.4b; `08`, Home pages by role, Tutor and
 * Head Tutor rows; `edge/journal`, Attendance figures). Worked out on read with the injected
 * clock (plan decision 12); every figure comes from `packages/calc` (`dailyAttendance`,
 * `absentNow`).
 *
 * - The cells of a class on a day are the attendance cells of the class's students (their class
 *   on the lesson's date) in the held lessons of that day, class and group lessons alike;
 *   cancelled lessons and lessons not held (`lessonStatuses`) are never read.
 * - A cell is exempt as the journal reads it (`lesson_student_exemption` through
 *   `exemptionMarksOf`): a lesson left "as attended" under an exemption is a marked cell (review
 *   correction 1).
 * - The week is Monday of the date's week to the date; the total is every class read; each one
 *   ratio of cells (plan decision 3).
 * - "Who is absent now" is read for today only, and answered for the reader's own classes as
 *   Tutor and for the Super Admin (review correction 3); "exempt now" is a live exemption of all
 *   subjects whose span holds the clock's moment in branch time (build decision).
 *
 * Who reads, from the assignments that permit the route: the Super Admin, the Head Tutor and the
 * Spiritual Vice Principal every class of the branch; a Tutor own classes.
 */

const WHOLE_ROLES: readonly Role[] = ['super_admin', 'head_tutor', 'spiritual_vice_principal'];

/** `branch_settings.attendance_percent` (0019) for a branch with no row. */
const DEFAULT_ATTENDANCE_PERCENT = 80;

/** All subjects in `exemption_spans.subject_key` (0123). */
const ALL_SUBJECTS = '00000000-0000-0000-0000-000000000000';

interface CellRow {
  readonly lesson_id: string;
  readonly lesson_date: string;
  readonly starts_at: Date;
  readonly student_id: string;
  readonly class_id: string;
  readonly mark: number | null;
}

const shown = (figure: DailyAttendance): AttendanceFigure => ({
  attended: figure.attended,
  marked: figure.marked,
  unmarked: figure.unmarked,
  exempt: figure.exempt,
  percent: figure.percent === null ? null : Number(figure.percent.roundHalfUp()),
});

const markOf = (value: number | null): AttendanceCell['mark'] =>
  value === 0 || value === 1 || value === 2 || value === 3 ? value : null;

@Injectable()
export class AttendanceTodayService {
  constructor(private readonly transactions: Transactions) {}

  read(access: Access, query: AttendanceTodayQuery): Promise<AttendanceToday> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const now = await transactionMoment(transaction);
      const today = schoolDateOf(now, branch.time_zone);
      const date = query.date ?? today;
      const weekFrom = mondayOf(date);

      const whole = access.permitting.some((one) => WHOLE_ROLES.includes(one.role));
      const superAdmin = access.permitting.some((one) => one.role === 'super_admin');
      const own = new Set(
        access.permitting
          .filter((one) => one.role === 'tutor')
          .flatMap((one) => one.classIds.map((id) => id.toLowerCase())),
      );
      let classQuery = transaction
        .selectFrom('classes')
        .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
        .select(['classes.id', 'classes.name', 'classes.grade'])
        .where('classes.branch_id', '=', branchId)
        .where('classes.archived_at', 'is', null)
        .where('academic_years.start_date', '<=', date)
        .where('academic_years.end_date', '>=', date);
      if (!whole) {
        if (own.size === 0) return empty(date, weekFrom, await thresholdOf(transaction, branchId));
        classQuery = classQuery.where('classes.id', 'in', [...own]);
      }
      const classes = (await classQuery.execute()).sort(
        (a, b) => a.grade - b.grade || a.name.localeCompare(b.name, 'ru') || (a.id < b.id ? -1 : 1),
      );
      const threshold = await thresholdOf(transaction, branchId);
      if (classes.length === 0) return empty(date, weekFrom, threshold);

      const cells = await cellsOf(
        transaction,
        branchId,
        classes.map((one) => one.id),
        weekFrom,
        date,
        now,
      );
      const exempt = await exemptionMarksOf(transaction, [
        ...new Set(cells.map((one) => one.lesson_id)),
      ]);
      const cellOf = (row: CellRow): AttendanceCell => ({
        mark: markOf(row.mark),
        exempt: exempt.get(row.lesson_id)?.has(row.student_id) ?? false,
      });

      // "Absent now": today only, the classes whose names the reader may be shown.
      const named = new Set(
        classes.filter((one) => superAdmin || own.has(one.id)).map((one) => one.id),
      );
      const absent =
        date === today
          ? await absentNowOf(
              transaction,
              cells.filter((row) => row.lesson_date === date && named.has(row.class_id)),
              cellOf,
              now,
              branch.time_zone,
            )
          : new Map<string, { studentId: string; since: Date }[]>();
      const studentIds = [...new Set([...absent.values()].flat().map((one) => one.studentId))];
      const names =
        studentIds.length === 0
          ? []
          : await transaction
              .selectFrom('students')
              .select(['id', 'first_name', 'last_name', 'paternal_name'])
              .where('id', 'in', studentIds)
              .execute();
      const nameOf = new Map(names.map((one) => [one.id, one]));

      const answer = classes.map((one) => {
        const mine = cells.filter((row) => row.class_id === one.id);
        const day = dailyAttendance(mine.filter((row) => row.lesson_date === date).map(cellOf));
        const percent = day.percent === null ? null : Number(day.percent.roundHalfUp());
        return {
          class: { id: one.id, name: one.name, grade: one.grade },
          day: shown(day),
          week: shown(dailyAttendance(mine.map(cellOf))),
          below: percent !== null && percent < threshold,
          absentNow: named.has(one.id)
            ? (absent.get(one.id) ?? []).flatMap((entry) => {
                const student = nameOf.get(entry.studentId);
                return student === undefined
                  ? []
                  : [
                      {
                        student: {
                          id: student.id,
                          firstName: student.first_name,
                          lastName: student.last_name,
                          paternalName: student.paternal_name,
                        },
                        since: entry.since.toISOString(),
                      },
                    ];
              })
            : null,
        };
      });
      for (const one of answer) {
        one.absentNow?.sort(
          (a, b) =>
            a.student.lastName.localeCompare(b.student.lastName, 'ru') ||
            a.student.firstName.localeCompare(b.student.firstName, 'ru') ||
            (a.student.id < b.student.id ? -1 : 1),
        );
      }
      return attendanceTodaySchema.parse({
        date,
        weekFrom,
        threshold,
        total: shown(dailyAttendance(cells.filter((row) => row.lesson_date === date).map(cellOf))),
        classes: answer,
      });
    });
  }
}

async function thresholdOf(transaction: Transaction, branchId: string): Promise<number> {
  const row = await transaction
    .selectFrom('branch_settings')
    .select('attendance_percent')
    .where('branch_id', '=', branchId)
    .executeTakeFirst();
  return row?.attendance_percent ?? DEFAULT_ATTENDANCE_PERCENT;
}

function empty(date: string, weekFrom: string, threshold: number): AttendanceToday {
  const none = shown(dailyAttendance([]));
  return attendanceTodaySchema.parse({ date, weekFrom, threshold, total: none, classes: [] });
}

/**
 * The attendance cells of the students of the classes named, in the held lessons of the branch
 * from `from` to `to`: one row per lesson and student who was a member of the lesson's class or
 * group on its date and of one of the classes on that date, with the stored mark or none.
 */
async function cellsOf(
  transaction: Transaction,
  branchId: string,
  classIds: readonly string[],
  from: string,
  to: string,
  now: Date,
): Promise<CellRow[]> {
  const lessons = await transaction
    .selectFrom('lessons')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', from)
    .where('lesson_date', '<=', to)
    .where('starts_at', '<=', now)
    .where('cancel_cause', 'is', null)
    .execute();
  const statuses = await lessonStatuses(
    transaction,
    branchId,
    lessons.map((one) => one.id),
    now,
  );
  const held = lessons.map((one) => one.id).filter((id) => statuses.get(id)?.held === true);
  if (held.length === 0) return [];
  const found = await sql<CellRow>`
    with l as (
      select id, lesson_date, starts_at, class_id, group_id from lessons
      where id = any(${held}::uuid[])
    ),
    members as (
      select l.id as lesson_id, l.lesson_date, l.starts_at, m.student_id
      from l join class_memberships m on m.class_id = l.class_id
        and m.valid_from < m.valid_until
        and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
      union
      select l.id, l.lesson_date, l.starts_at, m.student_id
      from l join group_memberships m on m.group_id = l.group_id
        and m.valid_from < m.valid_until
        and m.valid_from <= l.lesson_date and l.lesson_date < m.valid_until
    )
    select x.lesson_id, x.lesson_date::text as lesson_date, x.starts_at, x.student_id,
      c.class_id, cell.mark
    from members x
    join class_memberships c on c.student_id = x.student_id
      and c.valid_from < c.valid_until
      and c.valid_from <= x.lesson_date and x.lesson_date < c.valid_until
      and c.class_id = any(${[...classIds]}::uuid[])
    left join journal_cells cell on cell.lesson_id = x.lesson_id
      and cell.student_id = x.student_id and cell.work_id is null
    order by x.starts_at, x.lesson_id, x.student_id
  `.execute(transaction);
  return found.rows;
}

/** The students absent now of each class (`absentNow`), from today's cells in start order. */
async function absentNowOf(
  transaction: Transaction,
  today: readonly CellRow[],
  cellOf: (row: CellRow) => AttendanceCell,
  now: Date,
  timeZone: string,
): Promise<Map<string, { studentId: string; since: Date }[]>> {
  const byStudent = new Map<string, CellRow[]>();
  for (const row of today) {
    if (cellOf(row).exempt) continue;
    const key = `${row.class_id}|${row.student_id}`;
    byStudent.set(key, [...(byStudent.get(key) ?? []), row]);
  }
  const studentIds = [...new Set(today.map((row) => row.student_id))];
  const exemptNow =
    studentIds.length === 0
      ? new Set<string>()
      : new Set(
          (
            await sql<{ student_id: string }>`
              select distinct s.student_id from exemption_spans s
              where s.live
                and s.student_id = any(${studentIds}::uuid[])
                and s.subject_key = ${ALL_SUBJECTS}::uuid
                and s.span @> (${now}::timestamptz at time zone ${timeZone})
            `.execute(transaction)
          ).rows.map((row) => row.student_id),
        );
  const answer = new Map<string, { studentId: string; since: Date }[]>();
  for (const rows of byStudent.values()) {
    const first = rows[0];
    if (first === undefined) continue;
    const lessons = rows.map((row) => ({ mark: markOf(row.mark) }));
    if (!absentNow({ lessons, exemptNow: exemptNow.has(first.student_id) })) continue;
    const latest = [...rows].reverse().find((row) => row.mark !== null);
    if (latest === undefined) continue;
    answer.set(first.class_id, [
      ...(answer.get(first.class_id) ?? []),
      { studentId: first.student_id, since: latest.starts_at },
    ]);
  }
  return answer;
}

/** The branch's attendance of a day, one ratio over the cells of every class (the branch summary). */
export async function branchAttendanceOn(
  transaction: Transaction,
  branchId: string,
  date: string,
  now: Date,
): Promise<AttendanceFigure> {
  const classes = await transaction
    .selectFrom('classes')
    .select('id')
    .where('branch_id', '=', branchId)
    .execute();
  if (classes.length === 0) return shown(dailyAttendance([]));
  const cells = await cellsOf(
    transaction,
    branchId,
    classes.map((one) => one.id),
    date,
    date,
    now,
  );
  const exempt = await exemptionMarksOf(transaction, [
    ...new Set(cells.map((one) => one.lesson_id)),
  ]);
  return shown(
    dailyAttendance(
      cells.map((row) => ({
        mark: markOf(row.mark),
        exempt: exempt.get(row.lesson_id)?.has(row.student_id) ?? false,
      })),
    ),
  );
}

