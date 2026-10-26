import { Inject, Injectable } from '@nestjs/common';
import {
  DISCIPLINE_DAYS_MAX,
  disciplineSchema,
  lessonsTodaySchema,
  orphanAssignmentSchema,
  orphanLessonsSchema,
  remindersSchema,
  schoolDateOf,
  type Discipline,
  type DisciplineQuery,
  type DisciplineRow,
  type LessonsToday,
  type OrphanAssign,
  type OrphanAssignment,
  type OrphanLessons,
  type Reminders,
  type Role,
} from '@sodiq/shared';
import { addDays } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { notFound, refusingConstraints } from '../setup/setup-refusals.js';
import { journalKeysOf, ownerFactsOf, ownerOn } from '../timetable/journal-owners.js';
import { ownStaffOf } from './attendance-entry.js';
import { journalRows, staffNames, type JournalRow } from './journal-grid.query.js';
import { subjectOf, unitOf } from './journal-grid.service.js';
import { lessonsCounted } from './lesson-counted.js';
import { lessonStatuses, type LessonStatusRow } from './lesson-status.query.js';
import { lessonReminders, ratingReminder } from './reminders.js';

/**
 * The reminders of the teaching home, the counts per teacher and the orphan
 * lessons (task 8.7, pull request #225; `07`, Lesson status, Reminders; `08`,
 * Journal discipline; `edge/journal`, Locks). Every figure comes from the one
 * status reader (`lessonStatuses`) and the one reader of who a lesson counts
 * for (`lessonsCounted`), worked out on read with the injected clock.
 */

/** A held candidate lesson of the branch, with what its line shows. */
interface CandidateRow {
  readonly id: string;
  readonly subject_id: string;
  readonly lesson_date: string;
  readonly start_minutes: number;
  readonly teacher_id: string | null;
}

/** Roles that read the counts of every lesson of the branch. */
const WHOLE_ROLES: readonly Role[] = ['super_admin', 'principal', 'academic_vice_principal'];

const SUBJECT_ROLES: readonly Role[] = ['head_teacher', 'senior_head_teacher'];

/** The clock of a request in a branch: the moment, the time zone and today. */
async function clockOf(
  transaction: Transaction,
  branchId: string,
): Promise<{ now: Date; timeZone: string; today: string }> {
  const branch = await transaction
    .selectFrom('branches')
    .select('time_zone')
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const now = await transactionMoment(transaction);
  return { now, timeZone: branch.time_zone, today: schoolDateOf(now, branch.time_zone) };
}

/** The academic year of the branch holding `day`, not closed; `null` when none. */
async function openYearOn(
  transaction: Transaction,
  branchId: string,
  day: string,
  closedToo = false,
): Promise<{ id: string; startDate: string; endDate: string } | null> {
  const year = await transaction
    .selectFrom('academic_years')
    .select([
      'id',
      sql<string>`start_date::text`.as('start_date'),
      sql<string>`end_date::text`.as('end_date'),
      'status',
    ])
    .where('branch_id', '=', branchId)
    .where('start_date', '<=', day)
    .where('end_date', '>=', day)
    .executeTakeFirst();
  if (year === undefined || (year.status === 'closed' && !closedToo)) return null;
  return { id: year.id, startDate: year.start_date, endDate: year.end_date };
}

/** The lessons of the branch from `from` to `to` that have started and are not cancelled. */
function startedLessons(
  transaction: Transaction,
  branchId: string,
  from: string,
  to: string,
  now: Date,
  timeZone: string,
) {
  return transaction
    .selectFrom('lessons')
    .select([
      'lessons.id',
      'lessons.subject_id',
      sql<string>`lessons.lesson_date::text`.as('lesson_date'),
      sql<number>`(extract(epoch from (lessons.starts_at at time zone ${timeZone})::time) / 60)::int`.as(
        'start_minutes',
      ),
      'lessons.teacher_id',
    ])
    .where('lessons.branch_id', '=', branchId)
    .where('lessons.lesson_date', '>=', from)
    .where('lessons.lesson_date', '<=', to)
    .where('lessons.starts_at', '<=', now)
    .where('lessons.cancel_cause', 'is', null);
}

