import type { RouteScopes, ScopeLine } from '../route-scope-check.js';

// Task 10.3a: the limits of the scoped roles inside the routes of setup, people, results,
// access, classes, search, groups and timetable. Paths of the tests are under apps/api.

const WHO = 'src/modules/people/who-sees-what.test.ts';
const TUTOR_SCOPE = 'src/modules/classes/tutor-scope.test.ts';
const STUDENTS = 'src/modules/people/students.test.ts';
const PEOPLE = 'src/modules/people/scope-refusals.test.ts';
const PEOPLE_SEARCH = 'src/modules/people/search.test.ts';
const HEADS = 'src/modules/people/head-teachers.test.ts';
const GROUP_TRANSFERS = 'src/modules/people/group-transfers.test.ts';
const LEAVING = 'src/modules/journal/leaving-results.test.ts';
const RESULTS = 'src/modules/results/student-results.test.ts';
const RATING = 'src/modules/results/rating.test.ts';
const WARNING = 'src/modules/results/early-warning.test.ts';
const RESULTS_OWN = 'src/modules/results/scope-refusals.test.ts';
const CLASS_SEARCH = 'src/modules/classes/search.test.ts';
const GROUPS = 'src/modules/classes/groups.test.ts';
const GROUP_MEMBERS = 'src/modules/classes/group-members.test.ts';
const VIEWS = 'src/modules/timetable/views.test.ts';
const VIEWS_EXPORT = 'src/modules/timetable/views-export.test.ts';
const HOME = 'src/modules/timetable/teaching-home.test.ts';
const TIMETABLE_OWN = 'src/modules/timetable/scope-refusals.test.ts';

/** `02`, Tutor: "Views the full student list of the branch (view only)". */
const TUTOR_STUDENT_LIST: ScopeLine = {
  roles: ['tutor'],
  scope: 'branch',
  rule: '02, Tutor: "Views the full student list of the branch (view only)"',
  refusedIn: [],
};

/** `02`, Head Teacher (and the Senior Head Teacher, "everything a Head Teacher can do"). */
const HEADS_STUDENT_LIST: ScopeLine = {
  roles: ['head_teacher', 'senior_head_teacher'],
  scope: 'branch',
  rule: '02, Head Teacher: "Full student list across classes and groups" (class-wide, decision 11 of #90)',
  refusedIn: [],
};

/** The Basic group, the photo included, is read by every member of staff of the branch. */
const BASIC_OF_BRANCH = (roles: ScopeLine['roles']): ScopeLine => ({
  roles,
  scope: 'branch',
  rule: 'edge/people-roles-accounts, Personal data: "Basic (name, class, photo, UID): all staff of the branch"; 02, the full student list',
  refusedIn: [],
});

const TEACHER_TAUGHT = (...tests: string[]): ScopeLine => ({
  roles: ['teacher'],
  scope: 'taught_students',
  rule: '02, Teacher: "The students they teach ... and no other student" (task 3.6a, L48)',
  refusedIn: tests,
});

const TUTOR_OWN_CLASS = (rule: string, ...tests: string[]): ScopeLine => ({
  roles: ['tutor'],
  scope: 'class',
  rule,
  refusedIn: tests,
});

const HEADS_OWN_CLASSES: ScopeLine = {
  roles: ['head_teacher', 'senior_head_teacher'],
  scope: 'branch',
  rule: '02, Head Teacher: "Full student list across classes and groups": every class of the branch (CLASS_WIDE_ROLES, decision 11 of #90)',
  refusedIn: [],
};

// Results: the record's reader, then each subject only to a reader of its journal (task 9.1,
// decision 4, Look first).
const RESULTS_RULE_TUTOR =
  '02, Tutor: "the profiles of own class"; 07: "Views journals of own class" (task 9.1, decision 4)';
const RESULTS_RULE_HEADS =
  '02, Scope: "For own subjects in own branch: journals" (task 9.1, decision 4)';
const RESULTS_TUTOR_TESTS = [
  `${RESULTS_OWN} > refuses the Tutor of another class the results, tabs, attendance and lessons of the student`,
];
const RESULTS_HEAD_TESTS = [
  `${RESULTS} > answers each subject only to a reader of its journal, and refuses the readers outside the record`,
];
const RESULTS_SENIOR_TESTS = [
  `${RESULTS_OWN} > leaves every subject out for a Senior Head Teacher of another subject, and refuses its lessons`,
];

