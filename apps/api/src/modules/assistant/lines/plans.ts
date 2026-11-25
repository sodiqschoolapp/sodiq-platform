import type { AssistantRouteLine } from '../../access/assistant-routes.js';
import type { ChangeBasis, StepValue } from '../../access/assistant-change-routes.js';

/**
 * Keys of a lesson plan read (`planSchema`) that change with the clock alone: a row held or
 * started, what a row is open to now, the window's state, the flags and the request worked out
 * at the window's end, the waiting days of a request.
 */
const PLAN_CLOCK: readonly string[] = [
  'held',
  'started',
  'open',
  'window',
  'flag',
  'belowMinimum',
  'request',
  'next',
  'waitingDays',
  'late',
];

/** The plan of the step's journal in the quarter of its body, as `GET …/journals/:journalId` answers it. */
function planBasis(pick?: StepValue): ChangeBasis {
  return {
    kind: 'read',
    route: 'GET /api/plans/journals/:journalId',
    args: { journalId: 'path:journalId', quarterId: 'body:quarterId' },
    ...(pick === undefined ? {} : { pick: { value: pick } }),
    clockKeys: PLAN_CLOCK,
  };
}

/**
 * The closing checklist of the step's quarter; the prepared stamp, the school days passed, the
 * nightly check and whether the quarter is closable today move with the clock.
 */
const CLOSING_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/results/closing',
  args: { quarterId: 'path:quarterId' },
  clockKeys: ['prepared', 'schoolDays', 'check', 'closable', 'ended'],
};

const PLAN_MASTER_OUTDATED = ['plan_master_stale'] as const;
const PLAN_REQUEST_OUTDATED = ['plan_request_decided'] as const;
const ANNOUNCEMENT_OUTDATED = ['announcement_changed'] as const;
const RATING_OUTDATED = ['rating_exam_stale'] as const;

