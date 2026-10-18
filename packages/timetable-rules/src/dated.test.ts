import { describe, expect, it } from 'vitest';
import {
  datedPattern,
  patternIdOf,
  type DatedBlock,
  type DatedDay,
  type DatedPatternInput,
} from './dated.js';
import { dayTimes, type Day, type DaySlotInput } from './day.js';

// Task 5.5a-2a: the lessons of a weekly pattern on its dates. Invented names only.

const lesson = (length: number): DaySlotInput => ({ kind: 'lesson', lengthMinutes: length });
const pause = (length: number): DaySlotInput => ({ kind: 'break', lengthMinutes: length });

// Five lessons of 45 minutes from 08:00: L1 08:00, L2 08:50, L3 09:55, L4 10:45, L5 11:35.
const WEEKLY = dayTimes(480, [
  lesson(45),
  pause(5),
  lesson(45),
  pause(20),
  lesson(45),
  pause(5),
  lesson(45),
  pause(5),
  lesson(45),
]);
// A shortened day: three lessons of 30 minutes from 08:00 (L1 08:00, L2 08:35, L3 09:10).
const SHORT = dayTimes(480, [lesson(30), pause(5), lesson(30), pause(5), lesson(30)]);
// Breaks moved: L2 starts at 09:00 (a longer first break).
const MOVED = dayTimes(480, [lesson(45), pause(15), lesson(45), pause(10), lesson(45)]);
// Grade 10 only: one lesson before the first break, so its L1 is at the same time but L2 differs.
const TENTH = dayTimes(480, [lesson(45), pause(15), lesson(45)]);

const L1 = { start: 480, end: 525 };
const L2 = { start: 530, end: 575 };
const L4 = { start: 645, end: 690 };

const QUARTERS = [
  { firstDate: '2026-11-09', lastDate: '2026-12-25' },
  { firstDate: '2027-01-11', lastDate: '2027-03-19' },
];

const block = (id: string, extra: Partial<DatedBlock> = {}): DatedBlock => ({
  id,
  weekday: 1,
  ...L2,
  doublePairId: null,
  grades: [7],
  entries: [
    {
      id: `e-${id}`,
      loadRowId: `row-${id}`,
      classId: '7a',
      groupId: null,
      classIds: ['7a'],
      subjectId: 'math',
      teacherId: 't1',
      roomId: 'r1',
      tutorRow: false,
    },
  ],
  ...extra,
});

const weekday = (date: string) => {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
};

function input(extra: Partial<DatedPatternInput> = {}): DatedPatternInput {
  return {
    branchId: 'branch-a',
    firstDate: '2026-11-11',
    lastDate: '2026-11-30',
    blocks: [block('b1')],
    quarters: QUARTERS,
    weeklyDay: (grade): Day => (grade === 10 ? TENTH : WEEKLY),
    dayOn: (grade, date): DatedDay => {
      const real = weekday(date);
      if (real > 5) return { lessons: false };
      return {
        lessons: true,
        day: grade === 10 ? TENTH : WEEKLY,
        followsWeekday: real,
        noRegularLessons: false,
      };
    },
    studentsOn: (unitId, date) => (date < '2026-11-23' ? [`${unitId}-s1`] : [`${unitId}-s2`]),
    tutorOn: () => 'tutor-1',
    ...extra,
  };
}

const datesOf = (found: ReturnType<typeof datedPattern>) => found.lessons.map((one) => one.date);

