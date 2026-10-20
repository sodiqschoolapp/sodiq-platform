/**
 * The rule engine (docs/spec/06-timetable.md, Rules; task 5.2, pull request
 * #109): every blocked rule and warning of a set of placed lessons and exams,
 * by clock time. `checkTimetable` checks a whole draft or a range of dated
 * lessons; `checkCandidate` the results that name one placement (the grid
 * while dragging, a route's refusal). See `placement.ts` for the input.
 */
import { lessonTimeProblem, type Day } from './day.js';
import { teacherProblems, type LoadProblem, type LoadUnit } from './load.js';
import type {
  CheckOptions,
  EngineDay,
  EngineLoadRow,
  EngineTeacher,
  EngineUnit,
  Facts,
  Placement,
} from './placement.js';
import {
  RELAXED_WHEN_NO_TEACHER_FREE,
  RULE_ORDER,
  WARNINGS,
  type RuleCode,
  type RuleResult,
} from './rules.js';
import { firstOn, inForceOn, weekdayOf } from './templates.js';

/** Two half-open spans overlap: 09:00–09:45 and 09:45–10:30 do not. */
const overlaps = (a: Placement, b: Placement) => a.start < b.end && b.start < a.end;

const byStart = (a: Placement, b: Placement) =>
  a.start - b.start || a.end - b.end || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

const RANK = new Map<RuleCode, number>(RULE_ORDER.map((code, index) => [code, index]));

