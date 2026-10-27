import type { IdKind, IdLine, RouteIds } from '../route-id-check.js';

// The ids of the timetable routes and the tests that refuse another branch's (task 10.3b).
const M = 'src/modules/timetable';

const TL = `${M}/teaching-load.test.ts`;
const TL_YEAR = `${TL} > answers another branch's and an unknown year or source 404, changing nothing`;
const TL_ALL = `${TL} > answers another branch's and an unknown version, row, class, group, subject, teacher and room 404, changing nothing`;
const TL_QUERY = `${TL} > answers another branch's and an unknown id of the teachers' query and of a row edit 404, also as the Super Admin`;

const VH = `${M}/versions-history.test.ts`;
const VH_YEAR = `${VH} > answers 404 for another branch's year and an unknown one`;
const VH_COMPARE = `${VH} > answers 404 for another branch's and an unknown version, in the path and in \`with\``;

const VE = `${M}/version-export.test.ts`;
const VE_VERSION = `${VE} > answers 404 for a version of another branch or an unknown one, and writes nothing`;
const VE_BODY = `${VE} > answers 404 for a class, teacher or room of another branch or an unknown one, and writes nothing`;

const OUT = `${M}/out-of-date.test.ts > answers 404 for a version of another branch or an unknown one, and changes nothing`;
const TOTALS = `${M}/load-blocks.test.ts > answers 404 for another branch's version and an unknown one, also to the Super Admin, and nothing to a Teacher`;

const RD = `${M}/readiness.test.ts`;
const RD_TEMPLATES = `${RD} > answers 404 for another branch's version and an unknown one, changing nothing, and 403 to a Teacher`;
const RD_RULES = `${RD} > answers 404 for another branch's version and an unknown one, changing nothing, and 403 to the Principal and a Teacher`;

const PUB = `${M}/publish.test.ts`;
const PUB_VERSION = `${PUB} > answers 404 for another branch's version and an unknown one, and changes nothing`;
const PUB_REPEAT = `${PUB} > checks the permission and the branch again on a repeat, before the stored answer (permission review, must-fix 1)`;
const PUB_KEEPS = `${PUB} > answers 404 for another branch's or an unknown version or class, changing nothing`;

const WD = `${M}/withdraw.test.ts`;
const WD_VERSION = `${WD} > answers 404 for another branch's version and an unknown one, and changes nothing (should-fix 6)`;
const WD_REPEAT = `${WD} > checks the permission and the branch again on a repeat, before the stored answer`;

const EX = `${M}/exams.test.ts`;
const EX_DECISIONS = `${EX} > answers 404 for a decision naming another branch’s exam or block or an unknown one, on the publish and the withdraw, as each role that may send them, with every row of both branches unchanged (.claude/rules/api.md)`;
const EX_READ = `${EX} > lists the branch’s exams of a range, a cancelled one marked, for the Principal; another branch’s exam is 404`;
const EX_IDS = `${EX} > answers 404 for every id of the path and the body, as the Super Admin, and changes nothing`;
const EX_CHECK = `${EX} > answers 404 for every id of the body of another branch or unknown, and writes nothing (.claude/rules/api.md; plan test 9)`;
const EX_KEY = `${EX} > repeats a save with its key, refuses the key of another account, and checks a repeat before its answer`;

const BC = `${M}/bulk-cancels.test.ts`;
const BC_CLASS = `${BC} > answers 404 for a class of another branch and an unknown one, as the Academic Vice Principal and the Super Admin, with nothing written in either branch`;
const BC_BLOCK = `${BC} > answers 404 for a block or a lesson of another branch and an unknown one in the save, with nothing written in either branch`;
const BC_DATA = `${BC} > answers 404 for a data choice of another branch’s lesson and an unknown one, with nothing written in either branch`;
const BC_KEY = `${BC} > answers a repeated key with the stored answer once, refuses it from another account, and checks the branch and the role again on a repeat`;
const BC_PUBLISH_KEY = `${BC} > answers a repeat of a used request key with another branch's block 404 and from a role the route refuses 403`;

