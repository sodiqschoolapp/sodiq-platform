import { sql } from 'kysely';
import { Transactions } from '../database/transactions.js';
import { Audit } from '../modules/audit/audit.service.js';
import type { DayTemplatesKit } from './day-templates-kit.js';
import type { LoadKit } from './load-kit.js';

/**
 * Task 8.2: a rating entry and a note on a lesson, written as the application
 * writes them at a moment (the routes are tested in `rating.test.ts`), for the
 * tests of the reports over the journal. The rating exam is of a subject of
 * its own with the switch on, in a journal of the class, dated `examDate`
 * (in quarter 1, on or before `at`). Names are invented.
 */
export async function ratingEntryAndNote(
  t: DayTemplatesKit,
  load: Pick<LoadKit, 'classes'>,
  input: {
    readonly branch: string;
    readonly year: string;
    readonly classId: string;
    readonly lessonId: string;
    readonly studentId: string;
    readonly accountId: string;
    readonly at: string;
    readonly examDate: string;
  },
): Promise<void> {
  const subject = await load.classes.subject({ grades: [7], journalType: 'graded' });
  await t.database.migrator
    .updateTable('subjects')
    .set({ rating_exam: true })
    .where('id', '=', subject)
    .execute();
  const journal = await t.database.migrator
    .insertInto('journals')
    .values({
      branch_id: input.branch,
      academic_year_id: input.year,
      class_id: input.classId,
      subject_id: subject,
      runs: sql`'{[2026-09-01,)}'::datemultirange`,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  const quarter = await t.database.migrator
    .selectFrom('quarters')
    .select('id')
    .where('academic_year_id', '=', input.year)
    .where('number', '=', 1)
    .executeTakeFirstOrThrow();
  t.clock.set(input.at);
  try {
    await t.app.get(Transactions).run([input.branch], async (transaction) => {
      const audit = t.app.get(Audit);
      await audit.record(transaction, {
        branchId: input.branch,
        actorId: input.accountId,
        action: 'journal.rating_entry',
      });
      const exam = await transaction
        .insertInto('journal_rating_exams')
        .values({
          branch_id: input.branch,
          journal_id: journal.id,
          quarter_id: quarter.id,
          exam_date: input.examDate,
          version: 1,
          changed_by: input.accountId,
          changed_at: new Date(input.at),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await transaction
        .insertInto('journal_rating_entries')
        .values({
          branch_id: input.branch,
          rating_exam_id: exam.id,
          student_id: input.studentId,
          kind: 'score',
          score: 77,
          version: 1,
          changed_by: input.accountId,
          changed_how: 'entry',
          changed_at: new Date(input.at),
        })
        .execute();
      await transaction
        .insertInto('journal_comments')
        .values({
          branch_id: input.branch,
          student_id: input.studentId,
          target: 'note',
          lesson_id: input.lessonId,
          body: 'Helped a classmate',
          visibility: 'parents',
          version: 1,
          changed_by: input.accountId,
          changed_how: 'entry',
          changed_at: new Date(input.at),
        })
        .execute();
    });
  } finally {
    t.clock.set(input.at);
  }
}
