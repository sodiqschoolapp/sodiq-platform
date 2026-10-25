import { planOutcomeKindSchema, type PlanOutcome } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { accountOfStaff, postHolders, postsOf } from '../access/request-posts.js';
import { decisionReach } from '../access/request-routing.js';
import type { Audit } from '../audit/audit.service.js';
import { plannedJournal, staffNames, type JournalRow } from '../journal/journal-grid.query.js';
import { quarterClosedNow } from '../setup/closed-quarters.js';
import { copyItems } from './plan-separate.js';
import {
  lockJournals,
  movePlaces,
  planIdOf,
  planJournalIds,
  planRows,
  type PlanQuarter,
} from './plan-read.js';

/**
 * The outcomes of "not covered" items and the "carried in" tray (task 9.2d, pull request #233;
 * `edge/lesson-plans`, Plans and the journal, "Items are still 'not covered' at the end of the
 * quarter": "Each item gets one outcome: merged into a lesson, carried, or dropped with a reason;
 * only the approver can drop. Carried items wait in a 'carried in' tray on the next quarter's
 * plan. Items unresolved at closing are carried automatically. In quarter 4 only merge or drop
 * exist."). The writes both the routes (`plan-outcomes.service.ts`) and the close
 * (`closing.service.ts`) make; nothing here checks who may do it.
 *
 * An item is not covered in a journal when its place there stands past the journal's last row,
 * or when it waits in the journal's tray (decision 10). An outcome takes it out of that journal
 * only: its place (and the later places past the last row move up one step, so no gap is left to
 * absorb a later shift: `edge`, "The shift stops at the first empty row") or its tray row. An item
 * left with no place in any journal and no tray row is cleared.
 */

/**
 * Takes the next quarter `for key share` with no refusal, before any journal is locked: the close
 * of that quarter locks it `for update` before its journals (`holdQuarter` of `plans.service.ts`).
 */
export async function holdQuarter(transaction: Transaction, quarterId: string): Promise<void> {
  await transaction
    .selectFrom('quarters')
    .select('id')
    .where('id', '=', quarterId)
    .forKeyShare()
    .execute();
}

/** Who writes, for the rows and the audit entries. */
export interface OutcomeActor {
  readonly branchId: string;
  readonly accountId: string;
  readonly assignmentId: string;
  readonly requestId?: string;
}

/** Where a not-covered item stands in its journal. */
export type NotCoveredAt =
  | { readonly kind: 'place'; readonly planId: string; readonly position: number }
  | { readonly kind: 'tray' };

/**
 * Where the item is not covered in the journal and quarter, or `null` when it is not (it stands at
 * a row, or it has its outcome). `rowCount` is the journal's rows in the quarter.
 */
export async function notCoveredAt(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
  itemId: string,
  rowCount: number,
): Promise<NotCoveredAt | null> {
  const planId = await planIdOf(transaction, journalId, quarterId);
  if (planId !== null) {
    const place = await transaction
      .selectFrom('lesson_plan_places')
      .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_places.item_id')
      .select('lesson_plan_places.position')
      .where('lesson_plan_places.plan_id', '=', planId)
      .where('lesson_plan_places.journal_id', '=', journalId)
      .where('lesson_plan_places.item_id', '=', itemId)
      .where('lesson_plan_items.cleared_at', 'is', null)
      .executeTakeFirst();
    if (place !== undefined) {
      return place.position > rowCount ? { kind: 'place', planId, position: place.position } : null;
    }
  }
  const tray = await transaction
    .selectFrom('lesson_plan_tray')
    .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_tray.item_id')
    .select('lesson_plan_tray.item_id')
    .where('lesson_plan_tray.journal_id', '=', journalId)
    .where('lesson_plan_tray.quarter_id', '=', quarterId)
    .where('lesson_plan_tray.item_id', '=', itemId)
    .where('lesson_plan_items.cleared_at', 'is', null)
    .executeTakeFirst();
  return tray === undefined ? null : { kind: 'tray' };
}

/** The items of a journal not covered in a quarter: past the last row, then the tray. */
export async function notCoveredItemIds(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
  rowCount: number,
): Promise<string[]> {
  const planId = await planIdOf(transaction, journalId, quarterId);
  const past =
    planId === null
      ? []
      : await transaction
          .selectFrom('lesson_plan_places')
          .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_places.item_id')
          .select('lesson_plan_places.item_id')
          .where('lesson_plan_places.plan_id', '=', planId)
          .where('lesson_plan_places.journal_id', '=', journalId)
          .where('lesson_plan_places.position', '>', rowCount)
          .where('lesson_plan_items.cleared_at', 'is', null)
          .orderBy('lesson_plan_places.position')
          .execute();
  const tray = await trayCounts(transaction, [journalId], quarterId, true);
  return [...past.map((row) => row.item_id), ...(tray.ids.get(journalId) ?? [])];
}

