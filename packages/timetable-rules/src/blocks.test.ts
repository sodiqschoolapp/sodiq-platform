import { describe, expect, it } from 'vitest';
import {
  blockOf,
  blockProblems,
  loadBlocks,
  splitAndWhole,
  type BlockGroup,
  type BlockRow,
} from './blocks.js';

const group = (
  id: string,
  classIds: string[],
  grades: number[],
  subjectId = 'english',
): BlockGroup => ({ id, subjectId, classIds, grades });

const row = (id: string, groupId: string, changes: Partial<BlockRow> = {}): BlockRow => ({
  id,
  classId: null,
  groupId,
  subjectId: 'english',
  teacherId: `teacher-${id}`,
  lessonsPerWeek: 3,
  mixedBlock: false,
  ...changes,
});

const classRow = (id: string, classId: string, subjectId = 'english'): BlockRow => ({
  id,
  classId,
  groupId: null,
  subjectId,
  teacherId: `teacher-${id}`,
  lessonsPerWeek: 3,
  mixedBlock: false,
});

const groupsOf = (...all: BlockGroup[]) => new Map(all.map((one) => [one.id, one]));

// edge/timetable, Structure: "a split or a set of parallel groups is one block
// of several lessons"; 06, Model: parallel groups are "All groups of one
// subject and one grade or pair of grades"; task 3.4b, decision 2.
describe('loadBlocks', () => {
  it('makes the halves of a split of one class one block', () => {
    const groups = groupsOf(group('g1', ['oxford'], [7]), group('g2', ['oxford'], [7]));
    expect(loadBlocks([row('b', 'g2'), row('a', 'g1')], groups)).toEqual([['a', 'b']]);
  });

  it('makes parallel groups of two classes one block', () => {
    const groups = groupsOf(
      group('m1', ['oxford', 'princeton'], [7]),
      group('m2', ['oxford', 'princeton'], [7]),
    );
    expect(loadBlocks([row('a', 'm1'), row('b', 'm2')], groups)).toEqual([['a', 'b']]);
  });

  it('links a chain of groups through shared classes', () => {
    const groups = groupsOf(
      group('m1', ['oxford'], [7]),
      group('m2', ['oxford', 'princeton'], [7]),
      group('m3', ['princeton'], [7]),
    );
    expect(loadBlocks([row('a', 'm1'), row('b', 'm2'), row('c', 'm3')], groups)).toEqual([
      ['a', 'b', 'c'],
    ]);
  });

  it('makes two groups across classes of one grade one block with no class in common', () => {
    const groups = groupsOf(
      group('m1', ['oxford', 'princeton'], [7]),
      group('m2', ['cambridge', 'yale'], [7]),
    );
    expect(loadBlocks([row('a', 'm1'), row('b', 'm2')], groups)).toEqual([['a', 'b']]);
  });

  it('keeps splits of two classes with no class in common apart', () => {
    const groups = groupsOf(group('s1', ['oxford'], [7]), group('s2', ['cambridge'], [7]));
    expect(loadBlocks([row('a', 's1'), row('b', 's2')], groups)).toEqual([['a'], ['b']]);
  });

  it('keeps groups across classes of other grades apart', () => {
    const groups = groupsOf(
      group('m1', ['oxford', 'princeton'], [7]),
      group('p1', ['edinburgh', 'brown'], [9, 10]),
    );
    expect(loadBlocks([row('a', 'm1'), row('b', 'p1')], groups)).toEqual([['a'], ['b']]);
  });

  it('links two-grade groups of the same pair of grades', () => {
    const groups = groupsOf(
      group('p1', ['edinburgh', 'brown'], [9, 10]),
      group('p2', ['harvard', 'stanford'], [10, 9]),
    );
    expect(loadBlocks([row('a', 'p1'), row('b', 'p2')], groups)).toEqual([['a', 'b']]);
  });

  it('never makes groups of two subjects one block', () => {
    const groups = groupsOf(
      group('pe1', ['oxford'], [7], 'pe'),
      group('tech1', ['oxford'], [7], 'technology'),
    );
    expect(
      loadBlocks(
        [row('a', 'pe1', { subjectId: 'pe' }), row('b', 'tech1', { subjectId: 'technology' })],
        groups,
      ),
    ).toEqual([['a'], ['b']]);
  });

  it('leaves class rows out of every block', () => {
    const groups = groupsOf(group('g1', ['oxford'], [7]));
    expect(loadBlocks([classRow('c', 'oxford'), row('a', 'g1')], groups)).toEqual([['a']]);
    expect(blockOf('c', [classRow('c', 'oxford')], groups)).toEqual([]);
  });
});

