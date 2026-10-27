import type { RouteScopes, ScopeLine } from '../route-scope-check.js';

// Task 10.3a: the limit inside each journal route for the scoped roles it lets in, and the
// tests that call the route outside that limit and see it refused.

const SCOPE = 'src/modules/journal/scope-refusals.test.ts';
const GRID = 'src/modules/journal/journals.test.ts';
const READERS = 'src/modules/journal/rating-readers.test.ts';
const ATTENDANCE = 'src/modules/journal/attendance.test.ts';
const EXPORTS = 'src/modules/journal/journal-exports.test.ts';
const STATUS = 'src/modules/journal/lesson-status.test.ts';
const HOME = 'src/modules/results/home-pages.test.ts';
const DELIVERY = 'src/modules/plans/plan-delivery.test.ts';
const EXEMPTIONS = 'src/modules/journal/exemptions.test.ts';
const EXEMPTIONS_ACCESS = 'src/modules/journal/exemptions-access.test.ts';
const ABSENCES = 'src/modules/journal/student-absences.test.ts';
const ABSENCE_FILES = 'src/modules/journal/exemption-files.test.ts';

const at = (file: string, title: string) => `${file} > ${title}`;

// The rules.
const TEACHER_READS =
  '02, Teacher: "Journals of own classes and groups"; 07, Who can do what (a substitute: the substituted lesson only; task 6.2, decision 19)';
const HEAD_READS =
  '02, Head Teacher: "Views journals and lesson plans of those subjects"; 07, Who can do what: "View all journals of their subjects, a Head Teacher in own branch"';
const SENIOR_READS =
  '02, Senior Head Teacher: everything a Head Teacher can do, for the subjects given to them, in every branch; 07, Who can do what';
const TUTOR_READS =
  '07, Who can do what, Tutor: "Views journals of own class" (task 6.2, decision 2)';
const TEACHER_ENTERS =
  '07, Who can do what, Teacher: "Enters and edits in own journals inside the edit period"; Substitute teacher: "Enters for the substituted lesson only"';
const TUTOR_ENTERS =
  '07, Who can do what, Tutor: "Enters attendance in own Maʼnaviyat soati and Homework slot journals"; 02, Tutor: holds those lessons of own class';
const OWN_UNLOCK =
  '02, Head Teacher / Senior Head Teacher: "Also works as a Teacher"; an unlock is asked for a lesson or rating exam the person enters (task 8.4, decision 8)';
const OWN_REQUESTS =
  '02, Own requests; task 8.4: the requests the person sent; "deciding" lists only those the reader may decide; "branch" is the whole-branch readers\'';
const DECIDES =
  '02, Head Teachers and Senior Head Teachers, Who approves: "A teacher\'s unlock ... goes to the Head Teacher of the subject"; the Senior Head Teacher of the subject sees it too';
const OWN_REMINDERS =
  "07, Reminders: the caller's own lessons (task 8.7, decisions 12 and 13), for every role";
const BRANCH_EXPORT =
  "task 8.9, decision 3: the branch export is the whole-branch readers' (Super Admin, Principal, Academic Vice Principal); others export their own journals";
const OWN_EXPORTS =
  "task 8.9, decision 12: the person's own branch exports, access checked again at download";
const EXEMPTION_CARDS =
  "edge/exemptions, row 11; 07, Problem cases: \"The student's Tutor and teachers see 'back from exemption'\": own classes for a Tutor, own lessons today for everyone (task 8.5, permission review 11)";
const ABSENCE_REASONS =
  '02, Tutor: "Records the reason for an absence, without changing the mark" (own class; task 8.6)';

