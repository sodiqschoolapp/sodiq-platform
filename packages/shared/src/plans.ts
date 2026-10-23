import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { subjectColourSchema } from './subjects.js';

/**
 * Lesson plans and their items (task 7.1a, pull request #212; `09`, What a
 * plan contains; `edge/lesson-plans`). A plan is kept per journal and
 * quarter; its rows are the dated lessons of the quarter that are not
 * cancelled, numbered by position (edge: "The number is the position among
 * lessons that are not cancelled"); an item stands at a position of the
 * plan's queue and fills that row. The bounds are the checks of 0114.
 */

/** Decision 7: the spec bounds only the work's title. */
export const PLAN_TOPIC_MAX_LENGTH = 300;
export const PLAN_OBJECTIVES_MAX_LENGTH = 2000;
/** `edge/lesson-plans`: "a short title of at most 60 characters, used as the column title". */
export const PLAN_WORK_TITLE_MAX_LENGTH = 60;
export const PLAN_WORK_DESCRIPTION_MAX_LENGTH = 1000;
/** Build plan 7.1a: "any number of classworks and homeworks (at most 10 of each)". */
export const PLAN_WORKS_MAX = 10;
export const PLAN_LINKS_MAX = 10;
export const PLAN_LINK_MAX_LENGTH = 500;
/** `edge/lesson-plans`: "Limits: 20 MB per file, 10 files per item, a fixed list of file types". */
export const PLAN_FILES_MAX = 10;
/** 20 MB read as decimal, as the photos' 5 MB (decision 3). */
export const PLAN_FILE_MAX_BYTES = 20_000_000;
export const PLAN_FILE_NAME_MAX_LENGTH = 200;

/** The fixed list of file types (decision 3), with the extension each is saved under. */
export const PLAN_FILE_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'audio/mpeg',
  'video/mp4',
] as const;

export const planFileTypeSchema = z.enum(PLAN_FILE_TYPES);

export type PlanFileType = z.infer<typeof planFileTypeSchema>;

export const PLAN_FILE_EXTENSIONS: Readonly<Record<PlanFileType, string>> = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'audio/mpeg': 'mp3',
  'video/mp4': 'mp4',
};

/** Not blank, at most `max` characters, as the checks `length(btrim(x)) >= 1 and length(x) <= max`. */
const filledText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((value) => value.trim().length > 0, { message: 'Fill in this field.' });

/** A web address as `lesson_plan_links_valid` takes it: `http://` or `https://`, no blank. */
export const planLinkSchema = z
  .string()
  .max(PLAN_LINK_MAX_LENGTH)
  .regex(/^https?:\/\/[^\s]+$/);

/** A classwork or homework as typed: `id` names a work the item already has (its identity is kept). */
export const planWorkInputSchema = z.strictObject({
  id: z.uuid().optional(),
  title: filledText(PLAN_WORK_TITLE_MAX_LENGTH),
  description: z.string().max(PLAN_WORK_DESCRIPTION_MAX_LENGTH),
});

export type PlanWorkInput = z.infer<typeof planWorkInputSchema>;

/** What the owner types into a row (`09`, What a plan contains). */
export const planItemValuesSchema = z.strictObject({
  topic: filledText(PLAN_TOPIC_MAX_LENGTH),
  objectives: z.string().max(PLAN_OBJECTIVES_MAX_LENGTH),
  links: z.array(planLinkSchema).max(PLAN_LINKS_MAX),
  classworks: z.array(planWorkInputSchema).max(PLAN_WORKS_MAX),
  homeworks: z.array(planWorkInputSchema).max(PLAN_WORKS_MAX),
});

export type PlanItemValues = z.infer<typeof planItemValuesSchema>;

/** A work as the item holds it. */
export const planWorkSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
});

export type PlanWork = z.infer<typeof planWorkSchema>;

/**
 * The values a save was based on (decision 9, correction 3): every field of
 * the item as the page read it. A field whose sent value equals its base is
 * not touched by the save.
 */
export const planItemBaseSchema = z.strictObject({
  topic: z.string(),
  objectives: z.string(),
  links: z.array(z.string()),
  classworks: z.array(planWorkSchema.strict()),
  homeworks: z.array(planWorkSchema.strict()),
});

export type PlanItemBase = z.infer<typeof planItemBaseSchema>;

/** The works of a new item have no id yet: a field the path has no use for is refused. */
const planNewWorkSchema = planWorkInputSchema.omit({ id: true });

