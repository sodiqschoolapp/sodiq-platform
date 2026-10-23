import { sql } from 'kysely';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Transactions, type Transaction } from '../../database/transactions.js';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import { at, LessonsKit } from '../../testing/lessons-kit.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

const CHECK_VIOLATION = '23514';
const UNIQUE_VIOLATION = '23505';
const INSUFFICIENT_PRIVILEGE = '42501';

/** Thursday 15 October 2026, 10:00 in Tashkent: quarter 1 has started. */
const NOW = '2026-10-15T10:00:00+05:00';
/** Friday 20 November 2026: quarter 1 has ended, quarter 2 has started. */
const LATER = '2026-11-20T10:00:00+05:00';

/** The error a promise was refused with, or a failure when it was not refused. */
async function refusal(
  work: Promise<unknown>,
): Promise<{ code?: string; constraint?: string; message?: string }> {
  try {
    await work;
  } catch (error) {
    return error as { code?: string; constraint?: string; message?: string };
  }
  throw new Error('The database did not refuse it.');
}

// The switches of a subject per quarter, the rating exam and comments in the
// database (db/migrations/0120; task 8.2, pull request #218). edge/calculation:
// "These switches are stored per quarter"; "The rating exam"; edge/developer-rules,
// History and audit: "Append-only ... Partitioned by month". Every write of the
// application is made as `sodiq_app` through the branch filter. All names are invented.
describe('the rating exam and comments in the database', () => {
  let database: TestDatabase;
  let transactions: Transactions;
  let later: Transactions;
  let kit: LessonsKit;
  let north: string;
  let south: string;
  let account: string;
  const years = new Map<string, { year: string; quarters: string[] }>();

  const inBranch = <T>(branch: string, work: (transaction: Transaction) => Promise<T>) =>
    transactions.run([branch], work);

  const audited = (transaction: Transaction, branch: string) =>
    transaction
      .insertInto('audit_log')
      .values({ occurred_at: new Date(NOW), branch_id: branch, action: 'test.rating' })
      .execute();

  const quarterOf = (branch: string, number: number) =>
    years.get(branch)?.quarters[number - 1] ?? '';

  /** A subject with the rating exam (or none), graded. */
  const subject = async (rating = true) => {
    const id = await kit.load.classes.subject({ grades: [7], journalType: 'graded' });
    if (rating) {
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: true })
        .where('id', '=', id)
        .execute();
    }
    return id;
  };

  /** A class of grade 7 with one pupil, and its journal of the subject. */
  async function journalOf(branch: string, subjectId: string) {
    const year = years.get(branch)?.year ?? '';
    const classId = await kit.load.classes.schoolClass(branch, year, { grade: 7 });
    const [student] = await kit.pupils(branch, classId, 1);
    const journal = await database.migrator
      .insertInto('journals')
      .values({
        branch_id: branch,
        academic_year_id: year,
        class_id: classId,
        subject_id: subjectId,
        runs: sql`'{[2026-09-01,)}'::datemultirange`,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return { classId, student: student ?? '', journal: journal.id };
  }

  /** The rating exam row of a journal in quarter 1, as the application writes it. */
  const examRow = (
    branch: string,
    journal: string,
    values: { date?: string | null; notHeld?: boolean; quarter?: string } = {},
  ) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return (
        await transaction
          .insertInto('journal_rating_exams')
          .values({
            branch_id: branch,
            journal_id: journal,
            quarter_id: values.quarter ?? quarterOf(branch, 1),
            exam_date: values.date === undefined ? '2026-10-12' : values.date,
            not_held: values.notHeld ?? false,
            version: 1,
            changed_by: account,
            changed_at: new Date(0),
          })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    });

  const entry = (
    branch: string,
    exam: string,
    student: string,
    values: { kind?: string | null; score?: number | null; reason?: string | null } = {},
  ) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return transaction
        .insertInto('journal_rating_entries')
        .values({
          branch_id: branch,
          rating_exam_id: exam,
          student_id: student,
          kind: values.kind === undefined ? 'score' : values.kind,
          score: values.score === undefined ? 50 : values.score,
          reason: values.reason ?? null,
          version: 1,
          changed_by: account,
          changed_how: 'entry',
          changed_at: new Date(0),
        })
        .returning(['id', 'version'])
        .executeTakeFirstOrThrow();
    });

  const changeEntry = (
    branch: string,
    id: string,
    values: { kind?: string | null; score?: number | null; reason?: string | null },
  ) =>
    inBranch(branch, async (transaction) => {
      await audited(transaction, branch);
      return transaction
        .updateTable('journal_rating_entries')
        .set({ ...values, changed_by: account, changed_how: 'entry' })
        .where('id', '=', id)
        .returning(['version'])
        .executeTakeFirstOrThrow();
    });

  /** The switches of a subject in a quarter, read through `subject_quarter_switches`. */
  const switchesIn = async (subjectId: string, quarterId: string) => {
    const { rows } = await sql<{ rating_exam: boolean; rating_round: number }>`
      select rating_exam, rating_round from subject_quarter_switches(${subjectId}::uuid, ${quarterId}::uuid)
    `.execute(database.migrator);
    return rows[0];
  };

  /** A change of the subject's rating switch as the subject edit writes it, at `when`. */
  const switchRating = (
    subjectId: string,
    rating: boolean,
    from: number | null,
    when: Transactions = transactions,
  ) =>
    when.run([north], async (transaction) => {
      await audited(transaction, north);
      await transaction
        .updateTable('subjects')
        .set((eb) => ({
          rating_exam: rating,
          rating_round: eb('rating_round', '+', 1),
          switches_from: from,
        }))
        .where('id', '=', subjectId)
        .execute();
    });

  beforeAll(async () => {
    database = await createTestDatabase();
    transactions = new Transactions(database.app, new FixedClock(NOW));
    later = new Transactions(database.app, new FixedClock(LATER));
    kit = await LessonsKit.create(database.migrator);
    north = await insertBranch(database.migrator, 'North');
    south = await insertBranch(database.migrator, 'South');
    years.set(north, await kit.year(north));
    years.set(south, await kit.year(south));
    account = await kit.load.classes.account();
  });

  afterAll(async () => {
    await database.destroy();
  });

  describe('the switches per quarter (decisions 1 and 16)', () => {
    it('keeps a log written only by the trigger on subjects, never changed by the application', async () => {
      const id = await subject(false);
      const direct = await refusal(
        inBranch(north, (transaction) =>
          transaction
            .insertInto('subject_switches')
            .values({
              subject_id: id,
              journal_type: 'graded',
              rating_exam: true,
              weights_round: 1,
              rating_round: 1,
              changed_at: new Date(NOW),
            })
            .execute(),
        ),
      );
      expect(direct.code).toBe(CHECK_VIOLATION);
      for (const work of <((transaction: Transaction) => Promise<unknown>)[]>[
        (transaction: Transaction) =>
          transaction
            .updateTable('subject_switches')
            .set({ rating_exam: true })
            .where('subject_id', '=', id)
            .execute(),
        (transaction: Transaction) =>
          transaction.deleteFrom('subject_switches').where('subject_id', '=', id).execute(),
      ]) {
        expect((await refusal(inBranch(north, work))).code).toBe(INSUFFICIENT_PRIVILEGE);
      }
    });

    it('refuses a change of the switches by the application that names no quarter', async () => {
      const id = await subject(false);
      const failed = await refusal(switchRating(id, true, null));
      expect(failed.constraint).toBe('subject_switches_from');
    });

    it('reaches the quarters from the one named, and leaves a quarter ended before the change', async () => {
      const id = await subject(false);
      await switchRating(id, true, 2);
      expect((await switchesIn(id, quarterOf(north, 1)))?.rating_exam).toBe(false);
      expect((await switchesIn(id, quarterOf(north, 2)))?.rating_exam).toBe(true);
      expect((await switchesIn(id, quarterOf(north, 4)))?.rating_exam).toBe(true);
      // On 20 November, quarter 1 has ended: a change "from quarter 1" leaves it.
      await switchRating(id, false, 1, later);
      expect((await switchesIn(id, quarterOf(north, 1)))?.rating_exam).toBe(false);
      expect((await switchesIn(id, quarterOf(north, 2)))?.rating_exam).toBe(false);
      const fromOne = await subject(false);
      await switchRating(fromOne, true, 1);
      expect(await switchesIn(fromOne, quarterOf(north, 1))).toMatchObject({
        rating_exam: true,
        rating_round: 2,
      });
      // A change by the migrator outside a request (a fixture) reaches every quarter.
      await database.migrator
        .updateTable('subjects')
        .set({ rating_exam: false })
        .where('id', '=', fromOne)
        .execute();
      expect((await switchesIn(fromOne, quarterOf(north, 1)))?.rating_exam).toBe(false);
    });

    it('keeps the quarter number of a change for that update only (spec review of the code, should-fix 2)', async () => {
      const id = await subject(false);
      await switchRating(id, true, 2);
      const stored = await database.migrator
        .selectFrom('subjects')
        .select('switches_from')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(stored.switches_from).toBeNull();
      expect((await refusal(switchRating(id, false, null))).constraint).toBe(
        'subject_switches_from',
      );
    });

    it("lets a change through before the quarter's first day, whatever the quarter holds (decision 3)", async () => {
      const id = await subject();
      const { journal, student } = await journalOf(north, id);
      await entry(north, await examRow(north, journal), student);
      const { rows } = await sql<{ scores: number }>`
        select scores from subject_switch_blocked(
          ${id}::uuid, 1::smallint, '2026-08-20T10:00:00+05:00'::timestamptz, false, true
        )
      `.execute(database.migrator);
      expect(rows[0]?.scores).toBe(0);
    });

    // Correction 1: the quarterly weights take the rounds of their quarter's switches.
    describe('the quarterly weights in the rounds of their quarter (correction 1)', () => {
      /** A quarterly distribution written as the application, at `when`. */
      const weights = (
        subjectId: string,
        quarter: string,
        rounds: { rating_round: number; rating: boolean },
        when: Transactions = later,
      ) =>
        when.run([north], (transaction) =>
          transaction
            .insertInto('subject_quarter_weights')
            .values({
              branch_id: north,
              subject_id: subjectId,
              quarter_id: quarter,
              attendance: rounds.rating ? 20 : 30,
              classwork: rounds.rating ? 20 : 30,
              homework: rounds.rating ? 20 : 40,
              rating_exam: rounds.rating ? 40 : null,
              weights_round: 1,
              rating_round: rounds.rating_round,
            })
            .execute(),
        );

      it("saves a quarter that a change from a later quarter does not reach in its own rounds, and refuses the subject's current ones there", async () => {
        const id = await subject(false);
        // On 20 November, in quarter 2: the rating exam from quarter 3 (rating round 2).
        await switchRating(id, true, 3, later);
        await weights(id, quarterOf(north, 2), { rating_round: 1, rating: false });
        expect((await switchesIn(id, quarterOf(north, 2)))?.rating_round).toBe(1);
        const current = await refusal(
          weights(id, quarterOf(north, 3), { rating_round: 1, rating: true }),
        );
        expect(current.constraint).toBe('subject_quarter_weights_current_rating_round');
        await weights(id, quarterOf(north, 3), { rating_round: 2, rating: true });
        const wrong = await refusal(
          inBranch(north, (transaction) =>
            transaction
              .updateTable('subject_quarter_weights')
              .set({ rating_round: 2 })
              .where('subject_id', '=', id)
              .where('quarter_id', '=', quarterOf(north, 2))
              .execute(),
          ),
        );
        expect(wrong.constraint).toBe('subject_quarter_weights_current_rating_round');
      });

      it('keeps a quarter ended before a later change in its rounds, written after it', async () => {
        const id = await subject(false);
        await switchRating(id, true, 1, later);
        // Quarter 1 ended on 31 October: the change of 20 November leaves it.
        expect(await switchesIn(id, quarterOf(north, 1))).toMatchObject({
          rating_exam: false,
          rating_round: 1,
        });
        await weights(id, quarterOf(north, 1), { rating_round: 1, rating: false });
        const counted = await database.migrator
          .selectFrom('subject_quarter_weights')
          .select(['rating_round', 'rating_exam'])
          .where('subject_id', '=', id)
          .where('quarter_id', '=', quarterOf(north, 1))
          .executeTakeFirstOrThrow();
        expect(counted).toEqual({ rating_round: 1, rating_exam: null });
      });
    });

    it('counts the started quarters with scores in every branch, and none for a change from a later quarter', async () => {
      const id = await subject();
      const { journal, student } = await journalOf(south, id);
      const exam = await examRow(south, journal);
      await entry(south, exam, student);
      const blocked = (from: number) =>
        inBranch(north, async (transaction) => {
          const { rows } = await sql<{ scores: number; exams: number }>`
            select scores, exams from subject_switch_blocked(
              ${id}::uuid, ${from}::smallint, ${NOW}::timestamptz, false, true
            )
          `.execute(transaction);
          return rows[0];
        });
      expect(await blocked(1)).toEqual({ scores: 1, exams: 0 });
      expect(await blocked(2)).toEqual({ scores: 0, exams: 0 });
      // The branch filter alone would hide the other branch's row.
      const seen = await inBranch(north, (transaction) =>
        transaction
          .selectFrom('journal_rating_entries')
          .select('id')
          .where('student_id', '=', student)
          .execute(),
      );
      expect(seen).toEqual([]);
    });
  });

  describe('the rating exam row and its entries', () => {
    it('keeps a hand date inside its quarter and refuses a quarter where the subject has no rating exam', async () => {
      const rated = await journalOf(north, await subject());
      const outside = await refusal(examRow(north, rated.journal, { date: '2026-11-10' }));
      expect(outside.constraint).toBe('journal_rating_date_quarter');
      const unrated = await journalOf(north, await subject(false));
      const off = await refusal(examRow(north, unrated.journal));
      expect(off.constraint).toBe('journal_rating_switch_off');
    });

    it('keeps a score from 0 to 100, set exactly with the kind "score"', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal);
      const above = await refusal(entry(north, exam, scene.student, { score: 101 }));
      expect(above.constraint).toBe('journal_rating_entries_score_check');
      const lost = await refusal(
        entry(north, exam, scene.student, { kind: 'did_not_sit', score: 40 }),
      );
      expect(lost.constraint).toBe('journal_rating_entries_score_kind_check');
      await entry(north, exam, scene.student, { kind: 'did_not_sit', score: null });
      const twice = await refusal(entry(north, exam, scene.student));
      expect(twice.code).toBe(UNIQUE_VIOLATION);
      expect(twice.constraint).toBe('journal_rating_entries_key');
    });

    it('refuses an entry without a date in force, on insert and on update', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal, { date: null });
      expect((await refusal(entry(north, exam, scene.student))).constraint).toBe(
        'journal_rating_no_date',
      );
      const dated = await journalOf(north, await subject());
      const datedExam = await examRow(north, dated.journal);
      const written = await entry(north, datedExam, dated.student);
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('journal_rating_exams')
          .set({ exam_date: null, changed_by: account })
          .where('id', '=', datedExam)
          .execute();
      });
      expect(
        (await refusal(changeEntry(north, written.id, { score: 60, reason: 'Retake' }))).constraint,
      ).toBe('journal_rating_no_date');
    });

    it('refuses an entry before the date, and on a row marked "not held"', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal, { date: '2026-10-20' });
      expect((await refusal(entry(north, exam, scene.student))).constraint).toBe(
        'journal_rating_not_yet',
      );
      const held = await journalOf(north, await subject());
      const notHeld = await examRow(north, held.journal, { notHeld: true });
      expect((await refusal(entry(north, notHeld, held.student))).constraint).toBe(
        'journal_rating_not_held',
      );
    });

    it('refuses a student who is no member from the date to the quarter\x27s end, on insert and on update', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal);
      const outsider = await journalOf(north, await subject());
      expect((await refusal(entry(north, exam, outsider.student))).constraint).toBe(
        'journal_rating_not_member',
      );
      // A pupil of the class until 13 October: a member from the date of 12 October on.
      const leaver = await kit.members.student(north, { startsOn: '2026-09-01' });
      await kit.members.member({
        branch: north,
        classId: scene.classId,
        studentId: leaver,
        from: '2026-09-01',
        until: '2026-10-14',
        ownUntil: '2026-10-14',
      });
      const written = await entry(north, exam, leaver);
      // The date moves to 14 October: no day of membership from it on.
      await inBranch(north, async (transaction) => {
        await audited(transaction, north);
        await transaction
          .updateTable('journal_rating_exams')
          .set({ exam_date: '2026-10-14', changed_by: account })
          .where('id', '=', exam)
          .execute();
      });
      expect(
        (await refusal(changeEntry(north, written.id, { score: 60, reason: 'Retake' }))).constraint,
      ).toBe('journal_rating_not_member');
    });

    it('needs a reason on every write over an entry, a clear and the entry after it included (decision 9)', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal);
      const written = await entry(north, exam, scene.student, { score: 40 });
      expect((await refusal(changeEntry(north, written.id, { score: 60 }))).constraint).toBe(
        'journal_rating_reason',
      );
      await changeEntry(north, written.id, { kind: null, score: null, reason: 'Wrong row' });
      expect(
        (await refusal(changeEntry(north, written.id, { kind: 'score', score: 90, reason: null })))
          .constraint,
      ).toBe('journal_rating_reason');
      expect(
        await changeEntry(north, written.id, { kind: 'score', score: 90, reason: 'Late sitting' }),
      ).toEqual({ version: 3 });
    });

    it('keeps no score on a cleared row (spec review of the code, should-fix 1)', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal);
      const kept = await refusal(entry(north, exam, scene.student, { kind: null, score: 40 }));
      expect(kept.constraint).toBe('journal_rating_entries_score_kind_check');
    });

    it('takes a reason for one write only: the row keeps none, so the next write needs its own', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal);
      const written = await entry(north, exam, scene.student, { score: 40 });
      await changeEntry(north, written.id, { score: 60, reason: 'Retake' });
      const row = await database.migrator
        .selectFrom('journal_rating_entries')
        .select('reason')
        .where('id', '=', written.id)
        .executeTakeFirstOrThrow();
      expect(row.reason).toBeNull();
      expect((await refusal(changeEntry(north, written.id, { score: 70 }))).constraint).toBe(
        'journal_rating_reason',
      );
    });

    it('keeps the histories append-only for the application', async () => {
      const scene = await journalOf(north, await subject());
      const exam = await examRow(north, scene.journal);
      await entry(north, exam, scene.student);
      for (const table of ['journal_rating_history', 'journal_comment_history'] as const) {
        expect(
          (
            await refusal(
              inBranch(north, (transaction) =>
                transaction.updateTable(table).set({ version: 9 }).execute(),
              ),
            )
          ).code,
        ).toBe(INSUFFICIENT_PRIVILEGE);
        expect(
          (await refusal(inBranch(north, (transaction) => transaction.deleteFrom(table).execute())))
            .code,
        ).toBe(INSUFFICIENT_PRIVILEGE);
      }
      const lines = await database.migrator
        .selectFrom('journal_rating_history')
        .select(['student_id', 'kind_after', 'score_after'])
        .where('rating_exam_id', '=', exam)
        .orderBy('student_id', (order) => order.nullsFirst())
        .execute();
      expect(lines).toEqual([
        { student_id: null, kind_after: null, score_after: null },
        { student_id: scene.student, kind_after: 'score', score_after: 50 },
      ]);
    });
  });

  describe('comments (decision 10)', () => {
    /** A lesson of the class on a date, as the cells tests write one. */
    async function lessonOf(branch: string, classId: string, subjectId: string, date: string) {
      const year = years.get(branch)?.year ?? '';
      const source = await kit.source(branch, year, [{ classId, groupId: null, subjectId }]);
      return database.migrator.transaction().execute(async (transaction) => {
        const block = await transaction
          .insertInto('lesson_blocks')
          .values({
            branch_id: branch,
            academic_year_id: year,
            quarter_id: quarterOf(branch, 1),
            lesson_date: date,
            starts_at: at(date, '08:00'),
            ends_at: at(date, '08:45'),
            version_id: source.versionId,
            pattern_block_id: source.patternBlockId,
          })
          .returning(['id', 'lesson_date', 'starts_at', 'ends_at'])
          .executeTakeFirstOrThrow();
        return (
          await transaction
            .insertInto('lessons')
            .values({
              branch_id: branch,
              block_id: block.id,
              lesson_date: block.lesson_date,
              starts_at: block.starts_at,
              ends_at: block.ends_at,
              class_id: classId,
              subject_id: subjectId,
              load_row_id: source.lessons[0]?.loadRowId ?? '',
              pattern_entry_id: source.lessons[0]?.patternEntryId ?? '',
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      });
    }

    const note = (branch: string, lesson: string, student: string, body: string | null = 'Text') =>
      inBranch(branch, async (transaction) => {
        await audited(transaction, branch);
        return (
          await transaction
            .insertInto('journal_comments')
            .values({
              branch_id: branch,
              student_id: student,
              target: 'note',
              lesson_id: lesson,
              body,
              visibility: 'staff',
              version: 1,
              changed_by: account,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .returning('id')
            .executeTakeFirstOrThrow()
        ).id;
      });

    it('keeps one comment per target, never deleted by the application, and makes a lesson hold data', async () => {
      const subjectId = await subject();
      const scene = await journalOf(north, subjectId);
      const lesson = await lessonOf(north, scene.classId, subjectId, '2026-10-12');
      const holds = async () =>
        (
          await sql<{ holds: boolean }>`select lesson_holds_data(${lesson}::uuid) as holds`.execute(
            database.migrator,
          )
        ).rows[0]?.holds;
      expect(await holds()).toBe(false);
      const id = await note(north, lesson, scene.student);
      expect(await holds()).toBe(true);
      const twice = await refusal(note(north, lesson, scene.student));
      expect(twice.constraint).toBe('journal_comments_key');
      const removed = await refusal(
        inBranch(north, (transaction) =>
          transaction.deleteFrom('journal_comments').where('id', '=', id).execute(),
        ),
      );
      expect(removed.constraint).toBe('journal_comment_delete');
      const keys = await refusal(
        inBranch(north, async (transaction) => {
          await audited(transaction, north);
          await transaction
            .insertInto('journal_comments')
            .values({
              branch_id: north,
              student_id: scene.student,
              target: 'rating',
              lesson_id: lesson,
              body: 'Text',
              visibility: 'staff',
              version: 1,
              changed_by: account,
              changed_how: 'entry',
              changed_at: new Date(0),
            })
            .execute();
        }),
      );
      expect(keys.constraint).toBe('journal_comments_keys_check');
    });

    it('lists the comments of the days a shorter year cuts off, and a rating entry of a date cut off (From 3.6b-2)', async () => {
      const subjectId = await subject();
      const scene = await journalOf(south, subjectId);
      const lesson = await lessonOf(south, scene.classId, subjectId, '2026-09-07');
      await note(south, lesson, scene.student);
      const exam = await examRow(south, scene.journal, { date: '2026-09-08' });
      await entry(south, exam, scene.student);
      const holds = await sql<{ kind: string; valid_from: string }>`
        select kind, valid_from::text from year_cut_holds(
          ${years.get(south)?.year ?? ''}::uuid, '2026-09-10'::date, '2027-05-31'::date
        ) where kind = 'entry' and student_id = ${scene.student}::uuid
      `.execute(database.migrator);
      expect(holds.rows.map((one) => one.valid_from).sort()).toEqual(['2026-09-07', '2026-09-08']);
    });
  });
});
