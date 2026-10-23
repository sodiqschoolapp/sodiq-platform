import { classDisplayName } from '@sodiq/shared';
import { dayOn } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { loadCalendarSettings } from '../setup/calendar-state.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { switchKey, switchesOf } from '../setup/subject-switches.js';

/**
 * The reads of the journal grid (task 6.2, pull request #210), each one
 * statement for the whole quarter, through the branch filter of the
 * transaction. No calculation here: the figures are `journal-grid.service.ts`'s,
 * from `packages/calc`.
 */

/** A journal with what its header and scope need. */
export interface JournalRow {
  readonly id: string;
  readonly academicYearId: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly unitName: string;
  /** The grades of the class, or of the classes the group draws from. */
  readonly grades: readonly number[];
  /** The classes the group draws from; empty for a class journal. */
  readonly groupClassIds: readonly string[];
  readonly subject: {
    readonly names: { readonly uz: string; readonly ru: string; readonly en: string };
    readonly colour: string;
  };
  /**
   * The subject's switches in each quarter of the journal's year, by quarter
   * number (task 8.2, From 2.1 and 5.5c: "These switches are stored per
   * quarter"; `subject-switches.ts`). Read with `switchesOn`, `switchesIn`
   * and `plannedJournal`.
   */
  readonly quarters: readonly JournalQuarterSwitches[];
}

/** The switches of a journal's subject in one quarter of its year. */
export interface JournalQuarterSwitches {
  readonly id: string;
  readonly number: number;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly attendanceOnly: boolean;
  readonly ratingExam: boolean;
}

/** The switches of the quarter that holds `date`; `undefined` for a date in no quarter. */
export const switchesOn = (
  journal: Pick<JournalRow, 'quarters'>,
  date: string,
): JournalQuarterSwitches | undefined =>
  journal.quarters.find(
    (one) =>
      one.startDate !== null &&
      one.endDate !== null &&
      one.startDate <= date &&
      date <= one.endDate,
  );

/** The switches of a quarter by id; `undefined` for a quarter of another year. */
export const switchesIn = (
  journal: Pick<JournalRow, 'quarters'>,
  quarterId: string,
): JournalQuarterSwitches | undefined => journal.quarters.find((one) => one.id === quarterId);

/**
 * Whether the lessons on `date` take attendance only: the subject is attendance
 * only in that quarter. A date in no quarter has no lessons; it reads the
 * nearest decision, attendance only, so nothing is graded there.
 */
export const attendanceOnlyOn = (journal: Pick<JournalRow, 'quarters'>, date: string): boolean =>
  switchesOn(journal, date)?.attendanceOnly ?? true;

/**
 * Whether the journal is planned (task 8.2, decision 18): the subject is graded
 * in any quarter of its year. Attendance-only quarters are left out of the
 * figures by their switches, not by the plan.
 */
export const plannedJournal = (journal: Pick<JournalRow, 'quarters'>): boolean =>
  journal.quarters.some((one) => !one.attendanceOnly);

/** The journals of a branch, one or every one of a year, with their units and subjects. */
export async function journalRows(
  transaction: Transaction,
  branchId: string,
  filter: { readonly journalId: string } | { readonly yearId: string },
): Promise<JournalRow[]> {
  let query = transaction
    .selectFrom('journals')
    .innerJoin('subjects', 'subjects.id', 'journals.subject_id')
    .leftJoin('classes', 'classes.id', 'journals.class_id')
    .leftJoin('groups', 'groups.id', 'journals.group_id')
    .select([
      'journals.id',
      'journals.academic_year_id',
      'journals.class_id',
      'journals.group_id',
      'journals.subject_id',
      'classes.grade',
      'classes.name as class_name',
      'groups.name as group_name',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'subjects.colour',
    ])
    .where('journals.branch_id', '=', branchId);
  query =
    'journalId' in filter
      ? query.where('journals.id', '=', filter.journalId)
      : query.where('journals.academic_year_id', '=', filter.yearId);
  const rows = await query.execute();
  const yearIds = [...new Set(rows.map((row) => row.academic_year_id))].sort();
  const quarters =
    yearIds.length === 0
      ? []
      : await transaction
          .selectFrom('quarters')
          .select([
            'id',
            'academic_year_id',
            'number',
            sql<string | null>`start_date::text`.as('start_date'),
            sql<string | null>`end_date::text`.as('end_date'),
          ])
          .where('academic_year_id', 'in', yearIds)
          .orderBy('number')
          .execute();
  const switches = await switchesOf(
    transaction,
    [...new Set(rows.map((row) => row.subject_id))].sort(),
    quarters.map((quarter) => quarter.id),
  );
  const groupIds = rows.flatMap((row) => (row.group_id === null ? [] : [row.group_id]));
  const groupClasses =
    groupIds.length === 0
      ? []
      : await transaction
          .selectFrom('group_classes')
          .innerJoin('classes', 'classes.id', 'group_classes.class_id')
          .select(['group_classes.group_id', 'classes.id', 'classes.grade'])
          .where('group_classes.group_id', 'in', groupIds)
          .orderBy('classes.id')
          .execute();
  return rows.map((row) => {
    const drawn = groupClasses.filter((one) => one.group_id === row.group_id);
    return {
      id: row.id,
      academicYearId: row.academic_year_id,
      classId: row.class_id,
      groupId: row.group_id,
      subjectId: row.subject_id,
      unitName:
        row.class_id === null
          ? (row.group_name ?? '')
          : classDisplayName(row.grade ?? 0, row.class_name ?? ''),
      grades: row.class_id === null ? drawn.map((one) => one.grade) : [row.grade ?? 0],
      groupClassIds: drawn.map((one) => one.id),
      subject: {
        names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
        colour: row.colour,
      },
      quarters: quarters
        .filter((quarter) => quarter.academic_year_id === row.academic_year_id)
        .map((quarter) => {
          const own = switches.get(switchKey(row.subject_id, quarter.id));
          return {
            id: quarter.id,
            number: quarter.number,
            startDate: quarter.start_date,
            endDate: quarter.end_date,
            attendanceOnly: own?.journal_type !== 'graded',
            ratingExam: own?.journal_type === 'graded' && own.rating_exam,
          };
        }),
    };
  });
}

