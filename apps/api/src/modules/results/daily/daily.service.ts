import { Injectable, Logger } from '@nestjs/common';
import { ABOUT_TO_LOCK_HOURS, schoolDateOf } from '@sodiq/shared';
import { addDays } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import {
  Transactions,
  transactionMoment,
  type Transaction,
} from '../../../database/transactions.js';
import { Jobs } from '../../../jobs/jobs.service.js';
import { accountOfStaff } from '../../access/request-posts.js';
import { Audit } from '../../audit/audit.service.js';
import { journalRows } from '../../journal/journal-grid.query.js';
import { subjectOf, unitOf } from '../../journal/journal-grid.service.js';
import { lessonsCounted } from '../../journal/lesson-counted.js';
import { lessonStatuses } from '../../journal/lesson-status.query.js';
import { Notifications } from '../../notifications/notifications.service.js';
import { datedQuarters } from '../../plans/plan-read.js';
import { PlansService } from '../../plans/plans.service.js';
import { closingOf } from '../../setup/closed-quarters.js';
import { ownerFactsOf, ownerOn } from '../../timetable/journal-owners.js';
import { DAILY_WORK, type DailyData } from './daily-jobs.js';
import { checkBranch } from './result-check.js';

/**
 * The daily work of each branch (task 9.2c, pull request #231; plan decisions 6, 7, 9 and 15 to
 * 20). Every handler decides from stored moments and the injected clock (`transactionMoment`),
 * never from the fact that it was sent, so a job that runs late or twice sends nothing twice: the
 * runner's request key makes each job's writes once, `scheduled_runs` each day's job once per
 * branch and kind, and `lesson_lock_notices` "about to lock" once per lesson and person.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/** The branch's clock time as `HH:MM` (branch time, `edge/00-definitions`). */
function clockTimeOf(moment: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(moment);
  const part = (type: 'hour' | 'minute'): string =>
    parts.find((one) => one.type === type)?.value ?? '00';
  return `${part('hour')}:${part('minute')}`;
}

/** Whole days from `from` to `to`, both school dates. */
const daysBetween = (from: string, to: string): number =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** `edge/lesson-plans`: "reminded on days 1, 3 and 7, then weekly" (plan decision 19). */
export const requestReminderDay = (days: number): boolean =>
  days === 1 || days === 3 || (days >= 7 && days % 7 === 0);

@Injectable()
export class DailyWork {
  private readonly logger = new Logger('Daily');

  constructor(
    private readonly transactions: Transactions,
    private readonly jobs: Jobs,
    private readonly notifications: Notifications,
    private readonly audit: Audit,
    private readonly plans: PlansService,
  ) {}

  /**
   * `schedule.tick`: for each branch, in a transaction of that branch alone, each daily kind
   * whose hour has come and that has no run for the branch's date is recorded and enqueued
   * there, so `Jobs.enqueue` gets no branch outside its transaction (0.5b).
   */
  async tick(): Promise<void> {
    // `branches` is school-wide (no row filter): read in a transaction of no branch.
    const branches = await this.transactions.run([], (transaction) =>
      transaction.selectFrom('branches').select(['id', 'time_zone']).orderBy('id').execute(),
    );
    for (const branch of branches) {
      await this.transactions.run([branch.id], async (transaction) => {
        const now = await transactionMoment(transaction);
        const today = schoolDateOf(now, branch.time_zone);
        const time = clockTimeOf(now, branch.time_zone);
        for (const work of DAILY_WORK) {
          if (time < work.at) continue;
          const made = await transaction
            .insertInto('scheduled_runs')
            .values({
              branch_id: branch.id,
              kind: work.kind,
              day: today,
              // Written again by the trigger from the transaction's moment.
              enqueued_at: now,
            })
            .onConflict((conflict) => conflict.columns(['branch_id', 'kind', 'day']).doNothing())
            .returning('id')
            .executeTakeFirst();
          if (made === undefined) continue;
          await this.jobs.enqueue(transaction, work.job, {
            branchIds: [branch.id],
            data: { day: today },
          });
        }
      });
    }
  }

