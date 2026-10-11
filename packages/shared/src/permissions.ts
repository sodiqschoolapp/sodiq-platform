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
 *   and the rooms are an input of the timetable (`06`, step 4). No `export`
 *   until the export route of the lists exists (task 2.2).
 * - `divisions` (`03`, Division and Department; task 1.2): the Super Admin
 *   alone adds, renames and archives divisions and their departments ("Only
 *   this role creates ... divisions", `02`). The Principal views everything;
 *   the Academic Vice Principal reads the list because the department is a
 *   column of the teacher list (`04`) and a filter of the timetable board
 *   (`06`); approved by the owner, pull request #40, answer 5.
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
 *   edit of ... subjects and their weights"); the Principal views. No
 *   `export` until the export of the lists exists (task 2.2). A new area for
 *   new routes, decided without the owner on pull request #52 (decision 1),
 *   flagged on issue #42.
 */
export const PERMISSIONS = freezeTable({
  branches: rows({
    super_admin: ['view', 'create', 'edit'],
    principal: ['view'],
    academic_vice_principal: ['view'],
  }),
  rooms: rows({
    super_admin: ['view', 'create', 'edit', 'archive'],
    principal: ['view'],
    academic_vice_principal: ['view'],
  }),
  divisions: rows({
    super_admin: ['view', 'create', 'edit', 'archive'],
    principal: ['view'],
    academic_vice_principal: ['view'],
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
    super_admin: ['view', 'create', 'edit', 'archive'],
    principal: ['view'],
    academic_vice_principal: ['view', 'create', 'edit', 'archive'],
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
