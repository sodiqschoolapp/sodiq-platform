import { Injectable } from '@nestjs/common';
import {
  schoolDateOf,
  type ClassMembers as ClassMembersAnswer,
  type ClassPlacement,
  type ClassPlacementResult,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { classesInService, membersPeak, MEMBERSHIP_REFUSALS } from './class-membership-rows.js';
import { CLASS_GROUP_REFUSALS, coverClassRows, lockPlacementGroups } from './class-groups.js';
import { CLASS_PATH_GROUP_REFUSALS, withdrawGroupRows } from './group-membership-rows.js';
import {
  lockPlacementStudents,
  planPlacement,
  readPlacementClass,
  writePlacement,
  type PlacementClass,
} from './class-placement.js';
import { branchOf, refuseOutsideClassScope, zoneOf } from './classes.service.js';

/**
 * Class membership from the class's side (task 3.1b, pull request #89): its
 * Students tab, "Put into a class" and the withdraw of a planned placement.
 * The area `classes` (decision 9): `view` reads the tab, `edit` places and
 * withdraws. Lock order, as every placement and status change: the students
 * by id, then the class (in the guard of the database, 0045).
 */
@Injectable()
export class ClassMembers {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /** The Students tab; a Tutor's own class only (task 3.1c, decision 9 of pull request #90). */
  members(access: Access, classId: string): Promise<ClassMembersAnswer> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const found = await this.classOf(transaction, classId);
      refuseOutsideClassScope(access, classId);
      return this.readMembers(transaction, branchOf(access), found);
    });
  }

  /** "Put into a class" from a date, all or none (decisions 5 and 6). */
  place(
    access: Access,
    classId: string,
    input: ClassPlacement,
    requestId: string,
  ): Promise<ClassPlacementResult> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const placement = await this.classOf(transaction, classId);
          const students = await lockPlacementStudents(
            transaction,
            input.students.map((student) => student.id),
          );
          // Task 3.2c, decision 9: the class FOR UPDATE before its groups are
          // read, so a group create or edit, which takes its classes FOR
          // SHARE first, is read here or waits for this change.
          await classesInService(transaction, [placement.id]);
          const rows = await planPlacement(
            transaction,
            placement,
            input.students.map((student) => {
              const locked = students.get(student.id);
              if (locked === undefined) {
                throw notFound();
              }
              return { student: locked, version: student.version };
            }),
            input.from,
          );
          // Decision 9: every group the placement may touch, before its first write.
          const groups = await lockPlacementGroups(
            transaction,
            [placement.id],
            rows.map((row) => row.studentId),
          );
          await writePlacement(
            transaction,
            this.audit,
            access,
            placement,
            rows,
            'placement',
            requestId,
          );
          // Task 3.2c: a group of every split or group subject of the class
          // from the same date, all or none.
          const covered = await coverClassRows(
            transaction,
            this.audit,
            access,
            {
              classRows: rows.map((row) => ({
                index: input.students.findIndex((student) => student.id === row.studentId),
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
            },
            requestId,
          );
          return {
            ...(await this.readMembers(transaction, branchId, placement)),
            groupsPlaced: covered.automatic.map((row) => ({
              studentId: row.studentId,
              groupId: row.groupId,
              subjectId: row.subjectId,
            })),
          };
        }),
      { ...MEMBERSHIP_REFUSALS, ...CLASS_GROUP_REFUSALS },
    );
  }

  /**
   * The withdraw of a planned placement (decision 10: "It can be changed or
   * cancelled until the date"): its range becomes empty, `ended_by =
   * 'withdrawn'`, for good. One in force is moved by a transfer (3.3); one
   * already withdrawn is answered as it is.
   */
  withdraw(
    access: Access,
    classId: string,
    memberId: string,
    requestId: string,
  ): Promise<ClassMembersAnswer> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const placement = await this.classOf(transaction, classId);
          const found = await transaction
            .selectFrom('class_memberships')
            .select('student_id')
            .where('id', '=', memberId)
            .where('class_id', '=', classId)
            .executeTakeFirst();
          if (found === undefined) {
            throw notFound();
          }
          await lockPlacementStudents(transaction, [found.student_id]);
          const row = await transaction
            .selectFrom('class_memberships')
            .select(['valid_from', 'valid_until', 'ended_by'])
            .where('id', '=', memberId)
            .executeTakeFirstOrThrow();
          if (row.ended_by === 'withdrawn') {
            return this.readMembers(transaction, branchId, placement);
          }
          const today = schoolDateOf(
            await transactionMoment(transaction),
            await zoneOf(transaction, branchId),
          );
          if (row.valid_from <= today) {
            throw new ApiException(
              row.valid_until > today ? 'membership_in_force' : 'membership_not_planned',
              409,
            );
          }
          await transaction
            .updateTable('class_memberships')
            .set({ valid_until: row.valid_from, ended_by: 'withdrawn', leaving_id: null })
            .where('id', '=', memberId)
            .execute();
          // Task 3.2b (decision 8 of pull request #92): the group rows inside
          // the planned class row are withdrawn with it.
          const groupsWithdrawn = await withdrawGroupRows(
            transaction,
            found.student_id,
            classId,
            row.valid_from,
            row.valid_until,
          );
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'student.class_withdrawn',
            record: { type: 'student', id: found.student_id },
            oldValue: {
              classId,
              membershipId: memberId,
              from: row.valid_from,
              until: row.valid_until,
            },
            newValue: {
              until: row.valid_from,
              endedBy: 'withdrawn',
              ...(groupsWithdrawn.length === 0 ? {} : { groupMemberships: groupsWithdrawn }),
            },
            requestId,
          });
          return this.readMembers(transaction, branchId, placement);
        }),
      { ...MEMBERSHIP_REFUSALS, ...CLASS_PATH_GROUP_REFUSALS },
    );
  }

  /** The class of the path, of the branch of the request; 404 otherwise. */
  private async classOf(transaction: Transaction, classId: string): Promise<PlacementClass> {
    const found = await readPlacementClass(transaction, classId);
    if (found === undefined) {
      throw notFound();
    }
    return found;
  }

  /**
   * The Students tab: the members in force today and the planned ones, by
   * surname, first name and UID; the free seats today and the fewest on any
   * date from today on.
   */
  private async readMembers(
    transaction: Transaction,
    branchId: string,
    placement: PlacementClass,
  ): Promise<ClassMembersAnswer> {
    const today = schoolDateOf(
      await transactionMoment(transaction),
      await zoneOf(transaction, branchId),
    );
    const rows = await transaction
      .selectFrom('class_memberships')
      .innerJoin('students', 'students.id', 'class_memberships.student_id')
      .select([
        'class_memberships.id',
        'class_memberships.student_id',
        'class_memberships.valid_from',
        'class_memberships.valid_until',
        'students.uid',
        'students.first_name',
        'students.last_name',
      ])
      .where('class_memberships.class_id', '=', placement.id)
      .whereRef('class_memberships.valid_from', '<', 'class_memberships.valid_until')
      .where('class_memberships.valid_until', '>', today)
      .orderBy('students.last_name')
      .orderBy('students.first_name')
      .orderBy('students.uid')
      .orderBy('class_memberships.valid_from')
      .execute();
    const members = rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      uid: row.uid,
      firstName: row.first_name,
      lastName: row.last_name,
      from: row.valid_from,
      until: row.valid_until,
      state: row.valid_from <= today ? ('current' as const) : ('planned' as const),
    }));
    const current = members.filter((member) => member.state === 'current').length;
    return {
      members,
      freeToday: placement.maxSize - current,
      freeLeast: placement.maxSize - (await membersPeak(transaction, placement.id, today, null)),
      today,
    };
  }
}
