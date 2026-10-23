import { Injectable } from '@nestjs/common';
import {
  planItemSchema,
  planLessonItemSchema,
  planListSchema,
  planSchema,
  schoolDateOf,
  type ErrorDetail,
  type Plan,
  type PlanItem,
  type PlanItemCreate,
  type PlanItemSave,
  type PlanLessonItem,
  type PlanList,
  type PlanQueue,
  type PlanListQuery,
  type PlanQuery,
  type PlanFlag,
  type PlanState,
  type PlanWindowState,
  type PlanWork,
  type PlanWorkInput,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { journalRows, staffNames, type JournalRow } from '../journal/journal-grid.query.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { substitutionsInForce } from '../timetable/substitutions-read.js';
import {
  clockOf,
  datedQuarters,
  lockJournals,
  movePlaces,
  planIdOf,
  planItems,
  planJournalIds,
  planRows,
  preparedRequestOf,
  quarterOfToday,
  referenceDateOf,
  worksOf,
  type PlanQuarter,
  type PlanRowLesson,
} from './plan-read.js';
import {
  ownerIdOn,
  vacancyOn,
  planReachOf,
  planReaderOf,
  seesRequests,
  type PlanReach,
  type PlanReader,
} from './plan-scope.js';
import {
  gateDetail,
  openPeriodsOf,
  ownerPeriodsOf,
  passGate,
  storedWindowOf,
  type GatePass,
  type GateTarget,
} from './plan-gate.js';
import { planRequestsOf } from './plan-request-read.js';
import { unitKeysOf } from './plan-separate.js';
import {
  periodCovers,
  planFlagOf,
  windowStateOf,
  type GateOp,
  type GateRow,
} from './plan-window.js';
import { placeNew } from './plan-share.js';

/**
 * Lesson plans and their items (task 7.1a, pull request #212; `09`, What a
 * plan contains; `edge/lesson-plans`). One plan per journal and quarter,
 * made on its first write (decision 5 of the plan as left out: 7.2 makes one
 * for every journal); its rows are the quarter's lessons not cancelled and
 * item p fills row p (`plan-read.ts`). Only the owner writes; every write is
 * refused in a closed year and audited with the old and new values of what
 * it changed, which is the plan's history.
 */

/** The audit field of a write let through by requests (task 7.2). */
export const gateAudit = (pass: GatePass): { details?: JsonValue } => {
  const detail = gateDetail(pass);
  return detail === null ? {} : { details: detail };
};

const scopeRefusal = () => new ApiException('plan_scope', 403);

/**
 * The refusal the database answers for a plan write (`api.md`: with a route
 * test): two saves that each add works can pass 10 together. The row and the
 * attendance-only refusals are decided before the write, under the journal's
 * lock; their triggers and index guard the database.
 */
const PLAN_REFUSALS = { lesson_plan_works_limit: 'plan_works_full' } as const;

const unitOf = (journal: JournalRow) => ({
  kind: journal.classId === null ? ('group' as const) : ('class' as const),
  id: journal.classId ?? journal.groupId ?? '',
  name: journal.unitName,
});

const subjectOf = (journal: JournalRow) => ({
  id: journal.subjectId,
  names: journal.subject.names,
  colour: journal.subject.colour,
});

/** A journal and quarter as a request reads them. */
export interface Scene {
  readonly branchId: string;
  readonly journal: JournalRow;
  readonly closed: boolean;
  /**
   * Task 7.1b, decision 9: the journal has a run day on or after today; a
   * plan whose journal has none (a subject removed from the class) is closed
   * with the journal (`09`).
   */
  readonly open: boolean;
  readonly quarters: readonly PlanQuarter[];
  readonly quarter: PlanQuarter;
  readonly timeZone: string;
  readonly now: Date;
  readonly ownerId: string | null;
  readonly reach: PlanReach;
  /** The reader as the scope reads it (task 7.1c: the other journals of a shared plan). */
  readonly reader: PlanReader;
}

type Kind = 'classwork' | 'homework';

const KINDS: readonly { kind: Kind; list: 'classworks' | 'homeworks' }[] = [
  { kind: 'classwork', list: 'classworks' },
  { kind: 'homework', list: 'homeworks' },
];

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

const sameWork = (a: { title: string; description: string }, b: PlanWorkInput | PlanWork) =>
  a.title === b.title && a.description === b.description;

/** A work as an audit entry keeps it (review correction 4: a removed work's id, kind, position and texts). */
const workEntry = (work: PlanWork, kind: Kind, position: number) => ({
  id: work.id,
  kind,
  position,
  title: work.title,
  description: work.description,
});

@Injectable()
export class PlansService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /** The plans the reader may read in a year, with the state of each quarter. */
  list(access: Access, query: PlanListQuery): Promise<PlanList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { today } = await clockOf(transaction, branchId);
      const years = (
        await transaction
          .selectFrom('academic_years')
          .select([
            'id',
            sql<string>`start_date::text`.as('start_date'),
            sql<string>`end_date::text`.as('end_date'),
            'status',
          ])
          .where('branch_id', '=', branchId)
          .orderBy('start_date', 'desc')
          .execute()
      ).map((row) => ({
        id: row.id,
        startDate: row.start_date,
        endDate: row.end_date,
        closed: row.status === 'closed',
      }));
      let yearId: string | null;
      if (query.yearId !== undefined) {
        if (!years.some((year) => year.id === query.yearId)) throw notFound();
        yearId = query.yearId;
      } else {
        yearId =
          years.find((year) => year.startDate <= today && today <= year.endDate)?.id ??
          years[0]?.id ??
          null;
      }
      if (yearId === null) return planListSchema.parse({ years, yearId, quarters: [], plans: [] });
      const quarters = await datedQuarters(transaction, yearId);
      const journals = (await journalRows(transaction, branchId, { yearId })).filter(
        (journal) => !journal.subject.attendanceOnly,
      );
      const reader = await planReaderOf(transaction, access);
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
      const readable = journals.filter((journal) =>
        (quarters.length === 0 ? [null] : quarters).some((quarter) => {
          const owner =
            quarter === null
              ? null
              : ownerOn(
                  facts.runs.get(journal.id) ?? [],
                  facts.periods.get(journal.id) ?? [],
                  facts.out,
                  referenceDateOf(quarter, today),
                );
          const ownerId = owner === null || owner.kind === 'none' ? null : owner.staffId;
          return planReachOf(reader, journal, ownerId).read;
        }),
      );
      const counts = await this.rowCounts(transaction, readable, quarters);
      const filled = await this.filledCounts(transaction, readable, quarters, counts);
      // Task 7.2: the flag of each plan (overdue, window not opened, vacancy).
      const { now, timeZone } = await clockOf(transaction, branchId);
      const links =
        readable.length === 0
          ? []
          : await transaction
              .selectFrom('lesson_plan_journals')
              .select(['plan_id', 'journal_id', 'quarter_id'])
              .where(
                'journal_id',
                'in',
                readable.map((journal) => journal.id),
              )
              .execute();
      const planOf = new Map(
        links.map((link) => [`${link.journal_id}|${link.quarter_id}`, link.plan_id]),
      );
      const ownerPeriods = await ownerPeriodsOf(
        transaction,
        links.map((link) => link.plan_id),
        now,
      );
      const windowStates = new Map<string, PlanWindowState>();
      const stateOf = async (quarter: PlanQuarter, ownerId: string | null) => {
        const key = `${quarter.id}|${ownerId ?? ''}`;
        const known = windowStates.get(key);
        if (known !== undefined) return known;
        const window = await storedWindowOf(transaction, quarter, ownerId, timeZone);
        const found = windowStateOf(window, now).state;
        windowStates.set(key, found);
        return found;
      };
      const flags = new Map<string, PlanFlag | null>();
      for (const journal of readable) {
        for (const quarter of quarters) {
          const key = `${journal.id}|${quarter.id}`;
          const owner = ownerOn(
            facts.runs.get(journal.id) ?? [],
            facts.periods.get(journal.id) ?? [],
            facts.out,
            referenceDateOf(quarter, today),
          );
          const ownerId = owner === null || owner.kind === 'none' ? null : owner.staffId;
          const rows = counts.get(key) ?? 0;
          flags.set(
            key,
            planFlagOf({
              rows,
              complete: (filled.get(key)?.topics ?? 0) >= rows,
              vacancy: owner?.kind === 'none',
              window: await stateOf(quarter, ownerId),
              ownerPeriod: ownerPeriods.has(`${planOf.get(key) ?? ''}|${journal.id}`),
            }),
          );
        }
      }
      const sorted = [...readable].sort(
        (a, b) =>
          Number(a.classId === null) - Number(b.classId === null) ||
          (a.grades[0] ?? 0) - (b.grades[0] ?? 0) ||
          a.unitName.localeCompare(b.unitName, 'en') ||
          a.subject.names.en.localeCompare(b.subject.names.en, 'en'),
      );
      return planListSchema.parse({
        years,
        yearId,
        quarters,
        plans: sorted.map((journal) => ({
          journalId: journal.id,
          unit: unitOf(journal),
          subject: subjectOf(journal),
          quarters: quarters.map((quarter) => {
            const key = `${journal.id}|${quarter.id}`;
            const rows = counts.get(key) ?? 0;
            const found = filled.get(key);
            const topics = found?.topics ?? 0;
            const state: PlanState =
              rows === 0
                ? 'no_lessons'
                : found === undefined || found.items === 0
                  ? 'not_started'
                  : topics >= rows
                    ? 'complete'
                    : 'incomplete';
            return {
              quarterId: quarter.id,
              state,
              rows,
              empty: Math.max(rows - topics, 0),
              flag: flags.get(key) ?? null,
            };
          }),
        })),
      });
    });
  }

  /** The number of rows (lessons not cancelled) of each journal in each quarter. */
  private async rowCounts(
    transaction: Transaction,
    journals: readonly JournalRow[],
    quarters: readonly PlanQuarter[],
  ): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    const first = quarters[0];
    const last = quarters.at(-1);
    if (journals.length === 0 || first === undefined || last === undefined) return counts;
    const rows = await transaction
      .selectFrom('lessons')
      .select([
        'class_id',
        'group_id',
        'subject_id',
        sql<string>`lesson_date::text`.as('date'),
        sql<number>`count(*)::int`.as('count'),
      ])
      .where('cancel_cause', 'is', null)
      .where('lesson_date', '>=', first.startDate)
      .where('lesson_date', '<=', last.endDate)
      .where(
        'subject_id',
        'in',
        journals.map((journal) => journal.subjectId),
      )
      .groupBy(['class_id', 'group_id', 'subject_id', 'lesson_date'])
      .execute();
    const byUnit = new Map(
      journals.map((journal) => [
        `${journal.classId ?? ''}|${journal.groupId ?? ''}|${journal.subjectId}`,
        journal.id,
      ]),
    );
    for (const row of rows) {
      const journalId = byUnit.get(`${row.class_id ?? ''}|${row.group_id ?? ''}|${row.subject_id}`);
      const quarter = quarters.find((one) => one.startDate <= row.date && row.date <= one.endDate);
      if (journalId === undefined || quarter === undefined) continue;
      const key = `${journalId}|${quarter.id}`;
      counts.set(key, (counts.get(key) ?? 0) + row.count);
    }
    return counts;
  }

  /** The items of each journal's plan in each quarter, and how many fill a row. */
  private async filledCounts(
    transaction: Transaction,
    journals: readonly JournalRow[],
    quarters: readonly PlanQuarter[],
    rows: ReadonlyMap<string, number>,
  ): Promise<Map<string, { items: number; topics: number }>> {
    const found = new Map<string, { items: number; topics: number }>();
    if (journals.length === 0 || quarters.length === 0) return found;
    // Task 7.1c: the places of the journal (a cleared item has none).
    const items = await transaction
      .selectFrom('lesson_plan_journals')
      .innerJoin('lesson_plan_places', (join) =>
        join
          .onRef('lesson_plan_places.plan_id', '=', 'lesson_plan_journals.plan_id')
          .onRef('lesson_plan_places.journal_id', '=', 'lesson_plan_journals.journal_id'),
      )
      .select([
        'lesson_plan_journals.journal_id',
        'lesson_plan_journals.quarter_id',
        'lesson_plan_places.position',
      ])
      .where(
        'lesson_plan_journals.journal_id',
        'in',
        journals.map((journal) => journal.id),
      )
      .execute();
    for (const item of items) {
      const key = `${item.journal_id}|${item.quarter_id}`;
      const counted = found.get(key) ?? { items: 0, topics: 0 };
      counted.items += 1;
      // A topic is required, so an item that fills a row gives it a topic.
      if (item.position <= (rows.get(key) ?? 0)) counted.topics += 1;
      found.set(key, counted);
    }
    return found;
  }

  /** The plan of a journal in a quarter. */
  plan(access: Access, journalId: string, query: PlanQuery): Promise<Plan> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.sceneOf(transaction, access, branchId, journalId, query.quarterId);
      if (!scene.reach.read) throw scopeRefusal();
      if (scene.journal.subject.attendanceOnly) {
        throw new ApiException('plan_attendance_only', 409);
      }
      return this.answer(transaction, scene);
    });
  }

  async answer(transaction: Transaction, scene: Scene): Promise<Plan> {
    const rows = await planRows(
      transaction,
      scene.branchId,
      scene.journal,
      scene.quarter,
      scene.timeZone,
      scene.now,
    );
    const planId = await planIdOf(transaction, scene.journal.id, scene.quarter.id);
    const items = planId === null ? [] : await planItems(transaction, planId, scene.journal.id);
    const byPosition = new Map(items.map((item) => [item.position, item]));
    const names = await staffNames(transaction, scene.ownerId === null ? [] : [scene.ownerId]);
    // Task 7.2: the window for the owner, what the reader may write on each row now, the flag.
    const window = await storedWindowOf(transaction, scene.quarter, scene.ownerId, scene.timeZone);
    const { state, endsAt } = windowStateOf(window, scene.now);
    const writes = scene.reach.edit && !scene.closed && scene.open;
    const periods =
      writes && state !== 'open' && planId !== null
        ? await openPeriodsOf(transaction, planId, scene.journal.id, scene.now)
        : [];
    const openOf = (row: PlanRowLesson): 'none' | 'text' | 'all' => {
      if (!writes) return 'none';
      if (state === 'open') return 'all';
      const gateRow = { lessonId: row.lessonId, date: row.date, started: row.started };
      if (periods.some((period) => periodCovers(period, gateRow, 'move'))) return 'all';
      if (periods.some((period) => periodCovers(period, gateRow, 'wording'))) return 'text';
      return 'none';
    };
    const complete = rows.every((row) => byPosition.has(row.number));
    const ownerPeriods =
      planId === null ? new Set<string>() : await ownerPeriodsOf(transaction, [planId], scene.now);
    const flag = planFlagOf({
      rows: rows.length,
      complete,
      vacancy: await vacancyOn(
        transaction,
        scene.branchId,
        scene.journal,
        referenceDateOf(scene.quarter, schoolDateOf(scene.now, scene.timeZone)),
      ),
      window: state,
      ownerPeriod: ownerPeriods.has(`${planId ?? ''}|${scene.journal.id}`),
    });
    const prepared =
      planId === null ? null : await preparedRequestOf(transaction, planId, scene.journal.id);
    let request: Plan['request'] = prepared;
    if (request === null && state === 'ended' && !complete && planId !== null) {
      // Review decision 14: the request of the window's end, worked out on read
      // while the plan has no prepared or waiting request and no open period.
      const waiting = await transaction
        .selectFrom('lesson_plan_requests')
        .select('id')
        .where('plan_id', '=', planId)
        .where('journal_id', '=', scene.journal.id)
        .where((builder) =>
          builder.or([
            builder('status', 'in', ['prepared', 'sent']),
            builder.and([
              builder('status', '=', 'approved'),
              builder('finished_at', 'is', null),
              builder('open_until', '>=', scene.now),
            ]),
          ]),
        )
        .executeTakeFirst();
      if (waiting === undefined) {
        const empty = rows.filter((row) => !byPosition.has(row.number));
        request = {
          id: null,
          fromDate: empty.find((row) => !row.started)?.date ?? null,
          lessons: empty
            .filter((row) => row.started)
            .map((row) => ({ lessonId: row.lessonId, date: row.date })),
          causes: [
            {
              kind: 'window_end',
              onDate:
                (empty.find((row) => !row.started) ?? empty[0])?.date ?? scene.quarter.endDate,
              items: 0,
            },
          ],
        };
      }
    }
    return planSchema.parse({
      journalId: scene.journal.id,
      unit: unitOf(scene.journal),
      subject: subjectOf(scene.journal),
      quarters: scene.quarters,
      quarterId: scene.quarter.id,
      owner: scene.ownerId === null ? null : (names.get(scene.ownerId) ?? null),
      ownerStaffId: scene.ownerId,
      canEdit: scene.reach.edit && !scene.closed && scene.open,
      closed: scene.closed || !scene.open,
      rows: rows.map((row) => ({
        ...row,
        open: openOf(row),
        item: byPosition.get(row.number) ?? null,
      })),
      notCovered: items.filter((item) => item.position > rows.length),
      request,
      window: {
        state,
        startDate: window?.startDate ?? null,
        endDate: endsAt === null ? null : schoolDateOf(endsAt, scene.timeZone),
      },
      flag,
      requests:
        planId === null || !seesRequests(scene.reader, scene.journal, scene.ownerId)
          ? []
          : await planRequestsOf(transaction, scene, planId, false),
      sharedWith: planId === null ? [] : await this.sharedWith(transaction, scene, planId),
      shareCandidates:
        scene.reach.edit && !scene.closed && scene.open
          ? await this.shareCandidates(transaction, scene, planId)
          : [],
    });
  }

  /**
   * Task 7.1c: the other journals of a shared plan and where each stands
   * (`09`: "The plan screen shows where each class is").
   */
  private async sharedWith(
    transaction: Transaction,
    scene: Scene,
    planId: string,
  ): Promise<Plan['sharedWith']> {
    const found: Plan['sharedWith'] = [];
    for (const journalId of await planJournalIds(transaction, planId)) {
      if (journalId === scene.journal.id) continue;
      const [journal] = await journalRows(transaction, scene.branchId, { journalId });
      if (journal === undefined) continue;
      // Each journal told only to a reader of it (permission review, should-fix 4).
      const ownerId = await ownerIdOn(
        transaction,
        scene.branchId,
        journal,
        referenceDateOf(scene.quarter, schoolDateOf(scene.now, scene.timeZone)),
      );
      if (!planReachOf(scene.reader, journal, ownerId).read) continue;
      const rows = await planRows(
        transaction,
        scene.branchId,
        journal,
        scene.quarter,
        scene.timeZone,
        scene.now,
      );
      const items = await planItems(transaction, planId, journalId);
      const next = rows.find((row) => !row.started);
      found.push({
        journalId,
        unit: unitOf(journal),
        next:
          next === undefined
            ? null
            : {
                number: next.number,
                date: next.date,
                topic: items.find((item) => item.position === next.number)?.topic ?? null,
              },
        notCovered: items.filter((item) => item.position > rows.length).length,
      });
    }
    return found.sort((a, b) => a.unit.name.localeCompare(b.unit.name, 'en'));
  }

  /**
   * Task 7.1c: the reader's own journals that may join the plan (decision 3):
   * the same year, subject, kind, grades and language, owned by the plan's
   * owner on the reference date, not in the plan, with a plan of the quarter
   * holding no item (decision 4).
   */
  private async shareCandidates(
    transaction: Transaction,
    scene: Scene,
    planId: string | null,
  ): Promise<Plan['shareCandidates']> {
    const inPlan = new Set(
      planId === null ? [scene.journal.id] : await planJournalIds(transaction, planId),
    );
    const year = await journalRows(transaction, scene.branchId, {
      yearId: scene.journal.academicYearId,
    });
    const keys = await unitKeysOf(transaction, year);
    const own = keys.get(scene.journal.id);
    const alike = year.filter(
      (journal) =>
        !inPlan.has(journal.id) &&
        journal.subjectId === scene.journal.subjectId &&
        keys.get(journal.id) === own,
    );
    const { today } = await clockOf(transaction, scene.branchId);
    const found: Plan['shareCandidates'] = [];
    for (const journal of alike) {
      const owner = await ownerIdOn(
        transaction,
        scene.branchId,
        journal,
        referenceDateOf(scene.quarter, today),
      );
      if (owner === null || owner !== scene.ownerId) continue;
      const theirs = await planIdOf(transaction, journal.id, scene.quarter.id);
      if (theirs !== null && (await this.hasItems(transaction, theirs))) continue;
      found.push({ journalId: journal.id, unit: unitOf(journal) });
    }
    return found.sort((a, b) => a.unit.name.localeCompare(b.unit.name, 'en'));
  }

  /**
   * The plan of the scene's journal and quarter, made on the first write
   * under the journal's lock (review must-fix 3 of #212), with its link, the
   * mark that lays it before the commit (task 7.1b) and its audit entry.
   */
  async planFor(
    transaction: Transaction,
    access: Access,
    scene: Scene & { readonly assignmentId: string },
    requestId: string | undefined,
  ): Promise<string> {
    const journalId = scene.journal.id;
    const found = await planIdOf(transaction, journalId, scene.quarter.id);
    if (found !== null) return found;
    const plan = await transaction
      .insertInto('lesson_plans')
      .values({
        branch_id: scene.branchId,
        quarter_id: scene.quarter.id,
        subject_id: scene.journal.subjectId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .insertInto('lesson_plan_journals')
      .values({
        branch_id: scene.branchId,
        plan_id: plan.id,
        journal_id: journalId,
        quarter_id: scene.quarter.id,
      })
      .execute();
    // Task 7.1b: the plan is laid on its rows before the commit (its
    // snapshot, `PlanFollow`), as after any change of the timetable.
    await transaction
      .insertInto('lesson_plan_follow_marks')
      .values({ branch_id: scene.branchId, journal_id: journalId })
      .execute();
    await this.audit.record(transaction, {
      branchId: scene.branchId,
      actorId: access.accountId,
      assignmentId: scene.assignmentId,
      action: 'plan.create',
      record: { type: 'lesson_plan', id: plan.id },
      newValue: { journalId, quarterId: scene.quarter.id },
      ...(requestId === undefined ? {} : { requestId }),
    });
    return plan.id;
  }

  /** The plan holds an item not cleared. */
  async hasItems(transaction: Transaction, planId: string): Promise<boolean> {
    const found = await transaction
      .selectFrom('lesson_plan_items')
      .select('id')
      .where('plan_id', '=', planId)
      .where('cleared_at', 'is', null)
      .executeTakeFirst();
    return found !== undefined;
  }

  /**
   * The item of one lesson (task 7.1b, decision 11): for a reader of its plan,
   * or for the substitute of that lesson while the substitution is in force
   * (`09`: "The substitute sees the item of that lesson and cannot edit it";
   * `edge/lesson-plans`: "a substitute, for that lesson's item").
   */
  lessonItem(access: Access, lessonId: string): Promise<PlanLessonItem> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const lesson = await transaction
        .selectFrom('lessons')
        .select([
          'id',
          'class_id',
          'group_id',
          'subject_id',
          'teacher_id',
          sql<string>`lesson_date::text`.as('lesson_date'),
        ])
        .where('id', '=', lessonId)
        .where('branch_id', '=', branchId)
        .executeTakeFirst();
      if (lesson === undefined) throw notFound();
      const found = await transaction
        .selectFrom('journals')
        .innerJoin('academic_years', 'academic_years.id', 'journals.academic_year_id')
        .innerJoin('quarters', 'quarters.academic_year_id', 'academic_years.id')
        .select(['journals.id as journal_id', 'quarters.id as quarter_id'])
        .where('journals.branch_id', '=', branchId)
        .where('journals.subject_id', '=', lesson.subject_id)
        .where((builder) =>
          lesson.class_id === null
            ? builder('journals.group_id', '=', lesson.group_id)
            : builder('journals.class_id', '=', lesson.class_id),
        )
        .where('quarters.start_date', '<=', lesson.lesson_date)
        .where('quarters.end_date', '>=', lesson.lesson_date)
        .executeTakeFirst();
      // No journal or quarter holds the lesson: no plan to read (404, before any scope:
      // a state is told only to a reader, permission review should-fix 3).
      if (found === undefined) throw notFound();
      const scene = await this.sceneOf(
        transaction,
        access,
        branchId,
        found.journal_id,
        found.quarter_id,
      );
      if (!scene.reach.read) {
        // The substitute of this lesson only: its teacher while a substitution is in force.
        const reader = await planReaderOf(transaction, access);
        const substitutes =
          reader.staffId !== null && lesson.teacher_id === reader.staffId
            ? await substitutionsInForce(transaction, [
                { id: lesson.id, teacherId: lesson.teacher_id },
              ])
            : new Map();
        if (!substitutes.has(lesson.id)) throw scopeRefusal();
      }
      if (scene.journal.subject.attendanceOnly) {
        throw new ApiException('plan_attendance_only', 409);
      }
      const rows = await planRows(
        transaction,
        branchId,
        scene.journal,
        scene.quarter,
        scene.timeZone,
        scene.now,
      );
      const row = rows.find((one) => one.lessonId === lesson.id);
      const planId = await planIdOf(transaction, scene.journal.id, scene.quarter.id);
      const items =
        planId === null || row === undefined
          ? []
          : await planItems(transaction, planId, scene.journal.id);
      return planLessonItemSchema.parse({
        lessonId: lesson.id,
        journalId: scene.journal.id,
        date: lesson.lesson_date,
        number: row?.number ?? null,
        subject: subjectOf(scene.journal),
        unit: unitOf(scene.journal),
        item: items.find((item) => item.position === row?.number) ?? null,
      });
    });
  }

  /** Reads the journal, its year, the quarter and what the request may do. */
  async sceneOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    journalId: string,
    quarterId: string | undefined,
  ): Promise<Scene> {
    const [journal] = await journalRows(transaction, branchId, { journalId });
    if (journal === undefined) throw notFound();
    const year = await transaction
      .selectFrom('academic_years')
      .select('status')
      .where('id', '=', journal.academicYearId)
      .executeTakeFirstOrThrow();
    const { timeZone, today, now } = await clockOf(transaction, branchId);
    const quarters = await datedQuarters(transaction, journal.academicYearId);
    let quarter: PlanQuarter | undefined;
    if (quarterId !== undefined) {
      const known = await transaction
        .selectFrom('quarters')
        .select('id')
        .where('id', '=', quarterId)
        .where('academic_year_id', '=', journal.academicYearId)
        .executeTakeFirst();
      if (known === undefined) throw notFound();
      quarter = quarters.find((one) => one.id === quarterId);
    } else {
      quarter = quarterOfToday(quarters, today);
    }
    if (quarter === undefined) throw new ApiException('journal_no_quarter', 409);
    const ownerId = await ownerIdOn(
      transaction,
      branchId,
      journal,
      referenceDateOf(quarter, today),
    );
    const reader: PlanReader = await planReaderOf(transaction, access);
    const open = await transaction
      .selectFrom('journals')
      .select('id')
      .where('id', '=', journal.id)
      // Decision 9: a run day from the later of today and the quarter's first day.
      .where(
        sql<boolean>`runs && datemultirange(daterange(greatest(${today}::date, ${quarter.startDate}::date), null))`,
      )
      .executeTakeFirst();
    return {
      branchId,
      journal,
      closed: year.status === 'closed',
      open: open !== undefined,
      quarters,
      quarter,
      timeZone,
      now,
      ownerId,
      reach: planReachOf(reader, journal, ownerId),
      reader,
    };
  }

  /** The scene of a write: read and owned, the year open. */
  async writeSceneOf(
    transaction: Transaction,
    access: Access,
    branchId: string,
    journalId: string,
    quarterId: string,
  ): Promise<Scene & { readonly assignmentId: string }> {
    const scene = await this.sceneOf(transaction, access, branchId, journalId, quarterId);
    // A closed plan has no owner from its closing on: a reader of it is told
    // it is closed, anyone else is refused the scope.
    if (!scene.open && scene.reach.read && !scene.closed) {
      throw new ApiException('plan_closed', 409);
    }
    if (!scene.reach.edit || scene.reach.assignmentId === null) throw scopeRefusal();
    if (scene.journal.subject.attendanceOnly) {
      throw new ApiException('plan_attendance_only', 409);
    }
    if (scene.closed) throw new ApiException('plan_year_closed', 409);
    if (!scene.open) throw new ApiException('plan_closed', 409);
    return { ...scene, assignmentId: scene.reach.assignmentId };
  }

  /**
   * The item named by a path, not cleared, with the journals and quarter of
   * its plan (task 7.1c: several journals when the plan is shared).
   */
  async itemTarget(
    transaction: Transaction,
    itemId: string,
  ): Promise<{ planId: string; journalIds: readonly string[]; quarterId: string }> {
    const links = await transaction
      .selectFrom('lesson_plan_items')
      .innerJoin(
        'lesson_plan_journals',
        'lesson_plan_journals.plan_id',
        'lesson_plan_items.plan_id',
      )
      .select([
        'lesson_plan_items.plan_id',
        'lesson_plan_journals.journal_id',
        'lesson_plan_journals.quarter_id',
      ])
      .where('lesson_plan_items.id', '=', itemId)
      .where('lesson_plan_items.cleared_at', 'is', null)
      .orderBy('lesson_plan_journals.journal_id')
      .execute();
    const first = links[0];
    if (first === undefined) throw notFound();
    return {
      planId: first.plan_id,
      journalIds: links.map((link) => link.journal_id),
      quarterId: first.quarter_id,
    };
  }

  /** The place of an item in one journal of its plan. */
  private async placeOf(
    transaction: Transaction,
    itemId: string,
    journalId: string,
  ): Promise<{ position: number; moved_from: string | null }> {
    const place = await transaction
      .selectFrom('lesson_plan_places')
      .select(['position', sql<string | null>`moved_from::text`.as('moved_from')])
      .where('item_id', '=', itemId)
      .where('journal_id', '=', journalId)
      .executeTakeFirst();
    if (place === undefined) throw notFound();
    return place;
  }

  /**
   * The scene of a write to an item: the request may write its plan, and the
   * window or an open period lets the write through (task 7.2, `plan-gate.ts`).
   */
  async itemWriteScene(
    transaction: Transaction,
    access: Access,
    itemId: string,
    op: GateOp,
  ): Promise<
    Scene & {
      readonly assignmentId: string;
      readonly planId: string;
      readonly journalIds: readonly string[];
      /** The item's row in the scene's journal. */
      readonly position: number;
      readonly pass: GatePass;
      /** Task 7.2: the journals in which the item's row has started. */
      readonly startedIn: readonly string[];
    }
  > {
    const branchId = branchOf(access);
    const target = await this.itemTarget(transaction, itemId);
    // Decision 14: the writer owns every journal of a shared plan.
    const scenes = [];
    for (const journalId of target.journalIds) {
      scenes.push(
        await this.writeSceneOf(transaction, access, branchId, journalId, target.quarterId),
      );
    }
    const [scene] = scenes;
    if (scene === undefined) throw notFound();
    // The links read again after the lock (permission review, note 7): a
    // journal that joined meanwhile is owned too.
    const journalIds = await this.lockPlanOf(transaction, scene.journal.id, target.quarterId);
    for (const journalId of journalIds) {
      if (!target.journalIds.includes(journalId)) {
        await this.writeSceneOf(transaction, access, branchId, journalId, target.quarterId);
      }
    }
    const { position } = await this.placeOf(transaction, itemId, scene.journal.id);
    const targets: GateTarget[] = [];
    const startedIn: string[] = [];
    for (const journalId of journalIds) {
      const row = await this.gateRowOf(transaction, scene, journalId, itemId);
      if (row.started) startedIn.push(journalId);
      targets.push({ journalId, rows: [row], op });
    }
    const pass = await this.gate(transaction, scene, target.planId, targets);
    return { ...scene, planId: target.planId, journalIds, position, pass, startedIn };
  }

  /** The row of an item in one journal, as the gate reads it; an item past the last row has none. */
  private async gateRowOf(
    transaction: Transaction,
    scene: Scene,
    journalId: string,
    itemId: string,
  ): Promise<GateRow> {
    const rows = await this.rowsOfJournal(transaction, scene, journalId);
    const { position } = await this.placeOf(transaction, itemId, journalId);
    const row = rows[position - 1];
    return row === undefined
      ? { lessonId: null, date: null, started: false }
      : { lessonId: row.lessonId, date: row.date, started: row.started };
  }

  /** The rows of a journal of the scene's plan in the scene's quarter. */
  async rowsOfJournal(
    transaction: Transaction,
    scene: Scene,
    journalId: string,
  ): Promise<PlanRowLesson[]> {
    const journal =
      journalId === scene.journal.id
        ? scene.journal
        : (await journalRows(transaction, scene.branchId, { journalId }))[0];
    if (journal === undefined) throw notFound();
    return planRows(transaction, scene.branchId, journal, scene.quarter, scene.timeZone, scene.now);
  }

  /** Task 7.2: the window of the writer, else the open periods of every journal touched (`plan-gate.ts`). */
  gate(
    transaction: Transaction,
    scene: Scene,
    planId: string,
    targets: readonly GateTarget[],
    windowOnly = false,
  ): Promise<GatePass> {
    return passGate(transaction, {
      planId,
      quarter: scene.quarter,
      staffId: scene.reader.staffId,
      timeZone: scene.timeZone,
      now: scene.now,
      targets,
      windowOnly,
    });
  }

  /** The scene of a read of an item's file: the request may read its plan. */
  async itemReadScene(transaction: Transaction, access: Access, itemId: string): Promise<void> {
    const branchId = branchOf(access);
    const target = await this.itemTarget(transaction, itemId);
    // A reader of any journal of a shared plan reads its items.
    for (const journalId of target.journalIds) {
      const scene = await this.sceneOf(transaction, access, branchId, journalId, target.quarterId);
      if (scene.reach.read) return;
    }
    throw scopeRefusal();
  }

  /** Locks an item row for a write, whatever its state, then reads it (`database.md`). */
  async lockItem(transaction: Transaction, itemId: string) {
    await transaction
      .selectFrom('lesson_plan_items')
      .select('id')
      .where('id', '=', itemId)
      .forNoKeyUpdate()
      .execute();
    const item = await transaction
      .selectFrom('lesson_plan_items')
      .select(['id', 'plan_id', 'topic', 'objectives', 'links', 'cleared_at'])
      .where('id', '=', itemId)
      .executeTakeFirst();
    if (item === undefined || item.cleared_at !== null) throw notFound();
    return item;
  }

  /** A new item at an empty row (decision 5: the row is a lesson not cancelled). */
  createItem(
    access: Access,
    journalId: string,
    input: PlanItemCreate,
    requestId: string | undefined,
  ): Promise<PlanItem> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const scene = await this.writeSceneOf(
            transaction,
            access,
            branchId,
            journalId,
            input.quarterId,
          );
          // The journal first, so that two first writes make one plan (review must-fix 3);
          // `for no key update` lets an acting period's key share through (correction 1).
          // Task 7.1c: with every journal of a shared plan, in the order of the
          // id; a share committed in between is read after the lock.
          const others = (await this.lockPlanOf(transaction, journalId, scene.quarter.id)).filter(
            (id) => id !== journalId,
          );
          // Decision 14: the writer owns every journal of the plan.
          for (const other of others) {
            await this.writeSceneOf(transaction, access, branchId, other, input.quarterId);
          }
          const rows = await planRows(
            transaction,
            branchId,
            scene.journal,
            scene.quarter,
            scene.timeZone,
            scene.now,
          );
          // Task 7.1b (decision 12): the create names the lesson of its row;
          // another branch's or an unknown lesson is 404, checked first.
          const lesson = await transaction
            .selectFrom('lessons')
            .select('id')
            .where('id', '=', input.lessonId)
            .where('branch_id', '=', branchId)
            .executeTakeFirst();
          if (lesson === undefined) throw notFound();
          if (input.position > rows.length) throw new ApiException('plan_row_unknown', 409);
          if (rows[input.position - 1]?.lessonId !== input.lessonId) {
            throw new ApiException('plan_row_moved', 409);
          }
          const planId = await this.planFor(transaction, access, scene, requestId);
          const taken = await transaction
            .selectFrom('lesson_plan_places')
            .select('item_id')
            .where('plan_id', '=', planId)
            .where('journal_id', '=', journalId)
            .where('position', '=', input.position)
            .executeTakeFirst();
          if (taken !== undefined) {
            throw new ApiException('plan_row_taken', 409, undefined, [
              {
                path: 'position',
                code: 'plan_row_taken',
                message: 'The row already holds an item.',
                recordId: taken.item_id,
              },
            ]);
          }
          const page = await this.placesOf(transaction, planId, journalId);
          // Task 7.2: the window, else a period covering the row in every
          // journal (a new item moves the later ones of another journal).
          const own = rows[input.position - 1];
          const targets: GateTarget[] = [
            {
              journalId,
              rows: [
                own === undefined
                  ? { lessonId: null, date: null, started: false }
                  : { lessonId: own.lessonId, date: own.date, started: own.started },
              ],
              op: 'create',
            },
          ];
          for (const other of [...others].sort()) {
            const otherRows = await this.rowsOfJournal(transaction, scene, other);
            const placed = placeNew(page, input.position, {
              started: otherRows.filter((one) => one.started).length,
              places: await this.placesOf(transaction, planId, other),
            });
            const at = otherRows[placed.position - 1];
            targets.push({
              journalId: other,
              rows: [
                at === undefined
                  ? { lessonId: null, date: null, started: false }
                  : { lessonId: at.lessonId, date: at.date, started: at.started },
              ],
              op: placed.shifts.size > 0 ? 'move' : 'create',
            });
          }
          const pass = await this.gate(transaction, scene, planId, targets);
          const values = input.values;
          const item = await transaction
            .insertInto('lesson_plan_items')
            .values({
              branch_id: branchId,
              plan_id: planId,
              topic: values.topic,
              objectives: values.objectives,
              links: values.links,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          for (const { kind, list } of KINDS) {
            for (const [index, work] of values[list].entries()) {
              await transaction
                .insertInto('lesson_plan_works')
                .values({
                  branch_id: branchId,
                  item_id: item.id,
                  kind,
                  position: index + 1,
                  title: work.title,
                  description: work.description,
                })
                .execute();
            }
          }
          await transaction
            .insertInto('lesson_plan_places')
            .values({
              branch_id: branchId,
              plan_id: planId,
              journal_id: journalId,
              item_id: item.id,
              position: input.position,
            })
            .execute();
          // Decision 8: the other journals of a shared plan lay it after the item before it.
          for (const other of others.sort()) {
            const [otherJournal] = await journalRows(transaction, branchId, { journalId: other });
            if (otherJournal === undefined) continue;
            const otherRows = await planRows(
              transaction,
              branchId,
              otherJournal,
              scene.quarter,
              scene.timeZone,
              scene.now,
            );
            const placed = placeNew(page, input.position, {
              started: otherRows.filter((one) => one.started).length,
              places: await this.placesOf(transaction, planId, other),
            });
            await movePlaces(transaction, planId, other, placed.shifts);
            await transaction
              .insertInto('lesson_plan_places')
              .values({
                branch_id: branchId,
                plan_id: planId,
                journal_id: other,
                item_id: item.id,
                position: placed.position,
              })
              .execute();
          }
          const created = await this.itemOf(transaction, item.id, journalId);
          const row = rows[input.position - 1];
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: scene.assignmentId,
            action: 'plan.item_create',
            record: { type: 'lesson_plan', id: planId },
            newValue: {
              itemId: item.id,
              position: input.position,
              date: row?.date ?? null,
              topic: created.topic,
              objectives: created.objectives,
              links: created.links,
              classworks: created.classworks,
              homeworks: created.homeworks,
            },
            ...gateAudit(pass),
            ...(requestId === undefined ? {} : { requestId }),
          });
          return created;
        }),
      PLAN_REFUSALS,
    );
  }

  /**
   * A save of an item (decision 9 with review correction 3; `edge/lesson-plans`:
   * "A save is addressed to the item, not to the row. A save made on an older
   * state of the same field is refused and both values are shown"). Only the
   * fields whose value differs from their base are compared and written.
   */
  saveItem(
    access: Access,
    itemId: string,
    input: PlanItemSave,
    requestId: string | undefined,
  ): Promise<PlanItem> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const scene = await this.itemWriteScene(transaction, access, itemId, 'wording');
          const stored = await this.lockItem(transaction, itemId);
          const storedWorks = (await worksOf(transaction, [itemId])).get(itemId) ?? {
            classworks: [],
            homeworks: [],
          };
          const { base, values } = input;
          // A work sent with an id is one of the base's, of its kind.
          for (const { list } of KINDS) {
            values[list].forEach((work, index) => {
              if (work.id !== undefined && !base[list].some((one) => one.id === work.id)) {
                throw new ApiException('validation_failed', 400, undefined, [
                  {
                    path: `values.${list}.${index}.id`,
                    code: 'unknown_work',
                    message: 'The work is not one of the item as it was read.',
                  },
                ]);
              }
            });
          }
          const stale: ErrorDetail[] = [];
          const staleField = (path: string, value: ErrorDetail['storedPlanValue']) => {
            stale.push({
              path,
              code: 'plan_item_stale',
              message: 'The field was changed since it was read.',
              storedPlanValue: value,
            });
          };
          const changed = {
            topic: values.topic !== base.topic,
            objectives: values.objectives !== base.objectives,
            links: !sameList(values.links, base.links),
          };
          if (changed.topic && stored.topic !== base.topic)
            staleField('values.topic', stored.topic);
          if (changed.objectives && stored.objectives !== base.objectives) {
            staleField('values.objectives', stored.objectives);
          }
          if (changed.links && !sameList(stored.links, base.links)) {
            staleField('values.links', stored.links);
          }
          // Works by identity: a work this save changes or removes must be as it was read.
          const workChanges = KINDS.map(({ kind, list }) => {
            const sent = values[list];
            const before = base[list];
            const now = storedWorks[list];
            const kept = sent.filter((work) => work.id !== undefined);
            // A work of the base that the item no longer holds (or never held) is nothing to remove.
            const removed = before.filter(
              (work) =>
                !kept.some((one) => one.id === work.id) && now.some((one) => one.id === work.id),
            );
            const edited = kept.filter((work) => {
              const was = before.find((one) => one.id === work.id);
              return was !== undefined && !sameWork(was, work);
            });
            const added = sent.filter((work) => work.id === undefined);
            const reordered = !sameList(
              kept.map((work) => work.id ?? ''),
              before
                .filter((work) => kept.some((one) => one.id === work.id))
                .map((work) => work.id),
            );
            for (const work of [...edited, ...removed]) {
              const was = before.find((one) => one.id === work.id);
              const current = now.find((one) => one.id === work.id);
              if (was === undefined) continue;
              if (current === undefined) {
                // Removed meanwhile: a removal agrees; an edit of it is stale.
                if (edited.includes(work)) {
                  staleField(`values.${list}.${work.id ?? ''}`, null);
                }
              } else if (!sameWork(current, was)) {
                staleField(`values.${list}.${work.id ?? ''}`, {
                  title: current.title,
                  description: current.description,
                });
              }
            }
            return { kind, list, sent, before, now, removed, edited, added, reordered };
          });
          if (stale.length > 0) throw new ApiException('plan_item_stale', 409, undefined, stale);

          const oldValue: Record<string, JsonValue> = {};
          const newValue: Record<string, JsonValue> = {};
          const fields: { topic?: string; objectives?: string; links?: string[] } = {};
          if (changed.topic) {
            fields.topic = values.topic;
            oldValue.topic = stored.topic;
            newValue.topic = values.topic;
          }
          if (changed.objectives) {
            fields.objectives = values.objectives;
            oldValue.objectives = stored.objectives;
            newValue.objectives = values.objectives;
          }
          if (changed.links) {
            fields.links = values.links;
            oldValue.links = stored.links;
            newValue.links = values.links;
          }
          if (Object.keys(fields).length > 0) {
            await transaction
              .updateTable('lesson_plan_items')
              .set(fields)
              .where('id', '=', itemId)
              .execute();
          }
          const removedWorks: ReturnType<typeof workEntry>[] = [];
          for (const change of workChanges) {
            const touched =
              change.removed.length > 0 ||
              change.edited.length > 0 ||
              change.added.length > 0 ||
              change.reordered;
            if (!touched) continue;
            for (const work of change.removed) {
              const index = change.now.findIndex((one) => one.id === work.id);
              const current = change.now[index];
              if (current === undefined) continue;
              removedWorks.push(workEntry(current, change.kind, index + 1));
              await transaction.deleteFrom('lesson_plan_works').where('id', '=', work.id).execute();
            }
            for (const work of change.edited) {
              await transaction
                .updateTable('lesson_plan_works')
                .set({ title: work.title, description: work.description })
                .where('id', '=', work.id ?? '')
                .execute();
            }
            // The order sent, then works another save added meanwhile.
            const sentIds = new Set(
              change.sent.flatMap((work) => (work.id === undefined ? [] : [work.id])),
            );
            const others = change.now.filter(
              (work) => !sentIds.has(work.id) && !change.removed.some((one) => one.id === work.id),
            );
            let position = 0;
            for (const work of change.sent) {
              position += 1;
              if (work.id === undefined) {
                await transaction
                  .insertInto('lesson_plan_works')
                  .values({
                    branch_id: branchId,
                    item_id: itemId,
                    kind: change.kind,
                    position,
                    title: work.title,
                    description: work.description,
                  })
                  .execute();
              } else if (change.now.some((one) => one.id === work.id)) {
                await transaction
                  .updateTable('lesson_plan_works')
                  .set({ position })
                  .where('id', '=', work.id)
                  .execute();
              } else {
                position -= 1;
              }
            }
            for (const work of others) {
              position += 1;
              await transaction
                .updateTable('lesson_plan_works')
                .set({ position })
                .where('id', '=', work.id)
                .execute();
            }
            oldValue[change.list] = change.now.map((work, index) =>
              workEntry(work, change.kind, index + 1),
            );
          }
          // Task 7.2: `09`, "If the item of a lesson already held is changed,
          // it carries an \"edited after the lesson\" mark" (after the window).
          if (scene.pass.via === 'request' && scene.startedIn.length > 0) {
            await transaction
              .updateTable('lesson_plan_places')
              .set({ edited_after_lesson: true })
              .where('item_id', '=', itemId)
              .where('journal_id', 'in', [...scene.startedIn])
              .execute();
          }
          const saved = await this.itemOf(transaction, itemId, scene.journal.id);
          for (const change of workChanges) {
            if (change.list in oldValue) {
              newValue[change.list] = saved[change.list].map((work, index) =>
                workEntry(work, change.kind, index + 1),
              );
            }
          }
          if (Object.keys(newValue).length > 0) {
            await this.audit.record(transaction, {
              branchId,
              actorId: access.accountId,
              assignmentId: scene.assignmentId,
              action: 'plan.item_edit',
              record: { type: 'lesson_plan', id: scene.planId },
              oldValue,
              newValue,
              details: {
                itemId,
                position: scene.position,
                removedWorks,
                ...(gateDetail(scene.pass) ?? {}),
              },
              ...(requestId === undefined ? {} : { requestId }),
            });
          }
          return saved;
        }),
      PLAN_REFUSALS,
    );
  }

  /** "Clear" (`edge/lesson-plans`: "'Clear' empties only rows of lessons not yet held"). */
  clearItem(access: Access, itemId: string, requestId: string | undefined): Promise<void> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.itemWriteScene(transaction, access, itemId, 'move');
      await this.lockItem(transaction, itemId);
      // Task 7.1c: a held row of any journal of a shared plan keeps its item.
      let row: PlanRowLesson | undefined;
      for (const journalId of scene.journalIds) {
        const [journal] = await journalRows(transaction, branchId, { journalId });
        if (journal === undefined) continue;
        const rows: readonly PlanRowLesson[] = await planRows(
          transaction,
          branchId,
          journal,
          scene.quarter,
          scene.timeZone,
          scene.now,
        );
        const { position } = await this.placeOf(transaction, itemId, journalId);
        const at = rows[position - 1];
        if (at?.held === true) throw new ApiException('plan_row_held', 409);
        if (journalId === scene.journal.id) row = at;
      }
      const before = await this.itemOf(transaction, itemId, scene.journal.id);
      await transaction.deleteFrom('lesson_plan_places').where('item_id', '=', itemId).execute();
      await transaction
        .updateTable('lesson_plan_items')
        .set({ cleared_at: await transactionMoment(transaction) })
        .where('id', '=', itemId)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.item_clear',
        record: { type: 'lesson_plan', id: scene.planId },
        oldValue: {
          itemId,
          position: scene.position,
          date: row?.date ?? null,
          topic: before.topic,
          objectives: before.objectives,
          links: before.links,
          classworks: before.classworks,
          homeworks: before.homeworks,
          files: before.files.map((file) => file.id),
        },
        newValue: null,
        ...gateAudit(scene.pass),
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }

  /**
   * The queue edit (task 7.2, review decision 6; `edge`: "'Re-plan' runs from
   * a chosen lesson not yet held to the end of the quarter and allows insert,
   * delete, merge and reorder"): the new order of the items from the first row
   * not started, `null` for an empty row; an item left out is cleared. In a
   * shared plan each journal lays the order from its own first row not
   * started; an item on a started row of any journal is not moved.
   */
  editQueue(
    access: Access,
    journalId: string,
    input: PlanQueue,
    requestId: string | undefined,
  ): Promise<Plan> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.writeSceneOf(
        transaction,
        access,
        branchId,
        journalId,
        input.quarterId,
      );
      const members = await this.lockPlanOf(transaction, journalId, scene.quarter.id);
      for (const other of members) {
        if (other !== journalId) {
          await this.writeSceneOf(transaction, access, branchId, other, input.quarterId);
        }
      }
      const planId = await planIdOf(transaction, journalId, scene.quarter.id);
      if (planId === null) throw notFound();
      const trim = (list: readonly (string | null)[]) => {
        const copy = [...list];
        while (copy.length > 0 && copy.at(-1) === null) copy.pop();
        return copy;
      };
      const layout = new Map<
        string,
        { rows: PlanRowLesson[]; started: number; places: Map<string, number> }
      >();
      for (const id of members) {
        const rows = await this.rowsOfJournal(transaction, scene, id);
        layout.set(id, {
          rows,
          started: rows.filter((row) => row.started).length,
          places: await this.placesOf(transaction, planId, id),
        });
      }
      const own = layout.get(journalId);
      if (own === undefined) throw notFound();
      const current: (string | null)[] = [];
      for (const [itemId, position] of own.places) {
        if (position > own.started) current[position - own.started - 1] = itemId;
      }
      const now = trim(Array.from(current, (one) => one ?? null));
      const base = trim(input.base);
      if (now.length !== base.length || now.some((one, index) => one !== base[index])) {
        throw new ApiException('plan_queue_stale', 409);
      }
      const order = trim(input.order);
      const named = order.filter((one): one is string => one !== null);
      const inQueue = new Set(now.filter((one): one is string => one !== null));
      if (new Set(named).size !== named.length || named.some((one) => !inQueue.has(one))) {
        throw new ApiException('plan_queue_items', 409);
      }
      // An item on a started row of another journal stays where it is.
      for (const [id, one] of layout) {
        if (id === journalId) continue;
        for (const itemId of inQueue) {
          const at = one.places.get(itemId);
          if (at !== undefined && at <= one.started) throw new ApiException('plan_row_held', 409);
        }
      }
      const first = order.findIndex((one, index) => one !== (now[index] ?? null));
      const changed = first === -1 ? Math.max(order.length, now.length) : first;
      if (first === -1 && order.length === now.length) return this.answer(transaction, scene);
      const targets: GateTarget[] = [...layout].map(([id, one]) => {
        const row = one.rows[one.started + changed];
        return {
          journalId: id,
          rows: [
            row === undefined
              ? { lessonId: null, date: null, started: false }
              : { lessonId: row.lessonId, date: row.date, started: row.started },
          ],
          op: 'move' as const,
        };
      });
      const pass = await this.gate(transaction, scene, planId, targets);
      const cleared = [...inQueue].filter((itemId) => !named.includes(itemId)).sort();
      if (cleared.length > 0) {
        await transaction
          .deleteFrom('lesson_plan_places')
          .where('plan_id', '=', planId)
          .where('item_id', 'in', cleared)
          .execute();
        await transaction
          .updateTable('lesson_plan_items')
          .set({ cleared_at: scene.now })
          .where('id', 'in', cleared)
          .execute();
      }
      for (const [id, one] of layout) {
        const moves = new Map<string, number>();
        order.forEach((itemId, index) => {
          if (itemId !== null) moves.set(itemId, one.started + index + 1);
        });
        // Items of this journal's queue the order does not name (a started row elsewhere) follow.
        let next = one.started + order.length;
        for (const [itemId, position] of [...one.places].sort((a, b) => a[1] - b[1])) {
          if (position > one.started && !moves.has(itemId) && !cleared.includes(itemId)) {
            next += 1;
            moves.set(itemId, next);
          }
        }
        await movePlaces(transaction, planId, id, moves);
      }
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'plan.queue_edit',
        record: { type: 'lesson_plan', id: planId },
        oldValue: { journalId, from: own.started + 1, order: now },
        newValue: { journalId, from: own.started + 1, order, cleared },
        ...gateAudit(pass),
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.answer(transaction, scene);
    });
  }

  /** One item as the answer sends it. */
  private async itemOf(
    transaction: Transaction,
    itemId: string,
    journalId: string,
  ): Promise<PlanItem> {
    const item = await transaction
      .selectFrom('lesson_plan_items')
      .select('plan_id')
      .where('id', '=', itemId)
      .executeTakeFirstOrThrow();
    const found = (await planItems(transaction, item.plan_id, journalId)).find(
      (one) => one.id === itemId,
    );
    if (found === undefined) throw notFound();
    return planItemSchema.parse(found);
  }

  /**
   * Locks a journal and every journal of its plan in the quarter, in the
   * order of the id (task 7.1c, "Locks"); the links are read again after each
   * lock until no journal is missing. Gives the journals of the plan now.
   */
  async lockPlanOf(
    transaction: Transaction,
    journalId: string,
    quarterId: string,
  ): Promise<string[]> {
    const locked = new Set<string>();
    for (;;) {
      const planId = await planIdOf(transaction, journalId, quarterId);
      const all = planId === null ? [journalId] : await planJournalIds(transaction, planId);
      const missing = all.filter((id) => !locked.has(id));
      if (missing.length === 0) return all;
      await lockJournals(transaction, missing);
      for (const id of missing) locked.add(id);
    }
  }

  /** The places of a plan's items in one journal. */
  async placesOf(
    transaction: Transaction,
    planId: string,
    journalId: string,
  ): Promise<Map<string, number>> {
    const rows = await transaction
      .selectFrom('lesson_plan_places')
      .select(['item_id', 'position'])
      .where('plan_id', '=', planId)
      .where('journal_id', '=', journalId)
      .execute();
    return new Map(rows.map((row) => [row.item_id, row.position]));
  }
}
