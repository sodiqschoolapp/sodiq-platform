import { Injectable } from '@nestjs/common';
import {
  classDisplayName,
  listName,
  schoolDateOf,
  timetableViewSchema,
  viewAxisOf,
  viewChoicesSchema,
  viewDates,
  type BranchViewQuery,
  type ClassViewQuery,
  type DaySlot,
  type Role,
  type RoomViewQuery,
  type TeacherViewQuery,
  type TimetableView,
  type ViewBusy,
  type ViewChoices,
  type ViewChoicesQuery,
  type ViewDay,
  type ViewExam,
  type ViewKind,
  type ViewLesson,
  type ViewSpan,
} from '@sodiq/shared';
import { dayOn, weekdayOf } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { tutorClassesAt } from '../access/class-scope.js';
import type { CurrentAssignment } from '../access/current-assignments.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import { loadCalendarSettings, loadEntries } from '../setup/calendar-state.js';
import { notFound } from '../setup/setup-refusals.js';
import { claimsElsewhere, datedLessonsOf } from './dated-check.js';
import { isGeneratedCause } from './dated-lessons.js';
import { dayLessonsOf, gradeSlotsOn } from './day-changes.service.js';
import { examsOf } from './exams.service.js';
import { TimetablePattern } from './pattern.service.js';
import { storedLessonsOn, type StoredDayLesson } from './stored-day.js';
import { hasStoredLessons } from './stored-lessons.js';
import { Timetable } from './timetable.service.js';
import { versionOnDate, type VersionInForce } from './version-on-date.js';

/**
 * The read-only timetable views (task 5.9a, pull request #197; `06`, Views
 * and outputs): by class, by teacher, by room and for the whole school, by
 * day or by week, from the dated lessons with every one-day change applied
 * (decision 5). The area `timetable_views` lets nine roles in; the scope of
 * each is decided here, for every request (decisions 3 and 4):
 *
 * | Role | School | Class | Teacher | Room |
 * | --- | --- | --- | --- | --- |
 * | Super Admin, Principal, both Vice Principals | yes | every | every | every |
 * | Head Tutor | yes | every | own | no |
 * | Tutor | yes | own (rows in force now) | own | no |
 * | Head Teachers | no | no | own; teachers of own subjects, in them | no |
 * | Teacher | no | no | own | no |
 *
 * The teacher and room scopes come from this table by role, never from
 * `classesInScope` or `subjectsInScope`, which answer "all" for the Head Tutor.
 */

/** The roles that see the whole branch: `06`, "Principal and Vice Principals the whole branch". */
const WHOLE_BRANCH: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
];

const SUBJECT_HEADS: readonly Role[] = ['head_teacher', 'senior_head_teacher'];

/** What the caller may see in the branch of the request. */
interface Scope {
  readonly whole: boolean;
  readonly school: boolean;
  /** `all`, or the classes of the caller's Tutor rows in force now (decision 12). */
  readonly classes: 'all' | ReadonlySet<string>;
  /** The subjects of the caller's Head Teacher appointments; empty for none. */
  readonly subjects: ReadonlySet<string>;
  /** The caller's own staff record in the branch, or `null`. */
  readonly own: string | null;
}

/** Which lessons and exams of the branch a view takes, by date. */
interface Pick {
  readonly lesson: (lesson: ViewLesson) => boolean;
  /** The rooms of an exam the view shows; none leaves the exam out. */
  readonly examRooms: (exam: DayExam) => DayExam['rooms'];
}

const MINUTE = 60_000;

@Injectable()
export class TimetableViews {
  constructor(
    private readonly transactions: Transactions,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
  ) {}

