import {
  academicYearName,
  academicYearStatusSchema,
  groupKindOf,
  instructionLanguageSchema,
  schoolDateOf,
  type ErrorCode,
  type GroupDetail,
  type GroupSlots,
  type InstructionLanguage,
  type SchoolGroup,
} from '@sodiq/shared';
import { twoGradeSlots } from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import { transactionMoment, type Transaction } from '../../database/transactions.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { isWithdrawn } from '../setup/dated-rows.js';
import { notFound } from '../setup/setup-refusals.js';
import { readGroupTeachers } from '../timetable/group-teachers.js';

/**
 * The refusals of the database for groups (db/migrations/0046), by the name
 * of the constraint or trigger check that raised them. The service checks the
 * same rules first, for an answer of its own; these answer when two requests
 * race past the service's checks, or at the commit of the deferred guard.
 * `group_needs_class` and `groups_fixed` guard against a fault of the service
 * (the schema needs a class; the update grant leaves out the year and the
 * subject) and stay unmapped (500).
 */
export const GROUP_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  group_year_closed: 'group_year_closed',
  group_class_year: 'group_class_year',
  group_grades: 'group_grades',
  group_subject_grade: 'group_subject_grade',
  group_subject_archived: 'group_subject_archived',
  group_language: 'group_language',
  // Task 3.2b (decision 16): the group's side of its members.
  group_has_members: 'group_has_members',
  group_size_below_members: 'group_size_below_members',
  group_class_has_members: 'group_class_has_members',
};

/** The refusals of a restore, whose texts say what can be done then (spec review of the build, must-fix 4). */
export const GROUP_RESTORE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  ...GROUP_REFUSALS,
  group_class_year: 'group_restore_class',
  group_grades: 'group_restore_class',
  group_subject_grade: 'group_restore_subject',
  group_subject_archived: 'group_restore_subject',
};

/** The refusals the other side of a group meets: a class's and a subject's change (decision 16). */
export const GROUP_SIDE_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  class_grade_groups: 'class_grade_groups',
  class_in_groups: 'class_in_groups',
  // The class edit locks every class of its groups first and moves or asks
  // about each group itself; the deferred rule answers only a fault.
  group_language: 'request_refused',
  subject_grade_groups: 'subject_grade_groups',
  subject_has_groups: 'subject_has_groups',
};

/** A class as a group reads it. */
export interface GroupClassRow {
  id: string;
  grade: number;
  name: string;
  language: string;
  archived_at: Date | null;
  academic_year_id: string;
}

export interface GroupRow {
  id: string;
  academic_year_id: string;
  start_date: string;
  end_date: string;
  year_status: string;
  subject_id: string;
  name_uz: string;
  name_ru: string;
  name_en: string;
  language_rule: boolean;
  subject_archived_at: Date | null;
  subject_grades: number[];
  name: string;
  language: string;
  max_size: number;
  archived_at: Date | null;
  version: number;
  /** The members today in the branch's time zone (task 3.2b). */
  students: number;
}

function groupsIn(transaction: Transaction) {
  return transaction
    .selectFrom('groups')
    .innerJoin('academic_years', 'academic_years.id', 'groups.academic_year_id')
    .innerJoin('subjects', 'subjects.id', 'groups.subject_id')
    .select([
      'groups.id',
      'groups.academic_year_id',
      'academic_years.start_date',
      'academic_years.end_date',
      'academic_years.status as year_status',
      'groups.subject_id',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'subjects.language_rule',
      'subjects.archived_at as subject_archived_at',
      'subjects.grades as subject_grades',
      'groups.name',
      'groups.language',
      'groups.max_size',
      'groups.archived_at',
      'groups.version',
      // The members today (task 3.2b, the card's count): rows with days that
      // hold today in the branch's time zone, as the Students tab counts them.
      sql<number>`(
        select count(*)::int from group_memberships m
        where m.group_id = groups.id
          and m.valid_from < m.valid_until
          and m.valid_from <= branch_today(groups.branch_id)
          and m.valid_until > branch_today(groups.branch_id)
      )`.as('students'),
    ]);
}

/** The classes of the groups named, by grade and name. */
export async function classesOfGroups(
  transaction: Transaction,
  groupIds: readonly string[],
): Promise<Map<string, GroupClassRow[]>> {
  const found = new Map<string, GroupClassRow[]>();
  if (groupIds.length === 0) {
    return found;
  }
  const rows = await transaction
    .selectFrom('group_classes')
    .innerJoin('classes', 'classes.id', 'group_classes.class_id')
    .select([
      'group_classes.group_id',
      'classes.id',
      'classes.grade',
      'classes.name',
      'classes.language',
      'classes.archived_at',
      'classes.academic_year_id',
    ])
    .where('group_classes.group_id', 'in', groupIds)
    .orderBy('classes.grade')
    .orderBy('classes.name_key')
    .orderBy('classes.id')
    .execute();
  for (const row of rows) {
    const list = found.get(row.group_id) ?? [];
    list.push(row);
    found.set(row.group_id, list);
  }
  return found;
}

