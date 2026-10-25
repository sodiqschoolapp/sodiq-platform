import { Injectable } from '@nestjs/common';
import type { ResultFlag } from '@sodiq/calc';
import {
  CLOSING_BLOCKING,
  CLOSING_OPENS_DAYS_BEFORE,
  PERMISSIONS,
  permits,
  closingChecklistSchema,
  closingDecisionSchema,
  closingJournalDecisionSchema,
  type ClosingChecklist,
  type ClosingDecision,
  type ClosingDecisionAnswer,
  type ClosingDecisionInput,
  type ClosingFlagged,
  type ClosingItem,
  type ClosingJournalDecision,
  type ClosingJournalDecisionInput,
  type ClosingQuery,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { RequestKeys } from '../../database/request-keys.js';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { exemptOnDate } from '../journal/exemption-read.js';
import { journalRows, staffNames } from '../journal/journal-grid.query.js';
import { subjectOf, unitOf } from '../journal/journal-grid.service.js';
import { lessonsCounted } from '../journal/lesson-counted.js';
import { lessonStatuses } from '../journal/lesson-status.query.js';
import { ratingDateOf } from '../journal/rating.js';
import { Notifications } from '../notifications/notifications.service.js';
import { clockOf } from '../plans/plan-read.js';
import { PlanReportsService } from '../plans/plan-reports.service.js';
import { periodOpen } from '../plans/plan-window.js';
import { notFound } from '../setup/setup-refusals.js';
import { journalsWithoutTeacher, ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import type { QuarterRef } from './grade-changes.js';
import { exemptedIn } from './closing.query.js';
import { allowedDecisions, quarterOutcomes, type JournalOutcomes } from './quarter-outcomes.js';

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

/** A flagged student of the checklist, with the journal it is listed under. */
interface Flagged {
  readonly journalId: string;
  readonly subjectId: string;
  readonly studentId: string;
  readonly row: Omit<ClosingFlagged, 'student'>;
  readonly stale: boolean;
}

const notOpen = (): ApiException => new ApiException('closing_not_open', 409);
const notFlagged = (): ApiException => new ApiException('closing_not_flagged', 409);

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
      if (chosen.quarter === null) {
        return closingChecklistSchema.parse({
          quarters: chosen.quarters,
          quarterId: null,
          state: 'not_open',
          opensOn: null,
          lastDay: null,
          closable: false,
          canEdit,
          blocking: 0,
          warnings: 0,
          items: [],
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
      const open = today >= scene.opensOn;
      const items = open ? await this.itemsOf(transaction, access, scene) : [];
      const blocking = items.filter((item) => CLOSING_BLOCKING.includes(item.kind)).length;
      return closingChecklistSchema.parse({
        quarters: chosen.quarters,
        quarterId: chosen.quarter.id,
        state: open ? 'open' : 'not_open',
        opensOn: scene.opensOn,
        lastDay: chosen.quarter.endDate,
        // `07`: "A quarter cannot be closed before its last day."
        closable: open && blocking === 0 && today >= chosen.quarter.endDate,
        canEdit,
        blocking,
        warnings: items.length - blocking,
        items,
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
      // The reading first (review correction 3): the student and the subject of the branch.
      const student = await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      const subject = await transaction
        .selectFrom('subjects')
        .select('id')
        .where('id', '=', subjectId)
        .executeTakeFirst();
      if (student === undefined || subject === undefined) throw notFound();
      if (scene.today < scene.opensOn) throw notOpen();
      const flagged = await this.flaggedOf(transaction, scene, subjectId);
      const one = flagged.find((row) => row.studentId === studentId);
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
      if (scene.today < scene.opensOn) throw notOpen();
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
                    'weights_missing' | 'extension_open' | 'no_teacher'
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

  // -------------------------------------------------------------------------

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
  ): Promise<ClosingItem[]> {
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

    // The results: flags, decisions, rating entries, no result, parts without data, weights.
    const { journals: outcomes } = await quarterOutcomes(transaction, {
      branchId,
      timeZone: scene.timeZone,
      now,
      quarter,
      subjectIds: null,
    });
    const studentIds = new Set<string>();
    for (const one of outcomes.values()) for (const id of one.members.keys()) studentIds.add(id);
    const names = await studentNames(transaction, [...studentIds]);
    const nameOf = (id: string): StudentName =>
      names.get(id) ?? { id, firstName: '', lastName: '', paternalName: null, uid: '' };
    const flagged = flaggedIn(outcomes);
    const lessonsHeld = await heldLessonsOf(transaction, branchId, quarter, now);
    // The lessons: inside the edit period, no attendance, numbers missing (`07`; edge/journal).
    const statuses = await lessonStatuses(
      transaction,
      branchId,
      lessonsHeld.map((one) => one.id),
      now,
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
    const exempted = await exemptedIn(transaction, quarter, [...studentIds]);
    for (const [journalId, one] of outcomes) {
      const teacher = ownerOf(journalId);
      // `07`: "A graded subject has weights that do not total 100 for this quarter" (decision 4).
      if (one.weights.quarterly === null) {
        if (withLessons.has(journalId)) push('weights_missing', journalId, null);
        continue;
      }
      const listedHere = [...one.members].filter(
        ([, member]) =>
          member.outcome !== null &&
          member.outcome.atLeaving === null &&
          listedJournalOf(member.found?.spans ?? [], journalId) === journalId,
      );
      const own = flagged.filter((row) => row.journalId === journalId);
      const undecided = own.filter((row) => !row.stale && row.row.decision === null);
      const stale = own.filter((row) => row.stale);
      const flaggedRow = (row: Flagged) => ({ student: nameOf(row.studentId), ...row.row });
      if (undecided.length > 0) {
        push('undecided', journalId, teacher, { students: undecided.map(flaggedRow) });
      }
      if (stale.length > 0) {
        push('decision_outdated', journalId, teacher, { students: stale.map(flaggedRow) });
      }
      // `07`: "A rating exam entry is missing"; From 8.5: a pending entry blocks closing.
      if (one.ratingShown) {
        const missing = listedHere.filter(([, member]) => member.found?.ratingExam === null);
        if (missing.length > 0) {
          const { date } = await ratingDateOf(transaction, journalId, quarter.id);
          const pending =
            date === null
              ? new Set<string>()
              : await exemptOnDate(
                  transaction,
                  missing.map(([id]) => id),
                  one.journal.subjectId,
                  date,
                );
          push('rating_missing', journalId, teacher, {
            students: missing.map(([id]) => ({ student: nameOf(id), pending: pending.has(id) })),
          });
        }
      }
      // `07`: "Students with no result in a subject and no exemption" (From 8.5).
      const noResult = listedHere.filter(
        ([id, member]) =>
          member.outcome?.kind === 'no_result' &&
          !exempted.has(`${id}|${one.journal.subjectId}`) &&
          !exempted.has(`${id}|*`),
      );
      if (noResult.length > 0) {
        push('no_result', journalId, teacher, { students: noResult.map(([id]) => nameOf(id)) });
      }
      // `edge/calculation`: "The checklist warns when a part has a weight but no data in a
      // whole journal." Only once some student of the journal has a number.
      const numbers = listedHere.flatMap(([, member]) =>
        member.outcome?.kind === 'number' ? [member.outcome.result] : [],
      );
      if (numbers.length > 0) {
        const parts = (['attendance', 'classwork', 'homework', 'ratingExam'] as const).filter(
          (part) =>
            (part !== 'ratingExam' || one.ratingShown) &&
            numbers.every((result) =>
              result.leftOut.some((left) => left.part === part && left.reason === 'no_data'),
            ),
        );
        if (parts.length > 0) push('part_without_data', journalId, teacher, { parts });
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
      (id) => statuses.get(id)?.answer?.status !== 'complete',
    )) {
      push('edit_period', entry.journalId, entry.teacherId, {
        lessons: entry.lessons.length,
        incomplete: entry.incomplete,
      });
    }
    for (const entry of grouped((id) => (statuses.get(id)?.answer?.unmarked ?? 0) > 0)) {
      push('no_attendance', entry.journalId, entry.teacherId, { lessons: entry.lessons });
    }
    // A counted work of the lesson with no total, or a number waited for missing (07, Lesson
    // status; the homework checked at a lesson is counted there, never where it was given).
    for (const entry of grouped((id) => (statuses.get(id)?.answer?.worksMissing ?? 0) > 0)) {
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
    const completeness = await this.planReports.completenessIn(transaction, access, {
      quarterId: quarter.id,
    });
    const progress = await this.planReports.progressIn(transaction, access, {
      quarterId: quarter.id,
    });
    const notCovered = new Map(progress.plans.map((plan) => [plan.journalId, plan.notCovered]));
    for (const plan of completeness.plans) {
      const uncovered = notCovered.get(plan.journalId) ?? 0;
      if (plan.state === 'complete' && uncovered === 0 && plan.belowMinimum === null) continue;
      push('plan_incomplete', plan.journalId, ownerOf(plan.journalId), {
        state: plan.state,
        empty: plan.empty,
        notCovered: uncovered,
        belowMinimum: plan.belowMinimum !== null,
      });
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

/** The journal a student is listed under: the one of the latest membership in the quarter. */
function listedJournalOf(
  spans: readonly { journalId: string; from: string }[],
  fallback: string,
): string {
  const latest = [...spans].sort((a, b) => a.from.localeCompare(b.from)).at(-1);
  return latest?.journalId ?? fallback;
}

/** The flagged students of the journals given, each once, under the journal it is listed. */
function flaggedIn(journals: ReadonlyMap<string, JournalOutcomes>): Flagged[] {
  const found: Flagged[] = [];
  for (const [journalId, one] of journals) {
    for (const [studentId, member] of one.members) {
      const { outcome, input } = member;
      if (outcome === null || input === null || outcome.atLeaving !== null) continue;
      if (listedJournalOf(member.found?.spans ?? [], journalId) !== journalId) continue;
      if (outcome.flags.length === 0 && !outcome.staleDecision) continue;
      const stored = member.stored;
      found.push({
        journalId,
        subjectId: one.journal.subjectId,
        studentId,
        stale: outcome.staleDecision,
        row: {
          flags: [...outcome.flags] satisfies ResultFlag[],
          basedOn: outcome.basedOn,
          leftSubjectOn: outcome.leftSubjectOn,
          decision: stored?.decision ?? null,
          version: stored?.version ?? null,
          allowed: allowedDecisions(input),
        },
      });
    }
  }
  return found;
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
    throw error;
  }
}
