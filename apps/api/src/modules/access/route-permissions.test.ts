import { randomUUID } from 'node:crypto';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ROLES, type Role } from '@sodiq/shared';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { insertBranch } from '../../testing/branch-filter-sql.js';
import { createTestApp } from '../../testing/create-test-app.js';
import { FixedClock } from '../../testing/fixed-clock.js';
import {
  EveryMethodController,
  FaultyAccessController,
  PermissionSampleController,
  SAMPLE_PERMISSIONS,
} from '../../testing/permission-sample.controller.js';
import {
  accessProblems,
  declarationProblems,
  harnessCallers,
  StopBeforeHandler,
  type ExpectedAccess,
  type HarnessCallers,
} from '../../testing/route-harness.js';
import { expressRoutesOf, routesOf } from '../../testing/routes.js';
import { createTestDatabase, type TestDatabase } from '../../testing/test-database.js';

/**
 * docs/spec/14-quality-plan.md, "Permission tests": "For every role and every
 * API address, a test checks what is allowed and what is refused." This is the
 * list for the application as it runs, written by hand: for each route, who
 * may call it. A new route fails here until it is added; the harness then
 * calls it as each of the 15 roles, as an account without a role and without
 * sign-in, and compares.
 *
 * A route with a permission lists the roles the table gives its action. What
 * the roles may do is decided in `PERMISSIONS` (`packages/shared`); this list
 * is the second, independent statement of it.
 */
/** The roles that read the branch record, the buildings, the floors and the rooms of a branch. */
const SETUP_VIEWERS: readonly Role[] = ['super_admin', 'principal', 'academic_vice_principal'];

/** Slot types and day templates (task 1.5, answer 14): the Principal views, the other two write. */
const TEMPLATE_VIEWERS = SETUP_VIEWERS;
const TEMPLATE_WRITERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];
// Task 1.4, the owner's answer 18: the area `calendar`.
const CALENDAR_VIEWERS = SETUP_VIEWERS;
const CALENDAR_WRITERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];
// Task 1.6, the owner's answer 24: the area `settings`; travel time under `branches`.
const SETTINGS_VIEWERS = SETUP_VIEWERS;
const SETTINGS_WRITERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];
// Task 2.1, the owner's answer 4 and decision 1: the area `subjects`.
const SUBJECT_VIEWERS = SETUP_VIEWERS;
const SUBJECT_WRITERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

// Task 2.2a, decision 2 of pull request #53: the areas `staff` and
// `staff_teaching`. The server further keeps the branches and the status to
// the Super Admin and the Academic Vice Principal's edit to name, phone and
// email, decided from every current assignment (tested in staff.test.ts).
const STAFF_VIEWERS = SETUP_VIEWERS;
const STAFF_EDITORS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

// Task 2.4a, decision 2 of pull request #67: the area `students`. Task 3.6a
// (L48): the Teacher, the students taught only; the "No class" counter and
// the identity show refuse a Teacher alone in the route (who-sees-what.test.ts).
const STUDENT_VIEWERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
];
const STUDENT_EDITORS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

// Task 2.3c-1, decision 2 of pull request #65: the area `account_access`.
const ACCESS_EDITORS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

// Task 2.2c-1, decision 2 of pull request #58: `export` in `rooms`,
// `divisions`, `subjects`, `staff` and `vacancies` for the three roles that
// view them. The server further leaves the phone out of the Principal's staff
// file (tested in people/exports.test.ts).
const EXPORTERS = SETUP_VIEWERS;

// Task 3.1a, decision 5 of pull request #88 (Look first): the area `classes`.
// Task 3.1c (decision 1 of pull request #90): the Tutor reads own classes;
// the route decides the class (classes/tutor-scope.test.ts).
const CLASS_VIEWERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
];
const CLASS_EDITORS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

// Task 3.3a (pull request #95): the areas `group_transfers` and `student_history`.
const GROUP_MOVERS: readonly Role[] = [
  'super_admin',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
];
// Task 3.3c (pull request #97): the area `branch_moves` (decision 8 as changed by correction 3).
const BRANCH_MOVERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];
const BRANCH_MOVE_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
];
const HISTORY_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
];

/** The nine roles of the area `timetable_views` (task 5.9a, decision 2). */
const VIEW_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
];

/** The roles of `journal` `edit` (task 6.3, decision 1 with review correction 1). */
const JOURNAL_WRITERS: readonly Role[] = [
  'super_admin',
  'academic_vice_principal',
  'tutor',
  'teacher',
];

/** The readers of `absence_reasons` (task 6.3, decision 6). */
const ABSENCE_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
];

/** The writers of `absence_reasons` (task 6.3, decision 6). */
const ABSENCE_WRITERS: readonly Role[] = ['super_admin', 'academic_vice_principal', 'tutor'];

/** The readers of `plans` (task 7.1a, decision 2). */
const PLAN_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
];

/** The writers of `plans` (task 7.1a, decision 2): the owner in the route; the Super Admin owns none. */
const PLAN_WRITERS: readonly Role[] = ['super_admin', 'teacher'];

/** Task 8.8, decision 1: who reads the plan reports (own subjects for the Head Teachers, in the route). */
const PLAN_REPORT_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
];

/** Task 9.3a, decision 1: who reads and exports the rating (which lists, in the route). */
const RATING_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
];

/** Task 9.4a, decision 1: the readers of the early-warning list (`08`, Who sees it). */
const EARLY_WARNING_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'spiritual_vice_principal',
  'head_tutor',
  'tutor',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
];

/** Task 7.3, decision 2: who keeps master plans (the keeper of the subject in the route). */
const PLAN_MASTER_KEEPERS: readonly Role[] = [
  'super_admin',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
];

/** Task 7.2, decision 1: who opens, moves and extends a plan window. */
const PLAN_WINDOW_WRITERS: readonly Role[] = ['super_admin', 'academic_vice_principal'];

/** Task 7.2, decision 1: who sends a plan request (the owner in the route). */
const PLAN_REQUEST_SENDERS: readonly Role[] = ['super_admin', 'teacher'];

/** Task 7.2, decision 1: who decides one (the routing in the route, access/request-routing.ts). */
const PLAN_REQUEST_DECIDERS: readonly Role[] = [
  'super_admin',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
];

/** Task 8.4, decision 5: who reads unlock requests (the view in the route). */
const UNLOCK_READERS: readonly Role[] = [
  'super_admin',
  'principal',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
  'tutor',
];

/** Task 8.4, decision 5: who sends one (the person's own lesson or rating exam, in the route). */
const UNLOCK_SENDERS: readonly Role[] = [
  'super_admin',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
  'teacher',
  'tutor',
];

/** Task 8.4, decision 5: who decides one (the routing in the route, access/request-routing.ts). */
const UNLOCK_DECIDERS: readonly Role[] = [
  'super_admin',
  'academic_vice_principal',
  'senior_head_teacher',
  'head_teacher',
];

