import { Injectable } from '@nestjs/common';
import {
  nextDay,
  planEventDecidedSchema,
  planRequestsSchema,
  schoolDateOf,
  type PlanEventDecided,
  type PlanEventDecision,
  type PlanPreparedDecision,
  type PlanPreparedSend,
  type PlanRequest,
  type PlanRequestCreate,
  type PlanRequestDecision,
  type PlanRequests,
  type PlanRequestSend,
  type PlanRequestsQuery,
} from '@sodiq/shared';
import { isSchoolDay } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import { refuseOwnRequest } from '../access/own-request.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { journalRows, staffNames, type JournalRow } from '../journal/journal-grid.query.js';
import { Notifications } from '../notifications/notifications.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { dayMoments, storedWindowOf } from './plan-gate.js';
import { accountOfStaff, postHolders, postsOf } from './plan-posts.js';
import {
  clockOf,
  datedQuarters,
  planIdOf,
  planItems,
  referenceDateOf,
  type PlanRowLesson,
} from './plan-read.js';
import { decisionReach, firstTier } from './plan-request-routing.js';
import { ownerIdOn } from './plan-scope.js';
import { periodLastDay, periodOpen, windowStateOf } from './plan-window.js';
import { answerOf, calendarOf, requestRows, type RequestRow } from './plan-request-read.js';
import { PlansService, type Scene } from './plans.service.js';

/**
 * Plan edit requests (task 7.2, pull request #215; `09`, Editing after the
 * window; `edge/lesson-plans`, The window and requests). A request is per
 * plan and journal (0115): `prepared` by the system (7.1b), `sent` by the
 * plan's owner, then `approved` with a period of school days or `refused`;
 * a change of owner makes the earlier owner's sent requests `void` (the
 * follow). Every route that writes a request locks the plan's journals in
 * the order of the id (`lockPlanOf`), then the request rows, and reads the
 * status after the locks.
 */

const scopeRefusal = () => new ApiException('plan_scope', 403);

/** What the system would prepare at the window's end (review correction 2). */
interface WindowEndPart {
  /** The first row not started with no item, for the Re-plan part; `null` when every one is filled. */
  readonly fromDate: string | null;
  /** The started rows with no item, for the Text part. */
  readonly lessons: readonly { lessonId: string; date: string }[];
}

const WAITING = ['prepared', 'sent'] as const;