const studentResultLines = (head: string[], teacher: ScopeLine): ScopeLine[] => [
  TUTOR_OWN_CLASS(RESULTS_RULE_TUTOR, ...RESULTS_TUTOR_TESTS),
  { roles: ['head_teacher'], scope: 'subjects', rule: RESULTS_RULE_HEADS, refusedIn: head },
  {
    roles: ['senior_head_teacher'],
    scope: 'subjects',
    rule: RESULTS_RULE_HEADS,
    refusedIn: RESULTS_SENIOR_TESTS,
  },
  teacher,
];

// The rating: the readers table of `rating.service.ts` (task 9.3a, decisions 1 and 4, review
// correction 2): one subject to the subject heads (own subjects), the Teacher (own journal) and
// the Tutor (own classes); a class across subjects to the Tutor (own classes); the classes of the
// branch to management only.
const RATING_BIG = `${RATING} > opens each list only to its readers, decided in the route, and refuses the roles outside the area`;
const RATING_EXPORT = `${RESULTS_OWN} > refuses an export outside the scope of the Tutor, the Teacher and both Head Teachers, logging nothing`;
const RATING_SENIOR = `${RESULTS_OWN} > refuses a Senior Head Teacher of another subject the subject list, and every Senior Head Teacher the class list`;
const RATING_CHOICES_HEADS = `${RESULTS_OWN} > leaves the journals of another subject out of the choices of a Head Teacher and a Senior Head Teacher`;
const RATING_RULE = '08, Rating; rating.service.ts readers (task 9.3a, decisions 1 and 4)';
const ratingLines = (tests: {
  tutor: string[];
  head: string[];
  senior: string[];
  teacher: string[];
}): ScopeLine[] => [
  {
    roles: ['tutor'],
    scope: 'class',
    rule: `${RATING_RULE}: Tutor, own classes`,
    refusedIn: tests.tutor,
  },
  {
    roles: ['head_teacher'],
    scope: 'subjects',
    rule: `${RATING_RULE}: Head Teacher, own subjects, one subject at a time`,
    refusedIn: tests.head,
  },
  {
    roles: ['senior_head_teacher'],
    scope: 'subjects',
    rule: `${RATING_RULE}: Senior Head Teacher, own subjects, one subject at a time`,
    refusedIn: tests.senior,
  },
  {
    roles: ['teacher'],
    scope: 'own_lessons',
    rule: `${RATING_RULE}: Teacher, the owner of the journal on the reference date`,
    refusedIn: tests.teacher,
  },
];

// The timetable views (task 5.9a, decisions 3 and 4; `06`, Views and outputs).
const VIEWS_TUTOR = `${VIEWS} > gives the Tutor the school and own class only, no room`;
const VIEWS_HEAD = `${VIEWS} > gives a Head Teacher the teachers of own subjects, in those subjects only`;
const VIEWS_SENIOR = `${VIEWS} > gives a Senior Head Teacher the teachers of own subjects in every branch, nothing else`;
const VIEWS_TEACHER = `${VIEWS} > gives a teacher their own timetable and nobody else’s`;
const VIEWS_RULE_HEADS =
  '06, Views and outputs: "Head Teachers and Senior Head Teachers the teachers of their subjects" (5.9a decisions 3 and 4)';
const VIEWS_RULE_TEACHER = '02, Teacher: "Own timetable" (5.9a decision 3)';
const headViewLines = (tutor: ScopeLine): ScopeLine[] => [
  tutor,
  { roles: ['head_teacher'], scope: 'subjects', rule: VIEWS_RULE_HEADS, refusedIn: [VIEWS_HEAD] },
  {
    roles: ['senior_head_teacher'],
    scope: 'subjects',
    rule: VIEWS_RULE_HEADS,
    refusedIn: [VIEWS_SENIOR],
  },
  {
    roles: ['teacher'],
    scope: 'own_lessons',
    rule: VIEWS_RULE_TEACHER,
    refusedIn: [VIEWS_TEACHER],
  },
];