/** A dated lesson of a journal, as the grid reads it. */
export interface GridLessonRow {
  readonly id: string;
  readonly date: string;
  readonly startsAt: Date;
  /** Clock minutes of the day in branch time. */
  readonly start: number;
  readonly end: number;
  readonly teacherId: string | null;
  readonly teacherKind: 'person' | 'vacancy' | null;
  readonly cancelCause: string | null;
  readonly cancelReason: string | null;
}

/** The dated lessons of a journal from `from` to `to`, both included, in date and time order. */
export async function journalLessons(
  transaction: Transaction,
  journal: JournalRow,
  timeZone: string,
  from: string,
  to: string,
): Promise<GridLessonRow[]> {
  let query = transaction
    .selectFrom('lessons')
    .leftJoin('staff', 'staff.id', 'lessons.teacher_id')
    .select([
      'lessons.id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      'lessons.starts_at',
      sql<number>`(extract(epoch from (lessons.starts_at at time zone ${timeZone})::time) / 60)::int`.as(
        'start_minutes',
      ),
      sql<number>`(extract(epoch from (lessons.ends_at at time zone ${timeZone})::time) / 60)::int`.as(
        'end_minutes',
      ),
      'lessons.teacher_id',
      'staff.kind as teacher_kind',
      'lessons.cancel_cause',
      'lessons.cancel_reason',
    ])
    .where('lessons.subject_id', '=', journal.subjectId)
    .where('lessons.lesson_date', '>=', from)
    .where('lessons.lesson_date', '<=', to);
  query =
    journal.classId === null
      ? query.where('lessons.group_id', '=', journal.groupId)
      : query.where('lessons.class_id', '=', journal.classId);
  const rows = await query.orderBy('lessons.starts_at').orderBy('lessons.id').execute();
  return rows.map((row) => ({
    id: row.id,
    date: row.lesson_date,
    startsAt: row.starts_at,
    start: row.start_minutes,
    // A lesson ending at midnight reads 0: the end of the day.
    end: row.end_minutes === 0 ? 24 * 60 : row.end_minutes,
    teacherId: row.teacher_id,
    teacherKind:
      row.teacher_kind === null ? null : row.teacher_kind === 'vacancy' ? 'vacancy' : 'person',
    cancelCause: row.cancel_cause,
    cancelReason: row.cancel_reason,
  }));
}

/**
 * The lesson slot of each date whose start is `start`, read from the day
 * template of the unit's lowest grade on that date (as `gradeSlotsOn` of the
 * one-day changes), loaded once for every date.
 */
