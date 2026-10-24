import { PERMISSIONS, permits, schoolDateOf } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { personOutOf } from '../timetable/journal-owners.js';

/**
 * The edit period of a journal write (task 8.4, pull request #222; `07`,
 * Editing rules and locks; `edge/journal`, Locks, unlocks and corrections;
 * `edge/00-definitions`, Lock moment). The lock of a lesson or a rating exam
 * is worked out by the database on each request (`journal_lock_moment`,
 * 0122) and compared with the transaction's moment, the one the guard of
 * 0122 compares (`.claude/rules/database.md`). Before the lock a write is an
 * `entry`; from the lock it is taken only under an approved unlock of that
 * target for that person, still open (`late_entry`); a correction of the
 * Academic Vice Principal or the Super Admin takes no unlock. The database
 * guards the same rule again.
 */

/** What a write is aimed at: a lesson, or a journal's rating exam in a quarter. */
export type LockTarget =
  | { readonly kind: 'lesson'; readonly lessonId: string }
  | { readonly kind: 'rating'; readonly journalId: string; readonly quarterId: string };

/** An approved unlock as the window reads it. */
export interface OpenUnlock {
  readonly id: string;
  readonly staffId: string;
  readonly openUntil: Date;
  readonly decidedBy: string | null;
}

/** The window of a person on a target at a moment. */
export type EditWindow =
  | { readonly kind: 'open'; readonly locksAt: Date | null }
  | { readonly kind: 'unlocked'; readonly locksAt: Date; readonly unlock: OpenUnlock }
  | { readonly kind: 'locked'; readonly locksAt: Date };

/**
 * The window (pure): open before the lock (a target with no lock, a rating
 * exam with no date, is open); from it, the first approved unlock of the
 * person still open at `now`, else locked.
 */
export function editWindowOf(
  locksAt: Date | null,
  unlocks: readonly OpenUnlock[],
  staffId: string | null,
  now: Date,
): EditWindow {
  if (locksAt === null || now.getTime() < locksAt.getTime()) return { kind: 'open', locksAt };
  const unlock = unlocks.find(
    (one) => staffId !== null && one.staffId === staffId && one.openUntil.getTime() > now.getTime(),
  );
  return unlock === undefined ? { kind: 'locked', locksAt } : { kind: 'unlocked', locksAt, unlock };
}

/** How a write is made: what the trigger of 0122 writes it as, and under which unlock. */
export type WriteHow =
  | { readonly how: 'entry' }
  | { readonly how: 'late_entry'; readonly unlockId: string }
  /** Task 8.7 (decision 4): a late entry of the person an orphan lesson is assigned to. */
  | { readonly how: 'assigned_entry'; readonly orphanAssignmentId: string }
  | { readonly how: 'correction'; readonly assignmentId: string };

/**
 * The assignment that lets the account correct in the branch: the Academic
 * Vice Principal of the branch, then the Super Admin, from every current
 * assignment (`.claude/rules/api.md`), or `null`.
 */
export function correctorAssignment(access: Access, branchId: string): string | null {
  const branch = branchId.toLowerCase();
  return (
    access.assignments.find(
      (one) => one.role === 'academic_vice_principal' && one.branchId === branch,
    )?.id ??
    access.assignments.find((one) => one.role === 'super_admin')?.id ??
    null
  );
}

/** The lock moment of a target, from the database. */
export async function lockOf(transaction: Transaction, target: LockTarget): Promise<Date | null> {
  const found =
    target.kind === 'lesson'
      ? await sql<{ lock: Date | null }>`
          select journal_lesson_lock(${target.lessonId}::uuid) as lock
        `.execute(transaction)
      : await sql<{ lock: Date | null }>`
          select journal_rating_lock(${target.journalId}::uuid, ${target.quarterId}::uuid) as lock
        `.execute(transaction);
  const lock = found.rows[0]?.lock ?? null;
  return lock === null ? null : new Date(lock);
}

/** The lock moments of lessons, by id. */
export async function locksOfLessons(
  transaction: Transaction,
  lessonIds: readonly string[],
): Promise<Map<string, Date | null>> {
  if (lessonIds.length === 0) return new Map();
  const { rows } = await sql<{ id: string; lock: Date | null }>`
    select l.id, journal_lock_moment(l.branch_id, l.lesson_date) as lock
    from lessons l
    where l.id = any(${[...lessonIds]}::uuid[])
  `.execute(transaction);
  return new Map(rows.map((row) => [row.id, row.lock === null ? null : new Date(row.lock)]));
}

/**
 * The approved unlocks of a target for a person, still open at `now`, read
 * FOR SHARE: a decision held open makes the write wait (decision 7 and the
 * same-moment tests of the plan).
 */
