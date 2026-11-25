import type { AssistantRouteLine } from '../../access/assistant-routes.js';
import {
  STEP_ID,
  type AssistantPreview,
  type ChangeBasis,
  type StepValue,
} from '../../access/assistant-change-routes.js';

/**
 * Task 11.20: the lines of people, accounts, relatives, parent accounts, branch moves, group
 * transfers, the audit log, the forced deletes and the integration keys (`02`, Assistant, What
 * it can do).
 */

const id: StepValue = 'path:id';

/** The record found by the step's `id` inside a list. */
function readById(route: string, clockKeys?: readonly string[]): ChangeBasis {
  return {
    kind: 'read',
    route,
    args: {},
    pick: { value: id },
    ...(clockKeys === undefined ? {} : { clockKeys }),
  };
}

/** A GET of one record by the step's `id`; `today` moves with the clock. */
function readOne(route: string, clockKeys: readonly string[] = ['today']): ChangeBasis {
  return { kind: 'read', route, args: { id }, clockKeys };
}

function pickKeys(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => keys.includes(key)));
}

const STAFF_BASIS = readOne('GET /api/people/staff/:id');
const STUDENT_BASIS = readOne('GET /api/people/students/:id');
const RELATIVE_BASIS = readOne('GET /api/people/relatives/:id', []);
const STAFF_ACCOUNT_BASIS = readOne('GET /api/people/staff/:id/account');
const ACCOUNT_ACCESS_BASIS = readOne('GET /api/people/staff/:id/account/access', []);
const STUDENT_RELATIVES_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/people/students/:id/relatives',
  args: { id },
};
const PARENT_ACCOUNT_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/people/parents/:relativeId/account',
  args: { relativeId: 'path:relativeId' },
  clockKeys: ['valid'],
};
const INCOMING_BASIS = readById('GET /api/people/branch-moves/incoming', ['acceptable', 'today']);
const KEY_BASIS = readById('GET /api/integration-keys', ['lastUsedAt']);

const STUDENT_OUTDATED = ['student_changed'] as const;
const IMPORT_OUTDATED = [
  'import_changed',
  'import_already_confirmed',
  'import_already_done',
] as const;
const GROUP_MOVE_OUTDATED = ['move_not_scheduled', 'move_not_undoable'] as const;

const ONE_TIME = 'The one-time password is shown to the person only, never to you.';

/** The duplicate check of a staff record, from the fields it compares. */
const STAFF_CHECK: AssistantPreview = {
  route: 'POST /api/people/staff/check',
  args: {},
  body: (body) => ({
    ...pickKeys(body, ['firstName', 'lastName', 'birthDate', 'phone']),
    staffRecordId: null,
  }),
};

/** The duplicate check of a student, from the fields it compares. */
function studentCheck(edit: boolean): AssistantPreview {
  return {
    route: 'POST /api/people/students/check',
    args: {},
    body: (body) => ({
      ...pickKeys(body, ['firstName', 'lastName', 'birthDate']),
      studentId: edit ? STEP_ID : null,
    }),
  };
}

