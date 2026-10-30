import { Injectable } from '@nestjs/common';
import {
  CALC_VERSION,
  CalcInputError,
  finalQuarterRecord,
  recalculateAndCompare,
  storedQuarterInputs,
  storedQuarterOutcome,
} from '@sodiq/calc';
import {
  CLOSING_BLOCKING,
  CLOSING_LOCK_NOW,
  CLOSING_OPENS_DAYS_BEFORE,
  CLOSING_WARNINGS,
  PERMISSIONS,
  permits,
  closingChecklistSchema,
  closingClosedSchema,
  closingDecisionSchema,
  closingJournalDecisionSchema,
  closingRecalculationAppliedSchema,
  closingRecalculationSchema,
  closingReopenedSchema,
  type ClosingChange,
  type ClosingChecklist,
  type ClosingJournalCloseInput,
  type ClosingRecalculation,
  type ClosingRecalculationApplied,
  type ClosingRecalculationApplyInput,
  type ClosingReopened,
  type ClosingReopenedJournal,
  type ClosingReopening,
  type ClosingReopenInput,
  type ClosingClosed,
  type ClosingCloseInput,
  type ClosingDecision,
  type ClosingDecisionAnswer,
  type ClosingDecisionInput,
  type ClosingItem,
  type ClosingJournalDecision,
  type ClosingJournalDecisionInput,
  type ClosingQuery,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { isSchoolDay } from '@sodiq/timetable-rules';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { journalRows, staffNames } from '../journal/journal-grid.query.js';
import { subjectOf, unitOf } from '../journal/journal-grid.service.js';
import { lessonsCounted } from '../journal/lesson-counted.js';
import { countsOfFacts, lessonStatusFacts } from '../journal/lesson-status.query.js';
import { Notifications } from '../notifications/notifications.service.js';
import { carryClosedFrom, carryUnresolved, journalsRunningOn } from '../plans/plan-outcomes.js';
import { clockOf } from '../plans/plan-read.js';
import { calendarOf } from '../plans/plan-request-read.js';
import { PlanReportsService } from '../plans/plan-reports.service.js';
import { periodOpen } from '../plans/plan-window.js';
import {
  closedQuarters,
  closingOf,
  recordsInForce,
  reopenedJournals,
  reopeningsOf,
  type Reopening,
} from '../setup/closed-quarters.js';
import { notFound } from '../setup/setup-refusals.js';
import { accountNames } from '../timetable/edit-lock.js';
import { countsFromOf, goLiveOf } from '../journal/start-quarter.js';
import { journalsWithoutTeacher, ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import type { QuarterRef } from './grade-changes.js';
import {
  flaggedIn,
  listedJournalOf,
  resultItemsOf,
  studentsOfDraft,
  type Flagged,
} from './closing-results.js';
import { quarterOutcomes, type JournalOutcomes } from './quarter-outcomes.js';
import { Freshness, preparedClosing, preparedLessonCounts } from './prepared/read.js';
import {
  changesAgainst,
  outcomeShown,
  recordsBefore,
  storedShown,
  type RawChange,
  type ResultNow,
} from './closing-versions.js';

/**
 * The closing checklist of a quarter (task 9.2a, pull request #229; `07`,
 * Closing a quarter; `edge/journal`, Closing and reopening;
 * `edge/calculation`). Every item is worked out on read from stored rows and
 * the injected clock: nothing flips by a job. The results are those of
 * `studentQuarterOutcome` with the stored decisions (`quarter-outcomes.ts`).
 *
 * - A student at leaving (left the school or the branch in the quarter) is on no item
 *   (`edge/calculation`; From 8.6).
 * - A student who moved between journals of a subject is listed once, under the journal of
 *   the latest membership in the quarter (decision 7 of the review).
 * - The teacher of a journal item is the journal's owner on the reference date; of a lesson
 *   item, the person the lesson counts for (`lessonsCounted`); of an unlock, the person it
 *   covers. "Weights missing", "no teacher" and an open extension are the Academic Vice
 *   Principal's own: no teacher (review decision 3).
 * - Homework given at the last lesson of the quarter makes no column in it (`07`), so it is
 *   on no item.
 */

const DAY_MS = 86_400_000;

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/** The kinds the reminder carries: the items a teacher can finish. */
const REMINDED = new Set<ClosingItem['kind']>([
  'rating_missing',
  'undecided',
  'decision_outdated',
  'unlocked',
  'edit_period',
  'plan_periods',
  'no_attendance',
  'numbers_missing',
  'plan_incomplete',
  'no_result',
  'part_without_data',
  'plan_not_covered',
]);

interface Scene {
  readonly branchId: string;
  readonly today: string;
  readonly now: Date;
  readonly timeZone: string;
  readonly quarter: QuarterRef;
  readonly opensOn: string;
}

interface StudentName {
  readonly id: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly paternalName: string | null;
  readonly uid: string;
}

/** A final record to store, with its shown outcome (task 9.2c). */
interface RecordToStore extends ResultNow {
  readonly kind: 'closing' | 'at_leaving';
  readonly record: string;
}

type JournalRowOf = Awaited<ReturnType<typeof journalRows>>[number];

/** A changed result in an audit entry or a stored list: ids and the shown outcomes. */
const changeIds = (change: RawChange) => ({
  subjectId: change.subjectId,
  studentId: change.studentId,
  journalId: change.journalId,
  before: change.before,
  after: change.after,
});

const notOpen = (): ApiException => new ApiException('closing_not_open', 409);
const notFlagged = (): ApiException => new ApiException('closing_not_flagged', 409);

/**
 * 404 unless every student named has a class or group row of the branch (task 10.3b): a
 * student who moved to another branch during the quarter keeps the rows of this branch up
 * to the move (0053, decision 16) and is still listed and decided here; one who was never a
 * member of the branch, or unknown, is not found. The rows are read with an explicit branch,
 * not through the row filter, which holds every branch for the Super Admin.
 */
async function refuseNonMembers(
  transaction: Transaction,
  branchId: string,
  studentIds: readonly string[],
): Promise<void> {
  const ids = [...new Set(studentIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return;
  const members = await sql<{ student_id: string }>`
    select m.student_id from class_memberships m
    where m.student_id = any(${ids}::uuid[]) and m.branch_id = ${branchId}::uuid
    union
    select g.student_id from group_memberships g
    where g.student_id = any(${ids}::uuid[]) and g.branch_id = ${branchId}::uuid
  `.execute(transaction);
  if (members.rows.length !== ids.length) throw notFound();
}

@Injectable()
export class ClosingService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly notifications: Notifications,
    private readonly requestKeys: RequestKeys,
    private readonly planReports: PlanReportsService,
  ) {}

  /** `GET /api/results/closing`. */
  checklist(access: Access, query: ClosingQuery): Promise<ClosingChecklist> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { today, now, timeZone } = await clockOf(transaction, branchId);
      const chosen = await this.chosenQuarter(transaction, branchId, query.quarterId, today);
      // The permission table decides, as the guard does: `quarter_closing` `edit` in this branch.
      const canEdit = access.assignments.some(
        (one) =>
          (one.branchId === null || one.branchId === branchId) &&
          permits(PERMISSIONS, one.role, 'quarter_closing', 'edit'),
      );
      // Task 9.2c: `results_recalculation` `edit` in this branch, as the guard decides.
      const canApply = access.assignments.some(
        (one) =>
          (one.branchId === null || one.branchId === branchId) &&
          permits(PERMISSIONS, one.role, 'results_recalculation', 'edit'),
      );
      const none = {
        closable: false,
        lockNowNeeded: false,
        startQuarter: false,
        earlierOpen: false,
        closing: null,
        blocking: 0,
        warnings: 0,
        items: [],
        reopenings: [],
        reopening: null,
        changes: [],
        closedJournals: [],
        reopenedJournals: [],
        check: null,
        canApply,
        schoolDays: null,
      };
      if (chosen.quarter === null) {
        return closingChecklistSchema.parse({
          quarters: chosen.quarters,
          quarterId: null,
          prepared: { updatedAt: null, updating: false },
          state: 'not_open',
          opensOn: null,
          lastDay: null,
          canEdit,
          ...none,
        });
      }
      const scene: Scene = {
        branchId,
        today,
        now,
        timeZone,
        quarter: chosen.quarter,
        opensOn: addDays(chosen.quarter.endDate, -CLOSING_OPENS_DAYS_BEFORE),
      };
      // Task 10.1b: the items read the prepared units; the answer says when they were prepared.
      const freshness = new Freshness();
      const schoolDays = await schoolDaysOf(transaction, branchId, chosen.quarter, today);
      const stored = await reopeningsOf(transaction, chosen.quarter.id);
      const reopenings = await this.reopeningsShown(transaction, scene, stored);
      const check = await this.checkOf(transaction, scene);
      const closing = await this.closingRecordOf(transaction, chosen.quarter.id);
      if (closing !== null) {
        const branchClose = await closingOf(transaction, chosen.quarter.id);
        const closedJournals =
          branchClose === undefined
            ? []
            : (
                await transaction
                  .selectFrom('quarter_closing_journals')
                  .select(['journal_id', 'unit_name', 'subject_names'])
                  .where('closing_id', '=', branchClose.id)
                  .orderBy('unit_name')
                  .orderBy('journal_id')
                  .execute()
              ).map((row) => ({
                id: row.journal_id,
                unitName: row.unit_name,
                subjectNames: row.subject_names,
              }));
        const reopenedJournals: ClosingReopenedJournal[] = [];
        for (const row of stored) {
          if (row.journal_id === null || row.ended_by_closing_id !== null) continue;
          const shown = reopenings.find((one) => one.id === row.id);
          if (shown === undefined) continue;
          const items = await this.itemsOf(transaction, access, scene, {
            onlyJournalId: row.journal_id,
            freshness,
          });
          const blocking = items.filter((item) => CLOSING_BLOCKING.includes(item.kind)).length;
          const lockNow = items.filter((item) => CLOSING_LOCK_NOW.includes(item.kind)).length;
          reopenedJournals.push({
            reopening: shown,
            closable: blocking === lockNow,
            lockNowNeeded: lockNow > 0,
            blocking,
            warnings: items.length - blocking,
            items,
            changes: await this.changesOf(transaction, scene, row),
          });
        }
        return closingChecklistSchema.parse({
          quarters: chosen.quarters,
          quarterId: chosen.quarter.id,
          prepared: freshness.stamp,
          state: 'closed',
          opensOn: scene.opensOn,
          lastDay: chosen.quarter.endDate,
          canEdit,
          ...none,
          closing,
          schoolDays,
          reopenings,
          closedJournals,
          reopenedJournals,
          check,
        });
      }
      // Task 9.2c: the whole branch reopened and not closed again.
      const unfinished = stored.find(
        (row) => row.journal_id === null && row.ended_by_closing_id === null,
      );
      const everClosed = stored.length > 0 || (await this.everClosed(transaction, scene));
      const open = today >= scene.opensOn;
      const items = open ? await this.itemsOf(transaction, access, scene, { freshness }) : [];
      const blocking = items.filter((item) => CLOSING_BLOCKING.includes(item.kind)).length;
      const lockNow = items.filter((item) => CLOSING_LOCK_NOW.includes(item.kind)).length;
      // "Quarters are closed in order" holds for the first close (plan decision 12).
      const earlierOpen = !everClosed && (await this.earlierOpen(transaction, scene));
      return closingChecklistSchema.parse({
        quarters: chosen.quarters,
        quarterId: chosen.quarter.id,
        prepared: freshness.stamp,
        state: open ? 'open' : 'not_open',
        opensOn: scene.opensOn,
        lastDay: chosen.quarter.endDate,
        // `07`: "A quarter cannot be closed before its last day." Review correction 1: the
        // items "lock now and close" ends do not keep the close away.
        closable: open && blocking === lockNow && today >= chosen.quarter.endDate && !earlierOpen,
        lockNowNeeded: lockNow > 0,
        startQuarter: await this.isStartQuarter(transaction, scene),
        earlierOpen,
        closing: null,
        canEdit,
        blocking,
        warnings: items.length - blocking,
        items,
        reopenings,
        reopening: reopenings.find((one) => one.id === unfinished?.id) ?? null,
        changes:
          unfinished === undefined ? [] : await this.changesOf(transaction, scene, unfinished),
        closedJournals: [],
        reopenedJournals: [],
        check,
        canApply,
        schoolDays,
      });
    });
  }

  /** `PUT /api/results/closing/:quarterId/decisions`: one student. */
  decide(
    access: Access,
    quarterId: string,
    input: ClosingDecisionInput,
    requestId: string,
  ): Promise<ClosingDecisionAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      const subjectId = input.subjectId.toLowerCase();
      const studentId = input.studentId.toLowerCase();
      // The reading first (review correction 3): the student a member in the branch (a
      // student moved out in the quarter included, task 10.3b) and the subject.
      await refuseNonMembers(transaction, branchId, [studentId]);
      const subject = await transaction
        .selectFrom('subjects')
        .select('id')
        .where('id', '=', subjectId)
        .executeTakeFirst();
      if (subject === undefined) throw notFound();
      if (scene.today < scene.opensOn) throw notOpen();
      const reopened = await this.refuseClosed(transaction, scene);
      const flagged = await this.flaggedOf(transaction, scene, subjectId);
      const one = flagged.find((row) => row.studentId === studentId);
      // Task 9.2c: in a closed quarter, a student listed under a reopened journal only.
      if (reopened !== null && (one === undefined || !reopened.has(one.journalId))) {
        throw new ApiException('quarter_closed', 409);
      }
      // A result with no flag now (an outdated decision only) can only be cleared.
      if (one === undefined || (input.decision !== null && one.row.flags.length === 0)) {
        throw notFlagged();
      }
      const stored = await this.lockDecision(transaction, scene, subjectId, studentId);
      if ((stored?.version ?? null) !== input.version) {
        throw new ApiException('closing_decision_changed', 409);
      }
      if (input.decision === null) {
        if (stored?.decision === null || stored === undefined) {
          throw new ApiException('closing_nothing_to_clear', 409);
        }
      } else if (!one.row.allowed.includes(input.decision)) {
        throw new ApiException('closing_decision_not_allowed', 409);
      }
      return this.write(transaction, access, scene, {
        subjectId,
        studentId,
        decision: input.decision,
        stored,
        requestId,
      });
    });
  }

  /** `POST /api/results/closing/:quarterId/journals/:journalId/decisions`: a whole journal. */
  decideJournal(
    access: Access,
    quarterId: string,
    journalId: string,
    input: ClosingJournalDecisionInput,
    requestId: string,
  ): Promise<ClosingJournalDecision> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      const [journal] = await journalRows(transaction, branchId, {
        journalId: journalId.toLowerCase(),
      });
      if (journal === undefined || journal.academicYearId !== scene.quarter.academicYearId) {
        throw notFound();
      }
      // Every student of the body of the branch, or 404 before any other refusal
      // (.claude/rules/api.md, task 1.5; task 10.3b).
      await refuseNonMembers(transaction, branchId, input.students);
      if (scene.today < scene.opensOn) throw notOpen();
      const reopened = await this.refuseClosed(transaction, scene);
      // Task 9.2c: in a closed quarter, a reopened journal only.
      if (reopened !== null && !reopened.has(journal.id)) {
        throw new ApiException('quarter_closed', 409);
      }
      const own = (await this.flaggedOf(transaction, scene, journal.subjectId)).filter(
        (row) => row.journalId === journal.id,
      );
      // Each the decision may reach: an undecided or outdated one, or an outdated one to clear.
      const listed = new Map(
        own
          .filter((row) =>
            input.decision === null ? row.stale : row.row.decision === null || row.stale,
          )
          .map((row) => [row.studentId, row]),
      );
      // The students of the row the screen sends from (review of the code, round 1): the
      // undecided ones for a decision, the outdated ones for a clear; each is matched one to one.
      const shown = own
        .filter((row) =>
          input.decision === null ? row.stale : row.row.decision === null && !row.stale,
        )
        .map((row) => row.studentId);
      const decided: string[] = [];
      const refused: ClosingJournalDecision['refused'] = [];
      // Locked in the order of the student id (one order for every writer of these rows).
      for (const studentId of input.students.map((id) => id.toLowerCase()).sort()) {
        const one = listed.get(studentId);
        if (one === undefined || (input.decision !== null && one.row.flags.length === 0)) {
          refused.push({ studentId, code: 'closing_not_flagged' });
          continue;
        }
        if (input.decision !== null && !one.row.allowed.includes(input.decision)) {
          refused.push({ studentId, code: 'closing_decision_not_allowed' });
          continue;
        }
        const stored = await this.lockDecision(transaction, scene, journal.subjectId, studentId);
        if ((stored?.version ?? null) !== one.row.version) {
          // Changed since this transaction read it: not overwritten silently.
          refused.push({ studentId, code: 'closing_decision_changed' });
          continue;
        }
        await this.write(transaction, access, scene, {
          subjectId: journal.subjectId,
          studentId,
          decision: input.decision,
          stored,
          requestId,
        });
        decided.push(studentId);
      }
      // Matched one to one: a student listed now that the person did not see is named, never
      // decided unseen (.claude/rules/journal.md, the list confirmed as seen).
      const sent = new Set(input.students.map((id) => id.toLowerCase()));
      for (const studentId of [...shown].sort()) {
        if (!sent.has(studentId)) refused.push({ studentId, code: 'closing_list_changed' });
      }
      return closingJournalDecisionSchema.parse({ decided, refused });
    });
  }

  /** `POST /api/results/closing/:quarterId/plan-periods/end`: "end them all" (From 7.2). */
  endPlanPeriods(access: Access, quarterId: string, requestId: string): Promise<{ ended: number }> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      if (scene.today < scene.opensOn) throw notOpen();
      if ((await this.refuseClosed(transaction, scene)) !== null) {
        throw new ApiException('quarter_closed', 409);
      }
      const requests = await transaction
        .selectFrom('lesson_plan_requests')
        .select(['id', 'journal_id', 'status', 'open_until', 'finished_at'])
        .where('branch_id', '=', branchId)
        .where('quarter_id', '=', scene.quarter.id)
        .where('status', '=', 'approved')
        .orderBy('id')
        .forUpdate()
        .execute();
      const open = requests.filter((one) =>
        periodOpen(
          { openUntil: one.open_until, finishedAt: one.finished_at, status: one.status },
          scene.now,
        ),
      );
      if (open.length === 0) return { ended: 0 };
      await transaction
        .updateTable('lesson_plan_requests')
        .set({ finished_at: scene.now, updated_at: scene.now })
        .where(
          'id',
          'in',
          open.map((one) => one.id),
        )
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'plan.periods_ended',
        record: { type: 'quarter', id: scene.quarter.id },
        newValue: {
          requests: open.map((one) => ({ id: one.id, journalId: one.journal_id })),
        },
        requestId,
      });
      return { ended: open.length };
    });
  }

  /** `POST /api/results/closing/:quarterId/remind` (`07`: "sends the list to the teachers concerned"). */
  remind(access: Access, quarterId: string, key: string): Promise<{ sent: number }> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'results.closing_remind',
          accountId: access.accountId,
          input: { quarterId: scene.quarter.id },
        },
        async () => {
          if (scene.today < scene.opensOn) return { sent: 0 };
          if ((await this.refuseClosed(transaction, scene)) !== null) {
            throw new ApiException('quarter_closed', 409);
          }
          const items = await this.itemsOf(transaction, access, scene);
          const byTeacher = new Map<string, ClosingItem[]>();
          for (const item of items) {
            if (item.teacher === null || item.journal === null || !REMINDED.has(item.kind)) {
              continue;
            }
            byTeacher.set(item.teacher.id, [...(byTeacher.get(item.teacher.id) ?? []), item]);
          }
          const accounts =
            byTeacher.size === 0
              ? []
              : await transaction
                  .selectFrom('staff')
                  .select(['id', 'account_id'])
                  .where('id', 'in', [...byTeacher.keys()])
                  .where('account_id', 'is not', null)
                  .orderBy('id')
                  .execute();
          let sent = 0;
          for (const row of accounts) {
            const own = byTeacher.get(row.id) ?? [];
            if (row.account_id === null || own.length === 0) continue;
            await this.notifications.send(transaction, {
              kind: 'results.closing_reminder',
              branchId,
              accountIds: [row.account_id],
              data: {
                quarter: scene.quarter.number,
                items: own.slice(0, 200).map((item) => ({
                  kind: item.kind as Exclude<
                    ClosingItem['kind'],
                    'weights_missing' | 'extension_open' | 'no_teacher' | 'check_difference'
                  >,
                  unit: item.journal?.unit.name ?? '',
                  subject: item.journal?.subject.names ?? { uz: '', ru: '', en: '' },
                  count: countOf(item),
                })),
              },
            });
            sent += 1;
          }
          return { sent };
        },
      );
      return once.result;
    });
  }

  /**
   * `POST /api/results/closing/:quarterId/close` (task 9.2b): the close of the quarter for the
   * whole branch in one step (`07`, Closing a quarter). The quarter row is locked `for update`
   * first, the "closing" instant (`edge/journal`: "refuses new entries from that instant"; plan
   * decision 2); then the checklist is read again, the closing row and the names written, every
   * result stored as final from the raw entries, and the waiting plan requests made void, all in
   * this transaction: a failure leaves the quarter open with nothing stored. Repeat-safe
   * (`edge/developer-rules`, Repeat-safe actions).
   */
  close(
    access: Access,
    quarterId: string,
    input: ClosingCloseInput,
    key: string,
    requestId: string,
  ): Promise<ClosingClosed> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // The journals the warnings name are of the branch and of the quarter's year, read before
      // any lock (code round 1, finding 1; `.claude/rules/api.md`: an id in the body answers 404).
      const named = [
        ...new Set(
          input.warnings.flatMap((one) =>
            one.journalId === null ? [] : [one.journalId.toLowerCase()],
          ),
        ),
      ];
      if (named.length > 0) {
        const found = await transaction
          .selectFrom('journals')
          .select('id')
          .where('id', 'in', named)
          .where('branch_id', '=', branchId)
          .where('academic_year_id', '=', (query) =>
            query
              .selectFrom('quarters')
              .select('academic_year_id')
              .where('id', '=', quarterId.toLowerCase())
              .where('branch_id', '=', branchId),
          )
          .execute();
        if (found.length !== named.length) throw notFound();
      }
      // The quarter row locked first, then read (spec review of the code, must-fix 1): a save of
      // its dates that commits meanwhile is waited for, never read from before it.
      const locked = await transaction
        .selectFrom('quarters')
        .select('id')
        .where('id', '=', quarterId.toLowerCase())
        .where('branch_id', '=', branchId)
        .forUpdate()
        .executeTakeFirst();
      if (locked === undefined) throw notFound();
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'results.quarter_close',
          accountId: access.accountId,
          // The warnings in one order, so the same list sent in another order is the same request
          // (permission review should-fix 9).
          input: {
            quarterId: scene.quarter.id,
            ...input,
            warnings: [...input.warnings]
              .map((one) => ({ kind: one.kind, journalId: one.journalId?.toLowerCase() ?? null }))
              .sort((a, b) =>
                `${a.kind}|${a.journalId ?? ''}`.localeCompare(`${b.kind}|${b.journalId ?? ''}`),
              ),
          },
        },
        () => this.closeLocked(transaction, access, scene, input, requestId),
      );
      return closingClosedSchema.parse(once.result);
    });
  }

  private async closeLocked(
    transaction: Transaction,
    access: Access,
    scene: Scene,
    input: ClosingCloseInput,
    requestId: string,
  ): Promise<ClosingClosed> {
    const { branchId, quarter } = scene;
    if ((await this.refuseClosed(transaction, scene)) !== null) {
      throw new ApiException('quarter_closed', 409);
    }
    if (scene.today < scene.opensOn) throw notOpen();
    // `07`: "A quarter cannot be closed before its last day."
    if (scene.today < quarter.endDate) throw new ApiException('closing_before_last_day', 409);
    // Task 9.2c: the close after a reopening ends it, its end passed or not.
    const reopening = (await reopeningsOf(transaction, quarter.id)).find(
      (row) => row.journal_id === null && row.ended_by_closing_id === null,
    );
    // `edge/journal`: "Quarters are closed in order" (decision 6), for the first close (9.2c,
    // plan decision 12).
    if (
      !(await this.everClosed(transaction, scene)) &&
      (await this.earlierOpen(transaction, scene))
    ) {
      throw new ApiException('closing_earlier_open', 409);
    }
    // `edge/academic-year`, "Closing the start quarter" (review correction 2).
    const startQuarter = await this.isStartQuarter(transaction, scene);
    if (startQuarter && input.startQuarter === null) {
      throw new ApiException('closing_start_quarter_needed', 409);
    }
    if (!startQuarter && input.startQuarter !== null) {
      throw new ApiException('closing_not_start_quarter', 409);
    }
    const items = await this.itemsOf(transaction, access, scene);
    const blocking = items.filter((item) => CLOSING_BLOCKING.includes(item.kind));
    if (blocking.some((item) => !CLOSING_LOCK_NOW.includes(item.kind))) {
      throw new ApiException('closing_blocked', 409);
    }
    const lockedNow = blocking.filter((item) => CLOSING_LOCK_NOW.includes(item.kind));
    if (lockedNow.length > 0 && !input.lockNow) {
      throw new ApiException('closing_lock_now_needed', 409);
    }
    // `07`: "Warnings must be acknowledged"; the list matched to the one listed now (decision 8).
    const warnings = items.filter((item) =>
      (CLOSING_WARNINGS as readonly string[]).includes(item.kind),
    );
    const seen = new Set(
      input.warnings.map((one) => `${one.kind}|${one.journalId?.toLowerCase() ?? ''}`),
    );
    if (warnings.some((item) => !seen.has(`${item.kind}|${item.journal?.id ?? ''}`))) {
      throw new ApiException('closing_warnings_changed', 409);
    }

    // The final results, from the raw entries, with the stored decisions (From 4.3, 8.6, 9.2a).
    const records = await this.recordsOf(transaction, scene, null);
    // `edge/journal`: "Closing again lists every result that changed" (task 9.2c, decision 8).
    const changes =
      reopening === undefined
        ? []
        : changesAgainst(await recordsBefore(transaction, quarter.id, reopening), records, 'all');

    // Task 9.2d: "Items unresolved at closing are carried automatically", before the close row.
    const carried = await this.carry(
      transaction,
      access,
      scene,
      await journalRows(transaction, branchId, { yearId: quarter.academicYearId }),
      requestId,
    );
    const closing = await transaction
      .insertInto('quarter_closings')
      .values({
        branch_id: branchId,
        quarter_id: quarter.id,
        // Both written again by the trigger: the next version, the transaction's moment.
        version: 1,
        closed_at: scene.now,
        closed_by: access.accountId,
        lock_now: lockedNow.length > 0,
        start_quarter: input.startQuarter,
        warnings: JSON.stringify(warnings),
        changes: JSON.stringify(changes),
      })
      .returning(['id', 'version', 'closed_at'])
      .executeTakeFirstOrThrow();

    // The names as they were (`edge/academic-year`; review must-fix 4).
    const journals = (
      await journalRows(transaction, branchId, { yearId: quarter.academicYearId })
    ).sort((a, b) => a.id.localeCompare(b.id));
    await this.storeNames(transaction, scene, closing.id, journals);
    await this.storeRecords(transaction, scene, closing.id, records);

    // `edge/lesson-plans`: "Waiting requests become void" (From 7.2; decision 11).
    const waiting = await transaction
      .selectFrom('lesson_plan_requests')
      .select(['id', 'journal_id', 'status'])
      .where('branch_id', '=', branchId)
      .where('quarter_id', '=', quarter.id)
      .where('status', 'in', ['prepared', 'sent'])
      .orderBy('id')
      .forUpdate()
      .execute();
    if (waiting.length > 0) {
      await transaction
        .updateTable('lesson_plan_requests')
        .set({ status: 'void', updated_at: scene.now })
        .where(
          'id',
          'in',
          waiting.map((one) => one.id),
        )
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'plan.requests_voided',
        record: { type: 'quarter', id: quarter.id },
        newValue: {
          requests: waiting.map((one) => ({
            id: one.id,
            journalId: one.journal_id,
            status: one.status,
          })),
        },
        requestId,
      });
    }

    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'results.quarter_closed',
      record: { type: 'quarter', id: quarter.id },
      newValue: {
        closingId: closing.id,
        version: closing.version,
        lockNow: lockedNow.length > 0,
        startQuarter: input.startQuarter,
        warnings: warnings.map((item) => ({
          kind: item.kind,
          journalId: item.journal?.id ?? null,
        })),
        lockedNow: lockedNow.map((item) => ({
          kind: item.kind,
          journalId: item.journal?.id ?? null,
          teacherId: item.teacher?.id ?? null,
        })),
        stored: records.length,
        atLeaving: records.filter((one) => one.kind === 'at_leaving').length,
        voided: waiting.length,
        carried: carried.length,
        // Task 9.2c: the reopening it ends and the results that changed (ids only).
        reopeningId: reopening?.id ?? null,
        changes: changes.map(changeIds),
      },
      requestId,
    });

    // "Lock now and close ... is logged and tells the teachers" (decision 3).
    await this.tellLockedNow(transaction, branchId, quarter.number, lockedNow);

    return {
      closedAt: closing.closed_at.toISOString(),
      version: closing.version,
      stored: records.length,
      voided: waiting.length,
      carried: carried.length,
    };
  }

  // -------------------------------------------------------------------------

  /**
   * `POST /api/results/closing/:quarterId/reopen` (task 9.2c; `edge/journal`: "Reopening is for
   * one journal or the whole branch, for a set number of days"; `07`: "Reopening needs a reason
   * and is logged"). The quarter row is locked `for update` first, as the close does; the
   * reopening's trigger takes the moment and the end. Repeat-safe.
   */
  reopen(
    access: Access,
    quarterId: string,
    input: ClosingReopenInput,
    key: string,
    requestId: string,
  ): Promise<ClosingReopened> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      const journalId = input.journalId?.toLowerCase() ?? null;
      if (journalId !== null) {
        const [journal] = await journalRows(transaction, branchId, { journalId });
        if (journal === undefined || journal.academicYearId !== scene.quarter.academicYearId) {
          throw notFound();
        }
      }
      await transaction
        .selectFrom('quarters')
        .select('id')
        .where('id', '=', scene.quarter.id)
        .forUpdate()
        .execute();
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'results.quarter_reopen',
          accountId: access.accountId,
          input: { quarterId: scene.quarter.id, journalId, reason: input.reason, days: input.days },
        },
        async () => {
          const closing = await closingOf(transaction, scene.quarter.id);
          if (closing === undefined) throw new ApiException('quarter_not_closed', 409);
          const row = await refusingReopenings(() =>
            transaction
              .insertInto('quarter_reopenings')
              .values({
                branch_id: branchId,
                quarter_id: scene.quarter.id,
                closing_id: closing.id,
                journal_id: journalId,
                reason: input.reason,
                days: input.days,
                // Written again by the trigger from the transaction's moment.
                reopened_at: scene.now,
                open_until: scene.now,
                reopened_by: access.accountId,
              })
              .returning(['id', 'reopened_at', 'open_until'])
              .executeTakeFirstOrThrow(),
          );
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'results.quarter_reopened',
            record: { type: 'quarter', id: scene.quarter.id },
            newValue: {
              reopeningId: row.id,
              closingId: closing.id,
              version: closing.version,
              journalId,
              reason: input.reason,
              days: input.days,
              openUntil: row.open_until.toISOString(),
            },
            requestId,
          });
          return closingReopenedSchema.parse({
            id: row.id,
            openUntil: row.open_until.toISOString(),
          });
        },
      );
      return closingReopenedSchema.parse(once.result);
    });
  }

  /**
   * `POST /api/results/closing/:quarterId/journals/:journalId/close` (task 9.2c): a reopened
   * journal closed again, as the close does for the branch, with that journal's items only: a new
   * version holding the records of the students listed under it, the names as they are now, and
   * the results that changed. Repeat-safe.
   */
  closeJournal(
    access: Access,
    quarterId: string,
    journalId: string,
    input: ClosingJournalCloseInput,
    key: string,
    requestId: string,
  ): Promise<ClosingClosed> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      const [journal] = await journalRows(transaction, branchId, {
        journalId: journalId.toLowerCase(),
      });
      if (journal === undefined || journal.academicYearId !== scene.quarter.academicYearId) {
        throw notFound();
      }
      const named = [
        ...new Set(
          input.warnings.flatMap((one) =>
            one.journalId === null ? [] : [one.journalId.toLowerCase()],
          ),
        ),
      ];
      // Another journal named by a warning: 404 when it is no journal of the branch's year; one
      // that is answers 409 `closing_warnings_changed` below (permission review should-fix 9).
      const others = named.filter((id) => id !== journal.id);
      if (others.length > 0) {
        const found = await transaction
          .selectFrom('journals')
          .select('id')
          .where('id', 'in', others)
          .where('branch_id', '=', branchId)
          .where('academic_year_id', '=', journal.academicYearId)
          .execute();
        if (found.length !== others.length) throw notFound();
      }
      await transaction
        .selectFrom('quarters')
        .select('id')
        .where('id', '=', scene.quarter.id)
        .forUpdate()
        .execute();
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'results.journal_close',
          accountId: access.accountId,
          input: {
            quarterId: scene.quarter.id,
            journalId: journal.id,
            lockNow: input.lockNow,
            warnings: [...input.warnings]
              .map((one) => ({ kind: one.kind, journalId: one.journalId?.toLowerCase() ?? null }))
              .sort((a, b) => a.kind.localeCompare(b.kind)),
          },
        },
        () => this.closeJournalLocked(transaction, access, scene, journal, input, requestId),
      );
      return closingClosedSchema.parse(once.result);
    });
  }

  private async closeJournalLocked(
    transaction: Transaction,
    access: Access,
    scene: Scene,
    journal: JournalRowOf,
    input: ClosingJournalCloseInput,
    requestId: string,
  ): Promise<ClosingClosed> {
    const { branchId, quarter } = scene;
    if ((await closingOf(transaction, quarter.id)) === undefined) {
      throw new ApiException('quarter_not_closed', 409);
    }
    const reopening = (await reopeningsOf(transaction, quarter.id)).find(
      (row) => row.journal_id === journal.id && row.ended_by_closing_id === null,
    );
    if (reopening === undefined) throw new ApiException('closing_journal_not_reopened', 409);
    const items = await this.itemsOf(transaction, access, scene, { onlyJournalId: journal.id });
    const blocking = items.filter((item) => CLOSING_BLOCKING.includes(item.kind));
    if (blocking.some((item) => !CLOSING_LOCK_NOW.includes(item.kind))) {
      throw new ApiException('closing_blocked', 409);
    }
    const lockedNow = blocking.filter((item) => CLOSING_LOCK_NOW.includes(item.kind));
    if (lockedNow.length > 0 && !input.lockNow) {
      throw new ApiException('closing_lock_now_needed', 409);
    }
    const warnings = items.filter((item) =>
      (CLOSING_WARNINGS as readonly string[]).includes(item.kind),
    );
    const seen = new Set(
      input.warnings.map((one) => `${one.kind}|${one.journalId?.toLowerCase() ?? ''}`),
    );
    if (warnings.some((item) => !seen.has(`${item.kind}|${item.journal?.id ?? ''}`))) {
      throw new ApiException('closing_warnings_changed', 409);
    }
    // A warning of another journal is none of this journal's items.
    if (
      input.warnings.some(
        (one) => one.journalId !== null && one.journalId.toLowerCase() !== journal.id,
      )
    ) {
      throw new ApiException('closing_warnings_changed', 409);
    }
    const records = await this.recordsOf(transaction, scene, journal);
    const changes = changesAgainst(
      await recordsBefore(transaction, quarter.id, reopening),
      records,
      { journalId: journal.id },
    );
    // Task 9.2d: the journal's unresolved items are carried, as at the branch close.
    const carried = await this.carry(transaction, access, scene, [journal], requestId);
    const branchClose = await closingOf(transaction, quarter.id);
    const closing = await transaction
      .insertInto('quarter_closings')
      .values({
        branch_id: branchId,
        quarter_id: quarter.id,
        // Both written again by the trigger: the next version, the transaction's moment.
        version: 1,
        closed_at: scene.now,
        closed_by: access.accountId,
        lock_now: lockedNow.length > 0,
        // A journal's re-close keeps the branch close's choice (plan decision 13).
        start_quarter: branchClose?.start_quarter ?? null,
        warnings: JSON.stringify(warnings),
        cause: 'journal_close',
        journal_id: journal.id,
        changes: JSON.stringify(changes),
      })
      .returning(['id', 'version', 'closed_at'])
      .executeTakeFirstOrThrow();
    await this.storeNames(transaction, scene, closing.id, [journal]);
    await this.storeRecords(transaction, scene, closing.id, records);
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'results.journal_closed_again',
      record: { type: 'journal', id: journal.id },
      newValue: {
        quarterId: quarter.id,
        closingId: closing.id,
        version: closing.version,
        reopeningId: reopening.id,
        lockNow: lockedNow.length > 0,
        warnings: warnings.map((item) => ({
          kind: item.kind,
          journalId: item.journal?.id ?? null,
        })),
        stored: records.length,
        carried: carried.length,
        changes: changes.map(changeIds),
      },
      requestId,
    });
    await this.tellLockedNow(transaction, branchId, quarter.number, lockedNow);
    return {
      closedAt: closing.closed_at.toISOString(),
      version: closing.version,
      stored: records.length,
      voided: 0,
      carried: carried.length,
    };
  }

  /**
   * Task 9.2d: the close's carry of the items still not covered (`carryUnresolved`), with one audit
   * entry listing them (ids only), by the closer.
   */
  private async carry(
    transaction: Transaction,
    access: Access,
    scene: Scene,
    journals: readonly JournalRowOf[],
    requestId: string,
  ): Promise<{ journalId: string; itemId: string; copyId: string }[]> {
    const carried = await carryUnresolved(
      transaction,
      this.audit,
      {
        branchId: scene.branchId,
        accountId: access.accountId,
        assignmentId: access.assignmentId,
        requestId,
      },
      { quarter: scene.quarter, journals, timeZone: scene.timeZone, now: scene.now },
    );
    if (carried.length > 0) {
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'plan.not_covered_carried',
        record: { type: 'quarter', id: scene.quarter.id },
        newValue: { automatic: true, items: carried },
        requestId,
      });
    }
    return carried;
  }

  /** "Lock now and close ... is logged and tells the teachers" (9.2b, decision 3). */
  private async tellLockedNow(
    transaction: Transaction,
    branchId: string,
    quarterNumber: number,
    lockedNow: readonly ClosingItem[],
  ): Promise<void> {
    const told = [
      ...new Set(lockedNow.flatMap((item) => (item.teacher === null ? [] : [item.teacher.id]))),
    ].sort();
    if (told.length === 0) return;
    const accounts = await transaction
      .selectFrom('staff')
      .select('account_id')
      .where('id', 'in', told)
      .where('account_id', 'is not', null)
      .orderBy('id')
      .execute();
    const accountIds = accounts.flatMap((row) => (row.account_id === null ? [] : [row.account_id]));
    if (accountIds.length === 0) return;
    await this.notifications.send(transaction, {
      kind: 'results.quarter_locked_now',
      branchId,
      accountIds,
      data: { quarter: quarterNumber },
    });
  }

  /**
   * `GET /api/results/closing/:quarterId/recalculation` (task 9.2c; `edge/calculation`, "A bug
   * is found after results were closed and exported": "A 'recalculate and compare' tool lists the
   * differences without changing anything"): every record in force through
   * `recalculateAndCompare` of `packages/calc`.
   */
  recalculation(access: Access, quarterId: string): Promise<ClosingRecalculation> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      if ((await closingOf(transaction, scene.quarter.id)) === undefined) {
        throw new ApiException('quarter_not_closed', 409);
      }
      const rows = await this.differencesOf(transaction, scene);
      const names = await studentNames(
        transaction,
        rows.map((row) => row.studentId),
      );
      const journals = new Map(
        (
          await journalRows(transaction, branchId, {
            journalIds: [...new Set(rows.map((row) => row.journalId))],
          })
        ).map((journal) => [journal.id, journal]),
      );
      return closingRecalculationSchema.parse({
        quarterId: scene.quarter.id,
        currentVersion: CALC_VERSION,
        rows: rows.flatMap((row) => {
          const journal = journals.get(row.journalId);
          if (journal === undefined) return [];
          return [
            {
              student: names.get(row.studentId) ?? {
                id: row.studentId,
                firstName: '',
                lastName: '',
                paternalName: null,
                uid: '',
              },
              subject: subjectOf(journal),
              journalId: row.journalId,
              storedVersion: row.storedVersion,
              differences: row.differences,
              refused: row.refused,
              before: row.before,
              after: row.after,
            },
          ];
        }),
      });
    });
  }

  /**
   * `POST /api/results/closing/:quarterId/recalculation/apply` (task 9.2c): "Applying them is a
   * separate action with a reason; the old results are kept and the teachers concerned are told."
   * The quarter row is locked `for update` before anything is read (review must-fix 3), the rows
   * sent matched one to one with the differences listed now, a version `recalculation` stored with
   * the record of each from its stored inputs and the current module. Repeat-safe.
   */
  applyRecalculation(
    access: Access,
    quarterId: string,
    input: ClosingRecalculationApplyInput,
    key: string,
    requestId: string,
  ): Promise<ClosingRecalculationApplied> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, branchId, quarterId);
      // Every student and subject of the body known to the branch, or 404 before any other
      // refusal, the lock and before a used key answers (.claude/rules/api.md, tasks 1.5 and
      // 5.5a-1; task 10.3b).
      await this.refuseUnknownRows(transaction, branchId, input.students);
      await transaction
        .selectFrom('quarters')
        .select('id')
        .where('id', '=', scene.quarter.id)
        .forUpdate()
        .execute();
      const sent = input.students
        .map((row) => `${row.subjectId.toLowerCase()}|${row.studentId.toLowerCase()}`)
        .sort();
      const once = await this.requestKeys.runOnce(
        transaction,
        {
          key,
          scope: 'results.recalculation_apply',
          accountId: access.accountId,
          input: { quarterId: scene.quarter.id, reason: input.reason, students: sent },
        },
        async () => {
          if ((await closingOf(transaction, scene.quarter.id)) === undefined) {
            throw new ApiException('quarter_not_closed', 409);
          }
          // Only a record the current module calculates can be applied.
          const rows = (await this.differencesOf(transaction, scene)).filter(
            (row) => row.refused === null,
          );
          if (rows.length === 0) throw new ApiException('recalculation_nothing', 409);
          const listed = rows.map((row) => `${row.subjectId}|${row.studentId}`).sort();
          if (listed.length !== sent.length || listed.some((one, index) => one !== sent[index])) {
            throw new ApiException('recalculation_changed', 409);
          }
          const records: RecordToStore[] = rows.map((row) => {
            const record = finalQuarterRecord(storedQuarterInputs(row.record), row.kind);
            return {
              journalId: row.journalId,
              subjectId: row.subjectId,
              studentId: row.studentId,
              kind: row.kind,
              record: JSON.stringify(record),
              shown: storedShown(record),
            };
          });
          const branchClose = await closingOf(transaction, scene.quarter.id);
          const changes = changesAgainst(
            await recordsInForce(transaction, scene.quarter.id),
            records,
          );
          const closing = await transaction
            .insertInto('quarter_closings')
            .values({
              branch_id: branchId,
              quarter_id: scene.quarter.id,
              version: 1,
              closed_at: scene.now,
              closed_by: access.accountId,
              lock_now: false,
              start_quarter: branchClose?.start_quarter ?? null,
              warnings: '[]',
              cause: 'recalculation',
              reason: input.reason,
              changes: JSON.stringify(changes),
            })
            .returning(['id', 'version'])
            .executeTakeFirstOrThrow();
          await this.storeRecords(transaction, scene, closing.id, records);
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'results.recalculation_applied',
            record: { type: 'quarter', id: scene.quarter.id },
            newValue: {
              closingId: closing.id,
              version: closing.version,
              reason: input.reason,
              moduleVersion: CALC_VERSION,
              stored: records.length,
              changes: changes.map(changeIds),
            },
            requestId,
          });
          // "The teachers concerned are told": the owner of each journal on the last day.
          const teachers = await this.ownersOf(transaction, scene, [
            ...new Set(records.map((one) => one.journalId)),
          ]);
          const accounts =
            teachers.length === 0
              ? []
              : await transaction
                  .selectFrom('staff')
                  .select('account_id')
                  .where('id', 'in', teachers)
                  .where('account_id', 'is not', null)
                  .orderBy('id')
                  .execute();
          const accountIds = accounts.flatMap((row) =>
            row.account_id === null ? [] : [row.account_id],
          );
          if (accountIds.length > 0) {
            await this.notifications.send(transaction, {
              kind: 'results.recalculated',
              branchId,
              accountIds,
              data: { quarter: scene.quarter.number, version: closing.version },
            });
          }
          return closingRecalculationAppliedSchema.parse({
            version: closing.version,
            stored: records.length,
          });
        },
      );
      return closingRecalculationAppliedSchema.parse(once.result);
    });
  }

  /** The records in force that the current module calculates otherwise, or refuses. */
  private async differencesOf(
    transaction: Transaction,
    scene: Scene,
  ): Promise<
    {
      subjectId: string;
      studentId: string;
      journalId: string;
      kind: 'closing' | 'at_leaving';
      record: unknown;
      storedVersion: number;
      differences: string[];
      refused: string | null;
      before: ResultNow['shown'];
      after: ResultNow['shown'] | null;
    }[]
  > {
    const found = [];
    const records = [...(await recordsInForce(transaction, scene.quarter.id)).values()].sort(
      (a, b) => a.subjectId.localeCompare(b.subjectId) || a.studentId.localeCompare(b.studentId),
    );
    for (const one of records) {
      const comparison = recalculateAndCompare(one.record);
      if (comparison.same) continue;
      const kind = one.kind === 'at_leaving' ? 'at_leaving' : 'closing';
      found.push({
        subjectId: one.subjectId,
        studentId: one.studentId,
        journalId: one.journalId,
        kind,
        record: one.record,
        storedVersion: comparison.storedVersion,
        differences: comparison.differences.map((path) => path),
        refused: comparison.refused,
        before: storedShown(one.record),
        after:
          comparison.now === null
            ? null
            : outcomeShown(storedQuarterOutcome({ format: 1, kind, outcome: comparison.now })),
      } as const);
    }
    return found;
  }

  /** The owners of journals on the quarter's last day (staff ids). */
  private async ownersOf(
    transaction: Transaction,
    scene: Scene,
    journalIds: readonly string[],
  ): Promise<string[]> {
    if (journalIds.length === 0) return [];
    const journals = await journalRows(transaction, scene.branchId, { journalIds });
    const facts = await ownerFactsOf(
      transaction,
      scene.branchId,
      journals.map((journal) => ({
        id: journal.id,
        academic_year_id: journal.academicYearId,
        class_id: journal.classId,
        group_id: journal.groupId,
        subject_id: journal.subjectId,
      })),
    );
    const owners = new Set<string>();
    for (const journal of journals) {
      const owner = ownerOn(
        facts.runs.get(journal.id) ?? [],
        facts.periods.get(journal.id) ?? [],
        facts.out,
        scene.quarter.endDate,
      );
      if (owner !== null && owner.kind !== 'none') owners.add(owner.staffId);
    }
    return [...owners].sort();
  }

  /** The reopenings of a quarter as the checklist shows them (task 9.2c). */
  private async reopeningsShown(
    transaction: Transaction,
    scene: Scene,
    rows: readonly Reopening[],
  ): Promise<ClosingReopening[]> {
    if (rows.length === 0) return [];
    const journals = new Map(
      (
        await journalRows(transaction, scene.branchId, {
          journalIds: [
            ...new Set(rows.flatMap((row) => (row.journal_id === null ? [] : [row.journal_id]))),
          ],
        })
      ).map((journal) => [journal.id, journal]),
    );
    const names = await accountNames(transaction, [...new Set(rows.map((row) => row.reopened_by))]);
    const endings = await transaction
      .selectFrom('quarter_closings')
      .select(['id', 'version'])
      .where('quarter_id', '=', scene.quarter.id)
      .execute();
    const versionOf = new Map(endings.map((row) => [row.id, row.version]));
    const shown = rows.map((row) => {
      const journal = row.journal_id === null ? undefined : journals.get(row.journal_id);
      return {
        id: row.id,
        journal:
          journal === undefined
            ? null
            : { id: journal.id, unit: unitOf(journal), subject: subjectOf(journal) },
        reason: row.reason,
        days: row.days,
        reopenedAt: row.reopened_at.toISOString(),
        reopenedBy: names.get(row.reopened_by) ?? '',
        openUntil: row.open_until.toISOString(),
        ended: row.open_until.getTime() <= scene.now.getTime(),
        closedAgainVersion:
          row.ended_by_closing_id === null
            ? null
            : (versionOf.get(row.ended_by_closing_id) ?? null),
      };
    });
    return closingChecklistSchema.shape.reopenings.parse(shown);
  }

  /**
   * The results that changed since the record in force before a reopening (decision 8): of the
   * whole branch, or of the reopened journal's students.
   */
  private async changesOf(
    transaction: Transaction,
    scene: Scene,
    reopening: Reopening,
  ): Promise<ClosingChange[]> {
    const before = await recordsBefore(transaction, scene.quarter.id, reopening);
    const { journals: outcomes } = await quarterOutcomes(transaction, {
      branchId: scene.branchId,
      timeZone: scene.timeZone,
      now: scene.now,
      quarter: scene.quarter,
      subjectIds: null,
    });
    const now: ResultNow[] = [];
    const journalById = new Map<string, JournalOutcomes['journal']>();
    for (const [journalId, one] of outcomes) {
      journalById.set(journalId, one.journal);
      if (reopening.journal_id !== null && journalId !== reopening.journal_id) continue;
      for (const [studentId, member] of one.members) {
        if (member.outcome === null) continue;
        if (listedJournalOf(member.found?.spans ?? [], journalId) !== journalId) continue;
        now.push({
          subjectId: one.journal.subjectId,
          studentId,
          journalId,
          shown: outcomeShown(member.outcome),
        });
      }
    }
    const changes = changesAgainst(
      before,
      now,
      reopening.journal_id === null ? 'all' : { journalId: reopening.journal_id },
    );
    const names = await studentNames(
      transaction,
      changes.map((one) => one.studentId),
    );
    const shown = changes.flatMap((one) => {
      const journal = journalById.get(one.journalId);
      if (journal === undefined) return [];
      return [
        {
          student: names.get(one.studentId) ?? {
            id: one.studentId,
            firstName: '',
            lastName: '',
            paternalName: null,
            uid: '',
          },
          subject: subjectOf(journal),
          journalId: one.journalId,
          before: one.before,
          after: one.after,
        },
      ];
    });
    return closingChecklistSchema.shape.changes.parse(shown);
  }

  /** The latest finished nightly check of the branch, its differences in this quarter. */
  private async checkOf(
    transaction: Transaction,
    scene: Scene,
  ): Promise<ClosingChecklist['check']> {
    const latest = await latestCheckOf(transaction, scene.branchId);
    if (latest === undefined) return null;
    const journals = await checkDifferencesOf(transaction, latest.id, scene.quarter.id);
    return {
      checkedAt: latest.finished_at.toISOString(),
      journals: [...journals].map(([journalId, differences]) => ({ journalId, differences })),
    };
  }

  /** The names of the journals as they are now, stored with a version (`edge/academic-year`). */
  private async storeNames(
    transaction: Transaction,
    scene: Scene,
    closingId: string,
    journals: readonly JournalRowOf[],
  ): Promise<void> {
    const { branchId, quarter } = scene;
    if (journals.length === 0) return;
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
    const owners = new Map<string, string | null>();
    for (const journal of journals) {
      const owner = ownerOn(
        facts.runs.get(journal.id) ?? [],
        facts.periods.get(journal.id) ?? [],
        facts.out,
        quarter.endDate,
      );
      owners.set(journal.id, owner === null || owner.kind === 'none' ? null : owner.staffId);
    }
    const teacherNames = await staffNames(transaction, [
      ...new Set([...owners.values()].flatMap((id) => (id === null ? [] : [id]))),
    ]);
    await transaction
      .insertInto('quarter_closing_journals')
      .values(
        journals.map((journal) => {
          const owner = owners.get(journal.id) ?? null;
          return {
            branch_id: branchId,
            closing_id: closingId,
            journal_id: journal.id,
            unit_name: unitOf(journal).name,
            subject_names: JSON.stringify(subjectOf(journal).names),
            teacher_name: owner === null ? null : (teacherNames.get(owner) ?? null),
          };
        }),
      )
      .execute();
  }

  /**
   * The final records of the quarter from the raw entries with the stored decisions (From 4.3,
   * 8.6, 9.2a), of every student listed under a journal, or under the journal given (task 9.2c).
   */
  private async recordsOf(
    transaction: Transaction,
    scene: Scene,
    only: JournalRowOf | null,
  ): Promise<RecordToStore[]> {
    const { journals: outcomes } = await quarterOutcomes(transaction, {
      branchId: scene.branchId,
      timeZone: scene.timeZone,
      now: scene.now,
      quarter: scene.quarter,
      subjectIds: only === null ? null : [only.subjectId],
      quarterClosed: true,
    });
    const records: RecordToStore[] = [];
    for (const [journalId, one] of outcomes) {
      if (only !== null && journalId !== only.id) continue;
      for (const [studentId, member] of one.members) {
        if (member.input === null || member.outcome === null) continue;
        if (listedJournalOf(member.found?.spans ?? [], journalId) !== journalId) continue;
        const kind = member.input.atLeaving === null ? 'closing' : 'at_leaving';
        let record;
        try {
          record = finalQuarterRecord(member.input, kind);
        } catch (error) {
          // A record the module refuses: the checklist missed it; nothing is stored.
          if (error instanceof CalcInputError) throw new ApiException('closing_blocked', 409);
          throw error;
        }
        records.push({
          journalId,
          subjectId: one.journal.subjectId,
          studentId,
          kind,
          record: JSON.stringify(record),
          shown: storedShown(record),
        });
      }
    }
    return records;
  }

  private async storeRecords(
    transaction: Transaction,
    scene: Scene,
    closingId: string,
    records: readonly RecordToStore[],
  ): Promise<void> {
    for (let start = 0; start < records.length; start += 500) {
      await transaction
        .insertInto('quarter_final_results')
        .values(
          records.slice(start, start + 500).map((one) => ({
            branch_id: scene.branchId,
            closing_id: closingId,
            quarter_id: scene.quarter.id,
            subject_id: one.subjectId,
            student_id: one.studentId,
            journal_id: one.journalId,
            kind: one.kind,
            record: one.record,
          })),
        )
        .execute();
    }
  }

  /**
   * A write of the checklist in a closed quarter is refused (task 9.2b). The quarter is held `for
   * key share` before the write's rows: a close at the same moment waits for this write, or this
   * write for the close and is refused (permission review should-fix 8). Task 9.2c (review
   * must-fix 1): a quarter with no branch close in force takes them, also a reopened one whose end
   * has passed, until it is closed again: answers `null`. With the branch close in force, the
   * journals reopened and not closed again, which take the decisions of their students; none
   * reopened is refused `quarter_closed`.
   */
  private async refuseClosed(transaction: Transaction, scene: Scene): Promise<Set<string> | null> {
    await transaction
      .selectFrom('quarters')
      .select('id')
      .where('id', '=', scene.quarter.id)
      .forKeyShare()
      .execute();
    if ((await closingOf(transaction, scene.quarter.id)) === undefined) return null;
    const reopened = new Set(
      [...(await reopenedJournals(transaction, [scene.quarter.id]))].map(
        (key) => key.split('|')[1] ?? '',
      ),
    );
    if (reopened.size === 0) throw new ApiException('quarter_closed', 409);
    return reopened;
  }

  /** Whether the quarter has ever been closed (task 9.2c). */
  private async everClosed(transaction: Transaction, scene: Scene): Promise<boolean> {
    const row = await transaction
      .selectFrom('quarter_closings')
      .select('id')
      .where('quarter_id', '=', scene.quarter.id)
      .limit(1)
      .executeTakeFirst();
    return row !== undefined;
  }

  /** The close in force, as the checklist answers it; `null` while open. */
  private async closingRecordOf(
    transaction: Transaction,
    quarterId: string,
  ): Promise<ClosingChecklist['closing']> {
    const row = await closingOf(transaction, quarterId);
    if (row === undefined) return null;
    const names = await accountNames(transaction, [row.closed_by]);
    return {
      closedAt: row.closed_at.toISOString(),
      closedBy: names.get(row.closed_by) ?? '',
      version: row.version,
      lockNow: row.lock_now,
      startQuarter:
        row.start_quarter === 'keep' || row.start_quarter === 'not_official'
          ? row.start_quarter
          : null,
      warnings: closingChecklistSchema.shape.items.parse(row.warnings),
    };
  }

  /** An earlier dated quarter of the year is still open (decision 6). */
  private async earlierOpen(transaction: Transaction, scene: Scene): Promise<boolean> {
    const earlier = await transaction
      .selectFrom('quarters')
      .select('id')
      .where('academic_year_id', '=', scene.quarter.academicYearId)
      .where('number', '<', scene.quarter.number)
      .where('start_date', 'is not', null)
      .execute();
    const closed = await closedQuarters(
      transaction,
      earlier.map((row) => row.id),
    );
    return earlier.some((row) => !closed.has(row.id));
  }

  /** The start quarter: the branch's start date falls inside it after its first day (correction 2). */
  private async isStartQuarter(transaction: Transaction, scene: Scene): Promise<boolean> {
    return countsFromOf(await goLiveOf(transaction, scene.branchId), scene.quarter) !== null;
  }

  /** The quarters of the year shown, and the one asked for (the current one by default). */
  private async chosenQuarter(
    transaction: Transaction,
    branchId: string,
    quarterId: string | undefined,
    today: string,
  ): Promise<{ quarters: QuarterRef[]; quarter: QuarterRef | null }> {
    const rows = await transaction
      .selectFrom('quarters')
      .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
      .select([
        'quarters.id',
        'quarters.number',
        'quarters.academic_year_id',
        sql<string | null>`quarters.start_date::text`.as('start_date'),
        sql<string | null>`quarters.end_date::text`.as('end_date'),
        sql<string>`academic_years.start_date::text`.as('year_start'),
        sql<string>`academic_years.end_date::text`.as('year_end'),
      ])
      .where('quarters.branch_id', '=', branchId)
      .orderBy('academic_years.start_date', 'desc')
      .orderBy('quarters.number')
      .execute();
    const dated = rows.flatMap((row) =>
      row.start_date === null || row.end_date === null
        ? []
        : [
            {
              id: row.id,
              number: row.number,
              academicYearId: row.academic_year_id,
              startDate: row.start_date,
              endDate: row.end_date,
            },
          ],
    );
    let quarter: QuarterRef | undefined;
    if (quarterId !== undefined) {
      const id = quarterId.toLowerCase();
      if (!rows.some((row) => row.id === id)) throw notFound();
      quarter = dated.find((one) => one.id === id);
    } else {
      // The quarter of today; between quarters, the last one ended; else the first of the year.
      const ascending = [...dated].sort((a, b) => a.startDate.localeCompare(b.startDate));
      quarter =
        ascending.find((one) => one.startDate <= today && today <= one.endDate) ??
        [...ascending].reverse().find((one) => one.endDate < today) ??
        ascending[0];
    }
    const yearId = quarter?.academicYearId ?? dated[0]?.academicYearId ?? null;
    return {
      quarters: dated.filter((one) => one.academicYearId === yearId),
      quarter: quarter ?? null,
    };
  }

  /** 404 unless every student of the rows was a member in the branch and every subject is known. */
  private async refuseUnknownRows(
    transaction: Transaction,
    branchId: string,
    rows: readonly { subjectId: string; studentId: string }[],
  ): Promise<void> {
    await refuseNonMembers(
      transaction,
      branchId,
      rows.map((row) => row.studentId),
    );
    const subjectIds = [...new Set(rows.map((row) => row.subjectId.toLowerCase()))];
    const subjects =
      subjectIds.length === 0
        ? []
        : await transaction
            .selectFrom('subjects')
            .select('id')
            .where('id', 'in', subjectIds)
            .execute();
    if (subjects.length !== subjectIds.length) {
      throw notFound();
    }
  }

  /** The quarter of a write: 404 for another branch's or an unknown one, 409 while undated. */
  private async sceneOf(
    transaction: Transaction,
    branchId: string,
    quarterId: string,
  ): Promise<Scene> {
    const { today, now, timeZone } = await clockOf(transaction, branchId);
    const row = await transaction
      .selectFrom('quarters')
      .select([
        'id',
        'number',
        'academic_year_id',
        sql<string | null>`start_date::text`.as('start_date'),
        sql<string | null>`end_date::text`.as('end_date'),
      ])
      .where('id', '=', quarterId.toLowerCase())
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (row === undefined) throw notFound();
    if (row.start_date === null || row.end_date === null) throw notOpen();
    const quarter: QuarterRef = {
      id: row.id,
      number: row.number,
      academicYearId: row.academic_year_id,
      startDate: row.start_date,
      endDate: row.end_date,
    };
    return {
      branchId,
      today,
      now,
      timeZone,
      quarter,
      opensOn: addDays(quarter.endDate, -CLOSING_OPENS_DAYS_BEFORE),
    };
  }

  /** The stored decision row of a student, locked; `undefined` when none is stored. */
  private async lockDecision(
    transaction: Transaction,
    scene: Scene,
    subjectId: string,
    studentId: string,
  ): Promise<{ id: string; decision: string | null; version: number } | undefined> {
    return transaction
      .selectFrom('quarter_result_decisions')
      .select(['id', 'decision', 'version'])
      .where('branch_id', '=', scene.branchId)
      .where('quarter_id', '=', scene.quarter.id)
      .where('subject_id', '=', subjectId)
      .where('student_id', '=', studentId)
      .forUpdate()
      .executeTakeFirst();
  }

  private async write(
    transaction: Transaction,
    access: Access,
    scene: Scene,
    input: {
      readonly subjectId: string;
      readonly studentId: string;
      readonly decision: ClosingDecision | null;
      readonly stored: { id: string; decision: string | null; version: number } | undefined;
      readonly requestId: string;
    },
  ): Promise<ClosingDecisionAnswer> {
    const { stored } = input;
    let id: string;
    let version: number;
    if (stored === undefined) {
      // Two first decisions at one moment: the second meets the unique key and is told.
      const made = await refusingDecisionWrites(() =>
        transaction
          .insertInto('quarter_result_decisions')
          .values({
            branch_id: scene.branchId,
            quarter_id: scene.quarter.id,
            subject_id: input.subjectId,
            student_id: input.studentId,
            decision: input.decision,
            decided_by: access.accountId,
            // Written again by the trigger from the transaction's moment.
            decided_at: scene.now,
          })
          .returning(['id', 'version'])
          .executeTakeFirstOrThrow(),
      );
      id = made.id;
      version = made.version;
    } else {
      const made = await refusingDecisionWrites(() =>
        transaction
          .updateTable('quarter_result_decisions')
          .set({
            decision: input.decision,
            decided_by: access.accountId,
            version: stored.version + 1,
          })
          .where('id', '=', stored.id)
          .returning(['id', 'version'])
          .executeTakeFirstOrThrow(),
      );
      id = made.id;
      version = made.version;
    }
    await this.audit.record(transaction, {
      branchId: scene.branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: input.decision === null ? 'results.decision_cleared' : 'results.decision_set',
      record: { type: 'quarter_result_decision', id },
      oldValue: { decision: stored?.decision ?? null },
      newValue: {
        quarterId: scene.quarter.id,
        subjectId: input.subjectId,
        studentId: input.studentId,
        decision: input.decision,
      },
      requestId: input.requestId,
    });
    return closingDecisionSchema.parse({ decision: input.decision, version });
  }

  /** The flagged students of a subject, each listed once (undecided, outdated or decided). */
  private async flaggedOf(
    transaction: Transaction,
    scene: Scene,
    subjectId: string,
  ): Promise<Flagged[]> {
    const { journals } = await quarterOutcomes(transaction, {
      branchId: scene.branchId,
      timeZone: scene.timeZone,
      now: scene.now,
      quarter: scene.quarter,
      subjectIds: [subjectId],
    });
    return flaggedIn(journals);
  }

  /** Every item of the quarter, ordered by teacher, then class or group, then subject. */
  private async itemsOf(
    transaction: Transaction,
    access: Access,
    scene: Scene,
    options: {
      /** A reopened journal's own items only (task 9.2c). */
      readonly onlyJournalId?: string;
      /** Task 10.1b: read the prepared units, and collect their stamp, on the GET only. */
      readonly freshness?: Freshness;
    } = {},
  ): Promise<ClosingItem[]> {
    const { onlyJournalId, freshness } = options;
    const { branchId, quarter, now } = scene;
    const journals = (
      await journalRows(transaction, branchId, { yearId: quarter.academicYearId })
    ).sort((a, b) => a.id.localeCompare(b.id));
    const journalById = new Map(journals.map((journal) => [journal.id, journal]));
    const reference = scene.today < quarter.endDate ? scene.today : quarter.endDate;
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
    const ownerOf = (journalId: string): string | null => {
      const owner = ownerOn(
        facts.runs.get(journalId) ?? [],
        facts.periods.get(journalId) ?? [],
        facts.out,
        reference,
      );
      return owner === null || owner.kind === 'none' ? null : owner.staffId;
    };
    const drafts: {
      kind: ClosingItem['kind'];
      teacherId: string | null;
      journalId: string | null;
      rest: Record<string, unknown>;
    }[] = [];
    const push = (
      kind: ClosingItem['kind'],
      journalId: string | null,
      teacherId: string | null,
      rest: Record<string, unknown> = {},
    ) => {
      drafts.push({ kind, teacherId, journalId, rest });
    };

    const lessonsHeld = await heldLessonsOf(transaction, branchId, quarter, now);
    // The lessons: inside the edit period, no attendance, numbers missing (`07`; edge/journal).
    // Task 10.1b: the GET reads the prepared counts of each lesson, the lock compared with now.
    const statuses =
      freshness === undefined
        ? new Map(
            [
              ...(await lessonStatusFacts(
                transaction,
                branchId,
                lessonsHeld.map((one) => one.id),
                now,
              )),
            ].map(([id, one]) => [id, countsOfFacts(one)]),
          )
        : await preparedLessonCounts(
            { transaction, branchId, now },
            lessonsHeld.map((one) => one.id),
            freshness,
          );
    const counted = await lessonsCounted(
      transaction,
      branchId,
      lessonsHeld.map((one) => ({
        id: one.id,
        journalId: statuses.get(one.id)?.journalId ?? null,
        date: one.date,
        teacherId: one.teacherId,
      })),
    );
    const withLessons = new Set(
      [...statuses.values()].flatMap((one) =>
        one.held && one.journalId !== null ? [one.journalId] : [],
      ),
    );

    // The results: flags, decisions, rating entries, no result, parts without data, weights.
    // Task 10.1b: the GET reads the prepared `closing` units (behind ones from source); every
    // write the checklist gates reads them from source (plan decision 6).
    // A reopened journal: the subject of that journal, whose journals list its students.
    const only = onlyJournalId === undefined ? undefined : journalById.get(onlyJournalId);
    const subjectIds = only === undefined ? null : [only.subjectId];
    const results =
      freshness === undefined
        ? await resultItemsOf(transaction, scene, subjectIds)
        : await preparedClosing(
            { transaction, branchId, timeZone: scene.timeZone, now, today: scene.today },
            quarter,
            subjectIds,
            freshness,
          );
    const names = await studentNames(transaction, [
      ...new Set(results.drafts.flatMap(studentsOfDraft)),
    ]);
    const nameOf = (id: string): StudentName =>
      names.get(id) ?? { id, firstName: '', lastName: '', paternalName: null, uid: '' };
    for (const journalId of results.weightsMissing) {
      if (withLessons.has(journalId)) push('weights_missing', journalId, null);
    }
    // By journal, each journal's items in their order: the same from the units as from source.
    const byJournal = [...results.drafts].sort((a, b) => a.journalId.localeCompare(b.journalId));
    for (const draft of byJournal) {
      if (draft.kind === 'no_result') {
        push(draft.kind, draft.journalId, ownerOf(draft.journalId), {
          students: (draft.studentIds ?? []).map(nameOf),
        });
      } else if (draft.kind === 'part_without_data') {
        push(draft.kind, draft.journalId, ownerOf(draft.journalId), { parts: draft.parts ?? [] });
      } else {
        push(draft.kind, draft.journalId, ownerOf(draft.journalId), {
          students: (draft.students ?? []).map(({ studentId, ...row }) => ({
            student: nameOf(studentId),
            ...row,
          })),
        });
      }
    }

    type LessonGroup = {
      journalId: string;
      teacherId: string | null;
      lessons: { id: string; date: string }[];
      incomplete: number;
    };
    const grouped = (pick: (id: string) => boolean, incomplete?: (id: string) => boolean) => {
      const found = new Map<string, LessonGroup>();
      for (const lesson of lessonsHeld) {
        const status = statuses.get(lesson.id);
        const journalId = status?.journalId ?? null;
        if (status === undefined || journalId === null || !pick(lesson.id)) continue;
        const teacherId = counted.get(lesson.id) ?? null;
        const key = `${journalId}|${teacherId ?? ''}`;
        const entry = found.get(key) ?? { journalId, teacherId, lessons: [], incomplete: 0 };
        entry.lessons.push({ id: lesson.id, date: lesson.date });
        if (incomplete?.(lesson.id) === true) entry.incomplete += 1;
        found.set(key, entry);
      }
      return [...found.values()];
    };
    for (const entry of grouped(
      (id) => {
        const locksAt = statuses.get(id)?.locksAt ?? null;
        return (
          statuses.get(id)?.held === true && locksAt !== null && locksAt.getTime() > now.getTime()
        );
      },
      (id) => {
        const counts = statuses.get(id)?.counts ?? null;
        return counts === null || counts.unmarked > 0 || counts.worksMissing > 0;
      },
    )) {
      push('edit_period', entry.journalId, entry.teacherId, {
        lessons: entry.lessons.length,
        incomplete: entry.incomplete,
      });
    }
    for (const entry of grouped((id) => (statuses.get(id)?.counts?.unmarked ?? 0) > 0)) {
      push('no_attendance', entry.journalId, entry.teacherId, { lessons: entry.lessons });
    }
    // A counted work of the lesson with no total, or a number waited for missing (07, Lesson
    // status; the homework checked at a lesson is counted there, never where it was given).
    for (const entry of grouped((id) => (statuses.get(id)?.counts?.worksMissing ?? 0) > 0)) {
      push('numbers_missing', entry.journalId, entry.teacherId, { lessons: entry.lessons });
    }

    // `07`: "A lesson is temporarily unlocked for editing" (From 8.4).
    const unlocks = await transaction
      .selectFrom('journal_unlocks')
      .leftJoin('lessons', 'lessons.id', 'journal_unlocks.lesson_id')
      .select([
        'journal_unlocks.id',
        'journal_unlocks.target',
        'journal_unlocks.lesson_id',
        'journal_unlocks.journal_id',
        'journal_unlocks.quarter_id',
        'journal_unlocks.staff_id',
        sql<string | null>`lessons.lesson_date::text`.as('lesson_date'),
      ])
      .where('journal_unlocks.branch_id', '=', branchId)
      .where('journal_unlocks.status', '=', 'approved')
      .where('journal_unlocks.open_until', '>', now)
      .orderBy('journal_unlocks.id')
      .execute();
    const unlockGroups = new Map<
      string,
      {
        journalId: string;
        teacherId: string;
        lessons: { id: string; date: string }[];
        rating: boolean;
      }
    >();
    for (const unlock of unlocks) {
      let journalId: string | null;
      let lesson: { id: string; date: string } | null = null;
      if (unlock.target === 'rating') {
        if (unlock.quarter_id !== quarter.id) continue;
        journalId = unlock.journal_id;
      } else {
        const date = unlock.lesson_date;
        if (unlock.lesson_id === null || date === null) continue;
        if (date < quarter.startDate || date > quarter.endDate) continue;
        // An unlocked lesson is a held one; a lesson cancelled since is no item.
        journalId = statuses.get(unlock.lesson_id)?.journalId ?? null;
        lesson = { id: unlock.lesson_id, date };
      }
      if (journalId === null || !journalById.has(journalId)) continue;
      const key = `${journalId}|${unlock.staff_id}`;
      const entry = unlockGroups.get(key) ?? {
        journalId,
        teacherId: unlock.staff_id,
        lessons: [],
        rating: false,
      };
      if (lesson !== null) entry.lessons.push(lesson);
      else entry.rating = true;
      unlockGroups.set(key, entry);
    }
    for (const entry of unlockGroups.values()) {
      push('unlocked', entry.journalId, entry.teacherId, {
        lessons: entry.lessons,
        rating: entry.rating,
      });
    }
    // The branch-wide extension of the edit period (`edge/system-behaviour`; From 8.4).
    const extensions = await transaction
      .selectFrom('journal_edit_extensions')
      .select([
        'id',
        sql<string>`from_date::text`.as('from_date'),
        sql<string>`to_date::text`.as('to_date'),
        'open_until',
      ])
      .where('branch_id', '=', branchId)
      .where('open_until', '>', now)
      .where('from_date', '<=', quarter.endDate)
      .where('to_date', '>=', quarter.startDate)
      .orderBy('id')
      .execute();
    for (const extension of extensions) {
      push('extension_open', null, null, {
        fromDate: extension.from_date,
        toDate: extension.to_date,
        openUntil: extension.open_until.toISOString(),
      });
    }

    // From 7.2: the open plan periods of the quarter.
    const requests = await transaction
      .selectFrom('lesson_plan_requests')
      .select(['id', 'journal_id', 'status', 'open_until', 'finished_at'])
      .where('branch_id', '=', branchId)
      .where('quarter_id', '=', quarter.id)
      .where('status', '=', 'approved')
      .execute();
    const periods = new Map<string, number>();
    for (const request of requests) {
      if (
        periodOpen(
          {
            openUntil: request.open_until,
            finishedAt: request.finished_at,
            status: request.status,
          },
          now,
        )
      ) {
        periods.set(request.journal_id, (periods.get(request.journal_id) ?? 0) + 1);
      }
    }
    for (const [journalId, count] of periods) {
      push('plan_periods', journalId, ownerOf(journalId), { requests: count });
    }

    // `07`: "Lesson plans incomplete, or items 'not covered'"; From 8.8: below the minimum.
    // Task 10.1b: the plans of the completeness report and the items not covered by the rule of
    // the progress report, without the progress report's walk of every lesson and work.
    const { plans, notCovered } = await this.planReports.closingPlansIn(
      transaction,
      access,
      quarter.id,
    );
    for (const plan of plans) {
      const uncovered = notCovered.get(plan.journalId) ?? 0;
      if (plan.state === 'complete' && uncovered === 0 && plan.belowMinimum === null) continue;
      push('plan_incomplete', plan.journalId, ownerOf(plan.journalId), {
        state: plan.state,
        empty: plan.empty,
        notCovered: uncovered,
        belowMinimum: plan.belowMinimum !== null,
      });
    }
    // Task 9.2d (`edge/lesson-plans`: "In quarter 4 only merge or drop exist"; decisions 1 and
    // 11): where no carry is possible, an item not covered with no outcome blocks the close; a
    // journal that no longer runs on the quarter's last day is closed with it (correction 2).
    if (await carryClosedFrom(transaction, quarter.id)) {
      const running = await journalsRunningOn(transaction, [...notCovered.keys()], quarter.endDate);
      for (const [journalId, count] of notCovered) {
        if (count === 0 || !running.has(journalId)) continue;
        push('plan_not_covered', journalId, ownerOf(journalId), { notCovered: count });
      }
    }

    // From 5.7a-3c: "no teacher" (days under a vacancy without an acting teacher).
    for (const found of await journalsWithoutTeacher(
      transaction,
      branchId,
      quarter.startDate,
      addDays(quarter.endDate, 1),
    )) {
      push('no_teacher', found.journalId, null, {
        days: found.days.map((day) => ({ from: day.from, until: day.until })),
      });
    }

    // Task 9.2c: `edge/system-behaviour`, "A difference ... blocks closing that journal": the
    // journals with a difference in the branch's latest finished check, this quarter.
    const latest = await latestCheckOf(transaction, branchId);
    if (latest !== undefined) {
      for (const [journalId, differences] of await checkDifferencesOf(
        transaction,
        latest.id,
        quarter.id,
      )) {
        push('check_difference', journalId, null, {
          differences,
          checkedAt: latest.finished_at.toISOString(),
        });
      }
    }
    // A reopened journal's own items only (task 9.2c).
    if (onlyJournalId !== undefined) {
      const kept = drafts.filter((one) => one.journalId === onlyJournalId);
      drafts.length = 0;
      drafts.push(...kept);
    }

    // Named and ordered: by teacher, then class or group, then subject, then kind.
    const teacherNames = await staffNames(transaction, [
      ...new Set(drafts.flatMap((one) => (one.teacherId === null ? [] : [one.teacherId]))),
    ]);
    const order = (kind: ClosingItem['kind']) =>
      [
        ...CLOSING_BLOCKING,
        'no_attendance',
        'numbers_missing',
        'plan_incomplete',
        'no_result',
        'part_without_data',
        'no_teacher',
      ].indexOf(kind);
    const items = drafts.flatMap((draft) => {
      const journal = draft.journalId === null ? undefined : journalById.get(draft.journalId);
      if (draft.journalId !== null && journal === undefined) return [];
      return [
        {
          kind: draft.kind,
          teacher:
            draft.teacherId === null
              ? null
              : { id: draft.teacherId, name: teacherNames.get(draft.teacherId) ?? '' },
          journal:
            journal === undefined
              ? null
              : { id: journal.id, unit: unitOf(journal), subject: subjectOf(journal) },
          ...draft.rest,
        },
      ];
    });
    items.sort(
      (a, b) =>
        Number(a.teacher === null) - Number(b.teacher === null) ||
        (a.teacher?.name ?? '').localeCompare(b.teacher?.name ?? '', 'en') ||
        (a.journal?.unit.name ?? '').localeCompare(b.journal?.unit.name ?? '', 'en') ||
        (a.journal?.subject.names.en ?? '').localeCompare(
          b.journal?.subject.names.en ?? '',
          'en',
        ) ||
        order(a.kind) - order(b.kind),
    );
    return closingChecklistSchema.shape.items.parse(items);
  }
}