const ROUTE_ACCESS: Record<string, ExpectedAccess> = {
  'GET /api/health': 'public',
  'POST /api/auth/sign-in': 'public',
  // The password reset by email (task 2.3c-2, decision 1 of pull request #66).
  'POST /api/auth/password-reset': 'public',
  'POST /api/auth/password-reset/confirm': 'public',
  // The own sign-in, and a feedback report about the app: open to every
  // signed-in account, the Principal included (docs/decisions.md, tasks 0.7b and
  // 0.8b-3). Each acts on the account of the session only.
  'GET /api/auth/session': 'any_signed_in',
  'GET /api/auth/sessions': 'any_signed_in',
  'POST /api/auth/password': 'any_signed_in',
  'POST /api/auth/sign-out': 'any_signed_in',
  'POST /api/auth/sign-out-everywhere': 'any_signed_in',
  'PUT /api/auth/language': 'any_signed_in',
  // The own photo (task 2.3c-2, decision 18 of pull request #66): the Principal too.
  'PUT /api/auth/photo': 'any_signed_in',
  'DELETE /api/auth/photo': 'any_signed_in',
  'GET /api/auth/photo': 'any_signed_in',
  // The own sign-in history (task 2.6a, decision 10 of pull request #75).
  'GET /api/auth/sign-in-history': 'any_signed_in',
  'POST /api/auth/second-step': 'any_signed_in',
  'GET /api/auth/second-step': 'any_signed_in',
  'POST /api/auth/second-step/set-up': 'any_signed_in',
  'POST /api/auth/second-step/confirm': 'any_signed_in',
  'POST /api/auth/second-step/turn-off': 'any_signed_in',
  'GET /api/auth/trusted-devices': 'any_signed_in',
  'DELETE /api/auth/trusted-devices/:id': 'any_signed_in',
  'POST /api/feedback': 'any_signed_in',
  // The own notifications (task 0.9). The owner's spec change adds reading and
  // marking them to the Principal's own-account changes (answer 10 of the plan).
  'GET /api/notifications': 'any_signed_in',
  'POST /api/notifications/:id/read': 'any_signed_in',
  'POST /api/notifications/read-all': 'any_signed_in',
  // School setup (task 1.1; docs/spec/02-roles-and-access.md, Super Admin:
  // "Only this role creates branches, buildings, floors and rooms"; Principal:
  // "Changes nothing"; the Academic Vice Principal's view approved by the
  // owner, pull request #37, answer 5). Creating a branch names no branch.
  'POST /api/setup/branches': { branch: 'none', roles: ['super_admin'] },
  'GET /api/setup/branches': { branch: 'none', roles: ['super_admin'] },
  'GET /api/setup/branch': { branch: 'request', roles: SETUP_VIEWERS },
  'PUT /api/setup/branch': { branch: 'request', roles: ['super_admin'] },
  'GET /api/setup/buildings': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/setup/buildings/export': { branch: 'request', roles: EXPORTERS },
  'POST /api/setup/buildings': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/buildings/:id': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/buildings/:id/archive': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/buildings/:id/restore': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/buildings/:id/floors': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/floors/:id': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/floors/:id/archive': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/floors/:id/restore': { branch: 'request', roles: ['super_admin'] },
  'GET /api/setup/rooms': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/setup/rooms/export': { branch: 'request', roles: EXPORTERS },
  'POST /api/setup/rooms': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/rooms/:id': { branch: 'request', roles: ['super_admin'] },
  // Divisions and departments (task 1.2; `02`, Super Admin: "Only this role
  // creates ... divisions"; the view of the three roles approved by the owner,
  // pull request #40, answer 5). A division has no branch: every change is
  // school-wide work; the list is read through the branch of the request.
  'GET /api/setup/divisions': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/setup/divisions/export': { branch: 'request', roles: EXPORTERS },
  'POST /api/setup/divisions': { branch: 'none', roles: ['super_admin'] },
  'PUT /api/setup/divisions/:id': { branch: 'none', roles: ['super_admin'] },
  'POST /api/setup/divisions/:id/archive': { branch: 'none', roles: ['super_admin'] },
  'POST /api/setup/divisions/:id/restore': { branch: 'none', roles: ['super_admin'] },
  'POST /api/setup/divisions/:id/departments': { branch: 'none', roles: ['super_admin'] },
  'PUT /api/setup/departments/:id': { branch: 'none', roles: ['super_admin'] },
  'POST /api/setup/departments/:id/archive': { branch: 'none', roles: ['super_admin'] },
  'POST /api/setup/departments/:id/restore': { branch: 'none', roles: ['super_admin'] },
  // Academic years and quarters (task 1.3; the owner's answer 3, docs/decisions.md,
  // "Decided ahead for tasks 1.3 to 1.6"): the Super Admin creates and edits
  // years and runs "Start year"; the Super Admin and the Academic Vice
  // Principal date the quarters; the go-live date is an edit of the branch,
  // the Super Admin's alone (answer 7). The top bar's year and quarter for
  // every role (decision 8 of pull request #44).
  'GET /api/setup/academic-years': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/setup/academic-years': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/academic-years/:id': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/academic-years/:id/start': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/setup/academic-years/:id/quarters': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.6b-5a: the preview of the quarters' save, the same permission.
  'POST /api/setup/academic-years/:id/quarters/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'PUT /api/setup/branch/go-live': { branch: 'request', roles: ['super_admin'] },
  'GET /api/setup/current-period': { branch: 'request', roles: ROLES },
  // Slot types, day templates and where they apply (task 1.5; the owner's
  // answer 14): the Super Admin and the Academic Vice Principal view, create,
  // edit and archive; the Principal views. The preview has the permission of
  // the save it shows (decision 13 of pull request #46).
  'GET /api/setup/slot-types': { branch: 'request', roles: TEMPLATE_VIEWERS },
  'POST /api/setup/slot-types': { branch: 'request', roles: TEMPLATE_WRITERS },
  'PATCH /api/setup/slot-types/:id': { branch: 'request', roles: TEMPLATE_WRITERS },
  'POST /api/setup/slot-types/:id/lengths': { branch: 'request', roles: TEMPLATE_WRITERS },
  'POST /api/setup/slot-types/:id/archive': { branch: 'request', roles: TEMPLATE_WRITERS },
  'POST /api/setup/slot-types/:id/restore': { branch: 'request', roles: TEMPLATE_WRITERS },
  'GET /api/setup/day-templates': { branch: 'request', roles: TEMPLATE_VIEWERS },
  'GET /api/setup/day-templates/:id': { branch: 'request', roles: TEMPLATE_VIEWERS },
  'POST /api/setup/day-templates': { branch: 'request', roles: TEMPLATE_WRITERS },
  'PATCH /api/setup/day-templates/:id': { branch: 'request', roles: TEMPLATE_WRITERS },
  'POST /api/setup/day-templates/:id/versions': { branch: 'request', roles: TEMPLATE_WRITERS },
  'POST /api/setup/day-templates/:id/archive': { branch: 'request', roles: TEMPLATE_WRITERS },
  'POST /api/setup/day-templates/:id/restore': { branch: 'request', roles: TEMPLATE_WRITERS },
  'GET /api/setup/day-template-assignments': { branch: 'request', roles: TEMPLATE_VIEWERS },
  'POST /api/setup/day-template-assignments': { branch: 'request', roles: TEMPLATE_WRITERS },
  'POST /api/setup/day-template-assignments/:id/end': {
    branch: 'request',
    roles: TEMPLATE_WRITERS,
  },
  'GET /api/setup/day-template-table': { branch: 'request', roles: TEMPLATE_VIEWERS },
  'POST /api/setup/day-template-table/preview': { branch: 'request', roles: TEMPLATE_WRITERS },
  'GET /api/setup/calendar-entries': { branch: 'request', roles: CALENDAR_VIEWERS },
  'POST /api/setup/calendar-entries': { branch: 'request', roles: CALENDAR_WRITERS },
  'POST /api/setup/calendar-entries/preview': { branch: 'request', roles: CALENDAR_WRITERS },
  'PATCH /api/setup/calendar-entries/:id': { branch: 'request', roles: CALENDAR_WRITERS },
  'POST /api/setup/calendar-entries/:id/archive': { branch: 'request', roles: CALENDAR_WRITERS },
  'POST /api/setup/calendar-entries/:id/restore': { branch: 'request', roles: CALENDAR_WRITERS },
  'GET /api/setup/calendar-day': { branch: 'request', roles: CALENDAR_VIEWERS },
  'GET /api/setup/settings': { branch: 'request', roles: SETTINGS_VIEWERS },
  'PUT /api/setup/settings/edit-days': { branch: 'request', roles: SETTINGS_WRITERS },
  'PUT /api/setup/settings/early-warning': { branch: 'request', roles: SETTINGS_WRITERS },
  'PUT /api/setup/settings/class-daily-lessons': { branch: 'request', roles: SETTINGS_WRITERS },
  'GET /api/setup/attendance-values': { branch: 'request', roles: SETTINGS_VIEWERS },
  'PUT /api/setup/quarters/:id/attendance-values': { branch: 'request', roles: SETTINGS_WRITERS },
  // Task 9.1: the preview of a change of late and skipped values, as its write.
  'POST /api/setup/quarters/:id/attendance-values/preview': {
    branch: 'request',
    roles: SETTINGS_WRITERS,
  },
  'GET /api/setup/checklist': { branch: 'request', roles: SETTINGS_VIEWERS },
  'GET /api/setup/travel-times': { branch: 'request', roles: SETUP_VIEWERS },
  'PUT /api/setup/travel-times': { branch: 'request', roles: ['super_admin'] },
  'GET /api/setup/subjects': { branch: 'request', roles: SUBJECT_VIEWERS },
  'POST /api/setup/subjects/export': { branch: 'request', roles: EXPORTERS },
  'POST /api/setup/subjects': { branch: 'request', roles: SUBJECT_WRITERS },
  'PUT /api/setup/subjects/:id': { branch: 'request', roles: SUBJECT_WRITERS },
  'PUT /api/setup/subjects/:id/daily-weights': { branch: 'request', roles: SUBJECT_WRITERS },
  'POST /api/setup/subjects/:id/archive': { branch: 'request', roles: SUBJECT_WRITERS },
  'POST /api/setup/subjects/:id/restore': { branch: 'request', roles: SUBJECT_WRITERS },
  'GET /api/setup/subjects/:id/quarter-weights': { branch: 'request', roles: SUBJECT_VIEWERS },
  'PUT /api/setup/subjects/:id/quarter-weights/:quarterId': {
    branch: 'request',
    roles: SUBJECT_WRITERS,
  },
  'POST /api/setup/subjects/:id/quarter-weights/copy': {
    branch: 'request',
    roles: SUBJECT_WRITERS,
  },
  // Task 9.1: the previews of a weights change and of the copy, as their writes.
  'POST /api/setup/subjects/:id/quarter-weights/:quarterId/preview': {
    branch: 'request',
    roles: SUBJECT_WRITERS,
  },
  'POST /api/setup/subjects/:id/quarter-weights/copy/preview': {
    branch: 'request',
    roles: SUBJECT_WRITERS,
  },
  'GET /api/people/staff': { branch: 'request', roles: STAFF_VIEWERS },
  'POST /api/people/staff/export': { branch: 'request', roles: EXPORTERS },
  'GET /api/people/staff/:id': { branch: 'request', roles: STAFF_VIEWERS },
  'POST /api/people/staff/check': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/staff': { branch: 'request', roles: ['super_admin'] },
  'PUT /api/people/staff/:id': { branch: 'request', roles: STAFF_EDITORS },
  'PUT /api/people/staff/:id/teaching': { branch: 'request', roles: STAFF_EDITORS },
  'PUT /api/people/staff/:id/branches': { branch: 'request', roles: STAFF_EDITORS },
  'POST /api/people/staff/:id/status': { branch: 'request', roles: STAFF_EDITORS },
  'POST /api/people/staff/:id/identity': { branch: 'request', roles: STAFF_VIEWERS },
  // Task 2.4a, decision 2 of pull request #67: student records. The guard
  // lets every viewer reach the record and the show; the route refuses a
  // Tutor-only reader of the record and every reader but the Principal of the
  // show (students.test.ts).
  'GET /api/people/students': { branch: 'request', roles: STUDENT_VIEWERS },
  'POST /api/people/students/check': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/students': { branch: 'request', roles: STUDENT_EDITORS },
  'GET /api/people/students/:id': { branch: 'request', roles: STUDENT_VIEWERS },
  'PUT /api/people/students/:id': { branch: 'request', roles: STUDENT_EDITORS },
  'PUT /api/people/students/:id/uid': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/students/:id/identity': { branch: 'request', roles: STUDENT_VIEWERS },
  // Task 8.6 (correction 4 of the plan review): the readers of the record; the subjects by journal scope in the route.
  'GET /api/people/students/:id/leaving-results': { branch: 'request', roles: STUDENT_VIEWERS },
  // Task 9.1: the Results and Attendance tabs and the lessons behind a figure, as the record.
  'GET /api/results/students/:id': { branch: 'request', roles: STUDENT_VIEWERS },
  'GET /api/results/students/:id/tabs': { branch: 'request', roles: STUDENT_VIEWERS },
  'GET /api/results/students/:id/attendance': { branch: 'request', roles: STUDENT_VIEWERS },
  'GET /api/results/students/:id/lessons': { branch: 'request', roles: STUDENT_VIEWERS },
  // Task 9.2a (decision 2, Look first): the closing checklist, `quarter_closing`.
  'GET /api/results/closing': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'PUT /api/results/closing/:quarterId/decisions': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/results/closing/:quarterId/journals/:journalId/decisions': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/results/closing/:quarterId/plan-periods/end': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/results/closing/:quarterId/remind': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 9.2b: the close of a quarter, `quarter_closing` `edit`.
  'POST /api/results/closing/:quarterId/close': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 9.2c: the reopening, a journal closed again, "recalculate and compare" (`quarter_closing`),
  // and its apply (`results_recalculation` `edit`, decision 10, Look first).
  'POST /api/results/closing/:quarterId/reopen': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/results/closing/:quarterId/journals/:journalId/close': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'GET /api/results/closing/:quarterId/recalculation': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/results/closing/:quarterId/recalculation/apply': {
    branch: 'request',
    roles: ['super_admin'],
  },
  // Task 9.3a: the rating lists and their export.
  'GET /api/results/rating/choices': { branch: 'request', roles: RATING_READERS },
  'GET /api/results/rating/subject': { branch: 'request', roles: RATING_READERS },
  'GET /api/results/rating/class': { branch: 'request', roles: RATING_READERS },
  'GET /api/results/rating/classes': { branch: 'request', roles: RATING_READERS },
  'POST /api/results/rating/export': { branch: 'request', roles: RATING_READERS },
  // Task 9.4a, decision 1: the list; marking handled for the Tutor, the Teacher and the Super Admin.
  'GET /api/results/early-warning': { branch: 'request', roles: EARLY_WARNING_READERS },
  'POST /api/results/early-warning/handled': {
    branch: 'request',
    roles: ['super_admin', 'tutor', 'teacher'],
  },
  // Task 2.4b-1, decision 2: `students` `archive`, and `student_graduates` for the Super Admin.
  'POST /api/people/students/:id/leaving': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/students/:id/leaving/cancel': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/students/:id/leaving/undo': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/students/:id/return': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/students/:id/return/cancel': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/students/:id/restore': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/students/:id/delete': { branch: 'request', roles: STUDENT_EDITORS },
  // Task 2.4b-2: the export (decision 1), the photos and the "No class" counter.
  // Task 3.1c (decision 3 of pull request #90): the Tutor, own classes only
  // (classes/tutor-scope.test.ts). Task 3.6a (L59): the Head Tutor, the Head
  // Teacher and the Senior Head Teacher (student-exports.test.ts).
  'POST /api/people/students/export': {
    branch: 'request',
    roles: [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'head_tutor',
      'tutor',
      'senior_head_teacher',
      'head_teacher',
    ],
  },
  'GET /api/people/students/no-class': { branch: 'request', roles: STUDENT_VIEWERS },
  'PUT /api/people/students/:id/photo': { branch: 'request', roles: STUDENT_EDITORS },
  'DELETE /api/people/students/:id/photo': { branch: 'request', roles: STUDENT_EDITORS },
  'GET /api/people/students/:id/photo': { branch: 'request', roles: STUDENT_VIEWERS },
  // Task 2.5a, decision 4 of pull request #72: the area `relatives`; the links of a
  // student under `students` `edit`, the Relatives tab under `student_contact` `view`.
  // The route refuses the phone search and the show to the readers that may not (relatives.test.ts).
  'GET /api/people/relatives': { branch: 'request', roles: SETUP_VIEWERS },
  'GET /api/people/relatives/:id': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/people/relatives/phone-match': { branch: 'request', roles: STUDENT_EDITORS },
  'PATCH /api/people/relatives/:id': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/people/relatives/:id/show': { branch: 'request', roles: SETUP_VIEWERS },
  // Task 2.6a, decision 2 of pull request #75: the area `audit_log`. Which
  // entries each reads is decided in the route (audit-entries.test.ts).
  'GET /api/audit/entries': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/audit/entries/:id/show': { branch: 'request', roles: SETUP_VIEWERS },
  // The personal data report (task 2.6b, decision 3 of pull request #76): the
  // Super Admin alone, for a person of the branch of the request.
  'POST /api/people/students/:id/report': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/staff/:id/report': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/relatives/:id/report': { branch: 'request', roles: ['super_admin'] },
  // Task 2.5b-1 (pull request #73): the count of "no valid phone" for the home
  // tile under `relatives` `view`; the merge under `relatives` `edit`, refused
  // across branches to all but the Super Admin by the route (relative-owners.test.ts).
  'GET /api/people/relatives/no-valid-phone': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/people/relatives/:id/merge': { branch: 'request', roles: STUDENT_EDITORS },
  // Task 3.1c (decision 2 of pull request #90): the class Tutor, own classes
  // only (classes/tutor-scope.test.ts).
  'GET /api/people/students/:id/relatives': {
    branch: 'request',
    roles: [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
      'tutor',
    ],
  },
  'POST /api/people/students/:id/relatives': { branch: 'request', roles: STUDENT_EDITORS },
  'PATCH /api/people/students/:id/relatives/:relativeId': {
    branch: 'request',
    roles: STUDENT_EDITORS,
  },
  'POST /api/people/students/:id/relatives/:relativeId/unlink': {
    branch: 'request',
    roles: STUDENT_EDITORS,
  },
  // Task 2.3a, decision 4 of pull request #62: the account section.
  'GET /api/people/staff/:id/account': { branch: 'request', roles: ['super_admin', 'principal'] },
  'GET /api/people/staff/:id/account/suggestion': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/staff/:id/account': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/staff/:id/account/own': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/staff/:id/roles': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/staff/:id/roles/:assignmentId/end': {
    branch: 'request',
    roles: ['super_admin'],
  },
  'GET /api/access/super-admins': { branch: 'none', roles: ['super_admin'] },
  // Task 2.3c-1, decision 2 of pull request #65: the sign-in access of an
  // account. The server further keeps the Academic Vice Principal to the four
  // roles of the branch and the second-step reset to the Super Admin
  // (tested in account-access.test.ts).
  'GET /api/people/staff/:id/account/access': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/people/staff/:id/account/lock': { branch: 'request', roles: ACCESS_EDITORS },
  'POST /api/people/staff/:id/account/unlock': { branch: 'request', roles: ACCESS_EDITORS },
  'POST /api/people/staff/:id/account/password-reset': {
    branch: 'request',
    roles: ACCESS_EDITORS,
  },
  'POST /api/people/staff/:id/account/second-step-reset': {
    branch: 'request',
    roles: ACCESS_EDITORS,
  },
  'GET /api/people/accounts/never-used': { branch: 'request', roles: SETUP_VIEWERS },
  // Task 6.1c: the report of entries after a reset, for the readers of "Accounts never used".
  'GET /api/people/accounts/reset-entries': { branch: 'request', roles: SETUP_VIEWERS },
  // Task 2.3b-2: the alert of a branch with no active Academic Vice Principal.
  'GET /api/access/branches-without-vice-principal': { branch: 'none', roles: ['super_admin'] },
  // Task 2.3b-1: the subjects of an appointment under `accounts` `edit`; the
  // list of appointments its own area `head_teachers` (decision 8 of #63).
  'POST /api/people/staff/:id/roles/:assignmentId/subjects': {
    branch: 'request',
    roles: ['super_admin'],
  },
  'GET /api/access/head-teachers': {
    branch: 'request',
    roles: [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'senior_head_teacher',
      'head_teacher',
    ],
  },
  // Task 2.2c-2: photos under `staff` (decision 2 of pull request #59).
  'PUT /api/people/staff/:id/photo': { branch: 'request', roles: STAFF_EDITORS },
  'DELETE /api/people/staff/:id/photo': { branch: 'request', roles: STAFF_EDITORS },
  'GET /api/people/staff/:id/photo': { branch: 'request', roles: STAFF_VIEWERS },
  // Task 2.2b: availability under `staff_teaching`, vacancies their own area (decision 1).
  'GET /api/people/staff/:id/availability': { branch: 'request', roles: STAFF_VIEWERS },
  'PUT /api/people/staff/:id/availability': { branch: 'request', roles: STAFF_EDITORS },
  'GET /api/people/vacancies': { branch: 'request', roles: STAFF_VIEWERS },
  'POST /api/people/vacancies/export': { branch: 'request', roles: EXPORTERS },
  'GET /api/people/vacancies/:id': { branch: 'request', roles: STAFF_VIEWERS },
  'POST /api/people/vacancies': { branch: 'request', roles: STAFF_EDITORS },
  'PUT /api/people/vacancies/:id': { branch: 'request', roles: STAFF_EDITORS },
  'POST /api/people/vacancies/:id/close': { branch: 'request', roles: STAFF_EDITORS },
  'POST /api/people/vacancies/:id/reopen': { branch: 'request', roles: STAFF_EDITORS },
  'POST /api/people/vacancies/:id/delete': { branch: 'request', roles: STAFF_EDITORS },
  // Task 3.1a: classes and their Tutors; the Principal exports (decision 5).
  'GET /api/classes': { branch: 'request', roles: CLASS_VIEWERS },
  'GET /api/classes/tutor-candidates': { branch: 'request', roles: CLASS_EDITORS },
  'GET /api/classes/seats': { branch: 'request', roles: STUDENT_EDITORS },
  'POST /api/classes/export': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/classes': { branch: 'request', roles: CLASS_EDITORS },
  'GET /api/classes/:id': { branch: 'request', roles: CLASS_VIEWERS },
  'PUT /api/classes/:id': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/:id/archive': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/:id/restore': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/:id/tutors': { branch: 'request', roles: CLASS_EDITORS },
  // Task 3.6c-2, decision 10: the give's preview, under the give's permission.
  'POST /api/classes/:id/tutors/preview': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/:id/tutors/:tutorId/end': { branch: 'request', roles: CLASS_EDITORS },
  // Task 3.1b, decision 9: the Students tab for the readers, placement and withdraw for the editors.
  'GET /api/classes/:id/members': { branch: 'request', roles: CLASS_VIEWERS },
  'POST /api/classes/:id/members': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/:id/members/:memberId/withdraw': { branch: 'request', roles: CLASS_EDITORS },
  // Task 3.2a, decision 2 of pull request #91: the readers of classes read groups, each in
  // the scope the route decides; the editors of classes change them.
  // Task 3.2d (pull request #94, decision 3): Ctrl+K over records, each kind under the area
  // of its record route; the scope is decided in the route (people/search.test.ts,
  // classes/search.test.ts).
  'GET /api/search/students': { branch: 'request', roles: STUDENT_VIEWERS },
  'GET /api/search/relatives': { branch: 'request', roles: SETUP_VIEWERS },
  'GET /api/search/staff': { branch: 'request', roles: STAFF_VIEWERS },
  'GET /api/search/classes': { branch: 'request', roles: CLASS_VIEWERS },
  'GET /api/search/groups': { branch: 'request', roles: CLASS_VIEWERS },
  'GET /api/groups': { branch: 'request', roles: CLASS_VIEWERS },
  'GET /api/groups/slot-check': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/groups/export': { branch: 'request', roles: SETUP_VIEWERS },
  'POST /api/groups': { branch: 'request', roles: CLASS_EDITORS },
  'GET /api/groups/:id': { branch: 'request', roles: CLASS_VIEWERS },
  'PUT /api/groups/:id': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/groups/:id/archive': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/groups/:id/restore': { branch: 'request', roles: CLASS_EDITORS },
  // Task 3.2b (pull request #92, decision 6): members read under `view`, placed under `edit`.
  'GET /api/groups/:id/members': { branch: 'request', roles: CLASS_VIEWERS },
  'POST /api/groups/:id/members': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/groups/:id/members/:memberId/withdraw': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/groups/:id/members/:memberId/reviewed': { branch: 'request', roles: CLASS_EDITORS },
  'GET /api/groups/placement': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/groups/placement/automatic': { branch: 'request', roles: CLASS_EDITORS },
  // Task 3.3a (pull request #95): class transfers under `classes` `edit` (decision 3);
  // group transfers under the new area `group_transfers` (decision 2, Look first), the
  // Head Teachers' scope decided in the route (people/group-transfers.test.ts); the
  // History tab under the new area `student_history` (decision 9, Look first).
  'POST /api/classes/transfers': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/transfers/:id/change': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/transfers/:id/cancel': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/classes/transfers/:id/undo': { branch: 'request', roles: CLASS_EDITORS },
  'POST /api/groups/transfers': { branch: 'request', roles: GROUP_MOVERS },
  'POST /api/groups/transfers/:id/change': { branch: 'request', roles: GROUP_MOVERS },
  'POST /api/groups/transfers/:id/cancel': { branch: 'request', roles: GROUP_MOVERS },
  'POST /api/groups/transfers/:id/undo': { branch: 'request', roles: GROUP_MOVERS },
  'GET /api/people/students/:id/history': { branch: 'request', roles: HISTORY_READERS },
  // Task 3.3c (pull request #97): the move to another branch under the new area
  // `branch_moves`; the side of each route (sending or receiving branch) is
  // checked in the route (people/branch-moves.test.ts).
  'POST /api/people/students/:id/branch-move': { branch: 'request', roles: BRANCH_MOVERS },
  'POST /api/people/branch-moves/:id/cancel': { branch: 'request', roles: BRANCH_MOVERS },
  'GET /api/people/branch-moves/targets': { branch: 'request', roles: BRANCH_MOVERS },
  'GET /api/people/branch-moves/incoming': { branch: 'request', roles: BRANCH_MOVE_READERS },
  'GET /api/people/branch-moves/:id/groups': { branch: 'request', roles: BRANCH_MOVE_READERS },
  'POST /api/people/branch-moves/:id/accept': { branch: 'request', roles: BRANCH_MOVERS },
  'POST /api/people/branch-moves/:id/decline': { branch: 'request', roles: BRANCH_MOVERS },
  // Task 3.3d (pull request #98, decision 10): the merge of two student
  // records under the new area `student_merges`, the Super Admin alone.
  'GET /api/people/students/:id/merge': { branch: 'request', roles: ['super_admin'] },
  'POST /api/people/students/:id/merge': { branch: 'request', roles: ['super_admin'] },
  // Task 3.4a, decision 4 of pull request #99: draft versions and their
  // teaching load under the new area `timetable`.
  'GET /api/timetable/versions': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'PATCH /api/timetable/versions/:id': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.8a: the version history of a year and two versions compared, reads of `timetable`.
  'GET /api/timetable/history': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/versions/:id/compare': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  // Task 5.9c-2: Print, PDF and Excel of a version's pattern, for the roles that view the versions.
  'POST /api/timetable/versions/:id/export': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/versions/:id/load': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/versions/:id/totals': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/versions/:id/readiness': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/templates/confirm': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.3b-1: step 5 of the builder.
  'PUT /api/timetable/versions/:id/preferences': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/rules/confirm': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.3b-2: pinned lessons of step 5, under timetable edit (decision 6).
  'POST /api/timetable/versions/:id/pins': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'DELETE /api/timetable/versions/:id/pins/:pinId': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.4a: the grid of step 7, read under timetable view, written under edit.
  'GET /api/timetable/versions/:id/grid': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/pattern': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/pattern/swap': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.4b-2b: a suggestion of "Suggest a place" applied.
  'POST /api/timetable/versions/:id/pattern/rearrange': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.5a-1: publish (timetable edit) and its check, read by every reader of the timetable.
  'GET /api/timetable/versions/:id/publish-check': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/publish': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.5c-2a: withdraw, under the publish's own permission.
  'POST /api/timetable/versions/:id/withdraw': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.6a-5b-2 (decision 7): the withdraw's check, a view as the publish check.
  'GET /api/timetable/versions/:id/withdraw-check': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  // Task 5.6a-1 (decision 2): one-day changes under `timetable`, no role widened.
  'GET /api/timetable/day': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/lessons/:id/cancel': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/lessons/:id/restore': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.6a-2: the one-day room change and move, under timetable edit.
  'POST /api/timetable/lessons/:id/room': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/lessons/:id/move': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.6a-4: the correction of a past lesson and its people, under timetable edit.
  'POST /api/timetable/lessons/:id/correction': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'GET /api/timetable/lessons/:id/correction-teachers': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.8b: the forced delete of a lesson and the store, the Super Admin's
  // (forced_deletes); the history of a lesson under timetable view.
  'POST /api/timetable/lessons/:id/forced-delete': { branch: 'request', roles: ['super_admin'] },
  'GET /api/forced-deletes': { branch: 'request', roles: ['super_admin'] },
  'POST /api/forced-deletes/:id/restore': { branch: 'request', roles: ['super_admin'] },
  // Task 5.8c: the forced delete of a building, floor or room (forced_deletes).
  'POST /api/setup/buildings/:id/forced-delete': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/floors/:id/forced-delete': { branch: 'request', roles: ['super_admin'] },
  'POST /api/setup/rooms/:id/forced-delete': { branch: 'request', roles: ['super_admin'] },
  'GET /api/timetable/lessons/:id/history': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  // Task 5.9a: the read-only timetable views (timetable_views); the scope of
  // each role is the route's own, tested in views.test.ts.
  'GET /api/timetable/views/choices': { branch: 'request', roles: VIEW_READERS },
  'GET /api/timetable/views/branch': { branch: 'request', roles: VIEW_READERS },
  'GET /api/timetable/views/class': { branch: 'request', roles: VIEW_READERS },
  'GET /api/timetable/views/teacher': { branch: 'request', roles: VIEW_READERS },
  'GET /api/timetable/views/room': { branch: 'request', roles: VIEW_READERS },
  // Task 5.9c-1: Print, PDF and Excel of the same views, in the same scope (views-export.test.ts).
  'POST /api/timetable/views/export': { branch: 'request', roles: VIEW_READERS },
  // Task 6.2: the Journals page and the journal grid, scope in the route (journals.test.ts).
  'GET /api/journal/journals': { branch: 'request', roles: VIEW_READERS },
  'GET /api/journal/journals/:journalId': { branch: 'request', roles: VIEW_READERS },
  // Task 6.3: attendance entry (scope in the route, attendance.test.ts), the history of a
  // cell (within the reader's grid) and the reasons of absence (student-absences.test.ts).
  'POST /api/journal/lessons/:lessonId/attendance': { branch: 'request', roles: JOURNAL_WRITERS },
  'POST /api/journal/lessons/:lessonId/all-present': { branch: 'request', roles: JOURNAL_WRITERS },
  // Task 8.3a: undo and "copy attendance" (scope in the route, journal-saves.test.ts).
  'POST /api/journal/lessons/:lessonId/undo': { branch: 'request', roles: JOURNAL_WRITERS },
  'POST /api/journal/lessons/:lessonId/copy-attendance': {
    branch: 'request',
    roles: JOURNAL_WRITERS,
  },
  // Task 8.1: classwork and homework (scope in the route, journal-works.test.ts).
  'POST /api/journal/lessons/:lessonId/works': { branch: 'request', roles: JOURNAL_WRITERS },
  'DELETE /api/journal/lessons/:lessonId/works/:workId': {
    branch: 'request',
    roles: JOURNAL_WRITERS,
  },
  'PUT /api/journal/lessons/:lessonId/works/total': { branch: 'request', roles: JOURNAL_WRITERS },
  'PUT /api/journal/lessons/:lessonId/works/not-held': {
    branch: 'request',
    roles: JOURNAL_WRITERS,
  },
  'POST /api/journal/lessons/:lessonId/works/carry': { branch: 'request', roles: JOURNAL_WRITERS },
  'POST /api/journal/lessons/:lessonId/scores': { branch: 'request', roles: JOURNAL_WRITERS },
  // Task 8.2: the rating exam and comments.
  'PUT /api/journal/journals/:journalId/rating/:quarterId/date': {
    branch: 'request',
    roles: JOURNAL_WRITERS,
  },
  'PUT /api/journal/journals/:journalId/rating/:quarterId/not-held': {
    branch: 'request',
    roles: JOURNAL_WRITERS,
  },
  'POST /api/journal/journals/:journalId/rating/:quarterId/entries': {
    branch: 'request',
    roles: JOURNAL_WRITERS,
  },
  'GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history': {
    branch: 'request',
    roles: VIEW_READERS,
  },
  'PUT /api/journal/comments': { branch: 'request', roles: JOURNAL_WRITERS },
  // Task 8.4: unlock requests and the branch-wide extension of the edit period.
  'GET /api/journal/unlocks': { branch: 'request', roles: UNLOCK_READERS },
  'POST /api/journal/lessons/:lessonId/unlocks': { branch: 'request', roles: UNLOCK_SENDERS },
  'POST /api/journal/journals/:journalId/rating/:quarterId/unlocks': {
    branch: 'request',
    roles: UNLOCK_SENDERS,
  },
  'POST /api/journal/unlocks/:unlockId/decide': { branch: 'request', roles: UNLOCK_DECIDERS },
  'POST /api/journal/unlocks/:unlockId/withdraw': { branch: 'request', roles: UNLOCK_SENDERS },
  'GET /api/journal/extensions': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/journal/extensions': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 8.7: "not graded", the reminders, the counts per teacher and the orphan lessons.
  'POST /api/journal/lessons/:lessonId/not-graded': { branch: 'request', roles: JOURNAL_WRITERS },
  // Task 8.8: the lesson card (every reader of the journal) and its marks (the lesson's teacher).
  'GET /api/journal/lessons/:lessonId/card': { branch: 'request', roles: VIEW_READERS },
  'PUT /api/journal/lessons/:lessonId/delivery': { branch: 'request', roles: JOURNAL_WRITERS },
  'PUT /api/journal/lessons/:lessonId/homework-given': {
    branch: 'request',
    roles: JOURNAL_WRITERS,
  },
  'GET /api/journal/reminders': { branch: 'request', roles: VIEW_READERS },
  'GET /api/journal/discipline': {
    branch: 'request',
    roles: [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'senior_head_teacher',
      'head_teacher',
      'head_tutor',
    ],
  },
  'GET /api/journal/orphans': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/journal/orphans/:lessonId/assign': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/journal/orphans/assignments/:assignmentId/withdraw': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 8.9: the exports of journals (`journal` `export` for the nine readers, decision 1; the
  // scope in the route, journal-exports.test.ts) and the support view (decision 2).
  'POST /api/journal/journals/:journalId/export': { branch: 'request', roles: VIEW_READERS },
  'GET /api/journal/exports': { branch: 'request', roles: VIEW_READERS },
  'POST /api/journal/exports': { branch: 'request', roles: VIEW_READERS },
  'GET /api/journal/exports/:exportId/file': { branch: 'request', roles: VIEW_READERS },
  'GET /api/journal/support': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'GET /api/journal/comments/history': { branch: 'request', roles: VIEW_READERS },
  'GET /api/journal/lessons/:lessonId/students/:studentId/history': {
    branch: 'request',
    roles: VIEW_READERS,
  },
  // Task 8.5: the exemptions (decision 1): the Super Admin and the Academic Vice Principal write,
  // the Principal reads.
  'GET /api/exemptions': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/exemptions/absences-without': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/exemptions/move-offers': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/exemptions/move-offers/:id/reason': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/exemptions/move-offers/:id/confirm/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/move-offers/:id/confirm': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/move-offers/:id/drop': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions': { branch: 'request', roles: ['super_admin', 'academic_vice_principal'] },
  'POST /api/exemptions/batches/:batchId/end/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/batches/:batchId/end': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/batches/:batchId/void/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/batches/:batchId/void': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'GET /api/exemptions/:id': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/exemptions/:id/reason': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/exemptions/:id/document': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'PUT /api/exemptions/:id/document': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'DELETE /api/exemptions/:id/document': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/:id/edit/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'PATCH /api/exemptions/:id': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/:id/end/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/:id/end': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/:id/void/preview': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/exemptions/:id/void': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 8.5: the teaching home's exemption cards, scope in the route.
  'GET /api/journal/exemptions-today': { branch: 'request', roles: VIEW_READERS },
  'GET /api/journal/student-absences': { branch: 'request', roles: ABSENCE_READERS },
  'PUT /api/journal/student-absences/:studentId/:date': {
    branch: 'request',
    roles: ABSENCE_WRITERS,
  },
  // Task 8.5: the file of a reason, scope in the route.
  'PUT /api/journal/student-absences/:studentId/:date/file': {
    branch: 'request',
    roles: ABSENCE_WRITERS,
  },
  'DELETE /api/journal/student-absences/:studentId/:date/file': {
    branch: 'request',
    roles: ABSENCE_WRITERS,
  },
  'GET /api/journal/student-absences/:studentId/:date/file': {
    branch: 'request',
    roles: ABSENCE_READERS,
  },
  // Task 7.1a: the plans, scope in the route; only the owner writes (plans.test.ts).
  'GET /api/plans': { branch: 'request', roles: PLAN_READERS },
  'GET /api/plans/journals/:journalId': { branch: 'request', roles: PLAN_READERS },
  // Task 7.1b: the item of one lesson (a reader of the plan or the lesson's substitute).
  'GET /api/plans/lessons/:lessonId': { branch: 'request', roles: PLAN_READERS },
  // Task 8.8: the export of a plan (decision 2), the reports (decision 1) and the minimums.
  'POST /api/plans/journals/:journalId/export': { branch: 'request', roles: PLAN_READERS },
  'GET /api/plans/reports/completeness': { branch: 'request', roles: PLAN_REPORT_READERS },
  'GET /api/plans/reports/progress': { branch: 'request', roles: PLAN_REPORT_READERS },
  'GET /api/plans/reports/requests': { branch: 'request', roles: PLAN_REPORT_READERS },
  'POST /api/plans/reports/export': { branch: 'request', roles: PLAN_REPORT_READERS },
  'GET /api/plans/minimums': { branch: 'request', roles: PLAN_READERS },
  'PUT /api/plans/minimums': { branch: 'request', roles: PLAN_WINDOW_WRITERS },
  'POST /api/plans/journals/:journalId/items': { branch: 'request', roles: PLAN_WRITERS },
  // Task 7.1c: share, separate and copy (the owner of every journal of the plan, plans.test.ts).
  'POST /api/plans/journals/:journalId/share': { branch: 'request', roles: PLAN_WRITERS },
  'POST /api/plans/journals/:journalId/separate': { branch: 'request', roles: PLAN_WRITERS },
  'POST /api/plans/journals/:journalId/copy': { branch: 'request', roles: PLAN_WRITERS },
  'PUT /api/plans/items/:itemId': { branch: 'request', roles: PLAN_WRITERS },
  'POST /api/plans/items/:itemId/clear': { branch: 'request', roles: PLAN_WRITERS },
  'PUT /api/plans/items/:itemId/files': { branch: 'request', roles: PLAN_WRITERS },
  'DELETE /api/plans/files/:fileId': { branch: 'request', roles: PLAN_WRITERS },
  'GET /api/plans/files/:fileId': { branch: 'request', roles: PLAN_READERS },
  // Task 7.2: the queue edit (the owner, plan-requests.test.ts), the window and the requests.
  'PUT /api/plans/journals/:journalId/queue': { branch: 'request', roles: PLAN_WRITERS },
  // Task 9.2d: the outcomes of not-covered items (the drop is the approver's) and the tray.
  'POST /api/plans/journals/:journalId/not-covered/:itemId/merge': {
    branch: 'request',
    roles: PLAN_WRITERS,
  },
  'POST /api/plans/journals/:journalId/not-covered/:itemId/carry': {
    branch: 'request',
    roles: PLAN_WRITERS,
  },
  'POST /api/plans/journals/:journalId/not-covered/:itemId/drop': {
    branch: 'request',
    roles: PLAN_REQUEST_DECIDERS,
  },
  'POST /api/plans/journals/:journalId/carried/:itemId/place': {
    branch: 'request',
    roles: PLAN_WRITERS,
  },
  'GET /api/plans/windows': { branch: 'request', roles: PLAN_READERS },
  'PUT /api/plans/windows/:quarterId': { branch: 'request', roles: PLAN_WINDOW_WRITERS },
  'POST /api/plans/windows/:quarterId/extensions': {
    branch: 'request',
    roles: PLAN_WINDOW_WRITERS,
  },
  'GET /api/plans/requests': { branch: 'request', roles: PLAN_READERS },
  'POST /api/plans/journals/:journalId/requests': {
    branch: 'request',
    roles: PLAN_REQUEST_SENDERS,
  },
  'POST /api/plans/journals/:journalId/requests/prepared': {
    branch: 'request',
    roles: PLAN_REQUEST_SENDERS,
  },
  'POST /api/plans/journals/:journalId/requests/prepared/decide': {
    branch: 'request',
    roles: PLAN_REQUEST_DECIDERS,
  },
  'POST /api/plans/requests/:requestId/send': { branch: 'request', roles: PLAN_REQUEST_SENDERS },
  'POST /api/plans/requests/:requestId/decide': {
    branch: 'request',
    roles: PLAN_REQUEST_DECIDERS,
  },
  'POST /api/plans/requests/decide-event': { branch: 'request', roles: PLAN_REQUEST_DECIDERS },
  'POST /api/plans/requests/:requestId/finish': {
    branch: 'request',
    roles: PLAN_REQUEST_SENDERS,
  },
  // Task 7.3: master plans, the comparison, take and keep of a plan's master, the parallel classes.
  'GET /api/plans/masters': { branch: 'request', roles: PLAN_READERS },
  'POST /api/plans/masters': { branch: 'request', roles: PLAN_MASTER_KEEPERS },
  'GET /api/plans/masters/:masterId': { branch: 'request', roles: PLAN_READERS },
  'PATCH /api/plans/masters/:masterId': { branch: 'request', roles: PLAN_MASTER_KEEPERS },
  'POST /api/plans/masters/:masterId/archive': { branch: 'request', roles: PLAN_MASTER_KEEPERS },
  'POST /api/plans/masters/:masterId/restore': { branch: 'request', roles: PLAN_MASTER_KEEPERS },
  'POST /api/plans/masters/:masterId/items': { branch: 'request', roles: PLAN_MASTER_KEEPERS },
  'PUT /api/plans/masters/:masterId/items/:itemId': {
    branch: 'request',
    roles: PLAN_MASTER_KEEPERS,
  },
  'POST /api/plans/masters/:masterId/items/:itemId/remove': {
    branch: 'request',
    roles: PLAN_MASTER_KEEPERS,
  },
  'PUT /api/plans/masters/:masterId/order': { branch: 'request', roles: PLAN_MASTER_KEEPERS },
  'GET /api/plans/journals/:journalId/master-compare': { branch: 'request', roles: PLAN_READERS },
  'POST /api/plans/journals/:journalId/master-take': { branch: 'request', roles: PLAN_WRITERS },
  'POST /api/plans/journals/:journalId/master-keep': { branch: 'request', roles: PLAN_WRITERS },
  'GET /api/plans/parallel': { branch: 'request', roles: PLAN_READERS },
  // Task 5.9b: the teaching home page, own lessons only (teaching-home.test.ts).
  'GET /api/timetable/home': { branch: 'request', roles: VIEW_READERS },
  // Task 5.7b-2: the substitution per journal from an absence or a vacancy, under timetable edit.
  'GET /api/timetable/absences/:id/journals/:journalId/substitutes': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/absences/:id/journal-substitute': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'GET /api/timetable/vacancies/:id/journals/:journalId/substitutes': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/vacancies/:id/journal-substitute': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.7b-1: the substitution of a lesson, its suggestions and its withdrawal, under timetable edit.
  'GET /api/timetable/lessons/:id/substitutes': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/lessons/:id/substitute': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/lessons/:id/substitution/withdraw': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.6a-3: the check and the save of a bulk cancel, under timetable edit.
  'POST /api/timetable/bulk-cancels/check': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/bulk-cancels': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.6c-1: exams, read by every reader of the timetable, created,
  // changed and cancelled under timetable edit.
  'GET /api/timetable/exams': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/exams/:id': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/exams': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'PUT /api/timetable/exams/:id': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/exams/:id/cancel': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.7a-3a (decision 9): the vacancy fill and its check, under timetable edit as the publish.
  'POST /api/timetable/vacancy-fills': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/vacancy-fills/check': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.7a-3c: the acting teacher of a vacancy's journal, under timetable edit as the fill.
  'POST /api/timetable/acting-teachers': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/acting-teachers/check': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/acting-teachers/:id/end': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.6c-2: the check of a save, under timetable edit as the save.
  'POST /api/timetable/exams/check': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.7a-1: absences and the home page's lists, read by every reader of
  // the timetable, entered under timetable create, changed and withdrawn
  // under timetable edit.
  'GET /api/timetable/absences': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/absences/:id/lessons': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/attention': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/absences': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'PATCH /api/timetable/absences/:id': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/absences/:id/withdraw': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.7a-2b: room closures, read by every reader of the timetable,
  // entered under timetable create, changed, withdrawn and moved under edit.
  'GET /api/timetable/room-closures': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'GET /api/timetable/room-closures/:id/lessons': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/room-closures': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'PATCH /api/timetable/room-closures/:id': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/room-closures/:id/withdraw': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/room-closures/:id/move': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.5a-3b-1: the causes of a draft's mark, read by every reader of the
  // timetable, and bringing it up to date, under timetable edit.
  'GET /api/timetable/versions/:id/out-of-date': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/up-to-date': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.5a-2b-2: the lessons kept on a shortened day, under timetable edit.
  'PUT /api/timetable/versions/:id/day-keeps': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.4c-1: the edit lock of a draft and the locks of the grid, under timetable edit.
  'POST /api/timetable/versions/:id/edit-lock': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/locks': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'DELETE /api/timetable/versions/:id/locks/:lockId': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/pattern/:blockId/move': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  // Task 5.4b-2a: the room of a lesson, from the room picker.
  'POST /api/timetable/versions/:id/pattern/:blockId/room': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'DELETE /api/timetable/versions/:id/pattern/:blockId': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'GET /api/timetable/versions/:id/load/teachers': {
    branch: 'request',
    roles: ['super_admin', 'principal', 'academic_vice_principal'],
  },
  'POST /api/timetable/versions/:id/load': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'PATCH /api/timetable/versions/:id/load/:rowId': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
  'DELETE /api/timetable/versions/:id/load/:rowId': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal'],
  },
};

