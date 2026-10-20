/**
 * The lessons of a weekly pattern on its dates (task 5.5a-2a): what a publish
 * checks date by date, and what 5.5b creates as dated lessons
 * (docs/spec/06-timetable.md, Model, Dated lesson: "generated from the
 * published pattern using the academic calendar and that day's template …
 * Days off produce no lessons").
 *
 * A date gives a block's lessons when the block's weekday is the weekday the
 * date follows (`dayOn`: the date's own on a working weekday, the followed one
 * on a worked Saturday) for its grades. A lesson is matched by its order in
 * the day, per grade (edge/time-dates-calendar, "A shortened day": "Lessons are
 * matched by their order in the day"): the lesson number of the slot with the
 * block's stored times in the grade's weekly template, then the slot of that
 * number in the grade's template on the date. What the day cannot hold is
 * listed as cancelled, never checked (edge/timetable, "The pattern is valid
 * but one date is not", first exception; decisions 4 and 7):
 * - `not_in_template`: no slot of that number on the date, or, for a group of
 *   two grades, slots whose times differ between its grades;
 * - `day_off`: a group of two grades on a date off for one of them, unless the
 *   day-off entry's stored choice keeps the block (see below);
 * - `exam_week`: an exam week with "no regular lessons", a bulk cancel with
 *   that reason (edge/time-dates-calendar, "The last week of a quarter").
 * A vacation date (in no quarter), a day off and a weekday off give nothing.
 *
 * The lessons kept on a shortened day (task 5.5a-2b-2, pull request #143):
 * the day is shortened for a class when a lesson of the class on the weekday
 * it follows has no slot of its number on the date. There, a stored choice of
 * the Academic Vice Principal (`keptOn`: the slot positions of the lessons
 * kept) decides (edge/time-dates-calendar, "A shortened day": "The Academic
 * Vice Principal can choose which lessons are kept"): a kept lesson whose
 * number the date has keeps that slot; the other kept lessons, in their order
 * in the day, take the lesson slots no kept lesson holds (review correction
 * 1); a lesson not kept, or with no slot left, is cancelled
 * `not_in_template` (decision 5). A stored position that holds no lesson of
 * the class is ignored and named (decision 11); a choice on a day that is not
 * shortened, or none of whose positions holds a lesson, is unused (decision 3).
 * A lesson of several classes takes the time each class gives it, and is
 * cancelled `not_in_template` when they differ (decision 4).
 *
 * A group of two grades on a date one grade has off by a day-off entry (task
 * 5.6b-3, edge/time-dates-calendar, "A day off for grade 9 only, and a group
 * joins 9 Edinburgh and 10 Brown"): the entry's stored choice for the block
 * (`groupChoiceOn`, by its groups and weekly start) decides, in this order:
 * the day off first (no choice or `cancel`: cancelled `day_off`), then the
 * choice (`keep`), then the template of the grades that have school: an exam
 * week there cancels it `exam_week`, a slot their template lacks or times it
 * differently cancels it `not_in_template`, else the lesson takes their time
 * and the students of the grade that is off, by their membership on the date,
 * are exempt for it; a lesson of that grade alone (a group of its classes
 * only) is cancelled `day_off` on the date (code review round 1). Every such block and date is listed in `splitGroups`.
 */
import type { Day } from './day.js';
import type { Placement } from './placement.js';

/** One lesson of a pattern block: a load row's entry. */
export interface DatedEntry {
  /** The pattern entry. */
  readonly id: string;
  readonly loadRowId: string;
  readonly classId: string | null;
  readonly groupId: string | null;
  /** The class, or the classes the group draws from. */
  readonly classIds: readonly string[];
  readonly subjectId: string;
  /** The entry's teacher or vacancy. */
  readonly teacherId: string;
  readonly roomId: string | null;
  /** A Tutor row: its teacher on a date is the class's Tutor then (edge/timetable, Structure; decision 11). */
  readonly tutorRow: boolean;
}

/** A block of the pattern with its lessons. */
export interface DatedBlock {
  readonly id: string;
  readonly weekday: number;
  /** The block's position in the day template, breaks included (`pattern_blocks.slot_position`). */
  readonly slotPosition: number;
  readonly start: number;
  readonly end: number;
  readonly doublePairId: string | null;
  /** The grades of the block's classes and groups. */
  readonly grades: readonly number[];
  readonly entries: readonly DatedEntry[];
}