  /**
   * `results.check`: the run recorded first, the branch read in one snapshot, then the
   * differences stored with the run finished, the Super Admins told and one line logged (plan
   * decision 7: counts and ids only). A run that fails half-way stays unfinished, which the
   * check of 07:00 reports as missed.
   */
  async check(data: DailyData, branchIds: readonly string[]): Promise<void> {
    const branchId = onlyBranch(branchIds);
    const run = await this.transactions.run([branchId], async (transaction) =>
      transaction
        .insertInto('result_checks')
        .values({
          branch_id: branchId,
          day: data.day,
          // Written again by the trigger from the transaction's moment.
          started_at: await transactionMoment(transaction),
        })
        .returning('id')
        .executeTakeFirstOrThrow(),
    );
    const found = await this.transactions.run(
      [branchId],
      (transaction) => checkBranch(transaction, branchId),
      { snapshot: true },
    );
    await this.transactions.run([branchId], async (transaction) => {
      for (let start = 0; start < found.differences.length; start += 500) {
        await transaction
          .insertInto('result_check_differences')
          .values(
            found.differences.slice(start, start + 500).map((one) => ({
              branch_id: branchId,
              check_id: run.id,
              quarter_id: one.quarterId,
              journal_id: one.journalId,
              subject_id: one.subjectId,
              student_id: one.studentId,
              kind: one.kind,
              detail: JSON.stringify(one.detail),
            })),
          )
          .execute();
      }
      const byKind: Record<string, number> = {};
      for (const one of found.differences) byKind[one.kind] = (byKind[one.kind] ?? 0) + 1;
      const journals = new Set(found.differences.map((one) => one.journalId)).size;
      await transaction
        .updateTable('result_checks')
        .set({
          // Written again by the trigger from the transaction's moment.
          finished_at: await transactionMoment(transaction),
          summary: JSON.stringify({
            journals: found.journals,
            records: found.records,
            differences: byKind,
          }),
        })
        .where('id', '=', run.id)
        .execute();
      if (found.differences.length === 0) return;
      this.logger.warn(
        `results.check ${branchId} ${data.day}: ${found.differences.length} differences in ${journals} journals`,
      );
      const admins = await superAdmins(transaction);
      if (admins.length > 0) {
        await this.notifications.send(transaction, {
          kind: 'results.check_difference',
          branchId,
          accountIds: admins,
          data: { date: data.day, differences: found.differences.length, journals },
        });
      }
    });
  }

  /** `results.check_missed`: "A check that did not run also raises an alert" (07:00). */
  async checkMissed(transaction: Transaction, data: DailyData, branchId: string): Promise<void> {
    const done = await transaction
      .selectFrom('result_checks')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('day', '=', data.day)
      .where('finished_at', 'is not', null)
      .executeTakeFirst();
    if (done !== undefined) return;
    const admins = await superAdmins(transaction);
    if (admins.length === 0) return;
    this.logger.warn(`results.check ${branchId} ${data.day}: no finished run`);
    await this.notifications.send(transaction, {
      kind: 'results.check_missed',
      branchId,
      accountIds: admins,
      data: { date: data.day },
    });
  }

  /**
   * `results.closing_overdue` (`07`, Closing a quarter: "After the last day the Academic Vice
   * Principal is reminded until the quarter is closed"): every dated quarter of a year not closed
   * whose last day has passed and that has no branch close in force, a reopened one included.
   */
  async closingOverdue(transaction: Transaction, branchId: string): Promise<void> {
    const { today } = await clockIn(transaction, branchId);
    const quarters = await transaction
      .selectFrom('quarters')
      .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
      .select([
        'quarters.id',
        'quarters.number',
        sql<string>`quarters.end_date::text`.as('end_date'),
      ])
      .where('quarters.branch_id', '=', branchId)
      .where('academic_years.status', '<>', 'closed')
      .where('quarters.end_date', '<', today)
      .orderBy('quarters.end_date')
      .execute();
    const open = [];
    for (const quarter of quarters) {
      if ((await closingOf(transaction, quarter.id)) === undefined) open.push(quarter);
    }
    if (open.length === 0) return;
    const vices = await viceOrAdminsOf(transaction, branchId);
    if (vices.length === 0) return;
    for (const quarter of open) {
      await this.notifications.send(transaction, {
        kind: 'results.closing_overdue',
        branchId,
        accountIds: vices,
        data: { quarter: quarter.number, lastDay: quarter.end_date },
      });
    }
  }