// The tests.
const GRID_TEACHER = at(
  GRID,
  'refuses a teacher of another journal, and reads a teacher who is also Head Tutor whole',
);
const GRID_HEAD = at(
  GRID,
  'gives a Head Teacher the journals of own subjects and refuses the others',
);
const GRID_SENIOR = at(
  GRID,
  'gives a Senior Head Teacher the journals of own subjects in the branch of the request only',
);
const GRID_TUTOR = at(
  GRID,
  "gives a Tutor the journals of own class whole and refuses another class's",
);
const WRITES_TUTOR = at(
  SCOPE,
  'refuses the Tutor of the class every write of a graded lesson of the class, its rating exam and its comments, writing nothing',
);
const WRITES_TEACHER = at(
  SCOPE,
  'refuses a teacher of another journal every write of the lesson, its rating exam and its comments, writing nothing',
);
const UNLOCK_HEADS = at(
  SCOPE,
  'refuses a Head Teacher and a Senior Head Teacher of the subject an unlock of a lesson and of a rating exam they do not teach, writing nothing',
);
const UNLOCKS = at(
  SCOPE,
  'lists, decides and withdraws only own requests and those of own subjects, refusing the rest and writing nothing',
);
const REMINDERS = at(
  SCOPE,
  "gives every role its own reminders only, never the lessons of the journal's teacher",
);
const HISTORIES = at(
  SCOPE,
  'refuses a Senior Head Teacher of another subject the history of a cell, of a rating entry and of a comment, and a teacher of another journal the history of a comment',
);
const CARD = at(
  SCOPE,
  'refuses the lesson card to a Tutor of another class and a Senior Head Teacher of another subject',
);
const CARDS_TODAY = at(
  SCOPE,
  'shows a Head Teacher and a Senior Head Teacher of the subject none of the exemption cards of lessons they do not teach',
);
const BRANCH_EXPORTS = at(
  SCOPE,
  'keeps the branch export to its readers: a scoped role asks for none, lists none of another and gets no file of it, writing nothing',
);
const READERS_TUTOR = at(
  READERS,
  'gives the Tutor of one class of the group the rows of own class only, also in both histories',
);
const READERS_HEAD = at(
  READERS,
  'lets a Head Teacher of the subject read both histories, and refuses one of another subject and a Teacher with no lesson',
);
const CELL_TEACHER = at(
  ATTENDANCE,
  'answers the lines of the cells the reader’s grid shows, attendance only for a Head Tutor, and refuses a substitute outside their lesson',
);
const CELL_READERS = at(
  ATTENDANCE,
  'answers every reader whose grid shows the cell, and refuses a Tutor of another class and a Head Teacher of another subject',
);

/** The same limits for the Tutor and the Teacher on a write of a lesson, its rating exam or its comments. */
const entryLines: readonly ScopeLine[] = [
  { roles: ['tutor'], scope: 'own_lessons', rule: TUTOR_ENTERS, refusedIn: [WRITES_TUTOR] },
  { roles: ['teacher'], scope: 'own_lessons', rule: TEACHER_ENTERS, refusedIn: [WRITES_TEACHER] },
];

/** The four readers of a journal, as the grid decides them. */
const gridLines: readonly ScopeLine[] = [
  { roles: ['teacher'], scope: 'own_lessons', rule: TEACHER_READS, refusedIn: [GRID_TEACHER] },
  { roles: ['head_teacher'], scope: 'subjects', rule: HEAD_READS, refusedIn: [GRID_HEAD] },
  {
    roles: ['senior_head_teacher'],
    scope: 'subjects',
    rule: SENIOR_READS,
    refusedIn: [GRID_SENIOR],
  },
  { roles: ['tutor'], scope: 'class', rule: TUTOR_READS, refusedIn: [GRID_TUTOR] },
];

const unlockRequestLines: readonly ScopeLine[] = [
  ...entryLines,
  {
    roles: ['head_teacher', 'senior_head_teacher'],
    scope: 'own_lessons',
    rule: OWN_UNLOCK,
    refusedIn: [UNLOCK_HEADS],
  },
];

const ownExportLines: readonly ScopeLine[] = [
  {
    roles: ['tutor', 'teacher', 'head_teacher', 'senior_head_teacher'],
    scope: 'own_requests',
    rule: OWN_EXPORTS,
    refusedIn: [BRANCH_EXPORTS],
  },
];

