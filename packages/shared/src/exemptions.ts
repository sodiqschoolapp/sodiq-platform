import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { accountNamedSchema } from './reset-entries.js';

/**
 * Exemptions (task 8.5, pull request #223; `07`, Exemptions; `edge/exemptions`).
 * The records are `exemptions` (0123); the database keeps the overlap rule,
 * the shape of a slot exemption, the year's end and what changes after the
 * start, and these schemas are never wider than its checks.
 */

export const EXEMPTION_KINDS = ['temporary', 'full'] as const;

export const exemptionKindSchema = z.enum(EXEMPTION_KINDS);

export type ExemptionKind = z.infer<typeof exemptionKindSchema>;

/** `edge/exemptions`, the diagnosis row: "The reason is a category (illness, competition, family, school event, other)". */
export const EXEMPTION_CATEGORIES = [
  'illness',
  'competition',
  'family',
  'school_event',
  'other',
] as const;

export const exemptionCategorySchema = z.enum(EXEMPTION_CATEGORIES);

export type ExemptionCategory = z.infer<typeof exemptionCategorySchema>;

/** The detail of the reason (decision 18), as `exemptions_detail_check`. */
export const EXEMPTION_DETAIL_MAX = 1000;

/** The reason of a void, as `exemptions_void_reason_check`. */
export const EXEMPTION_VOID_REASON_MAX = 500;

/** One form's students (decision 19: "forty certificates arrive"). */
export const EXEMPTION_BATCH_MAX = 60;

/** The chosen subjects of one exemption. */
export const EXEMPTION_SUBJECTS_MAX = 30;

/** The late-entry choices of one call: a batch of 60 over a long range. */
export const EXEMPTION_CHOICES_MAX = 5000;

/** The document (decision 17): PDF, JPEG or PNG, up to 10 MB; the reason of absence's file the same. */
export const EXEMPTION_FILE_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;

export const EXEMPTION_FILE_MAX_BYTES = 10_000_000;

export const EXEMPTION_FILE_NAME_MAX_LENGTH = 200;

const clockTimeSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

const trimmed = (max: number) => z.string().trim().min(1).max(max);

/** A slot exemption's time on its one day, local branch time (decision 4). */
export const exemptionSlotsSchema = z
  .strictObject({ start: clockTimeSchema, end: clockTimeSchema })
  .refine((value) => value.start < value.end, {
    message: 'The end comes after the start.',
    path: ['end'],
  });

export type ExemptionSlots = z.infer<typeof exemptionSlotsSchema>;

/**
 * The choice for a lesson in the range that holds a "present" or "late" mark
 * or a number (`07`, Problem cases): leave it as attended (the exemption skips
 * it) or exempt it and clear the numbers.
 */
export const exemptionChoiceSchema = z.strictObject({
  studentId: z.uuid(),
  lessonId: z.uuid(),
  choice: z.enum(['keep', 'exempt']),
});

export type ExemptionChoice = z.infer<typeof exemptionChoiceSchema>;

const choicesSchema = z
  .array(exemptionChoiceSchema)
  .max(EXEMPTION_CHOICES_MAX)
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.forEach((one, index) => {
      const key = `${one.studentId.toLowerCase()}|${one.lessonId.toLowerCase()}`;
      if (seen.has(key)) {
        context.addIssue({
          code: 'custom',
          path: [index, 'lessonId'],
          message: 'One choice per student and lesson.',
        });
      }
      seen.add(key);
    });
  });

/** What an exemption covers: its kind, scope, dates or slots, and its reason. */
const exemptionFieldsShape = {
  kind: exemptionKindSchema,
  /** Null for all subjects. */
  subjectIds: z.array(z.uuid()).min(1).max(EXEMPTION_SUBJECTS_MAX).nullable(),
  startDate: schoolDateSchema,
  /** The last day; for a full exemption the server writes the year's last day and this is null. */
  endDate: schoolDateSchema.nullable(),
  /** Chosen slots of one day: then `endDate` equals `startDate`. */
  slots: exemptionSlotsSchema.nullable(),
  category: exemptionCategorySchema,
  detail: trimmed(EXEMPTION_DETAIL_MAX),
};

type FieldsValue = {
  kind: ExemptionKind;
  subjectIds: string[] | null;
  startDate: string;
  endDate: string | null;
  slots: ExemptionSlots | null;
};

