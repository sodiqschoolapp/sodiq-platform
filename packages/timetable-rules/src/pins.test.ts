import { describe, expect, it } from 'vitest';
import { checkTimetable } from './check.js';
import { dayTimes, type Day, type DaySlotInput } from './day.js';
import type { EngineDay, EngineTeacher, EngineUnit, Facts, Placement } from './placement.js';
import { elsewherePlacement } from './facts-data.js';
import { pinnedPlacements, tutorPinClashes, type Pin, type PinRow, type PinSlot } from './pins.js';
import { rulesReadiness } from './readiness.js';
import type { RuleResult } from './rules.js';

// Task 5.3b-2: pinned lessons of step 5 (06, Building a timetable, step 5:
// "pins lessons that must stay at a fixed time (for example the Homework slot
// at the end of the day)"; edge/timetable, Generator and editing: "the locked
// and pinned lessons are checked on their own. A blocked conflict stops the
// run and lists the lessons."). Invented names only.

const lesson = (length: number): DaySlotInput => ({ kind: 'lesson', lengthMinutes: length });
const pause = (length: number): DaySlotInput => ({ kind: 'break', lengthMinutes: length });

// Grades 5–11: 45-minute lessons from 08:00. Position 1 08:00–08:45 (L1),
// 2 a break, 3 08:50–09:35 (L2), 4 a break, 5 09:55–10:40 (L3).
const SENIOR = dayTimes(480, [lesson(45), pause(5), lesson(45), pause(20), lesson(45)]);
// Grades 1–4: 40-minute lessons from 08:00: position 5 is 09:30–10:10, which
// meets position 3 of the seniors by clock time (edge/timetable, Structure).
const JUNIOR = dayTimes(480, [lesson(40), pause(5), lesson(40), pause(5), lesson(40)]);

const A = 'branch-a';

const STUDENTS: Record<string, string[]> = {
  '7a': ['s1', 's2', 's3', 's4'],
  '7b': ['s5', 's6'],
  '2a': ['j1', 'j2'],
};

// The groups of the split of 7a for English: 7a-e1 holds s1, s2; 7a-e2 s3, s4.
const GROUP_STUDENTS: Record<string, string[]> = { '7a-e1': ['s1', 's2'], '7a-e2': ['s3', 's4'] };

interface TestRow extends PinRow {
  readonly classId: string | null;
  readonly groupId: string | null;
  readonly teacherId: string;
  readonly subjectId: string;
  readonly roomId: string | null;
  readonly grade: number;
}

const row = (id: string, extra: Partial<TestRow> = {}): TestRow => ({
  id,
  lessonsPerWeek: 2,
  mixedBlock: false,
  block: [id],
  classId: '7a',
  groupId: null,
  teacherId: 't1',
  subjectId: 'math',
  roomId: null,
  grade: 7,
  ...extra,
});

const ROWS: TestRow[] = [
  row('math-7a'),
  row('math-7b', { classId: '7b', teacherId: 't2' }),
  // A block of two group rows of 7a, one lesson a week each.
  row('eng-e1', {
    classId: null,
    groupId: '7a-e1',
    subjectId: 'english',
    teacherId: 't3',
    lessonsPerWeek: 1,
    block: ['eng-e1', 'eng-e2'],
  }),
  row('eng-e2', {
    classId: null,
    groupId: '7a-e2',
    subjectId: 'english',
    teacherId: 't4',
    lessonsPerWeek: 1,
    block: ['eng-e1', 'eng-e2'],
  }),
  // A mixed split: its halves meet in different slots (3.4b decision 12).
  row('pe-boys', {
    classId: null,
    groupId: '7a-e1',
    subjectId: 'pe',
    teacherId: 't5',
    mixedBlock: true,
    block: ['pe-boys', 'pe-girls'],
  }),
  // Homework slots of two classes with one Tutor (edge/timetable, Structure).
  row('hw-7a', { subjectId: 'homework', teacherId: 'tutor' }),
  row('hw-7b', { classId: '7b', subjectId: 'homework', teacherId: 'tutor' }),
  row('hw-2a', { classId: '2a', subjectId: 'homework', teacherId: 'tutor2', grade: 2 }),
  // A grade-2 lesson by t1, to meet a senior lesson by clock time.
  row('math-2a', { classId: '2a', grade: 2 }),
  row('math-7a-r', { roomId: 'lab', teacherId: 't6' }),
  row('math-7b-r', { classId: '7b', roomId: 'lab', teacherId: 't7' }),
];

