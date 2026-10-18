import { describe, expect, it } from 'vitest';
import {
  draftDifferences,
  mergeRowKey,
  pickedItems,
  takenPlan,
  type MergeEntry,
  type MergeRow,
  type MergeVersion,
} from './up-to-date.js';

// edge/timetable, Versions and drafts, "Two drafts are open": "Bringing one up
// to date lists what changed on both sides, and the Academic Vice Principal
// picks." 06, How surprises are prevented: "the differences are shown".

const row = (id: string, more: Partial<MergeRow> = {}): MergeRow => ({
  id,
  classId: 'class-a',
  groupId: null,
  subjectId: 'maths',
  teacherId: 'teacher-1',
  roomId: null,
  lessonsPerWeek: 2,
  roomType: null,
  doubleLessons: false,
  mixedBlock: false,
  shortReason: null,
  tutorRow: false,
  classIds: ['class-a'],
  ...more,
});

const entry = (
  id: string,
  loadRowId: string,
  blockId: string,
  more: Partial<MergeEntry> = {},
): MergeEntry => ({
  id,
  loadRowId,
  blockId,
  weekday: 1,
  slotPosition: 1,
  roomId: 'room-1',
  doublePairId: null,
  ...more,
});

/** Maths of class A on Monday 1 and Tuesday 2, art on Wednesday 3, a pin of maths on Monday 1. */
function version(prefix: string): MergeVersion {
  return {
    rows: [row(`${prefix}-maths`), row(`${prefix}-art`, { subjectId: 'art' })],
    entries: [
      entry(`${prefix}-e1`, `${prefix}-maths`, `${prefix}-b1`),
      entry(`${prefix}-e2`, `${prefix}-maths`, `${prefix}-b2`, { weekday: 2, slotPosition: 2 }),
      entry(`${prefix}-e3`, `${prefix}-art`, `${prefix}-b3`, { weekday: 3, slotPosition: 3 }),
    ],
    pins: [{ loadRowId: `${prefix}-maths`, weekday: 1, slotPosition: 1 }],
  };
}

const maths = mergeRowKey({ classId: 'class-a', groupId: null, subjectId: 'maths' });
const art = mergeRowKey({ classId: 'class-a', groupId: null, subjectId: 'art' });

/** A version with one row changed. */
function withRow(base: MergeVersion, id: string, more: Partial<MergeRow>): MergeVersion {
  return { ...base, rows: base.rows.map((one) => (one.id === id ? { ...one, ...more } : one)) };
}

