import {
  blockOf,
  firstOn,
  patternModel,
  templateFor,
  type AvailabilityEntry,
  type Day,
  type EngineDay,
  type EngineRoom,
  type EngineTeacher,
  type Facts,
  type PatternFactsData,
  type PatternModel,
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
 * What is not read yet: the published lessons of other branches as busy
 * elsewhere (`fixed`) and the drafts of other branches (`otherDrafts`, empty),
 * which 5.4b adds (decision 1; its From line); the teacher's other branches
 * (`branchIds` is this branch when the record is linked to it, which is all
 * `teacher_branch` reads while every placement is of this branch); the end of
 * the version is the end of its year, the next published version comes with
 * 5.5a (it bounds `teacher_unavailable_later`, a warning).
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
  const roomIds = [
    ...new Set(rows.map((row) => row.room_id).filter((id): id is string => id !== null)),
  ].sort();
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
      roomIds.length === 0
        ? Promise.resolve([])
        : transaction
            .selectFrom('rooms')
            .select(['id', 'status', 'shared', 'max_simultaneous_lessons', 'capacity'])
            .where('id', 'in', roomIds)
            .where('branch_id', '=', branchId)
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

  const engineRooms = new Map<string, EngineRoom>(
    rooms.map((room) => [room.id, engineRoomOf(room)]),
  );

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
  // A main classroom a new lesson may take is read as every room the rows name.
  const moreRoomIds = [
    ...new Set(
      mainRooms
        .map((one) => one.main_room_id)
        .filter((id): id is string => id !== null && !engineRooms.has(id)),
    ),
  ].sort();
  if (moreRoomIds.length > 0) {
    const more = await transaction
      .selectFrom('rooms')
      .select(['id', 'status', 'shared', 'max_simultaneous_lessons', 'capacity'])
      .where('id', 'in', moreRoomIds)
      .where('branch_id', '=', branchId)
      .execute();
    for (const room of more) {
      engineRooms.set(room.id, engineRoomOf(room));
    }
  }
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
    rooms: [...engineRooms.values()],
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
        lessonsPerWeek: row.lessons_per_week,
        mixedBlock: row.mixed_block,
        block: block.length === 0 ? [row.id] : block.map((one) => one.id).sort(),
      };
    }),
    otherDrafts: [],
  };
  const model = patternModel(data);

  return {
    facts: model.facts,
    data,
    model,
    placementOf: (row, at) =>
      model.placementOf(model.rowOf(row.id), { ...at, roomId: row.room_id }),
    dayOfRow: (row, weekday) => model.dayOfRows([model.rowOf(row.id)], weekday),
  };
}

function engineRoomOf(room: {
  id: string;
  status: string;
  shared: boolean;
  max_simultaneous_lessons: number | null;
  capacity: number;
}): EngineRoom {
  return {
    id: room.id,
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