export async function openUnlocksOf(
  transaction: Transaction,
  target: LockTarget,
  staffId: string,
  now: Date,
): Promise<OpenUnlock[]> {
  let query = transaction
    .selectFrom('journal_unlocks')
    .select(['id', 'staff_id', 'open_until', 'decided_by', 'status'])
    .where('staff_id', '=', staffId);
  query =
    target.kind === 'lesson'
      ? query.where('target', '=', 'lesson').where('lesson_id', '=', target.lessonId)
      : query
          .where('target', '=', 'rating')
          .where('journal_id', '=', target.journalId)
          .where('quarter_id', '=', target.quarterId);
  // Every row of the person on the target first, whatever its state (`database.md`):
  // a decision of a waiting one made meanwhile is waited for, then read again.
  await query.orderBy('id').forShare().execute();
  const rows = await query.where('status', '=', 'approved').orderBy('open_until', 'desc').execute();
  return rows.flatMap((row) =>
    row.open_until === null || new Date(row.open_until).getTime() <= now.getTime()
      ? []
      : [
          {
            id: row.id,
            staffId: row.staff_id,
            openUntil: new Date(row.open_until),
            decidedBy: row.decided_by,
          },
        ],
  );
}

/** Whether the person is out of the branch today (not linked, inactive or left; decision 7). */
export async function outToday(
  transaction: Transaction,
  branchId: string,
  staffId: string,
  today: string,
): Promise<boolean> {
  const out = await personOutOf(transaction, branchId, [staffId]);
  return out(staffId, today);
}

/**
 * Decides the write on a target and sets the settings of the transaction the
 * guard of 0122 reads: a correction (with `correction`, from the account's
 * corrector assignment, else 403 `journal_correction_role`) sets
 * `app.correction_reason`; a write from the lock sets `app.unlock_id` of the
 * person's open unlock, else 409 `journal_locked` with the lock moment. The
 * caller has decided the scope and the state of the target first.
 */
export async function decideWrite(
  transaction: Transaction,
  input: {
    readonly access: Access;
    readonly branchId: string;
    readonly target: LockTarget;
    readonly staffId: string | null;
    readonly correction?: { readonly reason: string } | undefined;
    /** Task 8.7: the open orphan assignment of the person on the lesson, if any. */
    readonly orphanAssignmentId?: string | null;
    /**
     * Task 8.7 (From 8.6): every cell the write names is an optional or reopened cell open now;
     * the cells guard takes such a write after the lock as a late entry (0123, 0127).
     */
    readonly openCells?: boolean;
  },
): Promise<WriteHow> {
  if (input.correction !== undefined) {
    const assignmentId = correctorAssignment(input.access, input.branchId);
    if (assignmentId === null) throw new ApiException('journal_correction_role', 403);
    await sql`select set_config('app.correction_reason', ${input.correction.reason}, true)`.execute(
      transaction,
    );
    return { how: 'correction', assignmentId };
  }
  const now = await transactionMoment(transaction);
  const locksAt = await lockOf(transaction, input.target);
  if (locksAt === null || now.getTime() < locksAt.getTime()) return { how: 'entry' };
  const window =
    input.staffId === null
      ? editWindowOf(locksAt, [], null, now)
      : editWindowOf(
          locksAt,
          (await outToday(
            transaction,
            input.branchId,
            input.staffId,
            schoolDateOf(now, await timeZoneOf(transaction, input.branchId)),
          ))
            ? []
            : await openUnlocksOf(transaction, input.target, input.staffId, now),
          input.staffId,
          now,
        );
  if (window.kind !== 'unlocked') {
    if (input.openCells === true) return { how: 'entry' };
    const assigned = input.orphanAssignmentId ?? null;
    if (assigned === null) throw lockedRefusal(locksAt);
    await sql`select set_config('app.orphan_assignment_id', ${assigned}, true)`.execute(
      transaction,
    );
    return { how: 'assigned_entry', orphanAssignmentId: assigned };
  }
  await sql`select set_config('app.unlock_id', ${window.unlock.id}, true)`.execute(transaction);
  return { how: 'late_entry', unlockId: window.unlock.id };
}

/** How the write was made, for its audit entry: nothing for an entry in the edit period. */
export function writeDetails(
  write: WriteHow,
  correction?: { readonly reason: string },
): Record<string, string> {
  if (write.how === 'late_entry') return { how: 'late_entry', unlockId: write.unlockId };
  if (write.how === 'assigned_entry') {
    return { how: 'late_entry', orphanAssignmentId: write.orphanAssignmentId };
  }
  if (write.how === 'correction') return { how: 'correction', reason: correction?.reason ?? '' };
  return {};
}

/** The assignment an audit entry names: the corrector's for a correction, else `entry`. */
export const writeAssignment = (write: WriteHow, entry: string): string =>
  write.how === 'correction' ? write.assignmentId : entry;

/** The refusal of a locked target, with its lock moment. */
export function lockedRefusal(locksAt: Date): ApiException {
  return new ApiException('journal_locked', 409, undefined, [
    {
      path: '',
      code: 'journal_locked',
      message: 'The edit period has ended.',
      locksAt: locksAt.toISOString(),
    },
  ]);
}

