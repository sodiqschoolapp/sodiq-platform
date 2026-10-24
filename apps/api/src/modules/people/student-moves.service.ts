import { Injectable } from '@nestjs/common';
import type {
  AuditAction,
  ClassTransfer,
  ClassTransferCancel,
  ClassTransferChange,
  ClassTransferUndo,
  ErrorCode,
  GroupTransfer,
  GroupTransferChange,
  GroupTransferUndo,
  JournalEntriesChoice,
  SchoolDate,
  StudentDetail,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import { inGroupScope } from '../access/group-scope.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  followJournal,
  giveBack,
  refuseEntriesLeftByUndo,
  settle,
  type JournalEffects,
  type JournalFollow,
  type JournalGiveBack,
} from '../journal/journal-entries.js';
import {
  CLASS_GROUP_REFUSALS,
  coverClassRows,
  lockClassGroups,
  type ClassRowToCover,
} from '../classes/class-groups.js';
import {
  MEMBERSHIP_REFUSALS,
  classesInService,
  membersPeak,
} from '../classes/class-membership-rows.js';
import {
  lockPlacementStudents,
  readPlacementClass,
  type PlacementStudent,
  classFull,
} from '../classes/class-placement.js';
import {
  CLASS_PATH_GROUP_REFUSALS,
  GROUP_MEMBERSHIP_REFUSALS,
  groupMembershipsOf,
  lockGroups,
  type StoredGroupMembership,
} from '../classes/group-membership-rows.js';
import { classesOfGroups } from '../classes/group-rows.js';
import {
  continuesStay,
  holdsDays,
  placementEnd,
  type StoredMembership,
} from '../classes/membership-plan.js';
import {
  lockMove,
  MOVE_REFUSALS,
  moveState,
  movesOf,
  pastMoverOf,
  studentOfMove,
  undoable,
  undoFacts,
  writtenBy,
  type StoredMove,
} from '../classes/student-moves.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { arrivedOn, branchMoveState, branchMovesOf } from './branch-moves.js';
import { Students } from './students.service.js';

/** Plain data for an audit entry: dates as text, no class instances. */
const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

const later = (a: SchoolDate, b: SchoolDate): SchoolDate => (a > b ? a : b);

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A move works for the branch of the request.');
  }
  return access.branchId;
}

/**
 * The refusals of a class move: the class rows (0045), a group row of a class
 * path, which only a fault meets (0048), the groups of the new class (0049)
 * and the moves (0050).
 */
const CLASS_MOVE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...MEMBERSHIP_REFUSALS,
  ...CLASS_PATH_GROUP_REFUSALS,
  ...CLASS_GROUP_REFUSALS,
  ...MOVE_REFUSALS,
};

/** The refusals of a group move: the group rows (0048) and the moves (0050). */
const GROUP_MOVE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...GROUP_MEMBERSHIP_REFUSALS,
  ...MOVE_REFUSALS,
};

/** A group as a move reads it: its subject, its classes and whether it is of the branch. */
interface MoveGroupRow {
  id: string;
  branchId: string;
  subjectId: string;
  classIds: string[];
}

/** What a move wrote and cut, as its audit entry names it. */
interface Moved {
  moveId: string;
  from: SchoolDate;
  [key: string]: unknown;
}

/**
 * Class and group transfers (docs/spec/04-people.md, Movements;
 * edge/students-classes-groups; task 3.3a, pull request #95). A move is a row
 * of `student_moves` (decision 7); the rows it cuts and writes name it.
 *
 * Lock order, the one of every class path (3.2c, decision 9): the student FOR
 * UPDATE, the move FOR UPDATE, the classes FOR UPDATE in the order of their
 * id, every group the change may touch FOR UPDATE in the order of their id,
 * then the writes. A group move takes the student, the move, then its two
 * groups. "Today" is the transaction moment in the branch's time zone.
 */
