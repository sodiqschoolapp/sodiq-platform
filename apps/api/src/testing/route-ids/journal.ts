import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the journal routes and the tests that refuse another branch's (task 10.3b).
const A = 'src/modules/journal/attendance.test.ts';
const ALL_PRESENT = `${A} > is refused before the start, on a cancelled lesson, on a lesson with no teacher recorded, outside the scope and for another branch`;
const ATTENDANCE = `${A} > refuses marks 4 and 5, a stale version, a student not expected and a student of another branch`;
const HISTORY = `${A} > answers the lines of the cells the reader’s grid shows, attendance only for a Head Tutor, and refuses a substitute outside their lesson`;
const S = 'src/modules/journal/journal-saves.test.ts';
const SAVES_KEY = `${S} > refuses a key used for other input, from another account, with another branch’s or an unknown lesson, from a refused role, and a save without a key`;
const UNDO = `${S} > refuses an undo beyond the largest action, before the start, on a cancelled lesson, outside the scope, and ids of another branch or unknown`;
const COPY = `${S} > refuses the first lesson and a single lesson, a cancelled first lesson, outside the scope, and another branch’s or an unknown lesson`;
const WORKS = `src/modules/journal/journal-works.test.ts > refuses another teacher, an attendance-only subject, another branch’s ids and unknown ones, leaving every row and the audit log as they were`;
const LOCKS = `src/modules/journal/journal-locks.test.ts > answers 404 with every row and the audit unchanged, as the Super Admin too`;
const JOURNALS = `src/modules/journal/journals.test.ts > answers 404 for an unknown journal and for one of another branch`;
const RATING = `src/modules/journal/rating.test.ts > answers 404 for another branch’s journal, an unknown quarter and an unknown student`;
const COMMENTS = `src/modules/journal/rating.test.ts > answers 404 for another branch’s lesson, an unknown work and an unknown student, and writes nothing`;
const COMMENT_HISTORY = `src/modules/journal/rating-readers.test.ts > answers 404 for every id of the comment history that the branch does not hold, and for a work of another lesson`;
const AB = 'src/modules/journal/student-absences.test.ts';
const ABSENCE = `${AB} > refuses a date with no class membership, another branch’s student and an unknown one`;
const ABSENCE_LIST = `${AB} > lists the days with a 0 or 3 or a reason, marks a 0 after being at school, and limits a Tutor to own classes`;
const ABSENCE_FILE = `src/modules/journal/exemption-files.test.ts > answers 404 for another branch’s student, an unknown student or date, a day with no reason or no category, and a file not there`;
const SUPPORT = `src/modules/journal/support-view.test.ts > lists a total and "not held" of the date’s works, and refuses another branch’s journal, a student with no membership and a date outside the year`;
const L = 'src/modules/journal/lesson-status.test.ts';
const DISCIPLINE_ITEMS = `src/modules/journal/discipline-report.test.ts > answers 404 for a teacher outside the counts, unknown or of another branch, and for the teacher of another subject to a Head Teacher`;
const DEPARTMENT_404 =
  'src/modules/journal/discipline-report.test.ts > keeps the Head Tutor to the Tutor subjects and a Head Teacher who also teaches to own subjects, in the items and the file, and answers 404 for an unknown department';
const DEPARTMENT =
  '03: departments are of the whole school; the report keeps the teachers of the branch of the request';
const ORPHANS = `${L} > refuses an inactive teacher and the caller’s own staff record, lists no orphan lesson of another branch, and answers 404 for a lesson, a staff record or an assignment of another branch or unknown, leaving every row of both branches as it was`;
const NOT_GRADED = `${L} > "Not graded" refuses a work with no total, a locked lesson without an unlock, another teacher, and ids it does not know; a typed number and a clear end it`;
const E = 'src/modules/journal/journal-exports.test.ts';
const EXPORT_JOURNAL = `${E} > answers 404 for an unknown journal and a quarter of another branch, and writes nothing in either branch`;
const EXPORT_BRANCH = `${E} > repeats a key: the stored answer for the same account, 409 for another, 404 and 403 checked first`;
const EXPORT_FILE = `${E} > is a job from one snapshot, one queued per person, with a link that works for 24 hours and access checked again at download`;
const D = 'src/modules/plans/plan-delivery.test.ts';
const DELIVERY = `${D} > answers 404 for the delivery of another branch’s or an unknown lesson, leaving every row of both branches`;
const HOMEWORK = `${D} > refuses a homework of another lesson, and 404s an unknown or other-branch homework`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const QUERY = 'CLAUDE.md, "A query never returns another branch\'s rows"';
const STAFF = `${BODY}; a staff member is the request's branch's when linked to it (edge/people-roles-accounts)`;
const DATE = 'a school date in the path, with the student: it names no record of its own';

