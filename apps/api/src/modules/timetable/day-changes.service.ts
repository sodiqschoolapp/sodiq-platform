import { Injectable } from '@nestjs/common';
import {
  classDisplayName,
  dayAnswerSchema,
  dayChangeAnswerSchema,
  dayLessonSchema,
  isMarkedChanged,
  listName,
  schoolDateOf,
  weekdaySchema,
  type DayAnswer,
  type DayChangeAnswer,
  type DayLesson,
  type DayQuery,
  type ErrorCode,
  type ErrorDetail,
  type LessonCancelBody,
  type RuleResultAnswer,
} from '@sodiq/shared';
import { weekdayOf, type RuleResult } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { dayBeginnings } from './dated-check.js';
import { TimetablePattern } from './pattern.service.js';
import {
  PUBLISH_LOCK,
  PUBLISH_REFUSALS,
  lockPublishChain,
  refusingPublish,
} from './publish.service.js';
import { pairOf, storedDayCheck, storedLessonsOn, type StoredDayLesson } from './stored-day.js';
import { Timetable } from './timetable.service.js';
import { sendWeekChanges, snapshotWeek } from './week-changes.js';

/**
 * The claims and the commit checks of 0058 that a restore can meet after its
 * rule check, when another change took the teacher, the room, the class or a
 * student meanwhile (spec review must-fix 4): the restore is refused as the
 * check would have refused it.
 */
export const DAY_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...PUBLISH_REFUSALS,
  time_claims_teacher_excl: 'restore_blocked',
  time_claims_room_excl: 'restore_blocked',
  time_claims_class_excl: 'restore_blocked',
  room_shared_full: 'restore_blocked',
  room_shared_capacity: 'restore_blocked',
  lesson_block_student_twice: 'restore_blocked',
};

/** A blocked result of the stored-day check as a detail of `restore_blocked`. */
function blockedDetail(result: RuleResult): ErrorDetail {
  return {
    path: `rules.${result.rule}`,
    code: result.rule,
    message: 'A blocked rule of the restored lesson on its date.',
    rule: { weekday: weekdaySchema.parse(weekdayOf(result.day)), lessonIds: [...result.lessonIds] },
    day: result.day,
  };
}

const answerOfResult = (result: RuleResult): RuleResultAnswer => ({
  rule: result.rule,
  severity: result.severity,
  weekday: weekdaySchema.parse(weekdayOf(result.day)),
  lessonIds: [...result.lessonIds],
  ...(result.detail === undefined || Object.keys(result.detail).length === 0
    ? {}
    : { detail: { ...result.detail } }),
  date: result.day,
});

/**
 * One-day changes of a published timetable (task 5.6a-1, pull request #160):
 * the day of a class, the cancel of one lesson with a reason and its restore
 * (`06`, Changes after publishing: "One-day change. … cancel. Every one-day
 * change needs a reason, applies to that date only and passes the same
 * rules."; How surprises are prevented: "Today's lessons change only through
 * a one-day change with a reason."; edge/timetable, After publishing: "A
 * cancelled lesson is restored after its room went to another lesson. Every
 * rule is checked again. The restore can be refused, with another room
 * offered.").
 *
 * A change takes the publish's locks of its branch and year first
 * (`lockPublishChain`), then the blocks and lessons of the lesson's date in
 * the writer's order (`snapshotWeek`), and reads the lesson again after them:
 * a publish that ran meanwhile may have removed it (404) (decision 6, spec
 * review should-fix 7). A lesson that has started is refused (decision 3).
 * The two halves of a double lesson are cancelled and restored together, and
 * a pair has started when its earlier half has (`edge/timetable`, Structure,
 * "Double lessons": "They are moved, cancelled and substituted together";
 * review of the code, change 1).
 * Each change marks the lesson changed and notifies its teachers once, with
 * the week before and after (decision 10), and writes its audit entry, in one
 * transaction.
 */