/** What a grade has on a date, as the calendar gives it (`dayOn` with the template's times). */
export type DatedDay =
  | {
      readonly lessons: false;
      /** The day-off calendar entry that leaves the grade off (task 5.6b-3); absent for a weekday off or no template. */
      readonly dayOffEntryId?: string;
    }
  | {
      readonly lessons: true;
      readonly day: Day;
      /** The weekday whose pattern the date follows. */
      readonly followsWeekday: number;
      readonly noRegularLessons: boolean;
    };

export interface DatedPatternInput {
  readonly branchId: string;
  /** The first and the last date, both included. */
  readonly firstDate: string;
  readonly lastDate: string;
  readonly blocks: readonly DatedBlock[];
  /** The quarters of the year: a date in none is a vacation. */
  readonly quarters: readonly { readonly firstDate: string; readonly lastDate: string }[];
  /** The weekly day of a grade on a weekday, where the block's times were taken; `null` with none. */
  readonly weeklyDay: (grade: number, weekday: number) => Day | null;
  /** What a grade has on a date. */
  readonly dayOn: (grade: number, date: string) => DatedDay;
  /** The expected students of a class or group on a date. */
  readonly studentsOn: (unitId: string, date: string) => readonly string[];
  /** The teacher of a Tutor row's lesson on a date at its start minute; `null`: no Tutor. */
  readonly tutorOn: (classId: string, date: string, start: number) => string | null;
  /** The grade of a class. */
  readonly gradeOf: (classId: string) => number;
  /** The slot positions a class keeps on a shortened date (task 5.5a-2b-2); `null` with no choice. */
  readonly keptOn: (classId: string, date: string) => readonly number[] | null;
  /**
   * The stored choice of a day-off entry for a block of two-grade groups on a
   * date (task 5.6b-3), the block named by its groups (sorted) and its weekly
   * start minute; `null` with none.
   */
  readonly groupChoiceOn: (
    entryId: string,
    date: string,
    groupIds: readonly string[],
    start: number,
  ) => DatedGroupChoice | null;
}

/** Task 5.6b-3: cancel a split group's block "day off", or keep it for the grade that has school. */
export type DatedGroupChoice = 'keep' | 'cancel';

/** A block of two-grade groups on a date a day-off entry leaves one of its grades off (task 5.6b-3). */
export interface DatedSplitGroup {
  readonly date: string;
  readonly blockId: string;
  readonly entryId: string;
  /** The groups of the block, sorted. */
  readonly groupIds: readonly string[];
  readonly weekday: number;
  readonly start: number;
  readonly end: number;
  /** The grades that have school on the date. */
  readonly gradesAtSchool: readonly number[];
  readonly choice: DatedGroupChoice | null;
}

/** A lesson of a date: the engine's placement and where it comes from. */
export interface DatedLesson {
  readonly placement: Placement;
  readonly entryId: string;
  readonly date: string;
  /** A Tutor row whose Tutor on the date is not the entry's teacher (decision 11). */
  readonly tutorFollowed: boolean;
  /**
   * The weekday the lesson's grades follow on the date: its block's weekday,
   * another than the date's own on a worked Saturday (review of #140: decided
   * per lesson, since a calendar entry can cover a range of grades only).
   */
  readonly followsWeekday: number;
}

export type DatedCancelReason = 'not_in_template' | 'day_off' | 'exam_week';

/** The lessons of a block on a date created as cancelled. */
export interface DatedCancelled {
  readonly date: string;
  readonly reason: DatedCancelReason;
  readonly blockId: string;
  readonly entryIds: readonly string[];
}

/** A Tutor row's lesson with no Tutor on its date: "needs a teacher". */
export interface DatedNoTutor {
  readonly date: string;
  readonly entryId: string;
}

/** A date shortened for a class: its lessons of the day and those kept (task 5.5a-2b-2). */
export interface DatedShortened {
  readonly date: string;
  readonly classId: string;
  /** The lesson slots of the day. */
  readonly lessonSlots: number;
  /** The class's lessons on the weekday the date follows, in their order in the day. */
  readonly lessons: readonly {
    readonly blockId: string;
    readonly slotPosition: number;
    readonly entryIds: readonly string[];
  }[];
  /** The slot positions kept: the choice's that hold a lesson, or the default's. */
  readonly kept: readonly number[];
  /** Whether a stored choice decides the date. */
  readonly chosen: boolean;
  /** Stored positions that hold no lesson of the class (decision 11). */
  readonly missingPositions: readonly number[];
}