  /**
   * `plans.reminders` (plan decisions 17, 19, 20): the window's end in three days and its last
   * day for an incomplete plan, to each plan owner (`09`); no window 14 days before a quarter, to
   * the Academic Vice Principals (`edge/lesson-plans`); a prepared request not sent, to its plan's
   * owner on days 1, 3, 7, then weekly (`edge/lesson-plans`).
   */
  async planReminders(transaction: Transaction, branchId: string): Promise<void> {
    const { today, timeZone } = await clockIn(transaction, branchId);
    const years = await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('status', '<>', 'closed')
      .orderBy('start_date')
      .execute();
    for (const year of years) {
      for (const quarter of await datedQuarters(transaction, year.id)) {
        if (today > quarter.endDate) continue;
        const window = await transaction
          .selectFrom('lesson_plan_windows')
          .select('id')
          .where('quarter_id', '=', quarter.id)
          .executeTakeFirst();
        if (window === undefined) {
          // "If none exists 14 days before a quarter starts ... reminded daily" (decision 20).
          if (today < quarter.startDate && addDays(today, 14) >= quarter.startDate) {
            const vices = await viceOrAdminsOf(transaction, branchId);
            if (vices.length > 0) {
              await this.notifications.send(transaction, {
                kind: 'plans.window_missing',
                branchId,
                accountIds: vices,
                data: { quarter: quarter.number, startDate: quarter.startDate },
              });
            }
          }
          continue;
        }
        const rows = await this.plans.remindersIn(transaction, branchId, year.id, quarter);
        const ending = new Set<string>();
        const lastDay = new Map<string, string[]>();
        for (const row of rows) {
          if (row.ownerId === null || row.endsAt === null) continue;
          // The window's end is the end of its last day: that day is the moment just before.
          const endDate = schoolDateOf(new Date(row.endsAt.getTime() - 1), timeZone);
          if (addDays(today, 3) === endDate) ending.add(`${row.ownerId}|${endDate}`);
          if (today === endDate && !row.complete) {
            lastDay.set(row.ownerId, [
              ...(lastDay.get(row.ownerId) ?? []),
              unitOf(row.journal).name,
            ]);
          }
        }
        for (const key of [...ending].sort()) {
          const [ownerId = '', endDate = ''] = key.split('|');
          const account = await accountOfStaff(transaction, ownerId);
          if (account === null) continue;
          await this.notifications.send(transaction, {
            kind: 'plans.window_ending',
            branchId,
            accountIds: [account],
            data: { quarter: quarter.number, endDate },
          });
        }
        for (const [ownerId, units] of [...lastDay].sort(([a], [b]) => a.localeCompare(b))) {
          const account = await accountOfStaff(transaction, ownerId);
          if (account === null) continue;
          await this.notifications.send(transaction, {
            kind: 'plans.window_last_day',
            branchId,
            accountIds: [account],
            data: { quarter: quarter.number, unit: [...new Set(units)].sort().join(', ') },
          });
        }
      }
    }
    // "A teacher never sends the prepared request" (decision 19).
    const prepared = await transaction
      .selectFrom('lesson_plan_requests')
      .innerJoin('quarters', 'quarters.id', 'lesson_plan_requests.quarter_id')
      .select([
        'lesson_plan_requests.id',
        'lesson_plan_requests.journal_id',
        'lesson_plan_requests.prepared_at',
        'quarters.number',
        sql<string>`quarters.end_date::text`.as('end_date'),
      ])
      .where('lesson_plan_requests.branch_id', '=', branchId)
      .where('lesson_plan_requests.status', '=', 'prepared')
      .orderBy('lesson_plan_requests.id')
      .execute();
    const due = prepared.filter((one) =>
      requestReminderDay(daysBetween(schoolDateOf(one.prepared_at, timeZone), today)),
    );
    if (due.length === 0) return;
    const journals = new Map(
      (
        await journalRows(transaction, branchId, {
          journalIds: [...new Set(due.map((one) => one.journal_id))],
        })
      ).map((journal) => [journal.id, journal]),
    );
    const facts = await ownerFactsOf(
      transaction,
      branchId,
      [...journals.values()].map((journal) => ({
        id: journal.id,
        academic_year_id: journal.academicYearId,
        class_id: journal.classId,
        group_id: journal.groupId,
        subject_id: journal.subjectId,
      })),
    );
    for (const one of due) {
      const journal = journals.get(one.journal_id);
      if (journal === undefined) continue;
      const owner = ownerOn(
        facts.runs.get(journal.id) ?? [],
        facts.periods.get(journal.id) ?? [],
        facts.out,
        today > one.end_date ? one.end_date : today,
      );
      if (owner === null || owner.kind === 'none') continue;
      const account = await accountOfStaff(transaction, owner.staffId);
      if (account === null) continue;
      await this.notifications.send(transaction, {
        kind: 'plans.request_unsent',
        branchId,
        accountIds: [account],
        data: {
          unit: unitOf(journal).name,
          quarter: one.number,
          days: daysBetween(schoolDateOf(one.prepared_at, timeZone), today),
        },
      });
    }
  }

