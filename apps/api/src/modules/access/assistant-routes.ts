import type { Action, AssistantReadGroup } from '@sodiq/shared';
import { NEW_ROUTE_LINES } from '../assistant/lines/index.js';
import {
  SUPER_ADMIN_CHANGES,
  TEACHER_CHANGES,
  type AssistantChangeLine,
  type AssistantPreviewLine,
} from './assistant-change-routes.js';

/**
 * The actions open to the assistant (task 11.20; `02`, Assistant, "What it can do": "Every action
 * the person's chosen role has on the screens … An action added to the platform later is open to
 * it too, under the switch of its area"). A route is named `<METHOD> /api/<path>` as Express
 * registers it. `ROUTE_LINES` holds, for every route with a permission, what the model needs to
 * use it: a description, and for a change what it was proposed on. Which role has a route is not
 * written here: `AssistantRoutes` (`assistant-routes.check.ts`) reads it at start from each
 * route's `@Requires` and the permission table, so a role's list is every route it holds, and
 * the Super Admin's switches (`assistant-switches.service.ts`) narrow what a question is given.
 */
export interface AssistantReadLine {
  kind?: 'read';
  /** What the panel names the read by ("Read: Classes and groups"). */
  group: AssistantReadGroup;
  /** The tool's description, the line the model reads: what the route answers, in English. */
  description: string;
}

/**
 * Task 11.20 (plan decision 7): an export, a route that takes a file, or a GET that answers a
 * file. On the lists and on the switches page; the model is given no tool for them until 11.22
 * (Files, photos and voice; exports prepared as a file).
 */
export interface AssistantFileLine {
  kind: 'export' | 'file' | 'download';
  group: AssistantReadGroup;
  description: string;
}

/**
 * The reads of 11.12 and 11.13 (the Super Admin's and the Academic Vice Principal's), kept as
 * written; since task 11.20 they are lines of `ROUTE_LINES`, open to every role the permission
 * table gives the route.
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
      'The relatives of one student: relationship, main contact and the portal access switch.',
  },
};

/** The reads of 11.14, first written for the Teacher. */
const TEACHER_READS: Readonly<Record<string, AssistantReadLine>> = {
  'GET /api/journal/lessons/:lessonId/card': {
    group: 'journal',
    description: 'The card of one own lesson: number, date, slot, topic, classworks, homeworks.',
  },
  'GET /api/journal/reminders': {
    group: 'journal',
    description: 'The own lessons whose journal is not filled yet.',
  },
  // The rating by class (`rating/classes`, `rating/class`) is for management and Tutors
  // (`rating.service.ts`): it refuses the Teacher, so it is not offered (code review).
  'GET /api/plans/journals/:journalId': {
    group: 'plans',
    description:
      'The own lesson plan of one journal for a quarter: the rows with dates, items, ids and the window state.',
  },
  'GET /api/plans/lessons/:lessonId': {
    group: 'plans',
    description: 'The plan item of one own lesson.',
  },
  'GET /api/plans/journals/:journalId/master-compare': {
    group: 'plans',
    description: 'The own plan beside the master plan it was copied from.',
  },
};

/** A line: a read, a change proposed and confirmed (11.13), a preview of one, or a file line. */
export type AssistantRouteLine =
  | AssistantReadLine
  | AssistantChangeLine
  | AssistantPreviewLine
  | AssistantFileLine;

/** What a route is to the assistant, read from the route itself (`routeKindOf`). */
export type AssistantRouteKind = 'read' | 'change' | 'preview' | 'export' | 'file' | 'download';

/** The kind a line says it is. */
export function kindOfLine(line: AssistantRouteLine): AssistantRouteKind {
  return line.kind ?? 'read';
}

