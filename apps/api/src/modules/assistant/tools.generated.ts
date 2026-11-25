// Written by `pnpm api:client` from openapi.generated.json (src/openapi/assistant-tools.ts).
// Do not edit: `assistant-tools.test.ts` fails when this is not what it writes.
import type { GeneratedTool } from './tools.js';

export const GENERATED_TOOLS: Readonly<Record<string, GeneratedTool>> = {
  "DELETE /api/exemptions/:id/document": {
    "name": "ExemptionsController_removeDocument",
    "method": "DELETE",
    "path": "/api/exemptions/:id/document",
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
  "DELETE /api/feedback-reports/:id/handled": {
    "name": "FeedbackReportsController_reopened",
    "method": "DELETE",
    "path": "/api/feedback-reports/:id/handled",
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
  "DELETE /api/journal/lessons/:lessonId/plan-works/:planWorkId": {
    "name": "WorksController_removePlanWork",
    "method": "DELETE",
    "path": "/api/journal/lessons/:lessonId/plan-works/:planWorkId",
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
      },
      {
        "name": "planWorkId",
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
  "DELETE /api/journal/lessons/:lessonId/works/:workId": {
    "name": "WorksController_remove",
    "method": "DELETE",
    "path": "/api/journal/lessons/:lessonId/works/:workId",
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
      },
      {
        "name": "workId",
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
  "DELETE /api/journal/student-absences/:studentId/:date/file": {
    "name": "StudentAbsencesController_removeFile",
    "method": "DELETE",
    "path": "/api/journal/student-absences/:studentId/:date/file",
    "parameters": [
      {
        "name": "studentId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "date",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      }
    ]
  },
  "DELETE /api/people/staff/:id/photo": {
    "name": "StaffPhotosController_removePhoto",
    "method": "DELETE",
    "path": "/api/people/staff/:id/photo",
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
  "DELETE /api/people/students/:id/photo": {
    "name": "StudentPhotosController_removePhoto",
    "method": "DELETE",
    "path": "/api/people/students/:id/photo",
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
  "DELETE /api/plans/files/:fileId": {
    "name": "PlansController_removeFile",
    "method": "DELETE",
    "path": "/api/plans/files/:fileId",
    "parameters": [
      {
        "name": "fileId",
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
  "DELETE /api/timetable/versions/:id/locks/:lockId": {
    "name": "TimetableController_deleteLock",
    "method": "DELETE",
    "path": "/api/timetable/versions/:id/locks/:lockId",
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
        "name": "lockId",
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
  "DELETE /api/timetable/versions/:id/pattern/:blockId": {
    "name": "TimetableController_removeBlock",
    "method": "DELETE",
    "path": "/api/timetable/versions/:id/pattern/:blockId",
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
        "name": "blockId",
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
  "DELETE /api/timetable/versions/:id/pins/:pinId": {
    "name": "TimetableController_deletePin",
    "method": "DELETE",
    "path": "/api/timetable/versions/:id/pins/:pinId",
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
        "name": "pinId",
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
  "GET /api/access/branches-without-vice-principal": {
    "name": "StaffAccountsController_branchesWithoutVice",
    "method": "GET",
    "path": "/api/access/branches-without-vice-principal",
    "parameters": []
  },
  "GET /api/access/head-teachers": {
    "name": "HeadTeachersController_list",
    "method": "GET",
    "path": "/api/access/head-teachers",
    "parameters": []
  },
  "GET /api/access/super-admins": {
    "name": "StaffAccountsController_superAdmins",
    "method": "GET",
    "path": "/api/access/super-admins",
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
  "GET /api/announcements-feed": {
    "name": "AnnouncementsController_addressed",
    "method": "GET",
    "path": "/api/announcements-feed",
    "parameters": [
      {
        "name": "month",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "pattern": "^\\d{4}-(?:0[1-9]|1[0-2])$"
        }
      }
    ]
  },
  "GET /api/audit/entries": {
    "name": "AuditLogController_list",
    "method": "GET",
    "path": "/api/audit/entries",
    "parameters": [
      {
        "name": "person",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "pattern": "^(staff|student|relative):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
        }
      },
      {
        "name": "recordType",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "maxLength": 40,
          "pattern": "^[a-z_]+$"
        }
      },
      {
        "name": "recordId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "from",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "to",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "group",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "sign_in",
            "accounts",
            "setup",
            "people",
            "classes",
            "timetable",
            "journal",
            "plans",
            "exports",
            "announcements",
            "feedback",
            "integration_keys",
            "assistant",
            "shows"
          ]
        }
      },
      {
        "name": "scope",
        "in": "query",
        "required": false,
        "schema": {
          "default": "branch",
          "type": "string",
          "enum": [
            "branch",
            "all",
            "school"
          ]
        }
      },
      {
        "name": "before",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "pattern": "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$"
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
  "GET /api/classes/seats": {
    "name": "ClassesController_seats",
    "method": "GET",
    "path": "/api/classes/seats",
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
      }
    ]
  },
  "GET /api/classes/tutor-candidates": {
    "name": "ClassesController_candidates",
    "method": "GET",
    "path": "/api/classes/tutor-candidates",
    "parameters": []
  },
  "GET /api/digest-log": {
    "name": "DigestController_log",
    "method": "GET",
    "path": "/api/digest-log",
    "parameters": [
      {
        "name": "from",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "to",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "status",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "due",
            "nothing",
            "delivered",
            "blocked",
            "failed",
            "no_chat"
          ]
        }
      },
      {
        "name": "page",
        "in": "query",
        "required": false,
        "schema": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10000
        }
      }
    ]
  },
  "GET /api/exemptions": {
    "name": "ExemptionsController_list",
    "method": "GET",
    "path": "/api/exemptions",
    "parameters": [
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
        "name": "kind",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "temporary",
            "full"
          ]
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
        "name": "studentId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "batchId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "state",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "in_force",
            "ending_this_week",
            "coming",
            "ended",
            "voided",
            "all"
          ]
        }
      }
    ]
  },
  "GET /api/exemptions/:id": {
    "name": "ExemptionsController_one",
    "method": "GET",
    "path": "/api/exemptions/:id",
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
  "GET /api/exemptions/:id/document": {
    "name": "ExemptionsController_document",
    "method": "GET",
    "path": "/api/exemptions/:id/document",
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
  "GET /api/exemptions/:id/reason": {
    "name": "ExemptionsController_reason",
    "method": "GET",
    "path": "/api/exemptions/:id/reason",
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
  "GET /api/exemptions/absences-without": {
    "name": "ExemptionsController_absencesWithout",
    "method": "GET",
    "path": "/api/exemptions/absences-without",
    "parameters": []
  },
  "GET /api/exemptions/move-offers": {
    "name": "ExemptionsController_offers",
    "method": "GET",
    "path": "/api/exemptions/move-offers",
    "parameters": []
  },
  "GET /api/exemptions/move-offers/:id/reason": {
    "name": "ExemptionsController_offerReason",
    "method": "GET",
    "path": "/api/exemptions/move-offers/:id/reason",
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
  "GET /api/feedback-reports": {
    "name": "FeedbackReportsController_list",
    "method": "GET",
    "path": "/api/feedback-reports",
    "parameters": []
  },
  "GET /api/forced-deletes": {
    "name": "ForcedDeletesController_list",
    "method": "GET",
    "path": "/api/forced-deletes",
    "parameters": []
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
  "GET /api/groups/placement": {
    "name": "GroupsController_placementBoard",
    "method": "GET",
    "path": "/api/groups/placement",
    "parameters": [
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
        "name": "grades",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "maxLength": 5
        }
      },
      {
        "name": "on",
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
  "GET /api/groups/slot-check": {
    "name": "GroupsController_slotCheck",
    "method": "GET",
    "path": "/api/groups/slot-check",
    "parameters": [
      {
        "name": "classIds",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "maxLength": 1480
        }
      }
    ]
  },
  "GET /api/integration-keys": {
    "name": "IntegrationKeysController_list",
    "method": "GET",
    "path": "/api/integration-keys",
    "parameters": []
  },
  "GET /api/integration-keys/choices": {
    "name": "IntegrationKeysController_choices",
    "method": "GET",
    "path": "/api/integration-keys/choices",
    "parameters": []
  },
  "GET /api/journal/attendance-today": {
    "name": "AttendanceTodayController_read",
    "method": "GET",
    "path": "/api/journal/attendance-today",
    "parameters": []
  },
  "GET /api/journal/comments/history": {
    "name": "CommentsController_history",
    "method": "GET",
    "path": "/api/journal/comments/history",
    "parameters": [
      {
        "name": "target",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "mark",
            "work",
            "note",
            "rating"
          ]
        }
      },
      {
        "name": "studentId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "lessonId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "workId",
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
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
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
  "GET /api/journal/discipline/items": {
    "name": "LessonStatusController_disciplineItems",
    "method": "GET",
    "path": "/api/journal/discipline/items",
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
      },
      {
        "name": "teacherId",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "column",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "held",
            "notStarted",
            "inProgress",
            "complete",
            "lockedIncomplete",
            "noAttendance",
            "noTopic",
            "worksMissing",
            "unplanned",
            "lateEntries"
          ]
        }
      }
    ]
  },
  "GET /api/journal/exemptions-today": {
    "name": "ExemptionsTodayController_today",
    "method": "GET",
    "path": "/api/journal/exemptions-today",
    "parameters": []
  },
  "GET /api/journal/exports": {
    "name": "JournalExportsController_list",
    "method": "GET",
    "path": "/api/journal/exports",
    "parameters": []
  },
  "GET /api/journal/exports/:exportId/file": {
    "name": "JournalExportsController_download",
    "method": "GET",
    "path": "/api/journal/exports/:exportId/file",
    "parameters": [
      {
        "name": "exportId",
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
  "GET /api/journal/extensions": {
    "name": "UnlocksController_listExtensions",
    "method": "GET",
    "path": "/api/journal/extensions",
    "parameters": []
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
  "GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history": {
    "name": "RatingController_history",
    "method": "GET",
    "path": "/api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history",
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
      },
      {
        "name": "studentId",
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
  "GET /api/journal/lessons/:lessonId/students/:studentId/history": {
    "name": "AttendanceController_history",
    "method": "GET",
    "path": "/api/journal/lessons/:lessonId/students/:studentId/history",
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
      },
      {
        "name": "studentId",
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
  "GET /api/journal/orphans": {
    "name": "LessonStatusController_orphans",
    "method": "GET",
    "path": "/api/journal/orphans",
    "parameters": []
  },
  "GET /api/journal/reminders": {
    "name": "LessonStatusController_reminders",
    "method": "GET",
    "path": "/api/journal/reminders",
    "parameters": []
  },
  "GET /api/journal/student-absences": {
    "name": "StudentAbsencesController_list",
    "method": "GET",
    "path": "/api/journal/student-absences",
    "parameters": [
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
        "name": "from",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "to",
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
  "GET /api/journal/student-absences/:studentId/:date/file": {
    "name": "StudentAbsencesController_readFile",
    "method": "GET",
    "path": "/api/journal/student-absences/:studentId/:date/file",
    "parameters": [
      {
        "name": "studentId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "date",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      }
    ]
  },
  "GET /api/journal/support": {
    "name": "SupportViewController_read",
    "method": "GET",
    "path": "/api/journal/support",
    "parameters": [
      {
        "name": "studentId",
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
      },
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
  "GET /api/people/accounts/never-used": {
    "name": "AccountAccessController_neverUsed",
    "method": "GET",
    "path": "/api/people/accounts/never-used",
    "parameters": []
  },
  "GET /api/people/accounts/reset-entries": {
    "name": "AccountAccessController_resetEntriesReport",
    "method": "GET",
    "path": "/api/people/accounts/reset-entries",
    "parameters": [
      {
        "name": "from",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "to",
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
  "GET /api/people/branch-moves/:id/groups": {
    "name": "BranchMovesController_groups",
    "method": "GET",
    "path": "/api/people/branch-moves/:id/groups",
    "parameters": [
      {
        "name": "classId",
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
  "GET /api/people/branch-moves/incoming": {
    "name": "BranchMovesController_incoming",
    "method": "GET",
    "path": "/api/people/branch-moves/incoming",
    "parameters": []
  },
  "GET /api/people/branch-moves/targets": {
    "name": "BranchMovesController_targets",
    "method": "GET",
    "path": "/api/people/branch-moves/targets",
    "parameters": []
  },
  "GET /api/people/classes/:classId/parent-slips": {
    "name": "ParentAccountsController_slipList",
    "method": "GET",
    "path": "/api/people/classes/:classId/parent-slips",
    "parameters": [
      {
        "name": "classId",
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
  "GET /api/people/parent-accounts/never-used": {
    "name": "ParentAccountsController_neverUsed",
    "method": "GET",
    "path": "/api/people/parent-accounts/never-used",
    "parameters": []
  },
  "GET /api/people/parents/:relativeId/account": {
    "name": "ParentAccountsController_account",
    "method": "GET",
    "path": "/api/people/parents/:relativeId/account",
    "parameters": [
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
    ]
  },
  "GET /api/people/relatives": {
    "name": "RelativesController_list",
    "method": "GET",
    "path": "/api/people/relatives",
    "parameters": [
      {
        "name": "filter",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "no_valid_phone"
          ]
        }
      },
      {
        "name": "search",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "maxLength": 120
        }
      },
      {
        "name": "phone",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string"
        }
      }
    ]
  },
  "GET /api/people/relatives/:id": {
    "name": "RelativesController_detail",
    "method": "GET",
    "path": "/api/people/relatives/:id",
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
  "GET /api/people/relatives/no-valid-phone": {
    "name": "RelativesController_noValidPhone",
    "method": "GET",
    "path": "/api/people/relatives/no-valid-phone",
    "parameters": []
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
  "GET /api/people/staff/:id/account": {
    "name": "StaffAccountsController_read",
    "method": "GET",
    "path": "/api/people/staff/:id/account",
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
  "GET /api/people/staff/:id/account/access": {
    "name": "AccountAccessController_read",
    "method": "GET",
    "path": "/api/people/staff/:id/account/access",
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
  "GET /api/people/staff/:id/account/suggestion": {
    "name": "StaffAccountsController_suggestion",
    "method": "GET",
    "path": "/api/people/staff/:id/account/suggestion",
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
  "GET /api/people/staff/:id/photo": {
    "name": "StaffPhotosController_readPhoto",
    "method": "GET",
    "path": "/api/people/staff/:id/photo",
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
  "GET /api/people/staff/import-template": {
    "name": "StaffController_importTemplate",
    "method": "GET",
    "path": "/api/people/staff/import-template",
    "parameters": [
      {
        "name": "language",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "uz",
            "ru",
            "en"
          ]
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
  "GET /api/people/students/:id/history": {
    "name": "StudentHistoryController_history",
    "method": "GET",
    "path": "/api/people/students/:id/history",
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
  "GET /api/people/students/:id/leaving-results": {
    "name": "LeavingResultsController_read",
    "method": "GET",
    "path": "/api/people/students/:id/leaving-results",
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
  "GET /api/people/students/:id/merge": {
    "name": "StudentMergesController_preview",
    "method": "GET",
    "path": "/api/people/students/:id/merge",
    "parameters": [
      {
        "name": "uid",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string"
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
  "GET /api/people/students/:id/photo": {
    "name": "StudentPhotosController_readPhoto",
    "method": "GET",
    "path": "/api/people/students/:id/photo",
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
  "GET /api/people/students/import-template": {
    "name": "StudentsController_importTemplate",
    "method": "GET",
    "path": "/api/people/students/import-template",
    "parameters": [
      {
        "name": "language",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "uz",
            "ru",
            "en"
          ]
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
  "GET /api/plans/files/:fileId": {
    "name": "PlansController_readFile",
    "method": "GET",
    "path": "/api/plans/files/:fileId",
    "parameters": [
      {
        "name": "fileId",
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
  "GET /api/plans/masters": {
    "name": "PlanMastersController_list",
    "method": "GET",
    "path": "/api/plans/masters",
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
        "name": "grade",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "pattern": "^(?:[0-9]|1[01])$"
        }
      },
      {
        "name": "quarter",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "pattern": "^[1-4]$"
        }
      },
      {
        "name": "journalId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
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
  "GET /api/plans/masters/:masterId": {
    "name": "PlanMastersController_master",
    "method": "GET",
    "path": "/api/plans/masters/:masterId",
    "parameters": [
      {
        "name": "masterId",
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
  "GET /api/plans/minimums": {
    "name": "PlanMinimumsController_list",
    "method": "GET",
    "path": "/api/plans/minimums",
    "parameters": []
  },
  "GET /api/plans/parallel": {
    "name": "PlanMastersController_parallel",
    "method": "GET",
    "path": "/api/plans/parallel",
    "parameters": [
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
        "required": true,
        "schema": {
          "type": "string",
          "pattern": "^(?:[0-9]|1[01])$"
        }
      },
      {
        "name": "quarterId",
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
  "GET /api/plans/reports/requests": {
    "name": "PlanReportsController_requests",
    "method": "GET",
    "path": "/api/plans/reports/requests",
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
  "GET /api/results/closing": {
    "name": "ClosingController_checklist",
    "method": "GET",
    "path": "/api/results/closing",
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
  "GET /api/results/closing/:quarterId/recalculation": {
    "name": "ClosingController_recalculation",
    "method": "GET",
    "path": "/api/results/closing/:quarterId/recalculation",
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
  "GET /api/results/students/:id/attendance": {
    "name": "StudentResultsController_attendance",
    "method": "GET",
    "path": "/api/results/students/:id/attendance",
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
  "GET /api/results/students/:id/lessons": {
    "name": "StudentResultsController_lessons",
    "method": "GET",
    "path": "/api/results/students/:id/lessons",
    "parameters": [
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
  "GET /api/results/students/:id/tabs": {
    "name": "StudentResultsController_tabs",
    "method": "GET",
    "path": "/api/results/students/:id/tabs",
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
  "GET /api/search/relatives": {
    "name": "PeopleSearchController_findRelatives",
    "method": "GET",
    "path": "/api/search/relatives",
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
  "GET /api/setup/attendance-values": {
    "name": "SettingsController_listAttendanceValues",
    "method": "GET",
    "path": "/api/setup/attendance-values",
    "parameters": []
  },
  "GET /api/setup/branch": {
    "name": "BranchesController_read",
    "method": "GET",
    "path": "/api/setup/branch",
    "parameters": []
  },
  "GET /api/setup/branches": {
    "name": "BranchesController_list",
    "method": "GET",
    "path": "/api/setup/branches",
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
  "GET /api/setup/day-template-table": {
    "name": "DayTemplatesController_table",
    "method": "GET",
    "path": "/api/setup/day-template-table",
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
  "GET /api/setup/day-templates": {
    "name": "DayTemplatesController_listTemplates",
    "method": "GET",
    "path": "/api/setup/day-templates",
    "parameters": []
  },
  "GET /api/setup/day-templates/:id": {
    "name": "DayTemplatesController_template",
    "method": "GET",
    "path": "/api/setup/day-templates/:id",
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
  "GET /api/setup/demo-clock": {
    "name": "DemoClockController_read",
    "method": "GET",
    "path": "/api/setup/demo-clock",
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
  "GET /api/setup/school-settings/digest": {
    "name": "DigestController_settings",
    "method": "GET",
    "path": "/api/setup/school-settings/digest",
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
  "GET /api/setup/subjects/import-template": {
    "name": "SubjectsController_importTemplate",
    "method": "GET",
    "path": "/api/setup/subjects/import-template",
    "parameters": [
      {
        "name": "language",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "uz",
            "ru",
            "en"
          ]
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
  "GET /api/system-status": {
    "name": "SystemStatusController_own",
    "method": "GET",
    "path": "/api/system-status",
    "parameters": []
  },
  "GET /api/system-status/providers": {
    "name": "SystemStatusController_providers",
    "method": "GET",
    "path": "/api/system-status/providers",
    "parameters": [
      {
        "name": "period",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "24h",
            "7d",
            "14d"
          ]
        }
      }
    ]
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
  "GET /api/timetable/absences/:id/journals/:journalId/substitutes": {
    "name": "JournalSubstitutionsController_absenceSubstitutes",
    "method": "GET",
    "path": "/api/timetable/absences/:id/journals/:journalId/substitutes",
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
  "GET /api/timetable/absences/:id/lessons": {
    "name": "AbsencesController_lessons",
    "method": "GET",
    "path": "/api/timetable/absences/:id/lessons",
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
  "GET /api/timetable/exams/:id": {
    "name": "ExamsController_one",
    "method": "GET",
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
    ]
  },
  "GET /api/timetable/history": {
    "name": "TimetableController_history",
    "method": "GET",
    "path": "/api/timetable/history",
    "parameters": [
      {
        "name": "academicYearId",
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
  "GET /api/timetable/home": {
    "name": "TeachingHomeController_home",
    "method": "GET",
    "path": "/api/timetable/home",
    "parameters": []
  },
  "GET /api/timetable/lessons/:id/correction-teachers": {
    "name": "DayChangesController_correctionTeachers",
    "method": "GET",
    "path": "/api/timetable/lessons/:id/correction-teachers",
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
  "GET /api/timetable/lessons/:id/substitutes": {
    "name": "SubstitutionsController_substitutes",
    "method": "GET",
    "path": "/api/timetable/lessons/:id/substitutes",
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
  "GET /api/timetable/room-closures/:id/lessons": {
    "name": "RoomClosuresController_lessons",
    "method": "GET",
    "path": "/api/timetable/room-closures/:id/lessons",
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
  "GET /api/timetable/vacancies/:id/journals/:journalId/substitutes": {
    "name": "JournalSubstitutionsController_vacancySubstitutes",
    "method": "GET",
    "path": "/api/timetable/vacancies/:id/journals/:journalId/substitutes",
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
        "name": "until",
        "in": "query",
        "required": false,
        "schema": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
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
  "GET /api/timetable/versions": {
    "name": "TimetableController_list",
    "method": "GET",
    "path": "/api/timetable/versions",
    "parameters": []
  },
  "GET /api/timetable/versions/:id/compare": {
    "name": "TimetableController_compare",
    "method": "GET",
    "path": "/api/timetable/versions/:id/compare",
    "parameters": [
      {
        "name": "with",
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
  "GET /api/timetable/versions/:id/grid": {
    "name": "TimetableController_grid",
    "method": "GET",
    "path": "/api/timetable/versions/:id/grid",
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
  "GET /api/timetable/versions/:id/load/import-template": {
    "name": "LoadImportsController_template",
    "method": "GET",
    "path": "/api/timetable/versions/:id/load/import-template",
    "parameters": [
      {
        "name": "language",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "uz",
            "ru",
            "en"
          ]
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
  "GET /api/timetable/versions/:id/load/teachers": {
    "name": "TimetableController_teachers",
    "method": "GET",
    "path": "/api/timetable/versions/:id/load/teachers",
    "parameters": [
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
        "name": "groupId",
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
  "GET /api/timetable/versions/:id/out-of-date": {
    "name": "TimetableController_outOfDate",
    "method": "GET",
    "path": "/api/timetable/versions/:id/out-of-date",
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
  "GET /api/timetable/versions/:id/pattern/import-template": {
    "name": "PatternImportsController_template",
    "method": "GET",
    "path": "/api/timetable/versions/:id/pattern/import-template",
    "parameters": [
      {
        "name": "language",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "enum": [
            "uz",
            "ru",
            "en"
          ]
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
  "GET /api/timetable/versions/:id/publish-check": {
    "name": "TimetableController_publishCheck",
    "method": "GET",
    "path": "/api/timetable/versions/:id/publish-check",
    "parameters": [
      {
        "name": "startsOn",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      {
        "name": "chain",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "enum": [
            "run_until",
            "replace",
            "carry"
          ]
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
  "GET /api/timetable/versions/:id/readiness": {
    "name": "TimetableController_readiness",
    "method": "GET",
    "path": "/api/timetable/versions/:id/readiness",
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
  "GET /api/timetable/versions/:id/totals": {
    "name": "TimetableController_totals",
    "method": "GET",
    "path": "/api/timetable/versions/:id/totals",
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
  "GET /api/timetable/versions/:id/withdraw-check": {
    "name": "TimetableController_withdrawCheck",
    "method": "GET",
    "path": "/api/timetable/versions/:id/withdraw-check",
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
  "PATCH /api/exemptions/:id": {
    "name": "ExemptionsController_edit",
    "method": "PATCH",
    "path": "/api/exemptions/:id",
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
            "temporary",
            "full"
          ]
        },
        "subjectIds": {
          "nullable": true,
          "minItems": 1,
          "maxItems": 30,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "startDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "slots": {
          "nullable": true,
          "type": "object",
          "properties": {
            "start": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            },
            "end": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            }
          },
          "required": [
            "start",
            "end"
          ],
          "additionalProperties": false
        },
        "category": {
          "type": "string",
          "enum": [
            "illness",
            "competition",
            "family",
            "school_event",
            "other"
          ]
        },
        "detail": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "version": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "kind",
        "subjectIds",
        "startDate",
        "endDate",
        "slots",
        "category",
        "detail",
        "version",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "PATCH /api/people/relatives/:id": {
    "name": "RelativesController_edit",
    "method": "PATCH",
    "path": "/api/people/relatives/:id",
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
        "fullName": {
          "type": "string"
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "workplace": {
          "nullable": true,
          "type": "string"
        },
        "email": {
          "nullable": true,
          "type": "string"
        },
        "extraPhones": {
          "maxItems": 3,
          "type": "array",
          "items": {
            "type": "string"
          }
        },
        "newOwner": {
          "nullable": true,
          "type": "object",
          "properties": {
            "previousId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "previousPhone": {
              "nullable": true,
              "type": "string"
            }
          },
          "required": [
            "previousId",
            "previousPhone"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "fullName",
        "phone",
        "workplace",
        "email",
        "extraPhones"
      ],
      "additionalProperties": false
    }
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
  "PATCH /api/plans/masters/:masterId": {
    "name": "PlanMastersController_rename",
    "method": "PATCH",
    "path": "/api/plans/masters/:masterId",
    "parameters": [
      {
        "name": "masterId",
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "name": {
          "type": "string",
          "maxLength": 60
        }
      },
      "required": [
        "revision",
        "name"
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
  "PATCH /api/timetable/room-closures/:id": {
    "name": "RoomClosuresController_edit",
    "method": "PATCH",
    "path": "/api/timetable/room-closures/:id",
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
  "PATCH /api/timetable/versions/:id": {
    "name": "TimetableController_editVersion",
    "method": "PATCH",
    "path": "/api/timetable/versions/:id",
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
        "dismissLeftRows": {
          "type": "boolean",
          "enum": [
            true
          ]
        }
      }
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
  "POST /api/announcements": {
    "name": "AnnouncementsController_create",
    "method": "POST",
    "path": "/api/announcements",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "kind": {
          "type": "string",
          "enum": [
            "news",
            "event"
          ]
        },
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "body": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        },
        "event": {
          "nullable": true,
          "type": "object",
          "properties": {
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
            "startsAt": {
              "nullable": true,
              "type": "string",
              "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"
            },
            "endsAt": {
              "nullable": true,
              "type": "string",
              "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"
            },
            "place": {
              "nullable": true,
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            }
          },
          "required": [
            "firstDate",
            "lastDate",
            "startsAt",
            "endsAt",
            "place"
          ],
          "additionalProperties": false
        },
        "audience": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "school"
                  ]
                }
              },
              "required": [
                "kind"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "branch"
                  ]
                }
              },
              "required": [
                "kind"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "grades"
                  ]
                },
                "grades": {
                  "minItems": 1,
                  "maxItems": 12,
                  "type": "array",
                  "items": {
                    "type": "integer",
                    "minimum": 0,
                    "maximum": 11
                  }
                }
              },
              "required": [
                "kind",
                "grades"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "classes"
                  ]
                },
                "classIds": {
                  "minItems": 1,
                  "maxItems": 60,
                  "type": "array",
                  "items": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  }
                }
              },
              "required": [
                "kind",
                "classIds"
              ],
              "additionalProperties": false
            }
          ]
        },
        "forStaff": {
          "type": "boolean"
        },
        "forParents": {
          "type": "boolean"
        }
      },
      "required": [
        "kind",
        "title",
        "body",
        "event",
        "audience",
        "forStaff",
        "forParents"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/announcements/:id/archive": {
    "name": "AnnouncementsController_archive",
    "method": "POST",
    "path": "/api/announcements/:id/archive",
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
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/announcements/:id/restore": {
    "name": "AnnouncementsController_restore",
    "method": "POST",
    "path": "/api/announcements/:id/restore",
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
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/audit/entries/:id/show": {
    "name": "AuditLogController_show",
    "method": "POST",
    "path": "/api/audit/entries/:id/show",
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
  "POST /api/classes/:id/tutors": {
    "name": "ClassesController_give",
    "method": "POST",
    "path": "/api/classes/:id/tutors",
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
        "assignmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "kind": {
          "type": "string",
          "enum": [
            "tutor",
            "acting"
          ]
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "until": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "assignmentId",
        "kind",
        "from",
        "until"
      ]
    }
  },
  "POST /api/classes/:id/tutors/:tutorId/end": {
    "name": "ClassesController_end",
    "method": "POST",
    "path": "/api/classes/:id/tutors/:tutorId/end",
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
        "name": "tutorId",
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
        }
      },
      "required": [
        "from"
      ]
    }
  },
  "POST /api/classes/:id/tutors/preview": {
    "name": "ClassesController_previewGive",
    "method": "POST",
    "path": "/api/classes/:id/tutors/preview",
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
        "assignmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "kind": {
          "type": "string",
          "enum": [
            "tutor",
            "acting"
          ]
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "until": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "assignmentId",
        "kind",
        "from",
        "until"
      ]
    }
  },
  "POST /api/classes/export": {
    "name": "ClassesController_export",
    "method": "POST",
    "path": "/api/classes/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "year",
              "language",
              "tutor",
              "mainRoom",
              "students",
              "maxSize",
              "status"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
    }
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
  "POST /api/exemptions": {
    "name": "ExemptionsController_create",
    "method": "POST",
    "path": "/api/exemptions",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "studentIds": {
          "minItems": 1,
          "maxItems": 60,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "kind": {
          "type": "string",
          "enum": [
            "temporary",
            "full"
          ]
        },
        "subjectIds": {
          "nullable": true,
          "minItems": 1,
          "maxItems": 30,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "startDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "slots": {
          "nullable": true,
          "type": "object",
          "properties": {
            "start": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            },
            "end": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            }
          },
          "required": [
            "start",
            "end"
          ],
          "additionalProperties": false
        },
        "category": {
          "type": "string",
          "enum": [
            "illness",
            "competition",
            "family",
            "school_event",
            "other"
          ]
        },
        "detail": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "studentIds",
        "kind",
        "subjectIds",
        "startDate",
        "endDate",
        "slots",
        "category",
        "detail",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/:id/edit/preview": {
    "name": "ExemptionsController_editPreview",
    "method": "POST",
    "path": "/api/exemptions/:id/edit/preview",
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
            "temporary",
            "full"
          ]
        },
        "subjectIds": {
          "nullable": true,
          "minItems": 1,
          "maxItems": 30,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "startDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "slots": {
          "nullable": true,
          "type": "object",
          "properties": {
            "start": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            },
            "end": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            }
          },
          "required": [
            "start",
            "end"
          ],
          "additionalProperties": false
        },
        "category": {
          "type": "string",
          "enum": [
            "illness",
            "competition",
            "family",
            "school_event",
            "other"
          ]
        },
        "detail": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "version": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "kind",
        "subjectIds",
        "startDate",
        "endDate",
        "slots",
        "category",
        "detail",
        "version",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/:id/end": {
    "name": "ExemptionsController_end",
    "method": "POST",
    "path": "/api/exemptions/:id/end",
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
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "version": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "endDate",
        "version",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/:id/end/preview": {
    "name": "ExemptionsController_endPreview",
    "method": "POST",
    "path": "/api/exemptions/:id/end/preview",
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
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "version": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "endDate",
        "version",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/:id/void": {
    "name": "ExemptionsController_void",
    "method": "POST",
    "path": "/api/exemptions/:id/void",
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
          "minimum": 1,
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
  "POST /api/exemptions/:id/void/preview": {
    "name": "ExemptionsController_voidPreview",
    "method": "POST",
    "path": "/api/exemptions/:id/void/preview",
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
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/batches/:batchId/end": {
    "name": "ExemptionsController_batchEnd",
    "method": "POST",
    "path": "/api/exemptions/batches/:batchId/end",
    "parameters": [
      {
        "name": "batchId",
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
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "endDate",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/batches/:batchId/end/preview": {
    "name": "ExemptionsController_batchEndPreview",
    "method": "POST",
    "path": "/api/exemptions/batches/:batchId/end/preview",
    "parameters": [
      {
        "name": "batchId",
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
        "endDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "endDate",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/batches/:batchId/void": {
    "name": "ExemptionsController_batchVoid",
    "method": "POST",
    "path": "/api/exemptions/batches/:batchId/void",
    "parameters": [
      {
        "name": "batchId",
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
  "POST /api/exemptions/batches/:batchId/void/preview": {
    "name": "ExemptionsController_batchVoidPreview",
    "method": "POST",
    "path": "/api/exemptions/batches/:batchId/void/preview",
    "parameters": [
      {
        "name": "batchId",
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
  "POST /api/exemptions/move-offers/:id/confirm": {
    "name": "ExemptionsController_confirm",
    "method": "POST",
    "path": "/api/exemptions/move-offers/:id/confirm",
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
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/exemptions/move-offers/:id/confirm/preview": {
    "name": "ExemptionsController_confirmPreview",
    "method": "POST",
    "path": "/api/exemptions/move-offers/:id/confirm/preview",
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
  "POST /api/exemptions/move-offers/:id/drop": {
    "name": "ExemptionsController_drop",
    "method": "POST",
    "path": "/api/exemptions/move-offers/:id/drop",
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
  "POST /api/exemptions/preview": {
    "name": "ExemptionsController_preview",
    "method": "POST",
    "path": "/api/exemptions/preview",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "studentIds": {
          "minItems": 1,
          "maxItems": 60,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "kind": {
          "type": "string",
          "enum": [
            "temporary",
            "full"
          ]
        },
        "subjectIds": {
          "nullable": true,
          "minItems": 1,
          "maxItems": 30,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "startDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "endDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "slots": {
          "nullable": true,
          "type": "object",
          "properties": {
            "start": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            },
            "end": {
              "type": "string",
              "pattern": "^([01][0-9]|2[0-3]):[0-5][0-9]$"
            }
          },
          "required": [
            "start",
            "end"
          ],
          "additionalProperties": false
        },
        "category": {
          "type": "string",
          "enum": [
            "illness",
            "competition",
            "family",
            "school_event",
            "other"
          ]
        },
        "detail": {
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "choices": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "lessonId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "choice": {
                "type": "string",
                "enum": [
                  "keep",
                  "exempt"
                ]
              }
            },
            "required": [
              "studentId",
              "lessonId",
              "choice"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "studentIds",
        "kind",
        "subjectIds",
        "startDate",
        "endDate",
        "slots",
        "category",
        "detail",
        "choices"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/feedback-reports/:id/handled": {
    "name": "FeedbackReportsController_handled",
    "method": "POST",
    "path": "/api/feedback-reports/:id/handled",
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
  "POST /api/forced-deletes/:id/restore": {
    "name": "ForcedDeletesController_restore",
    "method": "POST",
    "path": "/api/forced-deletes/:id/restore",
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
      "properties": {},
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
  "POST /api/groups/export": {
    "name": "GroupsController_export",
    "method": "POST",
    "path": "/api/groups/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 7,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "subject",
              "classes",
              "language",
              "students",
              "maxSize",
              "status"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
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
  "POST /api/groups/transfers/:id/cancel": {
    "name": "GroupTransfersController_cancel",
    "method": "POST",
    "path": "/api/groups/transfers/:id/cancel",
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
      "properties": {},
      "additionalProperties": false
    }
  },
  "POST /api/groups/transfers/:id/change": {
    "name": "GroupTransfersController_change",
    "method": "POST",
    "path": "/api/groups/transfers/:id/change",
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
        "toGroupId",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/groups/transfers/:id/undo": {
    "name": "GroupTransfersController_undo",
    "method": "POST",
    "path": "/api/groups/transfers/:id/undo",
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
  "POST /api/integration-keys": {
    "name": "IntegrationKeysController_create",
    "method": "POST",
    "path": "/api/integration-keys",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "staffRecordIds": {
          "minItems": 1,
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "endsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "name",
        "staffRecordIds",
        "endsOn"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/integration-keys/:id/revoke": {
    "name": "IntegrationKeysController_revoke",
    "method": "POST",
    "path": "/api/integration-keys/:id/revoke",
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
  "POST /api/journal/discipline/export": {
    "name": "LessonStatusController_disciplineExport",
    "method": "POST",
    "path": "/api/journal/discipline/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "to": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "departmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "from",
        "to"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/exports": {
    "name": "JournalExportsController_requestBranch",
    "method": "POST",
    "path": "/api/journal/exports",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "format": {
          "type": "string",
          "enum": [
            "xlsx",
            "pdf"
          ]
        },
        "quarterId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "month": {
          "type": "string",
          "pattern": "^\\d{4}-(0[1-9]|1[0-2])$"
        }
      },
      "required": [
        "format",
        "quarterId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/extensions": {
    "name": "UnlocksController_extend",
    "method": "POST",
    "path": "/api/journal/extensions",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "fromDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "toDate": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "days": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "fromDate",
        "toDate",
        "days",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/journals/:journalId/export": {
    "name": "JournalExportsController_exportJournal",
    "method": "POST",
    "path": "/api/journal/journals/:journalId/export",
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
        "format": {
          "type": "string",
          "enum": [
            "xlsx",
            "pdf"
          ]
        },
        "quarterId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "month": {
          "type": "string",
          "pattern": "^\\d{4}-(0[1-9]|1[0-2])$"
        }
      },
      "required": [
        "format",
        "quarterId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/journals/:journalId/rating/:quarterId/entries": {
    "name": "RatingController_entry",
    "method": "POST",
    "path": "/api/journal/journals/:journalId/rating/:quarterId/entries",
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
        "studentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "entry": {
          "nullable": true,
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "score"
                  ]
                },
                "score": {
                  "type": "integer",
                  "minimum": 0,
                  "maximum": 100
                }
              },
              "required": [
                "kind",
                "score"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "did_not_sit"
                  ]
                }
              },
              "required": [
                "kind"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "kind": {
                  "type": "string",
                  "enum": [
                    "exempt"
                  ]
                }
              },
              "required": [
                "kind"
              ],
              "additionalProperties": false
            }
          ]
        },
        "reason": {
          "nullable": true,
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "correction": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "studentId",
        "entry",
        "reason",
        "version"
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
  "POST /api/journal/lessons/:lessonId/all-present": {
    "name": "AttendanceController_allPresent",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/all-present",
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
  "POST /api/journal/lessons/:lessonId/attendance": {
    "name": "AttendanceController_save",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/attendance",
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
        "saves": {
          "minItems": 1,
          "maxItems": 60,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "mark": {
                "nullable": true,
                "anyOf": [
                  {
                    "type": "number",
                    "enum": [
                      0
                    ]
                  },
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
                  }
                ]
              },
              "version": {
                "nullable": true,
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              "numbers": {
                "type": "string",
                "enum": [
                  "keep",
                  "clear"
                ]
              }
            },
            "required": [
              "studentId",
              "mark",
              "version"
            ],
            "additionalProperties": false
          }
        },
        "correction": {
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
      "required": [
        "saves"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/lessons/:lessonId/copy-attendance": {
    "name": "AttendanceController_copyAttendance",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/copy-attendance",
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
  "POST /api/journal/lessons/:lessonId/not-graded": {
    "name": "WorksController_notGraded",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/not-graded",
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
        "workIds": {
          "minItems": 1,
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "correction": {
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
      "additionalProperties": false
    }
  },
  "POST /api/journal/lessons/:lessonId/scores": {
    "name": "WorksController_scores",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/scores",
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
        "saves": {
          "minItems": 1,
          "maxItems": 600,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "column": {
                "anyOf": [
                  {
                    "type": "object",
                    "properties": {
                      "workId": {
                        "type": "string",
                        "format": "uuid",
                        "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                      }
                    },
                    "required": [
                      "workId"
                    ],
                    "additionalProperties": false
                  },
                  {
                    "type": "object",
                    "properties": {
                      "planWorkId": {
                        "type": "string",
                        "format": "uuid",
                        "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                      },
                      "sourceLessonId": {
                        "type": "string",
                        "format": "uuid",
                        "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                      }
                    },
                    "required": [
                      "planWorkId",
                      "sourceLessonId"
                    ],
                    "additionalProperties": false
                  }
                ]
              },
              "score": {
                "nullable": true,
                "type": "integer",
                "minimum": 0,
                "maximum": 1000
              },
              "notGraded": {
                "type": "boolean",
                "enum": [
                  true
                ]
              },
              "version": {
                "nullable": true,
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              }
            },
            "required": [
              "studentId",
              "column",
              "score",
              "version"
            ],
            "additionalProperties": false
          }
        },
        "correction": {
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
      "required": [
        "saves"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/lessons/:lessonId/undo": {
    "name": "AttendanceController_undo",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/undo",
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
        "students": {
          "minItems": 1,
          "maxItems": 60,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "cells": {
                "minItems": 1,
                "maxItems": 21,
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "workId": {
                      "nullable": true,
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
                    "workId",
                    "version"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "studentId",
              "cells"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "students"
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
  "POST /api/journal/lessons/:lessonId/works": {
    "name": "WorksController_add",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/works",
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
        "kind": {
          "type": "string",
          "enum": [
            "classwork",
            "homework"
          ]
        },
        "title": {
          "type": "string",
          "minLength": 1
        },
        "correction": {
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
      "required": [
        "kind",
        "title"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/lessons/:lessonId/works/carry": {
    "name": "WorksController_carry",
    "method": "POST",
    "path": "/api/journal/lessons/:lessonId/works/carry",
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
        "column": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "workId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "workId"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "planWorkId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "sourceLessonId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "planWorkId",
                "sourceLessonId"
              ],
              "additionalProperties": false
            }
          ]
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "correction": {
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
      "required": [
        "column",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/orphans/:lessonId/assign": {
    "name": "LessonStatusController_assign",
    "method": "POST",
    "path": "/api/journal/orphans/:lessonId/assign",
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
        "staffId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "days": {
          "type": "integer",
          "minimum": 1,
          "maximum": 7
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "staffId",
        "days",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/journal/orphans/assignments/:assignmentId/withdraw": {
    "name": "LessonStatusController_withdraw",
    "method": "POST",
    "path": "/api/journal/orphans/assignments/:assignmentId/withdraw",
    "parameters": [
      {
        "name": "assignmentId",
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
  "POST /api/journal/unlocks/:unlockId/decide": {
    "name": "UnlocksController_decide",
    "method": "POST",
    "path": "/api/journal/unlocks/:unlockId/decide",
    "parameters": [
      {
        "name": "unlockId",
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
            "decision": {
              "type": "string",
              "enum": [
                "approve"
              ]
            },
            "days": {
              "type": "integer",
              "minimum": 1,
              "maximum": 7
            },
            "version": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "decision",
            "days",
            "version"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "decision": {
              "type": "string",
              "enum": [
                "refuse"
              ]
            },
            "reason": {
              "nullable": true,
              "type": "string",
              "minLength": 1,
              "maxLength": 500
            },
            "version": {
              "type": "integer",
              "minimum": 1,
              "maximum": 9007199254740991
            }
          },
          "required": [
            "decision",
            "reason",
            "version"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/journal/unlocks/:unlockId/withdraw": {
    "name": "UnlocksController_withdraw",
    "method": "POST",
    "path": "/api/journal/unlocks/:unlockId/withdraw",
    "parameters": [
      {
        "name": "unlockId",
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
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/branch-moves/:id/accept": {
    "name": "BranchMovesController_accept",
    "method": "POST",
    "path": "/api/people/branch-moves/:id/accept",
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
        "classId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "groups": {
          "maxItems": 50,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subjectId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "groupId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "subjectId",
              "groupId"
            ],
            "additionalProperties": false
          }
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
        "classId",
        "groups"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/branch-moves/:id/cancel": {
    "name": "BranchMovesController_cancel",
    "method": "POST",
    "path": "/api/people/branch-moves/:id/cancel",
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
      "properties": {},
      "additionalProperties": false
    }
  },
  "POST /api/people/branch-moves/:id/decline": {
    "name": "BranchMovesController_decline",
    "method": "POST",
    "path": "/api/people/branch-moves/:id/decline",
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
  "POST /api/people/classes/:classId/parent-slips": {
    "name": "ParentAccountsController_print",
    "method": "POST",
    "path": "/api/people/classes/:classId/parent-slips",
    "parameters": [
      {
        "name": "classId",
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
        "language": {
          "type": "string",
          "enum": [
            "uz",
            "ru",
            "en"
          ]
        },
        "printAgain": {
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "language",
        "printAgain"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/parent-accounts/never-used/export": {
    "name": "ParentAccountsController_neverUsedFile",
    "method": "POST",
    "path": "/api/people/parent-accounts/never-used/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 6,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "login",
              "children",
              "printedAt",
              "validUntil",
              "expired"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/parents/:relativeId/password-reset": {
    "name": "ParentAccountsController_reset",
    "method": "POST",
    "path": "/api/people/parents/:relativeId/password-reset",
    "parameters": [
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
        "language": {
          "type": "string",
          "enum": [
            "uz",
            "ru",
            "en"
          ]
        }
      },
      "required": [
        "language"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/parents/:relativeId/telegram-unlink": {
    "name": "ParentAccountsController_unlinkTelegram",
    "method": "POST",
    "path": "/api/people/parents/:relativeId/telegram-unlink",
    "parameters": [
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
    ]
  },
  "POST /api/people/relatives/:id/merge": {
    "name": "RelativesController_merge",
    "method": "POST",
    "path": "/api/people/relatives/:id/merge",
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
        "otherId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "thisPhone": {
          "nullable": true,
          "type": "string"
        },
        "otherPhone": {
          "nullable": true,
          "type": "string"
        },
        "phoneOf": {
          "type": "string",
          "enum": [
            "this",
            "other"
          ]
        },
        "nameOf": {
          "type": "string",
          "enum": [
            "this",
            "other"
          ]
        }
      },
      "required": [
        "otherId",
        "thisPhone",
        "otherPhone",
        "phoneOf",
        "nameOf"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/relatives/:id/report": {
    "name": "PersonalDataController_relative",
    "method": "POST",
    "path": "/api/people/relatives/:id/report",
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
  "POST /api/people/relatives/:id/show": {
    "name": "RelativesController_show",
    "method": "POST",
    "path": "/api/people/relatives/:id/show",
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
  "POST /api/people/relatives/phone-match": {
    "name": "RelativesController_phoneMatch",
    "method": "POST",
    "path": "/api/people/relatives/phone-match",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "phone": {
          "type": "string"
        }
      },
      "required": [
        "phone"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/staff": {
    "name": "StaffController_create",
    "method": "POST",
    "path": "/api/people/staff",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "fatherName": {
          "nullable": true,
          "type": "string"
        },
        "sex": {
          "type": "string",
          "enum": [
            "male",
            "female"
          ]
        },
        "birthDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "educationLevel": {
          "nullable": true,
          "type": "string",
          "enum": [
            "secondary",
            "specialised_secondary",
            "bachelor",
            "master",
            "phd",
            "other"
          ]
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "email": {
          "nullable": true,
          "type": "string"
        },
        "jshshir": {
          "nullable": true,
          "type": "string"
        },
        "admissionDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "contractType": {
          "nullable": true,
          "type": "string",
          "enum": [
            "full_time",
            "part_time"
          ]
        },
        "contractDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
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
        },
        "divisions": {
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "divisionId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "departmentId": {
                "nullable": true,
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "main": {
                "type": "boolean"
              }
            },
            "required": [
              "divisionId",
              "departmentId",
              "main"
            ]
          }
        },
        "departmentStartsOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "firstName",
        "lastName",
        "fatherName",
        "sex",
        "birthDate",
        "educationLevel",
        "phone",
        "email",
        "jshshir",
        "admissionDate",
        "contractType",
        "contractDate",
        "weeklyLessons",
        "dailyLessons",
        "divisions"
      ]
    }
  },
  "POST /api/people/staff/:id/account": {
    "name": "StaffAccountsController_create",
    "method": "POST",
    "path": "/api/people/staff/:id/account",
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
        "login": {
          "type": "string",
          "maxLength": 64,
          "pattern": "^[a-z]+(\\.[a-z]+){1,2}[0-9]*$"
        }
      },
      "required": [
        "login"
      ]
    }
  },
  "POST /api/people/staff/:id/account/lock": {
    "name": "AccountAccessController_lock",
    "method": "POST",
    "path": "/api/people/staff/:id/account/lock",
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
      ]
    }
  },
  "POST /api/people/staff/:id/account/own": {
    "name": "StaffAccountsController_linkOwn",
    "method": "POST",
    "path": "/api/people/staff/:id/account/own",
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
  "POST /api/people/staff/:id/account/password-reset": {
    "name": "AccountAccessController_resetPassword",
    "method": "POST",
    "path": "/api/people/staff/:id/account/password-reset",
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
  "POST /api/people/staff/:id/account/second-step-reset": {
    "name": "AccountAccessController_resetSecondStep",
    "method": "POST",
    "path": "/api/people/staff/:id/account/second-step-reset",
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
  "POST /api/people/staff/:id/account/unlock": {
    "name": "AccountAccessController_unlock",
    "method": "POST",
    "path": "/api/people/staff/:id/account/unlock",
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
  "POST /api/people/staff/:id/identity": {
    "name": "StaffController_identity",
    "method": "POST",
    "path": "/api/people/staff/:id/identity",
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
  "POST /api/people/staff/:id/report": {
    "name": "PersonalDataController_staff",
    "method": "POST",
    "path": "/api/people/staff/:id/report",
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
  "POST /api/people/staff/:id/roles": {
    "name": "StaffAccountsController_give",
    "method": "POST",
    "path": "/api/people/staff/:id/roles",
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
        "role": {
          "type": "string",
          "enum": [
            "super_admin",
            "principal",
            "academic_vice_principal",
            "spiritual_vice_principal",
            "head_tutor",
            "tutor",
            "class_teacher",
            "senior_head_teacher",
            "head_teacher",
            "teacher"
          ]
        },
        "branchId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "subjectIds": {
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "role",
        "branchId",
        "from"
      ]
    }
  },
  "POST /api/people/staff/:id/roles/:assignmentId/end": {
    "name": "StaffAccountsController_end",
    "method": "POST",
    "path": "/api/people/staff/:id/roles/:assignmentId/end",
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
        "name": "assignmentId",
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
        }
      },
      "required": [
        "from"
      ]
    }
  },
  "POST /api/people/staff/:id/roles/:assignmentId/subjects": {
    "name": "StaffAccountsController_changeSubjects",
    "method": "POST",
    "path": "/api/people/staff/:id/roles/:assignmentId/subjects",
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
        "name": "assignmentId",
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
        "subjectIds": {
          "minItems": 1,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "subjectIds",
        "from"
      ]
    }
  },
  "POST /api/people/staff/:id/status": {
    "name": "StaffController_status",
    "method": "POST",
    "path": "/api/people/staff/:id/status",
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
        "status": {
          "type": "string",
          "enum": [
            "active",
            "inactive",
            "left"
          ]
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "status",
        "from"
      ]
    }
  },
  "POST /api/people/staff/check": {
    "name": "StaffController_check",
    "method": "POST",
    "path": "/api/people/staff/check",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "birthDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "staffRecordId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "firstName",
        "lastName",
        "birthDate",
        "phone",
        "staffRecordId"
      ]
    }
  },
  "POST /api/people/staff/export": {
    "name": "StaffController_export",
    "method": "POST",
    "path": "/api/people/staff/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "staffId",
              "category",
              "branches",
              "department",
              "subjects",
              "grades",
              "languages",
              "phone",
              "status"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/staff/imports/:id/confirm": {
    "name": "StaffController_importConfirm",
    "method": "POST",
    "path": "/api/people/staff/imports/:id/confirm",
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
        "confirmedWarnings": {
          "default": [],
          "maxItems": 1000,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/people/staff/imports/:id/preview": {
    "name": "StaffController_importPreview",
    "method": "POST",
    "path": "/api/people/staff/imports/:id/preview",
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
        "confirmedWarnings": {
          "default": [],
          "maxItems": 1000,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/people/students": {
    "name": "StudentsController_create",
    "method": "POST",
    "path": "/api/people/students",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "paternalName": {
          "nullable": true,
          "type": "string"
        },
        "sex": {
          "type": "string",
          "enum": [
            "male",
            "female"
          ]
        },
        "birthDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "grade": {
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "documentType": {
          "nullable": true,
          "type": "string",
          "enum": [
            "passport",
            "id_card",
            "birth_certificate"
          ]
        },
        "documentNumber": {
          "nullable": true,
          "type": "string"
        },
        "jshshir": {
          "nullable": true,
          "type": "string"
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "email": {
          "nullable": true,
          "type": "string"
        },
        "address": {
          "nullable": true,
          "type": "string"
        },
        "region": {
          "nullable": true,
          "type": "string",
          "enum": [
            "andijan",
            "bukhara",
            "fergana",
            "jizzakh",
            "kashkadarya",
            "khorezm",
            "namangan",
            "navoi",
            "samarkand",
            "surkhandarya",
            "syrdarya",
            "tashkent_region",
            "karakalpakstan",
            "tashkent_city",
            "other"
          ]
        },
        "previousSchool": {
          "nullable": true,
          "type": "string"
        },
        "diagnosticScore": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "scholarship": {
          "default": {
            "type": "none",
            "coverage": null,
            "amount": null
          },
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "none",
                "merit",
                "financial_aid",
                "gift"
              ]
            },
            "coverage": {
              "nullable": true,
              "type": "string",
              "enum": [
                "full",
                "partial"
              ]
            },
            "amount": {
              "nullable": true,
              "type": "integer",
              "minimum": 1,
              "maximum": 1000000000
            }
          },
          "required": [
            "type",
            "coverage",
            "amount"
          ]
        },
        "consentSignedOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "contract": {
          "nullable": true,
          "type": "object",
          "properties": {
            "number": {
              "nullable": true,
              "type": "string"
            },
            "signedOn": {
              "type": "string",
              "format": "date",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
            }
          },
          "required": [
            "number",
            "signedOn"
          ]
        },
        "startsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "uid": {
          "type": "string"
        },
        "relatives": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "oneOf": [
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "new"
                    ]
                  },
                  "relative": {
                    "type": "object",
                    "properties": {
                      "fullName": {
                        "type": "string"
                      },
                      "phone": {
                        "nullable": true,
                        "type": "string"
                      },
                      "workplace": {
                        "nullable": true,
                        "type": "string"
                      },
                      "email": {
                        "nullable": true,
                        "type": "string"
                      },
                      "extraPhones": {
                        "maxItems": 3,
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": [
                      "fullName",
                      "phone",
                      "workplace",
                      "email"
                    ],
                    "additionalProperties": false
                  },
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
                  "kind",
                  "relative",
                  "relationship",
                  "mainContact",
                  "portalAccess",
                  "receivesNotices"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "existing"
                    ]
                  },
                  "relativeId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "phone": {
                    "type": "string"
                  },
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
                  "kind",
                  "relativeId",
                  "phone",
                  "relationship",
                  "mainContact",
                  "portalAccess",
                  "receivesNotices"
                ],
                "additionalProperties": false
              },
              {
                "type": "object",
                "properties": {
                  "kind": {
                    "type": "string",
                    "enum": [
                      "new_owner"
                    ]
                  },
                  "relative": {
                    "type": "object",
                    "properties": {
                      "fullName": {
                        "type": "string"
                      },
                      "phone": {
                        "type": "string"
                      },
                      "workplace": {
                        "nullable": true,
                        "type": "string"
                      },
                      "email": {
                        "nullable": true,
                        "type": "string"
                      },
                      "extraPhones": {
                        "maxItems": 3,
                        "type": "array",
                        "items": {
                          "type": "string"
                        }
                      }
                    },
                    "required": [
                      "fullName",
                      "phone",
                      "workplace",
                      "email"
                    ],
                    "additionalProperties": false
                  },
                  "previousId": {
                    "type": "string",
                    "format": "uuid",
                    "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                  },
                  "previousPhone": {
                    "nullable": true,
                    "type": "string"
                  },
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
                  "kind",
                  "relative",
                  "previousId",
                  "previousPhone",
                  "relationship",
                  "mainContact",
                  "portalAccess",
                  "receivesNotices"
                ],
                "additionalProperties": false
              }
            ]
          }
        },
        "classId": {
          "default": null,
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "firstName",
        "lastName",
        "paternalName",
        "sex",
        "birthDate",
        "grade",
        "documentType",
        "documentNumber",
        "jshshir",
        "phone",
        "email",
        "address",
        "region",
        "previousSchool",
        "diagnosticScore",
        "consentSignedOn",
        "contract",
        "startsOn",
        "uid",
        "relatives"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/branch-move": {
    "name": "BranchMovesController_release",
    "method": "POST",
    "path": "/api/people/students/:id/branch-move",
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
        "toBranchId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "version": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "toBranchId",
        "from",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/delete": {
    "name": "StudentStatusesController_delete",
    "method": "POST",
    "path": "/api/people/students/:id/delete",
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
  "POST /api/people/students/:id/identity": {
    "name": "StudentsController_identity",
    "method": "POST",
    "path": "/api/people/students/:id/identity",
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
  "POST /api/people/students/:id/merge": {
    "name": "StudentMergesController_merge",
    "method": "POST",
    "path": "/api/people/students/:id/merge",
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
        },
        "digest": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
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
        "uid",
        "reason",
        "digest"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/relatives": {
    "name": "RelativesController_link",
    "method": "POST",
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
    ],
    "body": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "new"
              ]
            },
            "relative": {
              "type": "object",
              "properties": {
                "fullName": {
                  "type": "string"
                },
                "phone": {
                  "nullable": true,
                  "type": "string"
                },
                "workplace": {
                  "nullable": true,
                  "type": "string"
                },
                "email": {
                  "nullable": true,
                  "type": "string"
                },
                "extraPhones": {
                  "maxItems": 3,
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "fullName",
                "phone",
                "workplace",
                "email"
              ],
              "additionalProperties": false
            },
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
            "kind",
            "relative",
            "relationship",
            "mainContact",
            "portalAccess",
            "receivesNotices"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "existing"
              ]
            },
            "relativeId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "phone": {
              "type": "string"
            },
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
            "kind",
            "relativeId",
            "phone",
            "relationship",
            "mainContact",
            "portalAccess",
            "receivesNotices"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "new_owner"
              ]
            },
            "relative": {
              "type": "object",
              "properties": {
                "fullName": {
                  "type": "string"
                },
                "phone": {
                  "type": "string"
                },
                "workplace": {
                  "nullable": true,
                  "type": "string"
                },
                "email": {
                  "nullable": true,
                  "type": "string"
                },
                "extraPhones": {
                  "maxItems": 3,
                  "type": "array",
                  "items": {
                    "type": "string"
                  }
                }
              },
              "required": [
                "fullName",
                "phone",
                "workplace",
                "email"
              ],
              "additionalProperties": false
            },
            "previousId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "previousPhone": {
              "nullable": true,
              "type": "string"
            },
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
            "kind",
            "relative",
            "previousId",
            "previousPhone",
            "relationship",
            "mainContact",
            "portalAccess",
            "receivesNotices"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/people/students/:id/relatives/:relativeId/unlink": {
    "name": "RelativesController_unlink",
    "method": "POST",
    "path": "/api/people/students/:id/relatives/:relativeId/unlink",
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
        "newMainContactId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "newMainContactId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/:id/report": {
    "name": "PersonalDataController_student",
    "method": "POST",
    "path": "/api/people/students/:id/report",
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
  "POST /api/people/students/:id/return": {
    "name": "StudentStatusesController_returnStudent",
    "method": "POST",
    "path": "/api/people/students/:id/return",
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
        "grade": {
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "classId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "contract": {
          "nullable": true,
          "type": "object",
          "properties": {
            "number": {
              "nullable": true,
              "type": "string"
            },
            "signedOn": {
              "type": "string",
              "format": "date",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
            }
          },
          "required": [
            "number",
            "signedOn"
          ]
        },
        "reason": {
          "nullable": true,
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "confirmLanguage": {
          "type": "boolean"
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
        "from",
        "grade",
        "classId",
        "contract",
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
  "POST /api/people/students/check": {
    "name": "StudentsController_check",
    "method": "POST",
    "path": "/api/people/students/check",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "birthDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "studentId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "firstName",
        "lastName",
        "birthDate",
        "studentId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/export": {
    "name": "StudentsController_export",
    "method": "POST",
    "path": "/api/people/students/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 31,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "uid",
              "name",
              "class",
              "groups",
              "tutor",
              "status",
              "paternalName",
              "sex",
              "grade",
              "startsOn",
              "phone",
              "email",
              "birthDate",
              "documentType",
              "documentNumber",
              "jshshir",
              "address",
              "region",
              "contractNumber",
              "contractSignedOn",
              "scholarshipType",
              "scholarshipCoverage",
              "scholarshipAmount",
              "previousSchool",
              "diagnosticScore",
              "consentSignedOn",
              "mainContactName",
              "mainContactRelationship",
              "mainContactPhone",
              "mainContactExtraPhones",
              "otherRelatives"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/people/students/imports/:id/confirm": {
    "name": "StudentsController_importConfirm",
    "method": "POST",
    "path": "/api/people/students/imports/:id/confirm",
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
        "confirmedWarnings": {
          "default": [],
          "maxItems": 1000,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        },
        "relativeLinks": {
          "default": [],
          "maxItems": 3000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "rowNumber": {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              "position": {
                "type": "integer",
                "minimum": 1,
                "maximum": 3
              },
              "relativeId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "rowNumber",
              "position",
              "relativeId"
            ],
            "additionalProperties": false
          }
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/people/students/imports/:id/preview": {
    "name": "StudentsController_importPreview",
    "method": "POST",
    "path": "/api/people/students/imports/:id/preview",
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
        "confirmedWarnings": {
          "default": [],
          "maxItems": 1000,
          "type": "array",
          "items": {
            "type": "integer",
            "minimum": 1,
            "maximum": 9007199254740991
          }
        },
        "relativeLinks": {
          "default": [],
          "maxItems": 3000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "rowNumber": {
                "type": "integer",
                "minimum": 1,
                "maximum": 9007199254740991
              },
              "position": {
                "type": "integer",
                "minimum": 1,
                "maximum": 3
              },
              "relativeId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "rowNumber",
              "position",
              "relativeId"
            ],
            "additionalProperties": false
          }
        }
      },
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
  "POST /api/people/vacancies/:id/delete": {
    "name": "VacanciesController_delete",
    "method": "POST",
    "path": "/api/people/vacancies/:id/delete",
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
  "POST /api/people/vacancies/export": {
    "name": "VacanciesController_export",
    "method": "POST",
    "path": "/api/people/vacancies/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 7,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "department",
              "subjects",
              "grades",
              "languages",
              "weeklyLessons",
              "status"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/items/:itemId/clear": {
    "name": "PlansController_clearItem",
    "method": "POST",
    "path": "/api/plans/items/:itemId/clear",
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
    ]
  },
  "POST /api/plans/journals/:journalId/carried/:itemId/place": {
    "name": "PlanOutcomesController_place",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/carried/:itemId/place",
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
        }
      },
      "required": [
        "quarterId",
        "position",
        "lessonId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/copy": {
    "name": "PlansController_copy",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/copy",
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
      "anyOf": [
        {
          "type": "object",
          "properties": {
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "source": {
              "type": "object",
              "properties": {
                "journalId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "quarterId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "journalId",
                "quarterId"
              ],
              "additionalProperties": false
            },
            "part": {
              "type": "string",
              "enum": [
                "all",
                "remaining"
              ]
            }
          },
          "required": [
            "quarterId",
            "source",
            "part"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "source": {
              "type": "object",
              "properties": {
                "masterId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "masterId"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "quarterId",
            "source"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/plans/journals/:journalId/export": {
    "name": "PlanExportController_export",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/export",
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
        "format": {
          "type": "string",
          "enum": [
            "pdf",
            "xlsx"
          ]
        }
      },
      "required": [
        "quarterId",
        "format"
      ],
      "additionalProperties": false
    }
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
  "POST /api/plans/journals/:journalId/master-keep": {
    "name": "PlanMastersController_keep",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/master-keep",
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "quarterId",
        "revision"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/master-take": {
    "name": "PlanMastersController_take",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/master-take",
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "quarterId",
        "revision"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/not-covered/:itemId/carry": {
    "name": "PlanOutcomesController_carry",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/not-covered/:itemId/carry",
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
        "quarterId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "quarterId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/not-covered/:itemId/drop": {
    "name": "PlanOutcomesController_drop",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/not-covered/:itemId/drop",
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
        "quarterId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "maxLength": 500
        }
      },
      "required": [
        "quarterId",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/not-covered/:itemId/merge": {
    "name": "PlanOutcomesController_merge",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/not-covered/:itemId/merge",
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
        "base": {
          "nullable": true,
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
            }
          },
          "required": [
            "topic",
            "objectives",
            "links"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "quarterId",
        "position",
        "lessonId",
        "base"
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
  "POST /api/plans/journals/:journalId/requests/prepared": {
    "name": "PlanRequestsController_sendPrepared",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/requests/prepared",
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
        "reason": {
          "type": "string",
          "maxLength": 1000
        }
      },
      "required": [
        "quarterId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/requests/prepared/decide": {
    "name": "PlanRequestsController_decidePrepared",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/requests/prepared/decide",
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
        "decision": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "decision": {
                  "type": "string",
                  "enum": [
                    "approve"
                  ]
                },
                "days": {
                  "type": "integer",
                  "minimum": 1,
                  "maximum": 10
                },
                "untick": {
                  "maxItems": 200,
                  "type": "array",
                  "items": {
                    "type": "object",
                    "properties": {
                      "lessonId": {
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
                      "lessonId",
                      "reason"
                    ],
                    "additionalProperties": false
                  }
                },
                "later": {
                  "type": "object",
                  "properties": {
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
                    "fromLessonId",
                    "reason"
                  ],
                  "additionalProperties": false
                }
              },
              "required": [
                "decision",
                "days"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "decision": {
                  "type": "string",
                  "enum": [
                    "refuse"
                  ]
                },
                "reason": {
                  "type": "string",
                  "maxLength": 1000
                }
              },
              "required": [
                "decision",
                "reason"
              ],
              "additionalProperties": false
            }
          ]
        }
      },
      "required": [
        "quarterId",
        "decision"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/separate": {
    "name": "PlansController_separate",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/separate",
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
        }
      },
      "required": [
        "quarterId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/journals/:journalId/share": {
    "name": "PlansController_share",
    "method": "POST",
    "path": "/api/plans/journals/:journalId/share",
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
        "journalId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "quarterId",
        "journalId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/masters": {
    "name": "PlanMastersController_create",
    "method": "POST",
    "path": "/api/plans/masters",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "yearId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "quarter": {
          "type": "integer",
          "minimum": 1,
          "maximum": 4
        },
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "grade": {
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "language": {
          "type": "string",
          "enum": [
            "uz",
            "ru"
          ]
        },
        "name": {
          "type": "string",
          "maxLength": 60
        },
        "scope": {
          "type": "string",
          "enum": [
            "branch",
            "all"
          ]
        }
      },
      "required": [
        "yearId",
        "quarter",
        "subjectId",
        "grade",
        "language",
        "name",
        "scope"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/masters/:masterId/archive": {
    "name": "PlanMastersController_archive",
    "method": "POST",
    "path": "/api/plans/masters/:masterId/archive",
    "parameters": [
      {
        "name": "masterId",
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "revision"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/masters/:masterId/items": {
    "name": "PlanMastersController_createItem",
    "method": "POST",
    "path": "/api/plans/masters/:masterId/items",
    "parameters": [
      {
        "name": "masterId",
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "position": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
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
        "revision",
        "position",
        "values"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/masters/:masterId/items/:itemId/remove": {
    "name": "PlanMastersController_removeItem",
    "method": "POST",
    "path": "/api/plans/masters/:masterId/items/:itemId/remove",
    "parameters": [
      {
        "name": "masterId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "revision"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/masters/:masterId/restore": {
    "name": "PlanMastersController_restore",
    "method": "POST",
    "path": "/api/plans/masters/:masterId/restore",
    "parameters": [
      {
        "name": "masterId",
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "revision"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/reports/export": {
    "name": "PlanReportsController_export",
    "method": "POST",
    "path": "/api/plans/reports/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "report": {
          "type": "string",
          "enum": [
            "completeness",
            "progress",
            "requests"
          ]
        },
        "quarterId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "departmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "teacherId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "report"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/plans/requests/:requestId/decide": {
    "name": "PlanRequestsController_decide",
    "method": "POST",
    "path": "/api/plans/requests/:requestId/decide",
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
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "decision": {
              "type": "string",
              "enum": [
                "approve"
              ]
            },
            "days": {
              "type": "integer",
              "minimum": 1,
              "maximum": 10
            },
            "untick": {
              "maxItems": 200,
              "type": "array",
              "items": {
                "type": "object",
                "properties": {
                  "lessonId": {
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
                  "lessonId",
                  "reason"
                ],
                "additionalProperties": false
              }
            },
            "later": {
              "type": "object",
              "properties": {
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
                "fromLessonId",
                "reason"
              ],
              "additionalProperties": false
            }
          },
          "required": [
            "decision",
            "days"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "decision": {
              "type": "string",
              "enum": [
                "refuse"
              ]
            },
            "reason": {
              "type": "string",
              "maxLength": 1000
            }
          },
          "required": [
            "decision",
            "reason"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/plans/requests/:requestId/finish": {
    "name": "PlanRequestsController_finish",
    "method": "POST",
    "path": "/api/plans/requests/:requestId/finish",
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
    ]
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
  "POST /api/plans/requests/decide-event": {
    "name": "PlanRequestsController_decideEvent",
    "method": "POST",
    "path": "/api/plans/requests/decide-event",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "eventId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "days": {
          "type": "integer",
          "minimum": 1,
          "maximum": 10
        }
      },
      "required": [
        "eventId",
        "days"
      ],
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
  "POST /api/results/closing/:quarterId/close": {
    "name": "ClosingController_close",
    "method": "POST",
    "path": "/api/results/closing/:quarterId/close",
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
        "warnings": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "no_attendance",
                  "numbers_missing",
                  "plan_incomplete",
                  "no_result",
                  "part_without_data",
                  "no_teacher"
                ]
              },
              "journalId": {
                "nullable": true,
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "kind",
              "journalId"
            ],
            "additionalProperties": false
          }
        },
        "lockNow": {
          "type": "boolean"
        },
        "startQuarter": {
          "nullable": true,
          "type": "string",
          "enum": [
            "keep",
            "not_official"
          ]
        }
      },
      "required": [
        "warnings",
        "lockNow",
        "startQuarter"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/results/closing/:quarterId/journals/:journalId/close": {
    "name": "ClosingController_closeJournal",
    "method": "POST",
    "path": "/api/results/closing/:quarterId/journals/:journalId/close",
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
    ],
    "body": {
      "type": "object",
      "properties": {
        "warnings": {
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "kind": {
                "type": "string",
                "enum": [
                  "no_attendance",
                  "numbers_missing",
                  "plan_incomplete",
                  "no_result",
                  "part_without_data",
                  "no_teacher"
                ]
              },
              "journalId": {
                "nullable": true,
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "kind",
              "journalId"
            ],
            "additionalProperties": false
          }
        },
        "lockNow": {
          "type": "boolean"
        }
      },
      "required": [
        "warnings",
        "lockNow"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/results/closing/:quarterId/journals/:journalId/decisions": {
    "name": "ClosingController_decideJournal",
    "method": "POST",
    "path": "/api/results/closing/:quarterId/journals/:journalId/decisions",
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
    ],
    "body": {
      "type": "object",
      "properties": {
        "decision": {
          "nullable": true,
          "type": "string",
          "enum": [
            "keep",
            "exempt",
            "not_assessed"
          ]
        },
        "students": {
          "minItems": 1,
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "decision",
        "students"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/results/closing/:quarterId/plan-periods/end": {
    "name": "ClosingController_endPlanPeriods",
    "method": "POST",
    "path": "/api/results/closing/:quarterId/plan-periods/end",
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
    ]
  },
  "POST /api/results/closing/:quarterId/recalculation/apply": {
    "name": "ClosingController_applyRecalculation",
    "method": "POST",
    "path": "/api/results/closing/:quarterId/recalculation/apply",
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
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "students": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "subjectId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "studentId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "subjectId",
              "studentId"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "reason",
        "students"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/results/closing/:quarterId/remind": {
    "name": "ClosingController_remind",
    "method": "POST",
    "path": "/api/results/closing/:quarterId/remind",
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
    ]
  },
  "POST /api/results/closing/:quarterId/reopen": {
    "name": "ClosingController_reopen",
    "method": "POST",
    "path": "/api/results/closing/:quarterId/reopen",
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
        "journalId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        },
        "days": {
          "type": "integer",
          "minimum": 1,
          "maximum": 14
        }
      },
      "required": [
        "journalId",
        "reason",
        "days"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/results/early-warning/handled": {
    "name": "EarlyWarningController_handle",
    "method": "POST",
    "path": "/api/results/early-warning/handled",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "quarterId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "studentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "reason": {
          "type": "string",
          "enum": [
            "low_result",
            "result_drop",
            "low_attendance",
            "absences_in_row"
          ]
        },
        "note": {
          "default": "",
          "type": "string",
          "maxLength": 500
        }
      },
      "required": [
        "quarterId",
        "studentId",
        "subjectId",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/results/rating/export": {
    "name": "RatingController_export",
    "method": "POST",
    "path": "/api/results/rating/export",
    "parameters": [],
    "body": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "subject"
              ]
            },
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "journalId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            }
          },
          "required": [
            "kind",
            "quarterId",
            "journalId"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "class"
              ]
            },
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "classId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            }
          },
          "required": [
            "kind",
            "quarterId",
            "classId"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "classes"
              ]
            },
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "grade": {
              "type": "integer",
              "minimum": 0,
              "maximum": 11
            },
            "language": {
              "type": "string",
              "enum": [
                "uz",
                "ru"
              ]
            }
          },
          "required": [
            "kind",
            "quarterId"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/results/reports/attendance/export": {
    "name": "ResultsReportsController_attendanceExport",
    "method": "POST",
    "path": "/api/results/reports/attendance/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "to": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "grade": {
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
        },
        "classId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "teacherId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "start": {
          "type": "integer",
          "minimum": 0,
          "maximum": 1439
        },
        "groupBy": {
          "default": "class",
          "type": "string",
          "enum": [
            "class",
            "tutor"
          ]
        }
      },
      "required": [
        "from",
        "to"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/results/reports/export": {
    "name": "ResultsReportsController_export",
    "method": "POST",
    "path": "/api/results/reports/export",
    "parameters": [],
    "body": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "table"
              ]
            },
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "classId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            }
          },
          "required": [
            "kind",
            "quarterId",
            "classId"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "mastery"
              ]
            },
            "quarterId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "subjectId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "grade": {
              "type": "integer",
              "minimum": 0,
              "maximum": 11
            },
            "classId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "teacherId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            }
          },
          "required": [
            "kind",
            "quarterId",
            "subjectId"
          ],
          "additionalProperties": false
        }
      ]
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
  "POST /api/setup/academic-years/:id/start": {
    "name": "AcademicYearsController_start",
    "method": "POST",
    "path": "/api/setup/academic-years/:id/start",
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
  "POST /api/setup/branches": {
    "name": "BranchesController_create",
    "method": "POST",
    "path": "/api/setup/branches",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "address": {
          "nullable": true,
          "type": "string",
          "maxLength": 300
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "email": {
          "nullable": true,
          "type": "string",
          "maxLength": 200
        },
        "workingWeekdays": {
          "minItems": 1,
          "maxItems": 7,
          "type": "array",
          "items": {
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
          }
        }
      },
      "required": [
        "name",
        "address",
        "phone",
        "email",
        "workingWeekdays"
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
  "POST /api/setup/buildings/:id/forced-delete": {
    "name": "PlaceForcedDeletesController_building",
    "method": "POST",
    "path": "/api/setup/buildings/:id/forced-delete",
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
  "POST /api/setup/buildings/export": {
    "name": "BuildingsController_export",
    "method": "POST",
    "path": "/api/setup/buildings/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 4,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "floors",
              "rooms",
              "status"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
    }
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
  "POST /api/setup/demo-clock/jumps": {
    "name": "DemoClockController_jump",
    "method": "POST",
    "path": "/api/setup/demo-clock/jumps",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "to": {
          "type": "string",
          "format": "date-time",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))T(?:(?:[01]\\d|2[0-3]):[0-5]\\d:[0-5]\\d(?:\\.\\d+)?(?:Z|([+-](?:[01]\\d|2[0-3]):[0-5]\\d)))$"
        }
      },
      "required": [
        "to"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/setup/departments/:id/archive": {
    "name": "DivisionsController_archiveDepartment",
    "method": "POST",
    "path": "/api/setup/departments/:id/archive",
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
  "POST /api/setup/departments/:id/restore": {
    "name": "DivisionsController_restoreDepartment",
    "method": "POST",
    "path": "/api/setup/departments/:id/restore",
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
  "POST /api/setup/divisions": {
    "name": "DivisionsController_create",
    "method": "POST",
    "path": "/api/setup/divisions",
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
        }
      },
      "required": [
        "names"
      ]
    }
  },
  "POST /api/setup/divisions/:id/archive": {
    "name": "DivisionsController_archive",
    "method": "POST",
    "path": "/api/setup/divisions/:id/archive",
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
  "POST /api/setup/divisions/:id/departments": {
    "name": "DivisionsController_createDepartment",
    "method": "POST",
    "path": "/api/setup/divisions/:id/departments",
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
        }
      },
      "required": [
        "names"
      ]
    }
  },
  "POST /api/setup/divisions/:id/restore": {
    "name": "DivisionsController_restore",
    "method": "POST",
    "path": "/api/setup/divisions/:id/restore",
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
  "POST /api/setup/divisions/export": {
    "name": "DivisionsController_export",
    "method": "POST",
    "path": "/api/setup/divisions/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 4,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "departments",
              "staff",
              "status"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
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
  "POST /api/setup/floors/:id/forced-delete": {
    "name": "PlaceForcedDeletesController_floor",
    "method": "POST",
    "path": "/api/setup/floors/:id/forced-delete",
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
  "POST /api/setup/quarters/:id/attendance-values/preview": {
    "name": "SettingsController_previewAttendanceValues",
    "method": "POST",
    "path": "/api/setup/quarters/:id/attendance-values/preview",
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
        "lateValue": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "skippedValue": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "lateValue",
        "skippedValue"
      ]
    }
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
  "POST /api/setup/rooms/:id/forced-delete": {
    "name": "PlaceForcedDeletesController_room",
    "method": "POST",
    "path": "/api/setup/rooms/:id/forced-delete",
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
  "POST /api/setup/rooms/export": {
    "name": "RoomsController_export",
    "method": "POST",
    "path": "/api/setup/rooms/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 7,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "building",
              "floor",
              "type",
              "capacity",
              "status",
              "shared"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
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
        "demanding"
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
  "POST /api/setup/subjects/export": {
    "name": "SubjectsController_export",
    "method": "POST",
    "path": "/api/setup/subjects/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "ids": {
          "minItems": 1,
          "maxItems": 5000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "columns": {
          "minItems": 1,
          "maxItems": 8,
          "type": "array",
          "items": {
            "type": "string",
            "enum": [
              "name",
              "department",
              "grades",
              "journalType",
              "ratingExam",
              "quarterly",
              "switches",
              "status"
            ]
          }
        },
        "selection": {
          "type": "string",
          "enum": [
            "ticked",
            "matching"
          ]
        },
        "search": {
          "type": "string",
          "maxLength": 200
        },
        "filters": {
          "type": "object",
          "additionalProperties": {
            "type": "string",
            "maxLength": 100
          }
        }
      },
      "required": [
        "ids",
        "columns",
        "selection",
        "search",
        "filters"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/setup/subjects/imports/:id/confirm": {
    "name": "SubjectsController_importConfirm",
    "method": "POST",
    "path": "/api/setup/subjects/imports/:id/confirm",
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
      "properties": {},
      "additionalProperties": false
    }
  },
  "POST /api/setup/subjects/imports/:id/preview": {
    "name": "SubjectsController_importPreview",
    "method": "POST",
    "path": "/api/setup/subjects/imports/:id/preview",
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
      "properties": {},
      "additionalProperties": false
    }
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
  "POST /api/timetable/absences/:id/journal-substitute": {
    "name": "JournalSubstitutionsController_absenceSubstitute",
    "method": "POST",
    "path": "/api/timetable/absences/:id/journal-substitute",
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
        "journalId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
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
        "journalId",
        "teacherId",
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
  "POST /api/timetable/acting-teachers": {
    "name": "ActingTeachersController_name",
    "method": "POST",
    "path": "/api/timetable/acting-teachers",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "vacancyId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "journalId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "personId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "until": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "confirmLanguage": {
          "type": "boolean",
          "enum": [
            true
          ]
        }
      },
      "required": [
        "vacancyId",
        "journalId",
        "personId",
        "from"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/acting-teachers/:id/end": {
    "name": "ActingTeachersController_end",
    "method": "POST",
    "path": "/api/timetable/acting-teachers/:id/end",
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
        "until": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "until"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/acting-teachers/check": {
    "name": "ActingTeachersController_check",
    "method": "POST",
    "path": "/api/timetable/acting-teachers/check",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "vacancyId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "journalId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "personId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "until": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "confirmLanguage": {
          "type": "boolean",
          "enum": [
            true
          ]
        }
      },
      "required": [
        "vacancyId",
        "journalId",
        "personId",
        "from"
      ],
      "additionalProperties": false
    }
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
  "POST /api/timetable/lessons/:id/correction": {
    "name": "DayChangesController_correct",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/correction",
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
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "cancel"
              ]
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
            "kind",
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
                "restore"
              ]
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
            },
            "confirm": {
              "type": "boolean"
            }
          },
          "required": [
            "kind",
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
                "teacher"
              ]
            },
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
            "kind",
            "teacherId",
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
                "room"
              ]
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
            },
            "confirm": {
              "type": "boolean"
            }
          },
          "required": [
            "kind",
            "roomId",
            "reason"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/timetable/lessons/:id/forced-delete": {
    "name": "LessonForcedDeletesController_forceDelete",
    "method": "POST",
    "path": "/api/timetable/lessons/:id/forced-delete",
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
  "POST /api/timetable/reports/load/export": {
    "name": "LoadReportController_export",
    "method": "POST",
    "path": "/api/timetable/reports/load/export",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "week": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "departmentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "week"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/room-closures": {
    "name": "RoomClosuresController_create",
    "method": "POST",
    "path": "/api/timetable/room-closures",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "roomId": {
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
        "roomId",
        "startsOn",
        "endsOn",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/room-closures/:id/move": {
    "name": "RoomClosuresController_move",
    "method": "POST",
    "path": "/api/timetable/room-closures/:id/move",
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
  "POST /api/timetable/room-closures/:id/withdraw": {
    "name": "RoomClosuresController_withdraw",
    "method": "POST",
    "path": "/api/timetable/room-closures/:id/withdraw",
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
  "POST /api/timetable/vacancies/:id/journal-substitute": {
    "name": "JournalSubstitutionsController_vacancySubstitute",
    "method": "POST",
    "path": "/api/timetable/vacancies/:id/journal-substitute",
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
        "journalId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "teacherId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "from": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "until": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
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
        "journalId",
        "teacherId",
        "from",
        "reason"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/vacancy-fills": {
    "name": "VacancyFillsController_fill",
    "method": "POST",
    "path": "/api/timetable/vacancy-fills",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "vacancyId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "personId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "startsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "rows": {
          "minItems": 1,
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
              "groupId": {
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
              "subjectId"
            ],
            "additionalProperties": false
          }
        },
        "rowsKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "transitionKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "laterKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
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
        }
      },
      "required": [
        "vacancyId",
        "personId",
        "startsOn",
        "rowsKey"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/vacancy-fills/check": {
    "name": "VacancyFillsController_check",
    "method": "POST",
    "path": "/api/timetable/vacancy-fills/check",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "vacancyId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "personId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "startsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "rows": {
          "minItems": 1,
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
              "groupId": {
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
              "subjectId"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "vacancyId",
        "personId",
        "startsOn"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions": {
    "name": "TimetableController_createVersion",
    "method": "POST",
    "path": "/api/timetable/versions",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "academicYearId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "startsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "copyFrom": {
          "default": null,
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "academicYearId",
        "startsOn"
      ]
    }
  },
  "POST /api/timetable/versions/:id/edit-lock": {
    "name": "TimetableController_takeEditLock",
    "method": "POST",
    "path": "/api/timetable/versions/:id/edit-lock",
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
  "POST /api/timetable/versions/:id/export": {
    "name": "TimetableController_exportVersion",
    "method": "POST",
    "path": "/api/timetable/versions/:id/export",
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
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "branch"
              ]
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "format"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "class"
              ]
            },
            "classId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "classId",
            "format"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "teacher"
              ]
            },
            "staffId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "staffId",
            "format"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "room"
              ]
            },
            "roomId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "roomId",
            "format"
          ],
          "additionalProperties": false
        }
      ]
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
  "POST /api/timetable/versions/:id/load/imports/:importId/confirm": {
    "name": "LoadImportsController_confirm",
    "method": "POST",
    "path": "/api/timetable/versions/:id/load/imports/:importId/confirm",
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
        "name": "importId",
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
      "properties": {},
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/load/imports/:importId/preview": {
    "name": "LoadImportsController_preview",
    "method": "POST",
    "path": "/api/timetable/versions/:id/load/imports/:importId/preview",
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
        "name": "importId",
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
      "properties": {},
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/locks": {
    "name": "TimetableController_createLock",
    "method": "POST",
    "path": "/api/timetable/versions/:id/locks",
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
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "block"
              ]
            },
            "blockId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            }
          },
          "required": [
            "kind",
            "blockId"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "class"
              ]
            },
            "classId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            }
          },
          "required": [
            "kind",
            "classId"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "teacher"
              ]
            },
            "teacherId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            }
          },
          "required": [
            "kind",
            "teacherId"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "day"
              ]
            },
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
            }
          },
          "required": [
            "kind",
            "weekday"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "POST /api/timetable/versions/:id/pattern": {
    "name": "TimetableController_placeBlock",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pattern",
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
        "loadRowId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "partnerRowId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
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
        "slotPosition": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20
        },
        "roomId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "rooms": {
          "maxItems": 20,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "loadRowId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "roomId": {
                "nullable": true,
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            },
            "required": [
              "loadRowId",
              "roomId"
            ],
            "additionalProperties": false
          }
        },
        "double": {
          "type": "boolean"
        }
      },
      "required": [
        "loadRowId",
        "weekday",
        "slotPosition"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/pattern/:blockId/move": {
    "name": "TimetableController_moveBlock",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pattern/:blockId/move",
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
        "name": "blockId",
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
        "slotPosition": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20
        }
      },
      "required": [
        "weekday",
        "slotPosition"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/pattern/:blockId/room": {
    "name": "TimetableController_lessonRoom",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pattern/:blockId/room",
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
        "name": "blockId",
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
        "lessonId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "roomId": {
          "nullable": true,
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      "required": [
        "lessonId",
        "roomId"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/pattern/imports/:importId/confirm": {
    "name": "PatternImportsController_confirm",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pattern/imports/:importId/confirm",
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
        "name": "importId",
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
        "removes": {
          "maxItems": 20000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "removes"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/pattern/imports/:importId/preview": {
    "name": "PatternImportsController_preview",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pattern/imports/:importId/preview",
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
        "name": "importId",
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
      "properties": {},
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/pattern/rearrange": {
    "name": "TimetableController_rearrangeBlocks",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pattern/rearrange",
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
        "changes": {
          "maxItems": 3,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "blockId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "loadRowId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "partnerRowId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
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
              "slotPosition": {
                "type": "integer",
                "minimum": 1,
                "maximum": 20
              },
              "rooms": {
                "maxItems": 20,
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "loadRowId": {
                      "type": "string",
                      "format": "uuid",
                      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                    },
                    "roomId": {
                      "nullable": true,
                      "type": "string",
                      "format": "uuid",
                      "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                    }
                  },
                  "required": [
                    "loadRowId",
                    "roomId"
                  ],
                  "additionalProperties": false
                }
              }
            },
            "required": [
              "weekday",
              "slotPosition"
            ],
            "additionalProperties": false
          }
        },
        "remove": {
          "maxItems": 1,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "changes"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/pattern/swap": {
    "name": "TimetableController_swapBlocks",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pattern/swap",
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
        "blockIds": {
          "type": "array",
          "items": {
            "anyOf": [
              {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              }
            ]
          },
          "minItems": 2,
          "maxItems": 2
        }
      },
      "required": [
        "blockIds"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/pins": {
    "name": "TimetableController_createPin",
    "method": "POST",
    "path": "/api/timetable/versions/:id/pins",
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
        "loadRowId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
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
        "slotPosition": {
          "type": "integer",
          "minimum": 1,
          "maximum": 20
        }
      },
      "required": [
        "loadRowId",
        "weekday",
        "slotPosition"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/publish": {
    "name": "TimetableController_publish",
    "method": "POST",
    "path": "/api/timetable/versions/:id/publish",
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
        "transitionKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "chain": {
          "type": "string",
          "enum": [
            "run_until",
            "replace",
            "carry"
          ]
        },
        "laterKey": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
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
        }
      },
      "required": [
        "startsOn"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/rules/confirm": {
    "name": "TimetableController_confirmRules",
    "method": "POST",
    "path": "/api/timetable/versions/:id/rules/confirm",
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
        "weights": {
          "type": "object",
          "properties": {
            "class_no_gaps": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "teacher_few_gaps": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "subject_spread": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "demanding_early": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "class_even_days": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "main_room": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "part_time_few_days": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "teacher_preferred_times": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            }
          },
          "required": [
            "class_no_gaps",
            "teacher_few_gaps",
            "subject_spread",
            "demanding_early",
            "class_even_days",
            "main_room",
            "part_time_few_days",
            "teacher_preferred_times"
          ],
          "additionalProperties": false
        },
        "pins": {
          "maxItems": 2000,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "weights",
        "pins"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/templates/confirm": {
    "name": "TimetableController_confirmTemplates",
    "method": "POST",
    "path": "/api/timetable/versions/:id/templates/confirm",
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
  "POST /api/timetable/versions/:id/up-to-date": {
    "name": "TimetableController_bringUpToDate",
    "method": "POST",
    "path": "/api/timetable/versions/:id/up-to-date",
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
        "key": {
          "type": "string",
          "pattern": "^[0-9a-f]{64}$"
        },
        "picks": {
          "default": [],
          "maxItems": 2000,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "item": {
                "type": "string",
                "minLength": 1,
                "maxLength": 2000
              },
              "side": {
                "type": "string",
                "enum": [
                  "draft",
                  "published"
                ]
              }
            },
            "required": [
              "item",
              "side"
            ],
            "additionalProperties": false
          }
        }
      },
      "required": [
        "key"
      ],
      "additionalProperties": false
    }
  },
  "POST /api/timetable/versions/:id/withdraw": {
    "name": "TimetableController_withdraw",
    "method": "POST",
    "path": "/api/timetable/versions/:id/withdraw",
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
        }
      },
      "additionalProperties": false
    }
  },
  "POST /api/timetable/views/export": {
    "name": "TimetableViewsController_export",
    "method": "POST",
    "path": "/api/timetable/views/export",
    "parameters": [],
    "body": {
      "oneOf": [
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "branch"
              ]
            },
            "date": {
              "type": "string",
              "format": "date",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
            },
            "span": {
              "type": "string",
              "enum": [
                "day",
                "week"
              ]
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "date",
            "span",
            "format"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "class"
              ]
            },
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
            "span": {
              "type": "string",
              "enum": [
                "day",
                "week"
              ]
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "classId",
            "date",
            "span",
            "format"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "teacher"
              ]
            },
            "staffId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "date": {
              "type": "string",
              "format": "date",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
            },
            "span": {
              "type": "string",
              "enum": [
                "day",
                "week"
              ]
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "staffId",
            "date",
            "span",
            "format"
          ],
          "additionalProperties": false
        },
        {
          "type": "object",
          "properties": {
            "kind": {
              "type": "string",
              "enum": [
                "room"
              ]
            },
            "roomId": {
              "type": "string",
              "format": "uuid",
              "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
            },
            "date": {
              "type": "string",
              "format": "date",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
            },
            "span": {
              "type": "string",
              "enum": [
                "day",
                "week"
              ]
            },
            "format": {
              "type": "string",
              "enum": [
                "pdf",
                "xlsx"
              ]
            }
          },
          "required": [
            "kind",
            "roomId",
            "date",
            "span",
            "format"
          ],
          "additionalProperties": false
        }
      ]
    }
  },
  "PUT /api/announcements/:id": {
    "name": "AnnouncementsController_edit",
    "method": "PUT",
    "path": "/api/announcements/:id",
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
        "title": {
          "type": "string",
          "minLength": 1,
          "maxLength": 120
        },
        "body": {
          "type": "string",
          "minLength": 1,
          "maxLength": 2000
        },
        "event": {
          "nullable": true,
          "type": "object",
          "properties": {
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
            "startsAt": {
              "nullable": true,
              "type": "string",
              "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"
            },
            "endsAt": {
              "nullable": true,
              "type": "string",
              "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"
            },
            "place": {
              "nullable": true,
              "type": "string",
              "minLength": 1,
              "maxLength": 120
            }
          },
          "required": [
            "firstDate",
            "lastDate",
            "startsAt",
            "endsAt",
            "place"
          ],
          "additionalProperties": false
        },
        "version": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "title",
        "body",
        "event",
        "version"
      ],
      "additionalProperties": false
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
  "PUT /api/exemptions/:id/document": {
    "name": "ExemptionsController_putDocument",
    "method": "PUT",
    "path": "/api/exemptions/:id/document",
    "parameters": [
      {
        "name": "name",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
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
  "PUT /api/integration-keys/:id/end-date": {
    "name": "IntegrationKeysController_changeEnd",
    "method": "PUT",
    "path": "/api/integration-keys/:id/end-date",
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
        "endsOn": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "endsOn"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/integration-keys/:id/people": {
    "name": "IntegrationKeysController_changePeople",
    "method": "PUT",
    "path": "/api/integration-keys/:id/people",
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
        "staffRecordIds": {
          "minItems": 1,
          "maxItems": 200,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "staffRecordIds"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/comments": {
    "name": "CommentsController_save",
    "method": "PUT",
    "path": "/api/journal/comments",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "on": {
          "oneOf": [
            {
              "type": "object",
              "properties": {
                "target": {
                  "type": "string",
                  "enum": [
                    "mark"
                  ]
                },
                "lessonId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "studentId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "target",
                "lessonId",
                "studentId"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "target": {
                  "type": "string",
                  "enum": [
                    "note"
                  ]
                },
                "lessonId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "studentId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "target",
                "lessonId",
                "studentId"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "target": {
                  "type": "string",
                  "enum": [
                    "work"
                  ]
                },
                "lessonId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "workId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "studentId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "target",
                "lessonId",
                "workId",
                "studentId"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "target": {
                  "type": "string",
                  "enum": [
                    "rating"
                  ]
                },
                "journalId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "quarterId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "studentId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "target",
                "journalId",
                "quarterId",
                "studentId"
              ],
              "additionalProperties": false
            }
          ]
        },
        "body": {
          "nullable": true,
          "type": "string",
          "minLength": 1,
          "maxLength": 1000
        },
        "visibility": {
          "type": "string",
          "enum": [
            "staff",
            "parents"
          ]
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "correction": {
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
      "required": [
        "on",
        "body",
        "visibility",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/journals/:journalId/rating/:quarterId/date": {
    "name": "RatingController_date",
    "method": "PUT",
    "path": "/api/journal/journals/:journalId/rating/:quarterId/date",
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
        "date": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "date",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/journals/:journalId/rating/:quarterId/not-held": {
    "name": "RatingController_notHeld",
    "method": "PUT",
    "path": "/api/journal/journals/:journalId/rating/:quarterId/not-held",
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
        "notHeld": {
          "type": "boolean"
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "confirm": {
          "default": false,
          "type": "boolean"
        }
      },
      "required": [
        "notHeld",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/lessons/:lessonId/delivery": {
    "name": "LessonCardController_setDelivery",
    "method": "PUT",
    "path": "/api/journal/lessons/:lessonId/delivery",
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
        "notDelivered": {
          "type": "boolean"
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "notDelivered",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/lessons/:lessonId/homework-given": {
    "name": "LessonCardController_setHomework",
    "method": "PUT",
    "path": "/api/journal/lessons/:lessonId/homework-given",
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
        "planWorkIds": {
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "notGiven": {
          "type": "boolean"
        }
      },
      "required": [
        "planWorkIds",
        "notGiven"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/lessons/:lessonId/plan-works/:planWorkId/title": {
    "name": "WorksController_renamePlanWork",
    "method": "PUT",
    "path": "/api/journal/lessons/:lessonId/plan-works/:planWorkId/title",
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
      },
      {
        "name": "planWorkId",
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
        "title": {
          "type": "string",
          "minLength": 1
        },
        "baseTitle": {
          "type": "string"
        }
      },
      "required": [
        "title",
        "baseTitle"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/lessons/:lessonId/topic": {
    "name": "WorksController_saveTopic",
    "method": "PUT",
    "path": "/api/journal/lessons/:lessonId/topic",
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
        "topic": {
          "type": "string",
          "maxLength": 300
        },
        "baseTopic": {
          "type": "string"
        },
        "correction": {
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
      "required": [
        "topic",
        "baseTopic"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/lessons/:lessonId/works/:workId/title": {
    "name": "WorksController_rename",
    "method": "PUT",
    "path": "/api/journal/lessons/:lessonId/works/:workId/title",
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
      },
      {
        "name": "workId",
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
        "title": {
          "type": "string",
          "minLength": 1
        },
        "version": {
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "title",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/lessons/:lessonId/works/not-held": {
    "name": "WorksController_notHeld",
    "method": "PUT",
    "path": "/api/journal/lessons/:lessonId/works/not-held",
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
        "column": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "workId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "workId"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "planWorkId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "sourceLessonId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "planWorkId",
                "sourceLessonId"
              ],
              "additionalProperties": false
            }
          ]
        },
        "notHeld": {
          "type": "boolean"
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "confirm": {
          "default": false,
          "type": "boolean"
        },
        "correction": {
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
      "required": [
        "column",
        "notHeld",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/lessons/:lessonId/works/total": {
    "name": "WorksController_total",
    "method": "PUT",
    "path": "/api/journal/lessons/:lessonId/works/total",
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
        "column": {
          "anyOf": [
            {
              "type": "object",
              "properties": {
                "workId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "workId"
              ],
              "additionalProperties": false
            },
            {
              "type": "object",
              "properties": {
                "planWorkId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                },
                "sourceLessonId": {
                  "type": "string",
                  "format": "uuid",
                  "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
                }
              },
              "required": [
                "planWorkId",
                "sourceLessonId"
              ],
              "additionalProperties": false
            }
          ]
        },
        "total": {
          "type": "integer",
          "minimum": 1,
          "maximum": 1000
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        },
        "confirm": {
          "default": false,
          "type": "boolean"
        },
        "correction": {
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
      "required": [
        "column",
        "total",
        "version"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/student-absences/:studentId/:date": {
    "name": "StudentAbsencesController_set",
    "method": "PUT",
    "path": "/api/journal/student-absences/:studentId/:date",
    "parameters": [
      {
        "name": "studentId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "date",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      }
    ],
    "body": {
      "type": "object",
      "properties": {
        "category": {
          "nullable": true,
          "type": "string",
          "enum": [
            "illness",
            "family",
            "school_permitted",
            "unexcused",
            "unknown"
          ]
        },
        "note": {
          "type": "string",
          "maxLength": 500
        }
      },
      "required": [
        "category",
        "note"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/journal/student-absences/:studentId/:date/file": {
    "name": "StudentAbsencesController_putFile",
    "method": "PUT",
    "path": "/api/journal/student-absences/:studentId/:date/file",
    "parameters": [
      {
        "name": "name",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "minLength": 1,
          "maxLength": 200
        }
      },
      {
        "name": "studentId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
      {
        "name": "date",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      }
    ]
  },
  "PUT /api/people/staff/:id": {
    "name": "StaffController_edit",
    "method": "PUT",
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
    ],
    "body": {
      "type": "object",
      "properties": {
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "fatherName": {
          "nullable": true,
          "type": "string"
        },
        "sex": {
          "type": "string",
          "enum": [
            "male",
            "female"
          ]
        },
        "birthDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "educationLevel": {
          "nullable": true,
          "type": "string",
          "enum": [
            "secondary",
            "specialised_secondary",
            "bachelor",
            "master",
            "phd",
            "other"
          ]
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "email": {
          "nullable": true,
          "type": "string"
        },
        "jshshir": {
          "nullable": true,
          "type": "string"
        },
        "admissionDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "contractType": {
          "nullable": true,
          "type": "string",
          "enum": [
            "full_time",
            "part_time"
          ]
        },
        "contractDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
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
        },
        "divisions": {
          "minItems": 1,
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "divisionId": {
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "departmentId": {
                "nullable": true,
                "type": "string",
                "format": "uuid",
                "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
              },
              "main": {
                "type": "boolean"
              }
            },
            "required": [
              "divisionId",
              "departmentId",
              "main"
            ]
          }
        },
        "departmentStartsOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "firstName",
        "lastName",
        "fatherName",
        "sex",
        "birthDate",
        "educationLevel",
        "phone",
        "email",
        "jshshir",
        "admissionDate",
        "contractType",
        "contractDate",
        "weeklyLessons",
        "dailyLessons",
        "divisions"
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
  "PUT /api/people/staff/:id/branches": {
    "name": "StaffController_branches",
    "method": "PUT",
    "path": "/api/people/staff/:id/branches",
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
        "mainBranchId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "furtherBranchIds": {
          "maxItems": 10,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "mainBranchId",
        "furtherBranchIds"
      ]
    }
  },
  "PUT /api/people/staff/:id/photo": {
    "name": "StaffPhotosController_setPhoto",
    "method": "PUT",
    "path": "/api/people/staff/:id/photo",
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
  "PUT /api/people/staff/imports": {
    "name": "StaffController_importUpload",
    "method": "PUT",
    "path": "/api/people/staff/imports",
    "parameters": []
  },
  "PUT /api/people/students/:id": {
    "name": "StudentsController_edit",
    "method": "PUT",
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
    ],
    "body": {
      "type": "object",
      "properties": {
        "firstName": {
          "type": "string"
        },
        "lastName": {
          "type": "string"
        },
        "paternalName": {
          "nullable": true,
          "type": "string"
        },
        "sex": {
          "type": "string",
          "enum": [
            "male",
            "female"
          ]
        },
        "birthDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "grade": {
          "type": "integer",
          "minimum": 0,
          "maximum": 11
        },
        "documentType": {
          "nullable": true,
          "type": "string",
          "enum": [
            "passport",
            "id_card",
            "birth_certificate"
          ]
        },
        "documentNumber": {
          "nullable": true,
          "type": "string"
        },
        "jshshir": {
          "nullable": true,
          "type": "string"
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "email": {
          "nullable": true,
          "type": "string"
        },
        "address": {
          "nullable": true,
          "type": "string"
        },
        "region": {
          "nullable": true,
          "type": "string",
          "enum": [
            "andijan",
            "bukhara",
            "fergana",
            "jizzakh",
            "kashkadarya",
            "khorezm",
            "namangan",
            "navoi",
            "samarkand",
            "surkhandarya",
            "syrdarya",
            "tashkent_region",
            "karakalpakstan",
            "tashkent_city",
            "other"
          ]
        },
        "previousSchool": {
          "nullable": true,
          "type": "string"
        },
        "diagnosticScore": {
          "nullable": true,
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "scholarship": {
          "default": {
            "type": "none",
            "coverage": null,
            "amount": null
          },
          "type": "object",
          "properties": {
            "type": {
              "type": "string",
              "enum": [
                "none",
                "merit",
                "financial_aid",
                "gift"
              ]
            },
            "coverage": {
              "nullable": true,
              "type": "string",
              "enum": [
                "full",
                "partial"
              ]
            },
            "amount": {
              "nullable": true,
              "type": "integer",
              "minimum": 1,
              "maximum": 1000000000
            }
          },
          "required": [
            "type",
            "coverage",
            "amount"
          ]
        },
        "consentSignedOn": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        },
        "contract": {
          "nullable": true,
          "type": "object",
          "properties": {
            "number": {
              "nullable": true,
              "type": "string"
            },
            "signedOn": {
              "type": "string",
              "format": "date",
              "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
            }
          },
          "required": [
            "number",
            "signedOn"
          ]
        }
      },
      "required": [
        "firstName",
        "lastName",
        "paternalName",
        "sex",
        "birthDate",
        "grade",
        "documentType",
        "documentNumber",
        "jshshir",
        "phone",
        "email",
        "address",
        "region",
        "previousSchool",
        "diagnosticScore",
        "consentSignedOn",
        "contract"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/people/students/:id/photo": {
    "name": "StudentPhotosController_setPhoto",
    "method": "PUT",
    "path": "/api/people/students/:id/photo",
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
  "PUT /api/people/students/imports": {
    "name": "StudentsController_importUpload",
    "method": "PUT",
    "path": "/api/people/students/imports",
    "parameters": []
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
  "PUT /api/plans/items/:itemId/files": {
    "name": "PlansController_addFile",
    "method": "PUT",
    "path": "/api/plans/items/:itemId/files",
    "parameters": [
      {
        "name": "name",
        "in": "query",
        "required": true,
        "schema": {
          "type": "string",
          "maxLength": 200
        }
      },
      {
        "name": "workId",
        "in": "query",
        "required": false,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
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
    ]
  },
  "PUT /api/plans/journals/:journalId/queue": {
    "name": "PlansController_editQueue",
    "method": "PUT",
    "path": "/api/plans/journals/:journalId/queue",
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
        "base": {
          "maxItems": 400,
          "type": "array",
          "items": {
            "nullable": true,
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        },
        "order": {
          "maxItems": 400,
          "type": "array",
          "items": {
            "nullable": true,
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "quarterId",
        "base",
        "order"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/plans/masters/:masterId/items/:itemId": {
    "name": "PlanMastersController_saveItem",
    "method": "PUT",
    "path": "/api/plans/masters/:masterId/items/:itemId",
    "parameters": [
      {
        "name": "masterId",
        "in": "path",
        "required": true,
        "schema": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        }
      },
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
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
        "revision",
        "values"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/plans/masters/:masterId/order": {
    "name": "PlanMastersController_order",
    "method": "PUT",
    "path": "/api/plans/masters/:masterId/order",
    "parameters": [
      {
        "name": "masterId",
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
        "revision": {
          "type": "integer",
          "minimum": 0,
          "maximum": 9007199254740991
        },
        "order": {
          "maxItems": 400,
          "type": "array",
          "items": {
            "type": "string",
            "format": "uuid",
            "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
          }
        }
      },
      "required": [
        "revision",
        "order"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/plans/minimums": {
    "name": "PlanMinimumsController_save",
    "method": "PUT",
    "path": "/api/plans/minimums",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "classworks": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "homeworks": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "subjectId",
        "classworks",
        "homeworks",
        "version"
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
  "PUT /api/results/closing/:quarterId/decisions": {
    "name": "ClosingController_decide",
    "method": "PUT",
    "path": "/api/results/closing/:quarterId/decisions",
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
        "subjectId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "studentId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "decision": {
          "nullable": true,
          "type": "string",
          "enum": [
            "keep",
            "exempt",
            "not_assessed"
          ]
        },
        "version": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 9007199254740991
        }
      },
      "required": [
        "subjectId",
        "studentId",
        "decision",
        "version"
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
  "PUT /api/setup/branch": {
    "name": "BranchesController_edit",
    "method": "PUT",
    "path": "/api/setup/branch",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "name": {
          "type": "string",
          "minLength": 1,
          "maxLength": 100
        },
        "address": {
          "nullable": true,
          "type": "string",
          "maxLength": 300
        },
        "phone": {
          "nullable": true,
          "type": "string"
        },
        "email": {
          "nullable": true,
          "type": "string",
          "maxLength": 200
        },
        "workingWeekdays": {
          "minItems": 1,
          "maxItems": 7,
          "type": "array",
          "items": {
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
          }
        }
      },
      "required": [
        "name",
        "address",
        "phone",
        "email",
        "workingWeekdays"
      ]
    }
  },
  "PUT /api/setup/branch/go-live": {
    "name": "BranchesController_setGoLive",
    "method": "PUT",
    "path": "/api/setup/branch/go-live",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "goLiveDate": {
          "nullable": true,
          "type": "string",
          "format": "date",
          "pattern": "^(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))$"
        }
      },
      "required": [
        "goLiveDate"
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
  "PUT /api/setup/departments/:id": {
    "name": "DivisionsController_renameDepartment",
    "method": "PUT",
    "path": "/api/setup/departments/:id",
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
        }
      },
      "required": [
        "names"
      ]
    }
  },
  "PUT /api/setup/divisions/:id": {
    "name": "DivisionsController_rename",
    "method": "PUT",
    "path": "/api/setup/divisions/:id",
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
        }
      },
      "required": [
        "names"
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
  "PUT /api/setup/quarters/:id/attendance-values": {
    "name": "SettingsController_setAttendanceValues",
    "method": "PUT",
    "path": "/api/setup/quarters/:id/attendance-values",
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
        "lateValue": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "skippedValue": {
          "type": "integer",
          "minimum": 0,
          "maximum": 100
        },
        "reason": {
          "type": "string",
          "minLength": 1,
          "maxLength": 500
        }
      },
      "required": [
        "lateValue",
        "skippedValue"
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
  "PUT /api/setup/school-settings/digest": {
    "name": "DigestController_change",
    "method": "PUT",
    "path": "/api/setup/school-settings/digest",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "sendAt": {
          "type": "string",
          "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"
        },
        "quietFrom": {
          "type": "string",
          "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"
        },
        "quietUntil": {
          "type": "string",
          "pattern": "^(?:[01]\\d|2[0-3]):[0-5]\\d$"
        }
      },
      "required": [
        "sendAt",
        "quietFrom",
        "quietUntil"
      ],
      "additionalProperties": false
    }
  },
  "PUT /api/setup/settings/class-daily-lessons": {
    "name": "SettingsController_setClassDailyLessons",
    "method": "PUT",
    "path": "/api/setup/settings/class-daily-lessons",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "classDailyLessons": {
          "nullable": true,
          "type": "integer",
          "minimum": 1,
          "maximum": 12
        }
      },
      "required": [
        "classDailyLessons"
      ]
    }
  },
  "PUT /api/setup/settings/early-warning": {
    "name": "SettingsController_setEarlyWarning",
    "method": "PUT",
    "path": "/api/setup/settings/early-warning",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "lowResult": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "resultDrop": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "attendancePercent": {
          "type": "integer",
          "minimum": 1,
          "maximum": 100
        },
        "absencesInRow": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        }
      },
      "required": [
        "lowResult",
        "resultDrop",
        "attendancePercent",
        "absencesInRow"
      ]
    }
  },
  "PUT /api/setup/settings/edit-days": {
    "name": "SettingsController_setEditDays",
    "method": "PUT",
    "path": "/api/setup/settings/edit-days",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "editDays": {
          "type": "integer",
          "minimum": 1,
          "maximum": 30
        }
      },
      "required": [
        "editDays"
      ]
    }
  },
  "PUT /api/setup/settings/plan-windows": {
    "name": "SettingsController_setPlanWindows",
    "method": "PUT",
    "path": "/api/setup/settings/plan-windows",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "planWindows": {
          "type": "boolean"
        }
      },
      "required": [
        "planWindows"
      ],
      "additionalProperties": false
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
        "demanding"
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
  "PUT /api/setup/subjects/imports": {
    "name": "SubjectsController_importUpload",
    "method": "PUT",
    "path": "/api/setup/subjects/imports",
    "parameters": []
  },
  "PUT /api/setup/travel-times": {
    "name": "TravelTimesController_set",
    "method": "PUT",
    "path": "/api/setup/travel-times",
    "parameters": [],
    "body": {
      "type": "object",
      "properties": {
        "otherBranchId": {
          "type": "string",
          "format": "uuid",
          "pattern": "^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$"
        },
        "minutes": {
          "type": "integer",
          "minimum": 0,
          "maximum": 180
        }
      },
      "required": [
        "otherBranchId",
        "minutes"
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
  },
  "PUT /api/timetable/versions/:id/day-keeps": {
    "name": "TimetableController_setDayKeep",
    "method": "PUT",
    "path": "/api/timetable/versions/:id/day-keeps",
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
  "PUT /api/timetable/versions/:id/load/imports": {
    "name": "LoadImportsController_upload",
    "method": "PUT",
    "path": "/api/timetable/versions/:id/load/imports",
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
  "PUT /api/timetable/versions/:id/pattern/imports": {
    "name": "PatternImportsController_upload",
    "method": "PUT",
    "path": "/api/timetable/versions/:id/pattern/imports",
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
  "PUT /api/timetable/versions/:id/preferences": {
    "name": "TimetableController_saveWeights",
    "method": "PUT",
    "path": "/api/timetable/versions/:id/preferences",
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
        "weights": {
          "type": "object",
          "properties": {
            "class_no_gaps": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "teacher_few_gaps": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "subject_spread": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "demanding_early": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "class_even_days": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "main_room": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "part_time_few_days": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            },
            "teacher_preferred_times": {
              "type": "integer",
              "minimum": 0,
              "maximum": 10
            }
          },
          "required": [
            "class_no_gaps",
            "teacher_few_gaps",
            "subject_spread",
            "demanding_early",
            "class_even_days",
            "main_room",
            "part_time_few_days",
            "teacher_preferred_times"
          ],
          "additionalProperties": false
        }
      },
      "required": [
        "weights"
      ],
      "additionalProperties": false
    }
  }
};