/** What the owner types into an empty row. */
export const planNewItemValuesSchema = planItemValuesSchema.extend({
  classworks: z.array(planNewWorkSchema).max(PLAN_WORKS_MAX),
  homeworks: z.array(planNewWorkSchema).max(PLAN_WORKS_MAX),
});

export type PlanNewItemValues = z.infer<typeof planNewItemValuesSchema>;

/** A new item at an empty row. */
export const planItemCreateSchema = z.strictObject({
  quarterId: z.uuid(),
  position: z.int().min(1),
  /**
   * Task 7.1b: the lesson of the row as the client read it; refused
   * `plan_row_moved` when another lesson stands at the position now
   * (`edge/lesson-plans`: "A plan is open in two tabs while a cancellation shifts it").
   */
  lessonId: z.uuid(),
  values: planNewItemValuesSchema,
});

export type PlanItemCreate = z.infer<typeof planItemCreateSchema>;

/** A save of an item, addressed to the item (edge: "A save is addressed to the item, not to the row"). */
export const planItemSaveSchema = z.strictObject({
  base: planItemBaseSchema,
  values: planItemValuesSchema,
});

export type PlanItemSave = z.infer<typeof planItemSaveSchema>;

export const planFileSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  type: planFileTypeSchema,
  bytes: z.int().min(1),
});

export type PlanFile = z.infer<typeof planFileSchema>;

export const planItemSchema = z.object({
  id: z.uuid(),
  position: z.int().min(1),
  topic: z.string(),
  objectives: z.string(),
  links: z.array(z.string()),
  classworks: z.array(planWorkSchema),
  homeworks: z.array(planWorkSchema),
  files: z.array(planFileSchema),
  /**
   * Task 7.1b: the date of the started lesson this item was moved back from
   * (`edge/lesson-plans`: "with a \"moved from [date]\" mark"), else `null`.
   */
  movedFrom: schoolDateSchema.nullable(),
  /**
   * Task 7.1c, decision 16: the plan the item was copied from (a copy or a
   * separation), whose history holds its earlier changes; `null` for an item
   * written here.
   */
  copiedFrom: z.object({ journalId: z.uuid(), quarterId: z.uuid() }).nullable(),
  /**
   * Task 7.2: the item of a lesson already held was changed through a request
   * (`09`: "it carries an \"edited after the lesson\" mark").
   */
  editedAfterLesson: z.boolean(),
});

export type PlanItem = z.infer<typeof planItemSchema>;

/** A row of the plan: a dated lesson not cancelled, with the item it holds. */
export const planRowSchema = z.object({
  /** The position among the quarter's lessons not cancelled, from 1. */
  number: z.int().min(1),
  lessonId: z.uuid(),
  date: schoolDateSchema,
  /** Clock minutes of the day in branch time. */
  start: z.int().min(0),
  end: z.int().min(1),
  slot: z.int().min(1).nullable(),
  /** `edge/00-definitions`, Held lesson, as the journal reads it. */
  held: z.boolean(),
  /** Task 7.2: the lesson's start has passed (the fixed part; a held row takes only Text). */
  started: z.boolean(),
  /** Task 7.2: what the reader may write on this row now (the window or an open period). */
  open: z.enum(['none', 'text', 'all']),
  item: planItemSchema.nullable(),
});

export type PlanRow = z.infer<typeof planRowSchema>;

const planUnitSchema = z.object({
  kind: z.enum(['class', 'group']),
  id: z.uuid(),
  name: z.string(),
});

const planSubjectSchema = z.object({
  id: z.uuid(),
  names: z.object({ uz: z.string(), ru: z.string(), en: z.string() }),
  colour: subjectColourSchema,
});

const planQuarterSchema = z.object({
  id: z.uuid(),
  number: z.int().min(1).max(4),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
});

/**
 * Why the system prepared an edit request (task 7.1b, decision 4; `09`,
 * "Requests prepared by the system": items not covered, empty rows after
 * lessons were added, a new teacher taking over; `edge/lesson-plans`: an
 * item moved back from a lesson cancelled after its date).
 */
export const PLAN_REQUEST_CAUSES = [
  'not_covered',
  'rows_added',
  'moved_back',
  'owner_changed',
  /** Task 7.2: a journal made after its quarter's window ended (`edge`: "a subject is added mid-quarter"). */
  'journal_added',
  /** Task 7.2: the plan was incomplete when the window ended (`edge`: "a request is prepared for every incomplete plan"). */
  'window_end',
] as const;

