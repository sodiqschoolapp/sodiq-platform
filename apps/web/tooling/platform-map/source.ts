import type { MenuItem } from '@sodiq/shared';

// Task 11.19: the hand-written part of the map of the platform, beside the walk of the code
// (`walk.ts`) and the descriptions (`descriptions/`). Each list here is closed: the test of the
// map (`tooling/platform-map.test.ts`) fails on a page, part, file or value the code has and the
// lists do not name, so a later task that adds one says here what it is.

/**
 * The files of `components/` that draw controls of their own, walked as a part of every page
 * that draws them (plan, review should fix 5): the list's toolbar and table, the side panel,
 * the record form's Save and Cancel, the shell's search and theme.
 */
export const SHARED_PARTS: readonly string[] = [
  'components/list/list-page.tsx',
  'components/list/data-table.tsx',
  'components/list/panel-actions.tsx',
  'components/side-panel.tsx',
  'components/form/record-form.tsx',
  'components/forced-delete-dialog.tsx',
  'components/prepared-stamp.tsx',
  'components/search/command-search.tsx',
  'components/states.tsx',
  'components/theme-switch.tsx',
  'components/unsent/unsent-changes.tsx',
];

/** The files of `components/` with controls that are not a part of their own, and why. */
export const PRIMITIVES: Readonly<Record<string, string>> = {
  'components/field.tsx':
    'The field components draw the label a form gives them; each field is a node of the form that draws it.',
};

/** Staff pages left out of the map, and why (plan decision 10). */
export const LEFT_OUT_PAGES: Readonly<Record<string, string>> = {
  '/dev/patterns': 'The sample page of the design patterns exists only in development.',
};

/**
 * Who opens a page that is not `guarded(area, Page)` in the router: every staff role, or the
 * roles whose menu shows an item (`visibleMenu`), or a role that views one of a few areas.
 */
export type PageGuard =
  | { every: true }
  | { menu: MenuItem }
  | {
      anyOf: ReadonlyArray<{
        area: string;
        action: 'view' | 'create' | 'edit' | 'archive' | 'export';
      }>;
    };

export const PAGE_GUARDS: Readonly<Record<string, PageGuard>> = {
  '/': { every: true },
  '/account': { every: true },
  '/account/password': { every: true },
  '/people': { menu: 'people' },
  '/setup': { menu: 'setup' },
  // `useMayReport` of `features/results/reports-page.tsx`.
  '/results/reports': {
    anyOf: [
      { area: 'attendance_report', action: 'view' },
      { area: 'results_reports', action: 'view' },
      { area: 'journal_discipline', action: 'view' },
      { area: 'timetable_load', action: 'view' },
    ],
  },
};

/** The title key of a page whose header the walk does not read (a title naming a record). */
export const PAGE_TITLES: Readonly<Record<string, string>> = {
  // The title is the own password's or the forced change's, chosen at the page.
  '/account/password': 'password.titleOwn',
};

/** How a value of an address is checked: a path parameter or a search key. */
export type ValueKind =
  | { kind: 'id' }
  | { kind: 'date' }
  | { kind: 'month' }
  | { kind: 'text' }
  | { kind: 'number' }
  | { kind: 'boolean' }
  | { kind: 'record' }
  | { kind: 'enum'; values: readonly string[] };

/** A path parameter that is not an id, with its values. */
export const PARAM_VALUES: Readonly<Record<string, ValueKind>> = {
  // `personalDataKindSchema` of `packages/shared`.
  kind: { kind: 'enum', values: ['staff', 'student'] },
};

/**
 * The search keys of the pages that are texts in the code, with what they hold. A key that is
 * a union of values in the code takes those values, and needs no line here.
 */
export const SEARCH_KINDS: Readonly<Record<string, ValueKind>> = {
  q: { kind: 'text' },
  sort: { kind: 'text' },
  open: { kind: 'id' },
  conversation: { kind: 'id' },
  person: { kind: 'id' },
  recordType: { kind: 'text' },
  recordId: { kind: 'id' },
  from: { kind: 'date' },
  to: { kind: 'date' },
  year: { kind: 'id' },
  quarter: { kind: 'id' },
  date: { kind: 'date' },
  month: { kind: 'month' },
  week: { kind: 'date' },
  department: { kind: 'id' },
  class: { kind: 'id' },
  journal: { kind: 'id' },
  student: { kind: 'id' },
  subject: { kind: 'id' },
  teacher: { kind: 'id' },
  building: { kind: 'id' },
  floor: { kind: 'id' },
  version: { kind: 'id' },
  id: { kind: 'id' },
};

/**
 * Controls whose label the walk cannot read as a key (correction 7 of the plan review): by
 * file, how many and why. Each is a record's own name or a text built from data, which the
 * person reads on the screen; such a control is described by its file's panel or page.
 */
