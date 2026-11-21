// Written by `pnpm api:client` from openapi.generated.json (src/openapi/assistant-tools.ts).
// Do not edit: `assistant-tools.test.ts` fails when this is not what it writes.
import type { GeneratedTool } from './tools.js';

export const GENERATED_TOOLS: Readonly<Record<string, GeneratedTool>> = {
  'GET /api/access/branches-without-vice-principal': {
    name: 'StaffAccountsController_branchesWithoutVice',
    method: 'GET',
    path: '/api/access/branches-without-vice-principal',
    parameters: [],
  },
  'GET /api/access/head-teachers': {
    name: 'HeadTeachersController_list',
    method: 'GET',
    path: '/api/access/head-teachers',
    parameters: [],
  },
  'GET /api/announcements': {
    name: 'AnnouncementsController_list',
    method: 'GET',
    path: '/api/announcements',
    parameters: [
      {
        name: 'archived',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['true', 'false'],
        },
      },
    ],
  },
  'GET /api/classes': {
    name: 'ClassesController_list',
    method: 'GET',
    path: '/api/classes',
    parameters: [],
  },
  'GET /api/classes/:id': {
    name: 'ClassesController_detail',
    method: 'GET',
    path: '/api/classes/:id',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/classes/:id/members': {
    name: 'ClassesController_membersOf',
    method: 'GET',
    path: '/api/classes/:id/members',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/groups': {
    name: 'GroupsController_list',
    method: 'GET',
    path: '/api/groups',
    parameters: [],
  },
  'GET /api/groups/:id': {
    name: 'GroupsController_detail',
    method: 'GET',
    path: '/api/groups/:id',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/groups/:id/members': {
    name: 'GroupsController_groupMembers',
    method: 'GET',
    path: '/api/groups/:id/members',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/journal/attendance-today': {
    name: 'AttendanceTodayController_read',
    method: 'GET',
    path: '/api/journal/attendance-today',
    parameters: [],
  },
  'GET /api/journal/discipline': {
    name: 'LessonStatusController_discipline',
    method: 'GET',
    path: '/api/journal/discipline',
    parameters: [
      {
        name: 'from',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'to',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'departmentId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/journal/journals': {
    name: 'JournalsController_list',
    method: 'GET',
    path: '/api/journal/journals',
    parameters: [
      {
        name: 'yearId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/journal/journals/:journalId': {
    name: 'JournalsController_grid',
    method: 'GET',
    path: '/api/journal/journals/:journalId',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'journalId',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/journal/lessons-today': {
    name: 'LessonStatusController_lessonsToday',
    method: 'GET',
    path: '/api/journal/lessons-today',
    parameters: [],
  },
  'GET /api/journal/unlocks': {
    name: 'UnlocksController_list',
    method: 'GET',
    path: '/api/journal/unlocks',
    parameters: [
      {
        name: 'view',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['deciding', 'own', 'branch'],
        },
      },
    ],
  },
  'GET /api/people/staff': {
    name: 'StaffController_list',
    method: 'GET',
    path: '/api/people/staff',
    parameters: [],
  },
  'GET /api/people/staff/:id': {
    name: 'StaffController_detail',
    method: 'GET',
    path: '/api/people/staff/:id',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/people/staff/:id/availability': {
    name: 'AvailabilityController_read',
    method: 'GET',
    path: '/api/people/staff/:id/availability',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/people/students': {
    name: 'StudentsController_list',
    method: 'GET',
    path: '/api/people/students',
    parameters: [
      {
        name: 'consent',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['missing'],
        },
      },
    ],
  },
  'GET /api/people/students/:id': {
    name: 'StudentsController_detail',
    method: 'GET',
    path: '/api/people/students/:id',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/people/students/no-class': {
    name: 'StudentsController_noClass',
    method: 'GET',
    path: '/api/people/students/no-class',
    parameters: [],
  },
  'GET /api/people/vacancies': {
    name: 'VacanciesController_list',
    method: 'GET',
    path: '/api/people/vacancies',
    parameters: [],
  },
  'GET /api/people/vacancies/:id': {
    name: 'VacanciesController_detail',
    method: 'GET',
    path: '/api/people/vacancies/:id',
    parameters: [
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/plans': {
    name: 'PlansController_list',
    method: 'GET',
    path: '/api/plans',
    parameters: [
      {
        name: 'yearId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/plans/reports/completeness': {
    name: 'PlanReportsController_completeness',
    method: 'GET',
    path: '/api/plans/reports/completeness',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'departmentId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'teacherId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/plans/reports/progress': {
    name: 'PlanReportsController_progress',
    method: 'GET',
    path: '/api/plans/reports/progress',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'departmentId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'teacherId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/plans/requests': {
    name: 'PlanRequestsController_list',
    method: 'GET',
    path: '/api/plans/requests',
    parameters: [
      {
        name: 'view',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['mine', 'deciding'],
        },
      },
      {
        name: 'yearId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/plans/windows': {
    name: 'PlanWindowsController_list',
    method: 'GET',
    path: '/api/plans/windows',
    parameters: [
      {
        name: 'yearId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/branch-summary': {
    name: 'BranchSummaryController_read',
    method: 'GET',
    path: '/api/results/branch-summary',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/early-warning': {
    name: 'EarlyWarningController_list',
    method: 'GET',
    path: '/api/results/early-warning',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'for',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['own_journals'],
        },
      },
      {
        name: 'classId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/rating/choices': {
    name: 'RatingController_choices',
    method: 'GET',
    path: '/api/results/rating/choices',
    parameters: [
      {
        name: 'yearId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/rating/class': {
    name: 'RatingController_classRating',
    method: 'GET',
    path: '/api/results/rating/class',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'classId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/rating/classes': {
    name: 'RatingController_classes',
    method: 'GET',
    path: '/api/results/rating/classes',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'grade',
        in: 'query',
        required: false,
        schema: {
          anyOf: [
            {
              type: 'integer',
              minimum: 0,
              maximum: 11,
            },
            {
              type: 'string',
              pattern: '^(?:[0-9]|1[01])$',
            },
          ],
        },
      },
      {
        name: 'language',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          enum: ['uz', 'ru'],
        },
      },
    ],
  },
  'GET /api/results/rating/subject': {
    name: 'RatingController_subject',
    method: 'GET',
    path: '/api/results/rating/subject',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'journalId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/reports/attendance': {
    name: 'ResultsReportsController_attendance',
    method: 'GET',
    path: '/api/results/reports/attendance',
    parameters: [
      {
        name: 'from',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'to',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'grade',
        in: 'query',
        required: false,
        schema: {
          anyOf: [
            {
              type: 'integer',
              minimum: 0,
              maximum: 11,
            },
            {
              type: 'string',
              pattern: '^(?:[0-9]|1[01])$',
            },
          ],
        },
      },
      {
        name: 'classId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'subjectId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'teacherId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'start',
        in: 'query',
        required: false,
        schema: {
          type: 'integer',
          minimum: 0,
          maximum: 1439,
        },
      },
      {
        name: 'groupBy',
        in: 'query',
        required: false,
        schema: {
          default: 'class',
          type: 'string',
          enum: ['class', 'tutor'],
        },
      },
    ],
  },
  'GET /api/results/reports/choices': {
    name: 'ResultsReportsController_choices',
    method: 'GET',
    path: '/api/results/reports/choices',
    parameters: [
      {
        name: 'yearId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/reports/results-table': {
    name: 'ResultsReportsController_table',
    method: 'GET',
    path: '/api/results/reports/results-table',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'classId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/reports/subject-mastery': {
    name: 'ResultsReportsController_mastery',
    method: 'GET',
    path: '/api/results/reports/subject-mastery',
    parameters: [
      {
        name: 'quarterId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'subjectId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'grade',
        in: 'query',
        required: false,
        schema: {
          anyOf: [
            {
              type: 'integer',
              minimum: 0,
              maximum: 11,
            },
            {
              type: 'string',
              pattern: '^(?:[0-9]|1[01])$',
            },
          ],
        },
      },
      {
        name: 'classId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'teacherId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/results/students/:id': {
    name: 'StudentResultsController_read',
    method: 'GET',
    path: '/api/results/students/:id',
    parameters: [
      {
        name: 'yearId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/search/classes': {
    name: 'ClassesSearchController_findClasses',
    method: 'GET',
    path: '/api/search/classes',
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
        },
      },
    ],
  },
  'GET /api/search/groups': {
    name: 'ClassesSearchController_findGroups',
    method: 'GET',
    path: '/api/search/groups',
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
        },
      },
    ],
  },
  'GET /api/search/staff': {
    name: 'PeopleSearchController_findStaff',
    method: 'GET',
    path: '/api/search/staff',
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
        },
      },
    ],
  },
  'GET /api/search/students': {
    name: 'PeopleSearchController_findStudents',
    method: 'GET',
    path: '/api/search/students',
    parameters: [
      {
        name: 'q',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          minLength: 1,
          maxLength: 100,
        },
      },
    ],
  },
  'GET /api/setup/academic-years': {
    name: 'AcademicYearsController_list',
    method: 'GET',
    path: '/api/setup/academic-years',
    parameters: [],
  },
  'GET /api/setup/branch': {
    name: 'BranchesController_read',
    method: 'GET',
    path: '/api/setup/branch',
    parameters: [],
  },
  'GET /api/setup/branches': {
    name: 'BranchesController_list',
    method: 'GET',
    path: '/api/setup/branches',
    parameters: [],
  },
  'GET /api/setup/buildings': {
    name: 'BuildingsController_list',
    method: 'GET',
    path: '/api/setup/buildings',
    parameters: [],
  },
  'GET /api/setup/calendar-day': {
    name: 'CalendarController_day',
    method: 'GET',
    path: '/api/setup/calendar-day',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
    ],
  },
  'GET /api/setup/calendar-entries': {
    name: 'CalendarController_list',
    method: 'GET',
    path: '/api/setup/calendar-entries',
    parameters: [],
  },
  'GET /api/setup/checklist': {
    name: 'SettingsController_checklist',
    method: 'GET',
    path: '/api/setup/checklist',
    parameters: [],
  },
  'GET /api/setup/current-period': {
    name: 'AcademicYearsController_currentPeriod',
    method: 'GET',
    path: '/api/setup/current-period',
    parameters: [],
  },
  'GET /api/setup/day-template-assignments': {
    name: 'DayTemplatesController_listAssignments',
    method: 'GET',
    path: '/api/setup/day-template-assignments',
    parameters: [],
  },
  'GET /api/setup/day-templates': {
    name: 'DayTemplatesController_listTemplates',
    method: 'GET',
    path: '/api/setup/day-templates',
    parameters: [],
  },
  'GET /api/setup/divisions': {
    name: 'DivisionsController_list',
    method: 'GET',
    path: '/api/setup/divisions',
    parameters: [],
  },
  'GET /api/setup/rooms': {
    name: 'RoomsController_list',
    method: 'GET',
    path: '/api/setup/rooms',
    parameters: [],
  },
  'GET /api/setup/settings': {
    name: 'SettingsController_read',
    method: 'GET',
    path: '/api/setup/settings',
    parameters: [],
  },
  'GET /api/setup/slot-types': {
    name: 'DayTemplatesController_listSlotTypes',
    method: 'GET',
    path: '/api/setup/slot-types',
    parameters: [],
  },
  'GET /api/setup/subjects': {
    name: 'SubjectsController_list',
    method: 'GET',
    path: '/api/setup/subjects',
    parameters: [],
  },
  'GET /api/setup/subjects/:id/quarter-weights': {
    name: 'SubjectsController_quarterWeights',
    method: 'GET',
    path: '/api/setup/subjects/:id/quarter-weights',
    parameters: [
      {
        name: 'yearId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
      {
        name: 'id',
        in: 'path',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/setup/travel-times': {
    name: 'TravelTimesController_list',
    method: 'GET',
    path: '/api/setup/travel-times',
    parameters: [],
  },
  'GET /api/timetable/absences': {
    name: 'AbsencesController_list',
    method: 'GET',
    path: '/api/timetable/absences',
    parameters: [
      {
        name: 'state',
        in: 'query',
        required: false,
        schema: {
          default: 'open',
          type: 'string',
          enum: ['open', 'all'],
        },
      },
    ],
  },
  'GET /api/timetable/attention': {
    name: 'AbsencesController_attention',
    method: 'GET',
    path: '/api/timetable/attention',
    parameters: [],
  },
  'GET /api/timetable/conflicts-summary': {
    name: 'TimetableController_conflictsSummary',
    method: 'GET',
    path: '/api/timetable/conflicts-summary',
    parameters: [],
  },
  'GET /api/timetable/day': {
    name: 'DayChangesController_day',
    method: 'GET',
    path: '/api/timetable/day',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'classId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/timetable/exams': {
    name: 'ExamsController_list',
    method: 'GET',
    path: '/api/timetable/exams',
    parameters: [
      {
        name: 'from',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'to',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
    ],
  },
  'GET /api/timetable/reports/load': {
    name: 'LoadReportController_load',
    method: 'GET',
    path: '/api/timetable/reports/load',
    parameters: [
      {
        name: 'week',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'departmentId',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/timetable/room-closures': {
    name: 'RoomClosuresController_list',
    method: 'GET',
    path: '/api/timetable/room-closures',
    parameters: [
      {
        name: 'state',
        in: 'query',
        required: false,
        schema: {
          default: 'open',
          type: 'string',
          enum: ['open', 'all'],
        },
      },
    ],
  },
  'GET /api/timetable/versions': {
    name: 'TimetableController_list',
    method: 'GET',
    path: '/api/timetable/versions',
    parameters: [],
  },
  'GET /api/timetable/views/branch': {
    name: 'TimetableViewsController_branch',
    method: 'GET',
    path: '/api/timetable/views/branch',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'span',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['day', 'week'],
        },
      },
    ],
  },
  'GET /api/timetable/views/choices': {
    name: 'TimetableViewsController_choices',
    method: 'GET',
    path: '/api/timetable/views/choices',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: false,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
    ],
  },
  'GET /api/timetable/views/class': {
    name: 'TimetableViewsController_class',
    method: 'GET',
    path: '/api/timetable/views/class',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'span',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['day', 'week'],
        },
      },
      {
        name: 'classId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/timetable/views/room': {
    name: 'TimetableViewsController_room',
    method: 'GET',
    path: '/api/timetable/views/room',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'span',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['day', 'week'],
        },
      },
      {
        name: 'roomId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
  'GET /api/timetable/views/teacher': {
    name: 'TimetableViewsController_teacher',
    method: 'GET',
    path: '/api/timetable/views/teacher',
    parameters: [
      {
        name: 'date',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'date',
          pattern:
            '^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$',
        },
      },
      {
        name: 'span',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          enum: ['day', 'week'],
        },
      },
      {
        name: 'staffId',
        in: 'query',
        required: true,
        schema: {
          type: 'string',
          format: 'uuid',
          pattern:
            '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$',
        },
      },
    ],
  },
};
