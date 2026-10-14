import { Injectable } from '@nestjs/common';
import {
  nextDay,
  schoolDateOf,
  type AutomaticPlacement,
  type AutomaticPlacementResult,
  type ErrorCode,
  type ErrorDetail,
  type GroupMembers as GroupMembersAnswer,
  type GroupPlacement,
  type GroupPlacementBoard,
  type GroupPlacementQuery,
  type SchoolDate,
} from '@sodiq/shared';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import { inGroupScope } from '../access/group-scope.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { lockPlacementStudents, type PlacementStudent } from './class-placement.js';
import { branchOf, zoneOf } from './classes.service.js';
import {
  GROUP_MEMBERSHIP_REFUSALS,
  groupMembersPeak,
  groupRangesFrom,
  peakWith,
  lockGroups,
} from './group-membership-rows.js';
import { classesOfGroups, readGroupRow, type GroupRow } from './group-rows.js';
import { SeatBook, smallestGroup } from './class-groups.js';

/** A group as a placement reads it, after its lock. */
interface PlacementGroupRow {
  id: string;
  branchId: string;
  subjectId: string;
  name: string;
  nameKey: string;
  maxSize: number;
  archived: boolean;
  yearStatus: string;
  yearStart: SchoolDate;
  /** The day after the year's end. */
  yearUntil: SchoolDate;
  classIds: string[];
}

/** A group row a placement writes: inside the class row that holds its first day (decision 7). */
interface PlannedGroupRow {
  studentId: string;
  groupId: string;
  from: SchoolDate;
  until: SchoolDate;
  ownUntil: SchoolDate;
  leavingId: string | null;
}

/** The refusal of one student, named in the details of the answer. */
const studentDetail = (index: number, studentId: string, code: ErrorCode): ErrorDetail => ({
  path: `students.${String(index)}`,
  code,
  message: `The student is refused: ${code}.`,
  recordId: studentId,
});

/** The class row of a student that holds `day` in one of `classIds`, rows with days only. */
function classRowOn(student: PlacementStudent, classIds: ReadonlySet<string>, day: SchoolDate) {
  return student.memberships.find(
    (row) =>
      row.validFrom < row.validUntil &&
      row.validFrom <= day &&
      day < row.validUntil &&
      classIds.has(row.classId.toLowerCase()),
  );
}

/**
 * Group membership (task 3.2b, pull request #92): the Students tab of a group,
 * "Put into a group", the withdraw of a planned placement, "Mark reviewed",
 * and the bulk placement screen with "Place automatically". The area
 * `groups` (decision 6): `view` reads the tab in the scope of 3.2a, `edit`
 * places, withdraws, marks reviewed and reads the screen.
 *
 * Lock order (spec review of the plan, must-fix 1): the students FOR UPDATE
 * in the order of their id, then the groups FOR UPDATE in the order of their
 * id, then the writes; the guard of the database (0048) re-takes the group.
 * A leaving and a class withdraw take the student, then its classes, then
 * its groups (`cutGroupRows`, `withdrawGroupRows`); a group edit takes its
 * classes, then the group. No two of them wait for each other in opposite
 * orders.
 */