/** A stored choice that decides nothing on its date (decision 3). */
export interface DatedUnusedKeep {
  readonly date: string;
  readonly classId: string;
}

export interface DatedPattern {
  readonly lessons: readonly DatedLesson[];
  readonly cancelled: readonly DatedCancelled[];
  readonly noTutor: readonly DatedNoTutor[];
  readonly shortened: readonly DatedShortened[];
  readonly unusedKeeps: readonly DatedUnusedKeep[];
  readonly splitGroups: readonly DatedSplitGroup[];
}

/** The date `days` after `date`. */
export function addDays(date: string, days: number): string {
  const moved = new Date(`${date}T00:00:00Z`);
  moved.setUTCDate(moved.getUTCDate() + days);
  return moved.toISOString().slice(0, 10);
}

/** The id of a dated lesson, block or pair made from a pattern id. */
export const datedId = (patternId: string, date: string) => `${patternId}@${date}`;

/** The pattern id and the date of a dated id. */
export function patternIdOf(id: string): { id: string; date: string } | null {
  const at = id.lastIndexOf('@');
  return at < 0 ? null : { id: id.slice(0, at), date: id.slice(at + 1) };
}

type BlockOnDate =
  | { readonly kind: 'none' }
  | { readonly kind: 'cancelled'; readonly reason: DatedCancelReason }
  | {
      readonly kind: 'lessons';
      readonly start: number;
      readonly end: number;
      /** Kept for the grades at school (task 5.6b-3): the classes and grades that are off. */
      readonly offClassIds: readonly string[];
      readonly offGrades: readonly number[];
    };

/** The groups of a block, sorted. */
const groupsOf = (block: DatedBlock): string[] =>
  [
    ...new Set(block.entries.flatMap((entry) => (entry.groupId === null ? [] : [entry.groupId]))),
  ].sort();

/** The lesson number of a block in the weekly day of a grade; `null` when its times are not there. */
function weeklyNumber(block: DatedBlock, grade: number, input: DatedPatternInput): number | null {
  return (
    input
      .weeklyDay(grade, block.weekday)
      ?.slots.find((slot) => slot.start === block.start && slot.end === block.end)?.lessonNumber ??
    null
  );
}

/** The classes of a block's lessons. */
const classesOf = (block: DatedBlock): string[] => [
  ...new Set(block.entries.flatMap((entry) => entry.classIds)),
];

/**
 * The lesson numbers a stored choice gives a class's blocks on a date
 * (`null`: cancelled), and what the date shows for the class; `chosen` is
 * `null` where no choice decides.
 */
interface ClassOnDate {
  readonly shortened: DatedShortened | null;
  readonly unused: boolean;
  readonly chosen: ReadonlyMap<string, number | null> | null;
}

function classOn(
  classId: string,
  blocks: readonly DatedBlock[],
  date: string,
  input: DatedPatternInput,
): ClassOnDate {
  const grade = input.gradeOf(classId);
  const stored = input.keptOn(classId, date);
  const day = input.dayOn(grade, date);
  if (!day.lessons) {
    return { shortened: null, unused: stored !== null, chosen: null };
  }
  const own = blocks
    .filter((block) => block.weekday === day.followsWeekday)
    .sort((a, b) => a.slotPosition - b.slotPosition);
  const numbers = new Map(own.map((block) => [block.id, weeklyNumber(block, grade, input)]));
  const daySlots = day.day.slots.flatMap((slot) =>
    slot.lessonNumber === null ? [] : [slot.lessonNumber],
  );
  const held = (number: number | null | undefined) =>
    number !== null && number !== undefined && daySlots.includes(number);
  const shortened = own.some((block) => {
    const number = numbers.get(block.id);
    return number !== null && number !== undefined && !held(number);
  });
  if (!shortened) {
    return { shortened: null, unused: stored !== null, chosen: null };
  }
  const positions = new Set(own.map((block) => block.slotPosition));
  const named = stored === null ? [] : [...new Set(stored)].sort((a, b) => a - b);
  const keptBlocks = own.filter((block) => named.includes(block.slotPosition));
  const lessons = own.map((block) => ({
    blockId: block.id,
    slotPosition: block.slotPosition,
    entryIds: block.entries.map((entry) => entry.id),
  }));
  const base = { date, classId, lessonSlots: daySlots.length, lessons };
  if (keptBlocks.length === 0) {
    return {
      shortened: {
        ...base,
        kept: own.filter((block) => held(numbers.get(block.id))).map((block) => block.slotPosition),
        chosen: false,
        missingPositions: named,
      },
      unused: stored !== null,
      chosen: null,
    };
  }
  // Review correction 1: a kept lesson keeps the slot of its number; the
  // others take the free lesson slots in their order in the day.
  const chosen = new Map<string, number | null>(own.map((block) => [block.id, null]));
  const taken = new Set<number>();
  for (const block of keptBlocks) {
    const number = numbers.get(block.id);
    if (held(number) && number !== null && number !== undefined) {
      chosen.set(block.id, number);
      taken.add(number);
    }
  }
  const free = daySlots.filter((number) => !taken.has(number));
  for (const block of keptBlocks) {
    if (chosen.get(block.id) !== null) continue;
    chosen.set(block.id, free.shift() ?? null);
  }
  return {
    shortened: {
      ...base,
      kept: keptBlocks.map((block) => block.slotPosition),
      chosen: true,
      missingPositions: named.filter((one) => !positions.has(one)),
    },
    unused: false,
    chosen,
  };
}