/** The same for the sample routes: the roles `SAMPLE_PERMISSIONS` gives each action, written again by hand. */
const SAMPLE_ROUTE_ACCESS: Record<string, ExpectedAccess> = {
  ...ROUTE_ACCESS,
  'GET /api/permission-sample/open': 'public',
  'GET /api/permission-sample/own': 'any_signed_in',
  'GET /api/permission-sample/view': {
    branch: 'request',
    roles: [
      'super_admin',
      'principal',
      'academic_vice_principal',
      'spiritual_vice_principal',
      'head_tutor',
      'tutor',
      'senior_head_teacher',
      'head_teacher',
      'teacher',
    ],
  },
  'POST /api/permission-sample/edit': {
    branch: 'request',
    roles: ['super_admin', 'academic_vice_principal', 'senior_head_teacher', 'head_teacher'],
  },
  'GET /api/permission-sample/school': {
    branch: 'none',
    roles: ['super_admin', 'senior_head_teacher', 'head_teacher'],
  },
  'POST /api/permission-sample/school': { branch: 'none', roles: ['super_admin'] },
};

/**
 * The routes a session may reach while it still owes a step of sign-in, each
 * with those steps, written by hand. Only routes of the own sign-in belong
 * here: a route with a permission that carried such a mark would let a session
 * without its second step act with its roles (found by the review).
 */
