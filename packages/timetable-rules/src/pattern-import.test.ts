// The lessons of a timetable import placed as the grid places them (task 5.14; `06`, Importing
// the load and the timetable, The timetable import). Invented data of `pattern-fixture.ts`.
import { describe, expect, it } from 'vitest';
import { checkTimetable } from './check.js';
import {
  patternModel,
  type PatternFactsData,
  type PatternModel,
  type PatternRowData,
  type PatternUnitData,
} from './facts-data.js';
import { checkedPlacements, newBlockOf } from './pattern-place.js';
import {
  importedBlocks,
  importKeyOf,
  importLessonId,
  type ImportedBlock,
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

  describe('one-sex halves paired with a partner (task 5.18)', () => {
    // A class of boys s1, s2 and girls s3, s4: PE and Swimming split by sex in blocks of two,
    // Gymnastics for girls only and Taekwondo for boys only, each a block of one row; every row
    // a mixed half (edge/timetable, Structure, the mixed block; `05`, groups for one sex).
    const SPORTS = ['pe', 'swim', 'gym', 'tkd'];
    const sportRow = (
      id: string,
      groupId: string,
      subjectId: string,
      teacherId: string,
      block: string[],
    ): PatternRowData =>
      row(id, {
        classId: null,
        groupId,
        subjectId,
        teacherId,
        lessonsPerWeek: 2,
        mixedBlock: true,
        block,
      });
    const sportRows = (boys: string, girls: string): PatternRowData[] => [
      sportRow('pe-b', boys, 'pe', 't3', ['pe-b', 'pe-g']),
      sportRow('pe-g', girls, 'pe', 't4', ['pe-b', 'pe-g']),
      sportRow('sw-b', boys, 'swim', 't5', ['sw-b', 'sw-g']),
      sportRow('sw-g', girls, 'swim', 't6', ['sw-b', 'sw-g']),
      sportRow('gym-g', girls, 'gym', 't5', ['gym-g']),
      sportRow('tkd-b', boys, 'tkd', 't6', ['tkd-b']),
    ];
    const group = (
      id: string,
      classIds: string[],
      studentIds: string[],
      sex: 'male' | 'female',
    ): PatternUnitData => ({
      id,
      kind: 'group',
      grades: [7],
      language: 'uz',
      tutorOnStart: null,
      classIds,
      studentIds,
      mainRoomId: null,
      sex,
    });
    const sportsData = (
      rows: PatternRowData[],
      units: PatternUnitData[],
      noStudents = false,
    ): PatternFactsData => {
      const base = patternData([...ROWS, ...rows]);
      return {
        ...base,
        subjects: [
          ...base.subjects,
          ...SPORTS.map((id) => ({
            id,
            active: true,
            languageRule: false,
            tutorSubject: false,
          })),
        ],
        units: [...base.units, ...units].map((one) =>
          noStudents ? { ...one, studentIds: [] } : one,
        ),
        classStudents: noStudents
          ? base.classStudents.map((one) => ({ ...one, studentIds: [] }))
          : base.classStudents,
      };
    };
    const oneClassUnits = [
      group('7a-boys', ['7a'], ['s1', 's2'], 'male'),
      group('7a-girls', ['7a'], ['s3', 's4'], 'female'),
    ];
    const sports = patternModel(sportsData(sportRows('7a-boys', '7a-girls'), oneClassUnits));

    /** The five sport slots of the file: one boys' and one girls' lesson of two subjects. */
    const PAIRINGS: [string, string][] = [
      ['pe-b', 'gym-g'],
      ['sw-b', 'gym-g'],
      ['pe-g', 'tkd-b'],
      ['pe-g', 'tkd-b'],
      ['pe-b', 'sw-g'],
    ];
    // Five slots, no two consecutive on one day (no row allows doubles anyway).
    const SLOTS: [number, number][] = [
      [1, 1],
      [1, 3],
      [2, 1],
      [3, 1],
      [4, 1],
    ];
    const fileOf = (pairings: readonly (readonly [string, string])[]): ImportLesson[] =>
      pairings.flatMap(([a, b], index) => {
        const [weekday, lessonNumber] = SLOTS[index] ?? [5, 1];
        return [
          lesson(10 + index * 2, a, weekday, lessonNumber),
          lesson(11 + index * 2, b, weekday, lessonNumber),
        ];
      });
    const rowsOf = (blocks: readonly ImportedBlock[]) =>
      blocks.map((one) => one.block.lessons.map((l) => l.loadRowId));
    const engine = (model: PatternModel, blocks: readonly ImportedBlock[]) =>
      checkTimetable(
        checkedPlacements(
          model,
          blocks.map((one) => one.block),
        ),
        model.facts,
      );
    const splitOrDouble = (model: PatternModel, blocks: readonly ImportedBlock[]) =>
      engine(model, blocks)
        .filter((one) => one.rule === 'split_apart' || one.rule === 'student_double')
        .map((one) => one.rule);

    it('imports the five sport pairings, each the block the grid builds, with no split apart', () => {
      const { blocks, problems } = importedBlocks(sports, fileOf(PAIRINGS));
      expect(problems).toEqual([]);
      expect(rowsOf(blocks)).toEqual(
        PAIRINGS.map(([a, b]) => newBlockOf(sports, a, b).lessons.map((one) => one.loadRowId)),
      );
      expect(rowsOf(blocks)).toEqual([
        ['gym-g', 'pe-b'],
        ['gym-g', 'sw-b'],
        ['pe-g', 'tkd-b'],
        ['pe-g', 'tkd-b'],
        ['pe-b', 'sw-g'],
      ]);
      expect(blocks.map((one) => one.block.doublePairId)).toEqual([null, null, null, null, null]);
      expect(splitOrDouble(sports, blocks)).toEqual([]);
    });

    it('groups the sport slots the same way whatever the order of the rows', () => {
      const forward = importedBlocks(sports, fileOf(PAIRINGS));
      const reversed = importedBlocks(sports, [...fileOf(PAIRINGS)].reverse());
      const swapped = importedBlocks(sports, fileOf(PAIRINGS.map(([a, b]) => [b, a] as const)));
      expect(reversed.problems).toEqual([]);
      expect(swapped.problems).toEqual([]);
      expect(rowsOf(reversed.blocks)).toEqual(rowsOf(forward.blocks));
      expect(rowsOf(swapped.blocks)).toEqual(rowsOf(forward.blocks));
    });

    it('still takes a lone one-sex block whole with no partner in its slot: the engine refuses it', () => {
      const { blocks, problems } = importedBlocks(sports, [lesson(3, 'gym-g', 1, 1)]);
      expect(problems).toEqual([]);
      expect(rowsOf(blocks)).toEqual([['gym-g']]);
      expect(splitOrDouble(sports, blocks)).toEqual(['split_apart']);
      // The student check of `checkBlocks`: the two boys have no lesson in the slot.
      expect(engine(sports, blocks).find((one) => one.rule === 'split_apart')?.detail).toEqual({
        students: 2,
      });
    });

    it('pairs two one-sex blocks of one row with each other', () => {
      const { blocks, problems } = importedBlocks(sports, [
        lesson(3, 'tkd-b', 1, 1),
        lesson(4, 'gym-g', 1, 1),
      ]);
      expect(problems).toEqual([]);
      expect(rowsOf(blocks)).toEqual([['gym-g', 'tkd-b']]);
      expect(splitOrDouble(sports, blocks)).toEqual([]);
    });

    it('leaves a one-sex block whole when its partner is in a whole block: the engine names the clash', () => {
      const orders = [
        [lesson(3, 'gym-g', 1, 1), lesson(4, 'pe-b', 1, 1), lesson(5, 'pe-g', 1, 1)],
        [lesson(4, 'pe-b', 1, 1), lesson(5, 'pe-g', 1, 1), lesson(3, 'gym-g', 1, 1)],
      ];
      for (const lessons of orders) {
        const { blocks, problems } = importedBlocks(sports, lessons);
        expect(problems).toEqual([]);
        expect(rowsOf(blocks)).toEqual([['gym-g'], ['pe-b', 'pe-g']]);
        expect(splitOrDouble(sports, blocks)).toContain('student_double');
      }
    });

    it('counts a held partner as present: nothing placed, nothing told, either way round', () => {
      const gymHeld = importedBlocks(
        sports,
        [lesson(3, 'pe-b', 1, 1)],
        [{ rowId: 'gym-g', weekday: 1, lessonNumber: 1 }],
      );
      expect(gymHeld).toEqual({ blocks: [], problems: [] });
      const peHeld = importedBlocks(
        sports,
        [lesson(3, 'gym-g', 1, 1)],
        [{ rowId: 'pe-b', weekday: 1, lessonNumber: 1 }],
      );
      expect(peHeld).toEqual({ blocks: [], problems: [] });
    });

    it('pairs the one-sex halves of a pair of classes that do these subjects together', () => {
      const pair = patternModel(
        sportsData(sportRows('7ab-boys', '7ab-girls'), [
          group('7ab-boys', ['7a', '7b'], ['s1', 's2', 's5'], 'male'),
          group('7ab-girls', ['7a', '7b'], ['s3', 's4', 's6'], 'female'),
        ]),
      );
      const { blocks, problems } = importedBlocks(pair, fileOf(PAIRINGS));
      expect(problems).toEqual([]);
      expect(rowsOf(blocks)).toEqual(rowsOf(importedBlocks(sports, fileOf(PAIRINGS)).blocks));
      expect(splitOrDouble(pair, blocks)).toEqual([]);
    });

    it('decides by the sex of the groups, not their students: classes with no students yet', () => {
      const empty = patternModel(sportsData(sportRows('7a-boys', '7a-girls'), oneClassUnits, true));
      const { blocks, problems } = importedBlocks(empty, fileOf(PAIRINGS));
      expect(problems).toEqual([]);
      expect(rowsOf(blocks)).toEqual(rowsOf(importedBlocks(sports, fileOf(PAIRINGS)).blocks));
    });

    it("accepts the pair in the engine: the rows of the pairing are each other's partners", () => {
      const [placed] = importedBlocks(sports, [
        lesson(3, 'pe-b', 1, 1),
        lesson(4, 'gym-g', 1, 1),
      ]).blocks;
      expect(placed).toBeDefined();
      const results = engine(sports, placed === undefined ? [] : [placed]);
      expect(results.filter((one) => one.rule === 'split_apart')).toEqual([]);
    });
  });

  it('reads back the row number of a lesson of the file only', () => {
    expect(importKeyOf(importLessonId(17))).toBe(17);
    expect(importKeyOf('entry-1')).toBeNull();
  });
});
