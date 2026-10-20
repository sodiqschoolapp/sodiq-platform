import { describe, expect, it } from 'vitest';
import {
  CHANGED_MARK_DAYS,
  publishBodySchema,
  withdrawBodySchema,
  isMarkedChanged,
  lessonStateOf,
  LOAD_LESSONS_MAX,
  lessonRoomRecordSchema,
  placeRecordSchema,
  rearrangeRecordSchema,
  loadRowEditSchema,
  loadRowRecordSchema,
  loadTeachersQuerySchema,
  timetableVersionCreateSchema,
  timetableVersionEditSchema,
} from './timetable.js';

const CLASS = '0190a3c4-0000-7000-8000-000000000001';
const GROUP = '0190a3c4-0000-7000-8000-000000000002';
const SUBJECT = '0190a3c4-0000-7000-8000-000000000003';
const TEACHER = '0190a3c4-0000-7000-8000-000000000004';
const ROOM = '0190a3c4-0000-7000-8000-000000000005';

const row = {
  classId: CLASS,
  groupId: null,
  subjectId: SUBJECT,
  teacherId: TEACHER,
  lessonsPerWeek: 3,
  roomId: null,
  roomType: null,
  doubleLessons: false,
};

// Task 3.4a, pull request #99: 05, Teaching load ("one teacher or one
// vacancy, lessons per week, the room or room type if a special one is
// needed"); decisions 12 and 13; correction 3.
describe('a load row', () => {
  it('takes a class or a group, never both or neither', () => {
    expect(loadRowRecordSchema.safeParse(row).success).toBe(true);
    expect(loadRowRecordSchema.safeParse({ ...row, classId: null, groupId: GROUP }).success).toBe(
      true,
    );
    expect(loadRowRecordSchema.safeParse({ ...row, groupId: GROUP }).success).toBe(false);
    expect(loadRowRecordSchema.safeParse({ ...row, classId: null }).success).toBe(false);
  });

  // Correction 3 of 3.4a as changed by task 3.6c-2 (decision 1): a Tutor row
  // is sent without a teacher (`null`), so the schema takes `null`; the server
  // refuses `null` on a new row that is not a Tutor row (`load_teacher_needed`,
  // teaching-load.test.ts). The field itself stays required, and an id only.
  it('names its teacher, or null for the server to decide (task 3.6c-2)', () => {
    expect(loadRowRecordSchema.safeParse({ ...row, teacherId: null }).success).toBe(true);
    expect(loadRowRecordSchema.safeParse({ ...row, teacherId: undefined }).success).toBe(false);
    expect(loadRowRecordSchema.safeParse({ ...row, teacherId: 'Karimova' }).success).toBe(false);
  });

  it('holds lessons per week from 1 to LOAD_LESSONS_MAX', () => {
    expect(LOAD_LESSONS_MAX).toBe(40);
    for (const lessons of [1, LOAD_LESSONS_MAX]) {
      expect(loadRowRecordSchema.safeParse({ ...row, lessonsPerWeek: lessons }).success).toBe(true);
    }
    for (const lessons of [0, LOAD_LESSONS_MAX + 1, 2.5]) {
      expect(loadRowEditSchema.safeParse({ ...row, lessonsPerWeek: lessons }).success).toBe(false);
    }
  });

  it('names a room or a room type, not both (decision 13)', () => {
    expect(loadRowRecordSchema.safeParse({ ...row, roomId: ROOM }).success).toBe(true);
    expect(loadRowRecordSchema.safeParse({ ...row, roomType: 'laboratory' }).success).toBe(true);
    const both = loadRowEditSchema.safeParse({ ...row, roomId: ROOM, roomType: 'laboratory' });
    expect(both.success).toBe(false);
    expect(both.error?.issues[0]?.path).toEqual(['roomType']);
    expect(loadRowRecordSchema.safeParse({ ...row, roomType: 'garden' }).success).toBe(false);
  });

  it('asks for the teachers of a class or a group', () => {
    expect(loadTeachersQuerySchema.safeParse({ classId: CLASS, subjectId: SUBJECT }).success).toBe(
      true,
    );
    expect(
      loadTeachersQuerySchema.safeParse({ classId: CLASS, groupId: GROUP, subjectId: SUBJECT })
        .success,
    ).toBe(false);
    expect(loadTeachersQuerySchema.safeParse({ subjectId: SUBJECT }).success).toBe(false);
  });
});

