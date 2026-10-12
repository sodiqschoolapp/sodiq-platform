import { Injectable } from '@nestjs/common';
import type {
  StudentCancelLeaving,
  StudentDelete,
  StudentDetail,
  StudentLeaving,
  StudentRestore,
  StudentReturn,
  StudentUndoLeaving,
} from '@sodiq/shared';
import { Transactions, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  holdsData,
  planCancelLeaving,
  planLeaving,
  planRestore,
  planReturn,
  planUndoLeaving,
  type StoredStudentStatus,
  type StudentStatusOutcome,
  type StudentStatusPlan,
} from './student-status.js';
import { Students } from './students.service.js';

const CHECK_VIOLATION = '23514';

/** The database guards of 0033 and the refusal each gives. */
const GUARDS: Readonly<Record<string, 'date_in_closed_year' | 'student_has_data'>> = {
  student_statuses_closed_year: 'date_in_closed_year',
  students_delete_guard: 'student_has_data',
};

/** Runs work; a guard of 0033 that refused becomes its 409. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    const code =
      failure.code === CHECK_VIOLATION && typeof failure.constraint === 'string'
        ? GUARDS[failure.constraint]
        : undefined;
    if (code === undefined) {
      throw error;
    }
    throw new ApiException(code, 409);
  }
}

/** Plain data for an audit entry: dates as text, no class instances. */
const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A student route works for the branch of the request.');
  }
  return access.branchId;
}

/** What a status route adds to the plan: the audit entry, and any other write of the change. */
interface StatusChange {
  action: string;
  version: number;
  plan: (rows: readonly StoredStudentStatus[], today: string) => StudentStatusOutcome;
  newValue: Record<string, unknown>;
  reason: string | null;
  /** Writes of the change besides the status rows (the contract and grade of a return). */
  also?: (transaction: Transaction) => Promise<void>;
}

/**
 * Leaving, return and delete of a student (docs/spec/04-people.md, Movements;
 * edge/students-classes-groups; task 2.4b-1, pull request #68). Every change
 * locks the student row first, reads the status rows after the lock, refuses
 * a change made on an older state (`student_changed`, edge: "The second one
 * gets \"student changed, reload\""), plans with the pure functions of
 * `student-status.ts` and writes its rows and its audit entry in one
 * transaction. "Today" is the transaction moment of the injected clock in the
 * branch's time zone. A date in a closed academic year is refused by the
 * database (0033).
 */
