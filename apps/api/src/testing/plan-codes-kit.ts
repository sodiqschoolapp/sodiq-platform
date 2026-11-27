import { sql, type Kysely } from 'kysely';
import type { DB } from '../database/types.generated.js';

/**
 * Task 11.27 (`09`, Codes): a plan item with a topic code and coded works at the row of a held
 * lesson, and the stored journal work of each, written by the migrator, for the tests of the
 * readers that answer codes (the portal, the results breakdown, the assistant, the support view).
 * The readers are called through their routes; the codes are written straight into the tables, as
 * a save while the subject's codes are on would leave them.
 */
export interface CodedWork {
  readonly kind: 'classwork' | 'homework';
  readonly title: string;
  readonly code: string | null;
  /** The total of the stored journal work. */
  readonly total: number;
}

export interface CodedItem {
  readonly itemId: string;
  /** The plan work of each work given, in order. */
  readonly planWorks: readonly string[];
  /** The stored journal work of each work given, in order. */
  readonly journalWorks: readonly string[];
}

/** A coded plan item of the journal at the row of `lessonId` in its quarter, and its journal works. */
export async function codedItemAt(
  migrator: Kysely<DB>,
  input: {
    readonly branch: string;
    readonly journalId: string;
    readonly lessonId: string;
    readonly topic: string;
    readonly topicCode: string | null;
    readonly works: readonly CodedWork[];
  },
): Promise<CodedItem> {
  const journal = await migrator
    .selectFrom('journals')
    .select(['class_id', 'subject_id', 'academic_year_id'])
    .where('id', '=', input.journalId)
    .executeTakeFirstOrThrow();
  const lesson = await migrator
    .selectFrom('lessons')
    .select(sql<string>`lesson_date::text`.as('date'))
    .where('id', '=', input.lessonId)
    .executeTakeFirstOrThrow();
  const quarter = await migrator
    .selectFrom('quarters')
    .select([
      'id',
      sql<string>`start_date::text`.as('start'),
      sql<string>`end_date::text`.as('end'),
    ])
    .where('academic_year_id', '=', journal.academic_year_id)
    .where('start_date', '<=', lesson.date)
    .where('end_date', '>=', lesson.date)
    .executeTakeFirstOrThrow();
  const plan = await migrator
    .selectFrom('lesson_plan_journals')
    .select('plan_id')
    .where('journal_id', '=', input.journalId)
    .where('quarter_id', '=', quarter.id)
    .executeTakeFirstOrThrow();
  const rows = (
    await migrator
      .selectFrom('lessons')
      .select('id')
      .where('class_id', '=', journal.class_id)
      .where('subject_id', '=', journal.subject_id)
      .where('lesson_date', '>=', quarter.start)
      .where('lesson_date', '<=', quarter.end)
      .where('cancel_cause', 'is', null)
      .orderBy('starts_at')
      .execute()
  ).map((row) => row.id);
  const position = rows.indexOf(input.lessonId) + 1;
  if (position === 0) throw new Error('The lesson is not a row of the journal’s quarter.');
  const item = await migrator
    .insertInto('lesson_plan_items')
    .values({
      branch_id: input.branch,
      plan_id: plan.plan_id,
      topic: input.topic,
      topic_code: input.topicCode,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const planWorks: string[] = [];
  const journalWorks: string[] = [];
  const counts = { classwork: 0, homework: 0 };
  for (const work of input.works) {
    counts[work.kind] += 1;
    const planned = await migrator
      .insertInto('lesson_plan_works')
      .values({
        branch_id: input.branch,
        item_id: item.id,
        kind: work.kind,
        position: counts[work.kind],
        title: work.title,
        work_code: work.code,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    planWorks.push(planned.id);
  }
  await migrator
    .insertInto('lesson_plan_places')
    .values({
      branch_id: input.branch,
      plan_id: plan.plan_id,
      journal_id: input.journalId,
      item_id: item.id,
      position,
    })
    .execute();
  for (const [index, work] of input.works.entries()) {
    const stored = await migrator
      .insertInto('journal_works')
      .values({
        branch_id: input.branch,
        lesson_id: input.lessonId,
        source_lesson_id: input.lessonId,
        plan_work_id: planWorks[index] ?? null,
        kind: work.kind,
        total: work.total,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    journalWorks.push(stored.id);
  }
  return { itemId: item.id, planWorks, journalWorks };
}

/** The codes switch of a subject, as the switch route leaves it (`subjects.codes_on`). */
export async function setCodes(
  migrator: Kysely<DB>,
  subjectId: string,
  on: boolean,
): Promise<void> {
  await migrator
    .updateTable('subjects')
    .set({ codes_on: on })
    .where('id', '=', subjectId)
    .execute();
}