/** The grades of these classes, ascending, each once. */
export const gradesOf = (classes: readonly { grade: number }[]): number[] =>
  [...new Set(classes.map((one) => one.grade))].sort((a, b) => a - b);

/** The one language of these classes, or `null` when they differ (decision 8). */
export function sharedLanguageOf(
  classes: readonly { language: string }[],
): InstructionLanguage | null {
  const languages = new Set(classes.map((one) => one.language));
  const [only] = [...languages];
  return languages.size === 1 && only !== undefined ? instructionLanguageSchema.parse(only) : null;
}

export function toGroup(
  row: GroupRow,
  classes: readonly GroupClassRow[],
  teacher: SchoolGroup['teacher'] = null,
): SchoolGroup {
  return {
    id: row.id,
    academicYearId: row.academic_year_id,
    yearName: academicYearName(row.start_date, row.end_date),
    // The checks of the tables keep the lists equal to the schemas'.
    yearStatus: academicYearStatusSchema.parse(row.year_status),
    subject: {
      id: row.subject_id,
      names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
      languageRule: row.language_rule,
    },
    name: row.name,
    language: instructionLanguageSchema.parse(row.language),
    maxSize: row.max_size,
    grades: gradesOf(classes),
    classes: classes.map((one) => ({
      id: one.id,
      grade: one.grade,
      name: one.name,
      language: instructionLanguageSchema.parse(one.language),
      archived: one.archived_at !== null,
    })),
    kind: groupKindOf(classes.length),
    students: row.students,
    teacher,
    archived: row.archived_at !== null,
    version: row.version,
  };
}

/**
 * Who reads a group: the branch of the request, and whether the reader sees a
 * draft's teacher (a reader of the area `timetable`; task 3.4b, decision 9).
 */
export interface GroupReader {
  readonly branchId: string;
  readonly drafts: boolean;
}

/** The groups of the branch, newest year first, by name, each with the teacher of its load row. */
export async function readGroups(
  transaction: Transaction,
  reader: GroupReader,
): Promise<SchoolGroup[]> {
  const rows = await groupsIn(transaction)
    .orderBy('academic_years.start_date', 'desc')
    .orderBy('groups.name_key')
    .orderBy('groups.id')
    .execute();
  const classes = await classesOfGroups(
    transaction,
    rows.map((row) => row.id),
  );
  const teachers = await readGroupTeachers(
    transaction,
    reader.branchId,
    rows.map((row) => ({ id: row.id, academicYearId: row.academic_year_id })),
    reader.drafts,
  );
  return rows.map((row) => toGroup(row, classes.get(row.id) ?? [], teachers.get(row.id) ?? null));
}

/** One group's row; 404 for another branch's or an unknown id. */
export async function readGroupRow(transaction: Transaction, id: string): Promise<GroupRow> {
  const row = await groupsIn(transaction).where('groups.id', '=', id).executeTakeFirst();
  if (row === undefined) {
    throw notFound();
  }
  return row;
}

/**
 * The lesson slots two grades share on each working weekday (decision 9): the
 * templates in force from the later of today in the branch's time zone, at
 * the moment of the transaction, and the year's first day; the weekly pattern,
 * no special dates. `null` unless the classes are of exactly two grades.
 */
export async function slotsOf(
  transaction: Transaction,
  branchId: string,
  yearStart: string,
  grades: readonly number[],
): Promise<GroupSlots> {
  const [gradeA, gradeB] = grades;
  if (grades.length !== 2 || gradeA === undefined || gradeB === undefined) {
    return null;
  }
  const branch = await transaction
    .selectFrom('branches')
    .select(['time_zone', 'working_weekdays'])
    .where('id', '=', branchId)
    .executeTakeFirstOrThrow();
  const today = schoolDateOf(await transactionMoment(transaction), branch.time_zone);
  const from = today > yearStart ? today : yearStart;
  const store = await loadStore(transaction);
  const assignments = store.assignments.filter((row) => !isWithdrawn(row));
  const days = twoGradeSlots(
    gradeA,
    gradeB,
    from,
    branch.working_weekdays,
    { assignments },
    (templateId, date) => dayOf(store, templateId, date)?.day ?? null,
  );
  return { grades: [gradeA, gradeB], days: days.map((day) => ({ ...day, slots: [...day.slots] })) };
}

/** A group with the shared slots of its two grades and the teacher of its load row. */
export async function readGroupDetail(
  transaction: Transaction,
  reader: GroupReader,
  id: string,
): Promise<GroupDetail> {
  const branchId = reader.branchId;
  const row = await readGroupRow(transaction, id);
  const classes = (await classesOfGroups(transaction, [id])).get(id) ?? [];
  const teachers = await readGroupTeachers(
    transaction,
    branchId,
    [{ id: row.id, academicYearId: row.academic_year_id }],
    reader.drafts,
  );
  const group = toGroup(row, classes, teachers.get(row.id) ?? null);
  return { ...group, slots: await slotsOf(transaction, branchId, row.start_date, group.grades) };
}
