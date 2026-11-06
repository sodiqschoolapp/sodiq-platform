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
const CHILD_RULE = 'build plan 11.2: one child-scope check used by every portal route';

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
  'POST /api/notifications/:id/read': [
    line('path:id', 'notification', 'own', OWN_RULE, [NOTIFICATION]),
  ],
};