const ROW_MAP = new Map<string, TestRow>(ROWS.map((one) => [one.id, one]));

const dayFor = (rowId: string, weekday: number): Day | null => {
  if (weekday > 5) return null;
  return (ROW_MAP.get(rowId)?.grade ?? 7) <= 4 ? JUNIOR : SENIOR;
};

function placementOf(rowId: string, slot: PinSlot): Placement {
  const one = ROW_MAP.get(rowId);
  if (one === undefined) throw new Error(rowId);
  const classIds = one.classId !== null ? [one.classId] : ['7a'];
  return {
    id: slot.id,
    kind: 'lesson',
    branchId: A,
    day: String(slot.weekday),
    start: slot.start,
    end: slot.end,
    blockId: slot.blockId,
    doublePairId: null,
    classId: one.classId,
    groupId: one.groupId,
    classIds,
    studentIds:
      one.classId !== null
        ? (STUDENTS[one.classId] ?? [])
        : (GROUP_STUDENTS[one.groupId ?? ''] ?? []),
    exemptStudentIds: [],
    subjectId: one.subjectId,
    loadRowId: one.id,
    teacherIds: [one.teacherId],
    substitute: false,
    roomId: one.roomId,
    examRooms: [],
    fixed: false,
  };
}

const pin = (id: string, loadRowId: string, weekday: number, slotPosition: number): Pin => ({
  id,
  loadRowId,
  weekday,
  slotPosition,
});

const pinned = (pins: Pin[]) =>
  pinnedPlacements({ pins, rows: ROW_MAP, day: dayFor, placement: placementOf });

const teacher = (id: string): EngineTeacher => ({
  id,
  vacancy: false,
  out: false,
  branchIds: [A],
  subjects: ['math', 'english', 'pe', 'homework'].map((subjectId) => ({
    subjectId,
    grades: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  })),
  languages: ['uz'],
  availability: [
    {
      branchId: A,
      validFrom: '2026-09-01',
      validUntil: null,
      ranges: [1, 2, 3, 4, 5].map((weekday) => ({ weekday, start: 480, end: 900 })),
    },
  ],
  weeklyLessons: null,
  dailyLessons: null,
});

const unit = (id: string, kind: 'class' | 'group', grade: number): EngineUnit => ({
  id,
  kind,
  grades: [grade],
  language: 'uz',
  tutorOnStart: null,
});

function facts(): Facts {
  const dayOf = (_branchId: string, grade: number, day: string): EngineDay =>
    Number(day) > 5
      ? { lessons: false, reason: 'not_working_day' }
      : { lessons: true, day: grade <= 4 ? JUNIOR : SENIOR, noRegularLessons: false };
  return {
    mode: 'pattern',
    startDate: '2026-11-09',
    versionEnd: '2026-12-27',
    teachers: new Map(
      ['t1', 't2', 't3', 't4', 't5', 't6', 't7', 'tutor', 'tutor2'].map((id) => [id, teacher(id)]),
    ),
    subjects: new Map(
      ['math', 'english', 'pe', 'homework'].map((id) => [
        id,
        { id, active: true, languageRule: false, tutorSubject: id === 'homework' },
      ]),
    ),
    rooms: new Map([
      ['lab', { id: 'lab', status: 'in_use', shared: false, lessonsAtOnce: 1, capacity: 30 }],
    ]),
    units: new Map(
      [
        unit('7a', 'class', 7),
        unit('7b', 'class', 7),
        unit('2a', 'class', 2),
        unit('7a-e1', 'group', 7),
        unit('7a-e2', 'group', 7),
      ].map((one) => [one.id, one]),
    ),
    classStudents: (classId) => STUDENTS[classId] ?? [],
    dayOf,
    years: new Map(),
    travelMinutes: () => 30,
    classDailyLessons: () => null,
    loadRows: [],
    otherDrafts: [],
  };
}

