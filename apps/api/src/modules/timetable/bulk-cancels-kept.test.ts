import type { DatedLesson } from '@sodiq/timetable-rules';
import { dayDecisionKeyOf } from '@sodiq/shared';
import { describe, expect, it } from 'vitest';
import {
  bulkKeyPartOf,
  bulkWritePlanOf,
  sortBulkOf,
  type BulkRecord,
  type SortedBulk,
} from './bulk-cancels-kept.js';
import { placeKeyOf } from './dated-lessons.js';

// All names are invented. Task 5.6a-5b-1, pull request #165: the bulk cancels
// of 5.6a-3 applied again after a publish (edge/timetable, Versions and
// drafts: "One-day changes, absences, room closures and exams are stored on
// their own and applied again after a publish. The preview sorts them into
// kept, needs a decision and dropped."; After publishing, the 7 Oxford row).
// The records are read from the database by `bulkRecordsOf`, tested on the
// routes (`bulk-cancels.test.ts`); the sorting and the write plan are pure.

const DATE = '2026-10-19';
const OXFORD = '01b15000-0000-7000-8000-000000000001';
const PRINCETON = '01b15000-0000-7000-8000-000000000002';
const MATHS = '01b15000-0000-7000-8000-000000000003';
const ENGLISH = '01b15000-0000-7000-8000-000000000004';
const BULK = '01b15000-0000-7000-8000-000000000005';
const SECOND = '01b15000-0000-7000-8000-000000000006';
const GROUP_BOTH = '01b15000-0000-7000-8000-000000000007';
const GROUP_OXFORD = '01b15000-0000-7000-8000-000000000008';
const BLOCK_MATHS = '01b15000-0000-7000-8000-000000000009';
const BLOCK_ENGLISH = '01b15000-0000-7000-8000-00000000000a';
const BLOCK_PHYSICS_1 = '01b15000-0000-7000-8000-00000000000b';
const BLOCK_PHYSICS_2 = '01b15000-0000-7000-8000-00000000000c';
const STORED_BLOCK = '01b15000-0000-7000-8000-00000000000d';
const PHYSICS = '01b15000-0000-7000-8000-00000000000e';

/** Midnight of the date in Tashkent (+05:00). */
const begins = (date: string) => new Date(`${date}T00:00:00+05:00`);
const at = (minutes: number) => new Date(begins(DATE).getTime() + minutes * 60_000);

function lessonOf(input: {
  entry: string;
  block: string;
  start: number;
  end?: number;
  classId?: string;
  groupId?: string;
  classIds: string[];
  subject: string;
  pair?: string;
  date?: string;
  patternDate?: string;
}): DatedLesson {
  const date = input.date ?? DATE;
  return {
    entryId: input.entry,
    date,
    tutorFollowed: false,
    followsWeekday: 1,
    placement: {
      id: `${input.entry}@${date}`,
      kind: 'lesson',
      branchId: 'branch',
      day: date,
      start: input.start,
      end: input.end ?? input.start + 45,
      blockId: `${input.block}@${input.patternDate ?? date}`,
      doublePairId: input.pair ?? null,
      classId: input.classId ?? null,
      groupId: input.groupId ?? null,
      classIds: input.classIds,
      studentIds: [],
      exemptStudentIds: [],
      subjectId: input.subject,
      loadRowId: 'row',
      teacherIds: [],
      substitute: false,
      roomId: null,
      examRooms: [],
      fixed: false,
    },
  };
}

/** 7 Oxford's maths in lesson 1 (08:00) and the English block of 7-E-1 (both classes) and 7-E-3 (Oxford) in lesson 2 (08:55). */
const oxfordMaths = lessonOf({
  entry: 'e-maths',
  block: BLOCK_MATHS,
  start: 480,
  classId: OXFORD,
  classIds: [OXFORD],
  subject: MATHS,
});
const princetonMaths = lessonOf({
  entry: 'e-maths-p',
  block: '01b15000-0000-7000-8000-0000000000f0',
  start: 480,
  classId: PRINCETON,
  classIds: [PRINCETON],
  subject: MATHS,
});
const englishBoth = lessonOf({
  entry: 'e-english-1',
  block: BLOCK_ENGLISH,
  start: 535,
  groupId: GROUP_BOTH,
  classIds: [OXFORD, PRINCETON],
  subject: ENGLISH,
});
const englishOxford = lessonOf({
  entry: 'e-english-3',
  block: BLOCK_ENGLISH,
  start: 535,
  groupId: GROUP_OXFORD,
  classIds: [OXFORD],
  subject: ENGLISH,
});

/** A bulk cancel of 7 Oxford on the date in lessons 1 and 2 (08:00 to 09:40). */
function recordOf(input: Partial<BulkRecord> = {}): BulkRecord {
  return {
    id: BULK,
    date: DATE,
    reason: 'Excursion to the museum',
    changedAt: new Date('2026-10-10T10:00:00Z'),
    classIds: [OXFORD],
    spans: [
      { classId: OXFORD, startsAt: at(480), endsAt: at(525) },
      { classId: OXFORD, startsAt: at(535), endsAt: at(580) },
    ],
    stored: [],
    ...input,
  };
}