const DC = `${M}/day-changes.test.ts`;
const DC_DAY = `${DC} > answers 404 for a class of another branch and an unknown one, as the Academic Vice Principal and the Super Admin`;
const DC_CANCEL = `${DC} > answers 404 for a lesson of another branch and an unknown one, as the Academic Vice Principal and the Super Admin, and nothing changes`;
const DC_CANCEL_KEY = `${DC} > keeps a used key to its account, its branch and its role (request keys)`;
const DC_ROOM = `${DC} > answers 404 for a lesson or a room of another branch and an unknown one, as the Academic Vice Principal and the Super Admin, and refuses the Principal`;
const DC_ROOM_KEY = `${DC} > keeps a used key to its account, its branch and its role, for every id it names (request keys)`;
const DC_RESTORE_ROOM = `${DC} > takes a room and a reason together, and answers 404 for a room of another branch or unknown`;
const DC_CORRECT = `${DC} > is refused to the Principal, and answers 404 for another branch’s or an unknown lesson, teacher and room, as the Academic Vice Principal and the Super Admin; nothing changes`;
const DC_TAUGHT = `${DC} > answers 404 on the "taught while absent" path for another branch’s or an unknown lesson, also with a used key; nothing changes`;
const DC_CORRECT_KEY = `${DC} > keeps a used key of a teacher, a room and a restore into a room to its ids and its role (permission review must-fix 1)`;
const DC_WITHDRAW_KEY = `${DC} > answers a repeat with the stored answer, refuses the key from another account and with other decisions, and a used key with another branch’s key 404`;
const DC_WITHDRAW_CHECK = `${DC} > refuses the check as the withdraw: a draft, another branch’s and an unknown id; the Principal reads it`;

const SUB = `${M}/substitutions.test.ts`;
const SUB_IDS = `${SUB} > answers 404 for another branch's or an unknown lesson and teacher, as the Academic Vice Principal and the Super Admin, and changes nothing`;
const SUB_KEY = `${SUB} > keeps a used key to its account, its branch and its role (request keys)`;

const JS = `${M}/journal-substitutions.test.ts`;
const JS_IDS = `${JS} > answers 404 for another branch's or an unknown absence, journal, teacher and vacancy, and changes nothing`;
const JS_KEY = `${JS} > keeps a used key to its account, its branch and its role (request keys)`;
const JS_VACANCY_KEY = `${JS} > keeps a used key of a vacancy's save to its account, its branch and its role (request keys)`;

const ABS = `${M}/absences.test.ts > answers 404 for another branch’s absence, an unknown one and a person not of the branch, and 422 for a vacancy`;

const RC = `${M}/room-closures.test.ts`;
const RC_IDS = `${RC} > answers 404 for another branch’s closure and an unknown one, and for a room of another branch or unknown, with nothing written`;
const RC_MOVE = `${RC} > answers 404 for a move of another branch’s closure or to another branch’s room, with lessons in both branches left as they were`;

const VF = `${M}/vacancy-fills.test.ts`;
const VF_IDS = `${VF} > answers 404 for another branch's or an unknown vacancy, person, class, group, subject, decision key or block, and changes nothing`;
const VF_KEY = `${VF} > checks the branch and the permission again on a repeat, before the stored answer`;

const AT = `${M}/acting-teachers.test.ts`;
const AT_IDS = `${AT} > answers 404 for another branch’s or an unknown journal, vacancy or person, writing nothing`;
const AT_KEY = `${AT} > checks the ids and the permission again on a repeat, before the stored answer`;
const AT_END = `${AT} > answers 404 for another branch’s or an unknown period, changing nothing`;

const FD = `${M}/forced-deletes.test.ts`;
const FD_IDS = `${FD} > answers 404 for a lesson of another branch and an unknown one, and nothing changes`;
const FD_KEY = `${FD} > keeps a used key to its account, its branch and its role (request keys)`;
const FD_HISTORY = `${FD} > is refused to a Teacher and answers 404 for another branch’s and an unknown lesson`;

const VW = `${M}/views.test.ts > answers 404 for another branch’s and an unknown class, teacher and room`;
const VW_VACANCY = `${M}/views.test.ts > answers 404 for another branch’s vacancy and shows a vacancy of the branch`;
const VW_EXPORT = `${M}/views-export.test.ts > answers 404 for another branch’s and an unknown class, teacher and room, with no file and no entry`;