const blocked = (results: readonly RuleResult[]) =>
  results.filter((result) => result.severity === 'blocked');

describe('pinnedPlacements', () => {
  it('places a class row at the times of its slot position', () => {
    const { placements, problems } = pinned([pin('p1', 'math-7a', 1, 5)]);
    expect(problems).toEqual([]);
    expect(placements).toHaveLength(1);
    expect(placements[0]).toMatchObject({ day: '1', start: 595, end: 640, loadRowId: 'math-7a' });
  });

  it('places every row of a block at the pin of one row, as one block', () => {
    const { placements } = pinned([pin('p1', 'eng-e1', 2, 3)]);
    expect(placements.map((one) => one.loadRowId).sort()).toEqual(['eng-e1', 'eng-e2']);
    expect(new Set(placements.map((one) => one.blockId)).size).toBe(1);
    expect(placements.every((one) => one.start === 530 && one.end === 575)).toBe(true);
    expect(blocked(checkTimetable(placements, facts()))).toEqual([]);
  });

  it('places a block once when two of its rows are pinned to one slot', () => {
    const { placements, problems } = pinned([pin('p1', 'eng-e1', 2, 3), pin('p2', 'eng-e2', 2, 3)]);
    expect(placements).toHaveLength(2);
    expect(problems).toEqual([]);
  });

  it('counts the pinned slots of a block over all its rows against the lessons per week', () => {
    const { problems } = pinned([pin('p1', 'eng-e1', 1, 3), pin('p2', 'eng-e2', 2, 1)]);
    expect(problems).toEqual([
      { pinId: 'p1', problem: 'pin_over_load' },
      { pinId: 'p2', problem: 'pin_over_load' },
    ]);
  });

  it('allows as many pinned slots as the lessons per week', () => {
    const { problems } = pinned([pin('p1', 'math-7a', 1, 1), pin('p2', 'math-7a', 2, 1)]);
    expect(problems).toEqual([]);
  });

  it('does not place a row marked mixed block and names it', () => {
    const { placements, problems } = pinned([pin('p1', 'pe-boys', 1, 1)]);
    expect(placements).toEqual([]);
    expect(problems).toEqual([{ pinId: 'p1', problem: 'pin_mixed_block' }]);
  });

  it('gives pin_no_slot for a weekday with no lessons and a position past the day', () => {
    const { placements, problems } = pinned([
      pin('p1', 'math-7a', 6, 1),
      pin('p2', 'math-7b', 1, 9),
    ]);
    expect(placements).toEqual([]);
    expect(problems).toEqual([
      { pinId: 'p1', problem: 'pin_no_slot' },
      { pinId: 'p2', problem: 'pin_no_slot' },
    ]);
  });

  it('places a break position, which the engine refuses as a break', () => {
    const { placements, problems } = pinned([pin('p1', 'math-7a', 1, 2)]);
    expect(problems).toEqual([]);
    expect(blocked(checkTimetable(placements, facts())).map((one) => one.rule)).toEqual([
      'break_slot',
    ]);
  });

  it('throws for a pin of a row it was not given', () => {
    expect(() => pinned([pin('p1', 'nobody', 1, 1)])).toThrow();
  });
});

