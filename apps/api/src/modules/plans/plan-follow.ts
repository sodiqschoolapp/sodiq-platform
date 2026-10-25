import { randomUUID } from 'node:crypto';
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
import {
  lockJournals,
  movePlaces,
  planRows,
  referenceDateOf,
  type PlanQuarter,
} from './plan-read.js';
import { storedWindowOf } from './plan-gate.js';
import { clearUntouchedCopy } from './plan-copy-clear.js';
import { separateJournal, unitKeysOf } from './plan-separate.js';
import { windowStateOf } from './plan-window.js';
import { separations, type SharingJournal } from './plan-share.js';
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

/**
 * Rows a check computes without writing them (the publish check, task 7.1b):
 * the plans of a year laid on `rows`, given the rows stored now.
 */
export interface LaidRows {
  readonly branchId: string;
  readonly yearId: string;
  readonly rows: (
    journal: JournalRow,
    quarter: PlanQuarter,
    stored: readonly QueueRow[],
  ) => readonly QueueRow[];
}

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

/** What a prepared request names of its plan. */
export interface PreparedPlan {
  readonly planId: string;
  readonly journal: { readonly id: string };
  readonly quarter: { readonly id: string; readonly startDate: string };
}

export interface Cause {
  readonly kind: PlanRequestCause;
  readonly onDate: string;
  readonly items: number;
  readonly staffId: string | null;
}

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
    // Task 7.2: one event per transaction (`09`, Approving together).
    const eventId = randomUUID();
    for (const [branchId, journalIds] of marks) {
      // Task 7.1c: a journal of a shared plan that lost its teacher, language
      // or grade leaves the plan first, then follows on its own.
      const separated = await this.separateShared(transaction, branchId, journalIds);
      // Task 8.8 (decision 5): a lesson cancelled loses its marks before its item moves.
      await this.withdrawCancelledMarks(transaction, branchId, journalIds);
      const followed = await this.followBranch(
        transaction,
        branchId,
        [...new Set([...journalIds, ...separated])].sort(),
      );
      await this.write(transaction, branchId, followed, eventId);
    }
  }

  /**
   * Task 8.8 (decision 5, correction 3; `edge/lesson-plans`, "On Thursday it
   * is recorded that Monday's lesson did not happen"): a lesson cancelled with
   * "topic not delivered" or homeworks "not given" loses them, each with its
   * history line `withdrawn`; the copy in "not covered" is cleared while it is
   * untouched, an edited copy stays as plan content. The item itself then
   * moves as after any cancellation. One audit entry per lesson.
   */
  private async withdrawCancelledMarks(
    transaction: Transaction,
    branchId: string,
    journalIds: readonly string[],
  ): Promise<void> {
    if (journalIds.length === 0) return;
    const deliveries = await transaction
      .selectFrom('journal_lesson_deliveries')
      .innerJoin('lessons', 'lessons.id', 'journal_lesson_deliveries.lesson_id')
      .select([
        'journal_lesson_deliveries.id',
        'journal_lesson_deliveries.lesson_id',
        'journal_lesson_deliveries.journal_id',
        'journal_lesson_deliveries.copy_item_id',
        'journal_lesson_deliveries.version',
        'journal_lesson_deliveries.changed_by',
      ])
      .where('journal_lesson_deliveries.journal_id', 'in', [...journalIds])
      .where('journal_lesson_deliveries.not_delivered', '=', true)
      .where('lessons.cancel_cause', 'is not', null)
      .orderBy('journal_lesson_deliveries.id')
      .forUpdate('journal_lesson_deliveries')
      .execute();
    const notGiven = await transaction
      .selectFrom('journal_homework_not_given')
      .innerJoin('lessons', 'lessons.id', 'journal_homework_not_given.lesson_id')
      .select([
        'journal_homework_not_given.id',
        'journal_homework_not_given.lesson_id',
        'journal_homework_not_given.plan_work_id',
        'journal_homework_not_given.changed_by',
      ])
      .where('journal_homework_not_given.journal_id', 'in', [...journalIds])
      .where('journal_homework_not_given.undone_at', 'is', null)
      .where('lessons.cancel_cause', 'is not', null)
      .orderBy('journal_homework_not_given.id')
      .forUpdate('journal_homework_not_given')
      .execute();
    if (deliveries.length === 0 && notGiven.length === 0) return;
    const now = await transactionMoment(transaction);
    const actor = await this.actorOf(transaction, branchId);
    const entries = new Map<string, { copy: JsonValue; homeworks: string[]; journalId: string }>();
    for (const one of deliveries) {
      let copy: JsonValue = null;
      if (one.copy_item_id !== null) {
        const rows = await this.rowsOfCopy(transaction, branchId, one.journal_id, one.copy_item_id);
        const cleared = await clearUntouchedCopy(transaction, rows, one.copy_item_id);
        copy = cleared === 'used' ? 'kept' : cleared;
      }
      await transaction
        .updateTable('journal_lesson_deliveries')
        .set({
          not_delivered: false,
          copy_item_id: null,
          version: one.version + 1,
          changed_by: actor.actorId ?? one.changed_by,
          changed_how: 'withdrawn',
        })
        .where('id', '=', one.id)
        .execute();
      entries.set(one.lesson_id, { copy, homeworks: [], journalId: one.journal_id });
    }
    for (const one of notGiven) {
      await transaction
        .updateTable('journal_homework_not_given')
        .set({
          undone_at: now,
          changed_by: actor.actorId ?? one.changed_by,
          changed_how: 'withdrawn',
        })
        .where('id', '=', one.id)
        .execute();
      const entry = entries.get(one.lesson_id) ?? { copy: null, homeworks: [], journalId: '' };
      entry.homeworks.push(one.plan_work_id);
      entries.set(one.lesson_id, entry);
    }
    for (const [lessonId, entry] of entries) {
      await this.audit.record(transaction, {
        branchId,
        actorId: actor.actorId,
        ...(actor.assignmentId === null ? {} : { assignmentId: actor.assignmentId }),
        action: 'journal.topic_not_delivered',
        record: { type: 'lesson', id: lessonId },
        oldValue: { notDelivered: deliveries.some((one) => one.lesson_id === lessonId) },
        newValue: {
          notDelivered: false,
          withdrawn: true,
          copy: entry.copy,
          homeworksGivenAgain: entry.homeworks,
        },
      });
    }
  }

  /** Task 8.8: the number of rows of a copy's journal in its plan's quarter (`planRows`). */
  private async rowsOfCopy(
    transaction: Transaction,
    branchId: string,
    journalId: string,
    copyId: string,
  ): Promise<number> {
    const link = await transaction
      .selectFrom('lesson_plan_items')
      .innerJoin(
        'lesson_plan_journals',
        'lesson_plan_journals.plan_id',
        'lesson_plan_items.plan_id',
      )
      .innerJoin('quarters', 'quarters.id', 'lesson_plan_journals.quarter_id')
      .select([
        'quarters.id',
        'quarters.number',
        sql<string | null>`quarters.start_date::text`.as('start_date'),
        sql<string | null>`quarters.end_date::text`.as('end_date'),
      ])
      .where('lesson_plan_items.id', '=', copyId)
      .where('lesson_plan_journals.journal_id', '=', journalId)
      .executeTakeFirst();
    const [journal] = await journalRows(transaction, branchId, { journalId });
    if (
      link === undefined ||
      journal === undefined ||
      link.start_date === null ||
      link.end_date === null
    ) {
      return 0;
    }
    const { timeZone, now } = await this.clockOf(transaction, branchId);
    return (
      await planRows(
        transaction,
        branchId,
        journal,
        { id: link.id, number: link.number, startDate: link.start_date, endDate: link.end_date },
        timeZone,
        now,
      )
    ).length;
  }

  /**
   * Task 7.1c, decisions 6 and 17: locks every journal of the shared plans
   * of the marked journals (in the order of the id, the links read again
   * until none is missing), then separates each journal whose owners of the
   * rows not started, or whose kind, grades or language, part it from the
   * plan (`separations`). Gives the journals separated.
   */
  private async separateShared(
    transaction: Transaction,
    branchId: string,
    journalIds: readonly string[],
  ): Promise<string[]> {
    const linksOf = async () => {
      const own = await transaction
        .selectFrom('lesson_plan_journals')
        .select('plan_id')
        .where('journal_id', 'in', [...journalIds])
        .execute();
      const planIds = [...new Set(own.map((row) => row.plan_id))];
      if (planIds.length === 0) return [];
      return transaction
        .selectFrom('lesson_plan_journals')
        .select(['plan_id', 'journal_id'])
        .where('plan_id', 'in', planIds)
        .orderBy('plan_id')
        .orderBy('journal_id')
        .execute();
    };
    const locked = new Set<string>();
    let links = await linksOf();
    for (;;) {
      // The marked journals with the first batch, in one statement in the
      // order of the id, as 7.1b locks them (code review, should-fix 7).
      const missing = [...new Set([...journalIds, ...links.map((row) => row.journal_id)])]
        .filter((id) => !locked.has(id))
        .sort();
      if (missing.length === 0) break;
      await lockJournals(transaction, missing);
      for (const id of missing) locked.add(id);
      links = await linksOf();
    }
    const byPlan = new Map<string, string[]>();
    for (const row of links)
      byPlan.set(row.plan_id, [...(byPlan.get(row.plan_id) ?? []), row.journal_id]);
    const shared = [...byPlan].filter(([, members]) => members.length > 1);
    if (shared.length === 0) return [];
    const { timeZone, now } = await this.clockOf(transaction, branchId);
    const actor = await this.actorOf(transaction, branchId);
    const separatedIds: string[] = [];
    for (const [planId, members] of shared) {
      const quarter = await transaction
        .selectFrom('lesson_plans')
        .innerJoin('quarters', 'quarters.id', 'lesson_plans.quarter_id')
        .select([
          'lesson_plans.shared_unit',
          'quarters.id',
          'quarters.number',
          sql<string | null>`quarters.start_date::text`.as('start_date'),
          sql<string | null>`quarters.end_date::text`.as('end_date'),
        ])
        .where('lesson_plans.id', '=', planId)
        .executeTakeFirstOrThrow();
      if (quarter.start_date === null || quarter.end_date === null) continue;
      const planQuarter: PlanQuarter = {
        id: quarter.id,
        number: quarter.number,
        startDate: quarter.start_date,
        endDate: quarter.end_date,
      };
      const journals: JournalRow[] = [];
      for (const journalId of members) {
        const [journal] = await journalRows(transaction, branchId, { journalId });
        if (journal !== undefined) journals.push(journal);
      }
      const keys = await unitKeysOf(transaction, journals);
      const facts = await this.factsOf(transaction, branchId, journals);
      const ordered = [...journals].sort(
        (a, b) =>
          Number(a.classId === null) - Number(b.classId === null) ||
          (a.grades[0] ?? 0) - (b.grades[0] ?? 0) ||
          a.unitName.localeCompare(b.unitName, 'en') ||
          a.id.localeCompare(b.id),
      );
      const sharing: SharingJournal[] = [];
      for (const [index, journal] of ordered.entries()) {
        const rows = await planRows(transaction, branchId, journal, planQuarter, timeZone, now);
        sharing.push({
          journalId: journal.id,
          order: index,
          unit: keys.get(journal.id) ?? '',
          owners: rows
            .filter((row) => !row.started)
            .map((row) => {
              const owner = ownerOn(
                facts.runs.get(journal.id) ?? [],
                facts.periods.get(journal.id) ?? [],
                facts.out,
                row.date,
              );
              return owner === null || owner.kind === 'none' ? null : owner.staffId;
            }),
        });
      }
      // The earlier owner: the snapshot's owner of the first row not started,
      // read in the order of the units.
      const snapshot = await transaction
        .selectFrom('lesson_plan_rows')
        .select(['journal_id', 'owner_staff_id'])
        .where('plan_id', '=', planId)
        .where('starts_at', '>', now)
        .orderBy('journal_id')
        .orderBy('position')
        .execute();
      let earlier: string | null | undefined;
      for (const journal of ordered) {
        const first = snapshot.find((row) => row.journal_id === journal.id);
        if (first !== undefined) {
          earlier = first.owner_staff_id;
          break;
        }
      }
      const leavers = separations(sharing, earlier, quarter.shared_unit);
      // Every journal changed together: the plan is shared under the new unit.
      const kept = sharing.find((one) => !leavers.some((out) => out.journalId === one.journalId));
      if (kept !== undefined && kept.unit !== quarter.shared_unit) {
        await transaction
          .updateTable('lesson_plans')
          .set({ shared_unit: kept.unit })
          .where('id', '=', planId)
          .execute();
      }
      for (const leaving of leavers) {
        const separated = await separateJournal(
          transaction,
          branchId,
          planId,
          leaving.journalId,
          actor.actorId,
        );
        await this.audit.record(transaction, {
          branchId,
          actorId: actor.actorId,
          ...(actor.assignmentId === null ? {} : { assignmentId: actor.assignmentId }),
          action: 'plan.separated',
          record: { type: 'lesson_plan', id: planId },
          newValue: {
            journalId: leaving.journalId,
            quarterId: planQuarter.id,
            planId: separated.planId,
            items: separated.items,
            cause: leaving.cause,
          },
        });
        separatedIds.push(leaving.journalId);
      }
    }
    return separatedIds;
  }

  /**
   * The follow of the plans this transaction touched, without a write: per
   * plan the reader may read, what moved, the items that no longer fit and
   * the rows left empty (`edge/lesson-plans`: "The impact preview shows, per
   * plan, items that no longer fit and rows left empty").
   */
  async preview(transaction: Transaction, access: Access, laid?: LaidRows): Promise<PlanImpact[]> {
    const marks =
      laid === undefined
        ? await this.marksOf(transaction)
        : new Map([[laid.branchId, await this.plannedJournals(transaction, laid)]]);
    const impacts: PlanImpact[] = [];
    const reader = await planReaderOf(transaction, access);
    for (const [branchId, journalIds] of marks) {
      if (journalIds.length === 0) continue;
      const followed = await this.followBranch(transaction, branchId, journalIds, laid?.rows);
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

  /** The journals with a plan of a year of the branch. */
  private async plannedJournals(transaction: Transaction, laid: LaidRows): Promise<string[]> {
    const rows = await transaction
      .selectFrom('lesson_plan_journals')
      .innerJoin('journals', 'journals.id', 'lesson_plan_journals.journal_id')
      .select('journals.id')
      .distinct()
      .where('journals.branch_id', '=', laid.branchId)
      .where('journals.academic_year_id', '=', laid.yearId)
      .orderBy('journals.id')
      .execute();
    return rows.map((row) => row.id);
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
    rewrite?: LaidRows['rows'],
  ): Promise<Followed[]> {
    await transaction
      .selectFrom('journals')
      .select('id')
      .where('id', 'in', [...journalIds])
      .orderBy('id')
      .forNoKeyUpdate()
      .execute();
    const { today, now, timeZone } = await this.clockOf(transaction, branchId);
    const plans = await transaction
      .selectFrom('lesson_plan_journals')
      .innerJoin('quarters', 'quarters.id', 'lesson_plan_journals.quarter_id')
      .select([
        'lesson_plan_journals.plan_id',
        'lesson_plan_journals.journal_id',
        'quarters.id as quarter_id',
        'quarters.number',
        'lesson_plan_journals.laid_at',
        // Task 7.2: the link was made by this transaction (its journal is new;
        // `database.md`: the bookkeeping column compared with `now()`).
        sql<boolean>`lesson_plan_journals.created_at = now()`.as('made_now'),
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
            // Task 7.1c: the places of each journal (a cleared item has none).
            transaction
              .selectFrom('lesson_plan_places')
              .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_places.item_id')
              .select([
                'lesson_plan_items.id',
                'lesson_plan_places.plan_id',
                'lesson_plan_places.journal_id',
                'lesson_plan_places.position',
                'lesson_plan_items.topic',
              ])
              .where('lesson_plan_places.plan_id', 'in', planIds)
              .orderBy('lesson_plan_places.position')
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
      const stored = (lessons.get(unitKey(journal)) ?? []).filter(
        (row) => quarter.startDate <= row.date && row.date <= quarter.endDate,
      );
      const after =
        rewrite === undefined
          ? stored
          : rewrite(journal, quarter, stored).filter(
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
        items: items.filter(
          (item) => item.plan_id === plan.plan_id && item.journal_id === plan.journal_id,
        ),
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
      const causes = causesOf(followedPlan, result, owners, now);
      // Task 7.2: a plan laid for the first time after its quarter's window
      // ended for its owner (`edge`: "a subject is added mid-quarter"; "The
      // system prepares a request covering the lessons not yet held").
      // Spec review of the code, should-fix 7: only a journal made in this
      // transaction, never a plan record laid late for the first time.
      if (before === null && rewrite === undefined && plan.made_now) {
        const first = after.findIndex((row) => row.startsAt.getTime() > now.getTime());
        const owner = owners[first] ?? null;
        const row = after[first];
        if (row !== undefined && owner !== null) {
          const window = await storedWindowOf(transaction, quarter, owner, timeZone);
          if (windowStateOf(window, now).state === 'ended') {
            causes.push({ kind: 'journal_added', onDate: row.date, items: 0, staffId: owner });
          }
        }
      }
      followed.push({ plan: followedPlan, result, owners, causes });
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
    eventId: string,
  ): Promise<void> {
    if (followed.length === 0) return;
    const now = await transactionMoment(transaction);
    const actor = await this.actorOf(transaction, branchId);
    // Decision 8 as changed on #213: a plan whose items moved, or that got a request.
    const told = new Map<string, { requested: Set<string>; moved: Set<string> }>();
    const counts = new Map<string, { plans: number; requests: number }>();
    for (const one of followed) {
      const { plan, result } = one;
      const changed = [...result.positions].filter(
        ([id, position]) => plan.items.find((item) => item.id === id)?.position !== position,
      );
      await movePlaces(transaction, plan.planId, plan.journal.id, new Map(changed));
      for (const [id, date] of result.movedBack) {
        await transaction
          .updateTable('lesson_plan_places')
          .set({ moved_from: date })
          .where('plan_id', '=', plan.planId)
          .where('journal_id', '=', plan.journal.id)
          .where('item_id', '=', id)
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
      // Task 7.2, review correction 4 (`edge/people-roles-accounts`: "On the
      // date, their own requests are cancelled"): a new owner of the rows not
      // started voids the earlier owner's sent requests and ends their periods.
      if (one.causes.some((cause) => cause.kind === 'owner_changed')) {
        await this.endEarlierOwners(transaction, branchId, plan, now, actor);
      }
      let requested = false;
      if (plan.open && one.causes.length > 0) {
        await this.prepare(transaction, branchId, plan, one.causes, now, actor, eventId);
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
        const entry = told.get(person) ?? {
          requested: new Set<string>(),
          moved: new Set<string>(),
        };
        (requested ? entry.requested : entry.moved).add(plan.journal.unitName);
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

  /**
   * Task 7.2 (review correction 4): the sent requests of the plan's journal
   * become void and the open periods end, at the transaction's moment.
   */
  private async endEarlierOwners(
    transaction: Transaction,
    branchId: string,
    plan: FollowedPlan,
    now: Date,
    actor: { actorId: string | null; assignmentId: string | null },
  ): Promise<void> {
    const requests = await transaction
      .selectFrom('lesson_plan_requests')
      .select(['id', 'status', 'open_until', 'finished_at'])
      .where('plan_id', '=', plan.planId)
      .where('journal_id', '=', plan.journal.id)
      .where('status', 'in', ['sent', 'approved'])
      .orderBy('id')
      .forUpdate()
      .execute();
    const voided: string[] = [];
    const ended: string[] = [];
    for (const request of requests) {
      if (request.status === 'sent') {
        await transaction
          .updateTable('lesson_plan_requests')
          .set({ status: 'void', updated_at: now })
          .where('id', '=', request.id)
          .execute();
        voided.push(request.id);
      } else if (
        request.finished_at === null &&
        request.open_until !== null &&
        request.open_until.getTime() >= now.getTime()
      ) {
        await transaction
          .updateTable('lesson_plan_requests')
          .set({ finished_at: now, updated_at: now })
          .where('id', '=', request.id)
          .execute();
        ended.push(request.id);
      }
    }
    if (voided.length === 0 && ended.length === 0) return;
    await this.audit.record(transaction, {
      branchId,
      actorId: actor.actorId,
      ...(actor.assignmentId === null ? {} : { assignmentId: actor.assignmentId }),
      action: 'plan.request_void',
      record: { type: 'lesson_plan', id: plan.planId },
      newValue: { journalId: plan.journal.id, voided, ended, cause: 'owner_changed' },
    });
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

  /**
   * Task 8.8 (decision 9): prepares the edit request of one plan's journal for an event outside
   * the follow ("topic not delivered": "A copy of the item goes to 'not covered', a request is
   * prepared"), as the follow prepares its own, with an event of its own.
   */
  async prepareFor(
    transaction: Transaction,
    input: {
      readonly branchId: string;
      readonly plan: PreparedPlan;
      readonly causes: readonly Cause[];
      readonly actor: { actorId: string | null; assignmentId: string | null };
    },
  ): Promise<void> {
    await this.prepare(
      transaction,
      input.branchId,
      input.plan,
      input.causes,
      await transactionMoment(transaction),
      input.actor,
      randomUUID(),
    );
  }

  /** Prepares the plan's edit request or adds the causes to it (`edge`: "a later event adds to it"). */
  private async prepare(
    transaction: Transaction,
    branchId: string,
    plan: PreparedPlan,
    causes: readonly Cause[],
    now: Date,
    actor: { actorId: string | null; assignmentId: string | null },
    eventId: string,
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
    let storedFrom = fromDate;
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
          from_date: (storedFrom = existing.from_date < fromDate ? existing.from_date : fromDate),
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
          event_id: eventId,
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
        fromDate: storedFrom,
        causes: causes.map((cause) => ({ ...cause })),
      },
    });
  }

  /** One notice per owner listing their plans, one per Head Teacher of the subject with counts. */
  private async tell(
    transaction: Transaction,
    branchId: string,
    told: ReadonlyMap<string, { requested: Set<string>; moved: Set<string> }>,
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
          // Review correction 2: each plan marked "request prepared" or "moved only".
          data: { requested: unitList(entry.requested), moved: unitList(entry.moved) },
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
  const before = plan.before;
  if (before !== null && before.length > 0) {
    // By date, not by lesson: a writer that removes and creates the lessons
    // again (a publish at another time of the day) keeps no id (code review of
    // #213, must-fix 2). The owner a date had is the snapshot's on its latest
    // row on or before that date, else on its first row.
    const ownerBeforeOn = (date: string): string | null => {
      let found = before[0]?.ownerId ?? null;
      for (const row of before) {
        if (row.date > date) break;
        found = row.ownerId;
      }
      return found;
    };
    for (const [index, row] of after.entries()) {
      if (row.startsAt.getTime() <= now.getTime()) continue;
      const owner = owners[index] ?? null;
      if (owner !== null && owner !== ownerBeforeOn(row.date)) {
        causes.push({ kind: 'owner_changed', onDate: row.date, items: 0, staffId: owner });
        break;
      }
    }
  }
  return causes;
}

/** The classes and groups of a notice, joined, or a dash for none (the text names both lists). */
function unitList(units: ReadonlySet<string>): string {
  return units.size === 0
    ? '—'
    : [...units]
        .sort((a, b) => a.localeCompare(b, 'en'))
        .join(', ')
        .slice(0, 4000);
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