@Injectable()
export class StudentStatuses {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly students: Students,
  ) {}

  /** Leaving the school: the last day and a reason; scheduled when the last day is today or later. */
  leave(
    access: Access,
    id: string,
    input: StudentLeaving,
    requestId: string,
  ): Promise<StudentDetail> {
    return this.change(access, id, requestId, {
      action: 'student.leave',
      version: input.version,
      plan: (rows, today) => planLeaving(rows, input.lastDay, input.reason, today),
      newValue: { lastDay: input.lastDay },
      reason: input.reason,
    });
  }

  /** The cancel of a scheduled leaving. */
  cancelLeaving(
    access: Access,
    id: string,
    input: StudentCancelLeaving,
    requestId: string,
  ): Promise<StudentDetail> {
    return this.change(access, id, requestId, {
      action: 'student.leave_cancelled',
      version: input.version,
      plan: (rows, today) => planCancelLeaving(rows, today),
      newValue: {},
      reason: null,
    });
  }

  /** "Undo leaving" of a leaving in force, with a reason. */
  undoLeaving(
    access: Access,
    id: string,
    input: StudentUndoLeaving,
    requestId: string,
  ): Promise<StudentDetail> {
    return this.change(access, id, requestId, {
      action: 'student.leave_undone',
      version: input.version,
      plan: (rows, today) => planUndoLeaving(rows, input.reason, today),
      newValue: {},
      reason: input.reason,
    });
  }

  /**
   * Coming back from the Inactive list with a new contract, into the grade
   * the student returns to (decision 7); the UID and every earlier row and
   * contract stay.
   */
  returnStudent(
    access: Access,
    id: string,
    input: StudentReturn,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return this.students.refusingTaken(access, () =>
      this.change(access, id, requestId, {
        action: 'student.return',
        version: input.version,
        plan: (rows, today) => planReturn(rows, input.from, input.reason, today),
        newValue: { from: input.from, grade: input.grade, contract: input.contract },
        reason: input.reason,
        also: async (transaction) => {
          // The grade of a return is part of the return (`04`, Movements), under
          // `archive`; the Super Admin and the Academic Vice Principal hold both
          // `archive` and `edit` of `students`, and a test pins it.
          await transaction
            .updateTable('students')
            .set({ grade: input.grade })
            .where('id', '=', id)
            .execute();
          await this.students.inserting({ 'contract.number': input.contract.number }, () =>
            transaction
              .insertInto('student_contracts')
              .values({
                student_id: id,
                branch_id: branchId,
                number: input.contract.number,
                signed_on: input.contract.signedOn,
              })
              .execute(),
          );
        },
      }),
    );
  }

  /** The Super Admin's restore of a graduated student, with a reason. */
  restore(
    access: Access,
    id: string,
    input: StudentRestore,
    requestId: string,
  ): Promise<StudentDetail> {
    return this.change(access, id, requestId, {
      action: 'student.graduate_restored',
      version: input.version,
      plan: (rows, today) => planRestore(rows, input.from, input.reason, today),
      newValue: { from: input.from },
      reason: input.reason,
    });
  }

  /**
   * The delete of a student created twice (edge: "may delete a student only if
   * there is no ... data"; decisions 3, 4 and 14): refused for a student with
   * data, here and by `students_delete_guard`. The contracts, the status rows
   * and the account go with the student; the UIDs stay reserved for good. The
   * audit entry keeps everything removed.
   */
  delete(access: Access, id: string, input: StudentDelete, requestId: string): Promise<void> {
    const branchId = branchOf(access);
    return guarded(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const row = await this.students.lockStudent(transaction, id);
        const rows = (await this.students.statusRowsOf(transaction, id)).get(id) ?? [];
        if (rows.length !== input.version) {
          throw new ApiException('student_changed', 409);
        }
        const contracts = await transaction
          .selectFrom('student_contracts')
          .select(['id', 'number', 'signed_on'])
          .where('student_id', '=', id)
          .orderBy('id')
          .execute();
        if (holdsData(rows, row.scholarship_type, contracts.length)) {
          throw new ApiException('student_has_data', 409);
        }
        const uids = await transaction
          .selectFrom('student_uids')
          .select(['uid', 'held_from'])
          .where('student_id', '=', id)
          .orderBy('held_from')
          .execute();
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: 'student.delete',
          record: { type: 'student', id },
          oldValue: asJson({
            student: row,
            contracts,
            statuses: rows,
            uids: uids.map((uid) => uid.uid),
          }),
          reason: input.reason,
          requestId,
        });
        await transaction.deleteFrom('students').where('id', '=', id).execute();
      }),
    );
  }

  private change(
    access: Access,
    id: string,
    requestId: string,
    change: StatusChange,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return guarded(() =>
      this.transactions.run(access.branchIds, async (transaction) => {
        const student = await this.students.lockStudent(transaction, id);
        const rows = (await this.students.statusRowsOf(transaction, id)).get(id) ?? [];
        if (rows.length !== change.version) {
          throw new ApiException('student_changed', 409);
        }
        const today = await this.students.todayIn(transaction, branchId);
        const outcome = change.plan(rows, today);
        if ('refusal' in outcome) {
          throw new ApiException(outcome.refusal, 409);
        }
        await this.apply(transaction, branchId, id, outcome);
        await change.also?.(transaction);
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: change.action,
          record: { type: 'student', id },
          // The grade too: a return writes it (permission review of the build).
          oldValue: asJson({ statuses: rows, grade: student.grade }),
          newValue: asJson({ ...change.newValue, cuts: outcome.cuts, writes: outcome.writes }),
          reason: change.reason ?? undefined,
          requestId,
        });
        return this.students.readDetail(transaction, access, id);
      }),
    );
  }

  /** The cuts first, then the new rows: a new row never overlaps a row not yet cut. */
  private async apply(
    transaction: Transaction,
    branchId: string,
    id: string,
    plan: StudentStatusPlan,
  ): Promise<void> {
    for (const cut of plan.cuts) {
      await transaction
        .updateTable('student_statuses')
        .set({ valid_until: cut.validUntil })
        .where('id', '=', cut.id)
        .where('student_id', '=', id)
        .execute();
    }
    for (const write of plan.writes) {
      await transaction
        .insertInto('student_statuses')
        .values({
          student_id: id,
          branch_id: branchId,
          status: write.status,
          valid_from: write.validFrom,
          valid_until: write.validUntil,
          cause: write.cause,
          reason: write.reason,
        })
        .execute();
    }
  }
}
