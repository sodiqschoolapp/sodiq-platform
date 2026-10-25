import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { Audit } from '../audit/audit.service.js';

/** Who writes the takeover, for its lines and its audit entry. */
export interface TakeoverActor {
  readonly branchId: string;
  readonly accountId: string;
  readonly assignmentId: string;
  readonly requestId?: string;
}

/**
 * The takeover of works added by hand (task 8.1, review correction 1;
 * `edge/journal`, "A lesson is held with no plan item": "When the plan item
 * is written later, its works take over these columns in order, classworks
 * with classworks and homeworks with homeworks, and give them their titles;
 * a hand-added work left without a match stays as an unplanned column, and a
 * planned work left without a match gets its own column"). Called by the plan
 * writes that give a started row its item or change the works of a started
 * row's item, once per lesson of that row: the planned works with no journal
 * work of their own are linked, in order, to the unplanned works of that
 * lesson and kind in order of their position. The link is set once (0119);
 * a later save never moves a number to another title.
 */
export async function takeOverUnplanned(
  transaction: Transaction,
  audit: Audit,
  actor: TakeoverActor,
  itemId: string,
  lessonIds: readonly string[],
): Promise<void> {
  if (lessonIds.length === 0) return;
  const planned = await transaction
    .selectFrom('lesson_plan_works')
    .select(['id', 'kind'])
    .where('item_id', '=', itemId)
    .orderBy('kind')
    .orderBy('position')
    .orderBy('id')
    .execute();
  if (planned.length === 0) return;
  const linked: { workId: string; planWorkId: string; lessonId: string }[] = [];
  for (const lessonId of [...new Set(lessonIds)].sort()) {
    // The lock of an add by hand at the lesson (code review, should-fix 3): an add that read
    // "no plan item" before this item commits first, and is taken over here.
    await sql`select pg_advisory_xact_lock(hashtextextended(${`journal_works_limit:${lessonId}`}, 0))`.execute(
      transaction,
    );
    const rows = await transaction
      .selectFrom('journal_works')
      .select(['id', 'kind', 'plan_work_id', 'position'])
      .where('source_lesson_id', '=', lessonId)
      .orderBy('position')
      .orderBy('id')
      .forUpdate()
      .execute();
    const taken = new Set(
      rows.flatMap((row) => (row.plan_work_id === null ? [] : [row.plan_work_id])),
    );
    for (const kind of ['classwork', 'homework'] as const) {
      const free = planned.filter((work) => work.kind === kind && !taken.has(work.id));
      const unplanned = rows.filter((row) => row.kind === kind && row.plan_work_id === null);
      for (const [index, row] of unplanned.entries()) {
        const work = free[index];
        if (work === undefined) break;
        await transaction
          .updateTable('journal_works')
          .set({ plan_work_id: work.id, changed_by: actor.accountId, changed_how: 'takeover' })
          .where('id', '=', row.id)
          .execute();
        linked.push({ workId: row.id, planWorkId: work.id, lessonId });
      }
    }
  }
  if (linked.length === 0) return;
  await audit.record(transaction, {
    branchId: actor.branchId,
    actorId: actor.accountId,
    assignmentId: actor.assignmentId,
    action: 'journal.work_takeover',
    record: { type: 'lesson_plan_item', id: itemId },
    newValue: { works: linked },
    ...(actor.requestId === undefined ? {} : { requestId: actor.requestId }),
  });
}

/**
 * The separation of a journal from a shared plan copies its items and their
 * works (`copyItems`, `plan-separate.ts`): the journal's works that name a
 * work of an old item name its copy from then on, the work of the same kind
 * and position of the copied item (task 8.1, decision 17, spec review
 * must-fix 1); 0119 lets the link move only so. The lines go with the
 * separation's audit entry.
 */
export async function followSeparation(
  transaction: Transaction,
  accountId: string | null,
  journalId: string,
  copies: ReadonlyMap<string, string>,
): Promise<number> {
  if (copies.size === 0) return 0;
  const journal = await transaction
    .selectFrom('journals')
    .select(['class_id', 'group_id', 'subject_id'])
    .where('id', '=', journalId)
    .executeTakeFirstOrThrow();
  const pairs = await transaction
    .selectFrom('lesson_plan_works as old')
    .innerJoin('lesson_plan_works as copy', (join) =>
      join.onRef('copy.kind', '=', 'old.kind').onRef('copy.position', '=', 'old.position'),
    )
    .select([
      'old.id as old_id',
      'old.item_id as old_item',
      'copy.id as copy_id',
      'copy.item_id as copy_item',
    ])
    .where('old.item_id', 'in', [...copies.keys()])
    .where('copy.item_id', 'in', [...copies.values()])
    .execute();
  let moved = 0;
  for (const pair of pairs.sort((a, b) => a.old_id.localeCompare(b.old_id))) {
    if (copies.get(pair.old_item) !== pair.copy_item) continue;
    const update = transaction
      .updateTable('journal_works')
      .set({ plan_work_id: pair.copy_id, changed_by: accountId, changed_how: 'separation' })
      .where('plan_work_id', '=', pair.old_id)
      .where('source_lesson_id', 'in', (eb) => {
        let lessons = eb
          .selectFrom('lessons')
          .select('lessons.id')
          .where('lessons.subject_id', '=', journal.subject_id);
        lessons =
          journal.class_id === null
            ? lessons.where('lessons.group_id', '=', journal.group_id)
            : lessons.where('lessons.class_id', '=', journal.class_id);
        return lessons;
      });
    const result = await update.executeTakeFirst();
    moved += Number(result.numUpdatedRows);
    // Task 8.8: a homework marked "not given" in this journal stays marked on the copy.
    await transaction
      .updateTable('journal_homework_not_given')
      .set({ plan_work_id: pair.copy_id })
      .where('plan_work_id', '=', pair.old_id)
      .where('journal_id', '=', journalId)
      .execute();
  }
  return moved;
}