// edge/timetable, Structure: "all parts have equal lessons per week and
// different teachers. A mixed block is allowed"; decision 12.
describe('blockProblems', () => {
  const split = groupsOf(group('g1', ['oxford'], [7]), group('g2', ['oxford'], [7]));

  it('finds nothing for parts with equal lessons and different teachers', () => {
    const rows = [row('a', 'g1'), row('b', 'g2')];
    expect(blockProblems(rows[0] as BlockRow, rows, split)).toEqual([]);
  });

  it('finds parts with other lessons per week', () => {
    const rows = [row('a', 'g1'), row('b', 'g2', { lessonsPerWeek: 2 })];
    expect(blockProblems(rows[0] as BlockRow, rows, split)).toEqual(['load_block_lessons']);
  });

  it('finds one teacher on two parts', () => {
    const rows = [row('a', 'g1', { teacherId: 't' }), row('b', 'g2', { teacherId: 't' })];
    expect(blockProblems(rows[1] as BlockRow, rows, split)).toEqual(['load_block_teacher']);
  });

  it('lets one teacher take both halves of a split marked as a mixed block', () => {
    const rows = [
      row('a', 'g1', { teacherId: 't', mixedBlock: true }),
      row('b', 'g2', { teacherId: 't', mixedBlock: true }),
    ];
    expect(blockProblems(rows[0] as BlockRow, rows, split)).toEqual([]);
    const unequal = [rows[0] as BlockRow, { ...(rows[1] as BlockRow), lessonsPerWeek: 2 }];
    expect(blockProblems(unequal[0] as BlockRow, unequal, split)).toEqual(['load_block_lessons']);
  });

  it('finds halves of one split that disagree on the mixed mark', () => {
    const rows = [row('a', 'g1', { mixedBlock: true }), row('b', 'g2')];
    expect(blockProblems(rows[1] as BlockRow, rows, split)).toEqual(['load_block_mixed']);
  });

  it('finds a mixed mark on a group across classes, and one teacher there still refused', () => {
    const groups = groupsOf(
      group('m1', ['oxford', 'princeton'], [7]),
      group('m2', ['oxford', 'princeton'], [7]),
    );
    const rows = [
      row('a', 'm1', { teacherId: 't', mixedBlock: true }),
      row('b', 'm2', { teacherId: 't', mixedBlock: true }),
    ];
    expect(blockProblems(rows[0] as BlockRow, rows, groups)).toEqual([
      'load_mixed_not_split',
      'load_block_teacher',
    ]);
  });

  it('lets PE and technology splits of one class have other lessons and one teacher', () => {
    const groups = groupsOf(
      group('pe1', ['oxford'], [7], 'pe'),
      group('pe2', ['oxford'], [7], 'pe'),
      group('tech1', ['oxford'], [7], 'technology'),
      group('tech2', ['oxford'], [7], 'technology'),
    );
    const rows = [
      row('a', 'pe1', { subjectId: 'pe', teacherId: 'x', mixedBlock: true, lessonsPerWeek: 2 }),
      row('b', 'pe2', { subjectId: 'pe', teacherId: 'x', mixedBlock: true, lessonsPerWeek: 2 }),
      row('c', 'tech1', { subjectId: 'technology', teacherId: 'y', mixedBlock: true }),
      row('d', 'tech2', { subjectId: 'technology', teacherId: 'y', mixedBlock: true }),
    ];
    for (const one of rows) {
      expect(blockProblems(one, blockOf(one.id, rows, groups), groups), one.id).toEqual([]);
    }
  });
});

// 05, Group: "Whether a class is split for a subject is set in the teaching load."
describe('splitAndWhole', () => {
  const groups = groupsOf(group('g1', ['oxford', 'princeton'], [7]));

  it('finds a class row beside a group row of the subject that draws from the class', () => {
    const rows = [classRow('c', 'princeton'), row('a', 'g1')];
    expect(splitAndWhole(rows[0] as BlockRow, rows, groups)).toBe(true);
    expect(splitAndWhole(rows[1] as BlockRow, rows, groups)).toBe(true);
  });

  it('finds nothing for another subject or another class', () => {
    const rows = [
      classRow('c', 'princeton', 'algebra'),
      classRow('d', 'cambridge'),
      row('a', 'g1'),
    ];
    for (const one of rows) {
      expect(splitAndWhole(one, rows, groups), one.id).toBe(false);
    }
  });
});