@Injectable()
export class PlanRequestsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly notifications: Notifications,
    private readonly plans: PlansService,
  ) {}

  // -------------------------------------------------------------------------
  // Reads.

  /** A request of the branch, 404 otherwise. */
  private async requestOf(
    transaction: Transaction,
    branchId: string,
    requestId: string,
  ): Promise<RequestRow> {
    const [found] = await requestRows(transaction, (query) =>
      query.where('id', '=', requestId).where('branch_id', '=', branchId),
    );
    if (found === undefined) throw notFound();
    return found;
  }

  /** The request read again after the locks, its row locked. */
  private async lockRequest(transaction: Transaction, requestId: string): Promise<RequestRow> {
    await transaction
      .selectFrom('lesson_plan_requests')
      .select('id')
      .where('id', '=', requestId)
      .forUpdate()
      .execute();
    const [found] = await requestRows(transaction, (query) => query.where('id', '=', requestId));
    if (found === undefined) throw notFound();
    return found;
  }

  /** The account that asks: the sender, else the plan's owner on the reference date (review decision 15). */
  private async requesterOf(
    transaction: Transaction,
    branchId: string,
    request: RequestRow,
    journal: JournalRow,
    today: string,
  ): Promise<string | null> {
    if (request.requested_by !== null) return request.requested_by;
    const quarters = await datedQuarters(transaction, journal.academicYearId);
    const quarter = quarters.find((one) => one.id === request.quarter_id);
    if (quarter === undefined) return null;
    const owner = await ownerIdOn(transaction, branchId, journal, referenceDateOf(quarter, today));
    return accountOfStaff(transaction, owner);
  }

  /** What the reader may do with a request (`plan-request-routing.ts`). */
  private async reachOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    journal: JournalRow,
    requester: string | null,
    now: Date,
  ): Promise<'decide' | 'own' | 'none'> {
    const holders = await postHolders(transaction, branchId, journal.subjectId, now);
    return decisionReach(
      { accountId: access.accountId, posts: postsOf(holders, access.accountId) },
      { accountId: requester, posts: postsOf(holders, requester) },
    );
  }

  /** The requests of the reader's own plans, or those the reader decides or sees. */
  list(access: Access, query: PlanRequestsQuery): Promise<PlanRequests> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { today, now } = await clockOf(transaction, branchId);
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
      let yearId: string | undefined;
      if (query.yearId !== undefined) {
        if (!years.some((year) => year.id === query.yearId)) throw notFound();
        yearId = query.yearId;
      } else {
        yearId =
          years.find((year) => year.start_date <= today && today <= year.end_date)?.id ??
          years[0]?.id;
      }
      if (yearId === undefined) return planRequestsSchema.parse({ requests: [], events: [] });
      const journals = new Map(
        (await journalRows(transaction, branchId, { yearId })).map((journal) => [
          journal.id,
          journal,
        ]),
      );
      const rows = (
        await requestRows(transaction, (q) => q.where('branch_id', '=', branchId))
      ).filter((row) => journals.has(row.journal_id));
      const settings = await calendarOf(transaction, branchId);
      const reader = await transaction
        .selectFrom('staff')
        .select('id')
        .where('account_id', '=', access.accountId)
        .executeTakeFirst();
      const shown: PlanRequest[] = [];
      const events = new Map<
        string,
        { at: Date; requests: Set<string>; subjects: Map<string, JournalRow> }
      >();
      for (const row of rows) {
        const journal = journals.get(row.journal_id);
        if (journal === undefined) continue;
        const requester = await this.requesterOf(transaction, branchId, row, journal, today);
        let include: boolean;
        let canDecide = false;
        if (query.view === 'mine') {
          const quarters = await datedQuarters(transaction, journal.academicYearId);
          const quarter = quarters.find((one) => one.id === row.quarter_id);
          const owner =
            quarter === undefined
              ? null
              : await ownerIdOn(transaction, branchId, journal, referenceDateOf(quarter, today));
          include = requester === access.accountId || (owner !== null && owner === reader?.id);
        } else {
          const reach = await this.reachOf(transaction, access, branchId, journal, requester, now);
          // `02`: the Senior Head Teacher and the Academic Vice Principal "see it too".
          // Permission review, should-fix 3: the Principal "views everything in the branch".
          const principal = access.permitting.some((one) => one.role === 'principal');
          include = (reach === 'decide' || principal) && row.status !== 'void';
          canDecide = reach === 'decide' && (WAITING as readonly string[]).includes(row.status);
        }
        if (!include) continue;
        const answer = await answerOf(
          transaction,
          branchId,
          row,
          journal,
          today,
          now,
          settings,
          canDecide,
        );
        shown.push(answer);
        if (canDecide) {
          for (const cause of answer.causes) {
            const event = events.get(cause.eventId) ?? {
              at: new Date(0),
              requests: new Set<string>(),
              subjects: new Map<string, JournalRow>(),
            };
            event.requests.add(row.id);
            event.subjects.set(journal.subjectId, journal);
            events.set(cause.eventId, event);
          }
        }
      }
      if (events.size > 0) {
        const ats = await transaction
          .selectFrom('lesson_plan_request_causes')
          .select(['event_id', sql<Date>`min(at)`.as('at')])
          .where('event_id', 'in', [...events.keys()])
          .groupBy('event_id')
          .execute();
        for (const one of ats) {
          const event = events.get(one.event_id);
          if (event !== undefined) event.at = one.at;
        }
      }
      return planRequestsSchema.parse({
        requests: shown,
        events: [...events]
          .map(([eventId, event]) => ({
            eventId,
            at: event.at.toISOString(),
            requests: event.requests.size,
            subjects: [...event.subjects.values()].map((journal) => ({
              id: journal.subjectId,
              names: journal.subject.names,
              colour: journal.subject.colour,
            })),
          }))
          .sort((a, b) => b.at.localeCompare(a.at)),
      });
    });
  }

  // -------------------------------------------------------------------------
  // The window's end (review decision 14 and correction 2).

  /**
   * What the system prepares for a plan whose window ended for its owner: a
   * Re-plan from the first row not started with no item, and Text on the
   * started rows with no item. `null` when the window has not ended, or the
   * plan has no empty row.
   */
  async windowEndPart(
    transaction: Transaction,
    scene: Scene,
    planId: string | null,
    rows: readonly PlanRowLesson[],
  ): Promise<WindowEndPart | null> {
    const window = await storedWindowOf(transaction, scene.quarter, scene.ownerId, scene.timeZone);
    if (windowStateOf(window, scene.now).state !== 'ended') return null;
    const items = planId === null ? [] : await planItems(transaction, planId, scene.journal.id);
    const filled = new Set(items.map((item) => item.position));
    const empty = rows.filter((row) => !filled.has(row.number));
    const ahead = empty.find((row) => !row.started);
    const lessons = empty
      .filter((row) => row.started)
      .map((row) => ({ lessonId: row.lessonId, date: row.date }));
    if (ahead === undefined && lessons.length === 0) return null;
    return { fromDate: ahead?.date ?? null, lessons };
  }

  /** Adds the window's end part to a stored prepared request when it is sent or decided (correction 2). */
  private async addWindowEndPart(
    transaction: Transaction,
    request: RequestRow,
    part: WindowEndPart | null,
    now: Date,
  ): Promise<void> {
    if (part === null) return;
    const listed = new Set(
      (
        await transaction
          .selectFrom('lesson_plan_request_lessons')
          .select('lesson_id')
          .where('request_id', '=', request.id)
          .execute()
      ).map((one) => one.lesson_id),
    );
    const added = part.lessons.filter((one) => !listed.has(one.lessonId));
    if (added.length > 0) {
      await transaction
        .insertInto('lesson_plan_request_lessons')
        .values(
          added.map((one) => ({
            branch_id: request.branch_id,
            request_id: request.id,
            lesson_id: one.lessonId,
            lesson_date: one.date,
          })),
        )
        .execute();
    }
    if (part.fromDate !== null && request.from_date !== null && part.fromDate < request.from_date) {
      await transaction
        .updateTable('lesson_plan_requests')
        .set({ from_date: part.fromDate, updated_at: now })
        .where('id', '=', request.id)
        .execute();
    }
  }

  // -------------------------------------------------------------------------
  // The owner's writes.

  /** The scene of the owner's request write: the plan's journals locked, the plan's id. */
  private async ownerScene(
    transaction: Transaction,
    access: Access,
    branchId: string,
    journalId: string,
    quarterId: string,
  ): Promise<{ scene: Scene & { readonly assignmentId: string }; planId: string }> {
    const scene = await this.plans.writeSceneOf(
      transaction,
      access,
      branchId,
      journalId,
      quarterId,
    );
    await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
    const planId = await planIdOf(transaction, journalId, scene.quarter.id);
    if (planId === null) throw notFound();
    return { scene, planId };
  }

  /** Every lesson named by a body is a lesson of the branch: another branch's or an unknown one is 404. */
  private async lessonsOfBranch(
    transaction: Transaction,
    branchId: string,
    lessonIds: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(lessonIds)];
    if (unique.length === 0) return;
    const found = await transaction
      .selectFrom('lessons')
      .select('id')
      .where('id', 'in', unique)
      .where('branch_id', '=', branchId)
      .execute();
    if (found.length !== unique.length) throw notFound();
  }

  /** `edge`, review decision 13: a request is asked only while the owner's window is not open. */
  private async refuseInsideWindow(transaction: Transaction, scene: Scene): Promise<void> {
    const window = await storedWindowOf(
      transaction,
      scene.quarter,
      scene.reader.staffId,
      scene.timeZone,
    );
    if (windowStateOf(window, scene.now).state === 'open') {
      throw new ApiException('plan_request_window_open', 409);
    }
  }

  /** `09`: "The teacher sends an edit request: which lessons, and the reason." */
  create(
    access: Access,
    journalId: string,
    input: PlanRequestCreate,
    requestId: string | undefined,
  ): Promise<PlanRequest> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { scene, planId } = await this.ownerScene(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      // Permission review, should-fix 5: a lesson of the body is of the branch (404).
      await this.lessonsOfBranch(
        transaction,
        branchId,
        input.kind === 'text' ? input.lessonIds : [input.fromLessonId],
      );
      await this.refuseInsideWindow(transaction, scene);
      const rows = await this.plans.rowsOfJournal(transaction, scene, journalId);
      const rowOf = (lessonId: string) => rows.find((row) => row.lessonId === lessonId);
      let fromDate: string | null = null;
      let lessons: { lessonId: string; date: string }[] = [];
      if (input.kind === 'text') {
        const unique = [...new Set(input.lessonIds)];
        for (const lessonId of unique) {
          const row = rowOf(lessonId);
          if (row === undefined) throw new ApiException('plan_request_lesson_unknown', 409);
          lessons.push({ lessonId, date: row.date });
        }
        lessons = lessons.sort((a, b) => a.date.localeCompare(b.date));
      } else {
        const row = rowOf(input.fromLessonId);
        if (row === undefined) throw new ApiException('plan_request_lesson_unknown', 409);
        if (row.started) throw new ApiException('plan_request_held_replan', 409);
        fromDate = row.date;
      }
      const made = await transaction
        .insertInto('lesson_plan_requests')
        .values({
          branch_id: branchId,
          plan_id: planId,
          journal_id: journalId,
          quarter_id: scene.quarter.id,
          kind: input.kind,
          status: 'sent',
          from_date: fromDate,
          reason: input.reason,
          requested_by: access.accountId,
          sent_at: scene.now,
          prepared_at: scene.now,
          updated_at: scene.now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (lessons.length > 0) {
        await transaction
          .insertInto('lesson_plan_request_lessons')
          .values(
            lessons.map((one) => ({
              branch_id: branchId,
              request_id: made.id,
              lesson_id: one.lessonId,
              lesson_date: one.date,
            })),
          )
          .execute();
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.request_create',
        record: { type: 'lesson_plan', id: planId },
        newValue: {
          requestId: made.id,
          journalId,
          quarterId: scene.quarter.id,
          kind: input.kind,
          fromDate,
          lessons: lessons.map((one) => ({ ...one })),
          reason: input.reason,
        },
        ...(requestId === undefined ? {} : { requestId }),
      });
      await this.tellDeciders(transaction, branchId, scene, access.accountId);
      return this.answerSingle(transaction, branchId, made.id, scene);
    });
  }

  /** "The teacher only sends it": a prepared request sent by the plan's owner. */
  send(
    access: Access,
    requestId: string,
    input: PlanRequestSend,
    keyId: string | undefined,
  ): Promise<PlanRequest> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.requestOf(transaction, branchId, requestId);
      const { scene, planId } = await this.ownerScene(
        transaction,
        access,
        branchId,
        found.journal_id,
        found.quarter_id,
      );
      const request = await this.lockRequest(transaction, requestId);
      if (request.status !== 'prepared' || request.plan_id !== planId) {
        throw new ApiException('plan_request_decided', 409);
      }
      await this.refuseInsideWindow(transaction, scene);
      const rows = await this.plans.rowsOfJournal(transaction, scene, scene.journal.id);
      await this.addWindowEndPart(
        transaction,
        request,
        await this.windowEndPart(transaction, scene, planId, rows),
        scene.now,
      );
      await this.markSent(transaction, request, access, input.reason ?? request.reason, scene.now);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.request_send',
        record: { type: 'lesson_plan', id: planId },
        newValue: {
          requestId,
          journalId: scene.journal.id,
          reason: input.reason ?? request.reason,
        },
        ...(keyId === undefined ? {} : { requestId: keyId }),
      });
      await this.tellDeciders(transaction, branchId, scene, access.accountId);
      return this.answerSingle(transaction, branchId, requestId, scene);
    });
  }

  private async markSent(
    transaction: Transaction,
    request: RequestRow,
    access: Access,
    reason: string,
    now: Date,
  ): Promise<void> {
    await transaction
      .updateTable('lesson_plan_requests')
      .set({
        status: 'sent',
        requested_by: access.accountId,
        sent_at: now,
        reason,
        updated_at: now,
      })
      .where('id', '=', request.id)
      .execute();
  }

  /**
   * The request worked out at the window's end, stored and sent by the
   * owner. A stored prepared request is sent instead, with the Text part
   * added (correction 2); two at once store one (the journals' locks).
   */
  sendPrepared(
    access: Access,
    journalId: string,
    input: PlanPreparedSend,
    keyId: string | undefined,
  ): Promise<PlanRequest> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { scene, planId } = await this.ownerScene(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      await this.refuseInsideWindow(transaction, scene);
      const stored = await this.storeWindowEnd(transaction, scene, planId);
      const request = await this.lockRequest(transaction, stored.id);
      if (!(
        request.status === 'prepared' ||
        (request.status === 'sent' && request.requested_by === null)
      )) {
        // Stored and sent by a send at the same moment: the answer is that request.
        return this.answerSingle(transaction, branchId, request.id, scene);
      }
      await this.markSent(transaction, request, access, input.reason ?? request.reason, scene.now);
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.request_send',
        record: { type: 'lesson_plan', id: planId },
        newValue: { requestId: request.id, journalId, reason: input.reason ?? request.reason },
        ...(keyId === undefined ? {} : { requestId: keyId }),
      });
      await this.tellDeciders(transaction, branchId, scene, access.accountId);
      return this.answerSingle(transaction, branchId, request.id, scene);
    });
  }

  /**
   * The prepared request of a plan's journal, made from the window's end
   * part when none is stored (journals locked by the caller). Refused
   * `plan_request_nothing` when the plan needs nothing.
   */
  private async storeWindowEnd(
    transaction: Transaction,
    scene: Scene,
    planId: string,
  ): Promise<RequestRow> {
    const rows = await this.plans.rowsOfJournal(transaction, scene, scene.journal.id);
    const part = await this.windowEndPart(transaction, scene, planId, rows);
    const [existing] = await requestRows(transaction, (query) =>
      query
        .where('plan_id', '=', planId)
        .where('journal_id', '=', scene.journal.id)
        .where('status', '=', 'prepared'),
    );
    if (existing !== undefined) {
      await this.addWindowEndPart(transaction, existing, part, scene.now);
      return existing;
    }
    // A request already sent waits: a second store (two at once) answers it.
    const others = await requestRows(transaction, (query) =>
      query
        .where('plan_id', '=', planId)
        .where('journal_id', '=', scene.journal.id)
        .where('status', 'in', ['sent', 'approved']),
    );
    const sent = others.find((one) => one.status === 'sent');
    if (sent !== undefined) return sent;
    // An open period covers it already.
    if (
      part === null ||
      others.some((one) =>
        periodOpen(
          { openUntil: one.open_until, finishedAt: one.finished_at, status: one.status },
          scene.now,
        ),
      )
    ) {
      throw new ApiException('plan_request_nothing', 409);
    }
    const made = await transaction
      .insertInto('lesson_plan_requests')
      .values({
        branch_id: scene.branchId,
        plan_id: planId,
        journal_id: scene.journal.id,
        quarter_id: scene.quarter.id,
        kind: part.fromDate === null ? 'text' : 'replan',
        status: part.fromDate === null ? 'sent' : 'prepared',
        from_date: part.fromDate,
        // A Text part alone is no Re-plan to prepare: it waits as sent by nobody yet.
        ...(part.fromDate === null ? { sent_at: scene.now } : {}),
        prepared_at: scene.now,
        updated_at: scene.now,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    if (part.lessons.length > 0) {
      await transaction
        .insertInto('lesson_plan_request_lessons')
        .values(
          part.lessons.map((one) => ({
            branch_id: scene.branchId,
            request_id: made.id,
            lesson_id: one.lessonId,
            lesson_date: one.date,
          })),
        )
        .execute();
    }
    return this.lockRequest(transaction, made.id);
  }

  /** `edge`: "The teacher can press \"finished\" to lock early." */
  finish(access: Access, requestId: string, keyId: string | undefined): Promise<PlanRequest> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.requestOf(transaction, branchId, requestId);
      const { scene, planId } = await this.ownerScene(
        transaction,
        access,
        branchId,
        found.journal_id,
        found.quarter_id,
      );
      const request = await this.lockRequest(transaction, requestId);
      if (
        request.plan_id !== planId ||
        !periodOpen(
          {
            openUntil: request.open_until,
            finishedAt: request.finished_at,
            status: request.status,
          },
          scene.now,
        )
      ) {
        throw new ApiException('plan_request_decided', 409);
      }
      await transaction
        .updateTable('lesson_plan_requests')
        .set({ finished_at: scene.now, updated_at: scene.now })
        .where('id', '=', requestId)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.request_finish',
        record: { type: 'lesson_plan', id: planId },
        newValue: { requestId, journalId: scene.journal.id },
        ...(keyId === undefined ? {} : { requestId: keyId }),
      });
      return this.answerSingle(transaction, branchId, requestId, scene);
    });
  }

  // -------------------------------------------------------------------------
  // The deciders.

  /**
   * The scene of a decision: the reader reads the journal's plan and may
   * decide a request of it. The journals are locked before the request.
   */
  private async deciderScene(
    transaction: Transaction,
    access: Access,
    branchId: string,
    journalId: string,
    quarterId: string,
  ): Promise<{ scene: Scene; planId: string }> {
    // Permission review, should-fix 1: a closed year is told after the routing.
    const scene = await this.plans.sceneOf(transaction, access, branchId, journalId, quarterId);
    await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
    const planId = await planIdOf(transaction, journalId, scene.quarter.id);
    if (planId === null) throw notFound();
    return { scene, planId };
  }

  /** Refuses the reader's own (403 `own_request`) and anyone outside the routing (`plan_scope`). */
  private async refuseNonDecider(
    transaction: Transaction,
    access: Access,
    scene: Scene,
    request: RequestRow,
  ): Promise<string | null> {
    const today = schoolDateOf(scene.now, scene.timeZone);
    const requester = await this.requesterOf(
      transaction,
      scene.branchId,
      request,
      scene.journal,
      today,
    );
    const reach = await this.reachOf(
      transaction,
      access,
      scene.branchId,
      scene.journal,
      requester,
      scene.now,
    );
    if (reach === 'own') refuseOwnRequest(access.accountId, requester ?? '');
    if (reach !== 'decide') throw scopeRefusal();
    return requester;
  }

  /** `09`: "The Head Teacher of the subject in that branch approves or refuses it." */
  decide(
    access: Access,
    requestId: string,
    input: PlanRequestDecision,
    keyId: string | undefined,
  ): Promise<PlanRequest> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.requestOf(transaction, branchId, requestId);
      const { scene, planId } = await this.deciderScene(
        transaction,
        access,
        branchId,
        found.journal_id,
        found.quarter_id,
      );
      const request = await this.lockRequest(transaction, requestId);
      const requester = await this.refuseNonDecider(transaction, access, scene, request);
      if (scene.closed) throw new ApiException('plan_year_closed', 409);
      if (!(WAITING as readonly string[]).includes(request.status) || request.plan_id !== planId) {
        throw new ApiException('plan_request_decided', 409);
      }
      await this.decideOne(transaction, access, scene, planId, request, requester, input, keyId);
      return this.answerSingle(transaction, branchId, requestId, scene);
    });
  }

  /** The window-end request stored and decided by an approver ("can approve it without waiting"). */
  decidePrepared(
    access: Access,
    journalId: string,
    input: PlanPreparedDecision,
    keyId: string | undefined,
  ): Promise<PlanRequest> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { scene, planId } = await this.deciderScene(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      // The routing first: the store tells nothing to a reader who may not decide.
      const owner = await accountOfStaff(transaction, scene.ownerId);
      const reach = await this.reachOf(
        transaction,
        access,
        branchId,
        scene.journal,
        owner,
        scene.now,
      );
      if (reach === 'own') refuseOwnRequest(access.accountId, owner ?? '');
      if (reach !== 'decide') throw scopeRefusal();
      if (scene.closed) throw new ApiException('plan_year_closed', 409);
      const stored = await this.storeWindowEnd(transaction, scene, planId);
      const request = await this.lockRequest(transaction, stored.id);
      if (!(WAITING as readonly string[]).includes(request.status)) {
        throw new ApiException('plan_request_decided', 409);
      }
      const requester = await this.refuseNonDecider(transaction, access, scene, request);
      await this.decideOne(
        transaction,
        access,
        scene,
        planId,
        request,
        requester,
        input.decision,
        keyId,
      );
      return this.answerSingle(transaction, branchId, request.id, scene);
    });
  }

  /** Approves or refuses one locked, waiting request. */
  private async decideOne(
    transaction: Transaction,
    access: Access,
    scene: Scene,
    planId: string,
    request: RequestRow,
    requester: string | null,
    input: PlanRequestDecision,
    keyId: string | undefined,
    tell = true,
  ): Promise<{ until: string } | null> {
    const branchId = scene.branchId;
    const now = scene.now;
    if (input.decision === 'refuse') {
      await transaction
        .updateTable('lesson_plan_requests')
        .set({
          status: 'refused',
          decided_by: access.accountId,
          decided_at: now,
          decision_reason: input.reason,
          updated_at: now,
        })
        .where('id', '=', request.id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'plan.request_refuse',
        record: { type: 'lesson_plan', id: planId },
        newValue: { requestId: request.id, journalId: scene.journal.id, reason: input.reason },
        ...(keyId === undefined ? {} : { requestId: keyId }),
      });
      if (requester !== null) {
        await this.notifications.send(transaction, {
          kind: 'plans.request_refused',
          branchId,
          accountIds: [requester],
          data: {
            unit: scene.journal.unitName,
            quarter: scene.quarter.number,
            reason: input.reason,
          },
        });
      }
      return null;
    }
    // Correction 2: a prepared request decided after the window's end takes the Text part.
    if (request.status === 'prepared') {
      const rows = await this.plans.rowsOfJournal(transaction, scene, scene.journal.id);
      await this.addWindowEndPart(
        transaction,
        request,
        await this.windowEndPart(transaction, scene, planId, rows),
        now,
      );
    }
    await this.lessonsOfBranch(transaction, branchId, [
      ...(input.untick ?? []).map((one) => one.lessonId),
      ...(input.later === undefined ? [] : [input.later.fromLessonId]),
    ]);
    const fresh = await this.lockRequest(transaction, request.id);
    const listed = await transaction
      .selectFrom('lesson_plan_request_lessons')
      .select('lesson_id')
      .where('request_id', '=', request.id)
      .execute();
    for (const untick of input.untick ?? []) {
      if (!listed.some((one) => one.lesson_id === untick.lessonId)) {
        throw new ApiException('plan_request_lesson_unknown', 409);
      }
      await transaction
        .updateTable('lesson_plan_request_lessons')
        .set({ approved: false, untick_reason: untick.reason })
        .where('request_id', '=', request.id)
        .where('lesson_id', '=', untick.lessonId)
        .execute();
    }
    let fromDate = fresh.from_date;
    let decisionReason = '';
    if (input.later !== undefined) {
      // Review decision 10: unticking a Re-plan is a later first lesson.
      const rows = await this.plans.rowsOfJournal(transaction, scene, scene.journal.id);
      const row = rows.find((one) => one.lessonId === input.later?.fromLessonId);
      if (row === undefined || fromDate === null || row.date < fromDate) {
        throw new ApiException('plan_request_lesson_unknown', 409);
      }
      if (row.started) throw new ApiException('plan_request_held_replan', 409);
      fromDate = row.date;
      decisionReason = input.later.reason;
    }
    const settings = await calendarOf(transaction, branchId);
    const today = schoolDateOf(now, scene.timeZone);
    const yearEnd = await transaction
      .selectFrom('academic_years')
      .select(sql<string>`end_date::text`.as('end_date'))
      .where('id', '=', scene.journal.academicYearId)
      .executeTakeFirstOrThrow();
    const last = periodLastDay(
      today,
      input.days,
      (date) => isSchoolDay(date, settings),
      nextDay,
      yearEnd.end_date,
    );
    const { endsAt } = await dayMoments(transaction, last, last, scene.timeZone);
    await transaction
      .updateTable('lesson_plan_requests')
      .set({
        status: 'approved',
        decided_by: access.accountId,
        decided_at: now,
        days: input.days,
        open_until: endsAt,
        from_date: fromDate,
        decision_reason: decisionReason,
        updated_at: now,
      })
      .where('id', '=', request.id)
      .execute();
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'plan.request_approve',
      record: { type: 'lesson_plan', id: planId },
      newValue: {
        requestId: request.id,
        journalId: scene.journal.id,
        days: input.days,
        until: last,
        fromDate,
        unticked: (input.untick ?? []).map((one) => ({ ...one })),
        ...(input.later === undefined ? {} : { later: { ...input.later } }),
      } satisfies JsonValue,
      ...(keyId === undefined ? {} : { requestId: keyId }),
    });
    if (requester !== null && tell) {
      await this.notifications.send(transaction, {
        kind: 'plans.request_approved',
        branchId,
        accountIds: [requester],
        data: { unit: scene.journal.unitName, quarter: scene.quarter.number, until: last },
      });
    }
    return { until: last };
  }

  /**
   * `09`, Approving together: "The approver can approve all requests caused
   * by one event ... in one step and set the number of days once"; `edge`:
   * "Approval can be given by event and by subject". A request is approved
   * whole (review decision 16); one the reader may not decide is skipped.
   */
  decideEvent(
    access: Access,
    input: PlanEventDecision,
    keyId: string | undefined,
  ): Promise<PlanEventDecided> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const causes = await transaction
        .selectFrom('lesson_plan_request_causes')
        .select('request_id')
        .where('event_id', '=', input.eventId)
        .where('branch_id', '=', branchId)
        .execute();
      if (causes.length === 0) throw notFound();
      if (input.subjectId !== undefined) {
        const subject = await transaction
          .selectFrom('subjects')
          .select('id')
          .where('id', '=', input.subjectId)
          .executeTakeFirst();
        if (subject === undefined) throw notFound();
      }
      const ids = [...new Set(causes.map((cause) => cause.request_id))].sort();
      const requests = await requestRows(transaction, (query) =>
        query.where('id', 'in', ids).where('status', 'in', [...WAITING]),
      );
      const { today } = await clockOf(transaction, branchId);
      const approved: string[] = [];
      const skipped: string[] = [];
      const told = new Map<string, Set<string>>();
      let until = today;
      // Every journal first in the order of the id, then the requests.
      const journalIds = [...new Set(requests.map((one) => one.journal_id))].sort();
      const scenes = new Map<string, { scene: Scene; planId: string }>();
      for (const journalId of journalIds) {
        const one = requests.find((row) => row.journal_id === journalId);
        if (one === undefined) continue;
        const scene = await this.plans.sceneOf(
          transaction,
          access,
          branchId,
          journalId,
          one.quarter_id,
        );
        if (input.subjectId !== undefined && scene.journal.subjectId !== input.subjectId) continue;
        await this.plans.lockPlanOf(transaction, journalId, scene.quarter.id);
        const planId = await planIdOf(transaction, journalId, scene.quarter.id);
        if (planId !== null) scenes.set(journalId, { scene, planId });
      }
      for (const row of [...requests].sort((a, b) => a.id.localeCompare(b.id))) {
        const found = scenes.get(row.journal_id);
        if (found === undefined) continue;
        const request = await this.lockRequest(transaction, row.id);
        if (
          !(WAITING as readonly string[]).includes(request.status) ||
          request.plan_id !== found.planId
        ) {
          continue;
        }
        const requester = await this.requesterOf(
          transaction,
          branchId,
          request,
          found.scene.journal,
          today,
        );
        const reach = await this.reachOf(
          transaction,
          access,
          branchId,
          found.scene.journal,
          requester,
          found.scene.now,
        );
        if (reach !== 'decide' || found.scene.closed) {
          skipped.push(request.id);
          continue;
        }
        const done = await this.decideOne(
          transaction,
          access,
          found.scene,
          found.planId,
          request,
          requester,
          { decision: 'approve', days: input.days },
          keyId,
          false,
        );
        if (done !== null) until = done.until;
        approved.push(request.id);
        if (requester !== null) {
          const units = told.get(requester) ?? new Set<string>();
          units.add(found.scene.journal.unitName);
          told.set(requester, units);
        }
      }
      // `edge`: "One notice per teacher per event, listing their plans."
      for (const [accountId, units] of [...told].sort(([a], [b]) => a.localeCompare(b))) {
        await this.notifications.send(transaction, {
          kind: 'plans.request_approved',
          branchId,
          accountIds: [accountId],
          data: {
            unit: [...units].sort((a, b) => a.localeCompare(b, 'en')).join(', '),
            quarter: [...scenes.values()][0]?.scene.quarter.number ?? 1,
            until,
          },
        });
      }
      return planEventDecidedSchema.parse({ approved, skipped });
    });
  }

  // -------------------------------------------------------------------------
  // Helpers.

  /** Review correction 5: the first tier of the routing is told; never the requester. */
  private async tellDeciders(
    transaction: Transaction,
    branchId: string,
    scene: Scene,
    requester: string,
  ): Promise<void> {
    const holders = await postHolders(transaction, branchId, scene.journal.subjectId, scene.now);
    const accounts = firstTier(
      { accountId: requester, posts: postsOf(holders, requester) },
      holders,
    );
    const owner = scene.ownerId === null ? [] : [scene.ownerId];
    const names = await staffNames(transaction, owner);
    const name = names.get(scene.ownerId ?? '') ?? scene.journal.unitName;
    for (const accountId of accounts) {
      await this.notifications.send(transaction, {
        kind: 'plans.request_sent',
        branchId,
        accountIds: [accountId],
        data: {
          name: name === '' ? scene.journal.unitName : name,
          unit: scene.journal.unitName,
          quarter: scene.quarter.number,
        },
      });
    }
  }

  private async answerSingle(
    transaction: Transaction,
    branchId: string,
    requestId: string,
    scene: Scene,
  ): Promise<PlanRequest> {
    const [row] = await requestRows(transaction, (query) => query.where('id', '=', requestId));
    if (row === undefined) throw notFound();
    const settings = await calendarOf(transaction, branchId);
    return answerOf(
      transaction,
      branchId,
      row,
      scene.journal,
      schoolDateOf(scene.now, scene.timeZone),
      scene.now,
      settings,
      false,
    );
  }
}
