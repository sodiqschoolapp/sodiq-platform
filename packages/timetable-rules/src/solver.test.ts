// Task 5.10: the solver's problem from the rule engine, and its answer as
// pattern placements. Invented names only.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { checkTimetable } from './check.js';
import { patternModel, type PatternFactsData } from './facts-data.js';
import { FIXED_RULES } from './rules.js';
import {
  SOLVER_AFTER_RULES,
  SOLVER_OPTION_RULES,
  SOLVER_PAIR_RULES,
  SolverPinError,
  solvedPlacements,
  solverProblem,
  type SolverAnswer,
  type SolverProblem,
} from './solver.js';
import { solverBranch, type SolverBranch } from './testing/solver-branch.js';

const problemOf = (branch: SolverBranch, data: PatternFactsData = branch.data) =>
  solverProblem(patternModel(data), branch);

const lessonsOf = (problem: SolverProblem, rowId: string) =>
  problem.lessons.filter((lesson) => lesson.rowIds.includes(rowId));

const optionsOf = (problem: SolverProblem, rowId: string) => {
  const lesson = lessonsOf(problem, rowId).find((one) => !one.pinned);
  if (lesson === undefined) throw new Error(`No free lesson of ${rowId}.`);
  return lesson.options;
};

const weekdaysOf = (problem: SolverProblem, rowId: string) =>
  [...new Set(optionsOf(problem, rowId).map((option) => option.weekday))].sort();

describe('the rules the solver keeps', () => {
  it('every fixed rule is kept by the options, by the Kotlin constraints or after solving', () => {
    // The Kotlin side's list (`apps/solver/rules.json`, its constraints' names).
    const file = JSON.parse(
      readFileSync(new URL('../../../apps/solver/rules.json', import.meta.url), 'utf8'),
    ) as { pairRules: string[] };
    expect(file.pairRules).toEqual([...SOLVER_PAIR_RULES]);
    const kept = new Set<string>([
      ...SOLVER_OPTION_RULES,
      ...file.pairRules,
      ...SOLVER_AFTER_RULES,
    ]);
    expect(FIXED_RULES.filter((rule) => !kept.has(rule))).toEqual([]);
  });
});

describe('solverProblem: the options of a lesson', () => {
  const branch = solverBranch();
  const problem = problemOf(branch);

  it('keeps every lesson slot of the week where the block alone breaks no rule', () => {
    // History of 6a: every senior lesson slot from Monday to Friday, breaks left out.
    const options = optionsOf(problem, 'history-6a');
    expect(options.map((one) => `${one.weekday}@${one.start}`)).toEqual(
      [1, 2, 3, 4, 5].flatMap((weekday) =>
        [480, 530, 590, 635, 700, 745, 795].map((start) => `${weekday}@${start}`),
      ),
    );
    expect(options[0]).toMatchObject({ end: 525, number: 1, rowIds: null, rooms: ['room-6a'] });
  });

  it('leaves out a day off and the days that are not working days', () => {
    const data: PatternFactsData = {
      ...branch.data,
      days: branch.data.days.map((one) =>
        one.grade === 6 && one.weekday === 3
          ? { ...one, day: { lessons: false, reason: 'day_off' } }
          : one,
      ),
    };
    expect(weekdaysOf(problemOf(branch, data), 'math-6a')).toEqual([1, 2, 4, 5]);
  });

  it("leaves out the hours outside a teacher's availability", () => {
    // The part-time art teacher is at school on Monday to Wednesday.
    expect(weekdaysOf(problem, 'art-5a')).toEqual([1, 2, 3]);
  });

  it('leaves out a teacher without the subject, the grade or the language', () => {
    const without = (change: (teacher: PatternFactsData['teachers'][number]) => object) => ({
      ...branch.data,
      teachers: branch.data.teachers.map((one) =>
        one.id === 't-history-1' ? { ...one, ...change(one) } : one,
      ),
    });
    const subject = without((one) => ({
      subjects: one.subjects.filter((s) => s.subjectId !== 'history'),
    }));
    const grade = without((one) => ({
      subjects: one.subjects.map((s) => ({ ...s, grades: s.grades.filter((g) => g !== 6) })),
    }));
    const language = without(() => ({ languages: ['ru'] }));
    for (const data of [subject, grade, language]) {
      expect(optionsOf(problemOf(branch, data), 'history-6a')).toEqual([]);
    }
  });

  it('leaves out a clash with a busy-elsewhere lesson and the travel time around it', () => {
    // t-math-2 teaches in the other branch on Tuesday 08:00–09:30, travel 30 minutes.
    const tuesday = optionsOf(problem, 'math-5b')
      .filter((one) => one.weekday === 2)
      .map((one) => one.start);
    expect(tuesday).toEqual([635, 700, 745, 795]);
    const unset = { ...branch.data, travel: [] };
    expect(weekdaysOf(problemOf(branch, unset), 'math-5b')).toEqual([1, 3, 4, 5]);
  });

  it('keeps a two-grade group only in slots with the same times in both templates', () => {
    expect(optionsOf(problem, 'pe-9b-10b').length).toBeGreaterThan(0);
    const data: PatternFactsData = {
      ...branch.data,
      units: branch.data.units.map((one) =>
        one.id === 'pe-9b-10b' ? { ...one, classIds: ['4a', '10b'], grades: [4, 10] } : one,
      ),
      // 4a's students take the group's place; the senior and junior slots never match.
      rows: branch.data.rows.filter((row) => row.id !== 'pe-4a'),
    };
    expect(optionsOf(problemOf(branch, data), 'pe-9b-10b')).toEqual([]);
  });

  it('gives a room type its rooms in use, and a row without room its main classroom', () => {
    const rooms = new Set(optionsOf(problem, 'science-7a').flatMap((one) => one.rooms));
    expect([...rooms].sort()).toEqual(['lab-1', 'lab-2']);
    const closed = {
      ...branch.data,
      rooms: branch.data.rooms.map((one) =>
        one.id === 'lab-2' ? { ...one, status: 'closed' as const } : one,
      ),
    };
    const left = new Set(
      optionsOf(problemOf(branch, closed), 'science-7a').flatMap((o) => o.rooms),
    );
    expect([...left]).toEqual(['lab-1']);
    expect(new Set(optionsOf(problem, 'history-6a').flatMap((one) => one.rooms))).toEqual(
      new Set(['room-6a']),
    );
  });

  it('gives a block its lessons per week, each with all its rows', () => {
    const english = lessonsOf(problem, 'english-5a-en-1');
    expect(english).toHaveLength(3);
    for (const lesson of english) {
      expect(lesson.rowIds).toEqual(['english-5a-en-1', 'english-5a-en-2']);
      expect(lesson.options.every((one) => one.rooms.length === 2)).toBe(true);
    }
    expect(lessonsOf(problem, 'english-10-en-2')[0]?.rowIds).toEqual([
      'english-10-en-1',
      'english-10-en-2',
      'english-10-en-3',
    ]);
  });
});