function checkFields(value: FieldsValue, context: z.RefinementCtx): void {
  if (value.kind === 'full' && value.endDate !== null) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'A full exemption runs to the end of the academic year.',
    });
  }
  if (value.kind === 'temporary' && value.endDate === null) {
    context.addIssue({ code: 'custom', path: ['endDate'], message: 'The last day is required.' });
  }
  if (value.endDate !== null && value.endDate < value.startDate) {
    context.addIssue({
      code: 'custom',
      path: ['endDate'],
      message: 'The last day is not before the first.',
    });
  }
  if (value.slots !== null) {
    if (value.kind === 'full') {
      context.addIssue({
        code: 'custom',
        path: ['slots'],
        message: 'A full exemption is always whole days.',
      });
    }
    if (value.subjectIds !== null) {
      context.addIssue({
        code: 'custom',
        path: ['subjectIds'],
        message: 'An exemption for chosen slots covers every subject.',
      });
    }
    if (value.endDate !== value.startDate) {
      context.addIssue({
        code: 'custom',
        path: ['endDate'],
        message: 'Chosen slots are of one day.',
      });
    }
  }
  if (value.subjectIds !== null) {
    const seen = new Set<string>();
    value.subjectIds.forEach((id, index) => {
      if (seen.has(id.toLowerCase())) {
        context.addIssue({
          code: 'custom',
          path: ['subjectIds', index],
          message: 'A subject is named once.',
        });
      }
      seen.add(id.toLowerCase());
    });
  }
}

/** The form of new exemptions (`edge/exemptions`, row 8: "One form creates one exemption per chosen student"). */
export const exemptionCreateSchema = z
  .strictObject({
    studentIds: z.array(z.uuid()).min(1).max(EXEMPTION_BATCH_MAX),
    ...exemptionFieldsShape,
    /** The late-entry choices; empty for the preview. */
    choices: choicesSchema,
  })
  .superRefine((value, context) => {
    checkFields(value, context);
    const seen = new Set<string>();
    value.studentIds.forEach((id, index) => {
      if (seen.has(id.toLowerCase())) {
        context.addIssue({
          code: 'custom',
          path: ['studentIds', index],
          message: 'A student is named once.',
        });
      }
      seen.add(id.toLowerCase());
    });
  });

export type ExemptionCreate = z.infer<typeof exemptionCreateSchema>;

/** An edit before the start (`edge/exemptions`, row 4: "Before the start date every field can be changed"). */
export const exemptionEditSchema = z
  .strictObject({
    ...exemptionFieldsShape,
    version: z.int().min(1),
    choices: choicesSchema,
  })
  .superRefine((value, context) => {
    checkFields(value, context);
  });

export type ExemptionEdit = z.infer<typeof exemptionEditSchema>;

/** A new end date, shorter or longer ("End" from a date; "the exemption must be longer"). */
export const exemptionEndSchema = z.strictObject({
  endDate: schoolDateSchema,
  version: z.int().min(1),
  choices: choicesSchema,
});

export type ExemptionEnd = z.infer<typeof exemptionEndSchema>;

/** "Void, entered in error" with a reason. */
export const exemptionVoidSchema = z.strictObject({
  reason: trimmed(EXEMPTION_VOID_REASON_MAX),
  version: z.int().min(1),
});

export type ExemptionVoid = z.infer<typeof exemptionVoidSchema>;

/** The preview of a void: the version read. */
export const exemptionVoidPreviewSchema = z.strictObject({ version: z.int().min(1) });

export type ExemptionVoidPreview = z.infer<typeof exemptionVoidPreviewSchema>;

/** The end of every live exemption of a batch, with the late-entry choices. */
export const exemptionBatchEndSchema = z.strictObject({
  endDate: schoolDateSchema,
  choices: choicesSchema,
});

export type ExemptionBatchEnd = z.infer<typeof exemptionBatchEndSchema>;

export const exemptionBatchVoidSchema = z.strictObject({
  reason: trimmed(EXEMPTION_VOID_REASON_MAX),
});

export type ExemptionBatchVoid = z.infer<typeof exemptionBatchVoidSchema>;

export const exemptionParamsSchema = z.object({ id: z.uuid() });

export type ExemptionParams = z.infer<typeof exemptionParamsSchema>;

export const exemptionBatchParamsSchema = z.object({ batchId: z.uuid() });

export type ExemptionBatchParams = z.infer<typeof exemptionBatchParamsSchema>;

