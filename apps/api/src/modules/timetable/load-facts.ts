import {
  classTutorKindSchema,
  instructionLanguageSchema,
  listName,
  type ErrorCode,
  type LoadRow,
} from '@sodiq/shared';
import {
  blockOf,
  blockProblems,
  loadRowProblems,
  splitAndWhole,
  tutorAt,
  twoGradeSlots,
  type BlockGroup,
  type LoadProblem,
  type LoadSubject,
  type LoadTeacher,
  type LoadUnit,
  type TutorRow,
} from '@sodiq/timetable-rules';
import { sql } from 'kysely';
import type { Transaction } from '../../database/transactions.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { isWithdrawn } from '../setup/dated-rows.js';
import { blockRowOf, readBlockGroups, readUnplaced } from './load-blocks.js';

/**
 * The refusals of the database for versions and load rows (db/migrations/0055),
 * by the name of the constraint that raised them (decision 9). The service
 * checks the same rules first with the rule engine, for an answer of its own;
 * these answer when two requests race past its checks.
 * `teaching_load_rows_fixed`, `timetable_versions_fixed` and the unit check
 * guard against a fault of the service and stay unmapped (500).
 */
export const LOAD_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  load_version_draft: 'version_not_draft',
  // Task 5.3b-2: a pin of a row already at that slot; the draft trigger of the
  // pins (0070) runs pattern_rows_draft().
  timetable_pins_slot_key: 'pin_taken',
  pattern_version_draft: 'version_not_draft',
  pattern_year_closed: 'timetable_year_closed',
  timetable_versions_draft: 'version_not_draft',
  load_year_closed: 'timetable_year_closed',
  version_year_closed: 'timetable_year_closed',
  load_unit_year: 'load_unit_year',
  load_unit_archived: 'load_unit_archived',
  load_group_subject: 'load_group_subject',
  load_subject_archived: 'load_subject_archived',
  load_subject_grade: 'load_subject_grade',
  // Task 3.6c-2 (db/migrations/0067).
  load_no_tutor: 'load_no_tutor',
  load_tutor_row_teacher: 'load_tutor_row_teacher',
  load_teacher_branch: 'load_teacher_branch',
  load_teacher_status: 'load_teacher_status',
  load_teacher_subject: 'load_teacher_subject',
  load_teacher_language: 'load_teacher_language',
  load_room_closed: 'load_room_closed',
  teaching_load_rows_room_check: 'load_room_choice',
  // Task 3.4b (db/migrations/0056), at the commit.
  load_split_and_whole: 'load_split_and_whole',
  load_mixed_not_split: 'load_mixed_not_split',
  load_block_mixed: 'load_block_mixed',
  load_block_lessons: 'load_block_lessons',
  load_block_teacher: 'load_block_teacher',
  teaching_load_rows_class_key: 'load_row_exists',
  teaching_load_rows_group_key: 'load_row_exists',
  // The version create takes its year FOR UPDATE before the number; a fault
  // answers the general refusal.
  timetable_versions_number_key: 'request_refused',
};

/** What the rules of a row read of its version. */
export interface VersionContext {
  readonly branchId: string;
  readonly yearId: string;
  /** The intended start date: the day the Tutors are read on. */
  readonly startsOn: string;
  /**
   * The day a status is read on (decision 11): the start date, or today in the
   * branch's time zone when the start date has passed, as the trigger reads it.
   */
  readonly statusOn: string;
  readonly timeZone: string;
}

/** A class or group with what the page shows of it. */
export interface UnitFacts {
  readonly id: string;
  readonly name: string;
  readonly unit: LoadUnit;
}

export interface SubjectFacts extends LoadSubject {
  readonly names: { uz: string; ru: string; en: string };
}

export interface TeacherFacts extends LoadTeacher {
  readonly kind: 'person' | 'vacancy';
  /** Empty for a record the branch no longer sees. */
  readonly name: string | null;
}

export interface RoomFacts {
  readonly id: string;
  readonly name: string;
  readonly closed: boolean;
}

