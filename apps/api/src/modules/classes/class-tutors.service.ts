import { Injectable } from '@nestjs/common';
import {
  classTutorKindSchema,
  instructionLanguageSchema,
  schoolDateOf,
  type ClassDetail,
  type ClassTutorEnd,
  type ClassTutorGive,
  type ClassTutorPreview,
  type SchoolDate,
  type TutorCandidateList,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { startOfDate } from '../people/staff-status.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import {
  auditOf,
  followChanged,
  followTutors,
  type TutorFollow,
} from '../timetable/tutor-lessons.js';
import { CLASS_REFUSALS, tutorEnded } from './class-tutor-rows.js';
import { branchOf, readClassDetail, zoneOf } from './classes.service.js';

/**
 * The Tutors of a class (edge/students-classes-groups: "The Tutor of a class
 * is recorded with dates ... An acting Tutor can be set for a period"; task
 * 3.1a, decisions 8, 9 and 15). The Academic Vice Principal names which
 * classes each Tutor of the branch holds, under `classes` `edit`; the role
 * itself is given by the Super Admin. The database holds every rule
 * (db/migrations/0042): one Tutor and one acting Tutor at a moment, the
 * language rule, the dates within the role, no start or end in the past; the
 * service checks the same first, for an answer that names the field.
 */