/**
 * The subjects of the counts the reader may read (decision 6): `null` for the branch (the Super
 * Admin, the Principal, the Academic Vice Principal); own subjects for a Head Teacher and a
 * Senior Head Teacher; the subjects of the Tutor departments for the Head Tutor.
 */
async function subjectScopeOf(
  transaction: Transaction,
  access: Access,
): Promise<Set<string> | null> {
  if (access.permitting.some((one) => WHOLE_ROLES.includes(one.role))) return null;
  const scope = new Set(
    access.permitting
      .filter((one) => SUBJECT_ROLES.includes(one.role))
      .flatMap((one) => one.subjectIds),
  );
  if (access.permitting.some((one) => one.role === 'head_tutor')) {
    const tutors = await transaction
      .selectFrom('subjects')
      .innerJoin('departments', 'departments.id', 'subjects.department_id')
      .select('subjects.id')
      .where('departments.tutors', '=', true)
      .execute();
    for (const one of tutors) scope.add(one.id);
  }
  return scope;
}

@Injectable()
export class LessonStatusService {
  constructor(
    @Inject(Transactions) private readonly transactions: Transactions,
    @Inject(Audit) private readonly audit: Audit,
  ) {}

  /** The statuses, who each lesson counts for, and the journals of candidate lessons. */
  private async statusesOf(
    transaction: Transaction,
    branchId: string,
    rows: readonly CandidateRow[],
    now: Date,
  ): Promise<{
    statuses: Map<string, LessonStatusRow>;
    counted: Map<string, string | null>;
    journals: Map<string, JournalRow>;
  }> {
    const statuses = await lessonStatuses(
      transaction,
      branchId,
      rows.map((row) => row.id),
      now,
    );
    const counted = await lessonsCounted(
      transaction,
      branchId,
      rows.map((row) => ({
        id: row.id,
        journalId: statuses.get(row.id)?.journalId ?? null,
        date: row.lesson_date,
        teacherId: row.teacher_id,
      })),
    );
    const journalIds = [
      ...new Set(
        [...statuses.values()].flatMap((one) => (one.journalId === null ? [] : [one.journalId])),
      ),
    ];
    const journals = new Map(
      (await journalRows(transaction, branchId, { journalIds })).map((one) => [one.id, one]),
    );
    return { statuses, counted, journals };
  }

  /** A lesson as a line names it (`statusLessonSchema`), with the subject of a lesson outside every journal. */
  private async describer(
    transaction: Transaction,
    rows: readonly CandidateRow[],
    statuses: ReadonlyMap<string, LessonStatusRow>,
    journals: ReadonlyMap<string, JournalRow>,
  ): Promise<(row: CandidateRow) => Record<string, unknown>> {
    const loose = rows.filter((row) => !journals.has(statuses.get(row.id)?.journalId ?? ''));
    const subjects =
      loose.length === 0
        ? []
        : await transaction
            .selectFrom('subjects')
            .select(['id', 'name_uz', 'name_ru', 'name_en', 'colour'])
            .where('id', 'in', [...new Set(loose.map((row) => row.subject_id))])
            .execute();
    const subjectById = new Map(subjects.map((one) => [one.id, one]));
    return (row) => {
      const journal = journals.get(statuses.get(row.id)?.journalId ?? '');
      const subject = subjectById.get(row.subject_id);
      return {
        id: row.id,
        journalId: journal?.id ?? null,
        date: row.lesson_date,
        start: row.start_minutes,
        unit: journal === undefined ? null : unitOf(journal),
        subject:
          journal !== undefined
            ? subjectOf(journal)
            : {
                id: row.subject_id,
                names: {
                  uz: subject?.name_uz ?? '',
                  ru: subject?.name_ru ?? '',
                  en: subject?.name_en ?? '',
                },
                colour: subject?.colour ?? '',
              },
      };
    };
  }

