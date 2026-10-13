import { ROLES, type Role } from './roles.js';

/**
 * docs/spec/02-roles-and-access.md, Rules: "Permissions are a table: rows are
 * roles, columns are actions (view, create, edit, archive, export) per area."
 */
export const ACTIONS = ['view', 'create', 'edit', 'archive', 'export'] as const;

export type Action = (typeof ACTIONS)[number];

/** One area of the table: for each of the 15 roles, the actions it may take. */
export type PermissionRows = Readonly<Record<Role, readonly Action[]>>;

export type PermissionTable = Readonly<Record<string, PermissionRows>>;

/**
 * Makes a table unchangeable while the program runs: its areas, the rows of
 * each area and the list of actions of each row. Code that tries to add an
 * action or an area afterwards fails instead of widening what a role may do.
 */
export function freezeTable<Table extends PermissionTable>(table: Table): Table {
  for (const rows of Object.values(table)) {
    for (const actions of Object.values(rows)) {
      Object.freeze(actions);
    }
    Object.freeze(rows);
  }
  return Object.freeze(table);
}

/** A row for each of the 15 roles: nothing, unless named. */
function rows(named: Partial<Record<Role, readonly Action[]>>): PermissionRows {
  return Object.fromEntries(ROLES.map((role) => [role, named[role] ?? []])) as PermissionRows;
}

