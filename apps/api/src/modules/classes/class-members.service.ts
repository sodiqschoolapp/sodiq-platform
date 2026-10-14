import { Injectable } from '@nestjs/common';
import {
  schoolDateOf,
  type ClassMembers as ClassMembersAnswer,
  type ClassPlacement,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { membersPeak, MEMBERSHIP_REFUSALS } from './class-membership-rows.js';
import {
  lockPlacementStudents,
  planPlacement,
  readPlacementClass,
  writePlacement,
  type PlacementClass,
} from './class-placement.js';
import { branchOf, zoneOf } from './classes.service.js';

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

  members(access: Access, classId: string): Promise<ClassMembersAnswer> {
    return this.transactions.run(access.branchIds, async (transaction) =>
      this.readMembers(transaction, branchOf(access), await this.classOf(transaction, classId)),
    );
  }

  /** "Put into a class" from a date, all or none (decisions 5 and 6). */
  place(
    access: Access,
    classId: string,
    input: ClassPlacement,
    requestId: string,
  ): Promise<ClassMembersAnswer> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const placement = await this.classOf(transaction, classId);
          const students = await lockPlacementStudents(
            transaction,
            input.students.map((student) => student.id),
          );
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
          await writePlacement(
            transaction,
            this.audit,
            access,
            placement,
            rows,
            'placement',
            requestId,
          );
          return this.readMembers(transaction, branchId, placement);
        }),
      MEMBERSHIP_REFUSALS,
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
            requestId,
          });
          return this.readMembers(transaction, branchId, placement);
        }),
      MEMBERSHIP_REFUSALS,
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
