import {
  permits,
  type Action,
  type Area,
  type AssistantReadGroup,
  type AssistantRole,
  type PermissionTable,
} from '@sodiq/shared';
import {
  SUPER_ADMIN_CHANGES,
  type AssistantChangeLine,
  type AssistantPreviewLine,
} from './assistant-change-routes.js';

/**
 * The actions open to the assistant (`02`, Assistant: "The actions open to it are a list fixed
 * in code for each of the three roles; an action added later stays closed to it until a task
 * adds it"; task 11.12, pull request #374). A route is named `<METHOD> /api/<path>` as Express
 * registers it. `assistant-routes.test.ts` holds each list against the independent copy of
 * `apps/api/src/testing/assistant-route-list.ts`, and `AssistantRoutes` stops the app at start
 * for a listed route against `assistantRouteFault`.
 */
export interface AssistantReadLine {
  kind?: 'read';
  /** What the panel names the read by ("Read: Classes and groups"). */
  group: AssistantReadGroup;
  /** The tool's description, the line the model reads: what the route answers, in English. */
  description: string;
  /**
   * Keys removed at any depth from this read before the model is given it, beside the field
   * filter (task 11.13): a relative's name is of the student's Contact group (11.12 decision 2).
   */
  withheld?: readonly string[];
}

/**
 * The Super Admin's reads (task 11.12): "Reading: everything their role reads, except the fields
 * below" (`02`). Left out in this task, decision 4 of the plan (Look first): accounts and their
 * access, integration keys, the audit log, the personal-data report, monitoring, the demo clock,
 * relatives and parent accounts, the student Contact, Identity, Financial, diagnostic and history
 * routes, and exports.
 */