@Injectable()
export class ClassTutors {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /**
   * The Tutor assignments of the branch in force or planned (decision 8),
   * with the person, the languages they teach in and the classes they hold
   * now or later. `assignments` has no policy: the read keeps to the branch
   * of the request in code (.claude/rules/database.md).
   */
  candidates(access: Access): Promise<TutorCandidateList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const now = await transactionMoment(transaction);
      const zone = await zoneOf(transaction, branchId);
      const assignments = await transaction
        .selectFrom('assignments')
        .leftJoin('staff', (join) =>
          join
            .onRef('staff.account_id', '=', 'assignments.account_id')
            .on('staff.kind', '=', 'person'),
        )
        .select([
          'assignments.id',
          'assignments.valid_from',
          'assignments.valid_until',
          'staff.id as staff_id',
          'staff.first_name',
          'staff.last_name',
        ])
        .where('assignments.role', '=', 'tutor')
        .where('assignments.branch_id', '=', branchId)
        .where((builder) =>
          builder.or([
            builder('assignments.valid_until', 'is', null),
            builder.and([
              builder('assignments.valid_until', '>', now),
              builder('assignments.valid_until', '>', builder.ref('assignments.valid_from')),
            ]),
          ]),
        )
        .orderBy('staff.last_name')
        .orderBy('staff.first_name')
        .orderBy('assignments.id')
        .execute();
      const staffIds = assignments.flatMap((row) => (row.staff_id === null ? [] : [row.staff_id]));
      const languages =
        staffIds.length === 0
          ? []
          : await transaction
              .selectFrom('staff_languages')
              .select(['staff_id', 'language'])
              .where('staff_id', 'in', staffIds)
              .orderBy('language')
              .execute();
      const ids = assignments.map((row) => row.id);
      const held =
        ids.length === 0
          ? []
          : await transaction
              .selectFrom('class_tutors')
              .innerJoin('classes', 'classes.id', 'class_tutors.class_id')
              .select([
                'class_tutors.assignment_id',
                'class_tutors.kind',
                'classes.id',
                'classes.grade',
                'classes.name',
              ])
              .where('class_tutors.assignment_id', 'in', ids)
              .where((builder) =>
                builder.or([
                  builder('class_tutors.valid_until', 'is', null),
                  builder.and([
                    builder('class_tutors.valid_until', '>', now),
                    builder(
                      'class_tutors.valid_until',
                      '>',
                      builder.ref('class_tutors.valid_from'),
                    ),
                  ]),
                ]),
              )
              .orderBy('classes.grade')
              .orderBy('classes.name_key')
              .orderBy('classes.id')
              .execute();
      return {
        candidates: assignments.map((row) => ({
          assignmentId: row.id,
          staffId: row.staff_id,
          name:
            row.first_name === null || row.last_name === null
              ? null
              : { firstName: row.first_name, lastName: row.last_name },
          languages: languages
            .filter((one) => one.staff_id === row.staff_id)
            .map((one) => instructionLanguageSchema.parse(one.language)),
          from: schoolDateOf(row.valid_from, zone),
          until: row.valid_until === null ? null : schoolDateOf(row.valid_until, zone),
          classes: held
            .filter((one) => one.assignment_id === row.id)
            .map((one) => ({
              id: one.id,
              grade: one.grade,
              name: one.name,
              kind: classTutorKindSchema.parse(one.kind),
            })),
        })),
      };
    });
  }

  /**
   * Gives a class a Tutor or an acting Tutor from a date (decision 9): today
   * begins now, a later date at 00:00 of that day in the branch's time zone;
   * `until` ends it at 00:00 of that date, or the end of the role does
   * earlier.
   */
  give(
    access: Access,
    classId: string,
    give: ClassTutorGive,
    requestId: string,
  ): Promise<ClassDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.giveIn(transaction, access, classId, give, requestId);
          return readClassDetail(transaction, branchId, classId);
        }),
      CLASS_REFUSALS,
    );
  }

  /**
   * What the give would do to the class's Tutor lessons (task 3.6c-2,
   * decision 10): the real give and its follow run under a savepoint that is
   * rolled back, so the preview is what the save writes. Every refusal of the
   * give answers here too.
   */
  preview(
    access: Access,
    classId: string,
    give: ClassTutorGive,
    requestId: string,
  ): Promise<ClassTutorPreview> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await sql`savepoint tutor_preview`.execute(transaction);
          const follow = await this.giveIn(transaction, access, classId, give, requestId);
          const answer = await previewOf(transaction, branchId, follow);
          await sql`rollback to savepoint tutor_preview`.execute(transaction);
          return answer;
        }),
      CLASS_REFUSALS,
    );
  }

  /** The give in a transaction, with its audit entry; answers what its follow changed. */
  private async giveIn(
    transaction: Transaction,
    access: Access,
    classId: string,
    give: ClassTutorGive,
    requestId: string,
  ): Promise<TutorFollow> {
    const branchId = branchOf(access);
    const held = await this.lockClass(transaction, classId);
    // A body id of another branch, or unknown, is not found; a role of
    // the branch that is not Tutor is refused. Locked FOR SHARE as the
    // trigger locks it, so a role end at the same moment waits.
    const assignment = await transaction
      .selectFrom('assignments')
      .select(['id', 'role', 'valid_from', 'valid_until'])
      .where('id', '=', give.assignmentId)
      .where('branch_id', '=', branchId)
      .forShare()
      .executeTakeFirst();
    if (assignment === undefined) {
      throw notFound();
    }
    if (assignment.role !== 'tutor') {
      throw new ApiException('tutor_not_tutor', 409);
    }
    const now = await transactionMoment(transaction);
    const zone = await zoneOf(transaction, branchId);
    const validFrom = await this.momentOf(transaction, give.from, now, zone);
    const ownUntil = give.until === null ? null : await startOfDate(transaction, give.until, zone);
    if (
      validFrom < assignment.valid_from ||
      (assignment.valid_until !== null && validFrom >= assignment.valid_until)
    ) {
      throw new ApiException('tutor_outside_role', 409);
    }
    if (!(await teachesLanguage(transaction, give.assignmentId, held.language))) {
      throw new ApiException('tutor_language', 409);
    }
    const row = await transaction
      .insertInto('class_tutors')
      .values({
        branch_id: branchId,
        class_id: classId,
        assignment_id: give.assignmentId,
        kind: give.kind,
        valid_from: validFrom,
        own_until: ownUntil,
        given_by: access.accountId,
      })
      .returning(['id', 'valid_until'])
      .executeTakeFirstOrThrow();
    // Task 3.6c-2: the class's Tutor rows and Tutor lessons follow, from
    // the start of the new row.
    const follow = await followTutors(transaction, [classId], validFrom);
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId: access.assignmentId,
      action: 'class.tutor_given',
      record: { type: 'class', id: classId },
      newValue: {
        tutorId: row.id,
        assignmentId: give.assignmentId,
        kind: give.kind,
        validFrom: validFrom.toISOString(),
        validUntil: row.valid_until?.toISOString() ?? null,
        ...(followChanged(follow) ? { tutorLessons: auditOf(follow) } : {}),
      },
      requestId,
    });
    return follow;
  }

  /**
   * Ends a Tutor row from a date: today ends it now, a later date at 00:00 of
   * that day; a row that has not begun by then is withdrawn (its range
   * becomes empty). Only ever earlier: a row that already ends by then is
   * refused (`tutor_ends_by_then`).
   */
  end(
    access: Access,
    classId: string,
    tutorId: string,
    end: ClassTutorEnd,
    requestId: string,
  ): Promise<ClassDetail> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.lockClass(transaction, classId);
          const row = await transaction
            .selectFrom('class_tutors')
            .select(['id', 'valid_from', 'valid_until', 'own_until', 'end_cause'])
            .where('id', '=', tutorId)
            .where('class_id', '=', classId)
            .forUpdate()
            .executeTakeFirst();
          if (row === undefined) {
            throw notFound();
          }
          const now = await transactionMoment(transaction);
          if (tutorEnded(row, now)) {
            throw new ApiException('tutor_ended', 409);
          }
          const zone = await zoneOf(transaction, branchId);
          const at = await this.momentOf(transaction, end.from, now, zone);
          const validUntil = row.valid_from > at ? row.valid_from : at;
          if (row.valid_until !== null && row.valid_until <= validUntil) {
            throw new ApiException('tutor_ends_by_then', 409);
          }
          await transaction
            .updateTable('class_tutors')
            .set({
              valid_until: validUntil,
              own_until: validUntil > row.valid_from ? validUntil : row.own_until,
              end_cause: 'ended',
              ended_by: access.accountId,
            })
            .where('id', '=', tutorId)
            .execute();
          // Task 3.6c-2: from the new end, the earlier of the two (an end only
          // moves earlier).
          const follow = await followTutors(transaction, [classId], validUntil);
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'class.tutor_ended',
            record: { type: 'class', id: classId },
            oldValue: { tutorId, validUntil: row.valid_until?.toISOString() ?? null },
            newValue: {
              tutorId,
              validUntil: validUntil.toISOString(),
              ...(followChanged(follow) ? { tutorLessons: auditOf(follow) } : {}),
            },
            requestId,
          });
          return readClassDetail(transaction, branchId, classId);
        }),
      CLASS_REFUSALS,
    );
  }

  /**
   * The class of the path, locked FOR SHARE as the trigger of a give locks
   * it, so an archive or a change of language at the same moment waits or is
   * waited for; 404 for another branch's class or an unknown id. Archived:
   * `class_archived`; a closed year: `class_year_closed` (decision 18).
   */
  private async lockClass(
    transaction: Transaction,
    classId: string,
  ): Promise<{ language: string }> {
    const locked = await transaction
      .selectFrom('classes')
      .select('id')
      .where('id', '=', classId)
      .forShare()
      .executeTakeFirst();
    if (locked === undefined) {
      throw notFound();
    }
    const held = await transaction
      .selectFrom('classes')
      .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
      .select(['classes.language', 'classes.archived_at', 'academic_years.status'])
      .where('classes.id', '=', classId)
      .executeTakeFirstOrThrow();
    if (held.status === 'closed') {
      throw new ApiException('class_year_closed', 409);
    }
    if (held.archived_at !== null) {
      throw new ApiException('class_archived', 409);
    }
    return { language: held.language };
  }

  /** Today is now; a later date is 00:00 of that day; an earlier one is refused. */
  private async momentOf(
    transaction: Transaction,
    date: SchoolDate,
    now: Date,
    zone: string,
  ): Promise<Date> {
    const today = schoolDateOf(now, zone);
    if (date < today) {
      throw new ApiException('tutor_date_past', 409);
    }
    return date === today ? now : startOfDate(transaction, date, zone);
  }
}

