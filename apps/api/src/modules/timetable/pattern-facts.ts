import { sql } from 'kysely';
import {
  blockOf,
  elsewherePlacement,
  firstOn,
  patternModel,
  templateFor,
  type AvailabilityEntry,
  type Day,
  type EngineDay,
  type EngineTeacher,
  type Facts,
  type PatternFactsData,
  type PatternModel,
  type PatternRoomData,
  type Placement,
} from '@sodiq/timetable-rules';
import type { Transaction } from '../../database/transactions.js';
import { isWithdrawn } from '../setup/dated-rows.js';
import { dayOf, loadStore } from '../setup/day-template-state.js';
import { blockRowOf } from './load-blocks.js';
import type { LoadFacts, StoredLoadRow, VersionContext } from './load-facts.js';

/**
 * The rule engine's input for a weekly pattern of a draft (`mode: 'pattern'`,
 * packages/timetable-rules/src/placement.ts), read from the database (task
 * 5.3b-2): the first reader, used by the pins' check of step 5; the grid
 * (5.4a), publish (5.5a) and the solver re-check (5.10) read their facts here.
 *
 * Every fact is read on `context.statusOn`, the later of the start date and
 * today (5.3a decision 2): the availability entry in force then, the statuses,
 * the members of classes and groups, and the templates weekday by weekday on
 * each weekday's first date on or after it, with no special dates (the weekly
 * pattern, as `weekDaysOf`).
 *
 * Task 5.4b-1: the teachers' lessons in the published pattern in force on
 * `statusOn` in every other branch are read as busy elsewhere
 * (`busyElsewhere`, the engine's `fixed` placements: `timetable_busy_elsewhere`,
 * 0071), and their lessons in the other branches' drafts that can overlap this
 * one as `otherDrafts` (`timetable_drafts_elsewhere`): weekday, times and
 * branch only (decision 2). A later published version of another branch and
 * its one-day changes are dated facts, checked by publish (5.5a, its From
 * 5.4b-1 line). `branchIds` stays this branch when the record is linked to it
 * (review decision 12): its only readers, `checkDay` and `checkResources`
 * (`teacher_branch` and the profile rules), skip fixed placements, and every
 * other placement is of this branch, so another link changes no result.
 *
 * What is not read yet: the end of the version is the end of its year, the
 * next published version comes with 5.5a (it bounds
 * `teacher_unavailable_later`, a warning).
 *
 * The load rows are passed (review correction 3): `checkTimetable` then gives
 * a `load_mismatch` warning for every row with fewer pinned lessons than its
 * load, which no blocked list reads ("a warning while editing a draft", 06,
 * Rules, last row).
 *
 * Task 5.4a: the facts are built as data (`PatternFactsData`) and turned into
 * the engine's input by `patternModel` of the rule engine, the one converter
 * the grid calls too (decision 2); the grid gets `data` as it is.
 */
export interface PatternFacts {
  readonly facts: Facts;
  readonly data: PatternFactsData;
  readonly model: PatternModel;
  /** The lesson of a load row at a time of the pattern, as `checkTimetable` reads it. */
  readonly placementOf: (
    row: StoredLoadRow,
    at: { id: string; blockId: string; weekday: number; start: number; end: number },
  ) => Placement;
  /** The day of the row's lowest grade on the weekday; `null` when it has no lessons. */
  readonly dayOfRow: (row: StoredLoadRow, weekday: number) => Day | null;
}