/** The tray items of journals in a quarter, not cleared: their count, and their ids when asked. */
export async function trayCounts(
  transaction: Transaction,
  journalIds: readonly string[],
  quarterId: string,
  withIds = false,
): Promise<{ counts: Map<string, number>; ids: Map<string, string[]> }> {
  const counts = new Map<string, number>();
  const ids = new Map<string, string[]>();
  if (journalIds.length === 0) return { counts, ids };
  const rows = await transaction
    .selectFrom('lesson_plan_tray')
    .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_tray.item_id')
    .select(['lesson_plan_tray.journal_id', 'lesson_plan_tray.item_id'])
    .where('lesson_plan_tray.journal_id', 'in', [...journalIds])
    .where('lesson_plan_tray.quarter_id', '=', quarterId)
    .where('lesson_plan_items.cleared_at', 'is', null)
    .orderBy('lesson_plan_tray.outcome_id')
    .execute();
  for (const row of rows) {
    counts.set(row.journal_id, (counts.get(row.journal_id) ?? 0) + 1);
    if (withIds) ids.set(row.journal_id, [...(ids.get(row.journal_id) ?? []), row.item_id]);
  }
  return { counts, ids };
}

/** The next quarter of the quarter's year, or `null` for the last one. */
export async function nextQuarterOf(
  transaction: Transaction,
  quarterId: string,
): Promise<string | null> {
  const { rows } = await sql<{ id: string | null }>`
    select quarter_next(${quarterId}::uuid) as id
  `.execute(transaction);
  return rows[0]?.id ?? null;
}

/**
 * Whether no carry is possible from the quarter (decision 11): it is the last of its year, or its
 * next quarter is closed (`edge/lesson-plans`: "Nothing is possible in a closed quarter").
 */
export async function carryClosedFrom(
  transaction: Transaction,
  quarterId: string,
): Promise<boolean> {
  const next = await nextQuarterOf(transaction, quarterId);
  return next === null || (await quarterClosedNow(transaction, next));
}

/**
 * Takes the item out of the journal's not-covered list: its place, with the later places past the
 * last row one step up, or its tray row; then clears it when no journal holds it any more.
 */
export async function leaveNotCovered(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
  itemId: string,
  at: NotCoveredAt,
): Promise<void> {
  if (at.kind === 'place') {
    await transaction
      .deleteFrom('lesson_plan_places')
      .where('plan_id', '=', at.planId)
      .where('journal_id', '=', journalId)
      .where('item_id', '=', itemId)
      .execute();
    const later = await transaction
      .selectFrom('lesson_plan_places')
      .select(['item_id', 'position'])
      .where('plan_id', '=', at.planId)
      .where('journal_id', '=', journalId)
      .where('position', '>', at.position)
      .orderBy('position')
      .execute();
    await movePlaces(
      transaction,
      at.planId,
      journalId,
      new Map(later.map((row) => [row.item_id, row.position - 1])),
    );
  } else {
    await transaction
      .deleteFrom('lesson_plan_tray')
      .where('journal_id', '=', journalId)
      .where('quarter_id', '=', quarterId)
      .where('item_id', '=', itemId)
      .execute();
  }
  await clearIfLoose(transaction, itemId);
}

/** Clears an item that no journal holds any more: no place and no tray row. */
async function clearIfLoose(transaction: Transaction, itemId: string): Promise<void> {
  const place = await transaction
    .selectFrom('lesson_plan_places')
    .select('item_id')
    .where('item_id', '=', itemId)
    .executeTakeFirst();
  const tray = await transaction
    .selectFrom('lesson_plan_tray')
    .select('item_id')
    .where('item_id', '=', itemId)
    .executeTakeFirst();
  if (place !== undefined || tray !== undefined) return;
  await transaction
    .updateTable('lesson_plan_items')
    .set({ cleared_at: await transactionMoment(transaction) })
    .where('id', '=', itemId)
    .where('cleared_at', 'is', null)
    .execute();
}