describe('the pins checked on their own', () => {
  it('finds one teacher in two pins at one time and names both pins', () => {
    const set = pinned([pin('p1', 'math-7a', 1, 1), pin('p2', 'math-7a', 1, 1)]);
    // One row twice in one slot is one placement (decision of the unique key);
    // two rows of one teacher are a clash.
    expect(set.placements).toHaveLength(1);
    const clash = pinned([pin('p1', 'math-7a', 1, 1), pin('p3', 'math-2a', 1, 1)]);
    const results = blocked(checkTimetable(clash.placements, facts()));
    expect(results.map((one) => one.rule)).toEqual(['teacher_double']);
    expect(clash.pinsOf(results[0]?.lessonIds ?? [])).toEqual(['p1', 'p3']);
  });

  it('finds a clash by clock time across two templates, never by slot numbers', () => {
    // Senior position 3 is 08:50–09:35; junior position 5 is 09:30–10:10.
    const set = pinned([pin('p1', 'math-7a', 1, 3), pin('p2', 'math-2a', 1, 5)]);
    expect(blocked(checkTimetable(set.placements, facts())).map((one) => one.rule)).toEqual([
      'teacher_double',
    ]);
    const apart = pinned([pin('p1', 'math-7a', 1, 1), pin('p2', 'math-2a', 1, 5)]);
    expect(blocked(checkTimetable(apart.placements, facts()))).toEqual([]);
  });

  it('names the pin of a block row that has no pin of its own', () => {
    // t3 teaches eng-e1; the pin is on eng-e2, which places eng-e1 too.
    const t3 = row('math-7b-t3', { classId: '7b', teacherId: 't3' });
    const rows = new Map(ROW_MAP).set(t3.id, t3);
    const set = pinnedPlacements({
      pins: [pin('p1', 'eng-e2', 1, 1), pin('p2', 'math-7b-t3', 1, 1)],
      rows,
      day: dayFor,
      placement: (rowId, slot) =>
        rowId === t3.id
          ? { ...placementOf('math-7b', slot), loadRowId: t3.id, teacherIds: ['t3'] }
          : placementOf(rowId, slot),
    });
    const results = blocked(checkTimetable(set.placements, facts()));
    expect(results.map((one) => one.rule)).toEqual(['teacher_double']);
    expect(set.pinsOf(results[0]?.lessonIds ?? [])).toEqual(['p1', 'p2']);
  });

  it('finds two pins in one named room', () => {
    const set = pinned([pin('p1', 'math-7a-r', 3, 1), pin('p2', 'math-7b-r', 3, 1)]);
    expect(blocked(checkTimetable(set.placements, facts())).map((one) => one.rule)).toEqual([
      'room_double',
    ]);
  });
});

describe('tutorPinClashes', () => {
  const tutorRow = (rowId: string) => ROW_MAP.get(rowId)?.subjectId === 'homework';

  it('lists a Tutor of two classes whose pinned lessons fall at the same time', () => {
    const set = pinned([pin('p1', 'hw-7a', 5, 5), pin('p2', 'hw-7b', 5, 5)]);
    const results = checkTimetable(set.placements, facts());
    const clashes = tutorPinClashes(results, set.placements, tutorRow);
    expect(clashes).toHaveLength(1);
    expect(set.pinsOf(clashes[0]?.lessonIds ?? [])).toEqual(['p1', 'p2']);
  });

  it('lists nothing for the two classes pinned at two times', () => {
    const set = pinned([pin('p1', 'hw-7a', 5, 5), pin('p2', 'hw-7b', 4, 5)]);
    expect(
      tutorPinClashes(checkTimetable(set.placements, facts()), set.placements, tutorRow),
    ).toEqual([]);
  });

  it('lists a Tutor whose pinned lesson meets a Tutor lesson in another branch, and not another lesson there', () => {
    const set = pinned([pin('p1', 'hw-7a', 5, 5)]);
    const [hw] = set.placements;
    if (hw === undefined) throw new Error('no pinned lesson');
    const elsewhere = elsewherePlacement(
      {
        id: 'south-hw',
        teacherId: hw.teacherIds[0] ?? '',
        branchId: 'branch-south',
        weekday: 5,
        start: hw.start,
        end: hw.end,
      },
      true,
    );
    const all = [...set.placements, elsewhere];
    const results = checkTimetable(all, facts());
    const clashes = tutorPinClashes(results, all, tutorRow, new Set(['south-hw']));
    expect(clashes).toHaveLength(1);
    expect(set.pinsOf(clashes[0]?.lessonIds ?? [])).toEqual(['p1']);
    expect(tutorPinClashes(results, all, tutorRow)).toEqual([]);
  });

  it('lists no clash of a teacher who is not a Tutor of both', () => {
    const set = pinned([pin('p1', 'math-7a', 1, 1), pin('p2', 'math-2a', 1, 1)]);
    expect(
      tutorPinClashes(checkTimetable(set.placements, facts()), set.placements, tutorRow),
    ).toEqual([]);
  });
});