const SUPER_ADMIN_READS: Readonly<Record<string, AssistantReadLine>> = {
  'GET /api/setup/branch': {
    group: 'setup',
    description: 'The branch of the request: its name, working weekdays and settings.',
  },
  'GET /api/setup/buildings': {
    group: 'setup',
    description: 'The buildings and floors of the branch.',
  },
  'GET /api/setup/rooms': {
    group: 'setup',
    description: 'The rooms of the branch, with building, floor, capacity and whether shared.',
  },
  'GET /api/setup/divisions': {
    group: 'setup',
    description: 'The divisions of the school and their departments.',
  },
  'GET /api/setup/academic-years': {
    group: 'calendar',
    description: 'The academic years of the branch with their quarters and dates.',
  },
  'GET /api/setup/current-period': {
    group: 'calendar',
    description: 'The current academic year and quarter of the branch.',
  },
  'GET /api/setup/calendar-entries': {
    group: 'calendar',
    description: 'Days off and special days of the academic calendar of a year.',
  },
  'GET /api/setup/calendar-day': {
    group: 'calendar',
    description: 'What one date is in the calendar: a school day, a day off or a special day.',
  },
  'GET /api/setup/slot-types': {
    group: 'calendar',
    description: 'The slot types (lesson, break and the rest) of the branch.',
  },
  'GET /api/setup/day-templates': {
    group: 'calendar',
    description: 'The day templates of the branch: the slots of a school day and their times.',
  },
  'GET /api/setup/day-template-assignments': {
    group: 'calendar',
    description: 'Which day template each grade and weekday uses.',
  },
  'GET /api/setup/settings': {
    group: 'setup',
    description: 'The settings of the branch: edit days, early-warning thresholds and the rest.',
  },
  'GET /api/setup/checklist': {
    group: 'setup',
    description: 'The setup checklist of the branch: what is done and what is missing.',
  },
  'GET /api/setup/subjects': {
    group: 'setup',
    description: 'The subjects of the school with their departments, grades and weights.',
  },
  'GET /api/setup/subjects/:id/quarter-weights': {
    group: 'setup',
    description: 'The quarter weights of one subject in the branch.',
  },
  'GET /api/setup/travel-times': {
    group: 'setup',
    description: 'The travel times between the branches.',
  },
  'GET /api/people/staff': {
    group: 'staff',
    description: 'The staff of the branch: names, staff IDs, roles, departments and status.',
  },
  'GET /api/people/staff/:id': {
    group: 'staff',
    description: 'One staff record: name, staff ID, roles, subjects, grades and status.',
  },
  'GET /api/people/staff/:id/availability': {
    group: 'staff',
    description: 'When one teacher is available for lessons.',
  },
  'GET /api/people/vacancies': {
    group: 'staff',
    description: 'The vacancies of the branch, open and closed.',
  },
  'GET /api/people/vacancies/:id': {
    group: 'staff',
    description: 'One vacancy with its subjects and the lessons it holds.',
  },
  'GET /api/people/students': {
    group: 'students',
    description: 'The students of the branch with name, UID, class and status.',
  },
  'GET /api/people/students/:id': {
    group: 'students',
    description: 'One student: name, UID, class, groups and status.',
  },
  'GET /api/people/students/no-class': {
    group: 'students',
    description: 'The active students of the branch who have no class.',
  },
  'GET /api/access/head-teachers': {
    group: 'staff',
    description: 'The Head Teachers and Senior Head Teachers of the branch and their subjects.',
  },
  'GET /api/classes': {
    group: 'classes',
    description:
      'The classes of the branch with grade, language, room, Tutor or Class teacher (null when none) and the number of students.',
  },
  'GET /api/classes/:id': {
    group: 'classes',
    description: 'One class with its Tutor or Class teacher, room and details.',
  },
  'GET /api/classes/:id/members': {
    group: 'classes',
    description: 'The students of one class.',
  },
  'GET /api/groups': {
    group: 'classes',
    description: 'The groups of the branch with subject, classes, teacher and size.',
  },
  'GET /api/groups/:id': {
    group: 'classes',
    description: 'One group with its subject, classes and teacher.',
  },
  'GET /api/groups/:id/members': {
    group: 'classes',
    description: 'The students of one group.',
  },
  'GET /api/timetable/views/choices': {
    group: 'timetable',
    description: 'The classes, teachers and rooms a timetable view can show, with their ids.',
  },
  'GET /api/timetable/views/branch': {
    group: 'timetable',
    description: 'The timetable of the whole branch for a week.',
  },
  'GET /api/timetable/views/class': {
    group: 'timetable',
    description: 'The timetable of one class for a week.',
  },
  'GET /api/timetable/views/teacher': {
    group: 'timetable',
    description: 'The timetable of one teacher for a week.',
  },
  'GET /api/timetable/views/room': {
    group: 'timetable',
    description: 'The timetable of one room for a week.',
  },
  'GET /api/timetable/day': {
    group: 'timetable',
    description: 'The lessons of one day of the branch with teachers, rooms and changes.',
  },
  'GET /api/timetable/absences': {
    group: 'timetable',
    description: 'The teacher absences of the branch.',
  },
  'GET /api/timetable/exams': {
    group: 'timetable',
    description: 'The exams of the branch with dates, rooms and invigilators.',
  },
  'GET /api/timetable/room-closures': {
    group: 'timetable',
    description: 'The rooms closed for a period.',
  },
  'GET /api/timetable/versions': {
    group: 'timetable',
    description: 'The timetable versions of the branch: drafts and published, with dates.',
  },
  'GET /api/timetable/attention': {
    group: 'timetable',
    description: 'The lessons that need attention: needs a teacher, unresolved, clashes.',
  },
  'GET /api/timetable/conflicts-summary': {
    group: 'timetable',
    description: 'A summary of the conflicts of the timetable.',
  },
  'GET /api/timetable/reports/load': {
    group: 'timetable',
    description: 'The teaching load report: lessons per teacher.',
  },
  'GET /api/journal/journals': {
    group: 'journal',
    description: 'The journals of the branch: class or group, subject and teacher.',
  },
  'GET /api/journal/journals/:journalId': {
    group: 'journal',
    description: 'One journal with its lessons, works and the platform’s results.',
  },
  'GET /api/journal/lessons-today': {
    group: 'journal',
    description: 'The lessons of today and whether their journal is filled.',
  },
  'GET /api/journal/attendance-today': {
    group: 'journal',
    description: 'Today’s attendance of the branch, by class.',
  },
  'GET /api/journal/discipline': {
    group: 'journal',
    description: 'The journal discipline report: lessons left unfilled, by teacher.',
  },
  'GET /api/journal/unlocks': {
    group: 'journal',
    description: 'The unlock requests of locked lessons and their decisions.',
  },
  'GET /api/plans': {
    group: 'plans',
    description: 'The lesson plans of the branch.',
  },
  'GET /api/plans/windows': {
    group: 'plans',
    description: 'The lesson plan windows: when plans may be written.',
  },
  'GET /api/plans/requests': {
    group: 'plans',
    description: 'The requests to edit a lesson plan after the window.',
  },
  'GET /api/plans/reports/completeness': {
    group: 'plans',
    description: 'How complete the lesson plans are, by journal.',
  },
  'GET /api/plans/reports/progress': {
    group: 'plans',
    description: 'How far the lessons have come along their plans.',
  },
  'GET /api/results/rating/choices': {
    group: 'results',
    description: 'The quarters, grades and subjects the rating can show, with their ids.',
  },
  'GET /api/results/rating/classes': {
    group: 'results',
    description: 'The rating of the classes, as the platform calculates it.',
  },
  'GET /api/results/rating/class': {
    group: 'results',
    description: 'The rating list of one class, as the platform calculates it.',
  },
  'GET /api/results/rating/subject': {
    group: 'results',
    description: 'The rating of one subject across classes, as the platform calculates it.',
  },
  'GET /api/results/early-warning': {
    group: 'results',
    description: 'The early-warning list: students whose results or attendance are low.',
  },
  'GET /api/results/branch-summary': {
    group: 'results',
    description: 'The summary of the branch: results and attendance by grade.',
  },
  'GET /api/results/reports/choices': {
    group: 'results',
    description: 'The quarters, classes and subjects the reports can show, with their ids.',
  },
  'GET /api/results/reports/attendance': {
    group: 'results',
    description: 'The attendance report, as the platform calculates it.',
  },
  'GET /api/results/reports/results-table': {
    group: 'results',
    description: 'The results table of a class or grade: averages and grades per subject.',
  },
  'GET /api/results/reports/subject-mastery': {
    group: 'results',
    description: 'The subject mastery report: grades per subject.',
  },
  'GET /api/results/students/:id': {
    group: 'results',
    description: 'One student’s results per subject and quarter, as the platform calculates them.',
  },
  'GET /api/announcements': {
    group: 'announcements',
    description: 'The announcements and events of the branch.',
  },
  'GET /api/search/students': {
    group: 'search',
    description: 'Finds students by name or UID.',
  },
  'GET /api/search/staff': {
    group: 'search',
    description: 'Finds staff by name or staff ID.',
  },
  'GET /api/search/classes': {
    group: 'search',
    description: 'Finds classes by name.',
  },
  'GET /api/search/groups': {
    group: 'search',
    description: 'Finds groups by name.',
  },
  // Task 11.13: the reads a change is proposed on (its basis, plan "Basis of a step").
  'GET /api/timetable/lessons/:id/history': {
    group: 'timetable',
    description: 'The changes of one dated lesson: teacher, room, time, cancel, before and after.',
  },
  'GET /api/timetable/versions/:id/load': {
    group: 'timetable',
    description: 'The teaching load rows of a timetable version.',
  },
  // Decision 15 of the plan of pull request #376: names and relationship; phones are removed.
  'GET /api/people/students/:id/relatives': {
    group: 'students',
    description:
      'The relatives of one student: relationship, main contact and the portal access switch (names and phones are withheld).',
    withheld: ['fullName', 'name', 'firstName', 'lastName', 'patronymic', 'paternalName'],
  },
};

