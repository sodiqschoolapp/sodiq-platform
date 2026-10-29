import { lessonStatuses } from '../journal/lesson-status.query.js';
import { Inject, Injectable } from '@nestjs/common';
import {
  classDisplayName,
  listName,
  schoolDateOf,
  teachingHomeSchema,
  timetableViewSchema,
  viewAxisOf,
  viewChoicesSchema,
  viewDates,
  type BranchViewQuery,
  type ClassViewQuery,
  type DaySlot,
  type HomeBusy,
  type HomeDay,
  type HomeExam,
  type HomeLesson,
  type PermissionTable,
  type Role,
  type RoomViewQuery,
  type TeacherViewQuery,
  type TeachingHome,
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
import { permitting, reachingBranch, type Requirement } from '../access/permission-check.js';
import { PERMISSION_TABLE } from '../access/permission-table.token.js';
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

/** The lowest of some grades, `undefined` for none. */
export const lowestGrade = (grades: readonly number[]): number | undefined =>
  grades.length === 0 ? undefined : Math.min(...grades);

/**
 * A teacher or a vacancy with the name the views print, read through the
 * branch filter: a staff record linked to another branch only, or unknown,
 * is 404 (task 5.9a; the version print of task 5.9c-2 reads it the same way).
 */
export async function staffOfBranch(
  transaction: Transaction,
  staffId: string,
): Promise<{ id: string; kind: 'person' | 'vacancy'; name: string }> {
  const found = await transaction
    .selectFrom('staff')
    .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
    .where('id', '=', staffId)
    .executeTakeFirst();
  if (found === undefined) {
    throw notFound();
  }
  return {
    id: found.id,
    kind: found.kind === 'vacancy' ? 'vacancy' : 'person',
    name:
      found.kind === 'vacancy'
        ? (found.vacancy_name ?? '')
        : listName({ firstName: found.first_name ?? '', lastName: found.last_name ?? '' }),
  };
}

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
    @Inject(PERMISSION_TABLE) private readonly table: PermissionTable,
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
    return this.transactions.run(access.branchIds, (transaction) =>
      this.branchIn(transaction, access, query),
    );
  }

  /** The same view read in the caller's transaction (task 5.9c-1, decision 14: the file reads it once). */
  async branchIn(
    transaction: Transaction,
    access: Access,
    query: BranchViewQuery,
  ): Promise<TimetableView> {
    const branchId = branchOf(access);
    const scope = await scopeOf(transaction, access);
    if (!scope.school) throw scopeRefusal();
    return this.viewOf(transaction, access, branchId, 'branch', query.date, query.span, {
      subject: null,
      pick: () => ({ lesson: () => true, examRooms: (exam) => exam.rooms }),
    });
  }

  /** A class: its own lessons and those of its groups, and the exams it sits. */
  class(access: Access, query: ClassViewQuery): Promise<TimetableView> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.classIn(transaction, access, query),
    );
  }

  /** The same view read in the caller's transaction (task 5.9c-1, decision 14: the file reads it once). */
  async classIn(
    transaction: Transaction,
    access: Access,
    query: ClassViewQuery,
  ): Promise<TimetableView> {
    const branchId = branchOf(access);
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
  }

  /**
   * A teacher or a vacancy: the lessons they teach, those a substitute took
   * from them (decision 7), the exams they invigilate, and their busy blocks
   * in other branches (decision 8). A Head Teacher reading another teacher
   * sees only the days on which a load row of a subject in scope names them,
   * only the lessons and exams of those subjects, and no busy block (decision 4).
   */
  teacher(access: Access, query: TeacherViewQuery): Promise<TimetableView> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.teacherIn(transaction, access, query),
    );
  }

  /** The same view read in the caller's transaction (task 5.9c-1, decision 14: the file reads it once). */
  async teacherIn(
    transaction: Transaction,
    access: Access,
    query: TeacherViewQuery,
  ): Promise<TimetableView> {
    const branchId = branchOf(access);
    const found = await staffOfBranch(transaction, query.staffId);
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
    const { name } = found;
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
  }

  /** A room: the lessons and exams held in it. */
  room(access: Access, query: RoomViewQuery): Promise<TimetableView> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.roomIn(transaction, access, query),
    );
  }

  /** The same view read in the caller's transaction (task 5.9c-1, decision 14: the file reads it once). */
  async roomIn(
    transaction: Transaction,
    access: Access,
    query: RoomViewQuery,
  ): Promise<TimetableView> {
    const branchId = branchOf(access);
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
  }

  /**
   * The home page of a person who teaches (task 5.9b, pull request #198): the
   * caller's own lessons and exams of the week of today from every branch a
   * current assignment of the session permits `timetable_views` in, decided
   * by the guard's own rule `permitting` (decision 1, correction 1). Each such
   * branch is read in a transaction of its own with that branch's filter
   * only, by the code of the teacher view and with no busy block, so no
   * lesson comes twice (spec review must-fix 4). The caller's lessons and
   * exams in any other branch come as busy blocks with their time and branch
   * only (decision 2), read from a branch the staff record is linked to.
   */
  async home(access: Access): Promise<TeachingHome> {
    const requestBranch = branchOf(access);
    const { branches, today } = await this.transactions.run(
      access.branchIds,
      async (transaction) => ({
        branches: await transaction
          .selectFrom('branches')
          .select(['id', 'name', 'time_zone', 'purpose'])
          .orderBy('name')
          .orderBy('id')
          .execute(),
        today: await todayOf(transaction, requestBranch),
      }),
    );
    const week = viewDates(today, 'week');
    const full = branches.filter(
      (branch) =>
        permitting(
          HOME_REQUIREMENT,
          reachingBranch(access.assignments, branch.purpose === 'monitoring'),
          branch.id,
          this.table,
        ).length > 0,
    );
    const fullIds = new Set(full.map((one) => one.id));

    const days: HomeDay[] = [];
    const lessons: HomeLesson[] = [];
    const exams: HomeExam[] = [];
    const elsewhere: { busy: HomeBusy[] | null } = { busy: null };
    for (const branch of full) {
      const named = { id: branch.id, name: branch.name };
      await this.transactions.run([branch.id], async (transaction) => {
        // Read through this branch's filter: a record not linked to the branch is not found.
        const own = await transaction
          .selectFrom('staff')
          .select('id')
          .where('account_id', '=', access.accountId)
          .executeTakeFirst();
        if (own === undefined) return;
        const moment = await transactionMoment(transaction);
        // Each branch reads its own today and week (decision 3).
        const branchToday = schoolDateOf(moment, branch.time_zone);
        const view = await this.viewOf(
          transaction,
          access,
          branch.id,
          'teacher',
          branchToday,
          'week',
          {
            subject: { id: own.id, name: '' },
            busyOf: null,
            replacedOf: own.id,
            quietOutside: true,
            pick: () => ({
              lesson: (lesson) => lesson.teacher?.id === own.id || lesson.replacedHere,
              examRooms: (exam) =>
                exam.rooms.filter((room) => room.invigilatorIds.includes(own.id)),
            }),
          },
        );
        const at = await momentsOf(transaction, branch.time_zone, [...view.lessons, ...view.exams]);
        const placed = (index: number, date: string) => {
          const found = at[index];
          if (found === undefined) throw new Error('Every item has its moments.');
          return { branch: named, ...found, today: date === branchToday };
        };
        view.lessons.forEach((one, index) => lessons.push({ ...one, ...placed(index, one.date) }));
        view.exams.forEach((one, index) =>
          exams.push({ ...one, ...placed(view.lessons.length + index, one.date) }),
        );
        for (const day of view.days) {
          if (day.outsideYear) continue;
          days.push({
            date: day.date,
            dayOff: day.dayOff,
            version: day.version,
            fromPattern: day.fromPattern,
            branch: named,
          });
        }
        // Decision 2: from the first branch read where the record is linked
        // (`teacher_claims_elsewhere` refuses any other), the claims of the
        // branches not read in full.
        elsewhere.busy ??= (
          await claimsOfWeek(
            transaction,
            branch.id,
            branch.time_zone,
            own.id,
            viewDates(branchToday, 'week'),
            moment,
          )
        ).filter((one) => !fullIds.has(one.branch.id));
      });
    }

    const byStart = <T extends { startsAt: string; branch: { name: string } }>(a: T, b: T) =>
      a.startsAt.localeCompare(b.startsAt) || a.branch.name.localeCompare(b.branch.name);
    return teachingHomeSchema.parse({
      today,
      week: { from: week[0], to: week[week.length - 1] },
      branches: full
        .filter((branch) => days.some((day) => day.branch.id === branch.id))
        .map((branch) => ({ id: branch.id, name: branch.name })),
      days: days.sort(
        (a, b) => a.date.localeCompare(b.date) || a.branch.name.localeCompare(b.branch.name),
      ),
      lessons: lessons.sort((a, b) => byStart(a, b) || a.id.localeCompare(b.id)),
      exams: exams.sort((a, b) => byStart(a, b) || a.id.localeCompare(b.id)),
      busy: (elsewhere.busy ?? []).sort(byStart),
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
      /** A span wholly outside the years answers its days marked, not 422 (the home page, task 5.9b). */
      readonly quietOutside?: boolean;
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
    if (input.quietOutside !== true && dates.every((day) => yearOn(day) === null)) {
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
    // Task 6.2 (From 5.9b, decision 7 of #198): each lesson names its journal, opened from it.
    const journalOf = new Map(
      (
        await transaction
          .selectFrom('journals')
          .select(['id', 'academic_year_id', 'class_id', 'group_id', 'subject_id'])
          .where('branch_id', '=', branchId)
          .execute()
      ).map((one) => [
        `${one.academic_year_id}|${one.class_id ?? one.group_id ?? ''}|${one.subject_id}`,
        one.id,
      ]),
    );
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
          journalId: journalOf.get(`${year.id}|${one.unit.id}|${one.subject.id}`) ?? null,
          status: null,
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
        // The lowest grade of its classes: the order of `classIds` is the
        // database's, and the pattern print numbers a lesson the same way
        // (task 5.9c-2, approval correction 3; the block's minutes are read
        // from the template of the lowest grade, `blockPlacements`).
        const grade = lowestGrade(unitGrades(one.classIds));
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
    // Task 8.7 (decision 16): the status of each held lesson, from the one reader of the status.
    const statuses = await lessonStatuses(
      transaction,
      branchId,
      lessons.filter((one) => one.state === 'held').map((one) => one.id),
      moment,
    );
    for (const one of lessons) one.status = statuses.get(one.id)?.answer?.status ?? null;
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

/**
 * The requirement of the home page: the route declares it and the service
 * reads every branch it permits in full (correction 1), from one constant so
 * the two never disagree (permission review should-fix 2).
 */
export const HOME_REQUIREMENT = {
  area: 'timetable_views',
  action: 'view',
  branch: 'request',
} as const satisfies Requirement;

/** The moments of items given by a date and clock minutes in the branch's time zone. */
async function momentsOf(
  transaction: Transaction,
  timeZone: string,
  items: readonly { readonly date: string; readonly start: number; readonly end: number }[],
): Promise<{ startsAt: string; endsAt: string }[]> {
  if (items.length === 0) return [];
  const { rows } = await sql<{ starts_at: Date; ends_at: Date }>`
    select ((x.day::timestamp + make_interval(mins => x.start_minutes)) at time zone ${timeZone}) as starts_at,
      ((x.day::timestamp + make_interval(mins => x.end_minutes)) at time zone ${timeZone}) as ends_at
    from unnest(
      ${items.map((one) => one.date)}::date[],
      ${items.map((one) => one.start)}::int[],
      ${items.map((one) => one.end)}::int[]
    ) with ordinality as x(day, start_minutes, end_minutes, position)
    order by x.position
  `.execute(transaction);
  return rows.map((one) => ({
    startsAt: one.starts_at.toISOString(),
    endsAt: one.ends_at.toISOString(),
  }));
}

/**
 * The person's lessons and exams in every branch but the reading one over
 * the dates, as busy blocks: moments, the day and minutes in their own
 * branch's time (correction 2), the branch's name; no class, subject or room.
 */
async function claimsOfWeek(
  transaction: Transaction,
  branchId: string,
  timeZone: string,
  staffId: string,
  dates: readonly string[],
  moment: Date,
): Promise<HomeBusy[]> {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (first === undefined || last === undefined) return [];
  const { rows } = await sql<{
    starts_at: Date;
    ends_at: Date;
    branch_id: string;
    name: string;
    time_zone: string;
    day: string;
    start_minutes: number;
    end_minutes: number;
  }>`
    select c.starts_at, c.ends_at, c.branch_id, b.name, b.time_zone,
      (c.starts_at at time zone b.time_zone)::date::text as day,
      (extract(epoch from (c.starts_at at time zone b.time_zone)
        - (c.starts_at at time zone b.time_zone)::date::timestamp) / 60)::int as start_minutes,
      (extract(epoch from (c.ends_at at time zone b.time_zone)
        - (c.starts_at at time zone b.time_zone)::date::timestamp) / 60)::int as end_minutes
    from teacher_claims_elsewhere(
      ${branchId}::uuid, ${staffId}::uuid,
      (${first}::date::timestamp at time zone ${timeZone}),
      ((${last}::date + 1)::timestamp at time zone ${timeZone})
    ) c
    join branches b on b.id = c.branch_id
    where c.branch_id <> ${branchId}::uuid
    order by c.starts_at, c.ends_at, c.branch_id
  `.execute(transaction);
  return rows.map((one) => ({
    date: one.day,
    start: one.start_minutes,
    end: one.end_minutes,
    branch: { id: one.branch_id, name: one.name },
    startsAt: one.starts_at.toISOString(),
    endsAt: one.ends_at.toISOString(),
    today: one.day === schoolDateOf(moment, one.time_zone),
  }));
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
