import { sql, type Kysely } from 'kysely';
import type { DB } from '../database/types.generated.js';

/**
 * Task 10.8: a work added by hand before 7 November 2026, as the add of 8.1 to 10.7 wrote it: a
 * journal row with no plan work, stored where it is given, at the next free place of its kind,
 * written as the migrator at `at`. Since 10.8 the add of the journal writes a plan work
 * (`edge/journal`, "Works added by hand before 7 November 2026 are not in the plan"), so a test
 * of what such a row does makes it here.
 */
export async function handWork(
  migrator: Kysely<DB>,
  input: {
    readonly branchId: string;
    readonly lessonId: string;
    readonly kind: 'classwork' | 'homework';
    readonly title?: string | null;
    readonly at: string;
  },
): Promise<{ id: string; version: number }> {
  const taken = await migrator
    .selectFrom('journal_works')
    .select('position')
    .where('source_lesson_id', '=', input.lessonId)
    .where('kind', '=', input.kind)
    .where('plan_work_id', 'is', null)
    .execute();
  const used = new Set(taken.map((one) => one.position));
  let position = 1;
  while (used.has(position)) position += 1;
  return migrator.transaction().execute(async (transaction) => {
    await sql`select set_config('app.now', ${input.at}, true)`.execute(transaction);
    return transaction
      .insertInto('journal_works')
      .values({
        branch_id: input.branchId,
        lesson_id: input.lessonId,
        source_lesson_id: input.lessonId,
        kind: input.kind,
        position,
        title: input.title === undefined ? 'Dictation' : input.title,
        changed_how: 'entry',
      })
      .returning(['id', 'version'])
      .executeTakeFirstOrThrow();
  });
}
