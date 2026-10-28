import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the results routes and the tests that refuse another branch's (task 10.3b).
const SR = 'src/modules/results/student-results.test.ts';
const STUDENT = `${SR} > refuses the lessons of a subject the reader does not read, and answers 404 for another branch’s or an unknown id`;
const C = 'src/modules/results/closing.test.ts';
const CLOSING = `${C} > answers 404 for another branch's or an unknown quarter, journal, subject and student, changing no row`;
const REMIND_KEY = `${C} > reminds each teacher of their own items once per key, and checks the key`;
const CLOSE = `${C} > answers 404 for another branch's or an unknown quarter and journal, 403 to a role it refuses, and checks the key`;
const REOPEN = `${C} > answers 404 for another branch's and an unknown quarter and journal, the rows and the audit log unchanged`;
const REOPEN_KEY = `${C} > reopens the whole branch, takes a correction, lists the result that changed and closes again as version 2`;
const JOURNAL_CLOSE_KEY = `${C} > reopens one journal: its correction, its own items and changes, closed again with its students only`;
const APPLY = `${C} > answers 404 to the Super Admin's apply for another branch's and an unknown quarter, student and subject, changing no row`;
const APPLY_KEY = `${C} > lists a record the current module calculates otherwise, and applies it with a reason as a new version`;
const R = 'src/modules/results/rating.test.ts';
const RATING = `${R} > answers 404 for a quarter, journal or class unknown or of another branch, and for an attendance-only journal`;
const RATING_EXPORT = `${R} > answers 404 to an export naming a quarter, journal or class unknown or of another branch, and logs nothing`;
const E = 'src/modules/results/early-warning.test.ts';
const WARNING = `${E} > marks a reason handled with a note, audited, hides it, and refuses in order: 404 for each body id, 403 out of scope, 409 not listed`;
const WARNING_CLASS = `${E} > cuts the list to one own class of a Tutor, refuses another class, and answers 404 for another branch's`;
const SUMMARY = `src/modules/results/home-pages.test.ts > refuses the Academic Vice Principal and a Teacher (403), and answers 404 for another branch's or an unknown quarter`;

const REP = 'src/modules/results/reports.test.ts';
const REPORT_ATTENDANCE = `${REP} > gives the Tutor own classes only, refuses another class (403), and answers 404 for a class, subject or teacher unknown or of another branch`;
const REPORT_IDS = `${REP} > answers 404 for a quarter, class or subject unknown or of another branch, and for an attendance-only subject in mastery`;
const REPORT_EXPORT = `${REP} > answers 404 to an export naming an id unknown or of another branch, and logs nothing`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const QUERY = 'CLAUDE.md, "A query never returns another branch\'s rows"';
// Task 9.3b-2: a teacher filter names a staff member, the branch's when linked to it.
const STAFF = `${QUERY}; a staff member is the request's branch's when linked to it (edge/people-roles-accounts)`;
// A subject is one list for the whole school (subjects has no branch column): a
// school record, whose tests send an unknown one where one exists.
const SUBJECT =
  'docs/decisions.md, tasks 2.1 to 2.6, answer 3: one subject list for the whole school';
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
): IdLine => ({
  id,
  record,
  kind: 'branch',
  rule,
  refusedIn,
  ...(repeatIn === undefined ? {} : { repeatIn }),
});

