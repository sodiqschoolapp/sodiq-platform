import type { Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import type { JournalRow } from './journal-grid.query.js';
import { roleReadingOf } from './journal-scope.js';

/**
 * How a reader reads one student's row of a journal on a day (6.2 decision 20,
 * as the grid decides it; task 9.1, decision 4, Look first): `whole` for a role
 * that reads the journal whole, a Tutor whose class holds the student that day
 * in a group journal (the grid shows a Tutor those rows whole, `shapeOf('tutor')`;
 * `07`, Who can do what: "Tutor | Views journals of own class"), or a Teacher
 * who owns the journal that day; `attendance` for a reader of attendance only;
 * `null` otherwise. The result at leaving and the student results read here.
 */
export type StudentRowReading = 'whole' | 'attendance' | null;

export async function studentRowReading(
  transaction: Transaction,
  access: Access,
  input: {
    readonly branchId: string;
    readonly journal: JournalRow;
    readonly studentId: string;
    readonly day: string;
    /** The reader's staff record when a permitting assignment is a Teacher's, else `null`. */
    readonly staffId: string | null;
  },
): Promise<StudentRowReading> {
  const { journal } = input;
  const reading = roleReadingOf(access, {
    subjectId: journal.subjectId,
    classId: journal.classId,
    groupClassIds: journal.groupClassIds,
  });
  if (reading?.kind === 'whole') return 'whole';
  if (reading?.kind === 'tutor') {
    const own = await transaction
      .selectFrom('class_memberships')
      .select('class_id')
      .where('student_id', '=', input.studentId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', input.day)
      .where('valid_until', '>', input.day)
      .execute();
    if (own.some((row) => reading.classIds.has(row.class_id.toLowerCase()))) return 'whole';
  }
  if (input.staffId !== null) {
    const facts = await ownerFactsOf(transaction, input.branchId, [
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
      input.day,
    );
    if (owner !== null && owner.kind !== 'none' && owner.staffId === input.staffId) {
      return 'whole';
    }
  }
  return reading?.kind === 'attendance' ? 'attendance' : null;
}
