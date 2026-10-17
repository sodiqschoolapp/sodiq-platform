/**
 * The rule engine's input for the weekly pattern of a draft as plain data
 * (task 5.4a, decision 2): what the API reads from the database
 * (`readPatternFacts`) and sends to the grid, so the browser checks a move
 * with the very input the server checks it with (docs/spec/14-quality-plan.md,
 * Timetable, One rule engine: "The same checking code runs in the browser
 * while dragging and on the server when saving. The two can never disagree.").
 *
 * `patternModel` is the one place that turns the data back into `Facts` and
 * builds a lesson of a load row (`placementOf`); both sides call it. The dates
 * each fact is read on are those of `placement.ts` for a pattern.
 */
import type { Day } from './day.js';
import type {
  EngineDay,
  EngineLoadRow,
  EngineRoom,
  EngineSubject,
  EngineTeacher,
  EngineUnit,
  EngineYear,
  Facts,
  Placement,
} from './placement.js';

/** A class or group of the draft's rows, with its classes and its members on the reading date. */
export interface PatternUnitData extends EngineUnit {
  /** The class itself, or the classes a group draws from. */
  readonly classIds: readonly string[];
  readonly studentIds: readonly string[];
  /** A class's main classroom (`classes.main_room_id`); `null` for a group. */
  readonly mainRoomId: string | null;
}

/**
 * A room of the branch (task 5.4b-2a, decision 12): every room, so that the
 * engine knows any room a lesson may be put in, with its type for the room
 * picker's best fit.
 */
export interface PatternRoomData extends EngineRoom {
  /** `rooms.type` (03, rooms: classroom, laboratory, sports hall and so on). */
  readonly type: string;
}

/** A load row of the draft as the pattern reads it. */
export interface PatternRowData {
  readonly id: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly subjectId: string;
  readonly teacherId: string;
  /** The row's own room; `null` with a room type or none. */
  readonly roomId: string | null;
  /** The type of special room the row needs (`load_rows.room_type`); `null` with a room or none (task 5.4b-2a). */
  readonly roomType: string | null;
  readonly lessonsPerWeek: number;
  readonly mixedBlock: boolean;
  /** The rows of its block, the row included, sorted (`blockOf`); the row alone for a class row. */
  readonly block: readonly string[];
}

/**
 * A lesson of a teacher of the draft in the published pattern of another
 * branch (task 5.4b-1): busy elsewhere (06, Teachers who work in several
 * branches). Its weekday, times and branch only, no class, subject or room
 * (decision 2); `tutorLesson` for the load step's list of a Tutor of classes in
 * two branches.
 */
export interface ElsewhereLessonData {
  /** The other branch's pattern entry. */
  readonly id: string;
  readonly teacherId: string;
  readonly branchId: string;
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
  readonly tutorLesson: boolean;
}

export interface PatternFactsData {
  readonly branchId: string;
  /** The later of the draft's start date and today (`placement.ts`). */
  readonly startDate: string;
  readonly versionEnd: string;
  readonly teachers: readonly EngineTeacher[];
  readonly subjects: readonly EngineSubject[];
  /** Every room of the branch and every room a stored entry holds (task 5.4b-2a). */
  readonly rooms: readonly PatternRoomData[];
  readonly units: readonly PatternUnitData[];
  /** The members of every class of the units, groups' classes included. */
  readonly classStudents: readonly {
    readonly classId: string;
    readonly studentIds: readonly string[];
  }[];
  /** What each grade of the units has on each weekday 1 to 7. */
  readonly days: readonly {
    readonly grade: number;
    readonly weekday: number;
    readonly day: EngineDay;
  }[];
  readonly year: EngineYear;
  /** Travel times between two branches that are set (`null` pairs are left out). */
  readonly travel: readonly {
    readonly branchA: string;
    readonly branchB: string;
    readonly minutes: number;
  }[];
  readonly classDailyLessons: number | null;
  readonly rows: readonly PatternRowData[];
  /** The teachers' lessons in other branches' published patterns in force on `startDate`. */
  readonly busyElsewhere: readonly ElsewhereLessonData[];
  /** The teachers' lessons in other branches' drafts (06, Two drafts at once), for `other_draft`. */
  readonly otherDrafts: readonly Placement[];
  /** The name of every other branch met in `busyElsewhere` and `otherDrafts`. */
  readonly branches: readonly { readonly id: string; readonly name: string }[];
}

/**
 * A teacher's lesson in another branch as the engine reads it: `fixed` for a
 * published one (busy elsewhere: in every clash and the travel time, no rule
 * of its own), not for a draft's (`other_draft` only). A block of its own,
 * with no class, subject, row or room.
 */
export function elsewherePlacement(
  lesson: Omit<ElsewhereLessonData, 'tutorLesson'>,
  fixed: boolean,
): Placement {
  return {
    id: lesson.id,
    kind: 'lesson',
    branchId: lesson.branchId,
    day: String(lesson.weekday),
    start: lesson.start,
    end: lesson.end,
    blockId: lesson.id,
    doublePairId: null,
    classId: null,
    groupId: null,
    classIds: [],
    studentIds: [],
    exemptStudentIds: [],
    subjectId: null,
    loadRowId: null,
    teacherIds: [lesson.teacherId],
    substitute: false,
    roomId: null,
    examRooms: [],
    fixed,
  };
}

