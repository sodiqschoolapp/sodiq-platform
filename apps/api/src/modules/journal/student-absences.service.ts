import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import {
  absenceCategorySchema,
  classDisplayName,
  compareStudentNames,
  lessonStateOf,
  schoolDateOf,
  type AbsenceReason,
  type AbsenceReasonRecord,
  type Role,
  type StudentAbsenceDay,
  type StudentAbsences as StudentAbsencesAnswer,
  type StudentAbsencesQuery,
} from '@sodiq/shared';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound } from '../setup/setup-refusals.js';
import { awayLessons } from '../timetable/away-read.js';
import type { UploadedFile } from '../../http/file-routes.js';
import type { StoredFile } from '../../http/stored-file.js';
import { PHOTO_STORE, type PhotoStore } from '../people/photo-store.js';
import { namedAccounts } from './cell-lines.query.js';
import { checkedFile, putStored, readStored } from './exemptions.service.js';

/** The readers of every class of the branch (decision 6); the Tutor reads own classes only. */
const WHOLE_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
];

/** The writers of every class of the branch (decision 6); the Tutor writes own classes only. */
const WHOLE_WRITERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

const DAY_MS = 86_400_000;

function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week of `date` (decision 13: one week by default). */
function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
  return addDays(date, -((weekday + 6) % 7));
}

const lower = (id: string) => id.toLowerCase();

/** The classes a Tutor assignment that permits the route holds now (6.2 correction 4). */
const tutorClassesOf = (access: Access): Set<string> =>
  new Set(
    access.permitting
      .filter((assignment) => assignment.role === 'tutor')
      .flatMap((assignment) => assignment.classIds.map(lower)),
  );

const isWhole = (access: Access, roles: readonly Role[]) =>
  access.permitting.some((assignment) => roles.includes(assignment.role));

async function todayOf(transaction: Transaction, branchId: string): Promise<string> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
}

/**
 * The reasons of a student's absence and the Student absences page (task
 * 6.3, pull request #211; `edge/journal`, "A Tutor records why a student was
 * absent": "The reason is its own record per student and date: a category
 * ..., a text and an optional file. It never affects a calculation. The class
 * Tutor and the Academic Vice Principal can edit it until the quarter closes.
 * Teachers see the category only"; decisions 6 to 9 and 13). The file is
 * 8.5's (decision 10), the lock at the quarter's close 9.2b's (decision 11).
 */
