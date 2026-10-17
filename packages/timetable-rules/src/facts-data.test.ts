import { describe, expect, it } from 'vitest';
import { checkCandidates, checkTimetable } from './check.js';
import { elsewherePlacement, factsFromData, patternModel } from './facts-data.js';
import { checkedPlacements } from './pattern-place.js';
import type { Facts, Placement } from './placement.js';
import { BRANCH, JUNIOR, patternData, SENIOR } from './testing/pattern-fixture.js';

// Task 5.4a, decision 2: the browser and the server check a move with one
// input, the pattern facts as data turned into `Facts` by `factsFromData`
// (14, Timetable, One rule engine: "The two can never disagree").

const data = patternData();
const model = patternModel(data);

const at = (id: string, rowId: string, weekday: number, slot: { start: number; end: number }) =>
  model.placementOf(model.rowOf(rowId), {
    id,
    blockId: `block-${id}`,
    weekday,
    start: slot.start,
    end: slot.end,
    roomId: null,
    doublePairId: null,
  });

const slot = (day: typeof SENIOR, position: number) => {
  const found = day.slots.find((one) => one.position === position);
  if (found === undefined) throw new Error(`no slot ${position}`);
  return found;
};

/** The same facts as the fixture's data, written out by hand as a caller of 5.2 builds them. */
function handFacts(): Facts {
  const students: Record<string, string[]> = {
    '7a': ['s1', 's2', 's3', 's4'],
    '7b': ['s5', 's6'],
    '2a': ['j1', 'j2'],
  };
  return {
    mode: 'pattern',
    startDate: data.startDate,
    versionEnd: data.versionEnd,
    teachers: new Map(data.teachers.map((one) => [one.id, one])),
    subjects: new Map(data.subjects.map((one) => [one.id, one])),
    rooms: new Map(data.rooms.map((one) => [one.id, one])),
    units: new Map(
      data.units.map((one) => [
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
    classStudents: (classId) => students[classId] ?? [],
    dayOf: (_branch, grade, day) =>
      Number(day) > 5
        ? { lessons: false, reason: 'not_working_day' }
        : { lessons: true, day: grade <= 4 ? JUNIOR : SENIOR, noRegularLessons: false },
    years: new Map([[BRANCH, data.year]]),
    travelMinutes: (a, b) => (a === b ? 0 : null),
    classDailyLessons: () => null,
    loadRows: data.rows.map((one) => ({
      id: one.id,
      lessonsPerWeek: one.lessonsPerWeek,
      deliberatelyShort: false,
      doubleLessons: one.doubleLessons,
      // Task 5.4c-3b: the rows of its block and its partners (none in the fixture).
      block: one.block,
      partners: [],
    })),
    otherDrafts: [],
  };
}

describe('factsFromData', () => {
  // A teacher clash, a split apart, a student in a class lesson and a group
  // lesson at once, and a grade-2 lesson meeting a grade-7 lesson by clock time.
  const placements: Placement[] = [
    at('m7a', 'math-7a', 1, slot(SENIOR, 1)),
    at('m7b', 'math-7b', 1, slot(SENIOR, 1)),
    at('e1', 'eng-e1', 2, slot(SENIOR, 1)),
    at('e2', 'eng-e2', 2, slot(SENIOR, 3)),
    at('m7a-2', 'math-7a', 2, slot(SENIOR, 3)),
    at('m2a', 'math-2a', 3, slot(JUNIOR, 5)),
    at('m7a-3', 'math-7a', 3, slot(SENIOR, 3)),
  ];

  it('gives the results that facts written by hand give', () => {
    const fromData = checkTimetable(placements, factsFromData(data));
    expect(fromData).toEqual(checkTimetable(placements, handFacts()));
    const rules = new Set(fromData.map((one) => one.rule));
    expect(rules).toContain('teacher_double');
    expect(rules).toContain('split_apart');
    expect(rules).toContain('student_double');
  });

  it('checks two templates by clock time, not slot number', () => {
    // Grade 2 position 5 is 09:30–10:10; grade 7 position 3 is 08:50–09:35.
    const results = checkTimetable(
      [at('m2a', 'math-2a', 3, slot(JUNIOR, 5)), at('m7a', 'math-7a', 3, slot(SENIOR, 3))],
      factsFromData(data),
    );
    expect(results.filter((one) => one.rule === 'teacher_double')).toEqual([
      expect.objectContaining({ day: '3', lessonIds: ['m7a', 'm2a'] }),
    ]);
  });

  it('reads the days, travel times and the daily maximum of its own branch only', () => {
    const facts = factsFromData(data);
    expect(facts.dayOf(BRANCH, 7, '6')).toEqual({ lessons: false, reason: 'not_working_day' });
    expect(() => facts.dayOf(BRANCH, 9, '1')).toThrow();
    expect(() => facts.dayOf('branch-b', 7, '1')).toThrow();
    expect(facts.travelMinutes(BRANCH, BRANCH)).toBe(0);
    expect(facts.travelMinutes(BRANCH, 'branch-b')).toBeNull();
    const withTravel = factsFromData({
      ...data,
      travel: [{ branchA: 'branch-b', branchB: BRANCH, minutes: 25 }],
    });
    expect(withTravel.travelMinutes(BRANCH, 'branch-b')).toBe(25);
    expect(factsFromData({ ...data, classDailyLessons: 6 }).classDailyLessons(BRANCH)).toBe(6);
  });
});

describe('patternModel', () => {
  it('gives a new lesson the row room, else the class main classroom, else none', () => {
    expect(model.roomOfNew(model.rowOf('sci-7a'))).toBe('lab');
    expect(model.roomOfNew(model.rowOf('math-7a'))).toBe('r7a');
    expect(model.roomOfNew(model.rowOf('eng-e1'))).toBeNull();
    expect(model.roomOfNew(model.rowOf('math-2a'))).toBeNull();
  });

  it('builds a group lesson on the classes and members of its group', () => {
    const lesson = at('e1', 'eng-e1', 1, slot(SENIOR, 1));
    expect(lesson.classIds).toEqual(['7a']);
    expect(lesson.studentIds).toEqual(['s1', 's2']);
    expect(lesson.groupId).toBe('7a-e1');
  });

  it('throws for a row that is not in the data', () => {
    expect(() => model.rowOf('nowhere')).toThrow();
  });
});

describe('the lessons of other branches (task 5.4b-1)', () => {
  // 06, Teachers who work in several branches: "One clash check", "Busy
  // elsewhere" (fixed, with the travel time around them), "Two drafts at once".
  const SOUTH = 'branch-south';
  const senior1 = slot(SENIOR, 1);
  const elsewhere = {
    id: 'south-1',
    teacherId: 't1',
    branchId: SOUTH,
    weekday: 1,
    start: senior1.start,
    end: senior1.end,
    tutorLesson: false,
  };
  const withSouth = patternModel({
    ...data,
    busyElsewhere: [elsewhere],
    travel: [{ branchA: BRANCH, branchB: SOUTH, minutes: 30 }],
    branches: [{ id: SOUTH, name: 'South' }],
  });
  const lesson = (weekday: number, position: number) =>
    withSouth.placementOf(withSouth.rowOf('math-7a'), {
      id: 'mine',
      blockId: 'block-mine',
      weekday,
      start: slot(SENIOR, position).start,
      end: slot(SENIOR, position).end,
      roomId: null,
      doublePairId: null,
    });

  it('builds a fixed placement with the teacher, times and branch only', () => {
    expect(withSouth.fixed).toEqual([
      expect.objectContaining({
        id: 'south-1',
        branchId: SOUTH,
        day: '1',
        teacherIds: ['t1'],
        classIds: [],
        subjectId: null,
        roomId: null,
        fixed: true,
      }),
    ]);
    expect(checkedPlacements(withSouth, []).map((one) => one.id)).toEqual(['south-1']);
  });

  it('blocks a lesson at the same time as the teacher’s lesson elsewhere, and one within the travel time', () => {
    const same = checkCandidates(withSouth.fixed, withSouth.facts, [lesson(1, 1)]);
    expect(same.map((one) => one.rule)).toContain('teacher_double');
    const blocked = (results: readonly { severity: string }[]) =>
      results.filter((one) => one.severity === 'blocked');
    const next = checkCandidates(withSouth.fixed, withSouth.facts, [lesson(1, 3)]);
    expect(blocked(next)).toEqual([
      expect.objectContaining({ rule: 'travel_time', lessonIds: ['south-1', 'mine'] }),
    ]);
    expect(blocked(checkCandidates(withSouth.fixed, withSouth.facts, [lesson(2, 1)]))).toEqual([]);
  });

  it('reports nothing made of lessons elsewhere only', () => {
    const twice = patternModel({
      ...data,
      busyElsewhere: [elsewhere, { ...elsewhere, id: 'south-2' }],
    });
    // Two lessons elsewhere at once are the other branch's clash; only the
    // load warnings of the empty draft remain.
    expect(
      checkTimetable(twice.fixed, twice.facts).filter((one) => one.lessonIds.length > 0),
    ).toEqual([]);
  });

  it('warns of a draft of another branch with the teacher at that time, and blocks nothing', () => {
    const drafted = patternModel({
      ...data,
      otherDrafts: [elsewherePlacement(elsewhere, false)],
    });
    const results = checkCandidates([], drafted.facts, [
      drafted.placementOf(drafted.rowOf('math-7a'), {
        id: 'mine',
        blockId: 'block-mine',
        weekday: 1,
        start: senior1.start,
        end: senior1.end,
        roomId: null,
        doublePairId: null,
      }),
    ]);
    expect(results.filter((one) => one.rule === 'other_draft')).toEqual([
      expect.objectContaining({ severity: 'warning', detail: { branchId: SOUTH } }),
    ]);
    expect(results.some((one) => one.severity === 'blocked')).toBe(false);
  });
});
