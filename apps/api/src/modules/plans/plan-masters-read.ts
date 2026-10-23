import type { PlanMasterContent, PlanMasterItem, PlanWork, Role } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { journalRows } from '../journal/journal-grid.query.js';
import { notFound } from '../setup/setup-refusals.js';
import { compareMaster, masterUpdated, type CompareRow } from './plan-master-compare.js';
import { planJournalIds, planRows, worksOf, type PlanQuarter } from './plan-read.js';
import type { PlanReader } from './plan-scope.js';

/**
 * Reads of master plans (task 7.3, pull request #216). A master of another
 * branch is hidden by the row filter (`branch_or_school`, decision 1), so an
 * id of it is answered 404 like an unknown one.
 */

export interface MasterRow {
  readonly id: string;
  readonly branch_id: string | null;
  readonly subject_id: string;
  readonly grade: number;
  readonly language: 'uz' | 'ru';
  readonly start_year: number;
  readonly quarter: number;
  readonly name: string;
  readonly revision: number;
  readonly archived_at: Date | null;
}

/** The master named by a request, locked as asked (in a statement of its own, then read). */
export async function masterRowOf(
  transaction: Transaction,
  masterId: string,
  lock: 'update' | 'share' | null = null,
): Promise<MasterRow> {
  if (lock !== null) {
    let locking = transaction
      .selectFrom('lesson_plan_masters')
      .select('id')
      .where('id', '=', masterId);
    locking = lock === 'update' ? locking.forUpdate() : locking.forShare();
    await locking.execute();
  }
  const found = await transaction
    .selectFrom('lesson_plan_masters')
    .select([
      'id',
      'branch_id',
      'subject_id',
      'grade',
      'language',
      'start_year',
      'quarter',
      'name',
      'revision',
      'archived_at',
    ])
    .where('id', '=', masterId)
    .executeTakeFirst();
  if (found === undefined) throw notFound();
  return { ...found, language: found.language as 'uz' | 'ru' };
}

const WHOLE_ROLES: readonly Role[] = ['super_admin', 'principal', 'academic_vice_principal'];

const SUBJECT_ROLES: readonly Role[] = ['head_teacher', 'senior_head_teacher'];

/**
 * Who reads a master (decision 2): the whole-branch roles, the Head Teachers
 * and Senior Head Teacher of its subject, and a teacher with its subject and
 * grade in the profile (`edge/lesson-plans`, "Who may read a plan?", as for
 * plans). A teacher who owns a plan the master fits reads it through that
 * plan (spec review of the plan, note 13), decided by the caller.
 */
export function readsMaster(reader: PlanReader, master: MasterRow): boolean {
  const subject = master.subject_id.toLowerCase();
  if (
    reader.access.permitting.some(
      (assignment) =>
        WHOLE_ROLES.includes(assignment.role) ||
        (SUBJECT_ROLES.includes(assignment.role) && assignment.subjectIds.includes(subject)),
    )
  ) {
    return true;
  }
  return (reader.profile.get(subject) ?? []).includes(master.grade);
}

/** The start year of an academic year (its name is "<start>-<end>", 0016). */
export async function startYearOf(transaction: Transaction, yearId: string): Promise<number> {
  const year = await transaction
    .selectFrom('academic_years')
    .select(sql<number>`extract(year from start_date)::int`.as('start_year'))
    .where('id', '=', yearId)
    .executeTakeFirst();
  if (year === undefined) throw notFound();
  return year.start_year;
}

interface MasterItemRow {
  readonly id: string;
  readonly position: number;
  readonly topic: string;
  readonly objectives: string;
  readonly links: string[];
  readonly added_revision: number;
  readonly changed_revision: number;
  readonly removed_revision: number | null;
}

export interface MasterItemRead extends PlanMasterItem {
  readonly added: number;
  readonly changed: number;
  readonly removed: number | null;
}

/** The items of a master with their works, in order; the removed ones too when asked. */
export async function masterItemsOf(
  transaction: Transaction,
  masterId: string,
  withRemoved = false,
): Promise<MasterItemRead[]> {
  let query = transaction
    .selectFrom('lesson_plan_master_items')
    .select([
      'id',
      'position',
      'topic',
      'objectives',
      'links',
      'added_revision',
      'changed_revision',
      'removed_revision',
    ])
    .where('master_id', '=', masterId);
  if (!withRemoved) query = query.where('removed_revision', 'is', null);
  const items: MasterItemRow[] = await query.orderBy('position').orderBy('id').execute();
  const works =
    items.length === 0
      ? []
      : await transaction
          .selectFrom('lesson_plan_master_works')
          .select(['id', 'item_id', 'kind', 'title', 'description'])
          .where(
            'item_id',
            'in',
            items.map((item) => item.id),
          )
          .orderBy('position')
          .orderBy('id')
          .execute();
  return items.map((item) => {
    const own = works.filter((work) => work.item_id === item.id);
    const pick = (kind: string): PlanWork[] =>
      own
        .filter((work) => work.kind === kind)
        .map((work) => ({ id: work.id, title: work.title, description: work.description }));
    return {
      id: item.id,
      position: item.position,
      topic: item.topic,
      objectives: item.objectives,
      links: item.links,
      classworks: pick('classwork'),
      homeworks: pick('homework'),
      added: item.added_revision,
      changed: item.changed_revision,
      removed: item.removed_revision,
    };
  });
}