describe('draftDifferences', () => {
  it('lists nothing when the draft and the published side hold the same, under other ids', () => {
    expect(draftDifferences(version('s'), version('d'), version('p'))).toEqual([]);
  });

  it('labels a change of the draft only, with the draft as the default pick', () => {
    const draft = withRow(version('d'), 'd-maths', { teacherId: 'teacher-2' });
    const [item, ...rest] = draftDifferences(version('s'), draft, version('p'));
    expect(rest).toEqual([]);
    expect(item?.key).toBe(maths);
    expect(item?.changedBy).toBe('draft');
    expect(item?.defaultPick).toBe('draft');
    expect(item?.rows[0]?.draft?.teacherId).toBe('teacher-2');
    expect(item?.rows[0]?.published?.teacherId).toBe('teacher-1');
    expect(item?.rows[0]?.base?.teacherId).toBe('teacher-1');
  });

  it('labels a change of the published side only, with it as the default pick', () => {
    const published = withRow(version('p'), 'p-art', { lessonsPerWeek: 3 });
    const items = draftDifferences(version('s'), version('d'), published);
    expect(items.map((one) => [one.key, one.changedBy, one.defaultPick])).toEqual([
      [art, 'published', 'published'],
    ]);
  });

  it('gives no default when both sides changed an item, nor when there is no base', () => {
    const draft = withRow(version('d'), 'd-maths', { roomId: 'room-7' });
    const published = withRow(version('p'), 'p-maths', { roomId: 'room-8' });
    expect(
      draftDifferences(version('s'), draft, published).map((one) => [
        one.changedBy,
        one.defaultPick,
      ]),
    ).toEqual([['both', null]]);
    expect(
      draftDifferences(null, draft, version('p')).map((one) => [one.changedBy, one.defaultPick]),
    ).toEqual([['both', null]]);
  });

  it('lists a row only in the draft and a row only in the published side', () => {
    const draft: MergeVersion = {
      ...version('d'),
      rows: [...version('d').rows, row('d-music', { subjectId: 'music' })],
    };
    const published: MergeVersion = {
      ...version('p'),
      rows: [...version('p').rows, row('p-history', { subjectId: 'history' })],
    };
    const items = draftDifferences(version('s'), draft, published);
    expect(items.map((one) => [one.key, one.changedBy])).toEqual([
      ['class-a||history', 'published'],
      ['class-a||music', 'draft'],
    ]);
    expect(items[0]?.rows[0]?.draft).toBeNull();
    expect(items[1]?.rows[0]?.published).toBeNull();
  });

  it('counts a moved lesson, a lesson room and a pin as differences', () => {
    const moved: MergeVersion = {
      ...version('p'),
      entries: version('p').entries.map((one) =>
        one.id === 'p-e2' ? { ...one, slotPosition: 4 } : one,
      ),
    };
    const room: MergeVersion = {
      ...version('p'),
      entries: version('p').entries.map((one) =>
        one.id === 'p-e3' ? { ...one, roomId: 'room-9' } : one,
      ),
    };
    const pinned: MergeVersion = {
      ...version('p'),
      pins: [...version('p').pins, { loadRowId: 'p-art', weekday: 3, slotPosition: 3 }],
    };
    for (const [published, key] of [
      [moved, maths],
      [room, art],
      [pinned, art],
    ] as const) {
      expect(draftDifferences(version('s'), version('d'), published).map((one) => one.key)).toEqual(
        [key],
      );
    }
  });

  it('tells a double from two single lessons in the same slots (spec review must-fix 2)', () => {
    const singles: MergeVersion = {
      ...version('d'),
      entries: [
        entry('d-e1', 'd-maths', 'd-b1'),
        entry('d-e2', 'd-maths', 'd-b2', { slotPosition: 2 }),
      ],
      pins: [],
    };
    const double: MergeVersion = {
      ...version('p'),
      entries: [
        entry('p-e1', 'p-maths', 'p-b1', { doublePairId: 'pair-p' }),
        entry('p-e2', 'p-maths', 'p-b2', { slotPosition: 2, doublePairId: 'pair-p' }),
      ],
      pins: [],
    };
    const [item] = draftDifferences(null, singles, double);
    expect(item?.key).toBe(maths);
    expect(item?.rows[0]?.published?.placements.map((one) => one.pairedWith)).toEqual([
      { weekday: 1, slotPosition: 2 },
      { weekday: 1, slotPosition: 1 },
    ]);
    expect(item?.rows[0]?.draft?.placements.map((one) => one.pairedWith)).toEqual([null, null]);
  });

  it('never counts the teacher of a Tutor row as a difference (decision 6)', () => {
    const tutor = (prefix: string, teacherId: string): MergeVersion => ({
      rows: [row(`${prefix}-tutor`, { subjectId: 'manaviyat', tutorRow: true, teacherId })],
      entries: [],
      pins: [],
    });
    expect(draftDifferences(tutor('s', 't1'), tutor('d', 't2'), tutor('p', 't3'))).toEqual([]);
  });

  it('makes the halves of a split one item, picked whole (decision 5)', () => {
    const split = (prefix: string, teacher: string): MergeVersion => ({
      rows: [
        row(`${prefix}-g1`, {
          classId: null,
          groupId: 'group-1',
          subjectId: 'english',
          teacherId: teacher,
        }),
        row(`${prefix}-g2`, { classId: null, groupId: 'group-2', subjectId: 'english' }),
        row(`${prefix}-maths`),
      ],
      entries: [
        entry(`${prefix}-e1`, `${prefix}-g1`, `${prefix}-b1`),
        entry(`${prefix}-e2`, `${prefix}-g2`, `${prefix}-b1`, { roomId: 'room-2' }),
      ],
      pins: [],
    });
    const items = draftDifferences(split('s', 't1'), split('d', 't1'), split('p', 't5'));
    expect(items.map((one) => [one.key, one.rows.map((r) => r.key)])).toEqual([
      ['|group-1|english,|group-2|english', ['|group-1|english', '|group-2|english']],
    ]);
  });

  it('makes two subjects sharing a block one item (a mixed pairing), on either side', () => {
    const pairing: MergeVersion = {
      rows: [
        row('p-pe', { classId: null, groupId: 'boys', subjectId: 'pe', mixedBlock: true }),
        row('p-tech', { classId: null, groupId: 'girls', subjectId: 'tech', mixedBlock: true }),
      ],
      entries: [entry('p-e1', 'p-pe', 'p-b1'), entry('p-e2', 'p-tech', 'p-b1', { roomId: null })],
      pins: [],
    };
    const unplaced: MergeVersion = { ...pairing, entries: [] };
    const [item, ...rest] = draftDifferences(null, unplaced, pairing);
    expect(rest).toEqual([]);
    expect(item?.rows.map((one) => one.key)).toEqual(['|boys|pe', '|girls|tech']);
  });
});