@Injectable()
export class StudentAbsences {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
    @Inject(PHOTO_STORE) private readonly store: PhotoStore,
  ) {}

  list(access: Access, query: StudentAbsencesQuery): Promise<StudentAbsencesAnswer> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const today = await todayOf(transaction, branchId);
      const from = query.from ?? mondayOf(today);
      const to = query.to ?? today;
      const whole = isWhole(access, WHOLE_READERS);
      const own = tutorClassesOf(access);
      const classes = await this.classesOf(transaction, whole, own, today);
      let classId: string | null = query.classId ?? null;
      if (classId !== null) {
        const found = await transaction
          .selectFrom('classes')
          .select('id')
          .where('id', '=', classId)
          .executeTakeFirst();
        if (found === undefined) throw notFound();
        if (!whole && !own.has(lower(found.id))) throw new ApiException('absence_scope', 403);
        classId = found.id;
      } else {
        classId = classes[0]?.id ?? null;
      }
      const days =
        classId === null
          ? []
          : await this.daysOf(transaction, access, classId, from, to, own.has(lower(classId)));
      return { classId, from, to, classes, days };
    });
  }

  /** The classes to choose: a whole reader's every class of the year of today (or the latest), a Tutor's own. */
  private async classesOf(
    transaction: Transaction,
    whole: boolean,
    own: ReadonlySet<string>,
    today: string,
  ): Promise<{ id: string; name: string }[]> {
    let query = transaction
      .selectFrom('classes')
      .innerJoin('academic_years', 'academic_years.id', 'classes.academic_year_id')
      .select([
        'classes.id',
        'classes.grade',
        'classes.name',
        sql<string>`academic_years.start_date::text`.as('start'),
        sql<string>`academic_years.end_date::text`.as('end'),
      ])
      .where('classes.archived_at', 'is', null);
    if (!whole) {
      if (own.size === 0) return [];
      query = query.where('classes.id', 'in', [...own]);
    }
    const rows = await query.execute();
    // A whole reader: the year of today, else the latest year that has classes.
    let chosen = rows;
    if (whole) {
      const current = rows.filter((row) => row.start <= today && today <= row.end);
      const latest = rows.reduce((max, row) => (row.start > max ? row.start : max), '');
      chosen = current.length > 0 ? current : rows.filter((row) => row.start === latest);
    }
    return chosen
      .sort((one, other) => one.grade - other.grade || one.name.localeCompare(other.name))
      .map((row) => ({ id: row.id, name: classDisplayName(row.grade, row.name) }));
  }

  /**
   * The students and dates of the class from `from` to `to` with a 0 or 3 in
   * a lesson of the branch that started and is not cancelled, or with a
   * reason (decision 13), on the dates they were members of the class.
   */
  private async daysOf(
    transaction: Transaction,
    access: Access,
    classId: string,
    from: string,
    to: string,
    ownClass: boolean,
  ): Promise<StudentAbsenceDay[]> {
    const memberships = await transaction
      .selectFrom('class_memberships')
      .select([
        'student_id',
        sql<string>`valid_from::text`.as('valid_from'),
        sql<string>`valid_until::text`.as('valid_until'),
      ])
      .where('class_id', '=', classId)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', to)
      .where('valid_until', '>', from)
      .execute();
    if (memberships.length === 0) return [];
    const memberOn = (studentId: string, date: string) =>
      memberships.some(
        (row) => row.student_id === studentId && row.valid_from <= date && date < row.valid_until,
      );
    const studentIds = [...new Set(memberships.map((row) => row.student_id))];
    const now = await transactionMoment(transaction);
    const branch = await transaction
      .selectFrom('classes')
      .innerJoin('branches', 'branches.id', 'classes.branch_id')
      .select('branches.time_zone')
      .where('classes.id', '=', classId)
      .executeTakeFirstOrThrow();
    const marks = await transaction
      .selectFrom('journal_cells')
      .innerJoin('lessons', 'lessons.id', 'journal_cells.lesson_id')
      .innerJoin('subjects', 'subjects.id', 'lessons.subject_id')
      .leftJoin('staff', 'staff.id', 'lessons.teacher_id')
      .select([
        'lessons.teacher_id',
        'staff.kind as teacher_kind',
        'journal_cells.student_id',
        'journal_cells.mark',
        'lessons.id as lesson_id',
        sql<string>`lessons.lesson_date::text`.as('date'),
        'lessons.starts_at',
        sql<number>`(extract(epoch from (lessons.starts_at at time zone ${branch.time_zone})::time) / 60)::int`.as(
          'start_minutes',
        ),
        'subjects.name_uz',
        'subjects.name_ru',
        'subjects.name_en',
      ])
      .where('journal_cells.student_id', 'in', studentIds)
      .where('journal_cells.work_id', 'is', null)
      .where('journal_cells.mark', 'is not', null)
      .where('lessons.lesson_date', '>=', from)
      .where('lessons.lesson_date', '<=', to)
      .where('lessons.cancel_cause', 'is', null)
      .where('lessons.starts_at', '<=', now)
      // Task 8.5 (decision 2): a mark an exemption hides is no absence (07, Effect on totals:
      // "Exempt is its own category. It is never counted as absent").
      .where(sql<boolean>`lesson_student_expected(lessons.id, journal_cells.student_id)`)
      .orderBy('lessons.starts_at')
      .orderBy('lessons.id')
      .execute();
    // Held lessons only (`edge/00-definitions`, Held lesson; spec review of the code, should-fix 5).
    const lessonRows = [...new Map(marks.map((row) => [row.lesson_id, row])).values()];
    const away = await awayLessons(
      transaction,
      lessonRows.map((row) => ({
        id: row.lesson_id,
        teacherId: row.teacher_id,
        startsAt: new Date(row.starts_at),
      })),
    );
    const held = new Set(
      lessonRows
        .filter(
          (row) =>
            lessonStateOf(
              {
                startsAt: new Date(row.starts_at),
                cancelled: false,
                teacher:
                  row.teacher_kind === null
                    ? null
                    : row.teacher_kind === 'vacancy'
                      ? 'vacancy'
                      : 'person',
                away: away.has(row.lesson_id),
              },
              now,
            ) === 'held',
        )
        .map((row) => row.lesson_id),
    );
    const reasons = await transaction
      .selectFrom('student_absence_reasons')
      .select([
        'student_id',
        sql<string>`absence_date::text`.as('date'),
        'category',
        'note',
        'file_name',
        'file_type',
        'changed_by',
        'changed_at',
      ])
      .where('student_id', 'in', studentIds)
      .where('absence_date', '>=', from)
      .where('absence_date', '<=', to)
      .where('category', 'is not', null)
      .execute();
    const names = await namedAccounts(
      transaction,
      reasons.map((row) => row.changed_by),
    );
    const keyOf = (studentId: string, date: string) => `${studentId}/${date}`;
    const days = new Map<
      string,
      {
        studentId: string;
        date: string;
        lessons: StudentAbsenceDay['lessons'];
        presentEarlier: boolean;
        atSchool: boolean;
        reason: AbsenceReason | null;
      }
    >();
    const dayOf = (studentId: string, date: string) => {
      const key = keyOf(studentId, date);
      let found = days.get(key);
      if (found === undefined) {
        found = {
          studentId,
          date,
          lessons: [],
          presentEarlier: false,
          atSchool: false,
          reason: null,
        };
        days.set(key, found);
      }
      return found;
    };
    // In the order of the lessons' starts: a 0 after a 1, 2 or 3 is "at school earlier" (decision 9).
    for (const row of marks) {
      if (!held.has(row.lesson_id) || !memberOn(row.student_id, row.date)) continue;
      const day = dayOf(row.student_id, row.date);
      if (row.mark === 0 || row.mark === 3) {
        day.lessons.push({
          id: row.lesson_id,
          start: row.start_minutes,
          subject: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
          mark: row.mark === 0 ? 0 : 3,
        });
      }
      if (row.mark === 0 && day.atSchool) day.presentEarlier = true;
      if (row.mark !== 0) day.atSchool = true;
    }
    for (const row of reasons) {
      if (!memberOn(row.student_id, row.date)) continue;
      dayOf(row.student_id, row.date).reason = {
        studentId: row.student_id,
        date: row.date,
        category: row.category === null ? null : absenceCategorySchema.parse(row.category),
        note: row.note,
        file:
          row.file_name === null || row.file_type === null
            ? null
            : { name: row.file_name, type: row.file_type },
        changedBy: names.get(row.changed_by) ?? {
          accountId: row.changed_by,
          login: null,
          name: null,
        },
        changedAt: new Date(row.changed_at).toISOString(),
      };
    }
    const listed = [...days.values()].filter(
      (day) => day.lessons.length > 0 || day.reason !== null,
    );
    const students = await transaction
      .selectFrom('students')
      .select(['id', 'uid', 'first_name', 'last_name', 'paternal_name'])
      .where(
        'id',
        'in',
        listed.length === 0 ? [''] : [...new Set(listed.map((day) => day.studentId))],
      )
      .execute();
    const studentOf = new Map(
      students.map((row) => [
        row.id,
        {
          id: row.id,
          uid: row.uid,
          firstName: row.first_name,
          lastName: row.last_name,
          paternalName: row.paternal_name,
        },
      ]),
    );
    const canEdit = isWholeWriter(access) || (ownClass && entersReasons(access, 'tutor'));
    return listed
      .flatMap((day) => {
        const student = studentOf.get(day.studentId);
        return student === undefined
          ? []
          : [
              {
                student,
                date: day.date,
                lessons: day.lessons,
                presentEarlier: day.presentEarlier,
                reason: day.reason,
                canEdit,
              },
            ];
      })
      .sort(
        (one, other) =>
          other.date.localeCompare(one.date) || compareStudentNames(one.student, other.student),
      );
  }

  /** Sets or clears the reason of a student's absence on a date (decisions 6 and 8). */
  set(
    access: Access,
    studentId: string,
    date: string,
    input: AbsenceReasonRecord,
    requestId: string | undefined,
  ): Promise<AbsenceReason> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      // The student first, so that a membership change waits for the reason or the reason for it.
      const student = await transaction
        .selectFrom('students')
        .select('id')
        .where('id', '=', studentId)
        .forShare()
        .executeTakeFirst();
      if (student === undefined) throw notFound();
      const membership = await transaction
        .selectFrom('class_memberships')
        .select('class_id')
        .where('student_id', '=', student.id)
        .whereRef('valid_from', '<', 'valid_until')
        .where('valid_from', '<=', date)
        .where('valid_until', '>', date)
        .forShare()
        .executeTakeFirst();
      if (membership === undefined) throw new ApiException('absence_not_member', 409);
      const ownClass = tutorClassesOf(access).has(lower(membership.class_id));
      // The Tutor of the class (rows in force now) writes as the Tutor; the Academic Vice
      // Principal and the Super Admin write every class (decisions 6 and 8).
      const writer = writerOf(access, ownClass);
      if (writer === undefined) throw new ApiException('absence_scope', 403);
      const readStored = () =>
        transaction
          .selectFrom('student_absence_reasons')
          .select(['id', 'category', 'note'])
          .where('branch_id', '=', branchId)
          .where('student_id', '=', student.id)
          .where('absence_date', '=', date)
          .forUpdate()
          .executeTakeFirst();
      let stored = await readStored();
      if (stored === undefined) {
        // A first save: a row another first save wrote meanwhile is read and changed instead,
        // so the audit entry names its value as the old one (spec review of the code, should-fix 1).
        const inserted = await transaction
          .insertInto('student_absence_reasons')
          .values({
            branch_id: branchId,
            student_id: student.id,
            absence_date: date,
            category: input.category,
            note: input.note,
            changed_by: access.accountId,
            // Overwritten by student_absence_reasons_write.
            changed_at: new Date(0),
          })
          .onConflict((conflict) =>
            conflict.columns(['branch_id', 'student_id', 'absence_date']).doNothing(),
          )
          .returning('id')
          .executeTakeFirst();
        if (inserted !== undefined) {
          await this.audited(transaction, access, writer.id, branchId, student.id, inserted.id, {
            date,
            old: null,
            input,
            requestId,
          });
          return this.answer(transaction, student.id, date, inserted.id);
        }
        stored = await readStored();
        if (stored === undefined) throw new Error('A reason refused by its key is read back.');
      }
      await transaction
        .updateTable('student_absence_reasons')
        .set({
          category: input.category,
          note: input.note,
          changed_by: access.accountId,
          // Task 8.5: a cleared reason takes its file with it (the check of 0123).
          ...(input.category === null ? { file_key: null, file_type: null, file_name: null } : {}),
        })
        .where('id', '=', stored.id)
        .execute();
      await this.audited(transaction, access, writer.id, branchId, student.id, stored.id, {
        date,
        old: { date, category: stored.category, note: stored.note },
        input,
        requestId,
      });
      return this.answer(transaction, student.id, date, stored.id);
    });
  }

  private async audited(
    transaction: Transaction,
    access: Access,
    assignmentId: string,
    branchId: string,
    studentId: string,
    reasonId: string,
    change: {
      date: string;
      old: { date: string; category: string | null; note: string } | null;
      input: AbsenceReasonRecord;
      requestId: string | undefined;
    },
  ): Promise<void> {
    await this.audit.record(transaction, {
      branchId,
      actorId: access.accountId,
      assignmentId,
      action: 'absence_reason.set',
      record: { type: 'student', id: studentId },
      oldValue: change.old,
      newValue: { date: change.date, category: change.input.category, note: change.input.note },
      details: { reasonId },
      ...(change.requestId === undefined ? {} : { requestId: change.requestId }),
    });
  }

  /** The reason as stored, with who set it. */
  private async answer(
    transaction: Transaction,
    studentId: string,
    date: string,
    id: string,
  ): Promise<AbsenceReason> {
    const row = await transaction
      .selectFrom('student_absence_reasons')
      .select(['category', 'note', 'changed_by', 'changed_at', 'file_name', 'file_type'])
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    const names = await namedAccounts(transaction, [row.changed_by]);
    return {
      studentId,
      date,
      category: row.category === null ? null : absenceCategorySchema.parse(row.category),
      note: row.note,
      file:
        row.file_name === null || row.file_type === null
          ? null
          : { name: row.file_name, type: row.file_type },
      changedBy: names.get(row.changed_by) ?? {
        accountId: row.changed_by,
        login: null,
        name: null,
      },
      changedAt: new Date(row.changed_at).toISOString(),
    };
  }

  /**
   * The reason's file and the writer's assignment: the stored reason of the
   * branch, with a category, of a class the person writes (decision 6). For a
   * read, a reader of the class (decision 6; a Teacher never reads it).
   */
  private async fileScene(
    transaction: Transaction,
    access: Access,
    studentId: string,
    date: string,
    write: boolean,
  ) {
    const branchId = branchOf(access);
    const student = await transaction
      .selectFrom('students')
      .select('id')
      .where('id', '=', studentId)
      .forShare()
      .executeTakeFirst();
    if (student === undefined) throw notFound();
    const membership = await transaction
      .selectFrom('class_memberships')
      .select('class_id')
      .where('student_id', '=', student.id)
      .whereRef('valid_from', '<', 'valid_until')
      .where('valid_from', '<=', date)
      .where('valid_until', '>', date)
      .executeTakeFirst();
    if (membership === undefined) throw notFound();
    const ownClass = tutorClassesOf(access).has(lower(membership.class_id));
    const assignment = write ? writerOf(access, ownClass) : readerOf(access, ownClass);
    if (assignment === undefined) throw new ApiException('absence_scope', 403);
    const reason = await transaction
      .selectFrom('student_absence_reasons')
      .select(['id', 'category', 'file_key', 'file_type', 'file_name'])
      .where('branch_id', '=', branchId)
      .where('student_id', '=', student.id)
      .where('absence_date', '=', date)
      .forUpdate()
      .executeTakeFirst();
    if (reason?.category === null || reason === undefined) throw notFound();
    return { branchId, assignmentId: assignment.id, reason };
  }

  /** Attaches the file of a reason (task 8.5; From 6.3, decision 10): the bytes first, then the row. */
  async putFile(
    access: Access,
    studentId: string,
    date: string,
    name: string,
    file: UploadedFile | null,
    requestId: string | undefined,
  ): Promise<AbsenceReason> {
    await this.transactions.run(access.branchIds, (transaction) =>
      this.fileScene(transaction, access, studentId, date, true),
    );
    const type = checkedFile(this.store, file);
    const key = `absences/${studentId}/${date}/${randomUUID()}`;
    await putStored(this.store, key, file, type);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.fileScene(transaction, access, studentId, date, true);
      await transaction
        .updateTable('student_absence_reasons')
        .set({ file_key: key, file_type: type, file_name: name })
        .where('id', '=', scene.reason.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'absence_reason.file_add',
        record: { type: 'student', id: studentId },
        oldValue: scene.reason.file_name === null ? null : { date, name: scene.reason.file_name },
        newValue: { date, name, type, bytes: file?.bytes.length ?? 0 },
        details: { reasonId: scene.reason.id },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.answer(transaction, studentId, date, scene.reason.id);
    });
  }

  removeFile(
    access: Access,
    studentId: string,
    date: string,
    requestId: string | undefined,
  ): Promise<AbsenceReason> {
    return this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.fileScene(transaction, access, studentId, date, true);
      if (scene.reason.file_key === null) throw notFound();
      await transaction
        .updateTable('student_absence_reasons')
        .set({ file_key: null, file_type: null, file_name: null })
        .where('id', '=', scene.reason.id)
        .execute();
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'absence_reason.file_remove',
        record: { type: 'student', id: studentId },
        oldValue: { date, name: scene.reason.file_name },
        newValue: null,
        details: { reasonId: scene.reason.id },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return this.answer(transaction, studentId, date, scene.reason.id);
    });
  }

  /** The file; every opening is logged, as an exemption's document (`edge/exemptions`, row 10). */
  async readFile(
    access: Access,
    studentId: string,
    date: string,
    requestId: string | undefined,
  ): Promise<StoredFile> {
    const row = await this.transactions.run(access.branchIds, async (transaction) => {
      const scene = await this.fileScene(transaction, access, studentId, date, false);
      if (scene.reason.file_key === null) throw notFound();
      await this.audit.record(transaction, {
        branchId: scene.branchId,
        actorId: access.accountId,
        assignmentId: scene.assignmentId,
        action: 'absence_reason.file_open',
        record: { type: 'student', id: studentId },
        details: { reasonId: scene.reason.id, date },
        ...(requestId === undefined ? {} : { requestId }),
      });
      return scene.reason;
    });
    return readStored(this.store, row.file_key ?? '', row.file_type ?? '', row.file_name ?? '');
  }
}