/** The content the comparison shows: the works without their ids. */
export const contentOf = (item: {
  topic: string;
  objectives: string;
  links: readonly string[];
  classworks: readonly { title: string; description: string }[];
  homeworks: readonly { title: string; description: string }[];
}): PlanMasterContent => ({
  topic: item.topic,
  objectives: item.objectives,
  links: [...item.links],
  classworks: item.classworks.map((work) => ({ title: work.title, description: work.description })),
  homeworks: item.homeworks.map((work) => ({ title: work.title, description: work.description })),
});

/** What the comparison of a plan needs to know of its quarter and clock. */
export interface CompareScene {
  readonly branchId: string;
  readonly quarter: PlanQuarter;
  readonly timeZone: string;
  readonly now: Date;
}

/**
 * The comparison of a plan with its master (decision 5): the master's items,
 * removed ones included, against the plan's items copied from them; an item
 * is held when its row has started in any journal of the plan.
 */
export async function compareRowsOf(
  transaction: Transaction,
  scene: CompareScene,
  planId: string,
  masterId: string,
  since: number,
): Promise<CompareRow[]> {
  const masterItems = await masterItemsOf(transaction, masterId, true);
  const items = await transaction
    .selectFrom('lesson_plan_items')
    .select(['id', 'topic', 'objectives', 'links', 'master_item_id'])
    .where('plan_id', '=', planId)
    .where('cleared_at', 'is', null)
    .where('master_item_id', 'is not', null)
    .orderBy('id')
    .execute();
  const works = await worksOf(
    transaction,
    items.map((item) => item.id),
  );
  const held = new Set<string>();
  for (const journalId of await planJournalIds(transaction, planId)) {
    const [journal] = await journalRows(transaction, scene.branchId, { journalId });
    if (journal === undefined) continue;
    const rows = await planRows(
      transaction,
      scene.branchId,
      journal,
      scene.quarter,
      scene.timeZone,
      scene.now,
    );
    const started = rows.filter((row) => row.started).length;
    const places = await transaction
      .selectFrom('lesson_plan_places')
      .select(['item_id', 'position'])
      .where('plan_id', '=', planId)
      .where('journal_id', '=', journalId)
      .execute();
    for (const place of places) if (place.position <= started) held.add(place.item_id);
  }
  return compareMaster(
    masterItems.map((item) => ({
      id: item.id,
      position: item.position,
      added: item.added,
      changed: item.changed,
      removed: item.removed,
      content: contentOf(item),
    })),
    since,
    items.map((item) => {
      const own = works.get(item.id) ?? { classworks: [], homeworks: [] };
      return {
        itemId: item.id,
        masterItemId: item.master_item_id ?? '',
        content: contentOf({ ...item, ...own }),
        held: held.has(item.id),
      };
    }),
  );
}

/** The master link of a plan, or `null`. */
export async function planMasterOf(
  transaction: Transaction,
  planId: string,
): Promise<{ masterId: string; revision: number } | null> {
  const plan = await transaction
    .selectFrom('lesson_plans')
    .select(['master_id', 'master_revision'])
    .where('id', '=', planId)
    .executeTakeFirst();
  if (plan?.master_id == null || plan.master_revision === null) return null;
  return { masterId: plan.master_id, revision: plan.master_revision };
}

/** The master mark of a plan for its answer (`09`: "master updated"; decision 12). */
export async function planMasterMark(
  transaction: Transaction,
  scene: CompareScene,
  planId: string | null,
): Promise<{ id: string; name: string; scope: 'branch' | 'all'; updated: boolean } | null> {
  if (planId === null) return null;
  const link = await planMasterOf(transaction, planId);
  if (link === null) return null;
  const master = await masterRowOf(transaction, link.masterId);
  const updated =
    master.revision > link.revision &&
    masterUpdated(await compareRowsOf(transaction, scene, planId, master.id, link.revision));
  return {
    id: master.id,
    name: master.name,
    scope: master.branch_id === null ? 'all' : 'branch',
    updated,
  };
}