export const JOURNAL_SCOPES: RouteScopes = {
  'GET /api/journal/journals': gridLines,
  'GET /api/journal/journals/:journalId': gridLines,

  'POST /api/journal/lessons/:lessonId/attendance': entryLines,
  'POST /api/journal/lessons/:lessonId/all-present': entryLines,
  'POST /api/journal/lessons/:lessonId/undo': entryLines,
  'POST /api/journal/lessons/:lessonId/copy-attendance': entryLines,
  'POST /api/journal/lessons/:lessonId/works': entryLines,
  'DELETE /api/journal/lessons/:lessonId/works/:workId': entryLines,
  'PUT /api/journal/lessons/:lessonId/works/total': entryLines,
  'PUT /api/journal/lessons/:lessonId/works/not-held': entryLines,
  'POST /api/journal/lessons/:lessonId/works/carry': entryLines,
  'POST /api/journal/lessons/:lessonId/scores': entryLines,
  'POST /api/journal/lessons/:lessonId/not-graded': entryLines,
  'PUT /api/journal/lessons/:lessonId/delivery': entryLines,
  'PUT /api/journal/lessons/:lessonId/homework-given': entryLines,
  'PUT /api/journal/journals/:journalId/rating/:quarterId/date': entryLines,
  // "Not held" is the Academic Vice Principal's (decision 7 of the rating exam, rating.service.ts): the journal's own
  // teacher is refused too; the test proves the refusal outside the own journal.
  'PUT /api/journal/journals/:journalId/rating/:quarterId/not-held': entryLines,
  'POST /api/journal/journals/:journalId/rating/:quarterId/entries': entryLines,
  'PUT /api/journal/comments': entryLines,

  'POST /api/journal/lessons/:lessonId/unlocks': unlockRequestLines,
  'POST /api/journal/journals/:journalId/rating/:quarterId/unlocks': unlockRequestLines,
  'GET /api/journal/unlocks': [
    {
      roles: ['tutor', 'teacher'],
      scope: 'own_requests',
      rule: OWN_REQUESTS,
      refusedIn: [UNLOCKS],
    },
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: `${DECIDES}; ${OWN_REQUESTS}`,
      refusedIn: [UNLOCKS],
    },
  ],
  'POST /api/journal/unlocks/:unlockId/decide': [
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: DECIDES,
      refusedIn: [UNLOCKS],
    },
  ],
  'POST /api/journal/unlocks/:unlockId/withdraw': [
    {
      roles: ['tutor', 'teacher', 'head_teacher', 'senior_head_teacher'],
      scope: 'own_requests',
      rule: '02, Own requests; task 8.4: only the person who sent a request withdraws it',
      refusedIn: [UNLOCKS],
    },
  ],

  'GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history': [
    { roles: ['teacher'], scope: 'own_lessons', rule: TEACHER_READS, refusedIn: [READERS_HEAD] },
    { roles: ['head_teacher'], scope: 'subjects', rule: HEAD_READS, refusedIn: [READERS_HEAD] },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: SENIOR_READS,
      refusedIn: [HISTORIES],
    },
    { roles: ['tutor'], scope: 'class', rule: TUTOR_READS, refusedIn: [READERS_TUTOR] },
  ],
  'GET /api/journal/comments/history': [
    { roles: ['teacher'], scope: 'own_lessons', rule: TEACHER_READS, refusedIn: [HISTORIES] },
    { roles: ['head_teacher'], scope: 'subjects', rule: HEAD_READS, refusedIn: [READERS_HEAD] },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: SENIOR_READS,
      refusedIn: [HISTORIES],
    },
    { roles: ['tutor'], scope: 'class', rule: TUTOR_READS, refusedIn: [READERS_TUTOR] },
  ],
  'GET /api/journal/lessons/:lessonId/students/:studentId/history': [
    { roles: ['teacher'], scope: 'own_lessons', rule: TEACHER_READS, refusedIn: [CELL_TEACHER] },
    { roles: ['head_teacher'], scope: 'subjects', rule: HEAD_READS, refusedIn: [CELL_READERS] },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: SENIOR_READS,
      refusedIn: [HISTORIES],
    },
    { roles: ['tutor'], scope: 'class', rule: TUTOR_READS, refusedIn: [CELL_READERS] },
  ],
  'GET /api/journal/lessons/:lessonId/card': [
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: `${TEACHER_READS}; 09, In the journal: "Clicking it opens the lesson card"`,
      refusedIn: [
        at(
          DELIVERY,
          'refuses a teacher who reads neither the journal nor the plan, and 404s another branch or an unknown lesson',
        ),
      ],
    },
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: HEAD_READS,
      refusedIn: [
        at(
          DELIVERY,
          'refuses the Academic Vice Principal both marks, and gives the card whole to the Head Teacher of the subject, the Senior Head Teacher and the vice; a Head Teacher of another subject is refused',
        ),
      ],
    },
    { roles: ['senior_head_teacher'], scope: 'subjects', rule: SENIOR_READS, refusedIn: [CARD] },
    { roles: ['tutor'], scope: 'class', rule: TUTOR_READS, refusedIn: [CARD] },
  ],

  'GET /api/journal/reminders': [
    {
      roles: ['tutor', 'teacher', 'head_teacher', 'senior_head_teacher'],
      scope: 'own_lessons',
      rule: OWN_REMINDERS,
      refusedIn: [REMINDERS],
    },
  ],
  'GET /api/journal/attendance-today': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: '08, Home pages by role, Tutor; 02, Tutor: "attendance per lesson and daily attendance in percent" of own class (task 9.4b)',
      refusedIn: [
        at(
          HOME,
          'gives a Tutor the own class: the day, the week, below the threshold and who is absent now',
        ),
      ],
    },
  ],
  'GET /api/journal/discipline': [
    {
      roles: ['head_teacher'],
      scope: 'subjects',
      rule: '08, Journal discipline: own subjects for a Head Teacher (task 8.7, decision 6)',
      refusedIn: [
        at(
          STATUS,
          'refuses a range of more than 92 days or outside one year, and an unknown department; a Head Teacher of another subject sees nobody',
        ),
      ],
    },
    {
      roles: ['senior_head_teacher'],
      scope: 'subjects',
      rule: '08, Journal discipline: own subjects for a Senior Head Teacher, in every branch (task 8.7, decision 6)',
      refusedIn: [
        at(
          STATUS,
          'gives the Senior Head Teacher the teachers of own subjects in a branch without an appointment there, not those of another subject',
        ),
      ],
    },
  ],
  'GET /api/journal/lessons-today': [
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: '08, Home pages by role: lessons today, the same scope as the counts per teacher (task 9.4b; task 8.7, decision 6)',
      refusedIn: [
        at(
          HOME,
          'counts the held lessons by status as the counts per teacher do, the lessons ahead apart, and keeps the Head Teacher to own subjects',
        ),
      ],
    },
  ],

  'POST /api/journal/journals/:journalId/export': [
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: '07: "Export to Excel and PDF"; task 8.9, decision 1: "teachers export their own journals"',
      refusedIn: [
        at(
          EXPORTS,
          'writes attendance only for a reader of attendance, and refuses a month outside the quarter, a lesson reader, another branch and an unknown quarter',
        ),
      ],
    },
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: 'task 8.9: the export follows the scope of the grid (subjects for a Head Teacher and a Senior Head Teacher)',
      refusedIn: [
        at(
          EXPORTS,
          'follows the scope of the grid: a Head Teacher of the subject, a Senior Head Teacher in another branch and the Tutor of the class are let in; the same roles outside their scope are refused',
        ),
      ],
    },
    {
      roles: ['tutor'],
      scope: 'class',
      rule: 'task 8.9: the export follows the scope of the grid (own class for a Tutor)',
      refusedIn: [
        at(
          EXPORTS,
          'follows the scope of the grid: a Head Teacher of the subject, a Senior Head Teacher in another branch and the Tutor of the class are let in; the same roles outside their scope are refused',
        ),
      ],
    },
  ],
  'POST /api/journal/exports': [
    { roles: ['teacher'], scope: 'own_lessons', rule: BRANCH_EXPORT, refusedIn: [BRANCH_EXPORTS] },
    { roles: ['tutor'], scope: 'class', rule: BRANCH_EXPORT, refusedIn: [BRANCH_EXPORTS] },
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'subjects',
      rule: BRANCH_EXPORT,
      refusedIn: [BRANCH_EXPORTS],
    },
  ],
  'GET /api/journal/exports': ownExportLines,
  'GET /api/journal/exports/:exportId/file': ownExportLines,

  'GET /api/journal/exemptions-today': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: EXEMPTION_CARDS,
      refusedIn: [
        at(
          EXEMPTIONS,
          'shows the Tutor "exempt today" with the category and "back from exemption" the day after the end',
        ),
      ],
    },
    {
      roles: ['teacher'],
      scope: 'own_lessons',
      rule: EXEMPTION_CARDS,
      refusedIn: [
        at(
          EXEMPTIONS_ACCESS,
          "shows 'back' for the students of the teacher's own lessons today, of their subject only",
        ),
      ],
    },
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'own_lessons',
      rule: EXEMPTION_CARDS,
      refusedIn: [CARDS_TODAY],
    },
  ],

  'GET /api/journal/student-absences': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: ABSENCE_REASONS,
      refusedIn: [
        at(
          ABSENCES,
          'lists the days with a 0 or 3 or a reason, marks a 0 after being at school, and limits a Tutor to own classes',
        ),
      ],
    },
  ],
  'PUT /api/journal/student-absences/:studentId/:date': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: ABSENCE_REASONS,
      refusedIn: [
        at(
          ABSENCES,
          'lets the Academic Vice Principal and the Super Admin write any class, and refuses a Tutor of another class and every other role',
        ),
      ],
    },
  ],
  'PUT /api/journal/student-absences/:studentId/:date/file': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: ABSENCE_REASONS,
      refusedIn: [at(ABSENCE_FILES, 'refuses a Tutor of another class, a Teacher and a Principal')],
    },
  ],
  'DELETE /api/journal/student-absences/:studentId/:date/file': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: ABSENCE_REASONS,
      refusedIn: [at(ABSENCE_FILES, 'refuses a Tutor of another class, a Teacher and a Principal')],
    },
  ],
  'GET /api/journal/student-absences/:studentId/:date/file': [
    {
      roles: ['tutor'],
      scope: 'class',
      rule: ABSENCE_REASONS,
      refusedIn: [at(ABSENCE_FILES, 'refuses a Tutor of another class, a Teacher and a Principal')],
    },
  ],
};