export const RESULTS_IDS: RouteIds = {
  'GET /api/results/students/:id/tabs': [branch('path:id', 'student', PATH, [STUDENT])],
  'GET /api/results/students/:id/attendance': [
    branch('query:yearId', 'academic year', QUERY, [STUDENT]),
    branch('path:id', 'student', PATH, [STUDENT]),
  ],
  'GET /api/results/students/:id/lessons': [
    subject('query:subjectId', [STUDENT]),
    branch('query:quarterId', 'quarter', QUERY, [STUDENT]),
    branch('path:id', 'student', PATH, [STUDENT]),
  ],
  'GET /api/results/students/:id': [
    branch('query:yearId', 'academic year', QUERY, [STUDENT]),
    branch('path:id', 'student', PATH, [STUDENT]),
  ],
  'GET /api/results/closing': [branch('query:quarterId', 'quarter', QUERY, [CLOSING])],
  'PUT /api/results/closing/:quarterId/decisions': [
    branch('path:quarterId', 'quarter', PATH, [CLOSING]),
    subject('body:subjectId', [CLOSING]),
    branch('body:studentId', 'student', BODY, [CLOSING]),
  ],
  'POST /api/results/closing/:quarterId/journals/:journalId/decisions': [
    branch('path:quarterId', 'quarter', PATH, [CLOSING]),
    branch('path:journalId', 'journal', PATH, [CLOSING]),
    branch('body:students', 'student', BODY, [CLOSING]),
  ],
  'POST /api/results/closing/:quarterId/plan-periods/end': [
    branch('path:quarterId', 'quarter', PATH, [CLOSING]),
  ],
  'POST /api/results/closing/:quarterId/remind': [
    branch('path:quarterId', 'quarter', PATH, [CLOSING], [REMIND_KEY]),
  ],
  'POST /api/results/closing/:quarterId/close': [
    branch('path:quarterId', 'quarter', PATH, [CLOSE], [CLOSE]),
    branch('body:warnings[].journalId', 'journal', BODY, [CLOSE], [CLOSE]),
  ],
  'POST /api/results/closing/:quarterId/reopen': [
    branch('path:quarterId', 'quarter', PATH, [REOPEN], [REOPEN_KEY]),
    branch('body:journalId', 'journal', BODY, [REOPEN], [REOPEN_KEY]),
  ],
  'POST /api/results/closing/:quarterId/journals/:journalId/close': [
    branch('path:quarterId', 'quarter', PATH, [REOPEN], [JOURNAL_CLOSE_KEY]),
    branch('path:journalId', 'journal', PATH, [REOPEN], [JOURNAL_CLOSE_KEY]),
    branch('body:warnings[].journalId', 'journal', BODY, [JOURNAL_CLOSE_KEY], [JOURNAL_CLOSE_KEY]),
  ],
  'GET /api/results/closing/:quarterId/recalculation': [
    branch('path:quarterId', 'quarter', PATH, [REOPEN]),
  ],
  'POST /api/results/closing/:quarterId/recalculation/apply': [
    branch('path:quarterId', 'quarter', PATH, [APPLY], [APPLY_KEY]),
    subject('body:students[].subjectId', [APPLY]),
    branch('body:students[].studentId', 'student', BODY, [APPLY], [APPLY_KEY]),
  ],
  'GET /api/results/rating/choices': [branch('query:yearId', 'academic year', QUERY, [RATING])],
  'GET /api/results/rating/subject': [
    branch('query:quarterId', 'quarter', QUERY, [RATING]),
    branch('query:journalId', 'journal', QUERY, [RATING]),
  ],
  'GET /api/results/rating/class': [
    branch('query:quarterId', 'quarter', QUERY, [RATING]),
    branch('query:classId', 'class', QUERY, [RATING]),
  ],
  'GET /api/results/rating/classes': [branch('query:quarterId', 'quarter', QUERY, [RATING])],
  'POST /api/results/rating/export': [
    branch('body<kind=subject>.quarterId', 'quarter', BODY, [RATING_EXPORT]),
    branch('body<kind=subject>.journalId', 'journal', BODY, [RATING_EXPORT]),
    branch('body<kind=class>.quarterId', 'quarter', BODY, [RATING_EXPORT]),
    branch('body<kind=class>.classId', 'class', BODY, [RATING_EXPORT]),
    branch('body<kind=classes>.quarterId', 'quarter', BODY, [RATING_EXPORT]),
  ],
  'GET /api/results/early-warning': [
    branch('query:quarterId', 'quarter', QUERY, [WARNING]),
    branch('query:classId', 'class', QUERY, [WARNING_CLASS]),
  ],
  'POST /api/results/early-warning/handled': [
    branch('body:quarterId', 'quarter', BODY, [WARNING]),
    branch('body:studentId', 'student', BODY, [WARNING]),
    subject('body:subjectId', [WARNING]),
  ],
  'GET /api/results/branch-summary': [branch('query:quarterId', 'quarter', QUERY, [SUMMARY])],
  // Task 9.3b-2: the reports of `08` over the journal.
  'GET /api/results/reports/attendance': [
    branch('query:classId', 'class', QUERY, [REPORT_ATTENDANCE]),
    subject('query:subjectId', [REPORT_ATTENDANCE]),
    branch('query:teacherId', 'staff', STAFF, [REPORT_ATTENDANCE]),
  ],
  'POST /api/results/reports/attendance/export': [
    branch('body:classId', 'class', BODY, [REPORT_EXPORT]),
    subject('body:subjectId', [REPORT_EXPORT]),
    branch('body:teacherId', 'staff', STAFF, [REPORT_EXPORT]),
  ],
  'GET /api/results/reports/choices': [
    branch('query:yearId', 'academic year', QUERY, [REPORT_IDS]),
  ],
  'GET /api/results/reports/results-table': [
    branch('query:quarterId', 'quarter', QUERY, [REPORT_IDS]),
    branch('query:classId', 'class', QUERY, [REPORT_IDS]),
  ],
  'GET /api/results/reports/subject-mastery': [
    branch('query:quarterId', 'quarter', QUERY, [REPORT_IDS]),
    subject('query:subjectId', [REPORT_IDS]),
    branch('query:classId', 'class', QUERY, [REPORT_IDS]),
    branch('query:teacherId', 'staff', STAFF, [REPORT_IDS]),
  ],
  'POST /api/results/reports/export': [
    branch('body<kind=table>.quarterId', 'quarter', BODY, [REPORT_EXPORT]),
    branch('body<kind=table>.classId', 'class', BODY, [REPORT_EXPORT]),
    branch('body<kind=mastery>.quarterId', 'quarter', BODY, [REPORT_EXPORT]),
    subject('body<kind=mastery>.subjectId', [REPORT_EXPORT]),
    branch('body<kind=mastery>.classId', 'class', BODY, [REPORT_EXPORT]),
    branch('body<kind=mastery>.teacherId', 'staff', STAFF, [REPORT_EXPORT]),
  ],
};
