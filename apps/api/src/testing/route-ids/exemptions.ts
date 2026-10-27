import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the exemptions routes and the tests that refuse another branch's (task 10.3b).
const O = 'src/modules/journal/exemptions-other-branch-ids.test.ts';
const LIST = `${O} > answers no exemption of another branch to the filters of GET /api/exemptions`;
const READ = `${O} > answers 404 for an exemption of another branch on GET /api/exemptions/:id and its reason`;
const OFFER = `${O} > answers 404 for an offer of another branch on /api/exemptions/move-offers/:id confirm, its preview and drop`;
const CONFIRM_BODY = `${O} > answers 404 for a student and a lesson of another branch in the choices of /api/exemptions/move-offers/:id/confirm`;
const CREATE_BODY = `${O} > answers 404 for every id of another branch in the body of POST /api/exemptions and its preview`;
const CREATE_REPEAT = `${O} > answers 404 for a repeat of a used key of POST /api/exemptions with an id of another branch, never the stored answer`;
const EDIT_BODY = `${O} > answers 404 for every id of another branch in the body of PATCH /api/exemptions/:id and its edit/preview`;
const END_BODY = `${O} > answers 404 for every id of another branch in the body of /api/exemptions/:id/end and its preview`;
const BATCH_END_BODY = `${O} > answers 404 for every id of another branch in the body of /api/exemptions/batches/:batchId/end and its preview`;
const CHANGE = `${O} > answers 404 for an exemption of another branch on every change of /api/exemptions/:id`;
const BATCH = `${O} > answers 404 for a batch of another branch on every change of /api/exemptions/batches/:batchId`;
const F = 'src/modules/journal/exemption-files.test.ts';
const DOCUMENT = `${F} > answers 404 for another branch’s and an unknown exemption, and 409 for a voided one`;
const OFFER_REASON = `${F} > answers 404 for another branch’s and an unknown offer, writing nothing`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const QUERY = 'CLAUDE.md, "A query never returns another branch\'s rows"';
// A subject is one list for the whole school: its ids are `school` lines, and their tests send an
// unknown subject (coordinator ruling of task 10.3b).
const SUBJECT =
  'docs/decisions.md, tasks 2.1 to 2.6, answer 3: one subject list for the whole school';
const CHOICE = `${BODY}; a choice's student is one with a class or group row of the branch`;

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
  repeatIn?: readonly string[],
): IdLine => ({ id, record, kind: 'branch', rule, refusedIn, ...(repeatIn ? { repeatIn } : {}) });

const choices = (test: string, repeatIn?: readonly string[]): IdLine[] => [
  branch('body:choices[].studentId', 'student', CHOICE, [test], repeatIn),
  branch('body:choices[].lessonId', 'lesson', BODY, [test], repeatIn),
];

export const EXEMPTIONS_IDS: RouteIds = {
  'GET /api/exemptions': [
    branch('query:classId', 'class', QUERY, [LIST]),
    subject('query:subjectId', [LIST]),
    branch('query:studentId', 'student', QUERY, [LIST]),
    branch('query:batchId', 'exemption batch', QUERY, [LIST]),
  ],
  'POST /api/exemptions': [
    branch('body:studentIds', 'student', BODY, [CREATE_BODY], [CREATE_REPEAT]),
    subject('body:subjectIds', [CREATE_BODY]),
    ...choices(CREATE_BODY, [CREATE_REPEAT]),
  ],
  'POST /api/exemptions/preview': [
    branch('body:studentIds', 'student', BODY, [CREATE_BODY]),
    subject('body:subjectIds', [CREATE_BODY]),
    ...choices(CREATE_BODY),
  ],
  'GET /api/exemptions/move-offers/:id/reason': [
    branch('path:id', 'exemption move offer', PATH, [OFFER_REASON]),
  ],
  'POST /api/exemptions/move-offers/:id/confirm/preview': [
    branch('path:id', 'exemption move offer', PATH, [OFFER]),
  ],
  'POST /api/exemptions/move-offers/:id/confirm': [
    branch('path:id', 'exemption move offer', PATH, [OFFER]),
    ...choices(CONFIRM_BODY),
  ],
  'POST /api/exemptions/move-offers/:id/drop': [
    branch('path:id', 'exemption move offer', PATH, [OFFER]),
  ],
  'POST /api/exemptions/batches/:batchId/end/preview': [
    branch('path:batchId', 'exemption batch', PATH, [BATCH]),
    ...choices(BATCH_END_BODY),
  ],
  'POST /api/exemptions/batches/:batchId/end': [
    branch('path:batchId', 'exemption batch', PATH, [BATCH]),
    ...choices(BATCH_END_BODY),
  ],
  'POST /api/exemptions/batches/:batchId/void/preview': [
    branch('path:batchId', 'exemption batch', PATH, [BATCH]),
  ],
  'POST /api/exemptions/batches/:batchId/void': [
    branch('path:batchId', 'exemption batch', PATH, [BATCH]),
  ],
  'GET /api/exemptions/:id': [branch('path:id', 'exemption', PATH, [READ])],
  'PATCH /api/exemptions/:id': [
    branch('path:id', 'exemption', PATH, [CHANGE]),
    subject('body:subjectIds', [EDIT_BODY]),
    ...choices(EDIT_BODY),
  ],
  'GET /api/exemptions/:id/reason': [branch('path:id', 'exemption', PATH, [READ])],
  'GET /api/exemptions/:id/document': [branch('path:id', 'exemption', PATH, [DOCUMENT])],
  'PUT /api/exemptions/:id/document': [branch('path:id', 'exemption', PATH, [DOCUMENT])],
  'DELETE /api/exemptions/:id/document': [branch('path:id', 'exemption', PATH, [DOCUMENT])],
  'POST /api/exemptions/:id/edit/preview': [
    branch('path:id', 'exemption', PATH, [CHANGE]),
    subject('body:subjectIds', [EDIT_BODY]),
    ...choices(EDIT_BODY),
  ],
  'POST /api/exemptions/:id/end/preview': [
    branch('path:id', 'exemption', PATH, [CHANGE]),
    ...choices(END_BODY),
  ],
  'POST /api/exemptions/:id/end': [
    branch('path:id', 'exemption', PATH, [CHANGE]),
    ...choices(END_BODY),
  ],
  'POST /api/exemptions/:id/void/preview': [branch('path:id', 'exemption', PATH, [CHANGE])],
  'POST /api/exemptions/:id/void': [branch('path:id', 'exemption', PATH, [CHANGE])],
};
