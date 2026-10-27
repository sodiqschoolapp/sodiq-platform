import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the people routes and the tests that refuse another branch's (task 10.3b).
const ST = 'src/modules/people/staff.test.ts';
const STAFF = `${ST} > answers 404 for a record of another branch and for an unknown one, and changes nothing`;
const TEACHING = `${ST} > refuses a subject of another department, a grade the subject lacks and an unknown subject`;
const EX = 'src/modules/people/exports.test.ts';
const STAFF_EXPORT = `${EX} > answers 404 for a person of another branch, an unknown id and a vacancy, also to the Super Admin`;
const VACANCY_EXPORT = `${EX} > answers 404 for a vacancy of another branch, an unknown id and a person`;
const SA = 'src/modules/people/staff-accounts.test.ts';
const ACCOUNT = `${SA} > answers 404 for a record of another branch and an unknown one`;
const ROLE_END = `${SA} > refuses an end from a past date, an ended role and a role of another account`;
const OWN = `${SA} > answers 404 for a record of another branch, an unknown id and a vacancy`;
const AA = 'src/modules/people/account-access.test.ts';
const ACCESS = `${AA} > answers 404 for another branch’s record, an unknown id and a vacancy`;
const ACCESS_CHANGE = `${AA} > %s: 404 and account_missing with nothing written`;
const HT = 'src/modules/people/head-teachers.test.ts';
const APPOINTMENT = `${HT} > answers 404 for an appointment of another person or branch, an unknown one, a record of another branch and an unknown subject`;
const GIVE_SUBJECT = `${HT} > refuses subjects missing or given to another role, a branch for a Senior Head Teacher, and unknown or archived subjects`;
const STAFF_PHOTO = `src/modules/people/staff-photos.test.ts > answers 404 for a vacancy, an unknown id and a person of another branch, also with no store`;
const AV = 'src/modules/people/availability-vacancies.test.ts';
const AVAILABILITY = `${AV} > answers 404 for a record of another branch or an unknown one, changing nothing`;
const VACANCY = `${AV} > answer 404 for a vacancy of another branch, an unknown id and a person, changing nothing`;
const VACANCY_SUBJECT = `${AV} > answer 404 for an unknown department or subject in the body, changing nothing`;
const CREATE_CLASS = `src/modules/classes/class-members.test.ts > answers 404 for a class of another branch or unknown, creating nothing`;
const CREATE_CLASS_GROUPS = `src/modules/classes/class-groups.test.ts > answers 404 to the create with a class of another branch or unknown, changing nothing`;
const STUDENT_EXPORT = `src/modules/people/student-exports.test.ts > answers 404 for a student of another branch and an unknown id, with nothing logged`;
const S = 'src/modules/people/students.test.ts';
const STUDENT_CHECK = `${S} > answers 404 for a record of another branch or an unknown one in the body`;
const STUDENT = `${S} > answers 404 for a student of another branch or an unknown id on every record route`;
const STATUSES = `src/modules/people/student-statuses.test.ts > answers 404 for a student of another branch or an unknown id on every route`;
const RETURN_CLASS = `src/modules/people/student-return-class.test.ts > answers 404 for a class of another branch or an unknown one on both routes, also as the Super Admin`;
const JT = 'src/modules/journal/journal-transfers.test.ts';
const SEEN_LEAVING = `${JT} > on a leaving and a return`;
const SEEN_ACCEPT = `${JT} > on a late accept, for a third branch's entry and an unknown one`;
const SEEN_MERGE = `${JT} > on a merge, for an entry of a third branch, of another student and an unknown one`;
const BM = 'src/modules/people/branch-moves.test.ts';
const RELEASE = `${BM} > answers 404 for another branch's student and an unknown branch or student, with nothing written`;
const CANCEL = `${BM} > cancels an open release once, and answers 404 to the receiving branch`;
const CANCEL_ADMIN = `${BM} > answers 404 to a cancel by the Super Admin in the receiving or a third branch`;
const GROUPS = `${BM} > answers 404 for a class of the sending branch, an unknown class, an unknown release and a release to another branch`;
const ACCEPT = `${BM} > answers 404 for the sending branch's class and group, unknown ids, an unknown subject and a release not to the branch, with nothing written in either branch`;
const DECLINE = `${BM} > answers 404 to a decline of an unknown release`;
const HISTORY_MOVED = `${BM} > answers 404 to the History of a student of another branch, for the Super Admin too`;
const MERGE = `src/modules/people/student-merges.test.ts > answers 404 for another branch's path record and an unknown one on both routes, as the Super Admin, with nothing written`;
const STUDENT_PHOTO = `src/modules/people/student-photos.test.ts > answers 404 for a student of another branch and an unknown id on each route, also with no store`;
const R = 'src/modules/people/relatives.test.ts';
const RELATIVE = `${R} > answers 404 for a relative of another branch only and an unknown one`;
const RELATIVE_EDIT = `${R} > is refused to the Principal, and answers 404 for another branch`;
const RELATIVE_SHOW = `${R} > hides workplace and email from the Principal behind a logged show (decision 5)`;
const RELATIVES_TAB = `${R} > answers 404 for a student of another branch and an unknown one`;
const LINKS = `${R} > answers 404 for the links of another branch, and refuses the readers`;
const RO = 'src/modules/people/relative-owners.test.ts';
const RELATIVE_MERGE = `${RO} > answers 404 for a path id or an otherId of another branch and an unknown one`;
const RELATIVE_MERGE_ADMIN = `${RO} > answers 404 to the Super Admin for a path id outside the branch of the request and unknown ids`;
const NEW_OWNER = `${RO} > answers 404 to a new owner on a relative or a student of another branch and an unknown one`;
const REPORTS = `src/modules/people/personal-data.test.ts > answers 404 for a person of another branch, an unknown id and a vacancy, writing nothing`;
const LEAVING_RESULTS = `src/modules/journal/leaving-results.test.ts > answers 404 for another branch’s student and an unknown one`;
const O = 'src/modules/people/other-branch-ids.test.ts';
const STAFF_CHECK = `${O} > answers 404 to the check of an edit of a staff member of another branch only or an unknown one`;
const HISTORY = `${O} > answers 404 to the History of a student of another branch or an unknown one`;
const NEW_MAIN = `${O} > answers 404 to a new main contact of another branch only or an unknown one, changing nothing`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const QUERY = 'CLAUDE.md, "A query never returns another branch\'s rows"';
const SHARED =
  'edge/people-roles-accounts, "A person works in two branches ... every request is checked against one branch": a staff member linked only to another branch is not found';