describe('solverProblem: mixed splits', () => {
  const branch = solverBranch();
  const problem = problemOf(branch);
  const split = problem.lessons.filter((lesson) => lesson.splitClassId === '8a');

  it('gives the split one lesson per lesson of a half, choosing a whole block or a partner pair', () => {
    expect(split).toHaveLength(4);
    const pairs = new Set(split[0]?.options.map((one) => (one.rowIds ?? []).join('+')));
    // Physical education whole is blocked: its halves share one teacher.
    expect([...pairs].sort()).toEqual([
      'pe-8a-boys+tech-8a-girls',
      'pe-8a-girls+tech-8a-boys',
      'tech-8a-boys+tech-8a-girls',
    ]);
  });

  it('gives no combination whose halves leave a student of the class out', () => {
    const data: PatternFactsData = {
      ...branch.data,
      units: branch.data.units.map((one) =>
        one.id === '8a-girls' ? { ...one, studentIds: one.studentIds.slice(0, 1) } : one,
      ),
    };
    const lessons = problemOf(branch, data).lessons.filter((one) => one.splitClassId === '8a');
    expect(lessons.every((one) => one.options.length === 0)).toBe(true);
  });
});

describe('solverProblem: pins', () => {
  const branch = solverBranch();

  it('gives a pin one pinned lesson at the time of its slot on the start date, the rest free', () => {
    const problem = problemOf(branch);
    const native = lessonsOf(problem, 'native-5a');
    expect(native.filter((one) => one.pinned)).toEqual([
      {
        id: 'native-5a#pin1',
        rowIds: ['native-5a'],
        splitClassId: null,
        pinned: true,
        options: [
          { weekday: 1, start: 480, end: 525, number: 1, rowIds: null, rooms: ['room-5a'] },
        ],
      },
    ]);
    expect(native.filter((one) => !one.pinned)).toHaveLength(3);
  });

  it('holds the whole block of a pinned group row', () => {
    const problem = solverProblem(patternModel(branch.data), {
      ...branch,
      pins: [{ id: 'pin-2', loadRowId: 'english-6a-en-2', weekday: 2, slotPosition: 3 }],
    });
    const pinned = problem.lessons.filter((one) => one.pinned);
    expect(pinned).toHaveLength(1);
    expect(pinned[0]?.rowIds).toEqual(['english-6a-en-1', 'english-6a-en-2']);
    expect(pinned[0]?.options[0]).toMatchObject({ weekday: 2, start: 530, end: 575 });
  });

  it('refuses a pin problem and pins that clash, listing them', () => {
    const mixed = () =>
      solverProblem(patternModel(branch.data), {
        ...branch,
        pins: [{ id: 'pin-m', loadRowId: 'pe-8a-boys', weekday: 1, slotPosition: 1 }],
      });
    expect(mixed).toThrow(SolverPinError);
    try {
      mixed();
    } catch (error) {
      expect((error as SolverPinError).problems).toEqual([
        { pinId: 'pin-m', problem: 'pin_mixed_block' },
      ]);
    }
    // Mathematics of 5a and of 7a: one teacher, pinned to one slot.
    const clash = () =>
      solverProblem(patternModel(branch.data), {
        ...branch,
        pins: [
          { id: 'pin-a', loadRowId: 'math-5a', weekday: 1, slotPosition: 1 },
          { id: 'pin-b', loadRowId: 'math-7a', weekday: 1, slotPosition: 1 },
        ],
      });
    try {
      clash();
      expect.unreachable();
    } catch (error) {
      expect((error as SolverPinError).blocked.map((result) => result.rule)).toEqual([
        'teacher_double',
      ]);
    }
  });
});

