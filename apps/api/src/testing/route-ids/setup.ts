import type { IdLine, RouteIds } from '../route-id-check.js';

// The ids of the setup routes and the tests that refuse another branch's (task 10.3b).
const OWN = 'src/modules/setup/other-branch-ids.test.ts';
const BUILDING = `${OWN} > PUT /api/setup/buildings/:id answers 404`;
const BUILDING_STATE = `${OWN} > POST /api/setup/buildings/:id/archive and /restore answer 404`;
const BUILDING_FLOORS = `${OWN} > POST /api/setup/buildings/:id/floors answers 404`;
const FLOORS = `${OWN} > PUT /api/setup/floors/:id, its archive and its restore answer 404`;
const ROOM_NEW = `${OWN} > POST /api/setup/rooms answers 404 for the floor`;
const ROOM_EDIT = `${OWN} > PUT /api/setup/rooms/:id answers 404 for the room and for the floor`;

const E = 'src/modules/setup/exports.test.ts';
const BUILDINGS_EXPORT = `${E} > answers 404 for a building of another branch and an unknown id, with nothing changed`;
const ROOMS_EXPORT = `${E} > answers 404 for a room of another branch and an unknown id, with nothing changed`;
const SUBJECTS_EXPORT = `${E} > answers 404 for an unknown id, with nothing changed`;

const F = 'src/modules/setup/place-forced-deletes.test.ts';
const FORCED = `${F} > answers 404 for a %s of another branch and an unknown one, and nothing changes`;
const FORCED_KEY = `${F} > keeps a used key of a %s to its account, its branch and its role (request keys)`;

const Y = 'src/modules/setup/academic-years.test.ts';
const YEAR_EDIT = `${Y} > of another branch, or an unknown year, are not found, and nothing changes`;
const YEAR_START = `${Y} > of another branch, or an unknown year, is not found, and nothing changes`;
const QUARTERS = `src/modules/setup/quarter-lessons.test.ts > answers 404 for another branch's or an unknown year, or id among the choices, with both branches unchanged`;

const SLOT_TYPES = `src/modules/setup/slot-types.test.ts > answer 404 for a slot type of another branch or an unknown one, and change nothing in either branch`;
const T = 'src/modules/setup/day-templates.test.ts';
const TEMPLATES = `${T} > answer 404 for a template of another branch or an unknown one, and change nothing`;
const TEMPLATE_SLOTS = `${T} > refuse a slot type of another branch or an unknown one with 404, never a 500 from the key, for a new version too; nothing changes in either branch`;
const A = 'src/modules/setup/day-template-assignments.test.ts';
const ASSIGNMENTS = `${A} > answer 404 for a setting or a template of another branch, or an unknown one, never a 500 from the key; nothing changes in either branch`;
const TABLE_PREVIEW = `${A} > answers 404 for an id of another branch or an unknown one in any change, and writes nothing`;
const TEMPLATE_CHOICES = `src/modules/setup/template-lessons.test.ts > answers 404 for another branch's or an unknown id among the choices, with both branches unchanged`;

const CALENDAR = `src/modules/timetable/calendar-lessons.test.ts > answers 404 for another branch's or an unknown entry or template, with the lessons of both branches unchanged`;

const ATTENDANCE = `src/modules/setup/settings.test.ts > answer 404 for a quarter of another branch and an unknown one, with the quarters of both branches unchanged`;
const G = 'src/modules/results/grade-changes.test.ts';
const WEIGHT_PREVIEWS = `${G} > answers 404 for another branch’s and an unknown quarter and year, and an unknown subject, with every row unchanged`;
const WEIGHT_WRITES = `${G} > answers 404 to the writes of weights for another branch’s and an unknown quarter and year, and an unknown subject, with no notice and every row unchanged`;
const S = 'src/modules/setup/subjects.test.ts';
const SUBJECT = `${S} > of an unknown subject is not found; nothing is written`;
const SUBJECT_QUARTERS = `${S} > of another branch's quarter or year, or an unknown one, are not found; nothing is written`;

const PATH = '.claude/rules/api.md, task 1.3';
const BODY = '.claude/rules/api.md, task 1.5';
const CHOICE =
  ".claude/rules/api.md, task 1.5; task 5.6b-2a, decision 11: every key, block, class, exam and group of a choice is the branch's, checked before any lock";