/** The assignment a reason is written under: every class for the vice and the Super Admin, a Tutor's own. */
/**
 * The assignment named by the opening of a file: one that reads every class, else the Tutor
 * assignment that gives the own class (permission review 12, as `writerOf` does).
 */
function readerOf(access: Access, ownClass: boolean) {
  return isWhole(access, WHOLE_READERS)
    ? access.permitting.find((one) => WHOLE_READERS.includes(one.role))
    : ownClass
      ? access.permitting.find((one) => one.role === 'tutor')
      : undefined;
}

function writerOf(access: Access, ownClass: boolean) {
  return isWholeWriter(access)
    ? access.permitting.find((one) => WHOLE_WRITERS.includes(one.role))
    : ownClass
      ? access.permitting.find((one) => one.role === 'tutor')
      : undefined;
}

/** Whether an assignment of every class writes reasons (the Super Admin, the Academic Vice Principal). */
function isWholeWriter(access: Access): boolean {
  return access.assignments.some(
    (assignment) =>
      WHOLE_WRITERS.includes(assignment.role) &&
      (assignment.branchId === null || assignment.branchId === access.branchId),
  );
}

/** Whether a current assignment of the role writes reasons in the branch of the request. */
function entersReasons(access: Access, role: Role): boolean {
  return access.assignments.some(
    (assignment) =>
      assignment.role === role &&
      (assignment.branchId === null || assignment.branchId === access.branchId),
  );
}