const STEP_ROUTES: Record<string, string[]> = {
  'GET /api/auth/session': ['second_step', 'password_change', 'second_step_set_up'],
  'POST /api/auth/sign-out': ['second_step', 'password_change', 'second_step_set_up'],
  'POST /api/auth/password': ['password_change', 'second_step_set_up'],
  'POST /api/auth/second-step': ['second_step'],
  'GET /api/auth/second-step': ['second_step_set_up'],
  'POST /api/auth/second-step/set-up': ['second_step_set_up'],
  'POST /api/auth/second-step/confirm': ['second_step_set_up'],
};

const CLOCK = '2026-10-05T09:00:00+05:00';

describe('every route of the application, as every role', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let callers: HarnessCallers;
  const handlerStop = new StopBeforeHandler();

  beforeAll(async () => {
    database = await createTestDatabase();
    const home = await insertBranch(database.migrator, 'North');
    const other = await insertBranch(database.migrator, 'South');
    // The application as `main.ts` builds it: no test-only controller, the real table.
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock(CLOCK),
      handlerStop,
    });
    callers = await harnessCallers(app, { home, other });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('says who may call it, exactly once, and what it answers', () => {
    expect(declarationProblems(app, ROUTE_ACCESS)).toEqual([]);
  });

  // The harness reads the controllers; Express must answer exactly these routes and no other.
  it('is a route of the Express router, which has no other', () => {
    const names = routesOf(app).map((route) => route.name);

    expect(names).toHaveLength(Object.keys(ROUTE_ACCESS).length);
    expect(expressRoutesOf(app)).toEqual(names);
  });

  it('is reachable with an owed step of sign-in only where the list says so', () => {
    const marked = routesOf(app)
      .filter((route) => route.allowedBefore.length > 0)
      .map((route) => [route.name, route.allowedBefore]);

    expect(Object.fromEntries(marked)).toEqual(STEP_ROUTES);
  });

  it('is tried by 15 roles, an account without a role and nobody', () => {
    expect(callers.callers.map((caller) => caller.name)).toEqual(['nobody', 'no role', ...ROLES]);
  });

  // Every route as 17 callers in two branches: about 58 s here after task 7.2's
  // routes, and over 120 s on a CI runner once (pull request #215); the limit
  // is time only, the list it checks is the same.
  it('allows and refuses as listed', async () => {
    expect(await accessProblems(app, ROUTE_ACCESS, callers, handlerStop)).toEqual([]);
  }, 240_000);
});

