import type { AssistantRouteLine } from '../../access/assistant-routes.js';
import type { ChangeBasis, StepValue } from '../../access/assistant-change-routes.js';

const id: StepValue = 'path:id';

/** The record of a list whose `id` is the step's `path:id`. */
function readById(route: string, clockKeys?: readonly string[]): ChangeBasis {
  return {
    kind: 'read',
    route,
    args: {},
    pick: { value: id },
    ...(clockKeys === undefined ? {} : { clockKeys }),
  };
}

/** The keys of `GET /api/setup/settings` (`branchSettingsSchema`). */
const SETTINGS_KEYS = [
  'editDays',
  'lowResult',
  'resultDrop',
  'attendancePercent',
  'absencesInRow',
  'classDailyLessons',
  'planWindows',
] as const;

/**
 * A save of some of the branch settings rests on those settings alone: the other keys of the
 * read are left out of the fingerprint (as the keys that change with the clock are), so that two
 * saves of different settings in one proposal do not make the second outdated.
 */
function settingsBasis(keys: readonly (typeof SETTINGS_KEYS)[number][]): ChangeBasis {
  return {
    kind: 'read',
    route: 'GET /api/setup/settings',
    args: {},
    clockKeys: SETTINGS_KEYS.filter((key) => !keys.includes(key)),
  };
}