describe('datedPattern', () => {
  it('gives a version that starts on a Wednesday no lesson before it, then every Monday', () => {
    const found = datedPattern(input());
    expect(datesOf(found)).toEqual(['2026-11-16', '2026-11-23', '2026-11-30']);
    const [first] = found.lessons;
    expect(first?.placement).toMatchObject({
      id: 'e-b1@2026-11-16',
      blockId: 'b1@2026-11-16',
      day: '2026-11-16',
      ...L2,
      teacherIds: ['t1'],
      roomId: 'r1',
      fixed: false,
    });
    expect(patternIdOf(first?.placement.id ?? '')).toEqual({ id: 'e-b1', date: '2026-11-16' });
    expect(found.cancelled).toEqual([]);
  });

  it('gives nothing on a day off, a weekday off, or a vacation date', () => {
    const found = datedPattern(
      input({
        firstDate: '2026-12-14',
        lastDate: '2027-01-18',
        dayOn: (grade, date) =>
          date === '2026-12-14' ? { lessons: false } : input().dayOn(grade, date),
      }),
    );
    // 14 Dec is off; 28 Dec and 4 Jan are in the vacation between the quarters.
    expect(datesOf(found)).toEqual(['2026-12-21', '2027-01-11', '2027-01-18']);
  });

  it('lists the lessons beyond a shortened day as not in the template, and keeps those it holds', () => {
    const found = datedPattern(
      input({
        firstDate: '2026-11-16',
        lastDate: '2026-11-16',
        blocks: [block('b1'), block('b4', L4)],
        dayOn: () => ({ lessons: true, day: SHORT, followsWeekday: 1, noRegularLessons: false }),
      }),
    );
    // L2 is matched by its order in the day: the second lesson of the short day.
    expect(
      found.lessons.map((one) => [one.entryId, one.placement.start, one.placement.end]),
    ).toEqual([['e-b1', 515, 545]]);
    expect(found.cancelled).toEqual([
      { date: '2026-11-16', reason: 'not_in_template', blockId: 'b4', entryIds: ['e-b4'] },
    ]);
  });

  it('takes the new times of a template whose breaks moved, by the lesson number', () => {
    const found = datedPattern(
      input({
        firstDate: '2026-11-16',
        lastDate: '2026-11-16',
        dayOn: () => ({ lessons: true, day: MOVED, followsWeekday: 1, noRegularLessons: false }),
      }),
    );
    expect(found.lessons[0]?.placement).toMatchObject({ start: 540, end: 585 });
  });

  it("gives a Saturday worked by Wednesday's timetable Wednesday's blocks", () => {
    const found = datedPattern(
      input({
        firstDate: '2026-11-18',
        lastDate: '2026-11-21',
        blocks: [block('mon'), block('wed', { weekday: 3 })],
        dayOn: (grade, date) =>
          date === '2026-11-21'
            ? { lessons: true, day: WEEKLY, followsWeekday: 3, noRegularLessons: false }
            : input().dayOn(grade, date),
      }),
    );
    expect(found.lessons.map((one) => `${one.entryId} ${one.date}`)).toEqual([
      'e-wed 2026-11-18',
      'e-wed 2026-11-21',
    ]);
    // Each lesson names the weekday its grades follow on the date (review of #140, finding 1).
    expect(found.lessons.map((one) => one.followsWeekday)).toEqual([3, 3]);
  });

  it('gives a lesson the weekday its own grades follow when other grades follow another (review of #140)', () => {
    // On Tuesday 17 November grade 3 follows Friday; grade 7 keeps Tuesday.
    const third = block('fri3', {
      weekday: 5,
      grades: [3],
      entries: block('x').entries.map((entry) => ({
        ...entry,
        id: 'e-fri3',
        classId: '3a',
        classIds: ['3a'],
      })),
    });
    const found = datedPattern(
      input({
        firstDate: '2026-11-17',
        lastDate: '2026-11-17',
        blocks: [third, block('tue7', { weekday: 2 })],
        dayOn: (grade, date) =>
          grade === 3
            ? { lessons: true, day: WEEKLY, followsWeekday: 5, noRegularLessons: false }
            : input().dayOn(grade, date),
      }),
    );
    expect(found.lessons.map((one) => [one.entryId, one.followsWeekday])).toEqual([
      ['e-fri3', 5],
      ['e-tue7', 2],
    ]);
  });

  it('cancels an exam week with no regular lessons as exam_week, unchecked', () => {
    const found = datedPattern(
      input({
        firstDate: '2026-11-16',
        lastDate: '2026-11-16',
        dayOn: () => ({ lessons: true, day: WEEKLY, followsWeekday: 1, noRegularLessons: true }),
      }),
    );
    expect(found.lessons).toEqual([]);
    expect(found.cancelled).toEqual([
      { date: '2026-11-16', reason: 'exam_week', blockId: 'b1', entryIds: ['e-b1'] },
    ]);
  });

  describe('a group of two grades', () => {
    const group = (extra: Partial<DatedBlock> = {}) =>
      block('pe', {
        ...L1,
        grades: [9, 10],
        entries: [
          {
            id: 'e-pe',
            loadRowId: 'row-pe',
            classId: null,
            groupId: 'pe910',
            classIds: ['9a', '10a'],
            subjectId: 'pe',
            teacherId: 't2',
            roomId: 'gym',
            tutorRow: false,
          },
        ],
        ...extra,
      });

    it('keeps a lesson in a slot both templates hold at the same time', () => {
      const found = datedPattern(
        input({ firstDate: '2026-11-16', lastDate: '2026-11-16', blocks: [group()] }),
      );
      expect(found.lessons.map((one) => [one.placement.start, one.placement.end])).toEqual([
        [480, 525],
      ]);
    });

    it('lists a slot whose times differ between its grades on the date as not in the template', () => {
      const found = datedPattern(
        input({
          firstDate: '2026-11-16',
          lastDate: '2026-11-16',
          blocks: [group()],
          dayOn: (grade) => ({
            lessons: true,
            day: grade === 9 ? SHORT : TENTH,
            followsWeekday: 1,
            noRegularLessons: false,
          }),
        }),
      );
      expect(found.lessons).toEqual([]);
      expect(found.cancelled).toEqual([
        { date: '2026-11-16', reason: 'not_in_template', blockId: 'pe', entryIds: ['e-pe'] },
      ]);
    });

    it('lists a date off for one of its grades as cancelled "day off" (decision 4)', () => {
      const found = datedPattern(
        input({
          firstDate: '2026-11-16',
          lastDate: '2026-11-16',
          blocks: [group()],
          dayOn: (grade, date) => (grade === 9 ? { lessons: false } : input().dayOn(grade, date)),
        }),
      );
      expect(found.lessons).toEqual([]);
      expect(found.cancelled).toEqual([
        { date: '2026-11-16', reason: 'day_off', blockId: 'pe', entryIds: ['e-pe'] },
      ]);
    });
  });

  it('gives each date of a double its own pair, and reads the members on the date', () => {
    const found = datedPattern(
      input({
        firstDate: '2026-11-16',
        lastDate: '2026-11-23',
        blocks: [block('b1', { doublePairId: 'pair' })],
      }),
    );
    expect(found.lessons.map((one) => one.placement.doublePairId)).toEqual([
      'pair@2026-11-16',
      'pair@2026-11-23',
    ]);
    expect(found.lessons.map((one) => one.placement.studentIds)).toEqual([['7a-s1'], ['7a-s2']]);
  });

  it("gives a Tutor row the class's Tutor of each date, or none (decision 11)", () => {
    const tutorBlock = block('tut', {
      entries: [
        {
          id: 'e-tut',
          loadRowId: 'row-tut',
          classId: '7a',
          groupId: null,
          classIds: ['7a'],
          subjectId: 'homework',
          teacherId: 'tutor-1',
          roomId: 'r1',
          tutorRow: true,
        },
      ],
    });
    const found = datedPattern(
      input({
        firstDate: '2026-11-16',
        lastDate: '2026-11-30',
        blocks: [tutorBlock],
        tutorOn: (classId, date, start) => {
          expect([classId, start]).toEqual(['7a', L2.start]);
          return date === '2026-11-16' ? 'tutor-1' : date === '2026-11-23' ? 'tutor-2' : null;
        },
      }),
    );
    expect(
      found.lessons.map((one) => [one.date, one.placement.teacherIds, one.tutorFollowed]),
    ).toEqual([
      ['2026-11-16', ['tutor-1'], false],
      ['2026-11-23', ['tutor-2'], true],
      ['2026-11-30', [], false],
    ]);
    expect(found.noTutor).toEqual([{ date: '2026-11-30', entryId: 'e-tut' }]);
  });
});