function blockOn(
  block: DatedBlock,
  date: string,
  input: DatedPatternInput,
  chosenOf: (classId: string) => ReadonlyMap<string, number | null> | null,
  splits: DatedSplitGroup[],
): BlockOnDate {
  const days = block.grades.map((grade) => ({ grade, day: input.dayOn(grade, date) }));
  const holding = days.filter((one) => one.day.lessons && one.day.followsWeekday === block.weekday);
  if (holding.length === 0) {
    return { kind: 'none' };
  }
  let offGrades: readonly number[] = [];
  if (holding.length < days.length) {
    // A group of two grades: one grade is off, or follows another weekday.
    const off = days.filter((one) => !holding.includes(one));
    const entryIds = new Set(
      off.map((one) => (one.day.lessons ? undefined : one.day.dayOffEntryId)),
    );
    const [entryId] = [...entryIds];
    const groupIds = groupsOf(block);
    if (entryIds.size !== 1 || entryId === undefined || groupIds.length === 0) {
      return {
        kind: 'cancelled',
        reason: days.some((one) => !one.day.lessons) ? 'day_off' : 'not_in_template',
      };
    }
    // Task 5.6b-3: the day off first, then the entry's choice.
    const choice = input.groupChoiceOn(entryId, date, groupIds, block.start);
    splits.push({
      date,
      blockId: block.id,
      entryId,
      groupIds,
      weekday: block.weekday,
      start: block.start,
      end: block.end,
      gradesAtSchool: holding.map((one) => one.grade),
      choice,
    });
    if (choice !== 'keep') {
      return { kind: 'cancelled', reason: 'day_off' };
    }
    offGrades = off.map((one) => one.grade);
  }
  if (holding.some((one) => one.day.lessons && one.day.noRegularLessons)) {
    return { kind: 'cancelled', reason: 'exam_week' };
  }
  // Each class of the block gives it a slot: a stored choice's, or the
  // block's own lesson number in its grade's day (decision 4).
  const times = new Set<string>();
  const allClasses = classesOf(block);
  const classes = allClasses.filter((classId) => !offGrades.includes(input.gradeOf(classId)));
  const sources =
    classes.length === 0
      ? holding.map((one) => ({ grade: one.grade, classId: null }))
      : classes.map((classId) => ({ grade: input.gradeOf(classId), classId }));
  for (const source of sources) {
    const day = input.dayOn(source.grade, date);
    if (!day.lessons) {
      return { kind: 'cancelled', reason: 'not_in_template' };
    }
    const chosen = source.classId === null ? null : chosenOf(source.classId);
    const number =
      chosen === null ? weeklyNumber(block, source.grade, input) : (chosen.get(block.id) ?? null);
    const slot =
      number === null
        ? undefined
        : day.day.slots.find((candidate) => candidate.lessonNumber === number);
    if (slot === undefined) {
      return { kind: 'cancelled', reason: 'not_in_template' };
    }
    times.add(`${slot.start}-${slot.end}`);
  }
  const [only] = [...times];
  if (times.size !== 1 || only === undefined) {
    return { kind: 'cancelled', reason: 'not_in_template' };
  }
  const [start, end] = only.split('-').map(Number);
  return {
    kind: 'lessons',
    start: start ?? 0,
    end: end ?? 0,
    offClassIds: allClasses.filter((classId) => !classes.includes(classId)),
    offGrades,
  };
}

