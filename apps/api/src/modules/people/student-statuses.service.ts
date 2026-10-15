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
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
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
import {
  CLASS_PATH_GROUP_REFUSALS,
  cutGroupRows,
  groupMembershipsOf,
  type GroupRowEnded,
} from '../classes/group-membership-rows.js';
import { planMemberships, type StoredMembership } from '../classes/membership-plan.js';
import {
  CLASS_GROUP_REFUSALS,
  coverClassRows,
  lockClassGroups,
  lockPlacementGroups,
  type GroupRowWritten,
} from '../classes/class-groups.js';
import {
  lockPlacementStudents,
  planPlacement,
  readPlacementClass,
  writePlacement,
  type PlacementClass,
} from '../classes/class-placement.js';
import { notFound } from '../setup/setup-refusals.js';
import { atClassFields, classLeft, groupsLeavingCut } from './return-class.js';
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
import { cancelledOf, MOVE_REFUSALS, movesOf } from '../classes/student-moves.js';
import { linkValueOf, RelativeWrites } from './relative-writes.js';
import { BRANCH_MOVE_REFUSALS, branchMovesOf } from './branch-moves.js';
import { Students } from './students.service.js';

const CHECK_VIOLATION = '23514';
const EXCLUSION_VIOLATION = '23P01';