@Injectable()
export class TimetableDayChanges {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly requestKeys: RequestKeys,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
  ) {}

  /** The stored lessons of a class of the branch on a date: its own and those of its groups. */
  day(access: Access, query: DayQuery): Promise<DayAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await transaction
        .selectFrom('classes')
        .select('id')
        .where('id', '=', query.classId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (found === undefined) {
        throw notFound();
      }
      const groups = await transaction
        .selectFrom('group_classes')
        .select('group_id')
        .where('class_id', '=', query.classId)
        .execute();
      const groupIds = new Set(groups.map((one) => one.group_id));
      const lessons = (await storedLessonsOn(transaction, branchId, query.date)).filter(
        (one) =>
          one.classId === query.classId || (one.groupId !== null && groupIds.has(one.groupId)),
      );
      const moment = await transactionMoment(transaction);
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      return dayAnswerSchema.parse({
        date: query.date,
        classId: query.classId,
        today: schoolDateOf(moment, branch.time_zone),
        lessons: await dayLessonsOf(transaction, lessons, moment),
      });
    });
  }

  /** A one-day cancel with its reason, safe to repeat with its key. */
  cancel(
    access: Access,
    id: string,
    input: LessonCancelBody,
    key: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.keyed(access, id, key, 'timetable.lesson_cancel', { reason: input.reason }, (t) =>
      this.cancelLocked(t, access, id, input.reason, requestId),
    );
  }

  /** The restore of a one-day cancel, safe to repeat with its key. */
  restore(access: Access, id: string, key: string, requestId: string): Promise<DayChangeAnswer> {
    return this.keyed(access, id, key, 'timetable.lesson_restore', {}, (t) =>
      this.restoreLocked(t, access, id, requestId),
    );
  }

  /** The lesson's branch before the request key (`.claude/rules/api.md`), then the work once. */
  private keyed(
    access: Access,
    id: string,
    key: string,
    scope: string,
    input: { readonly [field: string]: string },
    work: (transaction: Transaction) => Promise<DayChangeAnswer>,
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // The lesson of the branch first, so an unknown or foreign id never waits on a publish.
          await this.yearOf(transaction, branchId, id);
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          const once = await this.requestKeys.runOnce(
            transaction,
            { key, scope, accountId: access.accountId, input: { lessonId: id, ...input } },
            async () => (await work(transaction)) as unknown as JsonValue,
          );
          return dayChangeAnswerSchema.parse(once.result);
        }),
      DAY_REFUSALS,
    );
  }

  /** The academic year of a lesson of the branch, read without a lock; 404 otherwise. */
  private async yearOf(transaction: Transaction, branchId: string, id: string): Promise<string> {
    const found = await transaction
      .selectFrom('lessons')
      .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
      .select(['lesson_blocks.academic_year_id', sql<string>`lessons.lesson_date::text`.as('date')])
      .where('lessons.id', '=', id)
      .where('lessons.branch_id', '=', branchId)
      .executeTakeFirst();
    if (found === undefined) {
      throw notFound();
    }
    return found.academic_year_id;
  }

  /**
   * The locks of decision 6 and the lesson read again after them, with the
   * halves of its double pair (`pair`, by start, the lesson among them) and
   * the side before for the notices; 404 when a publish removed it meanwhile,
   * and `lesson_started` when it, or the earlier half of its pair, has
   * started (decision 3).
   */
  private async lockedLesson(transaction: Transaction, branchId: string, id: string) {
    const yearId = await this.yearOf(transaction, branchId, id);
    await lockPublishChain(transaction, branchId, yearId);
    const dated = await transaction
      .selectFrom('lessons')
      .select(sql<string>`lesson_date::text`.as('date'))
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (dated === undefined) {
      throw notFound();
    }
    const week = await snapshotWeek(transaction, branchId, dated.date, dated.date);
    const lessons = await storedLessonsOn(transaction, branchId, dated.date);
    const lesson = lessons.find((one) => one.id === id);
    if (lesson === undefined) {
      throw notFound();
    }
    const pair = pairOf(lessons, lesson);
    const moment = await transactionMoment(transaction);
    if (pair.some((one) => one.startsAt.getTime() <= moment.getTime())) {
      throw new ApiException('lesson_started', 409);
    }
    return { lesson, pair, week, moment };
  }

  private async cancelLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    reason: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    const { lesson, pair, week, moment } = await this.lockedLesson(transaction, branchId, id);
    if (lesson.cancelCause !== null) {
      throw new ApiException('lesson_cancelled', 409);
    }
    // Both halves of a double; a half already cancelled keeps its cause (decision 4).
    const lessonIds = pair.filter((one) => one.cancelCause === null).map((one) => one.id);
    await transaction
      .updateTable('lessons')
      .set({ cancel_cause: 'reason', cancel_reason: reason })
      .where('id', 'in', lessonIds)
      .execute();
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.cancel',
      record: { type: 'lesson', id },
      oldValue: { ...valuesOf(lesson), lessonIds, cancelCause: null },
      newValue: {
        ...valuesOf(lesson),
        lessonIds,
        cancelCause: 'reason',
        reason,
        notices: { ...notices },
      },
      requestId,
    });
    return this.answerOf(transaction, branchId, id, moment, []);
  }

  private async restoreLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    const { lesson, pair, week, moment } = await this.lockedLesson(transaction, branchId, id);
    if (lesson.cancelCause !== 'reason') {
      throw new ApiException('lesson_not_restorable', 409);
    }
    // Both halves of a double cancelled with a reason, checked together; a
    // half cancelled by another cause stays cancelled (decision 4).
    const lessons = pair.filter((one) => one.cancelCause === 'reason');
    const lessonIds = lessons.map((one) => one.id);
    const checked = await storedDayCheck(
      transaction,
      { timetable: this.timetable, pattern: this.pattern },
      { accountId: access.accountId, lessons },
    );
    if (checked.blocked.length > 0) {
      const rooms =
        checked.freeRooms.length === 0
          ? []
          : await transaction
              .selectFrom('rooms')
              .select(['id', 'name'])
              .where('id', 'in', checked.freeRooms)
              .where('branch_id', '=', branchId)
              .orderBy('name')
              .execute();
      throw new ApiException('restore_blocked', 409, undefined, [
        ...checked.blocked.map(blockedDetail),
        ...rooms.map((room) => ({
          path: 'rooms',
          code: 'room_free',
          message: 'A room free at the lesson’s time.',
          room: { id: room.id, name: room.name },
        })),
      ]);
    }
    for (const one of lessons) {
      await transaction
        .updateTable('lessons')
        .set({
          cancel_cause: null,
          cancel_reason: null,
          teacher_id: checked.teacherIds.get(one.id) ?? null,
        })
        .where('id', '=', one.id)
        .execute();
    }
    // The commit checks of 0058 now, so that a race meets the refusals here.
    await sql`set constraints all immediate`.execute(transaction);
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.restore',
      record: { type: 'lesson', id },
      oldValue: {
        ...valuesOf(lesson),
        lessonIds,
        cancelCause: 'reason',
        reason: lesson.cancelReason,
      },
      newValue: {
        ...valuesOf({ ...lesson, teacherId: checked.teacherIds.get(id) ?? null }),
        lessonIds,
        teacherIds: Object.fromEntries(checked.teacherIds),
        cancelCause: null,
        warnings: checked.warnings.map((one) => one.rule),
        notices: { ...notices },
      },
      requestId,
    });
    return this.answerOf(transaction, branchId, id, moment, checked.warnings);
  }

  private async answerOf(
    transaction: Transaction,
    branchId: string,
    id: string,
    moment: Date,
    warnings: readonly RuleResult[],
  ): Promise<DayChangeAnswer> {
    const dated = await transaction
      .selectFrom('lessons')
      .select(sql<string>`lesson_date::text`.as('date'))
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirstOrThrow();
    const lessons = await storedLessonsOn(transaction, branchId, dated.date);
    const changed = lessons.find((one) => one.id === id);
    if (changed === undefined) throw new Error('The changed lesson was not read.');
    const shown = await dayLessonsOf(transaction, pairOf(lessons, changed), moment);
    const lesson = shown.find((one) => one.id === id);
    if (lesson === undefined) throw new Error('The changed lesson was not read.');
    return dayChangeAnswerSchema.parse({ lesson, warnings: warnings.map(answerOfResult) });
  }
}