describe('a draft version', () => {
  it('is created empty or as a copy', () => {
    expect(
      timetableVersionCreateSchema.parse({ academicYearId: CLASS, startsOn: '2026-10-19' })
        .copyFrom,
    ).toBeNull();
    expect(
      timetableVersionCreateSchema.safeParse({ academicYearId: CLASS, startsOn: '19.10.2026' })
        .success,
    ).toBe(false);
  });

  it('is edited by its start date or the dismissal of its left rows', () => {
    expect(timetableVersionEditSchema.safeParse({ startsOn: '2026-10-26' }).success).toBe(true);
    expect(timetableVersionEditSchema.safeParse({ dismissLeftRows: true }).success).toBe(true);
    expect(timetableVersionEditSchema.safeParse({}).success).toBe(false);
    expect(timetableVersionEditSchema.safeParse({ dismissLeftRows: false }).success).toBe(false);
  });
});

// Task 5.4c-2: the bodies an undo sends (decision 7: `null` is no room).
describe('the bodies of an undo', () => {
  const BLOCK = '0190a3c4-0000-7000-8000-000000000010';
  const OTHER = '0190a3c4-0000-7000-8000-000000000011';
  const ROW = '0190a3c4-0000-7000-8000-000000000012';
  const at = { weekday: 1, slotPosition: 2 };

  it('places a block with the room of each lesson by load row, or with one room, not both', () => {
    expect(
      placeRecordSchema.safeParse({
        loadRowId: ROW,
        ...at,
        rooms: [{ loadRowId: ROW, roomId: null }],
      }).success,
    ).toBe(true);
    expect(
      placeRecordSchema.safeParse({
        loadRowId: ROW,
        ...at,
        roomId: ROOM,
        rooms: [{ loadRowId: ROW, roomId: ROOM }],
      }).success,
    ).toBe(false);
    expect(
      placeRecordSchema.safeParse({
        loadRowId: ROW,
        ...at,
        rooms: [
          { loadRowId: ROW, roomId: ROOM },
          { loadRowId: ROW, roomId: null },
        ],
      }).success,
    ).toBe(false);
  });

  // Task 5.4c-3a (review correction 1): a double lesson.
  it('places a double lesson with true or false only, a single one when left out', () => {
    for (const double of [true, false, undefined]) {
      expect(placeRecordSchema.safeParse({ loadRowId: ROW, ...at, double }).success).toBe(true);
    }
    for (const double of ['yes', 1, null]) {
      expect(placeRecordSchema.safeParse({ loadRowId: ROW, ...at, double }).success).toBe(false);
    }
  });

  it('gives a lesson no room', () => {
    expect(lessonRoomRecordSchema.safeParse({ lessonId: BLOCK, roomId: null }).success).toBe(true);
    expect(lessonRoomRecordSchema.safeParse({ lessonId: BLOCK }).success).toBe(false);
  });

  it('removes one block with up to two moves, a block once, one to three in all', () => {
    const move = { blockId: BLOCK, ...at };
    expect(rearrangeRecordSchema.safeParse({ changes: [], remove: [OTHER] }).success).toBe(true);
    expect(rearrangeRecordSchema.safeParse({ changes: [move], remove: [OTHER] }).success).toBe(
      true,
    );
    expect(rearrangeRecordSchema.safeParse({ changes: [] }).success).toBe(false);
    expect(rearrangeRecordSchema.safeParse({ changes: [move], remove: [BLOCK] }).success).toBe(
      false,
    );
    expect(rearrangeRecordSchema.safeParse({ changes: [], remove: [OTHER, BLOCK] }).success).toBe(
      false,
    );
    expect(
      rearrangeRecordSchema.safeParse({
        changes: [move, { blockId: ROOM, ...at }, { blockId: CLASS, ...at }],
        remove: [OTHER],
      }).success,
    ).toBe(false);
    expect(
      rearrangeRecordSchema.safeParse({
        changes: [{ ...move, rooms: [{ loadRowId: ROW, roomId: null }] }],
      }).success,
    ).toBe(true);
  });
});