/** Task 11.20: the lines of setup, feedback, portal and monitoring (`02`, Assistant, What it can do). */
export const SETUP_LINES: Readonly<Record<string, AssistantRouteLine>> = {
  // Branches and travel times.
  'GET /api/setup/branches': {
    group: 'setup',
    description:
      'Every branch of the school: name, address, working weekdays and the number of buildings and rooms.',
  },
  'POST /api/setup/branches': {
    kind: 'change',
    group: 'setup',
    description: 'Adds a branch of the school: name, address, phone, email and working weekdays.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/branch': {
    kind: 'change',
    group: 'setup',
    description:
      'Changes the branch of the request: give the full name, address, phone, email and working weekdays.',
    basis: { kind: 'read', route: 'GET /api/setup/branch', args: {}, clockKeys: ['goLiveDate'] },
  },
  'PUT /api/setup/branch/go-live': {
    kind: 'change',
    group: 'setup',
    description:
      'Sets the go-live date of the branch (a school day inside a planned or current academic year), or clears it with null.',
    basis: {
      kind: 'read',
      route: 'GET /api/setup/branch',
      args: {},
      clockKeys: ['name', 'address', 'phone', 'email'],
    },
  },
  'PUT /api/setup/travel-times': {
    kind: 'change',
    group: 'setup',
    description:
      'Sets the travel time in minutes (0 to 180) between the branch of the request and another branch, given by otherBranchId.',
    basis: {
      kind: 'read',
      route: 'GET /api/setup/travel-times',
      args: {},
      pick: { value: 'body:otherBranchId', key: 'branchId' },
    },
    records: ['body:otherBranchId'],
  },

  // Buildings, floors and rooms.
  'POST /api/setup/buildings/export': {
    kind: 'download',
    group: 'setup',
    description: 'An Excel file of the chosen buildings: give their ids and the columns.',
  },
  'POST /api/setup/rooms/export': {
    kind: 'download',
    group: 'setup',
    description: 'An Excel file of the chosen rooms: give their ids and the columns.',
  },
  'POST /api/setup/buildings/:id/forced-delete': {
    kind: 'change',
    group: 'setup',
    description:
      'Deletes for good a building that no lesson, timetable entry or other record references, with the reason; it can be restored for 30 days under Deleted for good.',
    basis: readById('GET /api/setup/buildings'),
  },
  'POST /api/setup/floors/:id/forced-delete': {
    kind: 'change',
    group: 'setup',
    description:
      'Deletes for good a floor that no lesson, timetable entry or other record references, with the reason; it can be restored for 30 days under Deleted for good.',
    basis: readById('GET /api/setup/buildings'),
  },
  'POST /api/setup/rooms/:id/forced-delete': {
    kind: 'change',
    group: 'setup',
    description:
      'Deletes for good a room that no lesson, timetable entry or other record references, with the reason; it can be restored for 30 days under Deleted for good.',
    basis: readById('GET /api/setup/rooms'),
  },

  // Divisions and departments (school-wide).
  'POST /api/setup/divisions/export': {
    kind: 'download',
    group: 'setup',
    description: 'An Excel file of the chosen divisions: give their ids and the columns.',
  },
  'POST /api/setup/divisions': {
    kind: 'change',
    group: 'setup',
    description: 'Adds a division of the school, with its name in Uzbek, Russian and English.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/divisions/:id': {
    kind: 'change',
    group: 'setup',
    description: 'Renames a division: give its names in Uzbek, Russian and English.',
    basis: readById('GET /api/setup/divisions'),
  },
  'POST /api/setup/divisions/:id/archive': {
    kind: 'change',
    group: 'setup',
    description:
      'Archives a division; refused for a built-in division or one whose departments still hold subjects or staff.',
    basis: readById('GET /api/setup/divisions'),
  },
  'POST /api/setup/divisions/:id/restore': {
    kind: 'change',
    group: 'setup',
    description: 'Restores an archived division.',
    basis: readById('GET /api/setup/divisions'),
  },
  'POST /api/setup/divisions/:id/departments': {
    kind: 'change',
    group: 'setup',
    description: 'Adds a department to a division, with its name in Uzbek, Russian and English.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/setup/departments/:id': {
    kind: 'change',
    group: 'setup',
    description: 'Renames a department: give its names in Uzbek, Russian and English.',
    basis: readById('GET /api/setup/divisions'),
  },
  'POST /api/setup/departments/:id/archive': {
    kind: 'change',
    group: 'setup',
    description: 'Archives a department; refused while it still has subjects or staff.',
    basis: readById('GET /api/setup/divisions'),
  },
  'POST /api/setup/departments/:id/restore': {
    kind: 'change',
    group: 'setup',
    description: 'Restores an archived department.',
    basis: readById('GET /api/setup/divisions'),
  },

  // Academic years and day templates.
  'POST /api/setup/academic-years/:id/start': {
    kind: 'change',
    group: 'calendar',
    description:
      'Starts a planned academic year: it becomes the current year. Refused while the branch has a current year or an earlier year is not closed.',
    basis: readById('GET /api/setup/academic-years'),
  },
  'GET /api/setup/day-template-table': {
    group: 'calendar',
    description:
      'The day template that applies to every working weekday and grade on a date: give the date.',
  },
  'GET /api/setup/day-templates/:id': {
    group: 'calendar',
    description:
      'One day template with its slots and their clock times as they stand on a date: give the template id and the date.',
  },

  // Settings of the branch.
  'GET /api/setup/attendance-values': {
    group: 'setup',
    description:
      'The late and skipped attendance values, in percent of a present lesson, of every quarter of the planned and current years.',
  },
  'POST /api/setup/quarters/:id/attendance-values/preview': {
    kind: 'preview',
    group: 'setup',
    description:
      'Preview of new attendance values of a quarter: the grades the change would alter in each journal. Changes nothing.',
  },
  'PUT /api/setup/quarters/:id/attendance-values': {
    kind: 'change',
    group: 'setup',
    description:
      'Sets the late and skipped values (0 to 100 percent) of a quarter, given by its id. In an open quarter give a reason; run the preview first, it shows the grades that change.',
    basis: {
      kind: 'read',
      route: 'GET /api/setup/attendance-values',
      args: {},
      pick: { value: id },
    },
    preview: { route: 'POST /api/setup/quarters/:id/attendance-values/preview' },
  },
  'PUT /api/setup/settings/edit-days': {
    kind: 'change',
    group: 'setup',
    description:
      'Sets the edit days of the branch: how many calendar days (1 to 30) after a lesson it stays open. Applies to lessons dated after the change.',
    basis: settingsBasis(['editDays']),
    records: [],
  },
  'PUT /api/setup/settings/early-warning': {
    kind: 'change',
    group: 'setup',
    description:
      'Sets the four thresholds of the early-warning list: lowResult, resultDrop, attendancePercent and absencesInRow, all four given.',
    basis: settingsBasis(['lowResult', 'resultDrop', 'attendancePercent', 'absencesInRow']),
    records: [],
  },
  'PUT /api/setup/settings/class-daily-lessons': {
    kind: 'change',
    group: 'setup',
    description:
      'Sets the most lessons a class has in a day (1 to 12), or null for no limit; a class with more is marked in the timetable.',
    basis: settingsBasis(['classDailyLessons']),
    records: [],
  },
  'PUT /api/setup/settings/plan-windows': {
    kind: 'change',
    group: 'setup',
    description:
      'Switches the lesson plan windows on or off. Off, teachers change their plans at any time, with no window, edit request or "overdue"; stored windows are kept.',
    basis: settingsBasis(['planWindows']),
    records: [],
  },

  // Subjects: exports and the Excel import.
  'POST /api/setup/subjects/export': {
    kind: 'download',
    group: 'setup',
    description: 'An Excel file of the chosen subjects: give their ids and the columns.',
  },
  'GET /api/setup/subjects/import-template': {
    kind: 'download',
    group: 'setup',
    description: 'The Excel template of the subject import, in the language given.',
  },
  'PUT /api/setup/subjects/imports': {
    kind: 'file',
    group: 'setup',
    description:
      'Uploads a filled subject import template; the rows are kept and their preview answered, nothing is saved yet.',
  },
  'POST /api/setup/subjects/imports/:id/preview': {
    kind: 'preview',
    group: 'setup',
    description:
      'Preview of a kept subject import: each row and its problems, and whether every row is clean. Saves nothing.',
  },
  'POST /api/setup/subjects/imports/:id/confirm': {
    kind: 'change',
    group: 'setup',
    description:
      'Saves every row of a kept subject import, or nothing while a row has a problem; the body is empty. Run the preview first.',
    basis: { kind: 'own' },
    outdatedCodes: [
      'subject_import_changed',
      'subject_import_already_confirmed',
      'import_already_done',
    ],
    preview: { route: 'POST /api/setup/subjects/imports/:id/preview' },
  },

  // The parents' digest and the demo time (school-wide, the Super Admin).
  'GET /api/setup/school-settings/digest': {
    group: 'setup',
    description:
      "The parents' digest settings: the time it is sent and the quiet hours, Tashkent time.",
  },
  'PUT /api/setup/school-settings/digest': {
    kind: 'change',
    group: 'setup',
    description:
      "Sets the parents' digest time and quiet hours (HH:MM, Tashkent time): sendAt, quietFrom and quietUntil; the time must lie outside the quiet hours.",
    basis: { kind: 'read', route: 'GET /api/setup/school-settings/digest', args: {} },
    records: [],
  },
  'GET /api/digest-log': {
    group: 'announcements',
    description:
      'The send log of the parents’ digests: per digest its date, status and parts. Filter by from and to dates and status; 500 rows a page.',
  },
  'GET /api/setup/demo-clock': {
    group: 'setup',
    description:
      'The demo time of the test environment: whether it is on, real time, demo time and the offset.',
  },
  'POST /api/setup/demo-clock/jumps': {
    kind: 'change',
    group: 'setup',
    description:
      'Moves demo time forward to the moment given (at most 400 days ahead); it never moves back and cannot be undone. Works on the test environment only.',
    basis: {
      kind: 'read',
      route: 'GET /api/setup/demo-clock',
      args: {},
      clockKeys: ['realNow', 'demoNow'],
    },
    records: [],
  },

  // Feedback reports and the system status (school-wide, the Super Admin).
  'GET /api/feedback-reports': {
    group: 'setup',
    description:
      'The feedback reports of the whole school, newest first: the sender, roles, page, text and whether it was marked handled.',
  },
  'POST /api/feedback-reports/:id/handled': {
    kind: 'change',
    group: 'setup',
    description: 'Marks a feedback report handled.',
    basis: readById('GET /api/feedback-reports'),
  },
  'DELETE /api/feedback-reports/:id/handled': {
    kind: 'change',
    group: 'setup',
    description: 'Marks a handled feedback report as new again.',
    basis: readById('GET /api/feedback-reports'),
  },
  'GET /api/system-status': {
    group: 'setup',
    description:
      'The platform’s own checks: the worker, failed jobs, new feedback reports and each branch’s nightly check.',
  },
  'GET /api/system-status/providers': {
    group: 'setup',
    description:
      'Uptime, metrics and errors from the outside services, with their history: period 24h (default), 7d or 14d.',
  },
};
