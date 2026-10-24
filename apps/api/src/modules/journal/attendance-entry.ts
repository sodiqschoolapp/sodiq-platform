import { PERMISSIONS, lessonStateOf, permits, schoolDateOf, type LessonState } from '@sodiq/shared';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { notFound } from '../setup/setup-refusals.js';
import { awayLessons } from '../timetable/away-read.js';
import { ownerFactsOf, ownerOn, type OwnerFacts } from '../timetable/journal-owners.js';
import { correctorAssignment, decideWrite, outToday, type WriteHow } from './edit-window.js';

/**
 * Who enters the attendance of a lesson (task 6.3, pull request #211;
 * decisions 1, 3 and 15 with review correction 1). The table lets the
 * Teacher, the Tutor, the Academic Vice Principal and the Super Admin in
 * (`journal` `edit`); this decides the lesson for every request, whatever the
 * role: the person's staff record is
 *
 * - the lesson's teacher (`lessons.teacher_id`: who holds it, the substitute
 *   while a substitution is in force, the person of a correction of kind
 *   `teacher`; `07`: "Substitute teacher | Enters for the substituted lesson
 *   only"), the Tutor of a Homework slot or Ma'naviyat soati lesson included;
 * - the journal's owner on the lesson's date (`journalOwnerOn`, the acting
 *   teacher included; "The earlier teacher keeps their own lessons");
 * - or the journal's owner today ("The new teacher may edit any lesson that
 *   is not yet locked"; the lock is 8.4's, decision 2).
 *
 * The lesson is entered only when held (`edge/00-definitions`, Held lesson):
 * from its start (`07`: "from the lesson's start time, not before"), not
 * cancelled, with a teacher recorded.
 */

/** A lesson as entry reads it, after its FOR SHARE lock. */
export interface EntryLesson {
  readonly id: string;
  readonly branchId: string;
  readonly date: string;
  readonly startsAt: Date;
  readonly teacherId: string | null;
  readonly teacherKind: 'person' | 'vacancy' | null;
  readonly cancelled: boolean;
  readonly journalId: string | null;
}

/**
 * The assignment an entry's audit entry names (permission review of the code,
 * should-fix 3): the Teacher's, then the Tutor's, of those that permit the
 * route, since a person enters only the lessons they teach or own; the first
 * permitting one otherwise (a Super Admin or an Academic Vice Principal who
 * teaches the lesson with no Teacher assignment).
 */
export function entryAssignment(access: Access): string {
  return (
    access.permitting.find((assignment) => assignment.role === 'teacher')?.id ??
    access.permitting.find((assignment) => assignment.role === 'tutor')?.id ??
    access.assignmentId
  );
}

/** Whether a current assignment of the account lets it enter in the branch (`journal` `edit`). */
export function entersByRole(access: Access, branchId: string): boolean {
  return access.assignments.some(
    (assignment) =>
      (assignment.branchId === null || assignment.branchId === branchId.toLowerCase()) &&
      permits(PERMISSIONS, assignment.role, 'journal', 'edit'),
  );
}

/** The person's staff record in the branch, read through the branch filter. */
export async function ownStaffOf(
  transaction: Transaction,
  accountId: string,
): Promise<string | null> {
  const found = await transaction
    .selectFrom('staff')
    .select('id')
    .where('account_id', '=', accountId)
    .executeTakeFirst();
  return found?.id ?? null;
}

/**
 * Locks the lesson FOR SHARE, as `saveCells` does (6.1a: a cancel, a date
 * move or a delete waits for the entry), and reads it with its journal. An
 * unknown lesson or another branch's is 404.
 */