/** A detail written the same way whatever the order of its fields. */
const detailKey = (detail: Readonly<Record<string, number | string>> | undefined) =>
  detail === undefined
    ? ''
    : JSON.stringify(Object.entries(detail).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

/**
 * Collects results, one per rule, day, set of placements and detail. Results
 * that tie in the report order keep the order they were found in.
 */
class Results {
  private readonly seen = new Map<string, RuleResult>();

  constructor(
    readonly options: CheckOptions,
    private readonly fixed: ReadonlySet<string>,
    private readonly mode: Facts['mode'],
  ) {}

  add(
    rule: RuleCode,
    day: string,
    placements: readonly Placement[],
    detail?: Readonly<Record<string, number | string>>,
  ): void {
    // A result made only of busy-elsewhere lessons belongs to the other branch.
    if (placements.length > 0 && placements.every((one) => this.fixed.has(one.id))) {
      return;
    }
    const ids = [...new Map(placements.map((one) => [one.id, one])).values()]
      .sort(byStart)
      .map((one) => one.id);
    // The detail is part of a result's identity: two results of one rule over
    // the same placements that differ in a date, a load row, a teacher, a
    // room or a slot are two results; the same rule over the same set with
    // the same detail (a shared room reached from several starts) stays one.
    const key = `${rule}|${day}|${ids.join(',')}|${detailKey(detail)}`;
    if (this.seen.has(key)) {
      return;
    }
    // Only a substitute's own lesson in a one-day change, never a pattern or
    // another lesson of the call (edge/timetable, After publishing, "No
    // teacher of the subject is free": "For a one-day change only").
    const relaxed =
      this.options.noSubjectTeacherFree === true &&
      this.mode === 'dated' &&
      RELAXED_WHEN_NO_TEACHER_FREE.includes(rule) &&
      placements.length === 1 &&
      placements.every((one) => one.substitute);
    const severity = WARNINGS.includes(rule) || relaxed ? 'warning' : 'blocked';
    this.seen.set(key, {
      rule,
      severity,
      day,
      lessonIds: ids,
      ...(detail === undefined ? {} : { detail }),
    });
  }

  list(): RuleResult[] {
    return [...this.seen.values()].sort(
      (a, b) =>
        (RANK.get(a.rule) ?? 0) - (RANK.get(b.rule) ?? 0) ||
        (a.day < b.day ? -1 : a.day > b.day ? 1 : 0) ||
        compareIds(a.lessonIds, b.lessonIds),
    );
  }
}

function compareIds(a: readonly string[], b: readonly string[]): number {
  const x = a.join(',');
  const y = b.join(',');
  return x < y ? -1 : x > y ? 1 : 0;
}

/** Groups items by a key; an item may have several keys. */
function groupBy<T>(items: readonly T[], keys: (item: T) => readonly string[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    for (const key of new Set(keys(item))) {
      const list = groups.get(key);
      if (list === undefined) {
        groups.set(key, [item]);
      } else {
        list.push(item);
      }
    }
  }
  return groups;
}

/**
 * Every pair of placements of one resource that overlap in time on one day:
 * a sweep over the placements sorted by start, comparing each with those
 * still running. A property test compares it with all pairs.
 */
export function overlappingPairs(
  placements: readonly Placement[],
  resources: (placement: Placement) => readonly string[],
): [Placement, Placement][] {
  const pairs: [Placement, Placement][] = [];
  const groups = groupBy(placements, (one) => resources(one).map((key) => `${one.day}|${key}`));
  for (const group of groups.values()) {
    const ordered = [...group].sort(byStart);
    let running: Placement[] = [];
    for (const current of ordered) {
      running = running.filter((one) => one.end > current.start);
      for (const earlier of running) {
        pairs.push([earlier, current]);
      }
      running.push(current);
    }
  }
  return pairs;
}

/**
 * A fact the caller must give: a placement whose teacher, unit, subject or
 * room is missing from the facts is a fault of the caller, never a free slot
 * (CLAUDE.md, What matters most, 1).
 */
function need<T>(map: ReadonlyMap<string, T>, id: string, kind: string): T {
  const found = map.get(id);
  if (found === undefined) {
    throw new Error(`The facts of the rule engine have no ${kind} ${id}.`);
  }
  return found;
}

const teachersOf = (one: Placement) => one.teacherIds;

const roomsOf = (one: Placement): string[] =>
  one.kind === 'lesson'
    ? one.roomId === null
      ? []
      : [one.roomId]
    : one.examRooms.map((room) => room.roomId);

/** The weekday of a placement's day: the day itself in a pattern, the date's weekday otherwise. */
const weekdayOfDay = (facts: Facts, day: string) =>
  facts.mode === 'pattern' ? Number(day) : weekdayOf(day);

const addDays = (date: string, days: number) => {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
};

/** The week of a day: '' for a pattern (one week), the Monday of a date. */
const weekOf = (facts: Facts, day: string) =>
  facts.mode === 'pattern' ? '' : addDays(day, 1 - weekdayOf(day));

/** The grades whose template a placement must fit: its unit's, or its classes' for an exam. */
function gradesOf(facts: Facts, placement: Placement): number[] {
  const unitId = placement.classId ?? placement.groupId;
  if (unitId !== null) {
    return [...need(facts.units, unitId, 'class or group').grades];
  }
  const grades = new Set<number>();
  for (const classId of placement.classIds) {
    for (const grade of need(facts.units, classId, 'class').grades) {
      grades.add(grade);
    }
  }
  return [...grades].sort((a, b) => a - b);
}

// --- One place at a time ---------------------------------------------------

function checkTeacherDouble(placements: readonly Placement[], results: Results): void {
  for (const [a, b] of overlappingPairs(placements, teachersOf)) {
    results.add('teacher_double', a.day, [a, b]);
  }
}

function checkClashes(placements: readonly Placement[], facts: Facts, results: Results): void {
  checkTeacherDouble(placements, results);
  const sharedRoom = (roomId: string) => need(facts.rooms, roomId, 'room').shared;
  for (const [a, b] of overlappingPairs(placements, (one) =>
    roomsOf(one).filter((roomId) => !sharedRoom(roomId)),
  )) {
    results.add('room_double', a.day, [a, b]);
  }
  checkSharedRooms(placements, facts, results);
  // Two lessons of one block at once are no class clash (decision 6).
  for (const [a, b] of overlappingPairs(placements, (one) => one.classIds)) {
    if (a.blockId === null || a.blockId !== b.blockId) {
      results.add('class_double', a.day, [a, b]);
    }
  }
  for (const [a, b] of overlappingPairs(placements, (one) => one.studentIds)) {
    results.add('student_double', a.day, [a, b]);
  }
}

/**
 * A shared room over its lessons at once, or with more students than its
 * capacity in the lessons running together (edge/timetable, Structure; 5.1a
 * decision 2). An exam is one use, and its students are not counted against
 * the shared capacity (decision 16).
 */
function checkSharedRooms(placements: readonly Placement[], facts: Facts, results: Results): void {
  const groups = groupBy(placements, (one) =>
    roomsOf(one)
      .filter((roomId) => facts.rooms.get(roomId)?.shared === true)
      .map((roomId) => `${one.day}|${roomId}`),
  );
  for (const [key, group] of groups) {
    const roomId = key.slice(key.indexOf('|') + 1);
    const room = facts.rooms.get(roomId);
    if (room === undefined) continue;
    // The most at once is reached at the start of some placement.
    for (const at of group) {
      const together = group.filter((one) => one.start <= at.start && at.start < one.end);
      if (together.length > room.lessonsAtOnce) {
        results.add('room_shared_full', at.day, together, { lessonsAtOnce: room.lessonsAtOnce });
      }
      const students = together
        .filter((one) => one.kind === 'lesson')
        .reduce((sum, one) => sum + one.studentIds.length, 0);
      if (students > room.capacity) {
        results.add(
          'room_shared_capacity',
          at.day,
          together.filter((one) => one.kind === 'lesson'),
          { capacity: room.capacity, students },
        );
      }
    }
  }
}

/**
 * Every student of a block's classes in one of its lessons (06, Rules: "All
 * groups or parts of one split are in the same slot, so that every student of
 * the class has a lesson at that time"; edge/timetable, Structure: "A block is
 * valid when every student of its classes is in exactly one of its lessons").
 * Twice is `student_double`. Task 5.4c-3b (decision 6, review correction 1):
 * a block of the pattern holds the rows of one block of the load, or a
 * pairing of two mixed halves that are each other's partners; any other set
 * of rows (a pairing whose mark was cleared since) leaves a split apart.
 */
function checkBlocks(placements: readonly Placement[], facts: Facts, results: Results): void {
  const loadRows = new Map(facts.loadRows.map((row) => [row.id, row]));
  const blocks = groupBy(
    placements.filter((one) => one.kind === 'lesson' && one.blockId !== null),
    (one) => [`${one.day}|${one.blockId ?? ''}`],
  );
  for (const block of blocks.values()) {
    const first = block[0];
    if (first === undefined) continue;
    if (block.some((one) => one.start !== first.start || one.end !== first.end)) {
      results.add('split_apart', first.day, block, {
        slots: new Set(block.map((one) => one.start)).size,
      });
      continue;
    }
    if (!rowsTogether(block, loadRows)) {
      results.add('split_apart', first.day, block, {
        rows: new Set(block.map((one) => one.loadRowId)).size,
      });
    }
    const exempt = new Set(block.flatMap((one) => one.exemptStudentIds));
    const placed = new Set(block.flatMap((one) => one.studentIds));
    const classIds = new Set(block.flatMap((one) => one.classIds));
    const missing = [...classIds]
      .flatMap((classId) => facts.classStudents(classId, first.day))
      .filter((studentId) => !exempt.has(studentId) && !placed.has(studentId));
    if (missing.length > 0) {
      results.add('split_apart', first.day, block, { students: new Set(missing).size });
    }
  }
}

/**
 * Whether the lessons of a block are the rows of one block of the load, or a
 * pairing of two partners (task 5.4c-3b); `true` when a row is not known so
 * (a lesson of no row, a row without `block`).
 */
function rowsTogether(
  block: readonly Placement[],
  loadRows: ReadonlyMap<string, EngineLoadRow>,
): boolean {
  const ids = [...new Set(block.map((one) => one.loadRowId))];
  const rows: EngineLoadRow[] = [];
  for (const id of ids) {
    const row = id === null ? undefined : loadRows.get(id);
    if (row?.block === undefined) return true;
    rows.push(row);
  }
  const [first, second] = rows;
  if (first?.block === undefined) return true;
  const own = first.block;
  if (rows.length === own.length && rows.every((row) => own.includes(row.id))) return true;
  return (
    rows.length === 2 &&
    second !== undefined &&
    first.partners?.includes(second.id) === true &&
    second.partners?.includes(first.id) === true
  );
}

// --- The day --------------------------------------------------------------

function inQuarter(facts: Facts, placement: Placement): RuleCode | null {
  const year = facts.years.get(placement.branchId);
  if (year === undefined || placement.day < year.firstDate || placement.day > year.lastDate) {
    return 'outside_year';
  }
  const quarter = year.quarters.some(
    (one) => one.firstDate <= placement.day && placement.day <= one.lastDate,
  );
  return quarter ? null : 'vacation';
}

/** The day rules and the one-slot rule of one placement. */
function checkDay(placement: Placement, facts: Facts, results: Results): void {
  if (facts.mode === 'dated') {
    const outside = inQuarter(facts, placement);
    if (outside !== null) {
      results.add(outside, placement.day, [placement]);
      return;
    }
  }
  const grades = gradesOf(facts, placement);
  const days: { grade: number; day: EngineDay }[] = grades.map((grade) => ({
    grade,
    day: facts.dayOf(placement.branchId, grade, placement.day),
  }));
  const offByDay = (one: (typeof days)[number]) =>
    !one.day.lessons &&
    one.day.reason === 'day_off' &&
    placement.gradesOff?.includes(one.grade) === true;
  const excused = (one: (typeof days)[number]) =>
    offByDay(one) && days.some((other) => other.day.lessons);
  for (const one of days) {
    // Task 5.6b-3: a grade of a kept two-grade lesson off by a day off,
    // while another grade of it has school.
    if (excused(one)) continue;
    if (!one.day.lessons) {
      results.add(one.day.reason, placement.day, [placement], { grade: one.grade });
      return;
    }
  }
  const open = days.flatMap((one) => (one.day.lessons ? [{ grade: one.grade, day: one.day }] : []));
  if (placement.kind === 'lesson' && open.some((one) => one.day.noRegularLessons)) {
    results.add('exam_week', placement.day, [placement]);
  }
  // An exam is not a lesson for the one-slot rule (06, Rules, the exam row).
  if (placement.kind === 'exam') {
    return;
  }
  const problems = open.map((one) =>
    lessonTimeProblem(one.day.day, placement.start, placement.end),
  );
  const failing = problems.filter((problem) => problem !== null);
  if (failing.length === 0) {
    return;
  }
  if (failing.length < problems.length) {
    // A group of two grades: one template has the slot, the other has not
    // (06, Rules; edge/timetable, Structure).
    results.add('two_grade_slot', placement.day, [placement]);
    return;
  }
  const problem = failing[0];
  if (problem !== undefined && problem !== null) {
    results.add(problem, placement.day, [placement]);
  }
}

/** The lesson number of the lesson slot with these times, or `null`. */
const lessonNumberAt = (day: Day, start: number, end: number) =>
  day.slots.find((slot) => slot.start === start && slot.end === end)?.lessonNumber ?? null;

/**
 * Double lessons: "Two linked lessons in consecutive lesson slots with the
 * same teacher and room" (edge/timetable, Structure). A double of a block of
 * several lessons is two lessons per load row, each row checked on its own
 * (task 5.4c-3a, decision 3); a lesson with no row is keyed by its unit.
 * `double_not_allowed`: a double of a row that does not allow double lessons
 * (05, Teaching load: "whether double lessons are allowed"; decision 2).
 */
function checkDoubles(placements: readonly Placement[], facts: Facts, results: Results): void {
  const pairs = groupBy(
    placements.filter((one) => one.kind === 'lesson' && one.doublePairId !== null),
    (one) => [
      `${one.day}|${one.doublePairId ?? ''}|${one.loadRowId ?? one.groupId ?? one.classId ?? ''}`,
    ],
  );
  const rows = new Map(facts.loadRows.map((row) => [row.id, row]));
  for (const pair of pairs.values()) {
    const rowId = pair[0]?.loadRowId ?? null;
    if (rowId !== null && rows.get(rowId)?.doubleLessons === false) {
      results.add('double_not_allowed', pair[0]?.day ?? '', pair);
    }
    const [first, second, ...rest] = [...pair].sort(byStart);
    if (first === undefined) continue;
    if (second === undefined || rest.length > 0) {
      results.add('double_apart', first.day, pair);
      continue;
    }
    const sameTeacher = first.teacherIds.join(',') === second.teacherIds.join(',');
    let consecutive = true;
    for (const grade of gradesOf(facts, first)) {
      const engineDay = facts.dayOf(first.branchId, grade, first.day);
      if (!engineDay.lessons) continue;
      const a = lessonNumberAt(engineDay.day, first.start, first.end);
      const b = lessonNumberAt(engineDay.day, second.start, second.end);
      if (a === null || b === null || b !== a + 1) {
        consecutive = false;
      }
    }
    if (!sameTeacher || first.roomId !== second.roomId || !consecutive) {
      results.add('double_apart', first.day, [first, second]);
    }
  }
}

// --- The teacher, the subject and the room ----------------------------------

const PROFILE_RULES: Partial<Record<LoadProblem, RuleCode>> = {
  load_teacher_branch: 'teacher_branch',
  load_teacher_status: 'teacher_inactive',
  load_teacher_subject: 'teacher_subject',
  load_teacher_grade: 'teacher_grade',
  load_teacher_language: 'teacher_language',
};

/** The unit as `teacherProblems` of the load reads it (one profile rule for the load and the lesson). */
function loadUnitOf(unit: EngineUnit): LoadUnit {
  return {
    kind: unit.kind,
    yearId: '',
    archived: false,
    grades: unit.grades,
    language: unit.language,
    subjectId: null,
    tutorOnStart: unit.tutorOnStart,
  };
}

/**
 * Whether the teacher's availability in the branch covers the time on the
 * date: the entry in force that day, a range of the weekday holding the whole
 * lesson. No entry in force means no hours there (2.2b).
 */
function availableOn(
  teacher: EngineTeacher,
  branchId: string,
  date: string,
  weekday: number,
  start: number,
  end: number,
): boolean {
  const entries = inForceOn(
    teacher.availability.filter((entry) => entry.branchId === branchId),
    date,
  );
  return entries.some((entry) =>
    entry.ranges.some(
      (range) => range.weekday === weekday && range.start <= start && end <= range.end,
    ),
  );
}

/** Whether the availability entries of the branch in force differ between the two dates. */
function entryChanged(
  teacher: EngineTeacher,
  branchId: string,
  from: string,
  date: string,
): boolean {
  const own = teacher.availability.filter((entry) => entry.branchId === branchId);
  const before = inForceOn(own, from);
  const after = inForceOn(own, date);
  return before.length !== after.length || before.some((entry, index) => entry !== after[index]);
}

/**
 * A pattern: the first date of the weekday on which each later entry (or the
 * end of one) takes effect, up to the version's end, where the lesson falls
 * outside the hours then in force (decision 8; edge/timetable, "A part-time
 * teacher stops working Fridays from December").
 */
function laterUnavailableDates(
  teacher: EngineTeacher,
  placement: Placement,
  facts: Facts,
): string[] {
  const weekday = Number(placement.day);
  const changes = new Set<string>();
  for (const entry of teacher.availability) {
    if (entry.branchId !== placement.branchId) continue;
    changes.add(entry.validFrom);
    if (entry.validUntil !== null) {
      changes.add(entry.validUntil);
    }
  }
  const dates = new Set<string>();
  for (const change of [...changes].sort()) {
    if (change <= facts.startDate) continue;
    const date = firstOn(change, weekday);
    if (date > facts.versionEnd) continue;
    if (!availableOn(teacher, placement.branchId, date, weekday, placement.start, placement.end)) {
      dates.add(date);
    }
  }
  return [...dates].sort();
}

function checkTeacherOfLesson(
  placement: Placement,
  teacher: EngineTeacher,
  facts: Facts,
  results: Results,
): void {
  const unitId = placement.classId ?? placement.groupId;
  const unit = unitId === null ? undefined : need(facts.units, unitId, 'class or group');
  const subject =
    placement.subjectId === null ? undefined : need(facts.subjects, placement.subjectId, 'subject');
  if (unit !== undefined && subject !== undefined) {
    const problems = teacherProblems(
      loadUnitOf(unit),
      {
        id: subject.id,
        archived: !subject.active,
        grades: [],
        languageRule: subject.languageRule,
        tutorSubject: subject.tutorSubject,
      },
      {
        id: teacher.id,
        inBranch: teacher.branchIds.includes(placement.branchId),
        out: teacher.out,
        subjects: teacher.subjects,
        languages: teacher.languages,
      },
    );
    for (const problem of problems) {
      const rule = PROFILE_RULES[problem];
      if (rule === undefined) continue;
      // A substitute who cannot teach in the language is listed last and
      // marked; choosing one needs a confirmation (05, Language of
      // instruction, Substitution; decision 17).
      results.add(
        rule === 'teacher_language' && placement.substitute ? 'substitute_language' : rule,
        placement.day,
        [placement],
      );
    }
  }
  if (placement.substitute && teacher.vacancy) {
    results.add('substitute_vacancy', placement.day, [placement]);
  }
  // A pattern reads the entry in force on the draft's intended start date
  // (06, Rules, availability row); a dated lesson the one on its date.
  const onDate = facts.mode === 'pattern' ? facts.startDate : placement.day;
  const weekday = weekdayOfDay(facts, placement.day);
  if (!availableOn(teacher, placement.branchId, onDate, weekday, placement.start, placement.end)) {
    const from = results.options.availabilityFrom;
    // A publish: a date under another entry than the start date's is a
    // warning by date (06, Rules, availability row; task 5.5a-2a, decision 6).
    const later =
      facts.mode === 'dated' &&
      from !== undefined &&
      placement.day > from &&
      entryChanged(teacher, placement.branchId, from, placement.day);
    if (later) {
      results.add('teacher_unavailable_later', placement.day, [placement], {
        date: placement.day,
      });
    } else {
      results.add('teacher_unavailable', placement.day, [placement]);
    }
  } else if (facts.mode === 'pattern') {
    for (const later of laterUnavailableDates(teacher, placement, facts)) {
      results.add('teacher_unavailable_later', placement.day, [placement], { date: later });
    }
  }
}

/** An invigilator: any active staff member, never a vacancy; availability and subject are warnings (06, Exam). */
function checkInvigilator(
  placement: Placement,
  teacher: EngineTeacher,
  facts: Facts,
  results: Results,
): void {
  if (teacher.vacancy) {
    results.add('invigilator_vacancy', placement.day, [placement], { teacherId: teacher.id });
    return;
  }
  if (teacher.out) {
    results.add('invigilator_inactive', placement.day, [placement], { teacherId: teacher.id });
  }
  const weekday = weekdayOfDay(facts, placement.day);
  const onDate = facts.mode === 'pattern' ? facts.startDate : placement.day;
  if (!availableOn(teacher, placement.branchId, onDate, weekday, placement.start, placement.end)) {
    results.add('invigilator_unavailable', placement.day, [placement], { teacherId: teacher.id });
  }
  if (
    placement.subjectId !== null &&
    !teacher.subjects.some((one) => one.subjectId === placement.subjectId)
  ) {
    results.add('invigilator_subject', placement.day, [placement], { teacherId: teacher.id });
  }
}

function checkResources(placement: Placement, facts: Facts, results: Results): void {
  for (const teacherId of placement.teacherIds) {
    const teacher = need(facts.teachers, teacherId, 'teacher');
    if (placement.kind === 'lesson') {
      checkTeacherOfLesson(placement, teacher, facts, results);
    } else {
      checkInvigilator(placement, teacher, facts, results);
    }
  }
  if (placement.kind === 'lesson' && placement.subjectId !== null) {
    if (facts.subjects.get(placement.subjectId)?.active === false) {
      results.add('subject_inactive', placement.day, [placement]);
    }
  }
  for (const roomId of roomsOf(placement)) {
    const room = need(facts.rooms, roomId, 'room');
    if (room.status === 'closed') {
      results.add('room_inactive', placement.day, [placement], { roomId });
    } else if (room.status === 'under_repair') {
      // The load may name such a room (3.4a decision 13); the dated closure
      // with "needs a room" is its own task (review correction 4).
      results.add('room_under_repair', placement.day, [placement], { roomId });
    }
  }
  // Room capacity: a warning for a room that is not shared, and for every
  // exam room against the students of its classes (06, Rules and Exam).
  if (placement.kind === 'lesson' && placement.roomId !== null) {
    const room = facts.rooms.get(placement.roomId);
    if (room !== undefined && !room.shared && placement.studentIds.length > room.capacity) {
      results.add('room_capacity', placement.day, [placement], {
        capacity: room.capacity,
        students: placement.studentIds.length,
      });
    }
  }
  for (const examRoom of placement.kind === 'exam' ? placement.examRooms : []) {
    const room = facts.rooms.get(examRoom.roomId);
    if (room !== undefined && examRoom.students > room.capacity) {
      results.add('room_capacity', placement.day, [placement], {
        roomId: examRoom.roomId,
        capacity: room.capacity,
        students: examRoom.students,
      });
    }
  }
}

/**
 * Travel time: a teacher's lesson and their next lesson that day in another
 * branch at least the pair's minutes apart (06, Rules; Teachers who work in
 * several branches, Travel time). Neighbours by start time only; exams and
 * busy-elsewhere lessons count (decision 15). An unset pair blocks (decision 1).
 */
function checkTravel(
  placements: readonly Placement[],
  facts: Pick<Facts, 'travelMinutes'>,
  results: Results,
): void {
  const groups = groupBy(placements, (one) => one.teacherIds.map((id) => `${one.day}|${id}`));
  for (const group of groups.values()) {
    // The lesson before the next one is the one that ends last among those
    // that start earlier: a long exam may hold a shorter lesson inside it.
    let before: Placement | undefined;
    for (const after of [...group].sort(byStart)) {
      const previous = before;
      if (before === undefined || after.end > before.end) {
        before = after;
      }
      if (previous === undefined || previous.branchId === after.branchId) continue;
      const gap = after.start - previous.end;
      // An overlap is `teacher_double`.
      if (gap < 0) continue;
      const minutes = facts.travelMinutes(previous.branchId, after.branchId);
      if (minutes === null) {
        results.add('travel_time_not_set', after.day, [previous, after]);
      } else if (gap < minutes) {
        results.add('travel_time', after.day, [previous, after], { minutes, gap });
      }
    }
  }
}

// --- Warnings of the load and the day ---------------------------------------

function checkLoadWarnings(placements: readonly Placement[], facts: Facts, results: Results): void {
  // Exams count for no load warning (06, Rules, the exam row).
  const lessons = placements.filter((one) => one.kind === 'lesson');
  const own = (list: readonly Placement[]) => list.filter((one) => !one.fixed);

  // Teachers: the week and the day, every branch (decision 10).
  for (const [key, list] of groupBy(lessons, (one) =>
    one.teacherIds.map((id) => `${weekOf(facts, one.day)}|${id}`),
  )) {
    const teacher = facts.teachers.get(key.slice(key.indexOf('|') + 1));
    const limit = teacher?.weeklyLessons ?? null;
    if (limit !== null && list.length > limit && own(list).length > 0) {
      results.add('teacher_week_load', weekOf(facts, list[0]?.day ?? ''), own(list), {
        lessons: list.length,
        limit,
      });
    }
  }
  for (const [key, list] of groupBy(lessons, (one) =>
    one.teacherIds.map((id) => `${one.day}|${id}`),
  )) {
    const teacher = facts.teachers.get(key.slice(key.indexOf('|') + 1));
    const limit = teacher?.dailyLessons ?? null;
    if (limit !== null && list.length > limit && own(list).length > 0) {
      results.add('teacher_day_load', list[0]?.day ?? '', own(list), {
        lessons: list.length,
        limit,
      });
    }
  }

  // Classes: blocks, not lessons (a split's halves are one block).
  const byClassDay = groupBy(own(lessons), (one) =>
    one.classIds.map((classId) => `${one.day}|${one.branchId}|${classId}`),
  );
  for (const [key, list] of byClassDay) {
    const [day = '', branchId = '', classId = ''] = key.split('|');
    const blocks = new Set(list.map((one) => one.blockId ?? one.id));
    const limit = facts.classDailyLessons(branchId);
    if (limit !== null && blocks.size > limit) {
      results.add('class_day_load', day, list, { classId, lessons: blocks.size, limit });
    }
    // A double pair counts once; two single lessons warn (decision 9). Task
    // 5.4c-3b (decision 2, review correction 3): per student, so the halves
    // of a mixed split in two slots of one day are once each.
    for (const [subjectId, ofSubject] of groupBy(list, (one) =>
      one.subjectId === null ? [] : [one.subjectId],
    )) {
      const unitsOf = new Map<string, Set<string>>();
      for (const one of ofSubject) {
        const exempt = new Set(one.exemptStudentIds);
        const members = one.studentIds.filter((studentId) => !exempt.has(studentId));
        // A lesson with no members on the reading date stands for its class or group.
        const unit = `unit:${one.groupId ?? one.classId ?? one.id}`;
        for (const studentId of members.length === 0 ? [unit] : members) {
          const units = unitsOf.get(studentId) ?? new Set<string>();
          units.add(one.doublePairId ?? one.blockId ?? one.id);
          unitsOf.set(studentId, units);
        }
      }
      if ([...unitsOf.values()].some((units) => units.size > 1)) {
        results.add('subject_twice', day, ofSubject, { classId, subjectId });
      }
    }
    checkFreePeriod(day, branchId, classId, list, facts, results);
  }

  if (facts.mode === 'pattern') {
    const placed = groupBy(own(lessons), (one) => (one.loadRowId === null ? [] : [one.loadRowId]));
    for (const row of facts.loadRows) {
      const list = placed.get(row.id) ?? [];
      const short = list.length < row.lessonsPerWeek;
      if (list.length !== row.lessonsPerWeek && !(short && row.deliberatelyShort)) {
        results.add('load_mismatch', '', list, {
          loadRowId: row.id,
          placed: list.length,
          lessonsPerWeek: row.lessonsPerWeek,
        });
      }
    }
  }
}

/** "a free period in the middle of a class's day": an empty lesson slot of its template between its first and last lesson. */
function checkFreePeriod(
  day: string,
  branchId: string,
  classId: string,
  list: readonly Placement[],
  facts: Facts,
  results: Results,
): void {
  const grade = facts.units.get(classId)?.grades[0];
  if (grade === undefined) return;
  const engineDay = facts.dayOf(branchId, grade, day);
  if (!engineDay.lessons) return;
  const slots = engineDay.day.slots.filter((slot) => slot.lessonNumber !== null);
  const taken = slots.map((slot) =>
    list.some((one) => one.start < slot.end && slot.start < one.end),
  );
  const first = taken.indexOf(true);
  const last = taken.lastIndexOf(true);
  if (first === -1) return;
  for (let index = first + 1; index < last; index += 1) {
    const slot = slots[index];
    if (taken[index] === false && slot !== undefined) {
      results.add('class_free_period', day, list, {
        classId,
        start: slot.start,
        end: slot.end,
      });
    }
  }
}

/** The teacher also placed at that time in a draft of another branch (06, Two drafts at once). */
function checkOtherDrafts(placements: readonly Placement[], facts: Facts, results: Results): void {
  for (const placement of placements) {
    if (placement.fixed) continue;
    for (const other of facts.otherDrafts) {
      if (
        other.branchId !== placement.branchId &&
        other.day === placement.day &&
        overlaps(other, placement) &&
        other.teacherIds.some((id) => placement.teacherIds.includes(id))
      ) {
        results.add('other_draft', placement.day, [placement, other], {
          branchId: other.branchId,
        });
      }
    }
  }
}

/** Every blocked rule and warning of the placements, in `RULE_ORDER`. */
export function checkTimetable(
  placements: readonly Placement[],
  facts: Facts,
  options: CheckOptions = {},
): RuleResult[] {
  const results = new Results(
    options,
    new Set(placements.filter((one) => one.fixed).map((one) => one.id)),
    facts.mode,
  );
  checkClashes(placements, facts, results);
  checkBlocks(placements, facts, results);
  for (const placement of placements) {
    if (placement.fixed) continue;
    checkDay(placement, facts, results);
    checkResources(placement, facts, results);
  }
  checkDoubles(placements, facts, results);
  checkTravel(placements, facts, results);
  checkLoadWarnings(placements, facts, results);
  checkOtherDrafts(placements, facts, results);
  return results.list();
}

/**
 * The results that name one placement, with it placed among the others
 * (replacing a placement of the same id): what the grid shows while dragging
 * and what a route refuses (06, Editing in the grid).
 */
export function checkCandidate(
  placements: readonly Placement[],
  facts: Facts,
  candidate: Placement,
  options: CheckOptions = {},
): RuleResult[] {
  return checkCandidates(placements, facts, [candidate], options);
}

/**
 * The results that name any of several placements placed together among the
 * others (replacing those of the same ids): a block of several lessons, or the
 * two blocks of a swap (task 5.4a, decision 5).
 */
export function checkCandidates(
  placements: readonly Placement[],
  facts: Facts,
  candidates: readonly Placement[],
  options: CheckOptions = {},
): RuleResult[] {
  const ids = new Set(candidates.map((one) => one.id));
  const others = placements.filter((one) => !ids.has(one.id));
  return checkTimetable([...others, ...candidates], facts, options).filter((result) =>
    result.lessonIds.some((id) => ids.has(id)),
  );
}

/**
 * Whether a teacher may take a dated lesson by time alone: one place at a
 * time and the travel time between branches (06, Rules), with the teacher's
 * other lessons and exams of the day, in every branch, as `fixed` placements
 * (task 3.6c-2, decision 4: a Tutor lesson that follows a change of Tutor).
 * The same rule functions as `checkTimetable`; availability, profile and load
 * are not read. Returns the results that name the candidate.
 */
export function checkTeacherTime(
  others: readonly Placement[],
  candidate: Placement,
  travelMinutes: Facts['travelMinutes'],
): RuleResult[] {
  const placements = [...others.filter((one) => one.id !== candidate.id), candidate];
  const results = new Results(
    {},
    new Set(placements.filter((one) => one.fixed).map((one) => one.id)),
    'dated',
  );
  checkTeacherDouble(placements, results);
  checkTravel(placements, { travelMinutes }, results);
  return results.list().filter((result) => result.lessonIds.includes(candidate.id));
}
