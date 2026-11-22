import type { AssistantReadGroup } from '@sodiq/shared';

/**
 * The changes open to the assistant as proposals (task 11.13, pull request #376; `02`,
 * Assistant: "What the Super Admin and the Academic Vice Principal can do through it"). A step
 * is never run by the model: it is stored in a proposal and sent only at the person's Confirm,
 * through this same route (`assistant-proposals.service.ts`).
 *
 * Each line says what the step was proposed on (its basis), so that "a change proposed on data
 * that has changed since is refused as outdated" (`02`) holds for every route:
 * - `own`: the route checks it itself from the body (a `version`, a `dayChangesKey`, the
 *   `lessonIds` of a bulk cancel); its refusals that mean "changed since" are `outdatedCodes`.
 * - `read`: the route has no version; the listed GET answers the record (`pick` finds it inside
 *   a list by its id), and a fingerprint of its canonical form is compared at Confirm.
 * - `create`: a new record; nothing to be outdated on, the route's own rules still refuse.
 */

/** A value of a step: a parameter of its path (`path:id`) or a field of its body (`body:studentId`). */
export type StepValue = `path:${string}` | `body:${string}`;

export type ChangeBasis =
  | { kind: 'own' }
  | { kind: 'create' }
  | {
      kind: 'read';
      /** A GET of the same role's list. */
      route: string;
      /** Its path and query parameters, from the step. */
      args: Readonly<Record<string, StepValue>>;
      /** The record inside the answer: the object whose `key` (default `id`) is this value. */
      pick?: { value: StepValue; key?: string };
      /** Keys of the answer that change with the clock, left out of the fingerprint. */
      clockKeys?: readonly string[];
    };

export interface AssistantPreview {
  /** A preview or check route (`kind: 'preview'` on the list), which writes nothing. */
  route: string;
  /** Its path parameters, from the step's; default: the same names. */
  args?: Readonly<Record<string, StepValue>>;
  /** Its body, from the step's body; default: the same body. */
  body?: (body: Readonly<Record<string, unknown>>) => unknown;
}

export interface AssistantChangeLine {
  kind: 'change';
  group: AssistantReadGroup;
  /** What the change does, in English, for the model. */
  description: string;
  basis: ChangeBasis;
  preview?: AssistantPreview;
  /** Refusals of the route that mean "changed since": the step is `outdated`. */
  outdatedCodes?: readonly string[];
  /**
   * The record the step changes, for "one record, one step"; `[]` for a change that names no
   * existing record (a create). Default: `path:id`.
   */
  records?: readonly StepValue[];
  /** When set, the only body fields the model may give; the rest of the body comes from `fromBasis`. */
  only?: readonly string[];
  /** Body fields sent as the basis read gives them (the record's own key of the same name). */
  fromBasis?: readonly string[];
  /** Warning-acceptance flags kept in the tool: only where `preview` shows the warnings again. */
  keepsFlags?: readonly string[];
}

export interface AssistantPreviewLine {
  kind: 'preview';
  group: AssistantReadGroup;
  description: string;
}

/**
 * Fields of a body that accept a warning the screen shows first (review correction 2 of the
 * plan): removed from every tool except a line's `keepsFlags`, so that Confirm never passes a
 * warning the person did not see.
 */
export const WARNING_FLAGS: readonly string[] = [
  'confirm',
  'confirmMixedGroups',
  'confirmMixedLanguage',
  'confirmLanguage',
  'confirmedWarnings',
  // How a student's journal entries follow a move: the screen asks it when entries exist.
  'journalEntries',
];

const id: StepValue = 'path:id';

function readById(route: string, clockKeys?: readonly string[]): ChangeBasis {
  return {
    kind: 'read',
    route,
    args: {},
    pick: { value: id },
    ...(clockKeys === undefined ? {} : { clockKeys }),
  };
}

const CLASS_OUTDATED = ['class_changed'] as const;
const GROUP_OUTDATED = ['group_changed'] as const;
const STUDENT_OUTDATED = ['student_changed'] as const;
const CALENDAR_OUTDATED = ['calendar_blocked'] as const;
const LESSON_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/timetable/lessons/:id/history',
  args: { id },
};

