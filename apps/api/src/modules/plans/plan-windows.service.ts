import { Injectable } from '@nestjs/common';
import {
  nextDay,
  planWindowsSchema,
  type PlanWindowExtend,
  type PlanWindows,
  type PlanWindowSave,
  type PlanWindowsQuery,
} from '@sodiq/shared';
import { isSchoolDay } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { refuseOwnRequest } from '../access/own-request.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { journalRows, staffNames, type JournalRow } from '../journal/journal-grid.query.js';
import { Notifications } from '../notifications/notifications.service.js';
import { loadCalendarSettings } from '../setup/calendar-state.js';
import { notFound } from '../setup/setup-refusals.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { dayMoments, storedWindowOf } from './plan-gate.js';
import { accountOfStaff } from './plan-posts.js';
import {
  clockOf,
  datedQuarters,
  lockJournals,
  planItems,
  planRows,
  referenceDateOf,
  type PlanQuarter,
} from './plan-read.js';
import { windowStateOf } from './plan-window.js';

/**
 * The plan window (task 7.2, pull request #215; `09`, The plan window: "The
 * Academic Vice Principal opens a window for a quarter: a start date and an
 * end date. It can be opened only when the timetable covering that quarter is
 * published"; "can extend the window for one teacher"; `edge/lesson-plans`,
 * The window and requests). The window and an extension are stored as
 * moments; nothing flips on a timer.
 */

/** The roles that open and extend a window (`02`): the route checks them from every assignment. */
const WINDOW_ROLES = ['academic_vice_principal', 'super_admin'] as const;

interface QuarterRow extends PlanQuarter {
  readonly yearId: string;
  readonly yearClosed: boolean;
}

