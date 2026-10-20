import { Injectable } from '@nestjs/common';
import {
  ABSENCE_PERMANENT_DAYS,
  classDisplayName,
  listName,
  lessonStateOf,
  schoolDateOf,
  type Absence,
  type AbsenceEdit,
  type AbsenceLessons,
  type AbsenceList,
  type AbsenceRecord,
  type AbsencesQuery,
  type Attention,
  type AttentionGroup,
  type ErrorDetail,
  type NotificationKind,
} from '@sodiq/shared';
import { isSchoolDay } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { Notifications } from '../notifications/notifications.service.js';
import { loadCalendarSettings } from '../setup/calendar-state.js';
import { notFound } from '../setup/setup-refusals.js';
import { absenceSpans, absentLessons } from './absences-read.js';
import { dayBeginnings } from './dated-check.js';

/**
 * Teacher absences (task 5.7a-1, pull request #185). An absence is entered
 * once for the person and covers every branch (`06`, Teachers who work in
 * several branches). It writes no lesson: a lesson keeps its teacher and its
 * state is read from the stored moments on every request (decision 7).
 *
 * The days are typed; the moments are what the rule compares (decision 5;
 * review corrections 1 and 2): a save never changes the state of a lesson
 * that has started.
 * - A new absence starts today or later; one from today starts at the save.
 * - A change of the first day only before the absence starts, to today or
 *   later; the last day today or later, or the day before today, which ends
 *   the absence at the save (its last day stays at least its first).
 * - An absence that has ended is not changed (a new one is entered); a
 *   withdraw only before it starts, and it is final.
 */

const EXCLUSION_VIOLATION = '23P01';
const DAY = 86_400_000;

const nextDay = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + DAY).toISOString().slice(0, 10);
const dayBefore = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - DAY).toISOString().slice(0, 10);

interface AbsenceRow {
  readonly id: string;
  readonly staff_id: string;
  readonly starts_on: string;
  readonly ends_on: string | null;
  readonly applies_from: Date;
  readonly applies_until: Date | null;
  readonly reason: string;
  readonly withdrawn_at: Date | null;
}

/** What the audit entry and the notice keep of an absence. */
function valuesOf(row: AbsenceRow) {
  return {
    staffId: row.staff_id,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    appliesFrom: row.applies_from.toISOString(),
    appliesUntil: row.applies_until === null ? null : row.applies_until.toISOString(),
    reason: row.reason,
  };
}

function stateOf(row: AbsenceRow, moment: Date): Absence['state'] {
  if (row.withdrawn_at !== null) return 'withdrawn';
  if (row.applies_until !== null && row.applies_until.getTime() <= moment.getTime()) {
    return 'ended';
  }
  return row.applies_from.getTime() > moment.getTime() ? 'planned' : 'current';
}