  /**
   * `journal.about_to_lock` (`10`: "Lesson about to lock with data missing | Teacher"; From 8.7;
   * plan decision 16): an incomplete held lesson whose lock comes within `ABOUT_TO_LOCK_HOURS`,
   * to the person it counts for, once per lesson and person.
   */
  async aboutToLock(transaction: Transaction, branchId: string): Promise<void> {
    const { today, now } = await clockIn(transaction, branchId);
    const lessons = await transaction
      .selectFrom('lessons')
      .select(['id', sql<string>`lesson_date::text`.as('lesson_date'), 'teacher_id'])
      .where('branch_id', '=', branchId)
      .where('lesson_date', '>=', addDays(today, -60))
      .where('lesson_date', '<=', today)
      .where('starts_at', '<=', now)
      .where('cancel_cause', 'is', null)
      .orderBy('lesson_date')
      .orderBy('id')
      .execute();
    if (lessons.length === 0) return;
    const statuses = await lessonStatuses(
      transaction,
      branchId,
      lessons.map((one) => one.id),
      now,
    );
    const near = lessons.filter((one) => {
      const row = statuses.get(one.id);
      const status = row?.answer?.status;
      return (
        row !== undefined &&
        row.held &&
        status !== undefined &&
        status !== 'complete' &&
        status !== 'locked_incomplete' &&
        row.locksAt !== null &&
        row.locksAt.getTime() > now.getTime() &&
        row.locksAt.getTime() - now.getTime() <= ABOUT_TO_LOCK_HOURS * HOUR_MS
      );
    });
    if (near.length === 0) return;
    const counted = await lessonsCounted(
      transaction,
      branchId,
      near.map((one) => ({
        id: one.id,
        journalId: statuses.get(one.id)?.journalId ?? null,
        date: one.lesson_date,
        teacherId: one.teacher_id,
      })),
    );
    const journals = new Map(
      (
        await journalRows(transaction, branchId, {
          journalIds: [
            ...new Set(
              near.flatMap((one) => {
                const id = statuses.get(one.id)?.journalId ?? null;
                return id === null ? [] : [id];
              }),
            ),
          ],
        })
      ).map((journal) => [journal.id, journal]),
    );
    for (const lesson of near) {
      const row = statuses.get(lesson.id);
      const journal = row?.journalId == null ? undefined : journals.get(row.journalId);
      const staffId = counted.get(lesson.id) ?? null;
      if (row?.locksAt == null || journal === undefined || staffId === null) continue;
      const account = await accountOfStaff(transaction, staffId);
      if (account === null) continue;
      const made = await transaction
        .insertInto('lesson_lock_notices')
        .values({ branch_id: branchId, lesson_id: lesson.id, account_id: account })
        .onConflict((conflict) =>
          conflict.columns(['branch_id', 'lesson_id', 'account_id']).doNothing(),
        )
        .returning('id')
        .executeTakeFirst();
      if (made === undefined) continue;
      await this.notifications.send(transaction, {
        kind: 'journal.lesson_about_to_lock',
        branchId,
        accountIds: [account],
        data: {
          date: lesson.lesson_date,
          unit: unitOf(journal).name,
          subject: subjectOf(journal).names,
          locksAt: row.locksAt.toISOString(),
        },
      });
    }
  }

