import type { RouteScopes } from '../route-scope-check.js';

/*
 * The whole-branch roles (Super Admin, Principal, Academic Vice Principal,
 * Vice Principal for Spiritual and Moral Education, Head Tutor) that a route
 * holds to less than the guard lets in: a field group left out or hidden, an
 * export without contact and identity fields, the accounts an administrator
 * may act on, a reading of attendance only (task 10.3a). `02` is
 * docs/spec/02-roles-and-access.md, `edge/people` is
 * docs/spec/edge-cases/people-roles-accounts.md.
 */

const STUDENTS = 'src/modules/people/students.test.ts';
const STAFF = 'src/modules/people/staff.test.ts';
const STAFF_EMAIL = 'src/modules/people/staff-email.test.ts';
const STAFF_ACCOUNTS = 'src/modules/people/staff-accounts.test.ts';
const ACCOUNT_ACCESS = 'src/modules/people/account-access.test.ts';
const SEARCH = 'src/modules/people/search.test.ts';
const RELATIVES = 'src/modules/people/relatives.test.ts';
const STUDENT_EXPORTS = 'src/modules/people/student-exports.test.ts';
const STAFF_EXPORTS = 'src/modules/people/exports.test.ts';
const STUDENT_RESULTS = 'src/modules/results/student-results.test.ts';
const AUDIT = 'src/modules/audit/audit-entries.test.ts';
const RATING_READERS = 'src/modules/journal/rating-readers.test.ts';
const JOURNAL_EXPORTS = 'src/modules/journal/journal-exports.test.ts';

const AVP_REACH =
  'edge/people, "Every account is created by an administrator": the Academic Vice Principal resets passwords and locks accounts only for Teachers, Tutors, Head Teachers and the Head Tutor of his branch';
const OWN_ACCOUNT = `${ACCOUNT_ACCESS} > %s: refuses the own account to both administrators`;
const AVP_REFUSED = `${ACCOUNT_ACCESS} > refuses %s with nothing written`;
const ATTENDANCE_READERS =
  '02, Vice Principal for Spiritual and Moral Education: views attendance; 08, Who sees it: the Head Tutor and the Spiritual Vice Principal for attendance (journal decision 20: attendance only)';
const RELATIVES_TAB = `${RELATIVES} > gives each reader what its group allows (02; decision 5)`;
const PROFILE_TABS = `${STUDENT_RESULTS} > answers each subject only to a reader of its journal, and refuses the readers outside the record`;