const PIN = `${M}/pins.test.ts > answers 404 for another branch's, another version's and an unknown version, row and pin, changing nothing`;

const PT = `${M}/pattern.test.ts`;
const PT_IDS = `${PT} > answers 404 for another branch's, another version's and an unknown version, row and block, changing nothing`;
const PT_DOUBLE = `${PT} > answers 404 to a double of another branch's, another version's and an unknown row, and to a half of their pairs; the Principal is refused; nothing changes`;
const PT_PARTNER = `${PT} > answers 404 to a partner of another branch's, another draft's and an unknown row, on the place and the rearrange route, changing nothing`;
const PT_ROOM = `${PT} > places a lesson in the room chosen in the picker, and answers 404 for a room of another branch or an unknown one`;
const PT_ROOMS = `${PT} > refuses a room and the rooms of a block together, and answers 404 for a room of another branch, an unknown one and a row not in the block, changing nothing`;
const PT_LESSON_ROOM = `${PT} > answers 404 for another branch's, another version's and an unknown version, block, lesson and room, changing nothing`;
const PT_REARRANGE = `${PT} > answers 404 for another branch's, another version's and an unknown version, block, row and room, changing nothing`;
const PT_REMOVE = `${PT} > answers 404 for a removed block of another branch's and another version's draft and an unknown one, changing nothing`;
const PT_EDIT_LOCK = `${PT} > answers 404 for another branch’s and an unknown version, 403 to the Principal and a Teacher, and refuses a published one`;
const PT_LOCKS = `${PT} > answers 404 for another branch’s, another version’s and an unknown id of the path and the body, changing nothing`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const QUERY = 'CLAUDE.md, "A query never returns another branch\'s rows"';
const STAFF =
  'edge/people-roles-accounts, "A person works in two branches ... every request is checked against one branch": a staff record linked to the branch (.claude/rules/api.md, task 1.5)';
const SUBJECT =
  'docs/decisions.md, tasks 2.1 to 2.6, answer 3: one subject list for the whole school';

/** A subject: one list for the whole school; the tests send an unknown one. */
const subject = (id: string, refusedIn: readonly string[]): IdLine =>
  line(id, 'subject', SUBJECT, refusedIn, undefined, 'school');
const DECISION =
  'Task 5.6a-5b-2, decision 12 of the review: every key and block of a decision is the branch’s (`refuseUnknownKeys`)';

const line = (
  id: string,
  record: string,
  rule: string,
  refusedIn: readonly string[],
  repeatIn?: readonly string[],
  kind: IdKind = 'branch',
): IdLine => ({
  id,
  record,
  kind,
  rule,
  refusedIn,
  ...(repeatIn === undefined ? {} : { repeatIn }),
});

/** The version of the path. */
const version = (refusedIn: readonly string[], repeatIn?: readonly string[]): IdLine =>
  line('path:id', 'timetable_version', PATH, refusedIn, repeatIn);

/** The lesson of the path. */
const lesson = (refusedIn: readonly string[], repeatIn?: readonly string[]): IdLine =>
  line('path:id', 'lesson', PATH, refusedIn, repeatIn);

/** The ids of an exam's body, on a create, a change and a check. */
const examBody = (refusedIn: readonly string[], repeatIn?: readonly string[]): IdLine[] => [
  subject('body:subjectId', refusedIn),
  line('body:rooms[].roomId', 'room', BODY, refusedIn, repeatIn),
  line('body:rooms[].classIds', 'class', BODY, refusedIn, repeatIn),
  line('body:rooms[].groupIds', 'group', BODY, refusedIn, repeatIn),
  line('body:rooms[].invigilatorIds', 'staff', STAFF, refusedIn, repeatIn),
  line('body:blockChoices[].classId', 'class', BODY, refusedIn, repeatIn),
  line('body:blockChoices[].blockId', 'lesson_block', BODY, refusedIn, repeatIn),
];