/** The latest finished nightly check of a branch (task 9.2c). */
async function latestCheckOf(
  transaction: Transaction,
  branchId: string,
): Promise<{ id: string; finished_at: Date } | undefined> {
  const row = await transaction
    .selectFrom('result_checks')
    .select(['id', 'finished_at'])
    .where('branch_id', '=', branchId)
    .where('finished_at', 'is not', null)
    .orderBy('finished_at', 'desc')
    .orderBy('id', 'desc')
    .limit(1)
    .executeTakeFirst();
  return row === undefined || row.finished_at === null
    ? undefined
    : { id: row.id, finished_at: row.finished_at };
}

/** The differences of a check in a quarter, counted by journal. */
async function checkDifferencesOf(
  transaction: Transaction,
  checkId: string,
  quarterId: string,
): Promise<Map<string, number>> {
  const rows = await transaction
    .selectFrom('result_check_differences')
    .select(['journal_id', sql<string>`count(*)`.as('count')])
    .where('check_id', '=', checkId)
    .where('quarter_id', '=', quarterId)
    .groupBy('journal_id')
    .orderBy('journal_id')
    .execute();
  return new Map(rows.map((row) => [row.journal_id, Number(row.count)]));
}

/** A reopening's refusals of the database, each told (task 9.2c). */
async function refusingReopenings<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (failure.code === '23514' || failure.code === '23505') {
      switch (failure.constraint) {
        case 'academic_years_closed':
          throw new ApiException('year_closed', 409);
        case 'quarter_not_closed':
          throw new ApiException('quarter_not_closed', 409);
        case 'quarter_reopened':
        case 'quarter_reopenings_unfinished_journal_key':
        case 'quarter_reopenings_unfinished_branch_key':
          throw new ApiException('quarter_reopened', 409);
        case 'quarter_journal_reopened':
          throw new ApiException('quarter_journal_reopened', 409);
        case 'quarter_journal_not_closed':
          throw new ApiException('closing_journal_not_closed', 409);
      }
    }
    throw error;
  }
}

