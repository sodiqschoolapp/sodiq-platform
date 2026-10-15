import { Injectable } from '@nestjs/common';
import {
  academicYearName,
  academicYearStatusSchema,
  loadProblemSchema,
  schoolDateOf,
  timetableVersionStatusSchema,
  type ErrorCode,
  type ErrorDetail,
  type Load,
  type LoadRow,
  type LoadRowEdit,
  type LoadRowRecord,
  type LoadTeachers,
  type LoadTeachersQuery,
  type LoadTotals,
  type TimetableVersion,
  type TimetableVersionCreate,
  type TimetableVersionEdit,
  type TimetableVersionList,
} from '@sodiq/shared';
import {
  BLOCK_PROBLEM_ORDER,
  blockOf,
  blockProblems,
  classWeekLessons,
  firstOn,
  freeSlots,
  lessonIntervals,
  loadBlocks,
  loadRowProblems,
  refusingProblems,
  ROOM_PROBLEMS,
  splitAndWhole,
  splitClassOf,
  TEACHER_PROBLEMS,
  teacherProblems,
  teacherWeekLessons,
  weekDaysOf,
  weekLessonSlots,
  type BlockProblem,
  type WeekDay,
  type LoadProblem,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { z } from 'zod';
import { Transactions, transactionMoment, type Transaction } from '../../database/transactions.js';
import type { JsonValue } from '../../database/types.generated.js';
import { ApiException } from '../../http/api-exception.js';
import type { Access } from '../access/permission.guard.js';
import { Audit } from '../audit/audit.service.js';
import { branchOf } from '../classes/classes.service.js';
import { changesOf, notFound, refusingConstraints } from '../setup/setup-refusals.js';
import {
  LOAD_REFUSALS,
  LoadFacts,
  readClassFacts,
  readGroupFacts,
  readRoomFacts,
  readSubjectFacts,
  readTeacherFacts,
  sharedSlotOf,
  type StoredLoadRow,
  type UnitFacts,
  type VersionContext,
} from './load-facts.js';
import { blockRowOf, readBlockGroups } from './load-blocks.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { isWithdrawn } from '../setup/dated-rows.js';

const refused = (code: ErrorCode): ApiException => new ApiException(code, 409);

/**
 * The subjects of rows about to be written FOR KEY SHARE in the order of their
 * id, in a statement before the write (task 3.4c, decision 6 of pull request
 * #101): a department move of a subject (FOR UPDATE) waits for the write or is
 * waited for, so a Tutor row never slips in while its subject leaves the
 * Tutors department.
 */
async function lockSubjects(transaction: Transaction, ids: readonly string[]): Promise<void> {
  const sorted = [...new Set(ids.map((id) => id.toLowerCase()))].sort();
  if (sorted.length === 0) {
    return;
  }
  await transaction
    .selectFrom('subjects')
    .select('id')
    .where('id', 'in', sorted)
    .orderBy('id')
    .forKeyShare()
    .execute();
}

/** A row a copy left on the draft (decision 10), as stored in `left_rows`. */
const leftRowSchema = z.object({
  sourceRowId: z.uuid(),
  classId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  subjectId: z.uuid(),
  teacherId: z.uuid(),
  lessonsPerWeek: z.int(),
  roomId: z.uuid().nullable(),
  roomType: z.string().nullable(),
  doubleLessons: z.boolean(),
  // Task 3.4b: absent from the rows a copy left before 0056.
  mixedBlock: z.boolean().default(false),
  problems: z.array(loadProblemSchema),
});

type LeftRow = z.infer<typeof leftRowSchema>;

const leftRowsOf = (stored: unknown): LeftRow[] => z.array(leftRowSchema).parse(stored);

const storedOfLeft = (left: LeftRow): StoredLoadRow => ({
  id: left.sourceRowId,
  class_id: left.classId,
  group_id: left.groupId,
  subject_id: left.subjectId,
  teacher_id: left.teacherId,
  lessons_per_week: left.lessonsPerWeek,
  room_id: left.roomId,
  room_type: left.roomType,
  double_lessons: left.doubleLessons,
  mixed_block: left.mixedBlock,
});

/** A version with its year and branch, as the routes read it. */
interface VersionRow {
  id: string;
  branch_id: string;
  academic_year_id: string;
  number: number;
  status: string;
  starts_on: string;
  from_version_id: string | null;
  left_rows: unknown;
  start_date: string;
  end_date: string;
  year_status: string;
  time_zone: string;
}

/** The fields of a row as the audit entries record them. */
const fieldsOf = (row: StoredLoadRow) => ({
  classId: row.class_id,
  groupId: row.group_id,
  subjectId: row.subject_id,
  teacherId: row.teacher_id,
  lessonsPerWeek: row.lessons_per_week,
  roomId: row.room_id,
  roomType: row.room_type,
  doubleLessons: row.double_lessons,
  mixedBlock: row.mixed_block,
});

const ROW_COLUMNS = [
  'id',
  'class_id',
  'group_id',
  'subject_id',
  'teacher_id',
  'lessons_per_week',
  'room_id',
  'room_type',
  'double_lessons',
  'mixed_block',
] as const;

/** The id a row being created stands under while its block is read (no stored row has it). */
const NEW_ROW_ID = '00000000-0000-0000-0000-000000000000';

/**
 * The rows of a copy that pass (decision 10 of 3.4a; decision 10 of 3.4b, by a
 * rule that never depends on row order): a row with a problem of its own is
 * left with it; a group row of a class and subject that a copied class row
 * holds is left with `load_split_and_whole` (the class row is copied); then
 * every part of a block whose parts break a block rule is left, each with its
 * own block problems, or those of the block when it has none. What is copied
 * passes the database's commit check (0056).
 */
function copiedRows(
  rows: readonly StoredLoadRow[],
  facts: LoadFacts,
  leave: (row: StoredLoadRow, problems: readonly LoadProblem[]) => void,
): StoredLoadRow[] {
  const passing: StoredLoadRow[] = [];
  for (const row of rows) {
    const problems = facts.problemsOf(row);
    if (problems.length === 0) {
      passing.push(row);
    } else {
      leave(row, problems);
    }
  }
  const classRows = passing.filter((row) => row.class_id !== null);
  const kept: StoredLoadRow[] = [...classRows];
  const groupRows: StoredLoadRow[] = [];
  for (const row of passing.filter((one) => one.group_id !== null)) {
    const candidates = [...classRows, row].map(blockRowOf);
    const own = candidates.at(-1);
    if (own !== undefined && splitAndWhole(own, candidates, facts.groups)) {
      leave(row, ['load_split_and_whole']);
    } else {
      groupRows.push(row);
    }
  }
  const asBlocks = groupRows.map(blockRowOf);
  for (const ids of loadBlocks(asBlocks, facts.groups)) {
    const parts = groupRows.filter((row) => ids.includes(row.id));
    const partBlock = asBlocks.filter((row) => ids.includes(row.id));
    const problems = new Map(
      partBlock.map((row) => [row.id, blockProblems(row, partBlock, facts.groups)]),
    );
    const all = BLOCK_PROBLEM_ORDER.filter((problem) =>
      [...problems.values()].some((one) => one.includes(problem)),
    );
    if (all.length === 0) {
      kept.push(...parts);
    } else {
      for (const part of parts) {
        const own = problems.get(part.id) ?? [];
        leave(part, own.length > 0 ? own : all);
      }
    }
  }
  return rows.filter((row) => kept.includes(row));
}

/**
 * Draft timetable versions and their teaching load (docs/spec/05, Teaching
 * load; 06, Model and Building a timetable; edge/timetable, Versions and
 * drafts; task 3.4a, pull request #99). Every route works for the branch of
 * the request; a version, row, class, group, subject, teacher or room that is
 * not of the branch is 404.
 *
 * Lock order, the same on every path (year before version): a load write
 * locks the version's year FOR SHARE, then the version FOR UPDATE, then the
 * teacher's record FOR KEY SHARE, then reads; a version create locks the year
 * FOR UPDATE, then the version copied FOR SHARE; a version edit locks the year
 * FOR SHARE, then the version FOR UPDATE. The rules come from the one rule
 * engine (`loadRowProblems`); the database keeps the same ones (0055).
 */
@Injectable()
export class Timetable {
  constructor(
    private readonly transactions: Transactions,
    private readonly audit: Audit,
  ) {}

  /** The versions of the branch, newest year first, by number. */
  list(access: Access): Promise<TimetableVersionList> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const rows = await this.versionsIn(transaction)
        .orderBy('academic_years.start_date', 'desc')
        .orderBy('timetable_versions.number', 'desc')
        .execute();
      return {
        versions: await this.answersOf(transaction, rows),
        today: await this.todayIn(transaction, branchId),
      };
    });
  }

  /**
   * A new draft (decisions 5 and 10): empty, or a copy of a version of the
   * same branch and year whose rows are checked again by the engine on the
   * draft's start date; the rows that pass are copied, the others kept in
   * `left_rows` with their problems.
   */
  createVersion(
    access: Access,
    input: TimetableVersionCreate,
    requestId: string,
  ): Promise<TimetableVersion> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const locked = await transaction
            .selectFrom('academic_years')
            .select('id')
            .where('id', '=', input.academicYearId)
            .where('branch_id', '=', branchId)
            .forUpdate()
            .executeTakeFirst();
          if (locked === undefined) {
            throw notFound();
          }
          let source: VersionRow | undefined;
          if (input.copyFrom !== null) {
            const found = await transaction
              .selectFrom('timetable_versions')
              .select('id')
              .where('id', '=', input.copyFrom)
              .where('branch_id', '=', branchId)
              .forShare()
              .executeTakeFirst();
            if (found === undefined) {
              throw notFound();
            }
            source = await this.versionRow(transaction, input.copyFrom);
          }
          const year = await transaction
            .selectFrom('academic_years')
            .innerJoin('branches', 'branches.id', 'academic_years.branch_id')
            .select([
              'academic_years.status',
              'academic_years.start_date',
              'academic_years.end_date',
              'branches.time_zone',
            ])
            .where('academic_years.id', '=', input.academicYearId)
            .executeTakeFirstOrThrow();
          if (year.status === 'closed') {
            throw refused('timetable_year_closed');
          }
          if (source !== undefined && source.academic_year_id !== input.academicYearId) {
            throw refused('version_copy_year');
          }
          await this.checkStart(transaction, branchId, input.startsOn, year);
          const last = await transaction
            .selectFrom('timetable_versions')
            .select((builder) => builder.fn.max('number').as('number'))
            .where('academic_year_id', '=', input.academicYearId)
            .executeTakeFirst();
          const number = (last?.number ?? 0) + 1;
          const context: VersionContext = {
            branchId,
            yearId: input.academicYearId,
            startsOn: input.startsOn,
            // The start date is on or after today (decision 5).
            statusOn: input.startsOn,
            timeZone: year.time_zone,
          };
          const copied: StoredLoadRow[] = [];
          const left: LeftRow[] = [];
          if (source !== undefined) {
            const rows = await this.rowsOf(transaction, source.id);
            // The teachers FOR KEY SHARE in the order of their id before their
            // statuses are read, as a row write does, so a vacancy close at the
            // same moment leaves its row in `left_rows` rather than failing
            // the copy (spec review of the build, should-fix 6).
            const teacherIds = [...new Set(rows.map((row) => row.teacher_id))].sort();
            if (teacherIds.length > 0) {
              await transaction
                .selectFrom('staff')
                .select('id')
                .where('id', 'in', teacherIds)
                .orderBy('id')
                .forKeyShare()
                .execute();
            }
            await lockSubjects(
              transaction,
              rows.map((row) => row.subject_id),
            );
            const facts = await LoadFacts.of(transaction, context, rows);
            const leave = (row: StoredLoadRow, problems: readonly LoadProblem[]) => {
              left.push({
                sourceRowId: row.id,
                classId: row.class_id,
                groupId: row.group_id,
                subjectId: row.subject_id,
                teacherId: row.teacher_id,
                lessonsPerWeek: row.lessons_per_week,
                roomId: row.room_id,
                roomType: row.room_type,
                doubleLessons: row.double_lessons,
                mixedBlock: row.mixed_block,
                problems: [...problems],
              });
            };
            for (const row of copiedRows(rows, facts, leave)) {
              copied.push(row);
            }
          }
          const created = await transaction
            .insertInto('timetable_versions')
            .values({
              branch_id: branchId,
              academic_year_id: input.academicYearId,
              number,
              starts_on: input.startsOn,
              from_version_id: source?.id ?? null,
              left_rows: JSON.stringify(left),
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          for (const row of copied) {
            await transaction
              .insertInto('teaching_load_rows')
              .values({
                branch_id: branchId,
                version_id: created.id,
                class_id: row.class_id,
                group_id: row.group_id,
                subject_id: row.subject_id,
                teacher_id: row.teacher_id,
                lessons_per_week: row.lessons_per_week,
                room_id: row.room_id,
                room_type: row.room_type,
                double_lessons: row.double_lessons,
                mixed_block: row.mixed_block,
              })
              .execute();
          }
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'timetable_version.create',
            record: { type: 'timetable_version', id: created.id },
            newValue: {
              academicYearId: input.academicYearId,
              number,
              startsOn: input.startsOn,
              fromVersionId: source?.id ?? null,
              copiedRows: copied.map((row) => row.id),
              leftRows: left as unknown as JsonValue,
            },
            requestId,
          });
          return this.answerOf(transaction, created.id);
        }),
      LOAD_REFUSALS,
    );
  }

  /** The start date of a draft, or the dismissal of the rows its copy left (decision 10). */
  editVersion(
    access: Access,
    id: string,
    input: TimetableVersionEdit,
    requestId: string,
  ): Promise<TimetableVersion> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const version = await this.lockDraft(transaction, branchId, id);
          const before = {
            startsOn: version.starts_on,
            leftRows: leftRowsOf(version.left_rows).length,
          };
          const after = {
            startsOn: input.startsOn ?? version.starts_on,
            leftRows: input.dismissLeftRows === true ? 0 : before.leftRows,
          };
          const changes = changesOf(before, after);
          if (changes === null) {
            return this.answerOf(transaction, id);
          }
          if (after.startsOn !== before.startsOn) {
            await this.checkStart(transaction, branchId, after.startsOn, {
              start_date: version.start_date,
              end_date: version.end_date,
              time_zone: version.time_zone,
            });
          }
          await transaction
            .updateTable('timetable_versions')
            .set({
              starts_on: after.startsOn,
              ...(after.leftRows === before.leftRows ? {} : { left_rows: JSON.stringify([]) }),
            })
            .where('id', '=', id)
            .execute();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'timetable_version.edit',
            record: { type: 'timetable_version', id },
            oldValue: {
              ...changes.oldValue,
              ...(after.leftRows === before.leftRows
                ? {}
                : { leftRows: version.left_rows as JsonValue }),
            },
            newValue: changes.newValue,
            requestId,
          });
          return this.answerOf(transaction, id);
        }),
      LOAD_REFUSALS,
    );
  }

  /** The rows of a version with their problems today (decision 3), and the rows a copy left. */
  load(access: Access, id: string): Promise<Load> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.findVersion(transaction, branchId, id);
      const context = await this.contextOf(transaction, version);
      const rows = await this.rowsOf(transaction, id);
      const left = leftRowsOf(version.left_rows).map(storedOfLeft);
      const facts = await LoadFacts.of(transaction, context, [...rows, ...left], {
        versionRows: rows,
        unplaced: true,
      });
      const stored = leftRowsOf(version.left_rows);
      return {
        version: await this.answerOf(transaction, id),
        rows: this.sorted(rows.map((row) => facts.answerOf(row, facts.problemsOf(row)))),
        leftRows: left.map((row, index) => facts.answerOf(row, stored[index]?.problems ?? [])),
      };
    });
  }

  /**
   * The teachers and vacancies of the branch a row of the unit and subject
   * may take: those the engine finds no teacher problem for (the same rules
   * as the create). The class's Tutors first, marked; the Tutor preselected
   * for a Tutor subject on a class row (correction 1).
   */
  teachers(access: Access, id: string, query: LoadTeachersQuery): Promise<LoadTeachers> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.findVersion(transaction, branchId, id);
      const context = await this.contextOf(transaction, version);
      const unit = await this.unitOf(
        transaction,
        context,
        query.classId ?? null,
        query.groupId ?? null,
      );
      const subject = (await readSubjectFacts(transaction, [query.subjectId])).get(query.subjectId);
      if (subject === undefined) {
        throw notFound();
      }
      const all = await readTeacherFacts(transaction, context, 'branch');
      const otherParts = await this.otherPartsTeachers(
        transaction,
        context,
        id,
        query.groupId ?? null,
        query.subjectId,
      );
      const fit = [...all.values()].filter(
        (teacher) =>
          teacherProblems(unit.unit, subject, teacher).length === 0 && !otherParts.has(teacher.id),
      );
      // H30 of issue #105: why each teacher or vacancy with the subject cannot
      // take the row, the first reason of the order above.
      const blockGroups = [...new Set([...otherParts.values()].filter((one) => one !== null))];
      const groupNames =
        blockGroups.length === 0
          ? []
          : await transaction
              .selectFrom('groups')
              .select(['id', 'name'])
              .where('id', 'in', blockGroups)
              .execute();
      const excluded = [...all.values()].flatMap((teacher) => {
        const problems = teacherProblems(unit.unit, subject, teacher);
        if (problems.includes('load_teacher_subject')) {
          return [];
        }
        const reason = problems.includes('load_teacher_status')
          ? ('status' as const)
          : problems.includes('load_teacher_grade')
            ? ('grade' as const)
            : problems.includes('load_teacher_language')
              ? ('language' as const)
              : otherParts.has(teacher.id)
                ? ('block' as const)
                : null;
        if (reason === null) {
          return [];
        }
        const groupId = otherParts.get(teacher.id) ?? null;
        return [
          {
            id: teacher.id,
            kind: teacher.kind,
            name: teacher.name,
            reason,
            blockGroup:
              reason === 'block'
                ? (groupNames.find((one) => groupId !== null && one.id === groupId)?.name ?? null)
                : null,
          },
        ];
      });
      excluded.sort(
        (a, b) => (a.name ?? '').localeCompare(b.name ?? '') || a.id.localeCompare(b.id),
      );
      const tutors = unit.unit.tutorStaffIds;
      const rank = (teacherId: string) => {
        const at = tutors.indexOf(teacherId);
        return at === -1 ? tutors.length : at;
      };
      fit.sort(
        (a, b) =>
          rank(a.id) - rank(b.id) ||
          (a.kind === b.kind ? 0 : a.kind === 'person' ? -1 : 1) ||
          (a.name ?? '').localeCompare(b.name ?? '') ||
          a.id.localeCompare(b.id),
      );
      const preselect = subject.tutorSubject && unit.unit.kind === 'class' ? unit.mainTutor : null;
      return {
        teachers: fit.map((teacher) => ({
          id: teacher.id,
          kind: teacher.kind,
          name: teacher.name,
          tutor: tutors.includes(teacher.id),
        })),
        defaultTeacherId:
          preselect !== null && fit.some((teacher) => teacher.id === preselect) ? preselect : null,
        excluded,
        noTutor: subject.tutorSubject && unit.unit.kind === 'class' && tutors.length === 0,
      };
    });
  }

  /**
   * The weekly totals of a version (06, Building a timetable, steps 2 and 3;
   * Teachers who work in several branches, Weekly load; task 3.4b, decisions
   * 5 to 8 with corrections 1 and 2): shown, never refusing. Each weekday is
   * read on its first date on or after the start date, or today when the
   * start date has passed (`statusOn`; spec review of the build, should-fix 5).
   */
  totals(access: Access, id: string): Promise<LoadTotals> {
    const branchId = branchOf(access);
    return this.transactions.run(access.branchIds, async (transaction) => {
      const version = await this.findVersion(transaction, branchId, id);
      const context = await this.contextOf(transaction, version);
      const rows = await this.rowsOf(transaction, id);
      const groups = await readBlockGroups(
        transaction,
        rows.map((row) => row.group_id),
      );
      const totalsRows = rows.map((row) => ({
        classId: row.class_id,
        groupId: row.group_id,
        subjectId: row.subject_id,
        teacherId: row.teacher_id,
        lessonsPerWeek: row.lessons_per_week,
      }));
      const classLessons = classWeekLessons(
        totalsRows,
        new Map([...groups].map(([groupId, group]) => [groupId, group.classIds])),
      );
      const classIds = [...classLessons.keys()].sort();
      const classes =
        classIds.length === 0
          ? []
          : await transaction
              .selectFrom('classes')
              .select(['id', 'name', 'grade'])
              .where('id', 'in', classIds)
              .where('branch_id', '=', branchId)
              .execute();
      const branch = await transaction
        .selectFrom('branches')
        .select('working_weekdays')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow();
      const store = await loadStore(transaction);
      const assignments = store.assignments.filter((row) => !isWithdrawn(row));
      const weeks = new Map<number, WeekDay[]>();
      const weekOf = (grade: number): WeekDay[] => {
        const known = weeks.get(grade);
        if (known !== undefined) {
          return known;
        }
        const days = weekDaysOf(
          grade,
          context.statusOn,
          branch.working_weekdays,
          { assignments },
          (templateId, date) => dayOf(store, templateId, date)?.day ?? null,
        );
        weeks.set(grade, days);
        return days;
      };

      const teacherLessons = teacherWeekLessons(totalsRows);
      const teacherIds = [...teacherLessons.keys()].sort();
      const teachers = await readTeacherFacts(transaction, context, teacherIds);
      const gradeOfClass = new Map(classes.map((row) => [row.id, row.grade]));
      const gradesOf = (teacherId: string): number[] => [
        ...new Set(
          rows
            .filter((row) => row.teacher_id === teacherId)
            .flatMap((row) =>
              row.class_id !== null
                ? [gradeOfClass.get(row.class_id)].filter((one): one is number => one !== undefined)
                : row.group_id === null
                  ? []
                  : [...(groups.get(row.group_id)?.grades ?? [])],
            ),
        ),
      ];
      const [contracts, entries, ranges, elsewhere] =
        teacherIds.length === 0
          ? [[], [], [], []]
          : await Promise.all([
              transaction
                .selectFrom('staff')
                .select(['id', 'weekly_lessons'])
                .where('id', 'in', teacherIds)
                .execute(),
              transaction
                .selectFrom('staff_availability')
                .select(['id', 'staff_id', 'valid_from', 'valid_until'])
                .where('staff_id', 'in', teacherIds)
                .where('branch_id', '=', branchId)
                .execute(),
              transaction
                .selectFrom('staff_availability_ranges')
                .select(['entry_id', 'weekday', 'start_minutes', 'end_minutes'])
                .where('staff_id', 'in', teacherIds)
                .where('branch_id', '=', branchId)
                .execute(),
              sql<{ teacher_id: string; branch_id: string; lessons: number; draft: boolean }>`
                select teacher_id, branch_id, lessons, draft
                from teacher_load_elsewhere(
                  ${branchId}::uuid, ${sql.val(teacherIds)}::uuid[], ${context.statusOn}::date
                )
              `
                .execute(transaction)
                .then((result) => result.rows),
            ]);
      const branchNames = new Map(
        elsewhere.length === 0
          ? []
          : (
              await transaction
                .selectFrom('branches')
                .select(['id', 'name'])
                .where('id', 'in', [...new Set(elsewhere.map((row) => row.branch_id))])
                .execute()
            ).map((row) => [row.id, row.name]),
      );
      const freeSlotsOf = (teacherId: string): number | null => {
        const grades = gradesOf(teacherId);
        let any = false;
        let sum = 0;
        for (const weekday of [...branch.working_weekdays].sort((a, b) => a - b)) {
          const date = firstOn(context.statusOn, weekday);
          const entry = entries.find(
            (one) => one.staff_id === teacherId && one.valid_from <= date && date < one.valid_until,
          );
          if (entry === undefined) continue;
          any = true;
          const slots = grades.flatMap((grade) => {
            const day = weekOf(grade).find((one) => one.weekday === weekday)?.day ?? null;
            return day === null ? [] : lessonIntervals(day);
          });
          const hours = ranges
            .filter((range) => range.entry_id === entry.id && range.weekday === weekday)
            .map((range) => ({ start: range.start_minutes, end: range.end_minutes }));
          sum += freeSlots(slots, hours);
        }
        return any ? sum : null;
      };

      return {
        classes: classes
          .map((row) => ({
            id: row.id,
            name: row.name,
            grade: row.grade,
            lessons: classLessons.get(row.id) ?? 0,
            lessonSlots: weekLessonSlots(weekOf(row.grade)),
          }))
          .sort(
            (a, b) => a.grade - b.grade || a.name.localeCompare(b.name) || a.id.localeCompare(b.id),
          ),
        teachers: teacherIds
          .map((teacherId) => {
            const teacher = teachers.get(teacherId);
            return {
              id: teacherId,
              kind: teacher?.kind ?? 'vacancy',
              name: teacher?.name ?? null,
              lessons: teacherLessons.get(teacherId) ?? 0,
              freeSlots: freeSlotsOf(teacherId),
              elsewhere: elsewhere
                .filter((row) => row.teacher_id === teacherId)
                .map((row) => ({
                  branchId: row.branch_id,
                  branchName: branchNames.get(row.branch_id) ?? '',
                  lessons: row.lessons,
                  draft: row.draft,
                }))
                .sort((a, b) => a.branchName.localeCompare(b.branchName)),
              contract: contracts.find((row) => row.id === teacherId)?.weekly_lessons ?? null,
            };
          })
          .sort(
            (a, b) =>
              (a.kind === b.kind ? 0 : a.kind === 'person' ? -1 : 1) ||
              (a.name ?? '').localeCompare(b.name ?? '') ||
              a.id.localeCompare(b.id),
          ),
      };
    });
  }

  /** A row of a draft: every rule of the engine (decision 7); the first problem is the refusal. */
  createRow(access: Access, id: string, input: LoadRowRecord, requestId: string): Promise<LoadRow> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const version = await this.lockDraft(transaction, branchId, id);
          const context = await this.contextOf(transaction, version);
          const unit = await this.unitOf(transaction, context, input.classId, input.groupId);
          await lockSubjects(transaction, [input.subjectId]);
          const subject = (await readSubjectFacts(transaction, [input.subjectId])).get(
            input.subjectId,
          );
          if (subject === undefined) {
            throw notFound();
          }
          const teacher = await this.teacherOf(transaction, context, input.teacherId);
          const room = await this.roomOf(transaction, context, input.roomId);
          // Task 3.4b: the row among the version's rows, for its block and the
          // split-or-whole rule (the version is locked FOR UPDATE).
          const candidate: StoredLoadRow = {
            id: NEW_ROW_ID,
            class_id: input.classId === null ? null : input.classId.toLowerCase(),
            group_id: input.groupId === null ? null : input.groupId.toLowerCase(),
            subject_id: input.subjectId.toLowerCase(),
            teacher_id: input.teacherId.toLowerCase(),
            lessons_per_week: input.lessonsPerWeek,
            room_id: input.roomId === null ? null : input.roomId.toLowerCase(),
            room_type: input.roomType,
            double_lessons: input.doubleLessons,
            mixed_block: input.mixedBlock,
          };
          const blocks = await LoadFacts.of(transaction, context, [candidate], {
            versionRows: await this.rowsOf(transaction, id),
          });
          const problems = loadRowProblems({
            versionYearId: context.yearId,
            unit: unit.unit,
            subject,
            teacher,
            room,
            sharedSlot: await sharedSlotOf(transaction, context, unit.unit),
            ...blocks.blockFactsOf(candidate),
          });
          this.refuse(refusingProblems(problems));
          await this.refuseTaken(transaction, id, input);
          const created = await transaction
            .insertInto('teaching_load_rows')
            .values({
              branch_id: branchId,
              version_id: id,
              class_id: input.classId,
              group_id: input.groupId,
              subject_id: input.subjectId,
              teacher_id: input.teacherId,
              lessons_per_week: input.lessonsPerWeek,
              room_id: input.roomId,
              room_type: input.roomType,
              double_lessons: input.doubleLessons,
              mixed_block: input.mixedBlock,
            })
            .returning(ROW_COLUMNS)
            .executeTakeFirstOrThrow();
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'teaching_load.create',
            record: { type: 'teaching_load_row', id: created.id },
            newValue: { versionId: id, ...fieldsOf(created) },
            requestId,
          });
          return this.rowAnswer(transaction, context, id, created);
        }),
      LOAD_REFUSALS,
    );
  }

  /**
   * The teacher, lessons per week, room or room type, double lessons and the
   * mixed mark of a row (decision 7): the teacher rules only when the teacher
   * changes, the room rule only when the room changes, so a row with a
   * problem from a later change can still have its lessons edited. Task 3.4b,
   * decision 3: a change of lessons per week is written to every part of the
   * row's block, a change of the mixed mark to every half of its split, in
   * one entry with `parts`; each block rule is checked only when its own
   * field changes, as the database checks it at the commit (0056).
   */
  editRow(
    access: Access,
    id: string,
    rowId: string,
    input: LoadRowEdit,
    requestId: string,
  ): Promise<LoadRow> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          const version = await this.lockDraft(transaction, branchId, id);
          const context = await this.contextOf(transaction, version);
          const before = await this.rowOf(transaction, id, rowId);
          const after: StoredLoadRow = {
            ...before,
            teacher_id: input.teacherId.toLowerCase(),
            lessons_per_week: input.lessonsPerWeek,
            room_id: input.roomId === null ? null : input.roomId.toLowerCase(),
            room_type: input.roomType,
            double_lessons: input.doubleLessons,
            mixed_block: input.mixedBlock ?? before.mixed_block,
          };
          const changes = changesOf(fieldsOf(before), fieldsOf(after));
          if (changes === null) {
            return this.rowAnswer(transaction, context, id, before);
          }
          const unit = await this.unitOf(transaction, context, before.class_id, before.group_id);
          if (after.teacher_id !== before.teacher_id) {
            await lockSubjects(transaction, [before.subject_id]);
          }
          const subject = (await readSubjectFacts(transaction, [before.subject_id])).get(
            before.subject_id,
          );
          if (subject === undefined) {
            throw notFound();
          }
          const checked: LoadProblem[] = [];
          if (after.teacher_id !== before.teacher_id) {
            const teacher = await this.teacherOf(transaction, context, after.teacher_id);
            checked.push(...teacherProblems(unit.unit, subject, teacher));
            this.refuse(checked);
          }
          if (after.room_id !== before.room_id) {
            const room = await this.roomOf(transaction, context, after.room_id);
            if (room?.closed === true) {
              throw refused('load_room_closed');
            }
          }
          const parts = await this.blockEdit(transaction, context, id, before, after);
          for (const row of [after, ...parts.map((part) => part.after)]) {
            await transaction
              .updateTable('teaching_load_rows')
              .set({
                teacher_id: row.teacher_id,
                lessons_per_week: row.lessons_per_week,
                room_id: row.room_id,
                room_type: row.room_type,
                double_lessons: row.double_lessons,
                mixed_block: row.mixed_block,
              })
              .where('id', '=', row.id)
              .execute();
          }
          const partsOf = (side: 'before' | 'after') =>
            parts.map((part) => ({
              rowId: part.before.id,
              lessonsPerWeek: part[side].lessons_per_week,
              mixedBlock: part[side].mixed_block,
            }));
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'teaching_load.edit',
            record: { type: 'teaching_load_row', id: rowId },
            oldValue: {
              ...changes.oldValue,
              ...(parts.length > 0 ? { parts: partsOf('before') } : {}),
            },
            newValue: {
              ...changes.newValue,
              ...(parts.length > 0 ? { parts: partsOf('after') } : {}),
            },
            requestId,
          });
          return this.rowAnswer(transaction, context, id, after);
        }),
      LOAD_REFUSALS,
    );
  }

  /** A row of a draft, deleted (decision 6); the whole row is kept in the audit entry. */
  deleteRow(access: Access, id: string, rowId: string, requestId: string): Promise<void> {
    const branchId = branchOf(access);
    return refusingConstraints(
      () =>
        this.transactions.run(access.branchIds, async (transaction) => {
          await this.lockDraft(transaction, branchId, id);
          const before = await this.rowOf(transaction, id, rowId);
          await this.audit.record(transaction, {
            branchId,
            actorId: access.accountId,
            assignmentId: access.assignmentId,
            action: 'teaching_load.delete',
            record: { type: 'teaching_load_row', id: rowId },
            oldValue: { versionId: id, ...fieldsOf(before) },
            requestId,
          });
          await transaction.deleteFrom('teaching_load_rows').where('id', '=', rowId).execute();
        }),
      LOAD_REFUSALS,
    );
  }

  // ---------------------------------------------------------------------------

  /**
   * Task 3.4b, decision 3: the other parts an edit writes (lessons per week to
   * every part of the block, the mixed mark to every half of the split), and
   * the refusal of a block rule whose own field changed: `load_block_teacher`
   * on a teacher change or a mixed mark changed, `load_mixed_not_split` and
   * `load_block_mixed` on a mark changed, `load_block_lessons` on a lessons
   * change. A block broken by a later change elsewhere refuses no edit of
   * another field (3.4a decisions 3 and 7).
   */
  private async blockEdit(
    transaction: Transaction,
    context: VersionContext,
    versionId: string,
    before: StoredLoadRow,
    after: StoredLoadRow,
  ): Promise<{ before: StoredLoadRow; after: StoredLoadRow }[]> {
    if (before.group_id === null) {
      // A class row is never a half of a split (spec review of the build, must-fix 1).
      if (after.mixed_block && !before.mixed_block) {
        this.refuse(['load_mixed_not_split']);
      }
      return [];
    }
    const versionRows = await this.rowsOf(transaction, versionId);
    const facts = await LoadFacts.of(transaction, context, [after], { versionRows });
    const lessonsChange = after.lessons_per_week !== before.lessons_per_week;
    const mixedChange = after.mixed_block !== before.mixed_block;
    const teacherChange = after.teacher_id !== before.teacher_id;
    const ownGroup = facts.groups.get(before.group_id);
    const splitClass = ownGroup === undefined ? null : splitClassOf(ownGroup);
    const parts: { before: StoredLoadRow; after: StoredLoadRow }[] = [];
    for (const part of facts.blockOf(after)) {
      if (part.id === after.id) continue;
      const partGroup = part.group_id === null ? undefined : facts.groups.get(part.group_id);
      const sameSplit =
        splitClass !== null && partGroup !== undefined && splitClassOf(partGroup) === splitClass;
      const changed: StoredLoadRow = {
        ...part,
        lessons_per_week: lessonsChange ? after.lessons_per_week : part.lessons_per_week,
        mixed_block: mixedChange && sameSplit ? after.mixed_block : part.mixed_block,
      };
      if (
        changed.lessons_per_week !== part.lessons_per_week ||
        changed.mixed_block !== part.mixed_block
      ) {
        parts.push({ before: part, after: changed });
      }
    }
    const rows = [
      ...versionRows.filter(
        (row) => row.id !== after.id && !parts.some((part) => part.before.id === row.id),
      ),
      after,
      ...parts.map((part) => part.after),
    ].map(blockRowOf);
    const own = rows.find((row) => row.id === after.id);
    if (own !== undefined) {
      const found = blockProblems(own, blockOf(own.id, rows, facts.groups), facts.groups);
      const checked: BlockProblem[] = [
        ...(mixedChange ? (['load_mixed_not_split', 'load_block_mixed'] as const) : []),
        ...(lessonsChange ? (['load_block_lessons'] as const) : []),
        ...(teacherChange || mixedChange ? (['load_block_teacher'] as const) : []),
      ];
      this.refuse(
        BLOCK_PROBLEM_ORDER.filter(
          (problem) => found.includes(problem) && checked.includes(problem),
        ),
      );
    }
    return parts;
  }

  /**
   * The teachers of the other parts of the block a group row would join
   * (decision 11): not offered, except to the halves of a split marked as a
   * mixed block. The row the version holds for the group stands for it.
   */
  private async otherPartsTeachers(
    transaction: Transaction,
    context: VersionContext,
    versionId: string,
    groupId: string | null,
    subjectId: string,
  ): Promise<Map<string, string | null>> {
    if (groupId === null) {
      return new Map();
    }
    const versionRows = await this.rowsOf(transaction, versionId);
    const group = groupId.toLowerCase();
    const held = versionRows.find((row) => row.group_id === group);
    const probe: StoredLoadRow = held ?? {
      id: NEW_ROW_ID,
      class_id: null,
      group_id: group,
      subject_id: subjectId.toLowerCase(),
      teacher_id: NEW_ROW_ID,
      lessons_per_week: 1,
      room_id: null,
      room_type: null,
      double_lessons: false,
      mixed_block: false,
    };
    const facts = await LoadFacts.of(transaction, context, [probe], { versionRows });
    const ownGroup = facts.groups.get(group);
    const splitClass = ownGroup === undefined ? null : splitClassOf(ownGroup);
    const others = facts.blockOf(probe).filter((part) => part.id !== probe.id);
    const halves = others.filter((part) => {
      const partGroup = part.group_id === null ? undefined : facts.groups.get(part.group_id);
      return (
        splitClass !== null && partGroup !== undefined && splitClassOf(partGroup) === splitClass
      );
    });
    const mixed =
      held?.mixed_block ?? (halves.length > 0 && halves.every((part) => part.mixed_block));
    // Each teacher of another part of the block, with the group of that part.
    return new Map(
      others
        .filter((part) => !(mixed && part.mixed_block && halves.includes(part)))
        .map((part) => [part.teacher_id, part.group_id]),
    );
  }

  /** The first problem refuses; a teacher's missing profile names the subject or the grade (decision 9). */
  private refuse(problems: readonly LoadProblem[]): void {
    const [first] = problems;
    if (first === undefined) {
      return;
    }
    const details: ErrorDetail[] | undefined =
      TEACHER_PROBLEMS.includes(first) || first === 'load_block_teacher'
        ? [{ path: 'teacherId', code: first, message: 'The teacher may not take this row.' }]
        : first === 'load_block_lessons'
          ? [
              {
                path: 'lessonsPerWeek',
                code: first,
                message: 'Every part of a block has the same lessons.',
              },
            ]
          : ROOM_PROBLEMS.includes(first)
            ? [{ path: 'roomId', code: first, message: 'The room may not be used.' }]
            : undefined;
    throw new ApiException(first, 409, undefined, details);
  }

  /** `load_row_exists` with the row that holds the unit and subject (the version is locked). */
  private async refuseTaken(
    transaction: Transaction,
    versionId: string,
    input: LoadRowRecord,
  ): Promise<void> {
    let query = transaction
      .selectFrom('teaching_load_rows')
      .select('id')
      .where('version_id', '=', versionId);
    query =
      input.classId !== null
        ? query.where('class_id', '=', input.classId).where('subject_id', '=', input.subjectId)
        : query.where('group_id', '=', input.groupId);
    const holder = await query.executeTakeFirst();
    if (holder !== undefined) {
      throw new ApiException('load_row_exists', 409, undefined, [
        {
          path: input.classId !== null ? 'subjectId' : 'groupId',
          code: 'load_row_exists',
          message: 'The version already has a row for this unit and subject.',
          recordId: holder.id,
        },
      ]);
    }
  }

  /** The class or group of a row, of the branch; 404 otherwise. */
  private async unitOf(
    transaction: Transaction,
    context: VersionContext,
    classId: string | null,
    groupId: string | null,
  ): Promise<UnitFacts> {
    const found =
      classId !== null
        ? (await readClassFacts(transaction, context, [classId])).get(classId.toLowerCase())
        : groupId !== null
          ? (await readGroupFacts(transaction, context, [groupId])).get(groupId.toLowerCase())
          : undefined;
    if (found === undefined) {
      throw notFound();
    }
    return found;
  }

  /**
   * A teacher or vacancy linked to the branch, its record locked FOR KEY
   * SHARE before its status is read, so a vacancy close at the same moment
   * waits for the row or is waited for; 404 for a record of another branch
   * or an unknown id.
   */
  private async teacherOf(transaction: Transaction, context: VersionContext, teacherId: string) {
    const id = teacherId.toLowerCase();
    const locked = await transaction
      .selectFrom('staff')
      .select('id')
      .where('id', '=', id)
      .forKeyShare()
      .executeTakeFirst();
    const teacher = (await readTeacherFacts(transaction, context, [id])).get(id);
    if (locked === undefined || teacher === undefined || !teacher.inBranch) {
      throw notFound();
    }
    return teacher;
  }

  /** The room named, of the branch; 404 otherwise. */
  private async roomOf(
    transaction: Transaction,
    context: VersionContext,
    roomId: string | null,
  ): Promise<{ closed: boolean } | null> {
    if (roomId === null) {
      return null;
    }
    const room = (await readRoomFacts(transaction, context, [roomId])).get(roomId.toLowerCase());
    if (room === undefined) {
      throw notFound();
    }
    return room;
  }

  /** A row of the version; 404 otherwise. */
  private async rowOf(
    transaction: Transaction,
    versionId: string,
    rowId: string,
  ): Promise<StoredLoadRow> {
    const row = await transaction
      .selectFrom('teaching_load_rows')
      .select(ROW_COLUMNS)
      .where('id', '=', rowId)
      .where('version_id', '=', versionId)
      .executeTakeFirst();
    if (row === undefined) {
      throw notFound();
    }
    return row;
  }

  private rowsOf(transaction: Transaction, versionId: string): Promise<StoredLoadRow[]> {
    return transaction
      .selectFrom('teaching_load_rows')
      .select(ROW_COLUMNS)
      .where('version_id', '=', versionId)
      .orderBy('id')
      .execute();
  }

  /** A row as the page shows it, among the version's rows (its block, the students not placed). */
  private async rowAnswer(
    transaction: Transaction,
    context: VersionContext,
    versionId: string,
    row: StoredLoadRow,
  ): Promise<LoadRow> {
    const versionRows = (await this.rowsOf(transaction, versionId)).map((one) =>
      one.id === row.id ? row : one,
    );
    const facts = await LoadFacts.of(transaction, context, [row], {
      versionRows,
      unplaced: true,
    });
    return facts.answerOf(row, facts.problemsOf(row));
  }

  /** The rows by unit (grade, then name) and subject, as the page lists them. */
  private sorted(rows: LoadRow[]): LoadRow[] {
    return rows.sort(
      (a, b) =>
        (a.unit.grades[0] ?? 0) - (b.unit.grades[0] ?? 0) ||
        a.unit.name.localeCompare(b.unit.name) ||
        a.subject.names.en.localeCompare(b.subject.names.en) ||
        a.id.localeCompare(b.id),
    );
  }

  /**
   * A draft of the branch for a write: the year FOR SHARE, then the version
   * FOR UPDATE, whatever their state, then read (the lock order of the
   * class). Another branch's or unknown: 404; a closed year:
   * `timetable_year_closed`; not a draft: `version_not_draft`.
   */
  private async lockDraft(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<VersionRow> {
    const named = await transaction
      .selectFrom('timetable_versions')
      .select('academic_year_id')
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (named === undefined) {
      throw notFound();
    }
    await transaction
      .selectFrom('academic_years')
      .select('id')
      .where('id', '=', named.academic_year_id)
      .forShare()
      .execute();
    await transaction
      .selectFrom('timetable_versions')
      .select('id')
      .where('id', '=', id)
      .forUpdate()
      .execute();
    const version = await this.versionRow(transaction, id);
    if (version.year_status === 'closed') {
      throw refused('timetable_year_closed');
    }
    if (version.status !== 'draft') {
      throw refused('version_not_draft');
    }
    return version;
  }

  /** A version of the branch, read without a lock; 404 otherwise. */
  private async findVersion(
    transaction: Transaction,
    branchId: string,
    id: string,
  ): Promise<VersionRow> {
    const found = await transaction
      .selectFrom('timetable_versions')
      .select('id')
      .where('id', '=', id)
      .where('branch_id', '=', branchId)
      .executeTakeFirst();
    if (found === undefined) {
      throw notFound();
    }
    return this.versionRow(transaction, id);
  }

  private versionRow(transaction: Transaction, id: string): Promise<VersionRow> {
    return transaction
      .selectFrom('timetable_versions')
      .innerJoin('academic_years', 'academic_years.id', 'timetable_versions.academic_year_id')
      .innerJoin('branches', 'branches.id', 'timetable_versions.branch_id')
      .select([
        'timetable_versions.id',
        'timetable_versions.branch_id',
        'timetable_versions.academic_year_id',
        'timetable_versions.number',
        'timetable_versions.status',
        'timetable_versions.starts_on',
        'timetable_versions.from_version_id',
        'timetable_versions.left_rows',
        'academic_years.start_date',
        'academic_years.end_date',
        'academic_years.status as year_status',
        'branches.time_zone',
      ])
      .where('timetable_versions.id', '=', id)
      .executeTakeFirstOrThrow();
  }

  private async contextOf(transaction: Transaction, version: VersionRow): Promise<VersionContext> {
    const today = await this.todayIn(transaction, version.branch_id);
    return {
      branchId: version.branch_id,
      yearId: version.academic_year_id,
      startsOn: version.starts_on,
      statusOn: version.starts_on > today ? version.starts_on : today,
      timeZone: version.time_zone,
    };
  }

  /** Decision 5: on or after today in the branch's time zone, and inside the year. */
  private async checkStart(
    transaction: Transaction,
    branchId: string,
    startsOn: string,
    year: { start_date: string; end_date: string; time_zone: string },
  ): Promise<void> {
    if (startsOn < year.start_date || startsOn > year.end_date) {
      throw new ApiException('version_start_outside_year', 422, undefined, [
        { path: 'startsOn', code: 'version_start_outside_year', message: 'Outside the year.' },
      ]);
    }
    if (startsOn < (await this.todayIn(transaction, branchId))) {
      throw new ApiException('version_start_past', 422, undefined, [
        { path: 'startsOn', code: 'version_start_past', message: 'Before today.' },
      ]);
    }
  }

  /** Today in the branch's time zone at the moment of the transaction (`.claude/rules/database.md`). */
  private async todayIn(transaction: Transaction, branchId: string): Promise<string> {
    const branch = await transaction
      .selectFrom('branches')
      .select('time_zone')
      .where('id', '=', branchId)
      .executeTakeFirstOrThrow();
    return schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  }

  private versionsIn(transaction: Transaction) {
    return transaction
      .selectFrom('timetable_versions')
      .innerJoin('academic_years', 'academic_years.id', 'timetable_versions.academic_year_id')
      .select([
        'timetable_versions.id',
        'timetable_versions.academic_year_id',
        'timetable_versions.number',
        'timetable_versions.status',
        'timetable_versions.starts_on',
        'timetable_versions.from_version_id',
        'timetable_versions.left_rows',
        'academic_years.start_date',
        'academic_years.end_date',
        'academic_years.status as year_status',
        sql<number>`(
          select count(*)::int from teaching_load_rows r
          where r.version_id = timetable_versions.id
        )`.as('rows'),
      ]);
  }

  private async answerOf(transaction: Transaction, id: string): Promise<TimetableVersion> {
    const rows = await this.versionsIn(transaction)
      .where('timetable_versions.id', '=', id)
      .execute();
    const [answer] = await this.answersOf(transaction, rows);
    if (answer === undefined) {
      throw notFound();
    }
    return answer;
  }

  private async answersOf(
    transaction: Transaction,
    rows: readonly {
      id: string;
      academic_year_id: string;
      number: number;
      status: string;
      starts_on: string;
      from_version_id: string | null;
      left_rows: unknown;
      start_date: string;
      end_date: string;
      year_status: string;
      rows: number;
    }[],
  ): Promise<TimetableVersion[]> {
    const sources = [
      ...new Set(rows.map((row) => row.from_version_id).filter((id): id is string => id !== null)),
    ];
    const numbers = new Map(
      sources.length === 0
        ? []
        : (
            await transaction
              .selectFrom('timetable_versions')
              .select(['id', 'number'])
              .where('id', 'in', sources)
              .execute()
          ).map((row) => [row.id, row.number]),
    );
    return rows.map((row) => {
      const fromNumber =
        row.from_version_id === null ? undefined : numbers.get(row.from_version_id);
      return {
        id: row.id,
        academicYearId: row.academic_year_id,
        yearName: academicYearName(row.start_date, row.end_date),
        yearStatus: academicYearStatusSchema.parse(row.year_status),
        number: row.number,
        status: timetableVersionStatusSchema.parse(row.status),
        startsOn: row.starts_on,
        fromVersion:
          row.from_version_id === null || fromNumber === undefined
            ? null
            : { id: row.from_version_id, number: fromNumber },
        rows: row.rows,
        leftRows: leftRowsOf(row.left_rows).length,
      };
    });
  }
}
