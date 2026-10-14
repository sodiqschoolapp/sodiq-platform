import { studentNameKey } from '@sodiq/shared';
import { sql } from 'kysely';
import type { Database } from '../database/database.js';
import type { Transaction } from '../database/transactions.js';
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
  cause?: 'placement' | 'create' | 'cancel' | 'undo';
  endedBy?: 'leaving' | null;
  leavingId?: string | null;
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
});

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

  /** The stored dates of a membership row. */
  rowOf(id: string) {
    return this.migrator
      .selectFrom('class_memberships')
      .select(['valid_from', 'valid_until', 'own_until', 'ended_by', 'leaving_id', 'branch_id'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
  }
}
