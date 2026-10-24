import type { RatingEntryValue, RatingExam, Role } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import type { Access } from '../access/permission.guard.js';
import { ownerOn, type OwnerFacts } from '../timetable/journal-owners.js';
import { entersByRole } from './attendance-entry.js';
import { namedAccounts } from './cell-lines.query.js';
import { markersOf } from './cell-markers.js';
import { editLockOf, lockOf, unlocksOfRating } from './edit-window.js';
import { switchesIn, type JournalRow } from './journal-grid.query.js';

/**
 * The rating exam of a journal in a quarter (task 8.2, pull request #218):
 * the stored row, the date in force (`journal_rating_date`, 0120: a standing
 * linked exam's, else the hand-set one) and who may do what. The grid and the
 * routes read it here, so they decide the same way.
 *
 * `edge/calculation`, "The rating exam": "an exam date set by the teacher or
 * the Academic Vice Principal ... The journal's teacher enters scores from
 * that date ... 'did not sit' (counts 0, set by the teacher) or 'exempt' (set
 * only by the Academic Vice Principal)"; "The exam is not held for one group":
 * "The Academic Vice Principal marks the exam 'not held'". The teacher is the
 * journal's teacher on the day of the entry (From 5.7a-3c, `ownerOn`).
 */

/** The roles that set "exempt" and "not held" in the branch (the Super Admin does what any role can, `02`). */
const VICE_PRINCIPAL_ROLES: readonly Role[] = ['super_admin', 'academic_vice_principal'];

/** The stored rating exam row, or `null` before the first write. */
export interface RatingRow {
  readonly id: string;
  readonly examDate: string | null;
  readonly notHeld: boolean;
  readonly version: number;
}

/** A stored entry with its author. */
export interface EntryRow {
  readonly id: string;
  readonly changedHow: string;
  readonly studentId: string;
  readonly entry: RatingEntryValue | null;
  readonly version: number;
  readonly changedBy: string;
  readonly changedAt: Date;
}

/** Who may do what on the rating exam, and the assignment each right is taken from. */
export interface RatingRights {
  /** The journal's teacher today: types scores and "did not sit", sets the hand date. */
  readonly teacher: boolean;
  /** The Academic Vice Principal or the Super Admin: "exempt", "not held", the hand date. */
  readonly vicePrincipal: string | null;
}

export const entryOf = (row: {
  readonly kind: string | null;
  readonly score: number | null;
}): RatingEntryValue | null => {
  if (row.kind === 'score' && row.score !== null) return { kind: 'score', score: row.score };
  if (row.kind === 'did_not_sit') return { kind: 'did_not_sit' };
  if (row.kind === 'exempt') return { kind: 'exempt' };
  return null;
};

/** The rights of the reader on a journal's rating exam today (`today` in branch time). */
export function ratingRightsOf(
  access: Access,
  branchId: string,
  input: {
    readonly journal: JournalRow;
    readonly facts: OwnerFacts;
    readonly staffId: string | null;
    readonly today: string;
  },
): RatingRights {
  const owner = ownerOn(
    input.facts.runs.get(input.journal.id) ?? [],
    input.facts.periods.get(input.journal.id) ?? [],
    input.facts.out,
    input.today,
  );
  const teacher =
    entersByRole(access, branchId) &&
    input.staffId !== null &&
    owner !== null &&
    owner.kind !== 'none' &&
    owner.staffId === input.staffId;
  const vicePrincipal =
    access.permitting.find(
      (assignment) =>
        VICE_PRINCIPAL_ROLES.includes(assignment.role) &&
        (assignment.branchId === null || assignment.branchId === branchId.toLowerCase()),
    )?.id ?? null;
  return { teacher, vicePrincipal };
}

/** The stored row of the journal and quarter; `null` before its first write. */
export async function ratingRowOf(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
  lock: 'none' | 'update' = 'none',
): Promise<RatingRow | null> {
  let query = transaction
    .selectFrom('journal_rating_exams')
    .select(['id', sql<string | null>`exam_date::text`.as('exam_date'), 'not_held', 'version'])
    .where('journal_id', '=', journalId)
    .where('quarter_id', '=', quarterId);
  if (lock === 'update') query = query.forUpdate();
  const row = await query.executeTakeFirst();
  return row === undefined
    ? null
    : { id: row.id, examDate: row.exam_date, notHeld: row.not_held, version: row.version };
}