export const planRequestCauseSchema = z.enum(PLAN_REQUEST_CAUSES);

export type PlanRequestCause = z.infer<typeof planRequestCauseSchema>;

/** Task 7.2: where the window of a quarter stands for an owner. */
export const PLAN_WINDOW_STATES = ['not_opened', 'before', 'open', 'ended'] as const;

export type PlanWindowState = (typeof PLAN_WINDOW_STATES)[number];

/**
 * Task 7.2: `edge/lesson-plans`: "Such plans show \"window not opened\", not
 * \"overdue\""; `edge/timetable`: "the plan window lists it as \"vacancy\", not
 * as overdue against anyone".
 */
export const PLAN_FLAGS = ['overdue', 'window_not_opened', 'vacancy'] as const;

export type PlanFlag = (typeof PLAN_FLAGS)[number];

export const planParamsSchema = z.object({ journalId: z.uuid() });

export type PlanParams = z.infer<typeof planParamsSchema>;

/** Without a quarter: the quarter of today, or the nearest one of the year. */
export const planQuerySchema = z.strictObject({ quarterId: z.uuid().optional() });

export type PlanQuery = z.infer<typeof planQuerySchema>;

export const planSchema = z.object({
  journalId: z.uuid(),
  unit: planUnitSchema,
  subject: planSubjectSchema,
  quarters: z.array(planQuarterSchema),
  quarterId: z.uuid(),
  /** The owner's name on the quarter's reference date; `null` under a vacancy with no acting teacher. */
  owner: z.string().nullable(),
  /** Task 7.2: the staff record of that owner, for an extension of the window. */
  ownerStaffId: z.uuid().nullable(),
  /** The reader owns the plan and the year is open. */
  canEdit: z.boolean(),
  closed: z.boolean(),
  rows: z.array(planRowSchema),
  /** Task 7.1b: the items past the last row, attached to no lesson ("not covered"). */
  notCovered: z.array(planItemSchema),
  /**
   * Task 7.1b: the edit request the system prepared; task 7.2: `id` is
   * `null` for the request worked out at the window's end and not stored yet.
   */
  request: z
    .object({
      id: z.uuid().nullable(),
      fromDate: schoolDateSchema.nullable(),
      /** The started rows with no topic, for Text (review correction 2). */
      lessons: z.array(z.object({ lessonId: z.uuid(), date: schoolDateSchema })),
      causes: z.array(
        z.object({
          kind: planRequestCauseSchema,
          onDate: schoolDateSchema,
          items: z.int().min(0),
        }),
      ),
    })
    .nullable(),
  /** Task 7.2: the window of the quarter for the plan's owner. */
  window: z.object({
    state: z.enum(PLAN_WINDOW_STATES),
    startDate: schoolDateSchema.nullable(),
    /** The last day in force for the owner (an extension included). */
    endDate: schoolDateSchema.nullable(),
  }),
  /** Task 7.2: overdue, window not opened, or vacancy; `null` otherwise. */
  flag: z.enum(PLAN_FLAGS).nullable(),
  /** Task 7.2: the requests of this plan and journal not prepared, newest first. */
  requests: z.array(z.lazy(() => planRequestSchema)),
  /**
   * Task 7.1c: the other classes or groups of a shared plan and where each
   * stands (`09`: "The plan screen shows where each class is"): its next
   * lesson not yet held, with the item there, and its items not covered.
   */
  sharedWith: z.array(
    z.object({
      journalId: z.uuid(),
      unit: planUnitSchema,
      next: z
        .object({
          number: z.int().min(1),
          date: schoolDateSchema,
          topic: z.string().nullable(),
        })
        .nullable(),
      notCovered: z.int().min(0),
    }),
  ),
  /** Task 7.1c: the reader's own journals that may join this plan (same subject, kind, grades and language). */
  shareCandidates: z.array(z.object({ journalId: z.uuid(), unit: planUnitSchema })),
});

export type Plan = z.infer<typeof planSchema>;

/** Task 7.1c: one more journal joins the plan of the path's journal. */
export const planShareSchema = z.strictObject({
  quarterId: z.uuid(),
  journalId: z.uuid(),
});

export type PlanShare = z.infer<typeof planShareSchema>;

/** Task 7.1c: the path's journal leaves its shared plan with a copy of the items. */
export const planSeparateSchema = z.strictObject({ quarterId: z.uuid() });

