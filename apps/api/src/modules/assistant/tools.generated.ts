// Written by `pnpm api:client` from openapi.generated.json (src/openapi/assistant-tools.ts).
// Do not edit: `assistant-tools.test.ts` fails when this is not what it writes.
import type { GeneratedTool } from './tools.js';

export const GENERATED_TOOLS: Readonly<Record<string, GeneratedTool>> = {
  "DELETE /api/timetable/versions/:id/load/:rowId": {
    "name": "TimetableController_deleteRow",
    "method": "DELETE",
    "path": "/api/timetable/versions/:id/load/:rowId",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "rowId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/access/head-teachers": {
    "name": "HeadTeachersController_list",
    "method": "GET",
    "path": "/api/access/head-teachers",
    "parameters": []
  },
  "GET /api/announcements": {
    "name": "AnnouncementsController_list",
    "method": "GET",
    "path": "/api/announcements",
    "parameters": [
      {
        "name": "archived",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "true",
            "false"
          ]
        }
      }
    ]
  },
  "GET /api/classes": {
    "name": "ClassesController_list",
    "method": "GET",
    "path": "/api/classes",
    "parameters": []
  },
  "GET /api/classes/:id": {
    "name": "ClassesController_detail",
    "method": "GET",
    "path": "/api/classes/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/classes/:id/members": {
    "name": "ClassesController_membersOf",
    "method": "GET",
    "path": "/api/classes/:id/members",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/groups": {
    "name": "GroupsController_list",
    "method": "GET",
    "path": "/api/groups",
    "parameters": []
  },
  "GET /api/groups/:id": {
    "name": "GroupsController_detail",
    "method": "GET",
    "path": "/api/groups/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/groups/:id/members": {
    "name": "GroupsController_groupMembers",
    "method": "GET",
    "path": "/api/groups/:id/members",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/journal/attendance-today": {
    "name": "AttendanceTodayController_read",
    "method": "GET",
    "path": "/api/journal/attendance-today",
    "parameters": []
  },
  "GET /api/journal/discipline": {
    "name": "LessonStatusController_discipline",
    "method": "GET",
    "path": "/api/journal/discipline",
    "parameters": [
      {
        "name": "from",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "to",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "departmentId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/journal/journals": {
    "name": "JournalsController_list",
    "method": "GET",
    "path": "/api/journal/journals",
    "parameters": [
      {
        "name": "yearId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/journal/journals/:journalId": {
    "name": "JournalsController_grid",
    "method": "GET",
    "path": "/api/journal/journals/:journalId",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "journalId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/journal/lessons-today": {
    "name": "LessonStatusController_lessonsToday",
    "method": "GET",
    "path": "/api/journal/lessons-today",
    "parameters": []
  },
  "GET /api/journal/lessons/:lessonId/card": {
    "name": "LessonCardController_card",
    "method": "GET",
    "path": "/api/journal/lessons/:lessonId/card",
    "parameters": [
      {
        "name": "lessonId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/journal/reminders": {
    "name": "LessonStatusController_reminders",
    "method": "GET",
    "path": "/api/journal/reminders",
    "parameters": []
  },
  "GET /api/journal/unlocks": {
    "name": "UnlocksController_list",
    "method": "GET",
    "path": "/api/journal/unlocks",
    "parameters": [
      {
        "name": "view",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "deciding",
            "own",
            "branch"
          ]
        }
      }
    ]
  },
  "GET /api/people/staff": {
    "name": "StaffController_list",
    "method": "GET",
    "path": "/api/people/staff",
    "parameters": []
  },
  "GET /api/people/staff/:id": {
    "name": "StaffController_detail",
    "method": "GET",
    "path": "/api/people/staff/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/people/staff/:id/availability": {
    "name": "AvailabilityController_read",
    "method": "GET",
    "path": "/api/people/staff/:id/availability",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/people/students": {
    "name": "StudentsController_list",
    "method": "GET",
    "path": "/api/people/students",
    "parameters": [
      {
        "name": "consent",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "missing"
          ]
        }
      }
    ]
  },
  "GET /api/people/students/:id": {
    "name": "StudentsController_detail",
    "method": "GET",
    "path": "/api/people/students/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/people/students/:id/relatives": {
    "name": "RelativesController_ofStudent",
    "method": "GET",
    "path": "/api/people/students/:id/relatives",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/people/students/no-class": {
    "name": "StudentsController_noClass",
    "method": "GET",
    "path": "/api/people/students/no-class",
    "parameters": []
  },
  "GET /api/people/vacancies": {
    "name": "VacanciesController_list",
    "method": "GET",
    "path": "/api/people/vacancies",
    "parameters": []
  },
  "GET /api/people/vacancies/:id": {
    "name": "VacanciesController_detail",
    "method": "GET",
    "path": "/api/people/vacancies/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans": {
    "name": "PlansController_list",
    "method": "GET",
    "path": "/api/plans",
    "parameters": [
      {
        "name": "yearId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans/journals/:journalId": {
    "name": "PlansController_plan",
    "method": "GET",
    "path": "/api/plans/journals/:journalId",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "journalId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans/journals/:journalId/master-compare": {
    "name": "PlanMastersController_compare",
    "method": "GET",
    "path": "/api/plans/journals/:journalId/master-compare",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "journalId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans/lessons/:lessonId": {
    "name": "PlansController_lessonItem",
    "method": "GET",
    "path": "/api/plans/lessons/:lessonId",
    "parameters": [
      {
        "name": "lessonId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans/reports/completeness": {
    "name": "PlanReportsController_completeness",
    "method": "GET",
    "path": "/api/plans/reports/completeness",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "departmentId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "teacherId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans/reports/progress": {
    "name": "PlanReportsController_progress",
    "method": "GET",
    "path": "/api/plans/reports/progress",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "departmentId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "teacherId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans/requests": {
    "name": "PlanRequestsController_list",
    "method": "GET",
    "path": "/api/plans/requests",
    "parameters": [
      {
        "name": "view",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "mine",
            "deciding"
          ]
        }
      },
      {
        "name": "yearId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/plans/windows": {
    "name": "PlanWindowsController_list",
    "method": "GET",
    "path": "/api/plans/windows",
    "parameters": [
      {
        "name": "yearId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/branch-summary": {
    "name": "BranchSummaryController_read",
    "method": "GET",
    "path": "/api/results/branch-summary",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/early-warning": {
    "name": "EarlyWarningController_list",
    "method": "GET",
    "path": "/api/results/early-warning",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "for",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "own_journals"
          ]
        }
      },
      {
        "name": "classId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/rating/choices": {
    "name": "RatingController_choices",
    "method": "GET",
    "path": "/api/results/rating/choices",
    "parameters": [
      {
        "name": "yearId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/rating/class": {
    "name": "RatingController_classRating",
    "method": "GET",
    "path": "/api/results/rating/class",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "classId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/rating/classes": {
    "name": "RatingController_classes",
    "method": "GET",
    "path": "/api/results/rating/classes",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "grade",
        "in": "query",
        "required": false,
        "schema": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 11
            },
            {
              "type": "string",
              "pattern": "^(?:[0-9]|1[01])$"
            }
          ]
        }
      },
      {
        "name": "language",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "uz",
            "ru"
          ]
        }
      }
    ]
  },
  "GET /api/results/rating/subject": {
    "name": "RatingController_subject",
    "method": "GET",
    "path": "/api/results/rating/subject",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "journalId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/reports/attendance": {
    "name": "ResultsReportsController_attendance",
    "method": "GET",
    "path": "/api/results/reports/attendance",
    "parameters": [
      {
        "name": "from",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "to",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "grade",
        "in": "query",
        "required": false,
        "schema": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 11
            },
            {
              "type": "string",
              "pattern": "^(?:[0-9]|1[01])$"
            }
          ]
        }
      },
      {
        "name": "classId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "subjectId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "teacherId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "start",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1439
        }
      },
      {
        "name": "groupBy",
        "in": "query",
        "required": false,
        "schema": {
          "default": "class",
          "type": "string",
          "enum": [
            "class",
            "tutor"
          ]
        }
      }
    ]
  },
  "GET /api/results/reports/choices": {
    "name": "ResultsReportsController_choices",
    "method": "GET",
    "path": "/api/results/reports/choices",
    "parameters": [
      {
        "name": "yearId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/reports/results-table": {
    "name": "ResultsReportsController_table",
    "method": "GET",
    "path": "/api/results/reports/results-table",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "classId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/reports/subject-mastery": {
    "name": "ResultsReportsController_mastery",
    "method": "GET",
    "path": "/api/results/reports/subject-mastery",
    "parameters": [
      {
        "name": "quarterId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "subjectId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "grade",
        "in": "query",
        "required": false,
        "schema": {
          "anyOf": [
            {
              "type": "integer",
              "minimum": 0,
              "maximum": 11
            },
            {
              "type": "string",
              "pattern": "^(?:[0-9]|1[01])$"
            }
          ]
        }
      },
      {
        "name": "classId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "teacherId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/results/students/:id": {
    "name": "StudentResultsController_read",
    "method": "GET",
    "path": "/api/results/students/:id",
    "parameters": [
      {
        "name": "yearId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/search/classes": {
    "name": "ClassesSearchController_findClasses",
    "method": "GET",
    "path": "/api/search/classes",
    "parameters": [
      {
        "name": "q",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    ]
  },
  "GET /api/search/groups": {
    "name": "ClassesSearchController_findGroups",
    "method": "GET",
    "path": "/api/search/groups",
    "parameters": [
      {
        "name": "q",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    ]
  },
  "GET /api/search/staff": {
    "name": "PeopleSearchController_findStaff",
    "method": "GET",
    "path": "/api/search/staff",
    "parameters": [
      {
        "name": "q",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    ]
  },
  "GET /api/search/students": {
    "name": "PeopleSearchController_findStudents",
    "method": "GET",
    "path": "/api/search/students",
    "parameters": [
      {
        "name": "q",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      }
    ]
  },
  "GET /api/setup/academic-years": {
    "name": "AcademicYearsController_list",
    "method": "GET",
    "path": "/api/setup/academic-years",
    "parameters": []
  },
  "GET /api/setup/branch": {
    "name": "BranchesController_read",
    "method": "GET",
    "path": "/api/setup/branch",
    "parameters": []
  },
  "GET /api/setup/buildings": {
    "name": "BuildingsController_list",
    "method": "GET",
    "path": "/api/setup/buildings",
    "parameters": []
  },
  "GET /api/setup/calendar-day": {
    "name": "CalendarController_day",
    "method": "GET",
    "path": "/api/setup/calendar-day",
    "parameters": [
      {
        "name": "date",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      }
    ]
  },
  "GET /api/setup/calendar-entries": {
    "name": "CalendarController_list",
    "method": "GET",
    "path": "/api/setup/calendar-entries",
    "parameters": []
  },
  "GET /api/setup/checklist": {
    "name": "SettingsController_checklist",
    "method": "GET",
    "path": "/api/setup/checklist",
    "parameters": []
  },
  "GET /api/setup/current-period": {
    "name": "AcademicYearsController_currentPeriod",
    "method": "GET",
    "path": "/api/setup/current-period",
    "parameters": []
  },
  "GET /api/setup/day-template-assignments": {
    "name": "DayTemplatesController_listAssignments",
    "method": "GET",
    "path": "/api/setup/day-template-assignments",
    "parameters": []
  },
  "GET /api/setup/day-templates": {
    "name": "DayTemplatesController_listTemplates",
    "method": "GET",
    "path": "/api/setup/day-templates",
    "parameters": []
  },
  "GET /api/setup/divisions": {
    "name": "DivisionsController_list",
    "method": "GET",
    "path": "/api/setup/divisions",
    "parameters": []
  },
  "GET /api/setup/rooms": {
    "name": "RoomsController_list",
    "method": "GET",
    "path": "/api/setup/rooms",
    "parameters": []
  },
  "GET /api/setup/settings": {
    "name": "SettingsController_read",
    "method": "GET",
    "path": "/api/setup/settings",
    "parameters": []
  },
  "GET /api/setup/slot-types": {
    "name": "DayTemplatesController_listSlotTypes",
    "method": "GET",
    "path": "/api/setup/slot-types",
    "parameters": []
  },
  "GET /api/setup/subjects": {
    "name": "SubjectsController_list",
    "method": "GET",
    "path": "/api/setup/subjects",
    "parameters": []
  },
  "GET /api/setup/subjects/:id/quarter-weights": {
    "name": "SubjectsController_quarterWeights",
    "method": "GET",
    "path": "/api/setup/subjects/:id/quarter-weights",
    "parameters": [
      {
        "name": "yearId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/setup/travel-times": {
    "name": "TravelTimesController_list",
    "method": "GET",
    "path": "/api/setup/travel-times",
    "parameters": []
  },
  "GET /api/timetable/absences": {
    "name": "AbsencesController_list",
    "method": "GET",
    "path": "/api/timetable/absences",
    "parameters": [
      {
        "name": "state",
        "in": "query",
        "required": false,
        "schema": {
          "default": "open",
          "type": "string",
          "enum": [
            "open",
            "all"
          ]
        }
      }
    ]
  },
  "GET /api/timetable/attention": {
    "name": "AbsencesController_attention",
    "method": "GET",
    "path": "/api/timetable/attention",
    "parameters": []
  },
  "GET /api/timetable/conflicts-summary": {
    "name": "TimetableController_conflictsSummary",
    "method": "GET",
    "path": "/api/timetable/conflicts-summary",
    "parameters": []
  },
  "GET /api/timetable/day": {
    "name": "DayChangesController_day",
    "method": "GET",
    "path": "/api/timetable/day",
    "parameters": [
      {
        "name": "date",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "classId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/timetable/exams": {
    "name": "ExamsController_list",
    "method": "GET",
    "path": "/api/timetable/exams",
    "parameters": [
      {
        "name": "from",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "to",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      }
    ]
  },
  "GET /api/timetable/lessons/:id/history": {
    "name": "LessonForcedDeletesController_history",
    "method": "GET",
    "path": "/api/timetable/lessons/:id/history",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/timetable/reports/load": {
    "name": "LoadReportController_load",
    "method": "GET",
    "path": "/api/timetable/reports/load",
    "parameters": [
      {
        "name": "week",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "departmentId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/timetable/room-closures": {
    "name": "RoomClosuresController_list",
    "method": "GET",
    "path": "/api/timetable/room-closures",
    "parameters": [
      {
        "name": "state",
        "in": "query",
        "required": false,
        "schema": {
          "default": "open",
          "type": "string",
          "enum": [
            "open",
            "all"
          ]
        }
      }
    ]
  },
  "GET /api/timetable/versions": {
    "name": "TimetableController_list",
    "method": "GET",
    "path": "/api/timetable/versions",
    "parameters": []
  },
  "GET /api/timetable/versions/:id/load": {
    "name": "TimetableController_load",
    "method": "GET",
    "path": "/api/timetable/versions/:id/load",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/timetable/views/branch": {
    "name": "TimetableViewsController_branch",
    "method": "GET",
    "path": "/api/timetable/views/branch",
    "parameters": [
      {
        "name": "date",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "span",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "day",
            "week"
          ]
        }
      }
    ]
  },
  "GET /api/timetable/views/choices": {
    "name": "TimetableViewsController_choices",
    "method": "GET",
    "path": "/api/timetable/views/choices",
    "parameters": [
      {
        "name": "date",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      }
    ]
  },
  "GET /api/timetable/views/class": {
    "name": "TimetableViewsController_class",
    "method": "GET",
    "path": "/api/timetable/views/class",
    "parameters": [
      {
        "name": "date",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "span",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "day",
            "week"
          ]
        }
      },
      {
        "name": "classId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/timetable/views/room": {
    "name": "TimetableViewsController_room",
    "method": "GET",
    "path": "/api/timetable/views/room",
    "parameters": [
      {
        "name": "date",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "span",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "day",
            "week"
          ]
        }
      },
      {
        "name": "roomId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "GET /api/timetable/views/teacher": {
    "name": "TimetableViewsController_teacher",
    "method": "GET",
    "path": "/api/timetable/views/teacher",
    "parameters": [
      {
        "name": "date",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "span",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "day",
            "week"
          ]
        }
      },
      {
        "name": "staffId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "PATCH /api/people/students/:id/relatives/:relativeId": {
    "name": "RelativesController_editLink",
    "method": "PATCH",
    "path": "/api/people/students/:id/relatives/:relativeId",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "relativeId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "relationship": {
          "type": "string",
          "enum": [
            "father",
            "mother",
            "grandfather",
            "grandmother",
            "uncle",
            "aunt",
            "brother",
            "sister",
            "guardian",
            "other"
          ]
        },
        "mainContact": {
          "type": "boolean"
        },
        "portalAccess": {
          "type": "boolean"
        },
        "receivesNotices": {
          "type": "boolean"
        }
      },
      "required": [
        "relationship",
        "mainContact",
        "portalAccess",
        "receivesNotices"
      ],
      "additionalProperties": false
    }
  },
  "PATCH /api/setup/calendar-entries/:id": {
    "name": "CalendarController_edit",
    "method": "PATCH",
    "path": "/api/setup/calendar-entries/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "day_off",
            "special_day"
          ]
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "firstDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "lastDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "gradeFrom": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "gradeTo": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "dayTemplateId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "followsWeekday": {
          "nullable": true,
          "anyOf": [
            {
              "type": "number",
              "enum": [
                1
              ]
            },
            {
              "type": "number",
              "enum": [
                2
              ]
            },
            {
              "type": "number",
              "enum": [
                3
              ]
            },
            {
              "type": "number",
              "enum": [
                4
              ]
            },
            {
              "type": "number",
              "enum": [
                5
              ]
            },
            {
              "type": "number",
              "enum": [
                6
              ]
            },
            {
              "type": "number",
              "enum": [
                7
              ]
            }
          ]
        },
        "examWeek": {
          "nullable": true,
          "type": "string",
          "enum": [
            "regular_lessons",
            "no_regular_lessons"
          ]
        },
        "dayChangesKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "dayDecisions": {
          "maxItems": 2000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockDate": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "drop",
                  "cancel",
                  "keep"
                ]
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              }
            },
            "required": [
              "key",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "dayKeeps": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "date": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "slotPositions": {
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20
                }
              }
            },
            "required": [
              "classId",
              "date",
              "slotPositions"
            ],
            "additionalProperties": false
          }
        },
        "examBlocks": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "examId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "start": {
                "type": "integer",
                "minimum": 0,
                "maximum": 1440
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "examId",
              "classId",
              "start",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "groupBlocks": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "weekday": {
                "anyOf": [
                  {
                    "type": "number",
                    "enum": [
                      1
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      2
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      3
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      4
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      5
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      6
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      7
                    ]
                  }
                ]
              },
              "start": {
                "type": "integer",
                "minimum": 0,
                "maximum": 1439
              },
              "groupIds": {
                "minItems": 1,
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "weekday",
              "start",
              "groupIds",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "kind",
        "name",
        "firstDate",
        "lastDate",
        "gradeFrom",
        "gradeTo",
        "dayTemplateId",
        "followsWeekday",
        "examWeek"
      ],
      "additionalProperties": false
    }
  },
  "PATCH /api/setup/day-templates/:id": {
    "name": "DayTemplatesController_renameTemplate",
    "method": "PATCH",
    "path": "/api/setup/day-templates/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        }
      },
      "required": [
        "name"
      ]
    }
  },
  "PATCH /api/setup/slot-types/:id": {
    "name": "DayTemplatesController_renameSlotType",
    "method": "PATCH",
    "path": "/api/setup/slot-types/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        }
      },
      "required": [
        "name"
      ]
    }
  },
  "PATCH /api/timetable/absences/:id": {
    "name": "AbsencesController_edit",
    "method": "PATCH",
    "path": "/api/timetable/absences/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "startsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endsOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "startsOn",
        "endsOn"
      ],
      "additionalProperties": false
    }
  },
  "PATCH /api/timetable/versions/:id/load/:rowId": {
    "name": "TimetableController_editRow",
    "method": "PATCH",
    "path": "/api/timetable/versions/:id/load/:rowId",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "rowId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "teacherId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "lessonsPerWeek": {
          "type": "integer",
          "minimum": 1,
          "maximum": 40
        },
        "roomId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "roomType": {
          "nullable": true,
          "type": "string",
          "enum": [
            "classroom",
            "laboratory",
            "sports_hall",
            "hall",
            "other"
          ]
        },
        "doubleLessons": {
          "type": "boolean"
        },
        "shortReason": {
          "nullable": true,
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "mixedBlock": {
          "type": "boolean"
        }
      },
      "required": [
        "teacherId",
        "lessonsPerWeek",
        "roomId",
        "roomType",
        "doubleLessons"
      ]
    }
  },
  "POST /api/classes": {
    "name": "ClassesController_create",
    "method": "POST",
    "path": "/api/classes",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "grade": {
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "name": {
          "type": "string",
          "minLength": 2,
          "maxLength": 40,
          "pattern": "^\\p{L}[\\p{L}0-9 '\\u02BB\\u02BC-]*$"
        },
        "language": {
          "type": "string",
          "enum": [
            "uz",
            "ru"
          ]
        },
        "mainRoomId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "maxSize": {
          "type": "integer",
          "minimum": 1,
          "maximum": 60
        },
        "academicYearId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "grade",
        "name",
        "language",
        "mainRoomId",
        "maxSize",
        "academicYearId"
      ]
    }
  },
  "POST /api/classes/:id/archive": {
    "name": "ClassesController_archive",
    "method": "POST",
    "path": "/api/classes/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/classes/:id/members": {
    "name": "ClassesController_place",
    "method": "POST",
    "path": "/api/classes/:id/members",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "students": {
          "minItems": 1,
          "maxItems": 60,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "version": {
                "type": "integer",
                "minimum": 0,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "id",
              "version"
            ],
            "additionalProperties": false
          }
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "students",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/classes/:id/members/:memberId/withdraw": {
    "name": "ClassesController_withdraw",
    "method": "POST",
    "path": "/api/classes/:id/members/:memberId/withdraw",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "memberId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/classes/:id/restore": {
    "name": "ClassesController_restore",
    "method": "POST",
    "path": "/api/classes/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/classes/transfers": {
    "name": "ClassTransfersController_transfer",
    "method": "POST",
    "path": "/api/classes/transfers",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "studentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "toClassId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "confirmLanguage": {
          "type": "boolean"
        },
        "journalEntries": {
          "type": "object",
          "properties": {
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "seen": {
              "minItems": 1,
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "version": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "id",
                  "version"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "reason",
            "seen"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "studentId",
        "version",
        "toClassId",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/classes/transfers/:id/cancel": {
    "name": "ClassTransfersController_cancel",
    "method": "POST",
    "path": "/api/classes/transfers/:id/cancel",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/classes/transfers/:id/change": {
    "name": "ClassTransfersController_change",
    "method": "POST",
    "path": "/api/classes/transfers/:id/change",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "toClassId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "confirmLanguage": {
          "type": "boolean"
        },
        "journalEntries": {
          "type": "object",
          "properties": {
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "seen": {
              "minItems": 1,
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "version": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "id",
                  "version"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "reason",
            "seen"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "version",
        "toClassId",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/classes/transfers/:id/undo": {
    "name": "ClassTransfersController_undo",
    "method": "POST",
    "path": "/api/classes/transfers/:id/undo",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "version",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/groups": {
    "name": "GroupsController_create",
    "method": "POST",
    "path": "/api/groups",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "classIds": {
          "minItems": 1,
          "maxItems": 40,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 40,
          "pattern": "^[\\p{L}0-9][\\p{L}0-9 'ʻʼ-]*$"
        },
        "language": {
          "nullable": true,
          "type": "string",
          "enum": [
            "uz",
            "ru"
          ]
        },
        "maxSize": {
          "type": "integer",
          "minimum": 1,
          "maximum": 60
        },
        "sex": {
          "default": null,
          "nullable": true,
          "type": "string",
          "enum": [
            "male",
            "female"
          ]
        },
        "confirmMixedLanguage": {
          "default": false,
          "type": "boolean"
        },
        "academicYearId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "classIds",
        "name",
        "language",
        "maxSize",
        "academicYearId",
        "subjectId"
      ]
    }
  },
  "POST /api/groups/:id/archive": {
    "name": "GroupsController_archive",
    "method": "POST",
    "path": "/api/groups/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/groups/:id/members": {
    "name": "GroupsController_place",
    "method": "POST",
    "path": "/api/groups/:id/members",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "students": {
          "minItems": 1,
          "maxItems": 60,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "id": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "id"
            ],
            "additionalProperties": false
          }
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "students",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/groups/:id/members/:memberId/reviewed": {
    "name": "GroupsController_reviewed",
    "method": "POST",
    "path": "/api/groups/:id/members/:memberId/reviewed",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "memberId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/groups/:id/members/:memberId/withdraw": {
    "name": "GroupsController_withdraw",
    "method": "POST",
    "path": "/api/groups/:id/members/:memberId/withdraw",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "memberId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/groups/:id/restore": {
    "name": "GroupsController_restore",
    "method": "POST",
    "path": "/api/groups/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "confirmMixedLanguage": {
          "default": false,
          "type": "boolean"
        }
      }
    }
  },
  "POST /api/groups/placement/automatic": {
    "name": "GroupsController_placeAutomatically",
    "method": "POST",
    "path": "/api/groups/placement/automatic",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "grades": {
          "minItems": 1,
          "maxItems": 2,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 0,
            "maximum": 11
          }
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "subjectId",
        "grades",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/groups/transfers": {
    "name": "GroupTransfersController_transfer",
    "method": "POST",
    "path": "/api/groups/transfers",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "studentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "memberId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "toGroupId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "journalEntries": {
          "type": "object",
          "properties": {
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "seen": {
              "minItems": 1,
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "version": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "id",
                  "version"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "reason",
            "seen"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "studentId",
        "memberId",
        "toGroupId",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/journals/:journalId/rating/:quarterId/unlocks": {
    "name": "UnlocksController_requestRating",
    "method": "POST",
    "path": "/api/journal/journals/:journalId/rating/:quarterId/unlocks",
    "parameters": [
      {
        "name": "journalId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "quarterId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/lessons/:lessonId/unlocks": {
    "name": "UnlocksController_requestLesson",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/unlocks",
    "parameters": [
      {
        "name": "lessonId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/leaving": {
    "name": "StudentStatusesController_leave",
    "method": "POST",
    "path": "/api/people/students/:id/leaving",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "lastDay": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "journalEntries": {
          "type": "object",
          "properties": {
            "reason": {
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "seen": {
              "minItems": 1,
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "version": {
                    "type": "integer",
                    "minimum": 1,
                    "maximum": 9007199254740991
                  }
                },
                "required": [
                  "id",
                  "version"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "reason",
            "seen"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "lastDay",
        "reason",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/leaving/cancel": {
    "name": "StudentStatusesController_cancelLeaving",
    "method": "POST",
    "path": "/api/people/students/:id/leaving/cancel",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/leaving/undo": {
    "name": "StudentStatusesController_undoLeaving",
    "method": "POST",
    "path": "/api/people/students/:id/leaving/undo",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "reason",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/restore": {
    "name": "StudentStatusesController_restore",
    "method": "POST",
    "path": "/api/people/students/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "classId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "from",
        "classId",
        "reason",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/return/cancel": {
    "name": "StudentStatusesController_cancelReturn",
    "method": "POST",
    "path": "/api/people/students/:id/return/cancel",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/vacancies": {
    "name": "VacanciesController_create",
    "method": "POST",
    "path": "/api/people/vacancies",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "departmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "subjects": {
          "maxItems": 30,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subjectId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "grades": {
                "minItems": 1,
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                }
              }
            },
            "required": [
              "subjectId",
              "grades"
            ]
          }
        },
        "languages": {
          "maxItems": 2,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "uz",
              "ru"
            ]
          }
        },
        "weeklyLessons": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 60
        },
        "dailyLessons": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        }
      },
      "required": [
        "name",
        "departmentId",
        "subjects",
        "languages",
        "weeklyLessons",
        "dailyLessons"
      ]
    }
  },
  "POST /api/people/vacancies/:id/close": {
    "name": "VacanciesController_close",
    "method": "POST",
    "path": "/api/people/vacancies/:id/close",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/people/vacancies/:id/reopen": {
    "name": "VacanciesController_reopen",
    "method": "POST",
    "path": "/api/people/vacancies/:id/reopen",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/plans/journals/:journalId/items": {
    "name": "PlansController_createItem",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/items",
    "parameters": [
      {
        "name": "journalId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "quarterId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "position": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "lessonId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "values": {
          "type": "object",
          "properties": {
            "topic": {
              "type": "string",
              "maxLength": 300
            },
            "objectives": {
              "type": "string",
              "maxLength": 2000
            },
            "links": {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 500,
                "pattern": "^https?:\\/\\/[^\\s]+$"
              }
            },
            "classworks": {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string",
                    "maxLength": 60
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 1000
                  }
                },
                "required": [
                  "title",
                  "description"
                ],
                "additionalProperties": false
              }
            },
            "homeworks": {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "title": {
                    "type": "string",
                    "maxLength": 60
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 1000
                  }
                },
                "required": [
                  "title",
                  "description"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "topic",
            "objectives",
            "links",
            "classworks",
            "homeworks"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "quarterId",
        "position",
        "lessonId",
        "values"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/requests": {
    "name": "PlanRequestsController_create",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/requests",
    "parameters": [
      {
        "name": "journalId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "text"
              ]
            },
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "lessonIds": {
              "minItems": 1,
              "maxItems": 200,
              "type": "array",
              "items": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "reason": {
              "type": "string",
              "maxLength": 1000
            }
          },
          "required": [
            "kind",
            "quarterId",
            "lessonIds",
            "reason"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "replan"
              ]
            },
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "fromLessonId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "reason": {
              "type": "string",
              "maxLength": 1000
            }
          },
          "required": [
            "kind",
            "quarterId",
            "fromLessonId",
            "reason"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/plans/requests/:requestId/send": {
    "name": "PlanRequestsController_send",
    "method": "POST",
    "path": "/api/plans/requests/:requestId/send",
    "parameters": [
      {
        "name": "requestId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string",
          "maxLength": 1000
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/plans/windows/:quarterId/extensions": {
    "name": "PlanWindowsController_extend",
    "method": "POST",
    "path": "/api/plans/windows/:quarterId/extensions",
    "parameters": [
      {
        "name": "quarterId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "staffId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "staffId",
        "endDate"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/setup/academic-years": {
    "name": "AcademicYearsController_create",
    "method": "POST",
    "path": "/api/setup/academic-years",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "startDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "startDate",
        "endDate"
      ]
    }
  },
  "POST /api/setup/academic-years/:id/quarters/preview": {
    "name": "AcademicYearsController_previewQuarters",
    "method": "POST",
    "path": "/api/setup/academic-years/:id/quarters/preview",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "quarters": {
          "minItems": 4,
          "maxItems": 4,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "startDate": {
                "nullable": true,
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "endDate": {
                "nullable": true,
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              }
            },
            "required": [
              "startDate",
              "endDate"
            ]
          }
        },
        "days": {
          "type": "object",
          "properties": {
            "dayChangesKey": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "dayDecisions": {
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "key": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockDate": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "drop",
                      "cancel",
                      "keep"
                    ]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500
                  }
                },
                "required": [
                  "key",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      },
      "required": [
        "quarters"
      ]
    }
  },
  "POST /api/setup/buildings": {
    "name": "BuildingsController_create",
    "method": "POST",
    "path": "/api/setup/buildings",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "required": [
        "name"
      ]
    }
  },
  "POST /api/setup/buildings/:id/archive": {
    "name": "BuildingsController_archive",
    "method": "POST",
    "path": "/api/setup/buildings/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/buildings/:id/floors": {
    "name": "BuildingsController_createFloor",
    "method": "POST",
    "path": "/api/setup/buildings/:id/floors",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 50
        }
      },
      "required": [
        "name"
      ]
    }
  },
  "POST /api/setup/buildings/:id/restore": {
    "name": "BuildingsController_restore",
    "method": "POST",
    "path": "/api/setup/buildings/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/calendar-entries": {
    "name": "CalendarController_create",
    "method": "POST",
    "path": "/api/setup/calendar-entries",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "day_off",
            "special_day"
          ]
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "firstDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "lastDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "gradeFrom": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "gradeTo": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "dayTemplateId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "followsWeekday": {
          "nullable": true,
          "anyOf": [
            {
              "type": "number",
              "enum": [
                1
              ]
            },
            {
              "type": "number",
              "enum": [
                2
              ]
            },
            {
              "type": "number",
              "enum": [
                3
              ]
            },
            {
              "type": "number",
              "enum": [
                4
              ]
            },
            {
              "type": "number",
              "enum": [
                5
              ]
            },
            {
              "type": "number",
              "enum": [
                6
              ]
            },
            {
              "type": "number",
              "enum": [
                7
              ]
            }
          ]
        },
        "examWeek": {
          "nullable": true,
          "type": "string",
          "enum": [
            "regular_lessons",
            "no_regular_lessons"
          ]
        },
        "dayChangesKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "dayDecisions": {
          "maxItems": 2000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockDate": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "drop",
                  "cancel",
                  "keep"
                ]
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              }
            },
            "required": [
              "key",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "dayKeeps": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "date": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "slotPositions": {
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20
                }
              }
            },
            "required": [
              "classId",
              "date",
              "slotPositions"
            ],
            "additionalProperties": false
          }
        },
        "examBlocks": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "examId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "start": {
                "type": "integer",
                "minimum": 0,
                "maximum": 1440
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "examId",
              "classId",
              "start",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "groupBlocks": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "weekday": {
                "anyOf": [
                  {
                    "type": "number",
                    "enum": [
                      1
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      2
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      3
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      4
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      5
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      6
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      7
                    ]
                  }
                ]
              },
              "start": {
                "type": "integer",
                "minimum": 0,
                "maximum": 1439
              },
              "groupIds": {
                "minItems": 1,
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "weekday",
              "start",
              "groupIds",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "kind",
        "name",
        "firstDate",
        "lastDate",
        "gradeFrom",
        "gradeTo",
        "dayTemplateId",
        "followsWeekday",
        "examWeek"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/setup/calendar-entries/:id/archive": {
    "name": "CalendarController_archive",
    "method": "POST",
    "path": "/api/setup/calendar-entries/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "default": {},
      "type": "object",
      "properties": {
        "dayChangesKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "dayDecisions": {
          "maxItems": 2000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockDate": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "drop",
                  "cancel",
                  "keep"
                ]
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              }
            },
            "required": [
              "key",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "dayKeeps": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "date": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "slotPositions": {
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20
                }
              }
            },
            "required": [
              "classId",
              "date",
              "slotPositions"
            ],
            "additionalProperties": false
          }
        },
        "examBlocks": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "examId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "start": {
                "type": "integer",
                "minimum": 0,
                "maximum": 1440
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "examId",
              "classId",
              "start",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/setup/calendar-entries/:id/restore": {
    "name": "CalendarController_restore",
    "method": "POST",
    "path": "/api/setup/calendar-entries/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "default": {},
      "type": "object",
      "properties": {
        "dayChangesKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "dayDecisions": {
          "maxItems": 2000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "key": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockDate": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "drop",
                  "cancel",
                  "keep"
                ]
              },
              "reason": {
                "type": "string",
                "minLength": 1,
                "maxLength": 500
              }
            },
            "required": [
              "key",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "dayKeeps": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "date": {
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "slotPositions": {
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 20
                }
              }
            },
            "required": [
              "classId",
              "date",
              "slotPositions"
            ],
            "additionalProperties": false
          }
        },
        "examBlocks": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "examId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "start": {
                "type": "integer",
                "minimum": 0,
                "maximum": 1440
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "examId",
              "classId",
              "start",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "groupBlocks": {
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "weekday": {
                "anyOf": [
                  {
                    "type": "number",
                    "enum": [
                      1
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      2
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      3
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      4
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      5
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      6
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      7
                    ]
                  }
                ]
              },
              "start": {
                "type": "integer",
                "minimum": 0,
                "maximum": 1439
              },
              "groupIds": {
                "minItems": 1,
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "weekday",
              "start",
              "groupIds",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/setup/calendar-entries/preview": {
    "name": "CalendarController_preview",
    "method": "POST",
    "path": "/api/setup/calendar-entries/preview",
    "parameters": [],
    "body": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "create"
              ]
            },
            "record": {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "day_off",
                    "special_day"
                  ]
                },
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 60
                },
                "firstDate": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "lastDate": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "gradeFrom": {
                  "nullable": true,
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                },
                "gradeTo": {
                  "nullable": true,
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                },
                "dayTemplateId": {
                  "nullable": true,
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "followsWeekday": {
                  "nullable": true,
                  "anyOf": [
                    {
                      "type": "number",
                      "enum": [
                        1
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        2
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        3
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        4
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        5
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        6
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        7
                      ]
                    }
                  ]
                },
                "examWeek": {
                  "nullable": true,
                  "type": "string",
                  "enum": [
                    "regular_lessons",
                    "no_regular_lessons"
                  ]
                }
              },
              "required": [
                "kind",
                "name",
                "firstDate",
                "lastDate",
                "gradeFrom",
                "gradeTo",
                "dayTemplateId",
                "followsWeekday",
                "examWeek"
              ]
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "groupBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "weekday": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          3
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          4
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          5
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          6
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          7
                        ]
                      }
                    ]
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1439
                  },
                  "groupIds": {
                    "minItems": 1,
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "uuid",
                      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                    }
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "weekday",
                  "start",
                  "groupIds",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "action",
            "record"
          ]
        },
        {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "edit"
              ]
            },
            "id": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "record": {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "day_off",
                    "special_day"
                  ]
                },
                "name": {
                  "type": "string",
                  "minLength": 1,
                  "maxLength": 60
                },
                "firstDate": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "lastDate": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "gradeFrom": {
                  "nullable": true,
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                },
                "gradeTo": {
                  "nullable": true,
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                },
                "dayTemplateId": {
                  "nullable": true,
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "followsWeekday": {
                  "nullable": true,
                  "anyOf": [
                    {
                      "type": "number",
                      "enum": [
                        1
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        2
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        3
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        4
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        5
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        6
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        7
                      ]
                    }
                  ]
                },
                "examWeek": {
                  "nullable": true,
                  "type": "string",
                  "enum": [
                    "regular_lessons",
                    "no_regular_lessons"
                  ]
                }
              },
              "required": [
                "kind",
                "name",
                "firstDate",
                "lastDate",
                "gradeFrom",
                "gradeTo",
                "dayTemplateId",
                "followsWeekday",
                "examWeek"
              ]
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "groupBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "weekday": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          3
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          4
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          5
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          6
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          7
                        ]
                      }
                    ]
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1439
                  },
                  "groupIds": {
                    "minItems": 1,
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "uuid",
                      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                    }
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "weekday",
                  "start",
                  "groupIds",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "action",
            "id",
            "record"
          ]
        },
        {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "archive"
              ]
            },
            "id": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "action",
            "id"
          ]
        },
        {
          "type": "object",
          "properties": {
            "action": {
              "type": "string",
              "enum": [
                "restore"
              ]
            },
            "id": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "groupBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "weekday": {
                    "anyOf": [
                      {
                        "type": "number",
                        "enum": [
                          1
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          2
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          3
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          4
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          5
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          6
                        ]
                      },
                      {
                        "type": "number",
                        "enum": [
                          7
                        ]
                      }
                    ]
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1439
                  },
                  "groupIds": {
                    "minItems": 1,
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "string",
                      "format": "uuid",
                      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                    }
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "weekday",
                  "start",
                  "groupIds",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "action",
            "id"
          ]
        }
      ]
    }
  },
  "POST /api/setup/day-template-assignments": {
    "name": "DayTemplatesController_assign",
    "method": "POST",
    "path": "/api/setup/day-template-assignments",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "level": {
          "type": "string",
          "enum": [
            "default",
            "grades",
            "weekday",
            "weekday_grades"
          ]
        },
        "weekday": {
          "nullable": true,
          "anyOf": [
            {
              "type": "number",
              "enum": [
                1
              ]
            },
            {
              "type": "number",
              "enum": [
                2
              ]
            },
            {
              "type": "number",
              "enum": [
                3
              ]
            },
            {
              "type": "number",
              "enum": [
                4
              ]
            },
            {
              "type": "number",
              "enum": [
                5
              ]
            },
            {
              "type": "number",
              "enum": [
                6
              ]
            },
            {
              "type": "number",
              "enum": [
                7
              ]
            }
          ]
        },
        "gradeFrom": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "gradeTo": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "dayTemplateId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "days": {
          "type": "object",
          "properties": {
            "dayChangesKey": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "dayDecisions": {
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "key": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockDate": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "drop",
                      "cancel",
                      "keep"
                    ]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500
                  }
                },
                "required": [
                  "key",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      },
      "required": [
        "level",
        "weekday",
        "gradeFrom",
        "gradeTo",
        "dayTemplateId",
        "from"
      ]
    }
  },
  "POST /api/setup/day-template-assignments/:id/end": {
    "name": "DayTemplatesController_end",
    "method": "POST",
    "path": "/api/setup/day-template-assignments/:id/end",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "days": {
          "type": "object",
          "properties": {
            "dayChangesKey": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "dayDecisions": {
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "key": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockDate": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "drop",
                      "cancel",
                      "keep"
                    ]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500
                  }
                },
                "required": [
                  "key",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      },
      "required": [
        "from"
      ]
    }
  },
  "POST /api/setup/day-template-table/preview": {
    "name": "DayTemplatesController_preview",
    "method": "POST",
    "path": "/api/setup/day-template-table/preview",
    "parameters": [],
    "body": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "slot_length"
              ]
            },
            "slotTypeId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "change": {
              "type": "object",
              "properties": {
                "lengthMinutes": {
                  "type": "integer",
                  "minimum": 5,
                  "maximum": 180
                },
                "from": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "days": {
                  "type": "object",
                  "properties": {
                    "dayChangesKey": {
                      "type": "string",
                      "pattern": "^[0-9a-f]{64}$"
                    },
                    "dayDecisions": {
                      "maxItems": 2000,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "key": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockDate": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "drop",
                              "cancel",
                              "keep"
                            ]
                          },
                          "reason": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 500
                          }
                        },
                        "required": [
                          "key",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "dayKeeps": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "date": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "slotPositions": {
                            "maxItems": 20,
                            "type": "array",
                            "items": {
                              "type": "integer",
                              "minimum": 1,
                              "maximum": 20
                            }
                          }
                        },
                        "required": [
                          "classId",
                          "date",
                          "slotPositions"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "examBlocks": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "examId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "start": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 1440
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "cancel",
                              "keep"
                            ]
                          }
                        },
                        "required": [
                          "examId",
                          "classId",
                          "start",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "lengthMinutes",
                "from"
              ]
            }
          },
          "required": [
            "kind",
            "slotTypeId",
            "change"
          ]
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "template_version"
              ]
            },
            "dayTemplateId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "change": {
              "type": "object",
              "properties": {
                "from": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "startTime": {
                  "type": "string",
                  "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
                },
                "slotTypeIds": {
                  "minItems": 1,
                  "maxItems": 20,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  }
                },
                "days": {
                  "type": "object",
                  "properties": {
                    "dayChangesKey": {
                      "type": "string",
                      "pattern": "^[0-9a-f]{64}$"
                    },
                    "dayDecisions": {
                      "maxItems": 2000,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "key": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockDate": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "drop",
                              "cancel",
                              "keep"
                            ]
                          },
                          "reason": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 500
                          }
                        },
                        "required": [
                          "key",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "dayKeeps": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "date": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "slotPositions": {
                            "maxItems": 20,
                            "type": "array",
                            "items": {
                              "type": "integer",
                              "minimum": 1,
                              "maximum": 20
                            }
                          }
                        },
                        "required": [
                          "classId",
                          "date",
                          "slotPositions"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "examBlocks": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "examId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "start": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 1440
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "cancel",
                              "keep"
                            ]
                          }
                        },
                        "required": [
                          "examId",
                          "classId",
                          "start",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "from",
                "startTime",
                "slotTypeIds"
              ]
            }
          },
          "required": [
            "kind",
            "dayTemplateId",
            "change"
          ]
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "assignment_set"
              ]
            },
            "change": {
              "type": "object",
              "properties": {
                "level": {
                  "type": "string",
                  "enum": [
                    "default",
                    "grades",
                    "weekday",
                    "weekday_grades"
                  ]
                },
                "weekday": {
                  "nullable": true,
                  "anyOf": [
                    {
                      "type": "number",
                      "enum": [
                        1
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        2
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        3
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        4
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        5
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        6
                      ]
                    },
                    {
                      "type": "number",
                      "enum": [
                        7
                      ]
                    }
                  ]
                },
                "gradeFrom": {
                  "nullable": true,
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                },
                "gradeTo": {
                  "nullable": true,
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                },
                "dayTemplateId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "from": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "days": {
                  "type": "object",
                  "properties": {
                    "dayChangesKey": {
                      "type": "string",
                      "pattern": "^[0-9a-f]{64}$"
                    },
                    "dayDecisions": {
                      "maxItems": 2000,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "key": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockDate": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "drop",
                              "cancel",
                              "keep"
                            ]
                          },
                          "reason": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 500
                          }
                        },
                        "required": [
                          "key",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "dayKeeps": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "date": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "slotPositions": {
                            "maxItems": 20,
                            "type": "array",
                            "items": {
                              "type": "integer",
                              "minimum": 1,
                              "maximum": 20
                            }
                          }
                        },
                        "required": [
                          "classId",
                          "date",
                          "slotPositions"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "examBlocks": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "examId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "start": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 1440
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "cancel",
                              "keep"
                            ]
                          }
                        },
                        "required": [
                          "examId",
                          "classId",
                          "start",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "level",
                "weekday",
                "gradeFrom",
                "gradeTo",
                "dayTemplateId",
                "from"
              ]
            }
          },
          "required": [
            "kind",
            "change"
          ]
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "assignment_end"
              ]
            },
            "assignmentId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "change": {
              "type": "object",
              "properties": {
                "from": {
                  "type": "string",
                  "format": "date",
                  "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                },
                "days": {
                  "type": "object",
                  "properties": {
                    "dayChangesKey": {
                      "type": "string",
                      "pattern": "^[0-9a-f]{64}$"
                    },
                    "dayDecisions": {
                      "maxItems": 2000,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "key": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "blockDate": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "drop",
                              "cancel",
                              "keep"
                            ]
                          },
                          "reason": {
                            "type": "string",
                            "minLength": 1,
                            "maxLength": 500
                          }
                        },
                        "required": [
                          "key",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "dayKeeps": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "date": {
                            "type": "string",
                            "format": "date",
                            "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                          },
                          "slotPositions": {
                            "maxItems": 20,
                            "type": "array",
                            "items": {
                              "type": "integer",
                              "minimum": 1,
                              "maximum": 20
                            }
                          }
                        },
                        "required": [
                          "classId",
                          "date",
                          "slotPositions"
                        ],
                        "additionalProperties": false
                      }
                    },
                    "examBlocks": {
                      "maxItems": 500,
                      "type": "array",
                      "items": {
                        "type": "object",
                        "properties": {
                          "examId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "classId": {
                            "type": "string",
                            "format": "uuid",
                            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                          },
                          "start": {
                            "type": "integer",
                            "minimum": 0,
                            "maximum": 1440
                          },
                          "choice": {
                            "type": "string",
                            "enum": [
                              "cancel",
                              "keep"
                            ]
                          }
                        },
                        "required": [
                          "examId",
                          "classId",
                          "start",
                          "choice"
                        ],
                        "additionalProperties": false
                      }
                    }
                  },
                  "additionalProperties": false
                }
              },
              "required": [
                "from"
              ]
            }
          },
          "required": [
            "kind",
            "assignmentId",
            "change"
          ]
        }
      ]
    }
  },
  "POST /api/setup/day-templates": {
    "name": "DayTemplatesController_createTemplate",
    "method": "POST",
    "path": "/api/setup/day-templates",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "startTime": {
          "type": "string",
          "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
        },
        "slotTypeIds": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "name",
        "startTime",
        "slotTypeIds"
      ]
    }
  },
  "POST /api/setup/day-templates/:id/archive": {
    "name": "DayTemplatesController_archiveTemplate",
    "method": "POST",
    "path": "/api/setup/day-templates/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/day-templates/:id/restore": {
    "name": "DayTemplatesController_restoreTemplate",
    "method": "POST",
    "path": "/api/setup/day-templates/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/day-templates/:id/versions": {
    "name": "DayTemplatesController_addTemplateVersion",
    "method": "POST",
    "path": "/api/setup/day-templates/:id/versions",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "startTime": {
          "type": "string",
          "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
        },
        "slotTypeIds": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "days": {
          "type": "object",
          "properties": {
            "dayChangesKey": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "dayDecisions": {
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "key": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockDate": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "drop",
                      "cancel",
                      "keep"
                    ]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500
                  }
                },
                "required": [
                  "key",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      },
      "required": [
        "from",
        "startTime",
        "slotTypeIds"
      ]
    }
  },
  "POST /api/setup/floors/:id/archive": {
    "name": "BuildingsController_archiveFloor",
    "method": "POST",
    "path": "/api/setup/floors/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/floors/:id/restore": {
    "name": "BuildingsController_restoreFloor",
    "method": "POST",
    "path": "/api/setup/floors/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/rooms": {
    "name": "RoomsController_create",
    "method": "POST",
    "path": "/api/setup/rooms",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 50
        },
        "floorId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "type": {
          "type": "string",
          "enum": [
            "classroom",
            "laboratory",
            "sports_hall",
            "hall",
            "other"
          ]
        },
        "capacity": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        },
        "status": {
          "type": "string",
          "enum": [
            "in_use",
            "under_repair",
            "closed"
          ]
        },
        "shared": {
          "type": "boolean"
        },
        "maxSimultaneousLessons": {
          "nullable": true,
          "type": "integer",
          "minimum": 2,
          "maximum": 10
        }
      },
      "required": [
        "name",
        "floorId",
        "type",
        "capacity",
        "status",
        "shared",
        "maxSimultaneousLessons"
      ]
    }
  },
  "POST /api/setup/slot-types": {
    "name": "DayTemplatesController_createSlotType",
    "method": "POST",
    "path": "/api/setup/slot-types",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 60
        },
        "kind": {
          "type": "string",
          "enum": [
            "lesson",
            "break"
          ]
        },
        "lengthMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 180
        }
      },
      "required": [
        "name",
        "kind",
        "lengthMinutes"
      ]
    }
  },
  "POST /api/setup/slot-types/:id/archive": {
    "name": "DayTemplatesController_archiveSlotType",
    "method": "POST",
    "path": "/api/setup/slot-types/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/slot-types/:id/lengths": {
    "name": "DayTemplatesController_changeSlotLength",
    "method": "POST",
    "path": "/api/setup/slot-types/:id/lengths",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "lengthMinutes": {
          "type": "integer",
          "minimum": 5,
          "maximum": 180
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "days": {
          "type": "object",
          "properties": {
            "dayChangesKey": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "dayDecisions": {
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "key": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockDate": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "drop",
                      "cancel",
                      "keep"
                    ]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500
                  }
                },
                "required": [
                  "key",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      },
      "required": [
        "lengthMinutes",
        "from"
      ]
    }
  },
  "POST /api/setup/slot-types/:id/restore": {
    "name": "DayTemplatesController_restoreSlotType",
    "method": "POST",
    "path": "/api/setup/slot-types/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/subjects": {
    "name": "SubjectsController_create",
    "method": "POST",
    "path": "/api/setup/subjects",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "names": {
          "type": "object",
          "properties": {
            "uz": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            },
            "ru": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            },
            "en": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            }
          },
          "required": [
            "uz",
            "ru",
            "en"
          ]
        },
        "departmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "grades": {
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 0,
            "maximum": 11
          }
        },
        "colour": {
          "type": "string",
          "enum": [
            "red",
            "orange",
            "amber",
            "lime",
            "green",
            "teal",
            "cyan",
            "blue",
            "indigo",
            "violet",
            "pink",
            "brown"
          ]
        },
        "journalType": {
          "type": "string",
          "enum": [
            "graded",
            "attendance_only"
          ]
        },
        "ratingExam": {
          "type": "boolean"
        },
        "groupSubject": {
          "type": "boolean"
        },
        "languageRule": {
          "type": "boolean"
        },
        "demanding": {
          "type": "boolean"
        },
        "daily": {
          "nullable": true,
          "type": "object",
          "properties": {
            "attendance": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            "classwork": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            "homework": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            }
          },
          "required": [
            "attendance",
            "classwork",
            "homework"
          ]
        },
        "departmentStartsOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "switchesFrom": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 4
        }
      },
      "required": [
        "names",
        "departmentId",
        "grades",
        "colour",
        "journalType",
        "ratingExam",
        "groupSubject",
        "languageRule",
        "demanding",
        "daily"
      ]
    }
  },
  "POST /api/setup/subjects/:id/archive": {
    "name": "SubjectsController_archive",
    "method": "POST",
    "path": "/api/setup/subjects/:id/archive",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/setup/subjects/:id/quarter-weights/:quarterId/preview": {
    "name": "SubjectsController_previewQuarterWeights",
    "method": "POST",
    "path": "/api/setup/subjects/:id/quarter-weights/:quarterId/preview",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "quarterId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "attendance": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "classwork": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "homework": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "ratingExam": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "attendance",
        "classwork",
        "homework",
        "ratingExam"
      ]
    }
  },
  "POST /api/setup/subjects/:id/quarter-weights/copy": {
    "name": "SubjectsController_copyQuarterOne",
    "method": "POST",
    "path": "/api/setup/subjects/:id/quarter-weights/copy",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "yearId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "yearId"
      ]
    }
  },
  "POST /api/setup/subjects/:id/quarter-weights/copy/preview": {
    "name": "SubjectsController_previewCopy",
    "method": "POST",
    "path": "/api/setup/subjects/:id/quarter-weights/copy/preview",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "yearId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "yearId"
      ]
    }
  },
  "POST /api/setup/subjects/:id/restore": {
    "name": "SubjectsController_restore",
    "method": "POST",
    "path": "/api/setup/subjects/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/timetable/absences": {
    "name": "AbsencesController_create",
    "method": "POST",
    "path": "/api/timetable/absences",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "staffId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "startsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endsOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "staffId",
        "startsOn",
        "endsOn",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/absences/:id/withdraw": {
    "name": "AbsencesController_withdraw",
    "method": "POST",
    "path": "/api/timetable/absences/:id/withdraw",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ]
  },
  "POST /api/timetable/bulk-cancels": {
    "name": "BulkCancelsController_save",
    "method": "POST",
    "path": "/api/timetable/bulk-cancels",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "classIds": {
          "minItems": 1,
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "lessonNumbers": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20
          }
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "blocks": {
          "maxItems": 2000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "cancel"
                ]
              }
            },
            "required": [
              "blockId",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "lessonIds": {
          "maxItems": 10000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "dataChoices": {
          "default": [],
          "maxItems": 10000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "cancel"
                ]
              }
            },
            "required": [
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "date",
        "classIds",
        "lessonNumbers",
        "reason",
        "blocks",
        "lessonIds"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/bulk-cancels/check": {
    "name": "BulkCancelsController_check",
    "method": "POST",
    "path": "/api/timetable/bulk-cancels/check",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "classIds": {
          "minItems": 1,
          "maxItems": 500,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "lessonNumbers": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 20
          }
        }
      },
      "required": [
        "date",
        "classIds",
        "lessonNumbers"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/exams": {
    "name": "ExamsController_create",
    "method": "POST",
    "path": "/api/timetable/exams",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "firstLesson": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "lastLesson": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "subjectId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "rooms": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "roomId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "classIds": {
                "maxItems": 60,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "groupIds": {
                "maxItems": 60,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "invigilatorIds": {
                "minItems": 1,
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              }
            },
            "required": [
              "roomId",
              "classIds",
              "groupIds",
              "invigilatorIds"
            ],
            "additionalProperties": false
          }
        },
        "blockChoices": {
          "default": [],
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "classId",
              "blockId",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "ratingExam": {
          "default": false,
          "type": "boolean"
        },
        "confirm": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "date",
        "firstLesson",
        "lastLesson",
        "title",
        "subjectId",
        "rooms"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/exams/:id/cancel": {
    "name": "ExamsController_cancel",
    "method": "POST",
    "path": "/api/timetable/exams/:id/cancel",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "keepCancelled": {
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "keepReason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/timetable/exams/check": {
    "name": "ExamsController_check",
    "method": "POST",
    "path": "/api/timetable/exams/check",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "examId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "date": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "firstLesson": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "lastLesson": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "subjectId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "rooms": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "roomId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "classIds": {
                "maxItems": 60,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "groupIds": {
                "maxItems": 60,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "invigilatorIds": {
                "minItems": 1,
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              }
            },
            "required": [
              "roomId",
              "classIds",
              "groupIds",
              "invigilatorIds"
            ],
            "additionalProperties": false
          }
        },
        "blockChoices": {
          "default": [],
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "classId",
              "blockId",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "ratingExam": {
          "default": false,
          "type": "boolean"
        },
        "keepCancelled": {
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "keepReason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "date",
        "firstLesson",
        "lastLesson",
        "title",
        "subjectId",
        "rooms"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/lessons/:id/cancel": {
    "name": "DayChangesController_cancel",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/cancel",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "confirm": {
          "type": "boolean"
        }
      },
      "required": [
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/lessons/:id/move": {
    "name": "DayChangesController_move",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/move",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "lessonNumber": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "roomId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "date",
        "lessonNumber",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/lessons/:id/restore": {
    "name": "DayChangesController_restore",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/restore",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "roomId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/timetable/lessons/:id/room": {
    "name": "DayChangesController_room",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/room",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "roomId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "roomId",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/lessons/:id/substitute": {
    "name": "SubstitutionsController_substitute",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/substitute",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "teacherId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "confirm": {
          "type": "boolean"
        }
      },
      "required": [
        "teacherId",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/lessons/:id/substitution/withdraw": {
    "name": "SubstitutionsController_withdraw",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/substitution/withdraw",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/load": {
    "name": "TimetableController_createRow",
    "method": "POST",
    "path": "/api/timetable/versions/:id/load",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "teacherId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "lessonsPerWeek": {
          "type": "integer",
          "minimum": 1,
          "maximum": 40
        },
        "roomId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "roomType": {
          "nullable": true,
          "type": "string",
          "enum": [
            "classroom",
            "laboratory",
            "sports_hall",
            "hall",
            "other"
          ]
        },
        "doubleLessons": {
          "type": "boolean"
        },
        "shortReason": {
          "nullable": true,
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "classId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "groupId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "mixedBlock": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "teacherId",
        "lessonsPerWeek",
        "roomId",
        "roomType",
        "doubleLessons",
        "classId",
        "groupId",
        "subjectId"
      ]
    }
  },
  "PUT /api/classes/:id": {
    "name": "ClassesController_edit",
    "method": "PUT",
    "path": "/api/classes/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "grade": {
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "name": {
          "type": "string",
          "minLength": 2,
          "maxLength": 40,
          "pattern": "^\\p{L}[\\p{L}0-9 '\\u02BB\\u02BC-]*$"
        },
        "language": {
          "type": "string",
          "enum": [
            "uz",
            "ru"
          ]
        },
        "mainRoomId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "maxSize": {
          "type": "integer",
          "minimum": 1,
          "maximum": 60
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "confirmMixedGroups": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "grade",
        "name",
        "language",
        "mainRoomId",
        "maxSize",
        "version"
      ]
    }
  },
  "PUT /api/groups/:id": {
    "name": "GroupsController_edit",
    "method": "PUT",
    "path": "/api/groups/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "classIds": {
          "minItems": 1,
          "maxItems": 40,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 40,
          "pattern": "^[\\p{L}0-9][\\p{L}0-9 'ʻʼ-]*$"
        },
        "language": {
          "nullable": true,
          "type": "string",
          "enum": [
            "uz",
            "ru"
          ]
        },
        "maxSize": {
          "type": "integer",
          "minimum": 1,
          "maximum": 60
        },
        "sex": {
          "nullable": true,
          "type": "string",
          "enum": [
            "male",
            "female"
          ]
        },
        "confirmMixedLanguage": {
          "default": false,
          "type": "boolean"
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "classIds",
        "name",
        "language",
        "maxSize",
        "sex",
        "version"
      ]
    }
  },
  "PUT /api/people/staff/:id/availability": {
    "name": "AvailabilityController_set",
    "method": "PUT",
    "path": "/api/people/staff/:id/availability",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "ranges": {
          "maxItems": 35,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "weekday": {
                "anyOf": [
                  {
                    "type": "number",
                    "enum": [
                      1
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      2
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      3
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      4
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      5
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      6
                    ]
                  },
                  {
                    "type": "number",
                    "enum": [
                      7
                    ]
                  }
                ]
              },
              "start": {
                "type": "string",
                "pattern": "^([01]\\d|2[0-3]):[0-5]\\d$"
              },
              "end": {
                "type": "string",
                "pattern": "^(([01]\\d|2[0-3]):[0-5]\\d|24:00)$"
              }
            },
            "required": [
              "weekday",
              "start",
              "end"
            ]
          }
        }
      },
      "required": [
        "from",
        "ranges"
      ]
    }
  },
  "PUT /api/people/staff/:id/teaching": {
    "name": "StaffController_teaching",
    "method": "PUT",
    "path": "/api/people/staff/:id/teaching",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "subjects": {
          "maxItems": 30,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subjectId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "grades": {
                "minItems": 1,
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                }
              }
            },
            "required": [
              "subjectId",
              "grades"
            ]
          }
        },
        "languages": {
          "maxItems": 2,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "uz",
              "ru"
            ]
          }
        }
      },
      "required": [
        "subjects",
        "languages"
      ]
    }
  },
  "PUT /api/people/students/:id/uid": {
    "name": "StudentsController_correctUid",
    "method": "PUT",
    "path": "/api/people/students/:id/uid",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "uid": {
          "type": "string"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "uid",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/people/vacancies/:id": {
    "name": "VacanciesController_edit",
    "method": "PUT",
    "path": "/api/people/vacancies/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "departmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "subjects": {
          "maxItems": 30,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subjectId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "grades": {
                "minItems": 1,
                "type": "array",
                "items": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 11
                }
              }
            },
            "required": [
              "subjectId",
              "grades"
            ]
          }
        },
        "languages": {
          "maxItems": 2,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "uz",
              "ru"
            ]
          }
        },
        "weeklyLessons": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 60
        },
        "dailyLessons": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        }
      },
      "required": [
        "name",
        "departmentId",
        "subjects",
        "languages",
        "weeklyLessons",
        "dailyLessons"
      ]
    }
  },
  "PUT /api/plans/items/:itemId": {
    "name": "PlansController_saveItem",
    "method": "PUT",
    "path": "/api/plans/items/:itemId",
    "parameters": [
      {
        "name": "itemId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "base": {
          "type": "object",
          "properties": {
            "topic": {
              "type": "string"
            },
            "objectives": {
              "type": "string"
            },
            "links": {
              "type": "array",
              "items": {
                "type": "string"
              }
            },
            "classworks": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "title": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "title",
                  "description"
                ],
                "additionalProperties": false
              }
            },
            "homeworks": {
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "title": {
                    "type": "string"
                  },
                  "description": {
                    "type": "string"
                  }
                },
                "required": [
                  "id",
                  "title",
                  "description"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "topic",
            "objectives",
            "links",
            "classworks",
            "homeworks"
          ],
          "additionalProperties": false
        },
        "values": {
          "type": "object",
          "properties": {
            "topic": {
              "type": "string",
              "maxLength": 300
            },
            "objectives": {
              "type": "string",
              "maxLength": 2000
            },
            "links": {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "string",
                "maxLength": 500,
                "pattern": "^https?:\\/\\/[^\\s]+$"
              }
            },
            "classworks": {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "title": {
                    "type": "string",
                    "maxLength": 60
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 1000
                  }
                },
                "required": [
                  "title",
                  "description"
                ],
                "additionalProperties": false
              }
            },
            "homeworks": {
              "maxItems": 10,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "id": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "title": {
                    "type": "string",
                    "maxLength": 60
                  },
                  "description": {
                    "type": "string",
                    "maxLength": 1000
                  }
                },
                "required": [
                  "title",
                  "description"
                ],
                "additionalProperties": false
              }
            }
          },
          "required": [
            "topic",
            "objectives",
            "links",
            "classworks",
            "homeworks"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "base",
        "values"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/plans/windows/:quarterId": {
    "name": "PlanWindowsController_save",
    "method": "PUT",
    "path": "/api/plans/windows/:quarterId",
    "parameters": [
      {
        "name": "quarterId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "startDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "confirm": {
          "type": "boolean"
        }
      },
      "required": [
        "startDate",
        "endDate"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/setup/academic-years/:id": {
    "name": "AcademicYearsController_edit",
    "method": "PUT",
    "path": "/api/setup/academic-years/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "startDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "startDate",
        "endDate"
      ]
    }
  },
  "PUT /api/setup/academic-years/:id/quarters": {
    "name": "AcademicYearsController_saveQuarters",
    "method": "PUT",
    "path": "/api/setup/academic-years/:id/quarters",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "quarters": {
          "minItems": 4,
          "maxItems": 4,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "startDate": {
                "nullable": true,
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              },
              "endDate": {
                "nullable": true,
                "type": "string",
                "format": "date",
                "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
              }
            },
            "required": [
              "startDate",
              "endDate"
            ]
          }
        },
        "days": {
          "type": "object",
          "properties": {
            "dayChangesKey": {
              "type": "string",
              "pattern": "^[0-9a-f]{64}$"
            },
            "dayDecisions": {
              "maxItems": 2000,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "key": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "blockDate": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "drop",
                      "cancel",
                      "keep"
                    ]
                  },
                  "reason": {
                    "type": "string",
                    "minLength": 1,
                    "maxLength": 500
                  }
                },
                "required": [
                  "key",
                  "choice"
                ],
                "additionalProperties": false
              }
            },
            "dayKeeps": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "date": {
                    "type": "string",
                    "format": "date",
                    "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
                  },
                  "slotPositions": {
                    "maxItems": 20,
                    "type": "array",
                    "items": {
                      "type": "integer",
                      "minimum": 1,
                      "maximum": 20
                    }
                  }
                },
                "required": [
                  "classId",
                  "date",
                  "slotPositions"
                ],
                "additionalProperties": false
              }
            },
            "examBlocks": {
              "maxItems": 500,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "examId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "classId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "start": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 1440
                  },
                  "choice": {
                    "type": "string",
                    "enum": [
                      "cancel",
                      "keep"
                    ]
                  }
                },
                "required": [
                  "examId",
                  "classId",
                  "start",
                  "choice"
                ],
                "additionalProperties": false
              }
            }
          },
          "additionalProperties": false
        }
      },
      "required": [
        "quarters"
      ]
    }
  },
  "PUT /api/setup/buildings/:id": {
    "name": "BuildingsController_rename",
    "method": "PUT",
    "path": "/api/setup/buildings/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        }
      },
      "required": [
        "name"
      ]
    }
  },
  "PUT /api/setup/floors/:id": {
    "name": "BuildingsController_renameFloor",
    "method": "PUT",
    "path": "/api/setup/floors/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 50
        }
      },
      "required": [
        "name"
      ]
    }
  },
  "PUT /api/setup/rooms/:id": {
    "name": "RoomsController_edit",
    "method": "PUT",
    "path": "/api/setup/rooms/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 50
        },
        "floorId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "type": {
          "type": "string",
          "enum": [
            "classroom",
            "laboratory",
            "sports_hall",
            "hall",
            "other"
          ]
        },
        "capacity": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        },
        "status": {
          "type": "string",
          "enum": [
            "in_use",
            "under_repair",
            "closed"
          ]
        },
        "shared": {
          "type": "boolean"
        },
        "maxSimultaneousLessons": {
          "nullable": true,
          "type": "integer",
          "minimum": 2,
          "maximum": 10
        }
      },
      "required": [
        "name",
        "floorId",
        "type",
        "capacity",
        "status",
        "shared",
        "maxSimultaneousLessons"
      ]
    }
  },
  "PUT /api/setup/subjects/:id": {
    "name": "SubjectsController_edit",
    "method": "PUT",
    "path": "/api/setup/subjects/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "names": {
          "type": "object",
          "properties": {
            "uz": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            },
            "ru": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            },
            "en": {
              "type": "string",
              "minLength": 1,
              "maxLength": 100
            }
          },
          "required": [
            "uz",
            "ru",
            "en"
          ]
        },
        "departmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "grades": {
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 0,
            "maximum": 11
          }
        },
        "colour": {
          "type": "string",
          "enum": [
            "red",
            "orange",
            "amber",
            "lime",
            "green",
            "teal",
            "cyan",
            "blue",
            "indigo",
            "violet",
            "pink",
            "brown"
          ]
        },
        "journalType": {
          "type": "string",
          "enum": [
            "graded",
            "attendance_only"
          ]
        },
        "ratingExam": {
          "type": "boolean"
        },
        "groupSubject": {
          "type": "boolean"
        },
        "languageRule": {
          "type": "boolean"
        },
        "demanding": {
          "type": "boolean"
        },
        "daily": {
          "nullable": true,
          "type": "object",
          "properties": {
            "attendance": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            "classwork": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            },
            "homework": {
              "type": "integer",
              "minimum": 1,
              "maximum": 100
            }
          },
          "required": [
            "attendance",
            "classwork",
            "homework"
          ]
        },
        "departmentStartsOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "switchesFrom": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 4
        }
      },
      "required": [
        "names",
        "departmentId",
        "grades",
        "colour",
        "journalType",
        "ratingExam",
        "groupSubject",
        "languageRule",
        "demanding",
        "daily"
      ]
    }
  },
  "PUT /api/setup/subjects/:id/daily-weights": {
    "name": "SubjectsController_setDaily",
    "method": "PUT",
    "path": "/api/setup/subjects/:id/daily-weights",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "attendance": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "classwork": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "homework": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        }
      },
      "required": [
        "attendance",
        "classwork",
        "homework"
      ]
    }
  },
  "PUT /api/setup/subjects/:id/quarter-weights/:quarterId": {
    "name": "SubjectsController_setQuarterWeights",
    "method": "PUT",
    "path": "/api/setup/subjects/:id/quarter-weights/:quarterId",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "quarterId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "attendance": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "classwork": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "homework": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "ratingExam": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "attendance",
        "classwork",
        "homework",
        "ratingExam"
      ]
    }
  },
  "PUT /api/timetable/exams/:id": {
    "name": "ExamsController_change",
    "method": "PUT",
    "path": "/api/timetable/exams/:id",
    "parameters": [
      {
        "name": "id",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "date": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "firstLesson": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "lastLesson": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        },
        "subjectId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "rooms": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "roomId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "classIds": {
                "maxItems": 60,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "groupIds": {
                "maxItems": 60,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "invigilatorIds": {
                "minItems": 1,
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              }
            },
            "required": [
              "roomId",
              "classIds",
              "groupIds",
              "invigilatorIds"
            ],
            "additionalProperties": false
          }
        },
        "blockChoices": {
          "default": [],
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "classId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "cancel",
                  "keep"
                ]
              }
            },
            "required": [
              "classId",
              "blockId",
              "choice"
            ],
            "additionalProperties": false
          }
        },
        "ratingExam": {
          "default": false,
          "type": "boolean"
        },
        "confirm": {
          "default": false,
          "type": "boolean"
        },
        "keepCancelled": {
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "keepReason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "date",
        "firstLesson",
        "lastLesson",
        "title",
        "subjectId",
        "rooms"
      ],
      "additionalProperties": false
    }
  }
};
