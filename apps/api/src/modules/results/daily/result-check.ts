import { CalcInputError, recalculateAndCompare, storedQuarterInputs } from '@sodiq/calc';
import type { StudentQuarterInput } from '@sodiq/calc';
import { schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../../database/transactions.js';
import { transactionMoment } from '../../../database/transactions.js';
import { closingOf, recordsInForce, reopenedJournals } from '../../setup/closed-quarters.js';
import type { QuarterRef } from '../grade-changes.js';
import { quarterOutcomes } from '../quarter-outcomes.js';

/**
 * The nightly check of one branch (task 9.2c, pull request #231; `edge/system-behaviour`, "The
 * nightly check": "It recalculates open journals and stored final results. A difference alerts
 * the developer and blocks closing that journal"; `14`: "results can be recalculated at any time
 * and must match"; plan decision 6, Look first). Read-only: the caller runs it in one consistent
 * snapshot (review should-fix 4) and stores what it finds.
 *
 * - An open journal (its quarter has no branch close in force, or it has an unfinished
 *   reopening): each cell, work and rating entry of the quarter against the last line of its
 *   history (value and version), compared in one statement each; every listed student's outcome
 *   through `quarterOutcomes` (a `CalcInputError` is `refused`).
 * - Every other journal of a closed quarter: the record in force of each listed student (the
 *   highest version, as the readers take it; review must-fix 5) through `recalculateAndCompare`
 *   of `packages/calc` (`stored_module`), its stored inputs against the inputs read again from the
 *   entries (`stored_entries`), and a listed student with no record in force (`record_missing`).
 *
 * Nothing is calculated here: the outcomes and the comparison are the module's.
 */

export type CheckDifferenceKind =
  | 'cell_history'
  | 'work_history'
  | 'rating_history'
  | 'refused'
  | 'stored_module'
  | 'stored_entries'
  | 'record_missing';

export interface CheckDifference {
  readonly quarterId: string;
  readonly journalId: string;
  readonly subjectId: string | null;
  readonly studentId: string | null;
  readonly kind: CheckDifferenceKind;
  /** Ids, versions, paths and codes; no names and no values typed. */
  readonly detail: Record<string, string | number | boolean | null | readonly string[]>;
}

export interface CheckFound {
  readonly differences: CheckDifference[];
  readonly journals: number;
  readonly records: number;
}

/** The quarters the check reads: dated, of a year not closed, started by today. */
async function checkedQuarters(
  transaction: Transaction,
  branchId: string,
  today: string,
): Promise<QuarterRef[]> {
  const rows = await transaction
    .selectFrom('quarters')
    .innerJoin('academic_years', 'academic_years.id', 'quarters.academic_year_id')
    .select([
      'quarters.id',
      'quarters.number',
      'quarters.academic_year_id',
      sql<string>`quarters.start_date::text`.as('start_date'),
      sql<string>`quarters.end_date::text`.as('end_date'),
    ])
    .where('quarters.branch_id', '=', branchId)
    .where('academic_years.status', '<>', 'closed')
    .where('quarters.start_date', 'is not', null)
    .where('quarters.start_date', '<=', today)
    .orderBy('quarters.start_date')
    .execute();
  return rows.map((row) => ({
    id: row.id,
    number: row.number,
    academicYearId: row.academic_year_id,
    startDate: row.start_date,
    endDate: row.end_date,
  }));
}

/** The journal a student is listed under: the one of the latest membership in the quarter. */
function listedJournalOf(
  spans: readonly { journalId: string; from: string }[],
  fallback: string,
): string {
  const latest = [...spans].sort((a, b) => a.from.localeCompare(b.from)).at(-1);
  return latest?.journalId ?? fallback;
}

/** The inputs as the record stores them, in its one order of fields. */
function inputsShape(input: StudentQuarterInput): string {
  return JSON.stringify(storedQuarterInputs({ format: 1, inputs: input }));
}

/** Cells, works and rating entries whose value or version is not their history's last line. */
async function historyDifferences(
  transaction: Transaction,
  quarter: QuarterRef,
  open: (journalId: string) => boolean,
): Promise<CheckDifference[]> {
  const found: CheckDifference[] = [];
  const cells = await sql<{
    id: string;
    lesson_id: string;
    student_id: string;
    version: number;
    history_version: number | null;
    journal_id: string | null;
  }>`
    select c.id, c.lesson_id, c.student_id, c.version, h.version as history_version,
      lesson_journal(c.lesson_id) as journal_id
    from journal_cells c
    join lessons l on l.id = c.lesson_id
    join lesson_blocks b on b.id = l.block_id
    left join lateral (
      select x.version, x.mark_after, x.score_after from journal_cell_history x
      where x.cell_id = c.id order by x.version desc limit 1
    ) h on true
    where b.quarter_id = ${quarter.id}::uuid
      and (
        h.version is null or h.version <> c.version
        or h.mark_after is distinct from c.mark or h.score_after is distinct from c.score
      )
    order by c.id
  `.execute(transaction);
  for (const row of cells.rows) {
    if (row.journal_id === null || !open(row.journal_id)) continue;
    found.push({
      quarterId: quarter.id,
      journalId: row.journal_id,
      subjectId: null,
      studentId: row.student_id,
      kind: 'cell_history',
      detail: {
        cellId: row.id,
        lessonId: row.lesson_id,
        version: row.version,
        historyVersion: row.history_version,
      },
    });
  }
  const works = await sql<{
    id: string;
    lesson_id: string;
    version: number;
    history_version: number | null;
    journal_id: string | null;
  }>`
    select w.id, w.lesson_id, w.version, h.version as history_version,
      lesson_journal(w.lesson_id) as journal_id
    from journal_works w
    join lessons l on l.id = w.lesson_id
    join lesson_blocks b on b.id = l.block_id
    left join lateral (
      select x.version, x.total_after, x.not_held_after from journal_work_history x
      where x.work_id = w.id order by x.version desc limit 1
    ) h on true
    where b.quarter_id = ${quarter.id}::uuid
      and (
        h.version is null or h.version <> w.version
        or h.total_after is distinct from w.total or h.not_held_after is distinct from w.not_held
      )
    order by w.id
  `.execute(transaction);
  for (const row of works.rows) {
    if (row.journal_id === null || !open(row.journal_id)) continue;
    found.push({
      quarterId: quarter.id,
      journalId: row.journal_id,
      subjectId: null,
      studentId: null,
      kind: 'work_history',
      detail: {
        workId: row.id,
        lessonId: row.lesson_id,
        version: row.version,
        historyVersion: row.history_version,
      },
    });
  }
  const ratings = await sql<{
    id: string;
    student_id: string;
    version: number;
    history_version: number | null;
    journal_id: string;
  }>`
    select e.id, e.student_id, e.version, h.version as history_version, x.journal_id
    from journal_rating_entries e
    join journal_rating_exams x on x.id = e.rating_exam_id
    left join lateral (
      select y.version, y.kind_after, y.score_after from journal_rating_history y
      where y.entry_id = e.id order by y.version desc limit 1
    ) h on true
    where x.quarter_id = ${quarter.id}::uuid
      and (
        h.version is null or h.version <> e.version
        or h.kind_after is distinct from e.kind or h.score_after is distinct from e.score
      )
    order by e.id
  `.execute(transaction);
  for (const row of ratings.rows) {
    if (!open(row.journal_id)) continue;
    found.push({
      quarterId: quarter.id,
      journalId: row.journal_id,
      subjectId: null,
      studentId: row.student_id,
      kind: 'rating_history',
      detail: { entryId: row.id, version: row.version, historyVersion: row.history_version },
    });
  }
  return found;
}

/** Every difference of the branch's quarters (see the comment at the top). */
export async function checkBranch(transaction: Transaction, branchId: string): Promise<CheckFound> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const now = await transactionMoment(transaction);
  const today = schoolDateOf(now, branch.time_zone);
  const differences: CheckDifference[] = [];
  let journals = 0;
  let records = 0;
  for (const quarter of await checkedQuarters(transaction, branchId, today)) {
    const closed = (await closingOf(transaction, quarter.id)) !== undefined;
    const reopened = new Set(
      [...(await reopenedJournals(transaction, [quarter.id]))].map(
        (key) => key.split('|')[1] ?? '',
      ),
    );
    const open = (journalId: string): boolean => !closed || reopened.has(journalId);
    differences.push(...(await historyDifferences(transaction, quarter, open)));

    // The outcomes, subject by subject, so that a refusal names its subject's journals.
    const subjects = await transaction
      .selectFrom('journals')
      .select(['id', 'subject_id'])
      .where('branch_id', '=', branchId)
      .where('academic_year_id', '=', quarter.academicYearId)
      .orderBy('subject_id')
      .orderBy('id')
      .execute();
    const bySubject = new Map<string, string[]>();
    for (const row of subjects) {
      bySubject.set(row.subject_id, [...(bySubject.get(row.subject_id) ?? []), row.id]);
    }
    const inForce = closed ? await recordsInForce(transaction, quarter.id) : new Map();
    records += inForce.size;
    for (const [subjectId, journalIds] of bySubject) {
      let outcomes;
      try {
        ({ journals: outcomes } = await quarterOutcomes(transaction, {
          branchId,
          timeZone: branch.time_zone,
          now,
          quarter,
          subjectIds: [subjectId],
          quarterClosed: closed,
        }));
      } catch (error) {
        if (!(error instanceof CalcInputError)) throw error;
        for (const journalId of journalIds) {
          differences.push({
            quarterId: quarter.id,
            journalId,
            subjectId,
            studentId: null,
            kind: 'refused',
            detail: { code: error.code },
          });
        }
        continue;
      }
      for (const [journalId, one] of outcomes) {
        journals += 1;
        if (open(journalId)) continue;
        for (const [studentId, member] of one.members) {
          if (member.input === null || member.outcome === null) continue;
          if (listedJournalOf(member.found?.spans ?? [], journalId) !== journalId) continue;
          const stored = inForce.get(`${subjectId}|${studentId}`);
          if (stored === undefined) {
            differences.push({
              quarterId: quarter.id,
              journalId,
              subjectId,
              studentId,
              kind: 'record_missing',
              detail: {},
            });
            continue;
          }
          let comparison;
          try {
            comparison = recalculateAndCompare(stored.record);
          } catch (error) {
            // A record that is not of its format is a difference too, never a stop.
            if (!(error instanceof CalcInputError)) throw error;
            differences.push({
              quarterId: quarter.id,
              journalId,
              subjectId,
              studentId,
              kind: 'stored_module',
              detail: { closingId: stored.closingId, code: error.code },
            });
            continue;
          }
          if (!comparison.same) {
            differences.push({
              quarterId: quarter.id,
              journalId,
              subjectId,
              studentId,
              kind: 'stored_module',
              detail: {
                closingId: stored.closingId,
                storedVersion: comparison.storedVersion,
                currentVersion: comparison.currentVersion,
                paths: comparison.differences.slice(0, 50),
                refused: comparison.refused,
              },
            });
            continue;
          }
          if (inputsShape(storedQuarterInputs(stored.record)) !== inputsShape(member.input)) {
            differences.push({
              quarterId: quarter.id,
              journalId,
              subjectId,
              studentId,
              kind: 'stored_entries',
              detail: { closingId: stored.closingId },
            });
          }
        }
      }
    }
  }
  return { differences, journals, records };
}
