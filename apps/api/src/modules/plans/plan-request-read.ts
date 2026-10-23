import {
  nextDay,
  planRequestCauseSchema,
  planRequestSchema,
  schoolDateOf,
  type PlanRequest,
} from '@sodiq/shared';
import { isSchoolDay, type CalendarSettings } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { staffNames, type JournalRow } from '../journal/journal-grid.query.js';
import { loadCalendarSettings } from '../setup/calendar-state.js';
import { clockOf, datedQuarters, referenceDateOf } from './plan-read.js';
import { ownerIdOn } from './plan-scope.js';
import { PLAN_REQUEST_LATE_DAYS, periodOpen, schoolDaysBetween } from './plan-window.js';
import type { Scene } from './plans.service.js';

/** The reads of plan edit requests (task 7.2, pull request #215), shared by the plan page and the request routes. */

/** A stored request, as the routes read it. */
export interface RequestRow {
  readonly id: string;
  readonly branch_id: string;
  readonly plan_id: string;
  readonly journal_id: string;
  readonly quarter_id: string;
  readonly kind: string;
  readonly status: string;
  readonly from_date: string | null;
  readonly reason: string;
  readonly requested_by: string | null;
  readonly sent_at: Date | null;
  readonly decided_by: string | null;
  readonly decided_at: Date | null;
  readonly decision_reason: string;
  readonly days: number | null;
  readonly open_until: Date | null;
  readonly finished_at: Date | null;
}

type RequestQuery = ReturnType<typeof baseQuery>;

export async function requestRows(
  transaction: Transaction,
  where: (
    query: RequestQuery,
  ) => RequestQuery,
): Promise<RequestRow[]> {
  return where(baseQuery(transaction)).orderBy('id', 'desc').execute();
}

function baseQuery(transaction: Transaction) {
  return transaction
    .selectFrom('lesson_plan_requests')
    .select([
      'id',
      'branch_id',
      'plan_id',
      'journal_id',
      'quarter_id',
      'kind',
      'status',
      sql<string | null>`from_date::text`.as('from_date'),
      'reason',
      'requested_by',
      'sent_at',
      'decided_by',
      'decided_at',
      'decision_reason',
      'days',
      'open_until',
      'finished_at',
    ]);
}

export async function calendarOf(transaction: Transaction, branchId: string): Promise<CalendarSettings> {
  const branch = await transaction
    .selectFrom('branches')
    .select('working_weekdays')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return loadCalendarSettings(transaction, branch.working_weekdays);
}

/** One request as the answer sends it. */
export async function answerOf(
  transaction: Transaction,
  branchId: string,
  row: RequestRow,
  journal: JournalRow,
  today: string,
  now: Date,
  settings: CalendarSettings,
  canDecide: boolean,
): Promise<PlanRequest> {
  const quarters = await datedQuarters(transaction, journal.academicYearId);
  const quarter = quarters.find((one) => one.id === row.quarter_id);
  const owner =
    quarter === undefined
      ? null
      : await ownerIdOn(transaction, branchId, journal, referenceDateOf(quarter, today));
  const [lessons, causes] = await Promise.all([
    transaction
      .selectFrom('lesson_plan_request_lessons')
      .select([
        'lesson_id',
        sql<string>`lesson_date::text`.as('lesson_date'),
        'approved',
        'untick_reason',
      ])
      .where('request_id', '=', row.id)
      .orderBy('lesson_date')
      .orderBy('lesson_id')
      .execute(),
    transaction
      .selectFrom('lesson_plan_request_causes')
      .select(['kind', sql<string>`on_date::text`.as('on_date'), 'items', 'event_id'])
      .where('request_id', '=', row.id)
      .orderBy('at')
      .orderBy('id')
      .execute(),
  ]);
  const deciderStaff =
    row.decided_by === null
      ? undefined
      : await transaction
          .selectFrom('staff')
          .select('id')
          .where('account_id', '=', row.decided_by)
          .executeTakeFirst();
  const names = await staffNames(transaction, [
    ...(owner === null ? [] : [owner]),
    ...(deciderStaff === undefined ? [] : [deciderStaff.id]),
  ]);
  const waitingDays =
    row.status === 'sent' && row.sent_at !== null
      ? schoolDaysBetween(
          schoolDateOf(row.sent_at, (await clockOf(transaction, branchId)).timeZone),
          today,
          (date) => isSchoolDay(date, settings),
          nextDay,
        )
      : 0;
  return planRequestSchema.parse({
    id: row.id,
    journalId: journal.id,
    quarterId: row.quarter_id,
    quarter: quarter?.number ?? 1,
    unit: {
      kind: journal.classId === null ? 'group' : 'class',
      id: journal.classId ?? journal.groupId ?? '',
      name: journal.unitName,
    },
    subject: {
      id: journal.subjectId,
      names: journal.subject.names,
      colour: journal.subject.colour,
    },
    owner: owner === null ? null : (names.get(owner) ?? null),
    kind: row.kind,
    status: row.status,
    fromDate: row.from_date,
    lessons: lessons.map((one) => ({
      lessonId: one.lesson_id,
      date: one.lesson_date,
      approved: one.approved,
      untickReason: one.untick_reason,
    })),
    reason: row.reason,
    causes: causes.map((cause) => ({
      kind: planRequestCauseSchema.parse(cause.kind),
      onDate: cause.on_date,
      items: cause.items,
      eventId: cause.event_id,
    })),
    sentAt: row.sent_at?.toISOString() ?? null,
    decidedBy:
      row.decided_by === null
        ? null
        : deciderStaff === undefined
          ? ''
          : (names.get(deciderStaff.id) ?? ''),
    decidedAt: row.decided_at?.toISOString() ?? null,
    decisionReason: row.decision_reason,
    days: row.days,
    openUntil: row.open_until?.toISOString() ?? null,
    open: periodOpen(
      { openUntil: row.open_until, finishedAt: row.finished_at, status: row.status },
      now,
    ),
    finishedAt: row.finished_at?.toISOString() ?? null,
    waitingDays,
    late: waitingDays >= PLAN_REQUEST_LATE_DAYS,
    canDecide,
  });
}

/** The requests of one plan's journal, not prepared, newest first (the plan page). */
export async function planRequestsOf(
  transaction: Transaction,
  scene: Scene,
  planId: string,
  canDecide: boolean,
): Promise<PlanRequest[]> {
  const rows = await requestRows(transaction, (query) =>
    query
      .where('plan_id', '=', planId)
      .where('journal_id', '=', scene.journal.id)
      .where('status', '!=', 'prepared'),
  );
  const settings = await calendarOf(transaction, scene.branchId);
  const today = schoolDateOf(scene.now, scene.timeZone);
  const found: PlanRequest[] = [];
  for (const row of rows) {
    found.push(
      await answerOf(
        transaction,
        scene.branchId,
        row,
        scene.journal,
        today,
        scene.now,
        settings,
        canDecide && row.status === 'sent',
      ),
    );
  }
  return found;
}