/** The calendar preview's body of a save: `{ action, record, … }` (`calendarChangeSchema`). */
function calendarPreview(action: 'create' | 'edit' | 'archive' | 'restore'): AssistantPreview {
  return {
    route: 'POST /api/setup/calendar-entries/preview',
    args: {},
    body: (body) => {
      // The key and the decisions answer a preview; the preview itself takes neither.
      const rest = withoutKeys(body, ['dayChangesKey', 'dayDecisions']);
      const choices = pickKeys(rest, ['dayKeeps', 'examBlocks', 'groupBlocks']);
      if (action === 'create') {
        return { action, record: withoutKeys(rest, CHOICE_KEYS), ...choices };
      }
      return action === 'edit'
        ? { action, id: STEP_ID, record: withoutKeys(rest, CHOICE_KEYS), ...choices }
        : { action, id: STEP_ID, ...choices };
    },
  };
}

/** Written into a preview body in place of the step's record id (`proposals` fills it). */
export const STEP_ID = '$step:id';
const CHOICE_KEYS = ['dayKeeps', 'examBlocks', 'groupBlocks'];

function pickKeys(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => keys.includes(key)));
}

function withoutKeys(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)));
}

/** The day-template table's preview of a change (`templateChangeSchema`). */
function templatePreview(
  kind: 'slot_length' | 'template_version' | 'assignment_set' | 'assignment_end',
): AssistantPreview {
  const key =
    kind === 'slot_length'
      ? 'slotTypeId'
      : kind === 'template_version'
        ? 'dayTemplateId'
        : kind === 'assignment_end'
          ? 'assignmentId'
          : null;
  return {
    route: 'POST /api/setup/day-template-table/preview',
    args: {},
    body: (body) =>
      key === null ? { kind, change: body } : { kind, [key]: STEP_ID, change: body },
  };
}

const EXAM_CHECK = 'POST /api/timetable/exams/check';

/** The Super Admin's changes; the Academic Vice Principal's are those the table gives the role. */
export const SUPER_ADMIN_CHANGES: Readonly<
  Record<string, AssistantChangeLine | AssistantPreviewLine>
