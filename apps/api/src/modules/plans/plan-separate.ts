import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { JournalRow } from '../journal/journal-grid.query.js';

/**
 * The writes of shared plans that both a route and the follow make (task
 * 7.1c, pull request #214): copies of items and the separation of one
 * journal from its plan. Nothing here checks who may do it.
 */

/** What decides who may share a plan (decision 3): kind, grades and language, as one text. */
export async function unitKeysOf(
  transaction: Transaction,
  journals: readonly JournalRow[],
): Promise<Map<string, string>> {
  const classIds = journals.flatMap((journal) =>
    journal.classId === null ? [] : [journal.classId],
  );
  const groupIds = journals.flatMap((journal) =>
    journal.groupId === null ? [] : [journal.groupId],
  );
  const languages = new Map<string, string>();
  if (classIds.length > 0) {
    for (const row of await transaction
      .selectFrom('classes')
      .select(['id', 'language'])
      .where('id', 'in', classIds)
      .execute()) {
      languages.set(row.id, row.language);
    }
  }
  if (groupIds.length > 0) {
    for (const row of await transaction
      .selectFrom('groups')
      .select(['id', 'language'])
      .where('id', 'in', groupIds)
      .execute()) {
      languages.set(row.id, row.language);
    }
  }
  return new Map(
    journals.map((journal) => [
      journal.id,
      [
        journal.classId === null ? 'group' : 'class',
        [...journal.grades].sort((a, b) => a - b).join('+'),
        languages.get(journal.classId ?? journal.groupId ?? '') ?? '',
      ].join('|'),
    ]),
  );
}

/**
 * Copies items into a plan (decisions 10 and 16): topic, objectives, links,
 * works and the files not removed, each copy naming what it was made from (a
 * file names the first file whose bytes it shows). Gives the new item of each
 * source item, in the order given.
 */
export async function copyItems(
  transaction: Transaction,
  branchId: string,
  planId: string,
  itemIds: readonly string[],
): Promise<Map<string, string>> {
  const made = new Map<string, string>();
  if (itemIds.length === 0) return made;
  const items = await transaction
    .selectFrom('lesson_plan_items')
    .select(['id', 'topic', 'objectives', 'links'])
    .where('id', 'in', [...itemIds])
    .execute();
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const sourceId of itemIds) {
    const source = byId.get(sourceId);
    if (source === undefined) continue;
    const item = await transaction
      .insertInto('lesson_plan_items')
      .values({
        branch_id: branchId,
        plan_id: planId,
        topic: source.topic,
        objectives: source.objectives,
        links: source.links,
        copied_from: source.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    made.set(source.id, item.id);
  }
  const works = await transaction
    .selectFrom('lesson_plan_works')
    .select(['item_id', 'kind', 'position', 'title', 'description'])
    .where('item_id', 'in', [...made.keys()])
    .orderBy('item_id')
    .orderBy('kind')
    .orderBy('position')
    .execute();
  if (works.length > 0) {
    await transaction
      .insertInto('lesson_plan_works')
      .values(
        works.map((work) => ({
          branch_id: branchId,
          item_id: made.get(work.item_id) ?? '',
          kind: work.kind,
          position: work.position,
          title: work.title,
          description: work.description,
        })),
      )
      .execute();
  }
  const files = await transaction
    .selectFrom('lesson_plan_files')
    .select(['id', 'item_id', 'name', 'type', 'bytes', 'copied_from'])
    .where('item_id', 'in', [...made.keys()])
    .where('removed_at', 'is', null)
    .orderBy('id')
    .execute();
  if (files.length > 0) {
    await transaction
      .insertInto('lesson_plan_files')
      .values(
        files.map((file) => ({
          branch_id: branchId,
          item_id: made.get(file.item_id) ?? '',
          name: file.name,
          type: file.type,
          bytes: file.bytes,
          copied_from: file.copied_from ?? file.id,
        })),
      )
      .execute();
  }
  return made;
}

/**
 * Separates one journal from its shared plan (`09`: "A shared plan can be
 * separated later"; `edge/lesson-plans`: "Separating the plan changes no
 * text and needs no request"): a new plan with a copy of every item not
 * cleared at the journal's places with their marks; the link moves, and its
 * snapshot, absorbed shifts and prepared request with it (decision 7). The
 * caller holds the journals of the plan. Gives the new plan.
 */
export async function separateJournal(
  transaction: Transaction,
  branchId: string,
  planId: string,
  journalId: string,
): Promise<{ planId: string; items: number }> {
  const plan = await transaction
    .selectFrom('lesson_plans')
    .select(['quarter_id', 'subject_id'])
    .where('id', '=', planId)
    .executeTakeFirstOrThrow();
  const created = await transaction
    .insertInto('lesson_plans')
    .values({ branch_id: branchId, quarter_id: plan.quarter_id, subject_id: plan.subject_id })
    .returning('id')
    .executeTakeFirstOrThrow();
  const places = await transaction
    .selectFrom('lesson_plan_places')
    .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_places.item_id')
    .select([
      'lesson_plan_places.item_id',
      'lesson_plan_places.position',
      sql<string | null>`lesson_plan_places.moved_from::text`.as('moved_from'),
      // Task 7.2: the mark stays with the separated rows (`edge`: "Separating the plan changes no text").
      'lesson_plan_places.edited_after_lesson',
    ])
    .where('lesson_plan_places.plan_id', '=', planId)
    .where('lesson_plan_places.journal_id', '=', journalId)
    .where('lesson_plan_items.cleared_at', 'is', null)
    .orderBy('lesson_plan_places.position')
    .execute();
  await transaction
    .deleteFrom('lesson_plan_places')
    .where('plan_id', '=', planId)
    .where('journal_id', '=', journalId)
    .execute();
  await transaction
    .updateTable('lesson_plan_journals')
    .set({ plan_id: created.id })
    .where('plan_id', '=', planId)
    .where('journal_id', '=', journalId)
    .execute();
  const made = await copyItems(
    transaction,
    branchId,
    created.id,
    places.map((place) => place.item_id),
  );
  if (places.length > 0) {
    await transaction
      .insertInto('lesson_plan_places')
      .values(
        places.map((place) => ({
          branch_id: branchId,
          plan_id: created.id,
          journal_id: journalId,
          item_id: made.get(place.item_id) ?? '',
          position: place.position,
          moved_from: place.moved_from,
          edited_after_lesson: place.edited_after_lesson,
        })),
      )
      .execute();
  }
  return { planId: created.id, items: places.length };
}