// The reports of `08` over the journal (task 9.3b-2, decision 1, approved by the owner): the
// readers table of `reports.service.ts`.
const REPORTS = 'src/modules/results/reports.test.ts';
const REPORT_TUTOR = `${REPORTS} > gives the Tutor own classes only, refuses another class (403), and answers 404 for a class, subject or teacher unknown or of another branch`;
const REPORT_READERS = `${REPORTS} > opens the results table and subject mastery only to their readers: own-subject columns for a Head Teacher, own classes for a Tutor, no mastery for the Head Tutor`;
const REPORT_EXPORT_SCOPE = `${REPORTS} > refuses an export outside the scope of the Tutor and both Head Teachers, logging nothing`;
const REPORTS_RULE =
  '08, Analytics in Release 1; reports.service.ts readers (task 9.3b-2, decision 1)';
const reportLines = (tests: { tutor: string; heads: string }): ScopeLine[] => [
  {
    roles: ['tutor'],
    scope: 'class',
    rule: `${REPORTS_RULE}: Tutor, own classes; subject mastery of own class journals and groups wholly of own classes`,
    refusedIn: [tests.tutor],
  },
  {
    roles: ['head_teacher'],
    scope: 'subjects',
    rule: `${REPORTS_RULE}: Head Teacher, own-subject columns and own subjects`,
    refusedIn: [tests.heads],
  },
  {
    roles: ['senior_head_teacher'],
    scope: 'subjects',
    rule: `${REPORTS_RULE}: Senior Head Teacher, own-subject columns and own subjects`,
    refusedIn: [tests.heads],
  },
];

