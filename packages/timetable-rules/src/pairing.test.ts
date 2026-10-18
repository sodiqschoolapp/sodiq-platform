// Mixed pairings in the weekly pattern (task 5.4c-3b): edge/timetable,
// Structure: "A mixed block is allowed: boys have physical education while
// girls have technology, and the reverse in another slot."
import { describe, expect, it } from 'vitest';
import { checkTimetable } from './check.js';
import type { Facts, Placement } from './placement.js';
import { weekdayOf } from './templates.js';
import { patternModel, type PatternFactsData, type PatternRowData } from './facts-data.js';
import {
  blockPlacements,
  checkedPlacements,
  mixedPartners,
  newBlockOf,
  newPairOf,
  pairingOf,
  pairingProblem,
  placeRowsOf,
  type PatternBlock,
} from './pattern-place.js';
import { patternData, row, ROWS } from './testing/pattern-fixture.js';

const half = (
  id: string,
  groupId: string,
  subjectId: string,
  teacherId: string,
  block: string[],
  extra: Partial<PatternRowData> = {},
): PatternRowData =>
  row(id, {
    classId: null,
    groupId,
    subjectId,
    teacherId,
    lessonsPerWeek: 2,
    mixedBlock: true,
    block,
    ...extra,
  });

const PE = ['pe-b', 'pe-g'];
const TECH = ['tech-b', 'tech-g'];

// 7a's boys (s1, s2) and girls (s3, s4): physical education and technology
// split and marked mixed; 7b's physical education split too; a third subject
// of 7a whose groups share a student with the boys.
function mixedData(
  rows: readonly PatternRowData[] = [
    ...ROWS,
    half('pe-b', '7a-pb', 'pe', 't7', PE),
    half('pe-g', '7a-pg', 'pe', 't7', PE),
    half('tech-b', '7a-tb', 'tech', 't8', TECH),
    half('tech-g', '7a-tg', 'tech', 't9', TECH),
    half('pe-7b', '7b-pb', 'pe', 't7', ['pe-7b', 'pe-7b-g']),
    half('pe-7b-g', '7b-pg', 'pe', 't7', ['pe-7b', 'pe-7b-g']),
  ],
): PatternFactsData {
  const base = patternData(rows);
  const [model] = base.teachers;
  if (model === undefined) throw new Error('The fixture has teachers.');
  const teacher = (id: string) => ({
    ...model,
    id,
    subjects: ['pe', 'tech'].map((subjectId) => ({ subjectId, grades: [7] })),
  });
  const group = (id: string, classId: string, studentIds: string[]) => ({
    id,
    kind: 'group' as const,
    grades: [7],
    language: 'uz',
    tutorOnStart: null,
    classIds: [classId],
    studentIds,
    mainRoomId: null,
  });
  return {
    ...base,
    teachers: [...base.teachers, teacher('t7'), teacher('t8'), teacher('t9')],
    subjects: [
      ...base.subjects,
      ...['pe', 'tech'].map((id) => ({
        id,
        active: true,
        languageRule: false,
        tutorSubject: false,
      })),
    ],
    units: [
      ...base.units,
      group('7a-pb', '7a', ['s1', 's2']),
      group('7a-pg', '7a', ['s3', 's4']),
      group('7a-tb', '7a', ['s1', 's2']),
      group('7a-tg', '7a', ['s3', 's4']),
      group('7b-pb', '7b', ['s5']),
      group('7b-pg', '7b', ['s6']),
    ],
  };
}

const model = patternModel(mixedData());

/** A stored block of rows at a weekday and slot position. */
function block(
  id: string,
  rowIds: readonly string[],
  weekday: number,
  slotPosition: number,
  m = model,
  doublePairId: string | null = null,
): PatternBlock {
  const lessons = rowIds.map((loadRowId) => ({
    id: `${id}:${loadRowId}`,
    loadRowId,
    roomId: null,
  }));
  const [first] = blockPlacements(m, { id, lessons }, weekday, slotPosition) ?? [];
  if (first === undefined) throw new Error('No such slot in the fixture.');
  return { id, weekday, slotPosition, start: first.start, end: first.end, lessons, doublePairId };
}

// The load's counts are left out: the fixture places a few lessons only.
const results = (blocks: readonly PatternBlock[], m = model) =>
  checkTimetable(checkedPlacements(m, blocks), m.facts).filter(
    (one) => one.rule !== 'load_mismatch',
  );