export async function lockedLesson(
  transaction: Transaction,
  branchId: string,
  lessonId: string,
): Promise<EntryLesson> {
  const locked = await transaction
    .selectFrom('lessons')
    .select('id')
    .where('id', '=', lessonId)
    .where('branch_id', '=', branchId)
    .forShare()
    .executeTakeFirst();
  if (locked === undefined) throw notFound();
  // Read again after the lock, in a statement of its own (`.claude/rules/database.md`).
  const row = await transaction
    .selectFrom('lessons')
    .leftJoin('staff', 'staff.id', 'lessons.teacher_id')
    .select([
      'lessons.id',
      'lessons.branch_id',
      'lessons.lesson_date',
      'lessons.starts_at',
      'lessons.teacher_id',
      'staff.kind as teacher_kind',
      'lessons.cancel_cause',
      'lessons.class_id',
      'lessons.group_id',
      'lessons.subject_id',
    ])
    .where('lessons.id', '=', lessonId)
    .executeTakeFirstOrThrow();
  let journal = transaction
    .selectFrom('journals')
    .select('id')
    .where('branch_id', '=', branchId)
    .where('subject_id', '=', row.subject_id);
  journal =
    row.class_id === null
      ? journal.where('group_id', '=', row.group_id)
      : journal.where('class_id', '=', row.class_id);
  const found = await journal.executeTakeFirst();
  return {
    id: row.id,
    branchId: row.branch_id,
    date: String(row.lesson_date),
    startsAt: new Date(row.starts_at),
    teacherId: row.teacher_id,
    teacherKind:
      row.teacher_kind === null ? null : row.teacher_kind === 'vacancy' ? 'vacancy' : 'person',
    cancelled: row.cancel_cause !== null,
    journalId: found?.id ?? null,
  };
}

/** The owner facts of a lesson's journal (`ownerFactsOf`), or `null` without a journal. */
export async function journalFactsOf(
  transaction: Transaction,
  branchId: string,
  journalId: string | null,
): Promise<OwnerFacts | null> {
  if (journalId === null) return null;
  const journals = await transaction
    .selectFrom('journals')
    .select(['id', 'academic_year_id', 'class_id', 'group_id', 'subject_id'])
    .where('id', '=', journalId)
    .execute();
  return ownerFactsOf(transaction, branchId, journals);
}

/**
 * The open orphan assignment of a person on a lesson at `now` (task 8.7, decision 15;
 * `edge/journal`: "The Academic Vice Principal assigns a teacher to complete them"),
 * read FOR SHARE so that a withdraw held open makes the entry wait: the person enters
 * that lesson as its teacher would, until the assignment's `open_until`.
 */
export async function orphanAssignmentOf(
  transaction: Transaction,
  lessonId: string,
  staffId: string,
  now: Date,
): Promise<string | null> {
  const found = await transaction
    .selectFrom('journal_orphan_assignments')
    .select('id')
    .where('lesson_id', '=', lessonId)
    .where('staff_id', '=', staffId)
    .where('withdrawn_at', 'is', null)
    .where('assigned_at', '<=', now)
    .where('open_until', '>', now)
    .forShare()
    .executeTakeFirst();
  return found?.id ?? null;
}

/**
 * Whether every student named has an optional (0127) or reopened (0123) cell on the lesson
 * open now (task 8.7, From 8.6: "can be filled for 7 days"); `false` for none named.
 */
export async function allCellsOpen(
  transaction: Transaction,
  lessonId: string,
  studentIds: readonly string[],
): Promise<boolean> {
  const ids = [...new Set(studentIds.map((id) => id.toLowerCase()))];
  if (ids.length === 0) return false;
  const found = await sql<{ open: boolean }>`
    select bool_and(
      exemption_reopened_open(${lessonId}::uuid, s) or journal_optional_open(${lessonId}::uuid, s)
    ) as open
    from unnest(${ids}::uuid[]) as s
  `.execute(transaction);
  return found.rows[0]?.open === true;
}

/** Whether the staff record teaches or owns the lesson (decision 3). */
export function teachesOrOwns(
  lesson: Pick<EntryLesson, 'date' | 'teacherId' | 'journalId'>,
  facts: OwnerFacts | null,
  staffId: string | null,
  today: string,
): boolean {
  if (staffId === null) return false;
  if (lesson.teacherId === staffId) return true;
  if (facts === null || lesson.journalId === null) return false;
  const runs = facts.runs.get(lesson.journalId) ?? [];
  const periods = facts.periods.get(lesson.journalId) ?? [];
  return [lesson.date, today].some((day) => {
    const owner = ownerOn(runs, periods, facts.out, day);
    return owner !== null && owner.kind !== 'none' && owner.staffId === staffId;
  });
}

