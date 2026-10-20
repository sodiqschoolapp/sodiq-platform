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
  slotPosition: 3,
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
    gradeOf: (classId) => Number.parseInt(classId, 10),
    keptOn: () => null,
    groupChoiceOn: () => null,
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
      // A weekday off by no entry asks no choice.
      expect(found.splitGroups).toEqual([]);
    });

    // Task 5.6b-3: edge/time-dates-calendar, "A day off for grade 9 only, and
    // a group joins 9 Edinburgh and 10 Brown".
    describe('on a day off of an entry for one grade (task 5.6b-3)', () => {
      const offFor9 =
        (day: (grade: number, date: string) => DatedDay = input().dayOn) =>
        (grade: number, date: string): DatedDay =>
          grade === 9 && date === '2026-11-16'
            ? { lessons: false, dayOffEntryId: 'navruz-9' }
            : day(grade, date);
      const asked: unknown[][] = [];
      const run = (choice: 'keep' | 'cancel' | null, extra: Partial<DatedPatternInput> = {}) =>
        datedPattern(
          input({
            firstDate: '2026-11-16',
            lastDate: '2026-11-16',
            blocks: [group()],
            dayOn: offFor9(),
            groupChoiceOn: (...args) => {
              asked.push(args);
              return choice;
            },
            ...extra,
          }),
        );

      it('cancels the block "day off" with no choice, and lists it with its entry, groups and times', () => {
        asked.length = 0;
        const found = run(null);
        expect(found.lessons).toEqual([]);
        expect(found.cancelled).toEqual([
          { date: '2026-11-16', reason: 'day_off', blockId: 'pe', entryIds: ['e-pe'] },
        ]);
        expect(found.splitGroups).toEqual([
          {
            date: '2026-11-16',
            blockId: 'pe',
            entryId: 'navruz-9',
            groupIds: ['pe910'],
            weekday: 1,
            ...L1,
            gradesAtSchool: [10],
            choice: null,
          },
        ]);
        expect(asked).toEqual([['navruz-9', '2026-11-16', ['pe910'], 480]]);
      });

      it('cancels it "day off" when the choice is cancel', () => {
        const found = run('cancel');
        expect(found.lessons).toEqual([]);
        expect(found.cancelled.map((one) => one.reason)).toEqual(['day_off']);
        expect(found.splitGroups.map((one) => one.choice)).toEqual(['cancel']);
      });

      it('keeps it on the time of the grade at school and exempts the off grade by its members on the date (correction 1)', () => {
        const found = run('keep', {
          studentsOn: (unitId, date) => {
            if (unitId === 'pe910') return ['s9-old', 's9-new', 's10'];
            if (unitId === '9a') return date >= '2026-11-16' ? ['s9-new'] : ['s9-old'];
            if (unitId === '10a') return ['s10', 's9-old'];
            return [];
          },
        });
        expect(found.cancelled).toEqual([]);
        expect(found.lessons.map((one) => one.placement)).toMatchObject([
          {
            start: 480,
            end: 525,
            studentIds: ['s9-old', 's9-new', 's10'],
            exemptStudentIds: ['s9-new'],
            gradesOff: [9],
          },
        ]);
        expect(found.splitGroups.map((one) => one.choice)).toEqual(['keep']);
      });

      it("takes the template of the grade at school, never the off grade's weekly time", () => {
        // L2 in grade 10's weekly day (TENTH) starts at 09:00; grade 10 has MOVED on the date.
        const found = run('keep', {
          blocks: [group({ start: 540, end: 585, slotPosition: 3 })],
          weeklyDay: (grade): Day => (grade === 10 ? TENTH : WEEKLY),
          dayOn: offFor9((grade) => ({
            lessons: true,
            day: grade === 10 ? MOVED : WEEKLY,
            followsWeekday: 1,
            noRegularLessons: false,
          })),
        });
        expect(found.lessons.map((one) => [one.placement.start, one.placement.end])).toEqual([
          [540, 585],
        ]);
        expect(found.splitGroups.map((one) => one.start)).toEqual([540]);
      });

      it("cancels a kept block 'not in the day's template' where the grade at school lacks its slot (correction 2)", () => {
        const found = run('keep', {
          blocks: [group(L4)],
          dayOn: offFor9((grade) => ({
            lessons: true,
            day: grade === 10 ? SHORT : WEEKLY,
            followsWeekday: 1,
            noRegularLessons: false,
          })),
        });
        expect(found.lessons).toEqual([]);
        expect(found.cancelled.map((one) => one.reason)).toEqual(['not_in_template']);
      });

      it('cancels a kept block "exam week" when the grade at school has no regular lessons', () => {
        const found = run('keep', {
          dayOn: offFor9((grade, date) => ({
            ...(input().dayOn(grade, date) as Extract<DatedDay, { lessons: true }>),
            noRegularLessons: true,
          })),
        });
        expect(found.lessons).toEqual([]);
        expect(found.cancelled.map((one) => one.reason)).toEqual(['exam_week']);
      });

      it('asks no choice when the grade off follows another weekday on a special day', () => {
        const found = run('keep', {
          dayOn: (grade, date) =>
            grade === 9
              ? { lessons: true, day: WEEKLY, followsWeekday: 3, noRegularLessons: false }
              : input().dayOn(grade, date),
        });
        expect(found.cancelled.map((one) => one.reason)).toEqual(['not_in_template']);
        expect(found.splitGroups).toEqual([]);
      });
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

// Task 5.5a-2b-2: the lessons kept on a shortened day (edge/time-dates-calendar,
// "A shortened day": "The Academic Vice Principal can choose which lessons are kept").
describe('datedPattern, the lessons kept on a shortened day', () => {
  const sevenParts: DaySlotInput[] = [];
  for (let n = 1; n <= 7; n += 1) {
    if (n > 1) sevenParts.push(pause(5));
    sevenParts.push(lesson(45));
  }
  // Seven lessons of 45 minutes from 08:00, 5 minutes apart: lesson n at slot position 2n - 1.
  const SEVEN = dayTimes(480, sevenParts);
  // A shortened day of five lessons of 30 minutes from 08:00: lesson k from 480 + 35 (k - 1).
  const FIVE = dayTimes(480, [
    lesson(30),
    pause(5),
    lesson(30),
    pause(5),
    lesson(30),
    pause(5),
    lesson(30),
    pause(5),
    lesson(30),
  ]);
  const short = (k: number) => [480 + 35 * (k - 1), 510 + 35 * (k - 1)];
  const position = (n: number) => 2 * n - 1;
  const DATE = '2026-11-16';

  const lessonBlock = (classId: string, n: number): DatedBlock => ({
    id: `${classId}-${String(n)}`,
    weekday: 1,
    slotPosition: position(n),
    start: 480 + 50 * (n - 1),
    end: 525 + 50 * (n - 1),
    doublePairId: null,
    grades: [Number.parseInt(classId, 10)],
    entries: [
      {
        id: `e-${classId}-${String(n)}`,
        loadRowId: `row-${classId}-${String(n)}`,
        classId,
        groupId: null,
        classIds: [classId],
        subjectId: `subject-${String(n)}`,
        teacherId: `t-${classId}-${String(n)}`,
        roomId: null,
        tutorRow: false,
      },
    ],
  });
  const dayOf = (numbers: readonly number[], classId = '7a') =>
    numbers.map((n) => lessonBlock(classId, n));

  const shortInput = (
    blocks: readonly DatedBlock[],
    keeps: Record<string, readonly number[]> = {},
    day: Day = FIVE,
  ) =>
    input({
      firstDate: DATE,
      lastDate: DATE,
      blocks,
      weeklyDay: () => SEVEN,
      dayOn: () => ({ lessons: true, day, followsWeekday: 1, noRegularLessons: false }),
      keptOn: (classId, date) => (date === DATE ? (keeps[classId] ?? null) : null),
    });
  const timesOf = (found: ReturnType<typeof datedPattern>) =>
    found.lessons.map((one) => [one.entryId, one.placement.start, one.placement.end]);
  const cancelledOf = (found: ReturnType<typeof datedPattern>) =>
    found.cancelled.map((one) => [one.blockId, one.reason]);

  it('keeps the two lessons chosen in place of the last two (Done when)', () => {
    const found = datedPattern(
      shortInput(dayOf([1, 2, 3, 4, 5, 6, 7]), { '7a': [1, 3, 5, 11, 13] }),
    );
    expect(timesOf(found)).toEqual([
      ['e-7a-1', ...short(1)],
      ['e-7a-2', ...short(2)],
      ['e-7a-3', ...short(3)],
      ['e-7a-6', ...short(4)],
      ['e-7a-7', ...short(5)],
    ]);
    expect(cancelledOf(found)).toEqual([
      ['7a-4', 'not_in_template'],
      ['7a-5', 'not_in_template'],
    ]);
    expect(found.shortened).toEqual([
      {
        date: DATE,
        classId: '7a',
        lessonSlots: 5,
        lessons: [1, 2, 3, 4, 5, 6, 7].map((n) => ({
          blockId: `7a-${String(n)}`,
          slotPosition: position(n),
          entryIds: [`e-7a-${String(n)}`],
        })),
        kept: [1, 3, 5, 11, 13],
        chosen: true,
        missingPositions: [],
      },
    ]);
    expect(found.unusedKeeps).toEqual([]);
  });

  it('keeps the first five by their order in the day without a choice, and lists the class', () => {
    const found = datedPattern(shortInput(dayOf([1, 2, 3, 4, 5, 6, 7])));
    expect(timesOf(found).map(([id]) => id)).toEqual([
      'e-7a-1',
      'e-7a-2',
      'e-7a-3',
      'e-7a-4',
      'e-7a-5',
    ]);
    expect(cancelledOf(found)).toEqual([
      ['7a-6', 'not_in_template'],
      ['7a-7', 'not_in_template'],
    ]);
    expect(found.shortened.map((one) => [one.classId, one.kept, one.chosen])).toEqual([
      ['7a', [1, 3, 5, 7, 9], false],
    ]);
  });

  it('gives a saved choice equal to the default the default lessons, with a free period (review correction 1)', () => {
    const blocks = dayOf([1, 2, 4, 5, 6, 7]);
    const none = datedPattern(shortInput(blocks));
    const same = datedPattern(shortInput(blocks, { '7a': [1, 3, 7, 9] }));
    expect(timesOf(none)).toEqual([
      ['e-7a-1', ...short(1)],
      ['e-7a-2', ...short(2)],
      ['e-7a-4', ...short(4)],
      ['e-7a-5', ...short(5)],
    ]);
    expect(timesOf(same)).toEqual(timesOf(none));
    expect(cancelledOf(same)).toEqual(cancelledOf(none));
    expect(same.shortened.map((one) => one.chosen)).toEqual([true]);
  });

  it('ignores a choice on a day that is not shortened for the class, and lists it unused (decision 3)', () => {
    const found = datedPattern(shortInput(dayOf([1, 2, 3, 4, 5]), { '7a': [1, 3, 5] }));
    expect(timesOf(found).map(([id]) => id)).toEqual([
      'e-7a-1',
      'e-7a-2',
      'e-7a-3',
      'e-7a-4',
      'e-7a-5',
    ]);
    expect(found.cancelled).toEqual([]);
    expect(found.shortened).toEqual([]);
    expect(found.unusedKeeps).toEqual([{ date: DATE, classId: '7a' }]);
  });

  it('ignores a stored position that holds no lesson of the class and names it (decision 11)', () => {
    const blocks = dayOf([1, 2, 3, 4, 5, 6, 7]);
    const found = datedPattern(shortInput(blocks, { '7a': [1, 3, 5, 11, 15] }));
    expect(timesOf(found)).toEqual([
      ['e-7a-1', ...short(1)],
      ['e-7a-2', ...short(2)],
      ['e-7a-3', ...short(3)],
      ['e-7a-6', ...short(4)],
    ]);
    expect(found.shortened[0]).toMatchObject({ kept: [1, 3, 5, 11], missingPositions: [15] });
    // No stored position holds a lesson: the choice is unused and the default applies.
    const none = datedPattern(shortInput(blocks, { '7a': [15, 17] }));
    expect(timesOf(none)).toEqual(timesOf(datedPattern(shortInput(blocks))));
    expect(none.shortened[0]).toMatchObject({ chosen: false, kept: [1, 3, 5, 7, 9] });
    expect(none.unusedKeeps).toEqual([{ date: DATE, classId: '7a' }]);
  });

  it('cancels a kept lesson that finds no free slot of the day', () => {
    const found = datedPattern(
      shortInput(dayOf([1, 2, 3, 4, 5, 6, 7]), { '7a': [1, 3, 5, 7, 9, 11] }),
    );
    expect(timesOf(found).map(([id]) => id)).toEqual([
      'e-7a-1',
      'e-7a-2',
      'e-7a-3',
      'e-7a-4',
      'e-7a-5',
    ]);
    expect(cancelledOf(found)).toEqual([
      ['7a-6', 'not_in_template'],
      ['7a-7', 'not_in_template'],
    ]);
  });

  describe('a group drawn from two classes (decision 4)', () => {
    // Lesson 6 of 7a and 7b is one group lesson.
    const groupBlock: DatedBlock = {
      ...lessonBlock('7a', 6),
      id: 'grp',
      entries: [
        {
          id: 'e-grp',
          loadRowId: 'row-grp',
          classId: null,
          groupId: 'g7',
          classIds: ['7a', '7b'],
          subjectId: 'english',
          teacherId: 't-grp',
          roomId: null,
          tutorRow: false,
        },
      ],
    };
    const blocks = [
      ...dayOf([1, 2, 3, 4, 5, 7], '7a'),
      ...dayOf([1, 2, 3, 4, 5, 7], '7b'),
      groupBlock,
    ];

    it('keeps it where both classes keep it at the same slot', () => {
      const keep = [1, 3, 5, 9, 11];
      const found = datedPattern(shortInput(blocks, { '7a': keep, '7b': keep }));
      expect(found.lessons.find((one) => one.entryId === 'e-grp')?.placement).toMatchObject({
        start: short(4)[0],
        end: short(4)[1],
      });
    });

    it('cancels it where the classes keep it at different slots', () => {
      const found = datedPattern(
        shortInput(blocks, { '7a': [1, 3, 5, 9, 11], '7b': [1, 3, 5, 7, 11] }),
      );
      expect(found.lessons.some((one) => one.entryId === 'e-grp')).toBe(false);
      expect(found.cancelled).toContainEqual({
        date: DATE,
        reason: 'not_in_template',
        blockId: 'grp',
        entryIds: ['e-grp'],
      });
    });

    it('cancels it where one class keeps it and the other has no choice', () => {
      const found = datedPattern(shortInput(blocks, { '7a': [1, 3, 5, 9, 11] }));
      expect(found.lessons.some((one) => one.entryId === 'e-grp')).toBe(false);
      expect(found.cancelled).toContainEqual({
        date: DATE,
        reason: 'not_in_template',
        blockId: 'grp',
        entryIds: ['e-grp'],
      });
      expect(found.shortened.map((one) => one.classId)).toEqual(['7a', '7b']);
    });
  });
});