const branch = (
  id: string,
  record: string,
  rule: string,
  refusedIn: readonly string[],
  repeatIn?: readonly string[],
): IdLine => ({ id, record, kind: 'branch', rule, refusedIn, ...(repeatIn ? { repeatIn } : {}) });

const none = (id: string, rule: string): IdLine => ({
  id,
  record: 'school date',
  kind: 'none',
  rule,
  refusedIn: [],
});

const lesson = (test: string, repeatIn?: readonly string[]): IdLine =>
  branch('path:lessonId', 'lesson', PATH, [test], repeatIn);

const column = (test: string, repeatIn?: readonly string[]): IdLine[] => [
  branch('body:column.workId', 'journal work', BODY, [test], repeatIn),
  branch('body:column.planWorkId', 'plan work', BODY, [test], repeatIn),
  branch('body:column.sourceLessonId', 'lesson', BODY, [test], repeatIn),
];

const rating = (test: string): IdLine[] => [
  branch('path:journalId', 'journal', PATH, [test]),
  branch('path:quarterId', 'quarter', PATH, [test]),
];

const absence = (test: string): IdLine[] => [
  branch('path:studentId', 'student', PATH, [test]),
  none('path:date', DATE),
];

export const JOURNAL_IDS: RouteIds = {
  'GET /api/journal/lessons/:lessonId/card': [lesson(DELIVERY)],
  'PUT /api/journal/lessons/:lessonId/delivery': [lesson(DELIVERY)],
  'PUT /api/journal/lessons/:lessonId/homework-given': [
    lesson(HOMEWORK),
    branch('body:planWorkIds', 'plan work', BODY, [HOMEWORK]),
  ],
  'POST /api/journal/lessons/:lessonId/unlocks': [lesson(LOCKS)],
  'POST /api/journal/journals/:journalId/rating/:quarterId/unlocks': rating(LOCKS),
  'POST /api/journal/unlocks/:unlockId/decide': [
    branch('path:unlockId', 'journal unlock', PATH, [LOCKS]),
  ],
  'POST /api/journal/unlocks/:unlockId/withdraw': [
    branch('path:unlockId', 'journal unlock', PATH, [LOCKS]),
  ],
  'GET /api/journal/journals': [branch('query:yearId', 'academic year', QUERY, [JOURNALS])],
  'GET /api/journal/journals/:journalId': [
    branch('query:quarterId', 'quarter', QUERY, [JOURNALS]),
    branch('path:journalId', 'journal', PATH, [JOURNALS]),
  ],
  'POST /api/journal/lessons/:lessonId/attendance': [
    lesson(ATTENDANCE, [SAVES_KEY]),
    branch('body:saves[].studentId', 'student', BODY, [ATTENDANCE], [SAVES_KEY]),
  ],
  'POST /api/journal/lessons/:lessonId/all-present': [lesson(ALL_PRESENT)],
  'POST /api/journal/lessons/:lessonId/undo': [
    lesson(UNDO),
    branch('body:students[].studentId', 'student', BODY, [UNDO]),
    branch('body:students[].cells[].workId', 'journal work', BODY, [UNDO]),
  ],
  'POST /api/journal/lessons/:lessonId/copy-attendance': [lesson(COPY)],
  'GET /api/journal/lessons/:lessonId/students/:studentId/history': [
    lesson(HISTORY),
    branch('path:studentId', 'student', PATH, [HISTORY]),
  ],
  'GET /api/journal/student-absences': [branch('query:classId', 'class', QUERY, [ABSENCE_LIST])],
  'PUT /api/journal/student-absences/:studentId/:date': absence(ABSENCE),
  'GET /api/journal/student-absences/:studentId/:date/file': absence(ABSENCE_FILE),
  'PUT /api/journal/student-absences/:studentId/:date/file': absence(ABSENCE_FILE),
  'DELETE /api/journal/student-absences/:studentId/:date/file': absence(ABSENCE_FILE),
  'POST /api/journal/lessons/:lessonId/works': [lesson(WORKS)],
  'DELETE /api/journal/lessons/:lessonId/works/:workId': [
    lesson(WORKS),
    branch('path:workId', 'journal work', PATH, [WORKS]),
  ],
  'PUT /api/journal/lessons/:lessonId/works/total': [lesson(WORKS), ...column(WORKS)],
  'PUT /api/journal/lessons/:lessonId/works/not-held': [lesson(WORKS), ...column(WORKS)],
  'POST /api/journal/lessons/:lessonId/works/carry': [lesson(WORKS), ...column(WORKS)],
  'POST /api/journal/lessons/:lessonId/scores': [
    lesson(WORKS, [WORKS, SAVES_KEY]),
    branch('body:saves[].studentId', 'student', BODY, [WORKS], [WORKS, SAVES_KEY]),
    branch('body:saves[].column.workId', 'journal work', BODY, [WORKS], [WORKS, SAVES_KEY]),
    branch('body:saves[].column.planWorkId', 'plan work', BODY, [WORKS], [WORKS]),
    branch('body:saves[].column.sourceLessonId', 'lesson', BODY, [WORKS], [WORKS]),
  ],
  'POST /api/journal/lessons/:lessonId/not-graded': [
    lesson(NOT_GRADED),
    branch('body:workIds', 'journal work', BODY, [NOT_GRADED]),
  ],
  'PUT /api/journal/journals/:journalId/rating/:quarterId/date': rating(RATING),
  'PUT /api/journal/journals/:journalId/rating/:quarterId/not-held': rating(RATING),
  'POST /api/journal/journals/:journalId/rating/:quarterId/entries': [
    ...rating(RATING),
    branch('body:studentId', 'student', BODY, [RATING]),
  ],
  'GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history': [
    ...rating(RATING),
    branch('path:studentId', 'student', PATH, [RATING]),
  ],
  'PUT /api/journal/comments': [
    branch('body:on<target=mark>.lessonId', 'lesson', BODY, [COMMENTS]),
    branch('body:on<target=mark>.studentId', 'student', BODY, [COMMENTS]),
    branch('body:on<target=note>.lessonId', 'lesson', BODY, [COMMENTS]),
    branch('body:on<target=note>.studentId', 'student', BODY, [COMMENTS]),
    branch('body:on<target=work>.lessonId', 'lesson', BODY, [COMMENTS]),
    branch('body:on<target=work>.workId', 'journal work', BODY, [COMMENTS]),
    branch('body:on<target=work>.studentId', 'student', BODY, [COMMENTS]),
    branch('body:on<target=rating>.journalId', 'journal', BODY, [COMMENTS]),
    branch('body:on<target=rating>.quarterId', 'quarter', BODY, [COMMENTS]),
    branch('body:on<target=rating>.studentId', 'student', BODY, [COMMENTS]),
  ],
  'GET /api/journal/comments/history': [
    branch('query:studentId', 'student', QUERY, [COMMENT_HISTORY]),
    branch('query:lessonId', 'lesson', QUERY, [COMMENT_HISTORY]),
    branch('query:workId', 'journal work', QUERY, [COMMENT_HISTORY]),
    branch('query:journalId', 'journal', QUERY, [COMMENT_HISTORY]),
    branch('query:quarterId', 'quarter', QUERY, [COMMENT_HISTORY]),
  ],
  'GET /api/journal/discipline': [
    {
      id: 'query:departmentId',
      record: 'department',
      kind: 'school',
      rule: '03: departments are of the whole school; the report keeps the teachers of the branch of the request',
      refusedIn: [],
    },
  ],
  // Task 9.3b-2: the items behind a count and the file of the counts.
  'GET /api/journal/discipline/items': [
    {
      id: 'query:departmentId',
      record: 'department',
      kind: 'school',
      rule: DEPARTMENT,
      refusedIn: [DEPARTMENT_404],
    },
    branch('query:teacherId', 'staff', STAFF, [DISCIPLINE_ITEMS]),
  ],
  'POST /api/journal/discipline/export': [
    {
      id: 'body:departmentId',
      record: 'department',
      kind: 'school',
      rule: DEPARTMENT,
      refusedIn: [DEPARTMENT_404],
    },
  ],
  'POST /api/journal/orphans/:lessonId/assign': [
    lesson(ORPHANS),
    branch('body:staffId', 'staff', STAFF, [ORPHANS]),
  ],
  'POST /api/journal/orphans/assignments/:assignmentId/withdraw': [
    branch('path:assignmentId', 'orphan lesson assignment', PATH, [ORPHANS]),
  ],
  'POST /api/journal/journals/:journalId/export': [
    branch('path:journalId', 'journal', PATH, [EXPORT_JOURNAL]),
    branch('body:quarterId', 'quarter', BODY, [EXPORT_JOURNAL]),
  ],
  'POST /api/journal/exports': [
    branch('body:quarterId', 'quarter', BODY, [EXPORT_BRANCH], [EXPORT_BRANCH]),
  ],
  'GET /api/journal/exports/:exportId/file': [
    branch('path:exportId', 'journal export', PATH, [EXPORT_FILE]),
  ],
  'GET /api/journal/support': [
    branch('query:studentId', 'student', QUERY, [SUPPORT]),
    branch('query:journalId', 'journal', QUERY, [SUPPORT]),
  ],
};