@Injectable()
export class GroupMembers {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /**
   * The Students tab: 404 for an unknown or another branch's group, 403
   * outside the scope. A reader whose scope fits the group only as a Tutor
   * reads the members of own classes and a count of the others (decision 4).
   */
  members(access: Access, groupId: string): Promise<GroupMembersAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await readGroupRow(transaction, groupId);
      const classIds = ((await classesOfGroups(transaction, [groupId])).get(groupId) ?? []).map(
        (one) => one.id.toLowerCase(),
      );
      const key = { subjectId: row.subject_id, classIds };
      if (inGroupScope(access.permitting, key) === undefined) {
        throw new ApiException('permission_denied', 403);
      }
      const wide =
        inGroupScope(
          access.permitting.filter((assignment) => assignment.role !== 'tutor'),
          key,
        ) !== undefined;
      const own = new Set(
        access.permitting
          .filter((assignment) => assignment.role === 'tutor')
          .flatMap((assignment) => assignment.classIds),
      );
      return this.readMembers(transaction, branchId, row, (classId) =>
        wide ? true : own.has(classId.toLowerCase()),
      );
    });
  }

  /** "Put into a group" from a date, all or none; refused students are named in `details`. */
  place(
    access: Access,
    groupId: string,
    input: GroupPlacement,
    requestId: string,
  ): Promise<GroupMembersAnswer> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await readGroupRow(transaction, groupId);
          const students = await lockPlacementStudents(
            transaction,
            input.students.map((student) => student.id),
          );
          const [group] = await this.lockPlacementGroups(transaction, [groupId]);
          if (group === undefined) {
            throw notFound();
          }
          this.checkGroup(group, input.from);
          const rows: PlannedGroupRow[] = [];
          const details: ErrorDetail[] = [];
          const classIds = new Set(group.classIds);
          input.students.forEach(({ id }, index) => {
            const student = students.get(id);
            if (student === undefined) {
              throw notFound();
            }
            const held = classRowOn(student, classIds, input.from);
            if (held === undefined) {
              details.push(studentDetail(index, id, 'student_not_in_group_class'));
              return;
            }
            rows.push({
              studentId: id,
              groupId,
              from: input.from,
              until: held.validUntil,
              ownUntil: held.ownUntil,
              leavingId: held.endedBy === 'leaving' ? held.leavingId : null,
            });
          });
          await this.refuseHeldGroups(transaction, input, details, group.subjectId);
          const first = details[0];
          if (first !== undefined) {
            throw new ApiException(first.code as ErrorCode, 409, undefined, details);
          }
          // Date by date, as the guard counts (spec review of the build, should-fix 1).
          const existing = await groupRangesFrom(transaction, groupId, input.from);
          if (peakWith(existing, rows) > group.maxSize) {
            const until = rows.reduce(
              (latest, row) => (row.until > latest ? row.until : latest),
              input.from,
            );
            const free =
              group.maxSize - (await groupMembersPeak(transaction, groupId, input.from, until));
            throw new ApiException('group_full', 409, undefined, [
              {
                path: 'students',
                code: 'group_full',
                message: 'The group has fewer free seats than students.',
                freeSeats: Math.max(free, 0),
              },
            ]);
          }
          await this.write(transaction, access, group, rows, 'placement', requestId);
          return this.readMembers(
            transaction,
            branchId,
            await readGroupRow(transaction, groupId),
            () => true,
          );
        }),
      GROUP_MEMBERSHIP_REFUSALS,
    );
  }

  /**
   * The withdraw of a planned group placement ("It can be changed or
   * cancelled until the date"): its range becomes empty, for good. One in
   * force is moved by a transfer (3.3); one already withdrawn is answered as
   * it is.
   */
  withdraw(
    access: Access,
    groupId: string,
    memberId: string,
    requestId: string,
  ): Promise<GroupMembersAnswer> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const studentId = await this.memberOf(transaction, groupId, memberId);
          await lockPlacementStudents(transaction, [studentId]);
          await lockGroups(transaction, [groupId]);
          const row = await transaction
            .selectFrom('group_memberships')
            .select(['valid_from', 'valid_until', 'ended_by'])
            .where('id', '=', memberId)
            .executeTakeFirstOrThrow();
          // A row with no day (withdrawn, or emptied by a leaving) is answered as it is:
          // an empty range keeps its cause (spec review of the build, should-fix 8).
          if (row.valid_from < row.valid_until) {
            const today = schoolDateOf(
              await transactionMoment(transaction),
              await zoneOf(transaction, branchId),
            );
            if (row.valid_from <= today) {
              throw new ApiException(
                row.valid_until > today
                  ? 'group_membership_in_force'
                  : 'group_membership_not_planned',
                409,
              );
            }
            await transaction
              .updateTable('group_memberships')
              .set({ valid_until: row.valid_from, ended_by: 'withdrawn', leaving_id: null })
              .where('id', '=', memberId)
              .execute();
            await this.audit.record(transaction, {
              branchId,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'student.group_withdrawn',
              record: { type: 'student', id: studentId },
              oldValue: {
                groupId,
                membershipId: memberId,
                from: row.valid_from,
                until: row.valid_until,
              },
              newValue: { until: row.valid_from, endedBy: 'withdrawn' },
              requestId,
            });
          }
          return this.readMembers(
            transaction,
            branchId,
            await readGroupRow(transaction, groupId),
            () => true,
          );
        }),
      GROUP_MEMBERSHIP_REFUSALS,
    );
  }

  /** "Mark reviewed": the tag "placed automatically, review" goes, for good (decision 3). */
  reviewed(
    access: Access,
    groupId: string,
    memberId: string,
    requestId: string,
  ): Promise<GroupMembersAnswer> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const studentId = await this.memberOf(transaction, groupId, memberId);
          await lockPlacementStudents(transaction, [studentId]);
          const row = await transaction
            .selectFrom('group_memberships')
            .select('review')
            .where('id', '=', memberId)
            .executeTakeFirstOrThrow();
          if (row.review) {
            await transaction
              .updateTable('group_memberships')
              .set({ review: false })
              .where('id', '=', memberId)
              .execute();
            await this.audit.record(transaction, {
              branchId,
              actorId: access.accountId,
              assignmentId: access.assignmentId,
              action: 'student.group_reviewed',
              record: { type: 'student', id: studentId },
              oldValue: { groupId, membershipId: memberId, review: true },
              newValue: { review: false },
              requestId,
            });
          }
          return this.readMembers(
            transaction,
            branchId,
            await readGroupRow(transaction, groupId),
            () => true,
          );
        }),
      GROUP_MEMBERSHIP_REFUSALS,
    );
  }

  /**
   * The bulk placement screen (decision 14): the groups of the subject that
   * draw only from classes of the screen's grades, in the year that holds the
   * date, and the students not yet placed.
   */
  board(access: Access, query: GroupPlacementQuery): Promise<GroupPlacementBoard> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      await this.requireSubject(transaction, query.subjectId);
      const today = schoolDateOf(
        await transactionMoment(transaction),
        await zoneOf(transaction, branchId),
      );
      const groups = await this.screenGroups(transaction, query.subjectId, query.grades, query.on);
      const unplaced = await this.unplacedOf(transaction, query.subjectId, groups, query.on);
      const answer: GroupPlacementBoard['groups'] = [];
      for (const group of groups) {
        answer.push({
          id: group.id,
          name: group.name,
          language: group.language,
          classes: group.classes,
          maxSize: group.maxSize,
          members: await this.membersOn(transaction, group.id, query.on),
          free: group.maxSize - (await groupMembersPeak(transaction, group.id, query.on, null)),
        });
      }
      return { groups: answer, unplaced, today };
    });
  }

  /**
   * "Place automatically" (`edge/students-classes-groups`: "Bulk placement
   * puts students into the smallest suitable group and tags them \"placed
   * automatically, review\""): every student the screen lists as not placed
   * on the date, chosen again after the students are locked, into the
   * screen's groups only (correction 1 of the review of #92): the group that
   * draws from the student's class with a free seat on every date of the row
   * and the fewest members on the date, ties by name then id; the students in
   * the order of surname, first name and UID, each taking its seat before the
   * next is decided (decision 12). All or none (decision 13).
   */
  automatic(
    access: Access,
    input: AutomaticPlacement,
    requestId: string,
  ): Promise<AutomaticPlacementResult> {
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.requireSubject(transaction, input.subjectId);
          const seen = await this.screenGroups(
            transaction,
            input.subjectId,
            input.grades,
            input.from,
          );
          // A date of a closed year: its groups stay as they were.
          if (seen.some((group) => group.yearStatus === 'closed')) {
            throw new ApiException('group_year_closed', 409);
          }
          const candidates = await this.unplacedOf(transaction, input.subjectId, seen, input.from);
          if (candidates.length === 0) {
            return { placed: [] };
          }
          const students = await lockPlacementStudents(
            transaction,
            candidates.map((student) => student.id),
          );
          const groups = (
            await this.lockPlacementGroups(
              transaction,
              seen.map((group) => group.id),
            )
          ).filter((group) => !group.archived);
          // Read again under the locks: a placement that came first is no
          // longer a candidate (spec review of the plan, must-fix 2).
          const screen = groups.map((group) => ({ id: group.id, classIds: group.classIds }));
          const still = new Set(
            (await this.unplacedOf(transaction, input.subjectId, screen, input.from)).map(
              (one) => one.id,
            ),
          );
          const order = candidates.filter((one) => still.has(one.id));
          const rows: PlannedGroupRow[] = [];
          const details: ErrorDetail[] = [];
          for (const group of groups) {
            this.checkGroup(group, input.from);
          }
          // One rule for the screen and the class paths (task 3.2c, decision 7).
          const book = new SeatBook(transaction);
          for (const [index, candidate] of order.entries()) {
            const student = students.get(candidate.id);
            if (student === undefined) {
              throw notFound();
            }
            const offered = groups.filter(
              (group) => classRowOn(student, new Set(group.classIds), input.from) !== undefined,
            );
            const held = classRowOn(
              student,
              new Set(offered.flatMap((group) => group.classIds)),
              input.from,
            );
            const best =
              held === undefined
                ? undefined
                : await smallestGroup(book, offered, { from: input.from, until: held.validUntil });
            if (best === undefined || held === undefined) {
              details.push({
                ...studentDetail(index, student.id, 'placement_no_seat'),
                path: 'students',
              });
              continue;
            }
            book.add(best.id, { from: input.from, until: held.validUntil });
            rows.push({
              studentId: student.id,
              groupId: best.id,
              from: input.from,
              until: held.validUntil,
              ownUntil: held.ownUntil,
              leavingId: held.endedBy === 'leaving' ? held.leavingId : null,
            });
          }
          const first = details[0];
          if (first !== undefined) {
            throw new ApiException('placement_no_seat', 409, undefined, details);
          }
          const byId = new Map(groups.map((group) => [group.id, group]));
          for (const row of rows) {
            const group = byId.get(row.groupId);
            if (group !== undefined) {
              await this.write(transaction, access, group, [row], 'automatic', requestId);
            }
          }
          return {
            placed: rows.map((row) => ({ studentId: row.studentId, groupId: row.groupId })),
          };
        }),
      GROUP_MEMBERSHIP_REFUSALS,
    );
  }

  /** The member row of the path, of the group of the path and the branch of the request; 404 otherwise. */
  private async memberOf(
    transaction: Transaction,
    groupId: string,
    memberId: string,
  ): Promise<string> {
    await readGroupRow(transaction, groupId);
    const found = await transaction
      .selectFrom('group_memberships')
      .select('student_id')
      .where('id', '=', memberId)
      .where('group_id', '=', groupId)
      .executeTakeFirst();
    if (found === undefined) {
      throw notFound();
    }
    return found.student_id;
  }

  /** The subject of the screen: unknown is 404. */
  private async requireSubject(transaction: Transaction, subjectId: string): Promise<void> {
    const found = await transaction
      .selectFrom('subjects')
      .select('id')
      .where('id', '=', subjectId)
      .executeTakeFirst();
    if (found === undefined) {
      throw notFound();
    }
  }

  /** The groups locked FOR UPDATE in the order of their id, then read. */
  private async lockPlacementGroups(
    transaction: Transaction,
    groupIds: readonly string[],
  ): Promise<PlacementGroupRow[]> {
    await lockGroups(transaction, groupIds);
    if (groupIds.length === 0) {
      return [];
    }
    const rows = await transaction
      .selectFrom('groups')
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
        'academic_years.start_date',
        'academic_years.end_date',
      ])
      .where('groups.id', 'in', [...groupIds])
      .orderBy('groups.id')
      .execute();
    const classes = await classesOfGroups(
      transaction,
      rows.map((row) => row.id),
    );
    return rows.map((row) => ({
      id: row.id,
      branchId: row.branch_id,
      subjectId: row.subject_id,
      name: row.name,
      nameKey: row.name_key ?? row.name,
      maxSize: row.max_size,
      archived: row.archived_at !== null,
      yearStatus: row.status,
      yearStart: row.start_date,
      yearUntil: nextDay(row.end_date),
      classIds: (classes.get(row.id) ?? []).map((one) => one.id.toLowerCase()),
    }));
  }

  /** The group's own refusals: archived, a closed year, a date outside the year. */
  private checkGroup(group: PlacementGroupRow, from: SchoolDate): void {
    if (group.archived) {
      throw new ApiException('group_archived', 409);
    }
    if (group.yearStatus === 'closed') {
      throw new ApiException('group_year_closed', 409);
    }
    if (from < group.yearStart || from >= group.yearUntil) {
      throw new ApiException('group_membership_outside_year', 409, undefined, [
        {
          path: 'from',
          code: 'group_membership_outside_year',
          message: 'The date is outside the year.',
        },
      ]);
    }
  }

  /**
   * `student_has_group` (decision 10): a group of the subject on or after the
   * date. Read after the students are locked; named in `details`.
   */
  private async refuseHeldGroups(
    transaction: Transaction,
    input: GroupPlacement,
    details: ErrorDetail[],
    subjectId: string,
  ): Promise<void> {
    const held = new Set(
      (
        await transaction
          .selectFrom('group_memberships')
          .select('student_id')
          .where(
            'student_id',
            'in',
            input.students.map((student) => student.id),
          )
          .where('subject_id', '=', subjectId)
          .whereRef('valid_from', '<', 'valid_until')
          .where('valid_until', '>', input.from)
          .execute()
      ).map((row) => row.student_id.toLowerCase()),
    );
    input.students.forEach(({ id }, index) => {
      if (held.has(id.toLowerCase()) && !details.some((one) => one.recordId === id)) {
        details.push(studentDetail(index, id, 'student_has_group'));
      }
    });
    details.sort((a, b) => Number(a.path.split('.')[1]) - Number(b.path.split('.')[1]));
  }

  /** Writes the rows and one audit entry per student on the student record. */
  private async write(
    transaction: Transaction,
    access: Access,
    group: PlacementGroupRow,
    rows: readonly PlannedGroupRow[],
    cause: 'placement' | 'automatic',
    requestId: string,
  ): Promise<void> {
    for (const row of rows) {
      const review = cause === 'automatic';
      const written = await transaction
        .insertInto('group_memberships')
        .values({
          branch_id: group.branchId,
          student_id: row.studentId,
          group_id: group.id,
          subject_id: group.subjectId,
          valid_from: row.from,
          valid_until: row.until,
          own_until: row.ownUntil,
          cause,
          review,
          ended_by: row.leavingId === null ? null : 'leaving',
          leaving_id: row.leavingId,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await this.audit.record(transaction, {
        branchId: group.branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'student.group_joined',
        record: { type: 'student', id: row.studentId },
        newValue: {
          groupId: group.id,
          membershipId: written.id,
          from: row.from,
          until: row.until,
          cause,
          review,
        },
        requestId,
      });
    }
  }

  /** The members of a group on a day: rows with days that hold it. */
  private async membersOn(
    transaction: Transaction,
    groupId: string,
    day: SchoolDate,
  ): Promise<number> {
    const found = await transaction
      .selectFrom('group_memberships')
      .select((eb) => eb.fn.countAll<string>().as('count'))
      .where('group_id', '=', groupId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', day)
      .where('valid_until', '>', day)
      .executeTakeFirstOrThrow();
    return Number(found.count);
  }

  /**
   * The groups of the screen (decision 14 with correction 1): active groups
   * of the subject whose classes are all of the screen's grades, in the year
   * that holds the date; by name.
   */
  private async screenGroups(
    transaction: Transaction,
    subjectId: string,
    grades: readonly number[],
    day: SchoolDate,
  ) {
    const rows = await transaction
      .selectFrom('groups')
      .innerJoin('academic_years', 'academic_years.id', 'groups.academic_year_id')
      .select([
        'groups.id',
        'groups.name',
        'groups.language',
        'groups.max_size',
        'academic_years.status as year_status',
      ])
      .where('groups.subject_id', '=', subjectId)
      .where('groups.archived_at', 'is', null)
      .where('academic_years.start_date', '<=', day)
      .where('academic_years.end_date', '>=', day)
      .orderBy('groups.name_key')
      .orderBy('groups.id')
      .execute();
    const classes = await classesOfGroups(
      transaction,
      rows.map((row) => row.id),
    );
    return rows
      .map((row) => ({
        id: row.id,
        name: row.name,
        language: row.language as 'uz' | 'ru',
        maxSize: row.max_size,
        yearStatus: row.year_status,
        classes: (classes.get(row.id) ?? []).map((one) => ({
          id: one.id,
          grade: one.grade,
          name: one.name,
        })),
        classIds: (classes.get(row.id) ?? []).map((one) => one.id.toLowerCase()),
      }))
      .filter(
        (group) =>
          group.classes.length > 0 && group.classes.every((one) => grades.includes(one.grade)),
      );
  }

  /** The students of the screen not yet placed (decision 14), by surname, first name and UID. */
  private async unplacedOf(
    transaction: Transaction,
    subjectId: string,
    groups: readonly { id: string; classIds: readonly string[] }[],
    day: SchoolDate,
  ): Promise<GroupPlacementBoard['unplaced']> {
    const classIds = [...new Set(groups.flatMap((group) => group.classIds))];
    if (classIds.length === 0) {
      return [];
    }
    const rows = await transaction
      .selectFrom('class_memberships')
      .innerJoin('students', 'students.id', 'class_memberships.student_id')
      .innerJoin('classes', 'classes.id', 'class_memberships.class_id')
      .select([
        'students.id',
        'students.uid',
        'students.first_name',
        'students.last_name',
        'classes.id as class_id',
        'classes.grade',
        'classes.name',
        'class_memberships.valid_from',
      ])
      .where('class_memberships.class_id', 'in', classIds)
      .whereRef('class_memberships.valid_from', '<', 'class_memberships.valid_until')
      .where('class_memberships.valid_from', '<=', day)
      .where('class_memberships.valid_until', '>', day)
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('group_memberships')
              .select('group_memberships.id')
              .whereRef('group_memberships.student_id', '=', 'students.id')
              .where('group_memberships.subject_id', '=', subjectId)
              .whereRef('group_memberships.valid_from', '<', 'group_memberships.valid_until')
              .where('group_memberships.valid_until', '>', day),
          ),
        ),
      )
      .orderBy('students.last_name')
      .orderBy('students.first_name')
      .orderBy('students.uid')
      .execute();
    return rows.map((row) => ({
      id: row.id,
      uid: row.uid,
      firstName: row.first_name,
      lastName: row.last_name,
      class: { id: row.class_id, grade: row.grade, name: row.name },
      classFrom: row.valid_from,
    }));
  }

  /**
   * The Students tab: the members in force today and the planned ones, by
   * surname, first name and UID, with the class that holds the first day of
   * each row; the free seats today and the fewest from today on, counted over
   * every member. `shows` keeps the members of the classes the reader reads.
   */
  private async readMembers(
    transaction: Transaction,
    branchId: string,
    group: GroupRow,
    shows: (classId: string) => boolean,
  ): Promise<GroupMembersAnswer> {
    const today = schoolDateOf(
      await transactionMoment(transaction),
      await zoneOf(transaction, branchId),
    );
    const classIds = ((await classesOfGroups(transaction, [group.id])).get(group.id) ?? []).map(
      (one) => one.id,
    );
    const rows = await transaction
      .selectFrom('group_memberships')
      .innerJoin('students', 'students.id', 'group_memberships.student_id')
      .innerJoin('class_memberships', (join) =>
        join
          .onRef('class_memberships.student_id', '=', 'group_memberships.student_id')
          .onRef('class_memberships.valid_from', '<=', 'group_memberships.valid_from')
          .onRef('class_memberships.valid_until', '>', 'group_memberships.valid_from'),
      )
      .innerJoin('classes', 'classes.id', 'class_memberships.class_id')
      .select([
        'group_memberships.id',
        'group_memberships.student_id',
        'group_memberships.valid_from',
        'group_memberships.valid_until',
        'group_memberships.review',
        'students.uid',
        'students.first_name',
        'students.last_name',
        'classes.id as class_id',
        'classes.grade',
        'classes.name as class_name',
      ])
      .where('group_memberships.group_id', '=', group.id)
      .where('class_memberships.class_id', 'in', classIds.length === 0 ? [group.id] : classIds)
      .whereRef('group_memberships.valid_from', '<', 'group_memberships.valid_until')
      .where('group_memberships.valid_until', '>', today)
      .orderBy('students.last_name')
      .orderBy('students.first_name')
      .orderBy('students.uid')
      .orderBy('group_memberships.valid_from')
      .execute();
    const all = rows.map((row) => ({
      id: row.id,
      studentId: row.student_id,
      uid: row.uid,
      firstName: row.first_name,
      lastName: row.last_name,
      class: { id: row.class_id, grade: row.grade, name: row.class_name },
      from: row.valid_from,
      until: row.valid_until,
      state: row.valid_from <= today ? ('current' as const) : ('planned' as const),
      review: row.review,
    }));
    const members = all.filter((member) => shows(member.class.id));
    const current = all.filter((member) => member.state === 'current').length;
    return {
      members,
      othersCount: all.length - members.length,
      freeToday: group.max_size - current,
      freeLeast: group.max_size - (await groupMembersPeak(transaction, group.id, today, null)),
      today,
    };
  }
}