@Injectable()
export class StudentMoves {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly students: Students,
  ) {}

  /** A class transfer from a date (decisions 3 to 5). */
  transferClass(access: Access, input: ClassTransfer, requestId: string): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const student = await this.lockStudent(transaction, input.studentId, input.version);
          const today = await this.students.todayIn(transaction, branchId);
          const follow = await followJournal(transaction, student.id, input.from);
          const moved = await this.moveClass(transaction, access, student, today, input, requestId);
          const journal = await settleMove(transaction, access, follow, moved.moveId, today, input);
          await this.record(transaction, access, student.id, 'student.class_transferred', {
            newValue: { ...moved, journal },
            requestId,
          });
          return this.students.readDetail(transaction, access, student.id);
        }),
      CLASS_MOVE_REFUSALS,
    );
  }

  /** The change of a scheduled class transfer: its cancel and a new move, in one step. */
  changeClass(
    access: Access,
    moveId: string,
    input: ClassTransferChange,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const studentId = await studentOfMove(transaction, branchId, moveId, 'class');
          const student = await this.lockStudent(transaction, studentId, input.version);
          const move = await lockMove(transaction, branchId, moveId, 'class');
          const today = await this.students.todayIn(transaction, branchId);
          if (moveState(move, today) !== 'scheduled') {
            throw new ApiException('move_not_scheduled', 409);
          }
          const cancelled = await this.takeBackClass(
            transaction,
            access,
            student,
            move,
            'cancel',
            null,
            requestId,
          );
          const again = await this.lockStudent(transaction, studentId, null);
          const follow = await followJournal(transaction, studentId, input.from);
          const moved = await this.moveClass(
            transaction,
            access,
            again,
            today,
            {
              toClassId: input.toClassId,
              from: input.from,
              confirmLanguage: input.confirmLanguage,
              // H27 of issue #105: the question was answered when this move
              // was saved, for these two classes; it is not asked again.
              answeredFor: { fromClassId: move.fromClassId, toClassId: move.toClassId },
              replacesMoveId: move.id,
            },
            requestId,
          );
          const journal = await settleMove(transaction, access, follow, moved.moveId, today, input);
          await this.record(transaction, access, studentId, 'student.class_transfer_changed', {
            oldValue: cancelled,
            newValue: { ...moved, journal },
            requestId,
          });
          return this.students.readDetail(transaction, access, studentId);
        }),
      CLASS_MOVE_REFUSALS,
    );
  }

  /** The cancel of a scheduled class transfer ("It can be changed or cancelled until the date"). */
  cancelClass(
    access: Access,
    moveId: string,
    input: ClassTransferCancel,
    requestId: string,
  ): Promise<StudentDetail> {
    return this.takeBackClassRoute(access, moveId, input.version, 'cancel', null, requestId);
  }

  /** The undo of a class transfer that has begun, with a reason (decision 10). */
  undoClass(
    access: Access,
    moveId: string,
    input: ClassTransferUndo,
    requestId: string,
  ): Promise<StudentDetail> {
    return this.takeBackClassRoute(access, moveId, input.version, 'undo', input.reason, requestId);
  }

  /** A group transfer from a date, of the row the person saw (decisions 2 and 6). */
  transferGroup(access: Access, input: GroupTransfer, requestId: string): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const student = await this.lockStudent(transaction, input.studentId, null);
          const rows = await groupMembershipsOf(transaction, student.id);
          const row = rows.find((one) => one.id.toLowerCase() === input.memberId.toLowerCase());
          if (row === undefined) {
            throw notFound();
          }
          const today = await this.students.todayIn(transaction, branchId);
          const follow = await followJournal(transaction, student.id, input.from);
          const { assignmentId, ...moved } = await this.moveGroup(
            transaction,
            access,
            student,
            today,
            { row, toGroupId: input.toGroupId, from: input.from, seen: true },
          );
          const journal = await settleMove(transaction, access, follow, moved.moveId, today, input);
          await this.record(transaction, access, student.id, 'student.group_transferred', {
            newValue: { ...moved, journal },
            requestId,
            assignmentId,
          });
          return this.students.readDetail(transaction, access, student.id);
        }),
      GROUP_MOVE_REFUSALS,
    );
  }

  /** The change of a scheduled group transfer: its cancel and a new move, in one step. */
  changeGroup(
    access: Access,
    moveId: string,
    input: GroupTransferChange,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const studentId = await studentOfMove(transaction, branchId, moveId, 'group');
          const student = await this.lockStudent(transaction, studentId, null);
          const move = await lockMove(transaction, branchId, moveId, 'group');
          const today = await this.students.todayIn(transaction, branchId);
          await this.groupScope(transaction, access, move);
          if (moveState(move, today) !== 'scheduled') {
            throw new ApiException('move_not_scheduled', 409);
          }
          const cancelled = await this.takeBackGroup(transaction, student, move, 'cancel', null);
          const follow = await followJournal(transaction, studentId, input.from);
          const rows = await groupMembershipsOf(transaction, studentId);
          const row = rows.find(
            (one) =>
              holdsDays(one) &&
              one.subjectId === move.subjectId &&
              one.validFrom <= input.from &&
              input.from < one.validUntil,
          );
          if (row === undefined) {
            throw new ApiException('move_no_membership', 409);
          }
          const { assignmentId, ...moved } = await this.moveGroup(
            transaction,
            access,
            student,
            today,
            {
              row,
              toGroupId: input.toGroupId,
              from: input.from,
              seen: false,
              replacesMoveId: move.id,
            },
          );
          const journal = await settleMove(transaction, access, follow, moved.moveId, today, input);
          await this.record(transaction, access, studentId, 'student.group_transfer_changed', {
            oldValue: cancelled,
            newValue: { ...moved, journal },
            requestId,
            assignmentId,
          });
          return this.students.readDetail(transaction, access, studentId);
        }),
      GROUP_MOVE_REFUSALS,
    );
  }

  /** The cancel of a scheduled group transfer. */
  cancelGroup(access: Access, moveId: string, requestId: string): Promise<StudentDetail> {
    return this.takeBackGroupRoute(access, moveId, 'cancel', null, requestId);
  }

  /** The undo of a group transfer that has begun, with a reason (decision 10). */
  undoGroup(
    access: Access,
    moveId: string,
    input: GroupTransferUndo,
    requestId: string,
  ): Promise<StudentDetail> {
    return this.takeBackGroupRoute(access, moveId, 'undo', input.reason, requestId);
  }

  /**
   * The student FOR UPDATE with its status and class rows; another branch's
   * or an unknown id is 404; a `version` other than the one stored is
   * `student_changed` (edge: "The second one gets \"student changed,
   * reload\""; decision 6).
   */
  private async lockStudent(
    transaction: Transaction,
    id: string,
    version: number | null,
  ): Promise<PlacementStudent> {
    const student = (await lockPlacementStudents(transaction, [id])).get(id);
    if (student === undefined) {
      throw notFound();
    }
    if (version !== null && student.version !== version) {
      throw new ApiException('student_changed', 409);
    }
    return student;
  }

  private async record(
    transaction: Transaction,
    access: Access,
    studentId: string,
    action: AuditAction,
    entry: {
      oldValue?: unknown;
      newValue: unknown;
      reason?: string;
      requestId: string;
      /** The assignment whose scope allowed the change (a group move), else the route's. */
      assignmentId?: string;
    },
  ): Promise<void> {
    await this.audit.record(transaction, {
      branchId: branchOf(access),
      actorId: access.accountId,
      assignmentId: entry.assignmentId ?? access.assignmentId,
      action,
      record: { type: 'student', id: studentId },
      ...(entry.oldValue === undefined ? {} : { oldValue: asJson(entry.oldValue) }),
      newValue: asJson(entry.newValue),
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      requestId: entry.requestId,
    });
  }

  /** A date before today needs the Super Admin or the Academic Vice Principal (decision 4). */
  private pastAllowed(access: Access, from: SchoolDate, today: SchoolDate): string | null {
    if (from >= today) {
      return null;
    }
    const allowed = pastMoverOf(access);
    if (allowed === undefined) {
      throw new ApiException('move_in_past', 403);
    }
    return allowed.id;
  }

  /**
   * The class move itself, after the student is locked: the class row that
   * holds `from` ends there, the new row runs from `from` to the end of the
   * new class's year, cut at a scheduled leaving and naming it (must-fix 5);
   * the group rows of groups that also draw from the new class go on, the
   * others end at `from`, and the new class's split and group subjects not
   * covered get the smallest suitable group (decision 5), all or none.
   */
  private async moveClass(
    transaction: Transaction,
    access: Access,
    student: PlacementStudent,
    today: SchoolDate,
    input: {
      toClassId: string;
      from: SchoolDate;
      confirmLanguage?: boolean | undefined;
      /** The two classes of the saved move a change replaces (H27). */
      answeredFor?: { fromClassId: string | null; toClassId: string | null };
      /** The cancelled move a change replaces (task 3.5c, H34). */
      replacesMoveId?: string;
    },
    requestId: string,
  ): Promise<Moved> {
    const branchId = branchOf(access);
    const from = input.from;
    const target = await readPlacementClass(transaction, input.toClassId);
    if (target === undefined || target.branchId.toLowerCase() !== branchId.toLowerCase()) {
      throw notFound();
    }
    const pastAssignmentId = this.pastAllowed(access, from, today);
    await refuseBranchMove(transaction, branchId, student.id, from);
    const held = student.memberships.find(
      (row) => holdsDays(row) && row.validFrom <= from && from < row.validUntil,
    );
    if (held === undefined) {
      throw new ApiException('move_no_membership', 409);
    }
    if (held.classId.toLowerCase() === target.id.toLowerCase()) {
      throw new ApiException('move_same_target', 409);
    }
    const moves = await movesOf(transaction, student.id);
    if (moves.some((move) => move.kind === 'class' && moveState(move, today) === 'scheduled')) {
      throw new ApiException('move_scheduled', 409);
    }
    // A later class move that has begun is not overwritten by one dated
    // before it (spec review of the build, should-fix 3).
    if (
      moves.some(
        (move) =>
          move.kind === 'class' && moveState(move, today) === 'done' && move.effectiveOn > from,
      )
    ) {
      throw new ApiException('move_before_later', 409);
    }
    // The two classes FOR UPDATE in the order of their id, then read.
    await classesInService(transaction, [held.classId, target.id]);
    const classes = await transaction
      .selectFrom('classes')
      .select(['id', 'language', 'academic_year_id'])
      .where('id', 'in', [held.classId, target.id])
      .execute();
    const left = classes.find((one) => one.id.toLowerCase() === held.classId.toLowerCase());
    const joined = classes.find((one) => one.id.toLowerCase() === target.id.toLowerCase());
    if (left === undefined || joined === undefined) {
      throw notFound();
    }
    // Decision 11: one academic year; the rollover moves between years.
    if (left.academic_year_id !== joined.academic_year_id) {
      throw new ApiException('membership_outside_year', 409);
    }
    const languageDiffers = left.language !== joined.language;
    // H27 (decision 1 of task 3.5b): the classes are compared, not their languages.
    const answered =
      input.answeredFor?.fromClassId?.toLowerCase() === held.classId.toLowerCase() &&
      input.answeredFor.toClassId?.toLowerCase() === target.id.toLowerCase();
    if (languageDiffers && input.confirmLanguage !== true && !answered) {
      throw new ApiException('class_language_differs', 409);
    }
    const end = placementEnd(student.statuses, student.startsOn, from, target.ownUntil);
    if ('refusal' in end) {
      throw new ApiException(end.refusal, 409);
    }
    const own = await groupMembershipsOf(transaction, student.id);
    const groups = await lockClassGroups(
      transaction,
      [held.classId, target.id],
      own.map((row) => row.groupId),
    );
    const moveId = await this.insertMove(transaction, branchId, student.id, {
      kind: 'class',
      from_class_id: held.classId,
      to_class_id: target.id,
      effective_on: from,
      replaces_move_id: input.replacesMoveId ?? null,
    });
    // Every class row of the year with days from `from` on ends there.
    const cut = student.memberships.filter(
      (row) => holdsDays(row) && row.validUntil > from && row.validFrom < target.ownUntil,
    );
    for (const row of cut) {
      await this.cutClassRow(transaction, row, later(row.validFrom, from), moveId);
    }
    // H24 of issue #105: the seats of the target over the days the row holds,
    // checked before the write so the refusal names the class and the first
    // full day (the guard of 0045 still checks under its locks).
    const peak = await membersPeak(transaction, target.id, from, end.until);
    if (peak >= target.maxSize) {
      throw await classFull(transaction, target, from, end.until, 1, 'toClassId');
    }
    const written = await transaction
      .insertInto('class_memberships')
      .values({
        branch_id: target.branchId,
        student_id: student.id,
        class_id: target.id,
        valid_from: from,
        valid_until: end.until,
        own_until: target.ownUntil,
        cause: 'transfer',
        ended_by: end.leavingId === null ? null : 'leaving',
        leaving_id: end.leavingId,
        written_by_move_id: moveId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    const key = target.id.toLowerCase();
    const kept: StoredGroupMembership[] = [];
    const groupsCut: {
      id: string;
      groupId: string;
      from: SchoolDate;
      until: SchoolDate;
      was: SchoolDate;
    }[] = [];
    for (const row of own) {
      if (!holdsDays(row) || row.validUntil <= from || row.validFrom >= target.ownUntil) {
        continue;
      }
      if (groups.get(row.groupId.toLowerCase())?.classIds.has(key) === true) {
        kept.push(row);
        continue;
      }
      const until = later(row.validFrom, from);
      await this.cutGroupRow(transaction, row, until, moveId);
      groupsCut.push({
        id: row.id,
        groupId: row.groupId,
        from: row.validFrom,
        until,
        was: row.validUntil,
      });
    }
    const covered = await coverClassRows(
      transaction,
      this.audit,
      access,
      {
        classRows: [
          {
            index: 0,
            row: {
              studentId: student.id,
              classId: target.id,
              from,
              until: end.until,
              ownUntil: target.ownUntil,
              leavingId: end.leavingId,
            },
          },
        ],
        giveBack: null,
        groups,
        pathOf: () => 'toClassId',
        moveId,
      },
      requestId,
    );
    return {
      moveId,
      fromClassId: held.classId,
      toClassId: target.id,
      from,
      ...(languageDiffers ? { confirmLanguage: true } : {}),
      ...(pastAssignmentId === null ? {} : { pastAssignmentId }),
      memberships: {
        cut: cut.map((row) => ({
          id: row.id,
          classId: row.classId,
          from: row.validFrom,
          until: later(row.validFrom, from),
          was: row.validUntil,
        })),
        written: [{ id: written.id, classId: target.id, from, until: end.until }],
      },
      groupMemberships: {
        cut: groupsCut,
        kept: kept.map((row) => ({ id: row.id, groupId: row.groupId })),
        written: covered.automatic.map((row) => ({
          id: row.id,
          groupId: row.groupId,
          from: row.from,
          until: row.until,
          cause: row.cause,
          review: row.review,
        })),
      },
    };
  }

  private async takeBackClassRoute(
    access: Access,
    moveId: string,
    version: number,
    cause: 'cancel' | 'undo',
    reason: string | null,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const studentId = await studentOfMove(transaction, branchId, moveId, 'class');
          const student = await this.lockStudent(transaction, studentId, version);
          const move = await lockMove(transaction, branchId, moveId, 'class');
          const today = await this.students.todayIn(transaction, branchId);
          if (cause === 'cancel' && moveState(move, today) !== 'scheduled') {
            throw new ApiException('move_not_scheduled', 409);
          }
          if (cause === 'undo' && !undoable(move, today, await undoFacts(transaction, studentId))) {
            throw new ApiException('move_not_undoable', 409);
          }
          const follow = await followJournal(transaction, studentId, move.effectiveOn);
          const taken = await this.takeBackClass(
            transaction,
            access,
            student,
            move,
            cause,
            reason,
            requestId,
          );
          const journal = await takeBackJournal(transaction, access, follow, move.id, cause);
          await this.record(
            transaction,
            access,
            studentId,
            cause === 'cancel'
              ? 'student.class_transfer_cancelled'
              : 'student.class_transfer_undone',
            { newValue: { ...taken, journal }, ...(reason === null ? {} : { reason }), requestId },
          );
          return this.students.readDetail(transaction, access, studentId);
        }),
      CLASS_MOVE_REFUSALS,
    );
  }

  /**
   * A class move taken back, by its cancel (before its date) or its undo
   * (begun): the row it wrote into the new class is withdrawn or emptied, the
   * group rows inside it of groups that do not draw from the old class with
   * it; the rows it cut come back from its date as new rows (as a leaving
   * taken back, 3.1b), cut at a scheduled leaving, with the group rows it cut
   * and the smallest suitable group for any day left (`coverClassRows`).
   */
  private async takeBackClass(
    transaction: Transaction,
    access: Access,
    student: PlacementStudent,
    move: StoredMove,
    cause: 'cancel' | 'undo',
    reason: string | null,
    requestId: string,
  ): Promise<Moved> {
    const from = move.effectiveOn;
    const fromClassId = move.fromClassId;
    const toClassId = move.toClassId;
    if (fromClassId === null || toClassId === null) {
      throw new Error('A class move names both classes.');
    }
    const target = student.memberships.find((row) => writtenBy(row, move.id));
    const cut = student.memberships
      .filter((row) => row.endedBy === 'transfer' && row.endedByMoveId === move.id)
      .sort((a, b) => (a.validFrom < b.validFrom ? -1 : a.validFrom > b.validFrom ? 1 : 0));
    const own = await groupMembershipsOf(transaction, student.id);
    await classesInService(transaction, [fromClassId, toClassId]);
    const groups = await lockClassGroups(
      transaction,
      [fromClassId],
      own.map((row) => row.groupId),
    );
    // A live group move inside the days the class move gave is changed or
    // cancelled first (spec review of the build, should-fix 2).
    const live = new Set(
      (await movesOf(transaction, student.id))
        .filter((one) => one.kind === 'group' && one.cancelledAt === null && one.undoneAt === null)
        .map((one) => one.id),
    );
    if (
      target !== undefined &&
      own.some(
        (row) =>
          holdsDays(row) &&
          row.validFrom >= target.validFrom &&
          row.validFrom < target.validUntil &&
          row.writtenByMoveId !== null &&
          row.cause === 'transfer' &&
          live.has(row.writtenByMoveId),
      )
    ) {
      throw new ApiException('move_scheduled', 409);
    }
    const moment = await transactionMoment(transaction);
    await transaction
      .updateTable('student_moves')
      .set(cause === 'cancel' ? { cancelled_at: moment } : { undone_at: moment, reason })
      .where('id', '=', move.id)
      .execute();
    const emptied: { id: string; groupId?: string; classId?: string; was: SchoolDate }[] = [];
    if (target !== undefined && holdsDays(target)) {
      await transaction
        .updateTable('class_memberships')
        .set(
          cause === 'cancel'
            ? { valid_until: target.validFrom, ended_by: 'withdrawn', leaving_id: null }
            : {
                valid_until: target.validFrom,
                ended_by: 'undone',
                leaving_id: null,
                ended_by_move_id: move.id,
              },
        )
        .where('id', '=', target.id)
        .execute();
      emptied.push({ id: target.id, classId: target.classId, was: target.validUntil });
      const back = fromClassId.toLowerCase();
      for (const row of own) {
        const inTarget =
          holdsDays(row) && row.validFrom < target.validUntil && row.validUntil > target.validFrom;
        if (!inTarget || groups.get(row.groupId.toLowerCase())?.classIds.has(back) === true) {
          continue;
        }
        // The undo rule refused a row the move did not write (decision 10);
        // a cancel finds only rows that have not begun.
        const mine = writtenBy(row, move.id);
        await transaction
          .updateTable('group_memberships')
          .set(
            cause === 'undo'
              ? {
                  valid_until: row.validFrom,
                  ended_by: 'undone',
                  leaving_id: null,
                  ended_by_move_id: move.id,
                }
              : {
                  valid_until: row.validFrom,
                  ended_by: mine ? 'withdrawn' : 'class_withdrawn',
                  leaving_id: null,
                  ended_by_move_id: null,
                },
          )
          .where('id', '=', row.id)
          .execute();
        emptied.push({ id: row.id, groupId: row.groupId, was: row.validUntil });
      }
    }
    // The rows the move cut grow back from its date (task 3.5c, decision 1),
    // each to its own end or to the start of the next one given back, which
    // a later move wrote (`.claude/rules/database.md`); cut at a scheduled
    // leaving.
    const given = cut
      .map((row) => ({ row, start: later(from, row.validFrom) }))
      .filter(({ row, start }) => start < row.ownUntil);
    const classRows: { index: number; row: ClassRowToCover }[] = [];
    const written: { id: string; classId: string; from: SchoolDate; until: SchoolDate }[] = [];
    let leave: { from: SchoolDate; leavingId: string } | null = null;
    for (let index = 0; index < given.length; index += 1) {
      const one = given[index];
      if (one === undefined) {
        break;
      }
      const { row, start } = one;
      // A continuation of the same stay written before 0062 stays emptied;
      // this row grows over its days (spec review of the build, must-fix 2).
      let after = index + 1;
      while (given[after] !== undefined && continuesStay(row, given[after]?.row)) {
        after += 1;
      }
      index = after - 1;
      const next = given[after];
      const stopsAtMove = next !== undefined && next.start < row.ownUntil;
      const ownEnd = stopsAtMove ? next.start : row.ownUntil;
      const end = placementEnd(student.statuses, student.startsOn, start, ownEnd);
      if ('refusal' in end) {
        throw new ApiException(end.refusal, 409);
      }
      if (end.leavingId !== null) {
        leave = { from: end.until, leavingId: end.leavingId };
      }
      const byMove = end.leavingId === null && stopsAtMove ? next.row.writtenByMoveId : null;
      if (end.leavingId === null && stopsAtMove && byMove === null) {
        throw new Error('A row given back meets the next one only at a move.');
      }
      await transaction
        .updateTable('class_memberships')
        .set({
          valid_until: end.until,
          ended_by: end.leavingId !== null ? 'leaving' : byMove !== null ? 'transfer' : null,
          leaving_id: end.leavingId,
          ended_by_move_id: byMove,
        })
        .where('id', '=', row.id)
        .execute();
      written.push({ id: row.id, classId: row.classId, from: start, until: end.until });
      classRows.push({
        index: 0,
        row: {
          studentId: student.id,
          classId: row.classId,
          from: start,
          until: end.until,
          ownUntil: row.ownUntil,
          leavingId: end.leavingId,
          endedByMoveId: byMove,
        },
      });
    }
    const covered = await coverClassRows(
      transaction,
      this.audit,
      access,
      {
        classRows,
        giveBack: {
          studentId: student.id,
          takenBack: { leavingId: null, moveId: move.id, from },
          leave,
          cause,
        },
        groups,
        pathOf: () => '',
      },
      requestId,
    );
    return {
      moveId: move.id,
      from,
      fromClassId,
      toClassId,
      memberships: {
        emptied: emptied.filter((one) => one.classId !== undefined),
        given: written,
      },
      groupMemberships: {
        emptied: emptied.filter((one) => one.groupId !== undefined),
        written: covered.written.map((row) => ({
          id: row.id,
          groupId: row.groupId,
          from: row.from,
          until: row.until,
          cause: row.cause,
          review: row.review,
        })),
      },
    };
  }

  /**
   * The two groups of a group move, of the branch, and the scope of the
   * reader on them (decision 2): the assignment whose scope fits both, which
   * the audit entry names (`.claude/rules/api.md`; permission review of the
   * build, should-fix 1); 403 when none fits.
   */
  private async groupScope(
    transaction: Transaction,
    access: Access,
    move: StoredMove,
  ): Promise<string> {
    const ids = [move.fromGroupId, move.toGroupId].filter((id): id is string => id !== null);
    return scopeOf(access, await this.readGroups(transaction, branchOf(access), ids));
  }

  /** Groups of the branch of the request by id; an unknown id or another branch's is 404. */
  private async readGroups(
    transaction: Transaction,
    branchId: string,
    ids: readonly string[],
  ): Promise<MoveGroupRow[]> {
    const unique = [...new Set(ids.map((id) => id.toLowerCase()))];
    const rows = await transaction
      .selectFrom('groups')
      .select(['id', 'branch_id', 'subject_id'])
      .where('id', 'in', unique)
      .where('branch_id', '=', branchId)
      .execute();
    if (rows.length !== unique.length) {
      throw notFound();
    }
    const classes = await classesOfGroups(
      transaction,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      subjectId: row.subject_id,
      classIds: (classes.get(row.id) ?? []).map((one) => one.id.toLowerCase()),
    }));
  }

  /**
   * The group move itself, after the student is locked: the group row that
   * holds `from` ends there, the new row in the other group of the same
   * subject runs to where the old one ran, ended as it was (a scheduled
   * leaving or class move, correction 1). The new group must draw from the
   * student's class over those days (0048, at the commit).
   */
  private async moveGroup(
    transaction: Transaction,
    access: Access,
    student: PlacementStudent,
    today: SchoolDate,
    input: {
      row: StoredGroupMembership;
      toGroupId: string;
      from: SchoolDate;
      seen: boolean;
      /** The cancelled move a change replaces (task 3.5c, H34). */
      replacesMoveId?: string;
    },
  ): Promise<Moved & { assignmentId: string }> {
    const branchId = branchOf(access);
    const { row, from } = input;
    const [source, target] = await this.readGroupPair(
      transaction,
      branchId,
      row.groupId,
      input.toGroupId,
    );
    const assignmentId = scopeOf(access, [source, target]);
    if (source.subjectId !== target.subjectId) {
      throw new ApiException('group_transfer_subject', 409);
    }
    const pastAssignmentId = this.pastAllowed(access, from, today);
    await refuseBranchMove(transaction, branchOf(access), student.id, from);
    if (!(holdsDays(row) && row.validFrom <= from && from < row.validUntil)) {
      // The row the person saw no longer holds the date (decision 6).
      throw new ApiException(input.seen ? 'student_changed' : 'move_no_membership', 409);
    }
    if (source.id.toLowerCase() === target.id.toLowerCase()) {
      throw new ApiException('move_same_target', 409);
    }
    const moves = await movesOf(transaction, student.id);
    if (
      moves.some(
        (move) =>
          move.kind === 'group' &&
          move.subjectId === source.subjectId &&
          moveState(move, today) === 'scheduled',
      )
    ) {
      throw new ApiException('move_scheduled', 409);
    }
    if (
      moves.some(
        (move) =>
          move.kind === 'group' &&
          move.subjectId === source.subjectId &&
          moveState(move, today) === 'done' &&
          move.effectiveOn > from,
      )
    ) {
      throw new ApiException('move_before_later', 409);
    }
    await lockGroups(transaction, [source.id, target.id]);
    const classes = new Set(target.classIds);
    const inClass = student.memberships.some(
      (one) =>
        holdsDays(one) &&
        one.validFrom <= from &&
        from < one.validUntil &&
        classes.has(one.classId.toLowerCase()),
    );
    if (!inClass) {
      throw new ApiException('student_not_in_group_class', 409);
    }
    const moveId = await this.insertMove(transaction, branchId, student.id, {
      kind: 'group',
      subject_id: source.subjectId,
      from_group_id: source.id,
      to_group_id: target.id,
      effective_on: from,
      replaces_move_id: input.replacesMoveId ?? null,
    });
    await this.cutGroupRow(transaction, row, from, moveId);
    const written = await transaction
      .insertInto('group_memberships')
      .values({
        branch_id: branchId,
        student_id: student.id,
        group_id: target.id,
        subject_id: target.subjectId,
        valid_from: from,
        valid_until: row.validUntil,
        own_until: row.ownUntil,
        cause: 'transfer',
        review: false,
        ...endOf(row),
        written_by_move_id: moveId,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return {
      assignmentId,
      moveId,
      subjectId: source.subjectId,
      fromGroupId: source.id,
      toGroupId: target.id,
      from,
      ...(pastAssignmentId === null ? {} : { pastAssignmentId }),
      groupMemberships: {
        cut: [
          {
            id: row.id,
            groupId: row.groupId,
            from: row.validFrom,
            until: from,
            was: row.validUntil,
          },
        ],
        written: [{ id: written.id, groupId: target.id, from, until: row.validUntil }],
      },
    };
  }

  /** The two groups of a move, of the branch (404 otherwise), in the order asked. */
  private async readGroupPair(
    transaction: Transaction,
    branchId: string,
    sourceId: string,
    targetId: string,
  ): Promise<[MoveGroupRow, MoveGroupRow]> {
    const groups = await this.readGroups(transaction, branchId, [sourceId, targetId]);
    const source = groups.find((one) => one.id.toLowerCase() === sourceId.toLowerCase());
    const target = groups.find((one) => one.id.toLowerCase() === targetId.toLowerCase());
    if (source === undefined || target === undefined) {
      throw notFound();
    }
    return [source, target];
  }

  private async takeBackGroupRoute(
    access: Access,
    moveId: string,
    cause: 'cancel' | 'undo',
    reason: string | null,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const studentId = await studentOfMove(transaction, branchId, moveId, 'group');
          const student = await this.lockStudent(transaction, studentId, null);
          const move = await lockMove(transaction, branchId, moveId, 'group');
          const assignmentId = await this.groupScope(transaction, access, move);
          const today = await this.students.todayIn(transaction, branchId);
          if (cause === 'cancel' && moveState(move, today) !== 'scheduled') {
            throw new ApiException('move_not_scheduled', 409);
          }
          if (cause === 'undo' && !undoable(move, today, await undoFacts(transaction, studentId))) {
            throw new ApiException('move_not_undoable', 409);
          }
          const follow = await followJournal(transaction, studentId, move.effectiveOn);
          const taken = await this.takeBackGroup(transaction, student, move, cause, reason);
          const journal = await takeBackJournal(transaction, access, follow, move.id, cause);
          await this.record(
            transaction,
            access,
            studentId,
            cause === 'cancel'
              ? 'student.group_transfer_cancelled'
              : 'student.group_transfer_undone',
            {
              newValue: { ...taken, journal },
              ...(reason === null ? {} : { reason }),
              requestId,
              assignmentId,
            },
          );
          return this.students.readDetail(transaction, access, studentId);
        }),
      GROUP_MOVE_REFUSALS,
    );
  }

  /**
   * A group move taken back: the row it wrote is withdrawn (a cancel) or
   * emptied (an undo), and the row it cut comes back from its date in the old
   * group, ended as the row it wrote was. The old group must have a seat and
   * be in service (its guard refuses otherwise).
   */
  private async takeBackGroup(
    transaction: Transaction,
    student: PlacementStudent,
    move: StoredMove,
    cause: 'cancel' | 'undo',
    reason: string | null,
  ): Promise<Moved> {
    const fromGroupId = move.fromGroupId;
    const toGroupId = move.toGroupId;
    if (fromGroupId === null || toGroupId === null || move.subjectId === null) {
      throw new Error('A group move names both groups and its subject.');
    }
    const rows = await groupMembershipsOf(transaction, student.id);
    const target = rows.find((row) => writtenBy(row, move.id));
    if (target === undefined) {
      throw new Error('A group move wrote a row.');
    }
    await lockGroups(transaction, [fromGroupId, toGroupId]);
    const moment = await transactionMoment(transaction);
    await transaction
      .updateTable('student_moves')
      .set(cause === 'cancel' ? { cancelled_at: moment } : { undone_at: moment, reason })
      .where('id', '=', move.id)
      .execute();
    await transaction
      .updateTable('group_memberships')
      .set(
        cause === 'cancel'
          ? {
              valid_until: target.validFrom,
              ended_by: 'withdrawn',
              leaving_id: null,
              ended_by_move_id: null,
            }
          : {
              valid_until: target.validFrom,
              ended_by: 'undone',
              leaving_id: null,
              ended_by_move_id: move.id,
            },
      )
      .where('id', '=', target.id)
      .execute();
    // Task 3.5c (decision 1): the row the move cut grows back over the days
    // the target held, ended as the target was (H36: "a cancel or an undo
    // gives the stay back as it was before").
    const old = rows.find(
      (row) =>
        row.endedBy === 'transfer' && row.endedByMoveId === move.id && row.groupId === fromGroupId,
    );
    const given =
      holdsDays(target) && old !== undefined && old.validUntil === target.validFrom
        ? old
        : undefined;
    if (given !== undefined) {
      await transaction
        .updateTable('group_memberships')
        .set({ valid_until: target.validUntil, ...endOf(target) })
        .where('id', '=', given.id)
        .execute();
    }
    return {
      moveId: move.id,
      from: move.effectiveOn,
      subjectId: move.subjectId,
      fromGroupId,
      toGroupId,
      groupMemberships: {
        emptied: [{ id: target.id, groupId: toGroupId, was: target.validUntil }],
        // The days the target held that no row came back over (the row the
        // move cut no longer ends where the target begins): named, as every
        // path that cannot give rows back names them (spec review of the
        // build, should-fix 3).
        notGiven:
          given === undefined && holdsDays(target)
            ? [{ groupId: fromGroupId, from: target.validFrom, until: target.validUntil }]
            : [],
        given:
          given === undefined
            ? []
            : [
                {
                  id: given.id,
                  groupId: fromGroupId,
                  from: target.validFrom,
                  until: target.validUntil,
                },
              ],
      },
    };
  }

  private async insertMove(
    transaction: Transaction,
    branchId: string,
    studentId: string,
    values: {
      kind: 'class' | 'group';
      subject_id?: string;
      from_class_id?: string;
      to_class_id?: string;
      from_group_id?: string;
      to_group_id?: string;
      effective_on: SchoolDate;
      replaces_move_id?: string | null;
    },
  ): Promise<string> {
    const row = await transaction
      .insertInto('student_moves')
      .values({
        branch_id: branchId,
        student_id: studentId,
        made_at: await transactionMoment(transaction),
        ...values,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    return row.id;
  }

  /** A class row a move ends at `until`, naming the move (0050). */
  private async cutClassRow(
    transaction: Transaction,
    row: StoredMembership,
    until: SchoolDate,
    moveId: string,
  ): Promise<void> {
    await transaction
      .updateTable('class_memberships')
      .set({ valid_until: until, ended_by: 'transfer', leaving_id: null, ended_by_move_id: moveId })
      .where('id', '=', row.id)
      .execute();
  }

  /** A group row a move ends at `until`, naming the move (0050). */
  private async cutGroupRow(
    transaction: Transaction,
    row: StoredGroupMembership,
    until: SchoolDate,
    moveId: string,
  ): Promise<void> {
    await transaction
      .updateTable('group_memberships')
      .set({ valid_until: until, ended_by: 'transfer', leaving_id: null, ended_by_move_id: moveId })
      .where('id', '=', row.id)
      .execute();
  }
}

/**
 * Task 3.3c (decision 11): a class or group move waits for an open release
 * of the student to another branch; nothing is dated before the student's
 * move into this branch (decision 12).
 */
async function refuseBranchMove(
  transaction: Transaction,
  branchId: string,
  studentId: string,
  from: SchoolDate,
): Promise<void> {
  const moves = await branchMovesOf(transaction, studentId, branchId);
  if (moves.some((move) => branchMoveState(move) === 'open')) {
    throw new ApiException('branch_move_open', 409);
  }
  const arrived = arrivedOn(moves, branchId);
  if (arrived !== undefined && from < arrived) {
    throw new ApiException('before_branch_move', 409);
  }
}

/** The assignment whose scope fits every group of a move (decision 2); 403 when none does. */
function scopeOf(access: Access, groups: readonly MoveGroupRow[]): string {
  const fitting = access.permitting.find((assignment) =>
    groups.every((group) => inGroupScope([assignment], group) !== undefined),
  );
  if (fitting === undefined) {
    throw new ApiException('permission_denied', 403);
  }
  return fitting.id;
}

/**
 * The end of a row written in place of another over the same days: ended as
 * that one was, by a scheduled leaving or a scheduled class move (correction
 * 1), or at its own end.
 */
function endOf(row: StoredGroupMembership): {
  ended_by: 'leaving' | 'transfer' | null;
  leaving_id: string | null;
  ended_by_move_id: string | null;
} {
  if (row.endedBy === 'leaving') {
    return { ended_by: 'leaving', leaving_id: row.leavingId, ended_by_move_id: null };
  }
  if (row.endedBy === 'transfer') {
    return { ended_by: 'transfer', leaving_id: null, ended_by_move_id: row.endedByMoveId };
  }
  return { ended_by: null, leaving_id: null, ended_by_move_id: null };
}

/**
 * The journal side of a move (task 8.6, pull request #224; edge, the 11:00
 * and a week late rows): the entries of the journals left on or after its
 * date are refused for a move dated today, and voided with the reason given
 * for a move dated before it; the held lessons of the journals joined open as
 * optional cells (decision 10).
 */
async function settleMove(
  transaction: Transaction,
  access: Access,
  follow: JournalFollow,
  moveId: string,
  today: SchoolDate,
  input: { from: SchoolDate; journalEntries?: JournalEntriesChoice | undefined },
): Promise<JournalEffects> {
  return settle(transaction, follow, {
    source: { moveId },
    actorId: access.accountId,
    choice: input.journalEntries,
    voidable: input.from < today,
    opensOptional: input.from <= today,
  });
}

/**
 * The journal side of a move taken back (decision 12): an undo is refused
 * while the journals the move wrote rows for hold entries of the student on
 * or after its date (edge, the mistake row); a cancel or an undo gives back
 * what the move voided and withdraws its optional cells.
 */
async function takeBackJournal(
  transaction: Transaction,
  access: Access,
  follow: JournalFollow,
  moveId: string,
  cause: 'cancel' | 'undo',
): Promise<JournalGiveBack> {
  if (cause === 'undo') {
    await refuseEntriesLeftByUndo(transaction, follow);
  }
  return giveBack(transaction, {
    studentId: follow.studentId,
    source: { moveId },
    actorId: access.accountId,
  });
}
