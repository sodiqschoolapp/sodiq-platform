import { describe, expect, it } from 'vitest';
import {
  branchRecordSchema,
  DEFAULT_WORKING_WEEKDAYS,
  departmentRecordSchema,
  DIVISION_NAME_MAX_LENGTH,
  divisionRecordSchema,
  floorRecordSchema,
  namesSchema,
  buildingRecordSchema,
  ROOM_CAPACITY_MAX,
  ROOM_STATUSES,
  ROOM_TYPES,
  roomRecordSchema,
  SHARED_ROOM_LESSONS_MAX,
  WEEKDAYS,
  workingWeekdaysSchema,
} from './setup.js';

const FLOOR = '0199a000-0000-7000-8000-000000000001';

const BRANCH = {
  name: 'North',
  address: 'Chilonzor, 12',
  phone: '+998 71 000 00 00',
  email: 'north@example.test',
  workingWeekdays: [1, 2, 3, 4, 5],
};

const ROOM = {
  name: '101',
  floorId: FLOOR,
  type: 'classroom',
  capacity: 28,
  status: 'in_use',
  shared: false,
  maxSimultaneousLessons: null,
};

const paths = (result: { success: boolean; error?: { issues: { path: PropertyKey[] }[] } }) =>
  result.success ? [] : (result.error?.issues.map((issue) => issue.path.join('.')) ?? []);

// docs/spec/03-school-setup.md, Branch: "Name, address, working weekdays,
// contacts." The contacts are one phone and one email, both optional, and the
// address is optional (decided by the owner, pull request #37).
describe('the record of a branch', () => {
  it('takes its fields, trimmed, with an empty optional field stored as nothing', () => {
    const parsed = branchRecordSchema.parse({
      ...BRANCH,
      name: '  North  ',
      address: '',
      phone: ' ',
      email: '',
    });
    expect(parsed).toEqual({
      name: 'North',
      address: null,
      phone: null,
      email: null,
      workingWeekdays: [1, 2, 3, 4, 5],
    });
  });

  it('takes nothing for an optional field', () => {
    expect(
      branchRecordSchema.parse({ ...BRANCH, address: null, phone: null, email: null }),
    ).toMatchObject({ address: null, phone: null, email: null });
  });

  it('refuses an empty or too long name', () => {
    expect(paths(branchRecordSchema.safeParse({ ...BRANCH, name: ' ' }))).toEqual(['name']);
    expect(paths(branchRecordSchema.safeParse({ ...BRANCH, name: 'N'.repeat(101) }))).toEqual([
      'name',
    ]);
    expect(branchRecordSchema.safeParse({ ...BRANCH, name: 'N'.repeat(100) }).success).toBe(true);
  });

  it('refuses a text that is not an email address, and the too long optional fields', () => {
    expect(paths(branchRecordSchema.safeParse({ ...BRANCH, email: 'north' }))).toEqual(['email']);
    expect(paths(branchRecordSchema.safeParse({ ...BRANCH, address: 'A'.repeat(301) }))).toEqual([
      'address',
    ]);
    expect(paths(branchRecordSchema.safeParse({ ...BRANCH, phone: '1'.repeat(41) }))).toEqual([
      'phone',
    ]);
    expect(
      paths(branchRecordSchema.safeParse({ ...BRANCH, email: `${'e'.repeat(190)}@example.test` })),
    ).toEqual(['email']);
  });
});

// `12`, Language: "The week starts on Monday." The working weekdays are ISO
// numbers, Monday 1 to Sunday 7; a new branch works Monday to Friday (answer 2).
describe('the working weekdays', () => {
  it('are Monday to Sunday, and Monday to Friday by default', () => {
    expect(WEEKDAYS).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(DEFAULT_WORKING_WEEKDAYS).toEqual([1, 2, 3, 4, 5]);
  });

  it.each([[[1]], [[1, 2, 3, 4, 5]], [[1, 2, 3, 4, 5, 6]], [[6, 7]], [[1, 2, 3, 4, 5, 6, 7]]])(
    'take %j',
    (days) => {
      expect(workingWeekdaysSchema.safeParse(days).success).toBe(true);
    },
  );

  it.each([[[]], [[0, 1]], [[1, 8]], [[1, 1]], [[2, 1]], [[1.5]], [['1']]])('refuse %j', (days) => {
    expect(workingWeekdaysSchema.safeParse(days).success).toBe(false);
  });
});

describe('the records of a building and a floor', () => {
  it('take a trimmed name within their lengths', () => {
    expect(buildingRecordSchema.parse({ name: ' Main ' })).toEqual({ name: 'Main' });
    expect(floorRecordSchema.parse({ name: ' 2 ' })).toEqual({ name: '2' });
    expect(buildingRecordSchema.safeParse({ name: 'B'.repeat(100) }).success).toBe(true);
    expect(floorRecordSchema.safeParse({ name: 'F'.repeat(50) }).success).toBe(true);
  });

  it('refuse an empty or too long name', () => {
    expect(buildingRecordSchema.safeParse({ name: '' }).success).toBe(false);
    expect(buildingRecordSchema.safeParse({ name: 'B'.repeat(101) }).success).toBe(false);
    expect(floorRecordSchema.safeParse({ name: ' ' }).success).toBe(false);
    expect(floorRecordSchema.safeParse({ name: 'F'.repeat(51) }).success).toBe(false);
  });
});