export const PEOPLE_LINES: Readonly<Record<string, AssistantRouteLine>> = {
  // Staff records.
  'POST /api/people/staff/check': {
    kind: 'preview',
    group: 'staff',
    description:
      'Check of a staff record before it is saved: records of the branch with the same name and date of birth, one elsewhere, and whether the phone is taken.',
  },
  'POST /api/people/staff': {
    kind: 'change',
    group: 'staff',
    description:
      'Creates a staff record: names, sex, dates, contacts, contract, lessons per week and per day, and the divisions with one main. Run the check first and say what it found.',
    basis: { kind: 'create' },
    preview: STAFF_CHECK,
    records: [],
  },
  'PUT /api/people/staff/:id': {
    kind: 'change',
    group: 'staff',
    description:
      'Changes a staff record: give every field of the record as read, with the changed ones. The Academic Vice Principal changes only name, phone and email.',
    basis: STAFF_BASIS,
  },
  'PUT /api/people/staff/:id/branches': {
    kind: 'change',
    group: 'staff',
    description: 'Sets the main branch and the further branches of a staff member.',
    basis: STAFF_BASIS,
  },
  'POST /api/people/staff/:id/status': {
    kind: 'change',
    group: 'staff',
    description: 'Sets the status of a staff member from a date, today or later.',
    basis: STAFF_BASIS,
  },
  'POST /api/people/staff/:id/identity': {
    kind: 'change',
    group: 'staff',
    description:
      'Shows the hidden fields of a staff record (JSHSHIR and the rest); every show is logged.',
    basis: { kind: 'create' },
  },
  'POST /api/people/staff/export': {
    kind: 'download',
    group: 'staff',
    description: 'The Excel file of the staff list: the rows and columns chosen.',
  },
  'GET /api/people/staff/import-template': {
    kind: 'download',
    group: 'staff',
    description: 'The Excel template of the staff import, in a language.',
  },
  'PUT /api/people/staff/imports': {
    kind: 'file',
    group: 'staff',
    description: 'Uploads a filled staff import template; answers the preview of its rows.',
  },
  'POST /api/people/staff/imports/:id/preview': {
    kind: 'preview',
    group: 'staff',
    description:
      'Preview of a kept staff import with the warnings confirmed so far: each row, its problems and its warnings.',
  },
  'POST /api/people/staff/imports/:id/confirm': {
    kind: 'change',
    group: 'staff',
    description: `Saves every row of a kept staff import, or none. Set confirmedWarnings only to the rows whose warnings the preview showed and the person accepted. ${ONE_TIME}`,
    basis: { kind: 'own' },
    preview: { route: 'POST /api/people/staff/imports/:id/preview' },
    outdatedCodes: IMPORT_OUTDATED,
    keepsFlags: ['confirmedWarnings'],
  },
  'GET /api/people/staff/:id/photo': {
    kind: 'download',
    group: 'staff',
    description: 'The photo of a staff member.',
  },
  'PUT /api/people/staff/:id/photo': {
    kind: 'file',
    group: 'staff',
    description: 'Sets the photo of a staff member (JPEG or PNG).',
  },
  'DELETE /api/people/staff/:id/photo': {
    kind: 'change',
    group: 'staff',
    description: 'Removes the photo of a staff member.',
    basis: STAFF_BASIS,
  },
  'POST /api/people/staff/:id/report': {
    kind: 'export',
    group: 'staff',
    description: 'The personal data report of a staff member; every report is logged.',
  },

  // Accounts and roles.
  'GET /api/people/staff/:id/account': {
    group: 'staff',
    description:
      'The account of a staff member: login, roles with branches, subjects and dates, and what may be given.',
  },
  'GET /api/people/staff/:id/account/suggestion': {
    group: 'staff',
    description: 'The login suggested for a new account of a staff member, or null.',
  },
  'POST /api/people/staff/:id/account': {
    kind: 'change',
    group: 'staff',
    description: `Creates the account of a staff member with a login (read the suggestion first). ${ONE_TIME}`,
    basis: STAFF_ACCOUNT_BASIS,
  },
  'POST /api/people/staff/:id/account/own': {
    kind: 'change',
    group: 'staff',
    description: 'Links a staff record to the account of the person asking (their own).',
    basis: STAFF_ACCOUNT_BASIS,
  },
  'POST /api/people/staff/:id/roles': {
    kind: 'change',
    group: 'staff',
    description:
      'Gives a role to a staff member from a date, in a branch (none for a school-wide role); a Head Teacher or Senior Head Teacher also takes subjectIds.',
    basis: STAFF_ACCOUNT_BASIS,
  },
  'POST /api/people/staff/:id/roles/:assignmentId/end': {
    kind: 'change',
    group: 'staff',
    description: 'Ends a role of a staff member from a date (today ends it now).',
    basis: STAFF_ACCOUNT_BASIS,
    records: ['path:assignmentId'],
  },
  'POST /api/people/staff/:id/roles/:assignmentId/subjects': {
    kind: 'change',
    group: 'staff',
    description: 'Changes the subjects of a Head Teacher or Senior Head Teacher role from a date.',
    basis: STAFF_ACCOUNT_BASIS,
    records: ['path:assignmentId'],
  },
  'GET /api/access/super-admins': {
    group: 'staff',
    description: 'How many active Super Admins the school has.',
  },
  'GET /api/access/branches-without-vice-principal': {
    group: 'staff',
    description: 'The branches with no active Academic Vice Principal now.',
  },

  // Sign-in access.
  'GET /api/people/staff/:id/account/access': {
    group: 'staff',
    description:
      'The sign-in access of a staff member: login, lock, password reset in force, second step, never used, and what the reader may do.',
  },
  'POST /api/people/staff/:id/account/lock': {
    kind: 'change',
    group: 'staff',
    description: 'Locks the account of a staff member, with a reason.',
    basis: ACCOUNT_ACCESS_BASIS,
  },
  'POST /api/people/staff/:id/account/unlock': {
    kind: 'change',
    group: 'staff',
    description: 'Unlocks a locked account of a staff member.',
    basis: ACCOUNT_ACCESS_BASIS,
  },
  'POST /api/people/staff/:id/account/password-reset': {
    kind: 'change',
    group: 'staff',
    description: `Resets the password of a staff member's account. ${ONE_TIME}`,
    basis: ACCOUNT_ACCESS_BASIS,
  },
  'POST /api/people/staff/:id/account/second-step-reset': {
    kind: 'change',
    group: 'staff',
    description: `Resets the second step of a staff member's account, with a password reset (the Super Admin only). ${ONE_TIME}`,
    basis: ACCOUNT_ACCESS_BASIS,
  },
  'GET /api/people/accounts/never-used': {
    group: 'staff',
    description: 'The staff accounts of the branch never used since the person started.',
  },
  'GET /api/people/accounts/reset-entries': {
    group: 'staff',
    description:
      'The entries made within 48 hours of a password reset, optionally between two dates (from, to).',
  },

  // Students.
  'POST /api/people/students/check': {
    kind: 'preview',
    group: 'students',
    description:
      'Check of a student before it is saved: students with the same name and date of birth in the branch, and whether one exists elsewhere.',
  },
  'POST /api/people/students': {
    kind: 'change',
    group: 'students',
    description:
      'Creates a student record: the fields, the start date, the UID, the relatives (one main contact) and the class (required when the start is today or earlier). Run the check first and say what it found.',
    basis: { kind: 'create' },
    preview: studentCheck(false),
    records: [],
  },
  'PUT /api/people/students/:id': {
    kind: 'change',
    group: 'students',
    description:
      'Changes a student record (not the UID): give every field as read, with the changed ones.',
    basis: STUDENT_BASIS,
    preview: studentCheck(true),
  },
  'POST /api/people/students/:id/identity': {
    kind: 'change',
    group: 'students',
    description:
      'Shows the hidden fields of a student record (document, JSHSHIR and the rest); every show is logged.',
    basis: { kind: 'create' },
  },
  'POST /api/people/students/:id/return': {
    kind: 'change',
    group: 'students',
    description:
      'Records the return of a student who left, from a date, to a grade and class, with the contract. Send the student’s version.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/people/students/:id/delete': {
    kind: 'change',
    group: 'students',
    description:
      'Deletes a student record created twice by mistake, with a reason; refused once it has data. Send the version.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'GET /api/people/students/:id/history': {
    group: 'students',
    description:
      'The History tab of a student: each status, class, group and branch move with dates.',
  },
  'GET /api/people/students/:id/merge': {
    group: 'students',
    description:
      'What a merge of a student with the record of another UID would do, its refusal if any, and the digest the merge needs.',
  },
  'POST /api/people/students/:id/merge': {
    kind: 'change',
    group: 'students',
    description:
      'Merges the record of another UID into this student (the older UID survives), with a reason. Read the merge first and give its digest.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/people/students/export': {
    kind: 'download',
    group: 'students',
    description: 'The Excel file of the student list: the rows and columns chosen.',
  },
  'GET /api/people/students/import-template': {
    kind: 'download',
    group: 'students',
    description: 'The Excel template of the student import, in a language.',
  },
  'PUT /api/people/students/imports': {
    kind: 'file',
    group: 'students',
    description: 'Uploads a filled student import template; answers the preview of its rows.',
  },
  'POST /api/people/students/imports/:id/preview': {
    kind: 'preview',
    group: 'students',
    description:
      'Preview of a kept student import with the decisions so far: each row, its problems and its warnings.',
  },
  'POST /api/people/students/imports/:id/confirm': {
    kind: 'change',
    group: 'students',
    description:
      'Saves every row of a kept student import, or none. Set confirmedWarnings only to the rows whose warnings the preview showed and the person accepted, and relativeLinks as chosen.',
    basis: { kind: 'own' },
    preview: { route: 'POST /api/people/students/imports/:id/preview' },
    outdatedCodes: IMPORT_OUTDATED,
    keepsFlags: ['confirmedWarnings'],
  },
  'GET /api/people/students/:id/photo': {
    kind: 'download',
    group: 'students',
    description: 'The photo of a student.',
  },
  'PUT /api/people/students/:id/photo': {
    kind: 'file',
    group: 'students',
    description: 'Sets the photo of a student (JPEG or PNG).',
  },
  'DELETE /api/people/students/:id/photo': {
    kind: 'change',
    group: 'students',
    description: 'Removes the photo of a student.',
    basis: STUDENT_BASIS,
  },
  'POST /api/people/students/:id/report': {
    kind: 'export',
    group: 'students',
    description: 'The personal data report of a student; every report is logged.',
  },

  // Relatives and their links.
  'GET /api/people/relatives': {
    group: 'students',
    description:
      'The relatives of the branch: search by name, or filter no_valid_phone; phone finds one by its phone.',
  },
  'GET /api/people/relatives/no-valid-phone': {
    group: 'students',
    description: 'The number of relatives of the branch with no valid phone and an active student.',
  },
  'GET /api/people/relatives/:id': {
    group: 'students',
    description:
      'One relative: name, phones, workplace, the students linked and the Parent account.',
  },
  'GET /api/search/relatives': {
    group: 'search',
    description: 'Finds relatives by name or main phone.',
  },
  'POST /api/people/relatives/phone-match': {
    kind: 'change',
    group: 'students',
    description:
      'Finds who holds an exact phone, before a relative is added with it; writes nothing.',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/people/relatives/:id': {
    kind: 'change',
    group: 'students',
    description:
      'Changes a relative: give every field as read (with the whole list of extra phones), with the changed ones.',
    basis: RELATIVE_BASIS,
  },
  'POST /api/people/relatives/:id/merge': {
    kind: 'change',
    group: 'students',
    description:
      'Merges another relative record into this one: give otherId, both phones as read, and which phone and name stay.',
    basis: { kind: 'own' },
    outdatedCodes: ['relative_changed', 'relative_merged', 'relative_phone_changed'],
    records: ['path:id', 'body:otherId'],
  },
  'POST /api/people/relatives/:id/show': {
    kind: 'change',
    group: 'students',
    description: 'Shows the hidden workplace and email of a relative; every show is logged.',
    basis: { kind: 'create' },
  },
  'POST /api/people/relatives/:id/report': {
    kind: 'export',
    group: 'students',
    description: 'The personal data report of a relative; every report is logged.',
  },
  'POST /api/people/students/:id/relatives': {
    kind: 'change',
    group: 'students',
    description:
      'Links a relative to a student: a new one, an existing one (its relativeId and phone from the phone match), or a new owner of a phone; with the relationship and the main contact.',
    basis: STUDENT_RELATIVES_BASIS,
  },
  'POST /api/people/students/:id/relatives/:relativeId/unlink': {
    kind: 'change',
    group: 'students',
    description:
      'Unlinks a relative from a student; when it is the main contact, name the new one (newMainContactId).',
    basis: {
      ...STUDENT_RELATIVES_BASIS,
      pick: { value: 'path:relativeId', key: 'relativeId' },
    },
    records: ['path:relativeId'],
  },

  // Parent accounts.
  'GET /api/people/classes/:classId/parent-slips': {
    group: 'students',
    description:
      'The relatives of a class with portal access on: to print, with a valid slip, or signed in.',
  },
  'POST /api/people/classes/:classId/parent-slips': {
    kind: 'change',
    group: 'students',
    description: `Prints the Parent slips of a class in a language; printAgain lists the relatives whose valid slip is printed again. ${ONE_TIME}`,
    basis: {
      kind: 'read',
      route: 'GET /api/people/classes/:classId/parent-slips',
      args: { classId: 'path:classId' },
      clockKeys: ['valid'],
    },
    records: ['path:classId'],
  },
  'GET /api/people/parents/:relativeId/account': {
    group: 'students',
    description:
      'The Parent account of a relative: login, signed in, the latest slip and the Telegram link.',
  },
  'POST /api/people/parents/:relativeId/password-reset': {
    kind: 'change',
    group: 'students',
    description: `Resets the password of a Parent account: one slip in a language, valid for 7 days. ${ONE_TIME}`,
    basis: PARENT_ACCOUNT_BASIS,
    records: ['path:relativeId'],
  },
  'POST /api/people/parents/:relativeId/telegram-unlink': {
    kind: 'change',
    group: 'students',
    description: 'Ends the Telegram link of a Parent account.',
    basis: PARENT_ACCOUNT_BASIS,
    records: ['path:relativeId'],
  },
  'GET /api/people/parent-accounts/never-used': {
    kind: 'export',
    group: 'students',
    description: 'The report of Parent accounts never used; every read is logged as an export.',
  },
  'POST /api/people/parent-accounts/never-used/export': {
    kind: 'download',
    group: 'students',
    description: 'The Excel file of the Parent accounts never used.',
  },

  // Branch moves.
  'GET /api/people/branch-moves/targets': {
    group: 'students',
    description: 'The branches a student of this branch may be released to.',
  },
  'GET /api/people/branch-moves/incoming': {
    group: 'students',
    description:
      'The students released to this branch: UID, name, grade, the branch and date, and whether the accept is open.',
  },
  'GET /api/people/branch-moves/:id/groups': {
    group: 'students',
    description:
      'For an incoming student and a class (classId) of this branch: the groups of each subject with free seats.',
  },
  'POST /api/people/students/:id/branch-move': {
    kind: 'change',
    group: 'students',
    description: 'Releases a student to another branch from a date. Send the student’s version.',
    basis: { kind: 'own' },
    outdatedCodes: STUDENT_OUTDATED,
  },
  'POST /api/people/branch-moves/:id/cancel': {
    kind: 'change',
    group: 'students',
    description: 'Cancels an open release of a student to another branch.',
    basis: { kind: 'own' },
    outdatedCodes: ['branch_move_closed'],
  },
  'POST /api/people/branch-moves/:id/accept': {
    kind: 'change',
    group: 'students',
    description:
      'Accepts a student released to this branch into a class, with a group for each split or group subject (read the groups first; a subject left out gets the smallest suitable group).',
    basis: INCOMING_BASIS,
  },
  'POST /api/people/branch-moves/:id/decline': {
    kind: 'change',
    group: 'students',
    description: 'Declines a student released to this branch, with a reason.',
    basis: INCOMING_BASIS,
  },

  // Group transfers.
  'POST /api/groups/transfers/:id/change': {
    kind: 'change',
    group: 'classes',
    description: 'Changes a planned group move: the new group and date.',
    basis: { kind: 'own' },
    outdatedCodes: GROUP_MOVE_OUTDATED,
  },
  'POST /api/groups/transfers/:id/cancel': {
    kind: 'change',
    group: 'classes',
    description: 'Cancels a planned group move.',
    basis: { kind: 'own' },
    outdatedCodes: GROUP_MOVE_OUTDATED,
  },
  'POST /api/groups/transfers/:id/undo': {
    kind: 'change',
    group: 'classes',
    description: 'Undoes a group move that has taken effect, with a reason.',
    basis: { kind: 'own' },
    outdatedCodes: GROUP_MOVE_OUTDATED,
  },

  // Vacancies.
  'POST /api/people/vacancies/:id/delete': {
    kind: 'change',
    group: 'staff',
    description:
      'Deletes a vacancy that never held a teaching load; one that did is closed instead.',
    basis: { kind: 'read', route: 'GET /api/people/vacancies/:id', args: { id } },
  },
  'POST /api/people/vacancies/export': {
    kind: 'download',
    group: 'staff',
    description: 'The Excel file of the vacancies: the rows and columns chosen.',
  },

  // The audit log.
  'GET /api/audit/entries': {
    group: 'setup',
    description:
      'One page of the audit log: filter by person, record (recordType with recordId), dates, group and scope; before continues to older entries.',
  },
  'POST /api/audit/entries/:id/show': {
    kind: 'change',
    group: 'setup',
    description: 'Shows the hidden values of one audit log entry; every show is logged.',
    basis: { kind: 'create' },
  },

  // Forced deletes.
  'GET /api/forced-deletes': {
    group: 'setup',
    description:
      'The records of the branch deleted for good: what, why, by whom, and until when each can be restored.',
  },
  'POST /api/forced-deletes/:id/restore': {
    kind: 'change',
    group: 'setup',
    description: 'Restores a record deleted for good, within its 30 days.',
    basis: readById('GET /api/forced-deletes', ['restorable']),
  },

  // Integration keys (school-wide).
  'GET /api/integration-keys': {
    group: 'setup',
    description:
      'The integration keys of the school: name, people, end date, state and last use; never a secret.',
  },
  'GET /api/integration-keys/choices': {
    group: 'setup',
    description: 'The staff who may be put on an integration key now, in every branch.',
  },
  'POST /api/integration-keys': {
    kind: 'change',
    group: 'setup',
    description:
      'Creates an integration key with a name, people and an end date. The key’s secret is shown to the person only, never to you.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/integration-keys/:id/people': {
    kind: 'change',
    group: 'setup',
    description: 'Sets the people of an integration key (staffRecordIds).',
    basis: KEY_BASIS,
  },
  'PUT /api/integration-keys/:id/end-date': {
    kind: 'change',
    group: 'setup',
    description: 'Changes the end date of an integration key.',
    basis: KEY_BASIS,
  },
  'POST /api/integration-keys/:id/revoke': {
    kind: 'change',
    group: 'setup',
    description: 'Revokes an integration key for good.',
    basis: KEY_BASIS,
  },
};