// docs/build-plan.md, task 0.7b: "sample routes pass for all 15 roles".
describe('the sample routes, as every role', () => {
  let database: TestDatabase;
  let app: NestExpressApplication;
  let callers: HarnessCallers;
  const handlerStop = new StopBeforeHandler();

  beforeAll(async () => {
    database = await createTestDatabase();
    const home = await insertBranch(database.migrator, 'North');
    const other = await insertBranch(database.migrator, 'South');
    app = await createTestApp({
      database: database.app,
      clock: new FixedClock(CLOCK),
      controllers: [PermissionSampleController],
      permissionTable: SAMPLE_PERMISSIONS,
      handlerStop,
    });
    callers = await harnessCallers(app, { home, other });
  }, 120_000);

  afterAll(async () => {
    await app.close();
    await database.destroy();
  });

  it('are declared as listed', () => {
    expect(declarationProblems(app, SAMPLE_ROUTE_ACCESS)).toEqual([]);
  });

  // Every route as 17 callers in two branches, as the walk above: over 120 s on a CI
  // runner after task 8.2's routes (pull request #218), and a walk cut by its limit kept
  // running into the next test; the limit is time only, the list it checks is the same.
  it('are allowed and refused as listed: by role, by branch and without a branch', async () => {
    expect(await accessProblems(app, SAMPLE_ROUTE_ACCESS, callers, handlerStop)).toEqual([]);
  }, 240_000);

  // The harness is only worth something if it sees a difference.
  it('are reported when the list names a role the server refuses, or leaves out one it allows', async () => {
    const wrong: Record<string, ExpectedAccess> = {
      ...SAMPLE_ROUTE_ACCESS,
      'POST /api/permission-sample/edit': { branch: 'request', roles: ['super_admin', 'teacher'] },
      'GET /api/permission-sample/own': 'public',
      // A route for no branch that the list holds to be for one branch.
      'GET /api/permission-sample/school': {
        branch: 'request',
        roles: ['super_admin', 'senior_head_teacher', 'head_teacher'],
      },
    };

    const problems = await accessProblems(app, wrong, callers, handlerStop);

    expect(problems).toEqual(
      expect.arrayContaining([
        'POST /api/permission-sample/edit as teacher in the own branch: refused, listed as allowed',
        'POST /api/permission-sample/edit as head_teacher in the own branch: allowed, listed as refused',
        'POST /api/permission-sample/edit as senior_head_teacher in another branch: allowed, listed as refused',
        'GET /api/permission-sample/own as nobody in the own branch: not_signed_in, listed as allowed',
        'GET /api/permission-sample/school as head_teacher in another branch: allowed, listed as refused',
      ]),
    );
    expect(declarationProblems(app, wrong)).toEqual([
      'GET /api/permission-sample/own: declared any_signed_in, listed as public',
      'GET /api/permission-sample/school: declared for the branch "none", listed for "request"',
    ]);
  }, 240_000);
});

