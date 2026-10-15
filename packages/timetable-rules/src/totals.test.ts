import { describe, expect, it } from 'vitest';
import { dayTimes, type Day } from './day.js';
import type { TemplateAssignment } from './templates.js';
import {
  classWeekLessons,
  freeSlots,
  lessonIntervals,
  teacherWeekLessons,
  weekDaysOf,
  weekLessonSlots,
  type Interval,
  type TotalsRow,
} from './totals.js';

const lessons = (start: number, count: number, length: number, gap = 5): Day =>
  dayTimes(
    start,
    Array.from({ length: count * 2 - 1 }, (_, index) =>
      index % 2 === 0
        ? { kind: 'lesson' as const, lengthMinutes: length }
        : { kind: 'break' as const, lengthMinutes: gap },
    ),
  );

// 08:00, 40-minute lessons (grades 1-4) and 45-minute lessons (grades 5-11),
// 5-minute breaks: lesson 3 of the first (09:30-10:10) overlaps lesson 2 of
// the second (08:50-09:35) and lesson 3 (09:40-10:25). edge/timetable,
// Structure: clock time, never slot numbers.
const short = lessons(8 * 60, 6, 40);
const long = lessons(8 * 60, 6, 45);

describe('weekDaysOf (decision 6, correction 2)', () => {
  const assignment = (
    dayTemplateId: string,
    validFrom: string,
    validUntil: string | null,
  ): TemplateAssignment => ({
    level: 'default',
    weekday: null,
    gradeFrom: null,
    gradeTo: null,
    dayTemplateId,
    validFrom,
    validUntil,
  });

  it('reads each weekday on its first date on or after the start date', () => {
    // The version starts on Wednesday 2026-10-21; a template change takes
    // effect on Friday 2026-10-23, inside the start week.
    const days = weekDaysOf(
      7,
      '2026-10-21',
      [1, 2, 3, 4, 5],
      {
        assignments: [
          assignment('six', '2026-09-01', '2026-10-23'),
          assignment('four', '2026-10-23', null),
        ],
      },
      (id) => (id === 'six' ? lessons(480, 6, 45) : lessons(480, 4, 45)),
    );
    expect(days.map((one) => one.date)).toEqual([
      '2026-10-26',
      '2026-10-27',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
    ]);
    // Monday and Tuesday fall after the change too: 4 + 4 + 6 + 6 + 4.
    expect(weekLessonSlots(days)).toBe(24);
  });

  it('counts nothing for a weekday with no template', () => {
    const days = weekDaysOf(7, '2026-10-19', [1, 2], { assignments: [] }, () => long);
    expect(weekLessonSlots(days)).toBe(0);
  });
});

describe('freeSlots (decision 7)', () => {
  const both = [...lessonIntervals(short), ...lessonIntervals(long)];

  it('counts one template as its lesson slots inside the hours', () => {
    expect(freeSlots(lessonIntervals(long), [{ start: 0, end: 1440 }])).toBe(6);
    expect(freeSlots(lessonIntervals(long), [])).toBe(0);
  });

  it('never counts two slots that overlap in clock time', () => {
    const counted = freeSlots(both, [{ start: 0, end: 1440 }]);
    // Never more than one template has, never two overlapping intervals.
    expect(counted).toBe(6);
  });

  it('keeps a slot that ends where the hours begin out, and one that starts where they end', () => {
    // The hours 08:45-09:35 hold lesson 2 of the 45-minute day (08:50-09:35) only.
    expect(freeSlots(lessonIntervals(long), [{ start: 8 * 60 + 45, end: 9 * 60 + 35 }])).toBe(1);
    expect(freeSlots(lessonIntervals(long), [{ start: 8 * 60 + 45, end: 9 * 60 + 34 }])).toBe(0);
  });

  it('takes a slot of either template that fits the hours', () => {
    // 09:30-10:10 holds lesson 3 of the 40-minute day only.
    expect(freeSlots(both, [{ start: 9 * 60 + 30, end: 10 * 60 + 10 }])).toBe(1);
  });

  it('never exceeds the most slots of one template, and never overlaps (every hour window)', () => {
    const overlaps = (a: Interval, b: Interval) => a.start < b.end && b.start < a.end;
    for (let start = 7 * 60; start < 13 * 60; start += 5) {
      for (let end = start + 5; end <= 14 * 60; end += 5) {
        const hours = [{ start, end }];
        const counted = freeSlots(both, hours);
        const inside = both.filter((slot) => start <= slot.start && slot.end <= end);
        expect(counted).toBeLessThanOrEqual(inside.length);
        // The greedy answer is the largest set: no set of counted + 1 slots inside fits.
        const pick = [...inside].sort((a, b) => a.end - b.end);
        const chosen: Interval[] = [];
        for (const slot of pick) {
          if (chosen.every((one) => !overlaps(one, slot))) chosen.push(slot);
        }
        expect(counted).toBe(chosen.length);
        expect(counted).toBeLessThanOrEqual(Math.max(lessonIntervals(short).length, 6));
      }
    }
  });
});

describe('classWeekLessons and teacherWeekLessons', () => {
  const rows: TotalsRow[] = [
    { classId: 'oxford', groupId: null, subjectId: 'algebra', teacherId: 'a', lessonsPerWeek: 5 },
    { classId: null, groupId: 'en1', subjectId: 'english', teacherId: 'b', lessonsPerWeek: 3 },
    { classId: null, groupId: 'en2', subjectId: 'english', teacherId: 'c', lessonsPerWeek: 3 },
    { classId: null, groupId: 'pe', subjectId: 'pe', teacherId: 'a', lessonsPerWeek: 2 },
  ];
  const groupClasses = new Map([
    ['en1', ['oxford', 'princeton']],
    ['en2', ['oxford', 'princeton']],
    ['pe', ['oxford', 'edinburgh']],
  ]);

  it('counts a block once per class and a two-grade group for each of its classes', () => {
    expect(classWeekLessons(rows, groupClasses)).toEqual(
      new Map([
        ['oxford', 5 + 3 + 2],
        ['princeton', 3],
        ['edinburgh', 2],
      ]),
    );
  });

  it('sums the rows of each teacher', () => {
    expect(teacherWeekLessons(rows)).toEqual(
      new Map([
        ['a', 7],
        ['b', 3],
        ['c', 3],
      ]),
    );
  });
});