/** Every lesson of the pattern from the first to the last date (see the file's comment). */
export function datedPattern(input: DatedPatternInput): DatedPattern {
  const lessons: DatedLesson[] = [];
  const cancelled: DatedCancelled[] = [];
  const noTutor: DatedNoTutor[] = [];
  const shortened: DatedShortened[] = [];
  const unusedKeeps: DatedUnusedKeep[] = [];
  const splitGroups: DatedSplitGroup[] = [];
  const blocksOfClass = new Map<string, DatedBlock[]>();
  for (const block of input.blocks) {
    for (const classId of classesOf(block)) {
      blocksOfClass.set(classId, [...(blocksOfClass.get(classId) ?? []), block]);
    }
  }
  const classIds = [...blocksOfClass.keys()].sort();
  for (let date = input.firstDate; date <= input.lastDate; date = addDays(date, 1)) {
    if (!input.quarters.some((one) => one.firstDate <= date && date <= one.lastDate)) {
      continue;
    }
    const chosenByClass = new Map<string, ReadonlyMap<string, number | null>>();
    for (const classId of classIds) {
      const found = classOn(classId, blocksOfClass.get(classId) ?? [], date, input);
      if (found.shortened !== null) shortened.push(found.shortened);
      if (found.unused) unusedKeeps.push({ date, classId });
      if (found.chosen !== null) chosenByClass.set(classId, found.chosen);
    }
    for (const block of input.blocks) {
      const found = blockOn(
        block,
        date,
        input,
        (classId) => chosenByClass.get(classId) ?? null,
        splitGroups,
      );
      if (found.kind === 'none') continue;
      if (found.kind === 'cancelled') {
        cancelled.push({
          date,
          reason: found.reason,
          blockId: block.id,
          entryIds: block.entries.map((entry) => entry.id),
        });
        continue;
      }
      // Code review round 1: under "keep", a lesson of the grade that is off
      // alone has nobody at school: it is cancelled "day off"; the rest is held.
      const offOnly = block.entries.filter(
        (entry) =>
          found.offClassIds.length > 0 &&
          entry.classIds.every((classId) => found.offClassIds.includes(classId)),
      );
      if (offOnly.length > 0) {
        cancelled.push({
          date,
          reason: 'day_off',
          blockId: block.id,
          entryIds: offOnly.map((entry) => entry.id),
        });
      }
      for (const entry of block.entries) {
        if (offOnly.includes(entry)) continue;
        let teacherId: string | null = entry.teacherId;
        if (entry.tutorRow && entry.classId !== null) {
          teacherId = input.tutorOn(entry.classId, date, found.start);
          if (teacherId === null) {
            noTutor.push({ date, entryId: entry.id });
          }
        }
        const unitId = entry.classId ?? entry.groupId ?? '';
        const studentIds = input.studentsOn(unitId, date);
        // Task 5.6b-3 (correction 1): the members of the off grade's classes on the date.
        const offStudents = new Set(
          found.offClassIds.flatMap((classId) => input.studentsOn(classId, date)),
        );
        lessons.push({
          entryId: entry.id,
          date,
          tutorFollowed: teacherId !== null && teacherId !== entry.teacherId,
          followsWeekday: block.weekday,
          placement: {
            id: datedId(entry.id, date),
            kind: 'lesson',
            branchId: input.branchId,
            day: date,
            start: found.start,
            end: found.end,
            blockId: datedId(block.id, date),
            doublePairId: block.doublePairId === null ? null : datedId(block.doublePairId, date),
            classId: entry.classId,
            groupId: entry.groupId,
            classIds: entry.classIds,
            studentIds,
            exemptStudentIds: studentIds.filter((student) => offStudents.has(student)),
            subjectId: entry.subjectId,
            loadRowId: entry.loadRowId,
            teacherIds: teacherId === null ? [] : [teacherId],
            substitute: false,
            roomId: entry.roomId,
            examRooms: [],
            fixed: false,
            ...(found.offGrades.length === 0 ? {} : { gradesOff: found.offGrades }),
          },
        });
      }
    }
  }
  return { lessons, cancelled, noTutor, shortened, unusedKeeps, splitGroups };
}
