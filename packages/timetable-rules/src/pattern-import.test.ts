// The lessons of a timetable import placed as the grid places them (task 5.14; `06`, Importing
// the load and the timetable, The timetable import). Invented data of `pattern-fixture.ts`.
import { describe, expect, it } from 'vitest';
import { checkTimetable } from './check.js';
import { patternModel, type PatternRowData } from './facts-data.js';
import { checkedPlacements } from './pattern-place.js';
import {
  importedBlocks,
  importKeyOf,
  importLessonId,
  type ImportLesson,
} from './pattern-import.js';
import { patternData, row, ROWS } from './testing/pattern-fixture.js';

const model = patternModel(patternData());

const lesson = (key: number, rowId: string, weekday: number, lessonNumber: number) => ({
  key,
  rowId,
  weekday,
  lessonNumber,
});

/** The fixture with math of 7a allowing doubles. */
const doublesModel = patternModel(
  patternData(ROWS.map((one) => (one.id === 'math-7a' ? { ...one, doubleLessons: true } : one))),
);

describe('importedBlocks', () => {
  it('places a class lesson at the slot of its lesson number, breaks not counted', () => {
    const { blocks, problems } = importedBlocks(model, [lesson(3, 'math-7a', 1, 3)]);
    expect(problems).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.keys).toEqual([3]);
    expect(blocks[0]?.block).toMatchObject({
      weekday: 1,
      slotPosition: 5,
      start: 595,
      end: 640,
      doublePairId: null,
      lessons: [{ id: importLessonId(3), loadRowId: 'math-7a', roomId: 'r7a' }],
    });
  });

  it('takes the room of the file over the grid room of a new lesson', () => {
    const [placed] = importedBlocks(model, [
      { ...lesson(3, 'math-7a', 1, 1), roomId: 'lab' },
    ]).blocks;
    expect(placed?.block.lessons[0]?.roomId).toBe('lab');
  });

  it('places the two halves of a split in one slot as one block', () => {
    const { blocks, problems } = importedBlocks(model, [
      lesson(4, 'eng-e2', 2, 2),
      lesson(5, 'eng-e1', 2, 2),
    ]);
    expect(problems).toEqual([]);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.block.lessons.map((one) => one.loadRowId)).toEqual(['eng-e1', 'eng-e2']);
    expect(blocks[0]?.keys).toEqual([5, 4]);
    expect(blocks[0]?.block.slotPosition).toBe(3);
  });

  it('tells a block given in part on its present rows, naming the missing part', () => {
    const { blocks, problems } = importedBlocks(model, [lesson(4, 'eng-e1', 2, 2)]);
    expect(blocks).toEqual([]);
    expect(problems).toEqual([
      { key: 4, code: 'pattern_import_block_part', missingRowIds: ['eng-e2'] },
    ]);
  });

  it('tells both parts of a block placed in two slots', () => {
    const { blocks, problems } = importedBlocks(model, [
      lesson(4, 'eng-e1', 2, 3),
      lesson(5, 'eng-e2', 2, 4),
    ]);
    expect(blocks).toEqual([]);
    expect(problems).toEqual([
      { key: 4, code: 'pattern_import_block_part', missingRowIds: ['eng-e2'] },
      { key: 5, code: 'pattern_import_block_part', missingRowIds: ['eng-e1'] },
    ]);
  });

  it('counts a part held back for another problem as present, and places nothing of the block', () => {
    const { blocks, problems } = importedBlocks(
      model,
      [lesson(4, 'eng-e1', 2, 2)],
      [{ rowId: 'eng-e2', weekday: 2, lessonNumber: 2 }],
    );
    expect(problems).toEqual([]);
    expect(blocks).toEqual([]);
  });

  it('pairs two consecutive lessons of a doubles row, a break between them allowed', () => {
    const { blocks } = importedBlocks(doublesModel, [
      lesson(3, 'math-7a', 1, 1),
      lesson(4, 'math-7a', 1, 2),
    ]);
    const [a, b] = blocks;
    expect(a?.block.doublePairId).not.toBeNull();
    expect(a?.block.doublePairId).toBe(b?.block.doublePairId);
    expect(
      checkTimetable(
        checkedPlacements(
          doublesModel,
          blocks.map((one) => one.block),
        ),
        doublesModel.facts,
      ).filter((one) => one.rule === 'double_apart' || one.rule === 'double_not_allowed'),
    ).toEqual([]);
  });

  it('pairs a run of three from the earliest and leaves the third single', () => {
    const { blocks } = importedBlocks(doublesModel, [
      lesson(5, 'math-7a', 1, 3),
      lesson(3, 'math-7a', 1, 1),
      lesson(4, 'math-7a', 1, 2),
    ]);
    const pairOf = (key: number) => blocks.find((one) => one.keys[0] === key)?.block.doublePairId;
    expect(pairOf(3)).not.toBeNull();
    expect(pairOf(3)).toBe(pairOf(4));
    expect(pairOf(5)).toBeNull();
  });

  it('never pairs lessons two numbers apart, or of a row without doubles', () => {
    const apart = importedBlocks(doublesModel, [
      lesson(3, 'math-7a', 1, 1),
      lesson(4, 'math-7a', 1, 3),
    ]).blocks;
    expect(apart.map((one) => one.block.doublePairId)).toEqual([null, null]);
    const single = importedBlocks(model, [
      lesson(3, 'math-7a', 1, 3),
      lesson(4, 'math-7a', 1, 4),
    ]).blocks;
    expect(single.map((one) => one.block.doublePairId)).toEqual([null, null]);
  });

  it('tells a lesson number or a weekday the day does not have', () => {
    const { blocks, problems } = importedBlocks(model, [
      lesson(3, 'math-7a', 1, 5),
      lesson(4, 'math-7b', 6, 1),
    ]);
    expect(blocks).toEqual([]);
    expect(problems).toEqual([
      { key: 3, code: 'pattern_import_no_slot' },
      { key: 4, code: 'pattern_import_no_slot' },
    ]);
  });

  it('leaves clashes to the engine, by clock time across two templates', () => {
    // Teacher t1: 7a's lesson 2 (08:50–09:35) and 2a's lesson 3 (09:30–10:10) meet by clock time.
    const { blocks, problems } = importedBlocks(model, [
      lesson(3, 'math-7a', 1, 2),
      lesson(4, 'math-2a', 1, 3),
    ]);
    expect(problems).toEqual([]);
    const results = checkTimetable(
      checkedPlacements(
        model,
        blocks.map((one) => one.block),
      ),
      model.facts,
    ).filter((one) => one.rule === 'teacher_double');
    expect(results).toHaveLength(1);
    expect(results[0]?.lessonIds.map(importKeyOf).sort()).toEqual([3, 4]);
  });

  it('pairs a mixed half with one partner of another subject in the slot', () => {
    const half = (
      id: string,
      groupId: string,
      subjectId: string,
      block: string[],
    ): PatternRowData =>
      row(id, { classId: null, groupId, subjectId, teacherId: 't3', mixedBlock: true, block });
    const base = patternData([
      ...ROWS,
      half('pe-b', '7a-e1', 'math', ['pe-b', 'pe-g']),
      half('pe-g', '7a-e2', 'math', ['pe-b', 'pe-g']),
      half('tech-b', '7a-e1', 'science', ['tech-b', 'tech-g']),
      half('tech-g', '7a-e2', 'science', ['tech-b', 'tech-g']),
    ]);
    const mixed = patternModel(base);
    const lessons: ImportLesson[] = [lesson(3, 'pe-b', 3, 1), lesson(4, 'tech-g', 3, 1)];
    const { blocks, problems } = importedBlocks(mixed, lessons);
    expect(problems).toEqual([]);
    expect(blocks.map((one) => one.block.lessons.map((l) => l.loadRowId))).toEqual([
      ['pe-b', 'tech-g'],
    ]);
  });

  it('groups a slot the same way whatever the order of its rows (spec review of the code)', () => {
    const half = (
      id: string,
      groupId: string,
      subjectId: string,
      block: string[],
    ): PatternRowData =>
      row(id, { classId: null, groupId, subjectId, teacherId: 't3', mixedBlock: true, block });
    const mixed = patternModel(
      patternData([
        ...ROWS,
        half('pe-b', '7a-e1', 'math', ['pe-b', 'pe-g']),
        half('pe-g', '7a-e2', 'math', ['pe-b', 'pe-g']),
        half('tech-b', '7a-e1', 'science', ['tech-b', 'tech-g']),
        half('tech-g', '7a-e2', 'science', ['tech-b', 'tech-g']),
      ]),
    );
    const orders = [
      [lesson(3, 'tech-g', 3, 1), lesson(4, 'pe-b', 3, 1), lesson(5, 'pe-g', 3, 1)],
      [lesson(4, 'pe-b', 3, 1), lesson(5, 'pe-g', 3, 1), lesson(3, 'tech-g', 3, 1)],
    ];
    for (const lessons of orders) {
      const { blocks, problems } = importedBlocks(mixed, lessons);
      // The whole PE split is one block; technology given in part is told; no lesson twice.
      expect(blocks.map((one) => one.block.lessons.map((l) => l.loadRowId))).toEqual([
        ['pe-b', 'pe-g'],
      ]);
      expect(problems).toEqual([
        { key: 3, code: 'pattern_import_block_part', missingRowIds: ['tech-b'] },
      ]);
    }
  });

  it('reads back the row number of a lesson of the file only', () => {
    expect(importKeyOf(importLessonId(17))).toBe(17);
    expect(importKeyOf('entry-1')).toBeNull();
  });
});