/**
 * The table of the application, fixed in code for the 15 roles. Each task adds
 * the rows of its area with its first route, and writes out an empty list for
 * a role that may do nothing there. The server guard reads it for every
 * request; the menus read the same table.
 *
 * - `branches` (`03`, Branch; task 1.1): the Super Admin creates and edits a
 *   branch ("Only this role creates branches", `02`). The Principal views
 *   everything in the branch and changes nothing (`02`). The Academic Vice
 *   Principal reads the record: the working weekdays are an input of the
 *   timetable (`06`, Building a timetable, step 1; approved knowingly by the
 *   owner, pull request #37, answer 5).
 * - `rooms` (`03`, Building, floor, room; task 1.1): the same three roles; the
 *   Super Admin alone creates, edits and archives buildings, floors and rooms,
 *   and the rooms are an input of the timetable (`06`, step 4). The three
 *   export the lists of buildings and rooms (task 2.2c-1).
 * - `divisions` (`03`, Division and Department; task 1.2): the Super Admin
 *   alone adds, renames and archives divisions and their departments ("Only
 *   this role creates ... divisions", `02`). The Principal views everything;
 *   the Academic Vice Principal reads the list because the department is a
 *   column of the teacher list (`04`) and a filter of the timetable board
 *   (`06`); approved by the owner, pull request #40, answer 5. The three
 *   export the list (task 2.2c-1).
 * - `academic_years` (`03`, Academic year; task 1.3): the Super Admin creates
 *   a year, edits its dates and runs "Start year" (`edge/academic-year`); the
 *   Principal and the Academic Vice Principal view (owner's answer 3,
 *   docs/decisions.md, "Decided ahead for tasks 1.3 to 1.6").
 * - `quarters` (`03`, Quarters, owner: Academic Vice Principal; task 1.3):
 *   the Super Admin and the Academic Vice Principal view and date them; the
 *   Principal views (owner's answer 3).
 * - `current_period` (`03` and `12`, Context: "The branch, academic year
 *   and quarter in use are always shown in the top bar"; task 1.3): every role
 *   reads the year and quarter of its branch for the top bar. The answer holds
 *   the year's name and status and the quarter's dates, nothing personal.
 *   Decided without the owner on pull request #44 (decision 8), flagged on
 *   issue #42.
 * - `day_templates` (`03`, Slot types and day templates, owner: Academic
 *   Vice Principal; task 1.5): slot types and day templates together. The
 *   Super Admin and the Academic Vice Principal view, create, edit and
 *   archive; the Principal views (owner's answer 14).
 * - `calendar` (`03`, Academic calendar, owner: Academic Vice Principal;
 *   task 1.4): days off and special days. The Super Admin and the Academic
 *   Vice Principal view, create, edit and archive; the Principal views
 *   (owner's answer 18).
 * - `settings` (`07`, Editing rules and locks: the edit days are "a setting of
 *   the Academic Vice Principal"; `08`, Early-warning list; `edge/calculation`,
 *   late and skipped per quarter; task 1.6): the settings of a branch and its
 *   setup checklist. The Super Admin and the Academic Vice Principal view and
 *   edit; the Principal views (owner's answers 23 and 24). Travel time between
 *   branches is under `branches` (answer 24).
 * - `subjects` (`05`, Subject and "Grading weights on a subject"; task 2.1):
 *   the school-wide subject list and the weights of the branch. The Super
 *   Admin and every Academic Vice Principal view, create, edit and archive
 *   subjects (owner's answer 4; `02`: the Academic Vice Principal has "Full
 *   edit of ... subjects and their weights"); the Principal views. The three
 *   export the list (task 2.2c-1). A new area for
 *   new routes, decided without the owner on pull request #52 (decision 1),
 *   flagged on issue #42.
 * - `staff` (`04`, Teacher and staff record; task 2.2a): the staff records
 *   of the branch. The Super Admin creates and edits them ("the Super Admin
 *   creates staff accounts", `04`; `edge/people-roles-accounts`, Who can
 *   act); the Academic Vice Principal "sees the teacher list" (`04`) and
 *   edits name, phone and email ("Phone, email and name are changed by the
 *   Super Admin or Academic Vice Principal", Accounts and sign-in), which the
 *   server decides from every current assignment; the Principal views. The
 *   three export the list; the Principal's file leaves out the phone (task
 *   2.2c-1, decision 4 of pull request #58). A new area
 *   for new routes, decided without the owner on pull request #53
 *   (decision 2), confirmed at its review and flagged on issue #42. Its
 *   `edit` covers more than one role may do: the branches and the status
 *   of a person, and every field but name, phone and email, are the Super
 *   Admin's; the server decides that part from every current assignment and
 *   refuses the Academic Vice Principal with 403.
 * - `staff_teaching` (`04`, Academic: subjects with grades, languages of
 *   instruction; task 2.2a): the Super Admin and the Academic Vice Principal,
 *   who "edits a teacher's availability, subjects and grades" (Who can act),
 *   view and edit; the Principal views. Decision 2 of pull request #53. Task
 *   2.2b puts the availability routes here with the same rows (pull request
 *   #57, decision 1).
 * - `vacancies` (`04`, Vacancy; task 2.2b): the Academic Vice Principal
 *   "creates, edits, fills and closes" vacancies (`02`; Who can act) and the
 *   Super Admin does everything every other role can do (`02`): both view,
 *   create, edit and archive (close, reopen and the delete of a vacancy that
 *   never held a load); the Principal views. A new area for new routes,
 *   decided without the owner on pull request #57 (decision 1), confirmed at
 *   its review and flagged on issue #42. The three export the list.
 * - `export` in `rooms`, `divisions`, `subjects`, `staff` and `vacancies`
 *   (task 2.2c-1): `02`, Rules ("columns are actions (view, create, edit,
 *   archive, export)"); `12`, Lists ("Every list ... export"); edge cases,
 *   Who can act: the Principal's "Exports are allowed ... and are logged".
 *   Only the three roles that view these areas gain it. Widening existing
 *   roles, decided without the owner on pull request #58 (decision 2),
 *   confirmed at its review and flagged Look first on issue #42.
 * - `accounts` (`edge/people-roles-accounts`, Who can act: "The Super Admin
 *   creates staff accounts and gives all roles"; `02`: "Only this role
 *   creates ... roles"; task 2.3a): the account section of a staff record.
 *   The Super Admin views, creates an account (`create`) and gives and ends
 *   roles (`edit`); the Principal, who "views everything in the branch"
 *   (`02`), views the section of a record of the branch. The count of
 *   active Super Admins asks `create`, so only the Super Admin reads it. A
 *   new area for new routes, decided without the owner on pull request #62
 *   (decision 4), confirmed at its review and flagged on issue #42.
 * - `head_teachers` (`02`, Head Teachers and Senior Head Teachers; task
 *   2.3b-1): the Head Teacher and Senior Head Teacher appointments of a
 *   branch, view only. The Principal "views everything in the branch"; the
 *   Academic Vice Principal needs the approver of a subject ("Who
 *   approves"); a Senior Head Teacher "Sees the Head Teachers of those
 *   subjects", and a Head Teacher the holders of their own subjects, both
 *   limited to their subjects on the server (`subject-scope.ts`).
 *   Appointing stays in `accounts` `edit`. A new area for new routes,
 *   decided without the owner on pull request #63 (decision 8), confirmed at
 *   its review and flagged on issue #42.
 * - `account_access` (`edge/people-roles-accounts`, Who can act: the
 *   Academic Vice Principal "may reset passwords and lock accounts only for
 *   Teachers, Tutors, Head Teachers and the Head Tutor of his branch";
 *   Accounts and sign-in; task 2.3c-1): the sign-in access of an account of
 *   the branch (lock, unlock, password reset, second-step reset) and the
 *   report of accounts never used. The Super Admin and the Academic Vice
 *   Principal view and edit; the Principal, who "views everything in the
 *   branch" (`02`), views. The server keeps the Academic Vice Principal to
 *   accounts whose every role not ended is one of those four with one in the
 *   branch, and the second-step reset to the Super Admin, decided from every
 *   current assignment. A new area for new routes that widens what the
 *   Academic Vice Principal does, decided without the owner on pull request
 *   #65 (decision 2, Look first), confirmed at its review and flagged on
 *   issue #42.
 * - `students`, `student_contact`, `student_identity`, `student_financial`
 *   (`04`, Student record; `edge/people-roles-accounts`, Personal data and
 *   the audit log; task 2.4a): the student list with the Basic group (name,
 *   UID, class, photo, and sex, grade and start date), its create and edit,
 *   and the three groups of readers. `students`: the Super Admin and the
 *   Academic Vice Principal view, create and edit ("Full edit of students",
 *   `02`); the Principal, the Vice Principal for Spiritual and Moral
 *   Education, the Head Tutor, the Tutor, the Head Teacher and the Senior Head
 *   Teacher view (`02`: each "Sees the student list of the branch" or the
 *   "Full student list across classes and groups"; a Senior Head Teacher in
 *   each branch of a request). Teachers have no list (`02`: "Own lessons").
 *   The Tutor opens no profile until the class scope of task 3.1.
 *   `student_contact`: the Super Admin, the Principal, the Academic Vice
 *   Principal, the Vice Principal for Spiritual and Moral Education and the
 *   Head Tutor (the class Tutor with task 3.1). `student_identity`: the
 *   Super Admin and the Academic Vice Principal; the Principal sees it hidden
 *   with a logged show under `students` `view`. `student_financial`: the
 *   Super Admin, the Academic Vice Principal and the Principal. Four new areas
 *   for new routes, decided without the owner on pull request #67 (decision
 *   2, Look first: the Senior Head Teacher reads students of every branch),
 *   confirmed at its review and flagged on issue #42.
 * - `students` `archive` and `student_graduates` (`04`, Movements;
 *   `edge/students-classes-groups`; task 2.4b-1): the Super Admin and the
 *   Academic Vice Principal record a leaving, cancel or undo it, bring a
 *   student back and delete a student created twice ("The Academic Vice
 *   Principal may delete a student only if there is no ... data"); the
 *   Super Admin alone restores a graduated student ("The Super Admin
 *   restores the student to active with a class and a reason"). Decided
 *   without the owner on pull request #68 (decision 2, Look first),
 *   confirmed at its review and flagged on issue #42.
 */