/** The ids of the rows of a vacancy's fill, on the fill and its check. */
const fillBody = (refusedIn: readonly string[], repeatIn?: readonly string[]): IdLine[] => [
  line('body:vacancyId', 'staff', STAFF, refusedIn, repeatIn),
  line('body:personId', 'staff', STAFF, refusedIn, repeatIn),
  line('body:rows[].classId', 'class', BODY, refusedIn, repeatIn),
  line('body:rows[].groupId', 'group', BODY, refusedIn, repeatIn),
  subject('body:rows[].subjectId', refusedIn),
];

/** The ids of an acting teacher's body, on the naming and its check. */
const actingBody = (refusedIn: readonly string[], repeatIn?: readonly string[]): IdLine[] => [
  line('body:vacancyId', 'staff', STAFF, refusedIn, repeatIn),
  line('body:journalId', 'journal', BODY, refusedIn, repeatIn),
  line('body:personId', 'staff', STAFF, refusedIn, repeatIn),
];

/** A view's or an export's unit: a class, a teacher (a vacancy too) or a room. */
const viewUnit = (refusedIn: readonly string[]): IdLine[] => [
  line('body<kind=class>.classId', 'class', BODY, refusedIn),
  line('body<kind=teacher>.staffId', 'staff', STAFF, refusedIn),
  line('body<kind=room>.roomId', 'room', BODY, refusedIn),
];