/** `tutor_teaches_language` of db/migrations/0042: the person's languages, whichever branch shows them. */
async function teachesLanguage(
  transaction: Transaction,
  assignmentId: string,
  language: string,
): Promise<boolean> {
  const found = await sql<{ teaches: boolean }>`
    select tutor_teaches_language(${assignmentId}::uuid, ${language}) as teaches
  `.execute(transaction);
  return found.rows[0]?.teaches === true;
}

/** The answer of a preview: the lessons a follow changed, with what the screen shows of them. */
async function previewOf(
  transaction: Transaction,
  branchId: string,
  follow: TutorFollow,
): Promise<ClassTutorPreview> {
  const ids = [...follow.moved, ...follow.needsTeacher].map((one) => one.lessonId);
  const lessons =
    ids.length === 0
      ? []
      : await transaction
          .selectFrom('lessons')
          .innerJoin('subjects', 'subjects.id', 'lessons.subject_id')
          .innerJoin('branches', 'branches.id', 'lessons.branch_id')
          .select([
            'lessons.id',
            sql<string>`lessons.lesson_date::text`.as('date'),
            sql<string>`to_char(lessons.starts_at at time zone branches.time_zone, 'HH24:MI')`.as(
              'start',
            ),
            sql<string>`to_char(lessons.ends_at at time zone branches.time_zone, 'HH24:MI')`.as(
              'end',
            ),
            'subjects.name_uz',
            'subjects.name_ru',
            'subjects.name_en',
          ])
          .where('lessons.id', 'in', ids)
          .execute();
  const lessonOf = (id: string) => {
    const found = lessons.find((one) => one.id === id);
    if (found === undefined) {
      throw new Error('previewOf: a lesson of the follow is not readable');
    }
    return {
      lessonId: found.id,
      date: found.date,
      start: found.start,
      end: found.end,
      subjectNames: { uz: found.name_uz, ru: found.name_ru, en: found.name_en },
    };
  };
  const staffIds = [...new Set(follow.moved.map((one) => one.to))];
  const people =
    staffIds.length === 0
      ? []
      : await transaction
          .selectFrom('staff')
          .select(['id', 'first_name', 'last_name'])
          .where('id', 'in', staffIds)
          .execute();
  const nameOf = (id: string) => {
    const found = people.find((one) => one.id === id);
    return found?.first_name == null || found.last_name == null
      ? null
      : { firstName: found.first_name, lastName: found.last_name };
  };
  const otherBranches = [
    ...new Set(
      follow.needsTeacher.flatMap((one) =>
        one.clashes.map((clash) => clash.branchId).filter((id) => id !== branchId),
      ),
    ),
  ];
  const branches =
    otherBranches.length === 0
      ? []
      : await transaction
          .selectFrom('branches')
          .select(['id', 'name'])
          .where('id', 'in', otherBranches)
          .execute();
  const zone = await zoneOf(transaction, branchId);
  // A clash's clock times in the branch time of the class.
  const clockOf = async (moment: Date): Promise<string> => {
    const { rows } = await sql<{ clock: string }>`
      select to_char(${moment}::timestamptz at time zone ${zone}, 'HH24:MI') as clock
    `.execute(transaction);
    return rows[0]?.clock ?? '';
  };
  const byStart = <T extends { date: string; start: string; lessonId: string }>(a: T, b: T) =>
    a.date.localeCompare(b.date) ||
    a.start.localeCompare(b.start) ||
    a.lessonId.localeCompare(b.lessonId);
  const needsTeacher = [];
  for (const one of follow.needsTeacher) {
    const clashes = [];
    for (const clash of one.clashes) {
      clashes.push({
        start: await clockOf(clash.startsAt),
        end: await clockOf(clash.endsAt),
        branchName:
          clash.branchId === branchId
            ? null
            : (branches.find((branch) => branch.id === clash.branchId)?.name ?? ''),
      });
    }
    needsTeacher.push({ ...lessonOf(one.lessonId), clashes });
  }
  return {
    moved: follow.moved
      .map((one) => ({ ...lessonOf(one.lessonId), to: nameOf(one.to) }))
      .sort(byStart),
    needsTeacher: needsTeacher.sort(byStart),
    draftRows: follow.draftRows.length,
    draftEntriesRemoved: follow.draftEntriesRemoved.length,
  };
}