/** A stored row, as the facts are asked for it. */
export interface StoredLoadRow {
  readonly id: string;
  readonly class_id: string | null;
  readonly group_id: string | null;
  readonly subject_id: string;
  readonly teacher_id: string;
  readonly lessons_per_week: number;
  readonly room_id: string | null;
  readonly room_type: string | null;
  readonly double_lessons: boolean;
  readonly mixed_block: boolean;
  /** "Deliberately short" with its reason (task 5.5a-1); absent where no rule reads it. */
  readonly short_reason?: string | null;
}

const unique = (ids: readonly (string | null)[]): string[] =>
  [...new Set(ids.filter((id): id is string => id !== null))].sort();

/**
 * The rows of `class_tutors` of the classes named, with the staff record of
 * each, found through the account of the assignment, as `class_tutor_on`
 * reads it (db/migrations/0067). Read in a statement of its own, so a caller
 * that locked first sees a change committed before its locks.
 */
export async function readTutorRows(
  transaction: Transaction,
  classIds: readonly string[],
): Promise<Map<string, TutorRow[]>> {
  const found = new Map<string, TutorRow[]>();
  const wanted = unique(classIds);
  if (wanted.length === 0) {
    return found;
  }
  const rows = await transaction
    .selectFrom('class_tutors')
    .innerJoin('assignments', 'assignments.id', 'class_tutors.assignment_id')
    .innerJoin('staff', 'staff.account_id', 'assignments.account_id')
    .select([
      'class_tutors.class_id',
      'class_tutors.kind',
      'class_tutors.valid_from',
      'class_tutors.valid_until',
      'staff.id as staff_id',
    ])
    .where('class_tutors.class_id', 'in', wanted)
    .orderBy('class_tutors.class_id')
    .orderBy('class_tutors.valid_from')
    .orderBy('class_tutors.id')
    .execute();
  for (const row of rows) {
    const own = found.get(row.class_id) ?? [];
    own.push({
      staffId: row.staff_id,
      kind: classTutorKindSchema.parse(row.kind),
      validFrom: row.valid_from,
      validUntil: row.valid_until,
    });
    found.set(row.class_id, own);
  }
  return found;
}

/**
 * The moment a version reads its Tutors at (task 3.6c-2, decision 3): the last
 * moment of the later of its start date and today in branch time (`statusOn`),
 * the end of that day less one millisecond, as `class_tutor_on` reads the
 * day's end.
 */
export async function versionTutorMoment(
  transaction: Transaction,
  context: Pick<VersionContext, 'statusOn' | 'timeZone'>,
): Promise<Date> {
  const { rows } = await sql<{ day_end: Date }>`
    select ((${context.statusOn}::date + 1)::timestamp at time zone ${context.timeZone}) as day_end
  `.execute(transaction);
  const dayEnd = rows[0]?.day_end;
  if (dayEnd === undefined) {
    throw new Error('versionTutorMoment: no answer');
  }
  return new Date(dayEnd.getTime() - 1);
}

/** The classes named, with the class's Tutor of the version (`tutorAt`). Only the classes of the branch. */
export async function readClassFacts(
  transaction: Transaction,
  context: VersionContext,
  ids: readonly string[],
): Promise<Map<string, UnitFacts>> {
  const found = new Map<string, UnitFacts>();
  const wanted = unique(ids);
  if (wanted.length === 0) {
    return found;
  }
  const classes = await transaction
    .selectFrom('classes')
    .select(['id', 'academic_year_id', 'archived_at', 'grade', 'language', 'name'])
    .where('id', 'in', wanted)
    .where('branch_id', '=', context.branchId)
    .execute();
  const tutors = await readTutorRows(
    transaction,
    classes.map((row) => row.id),
  );
  const moment = await versionTutorMoment(transaction, context);
  for (const row of classes) {
    found.set(row.id, {
      id: row.id,
      name: row.name,
      unit: {
        kind: 'class',
        yearId: row.academic_year_id,
        archived: row.archived_at !== null,
        grades: [row.grade],
        language: row.language,
        subjectId: null,
        tutorOnStart: tutorAt(tutors.get(row.id) ?? [], moment),
      },
    });
  }
  return found;
}

