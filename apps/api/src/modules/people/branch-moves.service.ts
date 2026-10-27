import { Injectable } from '@nestjs/common';
import { exemptionsFollowBranchMove } from '../journal/exemption-follow.js';
import { followJournal, settle } from '../journal/journal-entries.js';
import { Notifications } from '../notifications/notifications.service.js';
import {
  PERMISSIONS,
  type AuditAction,
  type BranchMoveAccept,
  type BranchMoveDecline,
  type BranchMoveGroups,
  type BranchMoveRelease,
  type BranchMoveTargets,
  type ErrorCode,
  type IncomingBranchMoves,
  type SchoolDate,
  type StudentDetail,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import { decide } from '../access/permission-check.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import {
  CLASS_GROUP_REFUSALS,
  coverClassRows,
  groupSubjectRuns,
  lockClassGroups,
  runsWithin,
  SeatBook,
  smallestGroup,
  type CoverGroup,
} from '../classes/class-groups.js';
import {
  classesInService,
  MEMBERSHIP_REFUSALS,
  membersPeak,
} from '../classes/class-membership-rows.js';
import {
  lockPlacementStudents,
  planPlacement,
  readPlacementClass,
  writePlacement,
  type PlacementClass,
  type PlacementStudent,
} from '../classes/class-placement.js';
import {
  CLASS_PATH_GROUP_REFUSALS,
  GROUP_MEMBERSHIP_REFUSALS,
  groupMembershipsOf,
  groupMembersPeak,
} from '../classes/group-membership-rows.js';
import { holdsDays } from '../classes/membership-plan.js';
import { MOVE_REFUSALS, moveState, movesOf } from '../classes/student-moves.js';
import { lockOpenQuarters } from '../setup/closed-quarters.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import {
  arrivedOn,
  BRANCH_MOVE_REFUSALS,
  branchMoveState,
  branchMovesOf,
  branchNames,
  lockBranchMove,
} from './branch-moves.js';
import { Students } from './students.service.js';

/** Plain data for an audit entry: dates as text, no class instances. */
const asJson = (value: unknown): JsonValue => JSON.parse(JSON.stringify(value)) as JsonValue;

const later = (a: SchoolDate, b: SchoolDate): SchoolDate => (a > b ? a : b);

function branchOf(access: Access): string {
  if (access.branchId === null) {
    throw new Error('A branch move works for the branch of the request.');
  }
  return access.branchId;
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/** The refusals of an accept: the class rows, the group rows, the groups of the class, the moves and the branch move. */
const ACCEPT_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...MEMBERSHIP_REFUSALS,
  ...CLASS_PATH_GROUP_REFUSALS,
  ...GROUP_MEMBERSHIP_REFUSALS,
  ...CLASS_GROUP_REFUSALS,
  ...MOVE_REFUSALS,
  ...BRANCH_MOVE_REFUSALS,
  // Task 9.2b (From 3.3c, pull request #97, decision 9): the accept cuts the sending branch's
  // rows and writes the receiving branch's from the date; a closed quarter refuses both (0133).
  quarters_closed: 'branch_move_quarter_closed',
};

/**
 * The checks a release makes, and the accept again (decision 11): the student
 * is active on the date with no leaving or graduation after it; no class or
 * group move is scheduled, nor begun on or after the date; nothing is dated
 * before the student's arrival in this branch (decision 12).
 */
function refuseUnmovable(
  student: PlacementStudent,
  moves: Awaited<ReturnType<typeof movesOf>>,
  today: SchoolDate,
  from: SchoolDate,
  arrived: SchoolDate | undefined,
): void {
  if (arrived !== undefined && from < arrived) {
    throw new ApiException('before_branch_move', 409);
  }
  const rows = student.statuses.filter((row) => row.validFrom !== row.validUntil);
  const holding = rows.find(
    (row) => row.validFrom <= from && (row.validUntil === null || from < row.validUntil),
  );
  if (holding?.status !== 'active') {
    throw new ApiException('student_not_active', 409);
  }
  if (holding.validUntil !== null || rows.some((row) => row.validFrom > from)) {
    throw new ApiException('status_scheduled', 409);
  }
  const live = moves.filter((move) => {
    const state = moveState(move, today);
    return state === 'scheduled' || state === 'done';
  });
  if (live.some((move) => moveState(move, today) === 'scheduled')) {
    throw new ApiException('move_scheduled', 409);
  }
  if (live.some((move) => move.effectiveOn >= from)) {
    throw new ApiException('move_before_later', 409);
  }
}