/** The lesson's state at the transaction's moment (`lessonStateOf`), with its teacher's absence. */
export async function entryStateOf(
  transaction: Transaction,
  lesson: EntryLesson,
  now: Date,
): Promise<LessonState> {
  const away = await awayLessons(transaction, [
    { id: lesson.id, teacherId: lesson.teacherId, startsAt: lesson.startsAt },
  ]);
  return lessonStateOf(
    {
      startsAt: lesson.startsAt,
      cancelled: lesson.cancelled,
      teacher: lesson.teacherKind,
      away: away.has(lesson.id),
    },
    now,
  );
}

/** The refusal of a state that takes no entry (decision 15), or none for a held lesson. */
export function refuseState(state: LessonState): void {
  if (state === 'held') return;
  if (state === 'cancelled') throw new ApiException('lesson_cancelled_cell', 409);
  if (state === 'unresolved') throw new ApiException('lesson_not_held', 409);
  throw new ApiException('entry_not_started', 409);
}

/**
 * Locks the lesson and decides the entry (decisions 3 and 15): 404, then 403
 * `journal_entry_scope`, then the state, then the edit period (task 8.4,
 * `edit-window.ts`): 409 `journal_locked` from the lock without an open
 * unlock of the person. A person no longer active in the branch enters
 * nothing (task 8.4, spec review must-fix 7: "while their account is
 * active"). A correction (task 8.4) is made by the Academic Vice Principal or
 * the Super Admin with no scope of the lesson ("No unlock is needed"), else
 * 403 `journal_correction_role`. Called before any write.
 */
export async function enterableLesson(
  transaction: Transaction,
  access: Access,
  branchId: string,
  lessonId: string,
  options: {
    readonly correction?: { readonly reason: string } | undefined;
    /** Task 8.7: the students whose cells the write names, for the optional cells of a locked lesson. */
    readonly students?: readonly string[];
  } = {},
): Promise<{ lesson: EntryLesson; now: Date; timeZone: string; write: WriteHow }> {
  const lesson = await lockedLesson(transaction, branchId, lessonId);
  const now = await transactionMoment(transaction);
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(now, branch.time_zone);
  const staffId = await ownStaffOf(transaction, access.accountId);
  let orphanAssignmentId: string | null = null;
  if (options.correction === undefined) {
    const facts = await journalFactsOf(transaction, branchId, lesson.journalId);
    orphanAssignmentId =
      staffId === null ? null : await orphanAssignmentOf(transaction, lesson.id, staffId, now);
    if (
      (!teachesOrOwns(lesson, facts, staffId, today) && orphanAssignmentId === null) ||
      staffId === null ||
      (await outToday(transaction, branchId, staffId, today))
    ) {
      throw new ApiException('journal_entry_scope', 403);
    }
  } else if (correctorAssignment(access, branchId) === null) {
    throw new ApiException('journal_correction_role', 403);
  } else if (
    teachesOrOwns(
      lesson,
      await journalFactsOf(transaction, branchId, lesson.journalId),
      staffId,
      today,
    )
  ) {
    // Nobody approves their own (`02`, Own requests): a corrector's own lesson takes the
    // unlock path, never a correction of their own.
    throw new ApiException('own_request', 403);
  }
  refuseState(await entryStateOf(transaction, lesson, now));
  const write = await decideWrite(transaction, {
    access,
    branchId,
    target: { kind: 'lesson', lessonId: lesson.id },
    staffId,
    correction: options.correction,
    orphanAssignmentId,
    openCells: await allCellsOpen(transaction, lesson.id, options.students ?? []),
  });
  return { lesson, now, timeZone: branch.time_zone, write };
}