/** The groups named, with the grades of their classes. Only the groups of the branch. */
export async function readGroupFacts(
  transaction: Transaction,
  context: VersionContext,
  ids: readonly string[],
): Promise<Map<string, UnitFacts>> {
  const found = new Map<string, UnitFacts>();
  const wanted = unique(ids);
  if (wanted.length === 0) {
    return found;
  }
  const groups = await transaction
    .selectFrom('groups')
    .select(['id', 'academic_year_id', 'archived_at', 'language', 'name', 'subject_id'])
    .where('id', 'in', wanted)
    .where('branch_id', '=', context.branchId)
    .execute();
  const grades = await transaction
    .selectFrom('group_classes')
    .innerJoin('classes', 'classes.id', 'group_classes.class_id')
    .select(['group_classes.group_id', 'classes.grade'])
    .where('group_classes.group_id', 'in', wanted)
    .execute();
  for (const row of groups) {
    found.set(row.id, {
      id: row.id,
      name: row.name,
      unit: {
        kind: 'group',
        yearId: row.academic_year_id,
        archived: row.archived_at !== null,
        grades: [
          ...new Set(grades.filter((one) => one.group_id === row.id).map((one) => one.grade)),
        ].sort((a, b) => a - b),
        language: row.language,
        subjectId: row.subject_id,
        tutorOnStart: null,
      },
    });
  }
  return found;
}

/** The subjects named, with the mark of the Tutors department (decision 2). */
export async function readSubjectFacts(
  transaction: Transaction,
  ids: readonly string[],
): Promise<Map<string, SubjectFacts>> {
  const wanted = unique(ids);
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await transaction
    .selectFrom('subjects')
    .innerJoin('departments', 'departments.id', 'subjects.department_id')
    .select([
      'subjects.id',
      'subjects.archived_at',
      'subjects.grades',
      'subjects.language_rule',
      'subjects.name_uz',
      'subjects.name_ru',
      'subjects.name_en',
      'departments.tutors',
    ])
    .where('subjects.id', 'in', wanted)
    .execute();
  return new Map(
    rows.map((row) => [
      row.id,
      {
        id: row.id,
        archived: row.archived_at !== null,
        grades: row.grades,
        languageRule: row.language_rule,
        tutorSubject: row.tutors,
        names: { uz: row.name_uz, ru: row.name_ru, en: row.name_en },
      },
    ]),
  );
}

/**
 * The teachers and vacancies named, or every record linked to the branch when
 * `ids` is `'branch'`: whether linked to the branch, out on the start date
 * (decision 11: the status row in force then; none counts as in), the
 * profile's subjects and languages. A record the branch no longer sees is
 * answered with its kind only (`staff_record_kind`), out of the branch; a
 * deleted vacancy as a vacancy with no name.
 */
