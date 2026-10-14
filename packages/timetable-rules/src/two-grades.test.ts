import { describe, expect, it } from 'vitest';
import { dayTimes, type Day } from './day.js';
import { sharedLessonSlots, twoGradeSlots } from './two-grades.js';
import type { TemplateSettings } from './templates.js';

const lesson = (lengthMinutes: number) => ({ kind: 'lesson' as const, lengthMinutes });
const pause = (lengthMinutes: number) => ({ kind: 'break' as const, lengthMinutes });

// 08:00, five 45-minute lessons with 10-minute breaks, lunch after the third.
const senior = dayTimes(480, [
  lesson(45),
  pause(10),
  lesson(45),
  pause(10),
  lesson(45),
  pause(40),
  lesson(45),
  pause(10),
  lesson(45),
]);
// 08:00, 40-minute lessons: 08:00-08:40 against 08:00-08:45, nothing is shared.
const junior = dayTimes(480, [lesson(40), pause(15), lesson(40), pause(10), lesson(40)]);
// The same morning as `senior`, a longer lunch one slot later.
const lateLunch = dayTimes(480, [
  lesson(45),
  pause(10),
  lesson(45),
  pause(10),
  lesson(45),
  pause(10),
  lesson(45),
  pause(45),
  lesson(45),
]);

describe('sharedLessonSlots (edge/timetable: lessons only in a slot with the same start and end time in both templates)', () => {
  it('shares every lesson slot of two equal days', () => {
    expect(sharedLessonSlots(senior, senior).map((slot) => slot.start)).toEqual([
      480, 535, 590, 675, 730,
    ]);
  });

  it('compares clock time, never slot numbers: 40-minute and 45-minute lessons share nothing', () => {
    expect(sharedLessonSlots(senior, junior)).toEqual([]);
  });

  it('shares the morning when the days differ only after lunch', () => {
    expect(sharedLessonSlots(senior, lateLunch)).toEqual([
      { start: 480, end: 525, lessonA: 1, lessonB: 1 },
      { start: 535, end: 580, lessonA: 2, lessonB: 2 },
      { start: 590, end: 635, lessonA: 3, lessonB: 3 },
    ]);
  });

  it('never shares a lesson slot with a break of the same times', () => {
    const breakFirst = dayTimes(480, [pause(45), lesson(45)]);
    const lessonFirst = dayTimes(480, [lesson(45), pause(45)]);
    expect(sharedLessonSlots(breakFirst, lessonFirst)).toEqual([]);
  });
});

describe('twoGradeSlots (per working weekday, the templates in force from a date)', () => {
  const days: Record<string, Day> = { senior, junior, lateLunch };
  const dayOf = (templateId: string) => days[templateId] ?? null;
  // Default senior; grades 1 to 4 junior; Monday (1) for grades 9 to 11 lateLunch.
  const byDefault = {
    level: 'default',
    weekday: null,
    gradeFrom: null,
    gradeTo: null,
    dayTemplateId: 'senior',
    validFrom: '2026-09-01',
    validUntil: null,
  } as const;
  const byGrades = {
    level: 'grades',
    weekday: null,
    gradeFrom: 1,
    gradeTo: 4,
    dayTemplateId: 'junior',
    validFrom: '2026-09-01',
    validUntil: null,
  } as const;
  const settings: TemplateSettings = {
    assignments: [
      byDefault,
      byGrades,
      {
        level: 'weekday_grades',
        weekday: 1,
        gradeFrom: 9,
        gradeTo: 11,
        dayTemplateId: 'lateLunch',
        validFrom: '2026-09-01',
        validUntil: null,
      },
    ],
  };
  it('gives, from a Wednesday, the first date of each working weekday and its shared slots', () => {
    const week = twoGradeSlots(8, 9, '2026-10-14', [1, 2, 3, 4, 5], settings, dayOf);
    expect(week.map((day) => [day.weekday, day.date, day.slots.length])).toEqual([
      [1, '2026-10-19', 3],
      [2, '2026-10-20', 5],
      [3, '2026-10-14', 5],
      [4, '2026-10-15', 5],
      [5, '2026-10-16', 5],
    ]);
  });

  it('gives no slot on any weekday for grades of 40-minute and 45-minute lessons', () => {
    const week = twoGradeSlots(4, 5, '2026-10-14', [1, 2, 3, 4, 5], settings, dayOf);
    expect(week.every((day) => day.slots.length === 0)).toBe(true);
  });

  it('gives no slot on a weekday where a grade has no template', () => {
    const none: TemplateSettings = { assignments: [] };
    const week = twoGradeSlots(9, 10, '2026-10-14', [3], none, dayOf);
    expect(week).toEqual([{ weekday: 3, date: '2026-10-14', slots: [] }]);
  });

  it('reads the templates in force on each date, not on the first one', () => {
    const later: TemplateSettings = {
      assignments: [
        { ...byDefault, validUntil: '2026-10-16' },
        { ...byDefault, dayTemplateId: 'junior', validFrom: '2026-10-16' },
        byGrades,
      ],
    };
    // Grade 5 has senior until 16 October, junior from then; grade 4 junior throughout.
    const week = twoGradeSlots(4, 5, '2026-10-14', [3, 5], later, dayOf);
    expect(week.map((day) => [day.date, day.slots.length])).toEqual([
      ['2026-10-14', 0],
      ['2026-10-16', 3],
    ]);
  });
});