  /** What the caller may open on the date. */
  choices(access: Access, query: ViewChoicesQuery): Promise<ViewChoices> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scope = await scopeOf(transaction, access);
      const classes = await transaction
        .selectFrom('classes')
        .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
        .select(['classes.id', 'classes.grade', 'classes.name'])
        .where('classes.branch_id', '=', branchId)
        .where('classes.archived_at', 'is', null)
        .where('academic_years.status', '!=', 'closed')
        .orderBy('classes.grade')
        .orderBy('classes.name')
        .execute();
      const today = await todayOf(transaction, branchId);
      const teachers = await teachersOf(transaction, branchId, scope, query.date ?? today);
      const rooms = scope.whole
        ? await transaction
            .selectFrom('rooms')
            .select(['id', 'name'])
            .where('branch_id', '=', branchId)
            .orderBy('name')
            .execute()
        : [];
      return viewChoicesSchema.parse({
        today,
        branch: scope.school,
        classes: classes
          .filter((one) => scope.classes === 'all' || scope.classes.has(one.id))
          .map((one) => ({ id: one.id, name: classDisplayName(one.grade, one.name) })),
        teachers,
        rooms,
        own: scope.own,
      });
    });
  }

  /** The whole school: every class of the branch. */
  branch(access: Access, query: BranchViewQuery): Promise<TimetableView> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scope = await scopeOf(transaction, access);
      if (!scope.school) throw scopeRefusal();
      return this.viewOf(transaction, access, branchId, 'branch', query.date, query.span, {
        subject: null,
        pick: () => ({ lesson: () => true, examRooms: (exam) => exam.rooms }),
      });
    });
  }

  /** A class: its own lessons and those of its groups, and the exams it sits. */
  class(access: Access, query: ClassViewQuery): Promise<TimetableView> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('classes')
        .select(['id', 'grade', 'name'])
        .where('id', '=', query.classId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (found === undefined) throw notFound();
      const scope = await scopeOf(transaction, access);
      if (scope.classes !== 'all' && !scope.classes.has(found.id)) throw scopeRefusal();
      return this.viewOf(transaction, access, branchId, 'class', query.date, query.span, {
        subject: { id: found.id, name: classDisplayName(found.grade, found.name) },
        classId: found.id,
        pick: () => ({
          lesson: (lesson) => lesson.classIds.includes(found.id),
          examRooms: (exam) => exam.rooms.filter((room) => room.classIds.includes(found.id)),
        }),
      });
    });
  }

  /**
   * A teacher or a vacancy: the lessons they teach, those a substitute took
   * from them (decision 7), the exams they invigilate, and their busy blocks
   * in other branches (decision 8). A Head Teacher reading another teacher
   * sees only the days on which a load row of a subject in scope names them,
   * only the lessons and exams of those subjects, and no busy block (decision 4).
   */
  teacher(access: Access, query: TeacherViewQuery): Promise<TimetableView> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('staff')
        .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
        .where('id', '=', query.staffId)
        .executeTakeFirst();
      // Read through the branch filter: a staff record linked to another branch only is not found.
      if (found === undefined) {
        throw notFound();
      }
      const scope = await scopeOf(transaction, access);
      const own = scope.own === found.id;
      let subjectsOn: ((date: string) => ReadonlySet<string>) | null = null;
      if (!own && !scope.whole) {
        if (scope.subjects.size === 0 || found.kind === 'vacancy') throw scopeRefusal();
        const dates = viewDates(query.date, query.span);
        const byDate = await subjectsTaughtOn(transaction, branchId, found.id, dates);
        const shown = new Map(
          dates.map((date) => [
            date,
            new Set([...(byDate.get(date) ?? [])].filter((id) => scope.subjects.has(id))),
          ]),
        );
        if (![...shown.values()].some((ids) => ids.size > 0)) throw scopeRefusal();
        subjectsOn = (date) => shown.get(date) ?? new Set();
      }
      const name =
        found.kind === 'vacancy'
          ? (found.vacancy_name ?? '')
          : listName({ firstName: found.first_name ?? '', lastName: found.last_name ?? '' });
      return this.viewOf(transaction, access, branchId, 'teacher', query.date, query.span, {
        subject: { id: found.id, name },
        busyOf: found.kind === 'person' && subjectsOn === null ? found.id : null,
        pick: (date) => {
          const subjects = subjectsOn?.(date) ?? null;
          return {
            lesson: (lesson) =>
              (lesson.teacher?.id === found.id || lesson.replacedHere) &&
              (subjects === null || subjects.has(lesson.subject.id)),
            examRooms: (exam) =>
              subjects !== null && (exam.subject === null || !subjects.has(exam.subject.id))
                ? []
                : exam.rooms.filter((room) => room.invigilatorIds.includes(found.id)),
          };
        },
        replacedOf: found.id,
      });
    });
  }

  /** A room: the lessons and exams held in it. */
  room(access: Access, query: RoomViewQuery): Promise<TimetableView> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('rooms')
        .select(['id', 'name'])
        .where('id', '=', query.roomId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (found === undefined) throw notFound();
      const scope = await scopeOf(transaction, access);
      if (!scope.whole) throw scopeRefusal();
      return this.viewOf(transaction, access, branchId, 'room', query.date, query.span, {
        subject: { id: found.id, name: found.name },
        pick: () => ({
          lesson: (lesson) => lesson.room?.id === found.id,
          examRooms: (exam) => exam.rooms.filter((room) => room.room.id === found.id),
        }),
      });
    });
  }

  private async viewOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    kind: ViewKind,
    date: string,
    span: ViewSpan,
    input: {
      readonly subject: { id: string; name: string } | null;
      readonly pick: (date: string) => Pick;
      /** The class of a class view, whose own template gives the day's slots. */
      readonly classId?: string;
      /** The person whose busy blocks in other branches are shown. */
      readonly busyOf?: string | null;
      /** The teacher whose lessons a substitute took, marked on a teacher view. */
      readonly replacedOf?: string;
    },
  ): Promise<TimetableView> {
    const dates = viewDates(date, span);
    const branch = await transaction
      .selectFrom('branches')
      .select(['time_zone', 'working_weekdays'])
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const moment = await transactionMoment(transaction);
    const years = await transaction
      .selectFrom('academic_years')
      .select(['id', 'start_date', 'end_date'])
      .where('branch_id', '=', branchId)
      .execute();
    const yearOn = (day: string) =>
      years.find((one) => one.start_date <= day && day <= one.end_date) ?? null;
    if (dates.every((day) => yearOn(day) === null)) {
      throw new ApiException('calendar_outside_year', 422);
    }
    const [settings, entries] = await Promise.all([
      loadCalendarSettings(transaction, branch.working_weekdays),
      loadEntries(transaction),
    ]);
    const entryName = new Map(entries.map((one) => [one.id, one.name]));
    const classes = await transaction
      .selectFrom('classes')
      .select(['id', 'grade', 'name', 'archived_at', 'academic_year_id'])
      .where('branch_id', '=', branchId)
      .orderBy('grade')
      .orderBy('name')
      .execute();
    const gradeOf = new Map(classes.map((one) => [one.id, one.grade]));
    const groupClasses = await transaction
      .selectFrom('group_classes')
      .select(['group_id', 'class_id'])
      .execute();
    const classesOfGroup = new Map<string, string[]>();
    for (const row of groupClasses) {
      classesOfGroup.set(row.group_id, [...(classesOfGroup.get(row.group_id) ?? []), row.class_id]);
    }
    const busyAll =
      input.busyOf === undefined || input.busyOf === null
        ? []
        : await busyOf(transaction, branchId, branch.time_zone, input.busyOf, dates);

    const days: ViewDay[] = [];
    const lessons: ViewLesson[] = [];
    const exams: DayExam[] = [];
    const busy: ViewBusy[] = [];
    for (const day of dates) {
      const year = yearOn(day);
      if (year === null) {
        days.push({
          date: day,
          outsideYear: true,
          dayOff: null,
          version: null,
          fromPattern: false,
          axis: 'slots',
          slots: [],
        });
        continue;
      }
      const version = await versionOnDate(transaction, branchId, year.id, day);
      const fromPattern = version !== null && !(await hasStoredLessons(transaction, version.id));
      const pick = input.pick(day);
      const stored = fromPattern
        ? await this.patternLessons(transaction, access, version, day)
        : (await storedLessonsOn(transaction, branchId, day)).filter(
            // A lesson the expansion created cancelled (a day off, not in the
            // template) is no lesson of the day: "Days off produce no lessons" (`06`, Model).
            (one) => !isGeneratedCause(one.cancelCause),
          );
      const all = await dayLessonsOf(transaction, stored, moment);
      const slotsOfGrades = async (grades: readonly number[]) =>
        gradeSlotsOn(transaction, branchId, grades, day);
      const classIdsOf = (one: { unit: { kind: string; id: string } }) =>
        one.unit.kind === 'class' ? [one.unit.id] : (classesOfGroup.get(one.unit.id) ?? []);
      const dayLessons: ViewLesson[] = [];
      for (const one of all) {
        const classIds = classIdsOf(one);
        // The action flags of the day page are left out by the parse of the answer.
        const viewLesson: ViewLesson = {
          ...one,
          classIds,
          lessonNumber: null,
          replacedHere:
            input.replacedOf !== undefined &&
            one.substitution?.replaced?.id === input.replacedOf &&
            one.teacher?.id !== input.replacedOf,
        };
        if (pick.lesson(viewLesson)) dayLessons.push(viewLesson);
      }
      const dayExams = (await examsOfDay(transaction, branchId, day, classesOfGroup)).flatMap(
        (exam) => {
          const rooms = pick.examRooms(exam);
          return rooms.length === 0 ? [] : [{ ...exam, rooms }];
        },
      );
      const dayBusy = busyAll.filter((one) => one.date === day);

      // The templates of the day's lessons and exams, by the grades of their classes.
      const unitGrades = (classIds: readonly string[]) =>
        classIds.flatMap((id) => {
          const grade = gradeOf.get(id);
          return grade === undefined ? [] : [grade];
        });
      const grades = [
        ...new Set([
          ...dayLessons.flatMap((one) => unitGrades(one.classIds)),
          ...dayExams.flatMap((one) => one.rooms.flatMap((room) => unitGrades(room.classIds))),
        ]),
      ].sort((a, b) => a - b);
      const gradeSlots = new Map<number, DaySlot[]>();
      (await slotsOfGrades(grades)).forEach((slots, index) => {
        const grade = grades[index];
        if (grade !== undefined) gradeSlots.set(grade, slots);
      });
      for (const one of dayLessons) {
        const grade = unitGrades(one.classIds)[0];
        const slots = grade === undefined ? [] : (gradeSlots.get(grade) ?? []);
        one.lessonNumber =
          slots.find((slot) => slot.start === one.start && slot.end === one.end)?.lessonNumber ??
          null;
      }
      let axis: 'slots' | 'clock' = 'slots';
      let slots: DaySlot[] = [];
      if (kind === 'class' && input.classId !== undefined) {
        const grade = gradeOf.get(input.classId);
        slots = grade === undefined ? [] : ((await slotsOfGrades([grade]))[0] ?? []);
      } else if (kind === 'teacher' || kind === 'room') {
        const templates = [...gradeSlots.values()].filter((one) => one.length > 0);
        axis = viewAxisOf(templates, dayBusy.length > 0);
        slots = axis === 'slots' ? (templates[0] ?? []) : [];
      }

      const working = branch.working_weekdays.includes(weekdayOf(day));
      const shownDay =
        working || dayLessons.length > 0 || dayExams.length > 0 || dayBusy.length > 0;
      if (!shownDay) continue;
      days.push({
        date: day,
        outsideYear: false,
        dayOff: dayOffOn(settings, entryName, day, input.classId, gradeOf),
        version: version === null ? null : { number: version.number, startsOn: version.startsOn },
        fromPattern,
        axis,
        slots,
      });
      lessons.push(...dayLessons);
      exams.push(...dayExams);
      busy.push(...dayBusy);
    }
    const yearIds = new Set(days.flatMap((one) => yearOn(one.date)?.id ?? []));
    const schoolClasses =
      kind === 'branch'
        ? classes.filter((one) => one.archived_at === null && yearIds.has(one.academic_year_id))
        : kind === 'class'
          ? classes.filter((one) => one.id === input.classId)
          : [];
    return timetableViewSchema.parse({
      kind,
      span,
      today: schoolDateOf(moment, branch.time_zone),
      subject: input.subject,
      classes: schoolClasses.map((one) => ({
        id: one.id,
        name: classDisplayName(one.grade, one.name),
      })),
      days,
      lessons,
      // The parse leaves out the invigilators' ids: the view names them only.
      exams,
      busy,
    });
  }

  /**
   * The lessons of a version published before 0079, which has no dated
   * lessons, from its pattern (decision 13; 5.5b-2 decision 2), shaped as
   * stored lessons with the entry's id: one-day changes are not included.
   */
  private async patternLessons(
    transaction: Transaction,
    access: Access,
    version: VersionInForce,
    day: string,
  ): Promise<StoredDayLesson[]> {
    const row = await this.timetable.versionRow(transaction, version.id);
    const state = await this.pattern.stateOf(transaction, row, access.accountId);
    const { dated, begins } = await datedLessonsOf(transaction, state, day, day);
    return dated.lessons.map((one) => {
      const { placement } = one;
      const start = begins(one.date).getTime();
      return {
        id: one.entryId,
        branchId: row.branch_id,
        // A pattern block's id here is no stored block's (it carries the date): the entry's stands for it.
        blockId: one.entryId,
        versionId: version.id,
        doublePairId: placement.doublePairId,
        date: one.date,
        startsAt: new Date(start + placement.start * MINUTE),
        endsAt: new Date(start + placement.end * MINUTE),
        classId: placement.classId,
        groupId: placement.groupId,
        subjectId: placement.subjectId ?? '',
        loadRowId: placement.loadRowId ?? '',
        teacherId: placement.teacherIds[0] ?? null,
        roomId: placement.roomId,
        cancelCause: null,
        cancelReason: null,
      };
    });
  }
}