// Task 5.4c-3b: the partner of a mixed half in one block.
describe('the partner of a pairing', () => {
  const ROW = '0190a3c4-0000-7000-8000-000000000020';
  const PARTNER = '0190a3c4-0000-7000-8000-000000000021';
  const BLOCK = '0190a3c4-0000-7000-8000-000000000022';
  const at = { weekday: 1, slotPosition: 2 };

  it('places a row with a partner row, or with none', () => {
    expect(
      placeRecordSchema.safeParse({ loadRowId: ROW, partnerRowId: PARTNER, ...at }).success,
    ).toBe(true);
    expect(placeRecordSchema.safeParse({ loadRowId: ROW, partnerRowId: 'x', ...at }).success).toBe(
      false,
    );
  });

  it('takes a partner in a rearrange change of a new block only', () => {
    expect(
      rearrangeRecordSchema.safeParse({
        changes: [{ loadRowId: ROW, partnerRowId: PARTNER, ...at }],
      }).success,
    ).toBe(true);
    expect(
      rearrangeRecordSchema.safeParse({
        changes: [{ blockId: BLOCK, partnerRowId: PARTNER, ...at }],
      }).success,
    ).toBe(false);
  });
});

// Task 5.5c-3a: "Changed lessons carry a 'changed' mark on every timetable
// view for a week" (`06`, How surprises are prevented).
describe('the changed mark', () => {
  const changedAt = new Date('2026-10-10T18:55:00Z');
  const later = (ms: number) => new Date(changedAt.getTime() + ms);
  const DAY = 86_400_000;

  it('lasts seven days from the change, half-open', () => {
    expect(CHANGED_MARK_DAYS).toBe(7);
    expect(isMarkedChanged(changedAt, changedAt)).toBe(true);
    expect(isMarkedChanged(changedAt, later(7 * DAY - 1))).toBe(true);
    expect(isMarkedChanged(changedAt, later(7 * DAY))).toBe(false);
  });

  it('is not shown without a change, or before it', () => {
    expect(isMarkedChanged(null, changedAt)).toBe(false);
    expect(isMarkedChanged(changedAt, later(-1))).toBe(false);
  });
});

// Task 5.6a-4: edge/00-definitions, Held lesson: "A lesson whose start time
// has passed, which is not cancelled, and which has a teacher recorded (not
// 'needs a teacher' or 'unresolved')"; edge/timetable, After publishing, "The
// lesson time passes and nobody was assigned": "It never counts as held".
describe('the state of a lesson', () => {
  const startsAt = new Date('2026-10-12T04:00:00Z');
  const before = new Date(startsAt.getTime() - 1);
  const state = (
    teacher: 'person' | 'vacancy' | null,
    cancelled: boolean,
    now: Date,
    absent = false,
  ) => lessonStateOf({ startsAt, cancelled, teacher, absent }, now);

  it('is upcoming or needs a teacher before its start', () => {
    expect(state('person', false, before)).toBe('upcoming');
    expect(state(null, false, before)).toBe('needs_teacher');
    expect(state('vacancy', false, before)).toBe('needs_teacher');
  });

  it('is held from its exact start only with a person recorded', () => {
    expect(state('person', false, startsAt)).toBe('held');
  });

  it('is unresolved, never held, from its start with no teacher or a vacancy', () => {
    expect(state(null, false, startsAt)).toBe('unresolved');
    expect(state('vacancy', false, startsAt)).toBe('unresolved');
  });

  // Task 5.7a-1: a lesson of an absent person keeps its teacher and is "needs
  // a teacher", then "unresolved" (edge/timetable, After publishing).
  it('needs a teacher, then is unresolved, never held, while its person is absent', () => {
    expect(state('person', false, before, true)).toBe('needs_teacher');
    expect(state('person', false, startsAt, true)).toBe('unresolved');
    expect(state('vacancy', false, before, true)).toBe('needs_teacher');
    expect(state('vacancy', false, startsAt, true)).toBe('unresolved');
  });

  it('is cancelled, never held, whoever its teacher is', () => {
    for (const now of [before, startsAt]) {
      expect(state('person', true, now, true)).toBe('cancelled');
      expect(state('person', true, now)).toBe('cancelled');
      expect(state(null, true, now)).toBe('cancelled');
      expect(state('vacancy', true, now)).toBe('cancelled');
    }
  });
});