export type PlanSeparate = z.infer<typeof planSeparateSchema>;

/**
 * Task 7.1c: the items of another plan copied into an empty plan (`09`: "A
 * plan can be copied from another class, from another teacher of the same
 * subject and grade, or from last year"); `remaining` copies only the items
 * of lessons not yet held (`edge/lesson-plans`: "Only its remaining items are
 * attached").
 */
export const PLAN_COPY_PARTS = ['all', 'remaining'] as const;

export const planCopySchema = z.strictObject({
  quarterId: z.uuid(),
  source: z.strictObject({ journalId: z.uuid(), quarterId: z.uuid() }),
  part: z.enum(PLAN_COPY_PARTS),
});

export type PlanCopy = z.infer<typeof planCopySchema>;

/** The state of a plan in a quarter (`09`: "A plan is complete when every lesson of the quarter has a topic"). */
export const PLAN_STATES = ['not_started', 'incomplete', 'complete', 'no_lessons'] as const;

export type PlanState = (typeof PLAN_STATES)[number];

export const planListQuerySchema = z.strictObject({ yearId: z.uuid().optional() });

export type PlanListQuery = z.infer<typeof planListQuerySchema>;

export const planListSchema = z.object({
  years: z.array(
    z.object({
      id: z.uuid(),
      startDate: schoolDateSchema,
      endDate: schoolDateSchema,
      closed: z.boolean(),
    }),
  ),
  yearId: z.uuid().nullable(),
  quarters: z.array(planQuarterSchema),
  plans: z.array(
    z.object({
      journalId: z.uuid(),
      unit: planUnitSchema,
      subject: planSubjectSchema,
      /** In the order of `quarters`. */
      quarters: z.array(
        z.object({
          quarterId: z.uuid(),
          state: z.enum(PLAN_STATES),
          rows: z.int().min(0),
          /** Rows without a topic. */
          empty: z.int().min(0),
          /** Task 7.2. */
          flag: z.enum(PLAN_FLAGS).nullable(),
        }),
      ),
    }),
  ),
});

export type PlanList = z.infer<typeof planListSchema>;

export const planItemParamsSchema = z.object({ itemId: z.uuid() });

export type PlanItemParams = z.infer<typeof planItemParamsSchema>;

export const planFileParamsSchema = z.object({ fileId: z.uuid() });

export type PlanFileParams = z.infer<typeof planFileParamsSchema>;

/** The file's name travels in the query: the body is the file itself. */
export const planFileUploadQuerySchema = z.strictObject({
  name: filledText(PLAN_FILE_NAME_MAX_LENGTH),
});

export type PlanFileUploadQuery = z.infer<typeof planFileUploadQuerySchema>;

/** Task 7.1b: the item of one lesson (a reader of the plan, or the substitute of that lesson). */
export const planLessonParamsSchema = z.object({ lessonId: z.uuid() });

export type PlanLessonParams = z.infer<typeof planLessonParamsSchema>;

export const planLessonItemSchema = z.object({
  lessonId: z.uuid(),
  journalId: z.uuid(),
  date: schoolDateSchema,
  /** The row number of the lesson; `null` for a cancelled lesson. */
  number: z.int().min(1).nullable(),
  subject: planSubjectSchema,
  unit: planUnitSchema,
  item: planItemSchema.nullable(),
});

export type PlanLessonItem = z.infer<typeof planLessonItemSchema>;

/**
 * Task 7.1b: what a timetable change does to one plan, shown by the impact
 * previews (`edge/lesson-plans`: "The impact preview shows, per plan, items
 * that no longer fit and rows left empty").
 */
export const planImpactSchema = z.object({
  journalId: z.uuid(),
  unit: z.string(),
  subject: planSubjectSchema,
  quarter: z.int().min(1).max(4),
  /** The items moved to another lesson. */
  moved: z.int().min(0),
  /** The topics of the items that no longer fit ("not covered"). */
  notFitting: z.array(z.string()),
  /** The rows not started that hold no item after the change. */
  emptyRows: z.int().min(0),
});

export type PlanImpact = z.infer<typeof planImpactSchema>;

// ---------------------------------------------------------------------------
// Task 7.2: the plan window and edit requests (pull request #215).

/** The windows of a year (`09`, The plan window). */
export const planWindowsQuerySchema = z.strictObject({ yearId: z.uuid().optional() });

