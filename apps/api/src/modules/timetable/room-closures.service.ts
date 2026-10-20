import { Injectable } from '@nestjs/common';
import {
  classDisplayName,
  lessonStateOf,
  listName,
  needsRoomOf,
  schoolDateOf,
  type ErrorDetail,
  type RoomClosure,
  type RoomClosureEdit,
  type RoomClosureLessons,
  type RoomClosureList,
  type RoomClosureMove,
  type RoomClosureMoveAnswer,
  type RoomClosureRecord,
  type RoomClosuresQuery,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { awayLessons } from './away-read.js';
import { dayBeginnings } from './dated-check.js';
import { blockedDetail, recordChanges, valuesOf as lessonValuesOf } from './day-changes.service.js';
import { TimetablePattern } from './pattern.service.js';
import { lockPublishChain } from './publish.service.js';
import { roomsOutLessons } from './rooms-out-read.js';
import { pairOf, storedDayCheck, storedLessonsOn, type StoredDayLesson } from './stored-day.js';
import { Timetable } from './timetable.service.js';
import { sendWeekChanges, snapshotDates } from './week-changes.js';

/**
 * Room closures (task 5.7a-2b, pull request #187; `edge/timetable`, After
 * publishing, "A laboratory is under repair for three weeks": "A room
 * closure has a start, an end and a reason. Lessons in the range go to
 * 'needs a room', with 'move all to room R for the period'. The pattern is
 * unchanged and the lessons return afterwards.").
 *
 * A closure writes no lesson (decision 1): a lesson keeps its room and reads
 * "needs a room" from the stored moments on every request (`rooms-out-read.ts`).
 * The days are typed; the moments are what the rule compares, as for an
 * absence (decision 4):
 * - a new closure starts today or later; one from today starts at the save;
 * - the first day changes only before the closure starts, to today or later;
 *   the last day today or later, or the day before today, which ends the
 *   closure at the save (its last day stays at least its first);
 * - a closure that has ended is not changed (`room_closure_ended`); a
 *   withdraw only before it starts, and it is final (`room_closure_withdrawn`).
 * "Move all" is all or nothing (decision 6): each lesson moves as a one-day
 * room change, checked by the same rules, and one blocked lesson refuses the
 * whole move, listing every blocked lesson.
 */

const EXCLUSION_VIOLATION = '23P01';
const DAY = 86_400_000;

const nextDay = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
const dayBefore = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

const COLUMNS = [
  'room_closures.id',
  'room_closures.room_id',
  'room_closures.starts_on',
  'room_closures.ends_on',
  'room_closures.applies_from',
  'room_closures.applies_until',
  'room_closures.reason',
  'room_closures.withdrawn_at',
] as const;

/** The same columns as a write returns them. */
const RETURNING = [
  'id',
  'room_id',
  'starts_on',
  'ends_on',
  'applies_from',
  'applies_until',
  'reason',
  'withdrawn_at',
] as const;

interface ClosureRow {
  readonly id: string;
  readonly room_id: string;
  readonly starts_on: string;
  readonly ends_on: string;
  readonly applies_from: Date;
  readonly applies_until: Date;
  readonly reason: string;
  readonly withdrawn_at: Date | null;
}

/** What the audit entry keeps of a closure. */
function valuesOf(row: ClosureRow) {
  return {
    roomId: row.room_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    appliesFrom: row.applies_from.toISOString(),
    appliesUntil: row.applies_until.toISOString(),
    reason: row.reason,
  };
}

function stateOf(row: ClosureRow, moment: Date): RoomClosure['state'] {
  if (row.withdrawn_at !== null) return 'withdrawn';
  if (row.applies_until.getTime() <= moment.getTime()) return 'ended';
  return row.applies_from.getTime() > moment.getTime() ? 'planned' : 'current';
}

const answerOf = (row: ClosureRow, roomName: string, moment: Date): RoomClosure => {
  const state = stateOf(row, moment);
  return {
    id: row.id,
    room: { id: row.room_id, name: roomName },
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    reason: row.reason,
    state,
    canEdit: state === 'planned' || state === 'current',
    canWithdraw: state === 'planned',
  };
};

@Injectable()
export class TimetableRoomClosures {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly timetable: Timetable,
    private readonly pattern: TimetablePattern,
    private readonly notifications: Notifications,
  ) {}

  /** The closures of the branch's rooms, newest first. */
  list(access: Access, query: RoomClosuresQuery): Promise<RoomClosureList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const moment = await transactionMoment(transaction);
      let rows = transaction
        .selectFrom('room_closures')
        .innerJoin('rooms', 'rooms.id', 'room_closures.room_id')
        .select([...COLUMNS, 'rooms.name as room_name'])
        .where('room_closures.branch_id', '=', branchId);
      if (query.state === 'open') {
        rows = rows
          .where('room_closures.withdrawn_at', 'is', null)
          .where('room_closures.applies_until', '>', moment);
      }
      const found = await rows
        .orderBy('room_closures.starts_on', 'desc')
        .orderBy('room_closures.id', 'desc')
        .execute();
      return { closures: found.map((row) => answerOf(row, row.room_name, moment)) };
    });
  }

  /** Closes a room of the branch from a day to a day (decisions 3 and 4). */
  create(access: Access, input: RoomClosureRecord, requestId: string): Promise<RoomClosure> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const room = await this.roomOf(transaction, branchId, input.roomId);
      if (room.status === 'closed') throw new ApiException('room_closure_room', 422);
      const { moment, today, beginsOf } = await this.timesOf(
        transaction,
        branchId,
        input.startsOn,
        input.endsOn,
      );
      if (input.startsOn < today) throw new ApiException('room_closure_past', 409);
      const from = input.startsOn === today ? moment : beginsOf(input.startsOn);
      const until = beginsOf(nextDay(input.endsOn));
      await this.refuseOverlap(transaction, input.roomId, null, from, until);
      const row = await this.writing(() =>
        transaction
          .insertInto('room_closures')
          .values({
            branch_id: branchId,
            room_id: input.roomId,
            starts_on: input.startsOn,
            ends_on: input.endsOn,
            applies_from: from,
            applies_until: until,
            reason: input.reason,
            created_by: access.accountId,
          })
          .returning(RETURNING)
          .executeTakeFirstOrThrow(),
      );
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'room_closure.create',
        record: { type: 'room_closure', id: row.id },
        newValue: valuesOf(row),
        requestId,
      });
      return answerOf(row, room.name, moment);
    });
  }

  /** Changes the days of a closure (decision 4). */
  edit(
    access: Access,
    id: string,
    input: RoomClosureEdit,
    requestId: string,
  ): Promise<RoomClosure> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const before = await this.lockedRow(transaction, branchId, id);
      const room = await this.roomOf(transaction, branchId, before.room_id);
      const { moment, today, beginsOf } = await this.timesOf(
        transaction,
        branchId,
        input.startsOn < before.starts_on ? input.startsOn : before.starts_on,
        input.endsOn,
      );
      if (before.applies_until.getTime() <= moment.getTime()) {
        throw new ApiException('room_closure_ended', 409);
      }
      const started = before.applies_from.getTime() <= moment.getTime();
      let from = before.applies_from;
      if (started) {
        if (input.startsOn !== before.starts_on) throw new ApiException('room_closure_past', 409);
      } else if (input.startsOn !== before.starts_on) {
        if (input.startsOn < today) throw new ApiException('room_closure_past', 409);
        from = input.startsOn === today ? moment : beginsOf(input.startsOn);
      }
      let endsOn = input.endsOn;
      let until: Date;
      if (input.endsOn >= today) {
        if (input.endsOn < input.startsOn) throw new ApiException('room_closure_past', 409);
        until = beginsOf(nextDay(input.endsOn));
      } else if (input.endsOn === dayBefore(today) && started) {
        // Back in use today: the closure ends at the save; its last day
        // stays at least its first.
        until = moment;
        endsOn = input.endsOn < before.starts_on ? before.starts_on : input.endsOn;
      } else {
        throw new ApiException('room_closure_past', 409);
      }
      if (until.getTime() <= from.getTime()) throw new ApiException('room_closure_past', 409);
      await this.refuseOverlap(transaction, before.room_id, id, from, until);
      const row = await this.writing(() =>
        transaction
          .updateTable('room_closures')
          .set({
            starts_on: input.startsOn,
            ends_on: endsOn,
            applies_from: from,
            applies_until: until,
          })
          .where('id', '=', id)
          .returning(RETURNING)
          .executeTakeFirstOrThrow(),
      );
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'room_closure.edit',
        record: { type: 'room_closure', id },
        oldValue: valuesOf(before),
        newValue: valuesOf(row),
        requestId,
      });
      return answerOf(row, room.name, moment);
    });
  }

  /** Withdraws a closure that has not started; final. */
  withdraw(access: Access, id: string, requestId: string): Promise<RoomClosure> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const before = await this.lockedRow(transaction, branchId, id);
      const room = await this.roomOf(transaction, branchId, before.room_id);
      const moment = await transactionMoment(transaction);
      if (before.applies_until.getTime() <= moment.getTime()) {
        throw new ApiException('room_closure_ended', 409);
      }
      if (before.applies_from.getTime() <= moment.getTime()) {
        throw new ApiException('room_closure_past', 409);
      }
      const row = await transaction
        .updateTable('room_closures')
        .set({ withdrawn_at: moment })
        .where('id', '=', id)
        .returning(RETURNING)
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'room_closure.withdraw',
        record: { type: 'room_closure', id },
        oldValue: valuesOf(before),
        newValue: { withdrawnAt: moment.toISOString() },
        requestId,
      });
      return answerOf(row, room.name, moment);
    });
  }

  /** The lessons of the room that start inside the closure, not cancelled, with their state. */
  lessons(access: Access, id: string): Promise<RoomClosureLessons> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const closure = await this.visibleRow(transaction, branchId, id);
      const moment = await transactionMoment(transaction);
      if (closure.withdrawn_at !== null) return { lessons: [] };
      const rows = await transaction
        .selectFrom('lessons')
        .leftJoin('classes', 'classes.id', 'lessons.class_id')
        .leftJoin('groups', 'groups.id', 'lessons.group_id')
        .innerJoin('subjects', 'subjects.id', 'lessons.subject_id')
        .leftJoin('staff', 'staff.id', 'lessons.teacher_id')
        .select([
          'lessons.id',
          sql<string>`lessons.lesson_date::text`.as('date'),
          'lessons.starts_at',
          'lessons.ends_at',
          'lessons.teacher_id',
          'lessons.room_id',
          'classes.grade',
          'classes.name as class_name',
          'groups.name as group_name',
          'subjects.name_uz',
          'subjects.name_ru',
          'subjects.name_en',
          'staff.kind',
          'staff.first_name',
          'staff.last_name',
          'staff.vacancy_name',
        ])
        .where('lessons.branch_id', '=', branchId)
        .where('lessons.room_id', '=', closure.room_id)
        .where('lessons.cancel_cause', 'is', null)
        .where('lessons.starts_at', '>=', closure.applies_from)
        .where('lessons.starts_at', '<', closure.applies_until)
        .orderBy('lessons.starts_at')
        .orderBy('lessons.id')
        .execute();
      if (rows.length === 0) return { lessons: [] };
      const stated = rows.map((row) => ({
        id: row.id,
        teacherId: row.teacher_id,
        roomId: row.room_id,
        startsAt: row.starts_at,
      }));
      const away = await awayLessons(transaction, stated);
      const out = await roomsOutLessons(transaction, stated);
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const dates = rows.map((row) => row.date);
      const begins = await dayBeginnings(
        transaction,
        branch.time_zone,
        dates[0] ?? '',
        dates[dates.length - 1] ?? '',
      );
      const minutes = (date: string, at: Date) =>
        Math.round((at.getTime() - begins(date).getTime()) / 60_000);
      return {
        lessons: rows.map((row) => ({
          id: row.id,
          date: row.date,
          start: minutes(row.date, row.starts_at),
          end: minutes(row.date, row.ends_at),
          unit:
            row.class_name !== null && row.grade !== null
              ? classDisplayName(row.grade, row.class_name)
              : (row.group_name ?? ''),
          subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
          teacher:
            row.teacher_id === null || row.kind === null
              ? null
              : row.kind === 'vacancy'
                ? (row.vacancy_name ?? '')
                : listName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' }),
          state: lessonStateOf(
            {
              startsAt: row.starts_at,
              cancelled: false,
              // A teacher the branch filter hides is a person (a vacancy has one branch).
              teacher:
                row.teacher_id === null ? null : row.kind === 'vacancy' ? 'vacancy' : 'person',
              away: away.has(row.id),
            },
            moment,
          ),
          needsRoom: needsRoomOf(
            { startsAt: row.starts_at, cancelled: false, roomOut: out.get(row.id)?.cause ?? null },
            moment,
          ),
        })),
      };
    });
  }

  /**
   * "Move all to room R for the period" (decisions 6 and 12): every lesson
   * still in the room that starts inside the closure and has not started,
   * the halves of a double together, moved to R as one-day room changes. The
   * closure row and then the lessons are locked before the check, so what is
   * written is what was checked (spec review should-fix 2).
   */
  move(
    access: Access,
    id: string,
    input: RoomClosureMove,
    requestId: string,
  ): Promise<RoomClosureMoveAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.roomOf(transaction, branchId, input.roomId);
      const closure = await this.lockedRow(transaction, branchId, id);
      if (input.roomId === closure.room_id) throw new ApiException('room_closure_room', 422);
      const moment = await transactionMoment(transaction);
      if (closure.applies_until.getTime() <= moment.getTime()) {
        throw new ApiException('room_closure_ended', 409);
      }
      const from =
        closure.applies_from.getTime() > moment.getTime() ? closure.applies_from : moment;
      const listed = await transaction
        .selectFrom('lessons')
        .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
        .select([
          sql<string>`lessons.lesson_date::text`.as('date'),
          'lesson_blocks.academic_year_id',
        ])
        .where('lessons.branch_id', '=', branchId)
        .where('lessons.room_id', '=', closure.room_id)
        .where('lessons.cancel_cause', 'is', null)
        .where('lessons.starts_at', '>', from)
        .where('lessons.starts_at', '<', closure.applies_until)
        .execute();
      if (listed.length === 0) throw new ApiException('room_closure_nothing', 409);
      for (const yearId of [...new Set(listed.map((one) => one.academic_year_id))].sort()) {
        await lockPublishChain(transaction, branchId, yearId);
      }
      const dates = [...new Set(listed.map((one) => one.date))].sort();
      const week = await snapshotDates(transaction, branchId, dates);
      const services = { timetable: this.timetable, pattern: this.pattern };
      const blocked: ErrorDetail[] = [];
      const movedIds: string[] = [];
      for (const date of dates) {
        // Read again after the locks: a publish or a change may have moved one.
        const day = await storedLessonsOn(transaction, branchId, date);
        const inRoom = (one: StoredDayLesson) =>
          one.cancelCause === null &&
          one.roomId === closure.room_id &&
          one.startsAt.getTime() >= closure.applies_from.getTime() &&
          one.startsAt.getTime() < closure.applies_until.getTime();
        const done = new Set<string>();
        for (const lesson of day.filter(inRoom)) {
          if (done.has(lesson.id)) continue;
          const pair = pairOf(day, lesson);
          for (const half of pair) done.add(half.id);
          // A double has started when its earlier half has (5.6a-1, decision 3).
          if (pair.some((half) => half.startsAt.getTime() <= moment.getTime())) continue;
          const lessons = pair.filter((half) => half.cancelCause === null);
          const checked = await storedDayCheck(transaction, services, {
            accountId: access.accountId,
            lessons,
            roomId: input.roomId,
            closures: true,
          });
          if (checked.blocked.length > 0) {
            blocked.push(
              ...checked.blocked.map((one) =>
                blockedDetail(one, 'A blocked rule of a lesson moved to the room on its date.'),
              ),
            );
            continue;
          }
          for (const one of lessons) {
            await transaction
              .updateTable('lessons')
              .set({ room_id: input.roomId, teacher_id: checked.teacherIds.get(one.id) ?? null })
              .where('id', '=', one.id)
              .execute();
          }
          await recordChanges(
            transaction,
            access,
            'room',
            lessons.map((one) => ({ from: one, to: { ...one, roomId: input.roomId } })),
            input.reason,
          );
          const lessonIds = lessons.map((one) => one.id);
          // The same entry as the room route's, for each lesson moved
          // (spec review should-fix 5).
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'lesson.room_change',
            record: { type: 'lesson', id: lesson.id },
            oldValue: { ...lessonValuesOf(lesson), lessonIds },
            newValue: {
              ...lessonValuesOf({
                ...lesson,
                roomId: input.roomId,
                teacherId: checked.teacherIds.get(lesson.id) ?? null,
              }),
              lessonIds,
              teacherIds: Object.fromEntries(checked.teacherIds),
              reason: input.reason,
              warnings: checked.warnings.map((one) => one.rule),
              roomClosureId: id,
            },
            requestId,
          });
          movedIds.push(...lessonIds);
        }
      }
      // All or nothing (decision 6): the transaction rolls back every move.
      if (blocked.length > 0) {
        throw new ApiException('room_move_blocked', 409, undefined, blocked);
      }
      if (movedIds.length === 0) throw new ApiException('room_closure_nothing', 409);
      await sql`set constraints all immediate`.execute(transaction);
      const notices = await sendWeekChanges(transaction, this.notifications, week, {
        kind: 'timetable.day_changed',
      });
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'room_closure.move',
        record: { type: 'room_closure', id },
        newValue: {
          roomId: input.roomId,
          reason: input.reason,
          lessonIds: movedIds,
          notices: { ...notices },
        },
        requestId,
      });
      return { moved: movedIds.length };
    });
  }

  /** A room of the branch of the request, or 404. */
  private async roomOf(
    transaction: Transaction,
    branchId: string,
    roomId: string,
  ): Promise<{ name: string; status: string }> {
    const found = await transaction
      .selectFrom('rooms')
      .select(['name', 'status'])
      .where('id', '=', roomId)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    return found;
  }

  /** The closure of the branch of the request, or 404. */
  private async visibleRow(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<ClosureRow> {
    const found = await transaction
      .selectFrom('room_closures')
      .select(COLUMNS)
      .where('room_closures.id', '=', id)
      .where('room_closures.branch_id', '=', branchId)
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    return found;
  }

  /** The closure locked before its checks; a withdrawn one is final. */
  private async lockedRow(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<ClosureRow> {
    await this.visibleRow(transaction, branchId, id);
    const row = await transaction
      .selectFrom('room_closures')
      .select(COLUMNS)
      .where('room_closures.id', '=', id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (row.withdrawn_at !== null) throw new ApiException('room_closure_withdrawn', 409);
    return row;
  }

  /** The moment, today in branch time, and the start of each day from `first` on. */
  private async timesOf(
    transaction: Transaction,
    branchId: string,
    first: string,
    last: string,
  ): Promise<{ moment: Date; today: string; beginsOf: (date: string) => Date }> {
    const moment = await transactionMoment(transaction);
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const today = schoolDateOf(moment, branch.time_zone);
    const from = first < today ? first : today;
    const latest = [first, last, today].sort().at(-1) ?? today;
    return {
      moment,
      today,
      beginsOf: await dayBeginnings(transaction, branch.time_zone, from, nextDay(latest)),
    };
  }

  /** Refuses a closure that meets another live one of the room, naming it. */
  private async refuseOverlap(
    transaction: Transaction,
    roomId: string,
    own: string | null,
    from: Date,
    until: Date,
  ): Promise<void> {
    let query = transaction
      .selectFrom('room_closures')
      .select(['id', 'starts_on'])
      .where('room_id', '=', roomId)
      .where('withdrawn_at', 'is', null)
      .where('applies_from', '<', until)
      .where('applies_until', '>', from);
    if (own !== null) query = query.where('id', '<>', own);
    const other = await query.orderBy('applies_from').executeTakeFirst();
    if (other === undefined) return;
    throw new ApiException('room_closure_overlap', 409, undefined, [
      {
        path: 'startsOn',
        code: 'room_closure_overlap',
        message: 'Another closure of the room covers these days.',
        recordId: other.id,
        day: other.starts_on,
      },
    ]);
  }

  /** Two saves at one moment past the check above meet the exclusion of 0098. */
  private async writing<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (
        failure.code === EXCLUSION_VIOLATION &&
        failure.constraint === 'room_closures_no_overlap'
      ) {
        throw new ApiException('room_closure_overlap', 409);
      }
      throw error;
    }
  }
}