// Task 5.6a-5b-1, pull request #165: a bulk cancel's block is decided by its
// key, block and block date together; one choice per triple.
describe('publishBodySchema: the decisions of bulk cancels’ blocks', () => {
  const KEY = '01b15000-0000-7000-8000-000000000001';
  const BLOCK_A = '01b15000-0000-7000-8000-000000000002';
  const BLOCK_B = '01b15000-0000-7000-8000-000000000003';
  const one = (blockId: string, choice: 'keep' | 'cancel' = 'keep') => ({
    key: KEY,
    blockId,
    blockDate: '2026-10-19',
    choice,
  });

  it('takes one key with two blocks, and refuses the same key, block and date twice', () => {
    expect(
      publishBodySchema.safeParse({
        startsOn: '2026-10-19',
        dayDecisions: [one(BLOCK_A), one(BLOCK_B, 'cancel')],
      }).success,
    ).toBe(true);
    expect(
      publishBodySchema.safeParse({
        startsOn: '2026-10-19',
        dayDecisions: [one(BLOCK_A), one(BLOCK_A, 'cancel')],
      }).success,
    ).toBe(false);
  });

  it('refuses a block without its date, and a date without its block', () => {
    for (const decision of [
      { key: KEY, blockId: BLOCK_A, choice: 'keep' },
      { key: KEY, blockDate: '2026-10-19', choice: 'keep' },
    ]) {
      expect(
        publishBodySchema.safeParse({ startsOn: '2026-10-19', dayDecisions: [decision] }).success,
      ).toBe(false);
    }
  });
});

// Task 5.6a-5b-2: a withdraw takes the publish's key of the sorting and its
// decisions; no body, or `{}`, is a withdraw over dates with nothing stored.
describe('withdrawBodySchema', () => {
  const KEY = '01b15000-0000-7000-8000-000000000001';
  const BLOCK = '01b15000-0000-7000-8000-000000000002';

  it('takes no body and an empty one as no key and no decisions', () => {
    expect(withdrawBodySchema.parse(undefined)).toEqual({});
    expect(withdrawBodySchema.parse({})).toEqual({});
  });

  it('takes the key and the decisions of a publish, and refuses another field', () => {
    expect(
      withdrawBodySchema.safeParse({
        dayChangesKey: 'a'.repeat(64),
        dayDecisions: [
          { key: KEY, choice: 'drop' },
          { key: KEY, blockId: BLOCK, blockDate: '2026-10-26', choice: 'keep' },
        ],
      }).success,
    ).toBe(true);
    expect(withdrawBodySchema.safeParse({ startsOn: '2026-10-26' }).success).toBe(false);
  });

  it('refuses a block without its date, and one key and block twice', () => {
    expect(
      withdrawBodySchema.safeParse({ dayDecisions: [{ key: KEY, blockId: BLOCK, choice: 'keep' }] })
        .success,
    ).toBe(false);
    const twice = { key: KEY, blockId: BLOCK, blockDate: '2026-10-26', choice: 'keep' };
    expect(
      withdrawBodySchema.safeParse({ dayDecisions: [twice, { ...twice, choice: 'cancel' }] })
        .success,
    ).toBe(false);
  });
});