export const PERMISSIONS = freezeTable({
  branches: rows({
    super_admin: ['view', 'create', 'edit'],
    principal: ['view'],
    academic_vice_principal: ['view'],
  }),
  rooms: rows({
    super_admin: ['view', 'create', 'edit', 'archive', 'export'],
    principal: ['view', 'export'],
    academic_vice_principal: ['view', 'export'],
  }),
  divisions: rows({
    super_admin: ['view', 'create', 'edit', 'archive', 'export'],
    principal: ['view', 'export'],
    academic_vice_principal: ['view', 'export'],
  }),
  academic_years: rows({
    super_admin: ['view', 'create', 'edit'],
    principal: ['view'],
    academic_vice_principal: ['view'],
  }),
  quarters: rows({
    super_admin: ['view', 'edit'],
    principal: ['view'],
    academic_vice_principal: ['view', 'edit'],
  }),
  day_templates: rows({
    super_admin: ['view', 'create', 'edit', 'archive'],
    principal: ['view'],
    academic_vice_principal: ['view', 'create', 'edit', 'archive'],
  }),
  calendar: rows({
    super_admin: ['view', 'create', 'edit', 'archive'],
    principal: ['view'],
    academic_vice_principal: ['view', 'create', 'edit', 'archive'],
  }),
  settings: rows({
    super_admin: ['view', 'edit'],
    principal: ['view'],
    academic_vice_principal: ['view', 'edit'],
  }),
  subjects: rows({
    super_admin: ['view', 'create', 'edit', 'archive', 'export'],
    principal: ['view', 'export'],
    academic_vice_principal: ['view', 'create', 'edit', 'archive', 'export'],
  }),
  staff: rows({
    super_admin: ['view', 'create', 'edit', 'export'],
    principal: ['view', 'export'],
    academic_vice_principal: ['view', 'edit', 'export'],
  }),
  staff_teaching: rows({
    super_admin: ['view', 'edit'],
    principal: ['view'],
    academic_vice_principal: ['view', 'edit'],
  }),
  vacancies: rows({
    super_admin: ['view', 'create', 'edit', 'archive', 'export'],
    principal: ['view', 'export'],
    academic_vice_principal: ['view', 'create', 'edit', 'archive', 'export'],
  }),
  accounts: rows({
    super_admin: ['view', 'create', 'edit'],
    principal: ['view'],
  }),
  account_access: rows({
    super_admin: ['view', 'edit'],
    principal: ['view'],
    academic_vice_principal: ['view', 'edit'],
  }),
  head_teachers: rows({
    super_admin: ['view'],
    principal: ['view'],
    academic_vice_principal: ['view'],
    senior_head_teacher: ['view'],
    head_teacher: ['view'],
  }),
  students: rows({
    super_admin: ['view', 'create', 'edit', 'archive'],
    principal: ['view'],
    academic_vice_principal: ['view', 'create', 'edit', 'archive'],
    spiritual_vice_principal: ['view'],
    head_tutor: ['view'],
    tutor: ['view'],
    senior_head_teacher: ['view'],
    head_teacher: ['view'],
  }),
  student_contact: rows({
    super_admin: ['view'],
    principal: ['view'],
    academic_vice_principal: ['view'],
    spiritual_vice_principal: ['view'],
    head_tutor: ['view'],
  }),
  student_identity: rows({
    super_admin: ['view'],
    academic_vice_principal: ['view'],
  }),
  student_financial: rows({
    super_admin: ['view'],
    principal: ['view'],
    academic_vice_principal: ['view'],
  }),
  student_graduates: rows({
    super_admin: ['edit'],
  }),
  current_period: rows({
    super_admin: ['view'],
    principal: ['view'],
    academic_vice_principal: ['view'],
    spiritual_vice_principal: ['view'],
    head_tutor: ['view'],
    tutor: ['view'],
    senior_head_teacher: ['view'],
    head_teacher: ['view'],
    teacher: ['view'],
    student: ['view'],
    parent: ['view'],
    hr: ['view'],
    nurse: ['view'],
    psychologist: ['view'],
    librarian: ['view'],
  }),
} as const satisfies PermissionTable);

