import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { accountOfStaff } from '../access/request-posts.js';
import type { Notifications } from '../notifications/notifications.service.js';
import { journalOwnerOn } from '../timetable/journal-owners.js';
import { journalRows } from './journal-grid.query.js';

/**
 * The notices of a correction (task 8.4, pull request #222, decision 10;
 * `edge/journal`, Locks, unlocks and corrections: "The Academic Vice
 * Principal corrects a mark ... notifies the teacher with the old and new
 * value"). One notice per value corrected, at most `NOTICES_MAX` per save, to
 * the lesson's teacher (`lessons.teacher_id`, a substitute while one is in
 * force) and the journal's teacher on the date (`journalOwnerOn`) when they
 * differ, never to the corrector.
 */
const NOTICES_MAX = 50;

/** A value as the notice shows it: the mark or the number, `—` when empty. */
const shown = (value: number | null): string => (value === null ? '—' : String(value));

interface CorrectedValue {
  readonly studentId: string;
  readonly before: number | null;
  readonly after: number | null;
}

async function studentNames(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, string>> {
  if (ids.length === 0) return new Map();
  const rows = await transaction
    .selectFrom('students')
    .select(['id', 'first_name', 'last_name'])
    .where('id', 'in', [...new Set(ids)])
    .execute();
  return new Map(rows.map((row) => [row.id, `${row.last_name} ${row.first_name}`.trim()]));
}

/** The accounts told: the teachers of the lesson or of the journal on the date, never the corrector. */
async function teachersTold(
  transaction: Transaction,
  input: {
    readonly branchId: string;
    readonly journalId: string | null;
    readonly date: string;
    readonly lessonTeacherId: string | null;
    readonly correctorId: string;
  },
): Promise<string[]> {
  const owner =
    input.journalId === null
      ? null
      : await journalOwnerOn(transaction, input.branchId, input.journalId, input.date);
  const staff = [
    input.lessonTeacherId,
    owner !== null && owner.kind !== 'none' ? owner.staffId : null,
  ];
  const accounts = new Set<string>();
  for (const one of staff) {
    const account = await accountOfStaff(transaction, one);
    if (account !== null && account !== input.correctorId) accounts.add(account);
  }
  return [...accounts].sort();
}

async function send(
  transaction: Transaction,
  notifications: Notifications,
  input: {
    readonly branchId: string;
    readonly unit: string;
    readonly date: string;
    readonly reason: string;
    readonly accounts: readonly string[];
    readonly values: readonly CorrectedValue[];
  },
): Promise<number> {
  if (input.accounts.length === 0) return 0;
  const values = input.values.filter((one) => one.before !== one.after).slice(0, NOTICES_MAX);
  const names = await studentNames(
    transaction,
    values.map((one) => one.studentId),
  );
  for (const value of values) {
    await notifications.send(transaction, {
      kind: 'journal.correction',
      branchId: input.branchId,
      accountIds: [...input.accounts],
      data: {
        unit: input.unit,
        date: input.date,
        student: names.get(value.studentId) || '—',
        before: shown(value.before),
        after: shown(value.after),
        reason: input.reason,
      },
    });
  }
  return values.length;
}

/**
 * The notices of the cells this transaction corrected on a lesson, read from
 * their history lines (`changed_how` `correction`, 0122). Returns how many.
 */
export async function noticeCellCorrections(
  transaction: Transaction,
  notifications: Notifications,
  input: {
    readonly branchId: string;
    readonly lessonId: string;
    readonly correctorId: string;
    readonly reason: string;
  },
): Promise<number> {
  const lines = await transaction
    .selectFrom('journal_cell_history')
    .select(['student_id', 'work_id', 'mark_before', 'mark_after', 'score_before', 'score_after'])
    .where('lesson_id', '=', input.lessonId)
    .where('changed_how', '=', 'correction')
    .where(sql<boolean>`written_xact = pg_current_xact_id()`)
    .orderBy('student_id')
    .orderBy('work_id', (order) => order.nullsFirst())
    .execute();
  if (lines.length === 0) return 0;
  const lesson = await transaction
    .selectFrom('lessons')
    .select([
      sql<string>`lesson_date::text`.as('date'),
      'teacher_id',
      'class_id',
      'group_id',
      'subject_id',
    ])
    .where('id', '=', input.lessonId)
    .executeTakeFirstOrThrow();
  let journal = transaction
    .selectFrom('journals')
    .select('id')
    .where('branch_id', '=', input.branchId)
    .where('subject_id', '=', lesson.subject_id);
  journal =
    lesson.class_id === null
      ? journal.where('group_id', '=', lesson.group_id)
      : journal.where('class_id', '=', lesson.class_id);
  const found = await journal.executeTakeFirst();
  const [row] =
    found === undefined
      ? []
      : await journalRows(transaction, input.branchId, { journalId: found.id });
  const accounts = await teachersTold(transaction, {
    branchId: input.branchId,
    journalId: found?.id ?? null,
    date: lesson.date,
    lessonTeacherId: lesson.teacher_id,
    correctorId: input.correctorId,
  });
  return send(transaction, notifications, {
    branchId: input.branchId,
    unit: row?.unitName || '—',
    date: lesson.date,
    reason: input.reason,
    accounts,
    values: lines.map((line) => ({
      studentId: line.student_id,
      before: line.work_id === null ? line.mark_before : line.score_before,
      after: line.work_id === null ? line.mark_after : line.score_after,
    })),
  });
}

/** The notice of a rating entry corrected: to the journal's teacher on the exam's date. */
export async function noticeRatingCorrection(
  transaction: Transaction,
  notifications: Notifications,
  input: {
    readonly branchId: string;
    readonly journalId: string;
    readonly unit: string;
    readonly date: string;
    readonly correctorId: string;
    readonly reason: string;
    readonly studentId: string;
    readonly before: number | null;
    readonly after: number | null;
  },
): Promise<number> {
  const accounts = await teachersTold(transaction, {
    branchId: input.branchId,
    journalId: input.journalId,
    date: input.date,
    lessonTeacherId: null,
    correctorId: input.correctorId,
  });
  return send(transaction, notifications, {
    branchId: input.branchId,
    unit: input.unit,
    date: input.date,
    reason: input.reason,
    accounts,
    values: [{ studentId: input.studentId, before: input.before, after: input.after }],
  });
}