export async function readTeacherFacts(
  transaction: Transaction,
  context: VersionContext,
  ids: readonly string[] | 'branch',
): Promise<Map<string, TeacherFacts>> {
  const wanted =
    ids === 'branch'
      ? (
          await transaction
            .selectFrom('staff_branches')
            .select('staff_id')
            .where('branch_id', '=', context.branchId)
            .execute()
        ).map((row) => row.staff_id)
      : unique(ids);
  const found = new Map<string, TeacherFacts>();
  if (wanted.length === 0) {
    return found;
  }
  const [records, links, statuses, subjects, languages] = await Promise.all([
    transaction
      .selectFrom('staff')
      .select(['id', 'kind', 'first_name', 'last_name', 'vacancy_name'])
      .where('id', 'in', wanted)
      .execute(),
    transaction
      .selectFrom('staff_branches')
      .select('staff_id')
      .where('staff_id', 'in', wanted)
      .where('branch_id', '=', context.branchId)
      .execute(),
    transaction
      .selectFrom('staff_statuses')
      .select(['staff_id', 'status'])
      .where('staff_id', 'in', wanted)
      .where('valid_from', '<=', context.statusOn)
      .where((builder) =>
        builder.or([
          builder('valid_until', 'is', null),
          builder('valid_until', '>', context.statusOn),
        ]),
      )
      .execute(),
    transaction
      .selectFrom('staff_subjects')
      .select(['staff_id', 'subject_id', 'grades'])
      .where('staff_id', 'in', wanted)
      .execute(),
    transaction
      .selectFrom('staff_languages')
      .select(['staff_id', 'language'])
      .where('staff_id', 'in', wanted)
      .execute(),
  ]);
  const linked = new Set(links.map((row) => row.staff_id));
  for (const record of records) {
    found.set(record.id, {
      id: record.id,
      kind: record.kind === 'vacancy' ? 'vacancy' : 'person',
      name:
        record.kind === 'vacancy'
          ? record.vacancy_name
          : listName({ firstName: record.first_name ?? '', lastName: record.last_name ?? '' }),
      inBranch: linked.has(record.id),
      out: statuses.some(
        (row) => row.staff_id === record.id && ['inactive', 'left', 'closed'].includes(row.status),
      ),
      subjects: subjects
        .filter((row) => row.staff_id === record.id)
        .map((row) => ({ subjectId: row.subject_id, grades: row.grades })),
      languages: languages.filter((row) => row.staff_id === record.id).map((row) => row.language),
    });
  }
  for (const id of wanted.filter((one) => !found.has(one))) {
    const kind = (
      await sql<{ kind: string | null }>`select staff_record_kind(${id}::uuid) as kind`.execute(
        transaction,
      )
    ).rows[0]?.kind;
    // A record with no row any more is a deleted vacancy (people are never
    // deleted), named by a row a copy left (permission review, S1).
    {
      found.set(id, {
        id,
        kind: kind === 'person' ? 'person' : 'vacancy',
        name: null,
        inBranch: false,
        out: false,
        subjects: [],
        languages: [],
      });
    }
  }
  return found;
}

/** The rooms named of the branch. */
export async function readRoomFacts(
  transaction: Transaction,
  context: VersionContext,
  ids: readonly (string | null)[],
): Promise<Map<string, RoomFacts>> {
  const wanted = unique(ids);
  if (wanted.length === 0) {
    return new Map();
  }
  const rows = await transaction
    .selectFrom('rooms')
    .select(['id', 'name', 'status'])
    .where('id', 'in', wanted)
    .where('branch_id', '=', context.branchId)
    .execute();
  return new Map(
    rows.map((row) => [row.id, { id: row.id, name: row.name, closed: row.status === 'closed' }]),
  );
}

/**
 * Decision 8: for a group of two grades, whether some working weekday has a
 * lesson slot of the same start and end in both grades' templates in force
 * on the version's start date (`twoGradeSlots`); `null` for any other unit.
 */
export async function sharedSlotOf(
  transaction: Transaction,
  context: VersionContext,
  unit: LoadUnit,
): Promise<boolean | null> {
  const [gradeA, gradeB] = unit.grades;
  if (unit.kind !== 'group' || unit.grades.length !== 2 || gradeA === undefined) {
    return null;
  }
  if (gradeB === undefined) {
    return null;
  }
  const branch = await transaction
    .selectFrom('branches')
    .select('working_weekdays')
    .where('id', '=', context.branchId)
    .executeTakeFirstOrThrow();
  const store = await loadStore(transaction);
  const assignments = store.assignments.filter((row) => !isWithdrawn(row));
  const days = twoGradeSlots(
    gradeA,
    gradeB,
    context.startsOn,
    branch.working_weekdays,
    { assignments },
    (templateId, date) => dayOf(store, templateId, date)?.day ?? null,
  );
  return days.some((day) => day.slots.length > 0);
}