export const exemptionDocumentQuerySchema = z.object({
  name: z.string().trim().min(1).max(EXEMPTION_FILE_NAME_MAX_LENGTH),
});

export type ExemptionDocumentQuery = z.infer<typeof exemptionDocumentQuerySchema>;

/** The filters of the Exemptions page (`07`, Problem cases: "class, kind, subject, in force, ending this week"). */
export const exemptionsQuerySchema = z.object({
  classId: z.uuid().optional(),
  kind: exemptionKindSchema.optional(),
  subjectId: z.uuid().optional(),
  studentId: z.uuid().optional(),
  batchId: z.uuid().optional(),
  state: z.enum(['in_force', 'ending_this_week', 'coming', 'ended', 'voided', 'all']).optional(),
});

export type ExemptionsQuery = z.infer<typeof exemptionsQuerySchema>;

const localizedSchema = z.strictObject({ uz: z.string(), ru: z.string(), en: z.string() });

export const exemptionStudentSchema = z.strictObject({
  id: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  paternalName: z.string().nullable(),
  /** The class on the start date, or on today when that is later, if any. */
  className: z.string().nullable(),
});

export type ExemptionStudent = z.infer<typeof exemptionStudentSchema>;

export const exemptionSchema = z.strictObject({
  id: z.uuid(),
  batchId: z.uuid(),
  student: exemptionStudentSchema,
  kind: exemptionKindSchema,
  /** Null for all subjects. */
  subjects: z.array(z.strictObject({ id: z.uuid(), name: localizedSchema })).nullable(),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  slots: exemptionSlotsSchema.nullable(),
  category: exemptionCategorySchema,
  document: z.strictObject({ name: z.string(), type: z.string() }).nullable(),
  grantedBy: accountNamedSchema,
  grantedAt: z.iso.datetime({ offset: true }),
  state: z.enum(['coming', 'in_force', 'ended', 'voided']),
  /** How the end was last set: by "End", a leaving or a branch move; null while unchanged. */
  endCause: z.enum(['end', 'leaving', 'branch_move']).nullable(),
  voided: z
    .strictObject({
      at: z.iso.datetime({ offset: true }),
      by: accountNamedSchema,
      cause: z.enum(['error', 'leaving', 'branch_move']),
      reason: z.string().nullable(),
    })
    .nullable(),
  /** From a confirmed branch-move offer. */
  movedFrom: z.boolean(),
  version: z.int().min(1),
});

export type Exemption = z.infer<typeof exemptionSchema>;

export const exemptionListSchema = z.strictObject({
  /** Today in the branch: the page's "ending this week" reads it, never the browser's clock. */
  today: schoolDateSchema,
  items: z.array(exemptionSchema),
  /** The rows found beyond the 500 listed. */
  more: z.int().min(0),
});

export type ExemptionList = z.infer<typeof exemptionListSchema>;

/** The detail of the reason, opened one exemption at a time; every opening is logged. */
export const exemptionReasonSchema = z.strictObject({
  id: z.uuid(),
  category: exemptionCategorySchema,
  detail: z.string(),
});

export type ExemptionReason = z.infer<typeof exemptionReasonSchema>;

/** A lesson of the late-entry preview. */
export const exemptionPreviewLessonSchema = z.strictObject({
  lessonId: z.uuid(),
  date: schoolDateSchema,
  start: clockTimeSchema,
  subject: localizedSchema,
  /** The attendance mark typed, if any (0 to 3). */
  mark: z.int().min(0).max(3).nullable(),
  /** How many numbers are typed for the student in the lesson. */
  numbers: z.int().min(0),
  /** Whether the lesson's edit period has ended. */
  locked: z.boolean(),
});

export type ExemptionPreviewLesson = z.infer<typeof exemptionPreviewLessonSchema>;

/**
 * What a change does to one student's held lessons (`07`, Problem cases, the
 * late entry; `edge/exemptions`, row 4: "Shortening into the past or voiding
 * shows the same preview as a late entry").
 */
export const exemptionPreviewStudentSchema = z.strictObject({
  studentId: z.uuid(),
  /** Absent, skipped and empty cells: they become exempt by themselves. */
  auto: z.array(exemptionPreviewLessonSchema),
  /** A "present" or "late" mark, or a number: a choice is needed. */
  choose: z.array(exemptionPreviewLessonSchema),
  /** Cells that open again: their earlier marks come back, an empty one opens as optional. */
  reopen: z.array(exemptionPreviewLessonSchema.extend({ givesBack: z.boolean() })),
  /**
   * An overlap with another exemption of the student; `exemption` is named only
   * when the reader's branch holds it, so the screen can offer to extend it.
   */
  overlap: z
    .strictObject({
      exemption: z
        .strictObject({
          id: z.uuid(),
          kind: exemptionKindSchema,
          startDate: schoolDateSchema,
          endDate: schoolDateSchema,
          version: z.int().min(1),
          started: z.boolean(),
        })
        .nullable(),
    })
    .nullable(),
});

