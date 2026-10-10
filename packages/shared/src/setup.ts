import { z } from 'zod';
import { branchIdSchema } from './branches.js';

/**
 * School setup (docs/spec/03-school-setup.md, the rows Branch and Building,
 * floor, room; task 1.1). The bounds are not in the spec; they were agreed by
 * the owner at the plan (pull request #37, answer 9) and live here so that a
 * change is one line.
 */

// Branch: "Name, address, working weekdays, contacts."

export const BRANCH_NAME_MAX_LENGTH = 100;
export const BRANCH_ADDRESS_MAX_LENGTH = 300;
export const BRANCH_PHONE_MAX_LENGTH = 40;
export const BRANCH_EMAIL_MAX_LENGTH = 200;

/** The days of the week as ISO numbers them: Monday 1 to Sunday 7 (`12`, Language: "The week starts on Monday"). */
export const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7] as const;

export type Weekday = (typeof WEEKDAYS)[number];

/** A new branch works Monday to Friday (decided by the owner, answer 2): a working Saturday is a special day of the calendar. */
export const DEFAULT_WORKING_WEEKDAYS: readonly Weekday[] = [1, 2, 3, 4, 5];

/** The time zone of every branch until a task adds a field for it (`edge/00-definitions`, Branch time). */
export const DEFAULT_TIME_ZONE = 'Asia/Tashkent';

const weekdaySchema = z.union(WEEKDAYS.map((day) => z.literal(day)));

/** An optional text field: empty means "none", which the record stores as `null`. */
const optionalText = (maxLength: number) =>
  z
    .string()
    .trim()
    .max(maxLength)
    .transform((text) => (text === '' ? null : text))
    .nullable();

/**
 * The working weekdays of a branch: at least one, each once, Monday first.
 * The form sends them in that order; a body in another order is refused, so
 * two bodies that mean the same cannot differ.
 */
export const workingWeekdaysSchema = z
  .array(weekdaySchema)
  .min(1)
  .max(WEEKDAYS.length)
  .refine((days) => days.every((day, index) => index === 0 || day > (days[index - 1] ?? 0)), {
    message: 'Each weekday once, Monday first.',
  });

/** What is typed for a branch, as the create and the edit routes take it. */
export const branchRecordSchema = z.object({
  name: z.string().trim().min(1).max(BRANCH_NAME_MAX_LENGTH),
  address: optionalText(BRANCH_ADDRESS_MAX_LENGTH),
  /** The contacts of the branch: one phone and one email, both optional (decided by the owner, answer 1). */
  phone: optionalText(BRANCH_PHONE_MAX_LENGTH),
  email: z
    .string()
    .trim()
    .max(BRANCH_EMAIL_MAX_LENGTH)
    .transform((text) => (text === '' ? null : text))
    .nullable()
    .refine((text) => text === null || z.email().safeParse(text).success, {
      message: 'An email address.',
    }),
  workingWeekdays: workingWeekdaysSchema,
});

export type BranchRecord = z.infer<typeof branchRecordSchema>;