export async function readPatternFacts(
  transaction: Transaction,
  context: VersionContext,
  rows: readonly StoredLoadRow[],
  load: LoadFacts,
): Promise<PatternFacts> {
  const { branchId, statusOn } = context;
  const teacherIds = [...new Set(rows.map((row) => row.teacher_id))].sort();
  const groupIds = [
    ...new Set(rows.map((row) => row.group_id).filter((id): id is string => id !== null)),
  ].sort();
  const classIds = [
    ...new Set([
      ...rows.map((row) => row.class_id).filter((id): id is string => id !== null),
      ...groupIds.flatMap((id) => load.groups.get(id)?.classIds ?? []),
    ]),
  ].sort();

  const [branch, year, quarters, settings, travel, staff, entries, ranges, rooms] =
    await Promise.all([
      transaction
        .selectFrom('branches')
        .select('working_weekdays')
        .where('id', '=', branchId)
        .executeTakeFirstOrThrow(),
      transaction
        .selectFrom('academic_years')
        .select(['start_date', 'end_date'])
        .where('id', '=', context.yearId)
        .executeTakeFirstOrThrow(),
      transaction
        .selectFrom('quarters')
        .select(['start_date', 'end_date'])
        .where('academic_year_id', '=', context.yearId)
        .orderBy('number')
        .execute(),
      transaction
        .selectFrom('branch_settings')
        .select('class_daily_lessons')
        .where('branch_id', '=', branchId)
        .executeTakeFirst(),
      transaction
        .selectFrom('travel_times')
        .select(['branch_low', 'branch_high', 'minutes'])
        .execute(),
      teacherIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('staff')
            .select(['id', 'kind', 'weekly_lessons', 'daily_lessons'])
            .where('id', 'in', teacherIds)
            .execute(),
      teacherIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('staff_availability')
            .select(['id', 'staff_id', 'valid_from', 'valid_until'])
            .where('staff_id', 'in', teacherIds)
            .where('branch_id', '=', branchId)
            .execute(),
      teacherIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('staff_availability_ranges')
            .select(['entry_id', 'weekday', 'start_minutes', 'end_minutes'])
            .where('staff_id', 'in', teacherIds)
            .where('branch_id', '=', branchId)
            .execute(),
      // Task 5.4b-2a, decision 12: every room of the branch, so that any room a
      // lesson may be put in is known (an entry's room is a room of its branch, 0058).
      transaction
        .selectFrom('rooms')
        .select(['id', 'type', 'status', 'shared', 'max_simultaneous_lessons', 'capacity'])
        .where('branch_id', '=', branchId)
        .orderBy('id')
        .execute(),
    ]);
  const [classMembers, groupMembers] = await Promise.all([
    classIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('class_memberships')
          .select(['class_id', 'student_id'])
          .where('class_id', 'in', classIds)
          .where('valid_from', '<=', statusOn)
          .where('valid_until', '>', statusOn)
          .orderBy('student_id')
          .execute(),
    groupIds.length === 0
      ? Promise.resolve([])
      : transaction
          .selectFrom('group_memberships')
          .select(['group_id', 'student_id'])
          .where('group_id', 'in', groupIds)
          .where('valid_from', '<=', statusOn)
          .where('valid_until', '>', statusOn)
          .orderBy('student_id')
          .execute(),
  ]);

  const elsewhere = async (query: ReturnType<typeof sql<ElsewhereRow>>) =>
    teacherIds.length === 0 ? [] : (await query.execute(transaction)).rows;
  const [busyRows, draftRows] = await Promise.all([
    elsewhere(sql<ElsewhereRow>`
      select * from timetable_busy_elsewhere(${branchId}::uuid, ${sql.val(teacherIds)}::uuid[], ${statusOn}::date)
    `),
    elsewhere(sql<ElsewhereRow>`
      select * from timetable_drafts_elsewhere(${branchId}::uuid, ${sql.val(teacherIds)}::uuid[], ${statusOn}::date, ${year.end_date}::date)
    `),
  ]);
  const lessonOf = (row: ElsewhereRow) => ({
    id: row.entry_id,
    teacherId: row.staff_id,
    branchId: row.branch_id,
    weekday: row.weekday,
    start: row.start_minutes,
    end: row.end_minutes,
  });
  const byId = (a: { id: string }, b: { id: string }) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const otherBranchIds = [
    ...new Set([...busyRows, ...draftRows].map((row) => row.branch_id)),
  ].sort();
  const otherBranches =
    otherBranchIds.length === 0
      ? []
      : await transaction
          .selectFrom('branches')
          .select(['id', 'name'])
          .where('id', 'in', otherBranchIds)
          .orderBy('id')
          .execute();

  const membersOf = (list: readonly { id: string; student: string }[]) => {
    const found = new Map<string, string[]>();
    for (const one of list) {
      found.set(one.id, [...(found.get(one.id) ?? []), one.student]);
    }
    return found;
  };
  const classStudents = membersOf(
    classMembers.map((row) => ({ id: row.class_id, student: row.student_id })),
  );
  const groupStudents = membersOf(
    groupMembers.map((row) => ({ id: row.group_id, student: row.student_id })),
  );

  const teachers = new Map<string, EngineTeacher>();
  for (const id of teacherIds) {
    const known = load.teachers.get(id);
    const record = staff.find((row) => row.id === id);
    if (known === undefined) {
      throw new Error('A teacher of a load row of the branch could not be read.');
    }
    const availability: AvailabilityEntry[] = entries
      .filter((entry) => entry.staff_id === id)
      .map((entry) => ({
        branchId,
        validFrom: entry.valid_from,
        validUntil: entry.valid_until === 'infinity' ? null : entry.valid_until,
        ranges: ranges
          .filter((range) => range.entry_id === entry.id)
          .map((range) => ({
            weekday: range.weekday,
            start: range.start_minutes,
            end: range.end_minutes,
          })),
      }));
    teachers.set(id, {
      id,
      vacancy: known.kind === 'vacancy',
      out: known.out,
      branchIds: known.inBranch ? [branchId] : [],
      subjects: known.subjects,
      languages: known.languages,
      availability,
      weeklyLessons: record?.weekly_lessons ?? null,
      dailyLessons: record?.daily_lessons ?? null,
    });
  }

  const store = await loadStore(transaction);
  const weekly = { assignments: store.assignments.filter((row) => !isWithdrawn(row)) };
  const dayFor = (grade: number, weekday: number): EngineDay => {
    if (!branch.working_weekdays.includes(weekday)) {
      return { lessons: false, reason: 'not_working_day' };
    }
    const date = firstOn(statusOn, weekday);
    const templateId = templateFor(grade, date, weekly);
    const timed = templateId === null ? null : dayOf(store, templateId, date);
    return timed === null
      ? { lessons: false, reason: 'no_template' }
      : { lessons: true, day: timed.day, noRegularLessons: false };
  };

  const unitOf = (row: StoredLoadRow) => {
    const unit = load.units.get(row.class_id ?? row.group_id ?? '');
    if (unit === undefined) {
      throw new Error('A class or group of a load row of the branch could not be read.');
    }
    return unit;
  };
  const units = [...new Map(rows.map((row) => [unitOf(row).id, unitOf(row)])).values()].sort(
    (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const mainRooms =
    classIds.length === 0
      ? []
      : await transaction
          .selectFrom('classes')
          .select(['id', 'main_room_id'])
          .where('id', 'in', classIds)
          .execute();
  const mainRoomOf = new Map(mainRooms.map((one) => [one.id, one.main_room_id]));
  const grades = [...new Set(units.flatMap((unit) => unit.unit.grades))].sort((a, b) => a - b);
  const blockRows = rows.map(blockRowOf);

  const data: PatternFactsData = {
    branchId,
    startDate: statusOn,
    versionEnd: year.end_date,
    teachers: [...teachers.values()],
    subjects: [...load.subjects.values()]
      .map((subject) => ({
        id: subject.id,
        active: !subject.archived,
        languageRule: subject.languageRule,
        tutorSubject: subject.tutorSubject,
      }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
    rooms: rooms.map(roomDataOf),
    units: units.map((unit) => {
      const group = unit.unit.kind === 'group' ? load.groups.get(unit.id) : undefined;
      return {
        id: unit.id,
        kind: unit.unit.kind,
        grades: unit.unit.grades,
        language: unit.unit.language,
        tutorOnStart: unit.unit.tutorOnStart,
        classIds: unit.unit.kind === 'class' ? [unit.id] : [...(group?.classIds ?? [])],
        studentIds:
          unit.unit.kind === 'class'
            ? (classStudents.get(unit.id) ?? [])
            : (groupStudents.get(unit.id) ?? []),
        mainRoomId: unit.unit.kind === 'class' ? (mainRoomOf.get(unit.id) ?? null) : null,
      };
    }),
    classStudents: classIds.map((classId) => ({
      classId,
      studentIds: classStudents.get(classId) ?? [],
    })),
    days: grades.flatMap((grade) =>
      [1, 2, 3, 4, 5, 6, 7].map((weekday) => ({ grade, weekday, day: dayFor(grade, weekday) })),
    ),
    year: {
      firstDate: year.start_date,
      lastDate: year.end_date,
      quarters: quarters.flatMap((quarter) =>
        quarter.start_date === null || quarter.end_date === null
          ? []
          : [{ firstDate: quarter.start_date, lastDate: quarter.end_date }],
      ),
    },
    travel: travel.map((row) => ({
      branchA: row.branch_low,
      branchB: row.branch_high,
      minutes: row.minutes,
    })),
    classDailyLessons: settings?.class_daily_lessons ?? null,
    rows: rows.map((row) => {
      const block = row.group_id === null ? [] : blockOf(row.id, blockRows, load.groups);
      return {
        id: row.id,
        classId: row.class_id,
        groupId: row.group_id,
        subjectId: row.subject_id,
        teacherId: row.teacher_id,
        roomId: row.room_id,
        roomType: row.room_type,
        lessonsPerWeek: row.lessons_per_week,
        mixedBlock: row.mixed_block,
        doubleLessons: row.double_lessons,
        block: block.length === 0 ? [row.id] : block.map((one) => one.id).sort(),
      };
    }),
    busyElsewhere: busyRows
      .map((row) => ({ ...lessonOf(row), tutorLesson: row.tutor_lesson ?? false }))
      .sort(byId),
    otherDrafts: draftRows.map((row) => elsewherePlacement(lessonOf(row), false)).sort(byId),
    branches: otherBranches,
  };
  const model = patternModel(data);

  return {
    facts: model.facts,
    data,
    model,
    placementOf: (row, at) =>
      model.placementOf(model.rowOf(row.id), { ...at, roomId: row.room_id, doublePairId: null }),
    dayOfRow: (row, weekday) => model.dayOfRows([model.rowOf(row.id)], weekday),
  };
}

/** A row of `timetable_busy_elsewhere` or `timetable_drafts_elsewhere` (0071). */
interface ElsewhereRow {
  readonly staff_id: string;
  readonly branch_id: string;
  readonly entry_id: string;
  readonly weekday: number;
  readonly start_minutes: number;
  readonly end_minutes: number;
  /** `timetable_busy_elsewhere` only. */
  readonly tutor_lesson?: boolean;
}

function roomDataOf(room: {
  id: string;
  type: string;
  status: string;
  shared: boolean;
  max_simultaneous_lessons: number | null;
  capacity: number;
}): PatternRoomData {
  return {
    id: room.id,
    type: room.type,
    status:
      room.status === 'closed'
        ? 'closed'
        : room.status === 'under_repair'
          ? 'under_repair'
          : 'in_use',
    shared: room.shared,
    lessonsAtOnce: room.max_simultaneous_lessons ?? 1,
    capacity: room.capacity,
  };
}
