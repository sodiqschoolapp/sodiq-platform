import type { AssistantRouteLine } from '../../access/assistant-routes.js';
import type {
  AssistantPreview,
  ChangeBasis,
  StepValue,
} from '../../access/assistant-change-routes.js';

/** Task 11.20: the lines of timetable (`02`, Assistant, What it can do). */

const id: StepValue = 'path:id';

/** A record of a list read, found by its id (as `readById` of `assistant-change-routes.ts`). */
function readById(route: string, clockKeys?: readonly string[]): ChangeBasis {
  return {
    kind: 'read',
    route,
    args: {},
    pick: { value: id },
    ...(clockKeys === undefined ? {} : { clockKeys }),
  };
}

function withoutKeys(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => !keys.includes(key)));
}

function pickKeys(
  body: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): Record<string, unknown> {
  return Object.fromEntries(Object.entries(body).filter(([key]) => keys.includes(key)));
}

const VERSIONS = 'GET /api/timetable/versions';
const GRID = 'GET /api/timetable/versions/:id/grid';
const READINESS = 'GET /api/timetable/versions/:id/readiness';

/**
 * A version as the list answers it. The holder's own writes refresh the edit lock's `seenAt`
 * (task 5.4c-1), so it is left out of the fingerprint of a change of the draft.
 */
const VERSION_BASIS = readById(VERSIONS, ['seenAt']);

/** A block, a lock or a pin of the draft's grid, found by its id. */
function inGrid(value: StepValue): ChangeBasis {
  return { kind: 'read', route: GRID, args: { id }, pick: { value } };
}

/** The whole grid of the draft: a change that names several blocks of it. */
const WHOLE_GRID: ChangeBasis = { kind: 'read', route: GRID, args: { id }, clockKeys: ['seenAt'] };

/** The readiness of the draft's builder steps 1 to 5. */
const WHOLE_READINESS: ChangeBasis = { kind: 'read', route: READINESS, args: { id } };

const LESSON_BASIS: ChangeBasis = {
  kind: 'read',
  route: 'GET /api/timetable/lessons/:id/history',
  args: { id },
};

const EMPTY_BODY = (): Record<string, never> => ({});

const LOAD_IMPORT_PREVIEW: AssistantPreview = {
  route: 'POST /api/timetable/versions/:id/load/imports/:importId/preview',
  body: EMPTY_BODY,
};

const PATTERN_IMPORT_PREVIEW: AssistantPreview = {
  route: 'POST /api/timetable/versions/:id/pattern/imports/:importId/preview',
  body: EMPTY_BODY,
};

const ACTING_CHECK = 'POST /api/timetable/acting-teachers/check';
const FILL_CHECK = 'POST /api/timetable/vacancy-fills/check';

/** A draft write takes the draft's edit lock; another person active on it refuses it. */
const DRAFT_NOTE =
  'Only a draft is changed; it is refused (draft_edit_locked) while another person is editing the draft.';