/** The facts of a row that are not of its own records (task 3.4b). */
type FactsRow = Omit<StoredLoadRow, 'room_type' | 'double_lessons'>;

/**
 * What the facts read beside the rows asked for (task 3.4b): `versionRows`,
 * the rows of the version the blocks and the split-or-whole rule read (a row
 * asked for with the id of one of them stands in its place; one with a new id
 * is added); `unplaced`, whether the students not placed are counted
 * (decision 4; a count the answers show, never a refusal).
 */
export interface FactsOptions {
  readonly versionRows?: readonly StoredLoadRow[];
  readonly unplaced?: boolean;
}

/** Every fact the rows of a version need, read in a few statements. */
export class LoadFacts {
  private constructor(
    readonly context: VersionContext,
    readonly units: ReadonlyMap<string, UnitFacts>,
    readonly subjects: ReadonlyMap<string, SubjectFacts>,
    readonly teachers: ReadonlyMap<string, TeacherFacts>,
    readonly rooms: ReadonlyMap<string, RoomFacts>,
    private readonly slots: ReadonlyMap<string, boolean | null>,
    readonly versionRows: readonly StoredLoadRow[],
    readonly groups: ReadonlyMap<string, BlockGroup>,
    private readonly unplaced: ReadonlyMap<string, number>,
  ) {}

  static async of(
    transaction: Transaction,
    context: VersionContext,
    rows: readonly StoredLoadRow[],
    options: FactsOptions = {},
  ): Promise<LoadFacts> {
    const versionRows = options.versionRows ?? [];
    const groupFacts = await readBlockGroups(transaction, [
      ...rows.map((row) => row.group_id),
      ...versionRows.map((row) => row.group_id),
    ]);
    const unplaced =
      options.unplaced === true
        ? await readUnplaced(
            transaction,
            context.branchId,
            versionRows,
            groupFacts,
            context.statusOn,
          )
        : new Map<string, number>();
    const classes = await readClassFacts(
      transaction,
      context,
      rows.map((row) => row.class_id).filter((id): id is string => id !== null),
    );
    const groups = await readGroupFacts(
      transaction,
      context,
      [...rows, ...versionRows]
        .map((row) => row.group_id)
        .filter((id): id is string => id !== null),
    );
    const units = new Map([...classes, ...groups]);
    const slots = new Map<string, boolean | null>();
    for (const id of new Set(rows.map((row) => row.group_id))) {
      const facts = id === null ? undefined : groups.get(id);
      if (id !== null && facts !== undefined) {
        slots.set(id, await sharedSlotOf(transaction, context, facts.unit));
      }
    }
    return new LoadFacts(
      context,
      units,
      await readSubjectFacts(
        transaction,
        rows.map((row) => row.subject_id),
      ),
      await readTeacherFacts(
        transaction,
        context,
        rows.map((row) => row.teacher_id),
      ),
      await readRoomFacts(
        transaction,
        context,
        rows.map((row) => row.room_id),
      ),
      slots,
      versionRows,
      groupFacts,
      unplaced,
    );
  }

  /** The version's rows with `row` in place of the row of its id, or added. */
  private rowsWith(row: FactsRow): StoredLoadRow[] {
    const asStored: StoredLoadRow = {
      room_type: null,
      double_lessons: false,
      ...row,
    };
    return [...this.versionRows.filter((one) => one.id !== row.id), asStored];
  }

  /** The rows of the block of `row` among the version's rows, `row` included; empty for a class row. */
  blockOf(row: FactsRow): StoredLoadRow[] {
    const rows = this.rowsWith(row);
    const ids = new Set(blockOf(row.id, rows.map(blockRowOf), this.groups).map((one) => one.id));
    return rows.filter((one) => ids.has(one.id));
  }