async function timeZoneOf(transaction: Transaction, branchId: string): Promise<string> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return branch.time_zone;
}

/** The constraint refusals of the guard of 0122, as error codes (`refusingConstraints`). */
export const LOCK_REFUSALS = {
  journal_locked: 'journal_locked',
  journal_correction_role: 'journal_correction_role',
  journal_correction_reason: 'validation_failed',
} as const;

/** The unlock requests of one person on targets, for a screen: open approvals and the waiting one. */
export interface PersonUnlocks {
  readonly approved: readonly OpenUnlock[];
  readonly waiting: { readonly id: string; readonly version: number } | null;
}

/** The unlock requests of a person on lessons, by lesson (no lock taken: a read). */
export async function unlocksOfLessons(
  transaction: Transaction,
  lessonIds: readonly string[],
  staffId: string | null,
): Promise<Map<string, PersonUnlocks>> {
  if (staffId === null || lessonIds.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('journal_unlocks')
    .select(['id', 'lesson_id', 'staff_id', 'status', 'open_until', 'decided_by', 'version'])
    .where('target', '=', 'lesson')
    .where('staff_id', '=', staffId)
    .where('lesson_id', 'in', [...lessonIds])
    .where('status', 'in', ['sent', 'approved'])
    .execute();
  return groupUnlocks(rows.map((row) => ({ ...row, key: row.lesson_id ?? '' })));
}

/** The unlock requests of a person on a journal's rating exam in a quarter. */
export async function unlocksOfRating(
  transaction: Transaction,
  journalId: string,
  quarterId: string,
  staffId: string | null,
): Promise<PersonUnlocks> {
  if (staffId === null) return { approved: [], waiting: null };
  const rows = await transaction
    .selectFrom('journal_unlocks')
    .select(['id', 'staff_id', 'status', 'open_until', 'decided_by', 'version'])
    .where('target', '=', 'rating')
    .where('staff_id', '=', staffId)
    .where('journal_id', '=', journalId)
    .where('quarter_id', '=', quarterId)
    .where('status', 'in', ['sent', 'approved'])
    .execute();
  return (
    groupUnlocks(rows.map((row) => ({ ...row, key: 'rating' }))).get('rating') ?? {
      approved: [],
      waiting: null,
    }
  );
}

function groupUnlocks(
  rows: readonly {
    key: string;
    id: string;
    staff_id: string;
    status: string;
    open_until: Date | null;
    decided_by: string | null;
    version: number;
  }[],
): Map<string, PersonUnlocks> {
  const found = new Map<string, { approved: OpenUnlock[]; waiting: PersonUnlocks['waiting'] }>();
  for (const row of rows) {
    const own = found.get(row.key) ?? { approved: [], waiting: null };
    if (row.status === 'sent') own.waiting = { id: row.id, version: row.version };
    else if (row.open_until !== null) {
      own.approved.push({
        id: row.id,
        staffId: row.staff_id,
        openUntil: new Date(row.open_until),
        decidedBy: row.decided_by,
      });
    }
    found.set(row.key, own);
  }
  return found;
}

/**
 * The edit period a screen shows for a target (`editLockSchema`): the window
 * of the reader, who enters (`enters`: theirs to enter, held) and corrects.
 */
export function editLockOf(input: {
  readonly locksAt: Date | null;
  readonly unlocks: PersonUnlocks;
  readonly staffId: string | null;
  readonly now: Date;
  readonly enters: boolean;
  readonly requests: boolean;
  readonly corrects: boolean;
  readonly nameOf: (accountId: string | null) => string | null;
}): {
  locksAt: string | null;
  window: EditWindow['kind'];
  unlockedUntil: string | null;
  unlockedBy: string | null;
  request: { id: string; version: number } | null;
  canRequest: boolean;
  canCorrect: boolean;
} {
  const window = editWindowOf(input.locksAt, input.unlocks.approved, input.staffId, input.now);
  return {
    locksAt: input.locksAt?.toISOString() ?? null,
    window: window.kind,
    unlockedUntil: window.kind === 'unlocked' ? window.unlock.openUntil.toISOString() : null,
    unlockedBy: window.kind === 'unlocked' ? input.nameOf(window.unlock.decidedBy) : null,
    request: input.enters ? input.unlocks.waiting : null,
    canRequest:
      input.enters && input.requests && window.kind === 'locked' && input.unlocks.waiting === null,
    canCorrect: input.corrects,
  };
}

/** Whether a current assignment of the account may send unlock requests in the branch (`journal_unlocks` `create`). */
export function requestsUnlocks(access: Access, branchId: string): boolean {
  return access.assignments.some(
    (assignment) =>
      (assignment.branchId === null || assignment.branchId === branchId.toLowerCase()) &&
      permits(PERMISSIONS, assignment.role, 'journal_unlocks', 'create'),
  );
}
