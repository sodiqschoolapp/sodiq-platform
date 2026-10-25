import type { Transaction } from '../../database/transactions.js';
import { journalRows } from '../journal/journal-grid.query.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import type { QuarterRef } from './grade-changes.js';

const DAY_MS = 86_400_000;

const addDays = (date: string, days: number): string =>
  new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * The accounts told of a change of a quarterly distribution (task 9.1,
 * decision 11; `edge/calculation`, week 7: "tells the subject's teachers"):
 * the owners of the subject's journals of the year on the days of the quarter
 * up to today, or on its first day when it has not started (`ownerOn`, the one
 * reader of who owns a journal on a day: the acting teacher of a vacancy
 * included, a journal with "no teacher" telling nobody), each account once.
 */
export async function weightsNoticeAccounts(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly subjectId: string;
    readonly quarter: QuarterRef;
    readonly today: string;
  },
): Promise<string[]> {
  const { quarter } = input;
  const journals = (
    await journalRows(transaction, input.branchId, { yearId: quarter.academicYearId })
  ).filter((journal) => journal.subjectId === input.subjectId);
  if (journals.length === 0) return [];
  const facts = await ownerFactsOf(
    transaction,
    input.branchId,
    journals.map((journal) => ({
      id: journal.id,
      academic_year_id: journal.academicYearId,
      class_id: journal.classId,
      group_id: journal.groupId,
      subject_id: journal.subjectId,
    })),
  );
  const last =
    input.today < quarter.startDate
      ? quarter.startDate
      : input.today < quarter.endDate
        ? input.today
        : quarter.endDate;
  const staffIds = new Set<string>();
  for (const journal of journals) {
    for (let day = quarter.startDate; day <= last; day = addDays(day, 1)) {
      const owner = ownerOn(
        facts.runs.get(journal.id) ?? [],
        facts.periods.get(journal.id) ?? [],
        facts.out,
        day,
      );
      if (owner !== null && owner.kind !== 'none') staffIds.add(owner.staffId);
    }
  }
  if (staffIds.size === 0) return [];
  const rows = await transaction
    .selectFrom('staff')
    .select('account_id')
    .where('id', 'in', [...staffIds])
    .where('account_id', 'is not', null)
    .execute();
  return [...new Set(rows.flatMap((row) => (row.account_id === null ? [] : [row.account_id])))];
}