export type ExemptionPreviewStudent = z.infer<typeof exemptionPreviewStudentSchema>;

export const exemptionPreviewSchema = z.strictObject({
  students: z.array(exemptionPreviewStudentSchema),
  /** The year's last day: the end of a full exemption. */
  yearEnd: schoolDateSchema,
});

export type ExemptionPreview = z.infer<typeof exemptionPreviewSchema>;

export const exemptionCreatedSchema = z.strictObject({
  batchId: z.uuid(),
  exemptions: z.array(exemptionSchema),
});

export type ExemptionCreated = z.infer<typeof exemptionCreatedSchema>;

export const exemptionBatchChangedSchema = z.strictObject({
  exemptions: z.array(exemptionSchema),
});

export type ExemptionBatchChanged = z.infer<typeof exemptionBatchChangedSchema>;

/**
 * A reason of absence a Tutor recorded with no exemption covering its date
 * (`edge/exemptions`, row 9; decision 16).
 */
export const exemptionAbsenceSchema = z.strictObject({
  student: exemptionStudentSchema,
  date: schoolDateSchema,
  category: z.enum(['illness', 'family', 'school_permitted']),
  note: z.string(),
});

export type ExemptionAbsence = z.infer<typeof exemptionAbsenceSchema>;

export const exemptionAbsencesSchema = z.strictObject({
  items: z.array(exemptionAbsenceSchema),
});

export type ExemptionAbsences = z.infer<typeof exemptionAbsencesSchema>;

/** An exemption offered by a branch move (decision 3). */
export const exemptionMoveOfferSchema = z.strictObject({
  id: z.uuid(),
  student: exemptionStudentSchema,
  fromBranch: z.string(),
  movedOn: schoolDateSchema,
  kind: exemptionKindSchema,
  subjects: z.array(z.strictObject({ id: z.uuid(), name: localizedSchema })).nullable(),
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  slots: exemptionSlotsSchema.nullable(),
  category: exemptionCategorySchema,
  // The detail is read through its logged route, and only while the offer waits (0125).
  hasDocument: z.boolean(),
  decision: z.enum(['confirm', 'drop']).nullable(),
  decidedAt: z.iso.datetime({ offset: true }).nullable(),
  exemptionId: z.uuid().nullable(),
});

export type ExemptionMoveOffer = z.infer<typeof exemptionMoveOfferSchema>;

export const exemptionMoveOffersSchema = z.strictObject({
  items: z.array(exemptionMoveOfferSchema),
});

export type ExemptionMoveOffers = z.infer<typeof exemptionMoveOffersSchema>;

export const exemptionMoveOfferParamsSchema = z.object({ id: z.uuid() });

export type ExemptionMoveOfferParams = z.infer<typeof exemptionMoveOfferParamsSchema>;

/** The confirm takes the late-entry choices of the copy from the move date. */
export const exemptionMoveConfirmSchema = z.strictObject({ choices: choicesSchema });

export type ExemptionMoveConfirm = z.infer<typeof exemptionMoveConfirmSchema>;

/** One student on the teaching home's cards (`edge/exemptions`: "exempt today", "back from exemption"). */
export const exemptionTodayStudentSchema = z.strictObject({
  student: exemptionStudentSchema,
  kind: exemptionKindSchema,
  startDate: schoolDateSchema,
  endDate: schoolDateSchema,
  slots: exemptionSlotsSchema.nullable(),
  /** For the class Tutor only (`edge/exemptions`: "The class Tutor also sees the category"). */
  category: exemptionCategorySchema.nullable(),
});

export type ExemptionTodayStudent = z.infer<typeof exemptionTodayStudentSchema>;

export const exemptionsTodaySchema = z.strictObject({
  date: schoolDateSchema,
  exemptToday: z.array(exemptionTodayStudentSchema),
  backToday: z.array(exemptionTodayStudentSchema),
});

export type ExemptionsToday = z.infer<typeof exemptionsTodaySchema>;
