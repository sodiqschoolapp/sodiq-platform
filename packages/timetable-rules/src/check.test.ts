import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { checkCandidate, checkTimetable, overlappingPairs } from './check.js';
import { dayTimes, type DaySlotInput } from './day.js';
import type {
  EngineDay,
  EngineRoom,
  EngineTeacher,
  EngineUnit,
  Facts,
  Placement,
} from './placement.js';
import { slotStatus, type RuleCode, type RuleResult } from './rules.js';

// Task 5.2, pull request #109: every rule of docs/spec/06-timetable.md, Rules,
// with a passing and a failing case. Invented names only.

const lesson = (length: number): DaySlotInput => ({ kind: 'lesson', lengthMinutes: length });
const pause = (length: number): DaySlotInput => ({ kind: 'break', lengthMinutes: length });

// Grades 5–11: 45-minute lessons from 08:00. L1 08:00–08:45, L2 08:50–09:35,
// L3 09:55–10:40, L4 10:45–11:30, L5 11:35–12:20.
const SENIOR = dayTimes(480, [
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
// Grades 1–4: 40-minute lessons from 08:00. L1 08:00–08:40, L2 08:45–09:25,
// L3 09:30–10:10: slot 3 here meets slot 2 of the seniors (edge/timetable, Structure).
const JUNIOR = dayTimes(480, [lesson(40), pause(5), lesson(40), pause(5), lesson(40)]);
// Grade 10 after lunch differs: its L2 is 08:50–09:40, so grade 9 and 10 share only L1.
const TENTH = dayTimes(480, [lesson(45), pause(5), lesson(50), pause(15), lesson(45)]);

const L1 = { start: 480, end: 525 };
const L2 = { start: 530, end: 575 };
const L3 = { start: 595, end: 640 };
const L4 = { start: 645, end: 690 };
const J3 = { start: 570, end: 610 };

const A = 'branch-a';
const B = 'branch-b';

const week = (from: number, to: number) =>
  [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: from, end: to }));