> = {
  // Rooms and buildings (`02`: "rooms and buildings (Super Admin)").
  'POST /api/setup/rooms': {
    kind: 'change',
    group: 'setup',
    description: 'Adds a room on a floor.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/rooms/:id': {
    kind: 'change',
    group: 'setup',
    description: 'Changes a room: name, floor, type, capacity, status, shared.',
    basis: readById('GET /api/setup/rooms'),
  },
  'POST /api/setup/buildings': {
    kind: 'change',
    group: 'setup',
    description: 'Adds a building.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/buildings/:id': {
    kind: 'change',
    group: 'setup',
    description: 'Renames a building.',
    basis: readById('GET /api/setup/buildings'),
  },
  'POST /api/setup/buildings/:id/archive': {
    kind: 'change',
    group: 'setup',
    description: 'Archives a building.',
    basis: readById('GET /api/setup/buildings'),
  },
  'POST /api/setup/buildings/:id/restore': {
    kind: 'change',
    group: 'setup',
    description: 'Restores an archived building.',
    basis: readById('GET /api/setup/buildings'),
  },
  'POST /api/setup/buildings/:id/floors': {
    kind: 'change',
    group: 'setup',
    description: 'Adds a floor to a building.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/floors/:id': {
    kind: 'change',
    group: 'setup',
    description: 'Renames a floor.',
    basis: readById('GET /api/setup/buildings'),
  },
  'POST /api/setup/floors/:id/archive': {
    kind: 'change',
    group: 'setup',
    description: 'Archives a floor.',
    basis: readById('GET /api/setup/buildings'),
  },
  'POST /api/setup/floors/:id/restore': {
    kind: 'change',
    group: 'setup',
    description: 'Restores an archived floor.',
    basis: readById('GET /api/setup/buildings'),
  },

  // The academic calendar.
  'POST /api/setup/calendar-entries/preview': {
    kind: 'preview',
    group: 'calendar',
    description: 'Preview of a calendar change: the lessons it removes, adds or keeps.',
  },
  'POST /api/setup/calendar-entries': {
    kind: 'change',
    group: 'calendar',
    description:
      'Adds a day off or a special day (from tomorrow on only). Send dayChangesKey and the choices the preview asks for.',
    basis: { kind: 'own' },
    preview: calendarPreview('create'),
    outdatedCodes: CALENDAR_OUTDATED,
    records: [],
  },
  'PATCH /api/setup/calendar-entries/:id': {
    kind: 'change',
    group: 'calendar',
    description: 'Changes a calendar entry (dates after today only).',
    basis: { kind: 'own' },
    preview: calendarPreview('edit'),
    outdatedCodes: CALENDAR_OUTDATED,
  },
  'POST /api/setup/calendar-entries/:id/archive': {
    kind: 'change',
    group: 'calendar',
    description: 'Removes a calendar entry that has not started.',
    basis: { kind: 'own' },
    preview: calendarPreview('archive'),
    outdatedCodes: CALENDAR_OUTDATED,
  },
  'POST /api/setup/calendar-entries/:id/restore': {
    kind: 'change',
    group: 'calendar',
    description: 'Restores a removed calendar entry.',
    basis: { kind: 'own' },
    preview: calendarPreview('restore'),
    outdatedCodes: CALENDAR_OUTDATED,
  },

  // Slot types and day templates.
  'POST /api/setup/day-template-table/preview': {
    kind: 'preview',
    group: 'calendar',
    description: 'Preview of a slot length, day template or assignment change.',
  },
  'POST /api/setup/slot-types': {
    kind: 'change',
    group: 'calendar',
    description: 'Adds a slot type (a lesson or a break of a length).',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/setup/slot-types/:id': {
    kind: 'change',
    group: 'calendar',
    description: 'Renames a slot type.',
    basis: readById('GET /api/setup/slot-types'),
  },
  'POST /api/setup/slot-types/:id/lengths': {
    kind: 'change',
    group: 'calendar',
    description: 'Changes the length of a slot type from a date (tomorrow at the earliest).',
    basis: { kind: 'own' },
    preview: templatePreview('slot_length'),
    outdatedCodes: CALENDAR_OUTDATED,
  },
  'POST /api/setup/slot-types/:id/archive': {
    kind: 'change',
    group: 'calendar',
    description: 'Archives a slot type.',
    basis: readById('GET /api/setup/slot-types'),
  },
  'POST /api/setup/slot-types/:id/restore': {
    kind: 'change',
    group: 'calendar',
    description: 'Restores a slot type.',
    basis: readById('GET /api/setup/slot-types'),
  },
  'POST /api/setup/day-templates': {
    kind: 'change',
    group: 'calendar',
    description: 'Adds a day template: a start time and its slots in order.',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/setup/day-templates/:id': {
    kind: 'change',
    group: 'calendar',
    description: 'Renames a day template.',
    basis: readById('GET /api/setup/day-templates'),
  },
  'POST /api/setup/day-templates/:id/versions': {
    kind: 'change',
    group: 'calendar',
    description: 'Changes the slots or start time of a day template from a date.',
    basis: { kind: 'own' },
    preview: templatePreview('template_version'),
    outdatedCodes: CALENDAR_OUTDATED,
  },
  'POST /api/setup/day-templates/:id/archive': {
    kind: 'change',
    group: 'calendar',
    description: 'Archives a day template.',
    basis: readById('GET /api/setup/day-templates'),
  },
  'POST /api/setup/day-templates/:id/restore': {
    kind: 'change',
    group: 'calendar',
    description: 'Restores a day template.',
    basis: readById('GET /api/setup/day-templates'),
  },
  'POST /api/setup/day-template-assignments': {
    kind: 'change',
    group: 'calendar',
    description: 'Sets a day template for a weekday, a grade range or both, from a date.',
    basis: { kind: 'own' },
    preview: templatePreview('assignment_set'),
    outdatedCodes: CALENDAR_OUTDATED,
    records: [],
  },
  'POST /api/setup/day-template-assignments/:id/end': {
    kind: 'change',
    group: 'calendar',
    description: 'Ends a day template assignment from a date.',
    basis: { kind: 'own' },
    preview: templatePreview('assignment_end'),
    outdatedCodes: CALENDAR_OUTDATED,
  },

  // Academic years and quarters (dates).
  'POST /api/setup/academic-years': {
    kind: 'change',
    group: 'calendar',
    description: 'Adds a planned academic year with its start and end dates.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/academic-years/:id': {
    kind: 'change',
    group: 'calendar',
    description: 'Changes the start and end dates of an academic year.',
    basis: readById('GET /api/setup/academic-years'),
  },
  'POST /api/setup/academic-years/:id/quarters/preview': {
    kind: 'preview',
    group: 'calendar',
    description: 'Preview of new quarter dates: the lessons that move between quarters.',
  },
  'PUT /api/setup/academic-years/:id/quarters': {
    kind: 'change',
    group: 'calendar',
    description: 'Sets the dates of the four quarters of a year.',
    basis: { kind: 'own' },
    preview: { route: 'POST /api/setup/academic-years/:id/quarters/preview' },
    outdatedCodes: CALENDAR_OUTDATED,
  },

  // Subjects and their weights.
  'POST /api/setup/subjects': {
    kind: 'change',
    group: 'setup',
    description: 'Adds a subject.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/subjects/:id': {
    kind: 'change',
    group: 'setup',
    description: 'Changes a subject.',
    basis: readById('GET /api/setup/subjects'),
  },
  'PUT /api/setup/subjects/:id/daily-weights': {
    kind: 'change',
    group: 'setup',
    description: 'Sets the daily weights of a subject (attendance, classwork, homework).',
    basis: readById('GET /api/setup/subjects'),
  },
  'POST /api/setup/subjects/:id/archive': {
    kind: 'change',
    group: 'setup',
    description: 'Archives a subject.',
    basis: readById('GET /api/setup/subjects'),
  },
  'POST /api/setup/subjects/:id/restore': {
    kind: 'change',
    group: 'setup',
    description: 'Restores a subject.',
    basis: readById('GET /api/setup/subjects'),
  },
  'POST /api/setup/subjects/:id/quarter-weights/:quarterId/preview': {
    kind: 'preview',
    group: 'setup',
    description: 'Preview of new quarter weights of a subject.',
  },
  'PUT /api/setup/subjects/:id/quarter-weights/:quarterId': {
    kind: 'change',
    group: 'setup',
    description: 'Sets the weights of a subject for one quarter.',
    basis: { kind: 'own' },
    preview: { route: 'POST /api/setup/subjects/:id/quarter-weights/:quarterId/preview' },
    records: ['path:id', 'path:quarterId'],
  },
  'POST /api/setup/subjects/:id/quarter-weights/copy/preview': {
    kind: 'preview',
    group: 'setup',
    description: 'Preview of copying the quarter weights of a subject from another year.',
  },
  'POST /api/setup/subjects/:id/quarter-weights/copy': {
    kind: 'change',
    group: 'setup',
    description: 'Copies the quarter weights of a subject from another year.',
    basis: { kind: 'own' },
    preview: { route: 'POST /api/setup/subjects/:id/quarter-weights/copy/preview' },
  },

  // Staff records and availability (a status and the branches end roles: never).
  'PUT /api/people/staff/:id/teaching': {
    kind: 'change',
    group: 'staff',
    description: 'Sets the subjects and languages a teacher teaches.',
    basis: { kind: 'read', route: 'GET /api/people/staff/:id', args: { id } },
  },
  'PUT /api/people/staff/:id/availability': {
    kind: 'change',
    group: 'staff',
    description: 'Sets when a teacher is available, from a date.',
    basis: { kind: 'read', route: 'GET /api/people/staff/:id/availability', args: { id } },
  },

  // Classes and their members.
  'POST /api/classes': {
    kind: 'change',
    group: 'classes',
    description: 'Adds a class.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/classes/:id': {
    kind: 'change',
    group: 'classes',
    description: 'Changes a class (grade, name, language, room, size). Send its version.',
    basis: { kind: 'own' },
    outdatedCodes: CLASS_OUTDATED,
  },
  'POST /api/classes/:id/archive': {
    kind: 'change',
    group: 'classes',
    description: 'Archives a class.',
    basis: { kind: 'read', route: 'GET /api/classes/:id', args: { id } },
  },
  'POST /api/classes/:id/restore': {
    kind: 'change',
    group: 'classes',
    description: 'Restores an archived class.',
    basis: { kind: 'read', route: 'GET /api/classes/:id', args: { id } },
  },
  'POST /api/classes/:id/members': {
    kind: 'change',
    group: 'classes',
    description: 'Adds students to a class from a date. Send each student’s version.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/classes/:id/members/:memberId/withdraw': {
    kind: 'change',
    group: 'classes',
    description: 'Withdraws a planned class membership.',
    basis: {
      kind: 'read',
      route: 'GET /api/classes/:id/members',
      args: { id },
      pick: { value: 'path:memberId' },
    },
    records: ['path:memberId'],
  },
  'POST /api/classes/transfers': {
    kind: 'change',
    group: 'classes',
    description: 'Moves a student to another class from a date. Send the student’s version.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
    records: ['body:studentId'],
  },
  'POST /api/classes/transfers/:id/change': {
    kind: 'change',
    group: 'classes',
    description: 'Changes a planned class move.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/classes/transfers/:id/cancel': {
    kind: 'change',
    group: 'classes',
    description: 'Cancels a planned class move.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/classes/transfers/:id/undo': {
    kind: 'change',
    group: 'classes',
    description: 'Undoes a class move that has taken effect, with a reason.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },

  // Groups and their members.
  'POST /api/groups': {
    kind: 'change',
    group: 'classes',
    description: 'Adds a group of a subject.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/groups/:id': {
    kind: 'change',
    group: 'classes',
    description: 'Changes a group. Send its version.',
    basis: { kind: 'own' },
    outdatedCodes: GROUP_OUTDATED,
  },
  'POST /api/groups/:id/archive': {
    kind: 'change',
    group: 'classes',
    description: 'Archives a group.',
    basis: { kind: 'read', route: 'GET /api/groups/:id', args: { id } },
  },
  'POST /api/groups/:id/restore': {
    kind: 'change',
    group: 'classes',
    description: 'Restores an archived group.',
    basis: { kind: 'read', route: 'GET /api/groups/:id', args: { id } },
  },
  'POST /api/groups/:id/members': {
    kind: 'change',
    group: 'classes',
    description: 'Adds students to a group from a date.',
    basis: { kind: 'read', route: 'GET /api/groups/:id/members', args: { id } },
  },
  'POST /api/groups/:id/members/:memberId/withdraw': {
    kind: 'change',
    group: 'classes',
    description: 'Withdraws a planned group membership.',
    basis: {
      kind: 'read',
      route: 'GET /api/groups/:id/members',
      args: { id },
      pick: { value: 'path:memberId' },
    },
    records: ['path:memberId'],
  },
  'POST /api/groups/:id/members/:memberId/reviewed': {
    kind: 'change',
    group: 'classes',
    description: 'Marks a group membership as reviewed.',
    basis: {
      kind: 'read',
      route: 'GET /api/groups/:id/members',
      args: { id },
      pick: { value: 'path:memberId' },
    },
    records: ['path:memberId'],
  },
  'POST /api/groups/placement/automatic': {
    kind: 'change',
    group: 'classes',
    description: 'Places the students of grades into the groups of a subject automatically.',
    basis: { kind: 'create' },
    records: [],
  },
  'POST /api/groups/transfers': {
    kind: 'change',
    group: 'classes',
    description: 'Moves a student to another group of the same subject from a date.',
    basis: {
      kind: 'read',
      route: 'GET /api/people/students/:id',
      args: { id: 'body:studentId' },
    },
    records: ['body:studentId'],
  },

  // Students (a create and an edit carry fields that never go to the model: not listed).
  'PUT /api/people/students/:id/uid': {
    kind: 'change',
    group: 'students',
    description: 'Corrects a student’s UID, with a reason.',
    basis: { kind: 'read', route: 'GET /api/people/students/:id', args: { id } },
  },
  'POST /api/people/students/:id/leaving': {
    kind: 'change',
    group: 'students',
    description: 'Records that a student leaves, with the last day. Send the version.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/people/students/:id/leaving/cancel': {
    kind: 'change',
    group: 'students',
    description: 'Cancels a planned leaving.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/people/students/:id/leaving/undo': {
    kind: 'change',
    group: 'students',
    description: 'Undoes a leaving that has taken effect, with a reason.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/people/students/:id/return/cancel': {
    kind: 'change',
    group: 'students',
    description: 'Cancels a planned return of a student.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/people/students/:id/restore': {
    kind: 'change',
    group: 'students',
    description: 'Restores a graduate to a class from a date, with a reason.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  // The switches of portal access (`02`): `portalAccess` only (decision 15).
  'PATCH /api/people/students/:id/relatives/:relativeId': {
    kind: 'change',
    group: 'students',
    description: 'Switches the portal access of a relative of a student on or off.',
    basis: {
      kind: 'read',
      route: 'GET /api/people/students/:id/relatives',
      args: { id },
      pick: { value: 'path:relativeId', key: 'relativeId' },
    },
    records: ['path:relativeId'],
    only: ['portalAccess'],
    fromBasis: ['relationship', 'mainContact', 'receivesNotices'],
  },

  // The teaching load of a draft version.
  'POST /api/timetable/versions/:id/load': {
    kind: 'change',
    group: 'timetable',
    description: 'Adds a row to the teaching load of a draft version.',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/timetable/versions/:id/load/:rowId': {
    kind: 'change',
    group: 'timetable',
    description: 'Changes a row of the teaching load of a draft version.',
    basis: {
      kind: 'read',
      route: 'GET /api/timetable/versions/:id/load',
      args: { id },
      pick: { value: 'path:rowId' },
    },
    records: ['path:rowId'],
  },
  'DELETE /api/timetable/versions/:id/load/:rowId': {
    kind: 'change',
    group: 'timetable',
    description: 'Removes a row of the teaching load of a draft version.',
    basis: {
      kind: 'read',
      route: 'GET /api/timetable/versions/:id/load',
      args: { id },
      pick: { value: 'path:rowId' },
    },
    records: ['path:rowId'],
  },

  // One-day changes.
  'POST /api/timetable/lessons/:id/cancel': {
    kind: 'change',
    group: 'timetable',
    description: 'Cancels one lesson that has not begun, with a reason.',
    basis: LESSON_BASIS,
  },
  'POST /api/timetable/lessons/:id/restore': {
    kind: 'change',
    group: 'timetable',
    description: 'Restores a cancelled lesson that has not begun.',
    basis: LESSON_BASIS,
  },
  'POST /api/timetable/lessons/:id/room': {
    kind: 'change',
    group: 'timetable',
    description: 'Changes the room of one lesson for its date, with a reason.',
    basis: LESSON_BASIS,
  },
  'POST /api/timetable/lessons/:id/move': {
    kind: 'change',
    group: 'timetable',
    description:
      'Moves one lesson to another slot or school day of the same quarter, from today on, with a reason.',
    basis: LESSON_BASIS,
  },

  // Bulk cancels.
  'POST /api/timetable/bulk-cancels/check': {
    kind: 'preview',
    group: 'timetable',
    description:
      'Check of a bulk cancel: the lessons it cancels, those with data, the shared blocks.',
  },
  'POST /api/timetable/bulk-cancels': {
    kind: 'change',
    group: 'timetable',
    description:
      'Cancels the lessons of chosen classes and slots on a date, with a reason. Send exactly the lessonIds the check lists to cancel, a choice for each shared block and for each lesson with data (keep as held, or cancel).',
    basis: { kind: 'own' },
    preview: {
      route: 'POST /api/timetable/bulk-cancels/check',
      body: (body) => pickKeys(body, ['date', 'classIds', 'lessonNumbers']),
    },
    outdatedCodes: ['bulk_scope_changed'],
    records: [],
  },

  // Absences and substitutions.
  'POST /api/timetable/absences': {
    kind: 'change',
    group: 'timetable',
    description: 'Records that a teacher is absent for one or more dates, with a reason.',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/timetable/absences/:id': {
    kind: 'change',
    group: 'timetable',
    description: 'Changes the dates of an absence.',
    basis: readById('GET /api/timetable/absences'),
  },
  'POST /api/timetable/absences/:id/withdraw': {
    kind: 'change',
    group: 'timetable',
    description: 'Withdraws an absence.',
    basis: readById('GET /api/timetable/absences'),
  },
  'POST /api/timetable/lessons/:id/substitute': {
    kind: 'change',
    group: 'timetable',
    description: 'Puts a substitute teacher on one lesson, with a reason.',
    basis: LESSON_BASIS,
  },
  'POST /api/timetable/lessons/:id/substitution/withdraw': {
    kind: 'change',
    group: 'timetable',
    description: 'Withdraws the substitution of one lesson, with a reason.',
    basis: LESSON_BASIS,
  },

  // Exams.
  [EXAM_CHECK]: {
    kind: 'preview',
    group: 'timetable',
    description: 'Check of an exam: the lessons it replaces, its conflicts and warnings.',
  },
  'POST /api/timetable/exams': {
    kind: 'change',
    group: 'timetable',
    description:
      'Adds an exam on a date in consecutive lesson slots. Set confirm only to accept the warnings the check showed.',
    basis: { kind: 'own' },
    preview: {
      route: EXAM_CHECK,
      args: {},
      body: (body) => withoutKeys(body, ['confirm']),
    },
    records: [],
    keepsFlags: ['confirm'],
  },
  'PUT /api/timetable/exams/:id': {
    kind: 'change',
    group: 'timetable',
    description: 'Changes an exam that has not started.',
    basis: { kind: 'own' },
    preview: {
      route: EXAM_CHECK,
      args: {},
      body: (body) => ({ ...withoutKeys(body, ['confirm']), examId: STEP_ID }),
    },
    keepsFlags: ['confirm'],
  },
  'POST /api/timetable/exams/:id/cancel': {
    kind: 'change',
    group: 'timetable',
    description: 'Cancels an exam that has not started.',
    basis: readById('GET /api/timetable/exams'),
  },

  // Vacancies (filling one publishes a version: never).
  'POST /api/people/vacancies': {
    kind: 'change',
    group: 'staff',
    description: 'Adds a vacancy.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/people/vacancies/:id': {
    kind: 'change',
    group: 'staff',
    description: 'Changes a vacancy.',
    basis: { kind: 'read', route: 'GET /api/people/vacancies/:id', args: { id } },
  },
  'POST /api/people/vacancies/:id/close': {
    kind: 'change',
    group: 'staff',
    description: 'Closes a vacancy.',
    basis: { kind: 'read', route: 'GET /api/people/vacancies/:id', args: { id } },
  },
  'POST /api/people/vacancies/:id/reopen': {
    kind: 'change',
    group: 'staff',
    description: 'Reopens a closed vacancy.',
    basis: { kind: 'read', route: 'GET /api/people/vacancies/:id', args: { id } },
  },

  // The lesson plan window.
  'PUT /api/plans/windows/:quarterId': {
    kind: 'change',
    group: 'plans',
    description: 'Opens or changes the lesson plan window of a quarter.',
    basis: {
      kind: 'read',
      route: 'GET /api/plans/windows',
      args: {},
      pick: { value: 'path:quarterId', key: 'quarterId' },
    },
    records: ['path:quarterId'],
  },
  'POST /api/plans/windows/:quarterId/extensions': {
    kind: 'change',
    group: 'plans',
    description: 'Extends the lesson plan window of a quarter for one teacher.',
    basis: {
      kind: 'read',
      route: 'GET /api/plans/windows',
      args: {},
      pick: { value: 'path:quarterId', key: 'quarterId' },
    },
    records: ['path:quarterId', 'body:staffId'],
  },
};
