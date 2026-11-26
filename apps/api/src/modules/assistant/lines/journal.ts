import type { AssistantRouteLine } from '../../access/assistant-routes.js';
import type { ChangeBasis, StepValue } from '../../access/assistant-change-routes.js';

/**
 * The lesson card: the basis read of a change of a lesson that carries no version (`journal`
 * `view`, held by every role that holds `journal` `edit`). `canMark` and the plan's `edit` follow
 * the clock (the edit period, the plan window) and are left out of the fingerprint.
 */
const LESSON_CARD: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/journal/lessons/:lessonId/card',
  args: { lessonId: 'path:lessonId' },
  clockKeys: ['canMark', 'edit'],
};

/** Keys of an exemption that change with the day, not with a change of it. */
const EXEMPTION_CLOCK_KEYS = ['today', 'state', 'className'] as const;

const EXEMPTION_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/exemptions/:id',
  args: { id: 'path:id' },
  clockKeys: EXEMPTION_CLOCK_KEYS,
};

const BATCH_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/exemptions',
  args: { batchId: 'path:batchId' },
  clockKeys: EXEMPTION_CLOCK_KEYS,
};

const OFFER_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/exemptions/move-offers',
  args: {},
  pick: { value: 'path:id' },
};

/**
 * A reason of absence carries no version and no read answers one student and date without the
 * class: the student's record is the basis (the reason itself is not fingerprinted).
 */
const ABSENCE_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/people/students/:id',
  args: { id: 'path:studentId' },
};
const ABSENCE_RECORDS: readonly StepValue[] = ['path:studentId', 'path:date'];

const ORPHANS = 'GET /api/journal/orphans';

const EXEMPTION_CHANGED = ['exemption_stale', 'exemption_choice_missing'] as const;
const UNLOCK_CHANGED = ['journal_unlock_stale', 'journal_unlock_decided'] as const;

function onlyKeys(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => keys.includes(key)));
}