const SCHOOL_WIDE = "03: divisions and departments are the school's; `branch: 'none'`";
const SUBJECTS =
  'docs/decisions.md, tasks 2.1 to 2.6, answer 3: one subject list for the whole school; the test sends an unknown one';

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

const school = (
  id: string,
  record: string,
  rule: string,
  refusedIn: readonly string[] = [],
): IdLine => ({
  id,
  record,
  kind: 'school',
  rule,
  refusedIn,
});

/**
 * The ids of the choices a dated rewrite takes (task 5.6a-5a to 5.6b-3), at
 * `at` (`body:days.`, `body<kind=slot_length>.change.days.`): the key and the
 * block of a decision, the class of a shortened day's keep, the exam and the
 * class of a block's choice, and the groups of a split block's choice where
 * the route takes them.
 */
const choices = (
  at: string,
  refusedIn: readonly string[],
  take: { decisions: boolean; groups: boolean },
): IdLine[] => [
  ...(take.decisions
    ? [
        branch(
          `${at}dayDecisions[].key`,
          'one-day change, cancelled lesson, bulk cancel or substitution',
          CHOICE,
          refusedIn,
        ),
        branch(`${at}dayDecisions[].blockId`, 'pattern block', CHOICE, refusedIn),
      ]
    : []),
  branch(`${at}dayKeeps[].classId`, 'class', CHOICE, refusedIn),
  branch(`${at}examBlocks[].examId`, 'exam', CHOICE, refusedIn),
  branch(`${at}examBlocks[].classId`, 'class', CHOICE, refusedIn),
  ...(take.groups ? [branch(`${at}groupBlocks[].groupIds`, 'group', CHOICE, refusedIn)] : []),
];

const TEMPLATE_DAYS = { decisions: true, groups: false };
const CALENDAR_DAYS = { decisions: true, groups: true };