// docs/spec/03-school-setup.md, Building, floor, room: "Room: name or number,
// floor, type (classroom, laboratory, sports hall, hall, other), capacity,
// status (in use, under repair, closed)." docs/spec/edge-cases/timetable.md,
// Structure: "A room has a 'shared' switch and a maximum number of lessons at
// the same time."
describe('the record of a room', () => {
  it('has the five types and the three statuses of the spec', () => {
    expect(ROOM_TYPES).toEqual(['classroom', 'laboratory', 'sports_hall', 'hall', 'other']);
    expect(ROOM_STATUSES).toEqual(['in_use', 'under_repair', 'closed']);
  });

  it('takes a room that is not shared', () => {
    expect(roomRecordSchema.parse({ ...ROOM, name: ' 101 ' })).toEqual(ROOM);
  });

  it('takes a shared room with the number of lessons it holds at once', () => {
    const shared = { ...ROOM, shared: true, maxSimultaneousLessons: 2 };
    expect(roomRecordSchema.parse(shared)).toEqual(shared);
    expect(
      roomRecordSchema.safeParse({ ...shared, maxSimultaneousLessons: SHARED_ROOM_LESSONS_MAX })
        .success,
    ).toBe(true);
  });

  it('refuses a shared room without the number, or with fewer than two', () => {
    expect(
      paths(roomRecordSchema.safeParse({ ...ROOM, shared: true, maxSimultaneousLessons: null })),
    ).toEqual(['maxSimultaneousLessons']);
    expect(
      paths(roomRecordSchema.safeParse({ ...ROOM, shared: true, maxSimultaneousLessons: 1 })),
    ).toEqual(['maxSimultaneousLessons']);
    expect(
      paths(
        roomRecordSchema.safeParse({
          ...ROOM,
          shared: true,
          maxSimultaneousLessons: SHARED_ROOM_LESSONS_MAX + 1,
        }),
      ),
    ).toEqual(['maxSimultaneousLessons']);
  });

  it('refuses a number of lessons at once for a room that is not shared', () => {
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, maxSimultaneousLessons: 2 }))).toEqual([
      'maxSimultaneousLessons',
    ]);
  });

  // CLAUDE.md: typed numbers are whole numbers.
  it('refuses a capacity below one, above the limit, or not whole', () => {
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, capacity: 0 }))).toEqual(['capacity']);
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, capacity: ROOM_CAPACITY_MAX + 1 }))).toEqual(
      ['capacity'],
    );
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, capacity: 2.5 }))).toEqual(['capacity']);
    expect(roomRecordSchema.safeParse({ ...ROOM, capacity: ROOM_CAPACITY_MAX }).success).toBe(true);
  });

  it('refuses a type or a status outside the lists, and a floor that is not an id', () => {
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, type: 'gym' }))).toEqual(['type']);
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, status: 'open' }))).toEqual(['status']);
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, floorId: 'ground' }))).toEqual(['floorId']);
  });

  it('refuses an empty or too long name', () => {
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, name: '' }))).toEqual(['name']);
    expect(paths(roomRecordSchema.safeParse({ ...ROOM, name: 'R'.repeat(51) }))).toEqual(['name']);
  });
});

// docs/spec/03-school-setup.md, Divisions, Names: "Each division and
// department has a name in three languages." The bound of 100 follows 1.1.
describe('the records of a division and a department', () => {
  const NAMES = { uz: 'Moliya boʻlimi', ru: 'Финансовый отдел', en: 'Finance' };

  it('take the three names, trimmed', () => {
    expect(divisionRecordSchema.parse({ names: { ...NAMES, en: ' Finance ' } })).toEqual({
      names: NAMES,
    });
    expect(departmentRecordSchema.parse({ names: NAMES })).toEqual({ names: NAMES });
    expect(
      namesSchema.safeParse({ ...NAMES, uz: 'M'.repeat(DIVISION_NAME_MAX_LENGTH) }).success,
    ).toBe(true);
  });

  it('refuse a missing, empty or too long name in any language, naming it', () => {
    expect(paths(divisionRecordSchema.safeParse({ names: { ...NAMES, ru: ' ' } }))).toEqual([
      'names.ru',
    ]);
    expect(paths(departmentRecordSchema.safeParse({ names: { uz: 'A', en: 'A' } }))).toEqual([
      'names.ru',
    ]);
    expect(
      paths(
        divisionRecordSchema.safeParse({
          names: { ...NAMES, en: 'E'.repeat(DIVISION_NAME_MAX_LENGTH + 1) },
        }),
      ),
    ).toEqual(['names.en']);
  });
});

describe('the branch phone ("Decided ahead for tasks 2.2d and 2.7", item 10)', () => {
  const phoneOf = (phone: string) => branchRecordSchema.safeParse({ ...BRANCH, phone });

  it('stores "+998" and nine digits as the digits', () => {
    expect(phoneOf('+998 71 123 45 67').data?.phone).toBe('+998711234567');
    expect(phoneOf('+998 (71) 123-45-67').data?.phone).toBe('+998711234567');
  });

  it('keeps an empty phone as none', () => {
    expect(phoneOf('').data?.phone).toBeNull();
    expect(phoneOf('   ').data?.phone).toBeNull();
  });

  it('refuses any other text on phone', () => {
    for (const phone of ['71 123 45 67', '+99871123456', '+9987112345678', '+7 495 123 45 67', 'call the office']) {
      const result = phoneOf(phone);
      expect(result.success).toBe(false);
      expect(result.error?.issues.map((issue) => issue.path)).toEqual([['phone']]);
    }
  });
});
