import { studentNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Database } from '../database/database.js';
import { BRANCH_SETTING, MOMENT_SETTING, type Transaction } from '../database/transactions.js';
import { linkRelative } from './relatives-kit.js';

let count = 0;

/** A membership row as a test writes it; the dates are school dates. */
export interface MemberRow {
  branch: string;
  classId: string;
  studentId: string;
  from: string;
  until?: string;
  ownUntil?: string;
  cause?: 'placement' | 'create' | 'cancel' | 'undo' | 'transfer' | 'return' | 'restore';
  endedBy?: 'leaving' | 'transfer' | 'undone' | null;
  leavingId?: string | null;
  /** Task 3.3a: the move that wrote the row, and the one that ended it. */
  writtenByMoveId?: string | null;
  endedByMoveId?: string | null;
}

/** The values of a membership row: its own end is the day after the year's end by default. */
export const memberValues = (row: MemberRow) => ({
  branch_id: row.branch,
  student_id: row.studentId,
  class_id: row.classId,
  valid_from: row.from,
  valid_until: row.until ?? row.ownUntil ?? '2027-06-01',
  own_until: row.ownUntil ?? '2027-06-01',
  cause: row.cause ?? 'placement',
  ended_by: row.endedBy ?? null,
  leaving_id: row.leavingId ?? null,
  written_by_move_id: row.writtenByMoveId ?? null,
  ended_by_move_id: row.endedByMoveId ?? null,
});

/** A group row as a test writes it (task 3.2b); the dates are school dates. */
export interface GroupMemberRow {
  branch: string;
  groupId: string;
  subjectId: string;
  studentId: string;
  from: string;
  until?: string;
  ownUntil?: string;
  cause?: 'placement' | 'automatic' | 'transfer';
  review?: boolean;
  endedBy?: 'leaving' | 'transfer' | null;
  leavingId?: string | null;
  /** Task 3.3a: the move that wrote the row, and the one that ended it. */
  writtenByMoveId?: string | null;
  endedByMoveId?: string | null;
}

/** The values of a group row: its own end is the day after the year's end by default. */
export const groupMemberValues = (row: GroupMemberRow) => ({
  branch_id: row.branch,
  student_id: row.studentId,
  group_id: row.groupId,
  subject_id: row.subjectId,
  valid_from: row.from,
  valid_until: row.until ?? row.ownUntil ?? '2027-06-01',
  own_until: row.ownUntil ?? '2027-06-01',
  cause: row.cause ?? 'placement',
  review: row.review ?? false,
  ended_by: row.endedBy ?? null,
  leaving_id: row.leavingId ?? null,
  written_by_move_id: row.writtenByMoveId ?? null,
  ended_by_move_id: row.endedByMoveId ?? null,
});

/** A move as a test writes it (task 3.3a, 0050); the dates are school dates. */
export interface MoveRow {
  branch: string;
  studentId: string;
  from: string;
  fromClassId?: string;
  toClassId?: string;
  fromGroupId?: string;
  toGroupId?: string;
  subjectId?: string;
}

/**
 * The students and memberships class membership stands on (task 3.1b),
 * written by the migrator unless a transaction is given. Names are invented.
 */
export class MembersKit {
  constructor(
    private readonly migrator: Database,
    private readonly createdBy: string,
  ) {}

  /** A student of the branch, active from `startsOn`, with one relative. */
  async student(
    branch: string,
    input: { grade?: number; startsOn?: string } = {},
  ): Promise<string> {
    count += 1;
    const moment = new Date('2026-08-20T09:00:00+05:00');
    const uid = String(2600000 + count * 7);
    const last = `Rahimova${'a'.repeat(count % 4)}`;
    return this.migrator.transaction().execute(async (transaction) => {
      const found = await sql<{ id: string }>`select uuidv7() as id`.execute(transaction);
      const id = found.rows[0]?.id ?? '';
      await transaction
        .insertInto('students')
        .values({
          id,
          branch_id: branch,
          uid,
          first_name: 'Malika',
          last_name: last,
          name_key: studentNameKey(last, 'Malika'),
          sex: 'female',
          birth_date: '2013-05-06',
          grade: input.grade ?? 7,
          starts_on: input.startsOn ?? '2026-09-01',
          created_by: this.createdBy,
        })
        .execute();
      await transaction
        .insertInto('student_uids')
        .values({ uid, student_id: id, branch_id: branch, held_from: moment })
        .execute();
      await transaction
        .insertInto('student_contracts')
        .values({
          student_id: id,
          branch_id: branch,
          number: `M-${String(count)}`,
          signed_on: '2026-08-20',
        })
        .execute();
      await transaction
        .insertInto('student_statuses')
        .values({
          student_id: id,
          branch_id: branch,
          status: 'active',
          valid_from: input.startsOn ?? '2026-09-01',
          cause: 'start',
        })
        .execute();
      await linkRelative(transaction, id, branch, moment);
      return id;
    });
  }