const rules = (blocks: readonly PatternBlock[], m = model) =>
  results(blocks, m).map((one) => one.rule);

describe('mixedPartners', () => {
  it("gives the other subjects' halves of the same class only, those sharing no student first", () => {
    // Not its own split's other half, not itself, not a class row, not 7b's half.
    expect(mixedPartners(model, 'pe-b')).toEqual(['tech-g', 'tech-b']);
    expect(mixedPartners(model, 'tech-g')).toEqual(['pe-b', 'pe-g']);
    expect(mixedPartners(model, 'pe-7b')).toEqual([]);
  });

  it('is empty for a row that is not a mixed half', () => {
    expect(mixedPartners(model, 'math-7a')).toEqual([]);
    expect(mixedPartners(model, 'eng-e1')).toEqual([]);
  });

  it('leaves out a mixed row of a group of two classes', () => {
    const data = mixedData();
    const wide = patternModel({
      ...data,
      units: data.units.map((one) =>
        one.id === '7a-tg' ? { ...one, classIds: ['7a', '7b'] } : one,
      ),
    });
    expect(mixedPartners(wide, 'pe-b')).toEqual(['tech-b']);
  });
});

describe('pairingProblem', () => {
  it('accepts partners whichever row comes first', () => {
    expect(pairingProblem(model, 'pe-b', 'tech-g')).toBeNull();
    expect(pairingProblem(model, 'tech-g', 'pe-b')).toBeNull();
  });

  it.each([
    ['its own split', 'pe-b', 'pe-g'],
    ['the row itself', 'pe-b', 'pe-b'],
    ['a class row', 'pe-b', 'math-7a'],
    ["another class's half", 'pe-b', 'pe-7b'],
    ['a row that is not mixed', 'math-7a', 'pe-b'],
    ['a half of a split that is not mixed', 'eng-e1', 'pe-b'],
  ])('refuses %s', (_case, rowId, partnerRowId) => {
    expect(pairingProblem(model, rowId, partnerRowId)).toBe('pattern_mixed_partner');
  });

  it('pairingOf gives the two rows of a pairing, sorted, and null for a block of the load', () => {
    expect(pairingOf(model, ['tech-g', 'pe-b'])).toEqual(['pe-b', 'tech-g']);
    expect(pairingOf(model, PE)).toBeNull();
    expect(pairingOf(model, ['pe-b'])).toBeNull();
  });
});

describe('placeRowsOf', () => {
  it('names both rows of a pairing, and the first row of a block of the load', () => {
    expect(placeRowsOf(model, ['tech-g', 'pe-b'])).toEqual({
      loadRowId: 'pe-b',
      partnerRowId: 'tech-g',
    });
    expect(placeRowsOf(model, PE)).toEqual({ loadRowId: 'pe-b' });
    expect(placeRowsOf(model, ['math-7a'])).toEqual({ loadRowId: 'math-7a' });
  });
});

describe('newBlockOf with a partner', () => {
  it('gives one lesson per row, the same block whichever row is first', () => {
    const rows = (one: PatternBlock) => one.lessons.map((lesson) => lesson.loadRowId);
    expect(rows(newBlockOf(model, 'pe-b', 'tech-g'))).toEqual(['pe-b', 'tech-g']);
    expect(newBlockOf(model, 'tech-g', 'pe-b')).toEqual(newBlockOf(model, 'pe-b', 'tech-g'));
  });

  it('gives a mixed half alone its whole split', () => {
    expect(newBlockOf(model, 'pe-b').lessons.map((lesson) => lesson.loadRowId)).toEqual(PE);
  });

  it('newPairOf gives a double of a pairing', () => {
    const [first, second] = newPairOf(model, 'tech-g', 'pe-b');
    expect(first.lessons.map((lesson) => lesson.loadRowId)).toEqual(['pe-b', 'tech-g']);
    expect(second.lessons.map((lesson) => lesson.loadRowId)).toEqual(['pe-b', 'tech-g']);
  });
});