/** A line of a list: a read, a change proposed and confirmed (11.13), or a preview of one. */
export type AssistantRouteLine = AssistantReadLine | AssistantChangeLine | AssistantPreviewLine;

/** The Super Admin's list: the reads and the changes (task 11.13). */
const SUPER_ADMIN: Readonly<Record<string, AssistantRouteLine>> = {
  ...SUPER_ADMIN_READS,
  ...SUPER_ADMIN_CHANGES,
};

export type AssistantRouteLists = Readonly<
  Partial<Record<AssistantRole, Readonly<Record<string, AssistantRouteLine>>>>
>;

/** The list of each role written here; a role not named has none (the Teacher in 11.14). */
export const ASSISTANT_ROUTES: AssistantRouteLists = {
  super_admin: SUPER_ADMIN,
};

/**
 * Roles whose list is another role's narrowed by the permission table (task 11.13, plan
 * decision 4, Look first): the Academic Vice Principal has every line of the Super Admin's whose
 * permission the table gives the role, and no other. `AssistantRoutes` derives it at start
 * from each route's declaration; `assistant-routes.test.ts` holds the result against a copy.
 */
export const DERIVED_ASSISTANT_LISTS: Readonly<Partial<Record<AssistantRole, AssistantRole>>> = {
  academic_vice_principal: 'super_admin',
};

