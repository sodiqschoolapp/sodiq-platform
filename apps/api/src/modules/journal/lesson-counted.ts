import type { Transaction } from '../../database/transactions.js';
import { journalKeysOf, ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { substitutionsInForce } from '../timetable/substitutions-read.js';

/**
 * Who a lesson counts for (task 8.7, pull request #225, decision 13): the
 * substitute while a substitution is in force (`07`: "A substituted lesson
 * counts for the substitute on that day"; From 5.7b-1: the substitute is
 * `lessons.teacher_id`), otherwise the journal's owner on the lesson's date
 * (From 5.7a-3c: `journalOwnerOn`, the acting teacher under a vacancy); a
 * lesson whose owner is `none` counts for nobody (`edge/timetable`: "Nothing
 * is ever counted against a vacancy"). The one reader of the teaching home,
 * the reminders, the counts per teacher and the orphan lessons.
 */
export interface CountedLesson {
  readonly id: string;
  readonly journalId: string | null;
  readonly date: string;
  readonly teacherId: string | null;
}

/** The staff record each lesson counts for, `null` for nobody, by lesson id. */
export async function lessonsCounted(
  transaction: Transaction,
  branchId: string,
  lessons: readonly CountedLesson[],
): Promise<Map<string, string | null>> {
  const found = new Map<string, string | null>();
  if (lessons.length === 0) return found;
  const substituted = await substitutionsInForce(
    transaction,
    lessons.map((one) => ({ id: one.id, teacherId: one.teacherId })),
  );
  const journals = await journalKeysOf(transaction, branchId, [
    ...new Set(lessons.flatMap((one) => (one.journalId === null ? [] : [one.journalId]))),
  ]);
  const facts = await ownerFactsOf(transaction, branchId, journals);
  for (const lesson of lessons) {
    const substitution = substituted.get(lesson.id);
    if (substitution !== undefined) {
      found.set(lesson.id, substitution.substituteId);
      continue;
    }
    if (lesson.journalId === null) {
      found.set(lesson.id, null);
      continue;
    }
    const owner = ownerOn(
      facts.runs.get(lesson.journalId) ?? [],
      facts.periods.get(lesson.journalId) ?? [],
      facts.out,
      lesson.date,
    );
    found.set(lesson.id, owner === null || owner.kind === 'none' ? null : owner.staffId);
  }
  return found;
}