  /**
   * The problems of a row today, in the engine's order. Every record a row
   * names is of the branch or answered by `readTeacherFacts`; one that is not
   * is a fault (spec review of the build, should-fix 6).
   */
  problemsOf(row: FactsRow): LoadProblem[] {
    const unitId = row.class_id ?? row.group_id;
    const unit = unitId === null ? undefined : this.units.get(unitId);
    const subject = this.subjects.get(row.subject_id);
    const teacher = this.teachers.get(row.teacher_id);
    const room = row.room_id === null ? null : this.rooms.get(row.room_id);
    if (
      unit === undefined ||
      subject === undefined ||
      teacher === undefined ||
      room === undefined
    ) {
      throw new Error('A record of a load row of the branch could not be read.');
    }
    return loadRowProblems({
      versionYearId: this.context.yearId,
      unit: unit.unit,
      subject,
      teacher,
      room,
      sharedSlot: unitId === null ? null : (this.slots.get(unitId) ?? null),
      ...this.blockFactsOf(row),
    });
  }

  /** Task 3.4b: the split-or-whole rule, the block rules and the students not placed of a row. */
  blockFactsOf(row: FactsRow): {
    splitAndWhole: boolean;
    blockProblems: ReturnType<typeof blockProblems>;
    unplaced: number;
  } {
    const rows = this.rowsWith(row).map(blockRowOf);
    const own = rows.find((one) => one.id === row.id);
    if (own === undefined) {
      throw new Error('A row is always among its own rows.');
    }
    return {
      splitAndWhole: splitAndWhole(own, rows, this.groups),
      blockProblems: blockProblems(own, blockOf(row.id, rows, this.groups), this.groups),
      unplaced: this.unplaced.get(row.id) ?? 0,
    };
  }

  /** The parts of the block of a row of the version, by group name; empty for a class row or a left row. */
  private blockNamesOf(row: StoredLoadRow): { id: string; name: string }[] {
    if (row.group_id === null || !this.versionRows.some((one) => one.id === row.id)) {
      return [];
    }
    return this.blockOf(row)
      .map((part) => ({
        id: part.id,
        name: part.group_id === null ? '' : (this.units.get(part.group_id)?.name ?? ''),
      }))
      .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
  }

  /** A row as the page shows it, with the problems given (today's, or those a copy kept). */
  answerOf(row: StoredLoadRow, problems: readonly LoadProblem[]): LoadRow {
    const unitId = row.class_id ?? row.group_id ?? '';
    const unit = this.units.get(unitId);
    const subject = this.subjects.get(row.subject_id);
    const teacher = this.teachers.get(row.teacher_id);
    const room = row.room_id === null ? undefined : this.rooms.get(row.room_id);
    if (unit === undefined || subject === undefined || teacher === undefined) {
      throw new Error('A record of a load row of the branch could not be read.');
    }
    return {
      id: row.id,
      unit: {
        kind: unit.unit.kind,
        id: unit.id,
        name: unit.name,
        grades: [...unit.unit.grades],
        language: instructionLanguageSchema.parse(unit.unit.language),
        archived: unit.unit.archived,
      },
      subject: { id: subject.id, names: subject.names },
      teacher: { id: teacher.id, kind: teacher.kind, name: teacher.name },
      lessonsPerWeek: row.lessons_per_week,
      room: room === undefined ? null : { id: room.id, name: room.name },
      roomType: row.room_type === null ? null : roomTypeOf(row.room_type),
      doubleLessons: row.double_lessons,
      mixedBlock: row.mixed_block,
      shortReason: row.short_reason ?? null,
      block: this.blockNamesOf(row),
      unplaced: this.unplaced.get(row.id) ?? 0,
      problems: [...problems],
    };
  }
}

const ROOM_TYPES = ['classroom', 'laboratory', 'sports_hall', 'hall', 'other'] as const;

/** The stored room type; the check of the table keeps it in the list. */
function roomTypeOf(stored: string): (typeof ROOM_TYPES)[number] {
  const found = ROOM_TYPES.find((one) => one === stored);
  if (found === undefined) {
    throw new Error(`Unknown room type ${stored}.`);
  }
  return found;
}
