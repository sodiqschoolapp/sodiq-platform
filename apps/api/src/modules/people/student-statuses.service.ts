import { Injectable } from '@nestjs/common';
import type {
  AuditAction,
  ClassNotRestored,
  ErrorCode,
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
  applyMembershipPlan,
  classesInService,
  membershipsOf,
  MEMBERSHIP_REFUSALS,
} from '../classes/class-membership-rows.js';
import { planMemberships, type StoredMembership } from '../classes/membership-plan.js';
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
import { linkValueOf, RelativeWrites } from './relative-writes.js';
import { Students } from './students.service.js';

const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

/** The database guards of 0033 and 0045 and the refusal each gives. */
const GUARDS: Readonly<Record<string, ErrorCode>> = {
  student_statuses_closed_year: 'date_in_closed_year',
  students_delete_guard: 'student_has_data',
  // Task 3.1b: a class row cut or written back by the change, a return's grade.
  ...MEMBERSHIP_REFUSALS,
};

/** Runs work; a guard of 0033 that refused becomes its 409. */
async function guarded<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    const code =
      (failure.code === CHECK_VIOLATION || failure.code === EXCLUSION_VIOLATION) &&
      typeof failure.constraint === 'string' &&
      Object.hasOwn(GUARDS, failure.constraint)
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
  action: AuditAction;
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
    private readonly relatives: RelativeWrites,
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
        const memberships = await membershipsOf(transaction, id);
        if (rows.length + memberships.length !== input.version) {
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
        // The links go with the student (task 2.5a, decision 10): kept in the
        // entry, and each relative left with no live link anywhere is
        // archived by `relatives_follow_links`, decided here under its lock
        // in the order of its id.
        const links = (await this.relatives.linksOf(transaction, id)).sort((a, b) =>
          a.relative_id.localeCompare(b.relative_id),
        );
        const archived: string[] = [];
        for (const link of links) {
          const relative = await this.relatives.lockRelative(
            transaction,
            branchId,
            link.relative_id,
          );
          if ((await this.relatives.liveLinks(transaction, link.relative_id)) === 1) {
            archived.push(link.relative_id);
            // Its mark "same person" goes before the archive (`unmarkArchived`).
            await this.relatives.unmarkArchived(transaction, access, relative, requestId);
          }
        }
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
            // Task 3.1b, decision 12: the class rows go with the student (the cascade).
            memberships,
            uids: uids.map((uid) => uid.uid),
            relatives: links.map((link) => ({
              relativeId: link.relative_id,
              ...linkValueOf(id, link),
            })),
          }),
          reason: input.reason,
          requestId,
        });
        for (const relativeId of archived) {
          await this.audit.record(transaction, {
            branchId: null,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'relative.archive',
            record: { type: 'relative', id: relativeId },
            details: { branchId },
            requestId,
          });
        }
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
        const memberships = await membershipsOf(transaction, id);
        // The version counts the class rows too (task 3.1b, decision 17).
        if (rows.length + memberships.length !== change.version) {
          throw new ApiException('student_changed', 409);
        }
        const today = await this.students.todayIn(transaction, branchId);
        const outcome = change.plan(rows, today);
        if ('refusal' in outcome) {
          throw new ApiException(outcome.refusal, 409);
        }
        const written = await this.apply(transaction, branchId, id, outcome);
        const classes = await this.followLeaving(
          transaction,
          id,
          rows,
          memberships,
          outcome,
          written,
          change.action === 'student.leave_undone' ? 'undo' : 'cancel',
        );
        await change.also?.(transaction);
        await this.audit.record(transaction, {
          branchId,
          actorId: access.accountId,
          assignmentId: access.assignmentId,
          action: change.action,
          record: { type: 'student', id },
          // The grade too: a return writes it (permission review of the build).
          oldValue: asJson({ statuses: rows, grade: student.grade }),
          newValue: asJson({
            ...change.newValue,
            cuts: outcome.cuts,
            writes: outcome.writes,
            ...(classes === null ? {} : { memberships: classes.memberships }),
          }),
          reason: change.reason ?? undefined,
          requestId,
        });
        const detail = await this.students.readDetail(transaction, access, id);
        return classes === null || classes.notRestored.length === 0
          ? detail
          : { ...detail, classesNotRestored: classes.notRestored };
      }),
    );
  }

  /**
   * The class rows follow a change of a leaving (task 3.1b, decision 1 with
   * correction 1): a leaving cuts them at its first inactive day; a cancel,
   * an undo or the replace of a scheduled leaving gives back the rows the
   * leaving taken back had cut, through every check of the guard; a row of a
   * class out of service is named and not given back. The classes are locked
   * FOR SHARE after the student (the lock order of every placement). `null`
   * when the change touches no leaving (a return, a restore).
   */
  private async followLeaving(
    transaction: Transaction,
    id: string,
    rows: readonly StoredStudentStatus[],
    memberships: readonly StoredMembership[],
    outcome: StudentStatusPlan,
    written: readonly string[],
    cause: 'cancel' | 'undo',
  ): Promise<{
    memberships: Awaited<ReturnType<typeof applyMembershipPlan>> & { notRestored: string[] };
    notRestored: ClassNotRestored[];
  } | null> {
    const takenBack = outcome.cuts
      .map((cut) => ({ cut, row: rows.find((row) => row.id === cut.id) }))
      .find(
        ({ cut, row }) =>
          row !== undefined &&
          row.status === 'inactive' &&
          row.cause === 'leaving' &&
          cut.validUntil === row.validFrom,
      )?.row;
    const leavingIndex = outcome.writes.findIndex((write) => write.cause === 'leaving');
    const leaving = outcome.writes[leavingIndex];
    const leavingId = written[leavingIndex] ?? null;
    if (takenBack === undefined && leaving === undefined) {
      return null;
    }
    const inService = await classesInService(
      transaction,
      memberships.map((row) => row.classId),
    );
    const plan = planMemberships(
      memberships,
      {
        takeBack:
          takenBack === undefined ? null : { leavingId: takenBack.id, from: takenBack.validFrom },
        leave: leaving === undefined ? null : { from: leaving.validFrom },
      },
      (classId) => inService.has(classId),
    );
    const moved = await applyMembershipPlan(transaction, id, memberships, plan, leavingId, cause);
    const notRestoredIds = [...new Set(plan.notRestored.map((row) => row.classId))];
    const named =
      notRestoredIds.length === 0
        ? []
        : await transaction
            .selectFrom('classes')
            .select(['id', 'grade', 'name'])
            .where('id', 'in', notRestoredIds)
            .orderBy('grade')
            .orderBy('name_key')
            .execute();
    return {
      memberships: { ...moved, notRestored: notRestoredIds },
      notRestored: named.map((one) => ({ classId: one.id, grade: one.grade, name: one.name })),
    };
  }

  /**
   * The cuts first, then the new rows: a new row never overlaps a row not yet
   * cut. Answers the id of each new row, in the order of `plan.writes`.
   */
  private async apply(
    transaction: Transaction,
    branchId: string,
    id: string,
    plan: StudentStatusPlan,
  ): Promise<string[]> {
    for (const cut of plan.cuts) {
      await transaction
        .updateTable('student_statuses')
        .set({ valid_until: cut.validUntil })
        .where('id', '=', cut.id)
        .where('student_id', '=', id)
        .execute();
    }
    const ids: string[] = [];
    for (const write of plan.writes) {
      const row = await transaction
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
        .returning('id')
        .executeTakeFirstOrThrow();
      ids.push(row.id);
    }
    return ids;
  }
}
