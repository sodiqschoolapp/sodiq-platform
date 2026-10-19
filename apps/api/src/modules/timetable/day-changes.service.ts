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
  type LessonMoveBody,
  type LessonRestoreBody,
  type LessonRoomBody,
  type DaySlot,
  type RuleResultAnswer,
} from '@sodiq/shared';
import { dayOn, weekdayOf, type RuleResult } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { loadCalendarSettings } from '../setup/calendar-state.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { notFound } from '../setup/setup-refusals.js';
import { dayBeginnings } from './dated-check.js';
import { TimetablePattern } from './pattern.service.js';
import {
  PUBLISH_LOCK,
  PUBLISH_REFUSALS,
  lockPublishChain,
  refusingPublish,
} from './publish.service.js';
import {
  pairOf,
  slotMomentsOn,
  storedDayCheck,
  storedLessonsOn,
  type StoredDayLesson,
  type StoredDayResult,
} from './stored-day.js';
import { Timetable } from './timetable.service.js';
import { sendWeekChanges, snapshotDates, snapshotWeek } from './week-changes.js';

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

/**
 * The same for a one-day room change and a move (task 5.6a-2): their own
 * code, and a block's date in another quarter, which the route refuses first,
 * as `move_other_quarter`.
 */
export const MOVE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...PUBLISH_REFUSALS,
  time_claims_teacher_excl: 'day_change_blocked',
  time_claims_room_excl: 'day_change_blocked',
  time_claims_class_excl: 'day_change_blocked',
  room_shared_full: 'day_change_blocked',
  room_shared_capacity: 'day_change_blocked',
  lesson_block_student_twice: 'day_change_blocked',
  lesson_block_quarter: 'move_other_quarter',
  lesson_block_quarter_fixed: 'move_other_quarter',
};