export type PlanWindowsQuery = z.infer<typeof planWindowsQuerySchema>;

export const planWindowsSchema = z.object({
  yearId: z.uuid().nullable(),
  /** The reader may open, change and extend (the Academic Vice Principal, the Super Admin). */
  canEdit: z.boolean(),
  quarters: z.array(
    z.object({
      quarter: planQuarterSchema,
      /** Every school day of the quarter lies in a published version (review decision 9). */
      published: z.boolean(),
      window: z
        .object({
          startDate: schoolDateSchema,
          endDate: schoolDateSchema,
          state: z.enum(PLAN_WINDOW_STATES),
          extensions: z.array(
            z.object({ staffId: z.uuid(), name: z.string(), endDate: schoolDateSchema }),
          ),
        })
        .nullable(),
    }),
  ),
});

export type PlanWindows = z.infer<typeof planWindowsSchema>;

export const planWindowParamsSchema = z.object({ quarterId: z.uuid() });

export type PlanWindowParams = z.infer<typeof planWindowParamsSchema>;

/**
 * Open a window or move its dates (`edge`: "If it ends after the quarter's
 * first lesson, the system shows how many lessons will be held without a
 * plan and asks for confirmation").
 */
export const planWindowSaveSchema = z.strictObject({
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  confirm: z.boolean().optional(),
});

export type PlanWindowSave = z.infer<typeof planWindowSaveSchema>;

/** `09`: "The Academic Vice Principal can extend the window for one teacher". */
export const planWindowExtendSchema = z.strictObject({
  staffId: z.uuid(),
  endDate: schoolDateSchema,
});

export type PlanWindowExtend = z.infer<typeof planWindowExtendSchema>;

export const PLAN_REQUEST_KINDS = ['text', 'replan', 'extension'] as const;

export const PLAN_REQUEST_STATUSES = ['prepared', 'sent', 'approved', 'refused', 'void'] as const;

export const PLAN_REQUEST_REASON_MAX_LENGTH = 1000;

/** `edge`: "The days are school days, from 1 to 10." */
export const PLAN_REQUEST_DAYS_MIN = 1;
export const PLAN_REQUEST_DAYS_MAX = 10;

const reasonSchema = z.string().max(PLAN_REQUEST_REASON_MAX_LENGTH);

const requiredReasonSchema = reasonSchema.refine((value) => value.trim().length > 0, {
  message: 'A reason is required.',
});

export const planRequestSchema = z.object({
  id: z.uuid(),
  journalId: z.uuid(),
  quarterId: z.uuid(),
  quarter: z.int().min(1).max(4),
  unit: planUnitSchema,
  subject: planSubjectSchema,
  /** The plan's owner now; `null` under a vacancy with nobody acting. */
  owner: z.string().nullable(),
  kind: z.enum(PLAN_REQUEST_KINDS),
  status: z.enum(PLAN_REQUEST_STATUSES),
  fromDate: schoolDateSchema.nullable(),
  lessons: z.array(
    z.object({
      lessonId: z.uuid(),
      date: schoolDateSchema,
      approved: z.boolean(),
      untickReason: z.string(),
    }),
  ),
  reason: z.string(),
  causes: z.array(
    z.object({
      kind: planRequestCauseSchema,
      onDate: schoolDateSchema,
      items: z.int().min(0),
      eventId: z.uuid(),
    }),
  ),
  sentAt: z.iso.datetime({ offset: true }).nullable(),
  decidedBy: z.string().nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  decisionReason: z.string(),
  days: z.int().min(1).max(10).nullable(),
  openUntil: z.iso.datetime({ offset: true }).nullable(),
  /** The period is open now. */
  open: z.boolean(),
  finishedAt: z.iso.datetime({ offset: true }).nullable(),
  /** School days a sent request has waited (`edge`: "one unanswered for 2 school days is highlighted"). */
  waitingDays: z.int().min(0),
  late: z.boolean(),
  /** The reader may decide it now. */
  canDecide: z.boolean(),
});

export type PlanRequest = z.infer<typeof planRequestSchema>;

export const PLAN_REQUEST_VIEWS = ['mine', 'deciding'] as const;

export const planRequestsQuerySchema = z.strictObject({
  view: z.enum(PLAN_REQUEST_VIEWS),
  yearId: z.uuid().optional(),
});

export type PlanRequestsQuery = z.infer<typeof planRequestsQuerySchema>;

