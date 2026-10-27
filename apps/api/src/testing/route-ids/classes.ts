import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the classes and groups routes and the tests that refuse another branch's (task 10.3b).
const C = 'src/modules/classes/classes.test.ts';
const CLASS_PATH = `${C} > answers 404 for another branch's class and an unknown one, with nothing changed`;
const CLASS_CREATE = `${C} > answers 404 for a year or a room of another branch or unknown, with nothing written`;
const CLASS_ROOM = `${C} > answers 404 for another branch's room in the body, with nothing changed`;
const CLASS_EXPORT = `${C} > answers 404 for a class of another branch or an unknown one, with nothing written`;
const TU = 'src/modules/classes/class-tutors.test.ts';
const TUTOR_GIVE = `${TU} > answers 404 for another branch's class or assignment and unknown ones, with nothing written`;
const CM = 'src/modules/classes/class-members.test.ts';
const MEMBERS = `${CM} > answers 404 for a class or a student of another branch or unknown, changing nothing`;
const MEMBER_WITHDRAW = `${CM} > answers 404 for a member of another class, of another branch or unknown`;
const CG = 'src/modules/classes/class-groups.test.ts';
const PUT_INTO_CLASS = `${CG} > answers 404 to "Put into a class" for a class or a student of another branch or unknown, changing nothing`;
const G = 'src/modules/classes/groups.test.ts';
const SLOT_CHECK = `${G} > lets the form ask for the shared slots before the save, and refuses an id outside the branch`;
const GROUP_PATH = `${G} > answers another branch’s and an unknown group 404 on every path, changing nothing`;
const GROUP_BODY = `${G} > answers a class, a subject or a year of another branch or unknown in the body 404, changing nothing`;
const GM = 'src/modules/classes/group-members.test.ts';
const GROUP_PLACE = `${GM} > answers 404 for a group or a student of another branch or unknown, changing nothing`;
const O = 'src/modules/classes/other-branch-ids.test.ts';
const PREVIEW_CLASS = `${O} > answers 404 to the preview of a Tutor for another branch’s or an unknown class, changing nothing`;
const PREVIEW_ROLE = `${O} > answers 404 to the preview of a Tutor for another branch’s or an unknown assignment, changing nothing`;
const END_CLASS = `${O} > answers 404 to the end of a Tutor for another branch’s or an unknown class, changing nothing`;
const END_ROW = `${O} > answers 404 to the end of another branch’s or an unknown Tutor row, changing nothing`;
const GROUP_TAB = `${O} > answers 404 to the Students tab of another branch’s or an unknown group`;
const groupOf = (action: string) =>
  `${O} > answers 404 to ${action} for another branch’s or an unknown group, changing nothing`;
const rowOf = (action: string) =>
  `${O} > answers 404 to ${action} for another branch’s or an unknown member row, changing nothing`;
const BOARD = `${O} > answers 404 for an unknown subject, and none of another branch’s groups or students for a subject both branches have`;
const AUTOMATIC = `${O} > answers 404 for an unknown subject and places none of another branch’s students, changing nothing there`;
const GROUP_EXPORT = `${O} > answers 404 for another branch’s or an unknown group, logging nothing`;
const CT = 'src/modules/people/class-transfers.test.ts';
const CLASS_MOVES = `${CT} > answers 404 for a student, a class or a move it cannot see, and changes nothing`;
const GT = 'src/modules/people/group-transfers.test.ts';
const GROUP_MOVES_UNKNOWN = `${GT} > answers 404 for a student, a group row, a group or a move it cannot see`;
const GROUP_MOVES_BRANCH = `${GT} > answers 404 for ids of another branch on every route, the rows of both branches unchanged`;
const JT = 'src/modules/journal/journal-transfers.test.ts';
const SEEN_MOVE = `${JT} > answers 404 for a seen entry of another branch or an unknown one, and changes nothing`;
const SEEN_CHANGE = `${JT} > on the change of a scheduled class move`;
const SEEN_GROUP = `${JT} > on a group move and the change of a scheduled one`;
const TAKE_BACK = `${JT} > on the cancel and undo of class and group moves and of a leaving, with journal rows in both branches`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const QUERY = 'CLAUDE.md, "A query never returns another branch\'s rows"';
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
): IdLine => ({ id, record, kind: 'branch', rule, refusedIn });

const SEEN = 'body:journalEntries.seen[].id';