export const OTHER_SCOPES: RouteScopes = {
  'GET /api/setup/current-period': [
    {
      roles: ['tutor', 'senior_head_teacher', 'head_teacher', 'teacher'],
      scope: 'branch',
      rule: '12, Context: "The branch, academic year and quarter in use are always shown in the top bar" (every role)',
      refusedIn: [],
    },
  ],

  // --- Students -----------------------------------------------------------------------------
  'GET /api/people/students': [
    TUTOR_STUDENT_LIST,
    HEADS_STUDENT_LIST,
    TEACHER_TAUGHT(
      `${WHO} > lists the taught students only: a taught class, a taught group, a planned move into it`,
    ),
  ],
  'GET /api/people/students/no-class': [
    { ...TUTOR_STUDENT_LIST, rule: `${TUTOR_STUDENT_LIST.rule}: the counter of that list` },
    HEADS_STUDENT_LIST,
    TEACHER_TAUGHT(
      `${WHO} > refuses the History and Relatives tabs, the export, the counter and the show`,
    ),
  ],
  'GET /api/people/students/:id': [
    TUTOR_OWN_CLASS(
      '02, Tutor: "the profiles of own class" (task 3.1c)',
      `${TUTOR_SCOPE} > refuses another class, a former member and a student with no class`,
    ),
    BASIC_OF_BRANCH(['head_teacher', 'senior_head_teacher']),
    TEACHER_TAUGHT(`${WHO} > refuses another student on the record, the photo and Ctrl+K`),
  ],
  'GET /api/people/students/:id/photo': [
    BASIC_OF_BRANCH(['tutor', 'head_teacher', 'senior_head_teacher']),
    TEACHER_TAUGHT(`${WHO} > refuses another student on the record, the photo and Ctrl+K`),
  ],
  // The show is for the Principal alone; every scoped role is refused it, in its scope too.
  'POST /api/people/students/:id/identity': [
    TUTOR_OWN_CLASS(
      'edge/people-roles-accounts, Identity: Super Admin, Academic Vice Principal, Head Tutor; the Principal by a logged show; not the Tutor',
      `${TUTOR_SCOPE} > refuses the identity show to a Tutor`,
      `${STUDENTS} > refuses the show to a reader who sees the identity or may not see it`,
    ),
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: 'edge/people-roles-accounts, Identity: not a reader; the show is the Principal’s',
      refusedIn: [
        `${STUDENTS} > refuses the show to a reader who sees the identity or may not see it`,
      ],
    },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: 'edge/people-roles-accounts, Identity: not a reader; the show is the Principal’s',
      refusedIn: [
        `${PEOPLE} > refuses the identity show to a Senior Head Teacher who reads the record, writing nothing`,
      ],
    },
    TEACHER_TAUGHT(
      `${WHO} > refuses the History and Relatives tabs, the export, the counter and the show`,
    ),
  ],
  'POST /api/people/students/export': [
    TUTOR_OWN_CLASS(
      'edge/people-roles-accounts: "A Tutor exports the students of own class with every field the Tutor reads about them, and no other class"',
      `${TUTOR_SCOPE} > refuses a file with no row of the own class, and the consent filter`,
      `${TUTOR_SCOPE} > writes the own class only, with every group the Tutor reads, and counts the rows left out`,
    ),
    {
      ...HEADS_STUDENT_LIST,
      rule: '02, Head Teacher: "Full student list across classes and groups; exports it with the Basic fields"',
    },
  ],
  'GET /api/people/students/:id/relatives': [
    TUTOR_OWN_CLASS(
      '02, Tutor: "the profiles of own class"; Contact: "the class Tutor" (task 3.1c, decision 2)',
      `${TUTOR_SCOPE} > is refused for another class and a former member, 404 for another branch and unknown`,
    ),
  ],
  'GET /api/people/students/:id/history': [
    TUTOR_OWN_CLASS(
      '04, Profile tabs (History); the Tutor reads own classes (task 3.3a, decision 9 as changed by correction 3)',
      `${GROUP_TRANSFERS} > lets the Tutor of the class read it and refuses a Tutor of another class`,
    ),
    {
      ...HEADS_OWN_CLASSES,
      rule: '02, Head Teacher: "Full student list across classes and groups"; 04, Movements: Head Teachers move students between groups (task 3.3a, decision 9: class-wide)',
    },
  ],
  'GET /api/people/students/:id/leaving-results': [
    TUTOR_OWN_CLASS(
      '02, Tutor: "the profiles of own class"; a student who left is of no class now',
      `${LEAVING} > refuses the Tutor of the class alone, a student who left being of no class now, and answers a Tutor who also reads the record`,
    ),
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: RESULTS_RULE_HEADS,
      refusedIn: [
        `${LEAVING} > answers each subject only to a reader who reads its journal whole, and refuses the readers outside the record`,
      ],
    },
    TEACHER_TAUGHT(
      `${LEAVING} > answers each subject only to a reader who reads its journal whole, and refuses the readers outside the record`,
    ),
  ],
  'GET /api/search/students': [
    TUTOR_OWN_CLASS(
      'edge/people-roles-accounts: "Search returns only records the person may open" (the Tutor: own class)',
      `${PEOPLE_SEARCH} > lists for the Tutor the students of own class, in force and planned, and no other`,
    ),
    HEADS_STUDENT_LIST,
    TEACHER_TAUGHT(`${WHO} > refuses another student on the record, the photo and Ctrl+K`),
  ],

  // --- Student results ----------------------------------------------------------------------
  'GET /api/results/students/:id': [
    TUTOR_OWN_CLASS(
      RESULTS_RULE_TUTOR,
      `${RESULTS} > answers a Teacher who teaches the student another subject only that subject, and the class Tutor every subject of the class`,
      ...RESULTS_TUTOR_TESTS,
    ),
    ...studentResultLines(RESULTS_HEAD_TESTS, TEACHER_TAUGHT(...RESULTS_HEAD_TESTS)).slice(1),
  ],
  'GET /api/results/students/:id/tabs': studentResultLines(
    RESULTS_HEAD_TESTS,
    TEACHER_TAUGHT(...RESULTS_HEAD_TESTS),
  ),
  'GET /api/results/students/:id/attendance': studentResultLines(
    RESULTS_HEAD_TESTS,
    TEACHER_TAUGHT(...RESULTS_HEAD_TESTS),
  ),
  'GET /api/results/students/:id/lessons': studentResultLines(
    [
      `${RESULTS} > refuses the lessons of a subject the reader does not read, and answers 404 for another branch’s or an unknown id`,
    ],
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: '02, Teacher: journals of own classes and groups (task 9.1, decision 4)',
      refusedIn: [
        `${RESULTS} > answers a Teacher who teaches the student another subject only that subject, and the class Tutor every subject of the class`,
      ],
    },
  ),

  // --- Rating -------------------------------------------------------------------------------
  'GET /api/results/rating/choices': ratingLines({
    tutor: [RATING_BIG],
    head: [RATING_CHOICES_HEADS],
    senior: [RATING_CHOICES_HEADS],
    teacher: [RATING_BIG],
  }),
  'GET /api/results/rating/subject': ratingLines({
    tutor: [RATING_BIG],
    head: [RATING_BIG],
    senior: [RATING_SENIOR],
    teacher: [RATING_BIG],
  }),
  'GET /api/results/rating/class': ratingLines({
    tutor: [RATING_BIG],
    head: [RATING_BIG],
    senior: [RATING_SENIOR],
    teacher: [RATING_BIG],
  }),
  'GET /api/results/rating/classes': ratingLines({
    tutor: [RATING_BIG],
    head: [RATING_BIG],
    senior: [RATING_BIG],
    teacher: [RATING_BIG],
  }),
  'POST /api/results/rating/export': ratingLines({
    tutor: [RATING_BIG, RATING_EXPORT],
    head: [RATING_EXPORT],
    senior: [RATING_EXPORT],
    teacher: [RATING_EXPORT],
  }),

  // --- Early-warning list (task 9.4a, decisions 1 and 7) ------------------------------------
  'GET /api/results/early-warning': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: '08, Early-warning list: the Tutor, the students of own classes on the reference date (task 9.4a, decision 1)',
      refusedIn: [
        `${WARNING} > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal`,
      ],
    },
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: '02, Scope: "For own subjects in own branch: ... the early-warning list"',
      refusedIn: [
        `${WARNING} > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal`,
      ],
    },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: '02, Scope: "For own subjects in own branch: ... the early-warning list"; Senior Head Teacher in every branch',
      refusedIn: [
        `${RESULTS_OWN} > leaves every entry out for a Senior Head Teacher of another subject`,
      ],
    },
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: '08, Early-warning list: the Teacher, own journals (task 9.4a, decision 1)',
      refusedIn: [
        `${WARNING} > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal`,
      ],
    },
  ],
  'POST /api/results/early-warning/handled': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: 'Task 9.4a: the Tutor marks the students of own classes handled (permission review, must-fix 1)',
      refusedIn: [
        `${RESULTS_OWN} > refuses the Tutor of another class the mark handled, writing nothing`,
      ],
    },
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: 'Task 9.4a: the Teacher marks the entries of own journals handled',
      refusedIn: [
        `${WARNING} > marks a reason handled with a note, audited, hides it, and refuses in order: 404 for each body id, 403 out of scope, 409 not listed`,
      ],
    },
  ],

  // --- Appointments -------------------------------------------------------------------------
  'GET /api/access/head-teachers': [
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: '02, Scope: own subjects; the list shows the appointments of the reader’s subjects (task 2.3b-1)',
      refusedIn: [
        `${HEADS} > shows a Head Teacher alone neither another subject nor its Senior Head Teacher`,
      ],
    },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: '02, Senior Head Teacher: "Sees the Head Teachers of those subjects"',
      refusedIn: [
        `${HEADS} > shows a Senior Head Teacher alone the holders of their subjects in a branch of no own role`,
      ],
    },
  ],

  // --- Classes ------------------------------------------------------------------------------
  'GET /api/classes': [
    TUTOR_OWN_CLASS(
      '02, Tutor: "Own class or classes" (task 3.1c, decisions 1 and 9)',
      `${TUTOR_SCOPE} > lists the own classes only and reads them with their members`,
    ),
    HEADS_OWN_CLASSES,
  ],
  'GET /api/classes/:id': [
    TUTOR_OWN_CLASS(
      '02, Tutor: "Own class or classes" (task 3.1c, decisions 1 and 9)',
      `${TUTOR_SCOPE} > refuses another class 403 and another branch's or an unknown one 404`,
    ),
    HEADS_OWN_CLASSES,
  ],
  'GET /api/classes/:id/members': [
    TUTOR_OWN_CLASS(
      '02, Tutor: "Own class or classes" (task 3.1c, decisions 1 and 9)',
      `${TUTOR_SCOPE} > refuses another class 403 and another branch's or an unknown one 404`,
    ),
    HEADS_OWN_CLASSES,
  ],
  'GET /api/search/classes': [
    TUTOR_OWN_CLASS(
      'edge/people-roles-accounts: "Search returns only records the person may open" (the Tutor: own class)',
      `${CLASS_SEARCH} > finds own class and no other, by name and by a Cyrillic look-alike spelling`,
    ),
    HEADS_OWN_CLASSES,
  ],

  // --- Groups (task 3.2a, decisions 2 and 11 of #91) ----------------------------------------
  'GET /api/search/groups': [
    TUTOR_OWN_CLASS(
      'Task 3.2a, decision 11 (Look first): the groups that draw from own classes',
      `${CLASS_SEARCH} > finds the groups drawing from own class, and not one drawing from another class only`,
    ),
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: '02, Scope: "For own subjects in own branch: ... groups"',
      refusedIn: [
        `${CLASS_SEARCH} > a Head Teacher and the Senior Head Teacher find the groups of own subjects only`,
      ],
    },
  ],
  'GET /api/groups': groupLines(
    `${GROUPS} > lets the readers of 02 read every group, the Head Teachers own subjects, the Tutor own classes`,
  ),
  'GET /api/groups/:id': groupLines(
    `${GROUPS} > lets the readers of 02 read every group, the Head Teachers own subjects, the Tutor own classes`,
  ),
  'GET /api/groups/:id/members': [
    TUTOR_OWN_CLASS(
      'Task 3.2a, decision 11 (Look first): the groups that draw from own classes, the own class’s members',
      `${GROUP_MEMBERS} > lets a Tutor read the members of own class only, with a count of the others`,
    ),
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: '02, Scope: "For own subjects in own branch: ... groups"',
      refusedIn: [
        `${GROUP_MEMBERS} > lets a Head Teacher read a group of own subjects, not another`,
      ],
    },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: '02, Senior Head Teacher: everything a Head Teacher can do, for own subjects, in every branch',
      refusedIn: [
        `${GROUP_MEMBERS} > lets a Senior Head Teacher read a group of own subjects in a branch of no assignment of theirs`,
      ],
    },
  ],
  'POST /api/groups/transfers': [
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: '02, Head Teacher: "Moves students between groups of those subjects" (task 3.3a, decision 2)',
      refusedIn: [
        `${PEOPLE} > is refused to a Head Teacher and a Senior Head Teacher of another subject, writing nothing`,
        `${GROUP_TRANSFERS} > refuses a Head Teacher another subject, and a date in the past`,
        `${GROUP_TRANSFERS} > lets a Senior Head Teacher move own subjects in a second branch and refuses another subject`,
      ],
    },
  ],
  'POST /api/groups/transfers/:id/change': transferLines(),
  'POST /api/groups/transfers/:id/cancel': transferLines(),
  'POST /api/groups/transfers/:id/undo': transferLines(),

  // --- Timetable views ----------------------------------------------------------------------
  'GET /api/timetable/views/choices': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: '02, Tutor: "Sees the school timetable and the timetable of own class" (5.9a decision 3)',
      refusedIn: [`${VIEWS} > lists what each role may open`],
    },
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: VIEWS_RULE_HEADS,
      refusedIn: [
        `${TIMETABLE_OWN} > leaves the teachers of another subject, the school, the classes and the rooms out of the choices of a Head Teacher and a Senior Head Teacher`,
      ],
    },
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: VIEWS_RULE_TEACHER,
      refusedIn: [`${VIEWS} > lists what each role may open`],
    },
  ],
  'GET /api/timetable/views/branch': headViewLines({
    roles: ['tutor'],
    scope: 'branch',
    rule: '02, Tutor: "Sees the school timetable"',
    refusedIn: [],
  }),
  'GET /api/timetable/views/class': headViewLines(
    TUTOR_OWN_CLASS('02, Tutor: "the timetable of own class" (5.9a decision 3)', VIEWS_TUTOR),
  ),
  'GET /api/timetable/views/room': headViewLines(
    TUTOR_OWN_CLASS(
      '06, Views and outputs: the Tutor the school and own class, no room (5.9a decision 3)',
      VIEWS_TUTOR,
    ),
  ),
  'GET /api/timetable/views/teacher': headViewLines({
    roles: ['tutor'],
    scope: 'own_lessons',
    rule: '5.9a decision 3: the Tutor reads the own teacher view only',
    refusedIn: [VIEWS_TUTOR],
  }),
  'POST /api/timetable/views/export': [
    TUTOR_OWN_CLASS(
      '06, Views and outputs, with the 5.9a scope: the Tutor prints the school and own class',
      `${VIEWS_EXPORT} > lets the Tutor print the school and own class, nothing else`,
      `${VIEWS_EXPORT} > writes none for a refusal or a PDF that could not be made, and sends no file`,
    ),
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: VIEWS_RULE_HEADS,
      refusedIn: [
        `${VIEWS_EXPORT} > refuses a Head Teacher of another subject the teachers of this one`,
        `${VIEWS_EXPORT} > writes none for a refusal or a PDF that could not be made, and sends no file`,
      ],
    },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: VIEWS_RULE_HEADS,
      refusedIn: [
        `${VIEWS_EXPORT} > lets a Senior Head Teacher print a teacher of own subject in the branch, nothing else`,
        `${TIMETABLE_OWN} > refuses a Senior Head Teacher of another subject and a Teacher the file of another teacher, logging nothing`,
      ],
    },
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: VIEWS_RULE_TEACHER,
      refusedIn: [
        `${VIEWS_EXPORT} > lets a teacher print their own timetable and nobody else’s`,
        `${TIMETABLE_OWN} > refuses a Senior Head Teacher of another subject and a Teacher the file of another teacher, logging nothing`,
      ],
    },
  ],
  'GET /api/timetable/home': [
    {
      roles: ['tutor', 'head_teacher', 'senior_head_teacher'],
      scope: 'own_lessons',
      rule: 'Task 5.9b: the caller’s own lessons and exams of the week; the query takes no field',
      refusedIn: [
        `${TIMETABLE_OWN} > lists only the own lessons on the home page of a Tutor, a Head Teacher and a Senior Head Teacher`,
      ],
    },
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: 'Task 5.9b: the caller’s own lessons and exams of the week; the query takes no field',
      refusedIn: [`${HOME} > refuses a query that names a person (spec review should-fix 4)`],
    },
  ],

  // --- The reports of `08` over the journal (task 9.3b-2, decision 1) ---------------------------
  'GET /api/results/reports/attendance': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: `${REPORTS_RULE}: Tutor, the students of own classes`,
      refusedIn: [REPORT_TUTOR],
    },
  ],
  'POST /api/results/reports/attendance/export': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: `${REPORTS_RULE}: Tutor, the students of own classes`,
      refusedIn: [REPORT_EXPORT_SCOPE],
    },
  ],
  'GET /api/results/reports/choices': reportLines({ tutor: REPORT_READERS, heads: REPORT_READERS }),
  'GET /api/results/reports/results-table': reportLines({
    tutor: REPORT_READERS,
    heads: REPORT_READERS,
  }),
  'GET /api/results/reports/subject-mastery': reportLines({
    tutor: REPORT_READERS,
    heads: REPORT_READERS,
  }),
  'POST /api/results/reports/export': reportLines({
    tutor: REPORT_EXPORT_SCOPE,
    heads: REPORT_EXPORT_SCOPE,
  }),
};

function groupLines(test: string): ScopeLine[] {
  return [
    TUTOR_OWN_CLASS(
      'Task 3.2a, decision 11 (Look first): the groups that draw from own classes',
      test,
    ),
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: '02, Scope: "For own subjects in own branch: ... groups"',
      refusedIn: [test],
    },
  ];
}

function transferLines(): ScopeLine[] {
  return [
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: '02, Head Teacher: "Moves students between groups of those subjects" (task 3.3a, decision 2)',
      refusedIn: [
        `${GROUP_TRANSFERS} > lets a Head Teacher change, cancel and undo moves of own subjects only, naming the assignment`,
      ],
    },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: '02, Senior Head Teacher: everything a Head Teacher can do, for own subjects, in every branch',
      refusedIn: [
        `${PEOPLE} > is refused to a Senior Head Teacher of another subject on change, cancel and undo, writing nothing`,
      ],
    },
  ];
}