  /**
   * `timetable.forced_delete_purge` (From 5.8b; `edge/people-roles-accounts`: "after that the
   * data is removed and a summary stays in the audit log"; plan decision 18): the kept rows of
   * every forced delete past its restore time, not restored, emptied; the store row stays with
   * its reason; one audit entry of the run.
   */
  async forcedDeletePurge(transaction: Transaction, branchId: string): Promise<void> {
    const { now } = await clockIn(transaction, branchId);
    const due = await transaction
      .selectFrom('forced_deletes')
      .select(['id', 'record_type', 'record_id', 'rows'])
      .where('branch_id', '=', branchId)
      .where('restore_until', '<=', now)
      .where('restored_at', 'is', null)
      .where('purged_at', 'is', null)
      .orderBy('id')
      .forUpdate()
      .execute();
    if (due.length === 0) return;
    await transaction
      .updateTable('forced_deletes')
      .set({ rows: '{}', purged_at: now })
      .where(
        'id',
        'in',
        due.map((one) => one.id),
      )
      .execute();
    await this.audit.record(transaction, {
      branchId,
      actorId: null,
      action: 'forced_delete.purged',
      newValue: {
        forcedDeletes: due.map((one) => ({
          id: one.id,
          recordType: one.record_type,
          recordId: one.record_id,
          // A summary: how many rows of each table were kept (no values).
          rows: Object.fromEntries(
            Object.entries(one.rows as Record<string, unknown>).map(([table, list]) => [
              table,
              Array.isArray(list) ? list.length : 0,
            ]),
          ),
        })),
      },
      details: { command: 'timetable.forced_delete_purge' },
    });
  }
}

/** A daily job is enqueued for one branch. */
function onlyBranch(branchIds: readonly string[]): string {
  const [branchId] = branchIds;
  if (branchId === undefined || branchIds.length !== 1) {
    throw new Error('A daily job works for one branch.');
  }
  return branchId;
}

export const dailyBranchOf = onlyBranch;

async function clockIn(
  transaction: Transaction,
  branchId: string,
): Promise<{ today: string; now: Date; timeZone: string }> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const now = await transactionMoment(transaction);
  return { now, today: schoolDateOf(now, branch.time_zone), timeZone: branch.time_zone };
}

/**
 * The Academic Vice Principals of the branch now. `assignments` has no row filter, so the
 * branch is named here (`.claude/rules/database.md`; review should-fix 5).
 */
async function viceOf(transaction: Transaction, branchId: string): Promise<string[]> {
  const moment = await transactionMoment(transaction);
  const rows = await transaction
    .selectFrom('assignments')
    .select('account_id')
    .distinct()
    .where('role', '=', 'academic_vice_principal')
    .where('branch_id', '=', branchId)
    .where('valid_from', '<=', moment)
    .where((eb) => eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', moment)]))
    .orderBy('account_id')
    .execute();
  return rows.map((row) => row.account_id);
}

/**
 * The Academic Vice Principals of the branch, or the Super Admins when the post is vacant
 * (`edge/people-roles-accounts`: a task with no holder goes "to the Academic Vice Principal, then
 * to the Super Admin"; permission review should-fix 6).
 */
async function viceOrAdminsOf(transaction: Transaction, branchId: string): Promise<string[]> {
  const vices = await viceOf(transaction, branchId);
  return vices.length > 0 ? vices : superAdmins(transaction);
}

/** The Super Admins now (school-wide, no branch). */
async function superAdmins(transaction: Transaction): Promise<string[]> {
  const moment = await transactionMoment(transaction);
  const rows = await transaction
    .selectFrom('assignments')
    .select('account_id')
    .distinct()
    .where('role', '=', 'super_admin')
    .where('valid_from', '<=', moment)
    .where((eb) => eb.or([eb('valid_until', 'is', null), eb('valid_until', '>', moment)]))
    .orderBy('account_id')
    .execute();
  return rows.map((row) => row.account_id);
}
