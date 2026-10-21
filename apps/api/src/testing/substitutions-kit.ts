import type { Database } from '../database/database.js';

/**
 * Task 5.7b-1 (permission review, must-fix 1; `.claude/rules/api.md`: a route
 * that starts writing more tables through a shared function widens its 404
 * tests to those tables, with rows the function would change in both
 * branches): substitutions in force (0101) on the branch's lessons with a
 * teacher dated from `fromDate`, written by the migrator, each naming the
 * lesson's teacher as its substitute and nobody replaced, so a write of
 * dated lessons that rewrites or removes the lesson would end its row.
 * Answers the number of lessons substituted. Names are invented.
 */
export async function substitutedIn(
  migrator: Database,
  branch: string,
  fromDate: string,
  most = 20,
): Promise<number> {
  const lessons = await migrator
    .selectFrom('lessons')
    .select([
      'id',
      'teacher_id',
      'lesson_date',
      'class_id',
      'group_id',
      'subject_id',
      'load_row_id',
      'pattern_entry_id',
      'starts_at',
      'ends_at',
    ])
    .where('branch_id', '=', branch)
    .where('lesson_date', '>=', fromDate)
    .where('teacher_id', 'is not', null)
    .where((eb) =>
      eb.not(
        eb.exists(
          eb
            .selectFrom('substitution_lessons')
            .select('substitution_lessons.id')
            .whereRef('substitution_lessons.lesson_id', '=', 'lessons.id')
            .where('substitution_lessons.ended_at', 'is', null),
        ),
      ),
    )
    .orderBy('lesson_date')
    .orderBy('id')
    .limit(most)
    .execute();
  if (lessons.length === 0) return 0;
  const account = await migrator
    .selectFrom('accounts')
    .select('id')
    .orderBy('id')
    .executeTakeFirstOrThrow();
  for (const lesson of lessons) {
    const record = await migrator
      .insertInto('substitutions')
      .values({
        branch_id: branch,
        source: 'lesson',
        replaced_id: null,
        substitute_id: lesson.teacher_id ?? '',
        relaxed: false,
        reason: 'The teacher was ill',
        made_at: new Date('2026-10-01T12:00:00+05:00'),
        made_by: account.id,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await migrator
      .insertInto('substitution_lessons')
      .values({
        substitution_id: record.id,
        branch_id: branch,
        lesson_id: lesson.id,
        lesson_date: lesson.lesson_date,
        relaxed: false,
        // Task 5.7b-3 (0103): what the lesson is.
        class_id: lesson.class_id,
        group_id: lesson.group_id,
        subject_id: lesson.subject_id,
        load_row_id: lesson.load_row_id,
        pattern_entry_id: lesson.pattern_entry_id,
        pattern_date: lesson.lesson_date,
        starts_at: lesson.starts_at,
        ends_at: lesson.ends_at,
      })
      .execute();
  }
  return lessons.length;
}

/** The rows of the substitution tables of a branch, for a 404 test's snapshot. */
export async function substitutionRowsOf(
  migrator: Database,
  branch?: string,
): Promise<{ substitutions: unknown[]; substitution_lessons: unknown[] }> {
  let records = migrator.selectFrom('substitutions').selectAll().orderBy('id');
  let rows = migrator.selectFrom('substitution_lessons').selectAll().orderBy('id');
  if (branch !== undefined) {
    records = records.where('branch_id', '=', branch);
    rows = rows.where('branch_id', '=', branch);
  }
  return { substitutions: await records.execute(), substitution_lessons: await rows.execute() };
}

/**
 * Task 5.7b-3 (permission review of the code, must-fix 1): a live row of
 * `substitution_lessons` of a branch, the key a decision names a stored
 * substitution by.
 */
export async function liveSubstitutionRowOf(migrator: Database, branch: string): Promise<string> {
  const row = await migrator
    .selectFrom('substitution_lessons')
    .select('id')
    .where('branch_id', '=', branch)
    .where('ended_at', 'is', null)
    .orderBy('id')
    .executeTakeFirstOrThrow();
  return row.id;
}
