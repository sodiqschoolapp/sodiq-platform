import { permits, type PermissionTable } from './permissions.js';
import type { Role } from './roles.js';

/**
 * The items of the left menu. An item is the place where an area of the
 * spec is worked in; `home` is the first screen and belongs to every role.
 */
export const MENU_ITEMS = [
  'home',
  'setup',
  'people',
  'classes',
  'timetable',
  'journal',
  'results',
  'plans',
  'requests',
  'audit_log',
] as const;

export type MenuItem = (typeof MENU_ITEMS)[number];

/** `12`: "a left menu that shows only what the role can use, with no more than about ten items". */
export const MENU_MAX_ITEMS = 10;

const MANAGEMENT: readonly MenuItem[] = [
  'home',
  'setup',
  'people',
  'classes',
  'timetable',
  'journal',
  'results',
  'plans',
];

const HEAD_TEACHER: readonly MenuItem[] = [
  'home',
  'people',
  'classes',
  'timetable',
  'journal',
  'results',
  'plans',
  'requests',
];

/**
 * The menu of each of the 15 roles, in the order it is shown (decided by the
 * owner at the plan of task 0.8c, pull request #27, from `02`, `04`, `06`
 * "Views and outputs", `07`, `08`, `09` and the personal data rows of
 * `edge/people-roles-accounts`). It is display only: no route trusts it, and
 * where it and the permission table disagree the permission table wins, see
 * `visibleMenu`. Which of the actions an item allows is not written here:
 * the Principal's items are all view only.
 */
export const MENU: Readonly<Record<Role, readonly MenuItem[]>> = Object.freeze({
  super_admin: [...MANAGEMENT, 'requests', 'audit_log'],
  principal: [...MANAGEMENT, 'audit_log'],
  academic_vice_principal: [...MANAGEMENT, 'requests', 'audit_log'],
  spiritual_vice_principal: ['home', 'people', 'classes', 'timetable', 'journal', 'results'],
  head_tutor: ['home', 'people', 'classes', 'timetable', 'journal', 'results'],
  // Own classes (task 3.1c, decision 4 of pull request #90, Look first).
  tutor: ['home', 'people', 'classes', 'timetable', 'journal', 'results'],
  senior_head_teacher: HEAD_TEACHER,
  head_teacher: HEAD_TEACHER,
  teacher: ['home', 'timetable', 'journal', 'plans', 'results'],
  student: ['home'],
  parent: ['home'],
  hr: ['home'],
  nurse: ['home'],
  psychologist: ['home'],
  librarian: ['home'],
});

/**
 * The areas whose view opens an item, where they are more than the area of
 * the item's name: "Timetable" leads to the read-only views of
 * `timetable_views` for the roles that see no draft (task 5.9a, pull request
 * #197, decision 2).
 */
export const MENU_AREAS: Readonly<Partial<Record<MenuItem, readonly string[]>>> = Object.freeze({
  timetable: ['timetable', 'timetable_views'],
  // Task 9.3a: "Results" leads to the rating and the closing checklist; 9.4a adds the
  // early-warning list; 9.3b-2 the reports of `08`, Analytics (the menu holds at most ten
  // items, so the reports are pages of Results, not an item of their own).
  results: [
    'rating',
    'quarter_closing',
    'early_warning',
    'attendance_report',
    'results_reports',
    'timetable_load',
    'journal_discipline',
  ],
});

/**
 * The menu a role sees now: the items of its row that are built (`built`
 * lists the pages that exist) and, where the permission table has an area of
 * the item (its name, or those of `MENU_AREAS`), only those the table lets
 * the role view in one of them. The table is the only source of rights; this
 * function can never add an item to it.
 */
export function visibleMenu(
  role: Role,
  built: ReadonlySet<MenuItem>,
  table: PermissionTable,
): MenuItem[] {
  return MENU[role].filter((item) => {
    if (item === 'home') return true;
    if (!built.has(item)) return false;
    const areas = (MENU_AREAS[item] ?? [item]).filter((area) => Object.hasOwn(table, area));
    return areas.length === 0 || areas.some((area) => permits(table, role, area, 'view'));
  });
}

/** The kinds of home page (`08`, Home pages by role). */
export const HOME_KINDS = [
  'teaching',
  'tutor',
  'attendance_overview',
  'academic_vice_principal',
  'branch_summary',
  'later_release',
] as const;

export type HomeKind = (typeof HOME_KINDS)[number];

export const HOME_KIND: Readonly<Record<Role, HomeKind>> = Object.freeze({
  super_admin: 'branch_summary',
  principal: 'branch_summary',
  academic_vice_principal: 'academic_vice_principal',
  spiritual_vice_principal: 'attendance_overview',
  head_tutor: 'attendance_overview',
  tutor: 'tutor',
  senior_head_teacher: 'teaching',
  head_teacher: 'teaching',
  teacher: 'teaching',
  student: 'later_release',
  parent: 'later_release',
  hr: 'later_release',
  nurse: 'later_release',
  psychologist: 'later_release',
  librarian: 'later_release',
});
