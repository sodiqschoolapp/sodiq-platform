import { Injectable } from '@nestjs/common';
import { shownPercent } from '@sodiq/calc';
import {
  planCompletenessSchema,
  planProgressSchema,
  planRequestsReportSchema,
  schoolDateOf,
  subjectColourSchema,
  type PlanCompleteness,
  type PlanList,
  type PlanProgress,
  type PlanReportQuery,
  type PlanRequestsReport,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import {
  journalRows,
  plannedJournal,
  staffNames,
  type JournalRow,
} from '../journal/journal-grid.query.js';
import { lessonsCounted } from '../journal/lesson-counted.js';
import { notFound } from '../setup/setup-refusals.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { clockOf, quarterOfToday, referenceDateOf, type PlanQuarter } from './plan-read.js';
import { notCoveredOf, type JournalProgress } from './plan-progress.js';
import { Freshness, preparedPlanProgress } from '../results/prepared/read.js';
import { PlansService } from './plans.service.js';

/**
 * The plan reports (task 8.8, pull request #226; `09`, Reports): completeness
 * ("For each teacher, department and branch: complete, incomplete (with the
 * number of lessons that have no topic), not started, overdue"), progress
 * ("Lessons planned against lessons held; classes behind the plan; items not
 * covered"; `edge/lesson-plans`: "each teacher's share of 'not held'"), and
 * edit requests ("Number per teacher, who approved, what was changed").
 * Worked out on read over one quarter of the branch (decision 16), for the
 * whole-branch roles every plan, for a Head Teacher or Senior Head Teacher
 * the plans of their subjects only (decision 1). Every percent comes from
 * `packages/calc` (`shownPercent`), summed over counts, never averaged.
 */

const WHOLE = new Set(['super_admin', 'principal', 'academic_vice_principal']);
const SUBJECTS = new Set(['head_teacher', 'senior_head_teacher']);

/** The subjects a reader of the reports reads, `null` for every subject. */
function reportSubjects(access: Access): Set<string> | null {
  if (access.permitting.some((one) => WHOLE.has(one.role))) return null;
  return new Set(
    access.permitting
      .filter((one) => SUBJECTS.has(one.role))
      .flatMap((one) => one.subjectIds.map((id) => id.toLowerCase())),
  );
}

const percentOf = (part: number, whole: number): number | null =>
  whole === 0 ? null : Number(shownPercent(part, whole));

interface ReportBase {
  readonly branchId: string;
  readonly today: string;
  readonly now: Date;
  readonly timeZone: string;
  readonly quarters: readonly PlanQuarter[];
  readonly quarter: PlanQuarter | null;
  readonly journals: readonly JournalRow[];
  readonly owners: ReadonlyMap<string, string | null>;
  readonly names: ReadonlyMap<string, string>;
  readonly departmentOf: ReadonlyMap<
    string,
    { id: string; names: { uz: string; ru: string; en: string } } | null
  >;
  readonly departments: readonly { id: string; names: { uz: string; ru: string; en: string } }[];
  readonly list: PlanList;
  /** The planned journals of the year of subjects outside the reader's scope. */
  readonly otherSubjects: number;
}

const unitOf = (journal: JournalRow) => ({
  kind: journal.classId === null ? ('group' as const) : ('class' as const),
  id: journal.classId ?? journal.groupId ?? '',
  name: journal.unitName,
});

const subjectOf = (journal: JournalRow) => ({
  id: journal.subjectId,
  names: journal.subject.names,
  colour: subjectColourSchema.parse(journal.subject.colour),
});

@Injectable()
export class PlanReportsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly plans: PlansService,
  ) {}

  /** The quarter, the journals in the reader's scope with their owners and departments. */
  private async baseOf(
    transaction: Transaction,
    access: Access,
    query: PlanReportQuery,
  ): Promise<ReportBase> {
    const branchId = branchOf(access);
    const { today, now, timeZone } = await clockOf(transaction, branchId);
    const list = await this.plans.listIn(transaction, access, {});
    const quarters = list.quarters;
    let quarter: PlanQuarter | null;
    if (query.quarterId !== undefined) {
      const found = quarters.find((one) => one.id === query.quarterId?.toLowerCase());
      if (found === undefined) throw notFound();
      quarter = found;
    } else {
      quarter = quarterOfToday(quarters, today) ?? null;
    }
    const subjects = reportSubjects(access);
    const listed = new Set(list.plans.map((plan) => plan.journalId));
    const yearJournals =
      list.yearId === null ? [] : await journalRows(transaction, branchId, { yearId: list.yearId });
    const inScope = (journal: JournalRow) =>
      subjects === null || subjects.has(journal.subjectId.toLowerCase());
    // In one order (task 10.1b): `journalRows` gives the rows in no fixed order.
    const journals = yearJournals
      .filter((journal) => listed.has(journal.id) && inScope(journal))
      .sort((a, b) => a.id.localeCompare(b.id));
    // Other subjects' plans are counted, never named (decision 1).
    const otherSubjects = yearJournals.filter(
      (journal) => plannedJournal(journal) && !inScope(journal),
    ).length;
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
      const owner =
        quarter === null
          ? null
          : ownerOn(
              facts.runs.get(journal.id) ?? [],
              facts.periods.get(journal.id) ?? [],
              facts.out,
              referenceDateOf(quarter, today),
            );
      owners.set(journal.id, owner === null || owner.kind === 'none' ? null : owner.staffId);
    }
    const subjectIds = [...new Set(journals.map((journal) => journal.subjectId))];
    const departmentRows =
      subjectIds.length === 0
        ? []
        : await transaction
            .selectFrom('subjects')
            .innerJoin('departments', 'departments.id', 'subjects.department_id')
            .select([
              'subjects.id as subject_id',
              'departments.id',
              'departments.name_uz',
              'departments.name_ru',
              'departments.name_en',
              'departments.position',
            ])
            .where('subjects.id', 'in', subjectIds)
            .execute();
    const bySubject = new Map(
      departmentRows.map((row) => [
        row.subject_id,
        { id: row.id, names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en } },
      ]),
    );
    const departmentOf = new Map(
      journals.map((journal) => [journal.id, bySubject.get(journal.subjectId) ?? null]),
    );
    const departments = [
      ...new Map(
        [...departmentRows]
          .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
          .map((row) => [
            row.id,
            { id: row.id, names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en } },
          ]),
      ).values(),
    ];
    const names = await staffNames(transaction, [
      ...new Set([...owners.values()].flatMap((id) => (id === null ? [] : [id]))),
    ]);
    const filtered = journals.filter(
      (journal) =>
        (query.departmentId === undefined ||
          departmentOf.get(journal.id)?.id === query.departmentId.toLowerCase()) &&
        (query.teacherId === undefined || owners.get(journal.id) === query.teacherId.toLowerCase()),
    );
    return {
      branchId,
      today,
      now,
      timeZone,
      quarters,
      quarter,
      journals: filtered,
      owners,
      names,
      departmentOf,
      departments,
      list,
      otherSubjects,
    };
  }

  private teacherOf(base: ReportBase, journalId: string) {
    const id = base.owners.get(journalId) ?? null;
    return id === null ? null : { id, name: base.names.get(id) ?? '' };
  }

  /** The plans of the completeness report in a quarter. */
  private completenessRows(base: ReportBase, quarter: PlanQuarter) {
    const listed = new Map(base.list.plans.map((plan) => [plan.journalId, plan]));
    return base.journals.flatMap((journal) => {
      const found = listed.get(journal.id)?.quarters.find((one) => one.quarterId === quarter.id);
      if (found === undefined || found.state === 'no_lessons') return [];
      return [
        {
          journalId: journal.id,
          unit: unitOf(journal),
          subject: subjectOf(journal),
          teacher: this.teacherOf(base, journal.id),
          department: base.departmentOf.get(journal.id) ?? null,
          state: found.state,
          rows: found.rows,
          empty: found.empty,
          flag: found.flag,
          belowMinimum: found.belowMinimum,
        },
      ];
    });
  }

  /** `09`, Reports, Completeness. */
  completeness(access: Access, query: PlanReportQuery): Promise<PlanCompleteness> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.completenessIn(transaction, access, query),
    );
  }

  async completenessIn(
    transaction: Transaction,
    access: Access,
    query: PlanReportQuery,
  ): Promise<PlanCompleteness> {
    const base = await this.baseOf(transaction, access, query);
    const quarter = base.quarter;
    const plans = quarter === null ? [] : this.completenessRows(base, quarter);
    type Row = (typeof plans)[number];
    const countsOf = (rows: readonly Row[]) => {
      const complete = rows.filter((one) => one.state === 'complete').length;
      const incomplete = rows.filter((one) => one.state === 'incomplete');
      return {
        plans: rows.length,
        complete,
        incomplete: incomplete.length,
        noTopic: incomplete.reduce((sum, one) => sum + one.empty, 0),
        notStarted: rows.filter((one) => one.state === 'not_started').length,
        overdue: rows.filter((one) => one.flag === 'overdue').length,
        windowNotOpened: rows.filter((one) => one.flag === 'window_not_opened').length,
        belowMinimum: rows.filter((one) => one.belowMinimum !== null).length,
        percentComplete: percentOf(complete, rows.length),
      };
    };
    const group = <K>(key: (row: Row) => K, id: (value: K) => string) => {
      const found = new Map<string, { key: K; rows: Row[] }>();
      for (const row of plans) {
        const value = key(row);
        const entry = found.get(id(value)) ?? { key: value, rows: [] };
        entry.rows.push(row);
        found.set(id(value), entry);
      }
      return [...found.values()];
    };
    return planCompletenessSchema.parse({
      quarters: base.quarters,
      quarterId: quarter?.id ?? null,
      departments: base.departments,
      plans,
      teachers: group(
        (row) => row.teacher,
        (teacher) => teacher?.id ?? '',
      )
        .sort((a, b) => (a.key?.name ?? '').localeCompare(b.key?.name ?? '', 'en'))
        .map((entry) => ({ teacher: entry.key, counts: countsOf(entry.rows) })),
      byDepartment: group(
        (row) => row.department,
        (department) => department?.id ?? '',
      ).map((entry) => ({ department: entry.key, counts: countsOf(entry.rows) })),
      branch: countsOf(plans),
      otherSubjects: base.otherSubjects,
    });
  }

  /** `09`, Reports, Progress, with each teacher's share of "not held". */
  progress(access: Access, query: PlanReportQuery): Promise<PlanProgress> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.progressIn(transaction, access, query),
    );
  }

  async progressIn(
    transaction: Transaction,
    access: Access,
    query: PlanReportQuery,
  ): Promise<PlanProgress> {
    const base = await this.baseOf(transaction, access, query);
    const quarter = base.quarter;
    if (quarter === null || base.journals.length === 0) {
      return planProgressSchema.parse({
        quarters: base.quarters,
        quarterId: quarter?.id ?? null,
        departments: base.departments,
        plans: [],
        teachers: [],
        otherSubjects: base.otherSubjects,
        prepared: { updatedAt: null, updating: false },
      });
    }
    // Task 10.1b: what each journal counts, from the prepared `plan_progress` units (behind ones
    // from source by the same function).
    const freshness = new Freshness();
    const progress: Map<string, JournalProgress> = await preparedPlanProgress(
      {
        transaction,
        branchId: base.branchId,
        timeZone: base.timeZone,
        now: base.now,
        today: base.today,
      },
      quarter,
      base.journals,
      freshness,
    );
    const plans = [];
    const rowCounts = new Map<string, number>();
    // The planned works and those "not held" at each held lesson, for whom it counts.
    const heldLessons: (JournalProgress['heldLessons'][number] & { journalId: string })[] = [];
    for (const journal of base.journals) {
      const one = progress.get(journal.id);
      rowCounts.set(journal.id, one?.rows ?? 0);
      plans.push({
        journalId: journal.id,
        unit: unitOf(journal),
        subject: subjectOf(journal),
        teacher: this.teacherOf(base, journal.id),
        department: base.departmentOf.get(journal.id) ?? null,
        rows: one?.rows ?? 0,
        planned: one?.planned ?? 0,
        held: one?.held ?? 0,
        delivered: one?.delivered ?? 0,
        notCovered: 0,
        behind: (one?.delivered ?? 0) < (one?.held ?? 0),
      });
      for (const lesson of one?.heldLessons ?? [])
        heldLessons.push({ ...lesson, journalId: journal.id });
    }
    const uncovered = await notCoveredOf(
      transaction,
      base.journals.map((journal) => journal.id),
      quarter.id,
      (journalId) => rowCounts.get(journalId) ?? 0,
    );
    for (const plan of plans) {
      plan.notCovered = uncovered.get(plan.journalId) ?? 0;
      plan.behind ||= plan.notCovered > 0;
    }
    const counted = await lessonsCounted(transaction, base.branchId, heldLessons);
    const byTeacher = new Map<string, { planned: number; notHeld: number }>();
    for (const lesson of heldLessons) {
      const teacher = counted.get(lesson.id) ?? null;
      if (teacher === null) continue;
      const now = byTeacher.get(teacher) ?? { planned: 0, notHeld: 0 };
      byTeacher.set(teacher, {
        planned: now.planned + lesson.planned,
        notHeld: now.notHeld + lesson.notHeld,
      });
    }
    const names = await staffNames(transaction, [...byTeacher.keys()]);
    return planProgressSchema.parse({
      quarters: base.quarters,
      quarterId: quarter.id,
      departments: base.departments,
      plans,
      teachers: [...byTeacher]
        .map(([id, counts]) => ({
          teacher: { id, name: names.get(id) ?? '' },
          plannedWorks: counts.planned,
          notHeld: counts.notHeld,
          percentNotHeld: percentOf(counts.notHeld, counts.planned),
        }))
        .sort((a, b) => a.teacher.name.localeCompare(b.teacher.name, 'en')),
      otherSubjects: base.otherSubjects,
      prepared: freshness.stamp,
    });
  }

  /**
   * What the closing checklist reads of the plans of a quarter (task 10.1b, in place of the whole
   * completeness and progress reports): each plan of the completeness report with its state, and
   * the items not covered of every journal in scope, by the rule of the progress report
   * (`notCoveredOf`) over the plan's rows.
   */
  async closingPlansIn(
    transaction: Transaction,
    access: Access,
    quarterId: string,
  ): Promise<{
    plans: PlanCompleteness['plans'];
    notCovered: Map<string, number>;
  }> {
    const base = await this.baseOf(transaction, access, { quarterId });
    const quarter = base.quarter;
    if (quarter === null) return { plans: [], notCovered: new Map() };
    const listed = new Map(base.list.plans.map((plan) => [plan.journalId, plan]));
    const found = (journalId: string) =>
      listed.get(journalId)?.quarters.find((one) => one.quarterId === quarter.id);
    const plans = this.completenessRows(base, quarter);
    const notCovered = await notCoveredOf(
      transaction,
      base.journals.map((journal) => journal.id),
      quarter.id,
      (journalId) => found(journalId)?.rows ?? 0,
    );
    return { plans, notCovered };
  }

  /** `09`, Reports, Edit requests: "Number per teacher, who approved, what was changed". */
  requests(access: Access, query: PlanReportQuery): Promise<PlanRequestsReport> {
    return this.transactions.run(access.branchIds, (transaction) =>
      this.requestsIn(transaction, access, query),
    );
  }

  async requestsIn(
    transaction: Transaction,
    access: Access,
    query: PlanReportQuery,
  ): Promise<PlanRequestsReport> {
    const base = await this.baseOf(transaction, access, query);
    const quarter = base.quarter;
    const byJournal = new Map(base.journals.map((journal) => [journal.id, journal]));
    const rows =
      quarter === null || base.journals.length === 0
        ? []
        : await transaction
            .selectFrom('lesson_plan_requests')
            .leftJoin('staff', 'staff.account_id', 'lesson_plan_requests.decided_by')
            .select([
              'lesson_plan_requests.id',
              'lesson_plan_requests.journal_id',
              'lesson_plan_requests.kind',
              'lesson_plan_requests.status',
              'lesson_plan_requests.decided_at',
              'staff.id as decider',
            ])
            .where(
              'lesson_plan_requests.journal_id',
              'in',
              base.journals.map((journal) => journal.id),
            )
            .where('lesson_plan_requests.quarter_id', '=', quarter.id)
            .orderBy('lesson_plan_requests.id')
            .execute();
    const changes =
      rows.length === 0
        ? []
        : await transaction
            .selectFrom('audit_log')
            .select([
              'action',
              'occurred_at',
              sql<string>`req.value ->> 'id'`.as('request_id'),
              sql<string | null>`old_value ->> 'topic'`.as('topic_before'),
              sql<string | null>`new_value ->> 'topic'`.as('topic_after'),
            ])
            .innerJoin(
              sql<{
                value: unknown;
              }>`jsonb_array_elements(coalesce(details -> 'requests', '[]'::jsonb))`.as('req'),
              (join) => join.onTrue(),
            )
            .where('action', 'like', 'plan.%')
            .where(
              sql<string>`req.value ->> 'id'`,
              'in',
              rows.map((row) => row.id),
            )
            .orderBy('occurred_at')
            .execute();
    const deciders = await staffNames(transaction, [
      ...new Set(rows.flatMap((row) => (row.decider === null ? [] : [row.decider]))),
    ]);
    const byTeacher = new Map<string, PlanRequestsReport['teachers'][number]>();
    for (const row of rows) {
      const journal = byJournal.get(row.journal_id);
      if (journal === undefined) continue;
      const teacher = this.teacherOf(base, journal.id);
      const key = teacher?.id ?? '';
      const entry = byTeacher.get(key) ?? { teacher, total: 0, requests: [] };
      entry.total += 1;
      entry.requests.push({
        id: row.id,
        journalId: journal.id,
        unit: unitOf(journal),
        subject: subjectOf(journal),
        kind: row.kind as 'text' | 'replan' | 'extension',
        status: row.status as 'prepared' | 'sent' | 'approved' | 'refused' | 'void',
        decidedBy: row.decider === null ? null : (deciders.get(row.decider) ?? null),
        decidedOn: row.decided_at === null ? null : schoolDateOf(row.decided_at, base.timeZone),
        changes: changes
          .filter((change) => change.request_id === row.id)
          .map((change) => ({
            action: change.action,
            on: schoolDateOf(change.occurred_at, base.timeZone),
            topicBefore: change.topic_before,
            topicAfter: change.topic_after,
          })),
      });
      byTeacher.set(key, entry);
    }
    return planRequestsReportSchema.parse({
      quarters: base.quarters,
      quarterId: quarter?.id ?? null,
      departments: base.departments,
      teachers: [...byTeacher.values()].sort((a, b) =>
        (a.teacher?.name ?? '').localeCompare(b.teacher?.name ?? '', 'en'),
      ),
    });
  }
}
