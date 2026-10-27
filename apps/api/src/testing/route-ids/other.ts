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
