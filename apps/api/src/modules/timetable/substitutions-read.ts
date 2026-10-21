import type { Transaction } from '../../database/transactions.js';

/**
 * The substitutions in force (task 5.7b-1, pull request #191, decision 6): a
 * row of `substitution_lessons` (0101) with no end whose lesson's teacher is
 * its substitute, read on each request. The record names the teacher first
 * replaced (decision 5) and whether it was saved under the exception "no
 * teacher of the subject is free" (`relaxed`).
 */
export interface SubstitutionInForce {
  /** The record (`substitutions`). */
  readonly id: string;
  /** The lesson's row of the record (`substitution_lessons`). */
  readonly rowId: string;
  readonly replacedId: string | null;
  readonly substituteId: string;
  /** The lesson's own value (task 5.7b-2, decision 3: decided per date). */
  readonly relaxed: boolean;
  /** Task 5.7b-2 (decision 4): the absence the substitution was made for, or `null`. */
  readonly absenceId: string | null;
}

/** The substitution in force of each lesson named that has one, by lesson id. */
export async function substitutionsInForce(
  transaction: Transaction,
  lessons: readonly { readonly id: string; readonly teacherId: string | null }[],
): Promise<Map<string, SubstitutionInForce>> {
  const found = new Map<string, SubstitutionInForce>();
  if (lessons.length === 0) return found;
  const rows = await transaction
    .selectFrom('substitution_lessons')
    .innerJoin('substitutions', 'substitutions.id', 'substitution_lessons.substitution_id')
    .select([
      'substitution_lessons.id as row_id',
      'substitution_lessons.lesson_id',
      'substitutions.id',
      'substitutions.replaced_id',
      'substitutions.substitute_id',
      'substitution_lessons.relaxed',
      'substitutions.absence_id',
    ])
    .where(
      'substitution_lessons.lesson_id',
      'in',
      lessons.map((one) => one.id),
    )
    .where('substitution_lessons.ended_at', 'is', null)
    .execute();
  const teacherOf = new Map(lessons.map((one) => [one.id, one.teacherId]));
  for (const row of rows) {
    if (row.lesson_id === null || teacherOf.get(row.lesson_id) !== row.substitute_id) continue;
    found.set(row.lesson_id, {
      id: row.id,
      rowId: row.row_id,
      replacedId: row.replaced_id,
      substituteId: row.substitute_id,
      relaxed: row.relaxed,
      absenceId: row.absence_id,
    });
  }
  return found;
}

/**
 * Ends the live rows of the lessons named (decision 6, review correction 1),
 * with the moment of the transaction and the account of the change: every
 * writer that takes a substitute off a lesson or removes the lesson. Answers
 * the rows ended, for the change's audit entry.
 */
export async function endSubstitutionRows(
  transaction: Transaction,
  input: {
    readonly lessonIds: readonly string[];
    readonly cause: 'withdrawn' | 'replaced' | 'corrected' | 'dropped' | 'returned';
    readonly accountId: string;
    readonly moment: Date;
  },
): Promise<{ readonly lessonId: string; readonly substitutionId: string }[]> {
  const ended: { lessonId: string; substitutionId: string }[] = [];
  const ROWS = 500;
  for (let at = 0; at < input.lessonIds.length; at += ROWS) {
    const rows = await transaction
      .updateTable('substitution_lessons')
      .set({ ended_at: input.moment, end_cause: input.cause, ended_by: input.accountId })
      .where('lesson_id', 'in', input.lessonIds.slice(at, at + ROWS))
      .where('ended_at', 'is', null)
      .returning(['lesson_id', 'substitution_id'])
      .execute();
    for (const row of rows) {
      if (row.lesson_id !== null) {
        ended.push({ lessonId: row.lesson_id, substitutionId: row.substitution_id });
      }
    }
  }
  return ended.sort(
    (a, b) =>
      a.lessonId.localeCompare(b.lessonId) || a.substitutionId.localeCompare(b.substitutionId),
  );
}

/**
 * Writes a substitution record and its rows (0101), at the transaction's
 * moment; answers the record's id. The correction of a past lesson (task
 * 5.6a-4) writes one of source `correction`; the per-journal actions of
 * task 5.7b-2 `absence` and `journal`, with the journal (0102). Each
 * lesson keeps its own `relaxed` (decision 3); the record's is true when
 * any lesson's is.
 */
export async function writeRecord(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly source: 'lesson' | 'correction' | 'absence' | 'journal';
    readonly replacedId: string | null;
    readonly substituteId: string;
    readonly reason: string;
    readonly moment: Date;
    readonly accountId: string;
    readonly absenceId?: string | null;
    readonly journalId?: string | null;
    readonly lessons: readonly {
      readonly id: string;
      readonly date: string;
      readonly relaxed: boolean;
    }[];
  },
): Promise<string> {
  const record = await transaction
    .insertInto('substitutions')
    .values({
      branch_id: input.branchId,
      source: input.source,
      replaced_id: input.replacedId,
      substitute_id: input.substituteId,
      relaxed: input.lessons.some((one) => one.relaxed),
      reason: input.reason,
      absence_id: input.absenceId ?? null,
      journal_id: input.journalId ?? null,
      made_at: input.moment,
      made_by: input.accountId,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await transaction
    .insertInto('substitution_lessons')
    .values(
      input.lessons.map((one) => ({
        substitution_id: record.id,
        branch_id: input.branchId,
        lesson_id: one.id,
        lesson_date: one.date,
        relaxed: one.relaxed,
      })),
    )
    .execute();
  return record.id;
}
