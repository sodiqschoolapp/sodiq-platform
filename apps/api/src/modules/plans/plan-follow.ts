import { Injectable, type OnModuleInit } from '@nestjs/common';
import {
  schoolDateOf,
  subjectColourSchema,
  type PlanImpact,
  type PlanRequestCause,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { journalRows, type JournalRow } from '../journal/journal-grid.query.js';
import { Notifications } from '../notifications/notifications.service.js';
import { ownerFactsOf, ownerOn, type OwnerFacts } from '../timetable/journal-owners.js';
import { referenceDateOf, type PlanQuarter } from './plan-read.js';
import { followQueue, type Absorbed, type FollowResult, type QueueRow } from './plan-queue.js';
import { planReachOf, planReaderOf } from './plan-scope.js';

/**
 * The plans follow the timetable (task 7.1b, pull request #213; `09`, When
 * something else changes; `edge/lesson-plans`, How items stay attached:
 * "Whenever the timetable changes, the queue is attached again, first item
 * to the first lesson not yet held, in the same step as the change").
 *
 * Decision 5: the triggers of 0115 mark the journals with a plan that a
 * transaction touched; before the commit (`Transactions.addBeforeCommit`)
 * `run` follows every plan of those journals (`followQueue`), stores the new
 * positions and the snapshot of the rows, prepares the edit requests
 * (decision 4), writes the audit entries (decision 6) and sends the notices
 * (decision 8 as changed on #213). `preview` gives the same follow without a
 * write, for the impact previews that run a change and roll it back.
 */

/** A plan of a marked journal, as the follow reads it. */
interface FollowedPlan {
  readonly planId: string;
  readonly journal: JournalRow;
  readonly quarter: PlanQuarter;
  /** The journal has a run day on or after today (decision 9). */
  readonly open: boolean;
  readonly before: readonly SnapshotRow[] | null;
  readonly after: readonly QueueRow[];
  readonly items: readonly { id: string; position: number; topic: string }[];
  readonly absorbed: readonly Absorbed[];
}

interface SnapshotRow extends QueueRow {
  readonly ownerId: string | null;
}

/** What the follow did to a plan. */
interface Followed {
  readonly plan: FollowedPlan;
  readonly result: FollowResult;
  readonly owners: readonly (string | null)[];
  readonly causes: readonly Cause[];
}

interface Cause {
  readonly kind: PlanRequestCause;
  readonly onDate: string;
  readonly items: number;
  readonly staffId: string | null;
}

/** The position offset of the first of the two writes (the partial unique index of 0114). */
const OFFSET = 1_000_000;

const unitKey = (one: {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
}) => `${one.classId ?? ''}|${one.groupId ?? ''}|${one.subjectId}`;

const sameRows = (a: readonly SnapshotRow[] | null, b: readonly SnapshotRow[]) =>
  a !== null &&
  a.length === b.length &&
  a.every(
    (row, index) =>
      row.lessonId === b[index]?.lessonId &&
      row.date === b[index]?.date &&
      row.startsAt.getTime() === b[index]?.startsAt.getTime() &&
      row.ownerId === b[index]?.ownerId,
  );

@Injectable()
export class PlanFollow implements OnModuleInit {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly notifications: Notifications,
  ) {}

  onModuleInit(): void {
    this.transactions.addBeforeCommit((transaction) => this.run(transaction));
  }

  /** Follows the plans this transaction touched, and writes what changed. */
  async run(transaction: Transaction): Promise<void> {
    const marks = await this.marksOf(transaction);
    if (marks.size === 0) return;
    await sql`
      delete from lesson_plan_follow_marks where written_xact = pg_current_xact_id_if_assigned()
    `.execute(transaction);
    for (const [branchId, journalIds] of marks) {
      const followed = await this.followBranch(transaction, branchId, journalIds);
      await this.write(transaction, branchId, followed);
    }
  }

  /**
   * The follow of the plans this transaction touched, without a write: per
   * plan the reader may read, what moved, the items that no longer fit and
   * the rows left empty (`edge/lesson-plans`: "The impact preview shows, per
   * plan, items that no longer fit and rows left empty").
   */
  async preview(transaction: Transaction, access: Access): Promise<PlanImpact[]> {
    const marks = await this.marksOf(transaction);
    const impacts: PlanImpact[] = [];
    const reader = await planReaderOf(transaction, access);
    for (const [branchId, journalIds] of marks) {
      const followed = await this.followBranch(transaction, branchId, journalIds);
      const { today, now } = await this.clockOf(transaction, branchId);
      const facts = await this.factsOf(
        transaction,
        branchId,
        followed.map((one) => one.plan.journal),
      );
      for (const one of followed) {
        const { plan, result } = one;
        if (result.moves.length === 0 && !result.rowsAddedAtEnd) continue;
        const owner = ownerOn(
          facts.runs.get(plan.journal.id) ?? [],
          facts.periods.get(plan.journal.id) ?? [],
          facts.out,
          referenceDateOf(plan.quarter, today),
        );
        const ownerId = owner === null || owner.kind === 'none' ? null : owner.staffId;
        if (!planReachOf(reader, plan.journal, ownerId).read) continue;
        impacts.push(impactOf(one, now));
      }
    }
    return impacts.sort(
      (a, b) =>
        a.unit.localeCompare(b.unit, 'en') ||
        a.subject.names.en.localeCompare(b.subject.names.en, 'en') ||
        a.quarter - b.quarter,
    );
  }

  /** The journals marked by this transaction, by branch. */
  private async marksOf(transaction: Transaction): Promise<Map<string, string[]>> {
    const rows = await sql<{ branch_id: string; journal_id: string }>`
      select distinct branch_id, journal_id from lesson_plan_follow_marks
      where written_xact = pg_current_xact_id_if_assigned()
      order by branch_id, journal_id
    `.execute(transaction);
    const marks = new Map<string, string[]>();
    for (const row of rows.rows) {
      const list = marks.get(row.branch_id) ?? [];
      list.push(row.journal_id);
      marks.set(row.branch_id, list);
    }
    return marks;
  }

  private async clockOf(transaction: Transaction, branchId: string) {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    const now = await transactionMoment(transaction);
    return { timeZone: branch.time_zone, today: schoolDateOf(now, branch.time_zone), now };
  }

  private factsOf(
    transaction: Transaction,
    branchId: string,
    journals: readonly JournalRow[],
  ): Promise<OwnerFacts> {
    const unique = [...new Map(journals.map((journal) => [journal.id, journal])).values()];
    return ownerFactsOf(
      transaction,
      branchId,
      unique.map((journal) => ({
        id: journal.id,
        academic_year_id: journal.academicYearId,
        class_id: journal.classId,
        group_id: journal.groupId,
        subject_id: journal.subjectId,
      })),
    );
  }

  /**
   * Locks the journals (`for no key update`, as the plan writes do, in the
   * order of the id, in one statement), then reads every plan of them in
   * batched queries and follows each one.
   */
  private async followBranch(
    transaction: Transaction,
    branchId: string,
    journalIds: readonly string[],
  ): Promise<Followed[]> {
    await transaction
      .selectFrom('journals')
      .select('id')
      .where('id', 'in', [...journalIds])
      .orderBy('id')
      .forNoKeyUpdate()
      .execute();
    const { today, now } = await this.clockOf(transaction, branchId);
    const plans = await transaction
      .selectFrom('lesson_plan_journals')
      .innerJoin('quarters', 'quarters.id', 'lesson_plan_journals.quarter_id')
      .select([
        'lesson_plan_journals.plan_id',
        'lesson_plan_journals.journal_id',
        'quarters.id as quarter_id',
        'quarters.number',
        'lesson_plan_journals.laid_at',
        sql<string | null>`quarters.start_date::text`.as('start_date'),
        sql<string | null>`quarters.end_date::text`.as('end_date'),
      ])
      .where('lesson_plan_journals.journal_id', 'in', [...journalIds])
      .orderBy('lesson_plan_journals.journal_id')
      .orderBy('quarters.number')
      .execute();
    if (plans.length === 0) return [];
    const journals = new Map<string, JournalRow>();
    for (const journalId of new Set(plans.map((plan) => plan.journal_id))) {
      const [journal] = await journalRows(transaction, branchId, { journalId });
      if (journal !== undefined) journals.set(journalId, journal);
    }
    // Decision 9: a plan is open while its journal has a run day from the
    // later of today and its quarter's first day.
    const open = new Set(
      (
        await transaction
          .selectFrom('lesson_plan_journals')
          .innerJoin('journals', 'journals.id', 'lesson_plan_journals.journal_id')
          .innerJoin('quarters', 'quarters.id', 'lesson_plan_journals.quarter_id')
          .select('lesson_plan_journals.plan_id')
          .where('lesson_plan_journals.journal_id', 'in', [...journals.keys()])
          .where(
            sql<boolean>`journals.runs && datemultirange(daterange(greatest(${today}::date, quarters.start_date), null))`,
          )
          .execute()
      ).map((row) => row.plan_id),
    );
    const dated = plans.flatMap((plan) =>
      plan.start_date === null || plan.end_date === null
        ? []
        : [{ ...plan, start_date: plan.start_date, end_date: plan.end_date }],
    );
    const lessons = await this.lessonsOf(transaction, branchId, [...journals.values()], dated);
    const planIds = dated.map((plan) => plan.plan_id);
    const [snapshots, items, absorbed] =
      planIds.length === 0
        ? [[], [], []]
        : await Promise.all([
            transaction
              .selectFrom('lesson_plan_rows')
              .select([
                'plan_id',
                'journal_id',
                'position',
                'lesson_id',
                sql<string>`lesson_date::text`.as('lesson_date'),
                'starts_at',
                'owner_staff_id',
              ])
              .where('plan_id', 'in', planIds)
              .orderBy('plan_id')
              .orderBy('position')
              .execute(),
            transaction
              .selectFrom('lesson_plan_items')
              .select(['id', 'plan_id', 'position', 'topic'])
              .where('plan_id', 'in', planIds)
              .where('cleared_at', 'is', null)
              .orderBy('position')
              .execute(),
            transaction
              .selectFrom('lesson_plan_absorbed')
              .select(['plan_id', 'journal_id', 'removed_lesson_id', 'absorbing_lesson_id'])
              .where('plan_id', 'in', planIds)
              .orderBy('id')
              .execute(),
          ]);
    const facts = await this.factsOf(transaction, branchId, [...journals.values()]);
    const followed: Followed[] = [];
    for (const plan of dated) {
      const journal = journals.get(plan.journal_id);
      if (journal === undefined) continue;
      const quarter: PlanQuarter = {
        id: plan.quarter_id,
        number: plan.number,
        startDate: plan.start_date,
        endDate: plan.end_date,
      };
      const after = (lessons.get(unitKey(journal)) ?? []).filter(
        (row) => quarter.startDate <= row.date && row.date <= quarter.endDate,
      );
      const snapshot = snapshots.filter(
        (row) => row.plan_id === plan.plan_id && row.journal_id === plan.journal_id,
      );
      const before: SnapshotRow[] | null =
        plan.laid_at === null
          ? null
          : snapshot.map((row) => ({
              lessonId: row.lesson_id,
              date: row.lesson_date,
              startsAt: row.starts_at,
              ownerId: row.owner_staff_id,
            }));
      const followedPlan: FollowedPlan = {
        planId: plan.plan_id,
        journal,
        quarter,
        open: open.has(plan.plan_id),
        before,
        after,
        items: items.filter((item) => item.plan_id === plan.plan_id),
        absorbed: absorbed
          .filter((row) => row.plan_id === plan.plan_id && row.journal_id === plan.journal_id)
          .map((row) => ({
            removedLessonId: row.removed_lesson_id,
            absorbingLessonId: row.absorbing_lesson_id,
          })),
      };
      const result = followQueue({
        before,
        after,
        items: followedPlan.items,
        absorbed: followedPlan.absorbed,
        now,
      });
      const owners = after.map((row) => {
        const owner = ownerOn(
          facts.runs.get(journal.id) ?? [],
          facts.periods.get(journal.id) ?? [],
          facts.out,
          row.date,
        );
        return owner === null || owner.kind === 'none' ? null : owner.staffId;
      });
      followed.push({
        plan: followedPlan,
        result,
        owners,
        causes: causesOf(followedPlan, result, owners, now),
      });
    }
    return followed;
  }

  /** The lessons not cancelled of the journals, by unit, in date and time order. */
  private async lessonsOf(
    transaction: Transaction,
    branchId: string,
    journals: readonly JournalRow[],
    plans: readonly { start_date: string; end_date: string }[],
  ): Promise<Map<string, QueueRow[]>> {
    const found = new Map<string, QueueRow[]>();
    if (journals.length === 0 || plans.length === 0) return found;
    const from = plans.reduce(
      (min, plan) => (plan.start_date < min ? plan.start_date : min),
      '9999-12-31',
    );
    const to = plans.reduce(
      (max, plan) => (plan.end_date > max ? plan.end_date : max),
      '0000-01-01',
    );
    const classIds = journals.flatMap((journal) =>
      journal.classId === null ? [] : [journal.classId],
    );
    const groupIds = journals.flatMap((journal) =>
      journal.groupId === null ? [] : [journal.groupId],
    );
    const rows = await transaction
      .selectFrom('lessons')
      .select([
        'id',
        'class_id',
        'group_id',
        'subject_id',
        sql<string>`lesson_date::text`.as('lesson_date'),
        'starts_at',
      ])
      .where('branch_id', '=', branchId)
      .where('cancel_cause', 'is', null)
      .where(
        'subject_id',
        'in',
        journals.map((journal) => journal.subjectId),
      )
      .where('lesson_date', '>=', from)
      .where('lesson_date', '<=', to)
      .where((builder) =>
        builder.or([
          ...(classIds.length === 0 ? [] : [builder('class_id', 'in', classIds)]),
          ...(groupIds.length === 0 ? [] : [builder('group_id', 'in', groupIds)]),
        ]),
      )
      .orderBy('starts_at')
      .orderBy('id')
      .execute();
    for (const row of rows) {
      const key = unitKey({
        classId: row.class_id,
        groupId: row.group_id,
        subjectId: row.subject_id,
      });
      const list = found.get(key) ?? [];
      list.push({ lessonId: row.id, date: row.lesson_date, startsAt: row.starts_at });
      found.set(key, list);
    }
    return found;
  }

  /** Stores what the follow did in one branch, then audits and tells (decisions 4, 6 and 8). */
  private async write(
    transaction: Transaction,
    branchId: string,
    followed: readonly Followed[],
  ): Promise<void> {
    if (followed.length === 0) return;
    const now = await transactionMoment(transaction);
    const actor = await this.actorOf(transaction, branchId);
    // Decision 8 as changed on #213: a plan whose items moved, or that got a request.
    const told = new Map<string, { units: Set<string>; plans: number; requests: number }>();
    const counts = new Map<string, { plans: number; requests: number }>();
    for (const one of followed) {
      const { plan, result } = one;
      const changed = [...result.positions].filter(
        ([id, position]) => plan.items.find((item) => item.id === id)?.position !== position,
      );
      if (changed.length > 0) {
        for (const [id, position] of changed) {
          await transaction
            .updateTable('lesson_plan_items')
            .set({ position: position + OFFSET })
            .where('id', '=', id)
            .execute();
        }
        for (const [id, position] of changed) {
          await transaction
            .updateTable('lesson_plan_items')
            .set({ position })
            .where('id', '=', id)
            .execute();
        }
      }
      for (const [id, date] of result.movedBack) {
        await transaction
          .updateTable('lesson_plan_items')
          .set({ moved_from: date })
          .where('id', '=', id)
          .execute();
      }
      const snapshot = plan.after.map((row, index) => ({
        ...row,
        ownerId: one.owners[index] ?? null,
      }));
      if (!sameRows(plan.before, snapshot)) {
        await transaction
          .deleteFrom('lesson_plan_rows')
          .where('plan_id', '=', plan.planId)
          .where('journal_id', '=', plan.journal.id)
          .execute();
        if (snapshot.length > 0) {
          await transaction
            .insertInto('lesson_plan_rows')
            .values(
              snapshot.map((row, index) => ({
                branch_id: branchId,
                plan_id: plan.planId,
                journal_id: plan.journal.id,
                position: index + 1,
                lesson_id: row.lessonId,
                lesson_date: row.date,
                starts_at: row.startsAt,
                owner_staff_id: row.ownerId,
              })),
            )
            .execute();
        }
      }
      if (plan.before === null) {
        await transaction
          .updateTable('lesson_plan_journals')
          .set({ laid_at: now })
          .where('plan_id', '=', plan.planId)
          .where('journal_id', '=', plan.journal.id)
          .execute();
      }
      await transaction
        .deleteFrom('lesson_plan_absorbed')
        .where('plan_id', '=', plan.planId)
        .where('journal_id', '=', plan.journal.id)
        .execute();
      if (result.absorbed.length > 0) {
        await transaction
          .insertInto('lesson_plan_absorbed')
          .values(
            result.absorbed.map((record) => ({
              branch_id: branchId,
              plan_id: plan.planId,
              journal_id: plan.journal.id,
              removed_lesson_id: record.removedLessonId,
              absorbing_lesson_id: record.absorbingLessonId,
            })),
          )
          .execute();
      }
      if (result.moves.length > 0) {
        await this.audit.record(transaction, {
          branchId,
          actorId: actor.actorId,
          ...(actor.assignmentId === null ? {} : { assignmentId: actor.assignmentId }),
          action: 'plan.items_followed',
          record: { type: 'lesson_plan', id: plan.planId },
          details: {
            journalId: plan.journal.id,
            quarterId: plan.quarter.id,
            moves: result.moves.map((move) => ({ ...move })),
            movedBack: Object.fromEntries(result.movedBack),
          } satisfies JsonValue,
        });
      }
      let requested = false;
      if (plan.open && one.causes.length > 0) {
        await this.prepare(transaction, branchId, plan, one.causes, now, actor);
        requested = true;
      }
      if (!plan.open || (result.moves.length === 0 && !requested)) continue;
      // Decision 8 as changed on #213; review correction 1: an `owner_changed`
      // request is told to the new owner, every other one to the owner on the
      // quarter's reference date.
      const takers = one.causes.flatMap((cause) =>
        cause.kind === 'owner_changed' && cause.staffId !== null ? [cause.staffId] : [],
      );
      const referenceOwner = await this.referenceOwner(transaction, branchId, plan);
      const people = new Set([...takers, ...(referenceOwner === null ? [] : [referenceOwner])]);
      for (const person of people) {
        const entry = told.get(person) ?? { units: new Set<string>(), plans: 0, requests: 0 };
        entry.units.add(plan.journal.unitName);
        entry.plans += 1;
        if (requested) entry.requests += 1;
        told.set(person, entry);
      }
      const key = plan.journal.subjectId;
      const count = counts.get(key) ?? { plans: 0, requests: 0 };
      count.plans += 1;
      if (requested) count.requests += 1;
      counts.set(key, count);
    }
    await this.tell(transaction, branchId, told, counts, now);
  }

  /** The owner on the quarter's reference date (7.1a, decision 6). */
  private async referenceOwner(
    transaction: Transaction,
    branchId: string,
    plan: FollowedPlan,
  ): Promise<string | null> {
    const { today } = await this.clockOf(transaction, branchId);
    const facts = await this.factsOf(transaction, branchId, [plan.journal]);
    const owner = ownerOn(
      facts.runs.get(plan.journal.id) ?? [],
      facts.periods.get(plan.journal.id) ?? [],
      facts.out,
      referenceDateOf(plan.quarter, today),
    );
    return owner === null || owner.kind === 'none' ? null : owner.staffId;
  }

  /**
   * The actor of the change that caused the follow (decision 6): the first
   * audit entry of this transaction in the branch by id; none (a job) gives
   * the system.
   */
  private async actorOf(
    transaction: Transaction,
    branchId: string,
  ): Promise<{ actorId: string | null; assignmentId: string | null }> {
    const found = await sql<{ actor_id: string | null; assignment_id: string | null }>`
      select actor_id, assignment_id from audit_log
      where branch_id = ${branchId} and written_xact = pg_current_xact_id()
      order by id limit 1
    `.execute(transaction);
    const row = found.rows[0];
    return { actorId: row?.actor_id ?? null, assignmentId: row?.assignment_id ?? null };
  }

  /** Prepares the plan's edit request or adds the causes to it (`edge`: "a later event adds to it"). */
  private async prepare(
    transaction: Transaction,
    branchId: string,
    plan: FollowedPlan,
    causes: readonly Cause[],
    now: Date,
    actor: { actorId: string | null; assignmentId: string | null },
  ): Promise<void> {
    const fromDate = causes.reduce(
      (min, cause) => (cause.onDate < min ? cause.onDate : min),
      causes[0]?.onDate ?? plan.quarter.startDate,
    );
    await transaction
      .selectFrom('lesson_plan_requests')
      .select('id')
      .where('plan_id', '=', plan.planId)
      .where('journal_id', '=', plan.journal.id)
      .where('status', '=', 'prepared')
      .forUpdate()
      .execute();
    const existing = await transaction
      .selectFrom('lesson_plan_requests')
      .select(['id', sql<string>`from_date::text`.as('from_date')])
      .where('plan_id', '=', plan.planId)
      .where('journal_id', '=', plan.journal.id)
      .where('status', '=', 'prepared')
      .executeTakeFirst();
    let requestId: string;
    let oldValue: JsonValue = null;
    if (existing === undefined) {
      const created = await transaction
        .insertInto('lesson_plan_requests')
        .values({
          branch_id: branchId,
          plan_id: plan.planId,
          journal_id: plan.journal.id,
          quarter_id: plan.quarter.id,
          kind: 'replan',
          status: 'prepared',
          from_date: fromDate,
          prepared_at: now,
          updated_at: now,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      requestId = created.id;
    } else {
      requestId = existing.id;
      oldValue = { fromDate: existing.from_date };
      await transaction
        .updateTable('lesson_plan_requests')
        .set({
          from_date: existing.from_date < fromDate ? existing.from_date : fromDate,
          updated_at: now,
        })
        .where('id', '=', existing.id)
        .execute();
    }
    await transaction
      .insertInto('lesson_plan_request_causes')
      .values(
        causes.map((cause) => ({
          branch_id: branchId,
          request_id: requestId,
          kind: cause.kind,
          on_date: cause.onDate,
          items: cause.items,
          staff_id: cause.staffId,
          at: now,
        })),
      )
      .execute();
    await this.audit.record(transaction, {
      branchId,
      actorId: actor.actorId,
      ...(actor.assignmentId === null ? {} : { assignmentId: actor.assignmentId }),
      action: 'plan.request_prepared',
      record: { type: 'lesson_plan', id: plan.planId },
      oldValue,
      newValue: {
        requestId,
        journalId: plan.journal.id,
        quarterId: plan.quarter.id,
        fromDate,
        causes: causes.map((cause) => ({ ...cause })),
      },
    });
  }

  /** One notice per owner listing their plans, one per Head Teacher of the subject with counts. */
  private async tell(
    transaction: Transaction,
    branchId: string,
    told: ReadonlyMap<string, { units: Set<string>; plans: number; requests: number }>,
    counts: ReadonlyMap<string, { plans: number; requests: number }>,
    now: Date,
  ): Promise<void> {
    if (told.size > 0) {
      const accounts = await transaction
        .selectFrom('staff')
        .select(['id', 'account_id'])
        .where('id', 'in', [...told.keys()])
        .where('account_id', 'is not', null)
        .orderBy('id')
        .execute();
      for (const staff of accounts) {
        const entry = told.get(staff.id);
        if (entry === undefined || staff.account_id === null) continue;
        await this.notifications.send(transaction, {
          kind: 'plans.followed',
          branchId,
          accountIds: [staff.account_id],
          data: {
            units: [...entry.units].sort((a, b) => a.localeCompare(b, 'en')).slice(0, 200),
            plans: entry.plans,
            requests: entry.requests,
          },
        });
      }
    }
    if (counts.size === 0) return;
    // The Head Teachers holding a subject in the branch now (`assignments` has
    // no row policy: the branch is chosen here, `database.md`).
    const heads = await transaction
      .selectFrom('assignments')
      .innerJoin('assignment_subjects', 'assignment_subjects.assignment_id', 'assignments.id')
      .select(['assignments.account_id', 'assignment_subjects.subject_id'])
      .where('assignments.role', '=', 'head_teacher')
      .where('assignments.branch_id', '=', branchId)
      .where('assignments.valid_from', '<=', now)
      .where((builder) =>
        builder.or([
          builder('assignments.valid_until', 'is', null),
          builder('assignments.valid_until', '>', now),
        ]),
      )
      .where('assignment_subjects.valid_from', '<=', now)
      .where((builder) =>
        builder.or([
          builder('assignment_subjects.valid_until', 'is', null),
          builder('assignment_subjects.valid_until', '>', now),
        ]),
      )
      .where('assignment_subjects.subject_id', 'in', [...counts.keys()])
      .orderBy('assignments.account_id')
      .execute();
    const byHead = new Map<string, { plans: number; requests: number }>();
    for (const head of heads) {
      const count = counts.get(head.subject_id);
      if (count === undefined) continue;
      const sum = byHead.get(head.account_id) ?? { plans: 0, requests: 0 };
      sum.plans += count.plans;
      sum.requests += count.requests;
      byHead.set(head.account_id, sum);
    }
    for (const [accountId, sum] of byHead) {
      await this.notifications.send(transaction, {
        kind: 'plans.followed_counts',
        branchId,
        accountIds: [accountId],
        data: sum,
      });
    }
  }
}

/**
 * The causes of a request (decision 4): items sent to "not covered", empty
 * rows added at the end, an item moved back from a started lesson, a future
 * row given a new owner who is a person.
 */
function causesOf(
  plan: FollowedPlan,
  result: FollowResult,
  owners: readonly (string | null)[],
  now: Date,
): Cause[] {
  const { after } = plan;
  const firstOpen = after.find((row) => row.startsAt.getTime() > now.getTime());
  const causes: Cause[] = [];
  if (result.newlyNotCovered.length > 0) {
    const firstMoved = result.moves
      .map((move) => move.from)
      .filter((date): date is string => date !== null)
      .sort()[0];
    causes.push({
      kind: 'not_covered',
      onDate: firstMoved ?? firstOpen?.date ?? plan.quarter.endDate,
      items: result.newlyNotCovered.length,
      staffId: null,
    });
  }
  if (result.rowsAddedAtEnd) {
    const filled = Math.max(0, ...result.positions.values());
    causes.push({
      kind: 'rows_added',
      onDate: after[Math.min(filled, after.length - 1)]?.date ?? plan.quarter.endDate,
      items: 0,
      staffId: null,
    });
  }
  if (result.movedBack.size > 0) {
    causes.push({
      kind: 'moved_back',
      onDate: firstOpen?.date ?? plan.quarter.endDate,
      items: result.movedBack.size,
      staffId: null,
    });
  }
  if (plan.before !== null) {
    const ownerBefore = new Map(plan.before.map((row) => [row.lessonId, row.ownerId]));
    for (const [index, row] of after.entries()) {
      if (row.startsAt.getTime() <= now.getTime()) continue;
      if (!ownerBefore.has(row.lessonId)) continue;
      const owner = owners[index] ?? null;
      if (owner !== null && owner !== ownerBefore.get(row.lessonId)) {
        causes.push({ kind: 'owner_changed', onDate: row.date, items: 0, staffId: owner });
        break;
      }
    }
  }
  return causes;
}

/** What a preview shows of one plan. */
function impactOf(one: Followed, now: Date): PlanImpact {
  const { plan, result } = one;
  const notFitting = new Set(result.newlyNotCovered);
  const filled = new Set(
    [...result.positions.values()].filter((position) => position <= plan.after.length),
  );
  return {
    journalId: plan.journal.id,
    unit: plan.journal.unitName,
    subject: {
      id: plan.journal.subjectId,
      names: plan.journal.subject.names,
      colour: subjectColourSchema.parse(plan.journal.subject.colour),
    },
    quarter: plan.quarter.number,
    moved: result.moves.length,
    notFitting: plan.items.filter((item) => notFitting.has(item.id)).map((item) => item.topic),
    emptyRows: plan.after.filter(
      (row, index) => row.startsAt.getTime() > now.getTime() && !filled.has(index + 1),
    ).length,
  };
}