const scopeRefusal = () => new ApiException('timetable_view_scope', 403);

async function todayOf(transaction: Transaction, branchId: string): Promise<string> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
}

/** The caller's scope from every assignment that permits the route in the branch. */
async function scopeOf(transaction: Transaction, access: Access): Promise<Scope> {
  const roles = new Set(access.permitting.map((one) => one.role));
  const whole = WHOLE_BRANCH.some((role) => roles.has(role));
  const school = whole || roles.has('head_tutor') || roles.has('tutor');
  let classes: 'all' | ReadonlySet<string>;
  if (whole || roles.has('head_tutor')) {
    classes = 'all';
  } else {
    const tutors = access.permitting.filter((one: CurrentAssignment) => one.role === 'tutor');
    const found = await tutorClassesAt(
      transaction,
      tutors.map((one) => one.id),
    );
    classes = new Set([...found.values()].flat());
  }
  const subjects = new Set(
    access.permitting
      .filter((one) => SUBJECT_HEADS.includes(one.role))
      .flatMap((one) => one.subjectIds),
  );
  const ownRow = await transaction
    .selectFrom('staff')
    .select('id')
    .where('account_id', '=', access.accountId)
    .executeTakeFirst();
  return { whole, school, classes, subjects, own: ownRow?.id ?? null };
}