/** Whether the table gives the role what a listed route requires. */
export function derivedOpens(
  table: PermissionTable,
  role: AssistantRole,
  declaration: { area?: string; action?: Action },
): boolean {
  return (
    declaration.area !== undefined &&
    declaration.action !== undefined &&
    permits(table, role, declaration.area as Area, declaration.action)
  );
}

/**
 * The lists `AssistantRoutes` reads for the guard: `ASSISTANT_ROUTES`, except in a test app that
 * gives a role with no list yet a list of its own, to test the narrowing to a chosen role.
 */
export const ASSISTANT_ROUTE_LISTS = Symbol('ASSISTANT_ROUTE_LISTS');

/** The routes of a role's list, by name. */
export function assistantRoutesOf(
  role: AssistantRole,
): Readonly<Record<string, AssistantRouteLine>> {
  return ASSISTANT_ROUTES[role] ?? {};
}

/**
 * `02`, Assistant, "Never through the assistant": "Entering or changing journal data …,
 * journal corrections, exemptions, closing a quarter; publishing or withdrawing a timetable
 * version; starting or closing a year; force delete; accounts (passwords, second step, sessions,
 * printed slips), roles, appointments and permissions; integration keys; exports." The areas
 * whose changes are never open (the permission table itself has no route).
 */
export const NEVER_CHANGED_THROUGH_ASSISTANT: readonly string[] = [
  'journal',
  'journal_support',
  'exemptions',
  'quarter_closing',
  'results_recalculation',
  'forced_deletes',
  'accounts',
  'account_access',
  'parent_accounts',
  'integration_keys',
  // Journal data: the reason of an absence (spec review of the code, should fix 7).
  'absence_reasons',
];

/**
 * The same list, by route, where the area also holds changes the assistant may make (11.13).
 * Closing a year has no route yet (task 9.5a); every route stays closed to the assistant until a
 * task puts it on a list, and 9.5a adds its route here.
 */
