import { Injectable } from '@nestjs/common';
import {
  PERMISSIONS,
  permits,
  planMinimumsSchema,
  type PlanMinimumMark,
  type PlanMinimumSave,
  type PlanMinimums,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';

/**
 * The minimum works of a subject per quarter (task 8.8, pull request #226,
 * decision 11; `edge/lesson-plans`, "A plan has 40 topics and not one graded
 * work": "Each subject can have a minimum number of classworks and homeworks
 * per quarter, set by the Academic Vice Principal. Falling below it is a
 * warning at the end of the window and on the closing checklist."). One row
 * per subject and branch, for every quarter; 0 is no minimum. The count is
 * every planned work of the items on the journal's rows ("not held" counts:
 * the share of "not held" is the progress report's own figure).
 */

export interface Minimum {
  readonly classworks: number;
  readonly homeworks: number;
}

/** The minimums of subjects in the branch of the transaction. */
export async function minimumsOf(
  transaction: Transaction,
  subjectIds: readonly string[],
): Promise<Map<string, Minimum>> {
  if (subjectIds.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('subject_plan_minimums')
    .select(['subject_id', 'classworks', 'homeworks'])
    .where('subject_id', 'in', [...new Set(subjectIds)])
    .execute();
  return new Map(
    rows.map((row) => [row.subject_id, { classworks: row.classworks, homeworks: row.homeworks }]),
  );
}

/**
 * The planned works of each plan's journal on its rows (`<journal>|<quarter>`
 * keys, `rows` the number of rows of each key): the works of the items at a
 * place from 1 to the last row; an item not covered is on no row.
 */
export async function plannedWorkCounts(
  transaction: Transaction,
  links: readonly { planId: string; journalId: string; quarterId: string }[],
  rows: ReadonlyMap<string, number>,
): Promise<Map<string, Minimum>> {
  const found = new Map<string, Minimum>();
  if (links.length === 0) return found;
  const keyOf = new Map(links.map((link) => [`${link.planId}|${link.journalId}`, link]));
  const counted = await transaction
    .selectFrom('lesson_plan_places')
    .innerJoin('lesson_plan_works', 'lesson_plan_works.item_id', 'lesson_plan_places.item_id')
    .select([
      'lesson_plan_places.plan_id',
      'lesson_plan_places.journal_id',
      'lesson_plan_places.position',
      'lesson_plan_works.kind',
      sql<number>`count(*)::int`.as('works'),
    ])
    .where('lesson_plan_places.plan_id', 'in', [...new Set(links.map((link) => link.planId))])
    .groupBy([
      'lesson_plan_places.plan_id',
      'lesson_plan_places.journal_id',
      'lesson_plan_places.position',
      'lesson_plan_works.kind',
    ])
    .execute();
  for (const row of counted) {
    const link = keyOf.get(`${row.plan_id}|${row.journal_id}`);
    if (link === undefined) continue;
    const key = `${link.journalId}|${link.quarterId}`;
    if (row.position > (rows.get(key) ?? 0)) continue;
    const now = found.get(key) ?? { classworks: 0, homeworks: 0 };
    found.set(key, {
      classworks: now.classworks + (row.kind === 'classwork' ? row.works : 0),
      homeworks: now.homeworks + (row.kind === 'homework' ? row.works : 0),
    });
  }
  return found;
}

/** The mark of a plan below its minimum once the owner's window has ended, else `null`. */
export function minimumMarkOf(
  minimum: Minimum | undefined,
  counts: Minimum | undefined,
  windowEnded: boolean,
): PlanMinimumMark | null {
  if (!windowEnded || minimum === undefined) return null;
  const classworks = counts?.classworks ?? 0;
  const homeworks = counts?.homeworks ?? 0;
  if (classworks >= minimum.classworks && homeworks >= minimum.homeworks) return null;
  return {
    classworks,
    homeworks,
    minimumClassworks: minimum.classworks,
    minimumHomeworks: minimum.homeworks,
  };
}

@Injectable()
export class PlanMinimumsService {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /** The graded subjects of the school with their minimum in the branch. */
  list(access: Access): Promise<PlanMinimums> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const subjects = await transaction
        .selectFrom('subjects')
        .leftJoin('subject_plan_minimums', 'subject_plan_minimums.subject_id', 'subjects.id')
        .select([
          'subjects.id',
          'subjects.name_uz',
          'subjects.name_ru',
          'subjects.name_en',
          'subjects.colour',
          'subject_plan_minimums.classworks',
          'subject_plan_minimums.homeworks',
          'subject_plan_minimums.version',
        ])
        .where('subjects.archived_at', 'is', null)
        .where('subjects.journal_type', '<>', 'attendance_only')
        .orderBy('subjects.name_en')
        .execute();
      return planMinimumsSchema.parse({
        subjects: subjects.map((row) => ({
          subject: {
            id: row.id,
            names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
            colour: row.colour,
          },
          classworks: row.classworks ?? 0,
          homeworks: row.homeworks ?? 0,
          version: row.version,
        })),
        canEdit: access.permitting.some((one) =>
          permits(PERMISSIONS, one.role, 'plan_windows', 'edit'),
        ),
      });
    });
  }

  /** Sets the minimum of one subject in the branch, on the version read. */
  save(access: Access, input: PlanMinimumSave, requestId: string): Promise<PlanMinimums> {
    const branchId = branchOf(access);
    return this.transactions
      .run(access.branchIds, async (transaction) => {
        const subject = await transaction
          .selectFrom('subjects')
          .select(['id', 'journal_type', 'archived_at'])
          .where('id', '=', input.subjectId)
          .executeTakeFirst();
        if (subject === undefined) throw notFound();
        if (subject.archived_at !== null || subject.journal_type === 'attendance_only') {
          throw new ApiException('plan_attendance_only', 409);
        }
        const stored = await transaction
          .selectFrom('subject_plan_minimums')
          .select(['id', 'classworks', 'homeworks', 'version'])
          .where('subject_id', '=', subject.id)
          .forUpdate()
          .executeTakeFirst();
        if ((stored?.version ?? null) !== input.version) {
          throw new ApiException('plan_minimum_stale', 409);
        }
        if (stored === undefined) {
          await transaction
            .insertInto('subject_plan_minimums')
            .values({
              branch_id: branchId,
              subject_id: subject.id,
              classworks: input.classworks,
              homeworks: input.homeworks,
              changed_by: access.accountId,
            })
            .onConflict((conflict) => conflict.columns(['branch_id', 'subject_id']).doNothing())
            .execute();
        } else {
          await transaction
            .updateTable('subject_plan_minimums')
            .set({
              classworks: input.classworks,
              homeworks: input.homeworks,
              version: stored.version + 1,
              changed_by: access.accountId,
              changed_at: sql<Date>`now()`,
            })
            .where('id', '=', stored.id)
            .execute();
        }
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'plan.minimums',
          record: { type: 'subject', id: subject.id },
          oldValue:
            stored === undefined
              ? null
              : { classworks: stored.classworks, homeworks: stored.homeworks },
          newValue: { classworks: input.classworks, homeworks: input.homeworks },
          requestId,
        });
      })
      .then(() => this.list(access));
  }
}