function teacher(id: string, extra: Partial<EngineTeacher> = {}): EngineTeacher {
  return {
    id,
    vacancy: false,
    out: false,
    branchIds: [A, B],
    subjects: [
      { subjectId: 'math', grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
      { subjectId: 'english', grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
    ],
    languages: ['uz', 'ru'],
    availability: [
      { branchId: A, validFrom: '2026-09-01', validUntil: null, ranges: week(480, 900) },
      { branchId: B, validFrom: '2026-09-01', validUntil: null, ranges: week(480, 900) },
    ],
    weeklyLessons: null,
    dailyLessons: null,
    ...extra,
  };
}

const unit = (
  id: string,
  kind: 'class' | 'group',
  grades: number[],
  language = 'uz',
): EngineUnit => ({
  id,
  kind,
  grades,
  language,
  tutorStaffIds: [],
});

const room = (id: string, extra: Partial<EngineRoom> = {}): EngineRoom => ({
  id,
  status: 'in_use',
  shared: false,
  lessonsAtOnce: 1,
  capacity: 30,
  ...extra,
});

const CLASS_STUDENTS: Record<string, string[]> = {
  '7a': ['s1', 's2', 's3', 's4'],
  '7b': ['s5', 's6'],
  '1a': ['j1', 'j2'],
  '9a': ['n1', 'n2'],
  '10a': ['m1', 'm2'],
};

const SCHOOL_DATES = { firstDate: '2026-09-02', lastDate: '2027-05-31' };

function facts(extra: Partial<Facts> = {}): Facts {
  const dayOf = (branchId: string, grade: number, day: string): EngineDay => {
    if (day === '6' || day === '7' || day === '2026-11-14') {
      return { lessons: false, reason: 'not_working_day' };
    }
    if (day === '2026-11-11' && branchId === A) {
      return { lessons: false, reason: 'day_off' };
    }
    if (day === '2026-11-12' && grade <= 4) {
      return { lessons: false, reason: 'no_template' };
    }
    const times = grade <= 4 ? JUNIOR : grade === 10 ? TENTH : SENIOR;
    return { lessons: true, day: times, noRegularLessons: day === '2026-12-21' };
  };
  return {
    mode: 'pattern',
    startDate: '2026-11-09',
    versionEnd: '2026-12-27',
    teachers: new Map(
      [teacher('t1'), teacher('t2'), teacher('t3'), teacher('vac', { vacancy: true })].map(
        (one) => [one.id, one],
      ),
    ),
    subjects: new Map(
      [
        { id: 'math', active: true, languageRule: true, tutorSubject: false },
        { id: 'english', active: true, languageRule: false, tutorSubject: false },
        { id: 'old', active: false, languageRule: true, tutorSubject: false },
      ].map((one) => [one.id, one]),
    ),
    rooms: new Map(
      [
        room('r1'),
        room('r2'),
        room('small', { capacity: 2 }),
        room('gym', { shared: true, lessonsAtOnce: 2, capacity: 5 }),
        room('repair', { status: 'under_repair' }),
        room('closed', { status: 'closed' }),
      ].map((one) => [one.id, one]),
    ),
    units: new Map(
      [
        unit('7a', 'class', [7]),
        unit('7b', 'class', [7]),
        unit('1a', 'class', [1]),
        unit('9a', 'class', [9]),
        unit('10a', 'class', [10]),
        unit('7m1', 'group', [7]),
        unit('7m2', 'group', [7]),
        unit('pe910', 'group', [9, 10]),
        unit('7ru', 'class', [7], 'ru'),
      ].map((one) => [one.id, one]),
    ),
    classStudents: (classId) => CLASS_STUDENTS[classId] ?? [],
    dayOf,
    years: new Map([
      [
        A,
        {
          ...SCHOOL_DATES,
          quarters: [
            { firstDate: '2026-09-02', lastDate: '2026-10-31' },
            { firstDate: '2026-11-09', lastDate: '2026-12-27' },
          ],
        },
      ],
      [
        B,
        {
          ...SCHOOL_DATES,
          quarters: [
            { firstDate: '2026-09-02', lastDate: '2026-10-31' },
            { firstDate: '2026-11-09', lastDate: '2026-12-27' },
          ],
        },
      ],
    ]),
    travelMinutes: () => 30,
    classDailyLessons: () => null,
    loadRows: [],
    otherDrafts: [],
    ...extra,
  };
}

let next = 0;

/** A whole-class lesson of 7a in L1 on Monday, by t1, in r1, unless told otherwise. */
function place(extra: Partial<Placement> = {}): Placement {
  next += 1;
  const id = extra.id ?? `p${next}`;
  const classId = extra.classId === undefined ? '7a' : extra.classId;
  return {
    id,
    kind: 'lesson',
    branchId: A,
    day: '1',
    ...L1,
    blockId: `block-${id}`,
    doublePairId: null,
    classId,
    groupId: null,
    classIds: classId === null ? [] : [classId],
    studentIds: classId === null ? [] : (CLASS_STUDENTS[classId] ?? []),
    exemptStudentIds: [],
    subjectId: 'math',
    loadRowId: null,
    teacherIds: ['t1'],
    substitute: false,
    roomId: 'r1',
    examRooms: [],
    extra: false,
    fixed: false,
    ...extra,
  };
}

const exam = (extra: Partial<Placement> = {}): Placement =>
  place({
    kind: 'exam',
    classId: null,
    blockId: null,
    classIds: ['7a'],
    studentIds: CLASS_STUDENTS['7a'] ?? [],
    roomId: null,
    examRooms: [{ roomId: 'r2', students: 4 }],
    teacherIds: ['t2'],
    subjectId: 'english',
    start: L2.start,
    end: L3.end,
    ...extra,
  });

const codes = (results: readonly RuleResult[]) => results.map((result) => result.rule);
const only = (results: readonly RuleResult[], rule: RuleCode) =>
  results.filter((result) => result.rule === rule);

describe('one place at a time', () => {
  it('refuses a teacher in two lessons at once, by clock time across templates', () => {
    // Grade 1 slot 3 (09:30–10:10) meets grade 7 slot 2 (08:50–09:35).
    const results = checkTimetable(
      [place({ id: 'a', ...L2 }), place({ id: 'b', classId: '1a', ...J3, roomId: 'r2' })],
      facts(),
    );
    expect(only(results, 'teacher_double')).toEqual([
      { rule: 'teacher_double', severity: 'blocked', day: '1', lessonIds: ['a', 'b'] },
    ]);
  });

  it('allows lessons that touch: 08:00–08:45 and 08:45–09:30', () => {
    const results = checkTimetable(
      [
        place({ id: 'a', start: 480, end: 525 }),
        place({ id: 'b', classId: '7b', start: 525, end: 570, roomId: 'r2' }),
      ],
      facts(),
    );
    expect(codes(results)).not.toContain('teacher_double');
  });

  it('refuses a teacher in two branches at once and a vacancy in two lessons', () => {
    const results = checkTimetable(
      [
        place({ id: 'a' }),
        place({ id: 'b', branchId: B, classId: '7b', roomId: 'r2' }),
        place({ id: 'c', classId: '9a', teacherIds: ['vac'], roomId: 'small', ...L3 }),
        place({ id: 'd', classId: '10a', teacherIds: ['vac'], roomId: 'r2', ...L3 }),
      ],
      facts(),
    );
    expect(only(results, 'teacher_double').map((one) => one.lessonIds)).toEqual([
      ['a', 'b'],
      ['c', 'd'],
    ]);
  });

  it('counts an invigilator as busy (06, Rules, the exam row)', () => {
    const results = checkTimetable(
      [place({ id: 'a', classId: '7b', teacherIds: ['t2'], ...L3 }), exam({ id: 'x' })],
      facts(),
    );
    expect(only(results, 'teacher_double').map((one) => one.lessonIds)).toEqual([['x', 'a']]);
  });

  it('refuses a room that is not shared holding two lessons, or a lesson and an exam', () => {
    const results = checkTimetable(
      [
        place({ id: 'a' }),
        place({ id: 'b', classId: '7b', teacherIds: ['t2'] }),
        place({ id: 'c', classId: '9a', teacherIds: ['t3'], roomId: 'r2', ...L2 }),
        exam({ id: 'x', classIds: ['10a'], teacherIds: ['t1'] }),
      ],
      facts(),
    );
    expect(only(results, 'room_double').map((one) => one.lessonIds)).toEqual([
      ['a', 'b'],
      ['c', 'x'],
    ]);
  });

  it('lets a shared room hold its number of lessons, and refuses one more', () => {
    const two = [
      place({ id: 'a', classId: '1a', roomId: 'gym', teacherIds: ['t1'], start: 480, end: 520 }),
      place({ id: 'b', classId: '9a', roomId: 'gym', teacherIds: ['t2'] }),
    ];
    expect(codes(checkTimetable(two, facts()))).not.toContain('room_shared_full');
    const three = [...two, place({ id: 'c', classId: '10a', roomId: 'gym', teacherIds: ['t3'] })];
    expect(only(checkTimetable(three, facts()), 'room_shared_full')).toHaveLength(1);
    expect(only(checkTimetable(three, facts()), 'room_shared_full')[0]?.lessonIds).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('refuses a shared room whose lessons together pass its capacity, and counts no exam student', () => {
    const within = [
      place({ id: 'a', classId: '9a', roomId: 'gym', teacherIds: ['t1'] }),
      place({ id: 'b', classId: '10a', roomId: 'gym', teacherIds: ['t2'] }),
    ];
    expect(codes(checkTimetable(within, facts()))).not.toContain('room_shared_capacity');
    const over = [
      place({ id: 'a', classId: '7a', roomId: 'gym', teacherIds: ['t1'] }),
      place({ id: 'b', classId: '10a', roomId: 'gym', teacherIds: ['t2'] }),
      place({ id: 'c', classId: '9a', roomId: 'r2', teacherIds: ['t3'] }),
    ];
    expect(only(checkTimetable(over, facts()), 'room_shared_capacity')[0]).toMatchObject({
      severity: 'blocked',
      lessonIds: ['a', 'b'],
      detail: { capacity: 5, students: 6 },
    });
    // An exam in the shared room is one use; its 4 students are not counted (decision 16).
    const withExam = [
      place({ id: 'a', classId: '9a', roomId: 'gym', teacherIds: ['t1'], ...L2 }),
      exam({ id: 'x', examRooms: [{ roomId: 'gym', students: 4 }] }),
    ];
    expect(codes(checkTimetable(withExam, facts()))).not.toContain('room_shared_capacity');
  });

  it('refuses a class in two blocks at once, or in a lesson and an exam', () => {
    const results = checkTimetable(
      [
        place({ id: 'a' }),
        place({ id: 'b', teacherIds: ['t2'], roomId: 'r2' }),
        place({ id: 'c', classId: '9a', teacherIds: ['t3'], ...L2 }),
        exam({ id: 'x', classIds: ['9a'], studentIds: ['n1', 'n2'], teacherIds: ['t1'] }),
      ],
      facts(),
    );
    expect(only(results, 'class_double').map((one) => one.lessonIds)).toEqual([
      ['a', 'b'],
      ['c', 'x'],
    ]);
  });

  it('allows a split: two lessons of one block at once (edge/timetable, Structure)', () => {
    const block = [
      place({
        id: 'a',
        classId: null,
        groupId: '7m1',
        classIds: ['7a', '7b'],
        studentIds: ['s1', 's2', 's5'],
        blockId: 'blk',
      }),
      place({
        id: 'b',
        classId: null,
        groupId: '7m2',
        classIds: ['7a', '7b'],
        studentIds: ['s3', 's4', 's6'],
        blockId: 'blk',
        teacherIds: ['t2'],
        roomId: 'r2',
      }),
    ];
    const results = checkTimetable(block, facts());
    expect(codes(results)).not.toContain('class_double');
    expect(codes(results)).not.toContain('student_double');
    expect(codes(results)).not.toContain('split_apart');
  });

  it('refuses a student in two lessons at once: a class lesson against a group lesson, two groups', () => {
    const results = checkTimetable(
      [
        place({ id: 'a', classId: '9a', studentIds: ['n1', 'n2', 's1'] }),
        place({
          id: 'b',
          classId: null,
          groupId: '7m1',
          classIds: ['7b'],
          studentIds: ['s1', 's5'],
          teacherIds: ['t2'],
          roomId: 'r2',
        }),
      ],
      facts(),
    );
    expect(only(results, 'student_double').map((one) => one.lessonIds)).toEqual([['a', 'b']]);
  });

  it('refuses a student in two lessons of one block', () => {
    const results = checkTimetable(
      [
        place({
          id: 'a',
          classId: null,
          groupId: '7m1',
          classIds: ['7a', '7b'],
          studentIds: ['s1', 's2', 's5'],
          blockId: 'blk',
        }),
        place({
          id: 'b',
          classId: null,
          groupId: '7m2',
          classIds: ['7a', '7b'],
          studentIds: ['s1', 's3', 's4', 's6'],
          blockId: 'blk',
          teacherIds: ['t2'],
          roomId: 'r2',
        }),
      ],
      facts(),
    );
    expect(only(results, 'student_double').map((one) => one.lessonIds)).toEqual([['a', 'b']]);
  });

  it('refuses a split whose parts sit in different slots (06, Rules: "in the same slot")', () => {
    const results = checkTimetable(
      [
        place({
          id: 'a',
          classId: null,
          groupId: '7m1',
          classIds: ['7a', '7b'],
          studentIds: ['s1', 's2', 's5'],
          blockId: 'blk',
        }),
        place({
          id: 'b',
          classId: null,
          groupId: '7m2',
          classIds: ['7a', '7b'],
          studentIds: ['s3', 's4', 's6'],
          blockId: 'blk',
          teacherIds: ['t2'],
          roomId: 'r2',
          ...L3,
        }),
      ],
      facts(),
    );
    expect(only(results, 'split_apart')).toEqual([
      expect.objectContaining({ severity: 'blocked', lessonIds: ['a', 'b'] }),
    ]);
  });

  it('refuses a split whose parts are not all in the slot', () => {
    const results = checkTimetable(
      [
        place({
          id: 'a',
          classId: null,
          groupId: '7m1',
          classIds: ['7a', '7b'],
          studentIds: ['s1', 's2', 's5'],
          blockId: 'blk',
        }),
      ],
      facts(),
    );
    expect(only(results, 'split_apart')[0]).toMatchObject({
      severity: 'blocked',
      lessonIds: ['a'],
      detail: { students: 3 },
    });
  });

  it('leaves out cancelled lessons and exempt students (plan finding 2)', () => {
    // The sitting class's lesson was cancelled with the cause "exam": the caller
    // passes no placement for it, so the exam meets no class lesson.
    expect(codes(checkTimetable([exam({ id: 'x', teacherIds: ['t2'] })], facts()))).not.toContain(
      'class_double',
    );
    // 7a sits an exam; its students are exempt from the kept block with 7b.
    const kept = [
      place({
        id: 'a',
        classId: null,
        groupId: '7m1',
        classIds: ['7a', '7b'],
        studentIds: ['s5'],
        exemptStudentIds: ['s1', 's2'],
        blockId: 'blk',
        ...L2,
      }),
      place({
        id: 'b',
        classId: null,
        groupId: '7m2',
        classIds: ['7a', '7b'],
        studentIds: ['s6'],
        exemptStudentIds: ['s3', 's4'],
        blockId: 'blk',
        teacherIds: ['t3'],
        roomId: 'small',
        ...L2,
      }),
      exam({ id: 'x', classIds: ['7a'], teacherIds: ['t2'] }),
    ];
    const results = checkTimetable(kept, facts());
    expect(codes(results)).not.toContain('student_double');
    expect(codes(results)).not.toContain('split_apart');
    // The class itself still sits in the exam while its block runs: the block
    // keeps 7a among its classes, so that is a class clash the caller settles
    // by taking 7a out of the block's classes, as 5.1b does.
    const out = kept.map((one) =>
      one.id === 'x' ? one : { ...one, classIds: ['7b'], exemptStudentIds: [] },
    );
    expect(codes(checkTimetable(out, facts()))).toEqual([]);
  });
});

describe('the day', () => {
  const dated = (extra: Partial<Facts> = {}) => facts({ mode: 'dated', ...extra });

  it('allows a lesson on a school day in a quarter', () => {
    expect(codes(checkTimetable([place({ day: '2026-11-10' })], dated()))).toEqual([]);
  });

  it('refuses a date outside the academic year', () => {
    expect(codes(checkTimetable([place({ day: '2027-06-07' })], dated()))).toEqual([
      'outside_year',
    ]);
  });

  it('refuses a date in the year but in no quarter: a vacation (review correction 1)', () => {
    expect(codes(checkTimetable([place({ day: '2026-11-03' })], dated()))).toEqual(['vacation']);
  });

  it('refuses a day off in its own branch only', () => {
    expect(codes(checkTimetable([place({ day: '2026-11-11' })], dated()))).toEqual(['day_off']);
    expect(codes(checkTimetable([place({ day: '2026-11-11', branchId: B })], dated()))).toEqual([]);
  });

  it('refuses a weekday that is not a school day, and a date with no template', () => {
    // Saturday is also outside the teacher's hours.
    expect(codes(checkTimetable([place({ day: '6' })], facts()))).toEqual([
      'not_working_day',
      'teacher_unavailable',
    ]);
    expect(
      codes(
        checkTimetable(
          [place({ day: '2026-11-12', classId: '1a', start: 480, end: 520 })],
          dated(),
        ),
      ),
    ).toEqual(['no_template']);
  });

  it('refuses a regular lesson in an exam week with no regular lessons, not an extra one or an exam', () => {
    expect(codes(checkTimetable([place({ day: '2026-12-21' })], dated()))).toEqual(['exam_week']);
    expect(codes(checkTimetable([place({ day: '2026-12-21', extra: true })], dated()))).toEqual([]);
    expect(codes(checkTimetable([exam({ day: '2026-12-21' })], dated()))).toEqual([]);
  });

  it('refuses a lesson that is not exactly one lesson slot', () => {
    expect(codes(checkTimetable([place({ start: 480, end: 570 })], facts()))).toEqual([
      'not_a_slot',
    ]);
    expect(codes(checkTimetable([place({ start: 575, end: 595 })], facts()))).toEqual([
      'break_slot',
    ]);
    expect(codes(checkTimetable([place({ start: 485, end: 530 })], facts()))).toEqual([
      'not_a_slot',
    ]);
  });

  it('leaves an exam over two slots and their break out of the one-slot rule', () => {
    expect(codes(checkTimetable([exam({ start: L2.start, end: L3.end })], facts()))).toEqual([]);
  });

  it('refuses a two-grade group lesson where one template has other times', () => {
    const pe = (extra: Partial<Placement>) =>
      place({
        classId: null,
        groupId: 'pe910',
        classIds: ['9a', '10a'],
        studentIds: ['n1', 'n2', 'm1', 'm2'],
        subjectId: 'english',
        ...extra,
      });
    expect(codes(checkTimetable([pe({ ...L1 })], facts()))).toEqual([]);
    expect(codes(checkTimetable([pe({ ...L2 })], facts()))).toEqual(['two_grade_slot']);
  });

  it('refuses a double pair not in consecutive slots or not with one teacher and room', () => {
    const pair = (second: Partial<Placement>) => [
      place({ id: 'a', doublePairId: 'dp', blockId: 'b1' }),
      place({ id: 'b', doublePairId: 'dp', blockId: 'b2', ...L2, ...second }),
    ];
    const subjectTwice = (results: RuleResult[]) =>
      codes(results).filter((code) => code !== 'subject_twice' && code !== 'class_free_period');
    expect(codes(checkTimetable(pair({}), facts()))).toEqual([]);
    expect(subjectTwice(checkTimetable(pair({ ...L3 }), facts()))).toEqual(['double_apart']);
    expect(subjectTwice(checkTimetable(pair({ roomId: 'r2' }), facts()))).toEqual(['double_apart']);
    expect(subjectTwice(checkTimetable(pair({ teacherIds: ['t2'] }), facts()))).toEqual([
      'double_apart',
    ]);
  });
});

describe('the teacher, the subject and the room', () => {
  it('refuses a teacher without the subject, or without the grade', () => {
    const narrow = teacher('t9', { subjects: [{ subjectId: 'math', grades: [5, 6] }] });
    const f = facts({ teachers: new Map([['t9', narrow]]) });
    expect(codes(checkTimetable([place({ teacherIds: ['t9'] })], f))).toEqual(['teacher_grade']);
    expect(codes(checkTimetable([place({ teacherIds: ['t9'], subjectId: 'english' })], f))).toEqual(
      ['teacher_subject'],
    );
  });

  it('refuses a teacher who cannot teach in the language, unless the subject is outside the rule', () => {
    const uzbekOnly = teacher('t9', { languages: ['uz'] });
    const f = facts({ teachers: new Map([['t9', uzbekOnly]]) });
    expect(codes(checkTimetable([place({ teacherIds: ['t9'], classId: '7ru' })], f))).toEqual([
      'teacher_language',
    ]);
    expect(
      codes(
        checkTimetable([place({ teacherIds: ['t9'], classId: '7ru', subjectId: 'english' })], f),
      ),
    ).toEqual([]);
  });

  it('refuses an inactive teacher, one outside the branch, an inactive subject and a closed room', () => {
    const f = facts({
      teachers: new Map([
        ['gone', teacher('gone', { out: true })],
        ['away', teacher('away', { branchIds: [B] })],
      ]),
    });
    expect(codes(checkTimetable([place({ teacherIds: ['gone'] })], f))).toEqual([
      'teacher_inactive',
    ]);
    expect(codes(checkTimetable([place({ teacherIds: ['away'] })], f))).toEqual(['teacher_branch']);
    expect(codes(checkTimetable([place({ subjectId: 'old' })], facts()))).toContain(
      'subject_inactive',
    );
    expect(codes(checkTimetable([place({ roomId: 'closed' })], facts()))).toEqual([
      'room_inactive',
    ]);
  });

  it('warns on a room under repair, never blocks (review correction 4)', () => {
    const results = checkTimetable([place({ roomId: 'repair' })], facts());
    expect(results).toEqual([
      expect.objectContaining({ rule: 'room_under_repair', severity: 'warning' }),
    ]);
  });

  it('lets a Tutor take a Tutor subject of the class without the profile row', () => {
    const f = facts({
      subjects: new Map([
        ['homework', { id: 'homework', active: true, languageRule: false, tutorSubject: true }],
      ]),
      units: new Map([['7a', { ...unit('7a', 'class', [7]), tutorStaffIds: ['t1'] }]]),
    });
    expect(codes(checkTimetable([place({ subjectId: 'homework' })], f))).toEqual([]);
  });

  it('binds a vacancy by every blocked rule that binds a teacher (06, the vacancy row)', () => {
    const vacancy = teacher('vac', {
      vacancy: true,
      languages: ['uz'],
      subjects: [{ subjectId: 'math', grades: [7] }],
      availability: [
        { branchId: A, validFrom: '2026-09-01', validUntil: null, ranges: week(480, 600) },
      ],
      branchIds: [A],
    });
    const f = facts({ teachers: new Map([['vac', vacancy]]) });
    expect(codes(checkTimetable([place({ teacherIds: ['vac'] })], f))).toEqual([]);
    expect(codes(checkTimetable([place({ teacherIds: ['vac'], classId: '9a' })], f))).toEqual([
      'teacher_grade',
    ]);
    expect(codes(checkTimetable([place({ teacherIds: ['vac'], classId: '7ru' })], f))).toEqual([
      'teacher_language',
    ]);
    expect(codes(checkTimetable([place({ teacherIds: ['vac'], ...L4 })], f))).toEqual([
      'teacher_unavailable',
    ]);
    expect(codes(checkTimetable([place({ teacherIds: ['vac'], branchId: B })], f))).toContain(
      'teacher_branch',
    );
  });

  it('refuses a vacancy as a substitute, and warns on a substitute without the language', () => {
    const uzbekOnly = teacher('t9', { languages: ['uz'] });
    const f = facts({
      teachers: new Map([
        ['t9', uzbekOnly],
        ['vac', teacher('vac', { vacancy: true })],
      ]),
    });
    expect(codes(checkTimetable([place({ teacherIds: ['vac'], substitute: true })], f))).toEqual([
      'substitute_vacancy',
    ]);
    expect(
      checkTimetable([place({ teacherIds: ['t9'], classId: '7ru', substitute: true })], f),
    ).toEqual([expect.objectContaining({ rule: 'substitute_language', severity: 'warning' })]);
  });

  it('turns subject, grade and availability of a substitute into warnings when no teacher of the subject is free; double booking and other lessons stay blocked', () => {
    const narrow = teacher('t9', {
      subjects: [{ subjectId: 'english', grades: [5] }],
      availability: [
        { branchId: A, validFrom: '2026-09-01', validUntil: null, ranges: week(600, 900) },
      ],
    });
    const f = facts({
      mode: 'dated',
      teachers: new Map([
        ['t9', narrow],
        ['t1', teacher('t1')],
      ]),
    });
    const day = '2026-11-10';
    const placements = [
      // A substitute without the subject, before the teacher's hours.
      place({ id: 'a', day, teacherIds: ['t9'], substitute: true }),
      // A substitute with the subject in other grades, before the teacher's hours.
      place({
        id: 'c',
        day,
        teacherIds: ['t9'],
        classId: '9a',
        roomId: 'r2',
        subjectId: 'english',
        substitute: true,
        ...L3,
      }),
      // The teacher's own lesson at the substitute's time: not a one-day change.
      place({
        id: 'b',
        day,
        teacherIds: ['t9'],
        classId: '10a',
        roomId: 'small',
        subjectId: 'english',
      }),
    ];
    const view = (results: RuleResult[]) =>
      results.map((one) => `${one.severity} ${one.rule} ${one.lessonIds.join('+')}`);
    expect(view(checkTimetable(placements, f))).toEqual([
      'blocked teacher_double a+b',
      'blocked teacher_subject a',
      'blocked teacher_grade b',
      'blocked teacher_grade c',
      'blocked teacher_unavailable a',
      'blocked teacher_unavailable b',
      'blocked teacher_unavailable c',
    ]);
    expect(view(checkTimetable(placements, f, { noSubjectTeacherFree: true }))).toEqual([
      'blocked teacher_double a+b',
      'warning teacher_subject a',
      'blocked teacher_grade b',
      'warning teacher_grade c',
      'warning teacher_unavailable a',
      'blocked teacher_unavailable b',
      'warning teacher_unavailable c',
    ]);
    // A pattern has no one-day change: nothing is relaxed there.
    const pattern = placements.map((one) => ({ ...one, day: '2' }));
    expect(
      checkTimetable(pattern, { ...f, mode: 'pattern' }, { noSubjectTeacherFree: true }).every(
        (one) => one.severity === 'blocked',
      ),
    ).toBe(true);
  });

  it('reads availability in force on the start date of a pattern, and lists later entries by date', () => {
    // Fridays end at 10:00 from 7 December (edge/timetable, "A part-time teacher stops working Fridays").
    const partTime = teacher('t9', {
      availability: [
        { branchId: A, validFrom: '2026-09-01', validUntil: '2026-12-07', ranges: week(480, 900) },
        {
          branchId: A,
          validFrom: '2026-12-07',
          validUntil: null,
          ranges: week(480, 900).filter((one) => one.weekday !== 5),
        },
      ],
    });
    const f = facts({ teachers: new Map([['t9', partTime]]) });
    expect(codes(checkTimetable([place({ teacherIds: ['t9'], day: '1' })], f))).toEqual([]);
    expect(checkTimetable([place({ teacherIds: ['t9'], day: '5' })], f)).toEqual([
      expect.objectContaining({
        rule: 'teacher_unavailable_later',
        severity: 'warning',
        detail: { date: '2026-12-11' },
      }),
    ]);
    // Bounded by the version's end: a version that ends before then has no warning.
    expect(
      codes(
        checkTimetable([place({ teacherIds: ['t9'], day: '5' })], {
          ...f,
          versionEnd: '2026-12-06',
        }),
      ),
    ).toEqual([]);
    // From the start date on, the later entry is the one in force.
    expect(
      codes(
        checkTimetable([place({ teacherIds: ['t9'], day: '5' })], {
          ...f,
          startDate: '2026-12-07',
        }),
      ),
    ).toEqual(['teacher_unavailable']);
  });

  it('refuses a teacher with no hours in the lesson branch, or outside them', () => {
    const f = facts({
      teachers: new Map([
        [
          't9',
          teacher('t9', {
            availability: [
              { branchId: B, validFrom: '2026-09-01', validUntil: null, ranges: week(480, 900) },
            ],
          }),
        ],
      ]),
    });
    expect(codes(checkTimetable([place({ teacherIds: ['t9'] })], f))).toEqual([
      'teacher_unavailable',
    ]);
  });

  it('checks invigilators: a vacancy and an inactive one are refused, availability and subject warn', () => {
    const f = facts({
      teachers: new Map([
        ['vac', teacher('vac', { vacancy: true })],
        ['gone', teacher('gone', { out: true })],
        [
          'late',
          teacher('late', {
            subjects: [],
            availability: [
              { branchId: A, validFrom: '2026-09-01', validUntil: null, ranges: week(600, 900) },
            ],
          }),
        ],
        ['t2', teacher('t2')],
      ]),
    });
    expect(codes(checkTimetable([exam()], f))).toEqual([]);
    expect(codes(checkTimetable([exam({ teacherIds: ['vac'] })], f))).toEqual([
      'invigilator_vacancy',
    ]);
    expect(codes(checkTimetable([exam({ teacherIds: ['gone'] })], f))).toEqual([
      'invigilator_inactive',
    ]);
    expect(checkTimetable([exam({ teacherIds: ['late'] })], f)).toEqual([
      expect.objectContaining({ rule: 'invigilator_unavailable', severity: 'warning' }),
      expect.objectContaining({ rule: 'invigilator_subject', severity: 'warning' }),
    ]);
  });
});

describe('travel time', () => {
  const twoBranches = (gap: number, minutes: number | null) =>
    checkTimetable(
      [
        place({ id: 'a', ...L1 }),
        place({ id: 'b', branchId: B, classId: '7b', start: L1.end + gap, end: L1.end + gap + 45 }),
      ],
      facts({
        travelMinutes: () => minutes,
        dayOf: () => ({ lessons: true, day: SENIOR, noRegularLessons: false }),
      }),
    ).filter((one) => one.rule.startsWith('travel'));

  it('allows exactly the travel time and refuses one minute less', () => {
    expect(twoBranches(30, 30)).toEqual([]);
    expect(twoBranches(29, 30)).toEqual([
      {
        rule: 'travel_time',
        severity: 'blocked',
        day: '1',
        lessonIds: ['a', 'b'],
        detail: { minutes: 30, gap: 29 },
      },
    ]);
  });

  it('refuses two branches with no travel time set, whatever the gap (decision 1)', () => {
    expect(twoBranches(180, null).map((one) => one.rule)).toEqual(['travel_time_not_set']);
  });

  it('compares a lesson with the next one only', () => {
    // a (A) at L1, b (A) at L2, c (B) at L4: only b and c are neighbours.
    const results = checkTimetable(
      [
        place({ id: 'a', ...L1 }),
        place({ id: 'b', classId: '7b', roomId: 'r2', ...L2 }),
        place({ id: 'c', branchId: B, classId: '9a', ...L4 }),
      ],
      facts({ travelMinutes: () => 90 }),
    );
    expect(only(results, 'travel_time').map((one) => one.lessonIds)).toEqual([['b', 'c']]);
  });

  it('compares the next lesson with the one that ends last before it, not only the one that starts last', () => {
    // An exam in branch A until 10:40 holds a lesson of A inside it; the lesson
    // in branch B at 10:45 is 5 minutes after the exam, not 70 after the lesson.
    const results = checkTimetable(
      [
        exam({ id: 'x', teacherIds: ['t1'], start: L1.start, end: L3.end }),
        place({ id: 'a', classId: '9a', roomId: 'small', ...L2 }),
        place({ id: 'b', branchId: B, classId: '10a', start: L4.start, end: L4.end }),
      ],
      facts({ travelMinutes: () => 30 }),
    );
    expect(only(results, 'travel_time').map((one) => one.lessonIds)).toEqual([['x', 'b']]);
  });

  it('counts an invigilation and a busy-elsewhere lesson (decision 15)', () => {
    const results = checkTimetable(
      [
        exam({ id: 'x', teacherIds: ['t1'], start: L1.start, end: L2.end }),
        place({ id: 'f', branchId: B, classId: '9a', ...L3, fixed: true }),
      ],
      facts({ travelMinutes: () => 30 }),
    );
    expect(only(results, 'travel_time').map((one) => one.lessonIds)).toEqual([['x', 'f']]);
  });

  it('reports nothing that only busy-elsewhere lessons hold', () => {
    const results = checkTimetable(
      [
        place({ id: 'f', branchId: B, classId: '9a', fixed: true, subjectId: 'old' }),
        place({ id: 'g', branchId: B, classId: '10a', fixed: true, roomId: 'r2' }),
      ],
      facts(),
    );
    expect(results).toEqual([]);
  });
});

describe('warnings', () => {
  it('warns on a room smaller than the class, and an exam room smaller than its classes', () => {
    expect(codes(checkTimetable([place({ roomId: 'small' })], facts()))).toEqual(['room_capacity']);
    expect(codes(checkTimetable([place({ classId: '7b', roomId: 'small' })], facts()))).toEqual([]);
    expect(
      checkTimetable([exam({ examRooms: [{ roomId: 'small', students: 4 }] })], facts()),
    ).toEqual([expect.objectContaining({ rule: 'room_capacity', severity: 'warning' })]);
  });

  it('warns on a teacher over the contract load across branches, exams not counted', () => {
    const f = facts({ teachers: new Map([['t1', teacher('t1', { weeklyLessons: 2 })]]) });
    const two = [
      place({ id: 'a', day: '1' }),
      place({ id: 'b', day: '2', branchId: B }),
      exam({ id: 'x', day: '3', teacherIds: ['t1'] }),
    ];
    expect(codes(checkTimetable(two, f))).not.toContain('teacher_week_load');
    const three = [...two, place({ id: 'c', day: '4' })];
    expect(only(checkTimetable(three, f), 'teacher_week_load')[0]).toMatchObject({
      severity: 'warning',
      day: '',
      detail: { lessons: 3, limit: 2 },
    });
  });

  it('warns on a teacher over most lessons per day', () => {
    const f = facts({ teachers: new Map([['t1', teacher('t1', { dailyLessons: 1 })]]) });
    expect(codes(checkTimetable([place({ id: 'a' })], f))).toEqual([]);
    expect(
      codes(checkTimetable([place({ id: 'a' }), place({ id: 'b', classId: '7b', ...L3 })], f)),
    ).toEqual(['teacher_day_load']);
  });

  it('warns on a class over the daily maximum, counting a split block once', () => {
    const split = [
      place({
        id: 'a',
        classId: null,
        groupId: '7m1',
        classIds: ['7a', '7b'],
        studentIds: ['s1', 's2', 's5'],
        blockId: 'blk',
        subjectId: 'english',
      }),
      place({
        id: 'b',
        classId: null,
        groupId: '7m2',
        classIds: ['7a', '7b'],
        studentIds: ['s3', 's4', 's6'],
        blockId: 'blk',
        teacherIds: ['t2'],
        roomId: 'r2',
        subjectId: 'english',
      }),
    ];
    const one = facts({ classDailyLessons: () => 1 });
    expect(codes(checkTimetable(split, one))).toEqual([]);
    const more = [...split, place({ id: 'c', classId: '7a', ...L2 })];
    expect(only(checkTimetable(more, one), 'class_day_load')[0]).toMatchObject({
      severity: 'warning',
      detail: { classId: '7a', lessons: 2, limit: 1 },
    });
    expect(codes(checkTimetable(more, facts()))).not.toContain('class_day_load');
  });

  it('warns on a subject twice in a day, counting a double pair once', () => {
    const pair = [
      place({ id: 'a', doublePairId: 'dp' }),
      place({ id: 'b', doublePairId: 'dp', ...L2 }),
    ];
    expect(codes(checkTimetable(pair, facts()))).toEqual([]);
    expect(
      codes(checkTimetable([place({ id: 'a' }), place({ id: 'b', ...L3 })], facts())),
    ).toContain('subject_twice');
  });

  it('warns on a free period in the middle of a class day, not at its ends', () => {
    expect(
      codes(
        checkTimetable(
          [place({ id: 'a', ...L2 }), place({ id: 'b', ...L3, subjectId: 'english' })],
          facts(),
        ),
      ),
    ).toEqual([]);
    expect(
      only(
        checkTimetable(
          [place({ id: 'a' }), place({ id: 'b', ...L3, subjectId: 'english' })],
          facts(),
        ),
        'class_free_period',
      )[0],
    ).toMatchObject({
      severity: 'warning',
      detail: { classId: '7a', start: L2.start, end: L2.end },
    });
  });

  it('warns when the lessons placed differ from the load, unless deliberately short', () => {
    const rows = [
      { id: 'row1', lessonsPerWeek: 2, deliberatelyShort: false },
      { id: 'row2', lessonsPerWeek: 2, deliberatelyShort: true },
    ];
    const placements = [
      place({ id: 'a', loadRowId: 'row1' }),
      place({ id: 'b', loadRowId: 'row1', day: '2' }),
      place({ id: 'c', loadRowId: 'row2', day: '3', classId: '7b' }),
    ];
    expect(codes(checkTimetable(placements, facts({ loadRows: rows })))).toEqual([]);
    const missing = only(
      checkTimetable(placements.slice(1), facts({ loadRows: rows })),
      'load_mismatch',
    );
    expect(missing).toEqual([
      expect.objectContaining({
        severity: 'warning',
        detail: { loadRowId: 'row1', placed: 1, lessonsPerWeek: 2 },
      }),
    ]);
    // More lessons than the load warns, also on a deliberately short row.
    const extra = [
      ...placements,
      place({ id: 'd', loadRowId: 'row2', day: '4', classId: '7b' }),
      place({ id: 'e', loadRowId: 'row2', day: '5', classId: '7b' }),
    ];
    expect(only(checkTimetable(extra, facts({ loadRows: rows })), 'load_mismatch')).toHaveLength(1);
  });

  it('warns when the teacher is also placed at that time in a draft of another branch', () => {
    const other = place({ id: 'o', branchId: B, classId: '9a' });
    expect(checkTimetable([place({ id: 'a' })], facts({ otherDrafts: [other] }))).toEqual([
      expect.objectContaining({ rule: 'other_draft', severity: 'warning', lessonIds: ['a', 'o'] }),
    ]);
    expect(
      codes(checkTimetable([place({ id: 'a', ...L3 })], facts({ otherDrafts: [other] }))),
    ).toEqual([]);
  });
});

describe('missing facts', () => {
  // A caller that leaves out a fact gets a fault, never a free slot (spec review should-fix 1).
  it.each([
    ['teacher', { teacherIds: ['nobody'] }],
    ['class or group', { classId: 'nowhere', classIds: ['nowhere'] }],
    ['subject', { subjectId: 'nothing' }],
    ['room', { roomId: 'nowhere' }],
  ] as const)('throws for an unknown %s', (kind, extra) => {
    expect(() => checkTimetable([place(extra)], facts())).toThrow(`no ${kind}`);
  });
});

describe('a candidate and its slot', () => {
  it('returns only the results that name the candidate, and the slot status', () => {
    const placements = [
      place({ id: 'a' }),
      place({ id: 'b', teacherIds: ['t2'], classId: '7b' }),
      place({ id: 'c', classId: '9a', teacherIds: ['t3'], roomId: 'r2', ...L2 }),
    ];
    const blocked = checkCandidate(
      placements,
      facts(),
      place({
        id: 'd',
        classId: '7b',
        teacherIds: ['t3'],
        roomId: 'small',
        subjectId: 'english',
        ...L2,
      }),
    );
    expect(codes(blocked)).toEqual(['teacher_double']);
    expect(slotStatus(blocked)).toBe('blocked');
    const warned = checkCandidate(
      placements,
      facts(),
      place({ id: 'd', classId: '7a', teacherIds: ['t3'], roomId: 'small', ...L3 }),
    );
    expect(slotStatus(warned)).toBe('warning');
    expect(
      slotStatus(
        checkCandidate(
          placements,
          facts(),
          place({
            id: 'd',
            classId: '9a',
            teacherIds: ['t3'],
            roomId: 'r2',
            subjectId: 'english',
            ...L3,
          }),
        ),
      ),
    ).toBe('free');
  });

  it('moves a placement: the candidate replaces the one with its id', () => {
    const placements = [place({ id: 'a' }), place({ id: 'b', classId: '7b', ...L3 })];
    expect(checkCandidate(placements, facts(), place({ id: 'b', classId: '7b', ...L1 }))).toEqual([
      expect.objectContaining({ rule: 'teacher_double', lessonIds: ['a', 'b'] }),
      expect.objectContaining({ rule: 'room_double', lessonIds: ['a', 'b'] }),
    ]);
  });

  it('reports in the order of the rules, stable for any input order', () => {
    const placements = [
      place({ id: 'a', roomId: 'small' }),
      place({ id: 'b', classId: '7b' }),
      place({ id: 'c', day: '6' }),
    ];
    const forward = checkTimetable(placements, facts());
    const backward = checkTimetable([...placements].reverse(), facts());
    expect(backward).toEqual(forward);
    expect(codes(forward)).toEqual([
      'teacher_double',
      'not_working_day',
      'teacher_unavailable',
      'room_capacity',
    ]);
  });
});

describe('the sweep against all pairs (plan finding 10)', () => {
  const arbitraryPlacement = fc.record({
    day: fc.constantFrom('1', '2'),
    start: fc.integer({ min: 480, max: 700 }),
    length: fc.integer({ min: 1, max: 90 }),
    teacher: fc.constantFrom('t1', 't2', 't3'),
    room: fc.constantFrom('r1', 'r2'),
    classes: fc.subarray(['7a', '7b', '9a']),
    students: fc.subarray(['s1', 's2', 's3', 's4']),
  });

  const key = (pairs: [Placement, Placement][]) =>
    pairs.map(([a, b]) => [a.id, b.id].sort().join('+')).sort();

  it('finds exactly the overlapping pairs of each resource', () => {
    fc.assert(
      fc.property(fc.array(arbitraryPlacement, { maxLength: 25 }), (rows) => {
        const placements = rows.map((row, index) =>
          place({
            id: `q${String(index).padStart(2, '0')}`,
            day: row.day,
            start: row.start,
            end: row.start + row.length,
            teacherIds: [row.teacher],
            roomId: row.room,
            classIds: row.classes,
            studentIds: row.students,
          }),
        );
        const resources: ((one: Placement) => readonly string[])[] = [
          (one) => one.teacherIds,
          (one) => (one.roomId === null ? [] : [one.roomId]),
          (one) => one.classIds,
          (one) => one.studentIds,
        ];
        for (const resource of resources) {
          const all: [Placement, Placement][] = [];
          placements.forEach((a, i) => {
            placements.slice(i + 1).forEach((b) => {
              const shared = resource(a).filter((id) => resource(b).includes(id));
              for (let n = 0; n < new Set(shared).size; n += 1) {
                if (a.day === b.day && a.start < b.end && b.start < a.end) all.push([a, b]);
              }
            });
          });
          expect(key(overlappingPairs(placements, resource))).toEqual(key(all));
        }
      }),
      { numRuns: 300 },
    );
  });
});