export const NEVER_ROUTES_THROUGH_ASSISTANT: readonly string[] = [
  'POST /api/timetable/versions/:id/publish',
  'POST /api/timetable/versions/:id/withdraw',
  'POST /api/setup/academic-years/:id/start',
  // Appointments (`02`: "roles, appointments and permissions"): a class's Tutor and an acting
  // teacher, whose areas also hold changes 11.13 may open (spec review of the code, should fix 7).
  'POST /api/classes/:id/tutors',
  'POST /api/classes/:id/tutors/:tutorId/end',
  'POST /api/timetable/acting-teachers',
  'POST /api/timetable/acting-teachers/:id/end',
  // Task 11.13 (decision 2 of the plan of pull request #376, Look first): appointments and what
  // ends roles, a version published, held lessons changed, removals, an import that creates
  // accounts (review correction 1).
  'POST /api/classes/:id/tutors/preview',
  'POST /api/timetable/acting-teachers/check',
  'POST /api/people/staff/:id/roles',
  'POST /api/people/staff/:id/roles/:assignmentId/end',
  'POST /api/people/staff/:id/roles/:assignmentId/subjects',
  'POST /api/people/staff/:id/status',
  'PUT /api/people/staff/:id/branches',
  'POST /api/timetable/absences/:id/journal-substitute',
  'POST /api/timetable/vacancies/:id/journal-substitute',
  'POST /api/timetable/lessons/:id/correction',
  'POST /api/timetable/vacancy-fills',
  'POST /api/timetable/vacancy-fills/check',
  'POST /api/timetable/lessons/:id/forced-delete',
  'POST /api/setup/buildings/:id/forced-delete',
  'POST /api/setup/floors/:id/forced-delete',
  'POST /api/setup/rooms/:id/forced-delete',
  'POST /api/forced-deletes/:id/restore',
  'POST /api/people/staff/imports/:id/confirm',
  'POST /api/people/vacancies/:id/delete',
  'POST /api/people/students/:id/delete',
];

/** What a listed route declares, as `assistantRouteFault` reads it. */
export interface AssistantRouteFacts {
  /** `<METHOD> /api/<path>`. */
  name: string;
  method: string;
  /** `declarationsOf(handler)`. */
  declarations: readonly { kind: string; area?: string; action?: Action }[];
  /** The line of the list (task 11.13): a read, a change or a preview. */
  line?: AssistantRouteLine;
}

/**
 * Why a listed route is a fault of the code, or `undefined`. The application does not start
 * with one (`AssistantRoutes`), and `assistant-routes.test.ts` runs it over every route.
 */
export function assistantRouteFault(facts: AssistantRouteFacts): string | undefined {
  const [declaration] = facts.declarations;
  if (declaration === undefined || facts.declarations.length !== 1) {
    return 'is on the assistant’s list without exactly one access declaration';
  }
  if (declaration.kind !== 'requires') {
    return `is on the assistant’s list with the declaration ${declaration.kind}; only a route with a permission may be`;
  }
  if (declaration.action === 'export') {
    return 'is an export, never through the assistant';
  }
  if (NEVER_ROUTES_THROUGH_ASSISTANT.includes(facts.name)) {
    return 'is never through the assistant';
  }
  if (
    facts.method !== 'GET' &&
    NEVER_CHANGED_THROUGH_ASSISTANT.some((area) => area === declaration.area)
  ) {
    return `changes the area ${String(declaration.area)}, never through the assistant`;
  }
  const kind = facts.line?.kind ?? 'read';
  // A read is a GET of a `view`: a GET gated by another action reads what that action's
  // holders alone may see.
  if (kind === 'read') {
    return facts.method === 'GET' && declaration.action === 'view'
      ? undefined
      : 'is listed as a read and is not a GET of a view';
  }
  // Task 11.13: a change is sent only at Confirm, a preview writes nothing; neither is a GET.
  if (facts.method === 'GET') {
    return `is listed as a ${kind} and is a GET`;
  }
  return undefined;
}

/**
 * Why a line of a role's list does not fit the lines beside it (task 11.13), or `undefined`: a
 * change's basis read and preview must be on the same list, as a read and as a preview.
 */
export function assistantLineFault(
  name: string,
  line: AssistantRouteLine,
  lines: Readonly<Record<string, AssistantRouteLine>>,
): string | undefined {
  if (line.kind !== 'change') {
    return undefined;
  }
  if (line.basis.kind === 'read') {
    const basis = lines[line.basis.route];
    if (basis === undefined || (basis.kind ?? 'read') !== 'read') {
      return `rests on ${line.basis.route}, which is not a read of the same list`;
    }
  }
  if (line.preview !== undefined && lines[line.preview.route]?.kind !== 'preview') {
    return `has the preview ${line.preview.route}, which is not a preview of the same list`;
  }
  if (line.only !== undefined && line.fromBasis !== undefined && line.basis.kind !== 'read') {
    return `takes fields from a basis read it does not have (${name})`;
  }
  return undefined;
}