export type Area = keyof typeof PERMISSIONS;

/** Whether the table gives the role this action in this area. An unknown area gives nothing. */
export function permits(table: PermissionTable, role: Role, area: string, action: Action): boolean {
  if (!Object.hasOwn(table, area)) {
    return false;
  }
  const rows: Partial<PermissionRows> | undefined = table[area];
  return rows !== undefined && Object.hasOwn(rows, role) && (rows[role]?.includes(action) ?? false);
}

/** The Principal "views everything in the branch ... changes nothing"; exports are allowed. */
const PRINCIPAL_ACTIONS: readonly Action[] = ['view', 'export'];

/**
 * The rules no table may break, each named with its area when it is broken; an
 * empty list means the table is sound.
 *
 * - Every area has a row for each of the 15 roles and names only known roles
 *   and actions.
 * - The Principal has no action but view and export (edge cases, "Who can
 *   act" and the last row of "Personal data and the audit log": "the Principal
 *   has no edit rights").
 * - The Super Admin has every action that any other role has: "Everything
 *   every other role can do".
 */
export function checkTable(table: PermissionTable): string[] {
  const problems: string[] = [];
  const known = new Set<string>(ROLES);
  const actions = new Set<string>(ACTIONS);
  for (const [area, rows] of Object.entries(table)) {
    const written: Partial<Record<string, readonly string[]>> = rows;
    for (const role of ROLES) {
      if (!Object.hasOwn(written, role)) {
        problems.push(`${area}: no row for ${role}`);
      }
    }
    for (const [role, allowed] of Object.entries(written)) {
      if (!known.has(role)) {
        problems.push(`${area}: ${role} is not a role`);
      }
      for (const action of allowed ?? []) {
        if (!actions.has(action)) {
          problems.push(`${area}: ${role} has ${action}, which is not an action`);
        }
      }
    }
    for (const action of written.principal ?? []) {
      if (!PRINCIPAL_ACTIONS.some((allowed) => allowed === action)) {
        problems.push(`${area}: the Principal has ${action}`);
      }
    }
    const superAdmin = new Set(written.super_admin ?? []);
    for (const role of ROLES) {
      for (const action of written[role] ?? []) {
        if (!superAdmin.has(action)) {
          problems.push(`${area}: ${role} has ${action} and the Super Admin does not`);
        }
      }
    }
  }
  return problems;
}
