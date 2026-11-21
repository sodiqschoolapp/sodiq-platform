import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the other routes and the tests that refuse another branch's (task 10.3b).
const A = 'src/modules/audit/audit-entries.test.ts';
const SHOW = `${A} > answers 404 to an entry the reader may not read, and logs nothing`;
const BY_RECORD = `${A} > shows %s the entries of the branch and none of another`;
const RELATIVE = `${A} > does not show a relative linked only in another branch`;

const DEVICE = `src/modules/auth/trusted-devices.test.ts > but not by another account: its id is answered as not found and stays signed in`;
const NOTIFICATION = `src/modules/notifications/notifications.test.ts > only among the own: another account's is not found, and stays unread`;

const LESSON_STORE = 'src/modules/timetable/forced-deletes.test.ts';
const RESTORE_LESSON = `${LESSON_STORE} > is refused to the Academic Vice Principal, the Principal and a Teacher (the harness tries every role), and answers 404 for another branch’s and an unknown id`;
const RESTORE_KEY = `${LESSON_STORE} > keeps a used key to its account, its branch and its role (request keys)`;
const RESTORE_PLACE = `src/modules/setup/place-forced-deletes.test.ts > is refused to the Academic Vice Principal, the Principal and a Teacher, and answers 404 for another branch’s and an unknown id`;

// Task 11.2 (pull request #294, decision 4): a child of the parent's own family, by the child
// scope (`portal_children`); another family's child, a child out of scope and an unknown id are 404.
const P = 'src/modules/portal/portal.test.ts';
const CHILD_SCOPE = `${P} > every route of a child refuses a child out of scope with 404`;
const CHILD_FILES = `${P} > the files of homework`;
const CHILD_QUARTER =
  'src/modules/portal/portal-grades.test.ts > answers 404 for a quarter of another year or branch, and 400 for an unknown field';
const RATING_QUARTER =
  'src/modules/portal/portal-rating.test.ts > answers 404 for a quarter not started, of another year or of another branch, and 400 for an unknown field';
const CHILD_RULE = 'build plan 11.2: one child-scope check used by every portal route';

// Task 11.7 (pull request #306): announcements of the branch of the request, the classes of an
// audience, and the portal's page of a child.
const N = 'src/modules/announcements/announcements.test.ts';
const ANNOUNCEMENT_IDS = `${N} > answers 404 for another branch’s and an unknown id, the Super Admin included`;
const ANNOUNCEMENT_CLASSES = `${N} > writes for grades and classes of the branch; another branch’s or an unknown class is 404`;
const ANNOUNCEMENT_KEY = `${N} > keeps a used key to its account, its branch and its role (request keys)`;
const ANNOUNCEMENT_CHILD = `${N} > answers 404 for another family’s child, a link off, an unlinked relative and a child who left`;
const ANNOUNCEMENT_RULE = '.claude/rules/api.md, task 1.3; build plan 11.7';

// Pull request #361 (decision 6): a feedback report has no branch (0011), so another branch's id
// cannot exist; the test sends an unknown one.
const REPORT =
  'src/modules/feedback/feedback-list.test.ts > answers 404 for an unknown report, and writes nothing';
const REPORT_RULE = 'db/migrations/0011: a report is school-wide, it belongs to an account';

// Task 10.9 (pull request #368): a key has no branch (0175); its tests send an unknown id. The
// people of a key are picked from every branch by design (decision 2, Look first).
const K = 'src/modules/access/integration-keys.test.ts';
const KEY = `${K} > answers 404 for an unknown key on each route, and writes nothing`;
const KEY_RULE = 'db/migrations/0175: a key is of the whole school';
const KEY_PEOPLE_RULE =
  'task 10.9, decision 2 of pull request #368: the Super Admin puts on a key people of any branch; an unknown one is 404 (integration-keys.test.ts > answers 404 for an unknown staff record on create and on a people change, and writes nothing)';

// Task 11.12 (pull request #374): a conversation is the person's own, of any branch (decision 9):
// another person's, another branch's (asked in this one) and an unknown one are 404. The Super
// Admin reads every conversation of the school (`02`: "the Super Admin sees all of them").
const C = 'src/modules/assistant/assistant-conversations.test.ts';
const OWN_CONVERSATION = `${C} > lists the person’s own conversations of every branch, and no other person’s (plan decision 9)`;
const ASKED_IN = `${C} > refuses a question on a conversation of another branch, of another person and an unknown one (404): nothing stored, nothing counted`;
const CONVERSATION_RULE =
  '02, Assistant, Audit: the person sees their own conversations; plan decision 9';
const ALL_CONVERSATIONS_RULE =
  '02, Assistant, Audit: the Super Admin sees all of them, of every branch, by design, and can restore one; an unknown id is 404 (assistant-conversations.test.ts: "answers 404 for an unknown conversation on the Super Admin’s read", "refuses a restore of a conversation that is not archived (409) and of an unknown one (404)")';

const OWN_RULE = '.claude/rules/api.md, @AnySignedIn: never on one named in the request';

const line = (
  id: string,
  record: string,
  kind: IdLine['kind'],
  rule: string,
  refusedIn: readonly string[],
  repeatIn?: readonly string[],
): IdLine => ({
  id,
  record,
  kind,
  rule,
  refusedIn,
  ...(repeatIn === undefined ? {} : { repeatIn }),
});