/**
 * The move of a student to another branch (`edge/students-classes-groups`,
 * "A student moves to another branch"; task 3.3c, pull request #97). The
 * sending branch releases from a date and cancels while open; the receiving
 * branch accepts from that date on, choosing the class and the groups, or
 * declines with a reason; the Super Admin does both, each in the branch of
 * the request.
 *
 * Lock order on every path (must-fix 3 of the plan review): the student FOR
 * UPDATE, the release FOR UPDATE, the classes FOR UPDATE by id, the groups
 * FOR UPDATE by id, then the writes. The leaving that cancels a release takes
 * the student first too. Every id of the path, query and body is compared
 * with the branch of the request (must-fix 6): after the join of an accept
 * the filter shows the sending branch too.
 */
@Injectable()
export class BranchMoves {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
    private readonly students: Students,
    private readonly notifications: Notifications,
  ) {}

  /** The release of a student of the branch of the request (decisions 9 and 11). */
  release(
    access: Access,
    studentId: string,
    input: BranchMoveRelease,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // Task 9.2b (From 3.3c, pull request #97, decision 9): a release dated in a closed
          // quarter is refused; one dated after it is taken. The ids that answer 404 first, read
          // without a lock (`.claude/rules/api.md`), then the quarters of the sending branch
          // from the date on, in a statement of their own before the student
          // (`.claude/rules/database.md`; review correction 3).
          const seen = await transaction
            .selectFrom('students')
            .select('branch_id')
            .where('id', '=', studentId)
            .executeTakeFirst();
          const named = await transaction
            .selectFrom('branches')
            .select('id')
            .where('id', '=', input.toBranchId)
            .executeTakeFirst();
          if (seen === undefined || !same(seen.branch_id, branchId) || named === undefined) {
            throw notFound();
          }
          await lockOpenQuarters(
            transaction,
            branchId,
            input.from,
            null,
            'branch_move_quarter_closed',
          );
          await this.lockStudentOf(transaction, studentId, branchId);
          const student = await this.placementStudent(transaction, studentId);
          if (student.version !== input.version) {
            throw new ApiException('student_changed', 409);
          }
          const target = await transaction
            .selectFrom('branches')
            .select('id')
            .where('id', '=', input.toBranchId)
            .executeTakeFirst();
          if (target === undefined) {
            throw notFound();
          }
          if (same(target.id, branchId)) {
            throw new ApiException('branch_move_same_branch', 409);
          }
          const today = await this.students.todayIn(transaction, branchId);
          await this.refuseClosedYear(transaction, branchId, input.from);
          const branchMoves = await branchMovesOf(transaction, studentId, branchId);
          if (branchMoves.some((move) => branchMoveState(move) === 'open')) {
            throw new ApiException('branch_move_open', 409);
          }
          refuseUnmovable(
            student,
            await movesOf(transaction, studentId, branchId),
            today,
            input.from,
            arrivedOn(branchMoves, branchId),
          );
          const row = await transaction
            .insertInto('student_branch_moves')
            .values({
              branch_id: branchId,
              student_id: studentId,
              from_branch_id: branchId,
              to_branch_id: target.id,
              effective_on: input.from,
              released_at: await transactionMoment(transaction),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          await this.record(transaction, access, branchId, studentId, 'student.branch_released', {
            newValue: { branchMoveId: row.id, toBranchId: target.id, from: input.from },
            requestId,
          });
          return this.students.readDetail(transaction, access, studentId);
        }),
      BRANCH_MOVE_REFUSALS,
    );
  }

  /** The cancel of an open release by the sending branch. */
  cancel(access: Access, moveId: string, requestId: string): Promise<StudentDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const found = await transaction
            .selectFrom('student_branch_moves')
            .select('student_id')
            .where('id', '=', moveId)
            .where('branch_id', '=', branchId)
            // The sending side (permission review, should-fix 3).
            .where('from_branch_id', '=', branchId)
            .executeTakeFirst();
          if (found === undefined) {
            throw notFound();
          }
          await this.lockStudentOf(transaction, found.student_id, branchId);
          const move = await lockBranchMove(transaction, moveId);
          if (
            move === undefined ||
            !same(move.branchId, branchId) ||
            !same(move.fromBranchId, branchId)
          ) {
            throw notFound();
          }
          if (branchMoveState(move) !== 'open') {
            throw new ApiException('branch_move_closed', 409);
          }
          await transaction
            .updateTable('student_branch_moves')
            .set({ cancelled_at: await transactionMoment(transaction) })
            .where('id', '=', moveId)
            .execute();
          await this.record(
            transaction,
            access,
            branchId,
            move.studentId,
            'student.branch_release_cancelled',
            {
              newValue: {
                branchMoveId: moveId,
                toBranchId: move.toBranchId,
                from: move.effectiveOn,
              },
              requestId,
            },
          );
          return this.students.readDetail(transaction, access, move.studentId);
        }),
      BRANCH_MOVE_REFUSALS,
    );
  }

  /**
   * The branches a student may be released to: every other branch, by name
   * (the branches are school-wide; the release form's choice). A route of
   * its own: the list of branches is the Super Admin's.
   */
  targets(access: Access): Promise<BranchMoveTargets> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await transaction
        .selectFrom('branches')
        .select(['id', 'name'])
        .where('id', '<>', branchId)
        .orderBy('name')
        .orderBy('id')
        .execute();
      return { branches: rows };
    });
  }

  /** The releases to the branch of the request (decision 2). */
  incoming(access: Access): Promise<IncomingBranchMoves> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, (transaction) =>
      this.readIncoming(transaction, access, branchId),
    );
  }

  /**
   * The groups offered to the accept for a class of the branch of the
   * request: per split or group subject of the class, the groups that draw
   * from it with their free seats from the release's date, and the smallest
   * suitable one. The release is read through `branch_move_sending`, without
   * a join (should-fix 1 of the plan review).
   */
  groups(access: Access, moveId: string, classId: string): Promise<BranchMoveGroups> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await sql<{ effective_on: string }>`
        select effective_on::text as effective_on from branch_move_sending(${moveId}::uuid, ${branchId}::uuid)
      `.execute(transaction);
      const release = found.rows[0];
      if (release === undefined) {
        throw notFound();
      }
      const target = await this.classOfBranch(transaction, classId, branchId);
      const from = release.effective_on;
      const groups = await this.readGroups(transaction, target.id);
      const book = new SeatBook(transaction);
      const range = { from, until: target.ownUntil };
      const subjects = [];
      for (const [subjectId, stretches] of await this.stretchesOf(transaction, target.id, range)) {
        const offered = this.offered(groups, stretches, subjectId);
        const options = [];
        for (const group of offered) {
          const peak = await groupMembersPeak(transaction, group.id, from, target.ownUntil);
          options.push({ id: group.id, name: group.name, freeSeats: group.maxSize - peak });
        }
        const best = await smallestGroup(book, offered, range);
        subjects.push({
          subjectId,
          groups: options.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id)),
          suggested: best?.id ?? null,
        });
      }
      const peak = await membersPeak(transaction, target.id, from, target.ownUntil);
      return { subjects, freeSeats: target.maxSize - peak };
    });
  }

  /**
   * The accept (decisions 1, 6, 11, 13 and 15), all or none: the sending
   * branch joined; the student and the release locked and checked again;
   * the class and its groups locked; the release accepted; the old branch's
   * class and group rows cut at the date (`branch_move`); the branch of the
   * student changed, which the keys carry to its rows; the class row from the
   * date, the groups chosen, then the smallest suitable group for every other
   * split or group subject. One entry in each branch's log. The record is
   * read afterwards in a transaction of the request's branches alone.
   */
  async accept(
    access: Access,
    moveId: string,
    input: BranchMoveAccept,
    requestId: string,
  ): Promise<StudentDetail> {
    const branchId = branchOf(access);
    const studentId = await refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          // The ids of the body first, while the filter is the request's
          // (permission review, should-fix 2); then the join.
          const target = await this.classOfBranch(transaction, input.classId, branchId);
          const chosenIds = input.groups.map((group) => group.groupId);
          if (chosenIds.length > 0) {
            const known = await transaction
              .selectFrom('groups')
              .select('id')
              .where('id', 'in', chosenIds)
              .where('branch_id', '=', branchId)
              .execute();
            if (known.length !== new Set(chosenIds.map((id) => id.toLowerCase())).size) {
              throw notFound();
            }
            // A subject is one record of the school: an unknown one is not found (task 10.3b).
            const subjectIds = [...new Set(input.groups.map((one) => one.subjectId.toLowerCase()))];
            const subjects = await transaction
              .selectFrom('subjects')
              .select('id')
              .where('id', 'in', subjectIds)
              .execute();
            if (subjects.length !== subjectIds.length) {
              throw notFound();
            }
          }
          const sending = await this.transactions.joinSendingBranch(transaction, moveId, branchId);
          if (sending === undefined) {
            throw notFound();
          }
          // Task 9.2b (From 3.3c, pull request #97, decision 9; plan decision 12): the accept of a
          // release dated in a closed quarter is refused, also when the quarter was closed after
          // the release. The accept ends the sending branch's class and group rows from the
          // date and writes the receiving branch's from it, so the quarters of both branches
          // from the date on are locked, the sending branch's first, each in a statement of its
          // own before the student (`.claude/rules/database.md`; review correction 3); the
          // guards of 0133 on those rows refuse again (`ACCEPT_REFUSALS`).
          for (const branch of [sending.fromBranchId, branchId]) {
            await lockOpenQuarters(
              transaction,
              branch,
              sending.effectiveOn,
              null,
              'branch_move_quarter_closed',
            );
          }
          // The student FOR UPDATE first, then the release: a change that came
          // first (an accept, a cancel, a leaving) leaves the release closed.
          await this.lockStudent(transaction, sending.studentId);
          const move = await lockBranchMove(transaction, moveId);
          if (
            move === undefined ||
            branchMoveState(move) !== 'open' ||
            !same(move.toBranchId, branchId)
          ) {
            throw new ApiException('branch_move_closed', 409);
          }
          const today = await this.students.todayIn(transaction, branchId);
          const from = move.effectiveOn;
          if (today < from) {
            throw new ApiException('branch_move_not_yet', 409);
          }
          // Task 8.6: the journal entries of both branches are locked and read
          // before the rows are cut (`journal-entries.ts`).
          const follow = await followJournal(transaction, move.studentId, from);
          const student = await this.placementStudent(transaction, move.studentId);
          refuseUnmovable(
            student,
            await movesOf(transaction, move.studentId, move.fromBranchId),
            await this.students.todayIn(transaction, move.fromBranchId),
            from,
            arrivedOn(
              await branchMovesOf(transaction, move.studentId, move.fromBranchId),
              move.fromBranchId,
            ),
          );
          // The class row of the old branch on the date, if any: the language
          // is asked against it (decision 15).
          const held = student.memberships.find(
            (row) => holdsDays(row) && row.validFrom <= from && from < row.validUntil,
          );
          await classesInService(
            transaction,
            held === undefined ? [target.id] : [held.classId, target.id],
          );
          // Read again after its lock (spec review of the build, should-fix 1):
          // archived, its year closed or its size changed meanwhile.
          const locked = await this.classOfBranch(transaction, target.id, branchId);
          const languages = await transaction
            .selectFrom('classes')
            .select(['id', 'language'])
            .where('id', 'in', held === undefined ? [target.id] : [held.classId, target.id])
            .execute();
          const languageOf = (id: string) => languages.find((one) => same(one.id, id))?.language;
          const languageDiffers =
            held !== undefined && languageOf(held.classId) !== languageOf(target.id);
          if (languageDiffers && input.confirmLanguage !== true) {
            throw new ApiException('branch_move_language_differs', 409);
          }
          const own = await groupMembershipsOf(transaction, move.studentId);
          const groups = await lockClassGroups(
            transaction,
            [target.id],
            [...own.map((row) => row.groupId), ...chosenIds],
          );
          await transaction
            .updateTable('student_branch_moves')
            .set({ accepted_at: await transactionMoment(transaction) })
            .where('id', '=', moveId)
            .execute();
          // The rows of the old branch with days from the date on end there;
          // a planned row after it is emptied (correction 1).
          const classesCut = student.memberships.filter(
            (row) => holdsDays(row) && row.validUntil > from,
          );
          for (const row of classesCut) {
            await transaction
              .updateTable('class_memberships')
              .set({
                valid_until: later(row.validFrom, from),
                ended_by: 'branch_move',
                leaving_id: null,
                ended_by_branch_move_id: moveId,
              })
              .where('id', '=', row.id)
              .execute();
          }
          const groupsCut = own.filter((row) => holdsDays(row) && row.validUntil > from);
          for (const row of groupsCut) {
            await transaction
              .updateTable('group_memberships')
              .set({
                valid_until: later(row.validFrom, from),
                ended_by: 'branch_move',
                leaving_id: null,
                ended_by_branch_move_id: moveId,
              })
              .where('id', '=', row.id)
              .execute();
          }
          // Task 8.5 (decision 3): the exemptions of the sending branch end there and are offered.
          await exemptionsFollowBranchMove(
            transaction,
            this.audit,
            this.notifications,
            { branchId, actorId: access.accountId, assignmentId: access.assignmentId, requestId },
            { moveId, studentId: move.studentId, fromBranchId: move.fromBranchId, from },
          );
          await transaction
            .updateTable('students')
            .set({ branch_id: branchId })
            .where('id', '=', move.studentId)
            .execute();
          const moved = await this.placementStudent(transaction, move.studentId);
          const rows = await planPlacement(
            transaction,
            locked,
            [{ student: moved, version: null }],
            from,
          );
          const [membershipId] = await writePlacement(
            transaction,
            this.audit,
            access,
            locked,
            rows,
            'branch_move',
            requestId,
          );
          const row = rows[0];
          if (row === undefined || membershipId === undefined) {
            throw new Error('The placement of an accept writes one row.');
          }
          const chosen = await this.writeChosen(transaction, groups, locked, input, {
            studentId: move.studentId,
            from: row.from,
            until: row.until,
            leavingId: row.leavingId,
          });
          const covered = await coverClassRows(
            transaction,
            this.audit,
            access,
            {
              classRows: [
                {
                  index: 0,
                  row: {
                    studentId: move.studentId,
                    classId: locked.id,
                    from: row.from,
                    until: row.until,
                    ownUntil: locked.ownUntil,
                    leavingId: row.leavingId,
                  },
                },
              ],
              giveBack: null,
              groups,
              pathOf: () => 'groups',
            },
            requestId,
          );
          // Task 8.6 (From 3.3c, decisions 6 and 19: "a late accept cuts the old
          // branch's class and group rows back to the date: the entries of the old
          // journals on or after the date are listed as for a late transfer (moved
          // past or voided with a reason)"): voided with the reason given, also on the
          // date itself, since the accept cannot move the date the release set
          // (decision 15, Look first: the accepting branch reads and voids them); the
          // new branch's held lessons open as optional.
          const journal = await settle(transaction, follow, {
            source: { branchMoveId: moveId },
            actorId: access.accountId,
            choice: input.journalEntries,
            voidable: true,
            opensOptional: true,
          });
          await this.record(
            transaction,
            access,
            move.fromBranchId,
            move.studentId,
            'student.branch_left',
            {
              newValue: {
                branchMoveId: moveId,
                toBranchId: branchId,
                from,
                memberships: {
                  cut: classesCut.map((one) => ({
                    id: one.id,
                    classId: one.classId,
                    from: one.validFrom,
                    until: later(one.validFrom, from),
                    was: one.validUntil,
                  })),
                },
                groupMemberships: {
                  cut: groupsCut.map((one) => ({
                    id: one.id,
                    groupId: one.groupId,
                    from: one.validFrom,
                    until: later(one.validFrom, from),
                    was: one.validUntil,
                  })),
                },
                journalVoids: journal.journalVoids,
              },
              requestId,
            },
          );
          await this.record(transaction, access, branchId, move.studentId, 'student.branch_moved', {
            newValue: {
              branchMoveId: moveId,
              fromBranchId: move.fromBranchId,
              from,
              classId: target.id,
              classMembershipId: membershipId,
              ...(languageDiffers ? { confirmLanguage: true } : {}),
              groupsChosen: chosen.length,
              optionalCells: journal.optionalCells,
              groupsPlaced: covered.automatic.length,
              groupMemberships: {
                written: [
                  ...chosen,
                  ...covered.automatic.map((one) => ({
                    id: one.id,
                    groupId: one.groupId,
                    from: one.from,
                    until: one.until,
                    cause: one.cause,
                    review: one.review,
                  })),
                ],
              },
            },
            requestId,
          });
          return move.studentId;
        }),
      ACCEPT_REFUSALS,
    );
    return this.transactions.run(access.branchIds, (transaction) =>
      this.students.readDetail(transaction, access, studentId),
    );
  }

  /** The decline of a release to the branch of the request, with a reason (decision 14). */
  async decline(
    access: Access,
    moveId: string,
    input: BranchMoveDecline,
    requestId: string,
  ): Promise<IncomingBranchMoves> {
    const branchId = branchOf(access);
    await refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const sending = await this.transactions.joinSendingBranch(transaction, moveId, branchId);
          if (sending === undefined) {
            throw notFound();
          }
          // The student FOR UPDATE first, then the release: a change that came
          // first (an accept, a cancel, a leaving) leaves the release closed.
          await this.lockStudent(transaction, sending.studentId);
          const move = await lockBranchMove(transaction, moveId);
          if (
            move === undefined ||
            branchMoveState(move) !== 'open' ||
            !same(move.toBranchId, branchId)
          ) {
            throw new ApiException('branch_move_closed', 409);
          }
          await transaction
            .updateTable('student_branch_moves')
            .set({
              declined_at: await transactionMoment(transaction),
              decline_reason: input.reason,
            })
            .where('id', '=', moveId)
            .execute();
          const value = {
            branchMoveId: moveId,
            fromBranchId: move.fromBranchId,
            toBranchId: branchId,
            from: move.effectiveOn,
          };
          for (const branch of [move.fromBranchId, branchId]) {
            await this.record(
              transaction,
              access,
              branch,
              move.studentId,
              'student.branch_release_declined',
              { newValue: value, reason: input.reason, requestId },
            );
          }
        }),
      BRANCH_MOVE_REFUSALS,
    );
    return this.incoming(access);
  }

  private async readIncoming(
    transaction: Transaction,
    access: Access,
    branchId: string,
  ): Promise<IncomingBranchMoves> {
    const today = await this.students.todayIn(transaction, branchId);
    const found = await sql<{
      id: string;
      student_id: string;
      uid: string;
      first_name: string;
      last_name: string;
      grade: number;
      from_branch_id: string;
      effective_on: string;
    }>`
      select id, student_id, uid, first_name, last_name, grade, from_branch_id,
        effective_on::text as effective_on
      from branch_moves_incoming(${branchId}::uuid)
    `.execute(transaction);
    const names = await branchNames(
      transaction,
      found.rows.map((row) => row.from_branch_id),
    );
    return {
      moves: found.rows.map((row) => ({
        id: row.id,
        studentId: row.student_id,
        uid: row.uid,
        firstName: row.first_name,
        lastName: row.last_name,
        grade: row.grade,
        fromBranch: {
          id: row.from_branch_id,
          name: names.get(row.from_branch_id.toLowerCase()) ?? '',
        },
        from: row.effective_on,
        acceptable: today >= row.effective_on,
      })),
      canDecide:
        decide(
          { area: 'branch_moves', action: 'edit', branch: 'request' },
          access.assignments,
          access.branchId,
          PERMISSIONS,
        ) !== undefined,
      today,
    };
  }

  /** The student FOR UPDATE, wherever the joined filter shows it; 404 when it is gone. */
  private async lockStudent(transaction: Transaction, studentId: string): Promise<void> {
    const row = await transaction
      .selectFrom('students')
      .select('id')
      .where('id', '=', studentId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
  }

  /** The student FOR UPDATE, of `branchId` (404 otherwise, also for the Super Admin). */
  private async lockStudentOf(
    transaction: Transaction,
    studentId: string,
    branchId: string,
  ): Promise<void> {
    const row = await transaction
      .selectFrom('students')
      .select('branch_id')
      .where('id', '=', studentId)
      .forUpdate()
      .executeTakeFirst();
    if (row === undefined || !same(row.branch_id, branchId)) {
      throw notFound();
    }
  }

  /** The student with its status and class rows, after its lock. */
  private async placementStudent(
    transaction: Transaction,
    studentId: string,
  ): Promise<PlacementStudent> {
    const student = (await lockPlacementStudents(transaction, [studentId])).get(studentId);
    if (student === undefined) {
      throw notFound();
    }
    return student;
  }

  /** A class of `branchId` named in the request; another branch's or an unknown one is 404. */
  private async classOfBranch(
    transaction: Transaction,
    classId: string,
    branchId: string,
  ): Promise<PlacementClass> {
    const found = await readPlacementClass(transaction, classId);
    if (found === undefined || !same(found.branchId, branchId)) {
      throw notFound();
    }
    return found;
  }

  /** A date of the sending branch in a closed academic year is refused; a release needs an open one. */
  private async refuseClosedYear(
    transaction: Transaction,
    branchId: string,
    day: SchoolDate,
  ): Promise<void> {
    const year = await transaction
      .selectFrom('academic_years')
      .select('status')
      .where('branch_id', '=', branchId)
      .where('start_date', '<=', day)
      .where('end_date', '>=', day)
      .executeTakeFirst();
    if (year === undefined) {
      throw new ApiException('branch_move_outside_year', 409, undefined, [
        {
          path: 'from',
          code: 'branch_move_outside_year',
          message: 'The date is in no academic year of the branch.',
        },
      ]);
    }
    if (year.status === 'closed') {
      throw new ApiException('branch_move_year_closed', 409, undefined, [
        {
          path: 'from',
          code: 'branch_move_year_closed',
          message: 'The date is in a closed academic year.',
        },
      ]);
    }
  }

  /** The active groups that draw from the class, with their names, read (no lock). */
  private async readGroups(
    transaction: Transaction,
    classId: string,
  ): Promise<Map<string, CoverGroup & { name: string }>> {
    const rows = await transaction
      .selectFrom('group_classes')
      .innerJoin('groups', 'groups.id', 'group_classes.group_id')
      .innerJoin('academic_years', 'academic_years.id', 'groups.academic_year_id')
      .select([
        'groups.id',
        'groups.branch_id',
        'groups.subject_id',
        'groups.name',
        'groups.name_key',
        'groups.max_size',
        'groups.archived_at',
        'academic_years.status',
      ])
      .where('group_classes.class_id', '=', classId)
      .execute();
    return new Map(
      rows.map((row) => [
        row.id.toLowerCase(),
        {
          id: row.id,
          branchId: row.branch_id,
          subjectId: row.subject_id,
          name: row.name,
          // A generated column (0046), never empty for a stored name.
          nameKey: row.name_key ?? row.name,
          maxSize: row.max_size,
          inService: row.archived_at === null && row.status !== 'closed',
          classIds: new Set([classId.toLowerCase()]),
        },
      ]),
    );
  }

  /** The groups of a subject offered to a class: in service and drawing from it. */
  /**
   * The groups of a subject offered to the class (task 5.5a-2c, decision 5):
   * in service, of the subject, and listed by a stretch of the subject that
   * holds a day of the class row.
   */
  private offered<G extends CoverGroup>(
    groups: ReadonlyMap<string, G>,
    stretches: readonly { groupIds: ReadonlySet<string> }[],
    subjectId: string,
  ): G[] {
    return [...groups.values()].filter(
      (group) =>
        group.inService &&
        group.subjectId === subjectId &&
        stretches.some((stretch) => stretch.groupIds.has(group.id.toLowerCase())),
    );
  }

  /**
   * The split or group subjects of the class on the days of `range`, each
   * with its stretches cut to the range (`class_group_subject_runs`, 0075),
   * by subject id in the order of the runs.
   */
  private async stretchesOf(
    transaction: Transaction,
    classId: string,
    range: { from: SchoolDate; until: SchoolDate },
  ): Promise<Map<string, ReturnType<typeof runsWithin>>> {
    const runs = (await groupSubjectRuns(transaction, [classId])).get(classId.toLowerCase()) ?? [];
    const found = new Map<string, ReturnType<typeof runsWithin>>();
    for (const stretch of runsWithin(runs, range)) {
      found.set(stretch.subjectId, [...(found.get(stretch.subjectId) ?? []), stretch]);
    }
    return found;
  }

  /**
   * The groups chosen by the accept (decision 13): each a group of the
   * subject offered to the class, with a seat on every day of the class row;
   * written untagged with the cause `branch_move`, all or none.
   */
  private async writeChosen(
    transaction: Transaction,
    groups: ReadonlyMap<string, CoverGroup>,
    target: PlacementClass,
    input: BranchMoveAccept,
    row: { studentId: string; from: SchoolDate; until: SchoolDate; leavingId: string | null },
  ): Promise<
    {
      id: string;
      groupId: string;
      from: SchoolDate;
      until: SchoolDate;
      cause: 'branch_move';
      review: false;
    }[]
  > {
    const subjects = await this.stretchesOf(transaction, target.id, row);
    const book = new SeatBook(transaction);
    const written = [];
    for (const [index, choice] of input.groups.entries()) {
      const group = groups.get(choice.groupId.toLowerCase());
      const stretches = group === undefined ? undefined : subjects.get(group.subjectId);
      if (
        group === undefined ||
        stretches === undefined ||
        !same(group.subjectId, choice.subjectId) ||
        !this.offered(groups, stretches, group.subjectId).some((one) => one.id === group.id)
      ) {
        throw new ApiException('branch_move_group', 409, undefined, [
          {
            path: `groups.${String(index)}.groupId`,
            code: 'branch_move_group',
            message: 'The group is not offered to the class for that subject.',
          },
        ]);
      }
      // The chosen group over the days of the stretches that list it, joined
      // where they meet (decision 5); every other day is covered after.
      const ranges: { from: SchoolDate; until: SchoolDate }[] = [];
      for (const stretch of stretches) {
        if (!stretch.groupIds.has(group.id.toLowerCase())) {
          continue;
        }
        const last = ranges.at(-1);
        if (last !== undefined && last.until === stretch.from) {
          last.until = stretch.until;
        } else {
          ranges.push({ from: stretch.from, until: stretch.until });
        }
      }
      for (const range of ranges) {
        if (!(await book.fits(group, range))) {
          throw new ApiException('class_group_no_seat', 409, undefined, [
            {
              path: `groups.${String(index)}.groupId`,
              code: 'class_group_no_seat',
              message: 'The group has no free seat for the student.',
              recordId: row.studentId,
              subjectId: group.subjectId,
            },
          ]);
        }
      }
      for (const range of ranges) {
        book.add(group.id, range);
        // Only a row that reaches the end of the class row takes its own end and its cut.
        const atEnd = range.until === row.until;
        const inserted = await transaction
          .insertInto('group_memberships')
          .values({
            branch_id: group.branchId,
            student_id: row.studentId,
            group_id: group.id,
            subject_id: group.subjectId,
            valid_from: range.from,
            valid_until: range.until,
            own_until: atEnd ? target.ownUntil : range.until,
            cause: 'branch_move',
            review: false,
            ended_by: atEnd && row.leavingId !== null ? 'leaving' : null,
            leaving_id: atEnd ? row.leavingId : null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        written.push({
          id: inserted.id,
          groupId: group.id,
          from: range.from,
          until: range.until,
          cause: 'branch_move' as const,
          review: false as const,
        });
      }
    }
    return written;
  }

  private async record(
    transaction: Transaction,
    access: Access,
    branchId: string,
    studentId: string,
    action: AuditAction,
    entry: { newValue: unknown; reason?: string; requestId: string },
  ): Promise<void> {
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action,
      record: { type: 'student', id: studentId },
      newValue: asJson(entry.newValue),
      ...(entry.reason === undefined ? {} : { reason: entry.reason }),
      requestId: entry.requestId,
    });
  }
}