const RELATIVES =
  'edge/close-relatives: a relative is read through its live links to the branch of the request';
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
// A phone is unique in the whole school (`04`, Close relatives; `edge/close-relatives`):
// the relative a phone match found may be linked in any branch, and is linked
// to the student of this branch by design; the route checks only that it still
// holds the phone sent, and answers `relative_phone_changed` otherwise,
// telling nothing of the record (task 2.5b-1, decision 18).
const PHONE_HOLDER =
  '04, Close relatives, and edge/close-relatives: the holder of a phone found by the phone match, in any branch; checked against the phone sent (relative_phone_changed), never read for the request';

const branch = (
  id: string,
  record: string,
  rule: string,
  refusedIn: readonly string[],
): IdLine => ({ id, record, kind: 'branch', rule, refusedIn });
const school = (id: string, record: string, rule: string): IdLine => ({
  id,
  record,
  kind: 'school',
  rule,
  refusedIn: [],
});
const none = (id: string, record: string, rule: string): IdLine => ({
  id,
  record,
  kind: 'none',
  rule,
  refusedIn: [],
});

const DIVISIONS = '03: "Division: one list for the whole school"; departments are of a division';
const BRANCHES = '03: the branches are records of the whole school, given by the Super Admin';
const SEEN = 'body:journalEntries.seen[].id';
const staffPath = (refusedIn: readonly string[]) =>
  branch('path:id', 'staff', `${PATH}; ${SHARED}`, refusedIn);
const studentPath = (refusedIn: readonly string[]) => branch('path:id', 'student', PATH, refusedIn);

