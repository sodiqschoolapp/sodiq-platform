import { describe, expect, it } from 'vitest';
import {
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