export const NARROWER_SCOPES: RouteScopes = {
  // Field groups on the student list and record (edge/people, Personal data).
  'GET /api/people/students': [
    {
      roles: ['spiritual_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: Financial (the consent) for the Super Admin, the Academic VP, the Principal and the Head Tutor only',
      refusedIn: [`${STUDENTS} > answers the Basic group of the branch to every viewer`],
    },
  ],
  'GET /api/people/students/:id': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: Identity "the Principal sees them hidden, with a logged show"',
      refusedIn: [`${STUDENTS} > hides the identity from the Principal, with a show`],
    },
    {
      roles: ['spiritual_vice_principal'],
      scope: 'narrower',
      rule: '02, Spiritual VP: "Overview with the Basic and Contact fields"; no Identity, Financial or diagnostic score',
      refusedIn: [
        `${STUDENTS} > answers Basic and Contact to the Spiritual VP, no birth date, address or score`,
      ],
    },
  ],
  'POST /api/people/students/:id/identity': [
    {
      roles: ['super_admin', 'academic_vice_principal', 'head_tutor', 'spiritual_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: the logged show is the Principal’s; the readers of Identity see it unhidden, the Spiritual VP may not see it',
      refusedIn: [
        `${STUDENTS} > refuses the show to a reader who sees the identity or may not see it`,
      ],
    },
  ],
  'GET /api/people/staff/:id': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: identity fields hidden from the Principal, with a logged show (task 2.2a, decision 9)',
      refusedIn: [`${STAFF} > hides birth date and JSHSHIR from the Principal, with a logged show`],
    },
  ],
  'GET /api/people/students/:id/relatives': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: relatives’ workplaces and emails are Identity, hidden from the Principal',
      refusedIn: [RELATIVES_TAB],
    },
    {
      roles: ['spiritual_vice_principal'],
      scope: 'narrower',
      rule: '02, Spiritual VP: Relatives tab "name, relationship and phones of a relative"',
      refusedIn: [RELATIVES_TAB],
    },
  ],
  'GET /api/people/relatives/:id': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: relatives’ workplaces and emails hidden from the Principal, with a logged show',
      refusedIn: [
        `${RELATIVES} > hides workplace and email from the Principal behind a logged show (decision 5)`,
      ],
    },
  ],
  'POST /api/people/relatives/:id/show': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: the logged show is the Principal’s; a reader who sees the fields is refused it',
      refusedIn: [
        `${RELATIVES} > hides workplace and email from the Principal behind a logged show (decision 5)`,
      ],
    },
  ],

  // Exports: edge/people, "The Principal is view only": "Exports are allowed,
  // without contact and identity fields"; "An export contains only what the role may see".
  'POST /api/people/students/export': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people: the Principal’s exports are "without contact and identity fields", relatives included',
      refusedIn: [
        `${STUDENT_EXPORTS} > leaves Contact and Identity out of the Principal’s file and names them`,
        `${STUDENT_EXPORTS} > leaves the relatives out of the Principal’s file and names them`,
      ],
    },
    {
      roles: ['head_teacher', 'senior_head_teacher'],
      scope: 'narrower',
      rule: '02, Head Teacher: "Full student list across classes and groups; exports it with the Basic fields"',
      refusedIn: [
        `${STUDENT_EXPORTS} > writes Basic columns only for the Head Teachers, without the score, whole branch`,
      ],
    },
  ],
  'POST /api/people/staff/export': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people: the Principal’s exports are "without contact and identity fields" (task 2.2c-1, decision 4)',
      refusedIn: [
        `${STAFF_EXPORTS} > leaves the phone out of the Principal's file, says so, and refuses a file of the phone only`,
      ],
    },
  ],

  // The Spiritual VP's and the Head Tutor's profile tabs: no Results (02).
  'GET /api/results/students/:id': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: '02: the profile of the Spiritual VP and of the Head Tutor has the Attendance tab, no Results tab',
      refusedIn: [PROFILE_TABS],
    },
  ],
  'GET /api/results/students/:id/tabs': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: '02: the profile of the Spiritual VP and of the Head Tutor has the Attendance tab, no Results tab',
      refusedIn: [PROFILE_TABS],
    },
  ],
  'GET /api/results/students/:id/lessons': [
    {
      roles: ['head_tutor', 'spiritual_vice_principal'],
      scope: 'narrower',
      rule: `${ATTENDANCE_READERS}: the marks behind a figure, never the works`,
      refusedIn: [
        `${STUDENT_RESULTS} > opens the lessons behind a figure: the counted lessons with their marks, values and works`,
        'src/modules/results/narrower-refusals.test.ts > answers the Spiritual Vice Principal the marks behind a figure, never the works',
      ],
    },
  ],
  'GET /api/people/students/:id/leaving-results': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: '02: no Results tab for the Spiritual VP and the Head Tutor; 6.2 decision 2: the attendance readers read no result',
      refusedIn: [
        'src/modules/journal/leaving-results.test.ts > answers each subject only to a reader who reads its journal whole, and refuses the readers outside the record',
      ],
    },
  ],

  // Ctrl+K (edge/people, "Search with Ctrl+K finds anyone in any branch").
  'GET /api/search/students': [
    {
      roles: ['principal', 'head_tutor', 'spiritual_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, Ctrl+K: "Search by phone or document number is for the Super Admin and Academic Vice Principal"',
      refusedIn: [
        `${SEARCH} > never compares them for the Principal, a Head Teacher, the Head Tutor or a Tutor`,
      ],
    },
    {
      roles: ['head_tutor', 'spiritual_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, Ctrl+K: "Relatives’ phones are searched too, for the Super Admin, the Principal and the Academic Vice Principal"',
      refusedIn: [
        `${SEARCH} > never finds the child by the relative's phone for another reader of students`,
      ],
    },
  ],
  'GET /api/search/staff': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people, Ctrl+K: "Search by phone or document number is for the Super Admin and Academic Vice Principal"',
      refusedIn: [
        `${SEARCH} > finds by the phone and the JSHSHIR for the Academic Vice Principal and the Super Admin only`,
      ],
    },
  ],

  // Staff records and accounts.
  'PUT /api/people/staff/:id': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, "A teacher changes their own email": phone, email and name by the Academic VP, the email only for the accounts whose passwords he may reset, never of the own record; every other field the Super Admin’s (task 2.2a, decision 2)',
      refusedIn: [
        `${STAFF} > keeps every other field to the Super Admin`,
        `${STAFF_EMAIL} > refuses the Academic Vice Principal on accounts they may not reset, and on their own record`,
        `${STAFF_EMAIL} > is refused across branches: the Academic Vice Principal of another branch, and a person whose role is in another branch`,
      ],
    },
    {
      roles: ['super_admin'],
      scope: 'narrower',
      rule: 'edge/people: "nobody changes the email of their own record"',
      refusedIn: [
        `${STAFF_EMAIL} > refuses a Super Admin on their own record and lets them change another Super Admin`,
      ],
    },
  ],
  'PUT /api/people/staff/:id/branches': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: 'Task 2.2a, decision 2 of pull request #53: the branches of a staff record are the Super Admin’s',
      refusedIn: [`${STAFF} > keeps them to the Super Admin and refuses an unknown branch`],
    },
  ],
  'POST /api/people/staff/:id/status': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: 'Task 2.2a, decision 2 of pull request #53: the status of a staff record is the Super Admin’s',
      refusedIn: [`${STAFF} > is the Super Admin's only`],
    },
    {
      roles: ['super_admin'],
      scope: 'narrower',
      rule: 'edge/people: "The system refuses to lock or remove the last active Super Admin"; not the own record (task 2.2b, correction 5)',
      refusedIn: [
        `${STAFF} > refuses the Super Admin setting their own record to inactive or left`,
        `${STAFF_ACCOUNTS} > refuses to set the record of the last one inactive or left, today or later`,
      ],
    },
  ],
  'POST /api/people/staff/:id/roles/:assignmentId/end': [
    {
      roles: ['super_admin'],
      scope: 'narrower',
      rule: 'edge/people: "nobody can remove their own Super Admin role"; the last active Super Admin is not removed',
      refusedIn: [
        `${STAFF_ACCOUNTS} > refuses the end of one’s own Super Admin role`,
        `${STAFF_ACCOUNTS} > refuses to end the role of the last one`,
        'src/modules/access/narrower-refusals.test.ts > refuses the Super Admin the end of their own Super Admin role while another is active, with nothing written',
      ],
    },
  ],
  'POST /api/people/staff/:id/account/lock': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: AVP_REACH,
      refusedIn: [
        AVP_REFUSED,
        `${ACCOUNT_ACCESS} > refuses a person whose only Teacher role has ended`,
        OWN_ACCOUNT,
      ],
    },
    {
      roles: ['super_admin'],
      scope: 'narrower',
      rule: 'edge/people: "The system refuses to lock or remove the last active Super Admin"; not the own account (task 2.3c-1, decision 11)',
      refusedIn: [
        `${ACCOUNT_ACCESS} > refuses to lock the only active one, and locks one of two`,
        OWN_ACCOUNT,
      ],
    },
  ],
  'POST /api/people/staff/:id/account/unlock': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: `${AVP_REACH}; not a lock of the Super Admin`,
      refusedIn: [
        AVP_REFUSED,
        `${ACCOUNT_ACCESS} > refuses the Academic Vice Principal the undo of a Super Admin’s lock`,
        OWN_ACCOUNT,
      ],
    },
    {
      roles: ['super_admin'],
      scope: 'narrower',
      rule: 'Task 2.3c-1, decision 11: not the own account',
      refusedIn: [OWN_ACCOUNT],
    },
  ],
  'POST /api/people/staff/:id/account/password-reset': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: AVP_REACH,
      refusedIn: [
        AVP_REFUSED,
        `${ACCOUNT_ACCESS} > refuses a person whose only Teacher role has ended`,
        OWN_ACCOUNT,
      ],
    },
    {
      roles: ['super_admin'],
      scope: 'narrower',
      rule: 'Task 2.3c-1, decision 11: not the own account',
      refusedIn: [OWN_ACCOUNT],
    },
  ],
  'POST /api/people/staff/:id/account/second-step-reset': [
    {
      roles: ['academic_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, two-step sign-in: "A Super Admin resets an Academic Vice Principal’s second step; another Super Admin resets a Super Admin’s"',
      refusedIn: [
        `${ACCOUNT_ACCESS} > refuses the Academic Vice Principal always, with nothing written`,
      ],
    },
    {
      roles: ['super_admin'],
      scope: 'narrower',
      rule: 'edge/people: "another Super Admin resets a Super Admin’s" second step, never the own',
      refusedIn: [OWN_ACCOUNT],
    },
  ],

  // The audit log (edge/people, "Who may read the audit log").
  'GET /api/audit/entries': [
    {
      roles: ['principal', 'academic_vice_principal'],
      scope: 'narrower',
      rule: 'edge/people, audit log: the Principal and the Academic VP read their branch; "sign-ins and school-wide settings are read by the Super Admin"',
      refusedIn: [`${AUDIT} > does not show %s to the branch, and shows it to the Super Admin`],
    },
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people, Personal data: Identity hidden from the Principal, in the log too (task 2.6a, decision 6)',
      refusedIn: [
        `${AUDIT} > hides the address and the date of birth of a student entry from the Principal only`,
      ],
    },
  ],
  'POST /api/audit/entries/:id/show': [
    {
      roles: ['principal'],
      scope: 'narrower',
      rule: 'edge/people, audit log: sign-ins and entries of another branch are not the Principal’s',
      refusedIn: [`${AUDIT} > answers 404 to an entry the reader may not read, and logs nothing`],
    },
  ],

  // The journal for the readers of attendance.
  'GET /api/journal/journals/:journalId': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: ATTENDANCE_READERS,
      refusedIn: [
        'src/modules/journal/journals.test.ts > gives the Vice Principal for Spiritual and Moral Education and the Head Tutor attendance only',
        `${RATING_READERS} > shows the readers of attendance no rating exam and no comment but on marks (decision 10)`,
      ],
    },
  ],
  'GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: `${ATTENDANCE_READERS}; no rating exam (decision 10)`,
      refusedIn: [
        `${RATING_READERS} > shows the readers of attendance no rating exam and no comment but on marks (decision 10)`,
      ],
    },
  ],
  'GET /api/journal/comments/history': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: `${ATTENDANCE_READERS}; comments on marks only (decision 10)`,
      refusedIn: [
        `${RATING_READERS} > shows the readers of attendance no rating exam and no comment but on marks (decision 10)`,
      ],
    },
  ],
  'GET /api/journal/lessons/:lessonId/students/:studentId/history': [
    {
      roles: ['head_tutor', 'spiritual_vice_principal'],
      scope: 'narrower',
      rule: `${ATTENDANCE_READERS}: no work lines`,
      refusedIn: [
        'src/modules/journal/narrower-refusals.test.ts > answers the Spiritual Vice Principal the attendance lines of a cell only, no work line',
        'src/modules/journal/journal-works.test.ts > shows the Head Tutor no works, no works "not held", no homework given and no work lines',
        'src/modules/journal/attendance.test.ts > answers the lines of the cells the reader’s grid shows, attendance only for a Head Tutor, and refuses a substitute outside their lesson',
      ],
    },
  ],
  'POST /api/journal/journals/:journalId/export': [
    {
      roles: ['spiritual_vice_principal'],
      scope: 'narrower',
      rule: `${ATTENDANCE_READERS}; an export holds what the role may see (edge/people)`,
      refusedIn: [
        `${JOURNAL_EXPORTS} > writes attendance only for a reader of attendance, and refuses a month outside the quarter, a lesson reader, another branch and an unknown quarter`,
      ],
    },
  ],
  'POST /api/journal/exports': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: 'Task 8.9, decision 3: the export of the whole branch is for the readers of every journal whole (Super Admin, Principal, Academic VP)',
      refusedIn: [
        `${JOURNAL_EXPORTS} > fails a job whose requester lost the role, and is refused to a reader of part of the branch`,
        'src/modules/journal/narrower-refusals.test.ts > refuses the branch export to the Spiritual Vice Principal, a reader of attendance, with nothing written',
      ],
    },
  ],
  'GET /api/journal/exports': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: 'Task 8.9, decision 3: no branch export, and no exports of others, for a reader of part of the branch',
      refusedIn: [
        `${JOURNAL_EXPORTS} > fails a job whose requester lost the role, and is refused to a reader of part of the branch`,
        'src/modules/journal/narrower-refusals.test.ts > refuses the branch export to the Spiritual Vice Principal, a reader of attendance, with nothing written',
      ],
    },
  ],
  'GET /api/journal/discipline': [
    {
      roles: ['head_tutor'],
      scope: 'narrower',
      rule: '02, Head Tutor: "Views all classes, their tutors and attendance by class and by tutor": the lessons of the Tutor subjects',
      refusedIn: [
        'src/modules/journal/lesson-status.test.ts > gives the Head Tutor the lessons of the Tutor subjects only, also of a Tutor who teaches another department',
      ],
    },
  ],

  // Results.
  'GET /api/results/early-warning': [
    {
      roles: ['spiritual_vice_principal', 'head_tutor'],
      scope: 'narrower',
      rule: '08, Early warning, Who sees it: "the Head Tutor and the Vice Principal for Spiritual and Moral Education for attendance"',
      refusedIn: [
        'src/modules/results/early-warning.test.ts > shows each reader their own scope, the attendance reasons only to the Head Tutor and the Spiritual Vice Principal',
      ],
    },
  ],
  'GET /api/results/rating/subject': [
    {
      roles: ['head_tutor'],
      scope: 'narrower',
      rule: '08, Rating: the Head Tutor ranks the students of a class across subjects, not a journal in one subject',
      refusedIn: [
        'src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area',
      ],
    },
  ],
  'GET /api/results/rating/classes': [
    {
      roles: ['head_tutor'],
      scope: 'narrower',
      rule: '08, Rating: the ranking of the classes of the branch is for management',
      refusedIn: [
        'src/modules/results/rating.test.ts > opens each list only to its readers, decided in the route, and refuses the roles outside the area',
      ],
    },
  ],

  'POST /api/results/rating/export': [
    {
      roles: ['head_tutor'],
      scope: 'narrower',
      rule: '08, Rating: the Head Tutor ranks the students of a class, not a journal in one subject nor the classes of the branch; an export holds only what the role may see (edge/people)',
      refusedIn: [
        'src/modules/results/narrower-refusals.test.ts > refuses the Head Tutor the export of a subject list and of the classes list, with nothing logged',
      ],
    },
  ],

  // Timetable views: 06 and the table of views.service.ts (task 5.9a).
  'GET /api/timetable/views/teacher': [
    {
      roles: ['head_tutor'],
      scope: 'narrower',
      rule: '02, Head Tutor: "Sees the school timetable and the timetable of every class of the branch"; no other teacher (task 5.9a)',
      refusedIn: [
        'src/modules/timetable/views.test.ts > gives the Head Tutor the school and every class, no teacher and no room',
      ],
    },
  ],
  'GET /api/timetable/views/room': [
    {
      roles: ['head_tutor'],
      scope: 'narrower',
      rule: '02, Head Tutor: the school and every class; no room (task 5.9a)',
      refusedIn: [
        'src/modules/timetable/views.test.ts > gives the Head Tutor the school and every class, no teacher and no room',
      ],
    },
  ],
  'POST /api/timetable/views/export': [
    {
      roles: ['head_tutor'],
      scope: 'narrower',
      rule: '02, Head Tutor: the school and every class; no room, no other teacher (task 5.9a)',
      refusedIn: [
        'src/modules/timetable/views-export.test.ts > lets the Head Tutor print the school and every class, no room and no other teacher',
      ],
    },
  ],
};