export const OTHER_IDS: RouteIds = {
  'POST /api/announcements': [
    line(
      'body:audience<kind=classes>.classIds',
      'class of the audience',
      'branch',
      ANNOUNCEMENT_RULE,
      [ANNOUNCEMENT_CLASSES],
      [ANNOUNCEMENT_KEY],
    ),
  ],
  'PUT /api/announcements/:id': [
    line('path:id', 'announcement', 'branch', ANNOUNCEMENT_RULE, [ANNOUNCEMENT_IDS]),
  ],
  'POST /api/announcements/:id/archive': [
    line('path:id', 'announcement', 'branch', ANNOUNCEMENT_RULE, [ANNOUNCEMENT_IDS]),
  ],
  'POST /api/announcements/:id/restore': [
    line('path:id', 'announcement', 'branch', ANNOUNCEMENT_RULE, [ANNOUNCEMENT_IDS]),
  ],
  'GET /api/portal/children/:studentId/announcements': [
    line('path:studentId', 'child of the own family', 'own', CHILD_RULE, [ANNOUNCEMENT_CHILD]),
  ],
  'GET /api/portal/children/:studentId/timetable': [
    line('path:studentId', 'child of the own family', 'own', CHILD_RULE, [CHILD_SCOPE]),
  ],
  'GET /api/portal/children/:studentId/homework': [
    line('path:studentId', 'child of the own family', 'own', CHILD_RULE, [CHILD_SCOPE]),
  ],
  'GET /api/portal/children/:studentId/grades': [
    line('path:studentId', 'child of the own family', 'own', CHILD_RULE, [CHILD_SCOPE]),
    line('query:quarter', 'quarter of the child’s year', 'own', CHILD_RULE, [CHILD_QUARTER]),
  ],
  'GET /api/portal/children/:studentId/rating': [
    line('path:studentId', 'child of the own family', 'own', CHILD_RULE, [CHILD_SCOPE]),
    line('query:quarter', 'started quarter of the child’s year', 'own', CHILD_RULE, [
      RATING_QUARTER,
    ]),
  ],
  'GET /api/portal/children/:studentId/attendance': [
    line('path:studentId', 'child of the own family', 'own', CHILD_RULE, [CHILD_SCOPE]),
  ],
  'GET /api/portal/children/:studentId/files/:fileId': [
    line('path:studentId', 'child of the own family', 'own', CHILD_RULE, [
      CHILD_SCOPE,
      CHILD_FILES,
    ]),
    line('path:fileId', 'file of a homework the child’s page lists', 'own', CHILD_RULE, [
      CHILD_FILES,
    ]),
  ],
  'GET /api/audit/entries': [
    line(
      'query:recordId',
      'any record an entry names',
      'branch',
      `CLAUDE.md, "A query never returns another branch's rows"`,
      [BY_RECORD, RELATIVE],
    ),
  ],
  'POST /api/audit/entries/:id/show': [
    line('path:id', 'audit entry', 'branch', '.claude/rules/api.md, task 1.3', [SHOW]),
  ],
  'DELETE /api/auth/trusted-devices/:id': [
    line('path:id', 'trusted device (session)', 'own', OWN_RULE, [DEVICE]),
  ],
  'POST /api/forced-deletes/:id/restore': [
    line(
      'path:id',
      'forced delete store row',
      'branch',
      '.claude/rules/api.md, task 1.3',
      [RESTORE_LESSON, RESTORE_PLACE],
      [RESTORE_KEY],
    ),
  ],
  'POST /api/feedback-reports/:id/handled': [
    line('path:id', 'feedback report', 'school', REPORT_RULE, [REPORT]),
  ],
  'DELETE /api/feedback-reports/:id/handled': [
    line('path:id', 'feedback report', 'school', REPORT_RULE, [REPORT]),
  ],
  'POST /api/integration-keys': [
    line('body:staffRecordIds', 'staff record', 'none', KEY_PEOPLE_RULE, []),
  ],
  'PUT /api/integration-keys/:id/people': [
    line('path:id', 'integration key', 'school', KEY_RULE, [KEY]),
    line('body:staffRecordIds', 'staff record', 'none', KEY_PEOPLE_RULE, []),
  ],
  'PUT /api/integration-keys/:id/end-date': [
    line('path:id', 'integration key', 'school', KEY_RULE, [KEY]),
  ],
  'POST /api/integration-keys/:id/revoke': [
    line('path:id', 'integration key', 'school', KEY_RULE, [KEY]),
  ],
  'GET /api/assistant/conversations/:id': [
    line('path:id', 'assistant conversation', 'own', CONVERSATION_RULE, [OWN_CONVERSATION]),
  ],
  'POST /api/assistant/questions': [
    line('body:conversationId', 'assistant conversation', 'own', CONVERSATION_RULE, [ASKED_IN]),
  ],
  'GET /api/assistant/all-conversations/:id': [
    line('path:id', 'assistant conversation', 'none', ALL_CONVERSATIONS_RULE, []),
  ],
  'POST /api/assistant/all-conversations/:id/restore': [
    line('path:id', 'assistant conversation', 'none', ALL_CONVERSATIONS_RULE, []),
  ],
  'POST /api/notifications/:id/read': [
    line('path:id', 'notification', 'own', OWN_RULE, [NOTIFICATION]),
  ],
};