/** What an audit entry keeps of a lesson. */
function valuesOf(lesson: StoredDayLesson) {
  return {
    date: lesson.date,
    startsAt: lesson.startsAt.toISOString(),
    endsAt: lesson.endsAt.toISOString(),
    classId: lesson.classId,
    groupId: lesson.groupId,
    subjectId: lesson.subjectId,
    teacherId: lesson.teacherId,
    roomId: lesson.roomId,
  };
}

/** The lessons as the day page shows them, with their names and the "changed" mark. */
async function dayLessonsOf(
  transaction: Transaction,
  lessons: readonly StoredDayLesson[],
  moment: Date,
): Promise<DayLesson[]> {
  if (lessons.length === 0) return [];
  const ids = (pick: (one: StoredDayLesson) => string | null) => [
    ...new Set(lessons.flatMap((one) => (pick(one) === null ? [] : [pick(one) ?? '']))),
  ];
  const classIds = ids((one) => one.classId);
  const groupIds = ids((one) => one.groupId);
  const subjectIds = ids((one) => one.subjectId);
  const teacherIds = ids((one) => one.teacherId);
  const roomIds = ids((one) => one.roomId);
  const [classes, groups, subjects, teachers, rooms, marks, branch] = await Promise.all([
    classIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('classes')
          .select(['id', 'grade', 'name'])
          .where('id', 'in', classIds)
          .execute(),
    groupIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('groups')
          .select(['id', 'name'])
          .where('id', 'in', groupIds)
          .execute(),
    transaction
      .selectFrom('subjects')
      .select(['id', 'name_uz', 'name_ru', 'name_en'])
      .where('id', 'in', subjectIds)
      .execute(),
    teacherIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('staff')
          .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
          .where('id', 'in', teacherIds)
          .execute(),
    roomIds.length === 0
      ? Promise.resolve([])
      : transaction.selectFrom('rooms').select(['id', 'name']).where('id', 'in', roomIds).execute(),
    transaction
      .selectFrom('lesson_changes')
      .select(['lesson_id', 'changed_at'])
      .where(
        'lesson_id',
        'in',
        lessons.map((one) => one.id),
      )
      .execute(),
    transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', lessons[0]?.branchId ?? '')
      .executeTakeFirstOrThrow(),
  ]);
  const classOf = new Map(classes.map((one) => [one.id, classDisplayName(one.grade, one.name)]));
  const groupOf = new Map(groups.map((one) => [one.id, one.name]));
  const subjectOf = new Map(
    subjects.map((one) => [one.id, { uz: one.name_uz, ru: one.name_ru, en: one.name_en }]),
  );
  const teacherOf = new Map(
    teachers.map((one) => [
      one.id,
      {
        id: one.id,
        kind: one.kind === 'vacancy' ? ('vacancy' as const) : ('person' as const),
        name:
          one.kind === 'vacancy'
            ? (one.vacancy_name ?? '')
            : listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
      },
    ]),
  );
  const roomOf = new Map(rooms.map((one) => [one.id, one.name]));
  const markOf = new Map(marks.map((one) => [one.lesson_id, one.changed_at]));
  const dates = lessons.map((one) => one.date).sort();
  const begins = await dayBeginnings(
    transaction,
    branch.time_zone,
    dates[0] ?? '',
    dates[dates.length - 1] ?? '',
  );
  const minutesOf = (one: StoredDayLesson, at: Date) =>
    Math.round((at.getTime() - begins(one.date).getTime()) / 60_000);
  return lessons.map((one) => {
    // A double lesson has started when its earlier half has (decision 3).
    const started = pairOf(lessons, one).some(
      (half) => half.startsAt.getTime() <= moment.getTime(),
    );
    const subject = subjectOf.get(one.subjectId);
    if (subject === undefined) throw new Error('A lesson names a subject that was not read.');
    return {
      id: one.id,
      date: one.date,
      start: minutesOf(one, one.startsAt),
      end: minutesOf(one, one.endsAt),
      unit:
        one.classId !== null
          ? { kind: 'class', id: one.classId, name: classOf.get(one.classId) ?? '' }
          : { kind: 'group', id: one.groupId ?? '', name: groupOf.get(one.groupId ?? '') ?? '' },
      subject: { id: one.subjectId, names: subject },
      teacher: one.teacherId === null ? null : (teacherOf.get(one.teacherId) ?? null),
      room: one.roomId === null ? null : { id: one.roomId, name: roomOf.get(one.roomId) ?? '' },
      cancelCause: dayLessonSchema.shape.cancelCause.parse(one.cancelCause),
      cancelReason: one.cancelReason,
      changed: isMarkedChanged(markOf.get(one.id) ?? null, moment),
      canCancel: one.cancelCause === null && !started,
      canRestore: one.cancelCause === 'reason' && !started,
    };
  });
}