describe('rulesReadiness with pins', () => {
  const weights = {
    class_no_gaps: 5,
    teacher_few_gaps: 5,
    subject_spread: 5,
    demanding_early: 5,
    class_even_days: 5,
    main_room: 5,
    part_time_few_days: 5,
    teacher_preferred_times: 5,
  };
  const clash: RuleResult = {
    rule: 'teacher_double',
    severity: 'blocked',
    day: '1',
    lessonIds: ['a', 'b'],
  };
  const warning: RuleResult = {
    rule: 'load_mismatch',
    severity: 'warning',
    day: '',
    lessonIds: ['a'],
  };
  const pins = (extra: Partial<Parameters<typeof rulesReadiness>[0]['pins'] & object> = {}) => ({
    ids: ['p1', 'p2'],
    confirmed: ['p1', 'p2'],
    results: [],
    problems: [],
    ...extra,
  });

  it('is ready when the weights and the pins are confirmed as they stand', () => {
    expect(rulesReadiness({ weights, confirmed: weights, pins: pins() })).toEqual({
      ready: true,
      confirmed: true,
      changed: [],
      pinsChanged: false,
      conflicts: [],
      problems: [],
    });
  });

  it('is not ready when a pin was added or removed since the confirmation', () => {
    for (const ids of [['p1', 'p2', 'p3'], ['p1'], ['p1', 'p4']]) {
      expect(rulesReadiness({ weights, confirmed: weights, pins: pins({ ids }) })).toMatchObject({
        ready: false,
        confirmed: false,
        pinsChanged: true,
      });
    }
  });

  it('reads the pins in any order', () => {
    expect(
      rulesReadiness({ weights, confirmed: weights, pins: pins({ ids: ['p2', 'p1'] }) }).ready,
    ).toBe(true);
  });

  it('is not ready while a blocked result stands, and lists it', () => {
    expect(
      rulesReadiness({ weights, confirmed: weights, pins: pins({ results: [clash, warning] }) }),
    ).toMatchObject({ ready: false, confirmed: true, conflicts: [clash] });
  });

  it('stays ready with warnings only, which it does not list', () => {
    expect(
      rulesReadiness({ weights, confirmed: weights, pins: pins({ results: [warning] }) }),
    ).toMatchObject({ ready: true, conflicts: [] });
  });

  it('is not ready while a pin problem stands', () => {
    const problems = [{ pinId: 'p1', problem: 'pin_no_slot' as const }];
    expect(rulesReadiness({ weights, confirmed: weights, pins: pins({ problems }) })).toMatchObject(
      { ready: false, confirmed: true, problems },
    );
  });

  it('names no pin change while never confirmed', () => {
    expect(
      rulesReadiness({ weights, confirmed: null, pins: pins({ confirmed: null }) }),
    ).toMatchObject({ ready: false, confirmed: false, pinsChanged: false });
  });

  it('reads a confirmation stored before pins existed as no pins', () => {
    expect(
      rulesReadiness({ weights, confirmed: weights, pins: pins({ ids: [], confirmed: [] }) }).ready,
    ).toBe(true);
    expect(
      rulesReadiness({ weights, confirmed: weights, pins: pins({ ids: ['p1'], confirmed: [] }) }),
    ).toMatchObject({ ready: false, pinsChanged: true });
  });
});