// Left open by task 0.7b: a route with `@All()` crashed the harness.
describe('the harness and a route for every method', () => {
  let app: NestExpressApplication;
  const handlerStop = new StopBeforeHandler();
  const listed: Record<string, ExpectedAccess> = {
    ...ROUTE_ACCESS,
    'ALL /api/permission-every-method': 'any_signed_in',
  };

  beforeAll(async () => {
    app = await createTestApp({ controllers: [EveryMethodController], handlerStop });
  });

  afterAll(async () => {
    await app.close();
  });

  it('names it', () => {
    expect(declarationProblems(app, listed)).toEqual([
      'ALL /api/permission-every-method: answers every method (@All); a route names its one method, so that it can be called and listed',
    ]);
  });

  it('goes on to the other routes instead of stopping at it', async () => {
    // Nobody is signed in, so no database is needed: every answer is "not signed in" or public.
    const nobody: HarnessCallers = {
      home: randomUUID(),
      other: randomUUID(),
      callers: [{ name: 'nobody', role: null, cookies: undefined }],
    };

    expect(await accessProblems(app, listed, nobody, handlerStop)).toEqual([
      'ALL /api/permission-every-method: answers every method (@All) and was not called',
    ]);
  });
});

// The done-when of the task: "the harness fails if a route has no permission declaration".
describe('the harness', () => {
  let app: NestExpressApplication;

  beforeAll(async () => {
    app = await createTestApp({ controllers: [FaultyAccessController] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('names a route without a declaration, with two, with a permission and an owed step, without an answer schema, and one the list does not know', () => {
    const listed: Record<string, ExpectedAccess> = {
      ...ROUTE_ACCESS,
      'GET /api/permission-faults/undeclared': 'any_signed_in',
      'GET /api/permission-faults/twice': 'public',
      'GET /api/permission-faults/early': { branch: 'request', roles: ['teacher'] },
      'GET /api/removed': 'public',
    };

    expect(declarationProblems(app, listed)).toEqual([
      'GET /api/permission-faults/early: open to a session that owes a step of sign-in (second_step), which only a route of the own account may be',
      'GET /api/permission-faults/no-answer-schema: no @Returns, @ReturnsNothing, @AcceptedNothing or @ReturnsFile',
      'GET /api/permission-faults/no-answer-schema: not in the list of who may call it',
      'GET /api/permission-faults/twice: 2 access declarations, it needs exactly one',
      'GET /api/permission-faults/undeclared: 0 access declarations, it needs exactly one',
      'GET /api/removed: listed, but the application has no such route',
    ]);
  });
});