export const UNREAD_LABELS: Readonly<Record<string, { count: number; reason: string }>> = {
  'components/forced-delete-dialog.tsx': {
    count: 1,
    reason:
      "The forced delete's dialog takes its title from the record's own part (a lesson, an exam).",
  },
  'components/list/data-table.tsx': {
    count: 2,
    reason:
      "A column header's sort button carries the column's own name; a row's open link carries the record's name.",
  },
  'components/list/list-page.tsx': {
    count: 1,
    reason: "The bulk actions of a list are given by the page, each with its page's label.",
  },
  'components/list/panel-actions.tsx': {
    count: 1,
    reason: "The More menu repeats the panel's own buttons, each already a node of the panel.",
  },
  'features/access/app-menu.tsx': {
    count: 2,
    reason: "The menu's items, each named by its page's title; each page is a page of the map.",
  },
  'features/access/vice-principal-banner.tsx': {
    count: 1,
    reason: "The banner's link names a branch.",
  },
  'features/assistant/assistant-page.tsx': {
    count: 1,
    reason: 'A conversation of the list is named by its first question.',
  },
  'features/assistant/assistant-panel.tsx': {
    count: 1,
    reason: 'A conversation of the list is named by its first question.',
  },
  'features/classes/classes-page.tsx': { count: 1, reason: "A row's link is the class's name." },
  'features/classes/groups-page.tsx': { count: 1, reason: "A row's link is the group's name." },
  'features/journal/edit-period.tsx': {
    count: 3,
    reason:
      'The unlock request dialog, its reason and its button are named by the kind of request chosen.',
  },
  'features/journal/exemptions-page.tsx': {
    count: 1,
    reason: 'Each lesson’s group is named by the lesson.',
  },
  'features/journal/journal-grid.tsx': {
    count: 2,
    reason: "A work's buttons and the student column are named by the work and the class.",
  },
  'features/journal/journal-page.tsx': {
    count: 1,
    reason: "A work's button is named by the work.",
  },
  'features/journal/student-photo.tsx': {
    count: 1,
    reason: "The photo's dialog is named by the student.",
  },
  'features/people/availability-section.tsx': {
    count: 1,
    reason: 'One field per weekday, named by the weekday.',
  },
  'features/people/branch-move.tsx': {
    count: 1,
    reason: 'One group choice per subject, named by the subject.',
  },
  'features/people/relative-form.tsx': {
    count: 1,
    reason: 'A tick named by the relative’s phone.',
  },
  'features/people/vacancy-fill-dialog.tsx': {
    count: 1,
    reason: 'A suggested date is named by the date.',
  },
  'features/plans/plan-item-editor.tsx': {
    count: 1,
    reason: 'A suggestion is named by its own words.',
  },
  'features/plans/plan-row-panel.tsx': { count: 1, reason: 'A file is named by its file name.' },
  'features/results/load-report-page.tsx': {
    count: 4,
    reason: "The teaching load report's texts are read through a short-hand of the page (`k`).",
  },
  'features/results/results-table-page.tsx': {
    count: 1,
    reason: 'One column per subject, named by the subject.',
  },
  'features/results/student-results-tab.tsx': {
    count: 1,
    reason: 'A result is named by its figure.',
  },
  'features/setup/division-panel.tsx': {
    count: 1,
    reason: 'One name field per language, named by the language.',
  },
  'features/setup/rooms-by-floor.tsx': { count: 1, reason: 'A floor tab is named by the floor.' },
  'features/timetable/blocked-rules.tsx': { count: 1, reason: 'A room is named by the room.' },
  'features/timetable/bulk-cancel-dialog.tsx': {
    count: 1,
    reason: 'Each lesson’s choice is named by the lesson.',
  },
  'features/timetable/day-page.tsx': {
    count: 1,
    reason: 'The forced delete is named by the lesson.',
  },
  'features/timetable/exam-form.tsx': {
    count: 1,
    reason: 'The units are named by the exam’s kind.',
  },
  'features/timetable/grid-move-dialog.tsx': {
    count: 1,
    reason: 'The dialog is named by the lesson moved.',
  },
  'features/timetable/grid-room-picker.tsx': {
    count: 1,
    reason: 'The dialog is named by the lesson.',
  },
  'features/timetable/grid-suggest-dialog.tsx': {
    count: 1,
    reason: 'The dialog is named by the lesson.',
  },
  'features/timetable/journal-substitute-dialog.tsx': {
    count: 1,
    reason: 'The dialog is named by the lesson.',
  },
  'features/timetable/load-page.tsx': { count: 1, reason: "A row's link is the load row's name." },
  'features/timetable/publish-day-changes.tsx': {
    count: 5,
    reason: 'Each change waiting for a decision is named by the change.',
  },
  'features/timetable/views-page.tsx': {
    count: 1,
    reason: 'The record choice is named by the kind of view.',
  },
  'features/timetable/withdraw-dialog.tsx': {
    count: 1,
    reason: 'The dialog is named by the version.',
  },
};
