import { transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';

/**
 * Clears the copy of an undone or withdrawn "topic not delivered" while it
 * is untouched (task 8.8, decisions 5 and 7, correction 3: "cleared the way
 * a Clear clears a row"; a plan item is never deleted): still not covered in
 * its journal (past its `rows`) and with the content of the item it was made
 * from. Gives what was cleared, `null` when it was cleared already, or
 * `used` for a copy that is plan content now.
 */
export async function clearUntouchedCopy(
  transaction: Transaction,
  rows: number,
  copyId: string,
): Promise<Record<string, JsonValue> | null | 'used'> {
  const copy = await transaction
    .selectFrom('lesson_plan_items')
    .select(['id', 'topic', 'objectives', 'links', 'copied_from', 'cleared_at'])
    .where('id', '=', copyId)
    .forUpdate()
    .executeTakeFirst();
  if (copy === undefined || copy.cleared_at !== null) return null;
  const places = await transaction
    .selectFrom('lesson_plan_places')
    .select('position')
    .where('item_id', '=', copyId)
    .execute();
  if (places.some((one) => one.position <= rows)) return 'used';
  const source =
    copy.copied_from === null
      ? undefined
      : await transaction
          .selectFrom('lesson_plan_items')
          .select(['topic', 'objectives', 'links'])
          .where('id', '=', copy.copied_from)
          .executeTakeFirst();
  const worksOfItem = async (itemId: string) =>
    (
      await transaction
        .selectFrom('lesson_plan_works')
        .select(['kind', 'position', 'title', 'description'])
        .where('item_id', '=', itemId)
        .orderBy('kind')
        .orderBy('position')
        .execute()
    )
      .map((work) => `${work.kind}|${String(work.position)}|${work.title}|${work.description}`)
      .join('\n');
  const filesOfItem = async (itemId: string) =>
    (
      await transaction
        .selectFrom('lesson_plan_files')
        .select('id')
        .where('item_id', '=', itemId)
        .where('removed_at', 'is', null)
        .execute()
    ).length;
  const untouched =
    source !== undefined &&
    copy.copied_from !== null &&
    source.topic === copy.topic &&
    source.objectives === copy.objectives &&
    source.links.join('\n') === copy.links.join('\n') &&
    (await worksOfItem(copy.id)) === (await worksOfItem(copy.copied_from)) &&
    (await filesOfItem(copy.id)) === (await filesOfItem(copy.copied_from));
  if (!untouched) return 'used';
  await transaction.deleteFrom('lesson_plan_places').where('item_id', '=', copyId).execute();
  await transaction
    .updateTable('lesson_plan_items')
    .set({ cleared_at: await transactionMoment(transaction) })
    .where('id', '=', copyId)
    .execute();
  return { itemId: copy.id, topic: copy.topic, objectives: copy.objectives, links: copy.links };
}