  /**
   * A leaving written as the service writes its status rows: the active row
   * cut at the first inactive day and an inactive row from it. Answers the id
   * of the inactive row. The class rows are the caller's.
   */
  async leaving(
    db: Database | Transaction,
    branch: string,
    studentId: string,
    firstInactiveDay: string,
  ): Promise<string> {
    await db
      .updateTable('student_statuses')
      .set({ valid_until: firstInactiveDay })
      .where('student_id', '=', studentId)
      .where('valid_until', 'is', null)
      .execute();
    const row = await db
      .insertInto('student_statuses')
      .values({
        student_id: studentId,
        branch_id: branch,
        status: 'inactive',
        valid_from: firstInactiveDay,
        cause: 'leaving',
        reason: 'Moved to another city',
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A membership row, by the migrator or in the transaction given. */
  async member(row: MemberRow, db: Database | Transaction = this.migrator): Promise<string> {
    const written = await db
      .insertInto('class_memberships')
      .values(memberValues(row))
      .returning('id')
      .executeTakeFirstOrThrow();
    return written.id;
  }

  /** A move (task 3.3a), by the migrator or in the transaction given; a class move unless groups are named. */
  async move(row: MoveRow, db: Database | Transaction = this.migrator): Promise<string> {
    const group = row.fromGroupId !== undefined;
    const written = await db
      .insertInto('student_moves')
      .values({
        branch_id: row.branch,
        student_id: row.studentId,
        kind: group ? 'group' : 'class',
        subject_id: row.subjectId ?? null,
        from_class_id: row.fromClassId ?? null,
        to_class_id: row.toClassId ?? null,
        from_group_id: row.fromGroupId ?? null,
        to_group_id: row.toGroupId ?? null,
        effective_on: row.from,
        made_at: new Date('2026-10-14T10:00:00+05:00'),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return written.id;
  }

  /** A group row (task 3.2b), by the migrator or in the transaction given. */
  async groupMember(
    row: GroupMemberRow,
    db: Database | Transaction = this.migrator,
  ): Promise<string> {
    const written = await db
      .insertInto('group_memberships')
      .values(groupMemberValues(row))
      .returning('id')
      .executeTakeFirstOrThrow();
    return written.id;
  }

  /** The stored state of a group row. */
  groupRowOf(id: string) {
    return this.migrator
      .selectFrom('group_memberships')
      .select(['valid_from', 'valid_until', 'own_until', 'ended_by', 'leaving_id', 'review'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }

  /** The stored dates and cause of a membership row. */
  rowOf(id: string) {
    return this.migrator
      .selectFrom('class_memberships')
      .select([
        'valid_from',
        'valid_until',
        'own_until',
        'ended_by',
        'leaving_id',
        'branch_id',
        'cause',
      ])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }
}

/**
 * The move of a student to another branch as an accept writes it (task 3.3c,
 * db/migrations/0053): a release from `from` to `to`, accepted, and the branch
 * of the student changed, in one transaction of the migrator with the moment
 * and the filter an accept has. The class and group rows are the caller's:
 * a test of 2.4a or 3.1b moves the student with its rows left as they were.
 */
export async function moveStudentBranch(
  migrator: Database,
  studentId: string,
  from: string,
  to: string,
  moment = '2026-10-14T10:00:00+05:00',
): Promise<void> {
  await migrator.transaction().execute(async (transaction) => {
    await sql`
      select set_config(${BRANCH_SETTING}, ${`{${from},${to}}`}, true),
        set_config(${MOMENT_SETTING}, ${new Date(moment).toISOString()}, true)
    `.execute(transaction);
    const release = await transaction
      .insertInto('student_branch_moves')
      .values({
        branch_id: from,
        student_id: studentId,
        from_branch_id: from,
        to_branch_id: to,
        effective_on: sql<string>`branch_today(${to}::uuid)`,
        released_at: new Date(moment),
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await transaction
      .updateTable('student_branch_moves')
      .set({ accepted_at: new Date(moment) })
      .where('id', '=', release.id)
      .execute();
    await transaction
      .updateTable('students')
      .set({ branch_id: to })
      .where('id', '=', studentId)
      .execute();
  });
}
