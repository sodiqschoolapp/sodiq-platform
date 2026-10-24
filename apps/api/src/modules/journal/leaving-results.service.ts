import { Injectable } from '@nestjs/common';
import { finalQuarterRecord, studentQuarterOutcome, type StudentQuarterInput } from '@sodiq/calc';
import {
  schoolDateOf,
  studentLeavingResultsSchema,
  type JournalPart,
  type LeavingOutcome,
  type LeavingResult,
  type StudentLeavingResults,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { NO_PLACES, studentPlaces, studentReaderOf } from '../access/class-scope.js';
import type { Access } from '../access/permission.guard.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { ownStaffOf } from './attendance-entry.js';
import { gridWeights, journalRows, switchesIn, type JournalRow } from './journal-grid.query.js';
import { roleReadingOf, teaches } from './journal-scope.js';
import { subjectQuarterLessons } from './subject-quarter-lessons.js';

/**
 * The results at leaving on a student's record (task 8.6, pull request #224;
 * `edge/calculation`, "A student left the school before the quarter ended":
 * "A 'result at leaving' is stored on the profile: partial, labelled, with
 * the number of lessons"). Worked out on read (decision 5, Look first): for
 * the leaving in force, each subject with a held lesson in the quarter of the
 * last day, from `finalQuarterRecord(…, 'at_leaving')` of `packages/calc`
 * fed by `subject-quarter-lessons.ts`, so a save inside the edit period after
 * the leaving changes it. A read writes no audit entry (6.2 decision 17).
 *
 * Who reads (decision 14 with correction 4): the readers of the student's
 * record (`students` `view`, the class scope of the record); each subject only
 * for a reader who reads that subject's journal whole on the last day (6.2
 * decision 20): the journal of the student's last membership of the subject,
 * on its last day. Everything is read through the branch filter of the
 * request, so nothing of another branch is answered (decision 7).
 *
 * An attendance-only subject has no result (task 4.1, decision 13) and is
 * left out.
 */

const DAY_MS = 86_400_000;

const dayBefore = (date: string): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);

const keyOf = (journal: JournalRow) => ({
  subjectId: journal.subjectId,
  classId: journal.classId,
  groupClassIds: journal.groupClassIds,
});

@Injectable()
export class LeavingResults {
  constructor(private readonly transactions: Transactions) {}

  read(access: Access, studentId: string): Promise<StudentLeavingResults> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // An unknown id or another branch's is 404 before the scope is looked at.
      const student = await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .executeTakeFirst();
      if (student === undefined) throw notFound();
      const branch = await transaction
        .selectFrom('branches')
        .select('time_zone')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const now = await transactionMoment(transaction);
      const today = schoolDateOf(now, branch.time_zone);
      const places = (await studentPlaces(transaction, today, studentId)).get(studentId);
      if (studentReaderOf(access, 'students', places ?? NO_PLACES) === undefined) {
        throw new ApiException('permission_denied', 403);
      }
      const lastDay = await leavingLastDay(transaction, studentId, today);
      if (lastDay === null) return studentLeavingResultsSchema.parse({ lastDay, results: [] });
      const quarter = await transaction
        .selectFrom('quarters')
        .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
        .select([
          'quarters.id',
          'quarters.number',
          'quarters.academic_year_id',
          sql<string>`quarters.start_date::text`.as('start_date'),
          sql<string>`quarters.end_date::text`.as('end_date'),
        ])
        .where('academic_years.branch_id', '=', branchId)
        .where('quarters.start_date', '<=', lastDay)
        .where('quarters.end_date', '>=', lastDay)
        .executeTakeFirst();
      if (quarter === undefined) return studentLeavingResultsSchema.parse({ lastDay, results: [] });
      const dates = { id: quarter.id, startDate: quarter.start_date, endDate: quarter.end_date };

      const subjects = await subjectsOf(transaction, studentId, quarter.academic_year_id, dates);
      const staffId = teaches(access) ? await ownStaffOf(transaction, access.accountId) : null;
      // Parsed by the answer's schema below, which checks the colour as the grid's does.
      const results: (Omit<LeavingResult, 'subject'> & {
        subject: Omit<LeavingResult['subject'], 'colour'> & { colour: string };
      })[] = [];
      for (const subjectId of subjects) {
        const found = (
          await subjectQuarterLessons(transaction, {
            branchId,
            timeZone: branch.time_zone,
            now,
            academicYearId: quarter.academic_year_id,
            subjectId,
            quarter: dates,
            studentIds: [studentId],
          })
        ).get(studentId);
        if (found === undefined || found.heldInJournals === 0) continue;
        const last = found.spans.reduce<(typeof found.spans)[number] | undefined>(
          (latest, span) => (latest === undefined || span.until > latest.until ? span : latest),
          undefined,
        );
        if (last === undefined) continue;
        const [journal] = await journalRows(transaction, branchId, { journalId: last.journalId });
        if (journal === undefined) continue;
        if (!(await readsWhole(transaction, access, branchId, journal, staffId, last.until))) {
          continue;
        }
        const switches = switchesIn(journal, quarter.id);
        if (switches === undefined || switches.attendanceOnly) continue;
        const weights = await gridWeights(transaction, branchId, subjectId, quarter.id);
        if (weights.quarterly === null) continue;
        const ratingShown = switches.ratingExam && weights.quarterly.ratingExam !== null;
        const atLeaving = found.atLeaving ?? lastDay;
        const input: StudentQuarterInput = {
          weights: weights.quarterly,
          attendanceValues: { lateValue: weights.lateValue, skippedValue: weights.skippedValue },
          lessons: found.lessons.map((one) => one.lesson),
          ratingExam: ratingShown ? found.ratingExam : null,
          quarterClosed: false,
          heldInJournals: found.heldInJournals,
          countsFrom: null,
          leftSubjectOn: null,
          atLeaving,
          decision: null,
        };
        const record = finalQuarterRecord(input, 'at_leaving');
        results.push({
          subject: {
            id: journal.subjectId,
            names: journal.subject.names,
            colour: journal.subject.colour,
          },
          unit: {
            kind: journal.classId === null ? 'group' : 'class',
            id: journal.classId ?? journal.groupId ?? '',
            name: journal.unitName,
          },
          quarter: { id: quarter.id, number: quarter.number },
          lastDay: atLeaving,
          outcome: shownOf(studentQuarterOutcome(record.inputs)),
        });
      }
      results.sort((a, b) => a.subject.names.en.localeCompare(b.subject.names.en, 'en'));
      return studentLeavingResultsSchema.parse({ lastDay, results });
    });
  }
}