export const TIMETABLE_IDS: RouteIds = {
  'POST /api/timetable/versions': [
    line('body:academicYearId', 'academic_year', BODY, [TL_YEAR]),
    line('body:copyFrom', 'timetable_version', BODY, [TL_YEAR]),
  ],
  'GET /api/timetable/history': [line('query:academicYearId', 'academic_year', QUERY, [VH_YEAR])],
  'POST /api/timetable/versions/:id/export': [version([VE_VERSION]), ...viewUnit([VE_BODY])],
  'GET /api/timetable/versions/:id/compare': [
    version([VH_COMPARE]),
    line('query:with', 'timetable_version', QUERY, [VH_COMPARE]),
  ],
  'PATCH /api/timetable/versions/:id': [version([TL_ALL, TL_QUERY])],
  'GET /api/timetable/versions/:id/out-of-date': [version([OUT])],
  'POST /api/timetable/versions/:id/up-to-date': [version([OUT])],
  'GET /api/timetable/versions/:id/publish-check': [version([PUB_VERSION])],
  'PUT /api/timetable/versions/:id/day-keeps': [
    version([PUB_KEEPS]),
    line('body:classId', 'class', BODY, [PUB_KEEPS]),
  ],
  'POST /api/timetable/versions/:id/publish': [
    version([PUB_VERSION], [PUB_REPEAT]),
    line(
      'body:dayDecisions[].key',
      'day_decision_item',
      DECISION,
      [PUB_VERSION, EX_DECISIONS],
      [BC_PUBLISH_KEY],
    ),
    line(
      'body:dayDecisions[].blockId',
      'pattern_block',
      DECISION,
      [PUB_VERSION, EX_DECISIONS],
      [BC_PUBLISH_KEY],
    ),
  ],
  'GET /api/timetable/versions/:id/withdraw-check': [version([DC_WITHDRAW_CHECK])],
  'POST /api/timetable/versions/:id/withdraw': [
    version([WD_VERSION], [WD_REPEAT]),
    line(
      'body:dayDecisions[].key',
      'day_decision_item',
      DECISION,
      [WD_VERSION, EX_DECISIONS],
      [DC_WITHDRAW_KEY],
    ),
    line(
      'body:dayDecisions[].blockId',
      'pattern_block',
      DECISION,
      [EX_DECISIONS],
      [DC_WITHDRAW_KEY],
    ),
  ],
  'GET /api/timetable/versions/:id/load': [version([TL_ALL])],
  'POST /api/timetable/versions/:id/load': [
    version([TL_ALL, TL_QUERY]),
    line('body:teacherId', 'staff', STAFF, [TL_ALL]),
    line('body:roomId', 'room', BODY, [TL_ALL]),
    line('body:classId', 'class', BODY, [TL_ALL]),
    line('body:groupId', 'group', BODY, [TL_ALL]),
    subject('body:subjectId', [TL_ALL]),
  ],
  'GET /api/timetable/versions/:id/totals': [version([TOTALS])],
  'GET /api/timetable/versions/:id/readiness': [version([RD_TEMPLATES])],
  'POST /api/timetable/versions/:id/templates/confirm': [version([RD_TEMPLATES])],
  'PUT /api/timetable/versions/:id/preferences': [version([RD_RULES])],
  'POST /api/timetable/versions/:id/rules/confirm': [
    version([RD_RULES]),
    line(
      'body:pins',
      'timetable_pin',
      'Task 5.3b-2, decision 7 and permission review S2: the pins shown, a snapshot compared with the stored ones and never looked up; another branch’s and an unknown id are both 409 `pins_changed`, which tells nothing of either (pins.test.ts)',
      [],
      undefined,
      'none',
    ),
  ],
  'POST /api/timetable/versions/:id/edit-lock': [version([PT_EDIT_LOCK])],
  'POST /api/timetable/versions/:id/locks': [
    version([PT_LOCKS]),
    line('body<kind=block>.blockId', 'pattern_block', BODY, [PT_LOCKS]),
    line('body<kind=class>.classId', 'class', BODY, [PT_LOCKS]),
    line('body<kind=teacher>.teacherId', 'staff', STAFF, [PT_LOCKS]),
  ],
  'DELETE /api/timetable/versions/:id/locks/:lockId': [
    version([PT_LOCKS]),
    line('path:lockId', 'timetable_lock', PATH, [PT_LOCKS]),
  ],
  'POST /api/timetable/versions/:id/pins': [
    version([PIN]),
    line('body:loadRowId', 'teaching_load_row', BODY, [PIN]),
  ],
  'DELETE /api/timetable/versions/:id/pins/:pinId': [
    version([PIN]),
    line('path:pinId', 'timetable_pin', PATH, [PIN]),
  ],
  'GET /api/timetable/versions/:id/grid': [version([PT_IDS])],
  'POST /api/timetable/versions/:id/pattern': [
    version([PT_IDS]),
    line('body:loadRowId', 'teaching_load_row', BODY, [PT_IDS, PT_DOUBLE]),
    line('body:partnerRowId', 'teaching_load_row', BODY, [PT_PARTNER]),
    line('body:roomId', 'room', BODY, [PT_ROOM]),
    line('body:rooms[].loadRowId', 'teaching_load_row', BODY, [PT_ROOMS]),
    line('body:rooms[].roomId', 'room', BODY, [PT_ROOMS]),
  ],
  'POST /api/timetable/versions/:id/pattern/swap': [version([PT_IDS])],
  'POST /api/timetable/versions/:id/pattern/rearrange': [
    version([PT_REARRANGE]),
    line('body:changes[].blockId', 'pattern_block', BODY, [PT_REARRANGE]),
    line('body:changes[].loadRowId', 'teaching_load_row', BODY, [PT_REARRANGE]),
    line('body:changes[].partnerRowId', 'teaching_load_row', BODY, [PT_PARTNER]),
    line('body:changes[].rooms[].loadRowId', 'teaching_load_row', BODY, [PT_REARRANGE]),
    line('body:changes[].rooms[].roomId', 'room', BODY, [PT_REARRANGE]),
    line('body:remove', 'pattern_block', BODY, [PT_REMOVE, PT_DOUBLE]),
  ],
  'POST /api/timetable/versions/:id/pattern/:blockId/move': [
    version([PT_IDS]),
    line('path:blockId', 'pattern_block', PATH, [PT_IDS, PT_DOUBLE]),
  ],
  'POST /api/timetable/versions/:id/pattern/:blockId/room': [
    version([PT_LESSON_ROOM]),
    line('path:blockId', 'pattern_block', PATH, [PT_LESSON_ROOM]),
    line('body:lessonId', 'pattern_entry', BODY, [PT_LESSON_ROOM]),
    line('body:roomId', 'room', BODY, [PT_LESSON_ROOM]),
  ],
  'DELETE /api/timetable/versions/:id/pattern/:blockId': [
    version([PT_IDS]),
    line('path:blockId', 'pattern_block', PATH, [PT_IDS, PT_DOUBLE]),
  ],
  'GET /api/timetable/versions/:id/load/teachers': [
    version([TL_ALL]),
    line('query:classId', 'class', QUERY, [TL_QUERY]),
    line('query:groupId', 'group', QUERY, [TL_QUERY]),
    subject('query:subjectId', [TL_QUERY]),
  ],
  'DELETE /api/timetable/versions/:id/load/:rowId': [
    version([TL_ALL]),
    line('path:rowId', 'teaching_load_row', PATH, [TL_ALL, TL_QUERY]),
  ],
  'PATCH /api/timetable/versions/:id/load/:rowId': [
    version([TL_ALL]),
    line('path:rowId', 'teaching_load_row', PATH, [TL_ALL]),
    line('body:teacherId', 'staff', STAFF, [TL_ALL, TL_QUERY]),
    line('body:roomId', 'room', BODY, [TL_ALL, TL_QUERY]),
  ],
  'GET /api/timetable/day': [line('query:classId', 'class', QUERY, [DC_DAY])],
  'POST /api/timetable/lessons/:id/cancel': [lesson([DC_CANCEL], [DC_CANCEL_KEY])],
  'POST /api/timetable/lessons/:id/restore': [
    lesson([DC_CANCEL], [DC_CANCEL_KEY]),
    line('body:roomId', 'room', BODY, [DC_RESTORE_ROOM], [DC_ROOM_KEY]),
  ],
  'POST /api/timetable/lessons/:id/room': [
    lesson([DC_ROOM], [DC_ROOM_KEY]),
    line('body:roomId', 'room', BODY, [DC_ROOM], [DC_ROOM_KEY]),
  ],
  'POST /api/timetable/lessons/:id/move': [
    lesson([DC_ROOM], [DC_ROOM_KEY]),
    line('body:roomId', 'room', BODY, [DC_ROOM], [DC_ROOM_KEY]),
  ],
  'POST /api/timetable/lessons/:id/correction': [
    lesson([DC_CORRECT, DC_TAUGHT], [DC_CANCEL_KEY, DC_TAUGHT]),
    line('body<kind=restore>.roomId', 'room', BODY, [DC_CORRECT], [DC_CORRECT_KEY]),
    line('body<kind=teacher>.teacherId', 'staff', STAFF, [DC_CORRECT], [DC_CORRECT_KEY]),
    line('body<kind=room>.roomId', 'room', BODY, [DC_CORRECT], [DC_CORRECT_KEY]),
  ],
  'GET /api/timetable/lessons/:id/correction-teachers': [lesson([DC_CORRECT])],
  'GET /api/timetable/lessons/:id/substitutes': [lesson([SUB_IDS])],
  'POST /api/timetable/lessons/:id/substitute': [
    lesson([SUB_IDS], [SUB_KEY]),
    line('body:teacherId', 'staff', STAFF, [SUB_IDS], [SUB_KEY]),
  ],
  'POST /api/timetable/lessons/:id/substitution/withdraw': [lesson([SUB_IDS], [SUB_KEY])],
  'GET /api/timetable/absences/:id/journals/:journalId/substitutes': [
    line('path:id', 'absence', PATH, [JS_IDS]),
    line('path:journalId', 'journal', PATH, [JS_IDS]),
  ],
  'POST /api/timetable/absences/:id/journal-substitute': [
    line('path:id', 'absence', PATH, [JS_IDS], [JS_KEY]),
    line('body:journalId', 'journal', BODY, [JS_IDS], [JS_KEY]),
    line('body:teacherId', 'staff', STAFF, [JS_IDS], [JS_KEY]),
  ],
  'GET /api/timetable/vacancies/:id/journals/:journalId/substitutes': [
    line('path:id', 'staff', STAFF, [JS_IDS]),
    line('path:journalId', 'journal', PATH, [JS_IDS]),
  ],
  'POST /api/timetable/vacancies/:id/journal-substitute': [
    line('path:id', 'staff', STAFF, [JS_IDS], [JS_VACANCY_KEY]),
    line('body:journalId', 'journal', BODY, [JS_IDS], [JS_VACANCY_KEY]),
    line('body:teacherId', 'staff', STAFF, [JS_IDS], [JS_VACANCY_KEY]),
  ],
  'POST /api/timetable/bulk-cancels/check': [line('body:classIds', 'class', BODY, [BC_CLASS])],
  'POST /api/timetable/bulk-cancels': [
    line('body:classIds', 'class', BODY, [BC_CLASS], [BC_KEY]),
    line('body:blocks[].blockId', 'lesson_block', BODY, [BC_BLOCK], [BC_KEY]),
    line('body:lessonIds', 'lesson', BODY, [BC_BLOCK], [BC_KEY]),
    line('body:dataChoices[].lessonId', 'lesson', BODY, [BC_DATA], [BC_KEY]),
  ],
  'POST /api/timetable/exams': examBody([EX_IDS], [EX_IDS, EX_KEY]),
  'GET /api/timetable/exams/:id': [line('path:id', 'exam', PATH, [EX_READ])],
  'PUT /api/timetable/exams/:id': [
    line('path:id', 'exam', PATH, [EX_IDS], [EX_IDS, EX_KEY]),
    ...examBody([EX_IDS], [EX_IDS]),
    line('body:keepCancelled', 'lesson', BODY, [EX_IDS], [EX_IDS]),
  ],
  'POST /api/timetable/exams/check': [
    line('body:examId', 'exam', BODY, [EX_CHECK]),
    ...examBody([EX_CHECK]),
    line('body:keepCancelled', 'lesson', BODY, [EX_CHECK]),
  ],
  'POST /api/timetable/exams/:id/cancel': [
    line('path:id', 'exam', PATH, [EX_IDS], [EX_IDS, EX_KEY]),
    line('body:keepCancelled', 'lesson', BODY, [EX_IDS], [EX_IDS]),
  ],
  'POST /api/timetable/absences': [line('body:staffId', 'staff', STAFF, [ABS])],
  'PATCH /api/timetable/absences/:id': [line('path:id', 'absence', PATH, [ABS])],
  'POST /api/timetable/absences/:id/withdraw': [line('path:id', 'absence', PATH, [ABS])],
  'GET /api/timetable/absences/:id/lessons': [line('path:id', 'absence', PATH, [ABS])],
  'POST /api/timetable/room-closures': [line('body:roomId', 'room', BODY, [RC_IDS])],
  'PATCH /api/timetable/room-closures/:id': [line('path:id', 'room_closure', PATH, [RC_IDS])],
  'POST /api/timetable/room-closures/:id/withdraw': [
    line('path:id', 'room_closure', PATH, [RC_IDS]),
  ],
  'GET /api/timetable/room-closures/:id/lessons': [line('path:id', 'room_closure', PATH, [RC_IDS])],
  'POST /api/timetable/room-closures/:id/move': [
    line('path:id', 'room_closure', PATH, [RC_IDS, RC_MOVE]),
    line('body:roomId', 'room', BODY, [RC_IDS, RC_MOVE]),
  ],
  'POST /api/timetable/vacancy-fills': [
    ...fillBody([VF_IDS], [VF_KEY]),
    line('body:dayDecisions[].key', 'day_decision_item', DECISION, [VF_IDS], [VF_KEY]),
    line('body:dayDecisions[].blockId', 'pattern_block', DECISION, [VF_IDS], [VF_KEY]),
  ],
  'POST /api/timetable/vacancy-fills/check': fillBody([VF_IDS]),
  'POST /api/timetable/acting-teachers': actingBody([AT_IDS], [AT_KEY]),
  'POST /api/timetable/acting-teachers/check': actingBody([AT_IDS]),
  'POST /api/timetable/acting-teachers/:id/end': [
    line('path:id', 'journal_acting_teacher', PATH, [AT_END], [AT_KEY]),
  ],
  'POST /api/timetable/lessons/:id/forced-delete': [lesson([FD_IDS], [FD_KEY])],
  'GET /api/timetable/lessons/:id/history': [lesson([FD_HISTORY])],
  'GET /api/timetable/views/class': [line('query:classId', 'class', QUERY, [VW])],
  'GET /api/timetable/views/teacher': [line('query:staffId', 'staff', STAFF, [VW, VW_VACANCY])],
  'GET /api/timetable/views/room': [line('query:roomId', 'room', QUERY, [VW])],
  'POST /api/timetable/views/export': viewUnit([VW_EXPORT]),
};
