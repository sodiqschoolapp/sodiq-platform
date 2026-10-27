import type { RouteScopes, ScopeLine } from '../route-scope-check.js';

// The tests that prove the limits of the plan routes (task 10.3a).
const P = 'src/modules/plans/plans.test.ts';
const READ = `${P} > lets the readers of edge/lesson-plans read a plan, and only its owner edit it`;
const WRITE = `${P} > refuses a write from everyone but the owner, leaving every row and the audit log`;
const FILES = `${P} > adds, reads and removes files within the limits`;
const LESSON = `src/modules/plans/plan-follow.test.ts > lets every reader of the plan read it (edge/lesson-plans, "Who may read a plan?") and refuses the others`;
const D = 'src/modules/plans/plan-delivery.test.ts';
const EXPORT_TEACHER = `${D} > exports a plan with its marks, and refuses a teacher who does not read it`;
const EXPORT_HEAD = `${D} > answers 404 for the plan file of another branch’s journal or quarter and unknown ids, and refuses a Head Teacher of another subject`;
const REPORTS = `${D} > gives a Head Teacher who also teaches another subject the plans of the own subject only, counting the other, in every report and the file; a Senior Head Teacher the same`;
const R = 'src/modules/plans/plan-requests.test.ts';
const OWNER_ROUTES = `${R} > refuses a teacher who reads the plan by the profile every owner's route: ask, send, send prepared, finish, queue`;
const REQUEST_LIST = `${R} > shows the requests to those who decide or oversee them, the Principal read only, and to nobody else`;
const DECIDE_HEAD = `${R} > refuses the Head Teacher of another subject, and lets a new Head Teacher of the subject decide what waited for the earlier one`;
const O = 'src/modules/plans/plan-outcomes.test.ts';
const OUTCOMES = `${O} > refuses a reader who does not own the plan the merge, the carry and the place (plan_scope), changing nothing`;
const DROP = `${O} > lets the Head Teacher of the subject drop with a reason; the owner, another Head Teacher and a Teacher are refused`;
const M = 'src/modules/plans/plan-masters.test.ts';
const MASTER_READ = `${M} > lets every reader of plans read the masters, and a teacher only those of the subject and grade in the profile`;
const MASTER_WRITE = `${M} > refuses the writes of a master to every role but its keepers, and changes nothing`;
const MASTER_ALL = `${M} > is kept by the Senior Head Teacher, read and copied in every branch, and refused to the others who keep branch masters`;
const MASTER_TAKE = `${M} > refuses take and keep to anyone but the owner, the comparison and the parallel classes to another subject, and the list shows another subject nothing (permission review, must-fixes 3 and 4)`;
const PARALLEL = `${M} > shows each class of the grade with the item it has reached, and a group of two grades under both (09, Parallel classes)`;
const S = 'src/modules/plans/scope-refusals.test.ts';
const S_READS = `${S} > refuses a Head Teacher and a Senior Head Teacher of another subject the plan list, the item of a lesson, a plan file and the plan export, logging nothing`;
const S_REPORTS = `${S} > gives a Head Teacher and a Senior Head Teacher of another subject who read the plan by the profile none of its progress, its requests or its report files`;
const S_REQUESTS = `${S} > shows a teacher who does not own the plan none of its requests under "mine", and a Senior Head Teacher of another subject none under "deciding"`;
const S_DECISIONS = `${S} > refuses a Head Teacher and a Senior Head Teacher of another subject the decision of a request, of the prepared request, by event and the drop of a not-covered item, changing nothing`;
const S_MASTERS = `${S} > refuses a Head Teacher and a Senior Head Teacher of another subject a master, the masters list, a new master of the subject, the comparison and the parallel classes`;

const TEACHER_READS =
  'edge/lesson-plans, "Who may read a plan?": the owner; teachers with the same subject and grade in their profile (plan-scope.ts)';
const TEACHER_WRITES = 'edge/lesson-plans, "Who may read a plan?": "Only the owner edits"';
const HEAD_READS =
  '02, Head Teacher: "Views journals and lesson plans of those subjects"; Senior Head Teacher: the same for own subjects in every branch';
const HEAD_REPORTS = 'Task 8.8, decision 1: the plan reports of own subjects, the rest counted';
const HEAD_DECIDES =
  '02, Head Teacher: "Approves ... requests to edit a lesson plan after the window, for those subjects"; "Who approves"';
const HEAD_MASTERS =
  '09, Master plans: "A Head Teacher can keep a master plan for one of their subjects"; "A Senior Head Teacher can keep one master for all branches"';
const MASTER_READERS =
  'Task 7.3, decision 2: the masters are read as plans are (whole-branch roles, the Head Teachers of the subject, the profile)';

const line = (
  roles: ScopeLine['roles'],
  scope: ScopeLine['scope'],
  rule: string,
  refusedIn: readonly string[],
): ScopeLine => ({ roles, scope, rule, refusedIn });

