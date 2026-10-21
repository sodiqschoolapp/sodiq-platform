import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit, type LessonSource } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const NOW = '2026-10-15T10:00:00+05:00';
const EARLY = '2026-09-07';
const DAY = '2026-10-26';

/** What a promise came to: `written`, or the constraint that refused it. */
const outcome = (work: Promise<unknown>): Promise<string | undefined> =>
  work.then(
    () => 'written',
    (error: unknown) => (error as { constraint?: string }).constraint ?? String(error),
  );

// Task 5.7b-1, pull request #191 (db/migrations/0101): the substitution
// record. One live row per lesson (decision 6); the substitute is the
// lesson's teacher, so the teacher claim of 0058 keeps them in one place
// (edge/developer-rules, Teacher in one place); the row filter by branch.
// All names are invented.
describe('the substitution record in the database', () => {
  let database: TestDatabase;
  let kit: LessonsKit;
  let subject: string;
  let account: string;
  let branchCount = 0;

  const app = () => new Transactions(database.app, new FixedClock(NOW));

  /** A branch with a dated year, two classes of grade 7, two teachers and a published source. */
  async function fresh() {
    branchCount += 1;
    const branch = await insertBranch(database.migrator, `Branch ${String(branchCount)}`);
    const { year, quarters } = await kit.year(branch);
    const first = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const second = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const teacher = await kit.load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    const substitute = await kit.load.teacher(branch, { subjects: [{ subject, grades: [7] }] });
    const source = await kit.source(
      branch,
      year,
      [
        { classId: first, groupId: null, subjectId: subject },
        { classId: second, groupId: null, subjectId: subject },
      ],
      EARLY,
    );
    return { branch, year, quarter: quarters[0] ?? '', first, second, teacher, substitute, source };
  }

  type Fresh = Awaited<ReturnType<typeof fresh>>;

  /** A lesson of `classId` on DAY at 23:00 to 23:30 in a block of its own, by the migrator. */
  async function lessonOn(place: Fresh, classId: string, teacher: string, index: number) {
    const source: LessonSource = place.source;
    const block = await database.migrator
      .insertInto('lesson_blocks')
      .values({
        branch_id: place.branch,
        academic_year_id: place.year,
        quarter_id: place.quarter,
        lesson_date: DAY,
        starts_at: at(DAY, '23:00'),
        ends_at: at(DAY, '23:30'),
        version_id: source.versionId,
        pattern_block_id: source.patternBlockId,
      })
      .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
      .executeTakeFirstOrThrow();
    const from = source.lessons[index];
    const lesson = await database.migrator
      .insertInto('lessons')
      .values({
        branch_id: place.branch,
        block_id: block.id,
        lesson_date: block.lesson_date,
        starts_at: block.starts_at,
        ends_at: block.ends_at,
        class_id: classId,
        group_id: null,
        subject_id: subject,
        load_row_id: from?.loadRowId ?? '',
        pattern_entry_id: from?.patternEntryId ?? '',
        teacher_id: teacher,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return lesson.id;
  }

  /** A record of the branch with one row for the lesson, written as the application. */
  const recordOf = (place: Fresh, lessonId: string, branch = place.branch) =>
    app().run([branch], async (transaction) => {
      const record = await transaction
        .insertInto('substitutions')
        .values({
          branch_id: place.branch,
          source: 'lesson',
          replaced_id: place.teacher.staffId,
          substitute_id: place.substitute.staffId,
          relaxed: false,
          reason: 'The teacher is ill',
          made_at: new Date(NOW),
          made_by: account,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('substitution_lessons')
        .values({
          substitution_id: record.id,
          branch_id: place.branch,
          lesson_id: lessonId,
          lesson_date: DAY,
        })
        .execute();
      return record.id;
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    kit = await LessonsKit.create(database.migrator);
    subject = await kit.load.classes.subject({ grades: [7] });
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  it('keeps one live row per lesson; an ended row makes room for the next', async () => {
    const place = await fresh();
    const lesson = await lessonOn(place, place.first, place.substitute.staffId, 0);
    await recordOf(place, lesson);
    expect(await outcome(recordOf(place, lesson))).toBe('substitution_lessons_live');
    await app().run([place.branch], (transaction) =>
      transaction
        .updateTable('substitution_lessons')
        .set({ ended_at: new Date(NOW), end_cause: 'replaced', ended_by: account })
        .where('lesson_id', '=', lesson)
        .execute(),
    );
    expect(await outcome(recordOf(place, lesson))).toBe('written');
  });

  it('refuses an end without its cause or its account, and the substitute as the teacher replaced', async () => {
    const place = await fresh();
    const lesson = await lessonOn(place, place.first, place.substitute.staffId, 0);
    await recordOf(place, lesson);
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .updateTable('substitution_lessons')
            .set({ ended_at: new Date(NOW) })
            .where('lesson_id', '=', lesson)
            .execute(),
        ),
      ),
    ).toBe('substitution_lessons_end_check');
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .insertInto('substitutions')
            .values({
              branch_id: place.branch,
              source: 'lesson',
              replaced_id: place.substitute.staffId,
              substitute_id: place.substitute.staffId,
              relaxed: false,
              reason: 'The teacher is ill',
              made_at: new Date(NOW),
              made_by: account,
            })
            .execute(),
        ),
      ),
    ).toBe('substitutions_people_check');
  });

  it('keeps the substitute in one place: a second lesson at the same time is refused by the teacher claim', async () => {
    const place = await fresh();
    await lessonOn(place, place.first, place.substitute.staffId, 0);
    const other = await lessonOn(place, place.second, place.teacher.staffId, 1);
    expect(
      await outcome(
        database.migrator
          .updateTable('lessons')
          .set({ teacher_id: place.substitute.staffId })
          .where('id', '=', other)
          .execute(),
      ),
    ).toBe('time_claims_teacher_excl');
  });

  it('is filtered by branch: another branch neither reads nor writes the rows', async () => {
    const place = await fresh();
    const elsewhere = await fresh();
    const lesson = await lessonOn(place, place.first, place.substitute.staffId, 0);
    await recordOf(place, lesson);
    const seen = await app().run([elsewhere.branch], async (transaction) => ({
      records: await transaction.selectFrom('substitutions').select('id').execute(),
      rows: await transaction.selectFrom('substitution_lessons').select('id').execute(),
    }));
    expect(seen.records).toEqual([]);
    expect(seen.rows).toEqual([]);
    // The row filter refuses a row of another branch than the transaction's.
    expect(await outcome(recordOf(place, lesson, elsewhere.branch))).toContain(
      'row-level security',
    );
  });

  it('ties a row to its record and its lesson in its own branch (the composite keys), and an end to its moment', async () => {
    const place = await fresh();
    const elsewhere = await fresh();
    const lesson = await lessonOn(place, place.first, place.substitute.staffId, 0);
    const record = await recordOf(place, lesson);
    const theirs = await lessonOn(elsewhere, elsewhere.first, elsewhere.substitute.staffId, 0);
    // A row of the other branch naming this branch's record.
    expect(
      await outcome(
        database.migrator
          .insertInto('substitution_lessons')
          .values({
            substitution_id: record,
            branch_id: elsewhere.branch,
            lesson_id: theirs,
            lesson_date: DAY,
          })
          .execute(),
      ),
    ).toBe('substitution_lessons_substitution_fkey');
    // A row of this branch's record naming the other branch's lesson.
    expect(
      await outcome(
        database.migrator
          .insertInto('substitution_lessons')
          .values({
            substitution_id: record,
            branch_id: place.branch,
            lesson_id: theirs,
            lesson_date: DAY,
          })
          .execute(),
      ),
    ).toBe('substitution_lessons_lesson_fkey');
    // A cause without its moment.
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .updateTable('substitution_lessons')
            .set({ end_cause: 'withdrawn', ended_by: account })
            .where('lesson_id', '=', lesson)
            .execute(),
        ),
      ),
    ).toBe('substitution_lessons_end_check');
  });

  it('is insert only for the application, but for the end of a row', async () => {
    const place = await fresh();
    const lesson = await lessonOn(place, place.first, place.substitute.staffId, 0);
    const id = await recordOf(place, lesson);
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction
            .updateTable('substitutions')
            .set({ reason: 'Another reason' })
            .where('id', '=', id)
            .execute(),
        ),
      ),
    ).toContain('permission denied');
    expect(
      await outcome(
        app().run([place.branch], (transaction) =>
          transaction.deleteFrom('substitution_lessons').where('lesson_id', '=', lesson).execute(),
        ),
      ),
    ).toContain('permission denied');
  });
});