/** The count an item names in a reminder. */
function countOf(item: ClosingItem): number {
  switch (item.kind) {
    case 'rating_missing':
    case 'undecided':
    case 'decision_outdated':
    case 'no_result':
      return Math.max(1, item.students.length);
    case 'unlocked':
      return Math.max(1, item.lessons.length + (item.rating ? 1 : 0));
    case 'edit_period':
      return item.lessons;
    case 'plan_periods':
      return item.requests;
    case 'no_attendance':
    case 'numbers_missing':
      return Math.max(1, item.lessons.length);
    case 'plan_incomplete':
      return Math.max(1, item.empty + item.notCovered);
    case 'plan_not_covered':
      return item.notCovered;
    case 'part_without_data':
      return item.parts.length;
    default:
      return 1;
  }
}

async function studentNames(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, StudentName>> {
  if (ids.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('students')
    .select(['id', 'first_name', 'last_name', 'paternal_name', 'uid'])
    .where('id', 'in', ids)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        firstName: row.first_name,
        lastName: row.last_name,
        paternalName: row.paternal_name,
        uid: row.uid,
      },
    ]),
  );
}

/** The held, not cancelled lessons of the quarter in the branch (`edge/00-definitions`). */
async function heldLessonsOf(
  transaction: Transaction,
  branchId: string,
  quarter: QuarterRef,
  now: Date,
): Promise<{ id: string; date: string; teacherId: string | null }[]> {
  const rows = await transaction
    .selectFrom('lessons')
    .select(['id', sql<string>`lesson_date::text`.as('lesson_date'), 'teacher_id'])
    .where('branch_id', '=', branchId)
    .where('lesson_date', '>=', quarter.startDate)
    .where('lesson_date', '<=', quarter.endDate)
    .where('starts_at', '<=', now)
    .where('cancel_cause', 'is', null)
    .orderBy('lesson_date')
    .orderBy('id')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    date: row.lesson_date,
    teacherId: row.teacher_id,
  }));
}