export async function slotNumbers(
  transaction: Transaction,
  branchId: string,
  grade: number | undefined,
  lessons: readonly { readonly id: string; readonly date: string; readonly start: number }[],
): Promise<Map<string, number>> {
  const found = new Map<string, number>();
  if (grade === undefined || lessons.length === 0) return found;
  const branch = await transaction
    .selectFrom('branches')
    .select('working_weekdays')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const [settings, store] = await Promise.all([
    loadCalendarSettings(transaction, branch.working_weekdays),
    loadStore(transaction),
  ]);
  const byDate = new Map<string, { lessonNumber: number; start: number }[]>();
  for (const lesson of lessons) {
    let slots = byDate.get(lesson.date);
    if (slots === undefined) {
      const day = dayOn(grade, lesson.date, settings);
      const timed = day.lessons ? dayOf(store, day.dayTemplateId, lesson.date) : null;
      slots =
        timed?.day.slots.flatMap((slot) =>
          slot.lessonNumber === null
            ? []
            : [{ lessonNumber: slot.lessonNumber, start: slot.start }],
        ) ?? [];
      byDate.set(lesson.date, slots);
    }
    const slot = slots.find((one) => one.start === lesson.start);
    if (slot !== undefined) found.set(lesson.id, slot.lessonNumber);
  }
  return found;
}

/** A work of a lesson, in the order it was added. */
export interface GridWorkRow {
  readonly id: string;
  readonly lessonId: string;
  readonly kind: 'classwork' | 'homework';
  readonly total: number | null;
  readonly notHeld: boolean;
}

export async function lessonWorks(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<GridWorkRow[]> {
  if (lessonIds.length === 0) return [];
  const rows = await transaction
    .selectFrom('journal_works')
    .select(['id', 'lesson_id', 'kind', 'total', 'not_held'])
    .where('lesson_id', 'in', [...lessonIds])
    .orderBy('created_at')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    lessonId: row.lesson_id,
    kind: row.kind === 'homework' ? 'homework' : 'classwork',
    total: row.total,
    notHeld: row.not_held,
  }));
}

export interface GridCellRow {
  readonly lessonId: string;
  readonly studentId: string;
  readonly workId: string | null;
  readonly mark: number | null;
  readonly score: number | null;
  readonly version: number;
  /** The account that wrote the value last (task 6.3, decision 16). */
  readonly changedBy: string;
}