/** The date in force and whether a linked exam gives it (`journal_rating_date`, 0120). */
export async function ratingDateOf(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
): Promise<{ readonly date: string | null; readonly fromExam: boolean }> {
  const { rows } = await sql<{ linked: string | null; in_force: string | null }>`
    select journal_rating_linked_date(${journalId}::uuid, ${quarterId}::uuid)::text as linked,
      journal_rating_date(${journalId}::uuid, ${quarterId}::uuid)::text as in_force
  `.execute(transaction);
  const found = rows[0];
  return { date: found?.in_force ?? null, fromExam: (found?.linked ?? null) !== null };
}

/** The entries of a rating exam row, of the students named, by student. */
export async function entriesOf(
  transaction: Transaction,
  ratingExamId: string,
  studentIds: readonly string[] | null,
): Promise<EntryRow[]> {
  let query = transaction
    .selectFrom('journal_rating_entries')
    .select([
      'id',
      'student_id',
      'kind',
      'score',
      'version',
      'changed_by',
      'changed_how',
      'changed_at',
    ])
    .where('rating_exam_id', '=', ratingExamId);
  if (studentIds !== null) {
    if (studentIds.length === 0) return [];
    query = query.where('student_id', 'in', studentIds);
  }
  const rows = await query.orderBy('student_id').execute();
  return rows.map((row) => ({
    id: row.id,
    changedHow: row.changed_how,
    studentId: row.student_id,
    entry: entryOf(row),
    version: row.version,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  }));
}

/**
 * The rating exam as the grid and the routes answer it: `null` when the
 * subject has none in the quarter. `studentIds` are the students the reader
 * sees (a Tutor's own rows).
 */
export async function ratingExamOf(
  transaction: Transaction,
  input: {
    readonly journal: JournalRow;
    readonly quarterId: string;
    readonly rights: RatingRights;
    readonly today: string;
    readonly studentIds: readonly string[] | null;
    /** Task 8.4: the reader's staff record, the transaction's moment and whether the reader may request unlocks. */
    readonly staffId: string | null;
    readonly now: Date;
    readonly requests: boolean;
  },
): Promise<RatingExam | null> {
  const { journal, quarterId, rights, today } = input;
  if (switchesIn(journal, quarterId)?.ratingExam !== true) return null;
  const row = await ratingRowOf(transaction, journal.id, quarterId);
  const { date, fromExam } = await ratingDateOf(transaction, journal.id, quarterId);
  const entries = row === null ? [] : await entriesOf(transaction, row.id, input.studentIds);
  const names = await namedAccounts(
    transaction,
    entries.map((one) => one.changedBy),
  );
  const markers = await markersOf(
    transaction,
    'journal_rating_history',
    entries.map((one) => ({ ...one, changedBy: one.changedBy })),
  );
  // Task 8.4: the edit period of the exam, from its date in force.
  const unlocks = await unlocksOfRating(transaction, journal.id, quarterId, input.staffId);
  const approvers = await namedAccounts(
    transaction,
    unlocks.approved.map((one) => one.decidedBy),
  );
  const lock = editLockOf({
    locksAt: await lockOf(transaction, { kind: 'rating', journalId: journal.id, quarterId }),
    unlocks,
    staffId: input.staffId,
    now: input.now,
    enters: rights.teacher && date !== null && today >= date && row?.notHeld !== true,
    requests: input.requests,
    // The journal's teacher corrects nothing of their own: the unlock path (decision 17).
    corrects: rights.vicePrincipal !== null && !rights.teacher && date !== null && today >= date,
    nameOf: (accountId) => {
      const found = accountId === null ? undefined : approvers.get(accountId);
      return found?.name ?? found?.login ?? null;
    },
  });
  const open = date !== null && today >= date && row?.notHeld !== true;
  return {
    journalId: journal.id,
    quarterId,
    date,
    fromExam,
    notHeld: row?.notHeld ?? false,
    version: row?.version ?? null,
    // Task 8.4 (decision 6): the teacher's date waits for no unlock; it is refused once locked.
    canSetDate:
      ((rights.teacher && lock.window === 'open') || rights.vicePrincipal !== null) && !fromExam,
    canSetNotHeld: rights.vicePrincipal !== null,
    canEnter: rights.teacher && open && lock.window !== 'locked',
    canExempt: rights.vicePrincipal !== null && open,
    lock,
    entries: entries.map((one) => {
      const named = names.get(one.changedBy);
      return {
        studentId: one.studentId,
        entry: one.entry,
        version: one.version,
        changedBy: named?.name ?? named?.login ?? null,
        changedAt: one.changedAt.toISOString(),
        marker: markers.get(one.id) ?? null,
      };
    }),
  };
}
