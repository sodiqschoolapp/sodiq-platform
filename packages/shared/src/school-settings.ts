import { z } from 'zod';
import { journalSubjectSchema, journalUnitSchema } from './journal.js';
import { gradeChangesSchema } from './results.js';
import { changeReasonSchema } from './subjects.js';

/**
 * The settings of the whole school (task 9.4f, pull request #276; `05`, Grading weights on a
 * subject, Grades 0–4: "A school setting 'Rating exams in grades 0–4', kept by the Super Admin,
 * off by default"). Read under `settings` view, changed under `school_settings` edit (the
 * Super Admin alone; the owner's answer A on the pull request).
 */

/** An open quarter whose state differs from the setting: a reopened quarter (decision 2). */
export const ratingStateQuarterSchema = z.object({
  branchId: z.uuid(),
  branchName: z.string(),
  quarterId: z.uuid(),
  number: z.int().min(1).max(4),
  ratingExamsPrimary: z.boolean(),
});

export type RatingStateQuarter = z.infer<typeof ratingStateQuarterSchema>;

/** `GET /api/setup/school-settings`. */
export const schoolSettingsSchema = z.object({
  /** "Rating exams in grades 0–4". */
  ratingExamsPrimary: z.boolean(),
  /** The open quarters, of the branches the reader may read, whose state differs from it. */
  differing: z.array(ratingStateQuarterSchema),
  /** The reader may change the setting (`school_settings` edit); the server decides it. */
  mayChange: z.boolean(),
});

export type SchoolSettings = z.infer<typeof schoolSettingsSchema>;

/** `POST …/rating-exams-primary/preview` and `PUT …/rating-exams-primary`. */
export const ratingExamsPrimaryChangeSchema = z.strictObject({
  on: z.boolean(),
  /** Always required on the change (decision 8); the preview may leave it out. */
  reason: changeReasonSchema.optional(),
});

export type RatingExamsPrimaryChange = z.infer<typeof ratingExamsPrimaryChangeSchema>;

/** A journal of grades 0–4 of an open quarter holding a rating exam entry (refuses a turn-off). */
export const ratingEntryRefusalSchema = z.object({
  branchId: z.uuid(),
  branchName: z.string(),
  quarterId: z.uuid(),
  number: z.int().min(1).max(4),
  journalId: z.uuid(),
  unit: journalUnitSchema,
  subject: journalSubjectSchema,
});

/** An active group of grades 4 and 5 of a rating subject (refuses a turn-off). */
export const ratingGroupRefusalSchema = z.object({
  branchId: z.uuid(),
  branchName: z.string(),
  groupId: z.uuid(),
  name: z.string(),
  subject: journalSubjectSchema,
});

/** A rating subject an off quarter would need the distribution without the rating exam for. */
export const ratingWeightsMissingSchema = z.object({
  branchId: z.uuid(),
  branchName: z.string(),
  quarterId: z.uuid(),
  number: z.int().min(1).max(4),
  subject: journalSubjectSchema,
});

/** The preview of a change, and the `details` of its refusal (`rating_primary_refused`). */
export const ratingExamsPrimaryPreviewSchema = z.object({
  /** The open quarters the change would set. */
  quarterCount: z.int().min(0),
  /** The grades that change, by branch (`compareGrades`, as the previews of 9.1). */
  branches: z.array(
    z.object({
      branchId: z.uuid(),
      branchName: z.string(),
      quarters: gradeChangesSchema.shape.quarters,
    }),
  ),
  /** What refuses a turn-off; both empty for a turn-on. */
  entries: z.array(ratingEntryRefusalSchema),
  groups: z.array(ratingGroupRefusalSchema),
  /** Subjects without the distribution without the rating exam where it would be needed. */
  weightsMissing: z.array(ratingWeightsMissingSchema),
});

export type RatingExamsPrimaryPreview = z.infer<typeof ratingExamsPrimaryPreviewSchema>;