/**
 * The last day of the student's leaving in force: the last live status row is
 * inactive by a leaving and started on or before today (`student-status.ts`:
 * "the inactive row starts the day after it"); `null` otherwise.
 */
async function leavingLastDay(
  transaction: Transaction,
  studentId: string,
  today: string,
): Promise<string | null> {
  const last = await transaction
    .selectFrom('student_statuses')
    .select(['status', 'cause', sql<string>`valid_from::text`.as('valid_from')])
    .where('student_id', '=', studentId)
    .where(sql<boolean>`valid_from < coalesce(valid_until, 'infinity'::date)`)
    .orderBy('valid_from', 'desc')
    .limit(1)
    .executeTakeFirst();
  if (last?.status !== 'inactive' || last.cause !== 'leaving' || last.valid_from > today) {
    return null;
  }
  return dayBefore(last.valid_from);
}

/** The subjects of the journals of the student's class and group rows meeting the quarter. */
async function subjectsOf(
  transaction: Transaction,
  studentId: string,
  yearId: string,
  quarter: { readonly startDate: string; readonly endDate: string },
): Promise<string[]> {
  const [classes, groups] = await Promise.all([
    transaction
      .selectFrom('class_memberships')
      .select('class_id')
      .where('student_id', '=', studentId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', quarter.endDate)
      .where('valid_until', '>', quarter.startDate)
      .execute(),
    transaction
      .selectFrom('group_memberships')
      .select('group_id')
      .where('student_id', '=', studentId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', quarter.endDate)
      .where('valid_until', '>', quarter.startDate)
      .execute(),
  ]);
  const classIds = [...new Set(classes.map((row) => row.class_id))];
  const groupIds = [...new Set(groups.map((row) => row.group_id))];
  if (classIds.length === 0 && groupIds.length === 0) return [];
  const rows = await transaction
    .selectFrom('journals')
    .select('subject_id')
    .distinct()
    .where('academic_year_id', '=', yearId)
    .where((eb) =>
      eb.or([
        ...(classIds.length === 0 ? [] : [eb('class_id', 'in', classIds)]),
        ...(groupIds.length === 0 ? [] : [eb('group_id', 'in', groupIds)]),
      ]),
    )
    .orderBy('subject_id')
    .execute();
  return rows.map((row) => row.subject_id);
}

/**
 * Whether the reader reads the journal whole on `day` (6.2 decision 20, as the
 * grid decides it): a role that reads it whole, or a Teacher who owns it that day.
 */
async function readsWhole(
  transaction: Transaction,
  access: Access,
  branchId: string,
  journal: JournalRow,
  staffId: string | null,
  day: string,
): Promise<boolean> {
  if (roleReadingOf(access, keyOf(journal))?.kind === 'whole') return true;
  if (staffId === null) return false;
  const facts = await ownerFactsOf(transaction, branchId, [
    {
      id: journal.id,
      academic_year_id: journal.academicYearId,
      class_id: journal.classId,
      group_id: journal.groupId,
      subject_id: journal.subjectId,
    },
  ]);
  const owner = ownerOn(
    facts.runs.get(journal.id) ?? [],
    facts.periods.get(journal.id) ?? [],
    facts.out,
    day,
  );
  return owner !== null && owner.kind !== 'none' && owner.staffId === staffId;
}

/** The outcome as the record shows it: "based on n of N lessons" on every number. */
function shownOf(outcome: ReturnType<typeof studentQuarterOutcome>): LeavingOutcome {
  if (outcome.kind === 'exempt') return { kind: 'exempt' };
  if (outcome.kind !== 'number') return { kind: 'no_result' };
  return {
    kind: 'number',
    shown: Number(outcome.result.shown),
    grade: outcome.result.grade,
    provisional: outcome.result.provisional,
    leftOut: outcome.result.leftOut.map((one): JournalPart => one.part),
    basedOn: outcome.basedOn,
  };
}