@Injectable()
export class TimetableAbsences {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly notifications: Notifications,
  ) {}

  /** The absences of the persons linked to the branch of the request, newest first. */
  list(access: Access, query: AbsencesQuery): Promise<AbsenceList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const moment = await transactionMoment(transaction);
      let rows = transaction
        .selectFrom('absences')
        .innerJoin('staff', 'staff.id', 'absences.staff_id')
        .select([
          'absences.id',
          'absences.staff_id',
          'absences.starts_on',
          'absences.ends_on',
          'absences.applies_from',
          'absences.applies_until',
          'absences.reason',
          'absences.withdrawn_at',
          'staff.first_name',
          'staff.last_name',
        ])
        .where((eb) =>
          eb.exists(
            eb
              .selectFrom('staff_branches')
              .select('staff_branches.staff_id')
              .whereRef('staff_branches.staff_id', '=', 'absences.staff_id')
              .where('staff_branches.branch_id', '=', branchId),
          ),
        );
      if (query.state === 'open') {
        rows = rows
          .where('absences.withdrawn_at', 'is', null)
          .where((eb) =>
            eb.or([
              eb('absences.applies_until', 'is', null),
              eb('absences.applies_until', '>', moment),
            ]),
          );
      }
      const found = await rows
        .orderBy('absences.starts_on', 'desc')
        .orderBy('absences.id', 'desc')
        .execute();
      return {
        absences: found.map((row) => {
          const state = stateOf(row, moment);
          return {
            id: row.id,
            staff: {
              id: row.staff_id,
              name: listName({ firstName: row.first_name ?? '', lastName: row.last_name ?? '' }),
            },
            startsOn: row.starts_on,
            endsOn: row.ends_on,
            reason: row.reason,
            state,
            canEdit: state === 'planned' || state === 'current',
            canWithdraw: state === 'planned',
          };
        }),
      };
    });
  }

  /** Enters an absence for a person of the branch (decisions 5 and 11). */
  create(access: Access, input: AbsenceRecord, requestId: string): Promise<Absence> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const person = await this.personOf(transaction, branchId, input.staffId);
      const { moment, today, beginsOf } = await this.timesOf(
        transaction,
        branchId,
        input.startsOn,
        input.endsOn,
      );
      if (input.startsOn < today) {
        throw new ApiException('absence_past', 409);
      }
      const from = input.startsOn === today ? moment : beginsOf(input.startsOn);
      const until = input.endsOn === null ? null : beginsOf(nextDay(input.endsOn));
      await this.refuseOverlap(transaction, input.staffId, null, from, until);
      const row = await this.writing(() =>
        transaction
          .insertInto('absences')
          .values({
            staff_id: input.staffId,
            starts_on: input.startsOn,
            ends_on: input.endsOn,
            applies_from: from,
            applies_until: until,
            reason: input.reason,
            created_by: access.accountId,
          })
          .returning([
            'id',
            'staff_id',
            'starts_on',
            'ends_on',
            'applies_from',
            'applies_until',
            'reason',
            'withdrawn_at',
          ])
          .executeTakeFirstOrThrow(),
      );
      const notified = await this.tell(
        transaction,
        access,
        branchId,
        person.name,
        row,
        input.endsOn === null ? 'timetable.absence_entered_open' : 'timetable.absence_entered',
        from,
        until,
      );
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'absence.create',
        record: { type: 'absence', id: row.id },
        newValue: { ...valuesOf(row), notified },
        requestId,
      });
      return this.answerOf(row, person.name, moment);
    });
  }

  /** Changes the days of an absence (decision 5; review corrections 1 and 2). */
  edit(access: Access, id: string, input: AbsenceEdit, requestId: string): Promise<Absence> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const before = await this.lockedRow(transaction, branchId, id);
      const person = await this.personOf(transaction, branchId, before.staff_id);
      const { moment, today, beginsOf } = await this.timesOf(
        transaction,
        branchId,
        input.startsOn < before.starts_on ? input.startsOn : before.starts_on,
        input.endsOn,
      );
      if (before.applies_until !== null && before.applies_until.getTime() <= moment.getTime()) {
        throw new ApiException('absence_past', 409);
      }
      const started = before.applies_from.getTime() <= moment.getTime();
      let from = before.applies_from;
      if (started) {
        if (input.startsOn !== before.starts_on) throw new ApiException('absence_past', 409);
      } else if (input.startsOn !== before.starts_on) {
        if (input.startsOn < today) throw new ApiException('absence_past', 409);
        from = input.startsOn === today ? moment : beginsOf(input.startsOn);
      }
      let endsOn = input.endsOn;
      let until: Date | null;
      if (input.endsOn === null) {
        until = null;
      } else if (input.endsOn >= today) {
        if (input.endsOn < input.startsOn) throw new ApiException('absence_past', 409);
        until = beginsOf(nextDay(input.endsOn));
      } else if (input.endsOn === dayBefore(today) && started) {
        // Review correction 1: back today, the absence ends at the save; its
        // last day stays at least its first.
        until = moment;
        endsOn = input.endsOn < before.starts_on ? before.starts_on : input.endsOn;
      } else {
        throw new ApiException('absence_past', 409);
      }
      if (until !== null && until.getTime() <= from.getTime()) {
        throw new ApiException('absence_past', 409);
      }
      await this.refuseOverlap(transaction, before.staff_id, id, from, until);
      const row = await this.writing(() =>
        transaction
          .updateTable('absences')
          .set({
            starts_on: input.startsOn,
            ends_on: endsOn,
            applies_from: from,
            applies_until: until,
          })
          .where('id', '=', id)
          .returning([
            'id',
            'staff_id',
            'starts_on',
            'ends_on',
            'applies_from',
            'applies_until',
            'reason',
            'withdrawn_at',
          ])
          .executeTakeFirstOrThrow(),
      );
      const reach = {
        from: before.applies_from.getTime() < from.getTime() ? before.applies_from : from,
        until:
          before.applies_until === null || until === null
            ? null
            : before.applies_until.getTime() > until.getTime()
              ? before.applies_until
              : until,
      };
      const notified = await this.tell(
        transaction,
        access,
        branchId,
        person.name,
        row,
        row.ends_on === null ? 'timetable.absence_changed_open' : 'timetable.absence_changed',
        reach.from,
        reach.until,
      );
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'absence.edit',
        record: { type: 'absence', id },
        oldValue: valuesOf(before),
        newValue: { ...valuesOf(row), notified },
        requestId,
      });
      return this.answerOf(row, person.name, moment);
    });
  }

  /** Withdraws an absence that has not started (decision 5); final. */
  withdraw(access: Access, id: string, requestId: string): Promise<Absence> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const before = await this.lockedRow(transaction, branchId, id);
      const person = await this.personOf(transaction, branchId, before.staff_id);
      const moment = await transactionMoment(transaction);
      if (before.applies_from.getTime() <= moment.getTime()) {
        throw new ApiException('absence_past', 409);
      }
      const row = await transaction
        .updateTable('absences')
        .set({ withdrawn_at: moment })
        .where('id', '=', id)
        .returning([
          'id',
          'staff_id',
          'starts_on',
          'ends_on',
          'applies_from',
          'applies_until',
          'reason',
          'withdrawn_at',
        ])
        .executeTakeFirstOrThrow();
      const notified = await this.tell(
        transaction,
        access,
        branchId,
        person.name,
        row,
        'timetable.absence_withdrawn',
        before.applies_from,
        before.applies_until,
      );
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'absence.withdraw',
        record: { type: 'absence', id },
        oldValue: valuesOf(before),
        newValue: { withdrawnAt: moment.toISOString(), notified },
        requestId,
      });
      return this.answerOf(row, person.name, moment);
    });
  }

  /**
   * The branch's own lessons of the person inside the absence, not
   * cancelled, with their state: "the list of own affected lessons" (`06`,
   * Teachers who work in several branches, Absence).
   */
  lessons(access: Access, id: string): Promise<AbsenceLessons> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const absence = await this.visibleRow(transaction, branchId, id);
      const moment = await transactionMoment(transaction);
      if (absence.withdrawn_at !== null) return { lessons: [] };
      let query = transaction
        .selectFrom('lessons')
        .leftJoin('classes', 'classes.id', 'lessons.class_id')
        .leftJoin('groups', 'groups.id', 'lessons.group_id')
        .innerJoin('subjects', 'subjects.id', 'lessons.subject_id')
        .leftJoin('rooms', 'rooms.id', 'lessons.room_id')
        .select([
          'lessons.id',
          sql<string>`lessons.lesson_date::text`.as('date'),
          'lessons.starts_at',
          'lessons.ends_at',
          'lessons.teacher_id',
          'classes.grade',
          'classes.name as class_name',
          'groups.name as group_name',
          'subjects.name_uz',
          'subjects.name_ru',
          'subjects.name_en',
          'rooms.name as room_name',
        ])
        .where('lessons.branch_id', '=', branchId)
        .where('lessons.teacher_id', '=', absence.staff_id)
        .where('lessons.cancel_cause', 'is', null)
        .where('lessons.starts_at', '>=', absence.applies_from);
      if (absence.applies_until !== null) {
        query = query.where('lessons.starts_at', '<', absence.applies_until);
      }
      const rows = await query.orderBy('lessons.starts_at').orderBy('lessons.id').execute();
      if (rows.length === 0) return { lessons: [] };
      const absent = await absentLessons(
        transaction,
        rows.map((row) => ({ id: row.id, teacherId: row.teacher_id, startsAt: row.starts_at })),
      );
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
          room: row.room_name,
          state: lessonStateOf(
            {
              startsAt: row.starts_at,
              cancelled: false,
              teacher: 'person',
              absent: absent.has(row.id),
            },
            moment,
          ),
        })),
      };
    });
  }

  /**
   * The home page's "needs a teacher" and "unresolved" lists of the branch's
   * years not closed (decision 9, read at the build as "the open years"): one row per cause, an absence of a person, a
   * vacancy or nobody recorded.
   */
  attention(access: Access): Promise<Attention> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const moment = await transactionMoment(transaction);
      const lessons = await transaction
        .selectFrom('lessons')
        .innerJoin('lesson_blocks', 'lesson_blocks.id', 'lessons.block_id')
        .innerJoin('academic_years', 'academic_years.id', 'lesson_blocks.academic_year_id')
        .leftJoin('staff', 'staff.id', 'lessons.teacher_id')
        .select([
          'lessons.id',
          sql<string>`lessons.lesson_date::text`.as('date'),
          'lessons.starts_at',
          'lessons.teacher_id',
          'staff.kind',
          'staff.first_name',
          'staff.last_name',
          'staff.vacancy_name',
        ])
        .where('lessons.branch_id', '=', branchId)
        // Every year not closed: a planned year can hold published lessons
        // too (`edge/timetable`, "The school needs next year's timetable in August").
        .where('academic_years.status', '<>', 'closed')
        .where('lessons.cancel_cause', 'is', null)
        .orderBy('lessons.starts_at')
        .execute();
      if (lessons.length === 0) return { needsTeacher: [], unresolved: [] };
      const absent = await absentLessons(
        transaction,
        lessons.map((one) => ({ id: one.id, teacherId: one.teacher_id, startsAt: one.starts_at })),
      );
      // The days of each absence: its stored row when the branch sees it,
      // else read from its moments, so that a branch whose link to the person
      // was removed reads the same absence (decision 3; spec review must-fix 3).
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const spans = new Map([...absent.values()].map((one) => [one.absenceId, one]));
      const stored =
        spans.size === 0
          ? []
          : await transaction
              .selectFrom('absences')
              .select(['id', 'starts_on', 'ends_on'])
              .where('id', 'in', [...spans.keys()])
              .execute();
      const storedOf = new Map(stored.map((one) => [one.id, one]));
      const absences = [...spans.values()].map((span) => {
        const row = storedOf.get(span.absenceId);
        return {
          id: span.absenceId,
          starts_on: row?.starts_on ?? schoolDateOf(span.from, branch.time_zone),
          ends_on:
            row === undefined
              ? span.until === null
                ? null
                : schoolDateOf(new Date(span.until.getTime() - 1), branch.time_zone)
              : row.ends_on,
        };
      });
      const absenceOf = new Map(absences.map((one) => [one.id, one]));
      const permanent = await this.permanentOf(transaction, branchId, moment, absences);

      const groups = {
        needsTeacher: new Map<string, AttentionGroup>(),
        unresolved: new Map<string, AttentionGroup>(),
      };
      for (const one of lessons) {
        const span = absent.get(one.id);
        // The one place of a lesson's state (5.6a-4 decision 11): a row of
        // the lists is a lesson that needs a teacher or is unresolved there.
        // A teacher the branch filter hides is a person (a vacancy has one
        // branch, 0025).
        const state = lessonStateOf(
          {
            startsAt: one.starts_at,
            cancelled: false,
            teacher: one.teacher_id === null ? null : one.kind === 'vacancy' ? 'vacancy' : 'person',
            absent: span !== undefined,
          },
          moment,
        );
        if (state !== 'needs_teacher' && state !== 'unresolved') continue;
        let key: string;
        let group: Omit<AttentionGroup, 'lessons' | 'firstDate' | 'lastDate'>;
        if (span !== undefined) {
          const days = absenceOf.get(span.absenceId);
          key = `absence:${span.absenceId}`;
          group = {
            cause: 'absence',
            teacher: {
              id: one.teacher_id ?? '',
              kind: 'person',
              name:
                one.kind === null
                  ? ''
                  : listName({ firstName: one.first_name ?? '', lastName: one.last_name ?? '' }),
            },
            absence: {
              id: span.absenceId,
              startsOn: days?.starts_on ?? one.date,
              endsOn: days?.ends_on ?? null,
            },
            suggestPermanent: permanent.has(span.absenceId),
          };
        } else if (one.teacher_id === null) {
          key = 'nobody';
          group = { cause: 'nobody', teacher: null, absence: null, suggestPermanent: false };
        } else {
          key = `vacancy:${one.teacher_id}`;
          group = {
            cause: 'vacancy',
            teacher: { id: one.teacher_id, kind: 'vacancy', name: one.vacancy_name ?? '' },
            absence: null,
            suggestPermanent: false,
          };
        }
        const side = state === 'unresolved' ? groups.unresolved : groups.needsTeacher;
        const found = side.get(key);
        side.set(
          key,
          found === undefined
            ? { ...group, lessons: 1, firstDate: one.date, lastDate: one.date }
            : { ...found, lessons: found.lessons + 1, lastDate: one.date },
        );
      }
      const listOf = (map: Map<string, AttentionGroup>) =>
        [...map.values()].sort(
          (a, b) =>
            a.firstDate.localeCompare(b.firstDate) ||
            (a.teacher?.name ?? '').localeCompare(b.teacher?.name ?? ''),
        );
      return { needsTeacher: listOf(groups.needsTeacher), unresolved: listOf(groups.unresolved) };
    });
  }

  /**
   * The absences that have covered 10 school days of the branch from their
   * first day up to and including today (decision 10).
   */
  private async permanentOf(
    transaction: Transaction,
    branchId: string,
    moment: Date,
    absences: readonly { id: string; starts_on: string; ends_on: string | null }[],
  ): Promise<Set<string>> {
    const found = new Set<string>();
    if (absences.length === 0) return found;
    const branch = await transaction
      .selectFrom('branches')
      .select(['time_zone', 'working_weekdays'])
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const today = schoolDateOf(moment, branch.time_zone);
    const settings = await loadCalendarSettings(transaction, branch.working_weekdays);
    for (const one of absences) {
      const last = one.ends_on === null || one.ends_on > today ? today : one.ends_on;
      let days = 0;
      for (let date = one.starts_on; date <= last; date = nextDay(date)) {
        if (isSchoolDay(date, settings)) days += 1;
        if (days >= ABSENCE_PERMANENT_DAYS) break;
      }
      if (days >= ABSENCE_PERMANENT_DAYS) found.add(one.id);
    }
    return found;
  }

  /** A person record linked to the branch of the request; a vacancy is refused (decision 11). */
  private async personOf(
    transaction: Transaction,
    branchId: string,
    staffId: string,
  ): Promise<{ name: string }> {
    const found = await transaction
      .selectFrom('staff')
      .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
      .select(['staff.kind', 'staff.first_name', 'staff.last_name'])
      .where('staff.id', '=', staffId)
      .where('staff_branches.branch_id', '=', branchId)
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    if (found.kind !== 'person') throw new ApiException('absence_person', 422);
    return {
      name: listName({ firstName: found.first_name ?? '', lastName: found.last_name ?? '' }),
    };
  }

  /** The absence of a person linked to the branch of the request, or 404. */
  private async visibleRow(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<AbsenceRow> {
    const found = await transaction
      .selectFrom('absences')
      .select([
        'id',
        'staff_id',
        'starts_on',
        'ends_on',
        'applies_from',
        'applies_until',
        'reason',
        'withdrawn_at',
      ])
      .where('id', '=', id)
      .where((eb) =>
        eb.exists(
          eb
            .selectFrom('staff_branches')
            .select('staff_branches.staff_id')
            .whereRef('staff_branches.staff_id', '=', 'absences.staff_id')
            .where('staff_branches.branch_id', '=', branchId),
        ),
      )
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    return found;
  }

  /**
   * The absence locked before its checks (spec review should-fix 3), so that
   * a change and a withdraw at one moment meet on the row; a withdrawn one is
   * final.
   */
  private async lockedRow(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<AbsenceRow> {
    await this.visibleRow(transaction, branchId, id);
    const row = await transaction
      .selectFrom('absences')
      .select([
        'id',
        'staff_id',
        'starts_on',
        'ends_on',
        'applies_from',
        'applies_until',
        'reason',
        'withdrawn_at',
      ])
      .where('id', '=', id)
      .forUpdate()
      .executeTakeFirstOrThrow();
    if (row.withdrawn_at !== null) throw new ApiException('absence_withdrawn', 409);
    return row;
  }

  /** The moment, today in branch time, and the start of each day from `first` on. */
  private async timesOf(
    transaction: Transaction,
    branchId: string,
    first: string,
    last: string | null,
  ): Promise<{ moment: Date; today: string; beginsOf: (date: string) => Date }> {
    const moment = await transactionMoment(transaction);
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const today = schoolDateOf(moment, branch.time_zone);
    const from = first < today ? first : today;
    const latest = [first, last ?? first, today].sort().at(-1) ?? today;
    const to = nextDay(latest);
    return {
      moment,
      today,
      beginsOf: await dayBeginnings(transaction, branch.time_zone, from, to),
    };
  }

  /** Refuses an absence that meets another live one of the person, naming it. */
  private async refuseOverlap(
    transaction: Transaction,
    staffId: string,
    own: string | null,
    from: Date,
    until: Date | null,
  ): Promise<void> {
    const spans = await absenceSpans(transaction, [staffId], from, until);
    const other = (spans.get(staffId) ?? []).find((one) => one.absenceId !== own);
    if (other === undefined) return;
    const row = await transaction
      .selectFrom('absences')
      .select('starts_on')
      .where('id', '=', other.absenceId)
      .executeTakeFirst();
    const details: ErrorDetail[] = [
      {
        path: 'startsOn',
        code: 'absence_overlap',
        message: 'Another absence of the person covers these days.',
        recordId: other.absenceId,
        ...(row === undefined ? {} : { day: row.starts_on }),
      },
    ];
    throw new ApiException('absence_overlap', 409, undefined, details);
  }

  /** Two saves at one moment past the check above meet the exclusion of 0096. */
  private async writing<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      const failure = error as { code?: unknown; constraint?: unknown };
      if (failure.code === EXCLUSION_VIOLATION && failure.constraint === 'absences_no_overlap') {
        throw new ApiException('absence_overlap', 409);
      }
      throw error;
    }
  }

  /**
   * One notice to the current Academic Vice Principals of every branch of
   * the person or holding the person's lessons in the range, the author left
   * out, labelled with the branch of the request (decision 8). Answers the
   * number of accounts told, for the audit entry.
   */
  private async tell(
    transaction: Transaction,
    access: Access,
    branchId: string,
    name: string,
    row: AbsenceRow,
    kind: Extract<NotificationKind, `timetable.absence_${string}`>,
    from: Date,
    until: Date | null,
  ): Promise<number> {
    const { rows } = await sql<{ account_id: string }>`
      select account_id from absence_notice_accounts(${row.staff_id}::uuid, ${from}, ${until})
    `.execute(transaction);
    const accountIds = [...new Set(rows.map((one) => one.account_id))].filter(
      (one) => one !== access.accountId,
    );
    if (accountIds.length === 0) return 0;
    const person = name === '' ? '—' : name;
    if (kind === 'timetable.absence_entered' || kind === 'timetable.absence_changed') {
      await this.notifications.send(transaction, {
        kind,
        data: { name: person, startsOn: row.starts_on, endsOn: row.ends_on ?? row.starts_on },
        branchId,
        accountIds,
      });
    } else {
      await this.notifications.send(transaction, {
        kind,
        data: { name: person, startsOn: row.starts_on },
        branchId,
        accountIds,
      });
    }
    return accountIds.length;
  }

  private answerOf(row: AbsenceRow, name: string, moment: Date): Absence {
    const state = stateOf(row, moment);
    return {
      id: row.id,
      staff: { id: row.staff_id, name },
      startsOn: row.starts_on,
      endsOn: row.ends_on,
      reason: row.reason,
      state,
      canEdit: state === 'planned' || state === 'current',
      canWithdraw: state === 'planned',
    };
  }
}