export const SETUP_IDS: RouteIds = {
  'POST /api/setup/buildings/export': [branch('body:ids', 'building', BODY, [BUILDINGS_EXPORT])],
  'PUT /api/setup/buildings/:id': [branch('path:id', 'building', PATH, [BUILDING])],
  'POST /api/setup/buildings/:id/archive': [branch('path:id', 'building', PATH, [BUILDING_STATE])],
  'POST /api/setup/buildings/:id/restore': [branch('path:id', 'building', PATH, [BUILDING_STATE])],
  'POST /api/setup/buildings/:id/floors': [branch('path:id', 'building', PATH, [BUILDING_FLOORS])],
  'PUT /api/setup/floors/:id': [branch('path:id', 'floor', PATH, [FLOORS])],
  'POST /api/setup/floors/:id/archive': [branch('path:id', 'floor', PATH, [FLOORS])],
  'POST /api/setup/floors/:id/restore': [branch('path:id', 'floor', PATH, [FLOORS])],
  'POST /api/setup/rooms': [branch('body:floorId', 'floor', BODY, [ROOM_NEW])],
  'POST /api/setup/rooms/export': [branch('body:ids', 'room', BODY, [ROOMS_EXPORT])],
  'PUT /api/setup/rooms/:id': [
    branch('path:id', 'room', PATH, [ROOM_EDIT]),
    branch('body:floorId', 'floor', BODY, [ROOM_EDIT]),
  ],
  'POST /api/setup/buildings/:id/forced-delete': [
    branch('path:id', 'building', PATH, [FORCED], [FORCED_KEY]),
  ],
  'POST /api/setup/floors/:id/forced-delete': [
    branch('path:id', 'floor', PATH, [FORCED], [FORCED_KEY]),
  ],
  'POST /api/setup/rooms/:id/forced-delete': [
    branch('path:id', 'room', PATH, [FORCED], [FORCED_KEY]),
  ],

  'POST /api/setup/divisions/export': [school('body:ids', 'division', SCHOOL_WIDE)],
  'PUT /api/setup/divisions/:id': [school('path:id', 'division', SCHOOL_WIDE)],
  'POST /api/setup/divisions/:id/archive': [school('path:id', 'division', SCHOOL_WIDE)],
  'POST /api/setup/divisions/:id/restore': [school('path:id', 'division', SCHOOL_WIDE)],
  'POST /api/setup/divisions/:id/departments': [school('path:id', 'division', SCHOOL_WIDE)],
  'PUT /api/setup/departments/:id': [school('path:id', 'department', SCHOOL_WIDE)],
  'POST /api/setup/departments/:id/archive': [school('path:id', 'department', SCHOOL_WIDE)],
  'POST /api/setup/departments/:id/restore': [school('path:id', 'department', SCHOOL_WIDE)],

  'PUT /api/setup/academic-years/:id': [branch('path:id', 'academic year', PATH, [YEAR_EDIT])],
  'POST /api/setup/academic-years/:id/start': [
    branch('path:id', 'academic year', PATH, [YEAR_START]),
  ],
  'PUT /api/setup/academic-years/:id/quarters': [
    branch('path:id', 'academic year', PATH, [QUARTERS]),
    ...choices('body:days.', [QUARTERS], TEMPLATE_DAYS),
  ],
  'POST /api/setup/academic-years/:id/quarters/preview': [
    branch('path:id', 'academic year', PATH, [QUARTERS]),
    ...choices('body:days.', [QUARTERS], TEMPLATE_DAYS),
  ],

  'PATCH /api/setup/slot-types/:id': [branch('path:id', 'slot type', PATH, [SLOT_TYPES])],
  'POST /api/setup/slot-types/:id/lengths': [
    branch('path:id', 'slot type', PATH, [SLOT_TYPES]),
    ...choices('body:days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
  ],
  'POST /api/setup/slot-types/:id/archive': [branch('path:id', 'slot type', PATH, [SLOT_TYPES])],
  'POST /api/setup/slot-types/:id/restore': [branch('path:id', 'slot type', PATH, [SLOT_TYPES])],
  'POST /api/setup/day-templates': [
    branch('body:slotTypeIds', 'slot type', BODY, [TEMPLATE_SLOTS]),
  ],
  'GET /api/setup/day-templates/:id': [branch('path:id', 'day template', PATH, [TEMPLATES])],
  'PATCH /api/setup/day-templates/:id': [branch('path:id', 'day template', PATH, [TEMPLATES])],
  'POST /api/setup/day-templates/:id/versions': [
    branch('path:id', 'day template', PATH, [TEMPLATES]),
    branch('body:slotTypeIds', 'slot type', BODY, [TEMPLATE_SLOTS]),
    ...choices('body:days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
  ],
  'POST /api/setup/day-templates/:id/archive': [
    branch('path:id', 'day template', PATH, [TEMPLATES]),
  ],
  'POST /api/setup/day-templates/:id/restore': [
    branch('path:id', 'day template', PATH, [TEMPLATES]),
  ],
  'POST /api/setup/day-template-assignments': [
    branch('body:dayTemplateId', 'day template', BODY, [ASSIGNMENTS]),
    ...choices('body:days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
  ],
  'POST /api/setup/day-template-assignments/:id/end': [
    branch('path:id', 'day template setting', PATH, [ASSIGNMENTS]),
    ...choices('body:days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
  ],
  'POST /api/setup/day-template-table/preview': [
    branch('body<kind=slot_length>.slotTypeId', 'slot type', BODY, [TABLE_PREVIEW]),
    ...choices('body<kind=slot_length>.change.days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
    branch('body<kind=template_version>.dayTemplateId', 'day template', BODY, [TABLE_PREVIEW]),
    branch('body<kind=template_version>.change.slotTypeIds', 'slot type', BODY, [TABLE_PREVIEW]),
    ...choices('body<kind=template_version>.change.days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
    branch('body<kind=assignment_set>.change.dayTemplateId', 'day template', BODY, [TABLE_PREVIEW]),
    ...choices('body<kind=assignment_set>.change.days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
    branch('body<kind=assignment_end>.assignmentId', 'day template setting', BODY, [TABLE_PREVIEW]),
    ...choices('body<kind=assignment_end>.change.days.', [TEMPLATE_CHOICES], TEMPLATE_DAYS),
  ],

  'POST /api/setup/calendar-entries': [
    branch('body:dayTemplateId', 'day template', BODY, [CALENDAR]),
    ...choices('body:', [CALENDAR], CALENDAR_DAYS),
  ],
  'POST /api/setup/calendar-entries/preview': [
    branch('body<action=create>.record.dayTemplateId', 'day template', BODY, [CALENDAR]),
    ...choices('body<action=create>.', [CALENDAR], { decisions: false, groups: true }),
    branch('body<action=edit>.id', 'calendar entry', BODY, [CALENDAR]),
    branch('body<action=edit>.record.dayTemplateId', 'day template', BODY, [CALENDAR]),
    ...choices('body<action=edit>.', [CALENDAR], { decisions: false, groups: true }),
    branch('body<action=archive>.id', 'calendar entry', BODY, [CALENDAR]),
    ...choices('body<action=archive>.', [CALENDAR], { decisions: false, groups: false }),
    branch('body<action=restore>.id', 'calendar entry', BODY, [CALENDAR]),
    ...choices('body<action=restore>.', [CALENDAR], { decisions: false, groups: true }),
  ],
  'PATCH /api/setup/calendar-entries/:id': [
    branch('path:id', 'calendar entry', PATH, [CALENDAR]),
    branch('body:dayTemplateId', 'day template', BODY, [CALENDAR]),
    ...choices('body:', [CALENDAR], CALENDAR_DAYS),
  ],
  'POST /api/setup/calendar-entries/:id/archive': [
    branch('path:id', 'calendar entry', PATH, [CALENDAR]),
    ...choices('body:', [CALENDAR], { decisions: true, groups: false }),
  ],
  'POST /api/setup/calendar-entries/:id/restore': [
    branch('path:id', 'calendar entry', PATH, [CALENDAR]),
    ...choices('body:', [CALENDAR], CALENDAR_DAYS),
  ],

  'PUT /api/setup/quarters/:id/attendance-values': [
    branch('path:id', 'quarter', PATH, [ATTENDANCE]),
  ],
  'POST /api/setup/quarters/:id/attendance-values/preview': [
    branch('path:id', 'quarter', PATH, [WEIGHT_PREVIEWS]),
  ],
  'PUT /api/setup/travel-times': [
    school(
      'body:otherBranchId',
      'branch',
      "03, travel times: a pair of the school's branches; the Super Admin works in every branch, so another branch is the partner, not a refusal",
    ),
  ],

  'POST /api/setup/subjects/export': [school('body:ids', 'subject', SUBJECTS, [SUBJECTS_EXPORT])],
  'POST /api/setup/subjects': [school('body:departmentId', 'department', SCHOOL_WIDE)],
  'PUT /api/setup/subjects/:id': [
    school('path:id', 'subject', SUBJECTS, [SUBJECT]),
    school('body:departmentId', 'department', SCHOOL_WIDE),
  ],
  'PUT /api/setup/subjects/:id/daily-weights': [school('path:id', 'subject', SUBJECTS, [SUBJECT])],
  'POST /api/setup/subjects/:id/archive': [school('path:id', 'subject', SUBJECTS, [SUBJECT])],
  'POST /api/setup/subjects/:id/restore': [school('path:id', 'subject', SUBJECTS, [SUBJECT])],
  'GET /api/setup/subjects/:id/quarter-weights': [
    school('path:id', 'subject', SUBJECTS, [SUBJECT_QUARTERS]),
    branch('query:yearId', 'academic year', PATH, [SUBJECT_QUARTERS]),
  ],
  'PUT /api/setup/subjects/:id/quarter-weights/:quarterId': [
    school('path:id', 'subject', SUBJECTS, [WEIGHT_WRITES]),
    branch('path:quarterId', 'quarter', PATH, [WEIGHT_WRITES, SUBJECT_QUARTERS]),
  ],
  'POST /api/setup/subjects/:id/quarter-weights/copy': [
    school('path:id', 'subject', SUBJECTS, [WEIGHT_WRITES]),
    branch('body:yearId', 'academic year', BODY, [WEIGHT_WRITES, SUBJECT_QUARTERS]),
  ],
  'POST /api/setup/subjects/:id/quarter-weights/copy/preview': [
    school('path:id', 'subject', SUBJECTS, [WEIGHT_PREVIEWS]),
    branch('body:yearId', 'academic year', BODY, [WEIGHT_PREVIEWS]),
  ],
  'POST /api/setup/subjects/:id/quarter-weights/:quarterId/preview': [
    school('path:id', 'subject', SUBJECTS, [WEIGHT_PREVIEWS]),
    branch('path:quarterId', 'quarter', PATH, [WEIGHT_PREVIEWS]),
  ],
};