@Injectable()
export class PlanWindowsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly notifications: Notifications,
  ) {}

  /** The windows of a year of the branch, each quarter with its window and extensions. */
  list(access: Access, query: PlanWindowsQuery): Promise<PlanWindows> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { today, now, timeZone } = await clockOf(transaction, branchId);
      let yearId: string | null;
      if (query.yearId !== undefined) {
        const year = await transaction
          .selectFrom('academic_years')
          .select('id')
          .where('id', '=', query.yearId)
          .where('branch_id', '=', branchId)
          .executeTakeFirst();
        if (year === undefined) throw notFound();
        yearId = year.id;
      } else {
        const years = await transaction
          .selectFrom('academic_years')
          .select([
            'id',
            sql<string>`start_date::text`.as('start_date'),
            sql<string>`end_date::text`.as('end_date'),
          ])
          .where('branch_id', '=', branchId)
          .orderBy('start_date', 'desc')
          .execute();
        yearId =
          years.find((year) => year.start_date <= today && today <= year.end_date)?.id ??
          years[0]?.id ??
          null;
      }
      const canEdit = access.assignments.some(
        (assignment) =>
          (WINDOW_ROLES as readonly string[]).includes(assignment.role) &&
          (assignment.branchId === null || assignment.branchId === branchId),
      );
      if (yearId === null) return planWindowsSchema.parse({ yearId, canEdit, quarters: [] });
      const quarters = await datedQuarters(transaction, yearId);
      const answer: PlanWindows['quarters'] = [];
      for (const quarter of quarters) {
        const window = await storedWindowOf(transaction, quarter, null, timeZone);
        let shown: PlanWindows['quarters'][number]['window'] = null;
        if (window !== null) {
          const extensions = await transaction
            .selectFrom('lesson_plan_window_extensions')
            .select(['staff_id', sql<string>`end_date::text`.as('end_date')])
            .where('window_id', '=', window.id)
            .orderBy('granted_at')
            .orderBy('id')
            .execute();
          const latest = new Map<string, string>();
          for (const one of extensions) latest.set(one.staff_id, one.end_date);
          const names = await staffNames(transaction, [...latest.keys()]);
          shown = {
            startDate: window.startDate,
            endDate: window.endDate,
            state: windowStateOf(window, now).state,
            extensions: [...latest]
              .map(([staffId, endDate]) => ({ staffId, name: names.get(staffId) ?? '', endDate }))
              .sort((a, b) => a.name.localeCompare(b.name, 'en')),
          };
        }
        answer.push({
          quarter,
          published: await this.published(transaction, branchId, yearId, quarter),
          window: shown,
        });
      }
      return planWindowsSchema.parse({ yearId, canEdit, quarters: answer });
    });
  }

  /** The quarter of a path, of the branch. */
  private async quarterOf(
    transaction: Transaction,
    branchId: string,
    quarterId: string,
  ): Promise<QuarterRow> {
    const found = await transaction
      .selectFrom('quarters')
      .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
      .select([
        'quarters.id',
        'quarters.number',
        'quarters.academic_year_id',
        'academic_years.status',
        sql<string | null>`quarters.start_date::text`.as('start_date'),
        sql<string | null>`quarters.end_date::text`.as('end_date'),
      ])
      .where('quarters.id', '=', quarterId)
      .where('quarters.branch_id', '=', branchId)
      .executeTakeFirst();
    if (found === undefined) throw notFound();
    if (found.status === 'closed') throw new ApiException('plan_year_closed', 409);
    if (found.start_date === null || found.end_date === null) {
      throw new ApiException('plan_window_dates', 409);
    }
    return {
      id: found.id,
      number: found.number,
      startDate: found.start_date,
      endDate: found.end_date,
      yearId: found.academic_year_id,
      yearClosed: false,
    };
  }

  /**
   * Review decision 9: every school day of the quarter lies in the run of a
   * published version, that is a published version of the year starts on or
   * before the quarter's first school day (the chain runs on to the year's end).
   */
  private async published(
    transaction: Transaction,
    branchId: string,
    yearId: string,
    quarter: PlanQuarter,
  ): Promise<boolean> {
    const branch = await transaction
      .selectFrom('branches')
      .select('working_weekdays')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const settings = await loadCalendarSettings(transaction, branch.working_weekdays);
    let first: string | null = null;
    for (let date = quarter.startDate; date <= quarter.endDate; date = nextDay(date)) {
      if (isSchoolDay(date, settings)) {
        first = date;
        break;
      }
    }
    if (first === null) return false;
    const version = await transaction
      .selectFrom('timetable_versions')
      .select('id')
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', yearId)
      .where('status', '=', 'published')
      .where('starts_on', '<=', first)
      .executeTakeFirst();
    return version !== undefined;
  }

  /** The journals of the branch with a plan of the quarter, each with its owner on the reference date. */
  private async ownersOf(
    transaction: Transaction,
    branchId: string,
    quarter: QuarterRow,
    today: string,
  ): Promise<{ journal: JournalRow; ownerId: string | null }[]> {
    const links = await transaction
      .selectFrom('lesson_plan_journals')
      .select('journal_id')
      .where('quarter_id', '=', quarter.id)
      .orderBy('journal_id')
      .execute();
    const ids = new Set(links.map((link) => link.journal_id));
    const journals = (await journalRows(transaction, branchId, { yearId: quarter.yearId })).filter(
      (journal) => ids.has(journal.id),
    );
    const facts = await ownerFactsOf(
      transaction,
      branchId,
      journals.map((journal) => ({
        id: journal.id,
        academic_year_id: journal.academicYearId,
        class_id: journal.classId,
        group_id: journal.groupId,
        subject_id: journal.subjectId,
      })),
    );
    return journals.map((journal) => {
      const owner = ownerOn(
        facts.runs.get(journal.id) ?? [],
        facts.periods.get(journal.id) ?? [],
        facts.out,
        referenceDateOf(quarter, today),
      );
      return { journal, ownerId: owner === null || owner.kind === 'none' ? null : owner.staffId };
    });
  }

  /**
   * Review decision 10: the rows (lessons not cancelled) of the quarter's
   * plans with no item, whose start lies before the window's end.
   */
  private async withoutPlan(
    transaction: Transaction,
    branchId: string,
    quarter: QuarterRow,
    endDate: string,
  ): Promise<number> {
    // Spec review of the code, should-fix 9: the rows are `planRows`, the one
    // definition of a plan's rows; a lesson on or before the window's last day
    // starts before its end (23:59:59.999 of that day).
    const links = await transaction
      .selectFrom('lesson_plan_journals')
      .select(['plan_id', 'journal_id'])
      .where('quarter_id', '=', quarter.id)
      .execute();
    const planOf = new Map(links.map((link) => [link.journal_id, link.plan_id]));
    const journals = (await journalRows(transaction, branchId, { yearId: quarter.yearId })).filter(
      (journal) => planOf.has(journal.id),
    );
    const { timeZone, now } = await clockOf(transaction, branchId);
    let count = 0;
    for (const journal of journals) {
      const rows = await planRows(transaction, branchId, journal, quarter, timeZone, now);
      const filled = new Set(
        (await planItems(transaction, planOf.get(journal.id) ?? '', journal.id)).map(
          (item) => item.position,
        ),
      );
      count += rows.filter((row) => row.date <= endDate && !filled.has(row.number)).length;
    }
    return count;
  }

  /** Opens the window of a quarter or moves its dates (`edge`: "The end can move to any date from today on"). */
  save(
    access: Access,
    quarterId: string,
    input: PlanWindowSave,
    requestId: string | undefined,
  ): Promise<PlanWindows> {
    const branchId = branchOf(access);
    return (async () => {
      const yearId = await this.transactions.run(access.branchIds, async (transaction) => {
        const quarter = await this.quarterOf(transaction, branchId, quarterId);
        // The quarter first, then the window: two openings wait on each other.
        await transaction
          .selectFrom('quarters')
          .select('id')
          .where('id', '=', quarter.id)
          .forNoKeyUpdate()
          .execute();
        const { today, now, timeZone } = await clockOf(transaction, branchId);
        const existing = await transaction
          .selectFrom('lesson_plan_windows')
          .select([
            'id',
            'starts_at',
            sql<string>`start_date::text`.as('start_date'),
            sql<string>`end_date::text`.as('end_date'),
          ])
          .where('quarter_id', '=', quarter.id)
          .forUpdate()
          .executeTakeFirst();
        if (input.startDate > input.endDate) {
          throw new ApiException('plan_window_dates', 409);
        }
        if (input.endDate > quarter.endDate) {
          throw new ApiException('plan_window_after_quarter', 409);
        }
        if (input.endDate < today) throw new ApiException('plan_window_end_past', 409);
        if (
          existing !== undefined &&
          existing.start_date !== input.startDate &&
          existing.starts_at <= now
        ) {
          throw new ApiException('plan_window_started', 409);
        }
        if (!(await this.published(transaction, branchId, quarter.yearId, quarter))) {
          throw new ApiException('plan_window_unpublished', 409);
        }
        const moments = await dayMoments(transaction, input.startDate, input.endDate, timeZone);
        const without = await this.withoutPlan(transaction, branchId, quarter, input.endDate);
        if (without > 0 && input.confirm !== true) {
          throw new ApiException('plan_window_confirm', 409, undefined, [
            {
              path: 'endDate',
              code: 'plan_window_confirm',
              message: 'Lessons will be held without a plan.',
              lessonsWithoutPlan: without,
            },
          ]);
        }
        const owners = await this.ownersOf(transaction, branchId, quarter, today);
        let windowId: string;
        if (existing === undefined) {
          const made = await transaction
            .insertInto('lesson_plan_windows')
            .values({
              branch_id: branchId,
              quarter_id: quarter.id,
              start_date: input.startDate,
              end_date: input.endDate,
              starts_at: moments.startsAt,
              ends_at: moments.endsAt,
              opened_at: now,
              opened_by: access.accountId,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          windowId = made.id;
        } else {
          if (existing.start_date === input.startDate && existing.end_date === input.endDate) {
            return quarter.yearId;
          }
          windowId = existing.id;
          await transaction
            .updateTable('lesson_plan_windows')
            .set({
              start_date: input.startDate,
              end_date: input.endDate,
              starts_at: moments.startsAt,
              ends_at: moments.endsAt,
            })
            .where('id', '=', existing.id)
            .execute();
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: existing === undefined ? 'plan.window_open' : 'plan.window_change',
          record: { type: 'lesson_plan_window', id: windowId },
          oldValue:
            existing === undefined
              ? null
              : { startDate: existing.start_date, endDate: existing.end_date },
          newValue: {
            quarterId: quarter.id,
            startDate: input.startDate,
            endDate: input.endDate,
            lessonsWithoutPlan: without,
          },
          ...(requestId === undefined ? {} : { requestId }),
        });
        // `09`: "Teachers are reminded when the window opens" (review decision 20).
        const accounts = new Set<string>();
        for (const staffId of new Set(
          owners.flatMap((one) => (one.ownerId === null ? [] : [one.ownerId])),
        )) {
          const account = await accountOfStaff(transaction, staffId);
          if (account !== null) accounts.add(account);
        }
        for (const accountId of [...accounts].sort()) {
          await this.notifications.send(transaction, {
            kind: existing === undefined ? 'plans.window_opened' : 'plans.window_changed',
            branchId,
            accountIds: [accountId],
            data: { quarter: quarter.number, startDate: input.startDate, endDate: input.endDate },
          });
        }
        return quarter.yearId;
      });
      return this.list(access, { yearId });
    })();
  }

  /**
   * Extends the window for one teacher (`edge`, "Extend the window for one
   * teacher": "Before the window ends, an extension is simply a later end
   * date for that teacher. After it, it is recorded as a request approved by
   * the Academic Vice Principal").
   */
  extend(
    access: Access,
    quarterId: string,
    input: PlanWindowExtend,
    requestId: string | undefined,
  ): Promise<PlanWindows> {
    const branchId = branchOf(access);
    return this.transactions
      .run(access.branchIds, async (transaction) => {
        const quarter = await this.quarterOf(transaction, branchId, quarterId);
        const person = await transaction
          .selectFrom('staff')
          .innerJoin('staff_branches', 'staff_branches.staff_id', 'staff.id')
          .select(['staff.id', 'staff.kind'])
          .where('staff.id', '=', input.staffId)
          .where('staff_branches.branch_id', '=', branchId)
          .executeTakeFirst();
        if (person === undefined) throw notFound();
        // Permission review, must-fix 1 (`02`: "Nobody approves their own. ... An
        // Academic Vice Principal's own go to the Super Admin"): an extension of
        // one's own window, before or after its end, is refused.
        const personAccount = await accountOfStaff(transaction, person.id);
        if (personAccount !== null) refuseOwnRequest(access.accountId, personAccount);
        const { today, now, timeZone } = await clockOf(transaction, branchId);
        const window = await transaction
          .selectFrom('lesson_plan_windows')
          .select('id')
          .where('quarter_id', '=', quarter.id)
          .forUpdate()
          .executeTakeFirst();
        if (window === undefined) throw new ApiException('plan_window_none', 409);
        if (input.endDate > quarter.endDate) {
          throw new ApiException('plan_window_after_quarter', 409);
        }
        if (input.endDate < today) throw new ApiException('plan_window_end_past', 409);
        const owned = (await this.ownersOf(transaction, branchId, quarter, today)).filter(
          (one) => one.ownerId === person.id,
        );
        if (owned.length === 0) throw new ApiException('plan_extension_owner', 409);
        await lockJournals(transaction, owned.map((one) => one.journal.id).sort());
        const stored = await storedWindowOf(transaction, quarter, person.id, timeZone);
        if (stored === null) throw new ApiException('plan_window_none', 409);
        const { state, endsAt } = windowStateOf(stored, now);
        const moments = await dayMoments(transaction, input.endDate, input.endDate, timeZone);
        if (endsAt !== null && moments.endsAt <= endsAt) {
          throw new ApiException('plan_extension_not_later', 409);
        }
        const requests: string[] = [];
        if (state === 'ended') {
          // After the end: one approved request per plan the person owns.
          for (const one of owned) {
            const link = await transaction
              .selectFrom('lesson_plan_journals')
              .select('plan_id')
              .where('journal_id', '=', one.journal.id)
              .where('quarter_id', '=', quarter.id)
              .executeTakeFirst();
            if (link === undefined) continue;
            const made = await transaction
              .insertInto('lesson_plan_requests')
              .values({
                branch_id: branchId,
                plan_id: link.plan_id,
                journal_id: one.journal.id,
                quarter_id: quarter.id,
                kind: 'extension',
                status: 'approved',
                from_date: null,
                prepared_at: now,
                updated_at: now,
                decided_by: access.accountId,
                decided_at: now,
                open_until: moments.endsAt,
              })
              .returning('id')
              .executeTakeFirstOrThrow();
            requests.push(made.id);
          }
        } else {
          await transaction
            .insertInto('lesson_plan_window_extensions')
            .values({
              branch_id: branchId,
              window_id: window.id,
              staff_id: person.id,
              end_date: input.endDate,
              ends_at: moments.endsAt,
              granted_at: now,
              granted_by: access.accountId,
            })
            .execute();
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          personId: person.id,
          action: 'plan.window_extend',
          record: { type: 'lesson_plan_window', id: window.id },
          newValue: {
            quarterId: quarter.id,
            staffId: person.id,
            endDate: input.endDate,
            afterEnd: state === 'ended',
            requests,
          },
          ...(requestId === undefined ? {} : { requestId }),
        });
        const account = await accountOfStaff(transaction, person.id);
        if (account !== null) {
          await this.notifications.send(transaction, {
            kind: 'plans.window_extended',
            branchId,
            accountIds: [account],
            data: { quarter: quarter.number, endDate: input.endDate },
          });
        }
        return quarter.yearId;
      })
      .then((yearId) => this.list(access, { yearId }));
  }
}