/** A branch as the routes answer it. */
export const branchSchema = z.object({
  id: branchIdSchema,
  name: z.string(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  workingWeekdays: z.array(weekdaySchema),
  timeZone: z.string(),
});

export type Branch = z.infer<typeof branchSchema>;

// Building, floor, room: "Rooms are added floor by floor."

export const BUILDING_NAME_MAX_LENGTH = 100;
export const FLOOR_NAME_MAX_LENGTH = 50;
export const ROOM_NAME_MAX_LENGTH = 50;

/** `03`: "type (classroom, laboratory, sports hall, hall, other)". The database keeps the same list; a test compares the two. */
export const ROOM_TYPES = ['classroom', 'laboratory', 'sports_hall', 'hall', 'other'] as const;

export const roomTypeSchema = z.enum(ROOM_TYPES);

export type RoomType = z.infer<typeof roomTypeSchema>;

/**
 * `03`: "status (in use, under repair, closed)". A room is never archived:
 * `closed` is its end state (`edge/academic-year`: "an archived teacher and a
 * closed room"; decided by the owner, answer 7).
 */
export const ROOM_STATUSES = ['in_use', 'under_repair', 'closed'] as const;

export const roomStatusSchema = z.enum(ROOM_STATUSES);

export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const ROOM_CAPACITY_MIN = 1;
export const ROOM_CAPACITY_MAX = 1000;

/**
 * `edge/timetable`, Structure: "A room has a 'shared' switch and a maximum
 * number of lessons at the same time." A shared room holds at least two.
 */
export const SHARED_ROOM_LESSONS_MIN = 2;
export const SHARED_ROOM_LESSONS_MAX = 10;

export const buildingRecordSchema = z.object({
  name: z.string().trim().min(1).max(BUILDING_NAME_MAX_LENGTH),
});

export type BuildingRecord = z.infer<typeof buildingRecordSchema>;

/** "A name or number": `Ground`, `1`, `2`. */
export const floorRecordSchema = z.object({
  name: z.string().trim().min(1).max(FLOOR_NAME_MAX_LENGTH),
});

export type FloorRecord = z.infer<typeof floorRecordSchema>;

export const roomRecordSchema = z
  .object({
    name: z.string().trim().min(1).max(ROOM_NAME_MAX_LENGTH),
    /** An active floor of the branch. */
    floorId: z.uuid(),
    type: roomTypeSchema,
    capacity: z.int().min(ROOM_CAPACITY_MIN).max(ROOM_CAPACITY_MAX),
    status: roomStatusSchema,
    shared: z.boolean(),
    /** How many lessons a shared room holds at once; nothing for a room that is not shared. */
    maxSimultaneousLessons: z
      .int()
      .min(SHARED_ROOM_LESSONS_MIN)
      .max(SHARED_ROOM_LESSONS_MAX)
      .nullable(),
  })
  .superRefine((room, context) => {
    if (room.shared && room.maxSimultaneousLessons === null) {
      context.addIssue({
        code: 'custom',
        path: ['maxSimultaneousLessons'],
        message: 'A shared room says how many lessons it holds at once.',
      });
    }
    if (!room.shared && room.maxSimultaneousLessons !== null) {
      context.addIssue({
        code: 'custom',
        path: ['maxSimultaneousLessons'],
        message: 'Only a shared room holds several lessons at once.',
      });
    }
  });

export type RoomRecord = z.infer<typeof roomRecordSchema>;

export const floorSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** The moment it was archived; `null` while active. */
  archivedAt: z.iso.datetime().nullable(),
  /** How many rooms are on it, whatever their status. */
  roomCount: z.int().min(0),
});

export type Floor = z.infer<typeof floorSchema>;

/** A building with its floors, archived ones included and marked. */
export const buildingSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  archivedAt: z.iso.datetime().nullable(),
  /** Oldest first. */
  floors: z.array(floorSchema),
});

export type Building = z.infer<typeof buildingSchema>;

export const buildingListSchema = z.object({ buildings: z.array(buildingSchema) });

export type BuildingList = z.infer<typeof buildingListSchema>;

/** A room as the list shows it: with the names of its floor and building. */
export const roomSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  floorId: z.uuid(),
  floorName: z.string(),
  buildingId: z.uuid(),
  buildingName: z.string(),
  type: roomTypeSchema,
  capacity: z.int(),
  status: roomStatusSchema,
  shared: z.boolean(),
  maxSimultaneousLessons: z.int().nullable(),
});

export type Room = z.infer<typeof roomSchema>;

export const roomListSchema = z.object({ rooms: z.array(roomSchema) });

export type RoomList = z.infer<typeof roomListSchema>;

/** The `:id` of a building, a floor or a room in a path. */
export const setupIdParamsSchema = z.object({ id: z.uuid() });

export type SetupIdParams = z.infer<typeof setupIdParamsSchema>;

// Division and department (`03`, Divisions; task 1.2): "Each division and
// department has a name in three languages."

export const DIVISION_NAME_MAX_LENGTH = 100;

/** A name in the three languages of the app (`12`, Language), each required. */
export const namesSchema = z.object({
  uz: z.string().trim().min(1).max(DIVISION_NAME_MAX_LENGTH),
  ru: z.string().trim().min(1).max(DIVISION_NAME_MAX_LENGTH),
  en: z.string().trim().min(1).max(DIVISION_NAME_MAX_LENGTH),
});

export type Names = z.infer<typeof namesSchema>;

/** What is typed for a division: its names. Academic's cannot be changed. */
export const divisionRecordSchema = z.object({ names: namesSchema });

export type DivisionRecord = z.infer<typeof divisionRecordSchema>;

/** What is typed for a department: its names. Its division is the one it was added to. */
export const departmentRecordSchema = z.object({ names: namesSchema });

export type DepartmentRecord = z.infer<typeof departmentRecordSchema>;

export const departmentSchema = z.object({
  id: z.uuid(),
  names: namesSchema,
  archivedAt: z.iso.datetime().nullable(),
});

export type Department = z.infer<typeof departmentSchema>;

/** A division with its departments, archived ones included and marked; in the order of the list. */
export const divisionSchema = z.object({
  id: z.uuid(),
  names: namesSchema,
  /** Academic: "It cannot be renamed or archived." */
  builtIn: z.boolean(),
  archivedAt: z.iso.datetime().nullable(),
  departments: z.array(departmentSchema),
});

export type Division = z.infer<typeof divisionSchema>;

export const divisionListSchema = z.object({ divisions: z.array(divisionSchema) });

export type DivisionList = z.infer<typeof divisionListSchema>;