export const CLASSES_IDS: RouteIds = {
  'POST /api/classes': [
    branch('body:mainRoomId', 'room', BODY, [CLASS_CREATE]),
    branch('body:academicYearId', 'academic year', BODY, [CLASS_CREATE]),
  ],
  'POST /api/classes/export': [branch('body:ids', 'class', BODY, [CLASS_EXPORT])],
  'GET /api/classes/:id': [branch('path:id', 'class', PATH, [CLASS_PATH])],
  'PUT /api/classes/:id': [
    branch('path:id', 'class', PATH, [CLASS_PATH]),
    branch('body:mainRoomId', 'room', BODY, [CLASS_ROOM]),
  ],
  'POST /api/classes/:id/archive': [branch('path:id', 'class', PATH, [CLASS_PATH])],
  'POST /api/classes/:id/restore': [branch('path:id', 'class', PATH, [CLASS_PATH])],
  'POST /api/classes/:id/tutors': [
    branch('path:id', 'class', PATH, [TUTOR_GIVE]),
    branch('body:assignmentId', 'assignment', BODY, [TUTOR_GIVE]),
  ],
  'POST /api/classes/:id/tutors/preview': [
    branch('path:id', 'class', PATH, [PREVIEW_CLASS]),
    branch('body:assignmentId', 'assignment', BODY, [PREVIEW_ROLE]),
  ],
  'POST /api/classes/:id/tutors/:tutorId/end': [
    branch('path:id', 'class', PATH, [END_CLASS]),
    branch('path:tutorId', 'class tutor', PATH, [END_ROW]),
  ],
  'GET /api/classes/:id/members': [branch('path:id', 'class', PATH, [MEMBERS])],
  'POST /api/classes/:id/members': [
    branch('path:id', 'class', PATH, [MEMBERS, PUT_INTO_CLASS]),
    branch('body:students[].id', 'student', BODY, [MEMBERS, PUT_INTO_CLASS]),
  ],
  'POST /api/classes/:id/members/:memberId/withdraw': [
    branch('path:id', 'class', PATH, [MEMBER_WITHDRAW]),
    branch('path:memberId', 'class membership', PATH, [MEMBER_WITHDRAW]),
  ],
  'POST /api/classes/transfers': [
    branch('body:studentId', 'student', BODY, [CLASS_MOVES]),
    branch('body:toClassId', 'class', BODY, [CLASS_MOVES]),
    branch(SEEN, 'journal entry', BODY, [SEEN_MOVE]),
  ],
  'POST /api/classes/transfers/:id/change': [
    branch('path:id', 'student move', PATH, [CLASS_MOVES]),
    branch('body:toClassId', 'class', BODY, [CLASS_MOVES]),
    branch(SEEN, 'journal entry', BODY, [SEEN_CHANGE]),
  ],
  'POST /api/classes/transfers/:id/cancel': [
    branch('path:id', 'student move', PATH, [CLASS_MOVES, TAKE_BACK]),
  ],
  'POST /api/classes/transfers/:id/undo': [
    branch('path:id', 'student move', PATH, [CLASS_MOVES, TAKE_BACK]),
  ],
  'POST /api/groups': [
    branch('body:classIds', 'class', BODY, [GROUP_BODY]),
    branch('body:academicYearId', 'academic year', BODY, [GROUP_BODY]),
    subject('body:subjectId', [GROUP_BODY]),
  ],
  'GET /api/groups/slot-check': [branch('query:classIds', 'class', QUERY, [SLOT_CHECK])],
  'GET /api/groups/placement': [subject('query:subjectId', [BOARD])],
  'POST /api/groups/placement/automatic': [subject('body:subjectId', [AUTOMATIC])],
  'POST /api/groups/export': [branch('body:ids', 'group', BODY, [GROUP_EXPORT])],
  'GET /api/groups/:id': [branch('path:id', 'group', PATH, [GROUP_PATH])],
  'PUT /api/groups/:id': [
    branch('path:id', 'group', PATH, [GROUP_PATH]),
    branch('body:classIds', 'class', BODY, [GROUP_BODY]),
  ],
  'POST /api/groups/:id/archive': [branch('path:id', 'group', PATH, [GROUP_PATH])],
  'POST /api/groups/:id/restore': [branch('path:id', 'group', PATH, [GROUP_PATH])],
  'GET /api/groups/:id/members': [branch('path:id', 'group', PATH, [GROUP_TAB])],
  'POST /api/groups/:id/members': [
    branch('path:id', 'group', PATH, [GROUP_PLACE]),
    branch('body:students[].id', 'student', BODY, [GROUP_PLACE]),
  ],
  'POST /api/groups/:id/members/:memberId/withdraw': [
    branch('path:id', 'group', PATH, [groupOf('withdraw')]),
    branch('path:memberId', 'group membership', PATH, [rowOf('withdraw')]),
  ],
  'POST /api/groups/:id/members/:memberId/reviewed': [
    branch('path:id', 'group', PATH, [groupOf('reviewed')]),
    branch('path:memberId', 'group membership', PATH, [rowOf('reviewed')]),
  ],
  'POST /api/groups/transfers': [
    branch('body:studentId', 'student', BODY, [GROUP_MOVES_UNKNOWN, GROUP_MOVES_BRANCH]),
    branch('body:memberId', 'group membership', BODY, [GROUP_MOVES_UNKNOWN, GROUP_MOVES_BRANCH]),
    branch('body:toGroupId', 'group', BODY, [GROUP_MOVES_UNKNOWN]),
    branch(SEEN, 'journal entry', BODY, [SEEN_GROUP]),
  ],
  'POST /api/groups/transfers/:id/change': [
    branch('path:id', 'student move', PATH, [GROUP_MOVES_UNKNOWN, GROUP_MOVES_BRANCH]),
    branch('body:toGroupId', 'group', BODY, [GROUP_MOVES_BRANCH]),
    branch(SEEN, 'journal entry', BODY, [SEEN_GROUP]),
  ],
  'POST /api/groups/transfers/:id/cancel': [
    branch('path:id', 'student move', PATH, [GROUP_MOVES_UNKNOWN, GROUP_MOVES_BRANCH, TAKE_BACK]),
  ],
  'POST /api/groups/transfers/:id/undo': [
    branch('path:id', 'student move', PATH, [GROUP_MOVES_UNKNOWN, GROUP_MOVES_BRANCH, TAKE_BACK]),
  ],
};
