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
] as const;

export const planRequestCauseSchema = z.enum(PLAN_REQUEST_CAUSES);

export type PlanRequestCause = z.infer<typeof planRequestCauseSchema>;

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
  /** The reader owns the plan and the year is open. */
  canEdit: z.boolean(),
  closed: z.boolean(),
  rows: z.array(planRowSchema),
  /** Task 7.1b: the items past the last row, attached to no lesson ("not covered"). */
  notCovered: z.array(planItemSchema),
  /** Task 7.1b: the edit request the system prepared, until 7.2 sends it. */
  request: z
    .object({
      fromDate: schoolDateSchema,
      causes: z.array(
        z.object({
          kind: planRequestCauseSchema,
          onDate: schoolDateSchema,
          items: z.int().min(0),
        }),
      ),
    })
    .nullable(),
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