/** A blocked result of the stored-day check as a detail of `restore_blocked` or `day_change_blocked`. */
function blockedDetail(result: RuleResult): ErrorDetail {
  return {
    path: `rules.${result.rule}`,
    code: result.rule,
    message: 'A blocked rule of the changed lesson on its date.',
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
 * One-day changes of a published timetable (task 5.6a-1, pull request #160;
 * the room change, the move and the restore into another room of task
 * 5.6a-2, pull request #161):
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
        slots: await classSlotsOn(transaction, branchId, query.classId, query.date),
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

  /**
   * The restore of a one-day cancel, into another room with a reason when
   * given (task 5.6a-2, decision 10), safe to repeat with its key.
   */
  restore(
    access: Access,
    id: string,
    input: LessonRestoreBody,
    key: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.keyed(
      access,
      id,
      key,
      'timetable.lesson_restore',
      input.roomId === undefined ? {} : { roomId: input.roomId, reason: input.reason ?? '' },
      (t) => this.restoreLocked(t, access, id, input, requestId),
      { rooms: input.roomId === undefined ? [] : [input.roomId] },
    );
  }

  /** A one-day room change with its reason (task 5.6a-2), safe to repeat with its key. */
  room(
    access: Access,
    id: string,
    input: LessonRoomBody,
    key: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.keyed(
      access,
      id,
      key,
      'timetable.lesson_room',
      { roomId: input.roomId, reason: input.reason },
      (t) => this.roomLocked(t, access, id, input, requestId),
      { rooms: [input.roomId], refusals: MOVE_REFUSALS },
    );
  }

  /** A one-day move with its reason (task 5.6a-2), safe to repeat with its key. */
  move(
    access: Access,
    id: string,
    input: LessonMoveBody,
    key: string,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    return this.keyed(
      access,
      id,
      key,
      'timetable.lesson_move',
      {
        date: input.date,
        lessonNumber: String(input.lessonNumber),
        roomId: input.roomId ?? '',
        reason: input.reason,
      },
      (t) => this.moveLocked(t, access, id, input, requestId),
      { rooms: input.roomId === undefined ? [] : [input.roomId], refusals: MOVE_REFUSALS },
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
    options: {
      readonly rooms?: readonly string[];
      readonly refusals?: Readonly<Record<string, ErrorCode>>;
    } = {},
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    return refusingPublish(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // The lesson and the rooms of the branch first, so an unknown or
          // foreign id never waits on a publish.
          await this.yearOf(transaction, branchId, id);
          for (const roomId of options.rooms ?? []) {
            const room = await transaction
              .selectFrom('rooms')
              .select('id')
              .where('id', '=', roomId)
              .where('branch_id', '=', branchId)
              .executeTakeFirst();
            if (room === undefined) {
              throw notFound();
            }
          }
          await sql`select pg_advisory_xact_lock(${PUBLISH_LOCK})`.execute(transaction);
          const once = await this.requestKeys.runOnce(
            transaction,
            { key, scope, accountId: access.accountId, input: { lessonId: id, ...input } },
            async () => (await work(transaction)) as unknown as JsonValue,
          );
          return dayChangeAnswerSchema.parse(once.result);
        }),
      options.refusals ?? DAY_REFUSALS,
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
  private async lockedLesson(
    transaction: Transaction,
    branchId: string,
    id: string,
    toDate?: string,
  ) {
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
    // A move to another date locks the blocks of both dates only (spec review should-fix 5).
    const week =
      toDate === undefined || toDate === dated.date
        ? await snapshotWeek(transaction, branchId, dated.date, dated.date)
        : await snapshotDates(transaction, branchId, [dated.date, toDate]);
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
    return { lesson, pair, week, moment, lessons };
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
    input: LessonRestoreBody,
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
    // Into another room with a reason when given (decision 10); its own room
    // is no room change (spec review of the code, should-fix 3).
    const roomId = input.roomId;
    if (roomId !== undefined && lessons.every((one) => one.roomId === roomId)) {
      throw new ApiException('room_unchanged', 409);
    }
    const checked = await storedDayCheck(
      transaction,
      { timetable: this.timetable, pattern: this.pattern },
      { accountId: access.accountId, lessons, ...(roomId === undefined ? {} : { roomId }) },
    );
    await refuseBlocked(transaction, branchId, 'restore_blocked', checked);
    for (const one of lessons) {
      await transaction
        .updateTable('lessons')
        .set({
          cancel_cause: null,
          cancel_reason: null,
          teacher_id: checked.teacherIds.get(one.id) ?? null,
          ...(roomId === undefined ? {} : { room_id: roomId }),
        })
        .where('id', '=', one.id)
        .execute();
    }
    // The commit checks of 0058 now, so that a race meets the refusals here.
    await sql`set constraints all immediate`.execute(transaction);
    if (roomId !== undefined) {
      await recordChanges(
        transaction,
        access,
        'room',
        lessons.map((one) => ({ from: one, to: { ...one, roomId } })),
        input.reason ?? '',
      );
    }
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
        ...valuesOf({
          ...lesson,
          teacherId: checked.teacherIds.get(id) ?? null,
          roomId: roomId ?? lesson.roomId,
        }),
        lessonIds,
        teacherIds: Object.fromEntries(checked.teacherIds),
        cancelCause: null,
        ...(roomId === undefined ? {} : { roomId, roomReason: input.reason ?? '' }),
        warnings: checked.warnings.map((one) => one.rule),
        notices: { ...notices },
      },
      requestId,
    });
    return this.answerOf(transaction, branchId, id, moment, checked.warnings);
  }

  private async roomLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    input: LessonRoomBody,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    const { lesson, pair, week, moment } = await this.lockedLesson(transaction, branchId, id);
    if (lesson.cancelCause !== null) {
      throw new ApiException('lesson_cancelled', 409);
    }
    // Both halves of a double take the room ("the same teacher and room");
    // a half cancelled by another cause keeps its own (decision 4).
    const lessons = pair.filter((one) => one.cancelCause === null);
    if (lessons.every((one) => one.roomId === input.roomId)) {
      throw new ApiException('room_unchanged', 409);
    }
    const checked = await storedDayCheck(
      transaction,
      { timetable: this.timetable, pattern: this.pattern },
      { accountId: access.accountId, lessons, roomId: input.roomId },
    );
    // The lesson's own room is no other room to offer.
    const own = new Set(lessons.map((one) => one.roomId));
    await refuseBlocked(transaction, branchId, 'day_change_blocked', {
      ...checked,
      freeRooms: checked.freeRooms.filter((one) => !own.has(one)),
    });
    for (const one of lessons) {
      await transaction
        .updateTable('lessons')
        .set({ room_id: input.roomId, teacher_id: checked.teacherIds.get(one.id) ?? null })
        .where('id', '=', one.id)
        .execute();
    }
    await sql`set constraints all immediate`.execute(transaction);
    await recordChanges(
      transaction,
      access,
      'room',
      lessons.map((one) => ({ from: one, to: { ...one, roomId: input.roomId } })),
      input.reason,
    );
    const lessonIds = lessons.map((one) => one.id);
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.room_change',
      record: { type: 'lesson', id },
      oldValue: { ...valuesOf(lesson), lessonIds },
      newValue: {
        ...valuesOf({
          ...lesson,
          roomId: input.roomId,
          teacherId: checked.teacherIds.get(id) ?? null,
        }),
        lessonIds,
        teacherIds: Object.fromEntries(checked.teacherIds),
        reason: input.reason,
        warnings: checked.warnings.map((one) => one.rule),
        notices: { ...notices },
      },
      requestId,
    });
    return this.answerOf(transaction, branchId, id, moment, checked.warnings);
  }

  /**
   * A one-day move (task 5.6a-2): the lesson's block, every part of it, and
   * for a double both halves, to lesson slots `lessonNumber`, … of the date
   * (decisions 4 to 6, 9; edge/timetable, Structure: blocks "are placed and
   * moved whole"; edge/time-dates-calendar: "A one-day move stays inside the
   * same quarter and targets a school day from today on").
   */
  private async moveLocked(
    transaction: Transaction,
    access: Access,
    id: string,
    input: LessonMoveBody,
    requestId: string,
  ): Promise<DayChangeAnswer> {
    const branchId = branchOf(access);
    const { lesson, pair, week, moment, lessons } = await this.lockedLesson(
      transaction,
      branchId,
      id,
      input.date,
    );
    if (pair.some((one) => one.cancelCause !== null)) {
      throw new ApiException('lesson_cancelled', 409);
    }
    // Every part of the blocks; a part cancelled with a reason moves with
    // them and stays cancelled, one cancelled by another cause (an exam, the
    // day's template) keeps the block where it is (review correction 1).
    const blockIds = [...new Set(pair.map((one) => one.blockId))];
    const parts = lessons.filter((one) => blockIds.includes(one.blockId));
    if (parts.some((one) => one.cancelCause !== null && one.cancelCause !== 'reason')) {
      throw new ApiException('lesson_cancelled', 409);
    }
    const held = parts.filter((one) => one.cancelCause === null);
    const units = new Set(parts.map((one) => one.classId ?? one.groupId ?? ''));
    if (input.roomId !== undefined && units.size > 1) {
      throw new ApiException('move_room_parts', 409);
    }

    const blocks = await transaction
      .selectFrom('lesson_blocks')
      .select(['id', 'quarter_id', 'academic_year_id'])
      .where('id', 'in', blockIds)
      .execute();
    const block = blocks[0];
    if (block === undefined) throw new Error('The lesson’s block was not read.');
    // The quarter of the date: another quarter refuses; none (a vacation,
    // after the year) is the rule check's (review must-fix 2).
    const quarter = await transaction
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', block.academic_year_id)
      .where('branch_id', '=', branchId)
      .where('start_date', '<=', input.date)
      .where('end_date', '>=', input.date)
      .executeTakeFirst();
    if (quarter !== undefined && quarter.id !== block.quarter_id) {
      throw new ApiException('move_other_quarter', 409);
    }

    const services = { timetable: this.timetable, pattern: this.pattern };
    const first = pair[0] ?? lesson;
    const moments = await slotMomentsOn(transaction, services, {
      accountId: access.accountId,
      lesson: first,
      date: input.date,
      lessonNumber: input.lessonNumber,
      count: pair.length,
    });
    if (moments === null) {
      throw new ApiException('move_no_slot', 409);
    }
    const target = new Map(pair.map((one, at) => [one.blockId, moments[at]]));
    const placed = (one: StoredDayLesson): StoredDayLesson => {
      const to = target.get(one.blockId);
      if (to === undefined) throw new Error('A part of the move has no place.');
      return {
        ...one,
        date: input.date,
        startsAt: to.startsAt,
        endsAt: to.endsAt,
        roomId: input.roomId ?? one.roomId,
      };
    };
    if ((moments[0]?.startsAt.getTime() ?? 0) <= moment.getTime()) {
      throw new ApiException('move_target_started', 409);
    }
    // The version in force on the date must be the lesson's (decision 1).
    const inForce = await transaction
      .selectFrom('timetable_versions')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', block.academic_year_id)
      .where('status', '=', 'published')
      .where('starts_on', '<=', input.date)
      .orderBy('starts_on', 'desc')
      .executeTakeFirst();
    if (inForce?.id !== lesson.versionId) {
      throw new ApiException('move_other_version', 409);
    }
    if (
      parts.every((one) => {
        const to = placed(one);
        return (
          to.date === one.date &&
          to.startsAt.getTime() === one.startsAt.getTime() &&
          to.roomId === one.roomId
        );
      })
    ) {
      throw new ApiException('move_unchanged', 409);
    }

    const checked = await storedDayCheck(transaction, services, {
      accountId: access.accountId,
      lessons: held.map(placed),
      alongside: parts.filter((one) => one.cancelCause !== null).map(placed),
      ...(input.roomId === undefined ? {} : { roomId: input.roomId }),
    });
    await refuseBlocked(
      transaction,
      branchId,
      'day_change_blocked',
      units.size > 1 ? { ...checked, freeRooms: [] } : checked,
    );

    // A double moved by one slot meets its own other half while the first
    // block is written: the exclusions are checked on the end state (review
    // must-fix 1).
    await sql`set constraints time_claims_teacher_excl, time_claims_room_excl, time_claims_class_excl deferred`.execute(
      transaction,
    );
    for (const one of pair) {
      const to = target.get(one.blockId);
      if (to === undefined) continue;
      await transaction
        .updateTable('lesson_blocks')
        .set({ lesson_date: input.date, starts_at: to.startsAt, ends_at: to.endsAt })
        .where('id', '=', one.blockId)
        .execute();
    }
    for (const one of held) {
      await transaction
        .updateTable('lessons')
        .set({
          teacher_id: checked.teacherIds.get(one.id) ?? null,
          ...(input.roomId === undefined ? {} : { room_id: input.roomId }),
        })
        .where('id', '=', one.id)
        .execute();
    }
    await sql`set constraints all immediate`.execute(transaction);
    await recordChanges(
      transaction,
      access,
      'move',
      parts.map((one) => ({ from: one, to: placed(one) })),
      input.reason,
    );
    const lessonIds = parts.map((one) => one.id);
    const notices = await sendWeekChanges(transaction, this.notifications, week, {
      kind: 'timetable.day_changed',
    });
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'lesson.move',
      record: { type: 'lesson', id },
      oldValue: { ...valuesOf(lesson), lessonIds },
      newValue: {
        ...valuesOf({ ...placed(lesson), teacherId: checked.teacherIds.get(id) ?? null }),
        lessonIds,
        lessonNumber: input.lessonNumber,
        teacherIds: Object.fromEntries(checked.teacherIds),
        reason: input.reason,
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

/**
 * Refuses a one-day change whose check found a blocked rule, with the
 * results and the free rooms of its time, by name.
 */
async function refuseBlocked(
  transaction: Transaction,
  branchId: string,
  code: 'restore_blocked' | 'day_change_blocked',
  checked: StoredDayResult,
): Promise<void> {
  if (checked.blocked.length === 0) return;
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
  throw new ApiException(code, 409, undefined, [
    ...checked.blocked.map(blockedDetail),
    ...rooms.map((room) => ({
      path: 'rooms',
      code: 'room_free',
      message: 'A room free at the lesson’s time.',
      room: { id: room.id, name: room.name },
    })),
  ]);
}

/**
 * Stores what each lesson of a one-day room change or move was and became
 * (decision 8), at the transaction's moment, so that a publish can apply it
 * again (5.6a-5).
 */
async function recordChanges(
  transaction: Transaction,
  access: Access,
  kind: 'room' | 'move',
  changes: readonly { readonly from: StoredDayLesson; readonly to: StoredDayLesson }[],
  reason: string,
): Promise<void> {
  if (changes.length === 0) return;
  const moment = await transactionMoment(transaction);
  await transaction
    .insertInto('lesson_day_changes')
    .values(
      changes.map(({ from, to }) => ({
        branch_id: from.branchId,
        lesson_id: from.id,
        kind,
        class_id: from.classId,
        group_id: from.groupId,
        subject_id: from.subjectId,
        load_row_id: from.loadRowId,
        from_date: from.date,
        from_starts_at: from.startsAt,
        from_ends_at: from.endsAt,
        from_room_id: from.roomId,
        to_date: to.date,
        to_starts_at: to.startsAt,
        to_ends_at: to.endsAt,
        to_room_id: to.roomId,
        reason,
        changed_at: moment,
        changed_by: access.accountId,
      })),
    )
    .execute();
}

/**
 * The lesson slots of a class's day on a date (task 5.6a-2, decision 12): the
 * day template of the class's grade on the date; none on a day without
 * lessons.
 */
async function classSlotsOn(
  transaction: Transaction,
  branchId: string,
  classId: string,
  date: string,
): Promise<DaySlot[]> {
  const [schoolClass, branch] = await Promise.all([
    transaction
      .selectFrom('classes')
      .select('grade')
      .where('id', '=', classId)
      .executeTakeFirstOrThrow(),
    transaction
      .selectFrom('branches')
      .select('working_weekdays')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow(),
  ]);
  const [settings, store] = await Promise.all([
    loadCalendarSettings(transaction, branch.working_weekdays),
    loadStore(transaction),
  ]);
  const found = dayOn(schoolClass.grade, date, settings);
  if (!found.lessons) return [];
  const timed = dayOf(store, found.dayTemplateId, date);
  if (timed === null) return [];
  return timed.day.slots.flatMap((slot) =>
    slot.lessonNumber === null
      ? []
      : [{ lessonNumber: slot.lessonNumber, start: slot.start, end: slot.end }],
  );
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