describe('pickedItems', () => {
  const draft = withRow(version('d'), 'd-maths', { teacherId: 'teacher-2' });
  const published = withRow(version('p'), 'p-art', { lessonsPerWeek: 3 });
  const items = draftDifferences(version('s'), draft, published);

  it('needs a pick for every item (decision 7)', () => {
    expect(pickedItems(items, [{ item: maths, side: 'draft' }])).toEqual({
      ok: false,
      code: 'pick_missing',
    });
  });

  it('refuses a pick of an item not listed, or two picks of one', () => {
    expect(
      pickedItems(items, [
        { item: maths, side: 'draft' },
        { item: art, side: 'draft' },
        { item: 'class-z||maths', side: 'draft' },
      ]),
    ).toEqual({ ok: false, code: 'pick_unknown' });
    expect(
      pickedItems(items, [
        { item: maths, side: 'draft' },
        { item: maths, side: 'published' },
        { item: art, side: 'draft' },
      ]),
    ).toEqual({ ok: false, code: 'pick_unknown' });
  });

  it('gives the items picked from the published side', () => {
    const picked = pickedItems(items, [
      { item: maths, side: 'draft' },
      { item: art, side: 'published' },
    ]);
    expect(picked.ok && picked.published.map((one) => one.key)).toEqual([art]);
  });
});

describe('takenPlan', () => {
  it('changes a row in place, adds and removes rows, and replaces their blocks and pins', () => {
    const draft: MergeVersion = {
      ...version('d'),
      rows: [...version('d').rows, row('d-music', { subjectId: 'music' })],
      entries: [...version('d').entries, entry('d-e9', 'd-music', 'd-b9', { weekday: 5 })],
    };
    const published: MergeVersion = {
      rows: [
        ...withRow(version('p'), 'p-maths', { teacherId: 'teacher-3' }).rows,
        row('p-history', { subjectId: 'history' }),
      ],
      entries: [
        ...version('p').entries,
        entry('p-e8', 'p-history', 'p-b8', { weekday: 4, doublePairId: 'pair-8' }),
        entry('p-e9', 'p-history', 'p-b9', { weekday: 4, slotPosition: 2, doublePairId: 'pair-8' }),
      ],
      pins: [...version('p').pins, { loadRowId: 'p-history', weekday: 4, slotPosition: 1 }],
    };
    const items = draftDifferences(version('s'), draft, published);
    expect(items.map((one) => one.key)).toEqual(['class-a||history', maths, 'class-a||music']);
    expect(takenPlan(draft, published, items)).toEqual({
      updateRows: [{ draftId: 'd-maths', publishedId: 'p-maths' }],
      insertRows: ['p-history'],
      removeRows: ['d-music'],
      removeBlocks: ['d-b1', 'd-b2', 'd-b9'],
      insertBlocks: ['p-b1', 'p-b2', 'p-b8', 'p-b9'],
      pinRows: ['d-maths', 'p-history'],
      pins: [
        { loadRowId: 'd-maths', weekday: 1, slotPosition: 1 },
        { loadRowId: 'p-history', weekday: 4, slotPosition: 1 },
      ],
    });
  });

  it('takes nothing for no item', () => {
    expect(takenPlan(version('d'), version('p'), [])).toEqual({
      updateRows: [],
      insertRows: [],
      removeRows: [],
      removeBlocks: [],
      insertBlocks: [],
      pinRows: [],
      pins: [],
    });
  });
});