export const PEOPLE_IDS: RouteIds = {
  'POST /api/people/staff': [
    school('body:divisions[].divisionId', 'division', DIVISIONS),
    school('body:divisions[].departmentId', 'department', DIVISIONS),
  ],
  'POST /api/people/staff/export': [
    branch('body:ids', 'staff', `${BODY}; ${SHARED}`, [STAFF_EXPORT]),
  ],
  'GET /api/people/staff/:id': [staffPath([STAFF])],
  'PUT /api/people/staff/:id': [
    staffPath([STAFF]),
    school('body:divisions[].divisionId', 'division', DIVISIONS),
    school('body:divisions[].departmentId', 'department', DIVISIONS),
  ],
  'POST /api/people/staff/check': [
    branch('body:staffRecordId', 'staff', `${BODY}; ${SHARED}`, [STAFF_CHECK]),
  ],
  'PUT /api/people/staff/:id/teaching': [
    staffPath([STAFF]),
    subject('body:subjects[].subjectId', [TEACHING]),
  ],
  'PUT /api/people/staff/:id/branches': [
    staffPath([STAFF]),
    school('body:mainBranchId', 'branch', BRANCHES),
    school('body:furtherBranchIds', 'branch', BRANCHES),
  ],
  'POST /api/people/staff/:id/status': [staffPath([STAFF])],
  'POST /api/people/staff/:id/identity': [staffPath([STAFF])],
  'GET /api/people/staff/:id/account': [staffPath([ACCOUNT])],
  'POST /api/people/staff/:id/account': [staffPath([ACCOUNT])],
  'GET /api/people/staff/:id/account/suggestion': [staffPath([ACCOUNT])],
  'POST /api/people/staff/:id/account/own': [staffPath([OWN])],
  'POST /api/people/staff/:id/roles': [
    staffPath([ACCOUNT]),
    school(
      'body:branchId',
      'branch',
      `${BRANCHES}; a role is given in a branch the person is linked to (role_branch_not_person)`,
    ),
    subject('body:subjectIds', [GIVE_SUBJECT]),
  ],
  'POST /api/people/staff/:id/roles/:assignmentId/end': [
    staffPath([ACCOUNT]),
    branch('path:assignmentId', 'assignment', PATH, [ACCOUNT, ROLE_END]),
  ],
  'POST /api/people/staff/:id/roles/:assignmentId/subjects': [
    staffPath([APPOINTMENT]),
    branch('path:assignmentId', 'assignment', PATH, [APPOINTMENT]),
    subject('body:subjectIds', [APPOINTMENT]),
  ],
  'GET /api/people/staff/:id/account/access': [staffPath([ACCESS])],
  'POST /api/people/staff/:id/account/lock': [staffPath([ACCESS_CHANGE])],
  'POST /api/people/staff/:id/account/unlock': [staffPath([ACCESS_CHANGE])],
  'POST /api/people/staff/:id/account/password-reset': [staffPath([ACCESS_CHANGE])],
  'POST /api/people/staff/:id/account/second-step-reset': [staffPath([ACCESS_CHANGE])],
  'GET /api/people/staff/:id/photo': [staffPath([STAFF_PHOTO])],
  'PUT /api/people/staff/:id/photo': [staffPath([STAFF_PHOTO])],
  'DELETE /api/people/staff/:id/photo': [staffPath([STAFF_PHOTO])],
  'GET /api/people/staff/:id/availability': [staffPath([AVAILABILITY])],
  'PUT /api/people/staff/:id/availability': [staffPath([AVAILABILITY])],
  'POST /api/people/vacancies': [
    school('body:departmentId', 'department', DIVISIONS),
    subject('body:subjects[].subjectId', [VACANCY_SUBJECT]),
  ],
  'POST /api/people/vacancies/export': [branch('body:ids', 'vacancy', BODY, [VACANCY_EXPORT])],
  'GET /api/people/vacancies/:id': [branch('path:id', 'vacancy', PATH, [VACANCY])],
  'PUT /api/people/vacancies/:id': [
    branch('path:id', 'vacancy', PATH, [VACANCY]),
    school('body:departmentId', 'department', DIVISIONS),
    subject('body:subjects[].subjectId', [VACANCY_SUBJECT]),
  ],
  'POST /api/people/vacancies/:id/close': [branch('path:id', 'vacancy', PATH, [VACANCY])],
  'POST /api/people/vacancies/:id/reopen': [branch('path:id', 'vacancy', PATH, [VACANCY])],
  'POST /api/people/vacancies/:id/delete': [branch('path:id', 'vacancy', PATH, [VACANCY])],
  'POST /api/people/students': [
    none('body:relatives[]<kind=existing>.relativeId', 'relative', PHONE_HOLDER),
    none('body:relatives[]<kind=new_owner>.previousId', 'relative', PHONE_HOLDER),
    branch('body:classId', 'class', BODY, [CREATE_CLASS, CREATE_CLASS_GROUPS]),
  ],
  'POST /api/people/students/export': [branch('body:ids', 'student', BODY, [STUDENT_EXPORT])],
  'POST /api/people/students/check': [branch('body:studentId', 'student', BODY, [STUDENT_CHECK])],
  'GET /api/people/students/:id': [studentPath([STUDENT])],
  'PUT /api/people/students/:id': [studentPath([STUDENT])],
  'PUT /api/people/students/:id/uid': [studentPath([STUDENT])],
  'POST /api/people/students/:id/identity': [studentPath([STUDENT])],
  'POST /api/people/students/:id/leaving': [
    studentPath([STATUSES]),
    branch(SEEN, 'journal entry', BODY, [SEEN_LEAVING]),
  ],
  'POST /api/people/students/:id/leaving/cancel': [studentPath([STATUSES])],
  'POST /api/people/students/:id/leaving/undo': [studentPath([STATUSES])],
  'POST /api/people/students/:id/return': [
    studentPath([STATUSES]),
    branch('body:classId', 'class', BODY, [RETURN_CLASS]),
    branch(SEEN, 'journal entry', BODY, [SEEN_LEAVING]),
  ],
  'POST /api/people/students/:id/return/cancel': [studentPath([STATUSES])],
  'POST /api/people/students/:id/restore': [
    studentPath([STATUSES]),
    branch('body:classId', 'class', BODY, [RETURN_CLASS]),
  ],
  'POST /api/people/students/:id/delete': [studentPath([STATUSES])],
  'GET /api/people/students/:id/history': [studentPath([HISTORY, HISTORY_MOVED])],
  'POST /api/people/students/:id/branch-move': [
    studentPath([RELEASE]),
    school(
      'body:toBranchId',
      'branch',
      `${BRANCHES}; a student is released to another branch of the school (04, Movements)`,
    ),
  ],
  'POST /api/people/branch-moves/:id/cancel': [
    branch('path:id', 'branch move', PATH, [CANCEL, CANCEL_ADMIN]),
  ],
  'GET /api/people/branch-moves/:id/groups': [
    branch('query:classId', 'class', QUERY, [GROUPS]),
    branch('path:id', 'branch move', PATH, [GROUPS]),
  ],
  'POST /api/people/branch-moves/:id/accept': [
    branch('path:id', 'branch move', PATH, [ACCEPT]),
    branch('body:classId', 'class', BODY, [ACCEPT]),
    subject('body:groups[].subjectId', [ACCEPT]),
    branch('body:groups[].groupId', 'group', BODY, [ACCEPT]),
    branch(SEEN, 'journal entry', BODY, [SEEN_ACCEPT]),
  ],
  'POST /api/people/branch-moves/:id/decline': [
    branch('path:id', 'branch move', PATH, [ACCEPT, DECLINE]),
  ],
  'GET /api/people/students/:id/merge': [studentPath([MERGE])],
  'POST /api/people/students/:id/merge': [
    studentPath([MERGE]),
    branch(SEEN, 'journal entry', BODY, [SEEN_MERGE]),
  ],
  'GET /api/people/students/:id/photo': [studentPath([STUDENT_PHOTO])],
  'PUT /api/people/students/:id/photo': [studentPath([STUDENT_PHOTO])],
  'DELETE /api/people/students/:id/photo': [studentPath([STUDENT_PHOTO])],
  'GET /api/people/relatives/:id': [
    branch('path:id', 'relative', `${PATH}; ${RELATIVES}`, [RELATIVE]),
  ],
  'PATCH /api/people/relatives/:id': [
    branch('path:id', 'relative', `${PATH}; ${RELATIVES}`, [RELATIVE_EDIT, NEW_OWNER]),
    none('body:newOwner.previousId', 'relative', PHONE_HOLDER),
  ],
  'POST /api/people/relatives/:id/merge': [
    branch('path:id', 'relative', `${PATH}; ${RELATIVES}`, [RELATIVE_MERGE, RELATIVE_MERGE_ADMIN]),
    branch('body:otherId', 'relative', `${BODY}; ${RELATIVES}`, [
      RELATIVE_MERGE,
      RELATIVE_MERGE_ADMIN,
    ]),
  ],
  'POST /api/people/relatives/:id/show': [
    branch('path:id', 'relative', `${PATH}; ${RELATIVES}`, [RELATIVE_SHOW]),
  ],
  'GET /api/people/students/:id/relatives': [studentPath([RELATIVES_TAB])],
  'POST /api/people/students/:id/relatives': [
    studentPath([LINKS, NEW_OWNER]),
    none('body<kind=existing>.relativeId', 'relative', PHONE_HOLDER),
    none('body<kind=new_owner>.previousId', 'relative', PHONE_HOLDER),
  ],
  'PATCH /api/people/students/:id/relatives/:relativeId': [
    studentPath([LINKS]),
    branch('path:relativeId', 'relative', `${PATH}; ${RELATIVES}`, [LINKS]),
  ],
  'POST /api/people/students/:id/relatives/:relativeId/unlink': [
    studentPath([LINKS]),
    branch('path:relativeId', 'relative', `${PATH}; ${RELATIVES}`, [LINKS]),
    branch('body:newMainContactId', 'relative', `${BODY}; ${RELATIVES}`, [NEW_MAIN]),
  ],
  'POST /api/people/students/:id/report': [studentPath([REPORTS])],
  'POST /api/people/staff/:id/report': [staffPath([REPORTS])],
  'POST /api/people/relatives/:id/report': [
    branch('path:id', 'relative', `${PATH}; ${RELATIVES}`, [REPORTS]),
  ],
  'GET /api/people/students/:id/leaving-results': [studentPath([LEAVING_RESULTS])],
};