  /**
   * The caller's own reminders in the branch of the request (decisions 12 and 13): the held
   * lessons of the open year up to now that count for the caller, or that are assigned to
   * the caller as orphan lessons; and the rating exams of the journals the caller owns today.
   */
  ownReminders(access: Access): Promise<Reminders> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { now, timeZone, today } = await clockOf(transaction, branchId);
      const staffId = await ownStaffOf(transaction, access.accountId);
      const year = await openYearOn(transaction, branchId, today);
      if (staffId === null || year === null) return remindersSchema.parse({ today, reminders: [] });
      const acting = await transaction
        .selectFrom('journal_acting_teachers')
        .innerJoin('journals', 'journals.id', 'journal_acting_teachers.journal_id')
        .select(['journals.subject_id', 'journals.class_id', 'journals.group_id'])
        .where('journal_acting_teachers.person_id', '=', staffId)
        .where('journals.academic_year_id', '=', year.id)
        .execute();
      const assigned = (
        await transaction
          .selectFrom('journal_orphan_assignments')
          .select('lesson_id')
          .where('staff_id', '=', staffId)
          .where('withdrawn_at', 'is', null)
          .where('assigned_at', '<=', now)
          .where('open_until', '>', now)
          .execute()
      ).map((row) => row.lesson_id);
      const rows: CandidateRow[] = await startedLessons(
        transaction,
        branchId,
        year.startDate,
        today,
        now,
        timeZone,
      )
        .where((eb) =>
          eb.or([
            eb('lessons.teacher_id', '=', staffId),
            ...(assigned.length === 0 ? [] : [eb('lessons.id', 'in', assigned)]),
            ...acting.map((one) =>
              eb.and([
                eb('lessons.subject_id', '=', one.subject_id),
                one.class_id === null
                  ? eb('lessons.group_id', '=', one.group_id)
                  : eb('lessons.class_id', '=', one.class_id),
              ]),
            ),
          ]),
        )
        .execute();
      const { statuses, counted, journals } = await this.statusesOf(
        transaction,
        branchId,
        rows,
        now,
      );
      const assignedSet = new Set(assigned);
      const own = rows.filter((row) => counted.get(row.id) === staffId || assignedSet.has(row.id));
      const describe = await this.describer(transaction, own, statuses, journals);
      const reminders: unknown[] = lessonReminders(
        own.flatMap((row) => {
          const status = statuses.get(row.id);
          return status === undefined
            ? []
            : [
                {
                  lesson: describe(row) as { id: string; date: string; start: number },
                  row: status,
                },
              ];
        }),
        now,
      );
      // The rating exams of the journals the caller owns today (`07`: the teacher enters them).
      const ownedJournals = [
        ...new Set(own.flatMap((row) => statuses.get(row.id)?.journalId ?? [])),
      ];
      const facts = await ownerFactsOf(
        transaction,
        branchId,
        await journalKeysOf(transaction, branchId, ownedJournals),
      );
      for (const journalId of ownedJournals) {
        const owner = ownerOn(
          facts.runs.get(journalId) ?? [],
          facts.periods.get(journalId) ?? [],
          facts.out,
          today,
        );
        const journal = journals.get(journalId);
        if (
          journal === undefined ||
          owner === null ||
          owner.kind === 'none' ||
          owner.staffId !== staffId
        ) {
          continue;
        }
        const rated = await ratingReminder(transaction, journal, today, (one) => ({
          id: one.id,
          unit: unitOf(one),
          subject: subjectOf(one),
        }));
        if (rated !== null) reminders.push(rated);
      }
      return remindersSchema.parse({ today, reminders });
    });
  }

  /**
   * The lessons of today and their status (task 9.4b; `08`, Home pages by role, Academic Vice
   * Principal: "Lessons today and their status"; From 8.7): the same status reader and the same
   * scope as the counts per teacher. The held lessons by status, the incomplete ones named with
   * the teacher each counts for (`lessonsCounted`), and the lessons whose start has not come.
   */
  today(access: Access): Promise<LessonsToday> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { now, timeZone, today } = await clockOf(transaction, branchId);
      const scope = await subjectScopeOf(transaction, access);
      const subjects = scope === null ? null : [...scope];
      if (subjects !== null && subjects.length === 0) {
        return lessonsTodaySchema.parse({
          date: today,
          ahead: 0,
          held: 0,
          notStarted: 0,
          inProgress: 0,
          complete: 0,
          incomplete: [],
        });
      }
      let started = startedLessons(transaction, branchId, today, today, now, timeZone);
      if (subjects !== null) started = started.where('lessons.subject_id', 'in', subjects);
      const rows: CandidateRow[] = await started.execute();
      let later = transaction
        .selectFrom('lessons')
        .select((eb) => eb.fn.countAll<string>().as('count'))
        .where('branch_id', '=', branchId)
        .where('lesson_date', '=', today)
        .where('starts_at', '>', now)
        .where('cancel_cause', 'is', null);
      if (subjects !== null) later = later.where('subject_id', 'in', subjects);
      const ahead = Number((await later.executeTakeFirstOrThrow()).count);
      const { statuses, counted, journals } = await this.statusesOf(
        transaction,
        branchId,
        rows,
        now,
      );
      const describe = await this.describer(transaction, rows, statuses, journals);
      const counts = { held: 0, notStarted: 0, inProgress: 0, complete: 0 };
      const incomplete: { row: CandidateRow; staffId: string | null; status: string }[] = [];
      for (const row of rows) {
        const answer = statuses.get(row.id)?.answer ?? null;
        if (answer === null) continue;
        counts.held += 1;
        if (answer.status === 'not_started') counts.notStarted += 1;
        if (answer.status === 'in_progress') counts.inProgress += 1;
        if (answer.status === 'complete') counts.complete += 1;
        if (answer.status !== 'complete') {
          incomplete.push({ row, staffId: counted.get(row.id) ?? null, status: answer.status });
        }
      }
      const names = await staffNames(transaction, [
        ...new Set(incomplete.flatMap((one) => (one.staffId === null ? [] : [one.staffId]))),
      ]);
      incomplete.sort(
        (a, b) => a.row.start_minutes - b.row.start_minutes || (a.row.id < b.row.id ? -1 : 1),
      );
      return lessonsTodaySchema.parse({
        date: today,
        ahead,
        ...counts,
        incomplete: incomplete.map((one) => ({
          lesson: { ...describe(one.row), status: one.status },
          teacher:
            one.staffId === null ? null : { id: one.staffId, name: names.get(one.staffId) ?? '' },
        })),
      });
    });
  }

  /**
   * The counts per teacher (decisions 6 and 14 with correction 1): the held lessons dated in
   * the range that the reader may read, counted for the teacher each counts for. The scope
   * is the branch for the Super Admin, the Principal and the Academic Vice Principal; own
   * subjects for a Head Teacher and a Senior Head Teacher; the subjects of the Tutor
   * departments for the Head Tutor. The department filter takes the lessons of that
   * department's subjects.
   */
  discipline(access: Access, query: DisciplineQuery): Promise<Discipline> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const { now, timeZone } = await clockOf(transaction, branchId);
      // Any academic year, a closed one too (spec review should-fix 1).
      const year = await openYearOn(transaction, branchId, query.from, true);
      if (
        addDays(query.from, DISCIPLINE_DAYS_MAX - 1) < query.to ||
        year === null ||
        query.to > year.endDate
      ) {
        throw new ApiException('discipline_range', 409);
      }
      const scope = await subjectScopeOf(transaction, access);
      const subjects = await transaction
        .selectFrom('subjects')
        .innerJoin('departments', 'departments.id', 'subjects.department_id')
        .select([
          'subjects.id',
          'subjects.department_id',
          'departments.name_uz',
          'departments.name_ru',
          'departments.name_en',
          'departments.position',
          'departments.archived_at',
        ])
        .execute();
      const readable = subjects.filter((one) => scope === null || scope.has(one.id));
      if (
        query.departmentId !== undefined &&
        !readable.some((one) => one.department_id === query.departmentId?.toLowerCase())
      ) {
        throw notFound();
      }
      const chosen = readable
        .filter(
          (one) =>
            query.departmentId === undefined ||
            one.department_id === query.departmentId.toLowerCase(),
        )
        .map((one) => one.id);
      const rows: CandidateRow[] =
        chosen.length === 0
          ? []
          : await startedLessons(transaction, branchId, query.from, query.to, now, timeZone)
              .where('lessons.subject_id', 'in', chosen)
              .execute();
      const { statuses, counted } = await this.statusesOf(transaction, branchId, rows, now);
      const empty = (): Omit<DisciplineRow, 'teacher'> => ({
        held: 0,
        notStarted: 0,
        inProgress: 0,
        complete: 0,
        lockedIncomplete: 0,
        noAttendance: 0,
        noTopic: 0,
        worksMissing: 0,
        unplanned: 0,
        lateEntries: 0,
      });
      const byTeacher = new Map<string, Omit<DisciplineRow, 'teacher'>>();
      const count = (staffId: string) => {
        const found = byTeacher.get(staffId) ?? empty();
        byTeacher.set(staffId, found);
        return found;
      };
      for (const row of rows) {
        const staffId = counted.get(row.id) ?? null;
        const status = statuses.get(row.id);
        if (staffId === null || status?.answer === null || status === undefined) continue;
        const answer = status.answer;
        const into = count(staffId) as Record<keyof Omit<DisciplineRow, 'teacher'>, number>;
        into.held += 1;
        if (answer.status === 'not_started') into.notStarted += 1;
        if (answer.status === 'in_progress') into.inProgress += 1;
        if (answer.status === 'complete') into.complete += 1;
        if (answer.status === 'locked_incomplete') into.lockedIncomplete += 1;
        if (answer.unmarked > 0) into.noAttendance += 1;
        if (status.noTopic) into.noTopic += 1;
        into.worksMissing += answer.worksMissing;
        into.unplanned += status.unplanned;
      }
      // "Entries made after the edit period" (From 8.4): the history lines written under the
      // person's own unlock, never a correction, an optional cell or an orphan assignment.
      const lessonIds = rows.map((row) => row.id);
      const late =
        lessonIds.length === 0
          ? []
          : (
              await sql<{ staff_id: string; lines: string }>`
                select u.staff_id, count(*)::text as lines
                from (
                  select unlock_id from journal_cell_history
                  where lesson_id = any(${lessonIds}::uuid[]) and changed_how = 'late_entry'
                    and unlock_id is not null
                  union all
                  select unlock_id from journal_work_history
                  where lesson_id = any(${lessonIds}::uuid[]) and changed_how = 'late_entry'
                    and unlock_id is not null
                  union all
                  select unlock_id from journal_comment_history
                  where lesson_id = any(${lessonIds}::uuid[]) and changed_how = 'late_entry'
                    and unlock_id is not null
                ) h
                join journal_unlocks u on u.id = h.unlock_id
                group by u.staff_id
              `.execute(transaction)
            ).rows;
      for (const one of late) {
        (count(one.staff_id) as { lateEntries: number }).lateEntries += Number(one.lines);
      }
      const names = await staffNames(transaction, [...byTeacher.keys()]);
      const departments = [
        ...new Map(
          readable
            .filter((one) => one.archived_at === null)
            .map((one) => [
              one.department_id,
              {
                position: one.position,
                name: { uz: one.name_uz, ru: one.name_ru, en: one.name_en },
              },
            ]),
        ),
      ]
        .sort((a, b) => a[1].position - b[1].position)
        .map(([id, one]) => ({ id, names: one.name }));
      return disciplineSchema.parse({
        from: query.from,
        to: query.to,
        departments,
        teachers: [...byTeacher]
          .map(([id, counts]) => ({ teacher: { id, name: names.get(id) ?? '' }, ...counts }))
          .sort(
            (a, b) =>
              a.teacher.name.localeCompare(b.teacher.name, 'en') ||
              a.teacher.id.localeCompare(b.teacher.id),
          ),
      });
    });
  }

  /**
   * The people out of the school now among the teachers of the branch's lessons of the year
   * and the acting teachers of its journals (`staff_out_for_good`, which answers whatever
   * the membership filter lets the request see: a person unlinked from the branch before
   * leaving is found too, `.claude/rules/database.md`).
   */
  private async outOfSchool(
    transaction: Transaction,
    branchId: string,
    year: { id: string; startDate: string; endDate: string },
    now: Date,
  ): Promise<Set<string>> {
    const { rows } = await sql<{ id: string }>`
      select distinct candidates.id from (
        select l.teacher_id as id from lessons l
        where l.branch_id = ${branchId}::uuid and l.teacher_id is not null
          and l.lesson_date between ${year.startDate}::date and ${year.endDate}::date
        union
        select a.person_id from journal_acting_teachers a
        join journals j on j.id = a.journal_id
        where j.branch_id = ${branchId}::uuid and j.academic_year_id = ${year.id}::uuid
      ) candidates
      where staff_out_for_good(candidates.id, ${now})
    `.execute(transaction);
    return new Set(rows.map((row) => row.id));
  }

  /** The orphan lessons of the open year: held, not complete, counted for a person out of the school. */
  private async orphansOf(
    transaction: Transaction,
    branchId: string,
    clock: { now: Date; timeZone: string; today: string },
    lessonId?: string,
  ) {
    const year = await openYearOn(transaction, branchId, clock.today);
    const out =
      year === null
        ? new Set<string>()
        : await this.outOfSchool(transaction, branchId, year, clock.now);
    if (year === null || out.size === 0)
      return {
        rows: [] as CandidateRow[],
        statuses: new Map<string, LessonStatusRow>(),
        counted: new Map<string, string | null>(),
        journals: new Map<string, JournalRow>(),
        out,
      };
    const acting = await transaction
      .selectFrom('journal_acting_teachers')
      .innerJoin('journals', 'journals.id', 'journal_acting_teachers.journal_id')
      .select(['journals.subject_id', 'journals.class_id', 'journals.group_id'])
      .where('journal_acting_teachers.person_id', 'in', [...out])
      .where('journals.academic_year_id', '=', year.id)
      .execute();
    let query = startedLessons(
      transaction,
      branchId,
      year.startDate,
      clock.today,
      clock.now,
      clock.timeZone,
    ).where((eb) =>
      eb.or([
        eb('lessons.teacher_id', 'in', [...out]),
        ...acting.map((one) =>
          eb.and([
            eb('lessons.subject_id', '=', one.subject_id),
            one.class_id === null
              ? eb('lessons.group_id', '=', one.group_id)
              : eb('lessons.class_id', '=', one.class_id),
          ]),
        ),
      ]),
    );
    if (lessonId !== undefined) query = query.where('lessons.id', '=', lessonId);
    const candidates: CandidateRow[] = await query.execute();
    const { statuses, counted, journals } = await this.statusesOf(
      transaction,
      branchId,
      candidates,
      clock.now,
    );
    const rows = candidates.filter((row) => {
      const staffId = counted.get(row.id) ?? null;
      const answer = statuses.get(row.id)?.answer ?? null;
      return (
        staffId !== null && out.has(staffId) && answer !== null && answer.status !== 'complete'
      );
    });
    return { rows, statuses, counted, journals, out };
  }

  /** The persons of the branch active today, who may be assigned. */
  private async activeTeachers(transaction: Transaction, today: string) {
    const rows = await transaction
      .selectFrom('staff')
      .select('id')
      .where('kind', '=', 'person')
      .where((eb) =>
        eb.not(
          eb.exists(
            eb
              .selectFrom('staff_statuses')
              .select('staff_statuses.id')
              .whereRef('staff_statuses.staff_id', '=', 'staff.id')
              .where('staff_statuses.status', 'in', ['inactive', 'left'])
              .where('staff_statuses.valid_from', '<=', today)
              .where((inner) =>
                inner.or([
                  inner('staff_statuses.valid_until', 'is', null),
                  inner('staff_statuses.valid_until', '>', today),
                ]),
              ),
          ),
        ),
      )
      .execute();
    const names = await staffNames(
      transaction,
      rows.map((row) => row.id),
    );
    return rows
      .map((row) => ({ id: row.id, name: names.get(row.id) ?? '' }))
      .sort((a, b) => a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  }

  private async assignmentsOf(
    transaction: Transaction,
    lessonIds: readonly string[],
    now: Date,
  ): Promise<Map<string, OrphanAssignment>> {
    const found = new Map<string, OrphanAssignment>();
    if (lessonIds.length === 0) return found;
    const rows = await transaction
      .selectFrom('journal_orphan_assignments')
      .select(['id', 'lesson_id', 'staff_id', 'reason', 'days', 'open_until', 'assigned_at'])
      .where('lesson_id', 'in', [...lessonIds])
      .where('withdrawn_at', 'is', null)
      .where('open_until', '>', now)
      .execute();
    const names = await staffNames(
      transaction,
      rows.map((row) => row.staff_id),
    );
    for (const row of rows) {
      found.set(
        row.lesson_id,
        orphanAssignmentSchema.parse({
          id: row.id,
          teacher: { id: row.staff_id, name: names.get(row.staff_id) ?? '' },
          reason: row.reason,
          days: row.days,
          openUntil: new Date(row.open_until).toISOString(),
          assignedAt: new Date(row.assigned_at).toISOString(),
        }),
      );
    }
    return found;
  }

  /** The orphan lessons list (`edge/journal`, Locks; decision 15). */
  orphans(access: Access): Promise<OrphanLessons> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const clock = await clockOf(transaction, branchId);
      const { rows, statuses, counted, journals } = await this.orphansOf(
        transaction,
        branchId,
        clock,
      );
      const describe = await this.describer(transaction, rows, statuses, journals);
      const assignments = await this.assignmentsOf(
        transaction,
        rows.map((row) => row.id),
        clock.now,
      );
      const names = await staffNames(transaction, [
        ...new Set(rows.flatMap((row) => counted.get(row.id) ?? [])),
      ]);
      const sorted = [...rows].sort(
        (a, b) =>
          a.lesson_date.localeCompare(b.lesson_date) ||
          a.start_minutes - b.start_minutes ||
          a.id.localeCompare(b.id),
      );
      return orphanLessonsSchema.parse({
        lessons: sorted.map((row) => {
          const teacherId = counted.get(row.id) ?? '';
          return {
            lesson: { ...describe(row), status: statuses.get(row.id)?.answer?.status },
            teacher: { id: teacherId, name: names.get(teacherId) ?? '' },
            assignment: assignments.get(row.id) ?? null,
          };
        }),
        teachers: await this.activeTeachers(transaction, clock.today),
      });
    });
  }

  /**
   * Assigns a teacher to complete an orphan lesson, with a reason, for 1 to 7 days (decisions
   * 4 and 15): 404 for a lesson or a staff record of another branch or unknown, 409
   * `orphan_not_orphan` for a lesson that is not one now, 409 `orphan_teacher_inactive` for a
   * person not active in the branch today (0129). An open assignment of the lesson is
   * withdrawn first. One audit entry `journal.orphan_assign`.
   */
  assign(
    access: Access,
    lessonId: string,
    input: OrphanAssign,
    requestId?: string,
  ): Promise<OrphanAssignment> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const lesson = await transaction
        .selectFrom('lessons')
        .select('id')
        .where('id', '=', lessonId)
        .where('branch_id', '=', branchId)
        .forShare()
        .executeTakeFirst();
      if (lesson === undefined) throw notFound();
      const staff = await transaction
        .selectFrom('staff')
        .select(['id', 'kind'])
        .where('id', '=', input.staffId)
        .executeTakeFirst();
      if (staff === undefined) throw notFound();
      if (staff.kind !== 'person') throw new ApiException('orphan_teacher_inactive', 409);
      // Nobody assigns the lesson to themselves: it would open a locked lesson to the person
      // with no reason on each entry (`02`, Own requests; permission review should-fix 2).
      if (staff.id === (await ownStaffOf(transaction, access.accountId))) {
        throw new ApiException('own_request', 403);
      }
      const clock = await clockOf(transaction, branchId);
      const { rows } = await this.orphansOf(transaction, branchId, clock, lesson.id);
      if (rows.length === 0) throw new ApiException('orphan_not_orphan', 409);
      const before = await transaction
        .updateTable('journal_orphan_assignments')
        .set({ withdrawn_by: access.accountId })
        .where('lesson_id', '=', lesson.id)
        .where('withdrawn_at', 'is', null)
        .returning(['id'])
        .execute();
      const written = await refusingConstraints(
        () =>
          transaction
            .insertInto('journal_orphan_assignments')
            .values({
              branch_id: branchId,
              lesson_id: lesson.id,
              staff_id: staff.id,
              reason: input.reason,
              days: input.days,
              assigned_by: access.accountId,
              // Overwritten by journal_orphan_assignments_write.
              assigned_at: new Date(0),
              open_until: new Date(0),
            })
            .returning(['id'])
            .executeTakeFirstOrThrow(),
        { orphan_teacher_inactive: 'orphan_teacher_inactive' },
      );
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'journal.orphan_assign',
        record: { type: 'lesson', id: lesson.id },
        newValue: {
          assignmentId: written.id,
          staffId: staff.id,
          days: input.days,
          reason: input.reason,
          withdrawn: before.map((one) => one.id),
        },
        ...(requestId === undefined ? {} : { requestId }),
      });
      const found = (await this.assignmentsOf(transaction, [lesson.id], clock.now)).get(lesson.id);
      if (found === undefined) throw new Error('The assignment just written is open.');
      return found;
    });
  }

  /** Withdraws an orphan lesson's assignment: 404 outside the branch, 409 once withdrawn. */
  withdraw(access: Access, assignmentId: string, requestId?: string): Promise<void> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const row = await transaction
        .selectFrom('journal_orphan_assignments')
        .select(['id', 'lesson_id', 'withdrawn_at'])
        .where('id', '=', assignmentId)
        .where('branch_id', '=', branchId)
        .forUpdate()
        .executeTakeFirst();
      if (row === undefined) throw notFound();
      if (row.withdrawn_at !== null) throw new ApiException('orphan_assignment_withdrawn', 409);
      await transaction
        .updateTable('journal_orphan_assignments')
        .set({ withdrawn_by: access.accountId })
        .where('id', '=', row.id)
        .execute();
      await this.audit.record(transaction, {
        branchId,
        actorId: access.accountId,
        assignmentId: access.assignmentId,
        action: 'journal.orphan_withdraw',
        record: { type: 'lesson', id: row.lesson_id },
        newValue: { assignmentId: row.id },
        ...(requestId === undefined ? {} : { requestId }),
      });
    });
  }
}
