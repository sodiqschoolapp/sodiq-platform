import type { StudentReport } from '@sodiq/shared';
import type { Transaction } from '../../database/transactions.js';

/**
 * The past marks from before go-live of a student for the personal data report (task 11.26;
 * `edge/people-roles-accounts`: "past marks from before go-live included"; plan decision 21):
 * every row in every branch of the transaction (the Super Admin's, every branch), withdrawn ones
 * included and marked, by date, subject and lesson. The report is the one staff output that shows
 * them (`10`, Where they never appear).
 */
export async function studentPastMarks(
  transaction: Transaction,
  studentId: string,
): Promise<StudentReport['pastMarks']> {
  const attendance = await transaction
    .selectFrom('past_attendance')
    .innerJoin('past_mark_uploads', 'past_mark_uploads.id', 'past_attendance.upload_id')
    .innerJoin('branches', 'branches.id', 'past_attendance.branch_id')
    .innerJoin('subjects', 'subjects.id', 'past_attendance.subject_id')
    .select([
      'branches.name as branch',
      'past_mark_uploads.file_name',
      'past_attendance.school_date',
      'subjects.name_en',
      'past_attendance.lesson_number',
      'past_attendance.mark',
      'past_attendance.withdrawn_at',
    ])
    .where('past_attendance.student_id', '=', studentId)
    .orderBy('past_attendance.school_date')
    .orderBy('subjects.name_en')
    .orderBy('past_attendance.lesson_number')
    .orderBy('past_attendance.id')
    .execute();
  const works = await transaction
    .selectFrom('past_works')
    .innerJoin('past_mark_uploads', 'past_mark_uploads.id', 'past_works.upload_id')
    .innerJoin('branches', 'branches.id', 'past_works.branch_id')
    .innerJoin('subjects', 'subjects.id', 'past_works.subject_id')
    .select([
      'branches.name as branch',
      'past_mark_uploads.file_name',
      'past_works.school_date',
      'subjects.name_en',
      'past_works.lesson_number',
      'past_works.kind',
      'past_works.title',
      'past_works.total',
      'past_works.score',
      'past_works.withdrawn_at',
    ])
    .where('past_works.student_id', '=', studentId)
    .orderBy('past_works.school_date')
    .orderBy('subjects.name_en')
    .orderBy('past_works.lesson_number')
    .orderBy('past_works.kind')
    .orderBy('past_works.position')
    .orderBy('past_works.id')
    .execute();
  const day = (value: string | Date) =>
    typeof value === 'string' ? value : value.toISOString().slice(0, 10);
  const moment = (value: string | Date | null) =>
    value === null ? null : new Date(value).toISOString();
  return {
    attendance: attendance.map((row) => ({
      branch: row.branch,
      fileName: row.file_name,
      date: day(row.school_date),
      subject: row.name_en,
      lessonNumber: row.lesson_number,
      mark: row.mark,
      withdrawnAt: moment(row.withdrawn_at),
    })),
    works: works.map((row) => ({
      branch: row.branch,
      fileName: row.file_name,
      date: day(row.school_date),
      subject: row.name_en,
      lessonNumber: row.lesson_number,
      kind: row.kind === 'homework' ? 'homework' : 'classwork',
      title: row.title,
      total: Number(row.total),
      score: Number(row.score),
      withdrawnAt: moment(row.withdrawn_at),
    })),
  };
}