/** Every line, by route name; a route is on no list without one (`assistant-lines.test.ts`). */
export const ROUTE_LINES: Readonly<Record<string, AssistantRouteLine>> = {
  ...SUPER_ADMIN_READS,
  ...TEACHER_READS,
  ...SUPER_ADMIN_CHANGES,
  ...TEACHER_CHANGES,
  ...NEW_ROUTE_LINES,
};

/**
 * The lines `AssistantRoutes` reads: `ROUTE_LINES`, except in a test app that gives other lines
 * to test the start check or a line's absence.
 */
export const ASSISTANT_ROUTE_LINES = Symbol('ASSISTANT_ROUTE_LINES');

/** The prefix of the assistant's own routes. */
export const ASSISTANT_OWN_PREFIX = '/api/assistant';

/** The assistant's settings, which live under the school settings (task 11.12). */
export const ASSISTANT_SETTINGS_ROUTES: readonly string[] = [
  'GET /api/setup/school-settings/assistant',
  'PUT /api/setup/school-settings/assistant',
];

/**
 * The routes on no list, whatever the role holds (plan decision 5): the assistant's own (its
 * status, questions, conversations, proposals, settings, switches and conversation restores).
 * `02`, Never, whatever the switches: "The assistant cannot change its own switches or limits".
 */
export function notThroughAssistant(name: string): boolean {
  if (ASSISTANT_SETTINGS_ROUTES.includes(name)) {
    return true;
  }
  const path = name.slice(name.indexOf(' ') + 1);
  return path === ASSISTANT_OWN_PREFIX || path.startsWith(`${ASSISTANT_OWN_PREFIX}/`);
}

/** What a route declares and is, as `routeKindOf` and `assistantRouteFault` read it. */
export interface AssistantRouteFacts {
  /** `<METHOD> /api/<path>`. */
  name: string;
  method: string;
  /** `declarationsOf(handler)`. */
  declarations: readonly { kind: string; area?: string; action?: Action }[];
  /** A route of `FILE_ROUTES` (`@ValidFile`). */
  takesFile?: boolean;
  /** A route marked `@ReturnsFile()`. */
  returnsFile?: boolean;
  /** The line of the route. */
  line?: AssistantRouteLine;
}

/**
 * The kind of a route, in this order (plan review 11): a file route, a file answer, an export
 * (whatever its method), a GET, a preview or check, a change.
 */
export function routeKindOf(facts: AssistantRouteFacts): AssistantRouteKind {
  const action = facts.declarations[0]?.action;
  if (facts.takesFile === true) return 'file';
  if (facts.returnsFile === true) return 'download';
  if (action === 'export') return 'export';
  if (facts.method === 'GET') return 'read';
  if (/\/(preview|check)$/.test(facts.name)) return 'preview';
  return 'change';
}

/**
 * Why a route's line is a fault of the code, or `undefined`. The application does not start
 * with one (`AssistantRoutes`), and `assistant-lines.test.ts` runs it over every route.
 */
export function assistantRouteFault(facts: AssistantRouteFacts): string | undefined {
  const [declaration] = facts.declarations;
  if (declaration === undefined || facts.declarations.length !== 1) {
    return 'has a line without exactly one access declaration';
  }
  if (declaration.kind !== 'requires') {
    return `has a line with the declaration ${declaration.kind}; only a route with a permission may`;
  }
  if (notThroughAssistant(facts.name)) {
    return 'is the assistant’s own route, never through the assistant';
  }
  if (facts.line === undefined) {
    return undefined;
  }
  const expected = routeKindOf(facts);
  const written = kindOfLine(facts.line);
  if (written !== expected) {
    return `is written as a ${written} and is a ${expected}`;
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
    if (basis === undefined || kindOfLine(basis) !== 'read') {
      return `rests on ${line.basis.route}, which is not a read of the same list`;
    }
  }
  if (line.serverBase !== undefined) {
    const base = lines[line.serverBase.route];
    if (base === undefined || kindOfLine(base) !== 'read') {
      return `reads its base from ${line.serverBase.route}, which is not a read of the same list`;
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
