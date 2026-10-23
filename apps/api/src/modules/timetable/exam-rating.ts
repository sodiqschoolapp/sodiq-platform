import { classDisplayName, type ErrorDetail, type ExamRating } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { quarterOnDate, quarterSwitchesOf } from '../setup/subject-switches.js';

/**
 * The rating-exam link of an exam (task 5.6c-3b, pull request #184;
 * `edge/timetable`, Exams, "The exam is the quarter's rating exam": "An exam
 * can be linked to the rating exam of the journals of its subject whose
 * students all belong to its classes: class journals, and group journals
 * whose students all come from sitting classes. A group journal with students
 * outside the exam is listed and not linked; its teacher sets the date by
 * hand. The linked journals' rating exam date is the exam's date").
 *
 * The journals reached (decision 4) are those of the exam's year and subject
 * whose runs hold its date, with a student on that date among the exam's
 * students: the members on the date of its classes and of the groups that sit
 * in their own lesson (decision 9). A journal is linked when every one of its
 * students on that date is one of them. Each save writes them again
 * (decision 1); a cancelled exam keeps them as history, and every reader of a
 * link reads `rating_exam and cancel_cause is null` (decision 6). A journal is
 * linked to at most one standing exam per quarter (decision 2): the exam save
 * and the quarter save check it, both holding the year row.
 */

/** The journals of a rating exam by id, linked first. */
export interface RatingJournals {
  readonly linked: readonly string[];
  readonly notLinked: readonly string[];
}

/** An id no row has, for an `any` over an empty list. */
const NO_ID = '00000000-0000-0000-0000-000000000000';

const listOf = (ids: readonly string[]) => (ids.length === 0 ? [NO_ID] : [...ids]);

/** The journals an exam of `subjectId` on `date` with these classes and groups reaches. */
export async function ratingJournalsOf(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly yearId: string;
    readonly subjectId: string;
    readonly date: string;
    readonly classIds: readonly string[];
    readonly groupIds: readonly string[];
  },
): Promise<RatingJournals> {
  const { branchId, yearId, subjectId, date } = input;
  const { rows } = await sql<{ journal_id: string; linked: boolean }>`
    with sitting as (
      select m.student_id from class_memberships m
        where m.branch_id = ${branchId}
          and m.class_id = any(${listOf(input.classIds)}::uuid[])
          and m.valid_from <= ${date}::date and m.valid_until > ${date}::date
      union
      select m.student_id from group_memberships m
        where m.branch_id = ${branchId}
          and m.group_id = any(${listOf(input.groupIds)}::uuid[])
          and m.valid_from <= ${date}::date and m.valid_until > ${date}::date
    ),
    reached as (
      select j.id as journal_id, m.student_id from journals j
        join class_memberships m on m.class_id = j.class_id and m.branch_id = j.branch_id
        where j.branch_id = ${branchId} and j.academic_year_id = ${yearId}
          and j.subject_id = ${subjectId} and j.runs @> ${date}::date
          and m.valid_from <= ${date}::date and m.valid_until > ${date}::date
      union all
      select j.id as journal_id, m.student_id from journals j
        join group_memberships m on m.group_id = j.group_id and m.branch_id = j.branch_id
        where j.branch_id = ${branchId} and j.academic_year_id = ${yearId}
          and j.subject_id = ${subjectId} and j.runs @> ${date}::date
          and m.valid_from <= ${date}::date and m.valid_until > ${date}::date
    )
    select r.journal_id,
      bool_and(r.student_id in (select student_id from sitting)) as linked
    from reached r
    group by r.journal_id
    having bool_or(r.student_id in (select student_id from sitting))
    order by r.journal_id
  `.execute(transaction);
  return {
    linked: rows.filter((one) => one.linked).map((one) => one.journal_id),
    notLinked: rows.filter((one) => !one.linked).map((one) => one.journal_id),
  };
}

/**
 * Refuses a rating exam of a subject without one in the quarter of its date
 * (`exam_rating_subject`, decision 5): the switches of that quarter (task
 * 8.2, From 5.6c-3b; `edge/calculation`: "These switches are stored per
 * quarter"). A date in no quarter has no lessons, and the save refuses it
 * first; here it is refused as a subject without the exam.
 */
export async function refuseRatingSubject(
  transaction: Transaction,
  input: { readonly subjectId: string; readonly yearId: string; readonly date: string },
): Promise<void> {
  const quarter = await quarterOnDate(transaction, input.yearId, input.date);
  const switches =
    quarter === undefined
      ? undefined
      : await quarterSwitchesOf(transaction, input.subjectId, quarter.id);
  if (switches?.journal_type !== 'graded' || !switches.rating_exam) {
    throw new ApiException('exam_rating_subject', 409);
  }
}

