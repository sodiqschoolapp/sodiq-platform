import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the plans routes and the tests that refuse another branch's (task 10.3b).
const P = 'src/modules/plans/plans.test.ts';
const PLAN = `${P} > answers 404 for another branch’s or an unknown journal, quarter, item, file and year`;
const M = 'src/modules/plans/plan-masters.test.ts';
const MASTERS = `${M} > answers 404 for a master, an item, a body id or a quarter of another branch or unknown, and changes nothing`;
const O = 'src/modules/plans/plan-outcomes.test.ts';
const OUTCOMES = `${O} > answers 404 for another branch's or an unknown journal, quarter, item and lesson of every route, changing nothing in either branch`;
const PLACE = `${O} > answers 404 for another branch's or an unknown journal, item, quarter and lesson of the place of a carried item, changing nothing in either branch`;
const R = 'src/modules/plans/plan-requests.test.ts';
const WINDOWS = `${R} > answers 404 for another branch's or an unknown quarter on open and extend, and writes nothing`;
const REQUEST_PATHS = `${R} > answers 404 for another branch's or an unknown request, journal or event, and writes nothing`;
const QUEUE = `${R} > answers 404 for another branch's or an unknown journal on the queue, for another branch's lesson or item in a body`;
const REQUEST_BODIES = `${R} > answers 404 for another branch's or an unknown year, quarter, lesson, event or subject of the request routes, writing nothing`;
const F = 'src/modules/plans/plan-follow.test.ts';
const LESSON = `${F} > answers 404 for another branch's or an unknown lesson, and writes nothing`;
const SHARING = `${F} > answers 404 for another branch's or an unknown journal or quarter on share, separate and copy, and writes nothing`;
const D = 'src/modules/plans/plan-delivery.test.ts';
const MINIMUM = `${D} > answers 404 for a minimum of an unknown subject, and refuses an attendance-only subject`;
const REPORT_QUARTER = `${D} > answers 404 for a quarter of another branch or an unknown one, in every report and the file, logging nothing`;
const REPORT_TEACHER = `${D} > answers none of another branch’s plans to a teacher filter of another branch or an unknown one, in every report and the file`;
const EXPORT = `${D} > answers 404 for the plan file of another branch’s journal or quarter and unknown ids, and refuses a Head Teacher of another subject`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const QUERY = 'CLAUDE.md, "A query never returns another branch\'s rows"';
// A subject is one list for the whole school: its ids are `school` lines, and their tests send an
// unknown subject (coordinator ruling of task 10.3b).
const SUBJECT =
  'docs/decisions.md, tasks 2.1 to 2.6, answer 3: one subject list for the whole school';
const STAFF = `${BODY}; a staff member is the request's branch's when linked to it (edge/people-roles-accounts)`;
const DEPARTMENT =
  '03: departments are of the whole school; the filter keeps the plans of the branch of the request';
// The ids of the works of a save are the item's works as the page read it (`planItemBaseSchema`):
// they are matched only against the item's own works, never read anywhere else. An id the item
// does not hold (another item's, another branch's, unknown) is a work removed meanwhile
// (edge/lesson-plans, "A save is addressed to the item"): stale for an edit, nothing for a
// removal; plans.test.ts, "changes nothing for a work id of another item, another branch or none
// in a save".
const ITEM_WORK =
  'edge/lesson-plans, "A save is addressed to the item": a work id is matched only against the item\'s own works (planItemBaseSchema), never read elsewhere';

const subject = (id: string, refusedIn: readonly string[]): IdLine => ({
  id,
  record: 'subject',
  kind: 'school',
  rule: SUBJECT,
  refusedIn,
});

const branch = (
  id: string,
  record: string,
  rule: string,
  refusedIn: readonly string[],
): IdLine => ({ id, record, kind: 'branch', rule, refusedIn });

const none = (id: string, record: string, rule: string): IdLine => ({
  id,
  record,
  kind: 'none',
  rule,
  refusedIn: [],
});

const school = (id: string, record: string, rule: string): IdLine => ({
  id,
  record,
  kind: 'school',
  rule,
  refusedIn: [],
});

const reportFilters = (quarter: string): IdLine[] => [
  branch(quarter, 'quarter', QUERY, [REPORT_QUARTER]),
  school(quarter.replace('quarterId', 'departmentId'), 'department', DEPARTMENT),
  branch(quarter.replace('quarterId', 'teacherId'), 'staff', `${QUERY}; ${STAFF}`, [
    REPORT_TEACHER,
  ]),
];

const outcome = (lesson: boolean, test = OUTCOMES): IdLine[] => [
  branch('path:journalId', 'journal', PATH, [test]),
  branch('path:itemId', 'plan item', PATH, [test]),
  branch('body:quarterId', 'quarter', BODY, [test]),
  ...(lesson ? [branch('body:lessonId', 'lesson', BODY, [test])] : []),
];

