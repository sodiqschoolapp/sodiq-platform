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
  type TotalsGroup,
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
    {
      classId: 'oxford',
      groupId: null,
      subjectId: 'algebra',
      teacherId: 'a',
      lessonsPerWeek: 5,
      mixedBlock: false,
    },
    {
      classId: null,
      groupId: 'en1',
      subjectId: 'english',
      teacherId: 'b',
      lessonsPerWeek: 3,
      mixedBlock: false,
    },
    {
      classId: null,
      groupId: 'en2',
      subjectId: 'english',
      teacherId: 'c',
      lessonsPerWeek: 3,
      mixedBlock: false,
    },
    {
      classId: null,
      groupId: 'pe',
      subjectId: 'pe',
      teacherId: 'a',
      lessonsPerWeek: 2,
      mixedBlock: false,
    },
  ];
  const groupClasses = new Map<string, TotalsGroup>([
    ['en1', { classIds: ['oxford', 'princeton'], sex: null }],
    ['en2', { classIds: ['oxford', 'princeton'], sex: null }],
    ['pe', { classIds: ['oxford', 'edinburgh'], sex: null }],
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

/**
 * Task 5.16: one-sex mixed halves of a split pair across subjects (edge/timetable, Structure: "A
 * mixed block is allowed: boys have physical education while girls have technology, and the reverse
 * in another slot"; 06, Rules: "a mixed block pairs parts of two subjects instead"), so a sport slot
 * holds one boys' lesson and one girls' lesson and counts once for the class: the split needs the
 * larger of the boys' and the girls' lessons (decisions 2 to 5).
 */
describe('classWeekLessons with mixed halves for one sex', () => {
  const whole = (classId: string, lessonsPerWeek: number): TotalsRow => ({
    classId,
    groupId: null,
    subjectId: `core-${classId}`,
    teacherId: 't-core',
    lessonsPerWeek,
    mixedBlock: false,
  });
  const half = (
    groupId: string,
    subjectId: string,
    lessonsPerWeek: number,
    mixedBlock = true,
  ): TotalsRow => ({
    classId: null,
    groupId,
    subjectId,
    teacherId: `t-${groupId}`,
    lessonsPerWeek,
    mixedBlock,
  });
  /** The sport of one split: boys PE 2, Swimming 1, Taekwondo 2; girls PE 2, Swimming 1, Gymnastics 2. */
  const sport = (prefix: string, boysTaekwondo = 2, mixedBlock = true): TotalsRow[] => [
    half(`${prefix}-pe-b`, 'pe', 2, mixedBlock),
    half(`${prefix}-swim-b`, 'swimming', 1, mixedBlock),
    half(`${prefix}-tkd-b`, 'taekwondo', boysTaekwondo, mixedBlock),
    half(`${prefix}-pe-g`, 'pe', 2, mixedBlock),
    half(`${prefix}-swim-g`, 'swimming', 1, mixedBlock),
    half(`${prefix}-gym-g`, 'gymnastics', 2, mixedBlock),
  ];
  const sportGroups = (
    prefix: string,
    classIds: readonly string[],
    sexes: { boys: TotalsGroup['sex']; girls: TotalsGroup['sex'] } = {
      boys: 'male',
      girls: 'female',
    },
  ): [string, TotalsGroup][] => [
    [`${prefix}-pe-b`, { classIds, sex: sexes.boys }],
    [`${prefix}-swim-b`, { classIds, sex: sexes.boys }],
    [`${prefix}-tkd-b`, { classIds, sex: sexes.boys }],
    [`${prefix}-pe-g`, { classIds, sex: sexes.girls }],
    [`${prefix}-swim-g`, { classIds, sex: sexes.girls }],
    [`${prefix}-gym-g`, { classIds, sex: sexes.girls }],
  ];

  it('counts the sport of a pair of classes by its slots: 35 + 5 = 40 for each class', () => {
    const rows = [whole('sydney', 35), whole('columbia', 35), ...sport('pair')];
    const groups = new Map(sportGroups('pair', ['sydney', 'columbia']));
    expect(classWeekLessons(rows, groups)).toEqual(
      new Map([
        ['sydney', 40],
        ['columbia', 40],
      ]),
    );
  });

  it('counts the sport of one class by its slots', () => {
    const rows = [whole('sydney', 35), ...sport('own')];
    const groups = new Map(sportGroups('own', ['sydney']));
    expect(classWeekLessons(rows, groups)).toEqual(new Map([['sydney', 40]]));
  });

  it('still counts an unpaired extra half: boys 6, girls 5 gives 35 + 6', () => {
    const rows = [whole('sydney', 35), whole('columbia', 35), ...sport('pair', 3)];
    const groups = new Map(sportGroups('pair', ['sydney', 'columbia']));
    expect(classWeekLessons(rows, groups)).toEqual(
      new Map([
        ['sydney', 41],
        ['columbia', 41],
      ]),
    );
  });

  it('counts mixed halves for everyone per subject, as before', () => {
    const rows = [whole('sydney', 35), ...sport('own')];
    const groups = new Map(sportGroups('own', ['sydney'], { boys: null, girls: null }));
    expect(classWeekLessons(rows, groups)).toEqual(new Map([['sydney', 35 + 2 + 1 + 2 + 2]]));
  });

  it('counts one-sex halves not marked mixed per subject, as before', () => {
    const rows = [whole('sydney', 35), ...sport('own', 2, false)];
    const groups = new Map(sportGroups('own', ['sydney']));
    expect(classWeekLessons(rows, groups)).toEqual(new Map([['sydney', 35 + 7]]));
  });

  it('counts every mixed row of a split per subject when one mixed half is for everyone', () => {
    const rows = [whole('sydney', 35), ...sport('own')];
    const groups = new Map(sportGroups('own', ['sydney']));
    groups.set('own-gym-g', { classIds: ['sydney'], sex: null });
    expect(classWeekLessons(rows, groups)).toEqual(new Map([['sydney', 35 + 7]]));
  });

  it('counts groups of more than two classes per subject, as before', () => {
    const rows = sport('three');
    const groups = new Map(sportGroups('three', ['sydney', 'columbia', 'harvard']));
    const totals = classWeekLessons(rows, groups);
    expect([...totals.values()]).toEqual([7, 7, 7]);
  });

  it("counts a class's own split and its pair's split once each", () => {
    const rows = [
      whole('sydney', 30),
      whole('columbia', 30),
      ...sport('pair'),
      half('own-art-b', 'woodwork', 1),
      half('own-art-g', 'needlework', 2),
    ];
    const groups = new Map([
      ...sportGroups('pair', ['sydney', 'columbia']),
      ['own-art-b', { classIds: ['sydney'], sex: 'male' }] as [string, TotalsGroup],
      ['own-art-g', { classIds: ['sydney'], sex: 'female' }] as [string, TotalsGroup],
    ]);
    expect(classWeekLessons(rows, groups)).toEqual(
      new Map([
        ['sydney', 30 + 5 + 2],
        ['columbia', 30 + 5],
      ]),
    );
  });

  // Review correction 2: a taekwondo group of three classes that holds a class of the pair is
  // linked to the pair's boys' taekwondo by a shared class (groupsLinked, task 5.15) and runs in
  // the same slot, so counting it beside the sides counts that subject twice. This over-count is
  // the intended side (decision 4): counting more holds step 2 and names the class; counting less
  // lets through a draft that cannot be built. Do not "fix" it into an under-count.
  it("counts a group outside the split per subject beside the split's sides (over, by intent)", () => {
    const rows = [whole('sydney', 35), ...sport('pair'), half('tkd-three', 'taekwondo', 2, false)];
    const groups = new Map([
      ...sportGroups('pair', ['sydney', 'columbia']),
      ['tkd-three', { classIds: ['sydney', 'harvard', 'yale'], sex: null }] as [
        string,
        TotalsGroup,
      ],
    ]);
    const totals = classWeekLessons(rows, groups);
    expect(totals.get('sydney')).toBe(35 + 5 + 2);
    expect(totals.get('columbia')).toBe(5);
    expect(totals.get('harvard')).toBe(2);
    expect(totals.get('yale')).toBe(2);
  });

  it("takes the larger of two boys' groups of one subject, not their sum", () => {
    const rows = [half('pe-b1', 'pe', 2), half('pe-b2', 'pe', 2), half('pe-g', 'pe', 2)];
    const groups = new Map<string, TotalsGroup>([
      ['pe-b1', { classIds: ['sydney'], sex: 'male' }],
      ['pe-b2', { classIds: ['sydney'], sex: 'male' }],
      ['pe-g', { classIds: ['sydney'], sex: 'female' }],
    ]);
    expect(classWeekLessons(rows, groups)).toEqual(new Map([['sydney', 2]]));
  });
});