/** Task 11.20: the lines of plans, results, classes and announcements (`02`, Assistant, What it can do). */
export const PLANS_LINES: Readonly<Record<string, AssistantRouteLine>> = {
  // Announcements.
  'GET /api/announcements-feed': {
    group: 'announcements',
    description:
      'The announcements and events addressed to the person for one month (month as YYYY-MM; the current month when left out).',
  },
  'POST /api/announcements': {
    kind: 'change',
    group: 'announcements',
    description:
      'Publishes an announcement or an event: its kind, title and text (an event with its date), the audience (school, branch, grades or classes) and whether it is for staff, parents or both.',
    basis: { kind: 'create' },
    records: [],
  },
  'PUT /api/announcements/:id': {
    kind: 'change',
    group: 'announcements',
    description:
      'Changes the content of an announcement or event that is not archived. Send its version as the announcements read gave it.',
    basis: { kind: 'own' },
    outdatedCodes: [...ANNOUNCEMENT_OUTDATED, 'announcement_archived'],
  },
  'POST /api/announcements/:id/archive': {
    kind: 'change',
    group: 'announcements',
    description: 'Archives an announcement or event. Send its version.',
    basis: { kind: 'own' },
    outdatedCodes: ANNOUNCEMENT_OUTDATED,
  },
  'POST /api/announcements/:id/restore': {
    kind: 'change',
    group: 'announcements',
    description: 'Restores an archived announcement or event. Send its version.',
    basis: { kind: 'own' },
    outdatedCodes: ANNOUNCEMENT_OUTDATED,
  },

  // Classes, Tutors and groups.
  'GET /api/classes/seats': {
    group: 'classes',
    description:
      'The classes a new student can join from a date (from), each with the first day from then on with no free seat, or null when it always has one.',
  },
  'GET /api/classes/tutor-candidates': {
    group: 'classes',
    description:
      'The Tutors and Class teachers of the branch a class can be given: their assignmentId, languages, dates and the classes they hold now or later.',
  },
  'POST /api/classes/:id/tutors/preview': {
    kind: 'preview',
    group: 'classes',
    description:
      'Preview of giving a class a Tutor or an acting Tutor: the Tutor lessons that move to them and those left needing a teacher, with their clashes.',
  },
  'POST /api/classes/:id/tutors': {
    kind: 'change',
    group: 'classes',
    description:
      'Gives a class a Tutor (or Class teacher) or an acting Tutor from a date, optionally until a date: the assignmentId from the Tutor candidates read and the kind tutor or acting. The preview runs first.',
    basis: {
      kind: 'read',
      route: 'GET /api/classes/:id',
      args: { id: 'path:id' },
      clockKeys: ['today', 'state'],
    },
    preview: { route: 'POST /api/classes/:id/tutors/preview' },
  },
  'POST /api/classes/:id/tutors/:tutorId/end': {
    kind: 'change',
    group: 'classes',
    description:
      'Ends a Tutor or acting Tutor of a class from a date (from, the first day without the class); tutorId is the id of the Tutor row in the class read.',
    basis: {
      kind: 'read',
      route: 'GET /api/classes/:id',
      args: { id: 'path:id' },
      pick: { value: 'path:tutorId' },
      clockKeys: ['today', 'state'],
    },
    records: ['path:tutorId'],
  },
  'POST /api/classes/export': {
    kind: 'download',
    group: 'classes',
    description: 'The list of classes as an Excel file; the export is logged.',
  },
  'GET /api/groups/placement': {
    group: 'classes',
    description:
      'The group placement board of one subject for grades on a date: the groups with their members and free seats, and the students of those grades not yet placed.',
  },
  'GET /api/groups/slot-check': {
    group: 'classes',
    description:
      'For the classes of a new group (classIds, comma separated): the timetable slots those classes share, as the group form checks them.',
  },
  'POST /api/groups/export': {
    kind: 'download',
    group: 'classes',
    description: 'The list of groups as an Excel file; the export is logged.',
  },

  // The rating exam of a journal and the lesson card.
  'GET /api/journal/journals/:journalId/rating/:quarterId/students/:studentId/history': {
    group: 'journal',
    description:
      'The history of one student’s rating exam entry in a journal and quarter, and of the exam’s date and "not held" mark: before, after, by whom and when.',
  },
  'PUT /api/journal/journals/:journalId/rating/:quarterId/date': {
    kind: 'change',
    group: 'journal',
    description:
      'Sets or clears the hand-written date of the rating exam of a journal in a quarter. Send the exam’s version as the journal read gave it.',
    basis: { kind: 'own' },
    outdatedCodes: RATING_OUTDATED,
    records: ['path:journalId'],
  },
  'PUT /api/journal/journals/:journalId/rating/:quarterId/not-held': {
    kind: 'change',
    group: 'journal',
    description:
      'Marks the rating exam of a journal in a quarter "not held", or undoes it (the Academic Vice Principal’s mark). Send the exam’s version. When students already have entries the route refuses with rating_exam_entries: tell the person, who confirms it on the screen.',
    basis: { kind: 'own' },
    outdatedCodes: RATING_OUTDATED,
    records: ['path:journalId'],
  },
  'POST /api/journal/journals/:journalId/rating/:quarterId/entries': {
    kind: 'change',
    group: 'journal',
    description:
      'Saves one student’s rating exam entry in a journal and quarter: a score, did not sit, exempt, or null to clear, with the entry’s version from the journal read. The journal’s teacher types scores and did not sit, the Academic Vice Principal sets exempt; a change over a stored entry or a correction (correction true) needs a reason.',
    basis: { kind: 'own' },
    outdatedCodes: RATING_OUTDATED,
    records: ['body:studentId'],
  },
  'PUT /api/journal/lessons/:lessonId/delivery': {
    kind: 'change',
    group: 'journal',
    description:
      'Sets or undoes "topic not delivered" on a held lesson: its plan item is copied into "not covered". Send the delivery version from the lesson card read (null before the first mark).',
    basis: { kind: 'own' },
    outdatedCodes: ['delivery_stale'],
    records: ['path:lessonId'],
  },
  'PUT /api/journal/lessons/:lessonId/homework-given': {
    kind: 'change',
    group: 'journal',
    description:
      'Marks some or all homeworks of the lesson’s plan item "not given", or undoes it: planWorkIds are the homework ids of the lesson card read.',
    basis: {
      kind: 'read',
      route: 'GET /api/journal/lessons/:lessonId/card',
      args: { lessonId: 'path:lessonId' },
      clockKeys: ['held', 'canMark', 'edit'],
    },
    records: ['path:lessonId'],
  },

  // Lesson plans: the plan itself.
  'GET /api/plans/files/:fileId': {
    kind: 'download',
    group: 'plans',
    description: 'One file of a lesson plan item, as it was added.',
  },
  'PUT /api/plans/items/:itemId/files': {
    kind: 'file',
    group: 'plans',
    description:
      'Adds a file to a lesson plan item, to its materials or to one of its works (workId), with its name.',
  },
  'DELETE /api/plans/files/:fileId': {
    kind: 'change',
    group: 'plans',
    description:
      'Removes a file from an item of the own lesson plan; fileId is from the plan read.',
    basis: { kind: 'own' },
    records: ['path:fileId'],
  },
  'POST /api/plans/items/:itemId/clear': {
    kind: 'change',
    group: 'plans',
    description:
      'Clears an item of the own lesson plan at a row not yet held: the row becomes empty. A held row keeps its item.',
    basis: { kind: 'own' },
    outdatedCodes: ['plan_row_held'],
    records: ['path:itemId'],
  },
  'PUT /api/plans/journals/:journalId/queue': {
    kind: 'change',
    group: 'plans',
    description:
      'Reorders the items of the own plan from the first row not started (insert, delete, merge and reorder of an approved re-plan): base is the item ids of those rows in order as the plan read gave them (null for an empty row), order the new order; an item left out is cleared.',
    basis: { kind: 'own' },
    outdatedCodes: ['plan_queue_stale'],
    records: ['path:journalId'],
  },
  'POST /api/plans/journals/:journalId/share': {
    kind: 'change',
    group: 'plans',
    description:
      'Joins another own journal (body journalId, one of the plan’s shareCandidates) to this journal’s plan in a quarter, so both follow one plan.',
    basis: planBasis(),
    records: ['path:journalId', 'body:journalId'],
  },
  'POST /api/plans/journals/:journalId/separate': {
    kind: 'change',
    group: 'plans',
    description:
      'Separates this journal from its shared plan in a quarter: it keeps a copy of the items.',
    basis: planBasis(),
    records: ['path:journalId'],
  },
  'POST /api/plans/journals/:journalId/copy': {
    kind: 'change',
    group: 'plans',
    description:
      'Copies into this empty own plan of a quarter the items of another plan (source journalId and quarterId, part all or remaining: only the items of lessons not yet held) or of a master plan (source masterId).',
    basis: planBasis(),
    outdatedCodes: ['plan_not_empty'],
    records: ['path:journalId'],
  },
  'POST /api/plans/journals/:journalId/export': {
    kind: 'download',
    group: 'plans',
    description:
      'The lesson plan of a journal for a quarter as a PDF or Excel file, with its marks; the export is logged.',
  },
  'POST /api/plans/journals/:journalId/not-covered/:itemId/merge': {
    kind: 'change',
    group: 'plans',
    description:
      'Merges a not-covered item of the own plan into the row at position (with its lessonId as the plan read gave it): an empty row takes the item, a row with an item takes its content. base is the row’s item (topic, objectives, links) as read, null for an empty row.',
    basis: { kind: 'own' },
    outdatedCodes: [
      'plan_merge_stale',
      'plan_row_taken',
      'plan_row_moved',
      'plan_row_unknown',
      'plan_item_covered',
    ],
    records: ['path:itemId'],
  },
  'POST /api/plans/journals/:journalId/not-covered/:itemId/carry': {
    kind: 'change',
    group: 'plans',
    description:
      'Carries a not-covered item of the own plan into the "carried in" tray of the next quarter of the year.',
    basis: planBasis('path:itemId'),
    records: ['path:itemId'],
  },
  'POST /api/plans/journals/:journalId/not-covered/:itemId/drop': {
    kind: 'change',
    group: 'plans',
    description:
      'Drops a not-covered item of a teacher’s plan, with a reason: for the approver of that teacher’s requests only (the plan read says canDrop).',
    basis: planBasis('path:itemId'),
    records: ['path:itemId'],
  },
  'POST /api/plans/journals/:journalId/carried/:itemId/place': {
    kind: 'change',
    group: 'plans',
    description:
      'Places an item of the "carried in" tray of the own plan at the row at position (with its lessonId as the plan read gave it); the later items move one row on.',
    basis: { kind: 'own' },
    outdatedCodes: ['plan_row_taken', 'plan_row_moved', 'plan_row_unknown', 'plan_item_covered'],
    records: ['path:itemId'],
  },

  // Master plans.
  'GET /api/plans/masters': {
    group: 'plans',
    description:
      'The master plans of a year, by subject, grade and quarter (optional filters), with their scope, items and whether archived; with journalId and quarterId, those a plan can be copied from.',
  },
  'GET /api/plans/masters/:masterId': {
    group: 'plans',
    description:
      'One master plan with its revision and its rows in order (topic, objectives, links, classworks, homeworks).',
  },
  'POST /api/plans/masters': {
    kind: 'change',
    group: 'plans',
    description:
      'Creates a master plan for a year, quarter, subject, grade and language, with a name, for the branch or the whole school (scope).',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/plans/masters/:masterId': {
    kind: 'change',
    group: 'plans',
    description: 'Renames a master plan. Send its revision as the master read gave it.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:masterId'],
  },
  'POST /api/plans/masters/:masterId/archive': {
    kind: 'change',
    group: 'plans',
    description: 'Archives a master plan. Send its revision.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:masterId'],
  },
  'POST /api/plans/masters/:masterId/restore': {
    kind: 'change',
    group: 'plans',
    description: 'Restores an archived master plan. Send its revision.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:masterId'],
  },
  'POST /api/plans/masters/:masterId/items': {
    kind: 'change',
    group: 'plans',
    description:
      'Adds a row to a master plan at a position: topic, objectives, links, classworks and homeworks. Send the master’s revision; one change of a master per proposal, since each change raises the revision.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:masterId'],
  },
  'PUT /api/plans/masters/:masterId/items/:itemId': {
    kind: 'change',
    group: 'plans',
    description:
      'Changes a row of a master plan: give its full new values. Send the master’s revision.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:masterId'],
  },
  'POST /api/plans/masters/:masterId/items/:itemId/remove': {
    kind: 'change',
    group: 'plans',
    description: 'Removes a row of a master plan. Send the master’s revision.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:masterId'],
  },
  'PUT /api/plans/masters/:masterId/order': {
    kind: 'change',
    group: 'plans',
    description:
      'Sets the order of the rows of a master plan: every row id in the new order. Send the master’s revision.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:masterId'],
  },
  'POST /api/plans/journals/:journalId/master-take': {
    kind: 'change',
    group: 'plans',
    description:
      'Takes the changes of the master plan into the own plan of a quarter, on the rows not yet held (the master comparison read shows them). Send the master’s revision from the comparison.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:journalId'],
  },
  'POST /api/plans/journals/:journalId/master-keep': {
    kind: 'change',
    group: 'plans',
    description:
      'Keeps the own plan of a quarter as it is after a master plan change: the "master updated" mark goes, nothing else changes. Send the master’s revision from the comparison.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_MASTER_OUTDATED,
    records: ['path:journalId'],
  },
  'GET /api/plans/parallel': {
    group: 'plans',
    description:
      'The parallel classes and groups of a subject and grade in a quarter: for each, the last row reached and the next row with their topics.',
  },

  // Minimum works, plan reports and edit requests.
  'GET /api/plans/minimums': {
    group: 'plans',
    description:
      'The minimum number of classworks and homeworks per quarter of each subject, with the version a change is sent on.',
  },
  'PUT /api/plans/minimums': {
    kind: 'change',
    group: 'plans',
    description:
      'Sets the minimum classworks and homeworks per quarter of one subject. Send its version from the minimums read (null before the first save).',
    basis: { kind: 'own' },
    outdatedCodes: ['plan_minimum_stale'],
    records: ['body:subjectId'],
  },
  'GET /api/plans/reports/requests': {
    group: 'plans',
    description:
      'The plan edit requests report of a quarter, by teacher (optional departmentId and teacherId): each teacher’s requests with kind, status and dates.',
  },
  'POST /api/plans/reports/export': {
    kind: 'download',
    group: 'plans',
    description:
      'A plan report (completeness, progress or requests) as an Excel file; the export is logged.',
  },
  'POST /api/plans/journals/:journalId/requests/prepared': {
    kind: 'change',
    group: 'plans',
    description:
      'Sends the edit request the system worked out at the end of the window for the own plan of a quarter, as it is, with an optional note.',
    basis: planBasis(),
    records: ['path:journalId'],
  },
  'POST /api/plans/journals/:journalId/requests/prepared/decide': {
    kind: 'change',
    group: 'plans',
    description:
      'Decides, without waiting for the teacher to send it, the edit request worked out at the end of the window for a teacher’s plan of a quarter: approve with a number of school days (1 to 10), unticking lessons with a reason, or refuse with a reason.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_REQUEST_OUTDATED,
    records: ['path:journalId'],
  },
  'POST /api/plans/requests/:requestId/decide': {
    kind: 'change',
    group: 'plans',
    description:
      'Decides a waiting plan edit request: approve with a number of school days (1 to 10), optionally unticking lessons or naming a later first lesson, each with a reason, or refuse with a reason.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_REQUEST_OUTDATED,
    records: ['path:requestId'],
  },
  'POST /api/plans/requests/decide-event': {
    kind: 'change',
    group: 'plans',
    description:
      'Approves together every waiting plan edit request caused by one event (eventId from the requests read), optionally of one subject only, with one number of school days; the requests the person may not decide are skipped.',
    basis: { kind: 'own' },
    records: ['body:eventId'],
  },
  'POST /api/plans/requests/:requestId/finish': {
    kind: 'change',
    group: 'plans',
    description:
      'Finishes early the editing period an approved request opened on the own plan: the rows lock again.',
    basis: { kind: 'own' },
    outdatedCodes: PLAN_REQUEST_OUTDATED,
    records: ['path:requestId'],
  },

  // Closing a quarter.
  'GET /api/results/closing': {
    group: 'results',
    description:
      'The closing checklist of a quarter (the current one when quarterId is left out): its state, the blocking items and warnings by teacher and journal, the flagged results to decide, the reopenings and whether it can be closed.',
  },
  'GET /api/results/closing/:quarterId/recalculation': {
    group: 'results',
    description:
      'Recalculate and compare for a closed quarter: the results whose recalculation differs from the stored ones, by student, subject and journal. Changes nothing.',
  },
  'PUT /api/results/closing/:quarterId/decisions': {
    kind: 'change',
    group: 'results',
    description:
      'Sets or clears the decision on one flagged result of a student in a subject of the quarter. Send the stored decision’s version from the checklist (null when none is stored).',
    basis: { kind: 'own' },
    outdatedCodes: ['closing_decision_changed'],
    records: ['body:studentId'],
  },
  'POST /api/results/closing/:quarterId/journals/:journalId/decisions': {
    kind: 'change',
    group: 'results',
    description:
      'Sets or clears one decision on the flagged results of the listed students of one journal in the quarter at once.',
    basis: CLOSING_BASIS,
    records: ['path:journalId'],
  },
  'POST /api/results/closing/:quarterId/plan-periods/end': {
    kind: 'change',
    group: 'results',
    description: 'Ends every open lesson plan editing period of the quarter, from the checklist.',
    basis: CLOSING_BASIS,
    records: ['path:quarterId'],
  },
  'POST /api/results/closing/:quarterId/remind': {
    kind: 'change',
    group: 'results',
    description:
      'Sends each teacher concerned the list of their unfinished items on the closing checklist of the quarter.',
    basis: CLOSING_BASIS,
    records: ['path:quarterId'],
  },
  'POST /api/results/closing/:quarterId/close': {
    kind: 'change',
    group: 'results',
    description:
      'Closes the quarter for the whole branch. Name every warning the checklist lists (kind and journalId) as seen, lockNow when the checklist says lockNowNeeded, and for the start quarter of the branch its choice; with a blocking item left the close is refused.',
    basis: { kind: 'own' },
    outdatedCodes: ['closing_warnings_changed'],
    records: ['path:quarterId'],
  },
  'POST /api/results/closing/:quarterId/reopen': {
    kind: 'change',
    group: 'results',
    description:
      'Reopens a closed quarter for the whole branch (journalId null) or one journal, for 1 to 14 days, with a reason.',
    basis: CLOSING_BASIS,
    records: ['path:quarterId'],
  },
  'POST /api/results/closing/:quarterId/journals/:journalId/close': {
    kind: 'change',
    group: 'results',
    description:
      'Closes again a reopened journal of a closed quarter. Name every warning the checklist lists for it as seen, and lockNow when needed.',
    basis: { kind: 'own' },
    outdatedCodes: ['closing_warnings_changed'],
    records: ['path:journalId'],
  },
  'POST /api/results/closing/:quarterId/recalculation/apply': {
    kind: 'change',
    group: 'results',
    description:
      'Applies the recalculated results of the listed students and subjects of a closed quarter, as recalculate and compare listed them, with a reason.',
    basis: { kind: 'own' },
    outdatedCodes: ['recalculation_changed'],
    records: ['path:quarterId'],
  },

  // Early warning, rating and reports.
  'POST /api/results/early-warning/handled': {
    kind: 'change',
    group: 'results',
    description:
      'Marks one reason of a student’s early-warning entry in a subject and quarter handled, with an optional staff-only note.',
    basis: { kind: 'own' },
    outdatedCodes: ['early_warning_not_listed'],
    records: ['body:studentId'],
  },
  'POST /api/results/rating/export': {
    kind: 'download',
    group: 'results',
    description:
      'One rating list as an Excel file, with the person’s own rows; the export is logged.',
  },
  'POST /api/results/reports/attendance/export': {
    kind: 'download',
    group: 'results',
    description: 'The attendance report as an Excel file; the export is logged.',
  },
  'POST /api/results/reports/export': {
    kind: 'download',
    group: 'results',
    description:
      'The results table or the subject mastery report as an Excel file; the export is logged.',
  },

  // A student's results page.
  'GET /api/results/students/:id/attendance': {
    group: 'results',
    description:
      'One student’s attendance of a year (yearId, the current year when left out), per subject and quarter.',
  },
  'GET /api/results/students/:id/lessons': {
    group: 'results',
    description:
      'One student’s lessons of one subject in one quarter (subjectId and quarterId): attendance and marks lesson by lesson.',
  },
  'GET /api/results/students/:id/tabs': {
    group: 'results',
    description: 'Which tabs of a student’s page the person may read: results, attendance.',
  },
};