/**
 * The subjects of the load rows that name the staff record in the published
 * version in force on each date (decision 4, decided day by day).
 */
export async function subjectsTaughtOn(
  transaction: Transaction,
  branchId: string,
  staffId: string,
  dates: readonly string[],
): Promise<Map<string, Set<string>>> {
  const found = new Map<string, Set<string>>();
  const years = await transaction
    .selectFrom('academic_years')
    .select(['id', 'start_date', 'end_date'])
    .where('branch_id', '=', branchId)
    .execute();
  for (const date of dates) {
    const year = years.find((one) => one.start_date <= date && date <= one.end_date);
    if (year === undefined) continue;
    const version = await versionOnDate(transaction, branchId, year.id, date);
    if (version === null) continue;
    const rows = await transaction
      .selectFrom('teaching_load_rows')
      .select('subject_id')
      .where('version_id', '=', version.id)
      .where('teacher_id', '=', staffId)
      .execute();
    found.set(date, new Set(rows.map((one) => one.subject_id)));
  }
  return found;
}

/**
 * The teachers the caller may open: for the whole branch, every person and
 * vacancy named by a load row of a published version of a year not closed;
 * for a Head Teacher, those named by a row of a subject in scope in the
 * version in force on the date; and the caller's own record.
 */
async function teachersOf(
  transaction: Transaction,
  branchId: string,
  scope: Scope,
  date: string,
): Promise<ViewChoices['teachers']> {
  let ids: string[] = [];
  if (scope.whole) {
    const rows = await transaction
      .selectFrom('teaching_load_rows')
      .innerJoin('timetable_versions', 'timetable_versions.id', 'teaching_load_rows.version_id')
      .innerJoin('academic_years', 'academic_years.id', 'timetable_versions.academic_year_id')
      .select('teaching_load_rows.teacher_id')
      .distinct()
      .where('teaching_load_rows.branch_id', '=', branchId)
      .where('timetable_versions.status', '=', 'published')
      .where('academic_years.status', '!=', 'closed')
      .execute();
    ids = rows.flatMap((one) => (one.teacher_id === null ? [] : [one.teacher_id]));
  } else if (scope.subjects.size > 0) {
    const years = await transaction
      .selectFrom('academic_years')
      .select(['id', 'start_date', 'end_date'])
      .where('branch_id', '=', branchId)
      .execute();
    const year = years.find((one) => one.start_date <= date && date <= one.end_date);
    const version =
      year === undefined ? null : await versionOnDate(transaction, branchId, year.id, date);
    if (version !== null) {
      const rows = await transaction
        .selectFrom('teaching_load_rows')
        .select('teacher_id')
        .distinct()
        .where('version_id', '=', version.id)
        .where('subject_id', 'in', [...scope.subjects])
        .execute();
      ids = rows.flatMap((one) => (one.teacher_id === null ? [] : [one.teacher_id]));
    }
  }
  if (scope.own !== null) ids.push(scope.own);
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  const staff = await transaction
    .selectFrom('staff')
    .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
    .where('id', 'in', unique)
    .execute();
  const shown = staff
    .filter((one) => scope.whole || one.kind !== 'vacancy')
    .map((one) => ({
      id: one.id,
      kind: one.kind === 'vacancy' ? ('vacancy' as const) : ('person' as const),
      name:
        one.kind === 'vacancy'
          ? (one.vacancy_name ?? '')
          : listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
  // The caller's own record first.
  return [
    ...shown.filter((one) => one.id === scope.own),
    ...shown.filter((one) => one.id !== scope.own),
  ];
}

/** An exam of the day with every room, the classes each holds and its invigilators' ids. */
type DayExamRoom = ViewExam['rooms'][number] & { invigilatorIds: string[] };
type DayExam = Omit<ViewExam, 'rooms'> & { rooms: DayExamRoom[] };

async function examsOfDay(
  transaction: Transaction,
  branchId: string,
  date: string,
  classesOfGroup: ReadonlyMap<string, readonly string[]>,
): Promise<DayExam[]> {
  const rows = await transaction
    .selectFrom('exams')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('exam_date', '=', date)
    .where('cancel_cause', 'is', null)
    .orderBy('starts_at')
    .orderBy('id')
    .execute();
  const found = await examsOf(
    transaction,
    branchId,
    rows.map((one) => one.id),
  );
  return found.map((exam) => ({
    id: exam.id,
    date: exam.date,
    title: exam.title,
    subject: exam.subject,
    start: exam.start,
    end: exam.end,
    rooms: exam.rooms.map((room) => ({
      room: room.room,
      classIds: [
        ...new Set([
          ...room.classes.map((one) => one.id),
          ...room.groups.flatMap((one) => classesOfGroup.get(one.id) ?? []),
        ]),
      ],
      units: [...room.classes.map((one) => one.name), ...room.groups.map((one) => one.name)],
      invigilators: room.invigilators.map((one) => one.name),
      invigilatorIds: room.invigilators.map((one) => one.id),
    })),
  }));
}

/**
 * The person's lessons and exams in other branches over the dates, start,
 * end and branch name only (decision 8; `claimsElsewhere` leaves out the
 * reading branch's own claims).
 */
async function busyOf(
  transaction: Transaction,
  branchId: string,
  timeZone: string,
  staffId: string,
  dates: readonly string[],
): Promise<ViewBusy[]> {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return [];
  const range = (
    await sql<{ from_at: Date; until_at: Date }>`
      select (${first}::date::timestamp at time zone ${timeZone}) as from_at,
        ((${last}::date + 1)::timestamp at time zone ${timeZone}) as until_at
    `.execute(transaction)
  ).rows[0];
  if (range === undefined) return [];
  const { elsewhere, fixedBranches } = await claimsElsewhere(transaction, {
    branchId,
    timeZone,
    teacherIds: [staffId],
    from: range.from_at,
    until: range.until_at,
  });
  const branchIds = [...new Set(fixedBranches.values())];
  const names = new Map(
    branchIds.length === 0
      ? []
      : (
          await transaction
            .selectFrom('branches')
            .select(['id', 'name'])
            .where('id', 'in', branchIds)
            .execute()
        ).map((one) => [one.id, one.name]),
  );
  return [...elsewhere.entries()]
    .flatMap(([date, placements]) =>
      placements.map((one) => {
        const id = fixedBranches.get(one.id) ?? '';
        return { date, start: one.start, end: one.end, branch: { id, name: names.get(id) ?? '' } };
      }),
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

/**
 * The name of the day off on the date: the class's on a class view, else one
 * that covers every grade of the branch; `null` for none (decision 6).
 */
function dayOffOn(
  settings: Awaited<ReturnType<typeof loadCalendarSettings>>,
  names: ReadonlyMap<string, string>,
  date: string,
  classId: string | undefined,
  gradeOf: ReadonlyMap<string, number>,
): string | null {
  if (classId !== undefined) {
    const grade = gradeOf.get(classId);
    if (grade === undefined) return null;
    const found = dayOn(grade, date, settings);
    return !found.lessons && found.reason === 'day_off' && found.entryId !== null
      ? (names.get(found.entryId) ?? '')
      : null;
  }
  const entry = settings.entries.find(
    (one) =>
      one.kind === 'day_off' &&
      one.firstDate <= date &&
      date <= one.lastDate &&
      (one.gradeFrom === null || one.gradeTo === null),
  );
  return entry === undefined ? null : (names.get(entry.id) ?? '');
}