/** Where a lesson of the pattern sits. */
export interface PatternAt {
  readonly id: string;
  readonly blockId: string;
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
  readonly roomId: string | null;
}

export interface PatternModel {
  readonly data: PatternFactsData;
  readonly facts: Facts;
  /** The busy-elsewhere lessons (`busyElsewhere`) as fixed placements, for every check of the pattern. */
  readonly fixed: readonly Placement[];
  /** A row of the draft; throws for one not in the data (a caller's fault). */
  readonly rowOf: (rowId: string) => PatternRowData;
  readonly unitOf: (unitId: string) => PatternUnitData;
  /** The lesson of a load row at a time of the pattern, as `checkTimetable` reads it. */
  readonly placementOf: (row: PatternRowData, at: PatternAt) => Placement;
  /** The day of the lowest grade of the rows' units on the weekday; `null` when it has no lessons. */
  readonly dayOfRows: (rows: readonly PatternRowData[], weekday: number) => Day | null;
  /** The room a new lesson of the row takes: its own, else a class row's main classroom, else none. */
  readonly roomOfNew: (row: PatternRowData) => string | null;
}

const travelKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

function need<T>(map: ReadonlyMap<string, T>, id: string, kind: string): T {
  const found = map.get(id);
  if (found === undefined) {
    throw new Error(`The pattern facts have no ${kind} ${id}.`);
  }
  return found;
}

/** The engine's input of a draft's pattern from its data. */
export function factsFromData(data: PatternFactsData): Facts {
  const days = new Map(data.days.map((one) => [`${one.grade}:${one.weekday}`, one.day]));
  const classStudents = new Map(data.classStudents.map((one) => [one.classId, one.studentIds]));
  const travel = new Map(
    data.travel.map((one) => [travelKey(one.branchA, one.branchB), one.minutes]),
  );
  const loadRows: EngineLoadRow[] = data.rows.map((row) => ({
    id: row.id,
    lessonsPerWeek: row.lessonsPerWeek,
    // Stored with publish (5.5a).
    deliberatelyShort: false,
  }));
  return {
    mode: 'pattern',
    startDate: data.startDate,
    versionEnd: data.versionEnd,
    teachers: new Map(data.teachers.map((one) => [one.id, one])),
    subjects: new Map(data.subjects.map((one) => [one.id, one])),
    rooms: new Map(data.rooms.map((one) => [one.id, one])),
    units: new Map(
      data.units.map((one): [string, EngineUnit] => [
        one.id,
        {
          id: one.id,
          kind: one.kind,
          grades: one.grades,
          language: one.language,
          tutorOnStart: one.tutorOnStart,
        },
      ]),
    ),
    classStudents: (classId) => classStudents.get(classId) ?? [],
    dayOf: (branchId, grade, day) => {
      if (branchId !== data.branchId) {
        throw new Error(`The pattern facts have no days of branch ${branchId}.`);
      }
      return need(days, `${grade}:${day}`, 'day');
    },
    years: new Map([[data.branchId, data.year]]),
    travelMinutes: (a, b) => (a === b ? 0 : (travel.get(travelKey(a, b)) ?? null)),
    classDailyLessons: (branchId) => (branchId === data.branchId ? data.classDailyLessons : null),
    loadRows,
    otherDrafts: data.otherDrafts,
  };
}

/** The facts of a draft's pattern with the builders the grid and the API share. */
export function patternModel(data: PatternFactsData): PatternModel {
  const facts = factsFromData(data);
  const rows = new Map(data.rows.map((row) => [row.id, row]));
  const units = new Map(data.units.map((unit) => [unit.id, unit]));
  const unitOf = (unitId: string) => need(units, unitId, 'class or group');
  const unitOfRow = (row: PatternRowData) => unitOf(row.classId ?? row.groupId ?? '');
  return {
    data,
    facts,
    fixed: data.busyElsewhere.map((lesson) => elsewherePlacement(lesson, true)),
    rowOf: (rowId) => need(rows, rowId, 'load row'),
    unitOf,
    placementOf: (row, at) => {
      const unit = unitOfRow(row);
      return {
        id: at.id,
        kind: 'lesson',
        branchId: data.branchId,
        day: String(at.weekday),
        start: at.start,
        end: at.end,
        blockId: at.blockId,
        doublePairId: null,
        classId: row.classId,
        groupId: row.groupId,
        classIds: unit.classIds,
        studentIds: unit.studentIds,
        exemptStudentIds: [],
        subjectId: row.subjectId,
        loadRowId: row.id,
        teacherIds: [row.teacherId],
        substitute: false,
        roomId: at.roomId,
        examRooms: [],
        fixed: false,
      };
    },
    dayOfRows: (list, weekday) => {
      const grades = list.flatMap((row) => unitOfRow(row).grades);
      if (grades.length === 0) return null;
      const day = facts.dayOf(data.branchId, Math.min(...grades), String(weekday));
      return day.lessons ? day.day : null;
    },
    roomOfNew: (row) => row.roomId ?? (row.classId === null ? null : unitOfRow(row).mainRoomId),
  };
}