/**
 * Refuses a journal to link that another standing rating exam of the quarter
 * of `date` already links (`exam_rating_taken`, decision 2). A date in no
 * quarter has no lessons, and the save refuses it first.
 */
export async function refuseRatingTaken(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly yearId: string;
    readonly examId: string | null;
    readonly date: string;
    readonly linked: readonly string[];
  },
): Promise<void> {
  if (input.linked.length === 0) return;
  const quarter = await transaction
    .selectFrom('quarters')
    .select([sql<string>`start_date::text`.as('start'), sql<string>`end_date::text`.as('end')])
    .where('branch_id', '=', input.branchId)
    .where('academic_year_id', '=', input.yearId)
    .where('start_date', '<=', input.date)
    .where('end_date', '>=', input.date)
    .executeTakeFirst();
  if (quarter === undefined) return;
  const taken = await transaction
    .selectFrom('exam_rating_journals')
    .innerJoin('exams', 'exams.id', 'exam_rating_journals.exam_id')
    .select([
      'exam_rating_journals.journal_id',
      'exams.title',
      sql<string>`exams.exam_date::text`.as('date'),
    ])
    .where('exams.branch_id', '=', input.branchId)
    .where('exams.rating_exam', '=', true)
    .where('exams.cancel_cause', 'is', null)
    .where('exams.id', '!=', input.examId ?? NO_ID)
    .where('exams.exam_date', '>=', quarter.start)
    .where('exams.exam_date', '<=', quarter.end)
    .where('exam_rating_journals.linked', '=', true)
    .where('exam_rating_journals.journal_id', 'in', [...input.linked])
    .orderBy('exam_rating_journals.journal_id')
    .orderBy('exams.exam_date')
    .execute();
  if (taken.length === 0) return;
  const details: ErrorDetail[] = taken.map((one, index) => ({
    path: `rating.${String(index)}`,
    code: 'exam_rating_taken',
    message: one.title,
    recordId: one.journal_id,
    day: one.date,
  }));
  throw new ApiException('exam_rating_taken', 409, undefined, details);
}

/** The exam's rows written again: none when it is not a rating exam. */
export async function writeRating(
  transaction: Transaction,
  branchId: string,
  examId: string,
  rating: RatingJournals | null,
): Promise<void> {
  await transaction.deleteFrom('exam_rating_journals').where('exam_id', '=', examId).execute();
  if (rating === null) return;
  const rows = [
    ...rating.linked.map((journalId) => ({ journalId, linked: true })),
    ...rating.notLinked.map((journalId) => ({ journalId, linked: false })),
  ];
  if (rows.length === 0) return;
  await transaction
    .insertInto('exam_rating_journals')
    .values(
      rows.map((one) => ({
        branch_id: branchId,
        exam_id: examId,
        journal_id: one.journalId,
        linked: one.linked,
      })),
    )
    .execute();
}

/** The stored journals of a rating exam, standing or cancelled. */
export async function storedRating(
  transaction: Transaction,
  examId: string,
): Promise<RatingJournals> {
  const rows = await transaction
    .selectFrom('exam_rating_journals')
    .select(['journal_id', 'linked'])
    .where('exam_id', '=', examId)
    .orderBy('journal_id')
    .execute();
  return {
    linked: rows.filter((one) => one.linked).map((one) => one.journal_id),
    notLinked: rows.filter((one) => !one.linked).map((one) => one.journal_id),
  };
}

/** The journals by name, as the API answers them, each list by name. */
export async function ratingNamesOf(
  transaction: Transaction,
  rating: RatingJournals,
): Promise<ExamRating> {
  const ids = [...rating.linked, ...rating.notLinked];
  const rows =
    ids.length === 0
      ? []
      : await transaction
          .selectFrom('journals')
          .leftJoin('classes', 'classes.id', 'journals.class_id')
          .leftJoin('groups', 'groups.id', 'journals.group_id')
          .select([
            'journals.id',
            'journals.class_id',
            'journals.group_id',
            'classes.grade',
            'classes.name as class_name',
            'groups.name as group_name',
          ])
          .where('journals.id', 'in', ids)
          .execute();
  const named = (list: readonly string[]) =>
    list
      .flatMap((id) => {
        const row = rows.find((one) => one.id === id);
        if (row === undefined) return [];
        return [
          {
            id,
            unit:
              row.class_id !== null
                ? {
                    kind: 'class' as const,
                    id: row.class_id,
                    name: classDisplayName(row.grade ?? 0, row.class_name ?? ''),
                  }
                : { kind: 'group' as const, id: row.group_id ?? '', name: row.group_name ?? '' },
          },
        ];
      })
      .sort((a, b) => a.unit.name.localeCompare(b.unit.name) || a.id.localeCompare(b.id));
  return { linked: named(rating.linked), notLinked: named(rating.notLinked) };
}