/** Task 11.20: the lines of the journal, exemptions and absence reasons (`02`, Assistant, What it can do). */
export const JOURNAL_LINES: Readonly<Record<string, AssistantRouteLine>> = {
  // Attendance.
  'POST /api/journal/lessons/:lessonId/attendance': {
    kind: 'change',
    group: 'journal',
    description:
      'Saves the attendance marks of one lesson: 1 present, 0 absent, 2 late, 3 skipped, null clears. Read the lesson’s students and cells in the journal first and give one entry for every student, each with the version of the cell as read (null for a cell never saved); for a student changed from present or late to absent with numbers in the lesson, give numbers keep or clear. A correction of a locked lesson carries correction with its reason.',
    basis: { kind: 'own' },
    outdatedCodes: ['cell_stale'],
    records: ['path:lessonId'],
  },
  'POST /api/journal/lessons/:lessonId/all-present': {
    kind: 'change',
    group: 'journal',
    description:
      'Marks every student of one lesson with an empty attendance cell present; cells already marked are left as typed. Prefer the bulk attendance save, which names each student and mark.',
    basis: LESSON_CARD,
    records: ['path:lessonId'],
  },
  'POST /api/journal/lessons/:lessonId/copy-attendance': {
    kind: 'change',
    group: 'journal',
    description:
      'Copies the attendance of the first lesson of a double into this second lesson; cells already marked are left as typed.',
    basis: LESSON_CARD,
    records: ['path:lessonId'],
  },
  'POST /api/journal/lessons/:lessonId/undo': {
    kind: 'change',
    group: 'journal',
    description:
      'Undoes the person’s own last action on one lesson: give, for each student, the cells it changed (workId null for the attendance cell) with the versions that action gave them. A cell changed since is skipped and listed, not undone.',
    basis: { kind: 'own' },
    records: ['path:lessonId'],
  },
  'GET /api/journal/lessons/:lessonId/students/:studentId/history': {
    group: 'journal',
    description:
      'The history of one student’s cells in one lesson: attendance and numbers before and after, who changed them and when, and the totals and “not held” lines of its works.',
  },

  // Works, totals and numbers.
  'POST /api/journal/lessons/:lessonId/works': {
    kind: 'change',
    group: 'journal',
    description:
      'Adds a classwork or a homework with a title (at most 60 characters) to a held lesson; it is written into the lesson’s plan item.',
    basis: { kind: 'create' },
    records: ['path:lessonId'],
  },
  'PUT /api/journal/lessons/:lessonId/topic': {
    kind: 'change',
    group: 'journal',
    description:
      'Writes the topic of one lesson into its plan item (an empty topic clears it). Give baseTopic: the topic as read on the lesson card.',
    basis: { kind: 'own' },
    outdatedCodes: ['plan_item_stale'],
    records: ['path:lessonId'],
  },
  'PUT /api/journal/lessons/:lessonId/works/:workId/title': {
    kind: 'change',
    group: 'journal',
    description: 'Renames a work added by hand at a lesson. Give the work’s version as read.',
    basis: { kind: 'own' },
    outdatedCodes: ['work_stale'],
    records: ['path:workId'],
  },
  'DELETE /api/journal/lessons/:lessonId/works/:workId': {
    kind: 'change',
    group: 'journal',
    description:
      'Removes an empty work added by hand at a lesson: one with no total, no numbers and no “not held” mark.',
    basis: LESSON_CARD,
    records: ['path:workId'],
  },
  'PUT /api/journal/lessons/:lessonId/plan-works/:planWorkId/title': {
    kind: 'change',
    group: 'journal',
    description:
      'Renames a work of the lesson’s plan item from the journal. Give baseTitle: the title as read.',
    basis: { kind: 'own' },
    outdatedCodes: ['work_stale'],
    records: ['path:planWorkId'],
  },
  'DELETE /api/journal/lessons/:lessonId/plan-works/:planWorkId': {
    kind: 'change',
    group: 'journal',
    description:
      'Removes an empty work of the lesson’s plan item from the journal: one with no total, numbers or marks.',
    basis: LESSON_CARD,
    records: ['path:planWorkId'],
  },
  'PUT /api/journal/lessons/:lessonId/works/total': {
    kind: 'change',
    group: 'journal',
    description:
      'Sets the total (the highest score) of a work of one lesson. Give the column (workId, or planWorkId with sourceLessonId) and the work’s version as read (null for a column with no row yet). A total of a work that already has numbers is refused for the screen to confirm.',
    basis: { kind: 'own' },
    outdatedCodes: ['work_stale'],
    records: ['path:lessonId'],
  },
  'PUT /api/journal/lessons/:lessonId/works/not-held': {
    kind: 'change',
    group: 'journal',
    description:
      'Marks a work of one lesson “not held”, or takes the mark off. Give the column and the work’s version as read. A work that has numbers is refused for the screen to confirm.',
    basis: { kind: 'own' },
    outdatedCodes: ['work_stale'],
    records: ['path:lessonId'],
  },
  'POST /api/journal/lessons/:lessonId/scores': {
    kind: 'change',
    group: 'journal',
    description:
      'Saves the numbers of the works of one lesson: one entry per student and column, a whole number from 0 to the work’s total, null to clear, or notGraded with null. Give each cell’s version as read in the journal (null for a cell never saved). A correction of a locked lesson carries correction with its reason.',
    basis: { kind: 'own' },
    outdatedCodes: ['cell_stale'],
    records: ['path:lessonId'],
  },
  'POST /api/journal/lessons/:lessonId/not-graded': {
    kind: 'change',
    group: 'journal',
    description:
      'Sets the empty cells of the present students of one lesson to “not graded”, in the works named (every counted work with a total when none is named); they are left out of the average.',
    basis: LESSON_CARD,
    records: ['path:lessonId'],
  },

  // Comments.
  'PUT /api/journal/comments': {
    kind: 'change',
    group: 'journal',
    description:
      'Writes or clears (body null) the comment on an attendance mark, a number, a rating entry, or a student’s note for a lesson, seen by staff or by parents too. Give the comment’s version as read (null for a first comment).',
    basis: { kind: 'own' },
    outdatedCodes: ['comment_stale'],
    records: [],
  },
  'GET /api/journal/comments/history': {
    group: 'journal',
    description:
      'The history of the comment on one target: a mark, a work’s number, a note (target, studentId, lessonId, workId) or a rating entry (journalId, quarterId).',
  },

  // Today and the edit period.
  'GET /api/journal/exemptions-today': {
    group: 'journal',
    description:
      'The students exempt today and those back from an exemption today, in the caller’s own classes and lessons.',
  },
  'GET /api/journal/extensions': {
    group: 'journal',
    description:
      'The branch-wide extensions of the journal edit period: the dates they cover, until when, by whom and why.',
  },
  'POST /api/journal/extensions': {
    kind: 'change',
    group: 'journal',
    description:
      'Extends the edit period of every lesson of the branch between two dates by a number of days, with a reason.',
    basis: { kind: 'create' },
    records: [],
  },
  'POST /api/journal/unlocks/:unlockId/decide': {
    kind: 'change',
    group: 'journal',
    description:
      'Approves (with the days it stays open) or refuses (with an optional reason) an unlock request routed to the caller. Give the request’s version as read.',
    basis: { kind: 'own' },
    outdatedCodes: UNLOCK_CHANGED,
    records: ['path:unlockId'],
  },
  'POST /api/journal/unlocks/:unlockId/withdraw': {
    kind: 'change',
    group: 'journal',
    description:
      'Withdraws the caller’s own unlock request that is still waiting. Give its version as read.',
    basis: { kind: 'own' },
    outdatedCodes: UNLOCK_CHANGED,
    records: ['path:unlockId'],
  },

  // Discipline, orphan lessons and the support view.
  'GET /api/journal/discipline/items': {
    group: 'journal',
    description:
      'What one count of the journal discipline report stands for: the lessons or entries of one teacher behind one column, between two dates.',
  },
  'POST /api/journal/discipline/export': {
    kind: 'download',
    group: 'journal',
    description: 'The journal discipline report between two dates as an Excel file.',
  },
  'GET /api/journal/orphans': {
    group: 'journal',
    description:
      'The incomplete lessons of teachers who left, with the teacher a lesson is assigned to, and the teachers who may be assigned.',
  },
  'POST /api/journal/orphans/:lessonId/assign': {
    kind: 'change',
    group: 'journal',
    description:
      'Assigns an active teacher to complete an orphan lesson for 1 to 7 days, with a reason.',
    basis: { kind: 'read', route: ORPHANS, args: {} },
    outdatedCodes: ['orphan_not_orphan'],
    records: ['path:lessonId'],
  },
  'POST /api/journal/orphans/assignments/:assignmentId/withdraw': {
    kind: 'change',
    group: 'journal',
    description: 'Withdraws the assignment of a teacher to an orphan lesson.',
    basis: { kind: 'read', route: ORPHANS, args: {}, pick: { value: 'path:assignmentId' } },
    outdatedCodes: ['orphan_assignment_withdrawn'],
    records: ['path:assignmentId'],
  },
  'GET /api/journal/support': {
    group: 'journal',
    description:
      'The support view of one student, journal and date: the stored cells, the saves and refusals, and how the result was calculated. Every opening is logged.',
  },

  // Exports of journals.
  'GET /api/journal/exports': {
    kind: 'export',
    group: 'journal',
    description: 'The caller’s own exports of the branch’s journals and their status.',
  },
  'POST /api/journal/exports': {
    kind: 'export',
    group: 'journal',
    description:
      'Asks for an export of every journal of the branch for a quarter or a month, as Excel or PDF, made in the background.',
  },
  'GET /api/journal/exports/:exportId/file': {
    kind: 'download',
    group: 'journal',
    description: 'The file of a finished export of the branch’s journals.',
  },
  'POST /api/journal/journals/:journalId/export': {
    kind: 'download',
    group: 'journal',
    description: 'One journal for a quarter or a month as an Excel or PDF file.',
  },

  // Reasons of absence.
  'GET /api/journal/student-absences': {
    group: 'journal',
    description:
      'The absences of the students of one class by day (at most 31 days; this week when no dates are given): the lessons missed and the reason recorded. Give classId; without it the first class the caller may choose is shown.',
  },
  'PUT /api/journal/student-absences/:studentId/:date': {
    kind: 'change',
    group: 'journal',
    description:
      'Sets the reason of a student’s absence on a date: a category (illness, family, school_permitted, unexcused, unknown) and a note; category null with an empty note clears it.',
    basis: ABSENCE_BASIS,
    records: ABSENCE_RECORDS,
  },
  'PUT /api/journal/student-absences/:studentId/:date/file': {
    kind: 'file',
    group: 'journal',
    description:
      'Attaches a file (PDF, JPEG or PNG) to the reason of a student’s absence on a date.',
  },
  'GET /api/journal/student-absences/:studentId/:date/file': {
    kind: 'download',
    group: 'journal',
    description:
      'The file attached to the reason of a student’s absence on a date. Every opening is logged.',
  },
  'DELETE /api/journal/student-absences/:studentId/:date/file': {
    kind: 'change',
    group: 'journal',
    description: 'Removes the file attached to the reason of a student’s absence on a date.',
    basis: ABSENCE_BASIS,
    records: ABSENCE_RECORDS,
  },

  // Exemptions.
  'GET /api/exemptions': {
    group: 'journal',
    description:
      'The exemptions of the branch, filtered by class, kind, subject, student, batch or state (in_force, ending_this_week, coming, ended, voided, all), with dates, subjects, reason category and version.',
  },
  'GET /api/exemptions/:id': {
    group: 'journal',
    description:
      'One exemption: student, kind, subjects, dates or slots, category, state and version.',
  },
  'GET /api/exemptions/:id/reason': {
    group: 'journal',
    description: 'The detail of the reason of one exemption. Every opening is logged.',
  },
  'GET /api/exemptions/:id/document': {
    kind: 'download',
    group: 'journal',
    description: 'The document of one exemption. Every opening is logged.',
  },
  'PUT /api/exemptions/:id/document': {
    kind: 'file',
    group: 'journal',
    description: 'Attaches a document (PDF, JPEG or PNG) to an exemption.',
  },
  'DELETE /api/exemptions/:id/document': {
    kind: 'change',
    group: 'journal',
    description: 'Removes the document of an exemption.',
    basis: EXEMPTION_BASIS,
  },
  'GET /api/exemptions/absences-without': {
    group: 'journal',
    description:
      'Absences with a Tutor’s reason (illness, family, permitted by the school) that no exemption covers.',
  },
  'GET /api/exemptions/move-offers': {
    group: 'journal',
    description:
      'The exemptions offered by students moving into the branch from another branch, waiting or decided.',
  },
  'GET /api/exemptions/move-offers/:id/reason': {
    group: 'journal',
    description:
      'The detail of the reason of a waiting branch-move offer. Every opening is logged.',
  },
  'POST /api/exemptions/preview': {
    kind: 'preview',
    group: 'journal',
    description:
      'Preview of new exemptions: per student, the held lessons that become exempt by themselves, those with a present or late mark or a number that need a choice, and overlaps.',
  },
  'POST /api/exemptions': {
    kind: 'change',
    group: 'journal',
    description:
      'Creates one exemption per chosen student (temporary or full; all or chosen subjects; whole days or slots of one day; a category and a reason). Run the preview first and give a choice (keep or exempt) for every lesson it lists to choose.',
    basis: { kind: 'create' },
    preview: { route: 'POST /api/exemptions/preview' },
    outdatedCodes: ['exemption_choice_missing'],
    records: [],
  },
  'POST /api/exemptions/:id/edit/preview': {
    kind: 'preview',
    group: 'journal',
    description: 'Preview of a change of an exemption that has not started.',
  },
  'PATCH /api/exemptions/:id': {
    kind: 'change',
    group: 'journal',
    description:
      'Changes every field of an exemption before its start date. Give its version as read and a choice for every lesson the preview lists to choose.',
    basis: { kind: 'own' },
    preview: { route: 'POST /api/exemptions/:id/edit/preview' },
    outdatedCodes: EXEMPTION_CHANGED,
  },
  'POST /api/exemptions/:id/end/preview': {
    kind: 'preview',
    group: 'journal',
    description:
      'Preview of a new last day of an exemption: the lessons that change or open again.',
  },
  'POST /api/exemptions/:id/end': {
    kind: 'change',
    group: 'journal',
    description:
      'Sets a new last day of an exemption, earlier or later. Give its version as read and a choice for every lesson the preview lists to choose.',
    basis: { kind: 'own' },
    preview: { route: 'POST /api/exemptions/:id/end/preview' },
    outdatedCodes: EXEMPTION_CHANGED,
  },
  'POST /api/exemptions/:id/void/preview': {
    kind: 'preview',
    group: 'journal',
    description: 'Preview of voiding an exemption: the lessons that open again.',
  },
  'POST /api/exemptions/:id/void': {
    kind: 'change',
    group: 'journal',
    description: 'Voids an exemption entered in error, with a reason. Give its version as read.',
    basis: { kind: 'own' },
    preview: {
      route: 'POST /api/exemptions/:id/void/preview',
      body: (body) => onlyKeys(body, ['version']),
    },
    outdatedCodes: ['exemption_stale'],
  },
  'POST /api/exemptions/batches/:batchId/end/preview': {
    kind: 'preview',
    group: 'journal',
    description: 'Preview of a new last day for every live exemption of a batch.',
  },
  'POST /api/exemptions/batches/:batchId/end': {
    kind: 'change',
    group: 'journal',
    description:
      'Sets a new last day for every live exemption of a batch. Give a choice for every lesson the preview lists to choose.',
    basis: BATCH_BASIS,
    preview: { route: 'POST /api/exemptions/batches/:batchId/end/preview' },
    outdatedCodes: ['exemption_choice_missing'],
    records: ['path:batchId'],
  },
  'POST /api/exemptions/batches/:batchId/void/preview': {
    kind: 'preview',
    group: 'journal',
    description: 'Preview of voiding every live exemption of a batch.',
  },
  'POST /api/exemptions/batches/:batchId/void': {
    kind: 'change',
    group: 'journal',
    description: 'Voids every live exemption of a batch entered in error, with a reason.',
    basis: BATCH_BASIS,
    preview: {
      route: 'POST /api/exemptions/batches/:batchId/void/preview',
      body: () => ({}),
    },
    records: ['path:batchId'],
  },
  'POST /api/exemptions/move-offers/:id/confirm/preview': {
    kind: 'preview',
    group: 'journal',
    description:
      'Preview of confirming a branch-move offer: the lessons from the move date it changes.',
  },
  'POST /api/exemptions/move-offers/:id/confirm': {
    kind: 'change',
    group: 'journal',
    description:
      'Confirms an exemption offered by a branch move, as an exemption of this branch from the move date. Give a choice for every lesson the preview lists to choose.',
    basis: OFFER_BASIS,
    preview: {
      route: 'POST /api/exemptions/move-offers/:id/confirm/preview',
      body: () => ({}),
    },
    outdatedCodes: ['exemption_offer_decided', 'exemption_choice_missing'],
  },
  'POST /api/exemptions/move-offers/:id/drop': {
    kind: 'change',
    group: 'journal',
    description: 'Drops an exemption offered by a branch move: it is not copied into this branch.',
    basis: OFFER_BASIS,
    outdatedCodes: ['exemption_offer_decided'],
  },

  // A student's record.
  'GET /api/people/students/:id/leaving-results': {
    group: 'results',
    description:
      'The results of a student who left, per subject and quarter up to the last day, as the platform calculates them; only the subjects whose journal the caller reads whole.',
  },
};