/** Writes the outcome row (the trigger of 0136 checks the quarter and the kind). */
export async function writeOutcome(
  transaction: Transaction,
  actor: OutcomeActor,
  values: {
    readonly journalId: string;
    readonly quarterId: string;
    readonly itemId: string;
    readonly kind: 'merged' | 'carried' | 'dropped';
    readonly targetDate?: string;
    readonly reason?: string;
    readonly automatic?: boolean;
    readonly carriedItemId?: string;
  },
): Promise<string> {
  const row = await transaction
    .insertInto('lesson_plan_outcomes')
    .values({
      branch_id: actor.branchId,
      journal_id: values.journalId,
      quarter_id: values.quarterId,
      item_id: values.itemId,
      kind: values.kind,
      target_date: values.targetDate ?? null,
      reason: values.reason ?? '',
      automatic: values.automatic ?? false,
      decided_by: actor.accountId,
      decided_at: await transactionMoment(transaction),
      carried_item_id: values.carriedItemId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
}

/**
 * The plan of a journal in a quarter, made when missing, with its link, the mark that lays it
 * before the commit (task 7.1b) and its audit entry (`PlansService.planFor`).
 */
export async function ensurePlan(
  transaction: Transaction,
  audit: Audit,
  actor: OutcomeActor,
  journal: Pick<JournalRow, 'id' | 'subjectId'>,
  quarterId: string,
): Promise<string> {
  const found = await planIdOf(transaction, journal.id, quarterId);
  if (found !== null) return found;
  const plan = await transaction
    .insertInto('lesson_plans')
    .values({ branch_id: actor.branchId, quarter_id: quarterId, subject_id: journal.subjectId })
    .returning('id')
    .executeTakeFirstOrThrow();
  await transaction
    .insertInto('lesson_plan_journals')
    .values({
      branch_id: actor.branchId,
      plan_id: plan.id,
      journal_id: journal.id,
      quarter_id: quarterId,
    })
    .execute();
  // Task 7.1b: the plan is laid on its rows before the commit (its snapshot, `PlanFollow`).
  await transaction
    .insertInto('lesson_plan_follow_marks')
    .values({ branch_id: actor.branchId, journal_id: journal.id })
    .execute();
  await audit.record(transaction, {
    branchId: actor.branchId,
    actorId: actor.accountId,
    assignmentId: actor.assignmentId,
    action: 'plan.create',
    record: { type: 'lesson_plan', id: plan.id },
    newValue: { journalId: journal.id, quarterId },
    ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
  });
  return plan.id;
}

/**
 * Carries the item into the next quarter's tray of the journal (decision 13: a copy of the content,
 * `copied_from`, no master link): the outcome, the copy, the tray row, then the item leaves the
 * journal's list. The caller holds the next quarter (`holdQuarter`) and the journals of both
 * plans, and writes the audit entry. Gives the copy and the plan it is in.
 */
export async function carryItem(
  transaction: Transaction,
  audit: Audit,
  actor: OutcomeActor,
  input: {
    readonly journal: Pick<JournalRow, 'id' | 'subjectId'>;
    readonly quarterId: string;
    readonly nextQuarterId: string;
    readonly itemId: string;
    readonly at: NotCoveredAt;
    readonly automatic: boolean;
  },
): Promise<{ copyId: string; planId: string }> {
  const planId = await ensurePlan(transaction, audit, actor, input.journal, input.nextQuarterId);
  const made = await copyItems(transaction, actor.branchId, planId, [input.itemId], false);
  const copyId = made.get(input.itemId);
  if (copyId === undefined) throw new Error('carryItem: the item was not copied');
  const outcomeId = await writeOutcome(transaction, actor, {
    journalId: input.journal.id,
    quarterId: input.quarterId,
    itemId: input.itemId,
    kind: 'carried',
    automatic: input.automatic,
    carriedItemId: copyId,
  });
  await transaction
    .insertInto('lesson_plan_tray')
    .values({
      branch_id: actor.branchId,
      journal_id: input.journal.id,
      quarter_id: input.nextQuarterId,
      item_id: copyId,
      outcome_id: outcomeId,
    })
    .execute();
  await leaveNotCovered(transaction, input.journal.id, input.quarterId, input.itemId, input.at);
  return { copyId, planId };
}

/**
 * Locks the journals of the plans of `journalIds` in both quarters, in the order of the id, the
 * links read again after each lock until none is missing (`PlansService.lockPlanOf` over a set).
 */
export async function lockPlansOf(
  transaction: Transaction,
  journalIds: readonly string[],
  quarterIds: readonly string[],
): Promise<void> {
  const locked = new Set<string>();
  for (;;) {
    const all = new Set<string>(journalIds);
    for (const journalId of journalIds) {
      for (const quarterId of quarterIds) {
        const planId = await planIdOf(transaction, journalId, quarterId);
        if (planId === null) continue;
        for (const id of await planJournalIds(transaction, planId)) all.add(id);
      }
    }
    const missing = [...all].filter((id) => !locked.has(id)).sort();
    if (missing.length === 0) return;
    await lockJournals(transaction, missing);
    for (const id of missing) locked.add(id);
  }
}

/**
 * Separation (`plan-separate.ts`): the journal's tray items of the plan's quarter go with it, as
 * copies in the new plan, and its tray rows name the copies (plan review, must-fix 1). Gives the
 * copies made.
 */
export async function separateTray(
  transaction: Transaction,
  branchId: string,
  oldPlanId: string,
  newPlanId: string,
  journalId: string,
): Promise<Map<string, string>> {
  const plan = await transaction
    .selectFrom('lesson_plans')
    .select('quarter_id')
    .where('id', '=', oldPlanId)
    .executeTakeFirstOrThrow();
  const tray = await transaction
    .selectFrom('lesson_plan_tray')
    .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_tray.item_id')
    .select('lesson_plan_tray.item_id')
    .where('lesson_plan_tray.journal_id', '=', journalId)
    .where('lesson_plan_tray.quarter_id', '=', plan.quarter_id)
    .where('lesson_plan_items.plan_id', '=', oldPlanId)
    .where('lesson_plan_items.cleared_at', 'is', null)
    .orderBy('lesson_plan_tray.outcome_id')
    .execute();
  const made = await copyItems(
    transaction,
    branchId,
    newPlanId,
    tray.map((row) => row.item_id),
    true,
    true,
  );
  for (const [old, copy] of made) {
    await transaction
      .updateTable('lesson_plan_tray')
      .set({ item_id: copy })
      .where('journal_id', '=', journalId)
      .where('quarter_id', '=', plan.quarter_id)
      .where('item_id', '=', old)
      .execute();
    await clearIfLoose(transaction, old);
  }
  return made;
}

/**
 * The reach of a reader over the requests of the plan's owner (`PlanRequestsService`): `decide`
 * is the approver, who alone drops (decision 3: "only the approver can drop"); `own` is the
 * owner, refused as a request of their own.
 */
export async function dropReachOf(
  transaction: Transaction,
  accountId: string,
  branchId: string,
  journal: Pick<JournalRow, 'subjectId'>,
  ownerStaffId: string | null,
  now: Date,
): Promise<{ reach: 'decide' | 'own' | 'none'; ownerAccountId: string | null }> {
  const ownerAccountId = await accountOfStaff(transaction, ownerStaffId);
  const holders = await postHolders(transaction, branchId, journal.subjectId, now);
  const reach = decisionReach(
    { accountId, posts: postsOf(holders, accountId) },
    { accountId: ownerAccountId, posts: postsOf(holders, ownerAccountId) },
  );
  return { reach, ownerAccountId };
}

/** The outcomes of a journal's not-covered items in a quarter, oldest first, as the plan shows them. */
export async function outcomesOf(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
): Promise<PlanOutcome[]> {
  const rows = await transaction
    .selectFrom('lesson_plan_outcomes')
    .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_outcomes.item_id')
    .leftJoin('staff', 'staff.account_id', 'lesson_plan_outcomes.decided_by')
    .select([
      'lesson_plan_outcomes.id',
      'lesson_plan_outcomes.item_id',
      'lesson_plan_items.topic',
      'lesson_plan_outcomes.kind',
      sql<string | null>`lesson_plan_outcomes.target_date::text`.as('target_date'),
      'lesson_plan_outcomes.reason',
      'lesson_plan_outcomes.automatic',
      'lesson_plan_outcomes.decided_at',
      'staff.id as staff_id',
    ])
    .where('lesson_plan_outcomes.journal_id', '=', journalId)
    .where('lesson_plan_outcomes.quarter_id', '=', quarterId)
    .orderBy('lesson_plan_outcomes.decided_at')
    .orderBy('lesson_plan_outcomes.id')
    .execute();
  const names = await staffNames(
    transaction,
    rows.flatMap((row) => (row.staff_id === null ? [] : [row.staff_id])),
  );
  return rows.map((row) => ({
    id: row.id,
    itemId: row.item_id,
    topic: row.topic,
    kind: planOutcomeKindSchema.parse(row.kind),
    targetDate: row.target_date,
    reason: row.reason,
    automatic: row.automatic,
    decidedBy: row.staff_id === null ? null : (names.get(row.staff_id) ?? null),
    decidedAt: row.decided_at.toISOString(),
  }));
}

/**
 * The journals among `journalIds` that run on `date` (`journals.runs`): a journal whose runs end
 * before the quarter's last day (its subject removed from the class, its class archived) is
 * "closed with the journal" (`09`) and gets no carry, nor blocks a close (review correction 2).
 */
export async function journalsRunningOn(
  transaction: Transaction,
  journalIds: readonly string[],
  date: string,
): Promise<Set<string>> {
  if (journalIds.length === 0) return new Set();
  const rows = await transaction
    .selectFrom('journals')
    .select('id')
    .where('id', 'in', [...journalIds])
    .where(sql<boolean>`runs @> ${date}::date`)
    .execute();
  return new Set(rows.map((row) => row.id));
}

/**
 * The close's own carry (`edge/lesson-plans`: "Items unresolved at closing are carried
 * automatically"; decision 12): every item still not covered in the journals given, of those
 * that run on the quarter's last day, goes into the next quarter's tray, written by the closer
 * with `automatic`. The caller holds the quarter; this holds the next quarter and the journals of
 * both quarters' plans, in that order, before it reads (plan review, must-fix 5). Nothing is
 * carried from the last quarter or into a closed one: the checklist's `plan_not_covered` refused
 * that close first. Gives what it carried, for the audit entry.
 */
export async function carryUnresolved(
  transaction: Transaction,
  audit: Audit,
  actor: OutcomeActor,
  input: {
    readonly quarter: PlanQuarter;
    readonly journals: readonly JournalRow[];
    readonly timeZone: string;
    readonly now: Date;
  },
): Promise<{ journalId: string; itemId: string; copyId: string }[]> {
  const next = await nextQuarterOf(transaction, input.quarter.id);
  if (next === null) return [];
  await holdQuarter(transaction, next);
  if (await quarterClosedNow(transaction, next)) return [];
  const running = await journalsRunningOn(
    transaction,
    input.journals.map((journal) => journal.id),
    input.quarter.endDate,
  );
  const journals = input.journals
    .filter((journal) => running.has(journal.id) && plannedJournal(journal))
    .sort((a, b) => a.id.localeCompare(b.id));
  await lockPlansOf(
    transaction,
    journals.map((journal) => journal.id),
    [input.quarter.id, next],
  );
  const carried: { journalId: string; itemId: string; copyId: string }[] = [];
  for (const journal of journals) {
    const rows = await planRows(
      transaction,
      actor.branchId,
      journal,
      input.quarter,
      input.timeZone,
      input.now,
    );
    for (const itemId of await notCoveredItemIds(
      transaction,
      journal.id,
      input.quarter.id,
      rows.length,
    )) {
      const at = await notCoveredAt(transaction, journal.id, input.quarter.id, itemId, rows.length);
      if (at === null) continue;
      const { copyId } = await carryItem(transaction, audit, actor, {
        journal,
        quarterId: input.quarter.id,
        nextQuarterId: next,
        itemId,
        at,
        automatic: true,
      });
      carried.push({ journalId: journal.id, itemId, copyId });
    }
  }
  return carried;
}

/**
 * Puts a not-covered item at the empty row `position` of its journal (a merge into an empty row):
 * its place moves there and the later places past the last row move up one step, or its tray row
 * becomes a place.
 */
export async function moveToRow(
  transaction: Transaction,
  branchId: string,
  input: {
    readonly planId: string;
    readonly journalId: string;
    readonly quarterId: string;
    readonly itemId: string;
    readonly at: NotCoveredAt;
    readonly position: number;
  },
): Promise<void> {
  const { planId, journalId, itemId, at } = input;
  if (at.kind === 'place') {
    await movePlaces(transaction, planId, journalId, new Map([[itemId, input.position]]));
    const later = await transaction
      .selectFrom('lesson_plan_places')
      .select(['item_id', 'position'])
      .where('plan_id', '=', planId)
      .where('journal_id', '=', journalId)
      .where('position', '>', at.position)
      .orderBy('position')
      .execute();
    await movePlaces(
      transaction,
      planId,
      journalId,
      new Map(later.map((row) => [row.item_id, row.position - 1])),
    );
    return;
  }
  await transaction
    .deleteFrom('lesson_plan_tray')
    .where('journal_id', '=', journalId)
    .where('quarter_id', '=', input.quarterId)
    .where('item_id', '=', itemId)
    .execute();
  await transaction
    .insertInto('lesson_plan_places')
    .values({
      branch_id: branchId,
      plan_id: planId,
      journal_id: journalId,
      item_id: itemId,
      position: input.position,
    })
    .execute();
}
