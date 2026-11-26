// Written by `pnpm assistant:map` from the code of the web app (apps/web/tooling/platform-map/).
// Do not edit: `apps/web/tooling/platform-map.test.ts` fails when this is not what it writes.
export const PLATFORM_MAP_SOURCE: unknown = {
 "pages": [
  {
   "id": "page:/",
   "path": "/",
   "title": {
    "uz": "Bosh sahifa",
    "ru": "Главная",
    "en": "Home"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "The first screen after signing in, filled for the active role: today's lessons, own journals, early warnings, requests waiting, lessons that need a teacher or a room, or the branch summary. A button opens the announcements and events."
  },
  {
   "id": "page:/account",
   "path": "/account",
   "title": {
    "uz": "Hisob",
    "ru": "Учётная запись",
    "en": "Account"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "params": {},
   "search": {},
   "operations": [
    "AuthController_signOutEverywhere",
    "OwnPhotoController_removePhoto",
    "TrustedDevicesController_remove",
    "TwoStepController_confirm",
    "TwoStepController_setUp",
    "TwoStepController_turnOff"
   ],
   "description": "The person's own account: photo, language, password, the open sessions with sign out everywhere, the sign-in history, the trusted devices and the second step at sign-in."
  },
  {
   "id": "page:/account/password",
   "path": "/account/password",
   "title": {
    "uz": "Parolni oʻzgartirish",
    "ru": "Смена пароля",
    "en": "Change password"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "params": {},
   "search": {},
   "operations": [
    "AuthController_changePassword",
    "AuthController_signOut"
   ],
   "description": "Changes the person's own password: type the current password, then the new one twice. Other sessions are signed out and this device is no longer trusted. After a one-time password, the new password must be chosen here before going on."
  },
  {
   "id": "page:/announcements",
   "path": "/announcements",
   "title": {
    "uz": "Eʼlonlar va tadbirlar",
    "ru": "Объявления и мероприятия",
    "en": "Announcements and events"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "params": {},
   "search": {
    "month": {
     "kind": "month"
    },
    "view": {
     "kind": "enum",
     "values": [
      "list",
      "calendar"
     ]
    }
   },
   "operations": [],
   "description": "Shows the announcements and events published for the person this month, as a list or on a calendar, with buttons to move between months. A link leads to writing announcements where that is allowed."
  },
  {
   "id": "page:/announcements/manage",
   "path": "/announcements/manage",
   "title": {
    "uz": "Eʼlon yozish",
    "ru": "Писать объявления",
    "en": "Write announcements"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the announcements and events of the branch with their audience, publish date and the delivery of messages to parents. Here one adds a new announcement or event, edits one, and archives or restores it."
  },
  {
   "id": "page:/assistant",
   "path": "/assistant",
   "title": {
    "uz": "Yordamchi",
    "ru": "Помощник",
    "en": "Assistant"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "teacher"
   ],
   "params": {},
   "search": {
    "conversation": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "The full-page assistant: the list of the person's own conversations, a new conversation, and the chat where one asks how to do things on the platform or asks it to prepare changes that are confirmed before they run."
  },
  {
   "id": "page:/assistant-conversations",
   "path": "/assistant-conversations",
   "title": {
    "uz": "Yordamchi suhbatlari",
    "ru": "Разговоры с помощником",
    "en": "Assistant conversations"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "state": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "AssistantAdminController_restore"
   ],
   "description": "Lists every conversation people had with the assistant, with person, role, branch and last activity. Opening one shows it; a removed conversation can be restored to its person's list."
  },
  {
   "id": "page:/audit",
   "path": "/audit",
   "title": {
    "uz": "Audit jurnali",
    "ru": "Журнал аудита",
    "en": "Audit log"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    },
    "person": {
     "kind": "id"
    },
    "recordType": {
     "kind": "text"
    },
    "recordId": {
     "kind": "id"
    },
    "from": {
     "kind": "date"
    },
    "to": {
     "kind": "date"
    },
    "group": {
     "kind": "enum",
     "values": [
      "classes",
      "plans",
      "sign_in",
      "accounts",
      "setup",
      "people",
      "timetable",
      "journal",
      "exports",
      "announcements",
      "feedback",
      "integration_keys",
      "assistant",
      "shows"
     ]
    },
    "scope": {
     "kind": "enum",
     "values": [
      "branch",
      "all",
      "school"
     ]
    },
    "personKind": {
     "kind": "enum",
     "values": [
      "staff",
      "student",
      "relative"
     ]
    }
   },
   "operations": [
    "AuditLogController_show"
   ],
   "description": "Searches the audit log: every recorded change, sign-in and export, filtered by dates, kind, branch scope and person. Opening an entry shows before and after values; hidden values can be shown on purpose."
  },
  {
   "id": "page:/classes",
   "path": "/classes",
   "title": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Classes"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "grade": {
       "kind": "enum",
       "values": [
        "0",
        "1",
        "10",
        "11",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
       ]
      },
      "language": {
       "kind": "enum",
       "values": [
        "ru",
        "uz"
       ]
      },
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      },
      "tutor": {
       "kind": "enum",
       "values": [
        "none",
        "some"
       ]
      },
      "year": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "ClassesController_withdraw"
   ],
   "description": "Lists the classes of the branch with year, language, Tutor or Class teacher, main classroom, students, average and attendance. Here one adds a class, opens its record to edit it, archives it, and goes to the groups."
  },
  {
   "id": "page:/feedback-reports",
   "path": "/feedback-reports",
   "title": {
    "uz": "Fikr-mulohazalar",
    "ru": "Отзывы",
    "en": "Feedback reports"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "role": {
       "kind": "enum",
       "values": [
        "academic_vice_principal",
        "class_teacher",
        "head_teacher",
        "head_tutor",
        "hr",
        "librarian",
        "nurse",
        "parent",
        "principal",
        "psychologist",
        "senior_head_teacher",
        "spiritual_vice_principal",
        "student",
        "super_admin",
        "teacher",
        "tutor"
       ]
      },
      "state": {
       "kind": "enum",
       "values": [
        "handled",
        "new"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "FeedbackReportsController_handled",
    "FeedbackReportsController_reopened"
   ],
   "description": "Lists the reports people sent with the feedback button of any page: the text, sender, roles, page and time. Each report can be marked handled or back to new."
  },
  {
   "id": "page:/forced-deletes",
   "path": "/forced-deletes",
   "title": {
    "uz": "Butunlay oʻchirilganlar",
    "ru": "Удалённые окончательно",
    "en": "Deleted for good"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "state": {
       "kind": "enum",
       "values": [
        "expired",
        "restorable",
        "restored"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "ForcedDeletesController_restore"
   ],
   "description": "Lists lessons, buildings, floors and rooms deleted for good in the last 30 days, with the reason and who deleted them. A record can be restored from here while its 30 days run."
  },
  {
   "id": "page:/groups",
   "path": "/groups",
   "title": {
    "uz": "Guruhlar",
    "ru": "Группы",
    "en": "Groups"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "grade": {
       "kind": "enum",
       "values": [
        "0",
        "1",
        "10",
        "11",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
       ]
      },
      "language": {
       "kind": "enum",
       "values": [
        "ru",
        "uz"
       ]
      },
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      },
      "subject": {
       "kind": "id"
      },
      "year": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "GroupsController_archive",
    "GroupsController_restore",
    "GroupsController_reviewed",
    "GroupsController_withdraw"
   ],
   "description": "Lists the groups of the branch: subject, classes drawn from, language, students, teacher, average and attendance. Here one adds a group, edits or archives it, and opens the placement of students."
  },
  {
   "id": "page:/groups/placement",
   "path": "/groups/placement",
   "title": {
    "uz": "Guruhlarga taqsimlash",
    "ru": "Распределение по группам",
    "en": "Group placement"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "GroupsController_placeAutomatically"
   ],
   "description": "Places students into groups in bulk: choose a subject, grades and a date, tick the students not yet in a group of the subject and put them into a chosen group, or place them automatically."
  },
  {
   "id": "page:/integration-keys",
   "path": "/integration-keys",
   "title": {
    "uz": "Integratsiya kalitlari",
    "ru": "Ключи интеграции",
    "en": "Integration keys"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "state": {
       "kind": "enum",
       "values": [
        "active",
        "ended",
        "revoked"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "IntegrationKeysController_revoke"
   ],
   "description": "Lists the integration keys that let a department platform work for chosen people. Here one creates a key (its secret is shown once), changes its end date or people, and revokes it."
  },
  {
   "id": "page:/journal",
   "path": "/journal",
   "title": {
    "uz": "Jurnallar",
    "ru": "Журналы",
    "en": "Journals"
   },
   "roles": [
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
   ],
   "params": {},
   "search": {
    "tab": {
     "kind": "enum",
     "values": [
      "class",
      "group"
     ]
    },
    "year": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "subject": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the journals of the branch by class or by group for an academic year; opening one shows the class journal. Links lead to absences, unlock requests, exemptions, discipline, orphan lessons, closing, exports and the support view."
  },
  {
   "id": "page:/journal/$journalId",
   "path": "/journal/$journalId",
   "title": {
    "uz": "Sinf jurnali",
    "ru": "Классный журнал",
    "en": "Class journal"
   },
   "roles": [
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
   ],
   "params": {
    "journalId": {
     "kind": "id"
    }
   },
   "search": {
    "quarter": {
     "kind": "id"
    },
    "month": {
     "kind": "month"
    },
    "date": {
     "kind": "date"
    },
    "q": {
     "kind": "text"
    },
    "filter": {
     "kind": "enum",
     "values": [
      "all",
      "members",
      "left",
      "empty"
     ]
    },
    "mode": {
     "kind": "enum",
     "values": [
      "lesson"
     ]
    },
    "view": {
     "kind": "enum",
     "values": [
      "full"
     ]
    }
   },
   "operations": [
    "UnlocksController_decide",
    "UnlocksController_withdraw"
   ],
   "description": "The class journal of one class or group and subject for a quarter: attendance, marks and work scores in a grid or in lesson mode, with the quarter results and grades worked out by the platform. Cells are entered and undone here while the lesson is open."
  },
  {
   "id": "page:/journal/discipline",
   "path": "/journal/discipline",
   "title": {
    "uz": "Jurnal intizomi",
    "ru": "Дисциплина журнала",
    "en": "Journal discipline"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    },
    "from": {
     "kind": "date"
    },
    "to": {
     "kind": "date"
    },
    "department": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Shows per teacher, for a date range and department, how journals were kept: lessons held, nothing entered, in progress, complete, locked incomplete, attendance not marked, no topic, missing scores and late entries. Each count opens what is counted; it exports to Excel."
  },
  {
   "id": "page:/journal/exemptions",
   "path": "/journal/exemptions",
   "title": {
    "uz": "Ozod qilishlar",
    "ru": "Освобождения",
    "en": "Exemptions"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "class": {
       "kind": "text"
      },
      "kind": {
       "kind": "enum",
       "values": [
        "full",
        "temporary"
       ]
      },
      "state": {
       "kind": "enum",
       "values": [
        "coming",
        "ended",
        "ending_this_week",
        "in_force",
        "voided"
       ]
      },
      "subject": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    },
    "view": {
     "kind": "enum",
     "values": [
      "list",
      "absences",
      "offers"
     ]
    }
   },
   "operations": [
    "ExemptionsController_batchVoid",
    "ExemptionsController_confirm",
    "ExemptionsController_confirmPreview",
    "ExemptionsController_create",
    "ExemptionsController_document",
    "ExemptionsController_drop",
    "ExemptionsController_end",
    "ExemptionsController_endPreview",
    "ExemptionsController_offerReason",
    "ExemptionsController_preview",
    "ExemptionsController_reason",
    "ExemptionsController_removeDocument",
    "ExemptionsController_void",
    "ExemptionsController_voidPreview"
   ],
   "description": "Lists the exemptions of students from subjects or whole days, with their dates and reasons. Here one enters new exemptions, ends or voids them, attaches documents, and acts on absences with a reason and exemptions offered by a branch move."
  },
  {
   "id": "page:/journal/exports",
   "path": "/journal/exports",
   "title": {
    "uz": "Filial eksporti",
    "ru": "Экспорт филиала",
    "en": "Export of the branch"
   },
   "roles": [
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
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "JournalExportsController_download",
    "JournalExportsController_requestBranch"
   ],
   "description": "Asks for an export of the branch's journals for a quarter or month as Excel or PDF, made in the background, and lists the exports asked for with their status and a download link."
  },
  {
   "id": "page:/journal/orphans",
   "path": "/journal/orphans",
   "title": {
    "uz": "Oʻqituvchisiz darslar",
    "ru": "Уроки без учителя",
    "en": "Orphan lessons"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "LessonStatusController_withdraw"
   ],
   "description": "Lists incomplete lessons of teachers who have left the school. Here one assigns another teacher to complete a lesson for some days with a reason, or withdraws that assignment."
  },
  {
   "id": "page:/journal/student-absences",
   "path": "/journal/student-absences",
   "title": {
    "uz": "Oʻquvchilarning dars qoldirishlari",
    "ru": "Пропуски учеников",
    "en": "Student absences"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "category": {
       "kind": "enum",
       "values": [
        "family",
        "illness",
        "none",
        "school_permitted",
        "unexcused",
        "unknown"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    },
    "class": {
     "kind": "id"
    },
    "from": {
     "kind": "date"
    },
    "to": {
     "kind": "date"
    }
   },
   "operations": [
    "StudentAbsencesController_readFile",
    "StudentAbsencesController_removeFile",
    "StudentAbsencesController_set"
   ],
   "description": "Lists, by student and day, the absences of a class in a date range. Here one sets or clears the reason of an absence, adds a note and attaches or removes a supporting file."
  },
  {
   "id": "page:/journal/support",
   "path": "/journal/support",
   "title": {
    "uz": "Yordam koʻrinishi",
    "ru": "Вид поддержки",
    "en": "Support view"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "journal": {
     "kind": "id"
    },
    "student": {
     "kind": "id"
    },
    "date": {
     "kind": "date"
    }
   },
   "operations": [],
   "description": "Shows, for one journal, date and student, every save, refusal and exemption event of the student's cells in order, with how the result was calculated. Used to answer questions such as a mark that disappeared."
  },
  {
   "id": "page:/journal/unlocks",
   "path": "/journal/unlocks",
   "title": {
    "uz": "Ochish soʻrovlari",
    "ru": "Запросы на открытие",
    "en": "Unlock requests"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    },
    "view": {
     "kind": "enum",
     "values": [
      "branch",
      "deciding",
      "own"
     ]
    }
   },
   "operations": [
    "UnlocksController_decide",
    "UnlocksController_withdraw"
   ],
   "description": "Lists the requests to unlock locked lessons and rating exams, with reason and status. Here one decides or withdraws a request, opens the journal, and extends the edit period for a range of days."
  },
  {
   "id": "page:/people",
   "path": "/people",
   "title": {
    "uz": "Odamlar",
    "ru": "Люди",
    "en": "People"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "The entry to the people lists: staff, students, parents, vacancies, Head Teachers and accounts never used."
  },
  {
   "id": "page:/people/classes/$classId/parent-slips",
   "path": "/people/classes/$classId/parent-slips",
   "title": {
    "uz": "Ota-onalar varaqalari",
    "ru": "Бланки родителей",
    "en": "Parent slips"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "params": {
    "classId": {
     "kind": "id"
    }
   },
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "ParentAccountsController_print"
   ],
   "description": "Lists the parents of a class with portal access and prints their sign-in slips with a login and one-time password, in a chosen language. A slip can be printed again, which replaces the earlier password."
  },
  {
   "id": "page:/people/digest-log",
   "path": "/people/digest-log",
   "title": {
    "uz": "Xabarnomalar yuborilishi jurnali",
    "ru": "Журнал отправки сводок",
    "en": "Digest send log"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the daily digests sent to parents through Telegram for a chosen date, with status, send time and attempts, filtered by status and paged newer or older."
  },
  {
   "id": "page:/people/head-teachers",
   "path": "/people/head-teachers",
   "title": {
    "uz": "Fan rahbarlari",
    "ru": "Руководители предметов",
    "en": "Head Teachers"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "role": {
       "kind": "enum",
       "values": [
        "head_teacher",
        "senior_head_teacher"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the Head Teachers of the branch with the subjects they oversee and from and until when. Appointments are made on the account of a staff record."
  },
  {
   "id": "page:/people/never-used",
   "path": "/people/never-used",
   "title": {
    "uz": "Ishlatilmagan hisoblar",
    "ru": "Неиспользованные учётные записи",
    "en": "Accounts never used"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "password": {
       "kind": "enum",
       "values": [
        "expired",
        "valid"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the accounts of the branch that were never used, with login, creation date, whether the first password ran out and lock state. A name opens the staff record, where sign-in access is changed."
  },
  {
   "id": "page:/people/parent-accounts",
   "path": "/people/parent-accounts",
   "title": {
    "uz": "Hech kirmagan ota-onalar",
    "ru": "Родители, не входившие ни разу",
    "en": "Parents never signed in"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "expired": {
       "kind": "enum",
       "values": [
        "yes"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the parent accounts whose printed slip was never used to sign in, with children, print date and whether the password expired. The list can be exported."
  },
  {
   "id": "page:/people/parents",
   "path": "/people/parents",
   "title": {
    "uz": "Ota-onalar",
    "ru": "Родители",
    "en": "Parents"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "phone": {
       "kind": "enum",
       "values": [
        "no_valid_phone"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "ParentAccountsController_reset",
    "ParentAccountsController_unlinkTelegram",
    "RelativesController_merge",
    "RelativesController_phoneMatch",
    "RelativesController_show"
   ],
   "description": "Lists the parents and relatives of the branch's students with main phone and students. Opening one edits the record; filters find parents with no valid phone. Links lead to parents never signed in and the digest log."
  },
  {
   "id": "page:/people/report/$kind/$id",
   "path": "/people/report/$kind/$id",
   "title": {
    "uz": "Shaxsiy maʼlumotlar hisoboti",
    "ru": "Отчёт о персональных данных",
    "en": "Personal data report"
   },
   "roles": [
    "super_admin"
   ],
   "params": {
    "kind": {
     "kind": "enum",
     "values": [
      "staff",
      "student"
     ]
    },
    "id": {
     "kind": "id"
    }
   },
   "search": {},
   "operations": [],
   "description": "Produces the personal data report of one student, staff member or relative: every stored detail, history, marks and attendance. The report is logged as an export and can be printed."
  },
  {
   "id": "page:/people/reset-entries",
   "path": "/people/reset-entries",
   "title": {
    "uz": "Tiklashdan keyingi yozuvlar",
    "ru": "Записи после сброса",
    "en": "Entries after a reset"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    },
    "from": {
     "kind": "date"
    },
    "to": {
     "kind": "date"
    }
   },
   "operations": [],
   "description": "Lists the password resets of the branch in a date range, each with the journal entries made in the 48 hours after it, so that entries made after a possibly misused reset can be checked."
  },
  {
   "id": "page:/people/staff",
   "path": "/people/staff",
   "title": {
    "uz": "Xodimlar",
    "ru": "Сотрудники",
    "en": "Staff"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "category": {
       "kind": "enum",
       "values": [
        "academic_vice_principal",
        "class_teacher",
        "head_teacher",
        "head_tutor",
        "principal",
        "senior_head_teacher",
        "spiritual_vice_principal",
        "super_admin",
        "teacher",
        "tutor"
       ]
      },
      "department": {
       "kind": "id"
      },
      "division": {
       "kind": "id"
      },
      "grade": {
       "kind": "enum",
       "values": [
        "0",
        "1",
        "10",
        "11",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
       ]
      },
      "language": {
       "kind": "enum",
       "values": [
        "ru",
        "uz"
       ]
      },
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "inactive",
        "left"
       ]
      },
      "subject": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "AccountAccessController_lock",
    "AccountAccessController_unlock",
    "StaffAccountsController_linkOwn",
    "StaffController_identity",
    "StaffPhotosController_removePhoto"
   ],
   "description": "Lists the staff of the branch with category, department, subjects, grades and status. Here one adds a person, opens a record to edit it and its account, and imports staff from Excel."
  },
  {
   "id": "page:/people/staff/import",
   "path": "/people/staff/import",
   "title": {
    "uz": "Xodimlar importi",
    "ru": "Импорт сотрудников",
    "en": "Staff import"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "StaffController_importConfirm",
    "StaffController_importTemplate"
   ],
   "description": "Imports staff from an Excel file: download the template, upload the filled file, see each row's problems and decisions, then confirm. The new passwords are shown once for printing slips."
  },
  {
   "id": "page:/people/students",
   "path": "/people/students",
   "title": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "roles": [
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
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "class": {
       "kind": "idOrEnum",
       "values": [
        "none"
       ]
      },
      "consent": {
       "kind": "enum",
       "values": [
        "missing"
       ]
      },
      "grade": {
       "kind": "enum",
       "values": [
        "0",
        "1",
        "10",
        "11",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
       ]
      },
      "group": {
       "kind": "id"
      },
      "language": {
       "kind": "enum",
       "values": [
        "ru",
        "uz"
       ]
      },
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "graduated",
        "inactive"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "BranchMovesController_cancel",
    "ClassesController_withdraw",
    "ClassTransfersController_cancel",
    "GroupsController_reviewed",
    "GroupsController_withdraw",
    "GroupTransfersController_cancel",
    "RelativesController_ofStudent",
    "RelativesController_unlink",
    "StudentPhotosController_removePhoto",
    "StudentsController_detail",
    "StudentsController_identity",
    "StudentStatusesController_cancelLeaving",
    "StudentStatusesController_cancelReturn"
   ],
   "description": "Lists the students of the branch with UID, class, groups, Tutor and status. Here one adds a student, edits a record, puts students into a class or group, records leaving school, and imports from Excel."
  },
  {
   "id": "page:/people/students/import",
   "path": "/people/students/import",
   "title": {
    "uz": "Oʻquvchilar importi",
    "ru": "Импорт учеников",
    "en": "Student import"
   },
   "roles": [
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
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "StudentsController_importConfirm",
    "StudentsController_importTemplate"
   ],
   "description": "Imports students from an Excel file: download the template, upload the filled file, check each row's problems and possible duplicates, then confirm to create the students."
  },
  {
   "id": "page:/people/vacancies",
   "path": "/people/vacancies",
   "title": {
    "uz": "Vakansiyalar",
    "ru": "Вакансии",
    "en": "Vacancies"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "department": {
       "kind": "id"
      },
      "grade": {
       "kind": "enum",
       "values": [
        "0",
        "1",
        "10",
        "11",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
       ]
      },
      "language": {
       "kind": "enum",
       "values": [
        "ru",
        "uz"
       ]
      },
      "status": {
       "kind": "enum",
       "values": [
        "closed",
        "open"
       ]
      },
      "subject": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "ActingTeachersController_end",
    "ActingTeachersController_name",
    "JournalSubstitutionsController_absenceSubstitute",
    "JournalSubstitutionsController_vacancySubstitute",
    "TimetableController_setDayKeep",
    "VacanciesController_close",
    "VacanciesController_delete",
    "VacanciesController_reopen"
   ],
   "description": "Lists the vacancies of the branch: posts for teachers not yet hired, with department, subjects, grades, languages and weekly lessons. A vacancy can take teaching load. Here one adds and edits them."
  },
  {
   "id": "page:/plans",
   "path": "/plans",
   "title": {
    "uz": "Dars rejalari",
    "ru": "Планы уроков",
    "en": "Lesson plans"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {},
   "search": {
    "tab": {
     "kind": "enum",
     "values": [
      "class",
      "group"
     ]
    },
    "year": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "grade": {
       "kind": "number"
      },
      "quarter": {
       "kind": "enum",
       "values": [
        "1",
        "2",
        "3",
        "4"
       ]
      },
      "state": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      },
      "subject": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the lesson plans of the year by class or group and subject, with warnings such as a master updated or too few works. Opening one shows the plan. Links lead to windows, reports and edit requests."
  },
  {
   "id": "page:/plans/$journalId",
   "path": "/plans/$journalId",
   "title": {
    "uz": "Dars rejasi",
    "ru": "План уроков",
    "en": "Lesson plan"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {
    "journalId": {
     "kind": "id"
    }
   },
   "search": {
    "quarter": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "PlanMastersController_keep",
    "PlanMastersController_take",
    "PlanOutcomesController_carry",
    "PlanOutcomesController_drop",
    "PlanOutcomesController_merge",
    "PlanOutcomesController_place",
    "PlanRequestsController_create",
    "PlanRequestsController_finish",
    "PlanRequestsController_send",
    "PlanRequestsController_sendPrepared",
    "PlansController_addFile",
    "PlansController_clearItem",
    "PlansController_copy",
    "PlansController_separate",
    "PlansController_share",
    "PlanWindowsController_extend"
   ],
   "description": "The lesson plan of one class or group and subject for a quarter: one row per lesson with topic, classworks, homeworks and files. Rows are edited here; the page shows rows without a topic and works below the minimum."
  },
  {
   "id": "page:/plans/masters",
   "path": "/plans/masters",
   "title": {
    "uz": "Master-rejalar",
    "ru": "Мастер-планы",
    "en": "Master plans"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {},
   "search": {
    "tab": {
     "kind": "enum",
     "values": [
      "class",
      "group"
     ]
    },
    "year": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "grade": {
       "kind": "number"
      },
      "quarter": {
       "kind": "enum",
       "values": [
        "1",
        "2",
        "3",
        "4"
       ]
      },
      "state": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      },
      "subject": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the master plans: one list of topics for a subject, grade, language and quarter that classes copy into their plans. Here one adds a master plan and opens one."
  },
  {
   "id": "page:/plans/masters/$masterId",
   "path": "/plans/masters/$masterId",
   "title": {
    "uz": "Master-rejalar",
    "ru": "Мастер-планы",
    "en": "Master plans"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {
    "masterId": {
     "kind": "id"
    }
   },
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "PlanMastersController_archive",
    "PlanMastersController_order",
    "PlanMastersController_removeItem",
    "PlanMastersController_restore"
   ],
   "description": "One master plan: its rows of topics with objectives, links, classworks and homeworks. Here one adds, edits, reorders and removes rows, renames the master, and archives or restores it."
  },
  {
   "id": "page:/plans/parallel",
   "path": "/plans/parallel",
   "title": {
    "uz": "Parallel sinflar",
    "ru": "Параллельные классы",
    "en": "Parallel classes"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "Compares the classes and groups of one grade side by side for a subject and quarter: the lesson and topic each has reached and its next topic."
  },
  {
   "id": "page:/plans/reports",
   "path": "/plans/reports",
   "title": {
    "uz": "Rejalar hisobotlari",
    "ru": "Отчёты по планам",
    "en": "Plan reports"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "report": {
     "kind": "enum",
     "values": [
      "completeness",
      "progress",
      "requests"
     ]
    },
    "part": {
     "kind": "enum",
     "values": [
      "teachers",
      "plans"
     ]
    },
    "quarter": {
     "kind": "id"
    },
    "department": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "PlanReportsController_export"
   ],
   "description": "Reports on lesson plans for a quarter: completeness by teacher or by plan, progress against the plan, and edit requests, filtered by department. Each part exports to Excel."
  },
  {
   "id": "page:/plans/requests",
   "path": "/plans/requests",
   "title": {
    "uz": "Rejani oʻzgartirish soʻrovlari",
    "ru": "Запросы на изменение планов",
    "en": "Plan edit requests"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "PlanRequestsController_create",
    "PlanRequestsController_decideEvent",
    "PlanRequestsController_finish",
    "PlanRequestsController_send",
    "PlanRequestsController_sendPrepared",
    "PlanWindowsController_extend"
   ],
   "description": "Lists the requests to edit lesson plans after their window, with kind and status. Here one decides a request, opens the plan, or approves together the requests caused by one change."
  },
  {
   "id": "page:/plans/windows",
   "path": "/plans/windows",
   "title": {
    "uz": "Reja oynalari",
    "ru": "Окна планов",
    "en": "Plan windows"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {},
   "search": {},
   "operations": [
    "PlanMinimumsController_save"
   ],
   "description": "Shows each quarter's window in which teachers write their lesson plans, and opens or changes a window's first and last day. When plan windows are off in Settings, it says so."
  },
  {
   "id": "page:/results/attendance",
   "path": "/results/attendance",
   "title": {
    "uz": "Davomat",
    "ru": "Посещаемость",
    "en": "Attendance"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "params": {},
   "search": {
    "from": {
     "kind": "date"
    },
    "to": {
     "kind": "date"
    },
    "grade": {
     "kind": "number"
    },
    "class": {
     "kind": "id"
    },
    "subject": {
     "kind": "id"
    },
    "teacher": {
     "kind": "id"
    },
    "start": {
     "kind": "number"
    },
    "by": {
     "kind": "enum",
     "values": [
      "tutor"
     ]
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "The attendance report for a date range: expected lessons and attendance by class or by Tutor, with daily attendance, filtered by grade, class, subject, teacher and period."
  },
  {
   "id": "page:/results/closing",
   "path": "/results/closing",
   "title": {
    "uz": "Chorakni yopish roʻyxati",
    "ru": "Чек-лист закрытия",
    "en": "Closing checklist"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    },
    "quarter": {
     "kind": "id"
    }
   },
   "operations": [
    "ClosingController_applyRecalculation",
    "ClosingController_decide",
    "ClosingController_decideJournal",
    "ClosingController_endPlanPeriods",
    "ClosingController_remind",
    "ClosingController_reopen"
   ],
   "description": "The closing checklist of a quarter: everything unfinished, by teacher and class, with what blocks closing and what only warns. Here one reminds teachers, decides items, closes the quarter, and reopens it."
  },
  {
   "id": "page:/results/early-warning",
   "path": "/results/early-warning",
   "title": {
    "uz": "Erta ogohlantirish",
    "ru": "Раннее предупреждение",
    "en": "Early warning"
   },
   "roles": [
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
   ],
   "params": {},
   "search": {
    "quarter": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "reason": {
       "kind": "enum",
       "values": [
        "absences_in_row",
        "low_attendance",
        "low_result",
        "result_drop"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "EarlyWarningController_handle"
   ],
   "description": "Lists the students who need attention in a quarter, by subject, with reasons such as a low result, a drop, low attendance or absences in a row. The side panel shows the trend; a reason can be marked handled with a note."
  },
  {
   "id": "page:/results/load",
   "path": "/results/load",
   "title": {
    "uz": "Dars jadvali yuklamasi",
    "ru": "Нагрузка по расписанию",
    "en": "Timetable load"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "week": {
     "kind": "date"
    },
    "department": {
     "kind": "id"
    },
    "show": {
     "kind": "enum",
     "values": [
      "rooms",
      "classes",
      "freePeriods"
     ]
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "The timetable load report for a week: teachers against their planned and contract load, classes and groups against the load, rooms in use and free periods."
  },
  {
   "id": "page:/results/mastery",
   "path": "/results/mastery",
   "title": {
    "uz": "Fanni oʻzlashtirish",
    "ru": "Усвоение предмета",
    "en": "Subject mastery"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "quarter": {
     "kind": "id"
    },
    "subject": {
     "kind": "id"
    },
    "grade": {
     "kind": "number"
    },
    "class": {
     "kind": "id"
    },
    "teacher": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Subject mastery for a quarter and subject: how many students fall in each grade band, filtered by grade, class and teacher. Provisional while the quarter is open."
  },
  {
   "id": "page:/results/rating",
   "path": "/results/rating",
   "title": {
    "uz": "Reyting",
    "ru": "Рейтинг",
    "en": "Rating"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "params": {},
   "search": {
    "kind": {
     "kind": "enum",
     "values": [
      "class",
      "subject",
      "classes"
     ]
    },
    "year": {
     "kind": "id"
    },
    "quarter": {
     "kind": "id"
    },
    "journal": {
     "kind": "id"
    },
    "class": {
     "kind": "id"
    },
    "grade": {
     "kind": "number"
    },
    "language": {
     "kind": "enum",
     "values": [
      "uz",
      "ru"
     ]
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "RatingController_export"
   ],
   "description": "The rating of students in a subject, of a class across subjects, or of classes, for a quarter or year, with places and results. Provisional while the quarter is open; exports to Excel."
  },
  {
   "id": "page:/results/reports",
   "path": "/results/reports",
   "title": {
    "uz": "Hisobotlar",
    "ru": "Отчёты",
    "en": "Reports"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "The entry to the reports: attendance, results table, subject mastery, journal discipline and timetable load."
  },
  {
   "id": "page:/results/table",
   "path": "/results/table",
   "title": {
    "uz": "Natijalar jadvali",
    "ru": "Таблица результатов",
    "en": "Results table"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "params": {},
   "search": {
    "quarter": {
     "kind": "id"
    },
    "class": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "The results table of one class for a quarter: each student's result and grade in every subject. Provisional while the quarter is open."
  },
  {
   "id": "page:/setup",
   "path": "/setup",
   "title": {
    "uz": "Maktab sozlamalari",
    "ru": "Настройка школы",
    "en": "School setup"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "The entry to school setup: branches, buildings, rooms, divisions, years, slot types, day templates, calendar, settings, subjects, and the system pages such as deleted records, feedback, keys and status."
  },
  {
   "id": "page:/setup/assistant",
   "path": "/setup/assistant",
   "title": {
    "uz": "Yordamchi sozlamalari",
    "ru": "Настройки помощника",
    "en": "Assistant settings"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "The Super Admin’s settings of the assistant: switched on for the school and each role, the limits, which personal data may reach the model, and every action of each role by area, each switched on or off for the assistant. Heavy actions such as publishing, closing, password resets and roles start off."
  },
  {
   "id": "page:/setup/branch",
   "path": "/setup/branch",
   "title": {
    "uz": "Filial",
    "ru": "Филиал",
    "en": "Branch"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "Shows and edits the chosen branch: name, address, phone, email, working weekdays and time zone, and sets its go-live date."
  },
  {
   "id": "page:/setup/branches",
   "path": "/setup/branches",
   "title": {
    "uz": "Filiallar",
    "ru": "Филиалы",
    "en": "Branches"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the branches of the school with address, working weekdays, buildings and rooms. Here one adds a new branch."
  },
  {
   "id": "page:/setup/buildings",
   "path": "/setup/buildings",
   "title": {
    "uz": "Binolar va qavatlar",
    "ru": "Здания и этажи",
    "en": "Buildings and floors"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the buildings of the branch with their floors and rooms. Here one adds a building, edits its floors, archives or restores it, and deletes one for good with a reason."
  },
  {
   "id": "page:/setup/calendar",
   "path": "/setup/calendar",
   "title": {
    "uz": "Taqvim",
    "ru": "Календарь",
    "en": "Calendar"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "kind": {
       "kind": "enum",
       "values": [
        "day_off",
        "special_day"
       ]
      },
      "state": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      },
      "when": {
       "kind": "enum",
       "values": [
        "coming",
        "past"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "CalendarController_archive",
    "CalendarController_restore"
   ],
   "description": "Lists the days off and special days of the branch, with dates, kind, grades and day template. Here one adds and edits entries and checks what any date is for each grade."
  },
  {
   "id": "page:/setup/day-template-settings",
   "path": "/setup/day-template-settings",
   "title": {
    "uz": "Shablonlar qayerda amal qiladi",
    "ru": "Где действуют шаблоны",
    "en": "Where templates apply"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "level": {
       "kind": "enum",
       "values": [
        "default",
        "grades",
        "weekday",
        "weekday_grades"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Shows which day template applies on a date to each weekday and grade, and the settings by level. Here one sets a template from a date for the branch, a weekday or a range of grades, after seeing the changes."
  },
  {
   "id": "page:/setup/day-templates",
   "path": "/setup/day-templates",
   "title": {
    "uz": "Kun shablonlari",
    "ru": "Шаблоны дня",
    "en": "Day templates"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "state": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "DayTemplatesController_archiveTemplate",
    "DayTemplatesController_restoreTemplate"
   ],
   "description": "Lists the day templates of the branch: a start time and the lesson and break slots in order. Here one adds and edits them and archives or restores them."
  },
  {
   "id": "page:/setup/demo-clock",
   "path": "/setup/demo-clock",
   "title": {
    "uz": "Demo vaqt",
    "ru": "Демо-время",
    "en": "Demo time"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {},
   "operations": [
    "DemoClockController_jump",
    "DemoClockController_read"
   ],
   "description": "Moves the demo time of the test environment forward to a chosen date and time. Every rule of the platform then follows demo time. Demo time never moves back."
  },
  {
   "id": "page:/setup/divisions",
   "path": "/setup/divisions",
   "title": {
    "uz": "Boʻlimlar va kafedralar",
    "ru": "Отделы и кафедры",
    "en": "Divisions and departments"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the divisions of the school with their departments and staff. Here one adds a division and its departments, renames them, and archives or restores them."
  },
  {
   "id": "page:/setup/past-marks",
   "path": "/setup/past-marks",
   "title": {
    "uz": "Ishga tushishdan oldingi baholar",
    "ru": "Оценки до запуска",
    "en": "Past marks before go-live"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "PastMarksController_withdraw"
   ],
   "description": "Lists the saved uploads of past marks from before go-live (attendance, classwork and homework of the lessons before the branch went live, shown to parents only): file name, who and when, the number of rows, and whether each stands or was withdrawn. An upload opens in the side panel, where it can be withdrawn with a reason."
  },
  {
   "id": "page:/setup/past-marks/import",
   "path": "/setup/past-marks/import",
   "title": {
    "uz": "Oʻtgan baholar importi",
    "ru": "Импорт прошлых оценок",
    "en": "Import of past marks"
   },
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "PastMarksController_confirm",
    "PastMarksController_preview",
    "PastMarksController_template"
   ],
   "description": "Imports past marks from before go-live from an Excel file: download the template, upload the filled file, see each row's problems page by page, then confirm to save every row at once."
  },
  {
   "id": "page:/setup/rooms",
   "path": "/setup/rooms",
   "title": {
    "uz": "Xonalar",
    "ru": "Кабинеты",
    "en": "Rooms"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "view": {
     "kind": "enum",
     "values": [
      "floors"
     ]
    },
    "building": {
     "kind": "id"
    },
    "floor": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "building": {
       "kind": "id"
      },
      "floor": {
       "kind": "id"
      },
      "status": {
       "kind": "enum",
       "values": [
        "closed",
        "in_use",
        "under_repair"
       ]
      },
      "type": {
       "kind": "enum",
       "values": [
        "classroom",
        "hall",
        "laboratory",
        "other",
        "sports_hall"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the rooms of the branch as a list or by floor, with building, type, capacity, status and whether shared. Here one adds and edits rooms, sets the status of several, and deletes one for good."
  },
  {
   "id": "page:/setup/settings",
   "path": "/setup/settings",
   "title": {
    "uz": "Sozlamalar",
    "ru": "Настройки",
    "en": "Settings"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "The settings of the branch and school: edit days, most lessons of a class per day, plan windows, early-warning thresholds, attendance values per quarter, languages of instruction, grade bands and the assistant."
  },
  {
   "id": "page:/setup/slot-types",
   "path": "/setup/slot-types",
   "title": {
    "uz": "Dars va tanaffus turlari",
    "ru": "Типы уроков и перемен",
    "en": "Slot types"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "kind": {
       "kind": "enum",
       "values": [
        "break",
        "lesson"
       ]
      },
      "state": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "DayTemplatesController_archiveSlotType",
    "DayTemplatesController_restoreSlotType"
   ],
   "description": "Lists the slot types: the kinds of lesson and break with their length in minutes, including planned changes of length. Here one adds, edits, archives and restores them."
  },
  {
   "id": "page:/setup/subjects",
   "path": "/setup/subjects",
   "title": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "department": {
       "kind": "id"
      },
      "grade": {
       "kind": "enum",
       "values": [
        "0",
        "1",
        "10",
        "11",
        "2",
        "3",
        "4",
        "5",
        "6",
        "7",
        "8",
        "9"
       ]
      },
      "journalType": {
       "kind": "enum",
       "values": [
        "attendance_only",
        "graded"
       ]
      },
      "status": {
       "kind": "enum",
       "values": [
        "active",
        "archived"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "SubjectsController_copyQuarterOne",
    "SubjectsController_previewCopy"
   ],
   "description": "Lists the subjects of the school with department, grades, journal type, rating exam, quarter weights and switches. Here one adds and edits subjects, archives or restores them, and imports from Excel."
  },
  {
   "id": "page:/setup/subjects/import",
   "path": "/setup/subjects/import",
   "title": {
    "uz": "Fanlar importi",
    "ru": "Импорт предметов",
    "en": "Subject import"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "SubjectsController_importConfirm",
    "SubjectsController_importTemplate"
   ],
   "description": "Imports subjects from an Excel file: download the template, upload the filled file, see each row's problems, then confirm to create the subjects."
  },
  {
   "id": "page:/setup/travel-times",
   "path": "/setup/travel-times",
   "title": {
    "uz": "Yoʻl vaqti",
    "ru": "Время в пути",
    "en": "Travel time"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "Sets the travel time in minutes between the chosen branch and every other branch, used for teachers who work in several branches."
  },
  {
   "id": "page:/setup/years",
   "path": "/setup/years",
   "title": {
    "uz": "Oʻquv yillari",
    "ru": "Учебные годы",
    "en": "Academic years"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "status": {
       "kind": "enum",
       "values": [
        "closed",
        "current",
        "planned"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "AcademicYearsController_start"
   ],
   "description": "Lists the academic years with start, end, status and quarters. Here one adds a year, changes its dates and quarters, and starts it as the current year."
  },
  {
   "id": "page:/system-status",
   "path": "/system-status",
   "title": {
    "uz": "Tizim holati",
    "ru": "Состояние системы",
    "en": "System status"
   },
   "roles": [
    "super_admin"
   ],
   "params": {},
   "search": {
    "period": {
     "kind": "enum",
     "values": [
      "7d",
      "14d"
     ]
    }
   },
   "operations": [],
   "description": "Shows the health of the platform: background jobs, failed jobs and exports, refused saves, nightly checks per branch, feedback, and the uptime, alerts and errors of outside services over a chosen period."
  },
  {
   "id": "page:/timetable",
   "path": "/timetable",
   "title": {
    "uz": "Dars jadvali",
    "ru": "Расписание",
    "en": "Timetable"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {},
   "operations": [],
   "description": "The entry to the timetable: views, teaching load, draft builder, day changes, exams, absences, room closures and version history."
  },
  {
   "id": "page:/timetable/absences",
   "path": "/timetable/absences",
   "title": {
    "uz": "Kelmasliklar",
    "ru": "Отсутствия",
    "en": "Absences"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "state": {
       "kind": "enum",
       "values": [
        "current",
        "ended",
        "planned",
        "withdrawn"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "AbsencesController_withdraw",
    "JournalSubstitutionsController_absenceSubstitute",
    "JournalSubstitutionsController_vacancySubstitute",
    "SubstitutionsController_substitute",
    "SubstitutionsController_withdraw"
   ],
   "description": "Lists the absences of the branch's staff with first and last day and reason. Here one enters an absence when a teacher cannot come; it covers every branch they work in."
  },
  {
   "id": "page:/timetable/builder",
   "path": "/timetable/builder",
   "title": {
    "uz": "Qoralama yigʻuvchi",
    "ru": "Конструктор черновика",
    "en": "Draft builder"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "version": {
     "kind": "id"
    },
    "step": {
     "kind": "enum",
     "values": [
      "templates",
      "load",
      "teachers",
      "rooms",
      "rules",
      "grid",
      "publish"
     ]
    }
   },
   "operations": [
    "TimetableController_bringUpToDate",
    "TimetableController_confirmRules",
    "TimetableController_confirmTemplates",
    "TimetableController_deletePin",
    "TimetableController_grid",
    "TimetableController_lessonRoom",
    "TimetableController_moveBlock",
    "TimetableController_placeBlock",
    "TimetableController_publish",
    "TimetableController_rearrangeBlocks",
    "TimetableController_removeBlock",
    "TimetableController_setDayKeep",
    "TimetableController_swapBlocks"
   ],
   "description": "The draft builder of a timetable version: a checklist of steps from day templates, teaching load, teachers, rooms and rules to generation, editing in the grid and publishing, each shown ready or not ready."
  },
  {
   "id": "page:/timetable/day",
   "path": "/timetable/day",
   "title": {
    "uz": "Bir kunlik oʻzgarishlar",
    "ru": "Изменения на день",
    "en": "Day changes"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "date": {
     "kind": "date"
    },
    "class": {
     "kind": "id"
    }
   },
   "operations": [
    "BulkCancelsController_check",
    "BulkCancelsController_save",
    "DayChangesController_cancel",
    "DayChangesController_correct",
    "DayChangesController_move",
    "DayChangesController_restore",
    "DayChangesController_room",
    "SubstitutionsController_substitute",
    "SubstitutionsController_withdraw"
   ],
   "description": "Shows the lessons of a class on a date and makes one-day changes: cancel, move, change the room, substitute a teacher, restore, correct a past lesson, see the history, or delete a lesson for good."
  },
  {
   "id": "page:/timetable/exams",
   "path": "/timetable/exams",
   "title": {
    "uz": "Imtihonlar",
    "ru": "Экзамены",
    "en": "Exams"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "date": {
     "kind": "date"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "ExamsController_cancel",
    "ExamsController_change",
    "ExamsController_check",
    "ExamsController_create"
   ],
   "description": "Lists the exams of a date with time, rooms and classes and invigilators. Here one adds an exam, which cancels the lessons of its classes in its slots, changes it or cancels it."
  },
  {
   "id": "page:/timetable/load",
   "path": "/timetable/load",
   "title": {
    "uz": "Oʻquv yuklamasi",
    "ru": "Учебная нагрузка",
    "en": "Teaching load"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "version": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "problems": {
       "kind": "enum",
       "values": [
        "with",
        "without"
       ]
      },
      "subject": {
       "kind": "id"
      },
      "teacher": {
       "kind": "id"
      },
      "unit": {
       "kind": "id"
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "TimetableController_deleteRow",
    "TimetableController_editVersion"
   ],
   "description": "The teaching load of a timetable version: rows giving a class or group a subject, a teacher, lessons per week and a room need, with their problems. Here one starts a draft, adds and edits rows, imports from Excel and withdraws a version."
  },
  {
   "id": "page:/timetable/load/import",
   "path": "/timetable/load/import",
   "title": {
    "uz": "Oʻquv yuklamasi importi",
    "ru": "Импорт учебной нагрузки",
    "en": "Teaching load import"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "version": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "LoadImportsController_confirm",
    "LoadImportsController_template"
   ],
   "description": "Imports teaching load rows from an Excel file into the open draft: download the template, upload the filled file, check each row's problems, then confirm."
  },
  {
   "id": "page:/timetable/pattern/import",
   "path": "/timetable/pattern/import",
   "title": {
    "uz": "Dars jadvali importi",
    "ru": "Импорт расписания",
    "en": "Timetable import"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "version": {
     "kind": "id"
    },
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "PatternImportsController_confirm",
    "PatternImportsController_template"
   ],
   "description": "Imports a weekly timetable from an Excel file into a draft: download the template, upload the filled file, check each row's problems and warnings, then place the lessons."
  },
  {
   "id": "page:/timetable/room-closures",
   "path": "/timetable/room-closures",
   "title": {
    "uz": "Xonalarning yopilishi",
    "ru": "Закрытия кабинетов",
    "en": "Room closures"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {
      "state": {
       "kind": "enum",
       "values": [
        "current",
        "ended",
        "planned",
        "withdrawn"
       ]
      }
     }
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [
    "RoomClosuresController_withdraw"
   ],
   "description": "Lists the closures of the branch's rooms with first and last day and reason. Here one closes a room for some days, for example during repairs."
  },
  {
   "id": "page:/timetable/versions",
   "path": "/timetable/versions",
   "title": {
    "uz": "Versiyalar tarixi",
    "ru": "История версий",
    "en": "Version history"
   },
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "params": {},
   "search": {
    "q": {
     "kind": "text"
    },
    "sort": {
     "kind": "text"
    },
    "f": {
     "kind": "record",
     "keys": {}
    },
    "open": {
     "kind": "id"
    }
   },
   "operations": [],
   "description": "Lists the timetable versions of a year by start date, with status and source. Here one compares two versions and restores an older one as a new draft."
  },
  {
   "id": "page:/timetable/views",
   "path": "/timetable/views",
   "title": {
    "uz": "Dars jadvalini koʻrish",
    "ru": "Просмотр расписания",
    "en": "Timetable views"
   },
   "roles": [
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
   ],
   "params": {},
   "search": {
    "kind": {
     "kind": "enum",
     "values": [
      "branch",
      "class",
      "teacher",
      "room"
     ]
    },
    "id": {
     "kind": "id"
    },
    "date": {
     "kind": "date"
    },
    "span": {
     "kind": "enum",
     "values": [
      "day",
      "week"
     ]
    }
   },
   "operations": [],
   "description": "Shows the timetable read-only by school, class, teacher or room, for a day or a week, with every one-day change, substitution, exam and cancellation marked."
  }
 ],
 "nodes": [
  {
   "id": "app/app-layout.tsx#button:layout.dismiss",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the notice that this device is not trusted because a one-time password was used at sign-in."
  },
  {
   "id": "components/forced-delete-dialog.tsx#button:forcedDeletes.keep",
   "kind": "button",
   "label": {
    "uz": "Qoldirish",
    "ru": "Оставить",
    "en": "Keep it"
   },
   "pages": [
    "/setup/buildings",
    "/setup/rooms",
    "/timetable/day"
   ],
   "parent": "components/forced-delete-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog and keeps the record; nothing is deleted."
  },
  {
   "id": "components/forced-delete-dialog.tsx#button:forcedDeletes.send",
   "kind": "button",
   "label": {
    "uz": "Butunlay oʻchirish",
    "ru": "Удалить окончательно",
    "en": "Delete for good"
   },
   "pages": [
    "/setup/buildings",
    "/setup/rooms",
    "/timetable/day"
   ],
   "parent": "components/forced-delete-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Deletes the record for good with the typed reason. It is listed under Deleted for good and can be restored from there for 30 days."
  },
  {
   "id": "components/forced-delete-dialog.tsx#field:forcedDeletes.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/setup/buildings",
    "/setup/rooms",
    "/timetable/day"
   ],
   "parent": "components/forced-delete-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The reason for deleting the record for good; it is required and kept with the deletion."
  },
  {
   "id": "components/forced-delete-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/buildings",
    "/setup/rooms",
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog to delete a record for good, such as a lesson, building or room, with a typed reason. It says what is kept and for how long it can be restored."
  },
  {
   "id": "components/form/record-form.tsx#button:form.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/announcements/manage",
    "/classes",
    "/groups",
    "/integration-keys",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/parents",
    "/people/staff",
    "/people/students",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/windows",
    "/setup/assistant",
    "/setup/branch",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/rooms",
    "/setup/settings",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/travel-times",
    "/setup/years",
    "/timetable/absences",
    "/timetable/builder",
    "/timetable/load",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the form without saving. If something was typed, it first asks whether to leave without saving."
  },
  {
   "id": "components/form/record-form.tsx#button:form.save",
   "kind": "button",
   "label": {
    "uz": "Saqlash",
    "ru": "Сохранить",
    "en": "Save"
   },
   "pages": [
    "/announcements/manage",
    "/classes",
    "/groups",
    "/integration-keys",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/parents",
    "/people/staff",
    "/people/students",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/windows",
    "/setup/assistant",
    "/setup/branch",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/rooms",
    "/setup/settings",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/travel-times",
    "/setup/years",
    "/timetable/absences",
    "/timetable/builder",
    "/timetable/load",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Saves what is typed in the form. A field with a problem is marked and the form is not saved until it is corrected."
  },
  {
   "id": "components/list/list-page.tsx#button:app.loading",
   "kind": "button",
   "label": {
    "uz": "Yuklanmoqda…",
    "ru": "Загрузка…",
    "en": "Loading…"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Loads the next rows of the list from the server."
  },
  {
   "id": "components/list/list-page.tsx#button:list.clearSearch",
   "kind": "button",
   "label": {
    "uz": "Qidiruv va filtrlarni tozalash",
    "ru": "Сбросить поиск и фильтры",
    "en": "Clear search and filters"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Clears the search text and every filter of the list, so that all rows are shown again."
  },
  {
   "id": "components/list/list-page.tsx#button:list.clearSelection",
   "kind": "button",
   "label": {
    "uz": "Tanlovni bekor qilish",
    "ru": "Снять выбор",
    "en": "Clear selection"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Unticks every selected row of the list."
  },
  {
   "id": "components/list/list-page.tsx#button:list.columns",
   "kind": "button",
   "label": {
    "uz": "Ustunlar",
    "ru": "Столбцы",
    "en": "Columns"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the column chooser, where columns of the list are shown or hidden."
  },
  {
   "id": "components/list/list-page.tsx#button:list.exportAlsoChosen",
   "kind": "button",
   "label": {
    "uz": "Qoʻshimcha maydonlar: … guruh",
    "ru": "Дополнительные поля: … группы",
    "en": "Also export: … groups"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the choice of extra column groups to add to the export file of the list; it shows how many are chosen."
  },
  {
   "id": "components/list/list-page.tsx#button:list.exporting",
   "kind": "button",
   "label": {
    "uz": "Eksport qilinmoqda…",
    "ru": "Идёт экспорт…",
    "en": "Exporting…"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Exports the list to a file, either the ticked rows or every row matching the search and filters. The file holds only what the role may see, and the export is logged."
  },
  {
   "id": "components/list/list-page.tsx#button:list.filters",
   "kind": "button",
   "label": {
    "uz": "Filtrlar",
    "ru": "Фильтры",
    "en": "Filters"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows or hides the filters of the list on a narrow screen; it shows how many filters are in use."
  },
  {
   "id": "components/list/list-page.tsx#button:list.showMore",
   "kind": "button",
   "label": {
    "uz": "Yana koʻrsatish",
    "ru": "Показать ещё",
    "en": "Show more"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the next rows of the list that are already loaded."
  },
  {
   "id": "components/list/list-page.tsx#panel:app.loading",
   "kind": "panel",
   "label": {
    "uz": "Yuklanmoqda…",
    "ru": "Загрузка…",
    "en": "Loading…"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of a list that opens when a row is chosen, showing the record with its actions and forms."
  },
  {
   "id": "components/list/panel-actions.tsx#button:list.moreActions",
   "kind": "button",
   "label": {
    "uz": "Boshqa amallar",
    "ru": "Другие действия",
    "en": "More actions"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/classes",
    "/feedback-reports",
    "/groups",
    "/integration-keys",
    "/journal/student-absences",
    "/people/parents",
    "/people/staff",
    "/people/students",
    "/people/vacancies",
    "/plans/$journalId",
    "/plans/masters/$masterId",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/years",
    "/timetable/absences",
    "/timetable/load",
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the menu of the further actions of the record in the side panel."
  },
  {
   "id": "components/prepared-stamp.tsx#button:prepared.refresh",
   "kind": "button",
   "label": {
    "uz": "Yangilash",
    "ru": "Обновить",
    "en": "Refresh"
   },
   "pages": [
    "/",
    "/journal/discipline",
    "/plans/reports",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/mastery",
    "/results/rating",
    "/results/table"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Asks again for the prepared totals of the report while they are being updated; the figures shown meanwhile are already worked out from the journal."
  },
  {
   "id": "components/search/command-search.tsx#button:layout.dismiss",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "*"
   ],
   "parent": "components/search/command-search.tsx#panel:search.label",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the search dialog."
  },
  {
   "id": "components/search/command-search.tsx#button:problems.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Попробовать ещё раз",
    "en": "Try again"
   },
   "pages": [
    "*"
   ],
   "parent": "components/search/command-search.tsx#panel:search.label",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Searches the records again after the search failed."
  },
  {
   "id": "components/search/command-search.tsx#button:search.label",
   "kind": "button",
   "label": {
    "uz": "Qidiruv",
    "ru": "Поиск",
    "en": "Search"
   },
   "pages": [
    "*"
   ],
   "parent": "components/search/command-search.tsx#panel:search.label",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the search dialog to find a page or a record by name or UID (also Ctrl+K)."
  },
  {
   "id": "components/search/command-search.tsx#panel:search.label",
   "kind": "panel",
   "label": {
    "uz": "Qidiruv",
    "ru": "Поиск",
    "en": "Search"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The search dialog, also opened with Ctrl+K: it finds pages and, where allowed, students, staff, parents, classes and groups by name or UID."
  },
  {
   "id": "components/side-panel.tsx#button:list.closePanel",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": "components/side-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the side panel and returns to the list."
  },
  {
   "id": "components/side-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/announcements/manage",
    "/assistant-conversations",
    "/audit",
    "/classes",
    "/feedback-reports",
    "/forced-deletes",
    "/groups",
    "/groups/placement",
    "/integration-keys",
    "/journal",
    "/journal/discipline",
    "/journal/exemptions",
    "/journal/exports",
    "/journal/orphans",
    "/journal/student-absences",
    "/journal/unlocks",
    "/people/classes/$classId/parent-slips",
    "/people/digest-log",
    "/people/head-teachers",
    "/people/never-used",
    "/people/parent-accounts",
    "/people/parents",
    "/people/staff",
    "/people/staff/import",
    "/people/students",
    "/people/students/import",
    "/people/vacancies",
    "/plans",
    "/plans/$journalId",
    "/plans/masters",
    "/plans/masters/$masterId",
    "/plans/reports",
    "/plans/requests",
    "/results/attendance",
    "/results/closing",
    "/results/early-warning",
    "/results/load",
    "/results/mastery",
    "/results/rating",
    "/results/table",
    "/setup/branches",
    "/setup/buildings",
    "/setup/calendar",
    "/setup/day-template-settings",
    "/setup/day-templates",
    "/setup/divisions",
    "/setup/past-marks",
    "/setup/past-marks/import",
    "/setup/rooms",
    "/setup/slot-types",
    "/setup/subjects",
    "/setup/subjects/import",
    "/setup/years",
    "/timetable/absences",
    "/timetable/exams",
    "/timetable/load",
    "/timetable/load/import",
    "/timetable/pattern/import",
    "/timetable/room-closures",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel that opens beside a list to show the chosen record, its details and its actions."
  },
  {
   "id": "components/states.tsx#button:problems.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Попробовать ещё раз",
    "en": "Try again"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Loads the part of the page again after it could not be loaded."
  },
  {
   "id": "components/theme-switch.tsx#tab:theme.label",
   "kind": "tab",
   "label": {
    "uz": "Koʻrinish",
    "ru": "Тема",
    "en": "Theme"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the look of the app: light, dark, or as the device."
  },
  {
   "id": "components/unsent/unsent-changes.tsx#button:unsent.typed",
   "kind": "button",
   "label": {
    "uz": "Oʻzgarishlar saqlanmagan",
    "ru": "Изменения не сохранены",
    "en": "Changes not saved"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows that something is typed and not saved, or that a save failed, and takes the person to that form."
  },
  {
   "id": "features/access/app-menu.tsx#button:account.title",
   "kind": "button",
   "label": {
    "uz": "Hisob",
    "ru": "Учётная запись",
    "en": "Account"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the person's own account page."
  },
  {
   "id": "features/access/app-menu.tsx#button:layout.account",
   "kind": "button",
   "label": {
    "uz": "Hisob",
    "ru": "Учётная запись",
    "en": "Account"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the person menu with Account, Change password, the theme and the language."
  },
  {
   "id": "features/access/app-menu.tsx#button:layout.changePassword",
   "kind": "button",
   "label": {
    "uz": "Parolni oʻzgartirish",
    "ru": "Сменить пароль",
    "en": "Change password"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the page to change the person's own password."
  },
  {
   "id": "features/access/app-menu.tsx#button:layout.signOut",
   "kind": "button",
   "label": {
    "uz": "Chiqish",
    "ru": "Выйти",
    "en": "Sign out"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Signs the person out of the platform on this device."
  },
  {
   "id": "features/access/app-menu.tsx#button:layout.signOut:2",
   "kind": "button",
   "label": {
    "uz": "Chiqish",
    "ru": "Выйти",
    "en": "Sign out"
   },
   "pages": [
    "*"
   ],
   "parent": "features/access/app-menu.tsx#panel:menu.more",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Signs the person out of the platform on this device."
  },
  {
   "id": "features/access/app-menu.tsx#button:menu.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "*"
   ],
   "parent": "features/access/app-menu.tsx#panel:menu.more",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the More dialog."
  },
  {
   "id": "features/access/app-menu.tsx#button:menu.expand",
   "kind": "button",
   "label": {
    "uz": "Menyuni yoyish",
    "ru": "Развернуть меню",
    "en": "Expand the menu"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Widens the side menu to show the names of the sections, or narrows it back to icons."
  },
  {
   "id": "features/access/app-menu.tsx#button:menu.more",
   "kind": "button",
   "label": {
    "uz": "Yana",
    "ru": "Ещё",
    "en": "More"
   },
   "pages": [
    "*"
   ],
   "parent": "features/access/app-menu.tsx#panel:menu.more",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the More dialog with the other sections of the menu and the person's own entries."
  },
  {
   "id": "features/access/app-menu.tsx#panel:menu.more",
   "kind": "panel",
   "label": {
    "uz": "Yana",
    "ru": "Ещё",
    "en": "More"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The More dialog of the phone tab bar: the other sections of the menu, the account, change password and sign out."
  },
  {
   "id": "features/access/app-menu.tsx#tab:account.title",
   "kind": "tab",
   "label": {
    "uz": "Hisob",
    "ru": "Учётная запись",
    "en": "Account"
   },
   "pages": [
    "*"
   ],
   "parent": "features/access/app-menu.tsx#panel:menu.more",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": "/account",
   "description": "Opens the person's own account page (/account): language, photo, password and the second step."
  },
  {
   "id": "features/access/app-menu.tsx#tab:layout.changePassword",
   "kind": "tab",
   "label": {
    "uz": "Parolni oʻzgartirish",
    "ru": "Сменить пароль",
    "en": "Change password"
   },
   "pages": [
    "*"
   ],
   "parent": "features/access/app-menu.tsx#panel:menu.more",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": "/account/password",
   "description": "Opens the page to change the person's own password (/account/password)."
  },
  {
   "id": "features/access/attention-line.tsx#button:layout.attentionHide",
   "kind": "button",
   "label": {
    "uz": "Yashirish",
    "ru": "Скрыть",
    "en": "Hide"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows or hides the alerts that need attention, folded into one line on a phone."
  },
  {
   "id": "features/access/integration-keys-page.tsx#button:integrationKeys.copied",
   "kind": "button",
   "label": {
    "uz": "Nusxalandi",
    "ru": "Скопировано",
    "en": "Copied"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": "features/access/integration-keys-page.tsx#panel:integrationKeys.secretTitle",
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Copies the secret of the new key to the clipboard."
  },
  {
   "id": "features/access/integration-keys-page.tsx#button:integrationKeys.create",
   "kind": "button",
   "label": {
    "uz": "Kalit yaratish",
    "ru": "Создать ключ",
    "en": "Create key"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to create a new integration key with a name, an end date and its people."
  },
  {
   "id": "features/access/integration-keys-page.tsx#button:integrationKeys.done",
   "kind": "button",
   "label": {
    "uz": "Tayyor",
    "ru": "Готово",
    "en": "Done"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": "features/access/integration-keys-page.tsx#panel:integrationKeys.secretTitle",
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the secret dialog; the secret is not shown again."
  },
  {
   "id": "features/access/integration-keys-page.tsx#button:integrationKeys.revoke",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отозвать",
    "en": "Revoke"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [
    "IntegrationKeysController_revoke"
   ],
   "opens": null,
   "description": "Revokes the key after a confirmation: it stops working at once and cannot be restored."
  },
  {
   "id": "features/access/integration-keys-page.tsx#column:integrationKeys.endsOn",
   "kind": "column",
   "label": {
    "uz": "Tugash sanasi",
    "ru": "Дата окончания",
    "en": "End date"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The date after which the key stops working."
  },
  {
   "id": "features/access/integration-keys-page.tsx#column:integrationKeys.lastUsed",
   "kind": "column",
   "label": {
    "uz": "Oxirgi foydalanish",
    "ru": "Последнее использование",
    "en": "Last use"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "When the key was last used, or that it was never used."
  },
  {
   "id": "features/access/integration-keys-page.tsx#column:integrationKeys.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The name of the integration key."
  },
  {
   "id": "features/access/integration-keys-page.tsx#column:integrationKeys.people",
   "kind": "column",
   "label": {
    "uz": "Xodimlar",
    "ru": "Сотрудники",
    "en": "People"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The people the key lets the department platform work for."
  },
  {
   "id": "features/access/integration-keys-page.tsx#column:integrationKeys.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the key is active, past its end date or revoked."
  },
  {
   "id": "features/access/integration-keys-page.tsx#field:integrationKeys.endsOn",
   "kind": "field",
   "label": {
    "uz": "Tugash sanasi",
    "ru": "Дата окончания",
    "en": "End date"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The end date of the new key, at most one year from today."
  },
  {
   "id": "features/access/integration-keys-page.tsx#field:integrationKeys.endsOn:2",
   "kind": "field",
   "label": {
    "uz": "Tugash sanasi",
    "ru": "Дата окончания",
    "en": "End date"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Changes the end date of an existing key, at most one year from today; saved with the key's people."
  },
  {
   "id": "features/access/integration-keys-page.tsx#field:integrationKeys.findPerson",
   "kind": "field",
   "label": {
    "uz": "Ism yoki xodim ID boʻyicha qidirish",
    "ru": "Поиск по имени или табельному номеру",
    "en": "Find by name or staff ID"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the list of people by name or staff ID."
  },
  {
   "id": "features/access/integration-keys-page.tsx#field:integrationKeys.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The name of the new key, to tell it apart in the list."
  },
  {
   "id": "features/access/integration-keys-page.tsx#field:integrationKeys.people",
   "kind": "field",
   "label": {
    "uz": "Xodimlar",
    "ru": "Сотрудники",
    "en": "People"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff members the key works for; tick them in the list."
  },
  {
   "id": "features/access/integration-keys-page.tsx#panel:integrationKeys.secretTitle",
   "kind": "panel",
   "label": {
    "uz": "… siri",
    "ru": "Секрет ключа …",
    "en": "Secret of …"
   },
   "pages": [
    "/integration-keys"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the secret of the new key once, to copy it now; it can never be read again."
  },
  {
   "id": "features/access/switchers.tsx#button:switcher.roleButton",
   "kind": "button",
   "label": {
    "uz": "Menyu va bosh sahifa: …",
    "ru": "Меню и главная: …",
    "en": "Menu and home page: …"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the role switcher, which changes the menu and home page to another of the person's roles. The rights stay those of all the person's roles."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.audience",
   "kind": "field",
   "label": {
    "uz": "Kim uchun",
    "ru": "Для кого",
    "en": "For whom"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Who the new entry is for: the whole school, this branch, chosen grades or chosen classes of the branch. It cannot be changed later."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.body",
   "kind": "field",
   "label": {
    "uz": "Matn",
    "ru": "Текст",
    "en": "Text"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The text of the announcement or event."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.classes",
   "kind": "field",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Classes"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The classes of the branch the entry is for."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.endsAt",
   "kind": "field",
   "label": {
    "uz": "Tugashi",
    "ru": "Окончание",
    "en": "Ends at"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The time the event ends."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.firstDate",
   "kind": "field",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day of the event."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.forParents",
   "kind": "field",
   "label": {
    "uz": "Ota-onalar",
    "ru": "Родители",
    "en": "Parents"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the entry to the parents of the audience; parents with the school bot also get it as a message, outside the quiet hours."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.forStaff",
   "kind": "field",
   "label": {
    "uz": "Xodimlar",
    "ru": "Сотрудники",
    "en": "Staff"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the entry to the staff of the audience."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.grades",
   "kind": "field",
   "label": {
    "uz": "Parallellar",
    "ru": "Параллели",
    "en": "Grades"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The grades of the branch the entry is for."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.kind",
   "kind": "field",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the new entry is an announcement (news) or an event with dates, times and a place."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.lastDate",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The last day of the event."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.place",
   "kind": "field",
   "label": {
    "uz": "Joy",
    "ru": "Место",
    "en": "Place"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Where the event takes place."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.startsAt",
   "kind": "field",
   "label": {
    "uz": "Boshlanishi",
    "ru": "Начало",
    "en": "Starts at"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The time the event starts."
  },
  {
   "id": "features/announcements/announcement-form.tsx#field:announcements.form.title",
   "kind": "field",
   "label": {
    "uz": "Sarlavha",
    "ru": "Заголовок",
    "en": "Title"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The title of the announcement or event."
  },
  {
   "id": "features/announcements/announcement-month.tsx#button:announcements.nextMonth",
   "kind": "button",
   "label": {
    "uz": "Keyingi oy",
    "ru": "Следующий месяц",
    "en": "Next month"
   },
   "pages": [
    "/announcements",
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the next month."
  },
  {
   "id": "features/announcements/announcement-month.tsx#button:announcements.previousMonth",
   "kind": "button",
   "label": {
    "uz": "Oldingi oy",
    "ru": "Предыдущий месяц",
    "en": "Previous month"
   },
   "pages": [
    "/announcements",
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the previous month."
  },
  {
   "id": "features/announcements/announcement-month.tsx#tab:announcements.view",
   "kind": "tab",
   "label": {
    "uz": "Koʻrinish",
    "ru": "Вид",
    "en": "View"
   },
   "pages": [
    "/announcements",
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the month as a list or on a calendar."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#button:announcements.manage.add",
   "kind": "button",
   "label": {
    "uz": "Qoʻshish",
    "ru": "Добавить",
    "en": "Add"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new announcement or event."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#button:announcements.manage.archive",
   "kind": "button",
   "label": {
    "uz": "Arxivlash",
    "ru": "В архив",
    "en": "Archive"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Archives the announcement after a confirmation: it leaves the pages of staff and parents, and messages not sent yet are not sent."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#button:announcements.manage.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Restores the archived announcement after a confirmation; it is shown again and no message is sent again."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to change the text, dates, times or place of the announcement."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#column:announcements.form.audience",
   "kind": "column",
   "label": {
    "uz": "Kim uchun",
    "ru": "Для кого",
    "en": "For whom"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Where it is published and for whom: staff, parents or both."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#column:announcements.form.kind",
   "kind": "column",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether it is an announcement or an event."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#column:announcements.manage.messages",
   "kind": "column",
   "label": {
    "uz": "Ota-onalarga xabarlar",
    "ru": "Сообщения родителям",
    "en": "Messages to parents"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "How many messages to parents were delivered, are waiting or were not delivered, or that it is for staff only."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#column:announcements.manage.published",
   "kind": "column",
   "label": {
    "uz": "Chop etilgan",
    "ru": "Опубликовано",
    "en": "Published"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When it was published."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#column:announcements.manage.status",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether it is active or archived."
  },
  {
   "id": "features/announcements/announcements-manage-page.tsx#column:announcements.manage.titleColumn",
   "kind": "column",
   "label": {
    "uz": "Sarlavha",
    "ru": "Заголовок",
    "en": "Title"
   },
   "pages": [
    "/announcements/manage"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "spiritual_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The title of the announcement or event."
  },
  {
   "id": "features/assistant/assistant-chat.tsx#button:assistant.continue",
   "kind": "button",
   "label": {
    "uz": "Davom ettirish",
    "ru": "Продолжить",
    "en": "Continue"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Shown under an answer that a limit of one question cut: asks the next part of the work, which never proposes again a step proposed before. Waits until the proposal shown is confirmed or declined."
  },
  {
   "id": "features/assistant/assistant-chat.tsx#button:assistant.sending",
   "kind": "button",
   "label": {
    "uz": "Yuborilmoqda…",
    "ru": "Отправка…",
    "en": "Sending…"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "AssistantController_ask"
   ],
   "opens": null,
   "description": "Sends the typed question to the assistant (also Enter); it shows while the question is being sent or answered."
  },
  {
   "id": "features/assistant/assistant-conversations-page.tsx#button:assistant.conversationsPage.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/assistant-conversations"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [
    "AssistantAdminController_restore"
   ],
   "opens": null,
   "description": "Restores the conversation after a confirmation; it comes back to its person's list for 90 days."
  },
  {
   "id": "features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.branch",
   "kind": "column",
   "label": {
    "uz": "Filial",
    "ru": "Филиал",
    "en": "Branch"
   },
   "pages": [
    "/assistant-conversations"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The branch of the conversation."
  },
  {
   "id": "features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.lastActivity",
   "kind": "column",
   "label": {
    "uz": "Oxirgi faollik",
    "ru": "Последняя активность",
    "en": "Last activity"
   },
   "pages": [
    "/assistant-conversations"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "When the conversation was last used."
  },
  {
   "id": "features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.person",
   "kind": "column",
   "label": {
    "uz": "Xodim",
    "ru": "Сотрудник",
    "en": "Person"
   },
   "pages": [
    "/assistant-conversations"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The person who had the conversation."
  },
  {
   "id": "features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.role",
   "kind": "column",
   "label": {
    "uz": "Rol",
    "ru": "Роль",
    "en": "Role"
   },
   "pages": [
    "/assistant-conversations"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The role the person used in the conversation."
  },
  {
   "id": "features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.state",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/assistant-conversations"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the conversation is active or archived."
  },
  {
   "id": "features/assistant/assistant-conversations-page.tsx#column:assistant.conversationsPage.titleColumn",
   "kind": "column",
   "label": {
    "uz": "Suhbat",
    "ru": "Разговор",
    "en": "Conversation"
   },
   "pages": [
    "/assistant-conversations"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The name of the conversation."
  },
  {
   "id": "features/assistant/assistant-files.tsx#button:assistant.files.attach",
   "kind": "button",
   "label": {
    "uz": "Fayl biriktirish",
    "ru": "Прикрепить файл",
    "en": "Attach a file"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Attaches an Excel file, a PDF or a photo to the next question (at most 5 files, Excel up to 5 MB, a PDF or photo up to 10 MB, 14 MB together). An import template attached goes through that import’s own preview; the assistant reads any other file into a proposal."
  },
  {
   "id": "features/assistant/assistant-files.tsx#button:assistant.files.recordingFile",
   "kind": "button",
   "label": {
    "uz": "Ovozli yozuv",
    "ru": "Запись",
    "en": "Recording"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "AssistantAdminController_file",
    "AssistantController_file"
   ],
   "opens": null,
   "description": "Downloads a file of the conversation: one the person attached, the recording of a spoken question, or an export the assistant made."
  },
  {
   "id": "features/assistant/assistant-files.tsx#button:assistant.files.remove",
   "kind": "button",
   "label": {
    "uz": "… ni olib tashlash",
    "ru": "Убрать …",
    "en": "Remove …"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes an attached file from the question before it is sent."
  },
  {
   "id": "features/assistant/assistant-files.tsx#button:assistant.files.stop",
   "kind": "button",
   "label": {
    "uz": "Toʻxtatish va yuborish",
    "ru": "Остановить и отправить",
    "en": "Stop and send"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "AssistantController_upload"
   ],
   "opens": null,
   "description": "On a phone: records the question by voice (up to 2 minutes) and, when pressed again, stops and sends it; the assistant writes it out word for word and answers."
  },
  {
   "id": "features/assistant/assistant-page.tsx#button:assistant.newConversation",
   "kind": "button",
   "label": {
    "uz": "Yangi suhbat",
    "ru": "Новый разговор",
    "en": "New conversation"
   },
   "pages": [
    "/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Starts a new, empty conversation with the assistant."
  },
  {
   "id": "features/assistant/assistant-page.tsx#button:assistant.page.back",
   "kind": "button",
   "label": {
    "uz": "Suhbatlarga qaytish",
    "ru": "Назад к разговорам",
    "en": "Back to the conversations"
   },
   "pages": [
    "/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Goes back from a conversation to the list of conversations."
  },
  {
   "id": "features/assistant/assistant-panel.tsx#button:assistant.close",
   "kind": "button",
   "label": {
    "uz": "Yordamchini yopish",
    "ru": "Закрыть помощника",
    "en": "Close the assistant"
   },
   "pages": [
    "*"
   ],
   "parent": "features/assistant/assistant-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the assistant panel."
  },
  {
   "id": "features/assistant/assistant-panel.tsx#button:assistant.newConversation",
   "kind": "button",
   "label": {
    "uz": "Yangi suhbat",
    "ru": "Новый разговор",
    "en": "New conversation"
   },
   "pages": [
    "*"
   ],
   "parent": "features/assistant/assistant-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Starts a new, empty conversation in the assistant panel."
  },
  {
   "id": "features/assistant/assistant-panel.tsx#button:assistant.open",
   "kind": "button",
   "label": {
    "uz": "Yordamchi",
    "ru": "Помощник",
    "en": "Assistant"
   },
   "pages": [
    "*"
   ],
   "parent": "features/assistant/assistant-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the assistant panel beside the page."
  },
  {
   "id": "features/assistant/assistant-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The assistant panel beside every page: ask how to do something, or ask it to prepare changes that run only after Confirm."
  },
  {
   "id": "features/assistant/assistant-settings-page.tsx#tab:assistant.settingsPage.role",
   "kind": "tab",
   "label": {
    "uz": "Rol",
    "ru": "Роль",
    "en": "Role"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the role whose actions are listed: the Super Admin, the Academic Vice Principal or the Teacher. Each area opens to show its actions with a switch each, and a switch for the whole area."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.dailyLimit",
   "kind": "field",
   "label": {
    "uz": "Bir kishi uchun kunlik savollar",
    "ru": "Вопросов на человека в день",
    "en": "Questions per person per day"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "How many questions each person may ask the assistant per day; 0 is no daily limit."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.dataGroup_contact",
   "kind": "field",
   "label": {
    "uz": "Aloqa: telefonlar, pochta, manzillar",
    "ru": "Контакты: телефоны, почта, адреса",
    "en": "Contact: phones, emails, addresses"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Six switches, one per group of personal data (contact, identity, financial, the diagnostic score, medical, relatives): a group switched off reaches the model as [removed]. Secrets never do."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.fallbackOn",
   "kind": "field",
   "label": {
    "uz": "Frankfurt band boʻlganda jahon zaxira manzili",
    "ru": "Мировой резерв, когда Франкфурт занят",
    "en": "Worldwide fallback when Frankfurt is busy"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Lets a question go through a worldwide endpoint when the Frankfurt one is busy or does not answer."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.monthlyCap",
   "kind": "field",
   "label": {
    "uz": "Oylik xarajat chegarasi, AQSh dollari",
    "ru": "Месячный лимит расходов, доллары США",
    "en": "Monthly spending cap, US dollars"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The most the assistant may spend in a month, in US dollars."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.proposalSteps",
   "kind": "field",
   "label": {
    "uz": "Bitta taklifdagi oʻzgarishlar",
    "ru": "Изменений в одном предложении",
    "en": "Changes in one proposal"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "How many changes one proposal may hold (100 at the start); the rest goes to the next part."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.questionActions",
   "kind": "field",
   "label": {
    "uz": "Bitta savoldagi oʻqishlar va oʻzgarishlar",
    "ru": "Чтений и изменений в одном вопросе",
    "en": "Reads and changes in one question"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "How many reads and changes the assistant may make for one question (40 at the start); past it, the answer offers Continue."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.questionMinutes",
   "kind": "field",
   "label": {
    "uz": "Bitta savol uchun daqiqalar",
    "ru": "Минут на один вопрос",
    "en": "Minutes for one question"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "How many minutes the assistant may work on one question (10 at the start); then it says what is done and offers Continue."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.roleOn",
   "kind": "field",
   "label": {
    "uz": "… roli uchun yoqilgan",
    "ru": "Включён для роли «…»",
    "en": "On for the role …"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the assistant on or off for one role."
  },
  {
   "id": "features/assistant/assistant-settings-section.tsx#field:assistant.settings.schoolOn",
   "kind": "field",
   "label": {
    "uz": "Yordamchi maktab uchun yoqilgan",
    "ru": "Помощник включён для школы",
    "en": "Assistant on for the school"
   },
   "pages": [
    "/setup/assistant"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the assistant on or off for the whole school."
  },
  {
   "id": "features/assistant/proposal-card.tsx#button:assistant.proposal.confirming",
   "kind": "button",
   "label": {
    "uz": "Tasdiqlanmoqda…",
    "ru": "Подтверждение…",
    "en": "Confirming…"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Confirms the assistant's proposal: its changes run in order as on their pages, and the first one refused stops the rest."
  },
  {
   "id": "features/assistant/proposal-card.tsx#button:assistant.proposal.decline",
   "kind": "button",
   "label": {
    "uz": "Rad etish",
    "ru": "Отклонить",
    "en": "Decline"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Declines the assistant's proposal; nothing is changed."
  },
  {
   "id": "features/assistant/proposal-card.tsx#button:assistant.proposal.secretClose",
   "kind": "button",
   "label": {
    "uz": "Yozib oldim",
    "ru": "Я записал",
    "en": "I have written it down"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the one-time password or secret a confirmed step gave out; it is shown once and is not kept in the conversation."
  },
  {
   "id": "features/assistant/proposal-card.tsx#button:assistant.proposal.secretPrint",
   "kind": "button",
   "label": {
    "uz": "Chop etish",
    "ru": "Печать",
    "en": "Print"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Prints the one-time password or secret a confirmed step gave out, as its screen prints the slip."
  },
  {
   "id": "features/assistant/proposal-card.tsx#button:assistant.proposal.undoing",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish taklif qilinmoqda…",
    "ru": "Предлагаем отмену…",
    "en": "Proposing the undo…"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Undo of a confirmed proposal: proposes the reverse of each change made, the last first, as a new proposal to confirm; a change no action reverses is named."
  },
  {
   "id": "features/audit/audit-page.tsx#button:audit.clear",
   "kind": "button",
   "label": {
    "uz": "Tozalash",
    "ru": "Сбросить",
    "en": "Clear"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes the filter to one record and shows all matching entries again."
  },
  {
   "id": "features/audit/audit-page.tsx#column:audit.about",
   "kind": "column",
   "label": {
    "uz": "Kim haqida",
    "ru": "О ком",
    "en": "About"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The person the entry is about."
  },
  {
   "id": "features/audit/audit-page.tsx#column:audit.action",
   "kind": "column",
   "label": {
    "uz": "Nima boʻldi",
    "ru": "Что произошло",
    "en": "What happened"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "What happened, such as a record created, changed or archived, a sign-in or an export."
  },
  {
   "id": "features/audit/audit-page.tsx#column:audit.branch",
   "kind": "column",
   "label": {
    "uz": "Filial",
    "ru": "Филиал",
    "en": "Branch"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The branch of the entry, or school-wide."
  },
  {
   "id": "features/audit/audit-page.tsx#column:audit.record",
   "kind": "column",
   "label": {
    "uz": "Yozuv",
    "ru": "Запись",
    "en": "Record"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The record that was changed."
  },
  {
   "id": "features/audit/audit-page.tsx#column:audit.when",
   "kind": "column",
   "label": {
    "uz": "Qachon",
    "ru": "Когда",
    "en": "When"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When the change or event happened."
  },
  {
   "id": "features/audit/audit-page.tsx#column:audit.who",
   "kind": "column",
   "label": {
    "uz": "Kim",
    "ru": "Кто",
    "en": "Who"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Who made the change, or the system; a change made through an integration key or the assistant says so."
  },
  {
   "id": "features/audit/audit-page.tsx#field:audit.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day of the entries searched."
  },
  {
   "id": "features/audit/audit-page.tsx#field:audit.group",
   "kind": "field",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows only one kind of entry, such as sign-in, people, timetable or journal."
  },
  {
   "id": "features/audit/audit-page.tsx#field:audit.person",
   "kind": "field",
   "label": {
    "uz": "Shaxs",
    "ru": "Человек",
    "en": "Person"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows only the entries about the chosen person."
  },
  {
   "id": "features/audit/audit-page.tsx#field:audit.personKind",
   "kind": "field",
   "label": {
    "uz": "Kim haqida",
    "ru": "О ком",
    "en": "About whom"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the entries are about a staff member, a student or a relative."
  },
  {
   "id": "features/audit/audit-page.tsx#field:audit.scope",
   "kind": "field",
   "label": {
    "uz": "Jurnal",
    "ru": "Журнал",
    "en": "Log"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Searches this branch, all branches, or school-wide entries only."
  },
  {
   "id": "features/audit/audit-page.tsx#field:audit.to",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "По",
    "en": "To"
   },
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The last day of the entries searched."
  },
  {
   "id": "features/audit/entry-panel.tsx#button:audit.show",
   "kind": "button",
   "label": {
    "uz": "Yashirin qiymatlarni koʻrsatish",
    "ru": "Показать скрытые значения",
    "en": "Show hidden values"
   },
   "pages": [
    "/audit"
   ],
   "parent": "features/audit/entry-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "AuditLogController_show"
   ],
   "opens": null,
   "description": "Shows the hidden values of the entry, such as personal details; the showing is itself recorded in the log."
  },
  {
   "id": "features/audit/entry-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/audit"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one audit entry: who, when, the reason and the values before and after."
  },
  {
   "id": "features/audit/forced-deletes-page.tsx#button:forcedDeletes.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/forced-deletes"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [
    "ForcedDeletesController_restore"
   ],
   "opens": null,
   "description": "Restores the deleted record; a lesson whose time or room is now taken is refused with the reason."
  },
  {
   "id": "features/audit/forced-deletes-page.tsx#column:forcedDeletes.about",
   "kind": "column",
   "label": {
    "uz": "Sinf, guruh yoki joy",
    "ru": "Класс, группа или место",
    "en": "Class, group or place"
   },
   "pages": [
    "/forced-deletes"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The class, group or place the deleted record belonged to."
  },
  {
   "id": "features/audit/forced-deletes-page.tsx#column:forcedDeletes.deleted",
   "kind": "column",
   "label": {
    "uz": "Oʻchirildi",
    "ru": "Удалён",
    "en": "Deleted"
   },
   "pages": [
    "/forced-deletes"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Who deleted it and when."
  },
  {
   "id": "features/audit/forced-deletes-page.tsx#column:forcedDeletes.reason",
   "kind": "column",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/forced-deletes"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The reason typed when it was deleted."
  },
  {
   "id": "features/audit/forced-deletes-page.tsx#column:forcedDeletes.record",
   "kind": "column",
   "label": {
    "uz": "Nima oʻchirildi",
    "ru": "Что удалено",
    "en": "What was deleted"
   },
   "pages": [
    "/forced-deletes"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The kind and name of the record deleted for good."
  },
  {
   "id": "features/audit/forced-deletes-page.tsx#column:forcedDeletes.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/forced-deletes"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether it can still be restored, and until when, or was restored."
  },
  {
   "id": "features/auth/account/language-section.tsx#field:language.label",
   "kind": "field",
   "label": {
    "uz": "Til",
    "ru": "Язык",
    "en": "Language"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The language of the app for this person, Uzbek, Russian or English; the choice is saved to the account."
  },
  {
   "id": "features/auth/account/photo-section.tsx#button:account.photoAdd",
   "kind": "button",
   "label": {
    "uz": "Surat qoʻshish",
    "ru": "Добавить фото",
    "en": "Add photo"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the file picker to add or replace the person's own photo (JPEG or PNG)."
  },
  {
   "id": "features/auth/account/photo-section.tsx#button:account.photoRemove",
   "kind": "button",
   "label": {
    "uz": "Suratni olib tashlash",
    "ru": "Удалить фото",
    "en": "Remove photo"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "OwnPhotoController_removePhoto"
   ],
   "opens": null,
   "description": "Removes the person's own photo after a confirmation; the initials are shown instead."
  },
  {
   "id": "features/auth/account/second-step-section.tsx#button:account.turnOff",
   "kind": "button",
   "label": {
    "uz": "Oʻchirish",
    "ru": "Выключить",
    "en": "Turn off"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to turn off the second step, which asks for a code from the app."
  },
  {
   "id": "features/auth/account/second-step-section.tsx#button:account.turnOff:2",
   "kind": "button",
   "label": {
    "uz": "Oʻchirish",
    "ru": "Выключить",
    "en": "Turn off"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "TwoStepController_turnOff"
   ],
   "opens": null,
   "description": "Turns off the second step with the code typed from the authenticator app."
  },
  {
   "id": "features/auth/account/second-step-section.tsx#button:account.turnOn",
   "kind": "button",
   "label": {
    "uz": "Yoqish",
    "ru": "Включить",
    "en": "Turn on"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Starts setting up the second step at sign-in with an authenticator app."
  },
  {
   "id": "features/auth/account/second-step-section.tsx#button:confirm.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Stops setting up or turning off the second step and leaves it as it was."
  },
  {
   "id": "features/auth/account/second-step-section.tsx#button:confirm.cancel:2",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Stops setting up or turning off the second step and leaves it as it was."
  },
  {
   "id": "features/auth/account/second-step-section.tsx#field:setUp.code",
   "kind": "field",
   "label": {
    "uz": "Ilovadagi kod",
    "ru": "Код из приложения",
    "en": "Code from the app"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The current code from the authenticator app, needed to turn off the second step."
  },
  {
   "id": "features/auth/account/sessions-section.tsx#button:account.signOutEverywhere",
   "kind": "button",
   "label": {
    "uz": "Hamma joydan chiqish",
    "ru": "Выйти везде",
    "en": "Sign out everywhere"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "AuthController_signOutEverywhere"
   ],
   "opens": null,
   "description": "Signs out every other session of the account after a confirmation; this device stays signed in."
  },
  {
   "id": "features/auth/account/sign-in-history-section.tsx#button:app.loading",
   "kind": "button",
   "label": {
    "uz": "Yuklanmoqda…",
    "ru": "Загрузка…",
    "en": "Loading…"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Loads older lines of the person's sign-in history."
  },
  {
   "id": "features/auth/account/trusted-devices-section.tsx#button:account.removeNamed",
   "kind": "button",
   "label": {
    "uz": "… qurilmasini olib tashlash",
    "ru": "Удалить …",
    "en": "Remove …"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "TrustedDevicesController_remove"
   ],
   "opens": null,
   "description": "Removes the trusted device after a confirmation, which signs it out at once."
  },
  {
   "id": "features/auth/auth-page.tsx#button:theme.toLight",
   "kind": "button",
   "label": {
    "uz": "Yorugʻ koʻrinish",
    "ru": "Светлая тема",
    "en": "Light theme"
   },
   "pages": [
    "/account/password"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the page between the light and the dark theme."
  },
  {
   "id": "features/auth/password-page.tsx#button:layout.signOut",
   "kind": "button",
   "label": {
    "uz": "Chiqish",
    "ru": "Выйти",
    "en": "Sign out"
   },
   "pages": [
    "/account/password"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "AuthController_signOut"
   ],
   "opens": null,
   "description": "Signs out without choosing a new password."
  },
  {
   "id": "features/auth/password-page.tsx#button:password.submit",
   "kind": "button",
   "label": {
    "uz": "Parolni oʻzgartirish",
    "ru": "Сменить пароль",
    "en": "Change password"
   },
   "pages": [
    "/account/password"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "AuthController_changePassword"
   ],
   "opens": null,
   "description": "Changes the password. The person's other sessions are signed out and this device is no longer trusted."
  },
  {
   "id": "features/auth/password-page.tsx#field:password.currentOneTime",
   "kind": "field",
   "label": {
    "uz": "Bir martalik parol",
    "ru": "Одноразовый пароль",
    "en": "One-time password"
   },
   "pages": [
    "/account/password"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The password the person signed in with: the current password, or the one-time password given to them."
  },
  {
   "id": "features/auth/password-page.tsx#field:password.new",
   "kind": "field",
   "label": {
    "uz": "Yangi parol",
    "ru": "Новый пароль",
    "en": "New password"
   },
   "pages": [
    "/account/password"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The new password, at least the minimum length and different from the current one."
  },
  {
   "id": "features/auth/password-page.tsx#field:password.repeat",
   "kind": "field",
   "label": {
    "uz": "Yangi parol yana bir marta",
    "ru": "Новый пароль ещё раз",
    "en": "New password again"
   },
   "pages": [
    "/account/password"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The new password typed again, to check it was typed right."
  },
  {
   "id": "features/auth/second-step-set-up.tsx#button:setUp.confirm",
   "kind": "button",
   "label": {
    "uz": "Tasdiqlash",
    "ru": "Подтвердить",
    "en": "Confirm"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "TwoStepController_confirm"
   ],
   "opens": null,
   "description": "Checks the code from the app; when it is right, the second step is on and the recovery codes are shown once."
  },
  {
   "id": "features/auth/second-step-set-up.tsx#button:setUp.continue",
   "kind": "button",
   "label": {
    "uz": "Davom etish",
    "ru": "Продолжить",
    "en": "Continue"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Finishes the set-up of the second step once the recovery codes are saved and ticked as saved."
  },
  {
   "id": "features/auth/second-step-set-up.tsx#button:setUp.start",
   "kind": "button",
   "label": {
    "uz": "Boshlash",
    "ru": "Начать",
    "en": "Start"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "TwoStepController_setUp"
   ],
   "opens": null,
   "description": "Starts the set-up of the second step and shows the QR code and key to add to the authenticator app."
  },
  {
   "id": "features/auth/second-step-set-up.tsx#field:setUp.code",
   "kind": "field",
   "label": {
    "uz": "Ilovadagi kod",
    "ru": "Код из приложения",
    "en": "Code from the app"
   },
   "pages": [
    "/account"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The code the authenticator app shows after the QR code is scanned."
  },
  {
   "id": "features/classes/class-form.tsx#button:classes.takenOpen",
   "kind": "button",
   "label": {
    "uz": "Shu nomdagi sinfni ochish",
    "ru": "Открыть класс с этим названием",
    "en": "Open the class with this name"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the existing class that already holds this name, archived or not, so it can be restored or used instead."
  },
  {
   "id": "features/classes/class-form.tsx#field:classes.className",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the class's name within its grade, unique in the year."
  },
  {
   "id": "features/classes/class-form.tsx#field:classes.grade",
   "kind": "field",
   "label": {
    "uz": "Parallel",
    "ru": "Параллель",
    "en": "Grade"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the grade of the class."
  },
  {
   "id": "features/classes/class-form.tsx#field:classes.language",
   "kind": "field",
   "label": {
    "uz": "Taʼlim tili",
    "ru": "Язык обучения",
    "en": "Language of instruction"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the language of instruction of the class; its Tutor and groups must match it."
  },
  {
   "id": "features/classes/class-form.tsx#field:classes.mainRoom",
   "kind": "field",
   "label": {
    "uz": "Asosiy xona",
    "ru": "Основной кабинет",
    "en": "Main classroom"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class's main classroom, or none."
  },
  {
   "id": "features/classes/class-form.tsx#field:classes.maxSize",
   "kind": "field",
   "label": {
    "uz": "Sigʻim",
    "ru": "Макс. учеников",
    "en": "Max. students"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the most students the class may have; placements beyond it are refused."
  },
  {
   "id": "features/classes/class-form.tsx#field:classes.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year the new class belongs to; it cannot be changed afterwards."
  },
  {
   "id": "features/classes/class-members.tsx#button:classes.putIntoClass",
   "kind": "button",
   "label": {
    "uz": "Sinfga joylashtirish",
    "ru": "Зачислить в класс",
    "en": "Put into a class"
   },
   "pages": [
    "/classes",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to put students of this grade who have no class into this class from a chosen day."
  },
  {
   "id": "features/classes/class-members.tsx#button:classes.withdraw",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отменить",
    "en": "Withdraw"
   },
   "pages": [
    "/classes",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "ClassesController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws a planned placement after a confirmation; the student will not join the class on that day."
  },
  {
   "id": "features/classes/class-members.tsx#field:classes.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/classes",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day in the class; by default the latest of today, the start of the year and the students' start dates."
  },
  {
   "id": "features/classes/class-members.tsx#field:classes.from:2",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/classes",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day in the class; by default the latest of today, the start of the year and the students' start dates."
  },
  {
   "id": "features/classes/class-members.tsx#field:classes.name",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/classes",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class of the same grade that the ticked students are put into."
  },
  {
   "id": "features/classes/class-members.tsx#field:classes.pickStudents",
   "kind": "field",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/classes",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticks the active students of the class's grade, without a class, who are put into it."
  },
  {
   "id": "features/classes/class-panel.tsx#button:classes.archiveClass",
   "kind": "button",
   "label": {
    "uz": "Arxivlash",
    "ru": "В архив",
    "en": "Archive class"
   },
   "pages": [
    "/classes"
   ],
   "parent": "features/classes/class-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Archives the class after a confirmation; its Tutors end and planned ones are withdrawn. A class that still has students cannot be archived."
  },
  {
   "id": "features/classes/class-panel.tsx#button:classes.restoreClass",
   "kind": "button",
   "label": {
    "uz": "Sinfni tiklash",
    "ru": "Восстановить класс",
    "en": "Restore class"
   },
   "pages": [
    "/classes"
   ],
   "parent": "features/classes/class-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Restores the archived class after a confirmation; it comes back without a Tutor."
  },
  {
   "id": "features/classes/class-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/classes"
   ],
   "parent": "features/classes/class-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the class's record for editing: grade, name, language, main classroom and maximum size."
  },
  {
   "id": "features/classes/class-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows a class's record, its Tutors with their dates and its students, and holds the actions to edit, put students in, give a Tutor, archive or restore it."
  },
  {
   "id": "features/classes/class-tutors.tsx#button:classes.endTutor",
   "kind": "button",
   "label": {
    "uz": "Tyutorlikni tugatish",
    "ru": "Снять тьютора",
    "en": "End Tutor"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a date field to end this Tutor (or Class teacher) of the class from a chosen day, then asks for a confirmation."
  },
  {
   "id": "features/classes/class-tutors.tsx#button:classes.giveTutor",
   "kind": "button",
   "label": {
    "uz": "Tyutor tayinlash",
    "ru": "Назначить тьютора",
    "en": "Give Tutor"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to give the class a Tutor (or Class teacher for grades 0-4) from a date, showing which dated lessons move to them."
  },
  {
   "id": "features/classes/class-tutors.tsx#button:classes.setActing",
   "kind": "button",
   "label": {
    "uz": "Vaqtinchalik tyutor tayinlash",
    "ru": "Назначить временного тьютора",
    "en": "Set acting Tutor"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to set an acting Tutor (or Class teacher) for a period, showing which dated lessons move to them."
  },
  {
   "id": "features/classes/class-tutors.tsx#button:form.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the Tutor form when no staff member holds the needed role yet."
  },
  {
   "id": "features/classes/class-tutors.tsx#field:classes.endOn",
   "kind": "field",
   "label": {
    "uz": "Yakunlash sanasi",
    "ru": "Завершить с",
    "en": "Ends on"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the day the Tutor's hold of the class ends."
  },
  {
   "id": "features/classes/class-tutors.tsx#field:classes.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day the person holds the class."
  },
  {
   "id": "features/classes/class-tutors.tsx#field:classes.person",
   "kind": "field",
   "label": {
    "uz": "Shaxs",
    "ru": "Человек",
    "en": "Person"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the staff member with the Tutor or Class teacher role; one who does not teach in the class's language cannot be chosen."
  },
  {
   "id": "features/classes/class-tutors.tsx#field:classes.until",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "До",
    "en": "Until"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the last day the person holds the class, or leaves it open."
  },
  {
   "id": "features/classes/classes-page.tsx#button:classes.add",
   "kind": "button",
   "label": {
    "uz": "Yangi sinf",
    "ru": "Новый класс",
    "en": "New class"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form of a new class; it needs an academic year of the branch first."
  },
  {
   "id": "features/classes/classes-page.tsx#button:classes.add:2",
   "kind": "button",
   "label": {
    "uz": "Yangi sinf",
    "ru": "Новый класс",
    "en": "New class"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form of a new class; it needs an academic year of the branch first."
  },
  {
   "id": "features/classes/classes-page.tsx#button:classes.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new class form without saving."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.language",
   "kind": "column",
   "label": {
    "uz": "Taʼlim tili",
    "ru": "Язык обучения",
    "en": "Language of instruction"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the language of instruction of the class."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.mainRoom",
   "kind": "column",
   "label": {
    "uz": "Asosiy xona",
    "ru": "Основной кабинет",
    "en": "Main classroom"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the class's main classroom, or that it has none."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.maxSize",
   "kind": "column",
   "label": {
    "uz": "Sigʻim",
    "ru": "Макс. учеников",
    "en": "Max. students"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the most students the class may have."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.name",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the class, grade and name; pressing the row opens the class."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the class is active or archived."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.students",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many students are in the class today."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.tutorOrClassTeacher",
   "kind": "column",
   "label": {
    "uz": "Tyutor yoki sinf rahbari",
    "ru": "Тьютор или классный руководитель",
    "en": "Tutor or Class teacher"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the class's current Tutor (grades 5-11) or Class teacher (grades 0-4)."
  },
  {
   "id": "features/classes/classes-page.tsx#column:classes.year",
   "kind": "column",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/classes"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the academic year of the class."
  },
  {
   "id": "features/classes/group-form.tsx#button:groups.takenOpen",
   "kind": "button",
   "label": {
    "uz": "Shu nomdagi guruhni ochish",
    "ru": "Открыть группу с этим названием",
    "en": "Open the group with this name"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the existing group that already holds this name, archived or not."
  },
  {
   "id": "features/classes/group-form.tsx#field:groups.classes",
   "kind": "field",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Classes"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Ticks the classes whose students the group draws from, of one grade or two; for two grades the shared lesson slots are shown."
  },
  {
   "id": "features/classes/group-form.tsx#field:groups.groupName",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the group's name, unique in the year."
  },
  {
   "id": "features/classes/group-form.tsx#field:groups.language",
   "kind": "field",
   "label": {
    "uz": "Taʼlim tili",
    "ru": "Язык обучения",
    "en": "Language of instruction"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the language the group is taught in when its classes differ in language; mixing asks for a confirmation."
  },
  {
   "id": "features/classes/group-form.tsx#field:groups.maxSize",
   "kind": "field",
   "label": {
    "uz": "Sigʻim",
    "ru": "Макс. учеников",
    "en": "Max. students"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the most students the group may have."
  },
  {
   "id": "features/classes/group-form.tsx#field:groups.sex",
   "kind": "field",
   "label": {
    "uz": "Kimlar uchun",
    "ru": "Для кого",
    "en": "For"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the group is for everyone, girls only or boys only."
  },
  {
   "id": "features/classes/group-form.tsx#field:groups.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject the group is taught; it cannot be changed afterwards."
  },
  {
   "id": "features/classes/group-form.tsx#field:groups.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year of the new group; it cannot be changed afterwards."
  },
  {
   "id": "features/classes/group-members.tsx#button:groups.markReviewed",
   "kind": "button",
   "label": {
    "uz": "Koʻrib chiqildi",
    "ru": "Проверено",
    "en": "Mark reviewed"
   },
   "pages": [
    "/groups",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "GroupsController_reviewed"
   ],
   "opens": null,
   "description": "Marks a student who was placed into the group automatically as reviewed, removing the review tag."
  },
  {
   "id": "features/classes/group-members.tsx#button:groups.putIntoGroup",
   "kind": "button",
   "label": {
    "uz": "Guruhga joylashtirish",
    "ru": "Зачислить в группу",
    "en": "Put into a group"
   },
   "pages": [
    "/groups",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to put students of the group's classes who are in no group of its subject into this group from a chosen day."
  },
  {
   "id": "features/classes/group-members.tsx#button:groups.withdraw",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отменить",
    "en": "Withdraw"
   },
   "pages": [
    "/groups",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "GroupsController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws a planned placement after a confirmation; the student will not join the group on that day."
  },
  {
   "id": "features/classes/group-members.tsx#field:groups.columns.name",
   "kind": "field",
   "label": {
    "uz": "Guruh",
    "ru": "Группа",
    "en": "Group"
   },
   "pages": [
    "/groups",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the active group, drawing from the ticked students' class, that they are put into."
  },
  {
   "id": "features/classes/group-members.tsx#field:groups.from",
   "kind": "field",
   "label": {
    "uz": "Boshlanishi",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/groups",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day in the group."
  },
  {
   "id": "features/classes/group-members.tsx#field:groups.from:2",
   "kind": "field",
   "label": {
    "uz": "Boshlanishi",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/groups",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day in the group."
  },
  {
   "id": "features/classes/group-members.tsx#field:groups.pickStudents",
   "kind": "field",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/groups",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticks the students of the group's classes, in no group of its subject, who are put into it."
  },
  {
   "id": "features/classes/group-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/groups"
   ],
   "parent": "features/classes/group-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the group's record for editing: classes, name, language, maximum size and who it is for."
  },
  {
   "id": "features/classes/group-panel.tsx#button:groups.archiveGroup",
   "kind": "button",
   "label": {
    "uz": "Arxivlash",
    "ru": "В архив",
    "en": "Archive group"
   },
   "pages": [
    "/groups"
   ],
   "parent": "features/classes/group-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [
    "GroupsController_archive",
    "GroupsController_restore"
   ],
   "opens": null,
   "description": "Archives the group after a confirmation; it stays in the history and can be restored. A group that still has students cannot be archived."
  },
  {
   "id": "features/classes/group-panel.tsx#button:groups.restoreGroup",
   "kind": "button",
   "label": {
    "uz": "Guruhni tiklash",
    "ru": "Восстановить группу",
    "en": "Restore group"
   },
   "pages": [
    "/groups"
   ],
   "parent": "features/classes/group-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [
    "GroupsController_archive",
    "GroupsController_restore"
   ],
   "opens": null,
   "description": "Restores the archived group after a confirmation; it is checked again against its classes and subject."
  },
  {
   "id": "features/classes/group-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows a group's record, its shared lesson slots and its students, and holds the actions to edit, put students in, archive or restore it."
  },
  {
   "id": "features/classes/group-placement-page.tsx#button:groups.placement.automatic",
   "kind": "button",
   "label": {
    "uz": "Avtomatik taqsimlash",
    "ru": "Распределить автоматически",
    "en": "Place automatically"
   },
   "pages": [
    "/groups/placement"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "GroupsController_placeAutomatically"
   ],
   "opens": null,
   "description": "Puts every listed student into the smallest group with a free seat, after a confirmation; each is tagged for review."
  },
  {
   "id": "features/classes/group-placement-page.tsx#column:groups.placement.class",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/groups/placement"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's class."
  },
  {
   "id": "features/classes/group-placement-page.tsx#column:groups.placement.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/groups/placement"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student not yet in a group of the subject."
  },
  {
   "id": "features/classes/group-placement-page.tsx#column:people.students.uid",
   "kind": "column",
   "label": {
    "uz": "UID",
    "ru": "UID",
    "en": "UID"
   },
   "pages": [
    "/groups/placement"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the unique ID of the student not yet in a group."
  },
  {
   "id": "features/classes/group-placement-page.tsx#field:groups.placement.grades",
   "kind": "field",
   "label": {
    "uz": "Parallellar",
    "ru": "Параллели",
    "en": "Grades"
   },
   "pages": [
    "/groups/placement"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the grade, or pair of grades, whose classes are looked at."
  },
  {
   "id": "features/classes/group-placement-page.tsx#field:groups.placement.on",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/groups/placement"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the date the placement is checked on and starts from."
  },
  {
   "id": "features/classes/group-placement-page.tsx#field:groups.placement.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/groups/placement"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject whose unplaced students are listed."
  },
  {
   "id": "features/classes/groups-page.tsx#button:groups.add",
   "kind": "button",
   "label": {
    "uz": "Yangi guruh",
    "ru": "Новая группа",
    "en": "New group"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form of a new group."
  },
  {
   "id": "features/classes/groups-page.tsx#button:groups.add:2",
   "kind": "button",
   "label": {
    "uz": "Yangi guruh",
    "ru": "Новая группа",
    "en": "New group"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form of a new group."
  },
  {
   "id": "features/classes/groups-page.tsx#button:groups.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new group form without saving."
  },
  {
   "id": "features/classes/groups-page.tsx#column:groups.columns.classes",
   "kind": "column",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Classes"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the classes the group draws its students from."
  },
  {
   "id": "features/classes/groups-page.tsx#column:groups.columns.language",
   "kind": "column",
   "label": {
    "uz": "Taʼlim tili",
    "ru": "Язык обучения",
    "en": "Language of instruction"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the language the group is taught in."
  },
  {
   "id": "features/classes/groups-page.tsx#column:groups.columns.maxSize",
   "kind": "column",
   "label": {
    "uz": "Sigʻim",
    "ru": "Макс. учеников",
    "en": "Max. students"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the most students the group may have."
  },
  {
   "id": "features/classes/groups-page.tsx#column:groups.columns.name",
   "kind": "column",
   "label": {
    "uz": "Guruh",
    "ru": "Группа",
    "en": "Group"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the group's name; pressing the row opens the group."
  },
  {
   "id": "features/classes/groups-page.tsx#column:groups.columns.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the group is active or archived."
  },
  {
   "id": "features/classes/groups-page.tsx#column:groups.columns.students",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many students are in the group today."
  },
  {
   "id": "features/classes/groups-page.tsx#column:groups.columns.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/groups"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject the group is taught."
  },
  {
   "id": "features/feedback/feedback-button.tsx#button:confirm.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "FeedbackController_send"
   ],
   "opens": null,
   "description": "Closes the feedback dialog without sending."
  },
  {
   "id": "features/feedback/feedback-button.tsx#button:feedback.button",
   "kind": "button",
   "label": {
    "uz": "Fikr bildirish",
    "ru": "Отправить отзыв",
    "en": "Send feedback"
   },
   "pages": [
    "*"
   ],
   "parent": "features/feedback/feedback-button.tsx#panel:feedback.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to send feedback about what happened or what should work better."
  },
  {
   "id": "features/feedback/feedback-button.tsx#button:feedback.send",
   "kind": "button",
   "label": {
    "uz": "Yuborish",
    "ru": "Отправить",
    "en": "Send"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "FeedbackController_send"
   ],
   "opens": null,
   "description": "Sends the feedback report with the page and role attached. Only a limited number can be sent in 24 hours."
  },
  {
   "id": "features/feedback/feedback-button.tsx#field:feedback.message",
   "kind": "field",
   "label": {
    "uz": "Xabar",
    "ru": "Сообщение",
    "en": "Message"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The message of the feedback report: what happened or what should work better."
  },
  {
   "id": "features/feedback/feedback-button.tsx#panel:feedback.title",
   "kind": "panel",
   "label": {
    "uz": "Fikr bildirish",
    "ru": "Отправить отзыв",
    "en": "Send feedback"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog to send feedback about the platform; the current page and role are attached to the report."
  },
  {
   "id": "features/feedback/feedback-reports-page.tsx#button:feedbackReports.markNew",
   "kind": "button",
   "label": {
    "uz": "Yangi deb belgilash",
    "ru": "Отметить как новый",
    "en": "Mark as new"
   },
   "pages": [
    "/feedback-reports"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [
    "FeedbackReportsController_handled",
    "FeedbackReportsController_reopened"
   ],
   "opens": null,
   "description": "Marks the report handled, or a handled report back as new."
  },
  {
   "id": "features/feedback/feedback-reports-page.tsx#column:feedbackReports.page",
   "kind": "column",
   "label": {
    "uz": "Sahifa",
    "ru": "Страница",
    "en": "Page"
   },
   "pages": [
    "/feedback-reports"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The page the report was sent from."
  },
  {
   "id": "features/feedback/feedback-reports-page.tsx#column:feedbackReports.roles",
   "kind": "column",
   "label": {
    "uz": "Rollar",
    "ru": "Роли",
    "en": "Roles"
   },
   "pages": [
    "/feedback-reports"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The roles the sender held when sending."
  },
  {
   "id": "features/feedback/feedback-reports-page.tsx#column:feedbackReports.sender",
   "kind": "column",
   "label": {
    "uz": "Yuborgan",
    "ru": "Отправитель",
    "en": "Sent by"
   },
   "pages": [
    "/feedback-reports"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The person who sent the report."
  },
  {
   "id": "features/feedback/feedback-reports-page.tsx#column:feedbackReports.sent",
   "kind": "column",
   "label": {
    "uz": "Yuborilgan",
    "ru": "Отправлено",
    "en": "Sent"
   },
   "pages": [
    "/feedback-reports"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "When the report was sent."
  },
  {
   "id": "features/feedback/feedback-reports-page.tsx#column:feedbackReports.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/feedback-reports"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the report is new or handled."
  },
  {
   "id": "features/feedback/feedback-reports-page.tsx#column:feedbackReports.text",
   "kind": "column",
   "label": {
    "uz": "Xabar",
    "ru": "Сообщение",
    "en": "Report"
   },
   "pages": [
    "/feedback-reports"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The text of the feedback report."
  },
  {
   "id": "features/feedback/system-status-card.tsx#button:problems.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Попробовать ещё раз",
    "en": "Try again"
   },
   "pages": [
    "/"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Reads the last 24 hours of the outside services again after they could not be read."
  },
  {
   "id": "features/feedback/system-status-page.tsx#button:systemStatus.refresh",
   "kind": "button",
   "label": {
    "uz": "Yangilash",
    "ru": "Обновить",
    "en": "Refresh"
   },
   "pages": [
    "/",
    "/system-status"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Reads every check of the system status again."
  },
  {
   "id": "features/feedback/system-status-page.tsx#tab:systemStatus.period",
   "kind": "tab",
   "label": {
    "uz": "Davr",
    "ru": "Период",
    "en": "Period"
   },
   "pages": [
    "/",
    "/system-status"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the period for the outside services: 24 hours, 7 days or 14 days."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#button:journal.exports.ask",
   "kind": "button",
   "label": {
    "uz": "Eksport soʻrash",
    "ru": "Запросить экспорт",
    "en": "Ask for the export"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "JournalExportsController_requestBranch"
   ],
   "opens": null,
   "description": "Asks for an export of all the branch's journals in the chosen format and period; it is prepared in the background and appears in the list below."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#button:journal.exports.download",
   "kind": "button",
   "label": {
    "uz": "Yuklab olish",
    "ru": "Скачать",
    "en": "Download"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "JournalExportsController_download"
   ],
   "opens": null,
   "description": "Downloads the ready export file; access is checked again and an expired link is refused."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#button:journal.exports.refresh",
   "kind": "button",
   "label": {
    "uz": "Yangilash",
    "ru": "Обновить",
    "en": "Refresh"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Reads the list of exports again, to see whether a prepared export is ready."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#column:journal.exports.asOf",
   "kind": "column",
   "label": {
    "uz": "Olingan vaqti",
    "ru": "По состоянию на",
    "en": "As of"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the moment the export's data was taken from; every journal in the file is as it stood then."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#column:journal.exports.file",
   "kind": "column",
   "label": {
    "uz": "Fayl",
    "ru": "Файл",
    "en": "File"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the Download button once the export is ready."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#column:journal.exports.format",
   "kind": "column",
   "label": {
    "uz": "Format",
    "ru": "Формат",
    "en": "Format"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the file format of the export: Excel or PDF."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#column:journal.exports.period",
   "kind": "column",
   "label": {
    "uz": "Davr",
    "ru": "Период",
    "en": "Period"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the quarter the export covers, and the month when only one month was asked for."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#column:journal.exports.requested",
   "kind": "column",
   "label": {
    "uz": "Soʻralgan",
    "ru": "Запрошен",
    "en": "Asked for"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows when the export was asked for."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#column:journal.exports.status",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the export is waiting, being prepared, ready (with the time its link stops working) or failed, with the cause."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#field:journal.exports.month",
   "kind": "field",
   "label": {
    "uz": "Oy",
    "ru": "Месяц",
    "en": "Month"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses one month of the quarter, or the whole quarter, for the export."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#field:journal.exports.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter whose journals the export holds."
  },
  {
   "id": "features/journal/branch-exports-page.tsx#tab:journal.exports.format",
   "kind": "tab",
   "label": {
    "uz": "Format",
    "ru": "Формат",
    "en": "Format"
   },
   "pages": [
    "/journal/exports"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the format of the export to ask for: Excel or PDF."
  },
  {
   "id": "features/journal/cell-saves.tsx#button:journal.saving.keepStored",
   "kind": "button",
   "label": {
    "uz": "Saqlangan qiymat qolsin",
    "ru": "Оставить сохранённое",
    "en": "Keep the saved value"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": "features/journal/cell-saves.tsx#panel:journal.saving.staleTitle",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Keeps the value someone else saved and drops yours; nothing is sent."
  },
  {
   "id": "features/journal/cell-saves.tsx#button:journal.saving.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta yuborish",
    "ru": "Отправить снова",
    "en": "Send again"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Sends again every journal cell that could not be saved."
  },
  {
   "id": "features/journal/cell-saves.tsx#button:journal.saving.useMine",
   "kind": "button",
   "label": {
    "uz": "Meniki qolsin",
    "ru": "Оставить моё",
    "en": "Use mine"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": "features/journal/cell-saves.tsx#panel:journal.saving.staleTitle",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Saves your typed value over the newer saved one."
  },
  {
   "id": "features/journal/cell-saves.tsx#panel:journal.saving.staleTitle",
   "kind": "panel",
   "label": {
    "uz": "Bu katakchani boshqa kishi oʻzgartirdi",
    "ru": "Эту ячейку изменил кто-то другой",
    "en": "Someone changed this cell"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Appears when a cell you typed was changed by someone else meanwhile; it shows the saved value, who saved it and when, beside your value, so you choose which stays."
  },
  {
   "id": "features/journal/discipline-items-dialog.tsx#button:app.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": "features/journal/discipline-items-dialog.tsx#panel:journal.discipline.itemsTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the list and goes back to the report."
  },
  {
   "id": "features/journal/discipline-items-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/journal/discipline"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The list behind one count of a teacher on the journal discipline report: the lessons, or works and rating exam entries, with the date, the class and subject, and how many of the count each holds."
  },
  {
   "id": "features/journal/discipline-items-dialog.tsx#panel:journal.discipline.itemsTitle",
   "kind": "panel",
   "label": {
    "uz": "…: …",
    "ru": "…: …",
    "en": "…: …"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": "features/journal/discipline-items-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Lists what one count of a teacher stands for: each lesson or rating exam behind it, with its date and time, class or group, subject and count."
  },
  {
   "id": "features/journal/discipline-page.tsx#button:journal.discipline.showItems",
   "kind": "button",
   "label": {
    "uz": "Nima hisoblanganini koʻrsatish: …",
    "ru": "Показать, что учтено: …",
    "en": "Show what is counted: …"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the list of lessons or works behind this count of the teacher."
  },
  {
   "id": "features/journal/discipline-page.tsx#column:journal.discipline.teacher",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the teacher whose lessons the counts of the row are about."
  },
  {
   "id": "features/journal/discipline-page.tsx#column:journal.discipline.unplanned",
   "kind": "column",
   "label": {
    "uz": "Rejadan tashqari ishlar",
    "ru": "Незапланированные работы",
    "en": "Unplanned works"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows a count of the teacher's lessons in the range (held, nothing entered, in progress, complete, locked incomplete, no attendance, no topic, works missing scores, unplanned works, late entries); a count above zero opens its list."
  },
  {
   "id": "features/journal/discipline-page.tsx#field:journal.discipline.department",
   "kind": "field",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Limits the report to the teachers of one department, or shows all departments."
  },
  {
   "id": "features/journal/discipline-page.tsx#field:journal.discipline.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day of the range the counts cover; the range starts on this week's Monday by default."
  },
  {
   "id": "features/journal/discipline-page.tsx#field:journal.discipline.to",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "По",
    "en": "To"
   },
   "pages": [
    "/journal/discipline"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the last day of the range the counts cover; today by default."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.approve",
   "kind": "button",
   "label": {
    "uz": "Tasdiqlash",
    "ru": "Одобрить",
    "en": "Approve"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": "features/journal/edit-period.tsx#panel:journal.locks.decideTitle",
   "roles": [
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
   ],
   "operations": [
    "UnlocksController_decide"
   ],
   "opens": null,
   "description": "Sends the decision: approves the unlock for the chosen days, or, when Refuse is chosen, refuses it with the reason."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without sending; the typed reason is kept for the next time it is opened."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.back:2",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": "features/journal/edit-period.tsx#panel:journal.locks.decideTitle",
   "roles": [
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
   ],
   "operations": [
    "UnlocksController_decide"
   ],
   "opens": null,
   "description": "Closes the dialog without sending; the typed reason is kept for the next time it is opened."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.correct",
   "kind": "button",
   "label": {
    "uz": "Tuzatish",
    "ru": "Исправить",
    "en": "Correct"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Asks for a reason, then opens this locked lesson or rating exam for a correction; every save of it carries that reason."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.hideLocked",
   "kind": "button",
   "label": {
    "uz": "Yopiq darslarni yashirish",
    "ru": "Скрыть закрытые уроки",
    "en": "Hide the locked lessons"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Hides again the locked lessons that need nothing now, leaving the ones with a request, an unlock running or entries missing; when hidden it shows them."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.request",
   "kind": "button",
   "label": {
    "uz": "Ochishni soʻrash",
    "ru": "Запросить открытие",
    "en": "Request unlock"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to ask for this locked lesson or rating exam to be unlocked, with a reason; the request waits for a decision."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.stopCorrecting",
   "kind": "button",
   "label": {
    "uz": "Tuzatishni tugatish",
    "ru": "Закончить исправление",
    "en": "Stop correcting"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ends the correction under way; the corrected lesson is locked for entry again."
  },
  {
   "id": "features/journal/edit-period.tsx#button:journal.locks.withdraw",
   "kind": "button",
   "label": {
    "uz": "Soʻrovni qaytarib olish",
    "ru": "Отозвать запрос",
    "en": "Withdraw the request"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "UnlocksController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws your waiting unlock request for this lesson."
  },
  {
   "id": "features/journal/edit-period.tsx#field:journal.locks.days",
   "kind": "field",
   "label": {
    "uz": "Ochiq kunlar",
    "ru": "Дней открыто",
    "en": "Days open"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": "features/journal/edit-period.tsx#panel:journal.locks.decideTitle",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses for how many days, 1 to 7, the lesson stays unlocked once approved."
  },
  {
   "id": "features/journal/edit-period.tsx#field:journal.locks.decision",
   "kind": "field",
   "label": {
    "uz": "Qaror",
    "ru": "Решение",
    "en": "Decision"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": "features/journal/edit-period.tsx#panel:journal.locks.decideTitle",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether to approve or refuse the unlock request."
  },
  {
   "id": "features/journal/edit-period.tsx#field:journal.locks.refuseReason",
   "kind": "field",
   "label": {
    "uz": "Rad etish sababi",
    "ru": "Причина отказа",
    "en": "Reason of the refusal"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": "features/journal/edit-period.tsx#panel:journal.locks.decideTitle",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the optional reason of the refusal, which the teacher sees."
  },
  {
   "id": "features/journal/edit-period.tsx#panel:journal.locks.decideTitle",
   "kind": "panel",
   "label": {
    "uz": "Ochish soʻrovi boʻyicha qaror",
    "ru": "Решение по запросу на открытие",
    "en": "Decide the unlock request"
   },
   "pages": [
    "/journal/$journalId",
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Decides a teacher's request to unlock a locked lesson or rating exam: approve it for 1 to 7 days, or refuse it with an optional reason."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.attachDocument",
   "kind": "button",
   "label": {
    "uz": "Hujjat biriktirish",
    "ru": "Прикрепить документ",
    "en": "Attach a document"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a file picker to attach a supporting document to the exemption."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_create",
    "ExemptionsController_preview"
   ],
   "opens": null,
   "description": "Closes the dialog without saving."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.back:2",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.void",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_batchVoid",
    "ExemptionsController_end",
    "ExemptionsController_endPreview",
    "ExemptionsController_void",
    "ExemptionsController_voidPreview"
   ],
   "opens": null,
   "description": "Closes the dialog without saving."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.check",
   "kind": "button",
   "label": {
    "uz": "Tekshirish",
    "ru": "Проверить",
    "en": "Check"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_create",
    "ExemptionsController_preview"
   ],
   "opens": null,
   "description": "Checks the change and lists the held lessons it touches, asking where a mark exists whether to keep it or exempt and clear it; pressed again, it saves."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.check:2",
   "kind": "button",
   "label": {
    "uz": "Tekshirish",
    "ru": "Проверить",
    "en": "Check"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.void",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_batchVoid",
    "ExemptionsController_end",
    "ExemptionsController_endPreview",
    "ExemptionsController_void",
    "ExemptionsController_voidPreview"
   ],
   "opens": null,
   "description": "Checks the end or void and lists the lessons it reopens or changes; pressed again, it applies the change."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.check:3",
   "kind": "button",
   "label": {
    "uz": "Tekshirish",
    "ru": "Проверить",
    "en": "Check"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_confirm",
    "ExemptionsController_confirmPreview"
   ],
   "opens": null,
   "description": "Checks the offered exemption and lists the lessons it touches here; pressed again, it grants the exemption in this branch."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the form after the exemptions are saved."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.createFrom",
   "kind": "button",
   "label": {
    "uz": "Ozod qilish yaratish",
    "ru": "Создать освобождение",
    "en": "Create an exemption"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the new exemption form for this student, starting on the day of the absence."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.drop",
   "kind": "button",
   "label": {
    "uz": "Rad etish",
    "ru": "Отклонить",
    "en": "Drop"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_drop"
   ],
   "opens": null,
   "description": "Drops the exemption offered by the move, after a confirmation; it is not applied in this branch."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.end",
   "kind": "button",
   "label": {
    "uz": "Sanadan tugatish",
    "ru": "Завершить с даты",
    "en": "End from a date"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to end the exemption from a chosen last day, showing first which lessons change."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.new",
   "kind": "button",
   "label": {
    "uz": "Yangi ozod qilish",
    "ru": "Новое освобождение",
    "en": "New exemption"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to enter a new exemption for one or more students of a class."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.openDocument",
   "kind": "button",
   "label": {
    "uz": "… ni ochish",
    "ru": "Открыть …",
    "en": "Open …"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_document"
   ],
   "opens": null,
   "description": "Downloads the document attached to the exemption."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.removeDocument",
   "kind": "button",
   "label": {
    "uz": "Hujjatni olib tashlash",
    "ru": "Удалить документ",
    "en": "Remove the document"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_removeDocument"
   ],
   "opens": null,
   "description": "Removes the attached document after a confirmation."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.showReason",
   "kind": "button",
   "label": {
    "uz": "Sababni koʻrsatish",
    "ru": "Показать причину",
    "en": "Show the reason"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_reason"
   ],
   "opens": null,
   "description": "Shows the written detail of the exemption's reason; opening it is recorded."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.showReason:2",
   "kind": "button",
   "label": {
    "uz": "Sababni koʻrsatish",
    "ru": "Показать причину",
    "en": "Show the reason"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExemptionsController_offerReason"
   ],
   "opens": null,
   "description": "Shows the written detail of the reason of the exemption offered by the move."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.void",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish, xato kiritilgan",
    "ru": "Аннулировать, внесено по ошибке",
    "en": "Void, entered in error"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to void this exemption as entered in error, with a reason; the cleared values come back."
  },
  {
   "id": "features/journal/exemptions-page.tsx#button:journal.exemptions.voidBatch",
   "kind": "button",
   "label": {
    "uz": "Butun guruhni bekor qilish",
    "ru": "Аннулировать всю группу",
    "en": "Void the whole batch"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to void every exemption entered together with this one, with a reason."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.absenceReason",
   "kind": "column",
   "label": {
    "uz": "Tyutor sababi",
    "ru": "Причина от тьютора",
    "en": "Tutor's reason"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the reason the Tutor gave for the absence."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.category",
   "kind": "column",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the reason category: illness, competition, family, school event or other."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.class",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's class."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.class:2",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's class."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.date",
   "kind": "column",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the day the student was absent."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.dates",
   "kind": "column",
   "label": {
    "uz": "Sanalar",
    "ru": "Даты",
    "en": "Dates"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the days the exemption covers, or one day with its time slots."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.dates:2",
   "kind": "column",
   "label": {
    "uz": "Sanalar",
    "ru": "Даты",
    "en": "Dates"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the days the exemption covers, or one day with its time slots."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.decision",
   "kind": "column",
   "label": {
    "uz": "Qaror",
    "ru": "Решение",
    "en": "Decision"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the offered exemption is waiting, confirmed or dropped."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.fromBranch",
   "kind": "column",
   "label": {
    "uz": "Qaysi filialdan",
    "ru": "Из филиала",
    "en": "From branch"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the branch the student moved from, where the exemption was granted."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.kind",
   "kind": "column",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the exemption is temporary (from a date to a date) or full (from a date to the end of the academic year)."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.scope",
   "kind": "column",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subjects exempted, or all subjects."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the exemption is coming, in force, ending this week, ended or voided."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the exempted student; pressing the row opens the exemption's detail."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.student:2",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the exempted student; pressing the row opens the exemption's detail."
  },
  {
   "id": "features/journal/exemptions-page.tsx#column:journal.exemptions.student:3",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the exempted student; pressing the row opens the exemption's detail."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.category",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the reason category of the exemption."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class whose students are exempted; it lists them to tick."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.days",
   "kind": "field",
   "label": {
    "uz": "Vaqt",
    "ru": "Время",
    "en": "Time"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whole days, or chosen time slots of a single day."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.detail",
   "kind": "field",
   "label": {
    "uz": "Tafsilot",
    "ru": "Подробности",
    "en": "Detail"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the written detail of the reason; it is shown only when someone opens it."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.endDate",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the last day of a temporary exemption."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.endDate:2",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.void",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the new last day of the exemption when it is ended from a date."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.kind",
   "kind": "field",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses a temporary exemption, from a date to a date, or a full one, from a date to the end of the academic year."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.scope",
   "kind": "field",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether all subjects are exempted or only chosen ones."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.slotEnd",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "До",
    "en": "Until"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the time the exemption ends on its day."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.slotStart",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the time the exemption starts on its day."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.startDate",
   "kind": "field",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day of the exemption, or its only day for time slots."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.students",
   "kind": "field",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Ticks the students of the class who get the exemption."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.subjects",
   "kind": "field",
   "label": {
    "uz": "Ozod qilinadigan fanlar",
    "ru": "Освобождаемые предметы",
    "en": "Subjects exempted"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Ticks the subjects the exemption covers."
  },
  {
   "id": "features/journal/exemptions-page.tsx#field:journal.exemptions.voidReason",
   "kind": "field",
   "label": {
    "uz": "Nima uchun bekor qilinadi",
    "ru": "Почему аннулируется",
    "en": "Why it is voided"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": "features/journal/exemptions-page.tsx#panel:journal.exemptions.void",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the exemption is voided as entered in error."
  },
  {
   "id": "features/journal/exemptions-page.tsx#panel:journal.exemptions.new",
   "kind": "panel",
   "label": {
    "uz": "Yangi ozod qilish",
    "ru": "Новое освобождение",
    "en": "New exemption"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The form of a new exemption: the class and students, kind, subjects, days or time slots, reason and detail; Check shows the lessons it changes before it is saved."
  },
  {
   "id": "features/journal/exemptions-page.tsx#panel:journal.exemptions.void",
   "kind": "panel",
   "label": {
    "uz": "Bekor qilish, xato kiritilgan",
    "ru": "Аннулировать, внесено по ошибке",
    "en": "Void, entered in error"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that ends, voids or voids the whole batch of an exemption: a last day or a reason, a check of the lessons it touches, then the change."
  },
  {
   "id": "features/journal/exemptions-page.tsx#tab:journal.exemptions.views",
   "kind": "tab",
   "label": {
    "uz": "Boʻlimlar",
    "ru": "Разделы",
    "en": "Views"
   },
   "pages": [
    "/journal/exemptions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches between the list of exemptions, absences with a Tutor's reason and no exemption, and exemptions offered by a student's move from another branch."
  },
  {
   "id": "features/journal/journal-grid.tsx#button:journal.grid.exemptSection",
   "kind": "button",
   "label": {
    "uz": "Ozod: … nafar oʻquvchi",
    "ru": "Освобождены: … ученика",
    "en": "Exempt: … students"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens or folds the section at the bottom of the grid that lists the students exempt from the subject."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.grid.attendanceShort",
   "kind": "column",
   "label": {
    "uz": "Dav",
    "ru": "Пос",
    "en": "Att"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The attendance column of a lesson: each student's mark (present, late, absent, missed the lesson or exempt); its header shows the lock and offers All present."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.grid.grade",
   "kind": "column",
   "label": {
    "uz": "Baho",
    "ru": "Оценка",
    "en": "Grade"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the grade that the student's result gives."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.grid.monthResult",
   "kind": "column",
   "label": {
    "uz": "Oy natijasi, reyting imtihonisiz",
    "ru": "Итог месяца, без рейтингового экзамена",
    "en": "Month result, without the rating exam"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's result for the chosen period (the month without the rating exam, or the quarter), worked out by the platform, with signs for provisional, partial or carried-in results."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.grid.number",
   "kind": "column",
   "label": {
    "uz": "№",
    "ru": "№",
    "en": "No."
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's number in the list of the class or group."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.grid.photo",
   "kind": "column",
   "label": {
    "uz": "Rasm",
    "ru": "Фото",
    "en": "Photo"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's photo, or initials; pressing a photo opens it larger."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.grid.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's name, with any exemption beside it, and the class or group average on the bottom row."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.grid.uid",
   "kind": "column",
   "label": {
    "uz": "UID",
    "ru": "UID",
    "en": "UID"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's unique ID."
  },
  {
   "id": "features/journal/journal-grid.tsx#column:journal.works.unplanned",
   "kind": "column",
   "label": {
    "uz": "rejasiz",
    "ru": "вне плана",
    "en": "unplanned"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "A classwork or homework column added at the lesson rather than taken from the lesson plan; it holds each student's score out of the work's total."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.editor.open",
   "kind": "button",
   "label": {
    "uz": "Darsni tahrirlash",
    "ru": "Изменить урок",
    "en": "Edit lesson"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the lesson's editor, to change its topic, works and their totals."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.entry.allPresent",
   "kind": "button",
   "label": {
    "uz": "Hammasi keldi",
    "ru": "Все присутствуют",
    "en": "All present"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Marks every student without a mark present at this lesson."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.entry.markButton",
   "kind": "button",
   "label": {
    "uz": "…: …",
    "ru": "…: …",
    "en": "…: …"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Sets this attendance mark for the student at the lesson; pressing the chosen mark again clears it."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.grid.attendance",
   "kind": "button",
   "label": {
    "uz": "Davomat",
    "ru": "Посещаемость",
    "en": "Attendance"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the attendance column of the lesson in lesson mode, to mark each student."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.lessonMode.next",
   "kind": "button",
   "label": {
    "uz": "Keyingisi: …",
    "ru": "Далее: …",
    "en": "Next: …"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Goes on to the next column of the lesson, the next classwork or homework."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.lessonMode.nextLesson",
   "kind": "button",
   "label": {
    "uz": "Keyingi dars",
    "ru": "Следующий урок",
    "en": "Next lesson"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Moves lesson mode to the lesson after."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.lessonMode.previousLesson",
   "kind": "button",
   "label": {
    "uz": "Oldingi dars",
    "ru": "Предыдущий урок",
    "en": "Previous lesson"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Moves lesson mode to the lesson before."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.page.exitFullScreen",
   "kind": "button",
   "label": {
    "uz": "Toʻliq ekrandan chiqish",
    "ru": "Выйти из полноэкранного режима",
    "en": "Exit full screen"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Returns the journal grid from full screen to the page."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.page.fullScreen",
   "kind": "button",
   "label": {
    "uz": "Toʻliq ekran",
    "ru": "Во весь экран",
    "en": "Full screen"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the journal grid over the whole screen."
  },
  {
   "id": "features/journal/journal-page.tsx#button:journal.saving.undoHint",
   "kind": "button",
   "label": {
    "uz": "Bu sahifadagi oxirgi amalingizni bekor qilish (Ctrl+Z)",
    "ru": "Отменить ваше последнее действие на этой странице (Ctrl+Z)",
    "en": "Undo your last action on this page (Ctrl+Z)"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Undoes your last action on this journal page, such as a mark or a score entered."
  },
  {
   "id": "features/journal/journal-page.tsx#button:list.columns",
   "kind": "button",
   "label": {
    "uz": "Ustunlar",
    "ru": "Столбцы",
    "en": "Columns"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a menu to show or hide columns of the journal grid; the choice is remembered on this device."
  },
  {
   "id": "features/journal/journal-page.tsx#field:journal.page.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches to the journal of another class or group with the same subject."
  },
  {
   "id": "features/journal/journal-page.tsx#field:journal.page.filter",
   "kind": "field",
   "label": {
    "uz": "Filtr",
    "ru": "Фильтр",
    "en": "Filter"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows all students, only current members, those who left or moved, or those with an empty cell."
  },
  {
   "id": "features/journal/journal-page.tsx#field:journal.page.month",
   "kind": "field",
   "label": {
    "uz": "Oy",
    "ru": "Месяц",
    "en": "Month"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows one month of the quarter, with the month result, or the whole quarter."
  },
  {
   "id": "features/journal/journal-page.tsx#field:journal.page.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter whose lessons the journal shows."
  },
  {
   "id": "features/journal/journal-page.tsx#field:journal.page.search",
   "kind": "field",
   "label": {
    "uz": "Oʻquvchini qidirish",
    "ru": "Поиск ученика",
    "en": "Search students"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Finds students in the journal by name."
  },
  {
   "id": "features/journal/journal-page.tsx#field:journal.page.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches to the journal of another subject of the same class or group."
  },
  {
   "id": "features/journal/journal-page.tsx#field:journal.page.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses another academic year; it opens that year's list of journals."
  },
  {
   "id": "features/journal/journal-page.tsx#tab:journal.page.mode",
   "kind": "tab",
   "label": {
    "uz": "Koʻrinish",
    "ru": "Вид",
    "en": "View"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches between the grid of all lessons and lesson mode, which shows one lesson and one column at a time."
  },
  {
   "id": "features/journal/journals-page.tsx#column:journal.page.class",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/journal"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the class or group of the journal; pressing the row opens the journal."
  },
  {
   "id": "features/journal/journals-page.tsx#column:journal.page.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/journal"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject of the journal."
  },
  {
   "id": "features/journal/journals-page.tsx#field:journal.page.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/journal"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year whose journals are listed."
  },
  {
   "id": "features/journal/journals-page.tsx#tab:journal.page.tabs",
   "kind": "tab",
   "label": {
    "uz": "Sinflar yoki guruhlar",
    "ru": "Классы или группы",
    "en": "Classes or groups"
   },
   "pages": [
    "/journal"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the list between the journals of classes and those of groups."
  },
  {
   "id": "features/journal/lesson-mode-score.tsx#button:journal.notGraded.typeFor",
   "kind": "button",
   "label": {
    "uz": "…: baholanmagan (-)",
    "ru": "…: без оценки (-)",
    "en": "…: not graded (-)"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the student's cell of this work to not graded (-); pressing it again clears it."
  },
  {
   "id": "features/journal/lesson-mode-score.tsx#button:journal.refusals.point",
   "kind": "button",
   "label": {
    "uz": "Nuqta qoʻyish",
    "ru": "Поставить точку",
    "en": "Type a point"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Types a point in the number field beside it, for a number with decimals such as 7.5."
  },
  {
   "id": "features/journal/orphans-page.tsx#button:journal.orphans.withdraw",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "LessonStatusController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws the assignment of the teacher completing this lesson, after a confirmation."
  },
  {
   "id": "features/journal/orphans-page.tsx#column:journal.orphans.assignment",
   "kind": "column",
   "label": {
    "uz": "Toʻldiruvchi",
    "ru": "Заполняет",
    "en": "Completed by"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the teacher assigned to complete the lesson and until when it is open to them."
  },
  {
   "id": "features/journal/orphans-page.tsx#column:journal.orphans.lesson",
   "kind": "column",
   "label": {
    "uz": "Dars",
    "ru": "Урок",
    "en": "Lesson"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the incomplete lesson left by a teacher who left; pressing the row opens it to assign a teacher."
  },
  {
   "id": "features/journal/orphans-page.tsx#column:journal.orphans.status",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how far the lesson's entries got, such as nothing entered or in progress."
  },
  {
   "id": "features/journal/orphans-page.tsx#column:journal.orphans.teacher",
   "kind": "column",
   "label": {
    "uz": "Ketgan oʻqituvchi",
    "ru": "Ушедший учитель",
    "en": "Teacher who left"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the teacher who left with the lesson incomplete."
  },
  {
   "id": "features/journal/orphans-page.tsx#field:journal.orphans.days",
   "kind": "field",
   "label": {
    "uz": "Kun",
    "ru": "Дней",
    "en": "Days"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses for how many days, 1 to 7, the lesson stays open to the assigned teacher."
  },
  {
   "id": "features/journal/orphans-page.tsx#field:journal.orphans.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason of the assignment; it is required."
  },
  {
   "id": "features/journal/orphans-page.tsx#field:journal.orphans.teacherField",
   "kind": "field",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/journal/orphans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the teacher who completes the orphan lesson."
  },
  {
   "id": "features/journal/reminders-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/",
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Lists what needs doing in the journals: lessons with no attendance, planned works with numbers missing, lessons with no topic, rating exam scores missing and lessons about to lock; each item opens its journal."
  },
  {
   "id": "features/journal/student-absences-page.tsx#button:journal.absences.clear",
   "kind": "button",
   "label": {
    "uz": "Sababni tozalash",
    "ru": "Очистить причину",
    "en": "Clear the reason"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [
    "StudentAbsencesController_set"
   ],
   "opens": null,
   "description": "Clears the reason of the absence after a confirmation."
  },
  {
   "id": "features/journal/student-absences-page.tsx#button:journal.absences.file.attach",
   "kind": "button",
   "label": {
    "uz": "Fayl biriktirish",
    "ru": "Прикрепить файл",
    "en": "Attach a file"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a file picker to attach a file, such as a medical certificate, to the reason."
  },
  {
   "id": "features/journal/student-absences-page.tsx#button:journal.absences.file.open",
   "kind": "button",
   "label": {
    "uz": "… ni ochish",
    "ru": "Открыть …",
    "en": "Open …"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [
    "StudentAbsencesController_readFile"
   ],
   "opens": null,
   "description": "Downloads the file attached to the reason, such as a medical certificate."
  },
  {
   "id": "features/journal/student-absences-page.tsx#button:journal.absences.file.remove",
   "kind": "button",
   "label": {
    "uz": "Faylni olib tashlash",
    "ru": "Удалить файл",
    "en": "Remove the file"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [
    "StudentAbsencesController_removeFile"
   ],
   "opens": null,
   "description": "Removes the attached file after a confirmation."
  },
  {
   "id": "features/journal/student-absences-page.tsx#button:journal.absences.setReason",
   "kind": "button",
   "label": {
    "uz": "Sababni koʻrsatish",
    "ru": "Указать причину",
    "en": "Set the reason"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to set or change the reason of the student's absence that day."
  },
  {
   "id": "features/journal/student-absences-page.tsx#column:journal.absences.atSchoolEarlier",
   "kind": "column",
   "label": {
    "uz": "Shu kuni avvalroq maktabda boʻlgan",
    "ru": "Был в школе раньше в этот день",
    "en": "At school earlier that day"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the student was marked at school at an earlier lesson that day."
  },
  {
   "id": "features/journal/student-absences-page.tsx#column:journal.absences.category",
   "kind": "column",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the reason category given for the absence, or none."
  },
  {
   "id": "features/journal/student-absences-page.tsx#column:journal.absences.date",
   "kind": "column",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the day of the absence."
  },
  {
   "id": "features/journal/student-absences-page.tsx#column:journal.absences.lessons",
   "kind": "column",
   "label": {
    "uz": "Qoldirilgan darslar",
    "ru": "Пропущенные уроки",
    "en": "Lessons missed"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Lists the lessons the student missed that day, with the time, the subject and the mark."
  },
  {
   "id": "features/journal/student-absences-page.tsx#column:journal.absences.note",
   "kind": "column",
   "label": {
    "uz": "Izoh",
    "ru": "Заметка",
    "en": "Note"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the note written with the reason."
  },
  {
   "id": "features/journal/student-absences-page.tsx#column:journal.absences.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the absent student; pressing the row opens the day with its reason."
  },
  {
   "id": "features/journal/student-absences-page.tsx#field:journal.absences.category",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the reason category of the absence."
  },
  {
   "id": "features/journal/student-absences-page.tsx#field:journal.absences.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class whose absences are listed."
  },
  {
   "id": "features/journal/student-absences-page.tsx#field:journal.absences.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first day of the range listed (at most 31 days)."
  },
  {
   "id": "features/journal/student-absences-page.tsx#field:journal.absences.note",
   "kind": "field",
   "label": {
    "uz": "Izoh",
    "ru": "Заметка",
    "en": "Note"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds a short note about the reason."
  },
  {
   "id": "features/journal/student-absences-page.tsx#field:journal.absences.to",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "По",
    "en": "To"
   },
   "pages": [
    "/journal/student-absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the last day of the range listed."
  },
  {
   "id": "features/journal/student-photo.tsx#button:journal.entry.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the photo."
  },
  {
   "id": "features/journal/student-photo.tsx#button:journal.grid.photoOpen",
   "kind": "button",
   "label": {
    "uz": "… rasmini ochish",
    "ru": "Открыть фото: …",
    "en": "Open the photo of …"
   },
   "pages": [
    "/journal/$journalId"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the student's photo larger in a dialog."
  },
  {
   "id": "features/journal/support-page.tsx#field:journal.support.date",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/journal/support"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the day whose lesson entries are shown."
  },
  {
   "id": "features/journal/support-page.tsx#field:journal.support.journal",
   "kind": "field",
   "label": {
    "uz": "Jurnal",
    "ru": "Журнал",
    "en": "Journal"
   },
   "pages": [
    "/journal/support"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the journal to look into."
  },
  {
   "id": "features/journal/support-page.tsx#field:journal.support.student",
   "kind": "field",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/journal/support"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the student whose cells and their full history are shown."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#button:journal.unlocks.decide",
   "kind": "button",
   "label": {
    "uz": "Qaror qilish",
    "ru": "Решить",
    "en": "Decide"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to approve the unlock for some days or refuse it."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#button:journal.unlocks.openJournal",
   "kind": "button",
   "label": {
    "uz": "Jurnalni ochish",
    "ru": "Открыть журнал",
    "en": "Open the journal"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the journal of the request at its quarter."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#button:journal.unlocks.withdraw",
   "kind": "button",
   "label": {
    "uz": "Qaytarib olish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "UnlocksController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws your waiting unlock request."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#column:journal.unlocks.person",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the teacher who asked for the unlock."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#column:journal.unlocks.statusLabel",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the request is waiting, approved, refused, withdrawn or cancelled."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#column:journal.unlocks.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject of the journal."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#column:journal.unlocks.unit",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the class or group of the journal."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#column:journal.unlocks.what",
   "kind": "column",
   "label": {
    "uz": "Dars",
    "ru": "Урок",
    "en": "Lesson"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the locked lesson or rating exam the request is for; pressing the row opens the request."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#field:journal.unlocks.days",
   "kind": "field",
   "label": {
    "uz": "Kunlar",
    "ru": "Дней",
    "en": "Days"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses for how many days those lessons stay open for entry."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#field:journal.unlocks.fromDate",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the first lesson day whose edit period is extended for the whole branch."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#field:journal.unlocks.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason of the branch-wide extension; it is required and logged."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#field:journal.unlocks.toDate",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "По",
    "en": "To"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the last lesson day whose edit period is extended."
  },
  {
   "id": "features/journal/unlock-requests-page.tsx#tab:journal.unlocks.tabs",
   "kind": "tab",
   "label": {
    "uz": "Soʻrovlar",
    "ru": "Запросы",
    "en": "Requests"
   },
   "pages": [
    "/journal/unlocks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches between the requests waiting for your decision, your own requests and all the branch's requests."
  },
  {
   "id": "features/notifications/notifications-button.tsx#button:notifications.buttonUnread",
   "kind": "button",
   "label": {
    "uz": "Bildirishnomalar, … ta oʻqilmagan",
    "ru": "Уведомления, … непрочитанных",
    "en": "Notifications, … unread"
   },
   "pages": [
    "*"
   ],
   "parent": "features/notifications/notifications-button.tsx#panel:notifications.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the notifications; its name says how many are unread."
  },
  {
   "id": "features/notifications/notifications-button.tsx#button:notifications.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "*"
   ],
   "parent": "features/notifications/notifications-button.tsx#panel:notifications.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the notifications dialog."
  },
  {
   "id": "features/notifications/notifications-button.tsx#button:notifications.markAllRead",
   "kind": "button",
   "label": {
    "uz": "Hammasini oʻqilgan deb belgilash",
    "ru": "Отметить все как прочитанные",
    "en": "Mark all as read"
   },
   "pages": [
    "*"
   ],
   "parent": "features/notifications/notifications-button.tsx#panel:notifications.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "NotificationsController_readAll"
   ],
   "opens": null,
   "description": "Marks every notification as read."
  },
  {
   "id": "features/notifications/notifications-button.tsx#button:notifications.unread",
   "kind": "button",
   "label": {
    "uz": "Oʻqilmagan",
    "ru": "Не прочитано",
    "en": "Unread"
   },
   "pages": [
    "*"
   ],
   "parent": "features/notifications/notifications-button.tsx#panel:notifications.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [
    "NotificationsController_read"
   ],
   "opens": null,
   "description": "An unread notification; pressing it marks it as read."
  },
  {
   "id": "features/notifications/notifications-button.tsx#panel:notifications.title",
   "kind": "panel",
   "label": {
    "uz": "Bildirishnomalar",
    "ru": "Уведомления",
    "en": "Notifications"
   },
   "pages": [
    "*"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "The notifications dialog: changes to the person's timetable, substitutions, locks, plan windows and other notices, newest first."
  },
  {
   "id": "features/people/account-access-section.tsx#button:confirm.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/account-access-section.tsx#panel:people.access.lockTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "AccountAccessController_lock"
   ],
   "opens": null,
   "description": "Closes the lock dialog without locking the account."
  },
  {
   "id": "features/people/account-access-section.tsx#button:people.access.lock",
   "kind": "button",
   "label": {
    "uz": "Hozir bloklash",
    "ru": "Заблокировать сейчас",
    "en": "Lock now"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog that asks for the reason and then locks the account, so the person can no longer sign in."
  },
  {
   "id": "features/people/account-access-section.tsx#button:people.access.lock:2",
   "kind": "button",
   "label": {
    "uz": "Hozir bloklash",
    "ru": "Заблокировать сейчас",
    "en": "Lock now"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/account-access-section.tsx#panel:people.access.lockTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "AccountAccessController_lock"
   ],
   "opens": null,
   "description": "Locks the account with the reason typed; the person can no longer sign in until it is unlocked."
  },
  {
   "id": "features/people/account-access-section.tsx#button:people.access.resetPassword",
   "kind": "button",
   "label": {
    "uz": "Parolni tiklash",
    "ru": "Сбросить пароль",
    "en": "Reset password"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Resets the password after a confirmation: all sessions end and a slip with a one-time password valid for 24 hours is shown to print."
  },
  {
   "id": "features/people/account-access-section.tsx#button:people.access.resetSecondStep",
   "kind": "button",
   "label": {
    "uz": "Ikkinchi bosqichni tiklash",
    "ru": "Сбросить второй шаг",
    "en": "Reset second step"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes the two-step sign-in and its recovery codes and resets the password after a confirmation; a one-time password slip is shown and the person sets up the second step again."
  },
  {
   "id": "features/people/account-access-section.tsx#button:people.access.unlock",
   "kind": "button",
   "label": {
    "uz": "Blokdan chiqarish",
    "ru": "Разблокировать",
    "en": "Unlock"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "AccountAccessController_unlock"
   ],
   "opens": null,
   "description": "Unlocks the account after a confirmation, so the person can sign in again."
  },
  {
   "id": "features/people/account-access-section.tsx#field:people.access.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/account-access-section.tsx#panel:people.access.lockTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the account is locked, in at most 500 characters; the reason is shown with the lock."
  },
  {
   "id": "features/people/account-access-section.tsx#panel:people.access.lockTitle",
   "kind": "panel",
   "label": {
    "uz": "… hisobini bloklash",
    "ru": "Заблокировать учётную запись: …",
    "en": "Lock the account of …"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for locking a staff member's account, with the reason of the lock."
  },
  {
   "id": "features/people/account-section.tsx#button:people.account.changeSubjectsOf",
   "kind": "button",
   "label": {
    "uz": "«…» rolining fanlarini oʻzgartirish",
    "ru": "Изменить предметы роли «…»",
    "en": "Change the subjects of …"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change the subjects this role oversees, from a chosen date."
  },
  {
   "id": "features/people/account-section.tsx#button:people.account.chooseAll",
   "kind": "button",
   "label": {
    "uz": "Hammasini tanlash",
    "ru": "Выбрать все",
    "en": "Choose all"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Ticks every subject in the list."
  },
  {
   "id": "features/people/account-section.tsx#button:people.account.create",
   "kind": "button",
   "label": {
    "uz": "Hisob yaratish",
    "ru": "Создать учётную запись",
    "en": "Create account"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to create a sign-in account for this staff record; after saving, a first-password slip is shown to print."
  },
  {
   "id": "features/people/account-section.tsx#button:people.account.endOf",
   "kind": "button",
   "label": {
    "uz": "«…» rolini tugatish",
    "ru": "Завершить роль «…»",
    "en": "End the role …"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to end this role from a chosen date; after a confirmation the role ends on that date."
  },
  {
   "id": "features/people/account-section.tsx#button:people.account.give",
   "kind": "button",
   "label": {
    "uz": "Rol berish",
    "ru": "Назначить роль",
    "en": "Give a role"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to give the account a new role, with its branch, start date and, for a Head Teacher, its subjects."
  },
  {
   "id": "features/people/account-section.tsx#button:people.account.linkOwn",
   "kind": "button",
   "label": {
    "uz": "Mening hisobimga bogʻlash",
    "ru": "Связать с моей учётной записью",
    "en": "Link to my account"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "StaffAccountsController_linkOwn"
   ],
   "opens": null,
   "description": "Links this staff record to your own account after a confirmation; your name and photo then come from this record. The link cannot be undone."
  },
  {
   "id": "features/people/account-section.tsx#button:people.account.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Повторить",
    "en": "Try again"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Reads the list of subjects again after it failed to load."
  },
  {
   "id": "features/people/account-section.tsx#field:people.account.branch",
   "kind": "field",
   "label": {
    "uz": "Filial",
    "ru": "Филиал",
    "en": "Branch"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The branch the new role is for; not asked for a school-wide role."
  },
  {
   "id": "features/people/account-section.tsx#field:people.account.endFrom",
   "kind": "field",
   "label": {
    "uz": "Tugash sanasi",
    "ru": "Завершается с",
    "en": "Ends from"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The day from which the role ends; once that day has come the end cannot be taken back."
  },
  {
   "id": "features/people/account-section.tsx#field:people.account.from",
   "kind": "field",
   "label": {
    "uz": "Boshlanish sanasi",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day the new role is in force."
  },
  {
   "id": "features/people/account-section.tsx#field:people.account.login",
   "kind": "field",
   "label": {
    "uz": "Login",
    "ru": "Логин",
    "en": "Login"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The login of the new account, in small Latin letters and dots, for example a.karimov."
  },
  {
   "id": "features/people/account-section.tsx#field:people.account.newRole",
   "kind": "field",
   "label": {
    "uz": "Yangi rol",
    "ru": "Новая роль",
    "en": "New role"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The role to give to the account."
  },
  {
   "id": "features/people/account-section.tsx#field:people.account.subjects",
   "kind": "field",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The subjects the role oversees, ticked from the branch's subjects."
  },
  {
   "id": "features/people/account-section.tsx#field:people.account.subjectsFrom",
   "kind": "field",
   "label": {
    "uz": "Yangi fanlar boshlanish sanasi",
    "ru": "Новые предметы с",
    "en": "New subjects from"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day the new set of subjects applies to the role."
  },
  {
   "id": "features/people/availability-section.tsx#button:people.availability.change",
   "kind": "button",
   "label": {
    "uz": "Sanadan boshlab oʻzgartirish",
    "ru": "Изменить с даты",
    "en": "Change from a date"
   },
   "pages": [
    "/people/staff",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change the person's weekly available hours in this branch from a chosen date."
  },
  {
   "id": "features/people/availability-section.tsx#field:people.availability.from",
   "kind": "field",
   "label": {
    "uz": "Sanadan",
    "ru": "С даты",
    "en": "From"
   },
   "pages": [
    "/people/staff",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day the new available hours apply; the hours are typed per weekday, such as 08:00-13:00, 14:00-17:00."
  },
  {
   "id": "features/people/branch-move.tsx#button:people.students.branchMoves.accept",
   "kind": "button",
   "label": {
    "uz": "Qabul qilish",
    "ru": "Принять",
    "en": "Accept"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the accept of a student released to this branch: the class to join, then a confirmation; an accept cannot be undone."
  },
  {
   "id": "features/people/branch-move.tsx#button:people.students.branchMoves.decline",
   "kind": "button",
   "label": {
    "uz": "Rad etish",
    "ru": "Отклонить",
    "en": "Decline"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the decline of a release to this branch, with a reason; after a confirmation the student stays in the other branch."
  },
  {
   "id": "features/people/branch-move.tsx#field:people.students.branchMoves.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The class of this branch the arriving student joins."
  },
  {
   "id": "features/people/branch-move.tsx#field:people.students.branchMoves.from",
   "kind": "field",
   "label": {
    "uz": "U yerdagi birinchi kun",
    "ru": "Первый день там",
    "en": "First day there"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's first day in the other branch."
  },
  {
   "id": "features/people/branch-move.tsx#field:people.students.branchMoves.toBranch",
   "kind": "field",
   "label": {
    "uz": "Filial",
    "ru": "Филиал",
    "en": "Branch"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The branch the student is released to."
  },
  {
   "id": "features/people/branch-move.tsx#field:people.students.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the release from the other branch is declined."
  },
  {
   "id": "features/people/first-password-slip.tsx#button:people.account.closeSlip",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/people/staff",
    "/people/staff/import"
   ],
   "parent": "features/people/first-password-slip.tsx#panel:people.access.slipTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the slip; the password is not shown again."
  },
  {
   "id": "features/people/first-password-slip.tsx#button:people.account.print",
   "kind": "button",
   "label": {
    "uz": "Chop etish",
    "ru": "Печать",
    "en": "Print"
   },
   "pages": [
    "/people/staff",
    "/people/staff/import"
   ],
   "parent": "features/people/first-password-slip.tsx#panel:people.access.slipTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Prints the password slip."
  },
  {
   "id": "features/people/first-password-slip.tsx#button:problems.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Попробовать ещё раз",
    "en": "Try again"
   },
   "pages": [
    "/people/staff",
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Reads the branch details for the slip again after they failed to load."
  },
  {
   "id": "features/people/first-password-slip.tsx#panel:people.access.slipTitle",
   "kind": "panel",
   "label": {
    "uz": "Parol tiklandi",
    "ru": "Сброс пароля",
    "en": "Password reset"
   },
   "pages": [
    "/people/staff",
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that shows the printable slip with the login and the one-time password; the password is shown only once."
  },
  {
   "id": "features/people/head-teachers-page.tsx#column:people.headTeachers.from",
   "kind": "column",
   "label": {
    "uz": "Boshlanishi",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/people/head-teachers"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day of the appointment."
  },
  {
   "id": "features/people/head-teachers-page.tsx#column:people.headTeachers.person",
   "kind": "column",
   "label": {
    "uz": "Xodim",
    "ru": "Сотрудник",
    "en": "Person"
   },
   "pages": [
    "/people/head-teachers"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member who holds the Head Teacher role."
  },
  {
   "id": "features/people/head-teachers-page.tsx#column:people.headTeachers.role",
   "kind": "column",
   "label": {
    "uz": "Rol",
    "ru": "Роль",
    "en": "Role"
   },
   "pages": [
    "/people/head-teachers"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The kind of Head Teacher role held."
  },
  {
   "id": "features/people/head-teachers-page.tsx#column:people.headTeachers.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/people/head-teachers"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the appointment is planned or in force."
  },
  {
   "id": "features/people/head-teachers-page.tsx#column:people.headTeachers.subjects",
   "kind": "column",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/people/head-teachers"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The subjects the Head Teacher oversees."
  },
  {
   "id": "features/people/head-teachers-page.tsx#column:people.headTeachers.until",
   "kind": "column",
   "label": {
    "uz": "Tugashi",
    "ru": "По",
    "en": "Until"
   },
   "pages": [
    "/people/head-teachers"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The day the appointment ends, if an end is set."
  },
  {
   "id": "features/people/never-used-page.tsx#column:people.neverUsed.created",
   "kind": "column",
   "label": {
    "uz": "Yaratilgan",
    "ru": "Создана",
    "en": "Created"
   },
   "pages": [
    "/people/never-used"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When the account was created."
  },
  {
   "id": "features/people/never-used-page.tsx#column:people.neverUsed.lockedColumn",
   "kind": "column",
   "label": {
    "uz": "Blok",
    "ru": "Блокировка",
    "en": "Lock"
   },
   "pages": [
    "/people/never-used"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the account is locked."
  },
  {
   "id": "features/people/never-used-page.tsx#column:people.neverUsed.login",
   "kind": "column",
   "label": {
    "uz": "Login",
    "ru": "Логин",
    "en": "Login"
   },
   "pages": [
    "/people/never-used"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The login of the account."
  },
  {
   "id": "features/people/never-used-page.tsx#column:people.neverUsed.name",
   "kind": "column",
   "label": {
    "uz": "Familiya va ism",
    "ru": "Фамилия и имя",
    "en": "Surname and name"
   },
   "pages": [
    "/people/never-used"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The surname and name of the staff member whose account was never used."
  },
  {
   "id": "features/people/never-used-page.tsx#column:people.neverUsed.password",
   "kind": "column",
   "label": {
    "uz": "Parol",
    "ru": "Пароль",
    "en": "Password"
   },
   "pages": [
    "/people/never-used"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Until when the first password is valid, or the day it ran out."
  },
  {
   "id": "features/people/never-used-page.tsx#column:people.neverUsed.staffNumber",
   "kind": "column",
   "label": {
    "uz": "Xodim ID",
    "ru": "Табельный номер",
    "en": "Staff ID"
   },
   "pages": [
    "/people/never-used"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff ID of the person."
  },
  {
   "id": "features/people/parent-account-part.tsx#button:people.parentAccount.reset",
   "kind": "button",
   "label": {
    "uz": "Parolni tiklash",
    "ru": "Сбросить пароль",
    "en": "Reset password"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "ParentAccountsController_reset"
   ],
   "opens": null,
   "description": "Resets the parent's password after a confirmation and a choice of slip language: every session ends and a new slip valid for 7 days is printed."
  },
  {
   "id": "features/people/parent-account-part.tsx#button:people.parentAccount.unlink",
   "kind": "button",
   "label": {
    "uz": "Telegramni uzish",
    "ru": "Отвязать Telegram",
    "en": "Unlink Telegram"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "ParentAccountsController_unlinkTelegram"
   ],
   "opens": null,
   "description": "Unlinks the parent's Telegram after a confirmation; the portal no longer opens from Telegram without the password, and the password stays."
  },
  {
   "id": "features/people/parent-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the parent's record form to change the name, phones, workplace or email."
  },
  {
   "id": "features/people/parent-panel.tsx#button:people.relatives.closeChoices",
   "kind": "button",
   "label": {
    "uz": "Variantlarni yopish",
    "ru": "Закрыть варианты",
    "en": "Close the choices"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the choices shown when the new phone belongs to another relative."
  },
  {
   "id": "features/people/parent-panel.tsx#button:people.relatives.giveNumber",
   "kind": "button",
   "label": {
    "uz": "Raqamni shu qarindoshga berish",
    "ru": "Передать номер этому родственнику",
    "en": "Give the number to this relative"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Gives the phone to this parent and saves the earlier holder's new phone, or marks it unknown."
  },
  {
   "id": "features/people/parent-panel.tsx#button:people.relatives.merge",
   "kind": "button",
   "label": {
    "uz": "Birlashtirish",
    "ru": "Объединить",
    "en": "Merge"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "RelativesController_merge",
    "RelativesController_phoneMatch"
   ],
   "opens": null,
   "description": "Merges the two parent records after a confirmation: every student of both is linked to the one that stays, and the other is archived."
  },
  {
   "id": "features/people/parent-panel.tsx#button:people.relatives.mergeWith",
   "kind": "button",
   "label": {
    "uz": "… bilan birlashtirish",
    "ru": "Объединить с: …",
    "en": "Merge with …"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses to merge this parent with the record that already holds the phone number, so both become one person."
  },
  {
   "id": "features/people/parent-panel.tsx#button:people.relatives.newOwner",
   "kind": "button",
   "label": {
    "uz": "Boshqa odam: raqamning yangi egasi bor",
    "ru": "Другой человек: у номера новый владелец",
    "en": "A different person: the number has a new owner"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses to give the phone number to this parent as its new owner; the other record keeps its name without the number."
  },
  {
   "id": "features/people/parent-panel.tsx#button:people.relatives.show",
   "kind": "button",
   "label": {
    "uz": "Ish joyi va pochtani koʻrsatish",
    "ru": "Показать место работы и почту",
    "en": "Show workplace and email"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "RelativesController_show"
   ],
   "opens": null,
   "description": "Shows the parent's workplace and email, which are hidden until asked for; the showing is logged."
  },
  {
   "id": "features/people/parent-panel.tsx#field:people.relatives.mergeName",
   "kind": "field",
   "label": {
    "uz": "Qoladigan ism",
    "ru": "Остающееся имя",
    "en": "Name that stays"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses which of the two names the merged record keeps."
  },
  {
   "id": "features/people/parent-panel.tsx#field:people.relatives.mergePhone",
   "kind": "field",
   "label": {
    "uz": "Qoladigan telefon",
    "ru": "Остающийся телефон",
    "en": "Phone that stays"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses which of the two phones the merged record keeps."
  },
  {
   "id": "features/people/parent-panel.tsx#field:people.relatives.previousPhone",
   "kind": "field",
   "label": {
    "uz": "…ning yangi telefoni",
    "ru": "Новый телефон: …",
    "en": "New phone of …"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The new phone of the relative who held this number before."
  },
  {
   "id": "features/people/parent-panel.tsx#field:people.relatives.previousUnknown",
   "kind": "field",
   "label": {
    "uz": "…ning yangi telefoni nomaʼlum: amaldagi telefon yoʻq",
    "ru": "Новый телефон (…) неизвестен: нет действующего телефона",
    "en": "The new phone of … is unknown: no valid phone"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": "features/people/parent-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked when the earlier holder's new phone is not known; that relative is then marked as having no valid phone."
  },
  {
   "id": "features/people/parent-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of a parent: their data, phones and all linked students; a change of name or phone here applies for every linked student."
  },
  {
   "id": "features/people/parent-slip.tsx#button:people.parentSlips.back",
   "kind": "button",
   "label": {
    "uz": "Roʻyxatga qaytish",
    "ru": "Назад к списку",
    "en": "Back to the list"
   },
   "pages": [
    "/people/classes/$classId/parent-slips",
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Leaves the slips and goes back to the list of the class's parents; the passwords are not shown again."
  },
  {
   "id": "features/people/parent-slip.tsx#button:people.parentSlips.print",
   "kind": "button",
   "label": {
    "uz": "Chop etish",
    "ru": "Печать",
    "en": "Print"
   },
   "pages": [
    "/people/classes/$classId/parent-slips",
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Prints the sheet of parent slips, four to a page."
  },
  {
   "id": "features/people/parent-slip.tsx#button:problems.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Попробовать ещё раз",
    "en": "Try again"
   },
   "pages": [
    "/people/classes/$classId/parent-slips",
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Reads the branch details for the slips again after they failed to load."
  },
  {
   "id": "features/people/parent-slips-page.tsx#button:people.parentSlips.back",
   "kind": "button",
   "label": {
    "uz": "Roʻyxatga qaytish",
    "ru": "Назад к списку",
    "en": "Back to the list"
   },
   "pages": [
    "/people/classes/$classId/parent-slips"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Goes back to the list of parents when there was nothing to print."
  },
  {
   "id": "features/people/parent-slips-page.tsx#button:people.parentSlips.printSlips",
   "kind": "button",
   "label": {
    "uz": "Varaqalarni chop etish",
    "ru": "Напечатать бланки",
    "en": "Print the slips"
   },
   "pages": [
    "/people/classes/$classId/parent-slips"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "ParentAccountsController_print"
   ],
   "opens": null,
   "description": "Makes new passwords for the parents still to print and shows their slips, in the chosen language, ready to print."
  },
  {
   "id": "features/people/parent-slips-page.tsx#column:people.parentSlips.children",
   "kind": "column",
   "label": {
    "uz": "Farzandlari",
    "ru": "Дети",
    "en": "Children"
   },
   "pages": [
    "/people/classes/$classId/parent-slips"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent's children in the class."
  },
  {
   "id": "features/people/parent-slips-page.tsx#column:people.parentSlips.login",
   "kind": "column",
   "label": {
    "uz": "Login",
    "ru": "Логин",
    "en": "Login"
   },
   "pages": [
    "/people/classes/$classId/parent-slips"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The login of the parent's account, once one exists."
  },
  {
   "id": "features/people/parent-slips-page.tsx#column:people.parentSlips.relative",
   "kind": "column",
   "label": {
    "uz": "Ota-ona",
    "ru": "Родитель",
    "en": "Parent"
   },
   "pages": [
    "/people/classes/$classId/parent-slips"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent with portal access."
  },
  {
   "id": "features/people/parent-slips-page.tsx#column:people.parentSlips.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/people/classes/$classId/parent-slips"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the parent's slip is still to print, has been printed (where and when), or the parent has signed in."
  },
  {
   "id": "features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.children",
   "kind": "column",
   "label": {
    "uz": "Farzandlari",
    "ru": "Дети",
    "en": "Children"
   },
   "pages": [
    "/people/parent-accounts"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent's children."
  },
  {
   "id": "features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.expired",
   "kind": "column",
   "label": {
    "uz": "Muddati oʻtgan",
    "ru": "Истёк",
    "en": "Expired"
   },
   "pages": [
    "/people/parent-accounts"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the slip's password has run out."
  },
  {
   "id": "features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.login",
   "kind": "column",
   "label": {
    "uz": "Login",
    "ru": "Логин",
    "en": "Login"
   },
   "pages": [
    "/people/parent-accounts"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The login of the parent's account."
  },
  {
   "id": "features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.name",
   "kind": "column",
   "label": {
    "uz": "Ota-ona",
    "ru": "Родитель",
    "en": "Parent"
   },
   "pages": [
    "/people/parent-accounts"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent whose account has never been signed in to."
  },
  {
   "id": "features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.printedAt",
   "kind": "column",
   "label": {
    "uz": "Varaqa chop etilgan",
    "ru": "Бланк напечатан",
    "en": "Slip printed"
   },
   "pages": [
    "/people/parent-accounts"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When the parent's last slip was printed."
  },
  {
   "id": "features/people/parents-never-used-page.tsx#column:people.parentsNeverUsed.validUntil",
   "kind": "column",
   "label": {
    "uz": "Amal qiladi",
    "ru": "Действует до",
    "en": "Valid until"
   },
   "pages": [
    "/people/parent-accounts"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Until when the slip's password is valid."
  },
  {
   "id": "features/people/parents-page.tsx#column:people.relatives.elsewhere",
   "kind": "column",
   "label": {
    "uz": "Boshqa filiallar",
    "ru": "Другие филиалы",
    "en": "Other branches"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "How many students of other branches the parent is linked to."
  },
  {
   "id": "features/people/parents-page.tsx#column:people.relatives.listName",
   "kind": "column",
   "label": {
    "uz": "Familiya va ism",
    "ru": "Фамилия и имя",
    "en": "Surname and name"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent's surname and name."
  },
  {
   "id": "features/people/parents-page.tsx#column:people.relatives.phone",
   "kind": "column",
   "label": {
    "uz": "Asosiy telefon",
    "ru": "Основной телефон",
    "en": "Main phone"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent's main phone."
  },
  {
   "id": "features/people/parents-page.tsx#column:people.relatives.students",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/people/parents"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The students of this branch the parent is linked to."
  },
  {
   "id": "features/people/people-page.tsx#tab:people.headTeachersLink",
   "kind": "tab",
   "label": {
    "uz": "Fan rahbarlari",
    "ru": "Руководители предметов",
    "en": "Head Teachers"
   },
   "pages": [
    "/people"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": "/people/head-teachers",
   "description": "Opens the Head Teachers list of People (/people/head-teachers)."
  },
  {
   "id": "features/people/people-page.tsx#tab:people.neverUsedLink",
   "kind": "tab",
   "label": {
    "uz": "Ishlatilmagan hisoblar",
    "ru": "Неиспользованные учётные записи",
    "en": "Accounts never used"
   },
   "pages": [
    "/people"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": "/people/never-used",
   "description": "Opens the Accounts never used list of People (/people/never-used)."
  },
  {
   "id": "features/people/people-page.tsx#tab:people.parentsLink",
   "kind": "tab",
   "label": {
    "uz": "Ota-onalar",
    "ru": "Родители",
    "en": "Parents"
   },
   "pages": [
    "/people"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": "/people/parents",
   "description": "Opens the Parents list of People (/people/parents)."
  },
  {
   "id": "features/people/people-page.tsx#tab:people.staffLink",
   "kind": "tab",
   "label": {
    "uz": "Xodimlar",
    "ru": "Сотрудники",
    "en": "Staff"
   },
   "pages": [
    "/people"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": "/people/staff",
   "description": "Opens the Staff list of People (/people/staff)."
  },
  {
   "id": "features/people/people-page.tsx#tab:people.studentsLink",
   "kind": "tab",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/people"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": "/people/students",
   "description": "Opens the Students list of People (/people/students)."
  },
  {
   "id": "features/people/people-page.tsx#tab:people.vacanciesLink",
   "kind": "tab",
   "label": {
    "uz": "Vakansiyalar",
    "ru": "Вакансии",
    "en": "Vacancies"
   },
   "pages": [
    "/people"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": "/people/vacancies",
   "description": "Opens the Vacancies list of People (/people/vacancies)."
  },
  {
   "id": "features/people/people-tabs.tsx#tab:people.headTeachers.title",
   "kind": "tab",
   "label": {
    "uz": "Fan rahbarlari",
    "ru": "Руководители предметов",
    "en": "Head Teachers"
   },
   "pages": [
    "/people/head-teachers",
    "/people/never-used",
    "/people/parents",
    "/people/reset-entries",
    "/people/staff",
    "/people/students",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": "/people/head-teachers",
   "description": "The Head Teachers tab of People: switches to that list (/people/head-teachers), with its own search, filters and open record."
  },
  {
   "id": "features/people/people-tabs.tsx#tab:people.neverUsed.title",
   "kind": "tab",
   "label": {
    "uz": "Ishlatilmagan hisoblar",
    "ru": "Неиспользованные учётные записи",
    "en": "Accounts never used"
   },
   "pages": [
    "/people/head-teachers",
    "/people/never-used",
    "/people/parents",
    "/people/reset-entries",
    "/people/staff",
    "/people/students",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": "/people/never-used",
   "description": "The Accounts never used tab of People: switches to that list (/people/never-used), with its own search, filters and open record."
  },
  {
   "id": "features/people/people-tabs.tsx#tab:people.relatives.title",
   "kind": "tab",
   "label": {
    "uz": "Ota-onalar",
    "ru": "Родители",
    "en": "Parents"
   },
   "pages": [
    "/people/head-teachers",
    "/people/never-used",
    "/people/parents",
    "/people/reset-entries",
    "/people/staff",
    "/people/students",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": "/people/parents",
   "description": "The Parents tab of People: switches to that list (/people/parents), with its own search, filters and open record."
  },
  {
   "id": "features/people/people-tabs.tsx#tab:people.resetEntries.title",
   "kind": "tab",
   "label": {
    "uz": "Tiklashdan keyingi yozuvlar",
    "ru": "Записи после сброса",
    "en": "Entries after a reset"
   },
   "pages": [
    "/people/head-teachers",
    "/people/never-used",
    "/people/parents",
    "/people/reset-entries",
    "/people/staff",
    "/people/students",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": "/people/reset-entries",
   "description": "The Entries after a reset tab of People: switches to that list (/people/reset-entries), with its own search, filters and open record."
  },
  {
   "id": "features/people/people-tabs.tsx#tab:people.staff.title",
   "kind": "tab",
   "label": {
    "uz": "Xodimlar",
    "ru": "Сотрудники",
    "en": "Staff"
   },
   "pages": [
    "/people/head-teachers",
    "/people/never-used",
    "/people/parents",
    "/people/reset-entries",
    "/people/staff",
    "/people/students",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": "/people/staff",
   "description": "The Staff tab of People: switches to that list (/people/staff), with its own search, filters and open record."
  },
  {
   "id": "features/people/people-tabs.tsx#tab:people.students.title",
   "kind": "tab",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Ученики",
    "en": "Students"
   },
   "pages": [
    "/people/head-teachers",
    "/people/never-used",
    "/people/parents",
    "/people/reset-entries",
    "/people/staff",
    "/people/students",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": "/people/students",
   "description": "The Students tab of People: switches to that list (/people/students), with its own search, filters and open record."
  },
  {
   "id": "features/people/people-tabs.tsx#tab:people.vacancies.title",
   "kind": "tab",
   "label": {
    "uz": "Vakansiyalar",
    "ru": "Вакансии",
    "en": "Vacancies"
   },
   "pages": [
    "/people/head-teachers",
    "/people/never-used",
    "/people/parents",
    "/people/reset-entries",
    "/people/staff",
    "/people/students",
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": "/people/vacancies",
   "description": "The Vacancies tab of People: switches to that list (/people/vacancies), with its own search, filters and open record."
  },
  {
   "id": "features/people/personal-data-report-page.tsx#button:people.report.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/people/report/$kind/$id"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the report and goes back to the list it was opened from."
  },
  {
   "id": "features/people/personal-data-report-page.tsx#button:people.report.print",
   "kind": "button",
   "label": {
    "uz": "Chop etish",
    "ru": "Печать",
    "en": "Print"
   },
   "pages": [
    "/people/report/$kind/$id"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Prints the personal data report."
  },
  {
   "id": "features/people/relative-form.tsx#button:people.relatives.addExtraPhone",
   "kind": "button",
   "label": {
    "uz": "Qoʻshimcha telefon qoʻshish",
    "ru": "Добавить дополнительный телефон",
    "en": "Add an extra phone"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Adds a field for another extra phone."
  },
  {
   "id": "features/people/relative-form.tsx#button:people.relatives.removeExtraPhone",
   "kind": "button",
   "label": {
    "uz": "…-qoʻshimcha telefonni olib tashlash",
    "ru": "Удалить дополнительный телефон …",
    "en": "Remove extra phone …"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Removes this extra phone from the form."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.email",
   "kind": "field",
   "label": {
    "uz": "Elektron pochta",
    "ru": "Электронная почта",
    "en": "Email"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The relative's email address."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.extraPhone",
   "kind": "field",
   "label": {
    "uz": "…-qoʻshimcha telefon",
    "ru": "Дополнительный телефон …",
    "en": "Extra phone …"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "An extra phone of the relative, besides the main phone."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.fullNameField",
   "kind": "field",
   "label": {
    "uz": "Familiya, ism, otasining ismi",
    "ru": "Фамилия, имя, отчество",
    "en": "Surname, name, patronymic"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The relative's surname, name and patronymic."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.noPhone",
   "kind": "field",
   "label": {
    "uz": "Oʻz telefoni yoʻq",
    "ru": "Нет своего телефона",
    "en": "No phone of their own"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked when the relative has no phone of their own; notices then cannot reach them."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.ownerChoice",
   "kind": "field",
   "label": {
    "uz": "… kim?",
    "ru": "Кто такой(-ая) …?",
    "en": "Who is …?"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Says whether the typed phone's current holder is the same person, to link them, or a different person, so the number has a new owner."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.phone",
   "kind": "field",
   "label": {
    "uz": "Asosiy telefon",
    "ru": "Основной телефон",
    "en": "Main phone"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The relative's main phone, used for notices and to find the same person among other students' relatives."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.previousPhone",
   "kind": "field",
   "label": {
    "uz": "…ning yangi telefoni",
    "ru": "Новый телефон: …",
    "en": "New phone of …"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The new phone of the relative who held this number before."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.previousUnknown",
   "kind": "field",
   "label": {
    "uz": "…ning yangi telefoni nomaʼlum: amaldagi telefon yoʻq",
    "ru": "Новый телефон (…) неизвестен: нет действующего телефона",
    "en": "The new phone of … is unknown: no valid phone"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked when the earlier holder's new phone is not known; that relative is then marked as having no valid phone."
  },
  {
   "id": "features/people/relative-form.tsx#field:people.relatives.workplace",
   "kind": "field",
   "label": {
    "uz": "Ish joyi",
    "ru": "Место работы",
    "en": "Workplace"
   },
   "pages": [
    "/people/parents",
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Where the relative works."
  },
  {
   "id": "features/people/reset-entries-page.tsx#field:people.resetEntries.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/people/reset-entries"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day of the period whose password resets are listed."
  },
  {
   "id": "features/people/reset-entries-page.tsx#field:people.resetEntries.to",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "По",
    "en": "To"
   },
   "pages": [
    "/people/reset-entries"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The last day of the period whose password resets are listed."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.academicDepartment",
   "kind": "field",
   "label": {
    "uz": "Oʻquv boʻlimidagi kafedra",
    "ru": "Кафедра в учебном отделе",
    "en": "Department in Academic"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The department in the Academic division; subjects can be given only with one."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.admissionDate",
   "kind": "field",
   "label": {
    "uz": "Ishga qabul sanasi",
    "ru": "Дата приёма",
    "en": "Admission date"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The day the staff member joined the school."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.birthDate",
   "kind": "field",
   "label": {
    "uz": "Tugʻilgan sana",
    "ru": "Дата рождения",
    "en": "Date of birth"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's date of birth."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.contractDate",
   "kind": "field",
   "label": {
    "uz": "Shartnoma sanasi",
    "ru": "Дата договора",
    "en": "Contract date"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The date of the employment contract."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.contractType",
   "kind": "field",
   "label": {
    "uz": "Shartnoma",
    "ru": "Договор",
    "en": "Contract"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the contract is full time or part time."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.dailyLessons",
   "kind": "field",
   "label": {
    "uz": "Kuniga eng koʻp darslar",
    "ru": "Наибольшее число уроков в день",
    "en": "Most lessons per day"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The most lessons the person may teach in one day; the timetable keeps to it."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.department",
   "kind": "field",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The department within the main division."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.departmentStartsOn",
   "kind": "field",
   "label": {
    "uz": "Kafedraga oʻtish sanasi",
    "ru": "Переход на кафедру с",
    "en": "Moves to the department on"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The day the person moves to the newly chosen department."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.educationLevel",
   "kind": "field",
   "label": {
    "uz": "Maʼlumoti",
    "ru": "Образование",
    "en": "Education"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The highest education of the staff member."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.email",
   "kind": "field",
   "label": {
    "uz": "Elektron pochta",
    "ru": "Эл. почта",
    "en": "Email"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's email; a link to choose a new password can be sent to it."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.fatherName",
   "kind": "field",
   "label": {
    "uz": "Otasining ismi",
    "ru": "Отчество",
    "en": "Father's name"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's father's name."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.firstName",
   "kind": "field",
   "label": {
    "uz": "Ism",
    "ru": "Имя",
    "en": "First name"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's first name."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.furtherDivisions",
   "kind": "field",
   "label": {
    "uz": "Qoʻshimcha boʻlimlar",
    "ru": "Другие отделы",
    "en": "Further divisions"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Other divisions the person also works in."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.jshshir",
   "kind": "field",
   "label": {
    "uz": "JSHSHIR",
    "ru": "ПИНФЛ",
    "en": "JSHSHIR"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's JSHSHIR, the personal identification number."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.lastName",
   "kind": "field",
   "label": {
    "uz": "Familiya",
    "ru": "Фамилия",
    "en": "Surname"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's surname."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.mainDivision",
   "kind": "field",
   "label": {
    "uz": "Asosiy boʻlim",
    "ru": "Основной отдел",
    "en": "Main division"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The division the person mainly works in."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.phone",
   "kind": "field",
   "label": {
    "uz": "Telefon",
    "ru": "Телефон",
    "en": "Phone"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's phone; it must not belong to another staff record and marks the same person when it is a parent's main phone."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.sex",
   "kind": "field",
   "label": {
    "uz": "Jinsi",
    "ru": "Пол",
    "en": "Sex"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's sex."
  },
  {
   "id": "features/people/staff-form.tsx#field:people.staff.weeklyLessons",
   "kind": "field",
   "label": {
    "uz": "Shartnoma boʻyicha haftalik darslar",
    "ru": "Уроков в неделю по договору",
    "en": "Lessons per week by contract"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "How many lessons a week the contract provides for; the timetable uses it for the teaching load."
  },
  {
   "id": "features/people/staff-import-page.tsx#button:people.import.reading",
   "kind": "button",
   "label": {
    "uz": "Fayl oʻqilmoqda…",
    "ru": "Читаем файл…",
    "en": "Reading the file…"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Uploads the filled Excel file and shows its rows with their problems; it says Reading the file while the file is read."
  },
  {
   "id": "features/people/staff-import-page.tsx#button:people.import.template",
   "kind": "button",
   "label": {
    "uz": "Shablonni yuklab olish",
    "ru": "Скачать шаблон",
    "en": "Download the template"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "StaffController_importTemplate"
   ],
   "opens": null,
   "description": "Downloads the Excel template to fill in."
  },
  {
   "id": "features/people/staff-import-page.tsx#button:people.staffImport.confirm",
   "kind": "button",
   "label": {
    "uz": "Barcha … kishini saqlash",
    "ru": "Сохранить всех … человека",
    "en": "Save all … people"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "StaffController_importConfirm"
   ],
   "opens": null,
   "description": "Saves every row of the file as staff records; it is on only when every row is clean and every question is decided."
  },
  {
   "id": "features/people/staff-import-page.tsx#button:people.staffImport.print",
   "kind": "button",
   "label": {
    "uz": "Varaqalarni chop etish",
    "ru": "Распечатать листки",
    "en": "Print the slips"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Prints the first-password slips of the people just imported; the passwords are shown only on this page."
  },
  {
   "id": "features/people/staff-import-page.tsx#column:people.account.login",
   "kind": "column",
   "label": {
    "uz": "Login",
    "ru": "Логин",
    "en": "Login"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The login made for the person."
  },
  {
   "id": "features/people/staff-import-page.tsx#column:people.import.decisions",
   "kind": "column",
   "label": {
    "uz": "Hal qilish",
    "ru": "Решить",
    "en": "To decide"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Possible duplicates to tick when the row is really another person."
  },
  {
   "id": "features/people/staff-import-page.tsx#column:people.import.name",
   "kind": "column",
   "label": {
    "uz": "Familiya va ism",
    "ru": "Фамилия и имя",
    "en": "Surname and name"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The surname and name on the row."
  },
  {
   "id": "features/people/staff-import-page.tsx#column:people.import.problemsColumn",
   "kind": "column",
   "label": {
    "uz": "Xatolar",
    "ru": "Ошибки",
    "en": "Problems"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "What is wrong on the row and must be corrected, or Ready."
  },
  {
   "id": "features/people/staff-import-page.tsx#column:people.import.row",
   "kind": "column",
   "label": {
    "uz": "Qator",
    "ru": "Строка",
    "en": "Row"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The row number in the uploaded file."
  },
  {
   "id": "features/people/staff-import-page.tsx#column:people.staffImport.role",
   "kind": "column",
   "label": {
    "uz": "Rol",
    "ru": "Роль",
    "en": "Role"
   },
   "pages": [
    "/people/staff/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The role the row gives the person: Teacher, Tutor or none."
  },
  {
   "id": "features/people/staff-page.tsx#button:people.staff.add",
   "kind": "button",
   "label": {
    "uz": "Xodim qoʻshish",
    "ru": "Добавить сотрудника",
    "en": "Add person"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new staff member in the side panel."
  },
  {
   "id": "features/people/staff-page.tsx#button:people.staff.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new staff member form without saving."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.branches",
   "kind": "column",
   "label": {
    "uz": "Filiallar",
    "ru": "Филиалы",
    "en": "Branches"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The branches the person works in."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.categories",
   "kind": "column",
   "label": {
    "uz": "Toifa",
    "ru": "Категория",
    "en": "Category"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff categories of the person, such as Teacher or Tutor."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.department",
   "kind": "column",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The person's department."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.grades",
   "kind": "column",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Grades"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The grades the person teaches."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.languagesTitle",
   "kind": "column",
   "label": {
    "uz": "Taʼlim tillari",
    "ru": "Языки обучения",
    "en": "Languages of instruction"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The languages the person teaches in."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.name",
   "kind": "column",
   "label": {
    "uz": "Familiya va ism",
    "ru": "Фамилия и имя",
    "en": "Surname and name"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's surname and name."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.phone",
   "kind": "column",
   "label": {
    "uz": "Telefon",
    "ru": "Телефон",
    "en": "Phone"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The person's phone."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.photo.column",
   "kind": "column",
   "label": {
    "uz": "Surat",
    "ru": "Фото",
    "en": "Photo"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member's photo, or initials when there is none."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.staffId",
   "kind": "column",
   "label": {
    "uz": "Xodim raqami",
    "ru": "Табельный номер",
    "en": "Staff ID"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff ID of the person."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.statusColumn",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the person is active, inactive, has left or has not started yet."
  },
  {
   "id": "features/people/staff-page.tsx#column:people.staff.subjects",
   "kind": "column",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The subjects the person teaches."
  },
  {
   "id": "features/people/staff-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the staff member's record form for editing."
  },
  {
   "id": "features/people/staff-panel.tsx#button:people.staff.changeBranches",
   "kind": "button",
   "label": {
    "uz": "Filiallarni oʻzgartirish",
    "ru": "Изменить филиалы",
    "en": "Change branches"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change the person's main branch and further branches."
  },
  {
   "id": "features/people/staff-panel.tsx#button:people.staff.changeStatus",
   "kind": "button",
   "label": {
    "uz": "Holatni oʻzgartirish",
    "ru": "Изменить статус",
    "en": "Change status"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to set a new status (active, inactive or left) from a date; a change to Left ends every role of the account."
  },
  {
   "id": "features/people/staff-panel.tsx#button:people.staff.changeTeaching",
   "kind": "button",
   "label": {
    "uz": "Fanlar va tillarni oʻzgartirish",
    "ru": "Изменить предметы и языки",
    "en": "Change subjects and languages"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change the subjects the person teaches, their grades and the languages of instruction."
  },
  {
   "id": "features/people/staff-panel.tsx#button:people.staff.photo.add",
   "kind": "button",
   "label": {
    "uz": "Surat qoʻshish",
    "ru": "Добавить фотографию",
    "en": "Add photo"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a file choice to add a photo to the record; the photo is shrunk before it is sent."
  },
  {
   "id": "features/people/staff-panel.tsx#button:people.staff.photo.remove",
   "kind": "button",
   "label": {
    "uz": "Suratni olib tashlash",
    "ru": "Удалить фотографию",
    "en": "Remove photo"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "StaffPhotosController_removePhoto"
   ],
   "opens": null,
   "description": "Removes the photo after a confirmation; initials are shown instead."
  },
  {
   "id": "features/people/staff-panel.tsx#button:people.staff.showIdentity",
   "kind": "button",
   "label": {
    "uz": "Tugʻilgan sana va JSHSHIRni koʻrsatish",
    "ru": "Показать дату рождения и ПИНФЛ",
    "en": "Show date of birth and JSHSHIR"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "StaffController_identity"
   ],
   "opens": null,
   "description": "Shows the hidden date of birth and JSHSHIR of the person; the showing is logged."
  },
  {
   "id": "features/people/staff-panel.tsx#field:people.staff.from",
   "kind": "field",
   "label": {
    "uz": "Boshlanish",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The day the new status starts; a change planned after today replaces an earlier planned one."
  },
  {
   "id": "features/people/staff-panel.tsx#field:people.staff.furtherBranches",
   "kind": "field",
   "label": {
    "uz": "Qoʻshimcha filiallar",
    "ru": "Другие филиалы",
    "en": "Further branches"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Other branches the person also works in."
  },
  {
   "id": "features/people/staff-panel.tsx#field:people.staff.gradesOf",
   "kind": "field",
   "label": {
    "uz": "…: sinflar",
    "ru": "Классы: …",
    "en": "Grades of …"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The grades in which the person teaches this subject."
  },
  {
   "id": "features/people/staff-panel.tsx#field:people.staff.languagesTitle",
   "kind": "field",
   "label": {
    "uz": "Taʼlim tillari",
    "ru": "Языки обучения",
    "en": "Languages of instruction"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The languages the person teaches in."
  },
  {
   "id": "features/people/staff-panel.tsx#field:people.staff.mainBranchField",
   "kind": "field",
   "label": {
    "uz": "Asosiy filial",
    "ru": "Основной филиал",
    "en": "Main branch"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The branch the person mainly works in."
  },
  {
   "id": "features/people/staff-panel.tsx#field:people.staff.newStatus",
   "kind": "field",
   "label": {
    "uz": "Yangi holat",
    "ru": "Новый статус",
    "en": "New status"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The status the person takes: active, inactive or left."
  },
  {
   "id": "features/people/staff-panel.tsx#field:people.staff.subjects",
   "kind": "field",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/people/staff"
   ],
   "parent": "features/people/staff-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The subjects the person teaches, from the subjects of their department."
  },
  {
   "id": "features/people/staff-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/people/staff"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of a staff member: the record, photo, subjects and languages, branches, status, availability, account and roles, and sign-in access."
  },
  {
   "id": "features/people/student-form.tsx#button:people.students.restoreThis",
   "kind": "button",
   "label": {
    "uz": "Bu oʻquvchini tiklash",
    "ru": "Восстановить этого ученика",
    "en": "Restore this student"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the inactive or graduated student who already holds this JSHSHIR or document number, so that record can be restored instead."
  },
  {
   "id": "features/people/student-form.tsx#button:problems.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Попробовать ещё раз",
    "en": "Try again"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Reads the free seats of the classes again after they failed to load."
  },
  {
   "id": "features/people/student-form.tsx#field:people.relatives.email",
   "kind": "field",
   "label": {
    "uz": "Elektron pochta",
    "ru": "Электронная почта",
    "en": "Email"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The first relative's email address."
  },
  {
   "id": "features/people/student-form.tsx#field:people.relatives.fullNameField",
   "kind": "field",
   "label": {
    "uz": "Familiya, ism, otasining ismi",
    "ru": "Фамилия, имя, отчество",
    "en": "Surname, name, patronymic"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The first relative's surname, name and patronymic."
  },
  {
   "id": "features/people/student-form.tsx#field:people.relatives.noPhone",
   "kind": "field",
   "label": {
    "uz": "Oʻz telefoni yoʻq",
    "ru": "Нет своего телефона",
    "en": "No phone of their own"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked when the first relative has no phone of their own; notices then cannot reach them."
  },
  {
   "id": "features/people/student-form.tsx#field:people.relatives.phone",
   "kind": "field",
   "label": {
    "uz": "Asosiy telefon",
    "ru": "Основной телефон",
    "en": "Main phone"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The first relative's main phone; a phone already known links that person."
  },
  {
   "id": "features/people/student-form.tsx#field:people.relatives.portalAccess",
   "kind": "field",
   "label": {
    "uz": "Portalga kirish",
    "ru": "Доступ к порталу",
    "en": "Portal access"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked to give the relative a parent account for the portal; it is made when the class's slips are printed."
  },
  {
   "id": "features/people/student-form.tsx#field:people.relatives.relationship",
   "kind": "field",
   "label": {
    "uz": "Qarindoshlik",
    "ru": "Родство",
    "en": "Relationship"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "How the first relative is related to the student, such as Father or Mother."
  },
  {
   "id": "features/people/student-form.tsx#field:people.relatives.workplace",
   "kind": "field",
   "label": {
    "uz": "Ish joyi",
    "ru": "Место работы",
    "en": "Workplace"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Where the first relative works."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.address",
   "kind": "field",
   "label": {
    "uz": "Manzil",
    "ru": "Адрес",
    "en": "Address"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's home address."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.birthDate",
   "kind": "field",
   "label": {
    "uz": "Tugʻilgan sana",
    "ru": "Дата рождения",
    "en": "Date of birth"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's date of birth."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The class the student joins; a student who starts today or earlier needs one."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.consentSignedOn",
   "kind": "field",
   "label": {
    "uz": "Rozilik imzolangan sana",
    "ru": "Согласие подписано",
    "en": "Consent signed on"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The day the consent to the use of personal data was signed."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.contractNumber",
   "kind": "field",
   "label": {
    "uz": "Shartnoma raqami",
    "ru": "Номер договора",
    "en": "Contract number"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The number of the student's contract."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.contractSignedOn",
   "kind": "field",
   "label": {
    "uz": "Shartnoma sanasi",
    "ru": "Дата договора",
    "en": "Contract date"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The date the contract was signed."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.diagnosticScore",
   "kind": "field",
   "label": {
    "uz": "Diagnostik test bali",
    "ru": "Балл диагностического теста",
    "en": "Diagnostic test score"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's score in the diagnostic entry test."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.documentNumber",
   "kind": "field",
   "label": {
    "uz": "Hujjat raqami",
    "ru": "Номер документа",
    "en": "Document number"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The number of the identity document; it must not be held by another student."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.documentType",
   "kind": "field",
   "label": {
    "uz": "Hujjat",
    "ru": "Документ",
    "en": "Document"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The kind of identity document: passport, ID card or birth certificate."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.email",
   "kind": "field",
   "label": {
    "uz": "Elektron pochta",
    "ru": "Электронная почта",
    "en": "Email"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's email address."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.firstName",
   "kind": "field",
   "label": {
    "uz": "Ism",
    "ru": "Имя",
    "en": "First name"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's first name."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.grade",
   "kind": "field",
   "label": {
    "uz": "Sinf darajasi",
    "ru": "Параллель",
    "en": "Grade"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The grade the student is in."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.jshshir",
   "kind": "field",
   "label": {
    "uz": "JSHSHIR",
    "ru": "ПИНФЛ",
    "en": "JSHSHIR"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's JSHSHIR, the personal identification number; it must not be held by another student."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.lastName",
   "kind": "field",
   "label": {
    "uz": "Familiya",
    "ru": "Фамилия",
    "en": "Surname"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's surname."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.paternalName",
   "kind": "field",
   "label": {
    "uz": "Otasining ismi",
    "ru": "Отчество",
    "en": "Paternal name"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's paternal name."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.phone",
   "kind": "field",
   "label": {
    "uz": "Telefon",
    "ru": "Телефон",
    "en": "Phone"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's own phone."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.previousSchool",
   "kind": "field",
   "label": {
    "uz": "Avvalgi maktab",
    "ru": "Предыдущая школа",
    "en": "Previous school"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The school the student came from."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.region",
   "kind": "field",
   "label": {
    "uz": "Hudud",
    "ru": "Регион",
    "en": "Region"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The region the student lives in."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.scholarshipAmount",
   "kind": "field",
   "label": {
    "uz": "Miqdori, soʻm",
    "ru": "Сумма в сумах",
    "en": "Amount in soʻm"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The scholarship amount in soum."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.scholarshipCoverage",
   "kind": "field",
   "label": {
    "uz": "Qamrov",
    "ru": "Покрытие",
    "en": "Coverage"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the scholarship covers the fee in full or in part."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.scholarshipType",
   "kind": "field",
   "label": {
    "uz": "Grant",
    "ru": "Стипендия",
    "en": "Scholarship"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The kind of scholarship, or not a scholarship student."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.sex",
   "kind": "field",
   "label": {
    "uz": "Jinsi",
    "ru": "Пол",
    "en": "Sex"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's sex."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.startsOn",
   "kind": "field",
   "label": {
    "uz": "Boshlanish sanasi",
    "ru": "Дата начала",
    "en": "Start date"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's first day at school."
  },
  {
   "id": "features/people/student-form.tsx#field:people.students.uid",
   "kind": "field",
   "label": {
    "uz": "UID",
    "ru": "UID",
    "en": "UID"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's UID: letters, digits or both, up to 20 characters; a UID is never given twice."
  },
  {
   "id": "features/people/student-import-page.tsx#button:people.import.confirm",
   "kind": "button",
   "label": {
    "uz": "Barcha … ta oʻquvchini saqlash",
    "ru": "Сохранить всех … учеников",
    "en": "Save all … students"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "StudentsController_importConfirm"
   ],
   "opens": null,
   "description": "Saves every row of the file as students; it is on only when every row is clean and every question is decided."
  },
  {
   "id": "features/people/student-import-page.tsx#button:people.import.reading",
   "kind": "button",
   "label": {
    "uz": "Fayl oʻqilmoqda…",
    "ru": "Читаем файл…",
    "en": "Reading the file…"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Uploads the filled Excel file and shows its rows with their problems; it says Reading the file while the file is read."
  },
  {
   "id": "features/people/student-import-page.tsx#button:people.import.template",
   "kind": "button",
   "label": {
    "uz": "Shablonni yuklab olish",
    "ru": "Скачать шаблон",
    "en": "Download the template"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "StudentsController_importTemplate"
   ],
   "opens": null,
   "description": "Downloads the Excel template to fill in."
  },
  {
   "id": "features/people/student-import-page.tsx#column:people.import.decisions",
   "kind": "column",
   "label": {
    "uz": "Hal qilish",
    "ru": "Решить",
    "en": "To decide"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Questions to decide on the row: possible duplicates to tick, or a relative to link to the person who has the phone."
  },
  {
   "id": "features/people/student-import-page.tsx#column:people.import.name",
   "kind": "column",
   "label": {
    "uz": "Familiya va ism",
    "ru": "Фамилия и имя",
    "en": "Surname and name"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The surname and name on the row."
  },
  {
   "id": "features/people/student-import-page.tsx#column:people.import.problemsColumn",
   "kind": "column",
   "label": {
    "uz": "Xatolar",
    "ru": "Ошибки",
    "en": "Problems"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "What is wrong on the row and must be corrected, or Ready."
  },
  {
   "id": "features/people/student-import-page.tsx#column:people.import.row",
   "kind": "column",
   "label": {
    "uz": "Qator",
    "ru": "Строка",
    "en": "Row"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The row number in the uploaded file."
  },
  {
   "id": "features/people/student-import-page.tsx#column:people.students.class",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The class on the row."
  },
  {
   "id": "features/people/student-import-page.tsx#column:people.students.uid",
   "kind": "column",
   "label": {
    "uz": "UID",
    "ru": "UID",
    "en": "UID"
   },
   "pages": [
    "/people/students/import"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The UID on the row."
  },
  {
   "id": "features/people/student-merge.tsx#button:people.students.merge.show",
   "kind": "button",
   "label": {
    "uz": "Birlashtirishni koʻrsatish",
    "ru": "Показать объединение",
    "en": "Show the merge"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows what merging the two records would do: which record stays, the rows that change and the values that differ."
  },
  {
   "id": "features/people/student-merge.tsx#field:people.students.merge.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the two records are merged; a merge cannot be undone."
  },
  {
   "id": "features/people/student-merge.tsx#field:people.students.merge.uid",
   "kind": "field",
   "label": {
    "uz": "Boshqa yozuvning UID raqami",
    "ru": "UID другой записи",
    "en": "UID of the other record"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The UID of the other record of the same student, to be merged with this one."
  },
  {
   "id": "features/people/student-moves.tsx#button:people.students.moves.undo",
   "kind": "button",
   "label": {
    "uz": "Koʻchirishni qaytarish",
    "ru": "Аннулировать перевод",
    "en": "Undo the move"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to undo this move, with a reason."
  },
  {
   "id": "features/people/student-moves.tsx#field:people.students.moves.from",
   "kind": "field",
   "label": {
    "uz": "U yerdagi birinchi kun",
    "ru": "Первый день там",
    "en": "First day there"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's first day in the new class."
  },
  {
   "id": "features/people/student-moves.tsx#field:people.students.moves.from:2",
   "kind": "field",
   "label": {
    "uz": "U yerdagi birinchi kun",
    "ru": "Первый день там",
    "en": "First day there"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's first day in the new group."
  },
  {
   "id": "features/people/student-moves.tsx#field:people.students.moves.groupRow",
   "kind": "field",
   "label": {
    "uz": "Guruh",
    "ru": "Группа",
    "en": "Group"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The group the student moves out of."
  },
  {
   "id": "features/people/student-moves.tsx#field:people.students.moves.toClass",
   "kind": "field",
   "label": {
    "uz": "Yangi sinf",
    "ru": "Новый класс",
    "en": "New class"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The class the student moves to."
  },
  {
   "id": "features/people/student-moves.tsx#field:people.students.moves.toGroup",
   "kind": "field",
   "label": {
    "uz": "Yangi guruh",
    "ru": "Новая группа",
    "en": "New group"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The group of the same subject the student moves to."
  },
  {
   "id": "features/people/student-moves.tsx#field:people.students.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the move is undone."
  },
  {
   "id": "features/people/student-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the student's record form to edit the name, the details and the documents."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.branchMoves.cancel",
   "kind": "button",
   "label": {
    "uz": "Yuborishni bekor qilish",
    "ru": "Отменить передачу",
    "en": "Cancel the release"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [
    "BranchMovesController_cancel",
    "StudentsController_detail"
   ],
   "opens": null,
   "description": "Cancels the release to another branch after a confirmation; the student stays in this branch."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.branchMoves.move",
   "kind": "button",
   "label": {
    "uz": "Boshqa filialga oʻtkazish",
    "ru": "Перевести в другой филиал",
    "en": "Move to another branch"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to release the student to another branch from a date; the receiving branch then accepts the student and places them in a class."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.cancelLeaving",
   "kind": "button",
   "label": {
    "uz": "Rejalashtirilgan ketishni bekor qilish",
    "ru": "Отменить запланированное выбытие",
    "en": "Cancel the leaving"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [
    "StudentsController_detail",
    "StudentStatusesController_cancelLeaving"
   ],
   "opens": null,
   "description": "Cancels the scheduled leaving after a confirmation; the student stays active."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.cancelReturn",
   "kind": "button",
   "label": {
    "uz": "Qaytishni bekor qilish",
    "ru": "Отменить возвращение",
    "en": "Cancel the return"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [
    "StudentsController_detail",
    "StudentStatusesController_cancelReturn"
   ],
   "opens": null,
   "description": "Cancels the scheduled return after a confirmation; the class booked for next year is released."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.deleteAction",
   "kind": "button",
   "label": {
    "uz": "Oʻchirish",
    "ru": "Удалить",
    "en": "Delete"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the delete of a student record that holds no data, after a confirmation."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.leaveTitle",
   "kind": "button",
   "label": {
    "uz": "Maktabdan ketish",
    "ru": "Выбытие из школы",
    "en": "Leave school"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for the student's leaving: the date and the reason; the student leaves the class and its journals from that date."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.merge.action",
   "kind": "button",
   "label": {
    "uz": "Boshqa yozuv bilan birlashtirish",
    "ru": "Объединить с другой записью",
    "en": "Merge with another record"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the merge of this student record with another record of the same student; one record stays and holds the data of both."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.moves.cancel",
   "kind": "button",
   "label": {
    "uz": "…ga koʻchirishni bekor qilish",
    "ru": "Отменить перевод в …",
    "en": "Cancel the move to …"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [
    "ClassTransfersController_cancel",
    "GroupTransfersController_cancel",
    "StudentsController_detail"
   ],
   "opens": null,
   "description": "Cancels the scheduled move to the named class or group after a confirmation; the student stays where they are."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.moves.change",
   "kind": "button",
   "label": {
    "uz": "…ga koʻchirishni oʻzgartirish",
    "ru": "Изменить перевод в …",
    "en": "Change the move to …"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to change a scheduled move of the student (its date or its class or group)."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.moves.moveClass",
   "kind": "button",
   "label": {
    "uz": "Boshqa sinfga koʻchirish",
    "ru": "Перевести в другой класс",
    "en": "Move to another class"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to move the student to another class of the branch from a date."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.moves.moveGroup",
   "kind": "button",
   "label": {
    "uz": "Boshqa guruhga koʻchirish",
    "ru": "Перевести в другую группу",
    "en": "Move to another group"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to move the student to another group of a subject from a date."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.restoreTitle",
   "kind": "button",
   "label": {
    "uz": "Faol holatga tiklash",
    "ru": "Восстановить как активного",
    "en": "Restore to active"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to restore an archived student record."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.returnTitle",
   "kind": "button",
   "label": {
    "uz": "Maktabga qaytish",
    "ru": "Возвращение в школу",
    "en": "Return to school"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a student who left to return: the date and the class of the return."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.showIdentity",
   "kind": "button",
   "label": {
    "uz": "Hujjatlar va tugʻilgan sanani koʻrsatish",
    "ru": "Показать документы и дату рождения",
    "en": "Show documents and date of birth"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [
    "StudentsController_identity"
   ],
   "opens": null,
   "description": "Shows the student's hidden documents and date of birth; the showing is logged."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.uidTitle",
   "kind": "button",
   "label": {
    "uz": "UIDni tuzatish",
    "ru": "Исправить UID",
    "en": "Correct the UID"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to change the student's UID, the school's identifier of the student."
  },
  {
   "id": "features/people/student-panel.tsx#button:people.students.undoTitle",
   "kind": "button",
   "label": {
    "uz": "Ketishni bekor qilish",
    "ru": "Отменить выбытие",
    "en": "Undo leaving"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to undo the student's leaving, with a reason; the student is active again in the same class."
  },
  {
   "id": "features/people/student-panel.tsx#field:people.students.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the UID is corrected."
  },
  {
   "id": "features/people/student-panel.tsx#field:people.students.uid",
   "kind": "field",
   "label": {
    "uz": "UID",
    "ru": "UID",
    "en": "UID"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The corrected UID of the student: letters, digits or both, up to 20 characters."
  },
  {
   "id": "features/people/student-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of a student: the record in tabs (overview, results, attendance, contract, relatives, history) and the actions on the student."
  },
  {
   "id": "features/people/student-panel.tsx#tab:journal.exemptions.panelTitle",
   "kind": "tab",
   "label": {
    "uz": "Ozod qilishlar",
    "ru": "Освобождения",
    "en": "Exemptions"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's exemptions from subjects or lessons, with their dates."
  },
  {
   "id": "features/people/student-panel.tsx#tab:people.students.tabs.attendance",
   "kind": "tab",
   "label": {
    "uz": "Davomat",
    "ru": "Посещаемость",
    "en": "Attendance"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's attendance: absences and lateness by subject and quarter."
  },
  {
   "id": "features/people/student-panel.tsx#tab:people.students.tabs.contract",
   "kind": "tab",
   "label": {
    "uz": "Shartnoma va grant",
    "ru": "Договор и стипендия",
    "en": "Contract and scholarship"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's contracts, scholarship and stipend history."
  },
  {
   "id": "features/people/student-panel.tsx#tab:people.students.tabs.history",
   "kind": "tab",
   "label": {
    "uz": "Tarix",
    "ru": "История",
    "en": "History"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's history: classes, groups, branch moves, leavings and returns, with dates."
  },
  {
   "id": "features/people/student-panel.tsx#tab:people.students.tabs.label",
   "kind": "tab",
   "label": {
    "uz": "Profil",
    "ru": "Профиль",
    "en": "Profile"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The tabs of the student record; switching shows the overview, results, attendance, contract and scholarship, relatives or history."
  },
  {
   "id": "features/people/student-panel.tsx#tab:people.students.tabs.overview",
   "kind": "tab",
   "label": {
    "uz": "Umumiy",
    "ru": "Обзор",
    "en": "Overview"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's record: class, groups, status, UID and the main details."
  },
  {
   "id": "features/people/student-panel.tsx#tab:people.students.tabs.relatives",
   "kind": "tab",
   "label": {
    "uz": "Qarindoshlar",
    "ru": "Родственники",
    "en": "Relatives"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's relatives and parents with their phones, the main contact and portal access."
  },
  {
   "id": "features/people/student-panel.tsx#tab:people.students.tabs.results",
   "kind": "tab",
   "label": {
    "uz": "Natijalar",
    "ru": "Результаты",
    "en": "Results"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/people/student-panel.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the student's quarter and year results by subject."
  },
  {
   "id": "features/people/student-photo-section.tsx#button:people.staff.photo.add",
   "kind": "button",
   "label": {
    "uz": "Surat qoʻshish",
    "ru": "Добавить фотографию",
    "en": "Add photo"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a file choice to add a photo to the student's record."
  },
  {
   "id": "features/people/student-photo-section.tsx#button:people.staff.photo.remove",
   "kind": "button",
   "label": {
    "uz": "Suratni olib tashlash",
    "ru": "Удалить фотографию",
    "en": "Remove photo"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "StudentPhotosController_removePhoto"
   ],
   "opens": null,
   "description": "Removes the student's photo after a confirmation; initials are shown instead."
  },
  {
   "id": "features/people/student-relatives.tsx#button:form.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the choice of a new main contact without unlinking."
  },
  {
   "id": "features/people/student-relatives.tsx#button:people.relatives.add",
   "kind": "button",
   "label": {
    "uz": "Qarindosh qoʻshish",
    "ru": "Добавить родственника",
    "en": "Add a relative"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to add a relative to the student, a new person or one found by phone."
  },
  {
   "id": "features/people/student-relatives.tsx#button:people.relatives.changeLink",
   "kind": "button",
   "label": {
    "uz": "Bogʻlanishni oʻzgartirish",
    "ru": "Изменить связь",
    "en": "Change the link"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change how this relative is linked: relationship, main contact and portal access."
  },
  {
   "id": "features/people/student-relatives.tsx#button:people.relatives.unlink",
   "kind": "button",
   "label": {
    "uz": "Bogʻlanishni olib tashlash",
    "ru": "Отвязать",
    "en": "Unlink"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "RelativesController_ofStudent",
    "RelativesController_unlink"
   ],
   "opens": null,
   "description": "Unlinks the relative from the student after a confirmation; for the main contact it first asks who becomes the new main contact."
  },
  {
   "id": "features/people/student-relatives.tsx#button:people.relatives.unlink:2",
   "kind": "button",
   "label": {
    "uz": "Bogʻlanishni olib tashlash",
    "ru": "Отвязать",
    "en": "Unlink"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Unlinks the main contact after a confirmation and makes the chosen relative the new main contact."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.email",
   "kind": "field",
   "label": {
    "uz": "Elektron pochta",
    "ru": "Электронная почта",
    "en": "Email"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The relative's email address."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.fullNameField",
   "kind": "field",
   "label": {
    "uz": "Familiya, ism, otasining ismi",
    "ru": "Фамилия, имя, отчество",
    "en": "Surname, name, patronymic"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The relative's surname, name and patronymic."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.mainContact",
   "kind": "field",
   "label": {
    "uz": "Asosiy aloqa",
    "ru": "Основной контакт",
    "en": "Main contact"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked when this relative is the student's main contact."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.mainContact:2",
   "kind": "field",
   "label": {
    "uz": "Asosiy aloqa",
    "ru": "Основной контакт",
    "en": "Main contact"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked when this relative is the student's main contact."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.newMain",
   "kind": "field",
   "label": {
    "uz": "Yangi asosiy aloqa",
    "ru": "Новый основной контакт",
    "en": "New main contact"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The relative who becomes the main contact when the current one is unlinked."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.noPhone",
   "kind": "field",
   "label": {
    "uz": "Oʻz telefoni yoʻq",
    "ru": "Нет своего телефона",
    "en": "No phone of their own"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked when the relative has no phone of their own; notices then cannot reach them."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.phone",
   "kind": "field",
   "label": {
    "uz": "Asosiy telefon",
    "ru": "Основной телефон",
    "en": "Main phone"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The relative's main phone; a phone already known links that person."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.portalAccess",
   "kind": "field",
   "label": {
    "uz": "Portalga kirish",
    "ru": "Доступ к порталу",
    "en": "Portal access"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked to give the relative a parent account for the portal; it is made when the class's slips are printed."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.portalAccess:2",
   "kind": "field",
   "label": {
    "uz": "Portalga kirish",
    "ru": "Доступ к порталу",
    "en": "Portal access"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Ticked to give the relative a parent account for the portal; it is made when the class's slips are printed."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.relationship",
   "kind": "field",
   "label": {
    "uz": "Qarindoshlik",
    "ru": "Родство",
    "en": "Relationship"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "How the relative is related to the student, such as Father or Mother."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.relationship:2",
   "kind": "field",
   "label": {
    "uz": "Qarindoshlik",
    "ru": "Родство",
    "en": "Relationship"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "How the relative is related to the student, such as Father or Mother."
  },
  {
   "id": "features/people/student-relatives.tsx#field:people.relatives.workplace",
   "kind": "field",
   "label": {
    "uz": "Ish joyi",
    "ru": "Место работы",
    "en": "Workplace"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Where the relative works."
  },
  {
   "id": "features/people/student-status-section.tsx#button:people.students.nextYearStart",
   "kind": "button",
   "label": {
    "uz": "Kelgusi yilning birinchi kuni (…)",
    "ru": "Первый день следующего года (…)",
    "en": "First day of next year (…)"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Fills in the first day of the next academic year as the first day back."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The class the returning student joins."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.class:2",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The class the restored student joins; the student takes its grade."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.contractNumber",
   "kind": "field",
   "label": {
    "uz": "Shartnoma raqami",
    "ru": "Номер договора",
    "en": "Contract number"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The number of the contract signed for the return, if any."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.contractSignedOn",
   "kind": "field",
   "label": {
    "uz": "Shartnoma sanasi",
    "ru": "Дата договора",
    "en": "Contract date"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The date of the contract signed for the return."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.grade",
   "kind": "field",
   "label": {
    "uz": "Sinf darajasi",
    "ru": "Параллель",
    "en": "Grade"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The grade the returning student goes into."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.lastDay",
   "kind": "field",
   "label": {
    "uz": "Maktabdagi oxirgi kun",
    "ru": "Последний день в школе",
    "en": "Last day at school"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's last day at school; the student is inactive from the day after."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the student leaves the school."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.reason:2",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the leaving is undone."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.reason:3",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the student comes back."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.reason:4",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the graduated student is restored to active."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.reason:5",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the student created twice is deleted; the UID stays reserved."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.restoreFrom",
   "kind": "field",
   "label": {
    "uz": "Faol boʻlgan sana",
    "ru": "Активен с",
    "en": "Active from"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The day from which the graduated student is active again."
  },
  {
   "id": "features/people/student-status-section.tsx#field:people.students.returnFrom",
   "kind": "field",
   "label": {
    "uz": "Qaytgandan keyingi birinchi kun",
    "ru": "Первый день после возвращения",
    "en": "First day back"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's first day back at school."
  },
  {
   "id": "features/people/students-page.tsx#button:people.students.add",
   "kind": "button",
   "label": {
    "uz": "Oʻquvchi qoʻshish",
    "ru": "Добавить ученика",
    "en": "Add student"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new student in the side panel."
  },
  {
   "id": "features/people/students-page.tsx#button:people.students.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the panel that puts the ticked students into a class, without a change."
  },
  {
   "id": "features/people/students-page.tsx#button:people.students.cancel:2",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the panel that puts the ticked students into a group, without a change."
  },
  {
   "id": "features/people/students-page.tsx#button:people.students.cancel:3",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new student form without saving."
  },
  {
   "id": "features/people/students-page.tsx#button:people.students.cancel:4",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the panel that records the leaving of the ticked students, without a change."
  },
  {
   "id": "features/people/students-page.tsx#button:problems.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Попробовать ещё раз",
    "en": "Try again"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Reads the list of classes for the Class filter again after it failed to load."
  },
  {
   "id": "features/people/students-page.tsx#column:people.staff.photo.column",
   "kind": "column",
   "label": {
    "uz": "Surat",
    "ru": "Фото",
    "en": "Photo"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's photo, or initials when there is none."
  },
  {
   "id": "features/people/students-page.tsx#column:people.students.class",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's class, with a planned class and its date."
  },
  {
   "id": "features/people/students-page.tsx#column:people.students.groups",
   "kind": "column",
   "label": {
    "uz": "Guruhlar",
    "ru": "Группы",
    "en": "Groups"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The groups the student is in, with planned groups and their dates."
  },
  {
   "id": "features/people/students-page.tsx#column:people.students.name",
   "kind": "column",
   "label": {
    "uz": "Familiya va ism",
    "ru": "Фамилия и имя",
    "en": "Surname and name"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's surname and name."
  },
  {
   "id": "features/people/students-page.tsx#column:people.students.status",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the student is active, inactive, graduated or starts later."
  },
  {
   "id": "features/people/students-page.tsx#column:people.students.tutor",
   "kind": "column",
   "label": {
    "uz": "Tyutor yoki sinf rahbari",
    "ru": "Тьютор или классный руководитель",
    "en": "Tutor or Class teacher"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The Tutor or Class teacher of the student's class, and an acting Tutor."
  },
  {
   "id": "features/people/students-page.tsx#column:people.students.uid",
   "kind": "column",
   "label": {
    "uz": "UID",
    "ru": "UID",
    "en": "UID"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's UID."
  },
  {
   "id": "features/people/students-page.tsx#field:people.students.lastDay",
   "kind": "field",
   "label": {
    "uz": "Maktabdagi oxirgi kun",
    "ru": "Последний день в школе",
    "en": "Last day at school"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The last day at school of the ticked students; they are inactive from the day after."
  },
  {
   "id": "features/people/students-page.tsx#field:people.students.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Holds why the ticked students leave the school."
  },
  {
   "id": "features/people/vacancies-page.tsx#button:people.staff.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new vacancy form without saving."
  },
  {
   "id": "features/people/vacancies-page.tsx#button:people.vacancies.add",
   "kind": "button",
   "label": {
    "uz": "Vakansiya qoʻshish",
    "ru": "Добавить вакансию",
    "en": "Add vacancy"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new vacancy in the side panel."
  },
  {
   "id": "features/people/vacancies-page.tsx#column:people.staff.grades",
   "kind": "column",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Grades"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The grades the vacancy teaches."
  },
  {
   "id": "features/people/vacancies-page.tsx#column:people.staff.languagesTitle",
   "kind": "column",
   "label": {
    "uz": "Taʼlim tillari",
    "ru": "Языки обучения",
    "en": "Languages of instruction"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The languages the vacancy teaches in."
  },
  {
   "id": "features/people/vacancies-page.tsx#column:people.staff.weeklyLessons",
   "kind": "column",
   "label": {
    "uz": "Shartnoma boʻyicha haftalik darslar",
    "ru": "Уроков в неделю по договору",
    "en": "Lessons per week by contract"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "How many lessons a week the vacancy is planned for."
  },
  {
   "id": "features/people/vacancies-page.tsx#column:people.vacancies.department",
   "kind": "column",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The department of the vacancy."
  },
  {
   "id": "features/people/vacancies-page.tsx#column:people.vacancies.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The name of the vacancy."
  },
  {
   "id": "features/people/vacancies-page.tsx#column:people.vacancies.statusTitle",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the vacancy is open or closed, and the day it closes."
  },
  {
   "id": "features/people/vacancies-page.tsx#column:people.vacancies.subjects",
   "kind": "column",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The subjects the vacancy teaches."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without a change."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.cancel:2",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.endTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without a change."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.end",
   "kind": "button",
   "label": {
    "uz": "Tugatish",
    "ru": "Завершить",
    "en": "End"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to end the current acting teacher's period on a chosen day."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.end:2",
   "kind": "button",
   "label": {
    "uz": "Tugatish",
    "ru": "Завершить",
    "en": "End"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.endTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ActingTeachersController_end"
   ],
   "opens": null,
   "description": "Ends the acting teacher's period on the day chosen."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.name",
   "kind": "button",
   "label": {
    "uz": "Tayinlash",
    "ru": "Назначить",
    "en": "Name"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ActingTeachersController_name"
   ],
   "opens": null,
   "description": "Names the acting teacher for the chosen journal and dates."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.open",
   "kind": "button",
   "label": {
    "uz": "Vaqtincha oʻqituvchi tayinlash",
    "ru": "Назначить исполняющего обязанности",
    "en": "Name an acting teacher"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to name an acting teacher who writes a journal of the vacancy for a period."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.substitute",
   "kind": "button",
   "label": {
    "uz": "Jurnal boʻyicha oʻrinbosar",
    "ru": "Замена по журналу",
    "en": "Substitute per journal"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to arrange substitutes for the lessons of this journal of the vacancy."
  },
  {
   "id": "features/people/vacancy-acting.tsx#button:people.vacancies.acting.withdraw",
   "kind": "button",
   "label": {
    "uz": "Qaytarib olish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ActingTeachersController_end"
   ],
   "opens": null,
   "description": "Withdraws the planned acting teacher before the period starts, after a confirmation; it stays in the history."
  },
  {
   "id": "features/people/vacancy-acting.tsx#field:people.vacancies.acting.endOn",
   "kind": "field",
   "label": {
    "uz": "Jurnalni qaytaradigan kun",
    "ru": "Возвращает журнал",
    "en": "Hands the journal back on"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.endTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day the acting teacher no longer holds the journal."
  },
  {
   "id": "features/people/vacancy-acting.tsx#field:people.vacancies.acting.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day the acting teacher holds the journal, today at the earliest."
  },
  {
   "id": "features/people/vacancy-acting.tsx#field:people.vacancies.acting.journal",
   "kind": "field",
   "label": {
    "uz": "Jurnal",
    "ru": "Журнал",
    "en": "Journal"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The journal of the vacancy the acting teacher takes over."
  },
  {
   "id": "features/people/vacancy-acting.tsx#field:people.vacancies.acting.person",
   "kind": "field",
   "label": {
    "uz": "Shaxs",
    "ru": "Человек",
    "en": "Person"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member named as acting teacher."
  },
  {
   "id": "features/people/vacancy-acting.tsx#field:people.vacancies.acting.untilField",
   "kind": "field",
   "label": {
    "uz": "Jurnalni qaytaradigan kun (ixtiyoriy)",
    "ru": "Возвращает журнал (необязательно)",
    "en": "Hands the journal back on (optional)"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The day the acting teacher hands the journal back, if known; left empty the period is open-ended."
  },
  {
   "id": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.dialogTitle",
   "kind": "panel",
   "label": {
    "uz": "… uchun vaqtincha oʻqituvchi",
    "ru": "Исполняющий обязанности: …",
    "en": "Acting teacher for …"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for naming an acting teacher for a journal of the vacancy, from a day and optionally until one."
  },
  {
   "id": "features/people/vacancy-acting.tsx#panel:people.vacancies.acting.endTitle",
   "kind": "panel",
   "label": {
    "uz": "… davrini tugatish",
    "ru": "Завершить период: …",
    "en": "End the period of …"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for ending an acting teacher's period on a chosen day."
  },
  {
   "id": "features/people/vacancy-fill-dialog.tsx#button:people.vacancies.fill.action",
   "kind": "button",
   "label": {
    "uz": "Toʻldirish",
    "ru": "Заполнить",
    "en": "Fill"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-fill-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Gives the checked rows to the person after a confirmation, in the timetable in force and every later version; the vacancy closes when nothing holds it."
  },
  {
   "id": "features/people/vacancy-fill-dialog.tsx#button:people.vacancies.fill.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-fill-dialog.tsx#panel:people.vacancies.fill.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the fill dialog."
  },
  {
   "id": "features/people/vacancy-fill-dialog.tsx#button:timetable.publish.defaultStart",
   "kind": "button",
   "label": {
    "uz": "Odatiy boshlanish: …",
    "ru": "Обычное начало: …",
    "en": "Usual start: …"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-fill-dialog.tsx#panel:people.vacancies.fill.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the start day to the usual start, the next Monday."
  },
  {
   "id": "features/people/vacancy-fill-dialog.tsx#field:people.vacancies.fill.person",
   "kind": "field",
   "label": {
    "uz": "Xodim",
    "ru": "Сотрудник",
    "en": "Person"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-fill-dialog.tsx#panel:people.vacancies.fill.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The staff member who takes over the vacancy's lessons."
  },
  {
   "id": "features/people/vacancy-fill-dialog.tsx#field:people.vacancies.fill.startsOn",
   "kind": "field",
   "label": {
    "uz": "Sanadan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-fill-dialog.tsx#panel:people.vacancies.fill.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day the person takes the vacancy's rows."
  },
  {
   "id": "features/people/vacancy-fill-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for filling a vacancy with a person: the start day, the rows that go to the person and the effect on the timetable."
  },
  {
   "id": "features/people/vacancy-fill-dialog.tsx#panel:people.vacancies.fill.title",
   "kind": "panel",
   "label": {
    "uz": "Toʻldirish: …",
    "ru": "Заполнить: …",
    "en": "Fill …"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-fill-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for filling a vacancy: choose the person and start day, check which rows they can take, then fill."
  },
  {
   "id": "features/people/vacancy-form.tsx#field:people.staff.dailyLessons",
   "kind": "field",
   "label": {
    "uz": "Kuniga eng koʻp darslar",
    "ru": "Наибольшее число уроков в день",
    "en": "Most lessons per day"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The most lessons a day the vacancy may have in the timetable."
  },
  {
   "id": "features/people/vacancy-form.tsx#field:people.staff.gradesOf",
   "kind": "field",
   "label": {
    "uz": "…: sinflar",
    "ru": "Классы: …",
    "en": "Grades of …"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The grades in which the vacancy teaches this subject."
  },
  {
   "id": "features/people/vacancy-form.tsx#field:people.staff.languagesTitle",
   "kind": "field",
   "label": {
    "uz": "Taʼlim tillari",
    "ru": "Языки обучения",
    "en": "Languages of instruction"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The languages the vacancy teaches in."
  },
  {
   "id": "features/people/vacancy-form.tsx#field:people.staff.weeklyLessons",
   "kind": "field",
   "label": {
    "uz": "Shartnoma boʻyicha haftalik darslar",
    "ru": "Уроков в неделю по договору",
    "en": "Lessons per week by contract"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "How many lessons a week the vacancy is planned for."
  },
  {
   "id": "features/people/vacancy-form.tsx#field:people.vacancies.department",
   "kind": "field",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The department of the vacancy; its subjects are offered below."
  },
  {
   "id": "features/people/vacancy-form.tsx#field:people.vacancies.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The name of the vacancy."
  },
  {
   "id": "features/people/vacancy-form.tsx#field:people.vacancies.subjects",
   "kind": "field",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The subjects the vacancy teaches, from the department's subjects."
  },
  {
   "id": "features/people/vacancy-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-panel.tsx#panel",
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the vacancy's record form for editing."
  },
  {
   "id": "features/people/vacancy-panel.tsx#button:people.vacancies.close",
   "kind": "button",
   "label": {
    "uz": "Vakansiyani yopish",
    "ru": "Закрыть вакансию",
    "en": "Close the vacancy"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-panel.tsx#panel",
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "VacanciesController_close",
    "VacanciesController_reopen"
   ],
   "opens": null,
   "description": "Closes the vacancy; the button then reopens it."
  },
  {
   "id": "features/people/vacancy-panel.tsx#button:people.vacancies.delete",
   "kind": "button",
   "label": {
    "uz": "Oʻchirish",
    "ru": "Удалить",
    "en": "Delete"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-panel.tsx#panel",
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "VacanciesController_delete"
   ],
   "opens": null,
   "description": "Deletes the vacancy and its hours after a confirmation; the audit log keeps a copy."
  },
  {
   "id": "features/people/vacancy-panel.tsx#button:people.vacancies.fill.open",
   "kind": "button",
   "label": {
    "uz": "Toʻldirish",
    "ru": "Заполнить",
    "en": "Fill"
   },
   "pages": [
    "/people/vacancies"
   ],
   "parent": "features/people/vacancy-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to fill the vacancy with a staff member."
  },
  {
   "id": "features/people/vacancy-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/people/vacancies"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of a vacancy: its record, hours, fills and acting teachers."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#button:plans.files.dropOf",
   "kind": "button",
   "label": {
    "uz": "… ni olib tashlash",
    "ru": "Убрать …",
    "en": "Remove …"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes a picked file from the row before it is uploaded; nothing is sent for it when the row is saved."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#button:plans.files.dropOf:2",
   "kind": "button",
   "label": {
    "uz": "… ni olib tashlash",
    "ru": "Убрать …",
    "en": "Remove …"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes a file that could not be uploaded from the not-uploaded list, without trying again."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#button:plans.files.retry",
   "kind": "button",
   "label": {
    "uz": "Qayta urinish",
    "ru": "Повторить",
    "en": "Try again"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_addFile"
   ],
   "opens": null,
   "description": "Tries again to upload a file that failed when the row was saved, attaching it to its work or to the materials."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#button:plans.panel.addClasswork",
   "kind": "button",
   "label": {
    "uz": "Sinf ishi qoʻshish",
    "ru": "Добавить классную работу",
    "en": "Add classwork"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Adds one more classwork line to the row (the homework section has its own button), up to the limit of works."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#button:plans.panel.sameTopic",
   "kind": "button",
   "label": {
    "uz": "Oldingi darsdagi mavzu",
    "ru": "Та же тема, что на прошлом уроке",
    "en": "Same topic as the previous lesson"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Fills the topic with the topic of the previous lesson on the same day, for a double lesson."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#field:plans.panel.classworkTitle",
   "kind": "field",
   "label": {
    "uz": "…-sinf ishi",
    "ru": "Классная работа …",
    "en": "Classwork …"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The title of a classwork (or homework) of the lesson; once it has a title, files can be attached to it."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#field:plans.panel.description",
   "kind": "field",
   "label": {
    "uz": "Tavsif",
    "ru": "Описание",
    "en": "Description"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "A short description of the classwork or homework beside it."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#field:plans.panel.links",
   "kind": "field",
   "label": {
    "uz": "Havolalar",
    "ru": "Ссылки",
    "en": "Links"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Web links for the lesson, one per line; each must be a valid address."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#field:plans.panel.objectives",
   "kind": "field",
   "label": {
    "uz": "Maqsadlar va materiallar",
    "ru": "Цели и материалы",
    "en": "Objectives and materials"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The objectives of the lesson and the materials it uses, as free text."
  },
  {
   "id": "features/plans/plan-item-editor.tsx#field:plans.plan.topic",
   "kind": "field",
   "label": {
    "uz": "Mavzu",
    "ru": "Тема",
    "en": "Topic"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The topic of the lesson in this plan row."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the master item in the side panel for editing."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.master.addItem",
   "kind": "button",
   "label": {
    "uz": "Qator qoʻshish",
    "ru": "Добавить строку",
    "en": "Add row"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to add a new item at the end of the master plan."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.master.moveDown",
   "kind": "button",
   "label": {
    "uz": "Pastga",
    "ru": "Ниже",
    "en": "Move down"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanMastersController_order"
   ],
   "opens": null,
   "description": "Moves the item one place down in the master plan's order."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.master.moveUp",
   "kind": "button",
   "label": {
    "uz": "Yuqoriga",
    "ru": "Выше",
    "en": "Move up"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanMastersController_order"
   ],
   "opens": null,
   "description": "Moves the item one place up in the master plan's order."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.master.remove",
   "kind": "button",
   "label": {
    "uz": "Olib tashlash",
    "ru": "Удалить",
    "en": "Remove"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanMastersController_removeItem"
   ],
   "opens": null,
   "description": "Removes the item from the master plan, after a confirmation."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.master.rename",
   "kind": "button",
   "label": {
    "uz": "Nomini oʻzgartirish",
    "ru": "Переименовать",
    "en": "Rename"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a small form to change the name of the master plan."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.master.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanMastersController_archive",
    "PlanMastersController_restore"
   ],
   "opens": null,
   "description": "Restores an archived master plan so it can be edited and copied again. On an active master the same place archives it, after a confirmation."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.masters.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new item form without adding anything."
  },
  {
   "id": "features/plans/plan-master-page.tsx#button:plans.panel.addClasswork",
   "kind": "button",
   "label": {
    "uz": "Sinf ishi qoʻshish",
    "ru": "Добавить классную работу",
    "en": "Add classwork"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Adds one more classwork line to the master item (the homework section has its own button)."
  },
  {
   "id": "features/plans/plan-master-page.tsx#column:plans.master.number",
   "kind": "column",
   "label": {
    "uz": "№",
    "ru": "№",
    "en": "No."
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The position of the item in the master plan's order."
  },
  {
   "id": "features/plans/plan-master-page.tsx#column:plans.plan.classworks",
   "kind": "column",
   "label": {
    "uz": "Sinf ishlari",
    "ru": "Классные работы",
    "en": "Classworks"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The titles of the item's classworks."
  },
  {
   "id": "features/plans/plan-master-page.tsx#column:plans.plan.homeworks",
   "kind": "column",
   "label": {
    "uz": "Uyga vazifalar",
    "ru": "Домашние задания",
    "en": "Homeworks"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The titles of the item's homeworks."
  },
  {
   "id": "features/plans/plan-master-page.tsx#column:plans.plan.topic",
   "kind": "column",
   "label": {
    "uz": "Mavzu",
    "ru": "Тема",
    "en": "Topic"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The topic of the master item; pressing it opens the item in the side panel."
  },
  {
   "id": "features/plans/plan-master-page.tsx#field:plans.masters.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The new name of the master plan."
  },
  {
   "id": "features/plans/plan-master-page.tsx#field:plans.panel.classworkTitle",
   "kind": "field",
   "label": {
    "uz": "…-sinf ishi",
    "ru": "Классная работа …",
    "en": "Classwork …"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The title of a classwork (or homework) of the master item."
  },
  {
   "id": "features/plans/plan-master-page.tsx#field:plans.panel.description",
   "kind": "field",
   "label": {
    "uz": "Tavsif",
    "ru": "Описание",
    "en": "Description"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "A short description of the classwork or homework beside it."
  },
  {
   "id": "features/plans/plan-master-page.tsx#field:plans.panel.links",
   "kind": "field",
   "label": {
    "uz": "Havolalar",
    "ru": "Ссылки",
    "en": "Links"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Web links for the master item, one per line."
  },
  {
   "id": "features/plans/plan-master-page.tsx#field:plans.panel.objectives",
   "kind": "field",
   "label": {
    "uz": "Maqsadlar va materiallar",
    "ru": "Цели и материалы",
    "en": "Objectives and materials"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The objectives and materials of the master item, as free text."
  },
  {
   "id": "features/plans/plan-master-page.tsx#field:plans.plan.topic",
   "kind": "field",
   "label": {
    "uz": "Mavzu",
    "ru": "Тема",
    "en": "Topic"
   },
   "pages": [
    "/plans/masters/$masterId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The topic of the master item."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#button:plans.share.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-master-updated.tsx#panel:plans.masterCopy.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_copy"
   ],
   "opens": null,
   "description": "Closes the dialog without changing the plan."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#button:plans.share.back:2",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-master-updated.tsx#panel:plans.updated.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without changing the plan."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#button:plans.share.copySend",
   "kind": "button",
   "label": {
    "uz": "Nusxa olish",
    "ru": "Скопировать",
    "en": "Copy"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-master-updated.tsx#panel:plans.masterCopy.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_copy"
   ],
   "opens": null,
   "description": "Copies the chosen master's items into the plan's rows in order and closes the dialog."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#button:plans.updated.compare",
   "kind": "button",
   "label": {
    "uz": "Solishtirish",
    "ru": "Сравнить",
    "en": "Compare"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a side-by-side comparison of the plan and the master it was copied from, which has changed since."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#button:plans.updated.keep",
   "kind": "button",
   "label": {
    "uz": "Rejamni qoldirish",
    "ru": "Оставить мой план",
    "en": "Keep my plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-master-updated.tsx#panel:plans.updated.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanMastersController_keep",
    "PlanMastersController_take"
   ],
   "opens": null,
   "description": "Keeps the plan as it is, after a confirmation; the updated mark goes until the master changes again."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#button:plans.updated.take",
   "kind": "button",
   "label": {
    "uz": "Oʻzgarishlarni qabul qilish",
    "ru": "Принять изменения",
    "en": "Take the changes"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-master-updated.tsx#panel:plans.updated.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanMastersController_keep",
    "PlanMastersController_take"
   ],
   "opens": null,
   "description": "Takes the master's changes into this plan, after a confirmation; this cannot be undone."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#field:plans.masterCopy.master",
   "kind": "field",
   "label": {
    "uz": "Master-reja",
    "ru": "Мастер-план",
    "en": "Master plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-master-updated.tsx#panel:plans.masterCopy.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The master plan to copy, with its scope and number of items."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#panel:plans.masterCopy.title",
   "kind": "panel",
   "label": {
    "uz": "Master-rejadan nusxalash",
    "ru": "Копировать из мастер-плана",
    "en": "Copy from a master plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for filling this quarter's plan from a master plan that fits its subject, grade, language and quarter."
  },
  {
   "id": "features/plans/plan-master-updated.tsx#panel:plans.updated.title",
   "kind": "panel",
   "label": {
    "uz": "Master-reja oʻzgarishlari",
    "ru": "Изменения мастер-плана",
    "en": "Changes of the master plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that compares each changed master item with the plan's row, so the changes can be taken or the plan kept."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#button:plans.masters.add",
   "kind": "button",
   "label": {
    "uz": "Master-reja qoʻshish",
    "ru": "Добавить мастер-план",
    "en": "Add master"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new master plan of a subject one keeps; after saving, the new master opens."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#button:plans.masters.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new master form without creating anything."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.masters.grade",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Grade"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The grade the master plan is for."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.masters.items",
   "kind": "column",
   "label": {
    "uz": "Qatorlar",
    "ru": "Строки",
    "en": "Rows"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many items (rows) the master plan has."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.masters.language",
   "kind": "column",
   "label": {
    "uz": "Til",
    "ru": "Язык",
    "en": "Language"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The language of instruction the master plan is for."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.masters.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The name of the master plan; pressing it opens the master."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.masters.quarter",
   "kind": "column",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The quarter the master plan is for."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.masters.scope",
   "kind": "column",
   "label": {
    "uz": "Kim uchun",
    "ru": "Для",
    "en": "Kept for"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the master is kept for this branch or for all branches."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.masters.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the master plan is active or archived."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#column:plans.page.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The subject of the master plan."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#field:plans.masters.grade",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Grade"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The grade of the new master plan."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#field:plans.masters.language",
   "kind": "field",
   "label": {
    "uz": "Til",
    "ru": "Язык",
    "en": "Language"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The language of instruction of the new master plan."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#field:plans.masters.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The name of the new master plan."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#field:plans.masters.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The quarter of the new master plan."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#field:plans.masters.scope",
   "kind": "field",
   "label": {
    "uz": "Kim uchun",
    "ru": "Для",
    "en": "Kept for"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the new master is kept for this branch or for all branches; shown only when both are possible."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#field:plans.page.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The subject of the new master plan, from the subjects one keeps; the grade and scope choices follow it."
  },
  {
   "id": "features/plans/plan-masters-page.tsx#field:plans.page.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/plans",
    "/plans/masters"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year whose master plans are listed."
  },
  {
   "id": "features/plans/plan-minimums.tsx#button:plans.minimum.save",
   "kind": "button",
   "label": {
    "uz": "Saqlash",
    "ru": "Сохранить",
    "en": "Save"
   },
   "pages": [
    "/plans/windows"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanMinimumsController_save"
   ],
   "opens": null,
   "description": "Saves the subject's minimum works; a plan below them is flagged once its window has ended."
  },
  {
   "id": "features/plans/plan-minimums.tsx#field:plans.minimum.classworks",
   "kind": "field",
   "label": {
    "uz": "Sinf ishlari",
    "ru": "Классные работы",
    "en": "Classworks"
   },
   "pages": [
    "/plans/windows"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The minimum number of classworks a plan of this subject should have per quarter; 0 is no minimum."
  },
  {
   "id": "features/plans/plan-minimums.tsx#field:plans.minimum.homeworks",
   "kind": "field",
   "label": {
    "uz": "Uyga vazifalar",
    "ru": "Домашние задания",
    "en": "Homeworks"
   },
   "pages": [
    "/plans/windows"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The minimum number of homeworks a plan of this subject should have per quarter; 0 is no minimum."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.outcomes.carry",
   "kind": "button",
   "label": {
    "uz": "Keyingi chorakka koʻchirish",
    "ru": "Перенести в следующую четверть",
    "en": "Carry to next quarter"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanOutcomesController_carry"
   ],
   "opens": null,
   "description": "Carries the not-covered item to the next quarter's plan, after a confirmation; it waits there in the carried-in tray."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.outcomes.drop",
   "kind": "button",
   "label": {
    "uz": "Oʻchirish",
    "ru": "Удалить",
    "en": "Drop"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to drop the item from the plan with a reason."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.outcomes.drop:2",
   "kind": "button",
   "label": {
    "uz": "Oʻchirish",
    "ru": "Удалить",
    "en": "Drop"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.dropTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanOutcomesController_drop"
   ],
   "opens": null,
   "description": "Drops the item with the reason typed and closes the dialog."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.outcomes.merge",
   "kind": "button",
   "label": {
    "uz": "Darsga birlashtirish",
    "ru": "Объединить с уроком",
    "en": "Merge into a lesson"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to merge a not-covered item into one of the plan's open lessons."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.outcomes.merge:2",
   "kind": "button",
   "label": {
    "uz": "Darsga birlashtirish",
    "ru": "Объединить с уроком",
    "en": "Merge into a lesson"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.mergeTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanOutcomesController_merge",
    "PlanOutcomesController_place"
   ],
   "opens": null,
   "description": "Merges the item into the chosen lesson (or places it there, for a carried-in item) and closes the dialog."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.outcomes.place",
   "kind": "button",
   "label": {
    "uz": "Darsga qoʻyish",
    "ru": "Поставить на урок",
    "en": "Place at a lesson"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to place an item carried in from the last quarter at one of this plan's open lessons."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.share.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.mergeTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanOutcomesController_merge",
    "PlanOutcomesController_place"
   ],
   "opens": null,
   "description": "Closes the dialog without changing the plan."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#button:plans.share.back:2",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.dropTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanOutcomesController_drop"
   ],
   "opens": null,
   "description": "Closes the dialog without changing the plan."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#field:plans.outcomes.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.dropTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Why the item is dropped; required, and shown in the quarter's outcomes."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#field:plans.outcomes.row",
   "kind": "field",
   "label": {
    "uz": "Dars",
    "ru": "Урок",
    "en": "Lesson"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.mergeTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The open lesson of the plan to use, with its number, date and current topic."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.dropTitle",
   "kind": "panel",
   "label": {
    "uz": "«…» bandini oʻchirish",
    "ru": "Удалить «…»",
    "en": "Drop “…”"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for dropping a not-covered or carried-in item from the plan with a reason."
  },
  {
   "id": "features/plans/plan-outcomes.tsx#panel:plans.outcomes.mergeTitle",
   "kind": "panel",
   "label": {
    "uz": "«…» bandini darsga birlashtirish",
    "ru": "Объединить «…» с уроком",
    "en": "Merge “…” into a lesson"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for choosing the lesson at which a carried-in item is placed or into which a not-covered item is merged."
  },
  {
   "id": "features/plans/plan-page.tsx#column:plans.plan.classworks",
   "kind": "column",
   "label": {
    "uz": "Sinf ishlari",
    "ru": "Классные работы",
    "en": "Classworks"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The titles of the lesson's classworks."
  },
  {
   "id": "features/plans/plan-page.tsx#column:plans.plan.date",
   "kind": "column",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The date and slot of the lesson; pressing it opens the row in the side panel."
  },
  {
   "id": "features/plans/plan-page.tsx#column:plans.plan.files",
   "kind": "column",
   "label": {
    "uz": "Fayllar",
    "ru": "Файлы",
    "en": "Files"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many files are attached to the row."
  },
  {
   "id": "features/plans/plan-page.tsx#column:plans.plan.homeworks",
   "kind": "column",
   "label": {
    "uz": "Uyga vazifalar",
    "ru": "Домашние задания",
    "en": "Homeworks"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The titles of the lesson's homeworks."
  },
  {
   "id": "features/plans/plan-page.tsx#column:plans.plan.marks",
   "kind": "column",
   "label": {
    "uz": "Belgilar",
    "ru": "Отметки",
    "en": "Marks"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The journal's marks on a held lesson: topic not delivered, or homework not given."
  },
  {
   "id": "features/plans/plan-page.tsx#column:plans.plan.number",
   "kind": "column",
   "label": {
    "uz": "№",
    "ru": "№",
    "en": "No."
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The number of the lesson in the quarter."
  },
  {
   "id": "features/plans/plan-page.tsx#column:plans.plan.topic",
   "kind": "column",
   "label": {
    "uz": "Mavzu",
    "ru": "Тема",
    "en": "Topic"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The topic planned for the lesson, with marks such as moved from a date or edited after the lesson."
  },
  {
   "id": "features/plans/plan-page.tsx#tab:plans.plan.quarter",
   "kind": "tab",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the plan shown to another quarter of the year."
  },
  {
   "id": "features/plans/plan-parallel-page.tsx#field:plans.masters.grade",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Grade"
   },
   "pages": [
    "/plans/parallel"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the grade whose classes and groups are shown side by side."
  },
  {
   "id": "features/plans/plan-parallel-page.tsx#field:plans.masters.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/plans/parallel"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter whose plans are compared."
  },
  {
   "id": "features/plans/plan-parallel-page.tsx#field:plans.page.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/plans/parallel"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject whose classes are compared."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#button:plans.reports.excel",
   "kind": "button",
   "label": {
    "uz": "Excel",
    "ru": "Excel",
    "en": "Excel"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [
    "PlanReportsController_export"
   ],
   "opens": null,
   "description": "Downloads the report shown, with its quarter and department, as an Excel file."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.page.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The subject of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.page.subject:2",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The subject of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.counts.percentComplete",
   "kind": "column",
   "label": {
    "uz": "Toʻliq, %",
    "ru": "Заполнено, %",
    "en": "Complete, %"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The share of the teacher's plans that are complete, where every lesson has a topic."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.counts.plans",
   "kind": "column",
   "label": {
    "uz": "Rejalar",
    "ru": "Планы",
    "en": "Plans"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many plans the teacher has in the quarter."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.flag",
   "kind": "column",
   "label": {
    "uz": "Ogohlantirish",
    "ru": "Предупреждение",
    "en": "Warning"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Warnings on the plan: overdue, window not opened, vacancy, or below the minimum works."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.progress.behind",
   "kind": "column",
   "label": {
    "uz": "Rejadan orqada",
    "ru": "Отстаёт от плана",
    "en": "Behind the plan"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Marks the plans whose delivered topics are behind the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.progress.notHeld",
   "kind": "column",
   "label": {
    "uz": "Oʻtkazilmagan ishlar",
    "ru": "Работы не проводились",
    "en": "Works not held"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many of the teacher's planned works were not held."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.progress.percentNotHeld",
   "kind": "column",
   "label": {
    "uz": "Oʻtkazilmaganlar ulushi",
    "ru": "Доля не проведённых",
    "en": "Share not held"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The share of the teacher's planned works that were not held."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.progress.planned",
   "kind": "column",
   "label": {
    "uz": "Rejalashtirilgan darslar",
    "ru": "Уроков запланировано",
    "en": "Lessons planned"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many lessons of the quarter the plan has planned."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.progress.plannedWorks",
   "kind": "column",
   "label": {
    "uz": "Rejalashtirilgan ishlar",
    "ru": "Запланированные работы",
    "en": "Planned works"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many works the teacher planned in the quarter."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.requests.changes",
   "kind": "column",
   "label": {
    "uz": "Nima oʻzgartirildi",
    "ru": "Что изменено",
    "en": "What was changed"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "What was changed in the plan under the request, with the topic before and after."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.requests.decidedBy",
   "kind": "column",
   "label": {
    "uz": "Hal qildi",
    "ru": "Решил",
    "en": "Decided by"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Who decided the request, and on which date."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.requests.kind",
   "kind": "column",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The kind of edit request: text, re-plan or extension."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.requests.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Where the request stands: prepared, sent, approved, refused or void."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Where the plan stands: complete, not started, no lessons, or how many rows lack a topic."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.teacher",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The teacher whose plans the row counts, or the teacher of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.teacher:2",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The teacher whose plans the row counts, or the teacher of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.teacher:3",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The teacher whose plans the row counts, or the teacher of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.teacher:4",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The teacher whose plans the row counts, or the teacher of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.teacher:5",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The teacher whose plans the row counts, or the teacher of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.unit",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.unit:2",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group of the plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#column:plans.reports.unit:3",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group and the subject of the plan the request was for."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#field:plans.reports.department",
   "kind": "field",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the report to one department, or shows all departments."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#field:plans.reports.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter the report counts."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#tab:plans.reports.part",
   "kind": "tab",
   "label": {
    "uz": "Koʻrsatish",
    "ru": "Показать",
    "en": "Show"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the completeness or progress report between one row per teacher and one row per plan."
  },
  {
   "id": "features/plans/plan-reports-page.tsx#tab:plans.reports.report",
   "kind": "tab",
   "label": {
    "uz": "Hisobot",
    "ru": "Отчёт",
    "en": "Report"
   },
   "pages": [
    "/plans/reports"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches between the completeness, progress and edit requests reports."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#button:plans.requests.approveAll",
   "kind": "button",
   "label": {
    "uz": "Hammasini tasdiqlash",
    "ru": "Одобрить все",
    "en": "Approve all"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [
    "PlanRequestsController_decideEvent"
   ],
   "opens": null,
   "description": "Approves every waiting request caused by one change, with the school days chosen, after a confirmation; it cannot be taken back."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#button:plans.requests.approveSubject",
   "kind": "button",
   "label": {
    "uz": "… ni tasdiqlash",
    "ru": "Одобрить: …",
    "en": "Approve …"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [
    "PlanRequestsController_decideEvent"
   ],
   "opens": null,
   "description": "Approves the waiting requests of one change for one subject only, after a confirmation."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#button:plans.requests.decide",
   "kind": "button",
   "label": {
    "uz": "Qaror qilish",
    "ru": "Решить",
    "en": "Decide"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to approve or refuse the request."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#column:plans.requests.kindLabel",
   "kind": "column",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The kind of request: text, re-plan or window extension."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#column:plans.requests.owner",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The teacher who owns the plan."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#column:plans.requests.statusLabel",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Where the request stands; one waiting 2 school days is highlighted."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#column:plans.requests.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The subject of the plan."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#column:plans.requests.unit",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group of the plan the request is for; pressing it opens the request in the side panel."
  },
  {
   "id": "features/plans/plan-requests-page.tsx#field:plans.requests.daysLabel",
   "kind": "field",
   "label": {
    "uz": "Ochiq oʻquv kunlari",
    "ru": "Учебных дней открыто",
    "en": "School days open"
   },
   "pages": [
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many school days, 1 to 10, the lessons stay open when requests are approved together."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.requests.approve",
   "kind": "button",
   "label": {
    "uz": "Tasdiqlash",
    "ru": "Одобрить",
    "en": "Approve"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.decideTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Sends the decision (approve, or refuse when chosen) and closes the dialog."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.requests.ask",
   "kind": "button",
   "label": {
    "uz": "Oʻzgartirishni soʻrash",
    "ru": "Запросить изменение",
    "en": "Ask to edit"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to ask for permission to edit the plan outside its window."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.requests.decide",
   "kind": "button",
   "label": {
    "uz": "Qaror qilish",
    "ru": "Решить",
    "en": "Decide"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to approve or refuse the edit request."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.requests.finish",
   "kind": "button",
   "label": {
    "uz": "Tugatildi",
    "ru": "Готово",
    "en": "Finished"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanRequestsController_finish"
   ],
   "opens": null,
   "description": "Ends an open request early, after a confirmation; its lessons lock again at once."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.requests.send",
   "kind": "button",
   "label": {
    "uz": "Soʻrovni yuborish",
    "ru": "Отправить запрос",
    "en": "Send request"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanRequestsController_send",
    "PlanRequestsController_sendPrepared"
   ],
   "opens": null,
   "description": "Sends the edit request the system prepared for this plan to the people who decide it."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.requests.send:2",
   "kind": "button",
   "label": {
    "uz": "Soʻrovni yuborish",
    "ru": "Отправить запрос",
    "en": "Send request"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.askTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanRequestsController_create"
   ],
   "opens": null,
   "description": "Sends the edit request with the lessons and reason chosen, and closes the dialog."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.share.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.askTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanRequestsController_create"
   ],
   "opens": null,
   "description": "Closes the dialog without sending anything."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.share.back:2",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.decideTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without sending anything."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.share.back:3",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.windows.extendTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanWindowsController_extend"
   ],
   "opens": null,
   "description": "Closes the dialog without sending anything."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.windows.extend",
   "kind": "button",
   "label": {
    "uz": "Oynani uzaytirish",
    "ru": "Продлить окно",
    "en": "Extend window"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to give the plan's teacher a later end of the plan window."
  },
  {
   "id": "features/plans/plan-requests.tsx#button:plans.windows.extend:2",
   "kind": "button",
   "label": {
    "uz": "Oynani uzaytirish",
    "ru": "Продлить окно",
    "en": "Extend window"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.windows.extendTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlanWindowsController_extend"
   ],
   "opens": null,
   "description": "Saves the new last day of the window for this teacher and closes the dialog."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.daysLabel",
   "kind": "field",
   "label": {
    "uz": "Ochiq oʻquv kunlari",
    "ru": "Учебных дней открыто",
    "en": "School days open"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.decideTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many school days, 1 to 10, the approved lessons stay open."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.decisionLabel",
   "kind": "field",
   "label": {
    "uz": "Qaror",
    "ru": "Решение",
    "en": "Decision"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.decideTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the request is approved or refused."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.firstLabel",
   "kind": "field",
   "label": {
    "uz": "Birinchi dars",
    "ru": "Первый урок",
    "en": "First lesson"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.askTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The first lesson the request covers; for a re-plan, the first lesson not yet held to re-plan from."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.keepLesson",
   "kind": "field",
   "label": {
    "uz": "… ga ruxsat",
    "ru": "Разрешить …",
    "en": "Allow …"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.decideTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "A tick for each lesson of the request; untick a lesson to leave it locked, giving a reason."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.kindLabel",
   "kind": "field",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.askTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The kind of request: text changes the wording of lessons; re-plan reopens the lessons not yet held from a first lesson on."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.lastLabel",
   "kind": "field",
   "label": {
    "uz": "Oxirgi dars",
    "ru": "Последний урок",
    "en": "Last lesson"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.askTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The last lesson a text request covers."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.reasonLabel",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.askTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Why the plan needs editing; required."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.requests.refuseReason",
   "kind": "field",
   "label": {
    "uz": "Rad etish sababi",
    "ru": "Причина отказа",
    "en": "Reason of the refusal"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.requests.decideTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Why the request is refused, or why lessons were unticked; a refusal changes nothing in the plan."
  },
  {
   "id": "features/plans/plan-requests.tsx#field:plans.windows.end",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": "features/plans/plan-requests.tsx#panel:plans.windows.extendTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The new last day of the plan window for this teacher."
  },
  {
   "id": "features/plans/plan-requests.tsx#panel:plans.requests.askTitle",
   "kind": "panel",
   "label": {
    "uz": "Rejani oʻzgartirishni soʻrash",
    "ru": "Запросить изменение плана",
    "en": "Ask to edit the plan"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for an edit request: the kind, the lessons and the reason."
  },
  {
   "id": "features/plans/plan-requests.tsx#panel:plans.requests.decideTitle",
   "kind": "panel",
   "label": {
    "uz": "Soʻrov boʻyicha qaror",
    "ru": "Решение по запросу",
    "en": "Decide the request"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for approving or refusing an edit request."
  },
  {
   "id": "features/plans/plan-requests.tsx#panel:plans.windows.extendTitle",
   "kind": "panel",
   "label": {
    "uz": "… uchun oynani uzaytirish",
    "ru": "Продлить окно для …",
    "en": "Extend the window for …"
   },
   "pages": [
    "/plans/$journalId",
    "/plans/requests"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for extending the plan window for one teacher."
  },
  {
   "id": "features/plans/plan-row-panel.tsx#button:plans.panel.clear",
   "kind": "button",
   "label": {
    "uz": "Qatorni tozalash",
    "ru": "Очистить строку",
    "en": "Clear row"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-row-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_clearItem"
   ],
   "opens": null,
   "description": "Clears the row of a lesson not yet held, after a confirmation; the history keeps what it held."
  },
  {
   "id": "features/plans/plan-row-panel.tsx#button:plans.panel.fill",
   "kind": "button",
   "label": {
    "uz": "Toʻldirish",
    "ru": "Заполнить",
    "en": "Fill in"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-row-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to fill in the empty row with a topic, works and files."
  },
  {
   "id": "features/plans/plan-row-panel.tsx#button:plans.panel.removeFileOf",
   "kind": "button",
   "label": {
    "uz": "… faylini oʻchirish",
    "ru": "Удалить …",
    "en": "Remove …"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-row-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes the file from the row, after a confirmation."
  },
  {
   "id": "features/plans/plan-row-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one plan row: the lesson's topic, objectives, links, works and files, read or edited."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.masterCopy.open",
   "kind": "button",
   "label": {
    "uz": "Master-rejadan nusxalash",
    "ru": "Скопировать из мастер-плана",
    "en": "Copy from a master"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to fill this plan from a master plan."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.share.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.shareTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_share"
   ],
   "opens": null,
   "description": "Closes the dialog without changing the plan."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.share.back:2",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.copyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_copy"
   ],
   "opens": null,
   "description": "Closes the dialog without changing the plan."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.share.copy",
   "kind": "button",
   "label": {
    "uz": "Rejadan nusxa olish",
    "ru": "Скопировать из плана",
    "en": "Copy from a plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to copy the items of another plan, from this year or another, into this plan."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.share.copySend",
   "kind": "button",
   "label": {
    "uz": "Nusxa olish",
    "ru": "Скопировать",
    "en": "Copy"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.copyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_copy"
   ],
   "opens": null,
   "description": "Copies the chosen plan's items into this plan and closes the dialog."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.share.separate",
   "kind": "button",
   "label": {
    "uz": "Ajratish",
    "ru": "Отделить",
    "en": "Separate"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_separate"
   ],
   "opens": null,
   "description": "Separates this class from the shared plan, after a confirmation; it keeps its own copy of every item."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.share.share",
   "kind": "button",
   "label": {
    "uz": "Rejani boʻlishish",
    "ru": "Объединить план",
    "en": "Share plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to share this plan with another class or group of the same language."
  },
  {
   "id": "features/plans/plan-sharing.tsx#button:plans.share.shareSend",
   "kind": "button",
   "label": {
    "uz": "Boʻlishish",
    "ru": "Объединить",
    "en": "Share"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.shareTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "PlansController_share"
   ],
   "opens": null,
   "description": "Shares the plan with the chosen class or group and closes the dialog."
  },
  {
   "id": "features/plans/plan-sharing.tsx#field:plans.share.copyPart",
   "kind": "field",
   "label": {
    "uz": "Mavzular",
    "ru": "Темы",
    "en": "Items"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.copyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether to copy all items or only the items of lessons not yet held."
  },
  {
   "id": "features/plans/plan-sharing.tsx#field:plans.share.copyQuarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.copyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The quarter of the source plan to copy."
  },
  {
   "id": "features/plans/plan-sharing.tsx#field:plans.share.copySource",
   "kind": "field",
   "label": {
    "uz": "Reja",
    "ru": "План",
    "en": "Plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.copyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The plan of the same subject to copy from."
  },
  {
   "id": "features/plans/plan-sharing.tsx#field:plans.share.copyYear",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.copyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The academic year to copy a plan from."
  },
  {
   "id": "features/plans/plan-sharing.tsx#field:plans.share.shareWith",
   "kind": "field",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": "features/plans/plan-sharing.tsx#panel:plans.share.shareTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group to share the plan with."
  },
  {
   "id": "features/plans/plan-sharing.tsx#panel:plans.share.copyTitle",
   "kind": "panel",
   "label": {
    "uz": "Boshqa reja mavzularidan nusxa olish",
    "ru": "Скопировать темы другого плана",
    "en": "Copy the items of another plan"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for copying the items of another plan of the same subject into this one, in order."
  },
  {
   "id": "features/plans/plan-sharing.tsx#panel:plans.share.shareTitle",
   "kind": "panel",
   "label": {
    "uz": "Bu rejani boshqa sinf yoki guruh bilan boʻlishing",
    "ru": "Сделать этот план общим с другим классом или группой",
    "en": "Share this plan with another class or group"
   },
   "pages": [
    "/plans/$journalId"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for sharing this plan with another class or group."
  },
  {
   "id": "features/plans/plan-windows-page.tsx#field:plans.windows.end",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/plans/windows"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The last day of the quarter's plan window; if lessons will be held without a plan before it, saving asks for confirmation."
  },
  {
   "id": "features/plans/plan-windows-page.tsx#field:plans.windows.start",
   "kind": "field",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/plans/windows"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day of the quarter's plan window, when teachers may write their plans."
  },
  {
   "id": "features/plans/plans-page.tsx#column:plans.page.class",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/plans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group of the plan; pressing it opens the plan."
  },
  {
   "id": "features/plans/plans-page.tsx#column:plans.page.quarter",
   "kind": "column",
   "label": {
    "uz": "…-chorak",
    "ru": "… четверть",
    "en": "Quarter …"
   },
   "pages": [
    "/plans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Where the plan of that quarter stands, with flags such as overdue, master updated or below the minimum."
  },
  {
   "id": "features/plans/plans-page.tsx#column:plans.page.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/plans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The subject of the plan."
  },
  {
   "id": "features/plans/plans-page.tsx#field:plans.page.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/plans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year whose plans are listed."
  },
  {
   "id": "features/plans/plans-page.tsx#tab:plans.page.tabs",
   "kind": "tab",
   "label": {
    "uz": "Sinflar yoki guruhlar",
    "ru": "Классы или группы",
    "en": "Classes or groups"
   },
   "pages": [
    "/plans"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the list between the plans of classes and the plans of groups."
  },
  {
   "id": "features/portal/digest-log-page.tsx#button:digest.log.earlier",
   "kind": "button",
   "label": {
    "uz": "Yangiroq",
    "ru": "Новее",
    "en": "Newer"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the previous page of digests."
  },
  {
   "id": "features/portal/digest-log-page.tsx#button:digest.log.later",
   "kind": "button",
   "label": {
    "uz": "Eskiroq",
    "ru": "Старее",
    "en": "Older"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the next page of digests."
  },
  {
   "id": "features/portal/digest-log-page.tsx#column:digest.log.attempts",
   "kind": "column",
   "label": {
    "uz": "Urinishlar",
    "ru": "Попытки",
    "en": "Attempts"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "How many times sending was tried."
  },
  {
   "id": "features/portal/digest-log-page.tsx#column:digest.log.children",
   "kind": "column",
   "label": {
    "uz": "Farzandlar",
    "ru": "Дети",
    "en": "Children"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent's children the digest covers."
  },
  {
   "id": "features/portal/digest-log-page.tsx#column:digest.log.date",
   "kind": "column",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The day the digest is for."
  },
  {
   "id": "features/portal/digest-log-page.tsx#column:digest.log.login",
   "kind": "column",
   "label": {
    "uz": "Login",
    "ru": "Логин",
    "en": "Login"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent's portal login."
  },
  {
   "id": "features/portal/digest-log-page.tsx#column:digest.log.parent",
   "kind": "column",
   "label": {
    "uz": "Ota-ona",
    "ru": "Родитель",
    "en": "Parent"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The parent the digest goes to."
  },
  {
   "id": "features/portal/digest-log-page.tsx#column:digest.log.sentAt",
   "kind": "column",
   "label": {
    "uz": "Yuborilgan vaqt",
    "ru": "Отправлено",
    "en": "Sent at"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "When the digest was sent."
  },
  {
   "id": "features/portal/digest-log-page.tsx#column:digest.log.status",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Whether the digest is waiting, delivered, not delivered, had nothing new, or had no linked or a blocked chat."
  },
  {
   "id": "features/portal/digest-log-page.tsx#field:digest.log.chooseDate",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "The day whose digests are listed."
  },
  {
   "id": "features/portal/digest-log-page.tsx#field:digest.log.status",
   "kind": "field",
   "label": {
    "uz": "Holat",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/people/digest-log"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows only the digests of one status, or all."
  },
  {
   "id": "features/results/attendance-report-page.tsx#column:results.reports.attendance.daily",
   "kind": "column",
   "label": {
    "uz": "Kunlik davomat",
    "ru": "Посещаемость за день",
    "en": "Daily attendance"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The daily attendance percent of the line over the chosen range."
  },
  {
   "id": "features/results/attendance-report-page.tsx#column:results.reports.attendance.date",
   "kind": "column",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The day of the line, when one class is chosen and the report lists its days."
  },
  {
   "id": "features/results/attendance-report-page.tsx#column:results.reports.attendance.exempt",
   "kind": "column",
   "label": {
    "uz": "Ozod",
    "ru": "Освобождён",
    "en": "Exempt"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many expected cells were marked exempt, with their share; exempt is counted apart from the other marks."
  },
  {
   "id": "features/results/attendance-report-page.tsx#column:results.reports.attendance.expected",
   "kind": "column",
   "label": {
    "uz": "Kutilgan",
    "ru": "Ожидалось",
    "en": "Expected"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many attendance cells were expected in the range, the total the shares are taken from."
  },
  {
   "id": "features/results/attendance-report-page.tsx#field:results.reports.attendance.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the report to one class; with a class chosen, the report lists one line per day."
  },
  {
   "id": "features/results/attendance-report-page.tsx#field:results.reports.attendance.grade",
   "kind": "field",
   "label": {
    "uz": "Parallel",
    "ru": "Параллель",
    "en": "Grade"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the report to one grade, or shows all grades."
  },
  {
   "id": "features/results/attendance-report-page.tsx#field:results.reports.attendance.period",
   "kind": "field",
   "label": {
    "uz": "Dars",
    "ru": "Урок",
    "en": "Period"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the report to the lessons that start at one time of day, or shows all periods."
  },
  {
   "id": "features/results/attendance-report-page.tsx#field:results.reports.attendance.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the report to the lessons of one subject, or shows all subjects."
  },
  {
   "id": "features/results/attendance-report-page.tsx#field:results.reports.attendance.teacher",
   "kind": "field",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the report to the lessons of one teacher, or shows all teachers."
  },
  {
   "id": "features/results/attendance-report-page.tsx#field:results.reports.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The first day of the range the report counts; it defaults to the Monday of this week."
  },
  {
   "id": "features/results/attendance-report-page.tsx#field:results.reports.to",
   "kind": "field",
   "label": {
    "uz": "Gacha",
    "ru": "По",
    "en": "To"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The last day of the range the report counts; it defaults to today."
  },
  {
   "id": "features/results/attendance-report-page.tsx#tab:results.reports.attendance.groupBy",
   "kind": "tab",
   "label": {
    "uz": "Qatorlar",
    "ru": "Строки",
    "en": "Rows"
   },
   "pages": [
    "/results/attendance"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the lines between one per class and one per Tutor or Class teacher."
  },
  {
   "id": "features/results/close-quarter-dialog.tsx#button:results.closing.close.action",
   "kind": "button",
   "label": {
    "uz": "Chorakni yopish",
    "ru": "Закрыть четверть",
    "en": "Close the quarter"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/close-quarter-dialog.tsx#panel:results.closing.close.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the quarter once every point is ticked or chosen; the results are stored as final."
  },
  {
   "id": "features/results/close-quarter-dialog.tsx#button:results.closing.close.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/close-quarter-dialog.tsx#panel:results.closing.close.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without closing the quarter."
  },
  {
   "id": "features/results/close-quarter-dialog.tsx#field:results.closing.close.startQuarter",
   "kind": "field",
   "label": {
    "uz": "Bu filialning boshlangʻich choragi",
    "ru": "Это стартовая четверть филиала",
    "en": "This is the start quarter of the branch"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/close-quarter-dialog.tsx#panel:results.closing.close.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "For the branch's start quarter: whether the platform results are kept as the quarter results or the quarter is not official and left out of the year result."
  },
  {
   "id": "features/results/close-quarter-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that closes the chosen quarter once nothing blocks it."
  },
  {
   "id": "features/results/close-quarter-dialog.tsx#panel:results.closing.close.title",
   "kind": "panel",
   "label": {
    "uz": "…-chorakni yopish",
    "ru": "Закрыть …-ю четверть",
    "en": "Close quarter …"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/close-quarter-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the quarter: its journals become read only for the branch and every result is stored as final. Warnings must be acknowledged first, and lock now ticked when lessons are still open."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.closing.clear",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Снять",
    "en": "Clear"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_decide"
   ],
   "opens": null,
   "description": "Clears the decision stored for this student's flagged result."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.closing.clear:2",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Снять",
    "en": "Clear"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_decideJournal"
   ],
   "opens": null,
   "description": "Clears the outdated decisions of every flagged student of the journal at once."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.closing.closeQuarter",
   "kind": "button",
   "label": {
    "uz": "Chorakni yopish",
    "ru": "Закрыть четверть",
    "en": "Close the quarter"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to close the quarter; it is available only when nothing blocks closing."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.closing.decisions.exempt",
   "kind": "button",
   "label": {
    "uz": "Ozod",
    "ru": "Освобождён",
    "en": "Exempt"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_decide"
   ],
   "opens": null,
   "description": "Decides one flagged result of a student: keep the number, exempt, or not assessed (one button for each)."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.closing.decisions.exempt:2",
   "kind": "button",
   "label": {
    "uz": "Ozod",
    "ru": "Освобождён",
    "en": "Exempt"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_decideJournal"
   ],
   "opens": null,
   "description": "Applies one decision, keep the number, exempt or not assessed, to every flagged student of the journal at once."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.closing.endPeriods",
   "kind": "button",
   "label": {
    "uz": "Rejani tahrirlash muddatlarini tugatish",
    "ru": "Завершить периоды изменения планов",
    "en": "End plan periods"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_endPlanPeriods"
   ],
   "opens": null,
   "description": "Ends every open plan editing period of the quarter, after a confirmation listing the journals."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.closing.remind",
   "kind": "button",
   "label": {
    "uz": "Oʻqituvchilarga eslatish",
    "ru": "Напомнить учителям",
    "en": "Remind teachers"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_remind"
   ],
   "opens": null,
   "description": "Sends a reminder to the teachers who still have items to finish in the quarter."
  },
  {
   "id": "features/results/closing-page.tsx#button:results.reopening.action",
   "kind": "button",
   "label": {
    "uz": "Qayta ochish",
    "ru": "Открыть заново",
    "en": "Reopen"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to reopen the closed quarter, for the whole branch or one journal."
  },
  {
   "id": "features/results/closing-page.tsx#column:results.closing.count",
   "kind": "column",
   "label": {
    "uz": "Soni",
    "ru": "Количество",
    "en": "Count"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "How many lessons, students or other entries the item counts."
  },
  {
   "id": "features/results/closing-page.tsx#column:results.closing.item",
   "kind": "column",
   "label": {
    "uz": "Band",
    "ru": "Пункт",
    "en": "Item"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "What is left to finish in the quarter, such as lessons with no attendance; pressing it opens the item's details in the side panel."
  },
  {
   "id": "features/results/closing-page.tsx#column:results.closing.severity",
   "kind": "column",
   "label": {
    "uz": "Taʼsiri",
    "ru": "Влияние",
    "en": "Effect"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "What the item does to the close: blocks closing, is locked when the quarter closes, or is a warning."
  },
  {
   "id": "features/results/closing-page.tsx#column:results.closing.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The subject of the journal the item concerns."
  },
  {
   "id": "features/results/closing-page.tsx#column:results.closing.teacher",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The teacher the item concerns."
  },
  {
   "id": "features/results/closing-page.tsx#column:results.closing.unit",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group of the journal the item concerns."
  },
  {
   "id": "features/results/closing-page.tsx#field:results.closing.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter whose closing checklist is shown."
  },
  {
   "id": "features/results/early-warning-page.tsx#button:results.earlyWarning.handle",
   "kind": "button",
   "label": {
    "uz": "Koʻrib chiqildi deb belgilash",
    "ru": "Отметить как решённое",
    "en": "Mark handled"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [
    "EarlyWarningController_handle"
   ],
   "opens": null,
   "description": "Marks the chosen reason handled and stores the note with it."
  },
  {
   "id": "features/results/early-warning-page.tsx#column:results.earlyWarning.attendance",
   "kind": "column",
   "label": {
    "uz": "Davomat",
    "ru": "Посещаемость",
    "en": "Attendance"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's attendance percent in the subject."
  },
  {
   "id": "features/results/early-warning-page.tsx#column:results.earlyWarning.reasons",
   "kind": "column",
   "label": {
    "uz": "Sabablar",
    "ru": "Причины",
    "en": "Reasons"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Why the student is listed, with the figure and the threshold: low result, result dropped, low attendance or absences in a row."
  },
  {
   "id": "features/results/early-warning-page.tsx#column:results.earlyWarning.result",
   "kind": "column",
   "label": {
    "uz": "Natija",
    "ru": "Итог",
    "en": "Result"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student's current result in the subject."
  },
  {
   "id": "features/results/early-warning-page.tsx#column:results.earlyWarning.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The student who needs attention; pressing it opens the reasons, figures and trend in the side panel."
  },
  {
   "id": "features/results/early-warning-page.tsx#column:results.earlyWarning.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The subject the warning is about."
  },
  {
   "id": "features/results/early-warning-page.tsx#column:results.earlyWarning.unit",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The class or group of the subject's journal."
  },
  {
   "id": "features/results/early-warning-page.tsx#field:results.earlyWarning.note",
   "kind": "field",
   "label": {
    "uz": "Xodimlar uchun izoh",
    "ru": "Заметка для сотрудников",
    "en": "Staff note"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "A note for staff only on what was done about the warning."
  },
  {
   "id": "features/results/early-warning-page.tsx#field:results.earlyWarning.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter whose early-warning list is shown."
  },
  {
   "id": "features/results/early-warning-page.tsx#field:results.earlyWarning.which",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/results/early-warning"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The reason to mark handled, when the student is listed for more than one."
  },
  {
   "id": "features/results/load-report-page.tsx#tab:results.reports.links.load",
   "kind": "tab",
   "label": {
    "uz": "Dars jadvali yuklamasi",
    "ru": "Нагрузка по расписанию",
    "en": "Timetable load"
   },
   "pages": [
    "/results/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the timetable load report between teachers, classes, rooms and free periods."
  },
  {
   "id": "features/results/rating-page.tsx#button:results.ratingList.excel",
   "kind": "button",
   "label": {
    "uz": "Excel",
    "ru": "Excel",
    "en": "Excel"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [
    "RatingController_export"
   ],
   "opens": null,
   "description": "Downloads the rating list shown as an Excel file."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.class",
   "kind": "column",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class ranked."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.figure",
   "kind": "column",
   "label": {
    "uz": "Natija",
    "ru": "Результат",
    "en": "Result"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The student's result in the subject, with one decimal, or the state of a result that is not a number."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.figure:2",
   "kind": "column",
   "label": {
    "uz": "Natija",
    "ru": "Результат",
    "en": "Result"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The student's result across all subjects of the class, with one decimal."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.figure:3",
   "kind": "column",
   "label": {
    "uz": "Natija",
    "ru": "Результат",
    "en": "Result"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The class's result, with one decimal."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.note",
   "kind": "column",
   "label": {
    "uz": "Izoh",
    "ru": "Примечание",
    "en": "Note"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Notes on the student's result, such as few lessons, attendance only, or left the subject on a date."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.place",
   "kind": "column",
   "label": {
    "uz": "Oʻrin",
    "ru": "Место",
    "en": "Place"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The place in the rating list."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.place:2",
   "kind": "column",
   "label": {
    "uz": "Oʻrin",
    "ru": "Место",
    "en": "Place"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The place in the rating list."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.place:3",
   "kind": "column",
   "label": {
    "uz": "Oʻrin",
    "ru": "Место",
    "en": "Place"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The place in the rating list."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The student ranked."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.student:2",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The student ranked."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.students",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Учеников",
    "en": "Students"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many students of the class are counted."
  },
  {
   "id": "features/results/rating-page.tsx#column:results.ratingList.subjects",
   "kind": "column",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many subjects the student's result counts, marked when fewer than the class has."
  },
  {
   "id": "features/results/rating-page.tsx#field:results.ratingList.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class whose students are ranked across all subjects."
  },
  {
   "id": "features/results/rating-page.tsx#field:results.ratingList.grade",
   "kind": "field",
   "label": {
    "uz": "Sinflar parallel",
    "ru": "Параллель",
    "en": "Grade"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the rating of classes to one grade, or ranks the classes of all grades."
  },
  {
   "id": "features/results/rating-page.tsx#field:results.ratingList.journal",
   "kind": "field",
   "label": {
    "uz": "Fan va sinf yoki guruh",
    "ru": "Предмет и класс или группа",
    "en": "Subject and class or group"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject and the class or group whose students are ranked."
  },
  {
   "id": "features/results/rating-page.tsx#field:results.ratingList.language",
   "kind": "field",
   "label": {
    "uz": "Til",
    "ru": "Язык",
    "en": "Language"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the lists and choices to one language of instruction, or shows all."
  },
  {
   "id": "features/results/rating-page.tsx#field:results.ratingList.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter of the rating; an open quarter's list is provisional."
  },
  {
   "id": "features/results/rating-page.tsx#field:results.ratingList.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Year"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year of the rating."
  },
  {
   "id": "features/results/rating-page.tsx#tab:results.ratingList.kind",
   "kind": "tab",
   "label": {
    "uz": "Roʻyxat",
    "ru": "Список",
    "en": "List"
   },
   "pages": [
    "/results/rating"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches between the rating in one subject, the rating of a class across subjects, and the rating of classes."
  },
  {
   "id": "features/results/reopening.tsx#button:results.closing.close.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.reopening.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without changing anything."
  },
  {
   "id": "features/results/reopening.tsx#button:results.closing.close.back:2",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.reopening.closeAgainTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without changing anything."
  },
  {
   "id": "features/results/reopening.tsx#button:results.closing.close.back:3",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.recalculation.applyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without changing anything."
  },
  {
   "id": "features/results/reopening.tsx#button:results.recalculation.apply",
   "kind": "button",
   "label": {
    "uz": "Sabab bilan qoʻllash",
    "ru": "Применить с причиной",
    "en": "Apply with a reason"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to apply the recalculated results with a reason."
  },
  {
   "id": "features/results/reopening.tsx#button:results.recalculation.apply:2",
   "kind": "button",
   "label": {
    "uz": "Sabab bilan qoʻllash",
    "ru": "Применить с причиной",
    "en": "Apply with a reason"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.recalculation.applyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_applyRecalculation"
   ],
   "opens": null,
   "description": "Applies the recalculated results with the reason typed and closes the dialog."
  },
  {
   "id": "features/results/reopening.tsx#button:results.recalculation.compare",
   "kind": "button",
   "label": {
    "uz": "Qayta hisoblash va solishtirish",
    "ru": "Пересчитать и сравнить",
    "en": "Recalculate and compare"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Recalculates the closed quarter's results and lists those that differ from the stored ones."
  },
  {
   "id": "features/results/reopening.tsx#button:results.reopening.action",
   "kind": "button",
   "label": {
    "uz": "Qayta ochish",
    "ru": "Открыть заново",
    "en": "Reopen"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.reopening.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ClosingController_reopen"
   ],
   "opens": null,
   "description": "Reopens the quarter as chosen; the stored results are kept as a version."
  },
  {
   "id": "features/results/reopening.tsx#button:results.reopening.closeAgain",
   "kind": "button",
   "label": {
    "uz": "Yana yopish",
    "ru": "Закрыть снова",
    "en": "Close again"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to close the reopened journal again; it is available once nothing blocks it."
  },
  {
   "id": "features/results/reopening.tsx#button:results.reopening.closeAgain:2",
   "kind": "button",
   "label": {
    "uz": "Yana yopish",
    "ru": "Закрыть снова",
    "en": "Close again"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.reopening.closeAgainTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the reopened journal again once its warnings are acknowledged, storing the changed results as a new version."
  },
  {
   "id": "features/results/reopening.tsx#field:results.reopening.days",
   "kind": "field",
   "label": {
    "uz": "Necha kunga, 1 dan 14 gacha",
    "ru": "На сколько дней, от 1 до 14",
    "en": "For how many days, 1 to 14"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.reopening.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "For how many days the quarter stays reopened, from 1 to 14."
  },
  {
   "id": "features/results/reopening.tsx#field:results.reopening.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.reopening.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Why the quarter is reopened; required and stored with the reopening."
  },
  {
   "id": "features/results/reopening.tsx#field:results.reopening.reason:2",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.recalculation.applyTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Why the recalculated results are applied; required."
  },
  {
   "id": "features/results/reopening.tsx#field:results.reopening.what",
   "kind": "field",
   "label": {
    "uz": "Nimani qayta ochish",
    "ru": "Что открыть",
    "en": "What to reopen"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": "features/results/reopening.tsx#panel:results.reopening.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "What to reopen: the whole branch or one closed journal."
  },
  {
   "id": "features/results/reopening.tsx#panel:results.recalculation.applyTitle",
   "kind": "panel",
   "label": {
    "uz": "… ta qayta hisoblangan natijani qoʻllash",
    "ru": "Применить … пересчитанного результата",
    "en": "Apply … recalculated results"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for replacing stored results with the recalculated ones, with a reason."
  },
  {
   "id": "features/results/reopening.tsx#panel:results.reopening.closeAgainTitle",
   "kind": "panel",
   "label": {
    "uz": "… ni yana yopish",
    "ru": "Закрыть … снова",
    "en": "Close … again"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for closing a reopened journal again, with the count of results that changed."
  },
  {
   "id": "features/results/reopening.tsx#panel:results.reopening.title",
   "kind": "panel",
   "label": {
    "uz": "Chorakni qayta ochish",
    "ru": "Открыть четверть заново",
    "en": "Reopen the quarter"
   },
   "pages": [
    "/results/closing"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for reopening a closed quarter for a number of days, for the whole branch or one journal, with a reason."
  },
  {
   "id": "features/results/report-parts.tsx#button:results.reports.excel",
   "kind": "button",
   "label": {
    "uz": "Excel",
    "ru": "Excel",
    "en": "Excel"
   },
   "pages": [
    "/journal/discipline",
    "/results/attendance",
    "/results/load",
    "/results/mastery",
    "/results/table"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Downloads the report shown, with its filters, as an Excel file."
  },
  {
   "id": "features/results/result-lessons-dialog.tsx#button:app.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/results/result-lessons-dialog.tsx#panel:results.lessonsTitle",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the lessons dialog."
  },
  {
   "id": "features/results/result-lessons-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that shows the lessons behind a figure of a student's results or attendance."
  },
  {
   "id": "features/results/result-lessons-dialog.tsx#panel:results.lessonsTitle",
   "kind": "panel",
   "label": {
    "uz": "Darslar",
    "ru": "Уроки",
    "en": "Lessons"
   },
   "pages": [
    "/people/students"
   ],
   "parent": "features/results/result-lessons-dialog.tsx#panel",
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Lists the student's counted lessons of the subject in the quarter, with the attendance mark and the works behind the figure."
  },
  {
   "id": "features/results/results-table-page.tsx#column:results.reports.table.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/results/table"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The student of the line; each subject column beside it shows the result and grade, or its state."
  },
  {
   "id": "features/results/results-table-page.tsx#field:results.reports.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/results/table"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter whose results are shown."
  },
  {
   "id": "features/results/results-table-page.tsx#field:results.reports.table.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/results/table"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class whose students are listed."
  },
  {
   "id": "features/results/student-attendance-tab.tsx#button:results.openLessons",
   "kind": "button",
   "label": {
    "uz": "…: «…» ortidagi darslar",
    "ru": "Уроки за показателем «…», …",
    "en": "Lessons behind …, …"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the lessons behind the student's attendance figure in the subject."
  },
  {
   "id": "features/results/student-attendance-tab.tsx#tab:results.quarter",
   "kind": "tab",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the student's attendance to another quarter."
  },
  {
   "id": "features/results/student-results-tab.tsx#tab:results.quarter",
   "kind": "tab",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/people/students"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the student's results to another quarter."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#column:results.reports.mastery.band",
   "kind": "column",
   "label": {
    "uz": "Oraliq",
    "ru": "Диапазон",
    "en": "Band"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The range of results that falls in the band."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#column:results.reports.mastery.mark",
   "kind": "column",
   "label": {
    "uz": "Baho",
    "ru": "Оценка",
    "en": "Grade"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The grade band, or a state counted beside the bands: exempt, not assessed or no result."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#column:results.reports.mastery.percent",
   "kind": "column",
   "label": {
    "uz": "Ulushi",
    "ru": "Доля",
    "en": "Share"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "The share of the students that falls in the band."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#column:results.reports.mastery.students",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchilar",
    "ru": "Учеников",
    "en": "Students"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "How many students fall in the band."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#field:results.reports.mastery.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the count to one class, or counts all classes."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#field:results.reports.mastery.grade",
   "kind": "field",
   "label": {
    "uz": "Parallel",
    "ru": "Параллель",
    "en": "Grade"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the count to one grade, or counts all grades."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#field:results.reports.mastery.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject whose grade bands are shown."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#field:results.reports.mastery.teacher",
   "kind": "field",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Narrows the count to one teacher's students, or counts all teachers."
  },
  {
   "id": "features/results/subject-mastery-page.tsx#field:results.reports.quarter",
   "kind": "field",
   "label": {
    "uz": "Chorak",
    "ru": "Четверть",
    "en": "Quarter"
   },
   "pages": [
    "/results/mastery"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter whose results are counted."
  },
  {
   "id": "features/setup/branch-page.tsx#field:setup.branch.address",
   "kind": "field",
   "label": {
    "uz": "Manzil",
    "ru": "Адрес",
    "en": "Address"
   },
   "pages": [
    "/setup/branch",
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the branch's street address."
  },
  {
   "id": "features/setup/branch-page.tsx#field:setup.branch.email",
   "kind": "field",
   "label": {
    "uz": "Elektron pochta",
    "ru": "Электронная почта",
    "en": "Email"
   },
   "pages": [
    "/setup/branch",
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the branch's contact email address."
  },
  {
   "id": "features/setup/branch-page.tsx#field:setup.branch.goLiveDate",
   "kind": "field",
   "label": {
    "uz": "Ishga tushirish sanasi",
    "ru": "Дата запуска",
    "en": "Go-live date"
   },
   "pages": [
    "/setup/branch",
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the branch starts using the platform: no dated lessons exist before it and the first timetable starts on it. It must lie in a planned or current year and on a school day; empty clears it."
  },
  {
   "id": "features/setup/branch-page.tsx#field:setup.branch.goLiveDate:2",
   "kind": "field",
   "label": {
    "uz": "Ishga tushirish sanasi",
    "ru": "Дата запуска",
    "en": "Go-live date"
   },
   "pages": [
    "/setup/branch",
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the branch starts using the platform: no dated lessons exist before it and the first timetable starts on it. It must lie in a planned or current year and on a school day; empty clears it."
  },
  {
   "id": "features/setup/branch-page.tsx#field:setup.branch.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/branch",
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the branch's name, shown in the branch list and the top bar."
  },
  {
   "id": "features/setup/branch-page.tsx#field:setup.branch.phone",
   "kind": "field",
   "label": {
    "uz": "Telefon",
    "ru": "Телефон",
    "en": "Phone"
   },
   "pages": [
    "/setup/branch",
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the branch's phone number: +998 and 9 digits."
  },
  {
   "id": "features/setup/branch-page.tsx#field:setup.branch.workingWeekdays",
   "kind": "field",
   "label": {
    "uz": "Ish kunlari",
    "ru": "Рабочие дни",
    "en": "Working weekdays"
   },
   "pages": [
    "/setup/branch",
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the weekdays the branch works; lessons are planned only on these days. A save that would leave the go-live date on a non-school day is refused."
  },
  {
   "id": "features/setup/branches-page.tsx#button:setup.branch.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new branch form without saving."
  },
  {
   "id": "features/setup/branches-page.tsx#button:setup.branch.newBranch",
   "kind": "button",
   "label": {
    "uz": "Yangi filial",
    "ru": "Новый филиал",
    "en": "New branch"
   },
   "pages": [
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new branch in the side panel: name, address, phone, email and working weekdays."
  },
  {
   "id": "features/setup/branches-page.tsx#column:setup.branches.address",
   "kind": "column",
   "label": {
    "uz": "Manzil",
    "ru": "Адрес",
    "en": "Address"
   },
   "pages": [
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the branch's address."
  },
  {
   "id": "features/setup/branches-page.tsx#column:setup.branches.buildings",
   "kind": "column",
   "label": {
    "uz": "Binolar",
    "ru": "Здания",
    "en": "Buildings"
   },
   "pages": [
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many buildings the branch has."
  },
  {
   "id": "features/setup/branches-page.tsx#column:setup.branches.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the branch's name; selecting it opens the branch."
  },
  {
   "id": "features/setup/branches-page.tsx#column:setup.branches.rooms",
   "kind": "column",
   "label": {
    "uz": "Xonalar",
    "ru": "Кабинеты",
    "en": "Rooms"
   },
   "pages": [
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many rooms the branch has."
  },
  {
   "id": "features/setup/branches-page.tsx#column:setup.branches.weekdays",
   "kind": "column",
   "label": {
    "uz": "Ish kunlari",
    "ru": "Рабочие дни",
    "en": "Working weekdays"
   },
   "pages": [
    "/setup/branches"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the weekdays the branch works."
  },
  {
   "id": "features/setup/building-panel.tsx#button:forcedDeletes.deletePlace",
   "kind": "button",
   "label": {
    "uz": "Butunlay oʻchirish",
    "ru": "Удалить окончательно",
    "en": "Delete for good"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Deletes the building and its floors for good after asking for a reason; shown only when no floor has a room. It can be restored from Deleted for good for 30 days."
  },
  {
   "id": "features/setup/building-panel.tsx#button:forcedDeletes.deletePlaceNamed",
   "kind": "button",
   "label": {
    "uz": "Butunlay oʻchirish: …",
    "ru": "Удалить … окончательно",
    "en": "Delete … for good"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Deletes the floor for good after asking for a reason; shown only for a floor with no rooms. It can be restored from Deleted for good for 30 days."
  },
  {
   "id": "features/setup/building-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the building's name for editing in the panel."
  },
  {
   "id": "features/setup/building-panel.tsx#button:setup.buildings.addFloor",
   "kind": "button",
   "label": {
    "uz": "Qavat qoʻshish",
    "ru": "Добавить этаж",
    "en": "Add floor"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form under the floors to add a new floor to the building."
  },
  {
   "id": "features/setup/building-panel.tsx#button:setup.buildings.archiveBuilding",
   "kind": "button",
   "label": {
    "uz": "Binoni arxivlash",
    "ru": "Отправить здание в архив",
    "en": "Archive building"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Archives the building and its floors after a confirmation; refused while a room in it is in use or under repair. It can be restored."
  },
  {
   "id": "features/setup/building-panel.tsx#button:setup.buildings.archiveNamed",
   "kind": "button",
   "label": {
    "uz": "… qavatini arxivlash",
    "ru": "Отправить в архив этаж …",
    "en": "Archive floor …"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Archives the floor after a confirmation, only when every room on it is closed; on an archived floor the same button restores it."
  },
  {
   "id": "features/setup/building-panel.tsx#button:setup.buildings.renameNamed",
   "kind": "button",
   "label": {
    "uz": "… qavati nomini oʻzgartirish",
    "ru": "Переименовать этаж …",
    "en": "Rename floor …"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the floor's name in its row for editing; Save keeps the new name."
  },
  {
   "id": "features/setup/building-panel.tsx#button:setup.buildings.restoreBuilding",
   "kind": "button",
   "label": {
    "uz": "Binoni tiklash",
    "ru": "Восстановить здание",
    "en": "Restore building"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Restores the archived building after a confirmation, with the floors that were archived with it."
  },
  {
   "id": "features/setup/building-panel.tsx#field:setup.buildings.floorName",
   "kind": "field",
   "label": {
    "uz": "Nomi yoki raqami",
    "ru": "Название или номер",
    "en": "Name or number"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds a floor's name or number, used when rooms are placed on it."
  },
  {
   "id": "features/setup/building-panel.tsx#field:setup.buildings.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the building's name, unique among the branch's active buildings."
  },
  {
   "id": "features/setup/building-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/buildings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one building: its name, status and floors with their room counts, and the actions to rename, add, archive or delete floors and to edit or archive the building."
  },
  {
   "id": "features/setup/building-panel.tsx#panel:forcedDeletes.placeTitle_building",
   "kind": "panel",
   "label": {
    "uz": "… binosini butunlay oʻchirish",
    "ru": "Удалить здание … окончательно",
    "en": "Delete the building … for good"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": "features/setup/building-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that deletes the building for good: it asks for the reason and says the building is kept 30 days and can be restored from Deleted for good."
  },
  {
   "id": "features/setup/buildings-page.tsx#button:setup.buildings.add",
   "kind": "button",
   "label": {
    "uz": "Bino qoʻshish",
    "ru": "Добавить здание",
    "en": "Add building"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new building in the side panel."
  },
  {
   "id": "features/setup/buildings-page.tsx#button:setup.buildings.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new building form without saving."
  },
  {
   "id": "features/setup/buildings-page.tsx#column:setup.buildings.floors",
   "kind": "column",
   "label": {
    "uz": "Qavatlar",
    "ru": "Этажи",
    "en": "Floors"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many active floors the building has."
  },
  {
   "id": "features/setup/buildings-page.tsx#column:setup.buildings.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the building's name; selecting it opens the building in the side panel."
  },
  {
   "id": "features/setup/buildings-page.tsx#column:setup.buildings.rooms",
   "kind": "column",
   "label": {
    "uz": "Xonalar",
    "ru": "Кабинеты",
    "en": "Rooms"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many rooms are on the building's floors."
  },
  {
   "id": "features/setup/buildings-page.tsx#column:setup.buildings.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/setup/buildings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the building is active or archived."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.examWeek",
   "kind": "field",
   "label": {
    "uz": "Imtihon haftasi",
    "ru": "Неделя экзаменов",
    "en": "Exam week"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Marks the special day as part of an exam week, with or without regular lessons, or not an exam week."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.firstDate",
   "kind": "field",
   "label": {
    "uz": "Birinchi sana",
    "ru": "Первая дата",
    "en": "First date"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first date the entry covers."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.follows",
   "kind": "field",
   "label": {
    "uz": "Qaysi kun darslari",
    "ru": "Уроки дня",
    "en": "Lessons of"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whose lessons the special day holds: its own weekday's, or another weekday's when the date is not a working weekday."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.gradeFrom",
   "kind": "field",
   "label": {
    "uz": "Qaysi sinfdan",
    "ru": "С класса",
    "en": "From grade"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the lowest grade the entry covers when it is for some grades."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.gradeTo",
   "kind": "field",
   "label": {
    "uz": "Qaysi sinfgacha",
    "ru": "По класс",
    "en": "To grade"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the highest grade the entry covers when it is for some grades."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.kind",
   "kind": "field",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the new entry is a day off (no lessons) or a special day (lessons on another day template)."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.lastDate",
   "kind": "field",
   "label": {
    "uz": "Oxirgi sana",
    "ru": "Последняя дата",
    "en": "Last date"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the last date the entry covers; for a started entry it is the only date that can still change."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the entry's name, such as the holiday or event it marks."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.scope",
   "kind": "field",
   "label": {
    "uz": "Kimlar uchun",
    "ru": "Для",
    "en": "For"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the entry holds for the whole branch or only for a range of grades."
  },
  {
   "id": "features/setup/calendar-entry-form.tsx#field:setup.calendar.template",
   "kind": "field",
   "label": {
    "uz": "Kun shabloni",
    "ru": "Шаблон дня",
    "en": "Day template"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the day template whose times the special day follows."
  },
  {
   "id": "features/setup/calendar-entry-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": "features/setup/calendar-entry-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the entry's form; a started entry offers only its name and last date. A save that changes dates first shows what it does to the published timetable."
  },
  {
   "id": "features/setup/calendar-entry-panel.tsx#button:setup.calendar.archive",
   "kind": "button",
   "label": {
    "uz": "Arxivlash",
    "ru": "В архив",
    "en": "Archive"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": "features/setup/calendar-entry-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "CalendarController_archive",
    "CalendarController_restore"
   ],
   "opens": null,
   "description": "Archives the entry after showing what it changes in the published timetable; it can be restored."
  },
  {
   "id": "features/setup/calendar-entry-panel.tsx#button:setup.calendar.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": "features/setup/calendar-entry-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "CalendarController_archive",
    "CalendarController_restore"
   ],
   "opens": null,
   "description": "Restores the archived entry after showing what it changes in the published timetable."
  },
  {
   "id": "features/setup/calendar-entry-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one calendar entry: its kind, dates, grades and, for a special day, its template, weekday and exam week, with the actions to edit, archive or restore it."
  },
  {
   "id": "features/setup/calendar-exams-preview.tsx#field:setup.calendar.lessons.exams.block",
   "kind": "field",
   "label": {
    "uz": "… imtihon topshiradi, lekin uning darsi topshirmaydigan sinflar bilan umumiy: …",
    "ru": "… сдаёт экзамен, но его урок общий с классами, которые не сдают: …",
    "en": "… sits the exam, but its lesson is shared with classes that do not sit: …"
   },
   "pages": [
    "/setup/day-template-settings",
    "/setup/years",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Asks, for a class that sits an exam in a lesson shared with classes that do not, whether to cancel the whole lesson or keep it for the other classes; the save waits for a choice."
  },
  {
   "id": "features/setup/calendar-page.tsx#button:setup.calendar.add",
   "kind": "button",
   "label": {
    "uz": "Yozuv qoʻshish",
    "ru": "Добавить запись",
    "en": "Add entry"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new day off or special day in the side panel."
  },
  {
   "id": "features/setup/calendar-page.tsx#button:setup.calendar.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new calendar entry form without saving."
  },
  {
   "id": "features/setup/calendar-page.tsx#column:setup.calendar.dates",
   "kind": "column",
   "label": {
    "uz": "Sanalar",
    "ru": "Даты",
    "en": "Dates"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the first and last date of the entry."
  },
  {
   "id": "features/setup/calendar-page.tsx#column:setup.calendar.kind",
   "kind": "column",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the entry is a day off or a special day."
  },
  {
   "id": "features/setup/calendar-page.tsx#column:setup.calendar.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the entry's name; selecting it opens the entry in the side panel."
  },
  {
   "id": "features/setup/calendar-page.tsx#column:setup.calendar.scope",
   "kind": "column",
   "label": {
    "uz": "Kimlar uchun",
    "ru": "Для",
    "en": "For"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the entry is for the whole branch or for a range of grades."
  },
  {
   "id": "features/setup/calendar-page.tsx#column:setup.calendar.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the entry is active or archived."
  },
  {
   "id": "features/setup/calendar-page.tsx#column:setup.calendar.template",
   "kind": "column",
   "label": {
    "uz": "Kun shabloni",
    "ru": "Шаблон дня",
    "en": "Day template"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the day template of a special day."
  },
  {
   "id": "features/setup/calendar-page.tsx#field:setup.calendar.checkDate",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/setup/calendar"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds a date to check; the table under it shows, grade by grade, which day template or reason for no lessons that date has."
  },
  {
   "id": "features/setup/calendar-shortened.tsx#button:timetable.publish.shortened.reset",
   "kind": "button",
   "label": {
    "uz": "Avvalgi holatga qaytarish",
    "ru": "Вернуть как было",
    "en": "Back to the default"
   },
   "pages": [
    "/setup/day-template-settings",
    "/setup/years",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Clears the lessons ticked for a class on a shortened day, so its lessons are kept by their order in the day again."
  },
  {
   "id": "features/setup/day-template-form.tsx#field:setup.dayTemplates.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the new slots or start time take effect, tomorrow at the earliest."
  },
  {
   "id": "features/setup/day-template-form.tsx#field:setup.dayTemplates.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new day template's name."
  },
  {
   "id": "features/setup/day-template-form.tsx#field:setup.dayTemplates.slots",
   "kind": "field",
   "label": {
    "uz": "Tartibdagi slotlar",
    "ru": "Слоты по порядку",
    "en": "Slots in order"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the lessons and breaks of the day in order; each is added from the active slot types and shows its times, worked out from the start time and lengths."
  },
  {
   "id": "features/setup/day-template-form.tsx#field:setup.dayTemplates.startTime",
   "kind": "field",
   "label": {
    "uz": "Boshlanish vaqti",
    "ru": "Время начала",
    "en": "Start time"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the time the first slot of the day starts; the times of the other slots follow from it."
  },
  {
   "id": "features/setup/day-template-form.tsx#field:setup.dayTemplates.startTime:2",
   "kind": "field",
   "label": {
    "uz": "Boshlanish vaqti",
    "ru": "Время начала",
    "en": "Start time"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the start time of the day from the chosen date; earlier days keep their times."
  },
  {
   "id": "features/setup/day-template-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": "features/setup/day-template-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the day template's name for editing."
  },
  {
   "id": "features/setup/day-template-panel.tsx#button:setup.dayTemplates.archive",
   "kind": "button",
   "label": {
    "uz": "Arxivlash",
    "ru": "В архив",
    "en": "Archive"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": "features/setup/day-template-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayTemplatesController_archiveTemplate",
    "DayTemplatesController_restoreTemplate"
   ],
   "opens": null,
   "description": "Archives the day template after a confirmation; it can no longer be set for the branch, past days keep their times, and it can be restored."
  },
  {
   "id": "features/setup/day-template-panel.tsx#button:setup.dayTemplates.changeSlots",
   "kind": "button",
   "label": {
    "uz": "Sanadan boshlab yangi slotlar yoki boshlanish vaqti",
    "ru": "Новые слоты или время начала с даты",
    "en": "New slots or start time from a date"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": "features/setup/day-template-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form for new slots or a new start time from a date; Save first shows what the change does to the published timetable."
  },
  {
   "id": "features/setup/day-template-panel.tsx#button:setup.dayTemplates.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": "features/setup/day-template-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayTemplatesController_archiveTemplate",
    "DayTemplatesController_restoreTemplate"
   ],
   "opens": null,
   "description": "Restores the archived day template after a confirmation."
  },
  {
   "id": "features/setup/day-template-panel.tsx#field:setup.dayTemplates.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": "features/setup/day-template-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the day template's name when it is renamed."
  },
  {
   "id": "features/setup/day-template-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one day template: the day as it runs tomorrow, its versions by date, and the actions to rename it, change its slots from a date, archive or restore it."
  },
  {
   "id": "features/setup/day-templates-page.tsx#button:setup.dayTemplates.add",
   "kind": "button",
   "label": {
    "uz": "Kun shablonini qoʻshish",
    "ru": "Добавить шаблон дня",
    "en": "Add day template"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new day template: name, start time and slots in order."
  },
  {
   "id": "features/setup/day-templates-page.tsx#button:setup.dayTemplates.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new day template form without saving."
  },
  {
   "id": "features/setup/day-templates-page.tsx#column:setup.dayTemplates.day",
   "kind": "column",
   "label": {
    "uz": "Bugungi kun",
    "ru": "День сегодня",
    "en": "Day today"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows when the template's day starts and ends today."
  },
  {
   "id": "features/setup/day-templates-page.tsx#column:setup.dayTemplates.lessonSlots",
   "kind": "column",
   "label": {
    "uz": "Dars slotlari",
    "ru": "Урочных слотов",
    "en": "Lesson slots"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many lesson slots the template's day has."
  },
  {
   "id": "features/setup/day-templates-page.tsx#column:setup.dayTemplates.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the template's name; selecting it opens the template in the side panel."
  },
  {
   "id": "features/setup/day-templates-page.tsx#column:setup.dayTemplates.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the template is active or archived."
  },
  {
   "id": "features/setup/day-templates-page.tsx#column:setup.dayTemplates.use",
   "kind": "column",
   "label": {
    "uz": "Qoʻllanishi",
    "ru": "Применение",
    "en": "Use"
   },
   "pages": [
    "/setup/day-templates"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the template is set anywhere for the branch."
  },
  {
   "id": "features/setup/demo-clock-page.tsx#button:setup.demoClock.moveChosen",
   "kind": "button",
   "label": {
    "uz": "Shu vaqtga surish",
    "ru": "Перевести на это время",
    "en": "Move to this time"
   },
   "pages": [
    "/setup/demo-clock"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [
    "DemoClockController_jump",
    "DemoClockController_read"
   ],
   "opens": null,
   "description": "Moves demo time to the date and time typed, after a confirmation; it cannot be undone and everyone signed in sees the new time."
  },
  {
   "id": "features/setup/demo-clock-page.tsx#button:setup.demoClock.quick.hour",
   "kind": "button",
   "label": {
    "uz": "+1 soat",
    "ru": "+1 час",
    "en": "+1 hour"
   },
   "pages": [
    "/setup/demo-clock"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [
    "DemoClockController_jump",
    "DemoClockController_read"
   ],
   "opens": null,
   "description": "Moves demo time forward by one hour after a confirmation; the buttons beside it move it to tomorrow 07:05 or next Monday 09:05. Demo time never moves back."
  },
  {
   "id": "features/setup/demo-clock-page.tsx#field:setup.demoClock.date",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/setup/demo-clock"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date to move demo time to."
  },
  {
   "id": "features/setup/demo-clock-page.tsx#field:setup.demoClock.time",
   "kind": "field",
   "label": {
    "uz": "Vaqt (filial vaqti)",
    "ru": "Время (время филиала)",
    "en": "Time (branch time)"
   },
   "pages": [
    "/setup/demo-clock"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the time, in branch time, to move demo time to."
  },
  {
   "id": "features/setup/digest-settings-section.tsx#field:digest.settings.quietFrom",
   "kind": "field",
   "label": {
    "uz": "Tinch soatlar boshlanishi",
    "ru": "Тихие часы с",
    "en": "Quiet hours from"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds when the quiet hours start; no digest is sent between this time and the end of the quiet hours."
  },
  {
   "id": "features/setup/digest-settings-section.tsx#field:digest.settings.quietUntil",
   "kind": "field",
   "label": {
    "uz": "Tinch soatlar tugashi",
    "ru": "Тихие часы до",
    "en": "Quiet hours until"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds when the quiet hours end; a digest held back during them is sent then."
  },
  {
   "id": "features/setup/digest-settings-section.tsx#field:digest.settings.sendAt",
   "kind": "field",
   "label": {
    "uz": "Xabarnoma vaqti",
    "ru": "Время сводки",
    "en": "Time of the digest"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the time of day, Tashkent time, the parents' digest is sent; it must lie outside the quiet hours."
  },
  {
   "id": "features/setup/division-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": "features/setup/division-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the division's names in Uzbek, Russian and English for editing."
  },
  {
   "id": "features/setup/division-panel.tsx#button:setup.divisions.addDepartment",
   "kind": "button",
   "label": {
    "uz": "Kafedra qoʻshish",
    "ru": "Добавить кафедру",
    "en": "Add department"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": "features/setup/division-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to add a department to the division, with its name in three languages."
  },
  {
   "id": "features/setup/division-panel.tsx#button:setup.divisions.archiveDivision",
   "kind": "button",
   "label": {
    "uz": "Boʻlimni arxivlash",
    "ru": "Отправить отдел в архив",
    "en": "Archive division"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": "features/setup/division-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Archives the division and its departments after a confirmation; refused while staff members are in it. It can be restored."
  },
  {
   "id": "features/setup/division-panel.tsx#button:setup.divisions.archiveNamed",
   "kind": "button",
   "label": {
    "uz": "… kafedrasini arxivlash",
    "ru": "Отправить в архив кафедру …",
    "en": "Archive department …"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": "features/setup/division-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Archives the department after a confirmation; on an archived department the same button restores it."
  },
  {
   "id": "features/setup/division-panel.tsx#button:setup.divisions.renameNamed",
   "kind": "button",
   "label": {
    "uz": "… kafedrasi nomini oʻzgartirish",
    "ru": "Переименовать кафедру …",
    "en": "Rename department …"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": "features/setup/division-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the department's names in its row for editing in the three languages."
  },
  {
   "id": "features/setup/division-panel.tsx#button:setup.divisions.restoreDivision",
   "kind": "button",
   "label": {
    "uz": "Boʻlimni tiklash",
    "ru": "Восстановить отдел",
    "en": "Restore division"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": "features/setup/division-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Restores the archived division after a confirmation, with the departments archived with it."
  },
  {
   "id": "features/setup/division-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/divisions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one division: its names, status and departments, with the actions to rename, add or archive departments and to edit, archive or restore the division."
  },
  {
   "id": "features/setup/divisions-page.tsx#button:setup.divisions.add",
   "kind": "button",
   "label": {
    "uz": "Boʻlim qoʻshish",
    "ru": "Добавить отдел",
    "en": "Add division"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new division, with its name in three languages."
  },
  {
   "id": "features/setup/divisions-page.tsx#button:setup.divisions.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new division form without saving."
  },
  {
   "id": "features/setup/divisions-page.tsx#column:setup.divisions.departments",
   "kind": "column",
   "label": {
    "uz": "Kafedralar",
    "ru": "Кафедры",
    "en": "Departments"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many active departments the division has."
  },
  {
   "id": "features/setup/divisions-page.tsx#column:setup.divisions.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the division's name; selecting it opens the division in the side panel."
  },
  {
   "id": "features/setup/divisions-page.tsx#column:setup.divisions.staff",
   "kind": "column",
   "label": {
    "uz": "Xodimlar",
    "ru": "Сотрудники",
    "en": "Staff"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many staff members are in the division."
  },
  {
   "id": "features/setup/divisions-page.tsx#column:setup.divisions.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/setup/divisions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the division is active or archived."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#button:people.import.reading",
   "kind": "button",
   "label": {
    "uz": "Fayl oʻqilmoqda…",
    "ru": "Читаем файл…",
    "en": "Reading the file…"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Uploads the filled Excel file of past marks and shows the first page of its preview, every row with its problems; nothing is saved yet."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#button:people.import.template",
   "kind": "button",
   "label": {
    "uz": "Shablonni yuklab olish",
    "ru": "Скачать шаблон",
    "en": "Download the template"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "PastMarksController_template"
   ],
   "opens": null,
   "description": "Downloads the Excel template of past marks, with headings in three languages."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#button:setup.pastMarks.confirm",
   "kind": "button",
   "label": {
    "uz": "Barcha … ta qatorni saqlash",
    "ru": "Сохранить все … строки",
    "en": "Save all … rows"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "PastMarksController_confirm"
   ],
   "opens": null,
   "description": "Saves every row of the file at once; it stays off until every row is clean."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#button:setup.pastMarks.next",
   "kind": "button",
   "label": {
    "uz": "Keyingi",
    "ru": "Далее",
    "en": "Next"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "PastMarksController_preview"
   ],
   "opens": null,
   "description": "Shows the next page of the preview; rows with problems come first."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#button:setup.pastMarks.previous",
   "kind": "button",
   "label": {
    "uz": "Oldingi",
    "ru": "Назад",
    "en": "Previous"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "PastMarksController_preview"
   ],
   "opens": null,
   "description": "Shows the previous page of the preview."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#column:people.import.problemsColumn",
   "kind": "column",
   "label": {
    "uz": "Xatolar",
    "ru": "Ошибки",
    "en": "Problems"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows what is wrong with the row, each problem with its column, or that it is clean."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#column:people.import.row",
   "kind": "column",
   "label": {
    "uz": "Qator",
    "ru": "Строка",
    "en": "Row"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the row number in the uploaded file."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#column:setup.pastMarks.date",
   "kind": "column",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the date of the lesson as read from the row."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#column:setup.pastMarks.student",
   "kind": "column",
   "label": {
    "uz": "Oʻquvchi",
    "ru": "Ученик",
    "en": "Student"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the UID and the name as read from the row."
  },
  {
   "id": "features/setup/past-mark-import-page.tsx#column:setup.pastMarks.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/setup/past-marks/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject as read from the row."
  },
  {
   "id": "features/setup/past-marks-page.tsx#button:setup.pastMarks.keep",
   "kind": "button",
   "label": {
    "uz": "Qoldirish",
    "ru": "Оставить",
    "en": "Keep it"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": "features/setup/past-marks-page.tsx#panel:setup.pastMarks.withdrawTitle",
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "PastMarksController_withdraw"
   ],
   "opens": null,
   "description": "Closes the dialog without withdrawing anything."
  },
  {
   "id": "features/setup/past-marks-page.tsx#button:setup.pastMarks.withdraw",
   "kind": "button",
   "label": {
    "uz": "Qaytarib olish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the dialog to withdraw the whole upload with a reason."
  },
  {
   "id": "features/setup/past-marks-page.tsx#button:setup.pastMarks.withdraw:2",
   "kind": "button",
   "label": {
    "uz": "Qaytarib olish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": "features/setup/past-marks-page.tsx#panel:setup.pastMarks.withdrawTitle",
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "PastMarksController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws the upload with the reason typed."
  },
  {
   "id": "features/setup/past-marks-page.tsx#column:setup.pastMarks.at",
   "kind": "column",
   "label": {
    "uz": "Saqlangan",
    "ru": "Сохранено",
    "en": "Saved"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows when the upload was saved."
  },
  {
   "id": "features/setup/past-marks-page.tsx#column:setup.pastMarks.by",
   "kind": "column",
   "label": {
    "uz": "Kim saqlagan",
    "ru": "Кто сохранил",
    "en": "Saved by"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows who saved the upload."
  },
  {
   "id": "features/setup/past-marks-page.tsx#column:setup.pastMarks.fileName",
   "kind": "column",
   "label": {
    "uz": "Fayl",
    "ru": "Файл",
    "en": "File"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the name of the uploaded file; selecting it opens the upload in the side panel."
  },
  {
   "id": "features/setup/past-marks-page.tsx#column:setup.pastMarks.rows",
   "kind": "column",
   "label": {
    "uz": "Qatorlar",
    "ru": "Строк",
    "en": "Rows"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many rows the file held."
  },
  {
   "id": "features/setup/past-marks-page.tsx#column:setup.pastMarks.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the upload stands (its marks are shown to parents) or was withdrawn."
  },
  {
   "id": "features/setup/past-marks-page.tsx#field:setup.pastMarks.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": "features/setup/past-marks-page.tsx#panel:setup.pastMarks.withdrawTitle",
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The reason the upload is withdrawn; it is required and kept with the upload."
  },
  {
   "id": "features/setup/past-marks-page.tsx#panel:setup.pastMarks.withdrawTitle",
   "kind": "panel",
   "label": {
    "uz": "… ni qaytarib olish",
    "ru": "Отозвать …",
    "en": "Withdraw …"
   },
   "pages": [
    "/setup/past-marks"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that withdraws an upload of past marks: its rows are kept but no longer shown to parents, and the same file can then be imported again."
  },
  {
   "id": "features/setup/quarters-preview.tsx#button:setup.years.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/quarters-preview.tsx#panel:setup.years.preview.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the preview and goes back to the quarters form with nothing saved."
  },
  {
   "id": "features/setup/quarters-preview.tsx#button:setup.years.preview.save",
   "kind": "button",
   "label": {
    "uz": "Choraklarni saqlash",
    "ru": "Сохранить четверти",
    "en": "Save the quarters"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/quarters-preview.tsx#panel:setup.years.preview.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Saves the new quarter dates with the choices made; it stays off while something stops the save or a choice is missing."
  },
  {
   "id": "features/setup/quarters-preview.tsx#panel:setup.years.preview.title",
   "kind": "panel",
   "label": {
    "uz": "Chorak sanalari nimani oʻzgartiradi",
    "ru": "Что меняют новые даты четвертей",
    "en": "What the new quarter dates change"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that shows what new quarter dates do to the published timetable before they are saved: what stops the save, lessons that change quarter, lessons removed or created, and choices to make."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.building",
   "kind": "field",
   "label": {
    "uz": "Bino",
    "ru": "Здание",
    "en": "Building"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the building the room is in; its floors are offered next."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.capacity",
   "kind": "field",
   "label": {
    "uz": "Sigʻimi",
    "ru": "Вместимость",
    "en": "Capacity"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds how many students the room seats."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.floor",
   "kind": "field",
   "label": {
    "uz": "Qavat",
    "ru": "Этаж",
    "en": "Floor"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the floor of the building the room is on."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.maxLessons",
   "kind": "field",
   "label": {
    "uz": "Bir vaqtdagi darslar soni",
    "ru": "Уроков одновременно",
    "en": "Lessons at the same time"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds how many lessons a shared room can hold at the same time."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.name",
   "kind": "field",
   "label": {
    "uz": "Nomi yoki raqami",
    "ru": "Название или номер",
    "en": "Name or number"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the room's name or number."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.sharedSwitch",
   "kind": "field",
   "label": {
    "uz": "Umumiy: bir vaqtda bir nechta dars oʻtkaziladi",
    "ru": "Общий: вмещает несколько уроков одновременно",
    "en": "Shared: holds several lessons at the same time"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Marks the room as shared, so it can hold several lessons at the same time."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.status",
   "kind": "field",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the room is in use, under repair or closed; only rooms in use take lessons."
  },
  {
   "id": "features/setup/room-form.tsx#field:setup.rooms.type",
   "kind": "field",
   "label": {
    "uz": "Turi",
    "ru": "Тип",
    "en": "Type"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room's type: classroom, laboratory, sports hall, hall or other. The timetable uses it when a lesson needs a kind of room."
  },
  {
   "id": "features/setup/room-panel.tsx#button:forcedDeletes.deletePlace",
   "kind": "button",
   "label": {
    "uz": "Butunlay oʻchirish",
    "ru": "Удалить окончательно",
    "en": "Delete for good"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": "features/setup/room-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Deletes the room for good after asking for a reason; only a room nothing uses can be deleted. It can be restored from Deleted for good for 30 days."
  },
  {
   "id": "features/setup/room-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": "features/setup/room-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the room's form for editing: name, place, type, capacity, status and sharing."
  },
  {
   "id": "features/setup/room-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one room: its building, floor, type, capacity, status and sharing, with the actions to edit it or delete it for good."
  },
  {
   "id": "features/setup/room-panel.tsx#panel:forcedDeletes.placeTitle_room",
   "kind": "panel",
   "label": {
    "uz": "… xonasini butunlay oʻchirish",
    "ru": "Удалить кабинет … окончательно",
    "en": "Delete the room … for good"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": "features/setup/room-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that deletes the room for good: it asks for the reason and says the room is kept 30 days and can be restored from Deleted for good."
  },
  {
   "id": "features/setup/rooms-by-floor.tsx#button:setup.rooms.buildingCards",
   "kind": "button",
   "label": {
    "uz": "…, … ta xona koʻrsatilgan",
    "ru": "…, показано … кабинета",
    "en": "…, … rooms shown"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the by-floor view to this building, showing its floors and room cards; the number is how many rooms are shown."
  },
  {
   "id": "features/setup/rooms-by-floor.tsx#button:setup.rooms.types.other",
   "kind": "button",
   "label": {
    "uz": "Boshqa",
    "ru": "Другое",
    "en": "Other"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "A room card on the floor plan, showing its name, type, seats and sharing; pressing it opens the room in the side panel."
  },
  {
   "id": "features/setup/rooms-page.tsx#button:setup.rooms.add",
   "kind": "button",
   "label": {
    "uz": "Xona qoʻshish",
    "ru": "Добавить кабинет",
    "en": "Add room"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new room in the side panel."
  },
  {
   "id": "features/setup/rooms-page.tsx#button:setup.rooms.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new room form without saving."
  },
  {
   "id": "features/setup/rooms-page.tsx#column:setup.rooms.building",
   "kind": "column",
   "label": {
    "uz": "Bino",
    "ru": "Здание",
    "en": "Building"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the building the room is in."
  },
  {
   "id": "features/setup/rooms-page.tsx#column:setup.rooms.capacity",
   "kind": "column",
   "label": {
    "uz": "Sigʻimi",
    "ru": "Вместимость",
    "en": "Capacity"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many students the room seats."
  },
  {
   "id": "features/setup/rooms-page.tsx#column:setup.rooms.floor",
   "kind": "column",
   "label": {
    "uz": "Qavat",
    "ru": "Этаж",
    "en": "Floor"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the floor the room is on."
  },
  {
   "id": "features/setup/rooms-page.tsx#column:setup.rooms.name",
   "kind": "column",
   "label": {
    "uz": "Nomi yoki raqami",
    "ru": "Название или номер",
    "en": "Name or number"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the room's name or number; selecting it opens the room in the side panel."
  },
  {
   "id": "features/setup/rooms-page.tsx#column:setup.rooms.shared",
   "kind": "column",
   "label": {
    "uz": "Umumiy",
    "ru": "Общий",
    "en": "Shared"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the room is shared and how many lessons it holds at once."
  },
  {
   "id": "features/setup/rooms-page.tsx#column:setup.rooms.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the room is in use, under repair or closed."
  },
  {
   "id": "features/setup/rooms-page.tsx#column:setup.rooms.type",
   "kind": "column",
   "label": {
    "uz": "Turi",
    "ru": "Тип",
    "en": "Type"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the room's type, such as classroom or laboratory."
  },
  {
   "id": "features/setup/rooms-page.tsx#tab:setup.rooms.views",
   "kind": "tab",
   "label": {
    "uz": "Koʻrinish",
    "ru": "Вид",
    "en": "View"
   },
   "pages": [
    "/setup/rooms"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Switches between the list of rooms and the view by building and floor with room cards."
  },
  {
   "id": "features/setup/settings-page.tsx#field:setup.settings.classDaily",
   "kind": "field",
   "label": {
    "uz": "Bir kundagi eng koʻp darslar",
    "ru": "Больше всего уроков в день",
    "en": "Most lessons in a day"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the most lessons a class should have in a day; a class with more is marked in the timetable. Empty means no limit."
  },
  {
   "id": "features/setup/settings-page.tsx#field:setup.settings.editDays",
   "kind": "field",
   "label": {
    "uz": "Dars necha kun tahrir uchun ochiq",
    "ru": "Сколько дней урок открыт для правки",
    "en": "Days a lesson stays open"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds how many calendar days after a lesson its journal entries stay open for the teacher; applies to lessons dated after the change."
  },
  {
   "id": "features/setup/settings-page.tsx#field:setup.settings.lateValue",
   "kind": "field",
   "label": {
    "uz": "Kechikish, foiz",
    "ru": "Опоздание, процентов",
    "en": "Late, percent"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the percent a late mark counts as in the attendance part for the quarter; a change that alters published grades asks for a reason."
  },
  {
   "id": "features/setup/settings-page.tsx#field:setup.settings.planWindows",
   "kind": "field",
   "label": {
    "uz": "Reja oynalari",
    "ru": "Окна планов",
    "en": "Plan windows"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Turns lesson plan windows on or off: on, plans are written in a window and then changed by request; off, teachers change their plans at any time."
  },
  {
   "id": "features/setup/settings-page.tsx#field:setup.settings.skippedValue",
   "kind": "field",
   "label": {
    "uz": "Darsga kirmaslik, foiz",
    "ru": "Пропуск урока, процентов",
    "en": "Skipped, percent"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the percent a skipped lesson counts as in the attendance part for the quarter; a change that alters published grades asks for a reason."
  },
  {
   "id": "features/setup/settings-page.tsx#field:setup.settings.thresholds.lowResult",
   "kind": "field",
   "label": {
    "uz": "Chorak natijasi quyidagidan past",
    "ru": "Результат четверти ниже",
    "en": "Quarter result below"
   },
   "pages": [
    "/setup/settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the quarter result under which a student goes on the early-warning list, beside the other thresholds of that list."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.assistantConversationsLink",
   "kind": "tab",
   "label": {
    "uz": "Yordamchi suhbatlari",
    "ru": "Разговоры с помощником",
    "en": "Assistant conversations"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/assistant-conversations",
   "description": "Opens the Assistant conversations page of School setup (/assistant-conversations)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.assistantSettingsLink",
   "kind": "tab",
   "label": {
    "uz": "Yordamchi sozlamalari",
    "ru": "Настройки помощника",
    "en": "Assistant settings"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/assistant",
   "description": "Opens the Assistant settings page of School setup (/setup/assistant)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.branchesLink",
   "kind": "tab",
   "label": {
    "uz": "Filiallar",
    "ru": "Филиалы",
    "en": "Branches"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/branches",
   "description": "Opens the Branches page of School setup (/setup/branches)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.branchLink",
   "kind": "tab",
   "label": {
    "uz": "Filial",
    "ru": "Филиал",
    "en": "Branch"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/branch",
   "description": "Opens the Branch page of School setup (/setup/branch)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.buildingsLink",
   "kind": "tab",
   "label": {
    "uz": "Binolar va qavatlar",
    "ru": "Здания и этажи",
    "en": "Buildings and floors"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/buildings",
   "description": "Opens the Buildings and floors page of School setup (/setup/buildings)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.calendarLink",
   "kind": "tab",
   "label": {
    "uz": "Taqvim",
    "ru": "Календарь",
    "en": "Calendar"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/calendar",
   "description": "Opens the Calendar page of School setup (/setup/calendar)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.dayTemplatesLink",
   "kind": "tab",
   "label": {
    "uz": "Kun shablonlari",
    "ru": "Шаблоны дня",
    "en": "Day templates"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/day-templates",
   "description": "Opens the Day templates page of School setup (/setup/day-templates)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.demoClockLink",
   "kind": "tab",
   "label": {
    "uz": "Demo vaqt",
    "ru": "Демо-время",
    "en": "Demo time"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/demo-clock",
   "description": "Opens the Demo time page of School setup (/setup/demo-clock)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.divisionsLink",
   "kind": "tab",
   "label": {
    "uz": "Boʻlimlar va kafedralar",
    "ru": "Отделы и кафедры",
    "en": "Divisions and departments"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/divisions",
   "description": "Opens the Divisions and departments page of School setup (/setup/divisions)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.feedbackReportsLink",
   "kind": "tab",
   "label": {
    "uz": "Fikr-mulohazalar",
    "ru": "Отзывы",
    "en": "Feedback reports"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/feedback-reports",
   "description": "Opens the Feedback reports page of School setup (/feedback-reports)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.forcedDeletesLink",
   "kind": "tab",
   "label": {
    "uz": "Butunlay oʻchirilganlar",
    "ru": "Удалённые окончательно",
    "en": "Deleted for good"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/forced-deletes",
   "description": "Opens the Deleted for good page of School setup (/forced-deletes)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.integrationKeysLink",
   "kind": "tab",
   "label": {
    "uz": "Integratsiya kalitlari",
    "ru": "Ключи интеграции",
    "en": "Integration keys"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/integration-keys",
   "description": "Opens the Integration keys page of School setup (/integration-keys)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.pastMarksLink",
   "kind": "tab",
   "label": {
    "uz": "Ishga tushishdan oldingi baholar",
    "ru": "Оценки до запуска",
    "en": "Past marks before go-live"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/past-marks",
   "description": "Opens the page of past marks from before go-live of School setup (/setup/past-marks)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.roomsLink",
   "kind": "tab",
   "label": {
    "uz": "Xonalar",
    "ru": "Кабинеты",
    "en": "Rooms"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/rooms",
   "description": "Opens the Rooms page of School setup (/setup/rooms)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.settingsLink",
   "kind": "tab",
   "label": {
    "uz": "Sozlamalar",
    "ru": "Настройки",
    "en": "Settings"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/settings",
   "description": "Opens the Settings page of School setup (/setup/settings)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.slotTypesLink",
   "kind": "tab",
   "label": {
    "uz": "Dars va tanaffus turlari",
    "ru": "Типы уроков и перемен",
    "en": "Slot types"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/slot-types",
   "description": "Opens the Slot types page of School setup (/setup/slot-types)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.subjectsLink",
   "kind": "tab",
   "label": {
    "uz": "Fanlar",
    "ru": "Предметы",
    "en": "Subjects"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/subjects",
   "description": "Opens the Subjects page of School setup (/setup/subjects)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.systemStatusLink",
   "kind": "tab",
   "label": {
    "uz": "Tizim holati",
    "ru": "Состояние системы",
    "en": "System status"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/system-status",
   "description": "Opens the System status page of School setup (/system-status)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.templateSettingsLink",
   "kind": "tab",
   "label": {
    "uz": "Shablonlar qayerda amal qiladi",
    "ru": "Где действуют шаблоны",
    "en": "Where templates apply"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/day-template-settings",
   "description": "Opens the Where templates apply page of School setup (/setup/day-template-settings)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.travelTimesLink",
   "kind": "tab",
   "label": {
    "uz": "Yoʻl vaqti",
    "ru": "Время в пути",
    "en": "Travel time"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/travel-times",
   "description": "Opens the Travel time page of School setup (/setup/travel-times)."
  },
  {
   "id": "features/setup/setup-page.tsx#tab:setup.yearsLink",
   "kind": "tab",
   "label": {
    "uz": "Oʻquv yillari",
    "ru": "Учебные годы",
    "en": "Academic years"
   },
   "pages": [
    "/setup"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": "/setup/years",
   "description": "Opens the Academic years page of School setup (/setup/years)."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": "features/setup/slot-type-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the slot type's name for editing."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#button:setup.slotTypes.archive",
   "kind": "button",
   "label": {
    "uz": "Arxivlash",
    "ru": "В архив",
    "en": "Archive"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": "features/setup/slot-type-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayTemplatesController_archiveSlotType",
    "DayTemplatesController_restoreSlotType"
   ],
   "opens": null,
   "description": "Archives the slot type after a confirmation; it can no longer be added to a day template, past days keep their times, and it can be restored."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#button:setup.slotTypes.changeLength",
   "kind": "button",
   "label": {
    "uz": "Sanadan boshlab yangi davomiylik",
    "ru": "Новая длительность с даты",
    "en": "New length from a date"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": "features/setup/slot-type-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form for a new length from a date; Save first shows what the change does to the published timetable."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#button:setup.slotTypes.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": "features/setup/slot-type-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayTemplatesController_archiveSlotType",
    "DayTemplatesController_restoreSlotType"
   ],
   "opens": null,
   "description": "Restores the archived slot type after a confirmation."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#field:setup.slotTypes.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": "features/setup/slot-type-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the new length takes effect; earlier days keep their times."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#field:setup.slotTypes.length",
   "kind": "field",
   "label": {
    "uz": "Davomiyligi",
    "ru": "Длительность",
    "en": "Length"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": "features/setup/slot-type-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new length in minutes."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#field:setup.slotTypes.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": "features/setup/slot-type-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the slot type's name when it is renamed."
  },
  {
   "id": "features/setup/slot-type-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one slot type: its kind and its lengths by date, with the actions to rename it, set a new length from a date, archive or restore it."
  },
  {
   "id": "features/setup/slot-types-page.tsx#button:setup.slotTypes.add",
   "kind": "button",
   "label": {
    "uz": "Dars yoki tanaffus turini qoʻshish",
    "ru": "Добавить тип урока или перемены",
    "en": "Add slot type"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new lesson or break slot type."
  },
  {
   "id": "features/setup/slot-types-page.tsx#button:setup.slotTypes.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new slot type form without saving."
  },
  {
   "id": "features/setup/slot-types-page.tsx#column:setup.slotTypes.kind",
   "kind": "column",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the slot type is a lesson or a break."
  },
  {
   "id": "features/setup/slot-types-page.tsx#column:setup.slotTypes.length",
   "kind": "column",
   "label": {
    "uz": "Davomiyligi",
    "ru": "Длительность",
    "en": "Length"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the slot type's length in minutes today."
  },
  {
   "id": "features/setup/slot-types-page.tsx#column:setup.slotTypes.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the slot type's name; selecting it opens it in the side panel."
  },
  {
   "id": "features/setup/slot-types-page.tsx#column:setup.slotTypes.planned",
   "kind": "column",
   "label": {
    "uz": "Rejalashtirilgan",
    "ru": "Запланировано",
    "en": "Planned"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows a new length planned from a later date, if any."
  },
  {
   "id": "features/setup/slot-types-page.tsx#column:setup.slotTypes.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the slot type is active or archived."
  },
  {
   "id": "features/setup/slot-types-page.tsx#field:setup.slotTypes.kind",
   "kind": "field",
   "label": {
    "uz": "Turi",
    "ru": "Вид",
    "en": "Kind"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the new slot type is a lesson or a break."
  },
  {
   "id": "features/setup/slot-types-page.tsx#field:setup.slotTypes.length",
   "kind": "field",
   "label": {
    "uz": "Davomiyligi",
    "ru": "Длительность",
    "en": "Length"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new slot type's length in minutes."
  },
  {
   "id": "features/setup/slot-types-page.tsx#field:setup.slotTypes.name",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/slot-types"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new slot type's name."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.colour",
   "kind": "field",
   "label": {
    "uz": "Rang",
    "ru": "Цвет",
    "en": "Colour"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject's colour, used on the timetable and in lists."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.demanding",
   "kind": "field",
   "label": {
    "uz": "Murakkab fan",
    "ru": "Трудный предмет",
    "en": "Demanding"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Marks the subject as demanding, so the timetable generator places it in the first slots of the day."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.department",
   "kind": "field",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the department the subject belongs to."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.departmentStartsOn",
   "kind": "field",
   "label": {
    "uz": "Oʻtish sanasi",
    "ru": "Переход с",
    "en": "Moves on"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the subject moves to the newly chosen department."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.grades",
   "kind": "field",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Grades"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the grades the subject is taught in."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.groupSubject",
   "kind": "field",
   "label": {
    "uz": "Guruhli fan",
    "ru": "Предмет по группам",
    "en": "Group subject"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Marks the subject as taught in groups rather than to the whole class."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.journalType",
   "kind": "field",
   "label": {
    "uz": "Jurnal turi",
    "ru": "Тип журнала",
    "en": "Journal type"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the subject's journal is graded or attendance only."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.languageRule",
   "kind": "field",
   "label": {
    "uz": "Til qoidasi",
    "ru": "Правило языка",
    "en": "Language rule"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When on, only teachers of the class's language of instruction can take it; switched off for subjects like English taught in another language."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.nameUz",
   "kind": "field",
   "label": {
    "uz": "Oʻzbekcha nomi",
    "ru": "Название на узбекском",
    "en": "Name in Uzbek"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the subject's name in Uzbek; the fields beside it hold the Russian and English names. Each name must be free among active subjects."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.ratingExam",
   "kind": "field",
   "label": {
    "uz": "Reyting imtihoni",
    "ru": "Рейтинговый экзамен",
    "en": "Rating exam"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Turns on the rating exam for a graded subject, adding a rating exam part to its result."
  },
  {
   "id": "features/setup/subject-form.tsx#field:setup.subjects.switchesFrom",
   "kind": "field",
   "label": {
    "uz": "Kuchga kiradi",
    "ru": "Действует с",
    "en": "Takes effect from"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the quarter from which a changed journal type or rating exam takes effect; earlier quarters keep what they had."
  },
  {
   "id": "features/setup/subject-import-page.tsx#button:people.import.reading",
   "kind": "button",
   "label": {
    "uz": "Fayl oʻqilmoqda…",
    "ru": "Читаем файл…",
    "en": "Reading the file…"
   },
   "pages": [
    "/setup/subjects/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Uploads the filled Excel file and shows a preview of every row with its problems; nothing is saved yet."
  },
  {
   "id": "features/setup/subject-import-page.tsx#button:people.import.template",
   "kind": "button",
   "label": {
    "uz": "Shablonni yuklab olish",
    "ru": "Скачать шаблон",
    "en": "Download the template"
   },
   "pages": [
    "/setup/subjects/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "SubjectsController_importTemplate"
   ],
   "opens": null,
   "description": "Downloads the Excel template for the subject import, with headings in three languages."
  },
  {
   "id": "features/setup/subject-import-page.tsx#button:setup.subjectImport.confirm",
   "kind": "button",
   "label": {
    "uz": "Barcha … ta fanni saqlash",
    "ru": "Сохранить все … предмета",
    "en": "Save all … subjects"
   },
   "pages": [
    "/setup/subjects/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "SubjectsController_importConfirm"
   ],
   "opens": null,
   "description": "Saves every subject of the file at once; it stays off until every row is clean."
  },
  {
   "id": "features/setup/subject-import-page.tsx#column:people.import.problemsColumn",
   "kind": "column",
   "label": {
    "uz": "Xatolar",
    "ru": "Ошибки",
    "en": "Problems"
   },
   "pages": [
    "/setup/subjects/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows what is wrong with the row, or that it is clean."
  },
  {
   "id": "features/setup/subject-import-page.tsx#column:people.import.row",
   "kind": "column",
   "label": {
    "uz": "Qator",
    "ru": "Строка",
    "en": "Row"
   },
   "pages": [
    "/setup/subjects/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the row number of the subject in the uploaded file."
  },
  {
   "id": "features/setup/subject-import-page.tsx#column:setup.subjectImport.name",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/setup/subjects/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject's name as read from the row."
  },
  {
   "id": "features/setup/subject-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": "features/setup/subject-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the subject's form for editing."
  },
  {
   "id": "features/setup/subject-panel.tsx#button:setup.subjects.archiveSubject",
   "kind": "button",
   "label": {
    "uz": "Fanni arxivga yuborish",
    "ru": "Отправить предмет в архив",
    "en": "Archive subject"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": "features/setup/subject-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Archives the subject after a confirmation; it leaves the pickers of every branch and can be restored."
  },
  {
   "id": "features/setup/subject-panel.tsx#button:setup.subjects.changeWeightsOf",
   "kind": "button",
   "label": {
    "uz": "Taqsimotni oʻzgartirish: …",
    "ru": "Изменить распределение: …",
    "en": "Change distribution: …"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": "features/setup/subject-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form of the quarter's distribution: the weights of attendance, classwork, homework and the rating exam."
  },
  {
   "id": "features/setup/subject-panel.tsx#button:setup.subjects.copy",
   "kind": "button",
   "label": {
    "uz": "1-chorakni qolgan choraklarga nusxalash",
    "ru": "Скопировать 1-ю четверть в остальные",
    "en": "Copy quarter 1 to the other quarters"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": "features/setup/subject-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "SubjectsController_copyQuarterOne",
    "SubjectsController_previewCopy"
   ],
   "opens": null,
   "description": "Copies quarter 1's distribution to quarters 2 to 4, after a confirmation when they already have one."
  },
  {
   "id": "features/setup/subject-panel.tsx#button:setup.subjects.restoreSubject",
   "kind": "button",
   "label": {
    "uz": "Fanni tiklash",
    "ru": "Восстановить предмет",
    "en": "Restore subject"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": "features/setup/subject-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Restores the archived subject after a confirmation, with its weights as they were."
  },
  {
   "id": "features/setup/subject-panel.tsx#field:setup.subjects.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": "features/setup/subject-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year whose quarterly distributions are shown."
  },
  {
   "id": "features/setup/subject-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one subject: its details and its quarterly distributions of weights by year, with the actions to edit, archive or restore it."
  },
  {
   "id": "features/setup/subjects-page.tsx#button:setup.subjects.add",
   "kind": "button",
   "label": {
    "uz": "Fan qoʻshish",
    "ru": "Добавить предмет",
    "en": "Add subject"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new subject in the side panel."
  },
  {
   "id": "features/setup/subjects-page.tsx#button:setup.subjects.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new subject form without saving."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.department",
   "kind": "column",
   "label": {
    "uz": "Kafedra",
    "ru": "Кафедра",
    "en": "Department"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the department of the subject."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.grades",
   "kind": "column",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Grades"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the grades the subject is taught in."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.journalType",
   "kind": "column",
   "label": {
    "uz": "Jurnal turi",
    "ru": "Тип журнала",
    "en": "Journal type"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the subject's journal is graded or attendance only."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.name",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Name"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject's name with its colour; selecting it opens the subject in the side panel."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.quarterlyMissing",
   "kind": "column",
   "label": {
    "uz": "Vaznsiz choraklar",
    "ru": "Четверти без весов",
    "en": "Quarters not set"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many quarters of a graded subject have no distribution of weights yet."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.ratingExam",
   "kind": "column",
   "label": {
    "uz": "Reyting imtihoni",
    "ru": "Рейтинговый экзамен",
    "en": "Rating exam"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the subject has a rating exam."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the subject is active or archived."
  },
  {
   "id": "features/setup/subjects-page.tsx#column:setup.subjects.switches",
   "kind": "column",
   "label": {
    "uz": "Xususiyatlar",
    "ru": "Признаки",
    "en": "Switches"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows which of the group subject, language rule and demanding switches are on."
  },
  {
   "id": "features/setup/template-assignment-panel.tsx#button:setup.templateSettings.endTitle",
   "kind": "button",
   "label": {
    "uz": "Sanadan boshlab tugatish",
    "ru": "Завершить с даты",
    "en": "End from a date"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": "features/setup/template-assignment-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to end the setting from a date; Save first shows the templates after the change. The branch default cannot be ended, only replaced."
  },
  {
   "id": "features/setup/template-assignment-panel.tsx#field:setup.templateSettings.endFrom",
   "kind": "field",
   "label": {
    "uz": "Ushbu belgilashsiz birinchi kun",
    "ru": "Первый день без этого назначения",
    "en": "First day without this setting"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": "features/setup/template-assignment-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first date the setting no longer applies, tomorrow at the earliest."
  },
  {
   "id": "features/setup/template-assignment-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one template setting: its level, weekday, grades, template and dates, with the action to end it from a date."
  },
  {
   "id": "features/setup/template-settings-page.tsx#column:setup.templateSettings.from",
   "kind": "column",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the date the setting starts."
  },
  {
   "id": "features/setup/template-settings-page.tsx#column:setup.templateSettings.grades",
   "kind": "column",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Grades"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the grades of the setting, if it has them."
  },
  {
   "id": "features/setup/template-settings-page.tsx#column:setup.templateSettings.level",
   "kind": "column",
   "label": {
    "uz": "Nimaga",
    "ru": "Для чего",
    "en": "Applies to"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows what the setting applies to; selecting it opens the setting in the side panel."
  },
  {
   "id": "features/setup/template-settings-page.tsx#column:setup.templateSettings.template",
   "kind": "column",
   "label": {
    "uz": "Kun shabloni",
    "ru": "Шаблон дня",
    "en": "Day template"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the day template the setting gives."
  },
  {
   "id": "features/setup/template-settings-page.tsx#column:setup.templateSettings.until",
   "kind": "column",
   "label": {
    "uz": "Gacha",
    "ru": "До",
    "en": "Until"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the date the setting ends, or that it has no end."
  },
  {
   "id": "features/setup/template-settings-page.tsx#column:setup.templateSettings.weekday",
   "kind": "column",
   "label": {
    "uz": "Hafta kuni",
    "ru": "День недели",
    "en": "Weekday"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the weekday of the setting, if it has one."
  },
  {
   "id": "features/setup/template-settings-page.tsx#field:setup.templateSettings.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the setting starts, tomorrow by default; Save first shows the templates after the change."
  },
  {
   "id": "features/setup/template-settings-page.tsx#field:setup.templateSettings.gradeFrom",
   "kind": "field",
   "label": {
    "uz": "Qaysi sinfdan",
    "ru": "С класса",
    "en": "From grade"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the lowest grade the setting applies to."
  },
  {
   "id": "features/setup/template-settings-page.tsx#field:setup.templateSettings.gradeTo",
   "kind": "field",
   "label": {
    "uz": "Qaysi sinfgacha",
    "ru": "По класс",
    "en": "To grade"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the highest grade the setting applies to."
  },
  {
   "id": "features/setup/template-settings-page.tsx#field:setup.templateSettings.level",
   "kind": "field",
   "label": {
    "uz": "Nimaga",
    "ru": "Для чего",
    "en": "Applies to"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses what the new setting applies to: the whole branch, a range of grades, a weekday, or a weekday and a range of grades."
  },
  {
   "id": "features/setup/template-settings-page.tsx#field:setup.templateSettings.template",
   "kind": "field",
   "label": {
    "uz": "Kun shabloni",
    "ru": "Шаблон дня",
    "en": "Day template"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the day template to set."
  },
  {
   "id": "features/setup/template-settings-page.tsx#field:setup.templateSettings.weekday",
   "kind": "field",
   "label": {
    "uz": "Hafta kuni",
    "ru": "День недели",
    "en": "Weekday"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the weekday the setting applies to."
  },
  {
   "id": "features/setup/template-settings-page.tsx#field:setup.templateTable.date",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/setup/day-template-settings"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the date for which the table shows the day template of every weekday and grade."
  },
  {
   "id": "features/setup/template-table.tsx#button:setup.templateTable.cancel",
   "kind": "button",
   "label": {
    "uz": "Saqlamaslik",
    "ru": "Не сохранять",
    "en": "Do not save"
   },
   "pages": [
    "/setup/day-template-settings",
    "/timetable/builder"
   ],
   "parent": "features/setup/template-table.tsx#panel:setup.templateTable.previewTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the preview and goes back to the form with nothing saved."
  },
  {
   "id": "features/setup/template-table.tsx#button:setup.templateTable.save",
   "kind": "button",
   "label": {
    "uz": "Oʻzgarishni saqlash",
    "ru": "Сохранить изменение",
    "en": "Save the change"
   },
   "pages": [
    "/setup/day-template-settings",
    "/timetable/builder"
   ],
   "parent": "features/setup/template-table.tsx#panel:setup.templateTable.previewTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Saves the change with the choices made; it stays off while something stops the save or a choice is missing."
  },
  {
   "id": "features/setup/template-table.tsx#panel:setup.templateTable.previewTitle",
   "kind": "panel",
   "label": {
    "uz": "Bu oʻzgarishdan keyingi shablonlar",
    "ru": "Шаблоны после этого изменения",
    "en": "The templates after this change"
   },
   "pages": [
    "/setup/day-template-settings",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that shows the templates table after a change, with changed cells marked, and what the change does to the published timetable, before it is saved."
  },
  {
   "id": "features/setup/travel-times-page.tsx#field:setup.travelTimes.minutes",
   "kind": "field",
   "label": {
    "uz": "Daqiqa",
    "ru": "Минуты",
    "en": "Minutes"
   },
   "pages": [
    "/setup/travel-times"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the travel time in minutes to the other branch; a teacher's lessons in the two branches must be at least this far apart."
  },
  {
   "id": "features/setup/weights-form.tsx#field:setup.subjects.parts.attendance",
   "kind": "field",
   "label": {
    "uz": "Davomat",
    "ru": "Посещаемость",
    "en": "Attendance"
   },
   "pages": [
    "/setup/subjects"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the weight of attendance in the quarter result; with classwork, homework and the rating exam the parts must total 100."
  },
  {
   "id": "features/setup/year-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/year-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the year's start and end dates for editing."
  },
  {
   "id": "features/setup/year-panel.tsx#button:setup.years.changeQuarters",
   "kind": "button",
   "label": {
    "uz": "Choraklarni oʻzgartirish",
    "ru": "Изменить четверти",
    "en": "Change quarters"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/year-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the quarter dates for editing; when the new dates change the published timetable, Save first shows a preview."
  },
  {
   "id": "features/setup/year-panel.tsx#button:setup.years.start",
   "kind": "button",
   "label": {
    "uz": "Yilni boshlash",
    "ru": "Начать год",
    "en": "Start year"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/year-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "AcademicYearsController_start"
   ],
   "opens": null,
   "description": "Makes the planned year the branch's current year after a confirmation; off while another year is current or an earlier one is not closed."
  },
  {
   "id": "features/setup/year-panel.tsx#field:setup.years.endDate",
   "kind": "field",
   "label": {
    "uz": "Tugashi",
    "ru": "Окончание",
    "en": "End"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/year-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the last date of the academic year, in the calendar year after the start."
  },
  {
   "id": "features/setup/year-panel.tsx#field:setup.years.quarterEnd",
   "kind": "field",
   "label": {
    "uz": "…-chorak: tugashi",
    "ru": "…-я четверть: окончание",
    "en": "Quarter …: end"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/year-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the last date of the quarter, on or after its start."
  },
  {
   "id": "features/setup/year-panel.tsx#field:setup.years.quarterStart",
   "kind": "field",
   "label": {
    "uz": "…-chorak: boshlanishi",
    "ru": "…-я четверть: начало",
    "en": "Quarter …: start"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/year-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first date of the quarter, inside the year and after the previous quarter ends."
  },
  {
   "id": "features/setup/year-panel.tsx#field:setup.years.startDate",
   "kind": "field",
   "label": {
    "uz": "Boshlanishi",
    "ru": "Начало",
    "en": "Start"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": "features/setup/year-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first date of the academic year."
  },
  {
   "id": "features/setup/year-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of one academic year: its dates, status and quarters, with the actions to edit the dates, change the quarters and start the year."
  },
  {
   "id": "features/setup/years-page.tsx#button:setup.years.add",
   "kind": "button",
   "label": {
    "uz": "Yil qoʻshish",
    "ru": "Добавить год",
    "en": "Add year"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new academic year with its start and end dates."
  },
  {
   "id": "features/setup/years-page.tsx#button:setup.years.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new year form without saving."
  },
  {
   "id": "features/setup/years-page.tsx#column:setup.years.endDate",
   "kind": "column",
   "label": {
    "uz": "Tugashi",
    "ru": "Окончание",
    "en": "End"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the year's last date."
  },
  {
   "id": "features/setup/years-page.tsx#column:setup.years.name",
   "kind": "column",
   "label": {
    "uz": "Yil",
    "ru": "Год",
    "en": "Year"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the year's name; selecting it opens the year in the side panel."
  },
  {
   "id": "features/setup/years-page.tsx#column:setup.years.quarters",
   "kind": "column",
   "label": {
    "uz": "Choraklar",
    "ru": "Четверти",
    "en": "Quarters"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many of the year's four quarters are dated."
  },
  {
   "id": "features/setup/years-page.tsx#column:setup.years.startDate",
   "kind": "column",
   "label": {
    "uz": "Boshlanishi",
    "ru": "Начало",
    "en": "Start"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the year's first date."
  },
  {
   "id": "features/setup/years-page.tsx#column:setup.years.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "Status"
   },
   "pages": [
    "/setup/years"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the year is planned, current or closed."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.firstDay",
   "kind": "field",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first day of the absence; it starts as today."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.firstDay:2",
   "kind": "field",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new first day of the absence while changing its dates; it can be changed only before the absence has started."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.lastDay",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the last day of the absence, when the return date is known."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.lastDay:2",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new last day of the absence while changing its dates; shortening it gives later lessons back to the teacher."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.openEnded",
   "kind": "field",
   "label": {
    "uz": "Qaytish sanasi hali nomaʼlum",
    "ru": "Дата возвращения пока неизвестна",
    "en": "No return date yet"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When ticked, the absence has no last day yet and the last day field is hidden."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.openEnded:2",
   "kind": "field",
   "label": {
    "uz": "Qaytish sanasi hali nomaʼlum",
    "ru": "Дата возвращения пока неизвестна",
    "en": "No return date yet"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When ticked while changing the dates, the absence is left without a last day."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.person",
   "kind": "field",
   "label": {
    "uz": "Xodim",
    "ru": "Сотрудник",
    "en": "Person"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the staff member who will be absent; one absence covers every branch they work in."
  },
  {
   "id": "features/timetable/absence-form.tsx#field:timetable.absences.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for the absence."
  },
  {
   "id": "features/timetable/absence-panel.tsx#button:timetable.absences.changeDates",
   "kind": "button",
   "label": {
    "uz": "Sanalarni oʻzgartirish",
    "ru": "Изменить даты",
    "en": "Change the dates"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": "features/timetable/absence-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form in the panel to change the first day (before it starts), the last day or the open end of the absence."
  },
  {
   "id": "features/timetable/absence-panel.tsx#button:timetable.absences.substituteJournal",
   "kind": "button",
   "label": {
    "uz": "Butun yoʻqlik uchun oʻrinbosar",
    "ru": "Замена на всё отсутствие",
    "en": "Substitute for the whole absence"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": "features/timetable/absence-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to give one substitute every lesson of this journal for the whole absence; each date is still checked."
  },
  {
   "id": "features/timetable/absence-panel.tsx#button:timetable.absences.withdraw",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": "features/timetable/absence-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "AbsencesController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws the absence after a confirmation; its lessons go back to the teacher and a withdrawn absence cannot be changed again."
  },
  {
   "id": "features/timetable/absence-panel.tsx#button:timetable.day.substitute",
   "kind": "button",
   "label": {
    "uz": "Oʻrinbosar",
    "ru": "Замена",
    "en": "Substitute"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": "features/timetable/absence-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the substitution dialog for this lesson of the absence, to choose a free teacher to take it."
  },
  {
   "id": "features/timetable/absence-panel.tsx#button:timetable.day.withdrawSubstitution",
   "kind": "button",
   "label": {
    "uz": "Oʻrinbosarni bekor qilish",
    "ru": "Отменить замену",
    "en": "Withdraw the substitution"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": "features/timetable/absence-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to withdraw the substitute of this lesson, with a reason."
  },
  {
   "id": "features/timetable/absence-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of an absence: its details, the buttons to change or withdraw it, and the lessons of this branch that fall inside it, with their substitutes."
  },
  {
   "id": "features/timetable/absences-page.tsx#button:timetable.absences.add",
   "kind": "button",
   "label": {
    "uz": "Kelmaslik qaydini qoʻshish",
    "ru": "Добавить отсутствие",
    "en": "Add an absence"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new absence: the person, the first and last day and the reason."
  },
  {
   "id": "features/timetable/absences-page.tsx#button:timetable.absences.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new absence form without saving."
  },
  {
   "id": "features/timetable/absences-page.tsx#column:timetable.absences.firstDay",
   "kind": "column",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the first day of the absence."
  },
  {
   "id": "features/timetable/absences-page.tsx#column:timetable.absences.lastDay",
   "kind": "column",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the last day of the absence, or Open-ended when no return date is set."
  },
  {
   "id": "features/timetable/absences-page.tsx#column:timetable.absences.person",
   "kind": "column",
   "label": {
    "uz": "Xodim",
    "ru": "Сотрудник",
    "en": "Person"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the staff member who is absent; clicking it opens the absence in the side panel."
  },
  {
   "id": "features/timetable/absences-page.tsx#column:timetable.absences.reason",
   "kind": "column",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the reason given for the absence."
  },
  {
   "id": "features/timetable/absences-page.tsx#column:timetable.absences.state",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the absence is planned, happening now, ended or withdrawn."
  },
  {
   "id": "features/timetable/builder-page.tsx#button:timetable.builder.confirm",
   "kind": "button",
   "label": {
    "uz": "Shablonlarni tasdiqlash",
    "ru": "Подтвердить шаблоны",
    "en": "Confirm the templates"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_confirmTemplates"
   ],
   "opens": null,
   "description": "Confirms the period and day templates shown for the draft, which marks this step ready."
  },
  {
   "id": "features/timetable/builder-page.tsx#button:timetable.builder.stepNumber",
   "kind": "button",
   "label": {
    "uz": "….",
    "ru": "….",
    "en": "…."
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens that step of the draft builder; each step shows whether it is ready."
  },
  {
   "id": "features/timetable/builder-page.tsx#button:timetable.load.changeStart",
   "kind": "button",
   "label": {
    "uz": "Boshlanish sanasini oʻzgartirish",
    "ru": "Изменить дату начала",
    "en": "Change start date"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change the intended start date of the draft, with quarter-start shortcuts."
  },
  {
   "id": "features/timetable/builder-page.tsx#field:timetable.load.version",
   "kind": "field",
   "label": {
    "uz": "Versiya",
    "ru": "Версия",
    "en": "Version"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses which timetable version (draft or published) the builder shows."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#button:timetable.bulk.check",
   "kind": "button",
   "label": {
    "uz": "Tekshirish",
    "ru": "Проверить",
    "en": "Check"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "BulkCancelsController_check"
   ],
   "opens": null,
   "description": "Asks the server what the bulk cancel would do: the lessons cancelled, lessons shared with other classes and lessons that hold data."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#button:timetable.bulk.send",
   "kind": "button",
   "label": {
    "uz": "Darslarni bekor qilish",
    "ru": "Отменить уроки",
    "en": "Cancel lessons"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "BulkCancelsController_save"
   ],
   "opens": null,
   "description": "Cancels every lesson the check listed, with the choices and the reason given."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#button:timetable.day.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "BulkCancelsController_save"
   ],
   "opens": null,
   "description": "Closes the dialog without cancelling anything."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#field:timetable.bulk.classes",
   "kind": "field",
   "label": {
    "uz": "Sinflar",
    "ru": "Классы",
    "en": "Classes"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the classes whose lessons are cancelled; one tick chooses every class of the branch."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#field:timetable.bulk.shared",
   "kind": "field",
   "label": {
    "uz": "… va … uchun umumiy",
    "ru": "Общий для … и …",
    "en": "Shared by … with …"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses, for a lesson shared with classes not chosen, whether to cancel it whole or keep it for the others and exempt the chosen classes' students."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#field:timetable.bulk.slots",
   "kind": "field",
   "label": {
    "uz": "Darslar",
    "ru": "Уроки",
    "en": "Lesson slots"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the lesson numbers of the day to cancel."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#field:timetable.day.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for the bulk cancel; it is required."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that cancels many lessons of one date at once, for chosen classes and lesson slots, with a reason."
  },
  {
   "id": "features/timetable/bulk-cancel-dialog.tsx#panel:timetable.bulk.title",
   "kind": "panel",
   "label": {
    "uz": "… kuni ommaviy bekor qilish",
    "ru": "Массовая отмена на …",
    "en": "Bulk cancel on …"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/bulk-cancel-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Cancels the lessons of chosen classes and lesson slots on the date at once; Check first lists what would be cancelled and asks for a choice on shared lessons."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#button:timetable.day.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayChangesController_correct"
   ],
   "opens": null,
   "description": "Closes the dialog without saving the correction."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#button:timetable.day.correctSend",
   "kind": "button",
   "label": {
    "uz": "Tuzatishni saqlash",
    "ru": "Сохранить исправление",
    "en": "Save the correction"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayChangesController_correct"
   ],
   "opens": null,
   "description": "Saves the correction of the lesson; it is recorded in the lesson's history."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#field:timetable.day.confirm",
   "kind": "field",
   "label": {
    "uz": "Men bularni tekshirdim va tuzatishni saqlayman",
    "ru": "Я проверил(а) это и сохраняю исправление",
    "en": "I have checked these and save the correction"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "A tick that confirms the warnings listed have been checked; the correction is then saved with them."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#field:timetable.day.correctKind",
   "kind": "field",
   "label": {
    "uz": "Nima boʻldi",
    "ru": "Что произошло",
    "en": "What happened"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses what happened: it did not take place, it took place after all, someone else taught it, or it was held in another room."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#field:timetable.day.heldIn",
   "kind": "field",
   "label": {
    "uz": "Dars oʻtgan xona",
    "ru": "Кабинет, где прошёл урок",
    "en": "Room it was held in"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room the lesson was actually held in."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#field:timetable.day.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for the correction; it is required."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#field:timetable.day.whoTaught",
   "kind": "field",
   "label": {
    "uz": "Darsni kim oʻtdi",
    "ru": "Кто провёл урок",
    "en": "Who taught it"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the person who actually taught the lesson."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for correcting a past lesson, one at a time, with a reason."
  },
  {
   "id": "features/timetable/correction-dialog.tsx#panel:timetable.day.correctTitle",
   "kind": "panel",
   "label": {
    "uz": "…, … darsini tuzatish",
    "ru": "Исправить: … в …",
    "en": "Correct … at …"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/correction-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Corrects what happened in a lesson that has started: it did not take place, took place after all, someone else taught it, or it was in another room."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.bulk.open",
   "kind": "button",
   "label": {
    "uz": "Ommaviy bekor qilish",
    "ru": "Массовая отмена",
    "en": "Bulk cancel"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the bulk cancel dialog for the chosen date, to cancel lessons of several classes and slots at once."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.restoreTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayChangesController_move",
    "DayChangesController_restore",
    "DayChangesController_room"
   ],
   "opens": null,
   "description": "Closes the dialog without changing the lesson."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.cancel",
   "kind": "button",
   "label": {
    "uz": "Darsni bekor qilish",
    "ru": "Отменить урок",
    "en": "Cancel lesson"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to cancel this lesson for this day, with a reason."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.cancelSend",
   "kind": "button",
   "label": {
    "uz": "Darsni bekor qilish",
    "ru": "Отменить урок",
    "en": "Cancel the lesson"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.cancelTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayChangesController_cancel"
   ],
   "opens": null,
   "description": "Cancels the lesson for this day; a lesson that holds marks or attendance asks for a tick first."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.changeRoom",
   "kind": "button",
   "label": {
    "uz": "Xonani almashtirish",
    "ru": "Сменить кабинет",
    "en": "Change room"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to put this lesson in another room for this day only, with a reason."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.correct",
   "kind": "button",
   "label": {
    "uz": "Tuzatish",
    "ru": "Исправить",
    "en": "Correct"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the correction dialog for this past lesson: not held, held after all, another teacher or another room."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.forcedDelete",
   "kind": "button",
   "label": {
    "uz": "Butunlay oʻchirish",
    "ru": "Удалить окончательно",
    "en": "Delete for good"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to delete this lesson for good with a typed reason; it and its data can be restored for 30 days."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.history",
   "kind": "button",
   "label": {
    "uz": "Tarix",
    "ru": "История",
    "en": "History"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the history of this lesson: every change, who made it and when."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.keep",
   "kind": "button",
   "label": {
    "uz": "Darsni qoldirish",
    "ru": "Оставить урок",
    "en": "Keep the lesson"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.cancelTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayChangesController_cancel"
   ],
   "opens": null,
   "description": "Closes the dialog and keeps the lesson."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.move",
   "kind": "button",
   "label": {
    "uz": "Koʻchirish",
    "ru": "Перенести",
    "en": "Move"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to move this lesson to another date and lesson slot, and optionally another room, with a reason."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.restore",
   "kind": "button",
   "label": {
    "uz": "Tiklash",
    "ru": "Восстановить",
    "en": "Restore"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [
    "DayChangesController_restore"
   ],
   "opens": null,
   "description": "Restores this cancelled lesson; when its room is no longer free, another free room is offered."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.roomSend",
   "kind": "button",
   "label": {
    "uz": "Xonani almashtirish",
    "ru": "Сменить кабинет",
    "en": "Change the room"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.restoreTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "DayChangesController_move",
    "DayChangesController_restore",
    "DayChangesController_room"
   ],
   "opens": null,
   "description": "Saves the change: the new room, the move or the restore, for this day only."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.substitute",
   "kind": "button",
   "label": {
    "uz": "Oʻrinbosar",
    "ru": "Замена",
    "en": "Substitute"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the substitution dialog to choose a free teacher to take this lesson."
  },
  {
   "id": "features/timetable/day-page.tsx#button:timetable.day.withdrawSubstitution",
   "kind": "button",
   "label": {
    "uz": "Oʻrinbosarni bekor qilish",
    "ru": "Отменить замену",
    "en": "Withdraw the substitution"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a dialog to withdraw the substitute of this lesson, with a reason; the lesson goes back to its teacher."
  },
  {
   "id": "features/timetable/day-page.tsx#field:timetable.day.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class whose lessons of the date are shown."
  },
  {
   "id": "features/timetable/day-page.tsx#field:timetable.day.date",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the date whose lessons are shown."
  },
  {
   "id": "features/timetable/day-page.tsx#field:timetable.day.moveDate",
   "kind": "field",
   "label": {
    "uz": "Yangi sana",
    "ru": "Новая дата",
    "en": "New date"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.restoreTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the lesson is moved to."
  },
  {
   "id": "features/timetable/day-page.tsx#field:timetable.day.moveRoom",
   "kind": "field",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.restoreTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room for the lesson; when moving, it can keep its own room."
  },
  {
   "id": "features/timetable/day-page.tsx#field:timetable.day.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.restoreTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for the change; it is required."
  },
  {
   "id": "features/timetable/day-page.tsx#field:timetable.day.reason:2",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.cancelTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for cancelling the lesson; it is required."
  },
  {
   "id": "features/timetable/day-page.tsx#field:timetable.day.slot",
   "kind": "field",
   "label": {
    "uz": "Dars vaqti",
    "ru": "Урок",
    "en": "Lesson slot"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/day-page.tsx#panel:timetable.day.restoreTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the lesson slot of the new date the lesson is moved to."
  },
  {
   "id": "features/timetable/day-page.tsx#panel:timetable.day.cancelTitle",
   "kind": "panel",
   "label": {
    "uz": "… dagi … darsini bekor qilish",
    "ru": "Отменить … в …",
    "en": "Cancel … at …"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that cancels one lesson for this day, with a reason."
  },
  {
   "id": "features/timetable/day-page.tsx#panel:timetable.day.restoreTitle",
   "kind": "panel",
   "label": {
    "uz": "… dagi … darsini boshqa xonada tiklash",
    "ru": "Восстановить урок в другом кабинете: … в …",
    "en": "Restore … at … in another room"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog for a one-day change of a lesson: a change of room, a move to another date and slot, or a restore into another room, each with a reason."
  },
  {
   "id": "features/timetable/edit-lock.tsx#button:timetable.editLock.takeOver",
   "kind": "button",
   "label": {
    "uz": "Tahrirni olish",
    "ru": "Перехватить",
    "en": "Take over"
   },
   "pages": [
    "/timetable/builder",
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Takes over editing of the draft from the person editing it; allowed after 5 minutes without activity from them."
  },
  {
   "id": "features/timetable/exam-form.tsx#button:timetable.day.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExamsController_change",
    "ExamsController_create"
   ],
   "opens": null,
   "description": "Closes the exam form without saving."
  },
  {
   "id": "features/timetable/exam-form.tsx#button:timetable.exams.addRoom",
   "kind": "button",
   "label": {
    "uz": "Xona qoʻshish",
    "ru": "Добавить кабинет",
    "en": "Add a room"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Adds another room to the exam, with its own classes and invigilators."
  },
  {
   "id": "features/timetable/exam-form.tsx#button:timetable.exams.check",
   "kind": "button",
   "label": {
    "uz": "Tekshirish",
    "ru": "Проверить",
    "en": "Check"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExamsController_check"
   ],
   "opens": null,
   "description": "Asks the server what saving the exam would do: the lessons it cancels, shared lessons that need a choice, blocked rules and warnings."
  },
  {
   "id": "features/timetable/exam-form.tsx#button:timetable.exams.removeRoom",
   "kind": "button",
   "label": {
    "uz": "Bu xonani olib tashlash",
    "ru": "Убрать этот кабинет",
    "en": "Remove this room"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes this room, with its classes and invigilators, from the exam."
  },
  {
   "id": "features/timetable/exam-form.tsx#button:timetable.exams.save",
   "kind": "button",
   "label": {
    "uz": "Imtihonni saqlash",
    "ru": "Сохранить экзамен",
    "en": "Save the exam"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExamsController_change",
    "ExamsController_create"
   ],
   "opens": null,
   "description": "Saves the exam and cancels its lessons; it is on only when the latest check allows the save."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.date",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date of the exam."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.examTitle",
   "kind": "field",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Title"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the title of the exam."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.firstLesson",
   "kind": "field",
   "label": {
    "uz": "Qaysi darsdan",
    "ru": "С урока",
    "en": "From lesson"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the first lesson slot the exam takes."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.keepReason",
   "kind": "field",
   "label": {
    "uz": "Darslar bekorligicha qolishining sababi",
    "ru": "Причина, по которой уроки остаются отменёнными",
    "en": "Reason for keeping lessons cancelled"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for keeping cancelled the lessons that a change of the exam cannot give back."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.lastLesson",
   "kind": "field",
   "label": {
    "uz": "Qaysi darsgacha",
    "ru": "По урок",
    "en": "To lesson"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the last lesson slot the exam takes."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.room",
   "kind": "field",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room of this part of the exam; each room also takes its classes or groups and its invigilators."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.shared",
   "kind": "field",
   "label": {
    "uz": "… bu darsni imtihon topshirmaydigan … bilan baham koʻradi. Tanlang:",
    "ru": "… делит этот урок с …, которые не сдают экзамен. Выберите:",
    "en": "… shares this lesson with …, who do not sit the exam. Choose:"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses, for a lesson shared with classes that do not sit the exam, whether to cancel it for everyone or keep it for the others."
  },
  {
   "id": "features/timetable/exam-form.tsx#field:timetable.exams.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject of the exam, or none."
  },
  {
   "id": "features/timetable/exam-form.tsx#panel:timetable.exams.newTitle",
   "kind": "panel",
   "label": {
    "uz": "Yangi imtihon",
    "ru": "Новый экзамен",
    "en": "New exam"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The form of an exam: date, title, subject, lesson slots and rooms with their classes and invigilators. Check shows what it would cancel before it can be saved."
  },
  {
   "id": "features/timetable/exams-page.tsx#button:timetable.exams.cancel",
   "kind": "button",
   "label": {
    "uz": "Imtihonni bekor qilish",
    "ru": "Отменить экзамен",
    "en": "Cancel the exam"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a question to cancel this exam; the lessons it cancelled come back where nothing else holds their time."
  },
  {
   "id": "features/timetable/exams-page.tsx#button:timetable.exams.cancelSend",
   "kind": "button",
   "label": {
    "uz": "Imtihonni bekor qilish",
    "ru": "Отменить экзамен",
    "en": "Cancel the exam"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exams-page.tsx#panel:timetable.exams.cancelTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExamsController_cancel"
   ],
   "opens": null,
   "description": "Cancels the exam and gives its lessons back, or keeps the listed ones cancelled with the reason."
  },
  {
   "id": "features/timetable/exams-page.tsx#button:timetable.exams.change",
   "kind": "button",
   "label": {
    "uz": "Oʻzgartirish",
    "ru": "Изменить",
    "en": "Change"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the exam form to change this exam before it starts."
  },
  {
   "id": "features/timetable/exams-page.tsx#button:timetable.exams.keepExam",
   "kind": "button",
   "label": {
    "uz": "Imtihonni qoldirish",
    "ru": "Оставить экзамен",
    "en": "Keep the exam"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exams-page.tsx#panel:timetable.exams.cancelTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "ExamsController_cancel"
   ],
   "opens": null,
   "description": "Closes the question and keeps the exam."
  },
  {
   "id": "features/timetable/exams-page.tsx#button:timetable.exams.new",
   "kind": "button",
   "label": {
    "uz": "Yangi imtihon",
    "ru": "Новый экзамен",
    "en": "New exam"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new exam on the chosen date."
  },
  {
   "id": "features/timetable/exams-page.tsx#column:timetable.exams.examTitle",
   "kind": "column",
   "label": {
    "uz": "Nomi",
    "ru": "Название",
    "en": "Title"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the title of the exam; clicking it opens the exam in the side panel."
  },
  {
   "id": "features/timetable/exams-page.tsx#column:timetable.exams.invigilators",
   "kind": "column",
   "label": {
    "uz": "Nazoratchilar",
    "ru": "Наблюдатели",
    "en": "Invigilators"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the invigilators of the exam."
  },
  {
   "id": "features/timetable/exams-page.tsx#column:timetable.exams.rooms",
   "kind": "column",
   "label": {
    "uz": "Xonalar va sinflar",
    "ru": "Кабинеты и классы",
    "en": "Rooms and classes"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows each room of the exam with the classes or groups it holds."
  },
  {
   "id": "features/timetable/exams-page.tsx#column:timetable.exams.state",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the exam is planned, started or cancelled."
  },
  {
   "id": "features/timetable/exams-page.tsx#column:timetable.exams.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject of the exam, or No subject."
  },
  {
   "id": "features/timetable/exams-page.tsx#column:timetable.exams.time",
   "kind": "column",
   "label": {
    "uz": "Vaqt",
    "ru": "Время",
    "en": "Time"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the time of the exam."
  },
  {
   "id": "features/timetable/exams-page.tsx#field:timetable.exams.date",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the date whose exams are listed."
  },
  {
   "id": "features/timetable/exams-page.tsx#field:timetable.exams.keepReason",
   "kind": "field",
   "label": {
    "uz": "Darslar bekorligicha qolishining sababi",
    "ru": "Причина, по которой уроки остаются отменёнными",
    "en": "Reason for keeping lessons cancelled"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": "features/timetable/exams-page.tsx#panel:timetable.exams.cancelTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for keeping cancelled the lessons that cannot come back when the exam is cancelled."
  },
  {
   "id": "features/timetable/exams-page.tsx#panel:timetable.exams.cancelTitle",
   "kind": "panel",
   "label": {
    "uz": "«…» imtihonini bekor qilasizmi?",
    "ru": "Отменить экзамен «…»?",
    "en": "Cancel the exam \"…\"?"
   },
   "pages": [
    "/timetable/exams"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Asks before cancelling the exam; lessons that cannot come back are listed and can be kept cancelled with a reason."
  },
  {
   "id": "features/timetable/grid-clock-board.tsx#button:timetable.grid.openClass",
   "kind": "button",
   "label": {
    "uz": "Sinf jadvalini ochish",
    "ru": "Открыть доску класса",
    "en": "Open the class board"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the board of this lesson's class, where the lesson can be moved."
  },
  {
   "id": "features/timetable/grid-conflicts.tsx#button:timetable.grid.show",
   "kind": "button",
   "label": {
    "uz": "Darsni koʻrsatish",
    "ru": "Показать урок",
    "en": "Show the lesson"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the class board of the lesson behind this conflict and puts the focus on it."
  },
  {
   "id": "features/timetable/grid-conflicts.tsx#button:timetable.grid.show:2",
   "kind": "button",
   "label": {
    "uz": "Darsni koʻrsatish",
    "ru": "Показать урок",
    "en": "Show the lesson"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the entry in the To place list for a row of this conflict that has no lesson placed yet."
  },
  {
   "id": "features/timetable/grid-conflicts.tsx#field:timetable.grid.conflictFilter",
   "kind": "field",
   "label": {
    "uz": "Koʻrsatish",
    "ru": "Показать",
    "en": "Show"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses what the conflict panel lists: errors and warnings, errors only, or warnings only."
  },
  {
   "id": "features/timetable/grid-locks.tsx#button:timetable.grid.lockClass",
   "kind": "button",
   "label": {
    "uz": "Bu sinfni qulflash",
    "ru": "Закрепить этот класс",
    "en": "Lock this class"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Locks every lesson of the class shown, so suggestions and regeneration leave them where they are."
  },
  {
   "id": "features/timetable/grid-locks.tsx#button:timetable.grid.lockDay",
   "kind": "button",
   "label": {
    "uz": "Kunni qulflash",
    "ru": "Закрепить день",
    "en": "Lock the day"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Locks every lesson of the chosen weekday, so regeneration leaves it as it is."
  },
  {
   "id": "features/timetable/grid-locks.tsx#button:timetable.grid.lockTeacher",
   "kind": "button",
   "label": {
    "uz": "Oʻqituvchini qulflash",
    "ru": "Закрепить учителя",
    "en": "Lock the teacher"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Locks every lesson of the chosen teacher, so regeneration leaves them where they are."
  },
  {
   "id": "features/timetable/grid-locks.tsx#button:timetable.grid.unlock",
   "kind": "button",
   "label": {
    "uz": "Qulfni ochish",
    "ru": "Снять замок",
    "en": "Unlock"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes this lock, so suggestions and generation may move what it held."
  },
  {
   "id": "features/timetable/grid-locks.tsx#field:timetable.grid.lockDayLabel",
   "kind": "field",
   "label": {
    "uz": "Kun",
    "ru": "День",
    "en": "Day"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the weekday to lock."
  },
  {
   "id": "features/timetable/grid-locks.tsx#field:timetable.grid.lockTeacherLabel",
   "kind": "field",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the teacher to lock."
  },
  {
   "id": "features/timetable/grid-move-dialog.tsx#button:timetable.grid.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/grid-move-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog without moving the lesson."
  },
  {
   "id": "features/timetable/grid-move-dialog.tsx#button:timetable.grid.slotAt",
   "kind": "button",
   "label": {
    "uz": "…, …",
    "ru": "…, …",
    "en": "…, …"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/grid-move-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Moves the lesson to this weekday and time; a blocked slot cannot be chosen."
  },
  {
   "id": "features/timetable/grid-move-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that moves a lesson without dragging: every slot of the board with its free, warning or blocked mark."
  },
  {
   "id": "features/timetable/grid-place-form.tsx#field:timetable.grid.lesson",
   "kind": "field",
   "label": {
    "uz": "Dars",
    "ru": "Урок",
    "en": "Lesson"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses which lesson of the load to place in the empty slot, with how many of its lessons are already placed."
  },
  {
   "id": "features/timetable/grid-place-form.tsx#field:timetable.grid.pairedWith",
   "kind": "field",
   "label": {
    "uz": "Juftligi",
    "ru": "В паре с",
    "en": "Paired with"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the half of the mixed split this lesson is placed together with, or the whole split."
  },
  {
   "id": "features/timetable/grid-place-form.tsx#field:timetable.grid.placeDouble",
   "kind": "field",
   "label": {
    "uz": "Juft dars",
    "ru": "Сдвоенный урок",
    "en": "Double lesson"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When ticked, places the lesson as a double lesson."
  },
  {
   "id": "features/timetable/grid-place-form.tsx#field:timetable.grid.room",
   "kind": "field",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room of the new lesson from the rooms free in that slot, best fit first."
  },
  {
   "id": "features/timetable/grid-room-picker.tsx#button:timetable.grid.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the room list without changing the room."
  },
  {
   "id": "features/timetable/grid-room-picker.tsx#button:timetable.grid.unknownRoom",
   "kind": "button",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "A room"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Puts the lesson in this room; the list shows the rooms free in its slot with their capacity and warnings."
  },
  {
   "id": "features/timetable/grid-step.tsx#button:timetable.grid.addAt",
   "kind": "button",
   "label": {
    "uz": "Dars qoʻshish: …, …",
    "ru": "Добавить урок: …, …",
    "en": "Add a lesson on …, …"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to add a lesson in this empty slot of the class board."
  },
  {
   "id": "features/timetable/grid-step.tsx#button:timetable.grid.history.redo",
   "kind": "button",
   "label": {
    "uz": "Qaytarish",
    "ru": "Повторить",
    "en": "Redo"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_grid",
    "TimetableController_lessonRoom",
    "TimetableController_moveBlock",
    "TimetableController_placeBlock",
    "TimetableController_rearrangeBlocks",
    "TimetableController_removeBlock",
    "TimetableController_swapBlocks"
   ],
   "opens": null,
   "description": "Makes again the last change that was taken back."
  },
  {
   "id": "features/timetable/grid-step.tsx#button:timetable.grid.history.undo",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отменить",
    "en": "Undo"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_grid",
    "TimetableController_lessonRoom",
    "TimetableController_moveBlock",
    "TimetableController_placeBlock",
    "TimetableController_rearrangeBlocks",
    "TimetableController_removeBlock",
    "TimetableController_swapBlocks"
   ],
   "opens": null,
   "description": "Takes back the last change made in the grid."
  },
  {
   "id": "features/timetable/grid-step.tsx#field:timetable.grid.class",
   "kind": "field",
   "label": {
    "uz": "Sinf",
    "ru": "Класс",
    "en": "Class"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class whose board is shown."
  },
  {
   "id": "features/timetable/grid-step.tsx#field:timetable.grid.room",
   "kind": "field",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room whose week is shown on the clock board."
  },
  {
   "id": "features/timetable/grid-step.tsx#field:timetable.grid.teacher",
   "kind": "field",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the teacher whose week is shown on the clock board."
  },
  {
   "id": "features/timetable/grid-step.tsx#field:timetable.grid.view",
   "kind": "field",
   "label": {
    "uz": "Koʻrinish",
    "ru": "Вид",
    "en": "View"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the board: by class, by teacher or by room."
  },
  {
   "id": "features/timetable/grid-suggest-dialog.tsx#button:timetable.grid.applyAt",
   "kind": "button",
   "label": {
    "uz": "Qoʻllash: …",
    "ru": "Применить: …",
    "en": "Apply: …"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/grid-suggest-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Applies this suggestion: places or moves the lesson there, moving the other lessons it names."
  },
  {
   "id": "features/timetable/grid-suggest-dialog.tsx#button:timetable.grid.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/grid-suggest-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the suggestions without changing anything."
  },
  {
   "id": "features/timetable/grid-suggest-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Suggests places for a lesson: the best free slots, or moves of two or three other lessons that make room."
  },
  {
   "id": "features/timetable/grid-tile.tsx#button:timetable.grid.move",
   "kind": "button",
   "label": {
    "uz": "Koʻchirish",
    "ru": "Переместить",
    "en": "Move"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the move dialog to choose another slot for this lesson without dragging."
  },
  {
   "id": "features/timetable/grid-tile.tsx#button:timetable.grid.remove",
   "kind": "button",
   "label": {
    "uz": "Olib tashlash",
    "ru": "Убрать",
    "en": "Remove"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Removes this lesson from the draft after a confirmation."
  },
  {
   "id": "features/timetable/grid-tile.tsx#button:timetable.grid.roomOf",
   "kind": "button",
   "label": {
    "uz": "…, … xonasi",
    "ru": "Кабинет: …, …",
    "en": "Room of …, …"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the room list of this lesson to put it in another free room."
  },
  {
   "id": "features/timetable/grid-tile.tsx#button:timetable.grid.suggest",
   "kind": "button",
   "label": {
    "uz": "Joy taklif qilish",
    "ru": "Подсказать место",
    "en": "Suggest a place"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the suggestions of a better place for this lesson."
  },
  {
   "id": "features/timetable/grid-tile.tsx#button:timetable.grid.unlock",
   "kind": "button",
   "label": {
    "uz": "Qulfni ochish",
    "ru": "Снять замок",
    "en": "Unlock"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Locks this lesson in its place, or unlocks it when it is locked."
  },
  {
   "id": "features/timetable/grid-to-place.tsx#button:timetable.grid.place",
   "kind": "button",
   "label": {
    "uz": "Joylashtirish",
    "ru": "Поставить",
    "en": "Place"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the slot list of the board to place this lesson in a slot."
  },
  {
   "id": "features/timetable/grid-to-place.tsx#button:timetable.grid.suggest",
   "kind": "button",
   "label": {
    "uz": "Joy taklif qilish",
    "ru": "Подсказать место",
    "en": "Suggest a place"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens suggestions of free slots, or of moves that make room, for this lesson."
  },
  {
   "id": "features/timetable/grid-to-place.tsx#field:timetable.grid.pairedWith",
   "kind": "field",
   "label": {
    "uz": "Juftligi",
    "ru": "В паре с",
    "en": "Paired with"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the half of the mixed split this entry is placed together with, or the whole split."
  },
  {
   "id": "features/timetable/held-data.tsx#field:timetable.held.confirm",
   "kind": "field",
   "label": {
    "uz": "Baribir bekor qilish; yozuvlar saqlanadi, chizib qoʻyiladi va hech bir koʻrsatkichga kirmaydi",
    "ru": "Всё равно отменить; записи сохраняются, зачёркиваются и не входят ни в один показатель",
    "en": "Cancel all the same; the entries are kept, struck through and left out of every figure"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "A tick that cancels lessons holding attendance or marks anyway; the entries are kept, struck through and left out of every figure."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#button:timetable.day.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "JournalSubstitutionsController_absenceSubstitute",
    "JournalSubstitutionsController_vacancySubstitute"
   ],
   "opens": null,
   "description": "Closes the dialog without saving the substitution."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#button:timetable.day.substituteSend",
   "kind": "button",
   "label": {
    "uz": "Oʻrinbosarni saqlash",
    "ru": "Сохранить замену",
    "en": "Save the substitution"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "JournalSubstitutionsController_absenceSubstitute",
    "JournalSubstitutionsController_vacancySubstitute"
   ],
   "opens": null,
   "description": "Saves the substitute for every lesson of the journal in the period; the answer lists the dates saved and those blocked."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#button:timetable.journalSubstitute.close",
   "kind": "button",
   "label": {
    "uz": "Yopish",
    "ru": "Закрыть",
    "en": "Close"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the dialog after the substitution, once the dates saved and blocked are shown."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#field:timetable.day.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for the substitution."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#field:timetable.day.substitute",
   "kind": "field",
   "label": {
    "uz": "Oʻrinbosar",
    "ru": "Замена",
    "en": "Substitute"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the substitute; each teacher shows which dates they are free to take."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#field:timetable.day.substituteConfirm",
   "kind": "field",
   "label": {
    "uz": "Bularni tekshirdim va oʻrinbosarni saqlayman",
    "ru": "Я проверил(а) это и сохраняю замену",
    "en": "I have checked these and save the substitution"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "A tick that confirms the warnings listed have been checked; the substitution is then saved with them."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#field:timetable.journalSubstitute.from",
   "kind": "field",
   "label": {
    "uz": "Dan",
    "ru": "С",
    "en": "From"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first day of the period the substitute takes, for a vacancy."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#field:timetable.journalSubstitute.until",
   "kind": "field",
   "label": {
    "uz": "Gacha (oʻrinbosarsiz birinchi kun)",
    "ru": "До (первый день без заменяющего)",
    "en": "Until (the first day without the substitute)"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": "features/timetable/journal-substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first day without the substitute, for a vacancy; empty means no end."
  },
  {
   "id": "features/timetable/journal-substitute-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/people/vacancies",
    "/timetable/absences"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialog that gives one substitute every lesson of a journal over an absence or a vacancy period; each date is still checked."
  },
  {
   "id": "features/timetable/lesson-forced-delete.tsx#button:timetable.day.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": "features/timetable/lesson-forced-delete.tsx#panel:timetable.lessonHistory.title",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the history of the lesson."
  },
  {
   "id": "features/timetable/lesson-forced-delete.tsx#panel:timetable.lessonHistory.title",
   "kind": "panel",
   "label": {
    "uz": "Tarix: …, …, …",
    "ru": "История: …, …, …",
    "en": "History: …, …, …"
   },
   "pages": [
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the history of one lesson: every change of teacher, room, time or cancel, who made it and when."
  },
  {
   "id": "features/timetable/load-import-page.tsx#button:people.import.reading",
   "kind": "button",
   "label": {
    "uz": "Fayl oʻqilmoqda…",
    "ru": "Читаем файл…",
    "en": "Reading the file…"
   },
   "pages": [
    "/timetable/load/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a file picker to upload a filled-in teaching load file; the server reads it and shows a preview of every row."
  },
  {
   "id": "features/timetable/load-import-page.tsx#button:people.import.template",
   "kind": "button",
   "label": {
    "uz": "Shablonni yuklab olish",
    "ru": "Скачать шаблон",
    "en": "Download the template"
   },
   "pages": [
    "/timetable/load/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "LoadImportsController_template"
   ],
   "opens": null,
   "description": "Downloads the Excel template of the teaching load for the draft."
  },
  {
   "id": "features/timetable/load-import-page.tsx#button:timetable.loadImport.confirm",
   "kind": "button",
   "label": {
    "uz": "Barcha … ta qatorni qoʻshish",
    "ru": "Добавить все … строки",
    "en": "Add all … rows"
   },
   "pages": [
    "/timetable/load/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "LoadImportsController_confirm"
   ],
   "opens": null,
   "description": "Adds every row of the file to the draft's teaching load; it is on only when every row is clean."
  },
  {
   "id": "features/timetable/load-import-page.tsx#column:people.import.problemsColumn",
   "kind": "column",
   "label": {
    "uz": "Xatolar",
    "ru": "Ошибки",
    "en": "Problems"
   },
   "pages": [
    "/timetable/load/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows what is wrong with the row, or its warnings, as the server read it."
  },
  {
   "id": "features/timetable/load-import-page.tsx#column:people.import.row",
   "kind": "column",
   "label": {
    "uz": "Qator",
    "ru": "Строка",
    "en": "Row"
   },
   "pages": [
    "/timetable/load/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the row number of the line in the uploaded file."
  },
  {
   "id": "features/timetable/load-import-page.tsx#column:timetable.loadImport.rowColumn",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh, fan, oʻqituvchi, darslar",
    "ru": "Класс или группа, предмет, учитель, уроки",
    "en": "Class or group, subject, teacher, lessons"
   },
   "pages": [
    "/timetable/load/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the class or group, subject, teacher and lessons per week as the file has them."
  },
  {
   "id": "features/timetable/load-page.tsx#button:timetable.load.add",
   "kind": "button",
   "label": {
    "uz": "Qator qoʻshish",
    "ru": "Добавить строку",
    "en": "Add row"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new row of the teaching load."
  },
  {
   "id": "features/timetable/load-page.tsx#button:timetable.load.add:2",
   "kind": "button",
   "label": {
    "uz": "Qator qoʻshish",
    "ru": "Добавить строку",
    "en": "Add row"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new row of the teaching load."
  },
  {
   "id": "features/timetable/load-page.tsx#button:timetable.load.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new row form without saving."
  },
  {
   "id": "features/timetable/load-page.tsx#button:timetable.load.changeStart",
   "kind": "button",
   "label": {
    "uz": "Boshlanish sanasini oʻzgartirish",
    "ru": "Изменить дату начала",
    "en": "Change start date"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change the start date of the draft."
  },
  {
   "id": "features/timetable/load-page.tsx#button:timetable.load.dismiss",
   "kind": "button",
   "label": {
    "uz": "Olib tashlash",
    "ru": "Убрать",
    "en": "Dismiss"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_editVersion"
   ],
   "opens": null,
   "description": "Hides, after a confirmation, the list of rows a copy could not bring over; the audit log keeps them."
  },
  {
   "id": "features/timetable/load-page.tsx#button:timetable.load.newDraft",
   "kind": "button",
   "label": {
    "uz": "Yangi qoralama",
    "ru": "Новый черновик",
    "en": "New draft"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form for a new draft: its year, its start date, and empty or a copy of a version."
  },
  {
   "id": "features/timetable/load-page.tsx#button:timetable.load.withdraw",
   "kind": "button",
   "label": {
    "uz": "Qaytarib olish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the question to withdraw this published version before it starts; the earlier version runs again over its dates."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.blockColumn",
   "kind": "column",
   "label": {
    "uz": "Blok",
    "ru": "Блок",
    "en": "Block"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows, for a group row, the other groups of its block that meet at the same time."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.columns.double",
   "kind": "column",
   "label": {
    "uz": "Juft darslar",
    "ru": "Сдвоенные уроки",
    "en": "Double lessons"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether double lessons are allowed for the row."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.columns.lessons",
   "kind": "column",
   "label": {
    "uz": "Haftalik darslar",
    "ru": "Уроков в неделю",
    "en": "Lessons per week"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows how many lessons a week the row has."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.columns.problems",
   "kind": "column",
   "label": {
    "uz": "Muammolar",
    "ru": "Проблемы",
    "en": "Problems"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the problems the row has today, such as a teacher out or a subject not in the profile."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.columns.room",
   "kind": "column",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the room or room type the row needs, or no room."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.columns.subject",
   "kind": "column",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the subject of the load row."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.columns.teacher",
   "kind": "column",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the teacher or vacancy of the load row."
  },
  {
   "id": "features/timetable/load-page.tsx#column:timetable.load.columns.unit",
   "kind": "column",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the class or group of the load row; clicking it opens the row in the side panel."
  },
  {
   "id": "features/timetable/load-page.tsx#field:timetable.load.version",
   "kind": "field",
   "label": {
    "uz": "Versiya",
    "ru": "Версия",
    "en": "Version"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the timetable version whose teaching load is shown."
  },
  {
   "id": "features/timetable/load-row-form.tsx#button:timetable.load.useGroup",
   "kind": "button",
   "label": {
    "uz": "… guruhini tanlash",
    "ru": "Выбрать группу …",
    "en": "Use group …"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Puts this group in place of the class, for a subject taught in groups by default."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.doubleLessons",
   "kind": "field",
   "label": {
    "uz": "Juft darslarga ruxsat",
    "ru": "Сдвоенные уроки разрешены",
    "en": "Double lessons allowed"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When ticked, the row's lessons may be placed as double lessons."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.lessons",
   "kind": "field",
   "label": {
    "uz": "Haftalik darslar",
    "ru": "Уроков в неделю",
    "en": "Lessons per week"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds how many lessons a week the row has."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.mixedBlock",
   "kind": "field",
   "label": {
    "uz": "Aralash blok (qismlar turli vaqtda oʻtadi)",
    "ru": "Смешанный блок (половины занимаются в разное время)",
    "en": "Mixed block (the halves meet in different slots)"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "When ticked, the halves of a split meet in different slots and one teacher may take both halves."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.room",
   "kind": "field",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses a room or a room type the row needs, or no room."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.shortReason",
   "kind": "field",
   "label": {
    "uz": "Ataylab kam: sababi",
    "ru": "Намеренно меньше: причина",
    "en": "Deliberately short: reason"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason when the row has fewer lessons placed than its lessons per week on purpose."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.subject",
   "kind": "field",
   "label": {
    "uz": "Fan",
    "ru": "Предмет",
    "en": "Subject"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the subject of the row."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.teacher",
   "kind": "field",
   "label": {
    "uz": "Oʻqituvchi",
    "ru": "Учитель",
    "en": "Teacher"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the teacher or vacancy who teaches the row."
  },
  {
   "id": "features/timetable/load-row-form.tsx#field:timetable.load.unit",
   "kind": "field",
   "label": {
    "uz": "Sinf yoki guruh",
    "ru": "Класс или группа",
    "en": "Class or group"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the class or group the row is for."
  },
  {
   "id": "features/timetable/load-row-panel.tsx#button:form.edit",
   "kind": "button",
   "label": {
    "uz": "Tahrirlash",
    "ru": "Изменить",
    "en": "Edit"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": "features/timetable/load-row-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the row's form to change its teacher, lessons per week, room and double lessons."
  },
  {
   "id": "features/timetable/load-row-panel.tsx#button:timetable.load.deleteRow",
   "kind": "button",
   "label": {
    "uz": "Qatorni oʻchirish",
    "ru": "Удалить строку",
    "en": "Delete row"
   },
   "pages": [
    "/timetable/load"
   ],
   "parent": "features/timetable/load-row-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_deleteRow"
   ],
   "opens": null,
   "description": "Deletes the row from the draft after a confirmation; the audit log keeps a copy."
  },
  {
   "id": "features/timetable/load-row-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of a teaching load row: its fields and problems, with Edit and Delete."
  },
  {
   "id": "features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.allDraft",
   "kind": "button",
   "label": {
    "uz": "Hamma joyda qoralamani qoldirish",
    "ru": "Везде оставить черновик",
    "en": "Keep the draft everywhere"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/out-of-date-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Picks the draft's side for every difference."
  },
  {
   "id": "features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.allPublished",
   "kind": "button",
   "label": {
    "uz": "Hamma joyda eʼlon qilingan versiyani olish",
    "ru": "Везде взять опубликованную версию",
    "en": "Take the published version everywhere"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/out-of-date-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Picks the published version's side for every difference."
  },
  {
   "id": "features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.bring",
   "kind": "button",
   "label": {
    "uz": "Yangilash",
    "ru": "Обновить черновик",
    "en": "Bring up to date"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/out-of-date-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_bringUpToDate"
   ],
   "opens": null,
   "description": "Brings the draft up to date with the picks made; it is on once every difference has a pick."
  },
  {
   "id": "features/timetable/out-of-date-panel.tsx#button:timetable.outOfDate.openCheck",
   "kind": "button",
   "label": {
    "uz": "Tekshiruvni ochish",
    "ru": "Открыть проверку",
    "en": "Open the check"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/out-of-date-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the builder step that lists the reasons the draft cannot be published now."
  },
  {
   "id": "features/timetable/out-of-date-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows why the draft is out of date and every difference from the published version, with a choice for each, to bring the draft up to date."
  },
  {
   "id": "features/timetable/out-of-date-panel.tsx#tab:timetable.outOfDate.pick",
   "kind": "tab",
   "label": {
    "uz": "Qaysi biri qoladi: …",
    "ru": "Что оставить: …",
    "en": "Which to keep: …"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": "features/timetable/out-of-date-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses, for this difference, whether to keep the draft or take the published version."
  },
  {
   "id": "features/timetable/pattern-import-page.tsx#button:people.import.reading",
   "kind": "button",
   "label": {
    "uz": "Fayl oʻqilmoqda…",
    "ru": "Читаем файл…",
    "en": "Reading the file…"
   },
   "pages": [
    "/timetable/pattern/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a file picker to upload a filled-in timetable file; the server reads it and shows a preview with problems and warnings."
  },
  {
   "id": "features/timetable/pattern-import-page.tsx#button:people.import.template",
   "kind": "button",
   "label": {
    "uz": "Shablonni yuklab olish",
    "ru": "Скачать шаблон",
    "en": "Download the template"
   },
   "pages": [
    "/timetable/pattern/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "PatternImportsController_template"
   ],
   "opens": null,
   "description": "Downloads the Excel template of the timetable for the draft."
  },
  {
   "id": "features/timetable/pattern-import-page.tsx#button:timetable.patternImport.confirm",
   "kind": "button",
   "label": {
    "uz": "Barcha … ta darsni joylashtirish",
    "ru": "Расставить все … урока",
    "en": "Place all … lessons"
   },
   "pages": [
    "/timetable/pattern/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "PatternImportsController_confirm"
   ],
   "opens": null,
   "description": "Places every lesson of the file in the draft, after asking to remove the draft's placed lessons; it is on only when every row is clean."
  },
  {
   "id": "features/timetable/pattern-import-page.tsx#column:people.import.problemsColumn",
   "kind": "column",
   "label": {
    "uz": "Xatolar",
    "ru": "Ошибки",
    "en": "Problems"
   },
   "pages": [
    "/timetable/pattern/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows what is wrong with the row, as the server read it."
  },
  {
   "id": "features/timetable/pattern-import-page.tsx#column:people.import.row",
   "kind": "column",
   "label": {
    "uz": "Qator",
    "ru": "Строка",
    "en": "Row"
   },
   "pages": [
    "/timetable/pattern/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the row number of the line in the uploaded file."
  },
  {
   "id": "features/timetable/pattern-import-page.tsx#column:timetable.patternImport.rowColumn",
   "kind": "column",
   "label": {
    "uz": "Hafta kuni, dars, sinf yoki guruh, fan, oʻqituvchi, xona",
    "ru": "День недели, урок, класс или группа, предмет, учитель, кабинет",
    "en": "Weekday, lesson, class or group, subject, teacher, room"
   },
   "pages": [
    "/timetable/pattern/import"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the weekday, lesson, class or group, subject, teacher and room as the file has them."
  },
  {
   "id": "features/timetable/pins-section.tsx#button:timetable.builder.pins.remove",
   "kind": "button",
   "label": {
    "uz": "Olib tashlash",
    "ru": "Убрать",
    "en": "Remove"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_deletePin"
   ],
   "opens": null,
   "description": "Removes this pin, so the lesson is no longer fixed to that time."
  },
  {
   "id": "features/timetable/pins-section.tsx#field:timetable.builder.pins.row",
   "kind": "field",
   "label": {
    "uz": "Dars",
    "ru": "Урок",
    "en": "Lesson"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the lesson of the load to pin to a fixed time."
  },
  {
   "id": "features/timetable/pins-section.tsx#field:timetable.builder.pins.slot",
   "kind": "field",
   "label": {
    "uz": "Slot",
    "ru": "Слот",
    "en": "Slot"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the lesson slot of the weekday the lesson is pinned to."
  },
  {
   "id": "features/timetable/pins-section.tsx#field:timetable.builder.pins.weekday",
   "kind": "field",
   "label": {
    "uz": "Kun",
    "ru": "День",
    "en": "Day"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the weekday of the pin."
  },
  {
   "id": "features/timetable/publish-chain.tsx#field:timetable.publish.chain.title",
   "kind": "field",
   "label": {
    "uz": "Keyingi eʼlon qilingan versiyalar",
    "ru": "Более поздние опубликованные версии",
    "en": "Later published versions"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses what happens to later published versions: run until the next one starts, replace them, or carry the change into them."
  },
  {
   "id": "features/timetable/publish-check-parts.tsx#button:timetable.publish.openGrid",
   "kind": "button",
   "label": {
    "uz": "Jadvalni ochish",
    "ru": "Открыть сетку",
    "en": "Open the grid"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the grid step of the builder to fix the blocked rule shown beside it."
  },
  {
   "id": "features/timetable/publish-day-changes.tsx#field:timetable.publish.dayChanges.exams.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/vacancies",
    "/setup/day-template-settings",
    "/setup/years",
    "/timetable/builder",
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for the choice made for an exam that clashes with the new timetable."
  },
  {
   "id": "features/timetable/publish-day-changes.tsx#field:timetable.publish.dayChanges.substitutions.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/people/vacancies",
    "/setup/day-template-settings",
    "/setup/years",
    "/timetable/builder",
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for cancelling, that day, a lesson whose substitution the new timetable no longer fits."
  },
  {
   "id": "features/timetable/publish-impact.tsx#button:timetable.publish.impact.showAll",
   "kind": "button",
   "label": {
    "uz": "Barcha … qatorni koʻrsatish",
    "ru": "Показать все … строки",
    "en": "Show all … lines"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows every line of the changes, not only the first 20."
  },
  {
   "id": "features/timetable/publish-shortened.tsx#button:timetable.publish.shortened.remove",
   "kind": "button",
   "label": {
    "uz": "Olib tashlash",
    "ru": "Убрать",
    "en": "Remove"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_setDayKeep"
   ],
   "opens": null,
   "description": "Removes a stored choice that no longer decides anything."
  },
  {
   "id": "features/timetable/publish-shortened.tsx#button:timetable.publish.shortened.reset",
   "kind": "button",
   "label": {
    "uz": "Avvalgi holatga qaytarish",
    "ru": "Вернуть как было",
    "en": "Back to the default"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_setDayKeep"
   ],
   "opens": null,
   "description": "Removes the choice for this day, so the default lessons are kept."
  },
  {
   "id": "features/timetable/publish-shortened.tsx#button:timetable.publish.shortened.save",
   "kind": "button",
   "label": {
    "uz": "Tanlovni saqlash",
    "ru": "Сохранить выбор",
    "en": "Save the choice"
   },
   "pages": [
    "/people/vacancies",
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_setDayKeep"
   ],
   "opens": null,
   "description": "Saves which lessons are kept on this shortened day for the class."
  },
  {
   "id": "features/timetable/publish-step.tsx#button:timetable.publish.action",
   "kind": "button",
   "label": {
    "uz": "Eʼlon qilish",
    "ru": "Опубликовать",
    "en": "Publish"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_publish"
   ],
   "opens": null,
   "description": "Publishes the draft from the start date after a confirmation; it is on only when nothing blocks the publish."
  },
  {
   "id": "features/timetable/publish-step.tsx#button:timetable.publish.defaultStart",
   "kind": "button",
   "label": {
    "uz": "Odatiy boshlanish: …",
    "ru": "Обычное начало: …",
    "en": "Usual start: …"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Puts the usual start date, next Monday, in the start date field."
  },
  {
   "id": "features/timetable/publish-step.tsx#button:timetable.publish.quarterStart",
   "kind": "button",
   "label": {
    "uz": "Chorak boshi: …",
    "ru": "Начало четверти: …",
    "en": "Quarter start: …"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Puts the first day of this coming quarter in the start date field."
  },
  {
   "id": "features/timetable/publish-step.tsx#field:timetable.publish.startsOn",
   "kind": "field",
   "label": {
    "uz": "Boshlanish sanasi",
    "ru": "Дата начала",
    "en": "Start date"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the new version starts; the check below is made for it."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.firstDay",
   "kind": "field",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the first day of the closure."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.firstDay:2",
   "kind": "field",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new first day of the closure; it can be changed only before the closure has started."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.lastDay",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the last day of the closure."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.lastDay:2",
   "kind": "field",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new last day of the closure."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.moveReason",
   "kind": "field",
   "label": {
    "uz": "Oʻzgarish sababi",
    "ru": "Причина изменения",
    "en": "Reason of the change"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason of the one-day room changes; it starts as the closure's reason."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.moveRoom",
   "kind": "field",
   "label": {
    "uz": "Shu davr uchun xona",
    "ru": "Кабинет на этот период",
    "en": "Room for the period"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room the closed room's lessons go to for the period."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason the room is closed, for example repairs."
  },
  {
   "id": "features/timetable/room-closure-form.tsx#field:timetable.roomClosures.room",
   "kind": "field",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the room to close."
  },
  {
   "id": "features/timetable/room-closure-panel.tsx#button:timetable.roomClosures.changeDates",
   "kind": "button",
   "label": {
    "uz": "Sanalarni oʻzgartirish",
    "ru": "Изменить даты",
    "en": "Change the dates"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": "features/timetable/room-closure-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to change the first day (before it starts) or the last day of the closure."
  },
  {
   "id": "features/timetable/room-closure-panel.tsx#button:timetable.roomClosures.moveAll",
   "kind": "button",
   "label": {
    "uz": "Hammasini boshqa xonaga koʻchirish",
    "ru": "Перенести все в другой кабинет",
    "en": "Move all to another room"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": "features/timetable/room-closure-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens a form to move every lesson of the closed room to another room for the period; nothing moves if some cannot go there."
  },
  {
   "id": "features/timetable/room-closure-panel.tsx#button:timetable.roomClosures.withdraw",
   "kind": "button",
   "label": {
    "uz": "Bekor qilish",
    "ru": "Отозвать",
    "en": "Withdraw"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": "features/timetable/room-closure-panel.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "RoomClosuresController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws the closure after a confirmation; its lessons stay in the room and it cannot be changed again."
  },
  {
   "id": "features/timetable/room-closure-panel.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The side panel of a room closure: its details, the buttons to change, move or withdraw it, and the room's lessons inside it, marked when they need a room."
  },
  {
   "id": "features/timetable/room-closures-page.tsx#button:timetable.roomClosures.add",
   "kind": "button",
   "label": {
    "uz": "Xonani yopish",
    "ru": "Закрыть кабинет",
    "en": "Close a room"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the form to close a room: the room, the first and last day and the reason."
  },
  {
   "id": "features/timetable/room-closures-page.tsx#button:timetable.roomClosures.cancel",
   "kind": "button",
   "label": {
    "uz": "Bekor",
    "ru": "Отмена",
    "en": "Cancel"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Closes the new closure form without saving."
  },
  {
   "id": "features/timetable/room-closures-page.tsx#column:timetable.roomClosures.firstDay",
   "kind": "column",
   "label": {
    "uz": "Birinchi kun",
    "ru": "Первый день",
    "en": "First day"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the first day of the closure."
  },
  {
   "id": "features/timetable/room-closures-page.tsx#column:timetable.roomClosures.lastDay",
   "kind": "column",
   "label": {
    "uz": "Oxirgi kun",
    "ru": "Последний день",
    "en": "Last day"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the last day of the closure."
  },
  {
   "id": "features/timetable/room-closures-page.tsx#column:timetable.roomClosures.reason",
   "kind": "column",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the reason the room is closed."
  },
  {
   "id": "features/timetable/room-closures-page.tsx#column:timetable.roomClosures.room",
   "kind": "column",
   "label": {
    "uz": "Xona",
    "ru": "Кабинет",
    "en": "Room"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the closed room; clicking it opens the closure in the side panel."
  },
  {
   "id": "features/timetable/room-closures-page.tsx#column:timetable.roomClosures.state",
   "kind": "column",
   "label": {
    "uz": "Holat",
    "ru": "Состояние",
    "en": "State"
   },
   "pages": [
    "/timetable/room-closures"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the closure is planned, happening now, ended or withdrawn."
  },
  {
   "id": "features/timetable/rules-step.tsx#button:timetable.builder.rulesStep.confirm",
   "kind": "button",
   "label": {
    "uz": "Qoidalarni tasdiqlash",
    "ru": "Подтвердить правила",
    "en": "Confirm the rules"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "TimetableController_confirmRules"
   ],
   "opens": null,
   "description": "Confirms the rules, the saved preference weights and the pinned lessons, which marks this step ready."
  },
  {
   "id": "features/timetable/rules-step.tsx#field:timetable.preference.class_no_gaps",
   "kind": "field",
   "label": {
    "uz": "Sinfning birinchi va oxirgi darsi orasida boʻsh dars sloti yoʻq",
    "ru": "У класса нет пустого урочного слота между первым и последним уроком",
    "en": "A class has no empty lesson slot between its first and last lesson"
   },
   "pages": [
    "/timetable/builder"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Sets the weight, from 0 (not used) to 10, of the preference that a class has no empty slot between its first and last lesson; each preference has such a field."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#button:timetable.day.back",
   "kind": "button",
   "label": {
    "uz": "Orqaga",
    "ru": "Назад",
    "en": "Back"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.substituteTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "SubstitutionsController_substitute"
   ],
   "opens": null,
   "description": "Closes the dialog without saving."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#button:timetable.day.keep",
   "kind": "button",
   "label": {
    "uz": "Darsni qoldirish",
    "ru": "Оставить урок",
    "en": "Keep the lesson"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.withdrawSubstitutionTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "SubstitutionsController_withdraw"
   ],
   "opens": null,
   "description": "Closes the dialog and keeps the substitution."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#button:timetable.day.substituteSend",
   "kind": "button",
   "label": {
    "uz": "Oʻrinbosarni saqlash",
    "ru": "Сохранить замену",
    "en": "Save the substitution"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.substituteTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "SubstitutionsController_substitute"
   ],
   "opens": null,
   "description": "Saves the substitute for this lesson."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#button:timetable.day.withdrawSubstitutionSend",
   "kind": "button",
   "label": {
    "uz": "Oʻrinbosarni bekor qilish",
    "ru": "Отменить замену",
    "en": "Withdraw the substitution"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.withdrawSubstitutionTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [
    "SubstitutionsController_withdraw"
   ],
   "opens": null,
   "description": "Withdraws the substitution of this lesson."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#field:timetable.day.reason",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.substituteTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for the substitution."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#field:timetable.day.reason:2",
   "kind": "field",
   "label": {
    "uz": "Sabab",
    "ru": "Причина",
    "en": "Reason"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.withdrawSubstitutionTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the reason for withdrawing the substitution."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#field:timetable.day.substitute",
   "kind": "field",
   "label": {
    "uz": "Oʻrinbosar",
    "ru": "Замена",
    "en": "Substitute"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.substituteTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the substitute from the free teachers; those who cannot teach in the class's language are listed last and marked."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#field:timetable.day.substituteConfirm",
   "kind": "field",
   "label": {
    "uz": "Bularni tekshirdim va oʻrinbosarni saqlayman",
    "ru": "Я проверил(а) это и сохраняю замену",
    "en": "I have checked these and save the substitution"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel:timetable.day.substituteTitle",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "A tick that confirms the warnings listed have been checked; the substitution is then saved with them."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "The dialogs that give one lesson a substitute teacher, or withdraw a substitution, each with a reason."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#panel:timetable.day.substituteTitle",
   "kind": "panel",
   "label": {
    "uz": "…, … darsiga oʻrinbosar",
    "ru": "Замена: … в …",
    "en": "Substitute for … at …"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Gives this lesson a substitute: teachers free at that time are suggested, same subject first, then same department."
  },
  {
   "id": "features/timetable/substitute-dialog.tsx#panel:timetable.day.withdrawSubstitutionTitle",
   "kind": "panel",
   "label": {
    "uz": "…, … darsidagi oʻrinbosarni bekor qilish",
    "ru": "Отменить замену: … в …",
    "en": "Withdraw the substitution of … at …"
   },
   "pages": [
    "/timetable/absences",
    "/timetable/day"
   ],
   "parent": "features/timetable/substitute-dialog.tsx#panel",
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Withdraws the substitution of this lesson, with a reason; the lesson goes back to its teacher."
  },
  {
   "id": "features/timetable/teaching-home.tsx#button:journal.open",
   "kind": "button",
   "label": {
    "uz": "Jurnalni ochish",
    "ru": "Открыть журнал",
    "en": "Open the journal"
   },
   "pages": [
    "/"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal",
    "spiritual_vice_principal",
    "head_tutor",
    "tutor",
    "class_teacher",
    "senior_head_teacher",
    "head_teacher",
    "teacher",
    "hr",
    "nurse",
    "psychologist",
    "librarian"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the journal of this lesson for the day, switching to the lesson's branch first when needed."
  },
  {
   "id": "features/timetable/timetable-file-buttons.tsx#button:timetable.views.excel",
   "kind": "button",
   "label": {
    "uz": "Excel",
    "ru": "Excel",
    "en": "Excel"
   },
   "pages": [
    "/journal/$journalId",
    "/plans/$journalId",
    "/timetable/versions",
    "/timetable/views"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Downloads the file as an Excel workbook; the download is logged."
  },
  {
   "id": "features/timetable/timetable-file-buttons.tsx#button:timetable.views.pdf",
   "kind": "button",
   "label": {
    "uz": "PDF",
    "ru": "PDF",
    "en": "PDF"
   },
   "pages": [
    "/journal/$journalId",
    "/plans/$journalId",
    "/timetable/versions",
    "/timetable/views"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Downloads the file as a PDF; the download is logged."
  },
  {
   "id": "features/timetable/timetable-file-buttons.tsx#button:timetable.views.print",
   "kind": "button",
   "label": {
    "uz": "Chop etish",
    "ru": "Печать",
    "en": "Print"
   },
   "pages": [
    "/journal/$journalId",
    "/plans/$journalId",
    "/timetable/versions",
    "/timetable/views"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the file as a PDF in a new browser tab, to print it there."
  },
  {
   "id": "features/timetable/version-files.tsx#field:timetable.history.printWhat",
   "kind": "field",
   "label": {
    "uz": "Nimani chop etish",
    "ru": "Что печатать",
    "en": "What to print"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses what to print or export of the version: the whole school, a class, a teacher or a room."
  },
  {
   "id": "features/timetable/version-form.tsx#button:timetable.load.quarterShortcut",
   "kind": "button",
   "label": {
    "uz": "…-chorak: …",
    "ru": "…-я четверть: …",
    "en": "Quarter …: …"
   },
   "pages": [
    "/timetable/builder",
    "/timetable/load",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Puts the first day of this coming quarter in the start date field."
  },
  {
   "id": "features/timetable/version-form.tsx#field:timetable.load.copyFrom",
   "kind": "field",
   "label": {
    "uz": "Nimadan boshlash",
    "ru": "Начать с",
    "en": "Start from"
   },
   "pages": [
    "/timetable/builder",
    "/timetable/load",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses whether the new draft starts empty or as a copy of a version of the same year."
  },
  {
   "id": "features/timetable/version-form.tsx#field:timetable.load.startsOn",
   "kind": "field",
   "label": {
    "uz": "Boshlanish sanasi",
    "ru": "Дата начала",
    "en": "Start date"
   },
   "pages": [
    "/timetable/builder",
    "/timetable/load",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the date the new draft is meant to start; next Monday by default."
  },
  {
   "id": "features/timetable/version-form.tsx#field:timetable.load.startsOn:2",
   "kind": "field",
   "label": {
    "uz": "Boshlanish sanasi",
    "ru": "Дата начала",
    "en": "Start date"
   },
   "pages": [
    "/timetable/builder",
    "/timetable/load",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Holds the new start date of the draft when changing it."
  },
  {
   "id": "features/timetable/version-form.tsx#field:timetable.load.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/timetable/builder",
    "/timetable/load",
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year of the new draft."
  },
  {
   "id": "features/timetable/versions-page.tsx#button:timetable.history.restore",
   "kind": "button",
   "label": {
    "uz": "Yangi qoralama sifatida tiklash",
    "ru": "Восстановить как новый черновик",
    "en": "Restore as a new draft"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Opens the new draft form prefilled as a copy of this version, to reopen it as a new draft."
  },
  {
   "id": "features/timetable/versions-page.tsx#column:timetable.history.columns.copiedFrom",
   "kind": "column",
   "label": {
    "uz": "Nusxa olingan",
    "ru": "Скопирована из",
    "en": "Copied from"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the version this one was copied from, if any."
  },
  {
   "id": "features/timetable/versions-page.tsx#column:timetable.history.columns.inForce",
   "kind": "column",
   "label": {
    "uz": "Amalda",
    "ru": "Действует",
    "en": "In force on"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the quarters on whose first day this version is in force."
  },
  {
   "id": "features/timetable/versions-page.tsx#column:timetable.history.columns.status",
   "kind": "column",
   "label": {
    "uz": "Holati",
    "ru": "Статус",
    "en": "Status"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows whether the version is a draft, published or withdrawn."
  },
  {
   "id": "features/timetable/versions-page.tsx#column:timetable.history.columns.validFrom",
   "kind": "column",
   "label": {
    "uz": "Amal qilish sanasi",
    "ru": "Действует с",
    "en": "Valid from"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the date the version starts."
  },
  {
   "id": "features/timetable/versions-page.tsx#column:timetable.history.columns.version",
   "kind": "column",
   "label": {
    "uz": "Versiya",
    "ru": "Версия",
    "en": "Version"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Shows the version number; clicking it opens the version in the side panel."
  },
  {
   "id": "features/timetable/versions-page.tsx#field:timetable.history.compareWith",
   "kind": "field",
   "label": {
    "uz": "Solishtiriladigan versiya",
    "ru": "Сравнить с",
    "en": "Compare with"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses another version of the year to compare with; the changes between the two are listed."
  },
  {
   "id": "features/timetable/versions-page.tsx#field:timetable.history.year",
   "kind": "field",
   "label": {
    "uz": "Oʻquv yili",
    "ru": "Учебный год",
    "en": "Academic year"
   },
   "pages": [
    "/timetable/versions"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the academic year whose versions are listed."
  },
  {
   "id": "features/timetable/views-page.tsx#field:timetable.views.date",
   "kind": "field",
   "label": {
    "uz": "Sana",
    "ru": "Дата",
    "en": "Date"
   },
   "pages": [
    "/timetable/views"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Chooses the date the view shows, or the week it falls in."
  },
  {
   "id": "features/timetable/views-page.tsx#tab:timetable.views.kind",
   "kind": "tab",
   "label": {
    "uz": "Koʻrinish",
    "ru": "Вид",
    "en": "View"
   },
   "pages": [
    "/timetable/views"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches the timetable shown between the whole school, a class, a teacher and a room."
  },
  {
   "id": "features/timetable/views-page.tsx#tab:timetable.views.span",
   "kind": "tab",
   "label": {
    "uz": "Davr",
    "ru": "Период",
    "en": "Period"
   },
   "pages": [
    "/timetable/views"
   ],
   "parent": null,
   "roles": [
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
   ],
   "operations": [],
   "opens": null,
   "description": "Switches between one day and the whole week."
  },
  {
   "id": "features/timetable/withdraw-dialog.tsx#panel",
   "kind": "panel",
   "label": null,
   "pages": [
    "/timetable/load"
   ],
   "parent": null,
   "roles": [
    "super_admin",
    "principal",
    "academic_vice_principal"
   ],
   "operations": [],
   "opens": null,
   "description": "Asks before withdrawing a published version, listing its one-day changes as kept, needing a decision or dropped; Withdraw waits for each decision."
  }
 ]
};