/**
 * A first decision of two at one moment meets the unique key, and a decision in a closed year
 * meets the guard of 0132: each told, never a 500.
 */
async function refusingDecisionWrites<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (failure.code === '23505' && failure.constraint === 'quarter_result_decisions_key') {
      throw new ApiException('closing_decision_changed', 409);
    }
    if (failure.code === '23514' && failure.constraint === 'academic_years_closed') {
      throw new ApiException('year_closed', 409);
    }
    if (failure.code === '23514' && failure.constraint === 'quarters_closed') {
      throw new ApiException('quarter_closed', 409);
    }
    throw error;
  }
}

/**
 * The school days of a quarter and those passed by `today` (task 9.3b-2; From 9.4b, decision 7:
 * "quarter progress"): each date of the quarter that `isSchoolDay` takes on the branch calendar
 * (decision 13), counted up to and including today.
 */
async function schoolDaysOf(
  transaction: Transaction,
  branchId: string,
  quarter: { readonly startDate: string; readonly endDate: string },
  today: string,
): Promise<{ passed: number; total: number }> {
  const settings = await calendarOf(transaction, branchId);
  let passed = 0;
  let total = 0;
  for (let date = quarter.startDate; date <= quarter.endDate; date = addDays(date, 1)) {
    if (!isSchoolDay(date, settings)) continue;
    total += 1;
    if (date <= today) passed += 1;
  }
  return { passed, total };
}