describe('a pairing in the rule engine', () => {
  it('gives both pairings on one day no result', () => {
    // Monday: boys PE with girls technology, then girls PE with boys technology.
    expect(
      results([block('x', ['pe-b', 'tech-g'], 1, 1), block('y', ['pe-g', 'tech-b'], 1, 3)]),
    ).toEqual([]);
  });

  it('gives split_apart when the partner group misses a student of the class', () => {
    const data = mixedData();
    const short = patternModel({
      ...data,
      units: data.units.map((one) => (one.id === '7a-tg' ? { ...one, studentIds: ['s3'] } : one)),
    });
    const found = results([block('x', ['pe-b', 'tech-g'], 1, 1, short)], short);
    expect(found.map((one) => [one.rule, one.detail])).toEqual([['split_apart', { students: 1 }]]);
  });

  it('gives student_double when the two groups share a student', () => {
    expect(rules([block('x', ['pe-b', 'tech-b'], 1, 1)])).toContain('student_double');
  });

  it('gives teacher_double with one teacher for both lessons', () => {
    const data = mixedData();
    const one = patternModel({
      ...data,
      rows: data.rows.map((each) => (each.id === 'tech-g' ? { ...each, teacherId: 't7' } : each)),
    });
    expect(rules([block('x', ['pe-b', 'tech-g'], 1, 1, one)], one)).toContain('teacher_double');
  });

  it('gives split_apart when the two lessons sit in two slots', () => {
    const x = block('x', ['pe-b', 'tech-g'], 1, 1);
    const [first, second] = x.lessons;
    if (first === undefined || second === undefined) throw new Error('Two lessons.');
    const placements = checkedPlacements(model, [x]).map((one) =>
      one.id === second.id ? { ...one, start: 530, end: 575 } : one,
    );
    expect(
      checkTimetable(placements, model.facts).filter((one) => one.rule === 'split_apart'),
    ).toEqual([
      expect.objectContaining({ detail: { slots: 2 }, lessonIds: [first.id, second.id].sort() }),
    ]);
  });

  it('gives split_apart with its rows when the halves stop being partners', () => {
    // The mixed mark cleared on technology after the pairing was placed.
    const data = mixedData();
    const cleared = patternModel({
      ...data,
      rows: data.rows.map((one) => (TECH.includes(one.id) ? { ...one, mixedBlock: false } : one)),
    });
    const found = results([block('x', ['pe-b', 'tech-g'], 1, 1, cleared)], cleared);
    expect(found.map((one) => [one.rule, one.detail])).toEqual([['split_apart', { rows: 2 }]]);
  });

  it('gives split_apart with its rows for rows of two splits that are not mixed', () => {
    const data = mixedData();
    const plain = patternModel({
      ...data,
      rows: data.rows.map((one) => ({ ...one, mixedBlock: false })),
    });
    expect(
      results([block('x', ['pe-b', 'tech-g'], 1, 1, plain)], plain).map((one) => one.detail),
    ).toEqual([{ rows: 2 }]);
  });

  it('gives no split_apart to a class row, a split, parallel groups and each half of a double', () => {
    const data = mixedData();
    // Parallel groups across 7a and 7b: two groups of two classes, one block.
    const parallel = patternModel({
      ...data,
      rows: [
        ...data.rows,
        row('sci-p1', {
          classId: null,
          groupId: 'p1',
          subjectId: 'science',
          teacherId: 't5',
          block: ['sci-p1', 'sci-p2'],
        }),
        row('sci-p2', {
          classId: null,
          groupId: 'p2',
          subjectId: 'science',
          teacherId: 't6',
          block: ['sci-p1', 'sci-p2'],
        }),
      ].map((one) => (one.id === 'math-7a' ? { ...one, doubleLessons: true } : one)),
      units: [
        ...data.units,
        ...(
          [
            ['p1', ['s1', 's2', 's5']],
            ['p2', ['s3', 's4', 's6']],
          ] as const
        ).map(([id, studentIds]) => ({
          id,
          kind: 'group' as const,
          grades: [7],
          language: 'uz',
          tutorOnStart: null,
          classIds: ['7a', '7b'],
          studentIds: [...studentIds],
          mainRoomId: null,
        })),
      ],
    });
    const found = results(
      [
        block('m', ['math-7a'], 1, 1, parallel, 'dp'),
        block('m2', ['math-7a'], 1, 3, parallel, 'dp'),
        block('e', ['eng-e1', 'eng-e2'], 2, 1, parallel),
        block('p', ['sci-p1', 'sci-p2'], 3, 1, parallel),
        block('w', PE, 4, 1, parallel),
      ],
      parallel,
    );
    expect(found.filter((one) => one.rule === 'split_apart')).toEqual([]);
  });

  it('gives a double of a pairing double_not_allowed when one row does not allow doubles', () => {
    const data = mixedData();
    const doubles = patternModel({
      ...data,
      rows: data.rows.map((one) => (one.id === 'pe-b' ? { ...one, doubleLessons: true } : one)),
    });
    const found = results(
      [
        block('x', ['pe-b', 'tech-g'], 1, 1, doubles, 'dp'),
        block('x2', ['pe-b', 'tech-g'], 1, 3, doubles, 'dp'),
      ],
      doubles,
    );
    // Technology's two lessons only: physical education allows doubles.
    expect(
      found
        .filter((one) => one.rule === 'double_not_allowed')
        .map((one) => [...one.lessonIds].sort()),
    ).toEqual([['x2:tech-g', 'x:tech-g']]);
  });
});