const sort = (
  lessons: DatedLesson[],
  records: BulkRecord[] = [recordOf()],
  movedAt: ReadonlyMap<DatedLesson, Date> = new Map(),
): SortedBulk[] => sortBulkOf({ lessons, movedAt, begins, records, carriedVersionId: null });

const keyOf = (lesson: DatedLesson) =>
  placeKeyOf(lesson.entryId, lesson.placement.blockId?.split('@')[1] ?? lesson.date, lesson.date);

describe('sortBulkOf', () => {
  it('cancels the lessons of a chosen class in its spans on the lessons the write creates, never another class’s', () => {
    const [item] = sort([oxfordMaths, princetonMaths]);
    expect(item?.answer).toMatchObject({ key: BULK, category: 'kept', cancelled: 1, blocks: [] });
    expect(item?.plain).toEqual([oxfordMaths]);
    const plan = bulkWritePlanOf(sort([oxfordMaths, princetonMaths]), new Map());
    // Written on a created lesson only (decision 4): the write keeps a paired one as stored.
    expect(plan.bulkCancels).toEqual(new Map([[keyOf(oxfordMaths), 'Excursion to the museum']]));
    expect(plan.cancels).toEqual(new Map());
  });

  it('reads the spans by clock time: a lesson of a 40-minute day overlapping a span is in, one after it is not', () => {
    const short = lessonOf({
      entry: 'e-short',
      block: '01b15000-0000-7000-8000-0000000000f1',
      start: 520,
      end: 560,
      classId: OXFORD,
      classIds: [OXFORD],
      subject: MATHS,
    });
    const late = lessonOf({
      entry: 'e-late',
      block: '01b15000-0000-7000-8000-0000000000f2',
      start: 580,
      end: 620,
      classId: OXFORD,
      classIds: [OXFORD],
      subject: MATHS,
    });
    expect(sort([short, late])[0]?.plain).toEqual([short]);
  });

  it('lists a block fed by a class not chosen as needing a decision, with the parts of chosen classes alone (the 7 Oxford row)', () => {
    const [item] = sort([englishBoth, englishOxford]);
    expect(item?.answer.category).toBe('decide');
    expect(item?.plain).toEqual([]);
    expect(item?.blocks).toHaveLength(1);
    expect(item?.blocks[0]).toMatchObject({
      patternBlockId: BLOCK_ENGLISH,
      blockDate: DATE,
      carried: null,
      decisionKey: dayDecisionKeyOf({ key: BULK, blockId: BLOCK_ENGLISH, blockDate: DATE }),
    });
    expect(item?.blocks[0]?.chosenOnly).toEqual([englishOxford]);
    expect(item?.answer.blocks[0]).toMatchObject({
      chosenClassIds: [OXFORD],
      otherClassIds: [PRINCETON],
      choice: null,
      start: 535,
      end: 580,
    });
    // A group fed by chosen classes alone is cancelled with no question.
    const [only] = sort([englishOxford]);
    expect(only?.answer.category).toBe('kept');
    expect(only?.plain).toEqual([englishOxford]);
  });

  it('writes a decided block on every lesson of it, kept or created: “cancel” all, “keep” the chosen classes’ parts alone', () => {
    const items = sort([englishBoth, englishOxford]);
    const key = items[0]?.blocks[0]?.decisionKey ?? '';
    const cancel = bulkWritePlanOf(items, new Map([[key, 'cancel']]));
    expect([...cancel.cancels.keys()].sort()).toEqual(
      [keyOf(englishBoth), keyOf(englishOxford)].sort(),
    );
    expect(cancel.bulkCancels).toEqual(new Map());
    const keep = bulkWritePlanOf(items, new Map([[key, 'keep']]));
    expect([...keep.cancels.keys()]).toEqual([keyOf(englishOxford)]);
  });

  it('carries a stored choice to a block with the same lessons, onto the lessons the write creates, and asks again for a block that differs (decision 5)', () => {
    const storedLessons = [
      { unitId: GROUP_BOTH, subjectId: ENGLISH, startsAt: at(535), endsAt: at(580) },
      { unitId: GROUP_OXFORD, subjectId: ENGLISH, startsAt: at(535), endsAt: at(580) },
    ];
    const keep = recordOf({
      stored: [{ blockId: STORED_BLOCK, choice: 'keep', lessons: storedLessons }],
    });
    const [kept] = sort([englishBoth, englishOxford], [keep]);
    expect(kept?.answer.category).toBe('kept');
    expect(kept?.answer.blocks[0]?.choice).toBe('keep');
    expect(kept?.answer.cancelled).toBe(1);
    const plan = bulkWritePlanOf([kept as SortedBulk], new Map());
    expect([...plan.bulkCancels.keys()]).toEqual([keyOf(englishOxford)]);
    expect(plan.cancels).toEqual(new Map());
    const cancel = recordOf({
      stored: [{ blockId: STORED_BLOCK, choice: 'cancel', lessons: storedLessons }],
    });
    const [whole] = sort([englishBoth, englishOxford], [cancel]);
    expect(whole?.answer.blocks[0]?.choice).toBe('cancel');
    expect(whole?.answer.cancelled).toBe(2);
    // The new version's block with one part fewer: asked again.
    const [changed] = sort([englishBoth], [keep]);
    expect(changed?.answer.category).toBe('decide');
  });

  it('leaves a chosen class’s lesson in the place of a stored block that is gone (a row with no block) to be cancelled with no question', () => {
    // A row whose block an earlier publish removed is not read (`block_id` null): no stored choice.
    const [item] = sort([englishOxford], [recordOf({ stored: [] })]);
    expect(item?.answer.category).toBe('kept');
    expect(item?.plain).toEqual([englishOxford]);
  });

  it('brings in the other half of a double in the spans with the same treatment (decision 7)', () => {
    const first = lessonOf({
      entry: 'e-physics-1',
      block: BLOCK_PHYSICS_1,
      start: 535,
      classId: OXFORD,
      classIds: [OXFORD],
      subject: PHYSICS,
      pair: 'pair@2026-10-19',
    });
    const second = lessonOf({
      entry: 'e-physics-2',
      block: BLOCK_PHYSICS_2,
      start: 590,
      classId: OXFORD,
      classIds: [OXFORD],
      subject: PHYSICS,
      pair: 'pair@2026-10-19',
    });
    expect(sort([first, second])[0]?.plain).toEqual([first, second]);
  });

  it('takes a lesson a move recorded before the bulk cancel put in its spans, and leaves one a later move put there (decision 9)', () => {
    const movedIn = lessonOf({
      entry: 'e-moved',
      block: '01b15000-0000-7000-8000-0000000000f3',
      start: 480,
      classId: OXFORD,
      classIds: [OXFORD],
      subject: MATHS,
      patternDate: '2026-10-12',
    });
    const before = new Map([[movedIn, new Date('2026-10-09T10:00:00Z')]]);
    expect(sort([movedIn], [recordOf()], before)[0]?.plain).toEqual([movedIn]);
    const after = new Map([[movedIn, new Date('2026-10-11T10:00:00Z')]]);
    expect(sort([movedIn], [recordOf()], after)[0]?.plain).toEqual([]);
    expect(sort([movedIn], [recordOf()], after)[0]?.answer).toMatchObject({
      category: 'kept',
      cancelled: 0,
    });
  });

  it('lists a bulk cancel with nothing in its spans as kept with no lesson cancelled, never dropped (decision 3)', () => {
    const [item] = sort([princetonMaths]);
    expect(item?.answer).toMatchObject({ category: 'kept', cancelled: 0, blocks: [] });
  });

  it('names a pattern block met twice on the date (its own and a move of it from a week earlier) as two blocks with two keys', () => {
    const own = englishBoth;
    const movedHere = lessonOf({
      entry: 'e-english-1',
      block: BLOCK_ENGLISH,
      start: 480,
      groupId: GROUP_BOTH,
      classIds: [OXFORD, PRINCETON],
      subject: ENGLISH,
      patternDate: '2026-10-12',
    });
    const [item] = sort([own, movedHere]);
    const keys = item?.blocks.map((one) => [one.blockDate, one.decisionKey]);
    expect(keys).toEqual([
      [
        '2026-10-12',
        dayDecisionKeyOf({ key: BULK, blockId: BLOCK_ENGLISH, blockDate: '2026-10-12' }),
      ],
      [DATE, dayDecisionKeyOf({ key: BULK, blockId: BLOCK_ENGLISH, blockDate: DATE })],
    ]);
    // One choice reaches its own block alone.
    const plan = bulkWritePlanOf(
      item === undefined ? [] : [item],
      new Map([[item?.blocks[1]?.decisionKey ?? '', 'cancel']]),
    );
    expect([...plan.cancels.keys()]).toEqual([keyOf(own)]);
  });

  it('cancels a block two bulk cancels share when one keeps it and the other cancels it (decision 13)', () => {
    const princetonEvent = recordOf({
      id: SECOND,
      classIds: [PRINCETON],
      spans: [{ classId: PRINCETON, startsAt: at(535), endsAt: at(580) }],
      changedAt: new Date('2026-10-10T11:00:00Z'),
    });
    const items = sort([englishBoth, englishOxford], [recordOf(), princetonEvent]);
    const decisions = new Map(
      items.map((item) => [
        item.blocks[0]?.decisionKey ?? '',
        item.answer.key === BULK ? ('keep' as const) : ('cancel' as const),
      ]),
    );
    const plan = bulkWritePlanOf(items, decisions);
    expect([...plan.cancels.keys()].sort()).toEqual(
      [keyOf(englishBoth), keyOf(englishOxford)].sort(),
    );
  });

  it('changes its key with a bulk cancel added', () => {
    const one = bulkKeyPartOf(sort([oxfordMaths]));
    const two = bulkKeyPartOf(
      sort(
        [oxfordMaths],
        [recordOf(), recordOf({ id: SECOND, changedAt: new Date('2026-10-10T11:00:00Z') })],
      ),
    );
    expect(one).not.toBe(two);
  });
});