export const PLANS_IDS: RouteIds = {
  'GET /api/plans/reports/completeness': reportFilters('query:quarterId'),
  'GET /api/plans/reports/progress': reportFilters('query:quarterId'),
  'GET /api/plans/reports/requests': reportFilters('query:quarterId'),
  'POST /api/plans/reports/export': reportFilters('body:quarterId'),
  'PUT /api/plans/minimums': [subject('body:subjectId', [MINIMUM])],
  'POST /api/plans/journals/:journalId/export': [
    branch('path:journalId', 'journal', PATH, [EXPORT]),
    branch('body:quarterId', 'quarter', BODY, [EXPORT]),
  ],
  'GET /api/plans/windows': [branch('query:yearId', 'academic year', QUERY, [WINDOWS])],
  'PUT /api/plans/windows/:quarterId': [branch('path:quarterId', 'quarter', PATH, [WINDOWS])],
  'POST /api/plans/windows/:quarterId/extensions': [
    branch('path:quarterId', 'quarter', PATH, [WINDOWS]),
    branch('body:staffId', 'staff', STAFF, [WINDOWS]),
  ],
  'GET /api/plans/requests': [branch('query:yearId', 'academic year', QUERY, [REQUEST_BODIES])],
  'POST /api/plans/journals/:journalId/requests': [
    branch('path:journalId', 'journal', PATH, [REQUEST_PATHS]),
    branch('body<kind=text>.quarterId', 'quarter', BODY, [REQUEST_BODIES]),
    branch('body<kind=text>.lessonIds', 'lesson', BODY, [QUEUE]),
    branch('body<kind=replan>.quarterId', 'quarter', BODY, [REQUEST_BODIES]),
    branch('body<kind=replan>.fromLessonId', 'lesson', BODY, [QUEUE]),
  ],
  'POST /api/plans/journals/:journalId/requests/prepared': [
    branch('path:journalId', 'journal', PATH, [REQUEST_PATHS]),
    branch('body:quarterId', 'quarter', BODY, [REQUEST_BODIES]),
  ],
  'POST /api/plans/journals/:journalId/requests/prepared/decide': [
    branch('path:journalId', 'journal', PATH, [REQUEST_PATHS]),
    branch('body:quarterId', 'quarter', BODY, [REQUEST_BODIES]),
    branch('body:decision<decision=approve>.untick[].lessonId', 'lesson', BODY, [REQUEST_BODIES]),
    branch('body:decision<decision=approve>.later.fromLessonId', 'lesson', BODY, [REQUEST_BODIES]),
  ],
  'POST /api/plans/requests/:requestId/send': [
    branch('path:requestId', 'plan request', PATH, [REQUEST_PATHS]),
  ],
  'POST /api/plans/requests/:requestId/decide': [
    branch('path:requestId', 'plan request', PATH, [REQUEST_PATHS]),
    branch('body<decision=approve>.untick[].lessonId', 'lesson', BODY, [QUEUE, REQUEST_BODIES]),
    branch('body<decision=approve>.later.fromLessonId', 'lesson', BODY, [REQUEST_BODIES]),
  ],
  'POST /api/plans/requests/decide-event': [
    branch('body:eventId', 'timetable event', BODY, [REQUEST_BODIES]),
    subject('body:subjectId', [REQUEST_BODIES]),
  ],
  'POST /api/plans/requests/:requestId/finish': [
    branch('path:requestId', 'plan request', PATH, [REQUEST_PATHS]),
  ],
  'GET /api/plans/masters': [
    branch('query:yearId', 'academic year', QUERY, [MASTERS]),
    subject('query:subjectId', [MASTERS]),
    branch('query:journalId', 'journal', QUERY, [MASTERS]),
    branch('query:quarterId', 'quarter', QUERY, [MASTERS]),
  ],
  'POST /api/plans/masters': [
    branch('body:yearId', 'academic year', BODY, [MASTERS]),
    subject('body:subjectId', [MASTERS]),
  ],
  'GET /api/plans/masters/:masterId': [branch('path:masterId', 'master plan', PATH, [MASTERS])],
  'PATCH /api/plans/masters/:masterId': [branch('path:masterId', 'master plan', PATH, [MASTERS])],
  'POST /api/plans/masters/:masterId/archive': [
    branch('path:masterId', 'master plan', PATH, [MASTERS]),
  ],
  'POST /api/plans/masters/:masterId/restore': [
    branch('path:masterId', 'master plan', PATH, [MASTERS]),
  ],
  'POST /api/plans/masters/:masterId/items': [
    branch('path:masterId', 'master plan', PATH, [MASTERS]),
  ],
  'PUT /api/plans/masters/:masterId/items/:itemId': [
    branch('path:masterId', 'master plan', PATH, [MASTERS]),
    branch('path:itemId', 'master plan item', PATH, [MASTERS]),
  ],
  'POST /api/plans/masters/:masterId/items/:itemId/remove': [
    branch('path:masterId', 'master plan', PATH, [MASTERS]),
    branch('path:itemId', 'master plan item', PATH, [MASTERS]),
  ],
  'PUT /api/plans/masters/:masterId/order': [
    branch('path:masterId', 'master plan', PATH, [MASTERS]),
    branch('body:order', 'master plan item', BODY, [MASTERS]),
  ],
  'GET /api/plans/journals/:journalId/master-compare': [
    branch('query:quarterId', 'quarter', QUERY, [MASTERS]),
    branch('path:journalId', 'journal', PATH, [MASTERS]),
  ],
  'POST /api/plans/journals/:journalId/master-take': [
    branch('path:journalId', 'journal', PATH, [MASTERS]),
    branch('body:quarterId', 'quarter', BODY, [MASTERS]),
  ],
  'POST /api/plans/journals/:journalId/master-keep': [
    branch('path:journalId', 'journal', PATH, [MASTERS]),
    branch('body:quarterId', 'quarter', BODY, [MASTERS]),
  ],
  'GET /api/plans/parallel': [
    subject('query:subjectId', [MASTERS]),
    branch('query:quarterId', 'quarter', QUERY, [MASTERS]),
  ],
  'POST /api/plans/journals/:journalId/not-covered/:itemId/merge': outcome(true),
  'POST /api/plans/journals/:journalId/not-covered/:itemId/carry': outcome(false),
  'POST /api/plans/journals/:journalId/not-covered/:itemId/drop': outcome(false),
  'POST /api/plans/journals/:journalId/carried/:itemId/place': outcome(true, PLACE),
  'GET /api/plans': [branch('query:yearId', 'academic year', QUERY, [PLAN])],
  'GET /api/plans/journals/:journalId': [
    branch('query:quarterId', 'quarter', QUERY, [PLAN]),
    branch('path:journalId', 'journal', PATH, [PLAN]),
  ],
  'GET /api/plans/lessons/:lessonId': [branch('path:lessonId', 'lesson', PATH, [LESSON])],
  'POST /api/plans/journals/:journalId/items': [
    branch('path:journalId', 'journal', PATH, [PLAN]),
    branch('body:quarterId', 'quarter', BODY, [PLAN]),
    branch('body:lessonId', 'lesson', BODY, [LESSON]),
  ],
  'POST /api/plans/journals/:journalId/share': [
    branch('path:journalId', 'journal', PATH, [SHARING]),
    branch('body:quarterId', 'quarter', BODY, [SHARING]),
    branch('body:journalId', 'journal', BODY, [SHARING]),
  ],
  'POST /api/plans/journals/:journalId/separate': [
    branch('path:journalId', 'journal', PATH, [SHARING]),
    branch('body:quarterId', 'quarter', BODY, [SHARING]),
  ],
  'POST /api/plans/journals/:journalId/copy': [
    branch('path:journalId', 'journal', PATH, [SHARING]),
    branch('body:quarterId', 'quarter', BODY, [SHARING]),
    branch('body:source.journalId', 'journal', BODY, [SHARING]),
    branch('body:source.quarterId', 'quarter', BODY, [SHARING]),
    branch('body:source.masterId', 'master plan', BODY, [MASTERS]),
  ],
  'PUT /api/plans/journals/:journalId/queue': [
    branch('path:journalId', 'journal', PATH, [QUEUE]),
    branch('body:quarterId', 'quarter', BODY, [REQUEST_BODIES]),
    branch('body:base', 'plan item', BODY, [QUEUE]),
    branch('body:order', 'plan item', BODY, [QUEUE]),
  ],
  'PUT /api/plans/items/:itemId': [
    branch('path:itemId', 'plan item', PATH, [PLAN]),
    none('body:base.classworks[].id', 'plan work', ITEM_WORK),
    none('body:base.homeworks[].id', 'plan work', ITEM_WORK),
    none('body:values.classworks[].id', 'plan work', ITEM_WORK),
    none('body:values.homeworks[].id', 'plan work', ITEM_WORK),
  ],
  'POST /api/plans/items/:itemId/clear': [branch('path:itemId', 'plan item', PATH, [PLAN])],
  'PUT /api/plans/items/:itemId/files': [branch('path:itemId', 'plan item', PATH, [PLAN])],
  'GET /api/plans/files/:fileId': [branch('path:fileId', 'plan file', PATH, [PLAN])],
  'DELETE /api/plans/files/:fileId': [branch('path:fileId', 'plan file', PATH, [PLAN])],
};