const teacherWrites = (refusedIn: string): ScopeLine[] => [
  line(['teacher'], 'own_lessons', TEACHER_WRITES, [refusedIn]),
];

export const PLANS_SCOPES: RouteScopes = {
  'GET /api/plans': [
    line(['teacher'], 'own_lessons', TEACHER_READS, [READ]),
    line(['head_teacher'], 'subjects', HEAD_READS, [READ, S_READS]),
    line(['senior_head_teacher'], 'subjects', HEAD_READS, [S_READS]),
  ],
  'GET /api/plans/journals/:journalId': [
    line(['teacher'], 'own_lessons', TEACHER_READS, [READ]),
    line(['head_teacher', 'senior_head_teacher'], 'subjects', HEAD_READS, [READ]),
  ],
  'GET /api/plans/lessons/:lessonId': [
    line(
      ['teacher'],
      'own_lessons',
      `${TEACHER_READS}; 09: the substitute sees the item of that lesson`,
      [LESSON],
    ),
    line(['head_teacher'], 'subjects', HEAD_READS, [LESSON, S_READS]),
    line(['senior_head_teacher'], 'subjects', HEAD_READS, [S_READS]),
  ],
  'POST /api/plans/journals/:journalId/export': [
    line(['teacher'], 'own_lessons', `${TEACHER_READS}; edge: "Plans export to PDF and Excel"`, [
      EXPORT_TEACHER,
    ]),
    line(['head_teacher'], 'subjects', HEAD_READS, [EXPORT_HEAD, S_READS]),
    line(['senior_head_teacher'], 'subjects', HEAD_READS, [S_READS]),
  ],
  'GET /api/plans/reports/completeness': [
    line(['head_teacher', 'senior_head_teacher'], 'subjects', HEAD_REPORTS, [REPORTS]),
  ],
  'GET /api/plans/reports/progress': [
    line(['head_teacher'], 'subjects', HEAD_REPORTS, [REPORTS, S_REPORTS]),
    line(['senior_head_teacher'], 'subjects', HEAD_REPORTS, [S_REPORTS]),
  ],
  'GET /api/plans/reports/requests': [
    line(['head_teacher', 'senior_head_teacher'], 'subjects', HEAD_REPORTS, [S_REPORTS]),
  ],
  'POST /api/plans/reports/export': [
    line(['head_teacher'], 'subjects', HEAD_REPORTS, [REPORTS, S_REPORTS]),
    line(['senior_head_teacher'], 'subjects', HEAD_REPORTS, [S_REPORTS]),
  ],
  'GET /api/plans/minimums': [
    line(
      ['senior_head_teacher', 'head_teacher', 'teacher'],
      'branch',
      'edge/lesson-plans: "Each subject can have a minimum number of classworks and homeworks per quarter"; task 8.8, decision 11 (a setting of subjects, read by the readers of plans)',
      [],
    ),
  ],
  'POST /api/plans/journals/:journalId/items': teacherWrites(WRITE),
  'POST /api/plans/journals/:journalId/share': teacherWrites(WRITE),
  'POST /api/plans/journals/:journalId/separate': teacherWrites(WRITE),
  'POST /api/plans/journals/:journalId/copy': teacherWrites(WRITE),
  'PUT /api/plans/items/:itemId': teacherWrites(WRITE),
  'POST /api/plans/items/:itemId/clear': teacherWrites(WRITE),
  'PUT /api/plans/items/:itemId/files': teacherWrites(WRITE),
  'DELETE /api/plans/files/:fileId': teacherWrites(WRITE),
  'GET /api/plans/files/:fileId': [
    line(['teacher'], 'own_lessons', TEACHER_READS, [FILES]),
    line(['head_teacher', 'senior_head_teacher'], 'subjects', HEAD_READS, [S_READS]),
  ],
  'PUT /api/plans/journals/:journalId/queue': teacherWrites(OWNER_ROUTES),
  'POST /api/plans/journals/:journalId/not-covered/:itemId/merge': teacherWrites(OUTCOMES),
  'POST /api/plans/journals/:journalId/not-covered/:itemId/carry': teacherWrites(OUTCOMES),
  'POST /api/plans/journals/:journalId/not-covered/:itemId/drop': [
    line(['head_teacher'], 'subjects', HEAD_DECIDES, [DROP, S_DECISIONS]),
    line(['senior_head_teacher'], 'subjects', HEAD_DECIDES, [S_DECISIONS]),
  ],
  'POST /api/plans/journals/:journalId/carried/:itemId/place': teacherWrites(OUTCOMES),
  'GET /api/plans/windows': [
    line(
      ['senior_head_teacher', 'head_teacher', 'teacher'],
      'own_record',
      'edge/lesson-plans: "There is one window per quarter and branch"; 09: the Academic Vice Principal "can extend the window for one teacher, for example after illness"; decided in task 10.3a (pull request #241): an extension is shown to that teacher and the whole-branch readers only',
      [
        'src/modules/plans/scope-refusals.test.ts > shows an extension of the window to its teacher and the whole-branch readers only',
      ],
    ),
  ],
  'GET /api/plans/requests': [
    line(
      ['teacher'],
      'own_requests',
      '02, "Own requests"; task 7.2 build decision: the requests of a plan are shown to its owner',
      [REQUEST_LIST, S_REQUESTS],
    ),
    line(['head_teacher'], 'subjects', `${HEAD_DECIDES}; "sees it too"`, [REQUEST_LIST]),
    line(['senior_head_teacher'], 'subjects', `${HEAD_DECIDES}; "sees it too"`, [S_REQUESTS]),
  ],
  'POST /api/plans/journals/:journalId/requests': teacherWrites(OWNER_ROUTES),
  'POST /api/plans/journals/:journalId/requests/prepared': teacherWrites(OWNER_ROUTES),
  'POST /api/plans/journals/:journalId/requests/prepared/decide': [
    line(['head_teacher', 'senior_head_teacher'], 'subjects', HEAD_DECIDES, [S_DECISIONS]),
  ],
  'POST /api/plans/requests/:requestId/send': [
    line(['teacher'], 'own_requests', '09: "The teacher only sends it" (the owner of the plan)', [
      OWNER_ROUTES,
    ]),
  ],
  'POST /api/plans/requests/:requestId/decide': [
    line(['head_teacher'], 'subjects', HEAD_DECIDES, [DECIDE_HEAD, S_DECISIONS]),
    line(['senior_head_teacher'], 'subjects', HEAD_DECIDES, [S_DECISIONS]),
  ],
  'POST /api/plans/requests/decide-event': [
    line(
      ['head_teacher', 'senior_head_teacher'],
      'subjects',
      `${HEAD_DECIDES}; 09, Approving together (others counted, never named)`,
      [S_DECISIONS],
    ),
  ],
  'POST /api/plans/requests/:requestId/finish': [
    line(
      ['teacher'],
      'own_requests',
      'edge/lesson-plans: "The teacher can press \\"finished\\" to lock early" (the owner of the plan)',
      [OWNER_ROUTES],
    ),
  ],
  'GET /api/plans/masters': [
    line(['teacher'], 'own_lessons', MASTER_READERS, [MASTER_READ]),
    line(['head_teacher'], 'subjects', MASTER_READERS, [MASTER_TAKE, S_MASTERS]),
    line(['senior_head_teacher'], 'subjects', MASTER_READERS, [S_MASTERS]),
  ],
  'POST /api/plans/masters': [
    line(['head_teacher'], 'subjects', HEAD_MASTERS, [MASTER_WRITE, S_MASTERS]),
    line(['senior_head_teacher'], 'subjects', HEAD_MASTERS, [S_MASTERS]),
  ],
  'GET /api/plans/masters/:masterId': [
    line(['teacher'], 'own_lessons', MASTER_READERS, [MASTER_READ]),
    line(['head_teacher', 'senior_head_teacher'], 'subjects', MASTER_READERS, [S_MASTERS]),
  ],
  ...Object.fromEntries(
    [
      'PATCH /api/plans/masters/:masterId',
      'POST /api/plans/masters/:masterId/archive',
      'POST /api/plans/masters/:masterId/restore',
      'POST /api/plans/masters/:masterId/items',
      'PUT /api/plans/masters/:masterId/items/:itemId',
      'POST /api/plans/masters/:masterId/items/:itemId/remove',
      'PUT /api/plans/masters/:masterId/order',
    ].map((route) => [
      route,
      [
        line(['head_teacher'], 'subjects', HEAD_MASTERS, [MASTER_WRITE]),
        line(['senior_head_teacher'], 'subjects', HEAD_MASTERS, [MASTER_ALL]),
      ],
    ]),
  ),
  'GET /api/plans/journals/:journalId/master-compare': [
    line(['teacher'], 'own_lessons', TEACHER_READS, [MASTER_TAKE]),
    line(['head_teacher'], 'subjects', HEAD_READS, [MASTER_TAKE, S_MASTERS]),
    line(['senior_head_teacher'], 'subjects', HEAD_READS, [S_MASTERS]),
  ],
  'POST /api/plans/journals/:journalId/master-take': teacherWrites(MASTER_TAKE),
  'POST /api/plans/journals/:journalId/master-keep': teacherWrites(MASTER_TAKE),
  'GET /api/plans/parallel': [
    line(
      ['teacher'],
      'own_lessons',
      '09, Master plans: "The Head Teacher sees all classes of a grade side by side"; task 7.3, decision 13: a Teacher reads no parallel classes',
      [PARALLEL],
    ),
    line(
      ['head_teacher'],
      'subjects',
      '09, "Parallel classes": the Head Teacher, of own subjects',
      [MASTER_TAKE, S_MASTERS],
    ),
    line(
      ['senior_head_teacher'],
      'subjects',
      '09, "Parallel classes": the Head Teacher, of own subjects',
      [S_MASTERS],
    ),
  ],
};