export const planRequestsSchema = z.object({
  requests: z.array(planRequestSchema),
  /** The events of the waiting requests the reader may decide (`09`, Approving together). */
  events: z.array(
    z.object({
      eventId: z.uuid(),
      at: z.iso.datetime({ offset: true }),
      requests: z.int().min(1),
      subjects: z.array(planSubjectSchema),
    }),
  ),
});

export type PlanRequests = z.infer<typeof planRequestsSchema>;

/** `09`: "The teacher sends an edit request: which lessons, and the reason." */
export const planRequestCreateSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('text'),
    quarterId: z.uuid(),
    lessonIds: z.array(z.uuid()).min(1).max(200),
    reason: requiredReasonSchema,
  }),
  z.strictObject({
    kind: z.literal('replan'),
    quarterId: z.uuid(),
    fromLessonId: z.uuid(),
    reason: requiredReasonSchema,
  }),
]);

export type PlanRequestCreate = z.infer<typeof planRequestCreateSchema>;

export const planRequestParamsSchema = z.object({ requestId: z.uuid() });

export type PlanRequestParams = z.infer<typeof planRequestParamsSchema>;

/** A prepared request sent as it is ("The teacher only sends it"), with an optional note. */
export const planRequestSendSchema = z.strictObject({ reason: reasonSchema.optional() });

export type PlanRequestSend = z.infer<typeof planRequestSendSchema>;

/**
 * `edge`: "The days are school days, from 1 to 10. The approver can untick
 * lessons, giving a reason. A refusal changes nothing and the teacher may ask
 * again." Unticking a Re-plan is a later first lesson (review decision 10).
 */
export const planRequestDecisionSchema = z.discriminatedUnion('decision', [
  z.strictObject({
    decision: z.literal('approve'),
    days: z.int().min(PLAN_REQUEST_DAYS_MIN).max(PLAN_REQUEST_DAYS_MAX),
    untick: z
      .array(z.strictObject({ lessonId: z.uuid(), reason: requiredReasonSchema }))
      .max(200)
      .optional(),
    later: z.strictObject({ fromLessonId: z.uuid(), reason: requiredReasonSchema }).optional(),
  }),
  z.strictObject({ decision: z.literal('refuse'), reason: requiredReasonSchema }),
]);

export type PlanRequestDecision = z.infer<typeof planRequestDecisionSchema>;

/** The request worked out at the window's end, stored by the owner's send. */
export const planPreparedSendSchema = z.strictObject({
  quarterId: z.uuid(),
  reason: reasonSchema.optional(),
});

export type PlanPreparedSend = z.infer<typeof planPreparedSendSchema>;

/** The same request stored and decided by an approver ("can approve it without waiting"). */
export const planPreparedDecisionSchema = z.strictObject({
  quarterId: z.uuid(),
  decision: planRequestDecisionSchema,
});

export type PlanPreparedDecision = z.infer<typeof planPreparedDecisionSchema>;

/** `09`, Approving together: "approve all requests caused by one event ... and set the number of days once". */
export const planEventDecisionSchema = z.strictObject({
  eventId: z.uuid(),
  subjectId: z.uuid().optional(),
  days: z.int().min(PLAN_REQUEST_DAYS_MIN).max(PLAN_REQUEST_DAYS_MAX),
});

export type PlanEventDecision = z.infer<typeof planEventDecisionSchema>;

export const planEventDecidedSchema = z.object({
  approved: z.array(z.uuid()),
  /** The waiting requests of the event the reader may not decide: their own, or of a closed quarter. */
  skipped: z.array(z.uuid()),
  /**
   * The waiting requests of the event the reader does not oversee (another
   * subject), counted and not named: `02`, a Head Teacher's scope is "own
   * subjects in own branch" (review of the code of task 7.2, round 1).
   */
  others: z.int().min(0),
});

export type PlanEventDecided = z.infer<typeof planEventDecidedSchema>;

/**
 * The queue edit (review decision 6; `edge`: "Re-plan ... allows insert,
 * delete, merge and reorder"): the order of the items from the first row not
 * started, `null` for an empty row; an item left out is cleared. `base` is
 * the order as the page read it.
 */
export const planQueueSchema = z.strictObject({
  quarterId: z.uuid(),
  base: z.array(z.uuid().nullable()).max(400),
  order: z.array(z.uuid().nullable()).max(400),
});

export type PlanQueue = z.infer<typeof planQueueSchema>;