describe('solvedPlacements', () => {
  const branch = solverBranch();
  const model = patternModel(branch.data);
  const problem = solverProblem(model, branch);

  type Placed = { weekday: number; start: number; end: number; rooms: (string | null)[] };
  const answerOf = (placed: Record<string, Placed & { rowIds?: string[] }>): SolverAnswer => ({
    lessons: problem.lessons.map((lesson) => {
      const one = placed[lesson.id];
      return {
        id: lesson.id,
        option: one === undefined ? null : { rowIds: one.rowIds ?? [...lesson.rowIds], ...one },
      };
    }),
    score: { hard: 0, medium: 0, soft: 0 },
    seconds: 1,
    complete: false,
  });
  const pairIds = (answer: SolverAnswer, rowId: string) =>
    solvedPlacements(model, problem, answer)
      .filter((one) => one.loadRowId === rowId)
      .map((one) => one.doublePairId);

  it('pairs two consecutive lessons of a row that allows doubles, in one room', () => {
    // Senior lesson 3 (09:50) and 4 (10:35) on Monday.
    const answer = answerOf({
      'math-11a#1': { weekday: 1, start: 590, end: 635, rooms: ['room-11a'] },
      'math-11a#2': { weekday: 1, start: 635, end: 680, rooms: ['room-11a'] },
    });
    const ids = pairIds(answer, 'math-11a');
    expect(ids[0]).not.toBeNull();
    expect(ids[0]).toBe(ids[1]);
    const placements = solvedPlacements(model, problem, answer);
    const results = checkTimetable([...model.fixed, ...placements], model.facts);
    expect(results.filter((one) => one.rule === 'double_apart')).toEqual([]);
  });

  it('leaves apart two lessons not consecutive, in two rooms, or of a row without doubles', () => {
    const apart = answerOf({
      'math-11a#1': { weekday: 1, start: 480, end: 525, rooms: ['room-11a'] },
      'math-11a#2': { weekday: 1, start: 635, end: 680, rooms: ['room-11a'] },
    });
    expect(pairIds(apart, 'math-11a')).toEqual([null, null]);
    const rooms = answerOf({
      'math-11a#1': { weekday: 1, start: 590, end: 635, rooms: ['room-11a'] },
      'math-11a#2': { weekday: 1, start: 635, end: 680, rooms: ['room-11b'] },
    });
    expect(pairIds(rooms, 'math-11a')).toEqual([null, null]);
    const single = answerOf({
      'math-11b#1': { weekday: 1, start: 590, end: 635, rooms: ['room-11b'] },
      'math-11b#2': { weekday: 1, start: 635, end: 680, rooms: ['room-11b'] },
    });
    expect(pairIds(single, 'math-11b')).toEqual([null, null]);
  });

  it('places a mixed pairing as one block the engine accepts, and never pairs two pairings', () => {
    const answer = answerOf({
      'split-8a#1': {
        weekday: 1,
        start: 590,
        end: 635,
        rowIds: ['pe-8a-boys', 'tech-8a-girls'],
        rooms: ['hall', 'workshop-2'],
      },
      'split-8a#2': {
        weekday: 1,
        start: 635,
        end: 680,
        rowIds: ['pe-8a-girls', 'tech-8a-boys'],
        rooms: ['hall', 'workshop'],
      },
    });
    const placements = solvedPlacements(model, problem, answer);
    const first = placements.filter((one) => one.blockId === 'solver:split-8a#1');
    expect(first.map((one) => one.loadRowId).sort()).toEqual(['pe-8a-boys', 'tech-8a-girls']);
    expect(placements.every((one) => one.doublePairId === null)).toBe(true);
    const results = checkTimetable([...model.fixed, ...placements], model.facts);
    expect(results.filter((one) => one.rule === 'split_apart')).toEqual([]);
  });

  it('refuses an answer that places rows its lesson does not hold', () => {
    const answer = answerOf({
      'math-5a#1': { weekday: 1, start: 590, end: 635, rowIds: ['math-5b'], rooms: ['room-5b'] },
    });
    expect(() => solvedPlacements(model, problem, answer)).toThrow();
  });
});