// Task 5.5b-1 (From 5.4c-3b): the dated check gives the engine the load rows,
// so a dated block is checked as one block of the load or a pairing too.
describe('a pairing on a date', () => {
  const DATE = '2026-11-16';
  const datedFacts = (m = model): Facts => ({
    ...m.facts,
    mode: 'dated',
    dayOf: (branchId, grade, day) => m.facts.dayOf(branchId, grade, String(weekdayOf(day))),
  });
  const onDate = (blocks: readonly PatternBlock[], m = model): Placement[] =>
    checkedPlacements(m, blocks).map((one) => ({ ...one, day: DATE }));
  const datedRules = (blocks: readonly PatternBlock[], m = model) =>
    checkTimetable(onDate(blocks, m), datedFacts(m))
      .filter((one) => one.rule !== 'load_mismatch')
      .map((one) => [one.rule, one.detail]);

  it('gives a pairing of partners no result, and split_apart with its rows for halves that are not partners', () => {
    expect(datedRules([block('x', ['pe-b', 'tech-g'], 1, 1)])).toEqual([]);
    const data = mixedData();
    const plain = patternModel({
      ...data,
      rows: data.rows.map((one) => ({ ...one, mixedBlock: false })),
    });
    expect(datedRules([block('x', ['pe-b', 'tech-g'], 1, 1, plain)], plain)).toEqual([
      ['split_apart', { rows: 2 }],
    ]);
  });

  it('reads double lessons allowed from the rows on a date: none for rows that allow them (spec review should-fix 5)', () => {
    const data = mixedData();
    const pairOf = (allowed: readonly string[]) => {
      const m = patternModel({
        ...data,
        rows: data.rows.map((one) =>
          allowed.includes(one.id) ? { ...one, doubleLessons: true } : one,
        ),
      });
      return datedRules(
        [
          block('x', ['pe-b', 'tech-g'], 1, 1, m, 'dp'),
          block('x2', ['pe-b', 'tech-g'], 1, 3, m, 'dp'),
        ],
        m,
      ).map(([rule]) => rule);
    };
    expect(pairOf(['pe-b', 'tech-g'])).not.toContain('double_not_allowed');
    expect(pairOf(['pe-b'])).toContain('double_not_allowed');
  });
});

describe('subject_twice per student', () => {
  const twice = (blocks: readonly PatternBlock[]) =>
    results(blocks).filter((one) => one.rule === 'subject_twice');

  it('stays silent for both pairings on one day', () => {
    expect(
      twice([block('x', ['pe-b', 'tech-g'], 1, 1), block('y', ['pe-g', 'tech-b'], 1, 3)]),
    ).toEqual([]);
  });

  it('warns for two whole-class lessons of one subject on one day', () => {
    expect(
      twice([block('a', ['math-7a'], 1, 1), block('b', ['math-7a'], 1, 3)]).map(
        (one) => one.detail,
      ),
    ).toEqual([{ classId: '7a', subjectId: 'math' }]);
  });

  it('warns for two split blocks of one subject on one day', () => {
    expect(
      twice([block('a', ['eng-e1', 'eng-e2'], 1, 1), block('b', ['eng-e1', 'eng-e2'], 1, 3)]),
    ).toHaveLength(1);
  });

  it('warns when one student has the subject twice in two pairings', () => {
    // Boys PE twice on Monday: once with girls technology, once with girls PE's slot taken by boys.
    expect(
      twice([block('x', ['pe-b', 'tech-g'], 1, 1), block('y', ['pe-b', 'tech-g'], 1, 3)]).map(
        (one) => one.detail?.subjectId,
      ),
    ).toEqual(['pe', 'tech']);
  });
});
