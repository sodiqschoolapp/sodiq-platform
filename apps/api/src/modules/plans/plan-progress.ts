import type { Transaction } from '../../database/transactions.js';
import type { JournalRow } from '../journal/journal-grid.query.js';
import { journalsColumns } from '../journal/journal-works.query.js';
import { trayCounts } from './plan-outcomes.js';

/**
 * What the progress report of `09` (Reports, Progress) counts of each journal in a quarter: its
 * rows (the lessons of the quarter not cancelled), the rows with a topic, the held lessons, the
 * delivered ones, and the planned works and those "not held" at each held lesson. Task 10.1b: one
 * function for the report read from source and the `plan_progress` unit of the prepared totals
 * (a quarter and a journal), which stores what it gives; the person each held lesson counts for
 * and the items not covered are read on each request.
 */
export interface JournalProgress {
  readonly rows: number;
  readonly planned: number;
  readonly held: number;
  readonly delivered: number;
  readonly heldLessons: readonly {
    readonly id: string;
    readonly date: string;
    readonly teacherId: string | null;
    readonly planned: number;
    readonly notHeld: number;
  }[];
}

export async function journalProgressOf(
  transaction: Transaction,
  journals: readonly JournalRow[],
  quarter: { readonly startDate: string; readonly endDate: string },
  timeZone: string,
  now: Date,
): Promise<Map<string, JournalProgress>> {
  const found = new Map<string, JournalProgress>();
  if (journals.length === 0) return found;
  const all = await journalsColumns(transaction, journals, timeZone, now);
  const inQuarter = (date: string) => quarter.startDate <= date && date <= quarter.endDate;
  const withTopic = (lessonId: string) => {
    const item = all.items.get(lessonId);
    return item !== null && item !== undefined && item.topic.trim() !== '';
  };
  for (const journal of journals) {
    const one = all.journals.get(journal.id);
    const rows = (one?.lessons ?? []).filter(
      (lesson) => lesson.cancelCause === null && inQuarter(lesson.date),
    );
    const held = rows.filter((lesson) => all.held.has(lesson.id));
    found.set(journal.id, {
      rows: rows.length,
      planned: rows.filter((lesson) => withTopic(lesson.id)).length,
      held: held.length,
      delivered: held.filter((lesson) => withTopic(lesson.id) && !all.notDelivered.has(lesson.id))
        .length,
      heldLessons: held.map((lesson) => {
        const columns = one?.columns.get(lesson.id);
        const planned = [...(columns?.columns ?? []), ...(columns?.notHeld ?? [])].filter(
          (column) => column.planWorkId !== null && !column.unplanned,
        );
        return {
          id: lesson.id,
          date: lesson.date,
          teacherId: lesson.teacherId,
          planned: planned.length,
          notHeld: planned.filter((column) => column.notHeld).length,
        };
      }),
    });
  }
  return found;
}

/**
 * The items not covered of each journal named in a quarter (`09`, Reports, Progress): the items
 * placed past the journal's rows of the quarter, and (task 9.2d, decision 10) the items "carried
 * in" its tray. One rule for the progress report and the closing checklist (task 10.1b).
 */
export async function notCoveredOf(
  transaction: Transaction,
  journalIds: readonly string[],
  quarterId: string,
  rowsOf: (journalId: string) => number,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (journalIds.length === 0) return counts;
  const links = await transaction
    .selectFrom('lesson_plan_journals')
    .select(['plan_id', 'journal_id'])
    .where('journal_id', 'in', [...journalIds])
    .where('quarter_id', '=', quarterId)
    .execute();
  const places =
    links.length === 0
      ? []
      : await transaction
          .selectFrom('lesson_plan_places')
          .innerJoin('lesson_plan_items', 'lesson_plan_items.id', 'lesson_plan_places.item_id')
          .select(['lesson_plan_places.journal_id', 'lesson_plan_places.position'])
          .where(
            'lesson_plan_places.plan_id',
            'in',
            links.map((link) => link.plan_id),
          )
          .where('lesson_plan_items.cleared_at', 'is', null)
          .execute();
  const tray = (await trayCounts(transaction, journalIds, quarterId)).counts;
  for (const journalId of journalIds) {
    const rows = rowsOf(journalId);
    counts.set(
      journalId,
      places.filter((place) => place.journal_id === journalId && place.position > rows).length +
        (tray.get(journalId) ?? 0),
    );
  }
  return counts;
}