/** The database guards of 0033 and 0045 and the refusal each gives. */
const GUARDS: Readonly<Record<string, ErrorCode>> = {
  student_statuses_closed_year: 'date_in_closed_year',
  students_delete_guard: 'student_has_data',
  // Task 3.1b: a class row cut or written back by the change, a return's grade.
  ...MEMBERSHIP_REFUSALS,
  // Task 3.2b: the group rows follow the class rows; the containment answers a fault only.
  ...CLASS_PATH_GROUP_REFUSALS,
  // Task 3.2c: a class row written back needs its groups; a fault only.
  ...CLASS_GROUP_REFUSALS,
  // Task 3.3a: a leaving cancels the scheduled moves it comes before.
  ...MOVE_REFUSALS,
  // Task 3.3c: a leaving cancels an open release; no status of the new
  // branch is dated before the move (decision 12).
  ...BRANCH_MOVE_REFUSALS,
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

/** The class read by `before`; `also` runs only after it. */
function placedBy(placement: PlacementClass | undefined): PlacementClass {
  if (placement === undefined) {
    throw new Error('The class of the change is read before the change.');
  }
  return placement;
}

/** The leaving a return ends: the inactive row it cuts and its first inactive day. */
function leavingEnded(context: {
  rows: readonly StoredStudentStatus[];
  outcome: StudentStatusPlan;
}): { id: string; from: string } | null {
  const cut = context.outcome.cuts[0];
  const row = cut === undefined ? undefined : context.rows.find((one) => one.id === cut.id);
  return row === undefined ? null : { id: row.id, from: row.validFrom };
}

/** What a status route adds to the plan: the audit entry, and any other write of the change. */
interface StatusChange {
  action: AuditAction;
  version: number;
  plan: (rows: readonly StoredStudentStatus[], today: string) => StudentStatusOutcome;
  newValue: Record<string, unknown>;
  reason: string | null;
  /** Read before the student is locked and before any write (the class of a return, task 3.3b). */
  before?: (transaction: Transaction) => Promise<void>;
  /**
   * Writes of the change besides the status rows (the contract, grade and
   * class of a return), after them; what it answers joins the audit entry
   * and the answer.
   */
  also?: (
    transaction: Transaction,
    context: { rows: readonly StoredStudentStatus[]; outcome: StudentStatusPlan },
  ) => Promise<ChangeAlso | undefined>;
}

/** What the class of a return or a restore adds to the audit entry and to the answer. */
interface ChangeAlso {
  newValue: Record<string, unknown>;
  groupsPlaced: { studentId: string; groupId: string; subjectId: string }[];
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
   * the student returns to (decision 7) and into a class from the return date
   * (task 3.3b: `04`, Movements, "is placed in a class from the return
   * date"); the UID and every earlier row and contract stay.
   */
  returnStudent(
    access: Access,
    id: string,
    input: StudentReturn,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    let placement: PlacementClass | undefined;
    return atClassFields(() =>
      this.students.refusingTaken(access, () =>
        this.change(access, id, requestId, {
          action: 'student.return',
          version: input.version,
          before: async (transaction) => {
            placement = await this.classOfBody(transaction, branchId, input.classId);
          },
          plan: (rows, today) => planReturn(rows, input.from, input.reason, today),
          newValue: {
            from: input.from,
            grade: input.grade,
            contract: input.contract,
            classId: input.classId,
          },
          reason: input.reason,
          also: async (transaction, context) => {
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
            return this.placeBack(transaction, access, requestId, id, placedBy(placement), {
              from: input.from,
              cause: 'return',
              leaving: leavingEnded(context),
              confirmLanguage: input.confirmLanguage === true,
            });
          },
        }),
      ),
    );
  }

  /**
   * The Super Admin's restore of a graduated student, with a reason, into a
   * class (edge: "restores the student to active with a class and a reason";
   * task 3.3b): the student takes the class's grade (decision 6). No
   * confirmation of the language is asked (correction to decision 2).
   */
  restore(
    access: Access,
    id: string,
    input: StudentRestore,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    let placement: PlacementClass | undefined;
    return atClassFields(() =>
      this.change(access, id, requestId, {
        action: 'student.graduate_restored',
        version: input.version,
        before: async (transaction) => {
          placement = await this.classOfBody(transaction, branchId, input.classId);
        },
        plan: (rows, today) => planRestore(rows, input.from, input.reason, today),
        newValue: { from: input.from, classId: input.classId },
        reason: input.reason,
        also: async (transaction) => {
          const named = placedBy(placement);
          // The grade of the class (decision 6), under `student_graduates`
          // `edit`; the Super Admin also holds `students` `edit`, and a test
          // pins it. `students_grade_class` (0045) checks it.
          await transaction
            .updateTable('students')
            .set({ grade: named.grade })
            .where('id', '=', id)
            .execute();
          const placed = await this.placeBack(transaction, access, requestId, id, named, {
            from: input.from,
            cause: 'restore',
            leaving: null,
            confirmLanguage: false,
          });
          return { ...placed, newValue: { grade: named.grade, ...placed.newValue } };
        },
      }),
    );
  }

  /**
   * The class named in the body of a return or a restore, read before the
   * student is locked and before any write: another branch's or an unknown
   * one is 404, also for the Super Admin (`.claude/rules/api.md`).
   */
  private async classOfBody(
    transaction: Transaction,
    branchId: string,
    classId: string,
  ): Promise<PlacementClass> {
    const found = await readPlacementClass(transaction, classId);
    if (found === undefined || found.branchId.toLowerCase() !== branchId.toLowerCase()) {
      throw notFound();
    }
    return found;
  }

  /**
   * The class row of a return or a restore and its groups (task 3.3b), after
   * the status rows, grade and contract are written: the class FOR UPDATE and
   * read again after the lock (decision 9), every class rule checked again
   * by the placement plan of "Put into a class" for the one student, the
   * language of the class left confirmed (a return, decision 2), the groups
   * FOR UPDATE, the class row written with its cause and every split or
   * group subject covered, the group the leaving cut first on a return into
   * the class left (decision 5 with correction 1), all or none. Lock order:
   * the student, the class, the groups.
   */
  private async placeBack(
    transaction: Transaction,
    access: Access,
    requestId: string,
    id: string,
    named: PlacementClass,
    input: {
      from: string;
      cause: 'return' | 'restore';
      /** The leaving the return ends: its row and first inactive day. */
      leaving: { id: string; from: string } | null;
      confirmLanguage: boolean;
    },
  ): Promise<ChangeAlso> {
    await classesInService(transaction, [named.id]);
    const placement = await readPlacementClass(transaction, named.id);
    if (placement === undefined) {
      throw notFound();
    }
    const student = (await lockPlacementStudents(transaction, [id])).get(id);
    if (student === undefined) {
      throw notFound();
    }
    const rows = await planPlacement(
      transaction,
      placement,
      [{ student, version: null }],
      input.from,
    );
    const left =
      input.leaving === null
        ? undefined
        : classLeft(
            student.memberships,
            input.leaving.from,
            cancelledOf(await movesOf(transaction, id)),
          );
    let languageConfirmed = false;
    if (left !== undefined) {
      const languages = await transaction
        .selectFrom('classes')
        .select(['id', 'language'])
        .where('id', 'in', [left.classId, placement.id])
        .execute();
      const languageOf = (classId: string) =>
        languages.find((one) => one.id.toLowerCase() === classId.toLowerCase())?.language;
      if (languageOf(left.classId) !== languageOf(placement.id)) {
        if (!input.confirmLanguage) {
          throw new ApiException('return_language_differs', 409);
        }
        languageConfirmed = true;
      }
    }
    const groups = await lockPlacementGroups(transaction, [placement.id], [id]);
    const [membershipId] = await writePlacement(
      transaction,
      this.audit,
      access,
      placement,
      rows,
      input.cause,
      requestId,
    );
    const intoLeft =
      input.leaving !== null &&
      left !== undefined &&
      left.classId.toLowerCase() === placement.id.toLowerCase();
    const covered = await coverClassRows(
      transaction,
      this.audit,
      access,
      {
        classRows: rows.map((row) => ({
          index: 0,
          row: {
            studentId: row.studentId,
            classId: placement.id,
            from: row.from,
            until: row.until,
            ownUntil: placement.ownUntil,
            leavingId: row.leavingId,
          },
        })),
        giveBack: null,
        groups,
        pathOf: () => 'classId',
        ...(intoLeft && input.leaving !== null
          ? {
              // Keyed by the stored id, as `planClassGroups` reads it (spec review, should-fix 6).
              preferred: new Map([
                [
                  student.id,
                  groupsLeavingCut(await groupMembershipsOf(transaction, id), input.leaving.id),
                ],
              ]),
            }
          : {}),
      },
      requestId,
    );
    return {
      newValue: {
        classMembershipId: membershipId ?? null,
        ...(input.cause === 'return' ? { languageConfirmed } : {}),
        groupsPlaced: covered.automatic.length,
      },
      groupsPlaced: covered.automatic.map((row) => ({
        studentId: row.studentId,
        groupId: row.groupId,
        subjectId: row.subjectId,
      })),
    };
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
        // Task 3.2b: the group rows go with the student too (the cascade).
        const groupMemberships = await groupMembershipsOf(transaction, id);
        // Task 3.3a: so do the moves (should-fix 4 of the plan review).
        const moves = await movesOf(transaction, id);
        // Task 3.3c: and the releases to another branch.
        const branchMoves = await branchMovesOf(transaction, id, branchId);
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
            groupMemberships,
            moves,
            branchMoves,
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
        await change.before?.(transaction);
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
          access,
          requestId,
          id,
          rows,
          memberships,
          outcome,
          written,
          change.action === 'student.leave_undone' ? 'undo' : 'cancel',
        );
        const also = await change.also?.(transaction, { rows, outcome });
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
            ...also?.newValue,
            cuts: outcome.cuts,
            writes: outcome.writes,
            ...(classes === null
              ? {}
              : {
                  memberships: classes.memberships,
                  groupMemberships: classes.groupMemberships,
                  ...(classes.movesCancelled.length === 0
                    ? {}
                    : { movesCancelled: classes.movesCancelled }),
                  ...(classes.branchMoveCancelled === null
                    ? {}
                    : { branchMoveCancelled: classes.branchMoveCancelled }),
                }),
          }),
          reason: change.reason ?? undefined,
          requestId,
        });
        const detail = await this.students.readDetail(transaction, access, id);
        if (also !== undefined) {
          return { ...detail, groupsPlaced: also.groupsPlaced };
        }
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
   * FOR UPDATE after the student (the lock order of every placement), then
   * the groups (task 3.2c, decision 9). `null`
   * when the change touches no leaving (a return, a restore).
   */
  private async followLeaving(
    transaction: Transaction,
    access: Access,
    requestId: string,
    id: string,
    rows: readonly StoredStudentStatus[],
    memberships: readonly StoredMembership[],
    outcome: StudentStatusPlan,
    written: readonly string[],
    cause: 'cancel' | 'undo',
  ): Promise<{
    memberships: Awaited<ReturnType<typeof applyMembershipPlan>> & { notRestored: string[] };
    groupMemberships: {
      cut: GroupRowEnded[];
      written: Omit<GroupRowWritten, 'studentId' | 'subjectId'>[];
    };
    notRestored: ClassNotRestored[];
    movesCancelled: string[];
    /** The open release to another branch the leaving cancelled (task 3.3c, decision 10). */
    branchMoveCancelled: string | null;
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
    // Task 3.3a, decision 8: a leaving whose first inactive day is on or
    // before the date of a scheduled move cancels it (edge: "scheduled moves
    // are cancelled"), and a row a cancelled move wrote is never given back.
    const today = await this.students.todayIn(transaction, branchOf(access));
    const moves = await movesOf(transaction, id);
    const movesCancelled =
      leaving === undefined || leavingId === null
        ? []
        : moves
            .filter(
              (move) =>
                move.cancelledAt === null &&
                move.undoneAt === null &&
                move.effectiveOn > today &&
                move.effectiveOn >= leaving.validFrom,
            )
            .map((move) => move.id);
    if (movesCancelled.length > 0 && leavingId !== null) {
      await transaction
        .updateTable('student_moves')
        .set({
          cancelled_at: await transactionMoment(transaction),
          cancelled_by_leaving_id: leavingId,
        })
        .where('id', 'in', movesCancelled)
        .execute();
    }
    // Task 3.3c, decision 10: a leaving cancels an open release of the
    // student to another branch, whatever its date, under the student's lock
    // taken first (the lock order of the branch moves).
    const openRelease =
      leaving === undefined || leavingId === null
        ? undefined
        : (await branchMovesOf(transaction, id, branchOf(access))).find(
            (move) =>
              move.cancelledAt === null && move.declinedAt === null && move.acceptedAt === null,
          );
    if (openRelease !== undefined && leavingId !== null) {
      await transaction
        .updateTable('student_branch_moves')
        .set({
          cancelled_at: await transactionMoment(transaction),
          cancelled_by_leaving_id: leavingId,
        })
        .where('id', '=', openRelease.id)
        .execute();
    }
    const cancelledMoves = new Set([...cancelledOf(moves), ...movesCancelled]);
    const plan = planMemberships(
      memberships,
      {
        takeBack:
          takenBack === undefined ? null : { leavingId: takenBack.id, from: takenBack.validFrom },
        leave: leaving === undefined ? null : { from: leaving.validFrom },
      },
      (classId) => inService.has(classId),
      cancelledMoves,
      new Set(movesCancelled),
    );
    // Task 3.2c, decision 9: every group the change may touch, locked FOR
    // UPDATE in the order of their id in one call, after the classes and
    // before the first write: the groups of the student's own rows (the
    // rows a leaving cuts or a taken-back one gives back) and the active
    // groups of the classes written back.
    const groups = await lockClassGroups(
      transaction,
      plan.inserts.map((row) => row.classId),
      (await groupMembershipsOf(transaction, id)).map((row) => row.groupId),
    );
    const moved = await applyMembershipPlan(transaction, id, memberships, plan, leavingId, cause);
    // Task 3.2b (decision 8 of pull request #92): the group rows of the dates
    // the class rows lose end with them; a cancel, an undo or a later date
    // gives none back (decision 9: task 3.2c).
    const groupsCut =
      leaving === undefined || leavingId === null
        ? []
        : await cutGroupRows(
            transaction,
            id,
            leaving.validFrom,
            leavingId,
            takenBack?.id ?? null,
            new Set(movesCancelled),
          );
    // Task 3.2c: the class rows written back need their groups, every day:
    // the rows the leaving taken back cut come back first (decision 6), then
    // every day still without a group of a split or group subject gets the
    // smallest suitable group (decision 7), all or none (decision 3).
    const covered = await coverClassRows(
      transaction,
      this.audit,
      access,
      {
        classRows: plan.inserts.map((row) => ({
          index: 0,
          row: {
            studentId: id,
            classId: row.classId,
            from: row.validFrom,
            until: row.validUntil,
            ownUntil: row.ownUntil,
            leavingId: row.cut ? leavingId : null,
          },
        })),
        giveBack:
          takenBack === undefined
            ? null
            : {
                studentId: id,
                takenBack: { leavingId: takenBack.id, from: takenBack.validFrom },
                leave:
                  leaving === undefined || leavingId === null
                    ? null
                    : { from: leaving.validFrom, leavingId },
                cause,
              },
        groups,
        pathOf: () => '',
        cancelledMoves,
      },
      requestId,
    );
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
      groupMemberships: {
        cut: groupsCut,
        written: covered.written.map((row) => ({
          id: row.id,
          groupId: row.groupId,
          from: row.from,
          until: row.until,
          cause: row.cause,
          review: row.review,
        })),
      },
      notRestored: named.map((one) => ({ classId: one.id, grade: one.grade, name: one.name })),
      movesCancelled,
      branchMoveCancelled: openRelease?.id ?? null,
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