export const TIMETABLE_LINES: Readonly<Record<string, AssistantRouteLine>> = {
  // Reads.
  'GET /api/timetable/absences/:id/journals/:journalId/substitutes': {
    group: 'timetable',
    description:
      'The suggested substitutes for the lessons of one journal during a teacher absence: the dates a save would cover, and for each teacher the dates they can and cannot take. Give the absence id and the journalId (from the absence lessons read).',
  },
  'GET /api/timetable/absences/:id/lessons': {
    group: 'timetable',
    description:
      'The lessons of this branch that fall in one teacher absence, with their date, time, state and journalId.',
  },
  'GET /api/timetable/exams/:id': {
    group: 'timetable',
    description:
      'One exam: date, time, title, subject, rooms with their classes, groups and invigilators, the lessons it replaces, and whether it has started or was cancelled.',
  },
  'GET /api/timetable/history': {
    group: 'timetable',
    description:
      'The timetable versions of one academic year by start date, and the version in force on the first day of each quarter. Give the academicYearId.',
  },
  'GET /api/timetable/home': {
    group: 'timetable',
    description:
      'The caller’s own lessons and exams of this week from every branch, in time order, each with its branch; lessons in a branch the caller cannot read come as busy times only.',
  },
  'GET /api/timetable/lessons/:id/correction-teachers': {
    group: 'timetable',
    description:
      'The people who may be recorded as having taught one past lesson, for a correction of its teacher.',
  },
  'GET /api/timetable/lessons/:id/substitutes': {
    group: 'timetable',
    description:
      'The suggested substitute teachers of one dated lesson, in order of fit (subject, department, others), with warnings such as language.',
  },
  'GET /api/timetable/room-closures/:id/lessons': {
    group: 'timetable',
    description:
      'The lessons of a closed room that start inside one room closure, and whether each still needs another room.',
  },
  'GET /api/timetable/vacancies/:id/journals/:journalId/substitutes': {
    group: 'timetable',
    description:
      'The suggested substitutes for the lessons of one journal of a vacancy over a period, the vacancy’s acting teacher marked. Give the vacancy id, the journalId, from and optionally until (the first day without the substitute).',
  },
  'GET /api/timetable/versions/:id/compare': {
    group: 'timetable',
    description:
      'The differences between two timetable versions of the same year: load rows and lessons added, removed or changed. Give the version id and in with the other version’s id.',
  },
  'GET /api/timetable/versions/:id/grid': {
    group: 'timetable',
    description:
      'The weekly grid of a timetable version: its load rows, placed blocks with weekday, slot and rooms, the pins, the locks and every rule result (conflicts and warnings) now. Read it before a change of the grid; a version that is not a draft is read only.',
  },
  'GET /api/timetable/versions/:id/load/teachers': {
    group: 'timetable',
    description:
      'The teachers and vacancies a load row of a version may take for a class or group and subject, the class’s Tutor first, and those excluded with the reason. Give subjectId and either classId or groupId.',
  },
  'GET /api/timetable/versions/:id/out-of-date': {
    group: 'timetable',
    description:
      'Why a draft is marked out of date and the differences to pick from before bringing it up to date, with the key a bring-up-to-date sends back.',
  },
  'GET /api/timetable/versions/:id/publish-check': {
    group: 'timetable',
    description:
      'What a publish of a draft on a start date would refuse and warn, written nowhere: the dates offered, the refusals, the transition week, the later versions, the one-day changes that need a decision, and the keys a publish sends back. Give startsOn and, when later versions exist, chain (run_until, replace or carry).',
  },
  'GET /api/timetable/versions/:id/readiness': {
    group: 'timetable',
    description:
      'The readiness of steps 1 to 5 of the draft builder: the day templates per weekday and grade, the teaching load, the teachers, the rooms, the preference weights and pinned lessons (with their ids), and the grid’s error count.',
  },
  'GET /api/timetable/versions/:id/totals': {
    group: 'timetable',
    description:
      'The weekly totals of a version: lessons in the load against lesson slots per class, and per teacher the lessons here, free slots, other branches and the contract load.',
  },
  'GET /api/timetable/versions/:id/withdraw-check': {
    group: 'timetable',
    description:
      'What a withdraw of a published version before its start would do, written nowhere: the version that runs again, the blocked conflicts, the one-day changes that need a decision, and the key a withdraw sends back.',
  },

  // Files, exports and downloads (no tool before task 11.22).
  'GET /api/timetable/versions/:id/load/import-template': {
    kind: 'download',
    group: 'timetable',
    description:
      'The Excel template of a draft’s teaching load import, with the branch’s records, in a language.',
  },
  'GET /api/timetable/versions/:id/pattern/import-template': {
    kind: 'download',
    group: 'timetable',
    description:
      'The Excel template of a draft’s timetable import, with the branch’s records, in a language.',
  },
  'POST /api/timetable/reports/load/export': {
    kind: 'download',
    group: 'timetable',
    description: 'The teaching load report as an Excel file, logged.',
  },
  'POST /api/timetable/versions/:id/export': {
    kind: 'download',
    group: 'timetable',
    description:
      'Print, PDF or Excel of a version’s weekly timetable (the school, a class, a teacher or a room), logged.',
  },
  'POST /api/timetable/views/export': {
    kind: 'download',
    group: 'timetable',
    description:
      'Print, PDF or Excel of one timetable view (the school, a class, a teacher or a room, a day or a week) in the caller’s scope, logged.',
  },
  'PUT /api/timetable/versions/:id/load/imports': {
    kind: 'file',
    group: 'timetable',
    description:
      'Uploads a filled teaching load template into a draft; the rows are kept and their preview answered.',
  },
  'PUT /api/timetable/versions/:id/pattern/imports': {
    kind: 'file',
    group: 'timetable',
    description:
      'Uploads a filled timetable template into a draft; the rows are kept and their preview answered.',
  },

  // Previews and checks.
  [ACTING_CHECK]: {
    kind: 'preview',
    group: 'timetable',
    description:
      'Check of naming an acting teacher for a vacancy’s journal: what refuses it and whether the person does not teach in the class’s language.',
  },
  [FILL_CHECK]: {
    kind: 'preview',
    group: 'timetable',
    description:
      'Check of a vacancy fill: which rows the person takes or leave with the vacancy and why, the rows key, and the publish it makes with its keys and decisions.',
  },
  [LOAD_IMPORT_PREVIEW.route]: {
    kind: 'preview',
    group: 'timetable',
    description: 'Preview of an uploaded teaching load import: its rows and their problems.',
  },
  [PATTERN_IMPORT_PREVIEW.route]: {
    kind: 'preview',
    group: 'timetable',
    description:
      'Preview of an uploaded timetable import: its rows, problems, warnings and the lessons of the draft it removes.',
  },

  // Drafts and versions.
  'POST /api/timetable/versions': {
    kind: 'change',
    group: 'timetable',
    description:
      'Starts a new draft timetable version of an academic year with an intended start date, optionally copying a version of the same year (copyFrom).',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/timetable/versions/:id': {
    kind: 'change',
    group: 'timetable',
    description: `Changes a draft’s start date, or dismisses the rows a copy left (dismissLeftRows). ${DRAFT_NOTE}`,
    basis: VERSION_BASIS,
  },
  'POST /api/timetable/versions/:id/edit-lock': {
    kind: 'change',
    group: 'timetable',
    description:
      'Takes the edit lock of a draft ("Take over"); refused while another person was active on it in the last 5 minutes.',
    basis: readById(VERSIONS),
  },
  'POST /api/timetable/versions/:id/up-to-date': {
    kind: 'change',
    group: 'timetable',
    description:
      'Brings a draft marked out of date up to date. Read the out-of-date answer first; send its key and a pick (the item and the side) for every difference it lists.',
    basis: { kind: 'own' },
    outdatedCodes: ['out_of_date_changed'],
  },
  'POST /api/timetable/versions/:id/publish': {
    kind: 'change',
    group: 'timetable',
    description:
      'Publishes a draft from a start date. Run the publish check on that date first; send the transitionKey, chain and laterKey, dayChangesKey and a choice for each one-day change that needs a decision, as the check answered them.',
    basis: { kind: 'own' },
    outdatedCodes: ['publish_blocked'],
  },
  'POST /api/timetable/versions/:id/withdraw': {
    kind: 'change',
    group: 'timetable',
    description:
      'Withdraws a published version before its start. Read the withdraw check first; send its dayChangesKey and a choice for each one-day change that needs a decision.',
    basis: { kind: 'own' },
    outdatedCodes: ['withdraw_blocked'],
  },
  'PUT /api/timetable/versions/:id/day-keeps': {
    kind: 'change',
    group: 'timetable',
    description: `Chooses the lessons a class keeps on a shortened day of a draft: the classId, the date and the slot positions kept (an empty list removes the choice), as the publish check lists the shortened days. ${DRAFT_NOTE}`,
    basis: { kind: 'create' },
    records: ['body:classId'],
  },

  // Builder steps 1 and 5.
  'POST /api/timetable/versions/:id/templates/confirm': {
    kind: 'change',
    group: 'timetable',
    description: `Confirms the table of day templates per weekday and grade of a draft (builder step 1), as the readiness read shows it. ${DRAFT_NOTE}`,
    basis: WHOLE_READINESS,
  },
  'PUT /api/timetable/versions/:id/preferences': {
    kind: 'change',
    group: 'timetable',
    description: `Saves the eight preference weights of a draft (builder step 5); give every weight. ${DRAFT_NOTE}`,
    basis: WHOLE_READINESS,
  },
  'POST /api/timetable/versions/:id/rules/confirm': {
    kind: 'change',
    group: 'timetable',
    description: `Confirms the rules of a draft (builder step 5): send the weights and the ids of the pins exactly as the readiness read answered them. ${DRAFT_NOTE}`,
    basis: { kind: 'own' },
    outdatedCodes: ['preferences_changed', 'pins_changed'],
  },
  'POST /api/timetable/versions/:id/pins': {
    kind: 'change',
    group: 'timetable',
    description: `Pins a lesson of a draft: a loadRowId, a weekday and the slot position of the day template (breaks counted). ${DRAFT_NOTE}`,
    basis: { kind: 'create' },
    records: [],
  },
  'DELETE /api/timetable/versions/:id/pins/:pinId': {
    kind: 'change',
    group: 'timetable',
    description: `Removes a pinned lesson of a draft, by the pin id of the readiness read. ${DRAFT_NOTE}`,
    basis: { kind: 'read', route: READINESS, args: { id }, pick: { value: 'path:pinId' } },
    records: ['path:pinId'],
  },

  // The grid (builder step 7).
  'POST /api/timetable/versions/:id/locks': {
    kind: 'change',
    group: 'timetable',
    description: `Locks a lesson (by its blockId), a class, a teacher or a weekday of a draft, so that "Suggest a place" and the generator leave it where it is. ${DRAFT_NOTE}`,
    basis: { kind: 'create' },
    records: [],
  },
  'DELETE /api/timetable/versions/:id/locks/:lockId': {
    kind: 'change',
    group: 'timetable',
    description: `Removes a lock of a draft, by the lock id of the grid read. ${DRAFT_NOTE}`,
    basis: inGrid('path:lockId'),
    records: ['path:lockId'],
  },
  'POST /api/timetable/versions/:id/pattern': {
    kind: 'change',
    group: 'timetable',
    description: `Places a load row of a draft at a weekday and slot position with its whole block, optionally with a room, as a double lesson, or paired with a partner row; a blocked rule refuses it (pattern_blocked). ${DRAFT_NOTE}`,
    basis: { kind: 'create' },
    records: [],
  },
  'POST /api/timetable/versions/:id/pattern/:blockId/move': {
    kind: 'change',
    group: 'timetable',
    description: `Moves a block of a draft’s grid whole to a weekday and slot position; a blocked rule refuses it. ${DRAFT_NOTE}`,
    basis: inGrid('path:blockId'),
    records: ['path:blockId'],
  },
  'POST /api/timetable/versions/:id/pattern/:blockId/room': {
    kind: 'change',
    group: 'timetable',
    description: `Changes the room of one lesson (lessonId) of a block of a draft’s grid; a blocked rule refuses it. ${DRAFT_NOTE}`,
    basis: inGrid('path:blockId'),
    records: ['path:blockId'],
  },
  'DELETE /api/timetable/versions/:id/pattern/:blockId': {
    kind: 'change',
    group: 'timetable',
    description: `Removes a block of a draft’s grid with its lessons. ${DRAFT_NOTE}`,
    basis: inGrid('path:blockId'),
    records: ['path:blockId'],
  },
  'POST /api/timetable/versions/:id/pattern/swap': {
    kind: 'change',
    group: 'timetable',
    description: `Swaps the slots of two blocks of a draft’s grid, checked as one change. ${DRAFT_NOTE}`,
    basis: WHOLE_GRID,
    records: [],
  },
  'POST /api/timetable/versions/:id/pattern/rearrange': {
    kind: 'change',
    group: 'timetable',
    description: `Applies a rearrangement of one to three blocks of a draft’s grid, checked as one change: each a block moved or one new block of a load row placed, at a weekday and slot with its rooms. ${DRAFT_NOTE}`,
    basis: WHOLE_GRID,
    records: [],
  },

  // Imports into a draft.
  'POST /api/timetable/versions/:id/load/imports/:importId/confirm': {
    kind: 'change',
    group: 'timetable',
    description: `Adds every row of an uploaded teaching load import to the draft’s load, or nothing. ${DRAFT_NOTE}`,
    basis: { kind: 'own' },
    preview: LOAD_IMPORT_PREVIEW,
    outdatedCodes: ['load_import_changed'],
    records: ['path:importId'],
  },
  'POST /api/timetable/versions/:id/pattern/imports/:importId/confirm': {
    kind: 'change',
    group: 'timetable',
    description: `Replaces every placement of the draft by those of an uploaded timetable import, or nothing. Send in removes the ids of the draft’s lessons the preview lists as removed. ${DRAFT_NOTE}`,
    basis: { kind: 'own' },
    preview: PATTERN_IMPORT_PREVIEW,
    outdatedCodes: ['pattern_import_changed', 'pattern_import_draft_changed'],
    records: ['path:importId'],
  },

  // Changes of dated lessons.
  'POST /api/timetable/lessons/:id/correction': {
    kind: 'change',
    group: 'timetable',
    description:
      'Corrects one past lesson, with a reason: kind cancel, restore (optionally into a room), teacher (a person of the correction teachers read) or room.',
    basis: LESSON_BASIS,
  },
  'POST /api/timetable/lessons/:id/forced-delete': {
    kind: 'change',
    group: 'timetable',
    description:
      'Deletes one dated lesson for good, with a typed reason; its data is kept so the lesson can be restored.',
    basis: LESSON_BASIS,
  },

  // Room closures.
  'POST /api/timetable/room-closures': {
    kind: 'change',
    group: 'timetable',
    description: 'Closes a room from a first to a last day (from today on), with a reason.',
    basis: { kind: 'create' },
    records: [],
  },
  'PATCH /api/timetable/room-closures/:id': {
    kind: 'change',
    group: 'timetable',
    description:
      'Changes the first and last day of a room closure that has not ended; a closure that started keeps its first day.',
    basis: readById('GET /api/timetable/room-closures'),
  },
  'POST /api/timetable/room-closures/:id/withdraw': {
    kind: 'change',
    group: 'timetable',
    description: 'Withdraws a room closure that has not started.',
    basis: readById('GET /api/timetable/room-closures'),
  },
  'POST /api/timetable/room-closures/:id/move': {
    kind: 'change',
    group: 'timetable',
    description:
      'Moves every lesson of a closed room that still needs a room during the closure to another room, with a reason; nothing moves when one of them cannot go there.',
    basis: { kind: 'read', route: 'GET /api/timetable/room-closures/:id/lessons', args: { id } },
  },

  // Journal substitutes.
  'POST /api/timetable/absences/:id/journal-substitute': {
    kind: 'change',
    group: 'timetable',
    description:
      'Puts one substitute teacher on every lesson of one journal during a teacher absence, each date checked, with a reason. Read the journal’s suggested substitutes first and give the journalId and teacherId.',
    basis: {
      kind: 'read',
      route: 'GET /api/timetable/absences/:id/journals/:journalId/substitutes',
      args: { id, journalId: 'body:journalId' },
    },
    records: ['body:journalId'],
  },
  'POST /api/timetable/vacancies/:id/journal-substitute': {
    kind: 'change',
    group: 'timetable',
    description:
      'Puts one substitute teacher on the lessons of one journal of a vacancy over a period (from, until the first day without them), each date checked, with a reason. Read the journal’s suggested substitutes for the same period first.',
    basis: {
      kind: 'read',
      route: 'GET /api/timetable/vacancies/:id/journals/:journalId/substitutes',
      args: { id, journalId: 'body:journalId', from: 'body:from', until: 'body:until' },
    },
    records: ['body:journalId'],
  },

  // Vacancies: acting teachers and fills.
  'POST /api/timetable/acting-teachers': {
    kind: 'change',
    group: 'timetable',
    description:
      'Names an acting teacher for a journal of a vacancy from a date, optionally until a date. Set confirmLanguage only to accept the language warning the check showed.',
    basis: { kind: 'create' },
    preview: { route: ACTING_CHECK, body: (body) => withoutKeys(body, ['confirmLanguage']) },
    records: ['body:journalId'],
    keepsFlags: ['confirmLanguage'],
  },
  'POST /api/timetable/acting-teachers/:id/end': {
    kind: 'change',
    group: 'timetable',
    description:
      'Ends an acting teacher’s period on a day (until: the first day the person no longer owns the journal), or withdraws a planned period by giving its start.',
    basis: { kind: 'own' },
    outdatedCodes: ['acting_ended', 'acting_started'],
  },
  'POST /api/timetable/vacancy-fills': {
    kind: 'change',
    group: 'timetable',
    description:
      'Fills a vacancy with a person from a date, for all its rows or the chosen ones; this publishes a timetable version. Run the check first and send its rowsKey and the publish keys and decisions it answers.',
    basis: { kind: 'own' },
    preview: {
      route: FILL_CHECK,
      body: (body) => pickKeys(body, ['vacancyId', 'personId', 'startsOn', 'rows']),
    },
    outdatedCodes: ['fill_rows_changed'],
    records: ['body:vacancyId'],
  },
};