export async function lessonCells(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<GridCellRow[]> {
  if (lessonIds.length === 0) return [];
  const rows = await transaction
    .selectFrom('journal_cells')
    .select(['lesson_id', 'student_id', 'work_id', 'mark', 'score', 'version', 'changed_by'])
    .where('lesson_id', 'in', [...lessonIds])
    .execute();
  return rows.map((row) => ({
    lessonId: row.lesson_id,
    studentId: row.student_id,
    workId: row.work_id,
    mark: row.mark,
    score: row.score,
    version: row.version,
    changedBy: row.changed_by,
  }));
}

/**
 * The categories of the reasons of absence of `studentIds` from `from` to
 * `to`, cleared ones left out (task 6.3, decision 7: never the note).
 */
export async function absenceCategories(
  transaction: Transaction,
  studentIds: readonly string[],
  from: string,
  to: string,
): Promise<{ studentId: string; date: string; category: string }[]> {
  if (studentIds.length === 0) return [];
  const rows = await transaction
    .selectFrom('student_absence_reasons')
    .select(['student_id', sql<string>`absence_date::text`.as('date'), 'category'])
    .where('student_id', 'in', [...studentIds])
    .where('absence_date', '>=', from)
    .where('absence_date', '<=', to)
    .where('category', 'is not', null)
    .orderBy('absence_date')
    .orderBy('student_id')
    .execute();
  return rows.map((row) => ({
    studentId: row.student_id,
    date: row.date,
    category: row.category ?? '',
  }));
}

/** A membership row of the journal's class or group, not withdrawn, that meets `[from, to]`. */
export interface MembershipRow {
  readonly studentId: string;
  readonly validFrom: string;
  readonly validUntil: string;
}

export async function unitMemberships(
  transaction: Transaction,
  journal: JournalRow,
  from: string,
  to: string,
): Promise<MembershipRow[]> {
  const rows =
    journal.classId === null
      ? await transaction
          .selectFrom('group_memberships')
          .select([
            'student_id',
            sql<string>`valid_from::text`.as('valid_from'),
            sql<string>`valid_until::text`.as('valid_until'),
          ])
          .where('group_id', '=', journal.groupId)
          .whereRef('valid_from', '<', 'valid_until')
          .where('valid_from', '<=', to)
          .where('valid_until', '>', from)
          .execute()
      : await transaction
          .selectFrom('class_memberships')
          .select([
            'student_id',
            sql<string>`valid_from::text`.as('valid_from'),
            sql<string>`valid_until::text`.as('valid_until'),
          ])
          .where('class_id', '=', journal.classId)
          .whereRef('valid_from', '<', 'valid_until')
          .where('valid_from', '<=', to)
          .where('valid_until', '>', from)
          .execute();
  return rows.map((row) => ({
    studentId: row.student_id,
    validFrom: row.valid_from,
    validUntil: row.valid_until,
  }));
}

export interface GridStudentRow {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly paternalName: string | null;
  readonly uid: string;
}

export async function studentsOf(
  transaction: Transaction,
  ids: readonly string[],
): Promise<GridStudentRow[]> {
  if (ids.length === 0) return [];
  const rows = await transaction
    .selectFrom('students')
    .select(['id', 'first_name', 'last_name', 'paternal_name', 'uid'])
    .where('id', 'in', [...ids])
    .execute();
  return rows.map((row) => ({
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    paternalName: row.paternal_name,
    uid: row.uid,
  }));
}

/**
 * The students of each class on a date: the class rows in force on it. A
 * Tutor of a group journal reads the rows of own classes (`edge/journal`, "A
 * Tutor opens the journal of a group that mixes three classes").
 */
export async function classesOfStudents(
  transaction: Transaction,
  studentIds: readonly string[],
  on: string,
): Promise<Map<string, string[]>> {
  const found = new Map<string, string[]>();
  if (studentIds.length === 0) return found;
  const rows = await transaction
    .selectFrom('class_memberships')
    .select(['student_id', 'class_id'])
    .where('student_id', 'in', [...studentIds])
    .whereRef('valid_from', '<', 'valid_until')
    .where('valid_from', '<=', on)
    .where('valid_until', '>', on)
    .execute();
  for (const row of rows) {
    const own = found.get(row.student_id) ?? [];
    own.push(row.class_id.toLowerCase());
    found.set(row.student_id, own);
  }
  return found;
}

/** The weights and values of the subject and quarter in the branch. */
export interface GridWeights {
  readonly daily: { attendance: number; classwork: number; homework: number } | null;
  readonly quarterly: {
    attendance: number;
    classwork: number;
    homework: number;
    ratingExam: number | null;
  } | null;
  readonly lateValue: number;
  readonly skippedValue: number;
}

export async function gridWeights(
  transaction: Transaction,
  branchId: string,
  subjectId: string,
  quarterId: string,
): Promise<GridWeights> {
  const [daily, quarterly, quarter] = await Promise.all([
    transaction
      .selectFrom('subject_daily_weights')
      .select(['attendance', 'classwork', 'homework'])
      .where('branch_id', '=', branchId)
      .where('subject_id', '=', subjectId)
      .executeTakeFirst(),
    transaction
      .selectFrom('subject_quarter_weights')
      .select(['attendance', 'classwork', 'homework', 'rating_exam'])
      .where('branch_id', '=', branchId)
      .where('subject_id', '=', subjectId)
      .where('quarter_id', '=', quarterId)
      .executeTakeFirst(),
    transaction
      .selectFrom('quarters')
      .select(['late_value', 'skipped_value'])
      .where('id', '=', quarterId)
      .executeTakeFirstOrThrow(),
  ]);
  return {
    daily: daily ?? null,
    quarterly:
      quarterly === undefined
        ? null
        : {
            attendance: quarterly.attendance,
            classwork: quarterly.classwork,
            homework: quarterly.homework,
            ratingExam: quarterly.rating_exam,
          },
    lateValue: quarter.late_value,
    skippedValue: quarter.skipped_value,
  };
}

/**
 * The school date of the newest change of the subject's weights for the
 * quarter (the entries `subject_quarter_weights.set` of 2.1), or `null`
 * (decision 22: the caller shows it only after the quarter's first day).
 */
export async function weightsChangedAt(
  transaction: Transaction,
  branchId: string,
  subjectId: string,
  quarterId: string,
  timeZone: string,
): Promise<string | null> {
  const found = await transaction
    .selectFrom('audit_log')
    .select(sql<string>`(occurred_at at time zone ${timeZone})::date::text`.as('day'))
    .where('branch_id', '=', branchId)
    .where('action', '=', 'subject_quarter_weights.set')
    .where('record_id', '=', subjectId)
    .where(sql<boolean>`details ->> 'quarterId' = ${quarterId}`)
    .orderBy('occurred_at', 'desc')
    .limit(1)
    .executeTakeFirst();
  return found?.day ?? null;
}

/** Names of staff records (surname first). */
export async function staffNames(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  const found = new Map<string, string>();
  if (ids.length === 0) return found;
  const rows = await transaction
    .selectFrom('staff')
    .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
    .where('id', 'in', [...ids])
    .execute();
  for (const row of rows) {
    found.set(
      row.id,
      row.kind === 'vacancy'
        ? (row.vacancy_name ?? '')
        : `${row.last_name ?? ''} ${row.first_name ?? ''}`.trim(),
    );
  }
  return found;
}
