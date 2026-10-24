import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { relationshipSchema } from './relatives.js';
import { journalEntriesChoiceSchema } from './journal-entries.js';
import {
  scholarshipCoverageSchema,
  scholarshipTypeSchema,
  studentDetailSchema,
  studentGradeSchema,
  studentStatusSchema,
  studentUidSchema,
} from './students.js';

/**
 * The merge of two student records (`edge/students-classes-groups`, "A
 * student who left in 2025 is created again as new": "The Super Admin can
 * merge two records; the older UID survives"; "A student is created twice by
 * mistake ... 'leave' or the merge is used"; task 3.3d, pull request #98).
 * The record of the path and the record of the UID typed are joined into the
 * one whose first UID was held first (decision 3); the other is removed and
 * archived on the merge (decision 1). No undo (decision 13).
 */

/** The reason of a merge; the database keeps the same bound (`student_merges_reason_check`, 0054). */
export const STUDENT_MERGE_REASON_MAX_LENGTH = 500;

/** The preview names the other record by its UID, of any branch (decision 16). */
export const studentMergeQuerySchema = z.object({ uid: studentUidSchema });

export type StudentMergeQuery = z.infer<typeof studentMergeQuerySchema>;

/**
 * The merge, with the digest of the preview the person saw (edge: "The
 * second one gets 'student changed, reload'"; correction 3).
 */
export const studentMergeSchema = z.strictObject({
  uid: studentUidSchema,
  reason: z.string().trim().min(1).max(STUDENT_MERGE_REASON_MAX_LENGTH),
  digest: z.string().regex(/^[0-9a-f]{64}$/),
  /** The merged record's entries on the days the merge cuts, voided with a reason (task 8.6). */
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type StudentMerge = z.infer<typeof studentMergeSchema>;

/** A branch as the merge names it. */
export const mergeBranchSchema = z.object({ id: z.uuid(), name: z.string() });

/** One record of the pair as the preview shows it. */
export const studentMergeSideSchema = z.object({
  id: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  grade: studentGradeSchema,
  branch: mergeBranchSchema,
  /** The status today in the record's branch, as the list shows it (active before the start date); `null` without a status row. */
  status: studentStatusSchema.nullable(),
  /** The start date and today in the record's branch: "From <date>" before the start (issue #105, H13). */
  startsOn: schoolDateSchema,
  today: schoolDateSchema,
  /** The class in force today, by grade and name; `null` when none. */
  class: z.object({ grade: studentGradeSchema, name: z.string() }).nullable(),
});

export type StudentMergeSide = z.infer<typeof studentMergeSideSchema>;

/** One stretch of the joined life and the record whose row holds it (decision 4). */
export const studentMergeLifeSchema = z.object({
  status: studentStatusSchema,
  from: schoolDateSchema,
  until: schoolDateSchema.nullable(),
  side: z.enum(['kept', 'merged']),
});

/**
 * A row of either record that the merge changes: cut at its tail (`cutAt`,
 * the first day it loses) or left behind whole on the merge; a row carried
 * whole is only counted.
 */
export const studentMergeRowSchema = z.object({
  kind: z.enum(['status', 'class', 'group']),
  side: z.enum(['kept', 'merged']),
  action: z.enum(['cut', 'left']),
  /** The status, or the class or group by name. */
  name: z.string(),
  from: schoolDateSchema,
  until: schoolDateSchema.nullable(),
  cutAt: schoolDateSchema.nullable(),
});

export type StudentMergeRow = z.infer<typeof studentMergeRowSchema>;

/** A scholarship as a merge preview shows it (task 3.5b, H29). */
export const mergeScholarshipSchema = z.object({
  type: scholarshipTypeSchema,
  coverage: scholarshipCoverageSchema.nullable(),
  amount: z.int().nullable(),
});

/** The personal fields the merge compares (decision 7). */
export const STUDENT_MERGE_FIELDS = [
  'firstName',
  'lastName',
  'paternalName',
  'sex',
  'birthDate',
  'document',
  'jshshir',
  'phone',
  'email',
  'address',
  'region',
  'previousSchool',
  'diagnosticScore',
  'consentSignedOn',
] as const;

export const studentMergeFieldSchema = z.enum(STUDENT_MERGE_FIELDS);

export type StudentMergeField = z.infer<typeof studentMergeFieldSchema>;

/**
 * The preview (decisions 4, 7 and 12, corrections 1 and 3): the record that
 * stays and the one merged into it, the branch the kept record will be of,
 * the joined life, the rows cut or left behind, the fields filled from the
 * merged record, the values that differ (kept as the kept record's), the
 * number of rows carried whole, and the digest the merge sends back; or the
 * refusal the merge would give.
 */
export const studentMergePreviewSchema = z.object({
  kept: studentMergeSideSchema,
  merged: studentMergeSideSchema,
  /** The kept record's branch after the merge: the later life's (decision 7, correction 1). */
  branch: mergeBranchSchema,
  life: z.array(studentMergeLifeSchema),
  rows: z.array(studentMergeRowSchema),
  carried: z.int().min(0),
  filled: z.array(studentMergeFieldSchema),
  differing: z.array(
    z.object({
      field: studentMergeFieldSchema,
      kept: z.string(),
      merged: z.string(),
    }),
  ),
  /**
   * What the merge does with the values beside the personal fields (task
   * 3.5b, H29 of issue #105), each of both records and the one kept: the
   * start date (the first day of the joined life), the grade and the
   * scholarship (the later life's record, `later`), the contracts (all kept,
   * a dated list) and the relatives (each one's link: kept, added to the
   * record that stays, or already linked to it).
   */
  values: z.object({
    later: z.enum(['kept', 'merged']),
    startsOn: z.object({
      kept: schoolDateSchema,
      merged: schoolDateSchema,
      result: schoolDateSchema.nullable(),
    }),
    grade: z.object({ kept: studentGradeSchema, merged: studentGradeSchema }),
    scholarship: z.object({ kept: mergeScholarshipSchema, merged: mergeScholarshipSchema }),
    contracts: z.array(
      z.object({
        side: z.enum(['kept', 'merged']),
        number: z.string(),
        signedOn: schoolDateSchema,
      }),
    ),
    relatives: z.array(
      z.object({
        side: z.enum(['kept', 'merged']),
        fullName: z.string(),
        relationship: relationshipSchema,
        fate: z.enum(['stays', 'added', 'already_linked']),
      }),
    ),
  }),
  refusal: z.object({ code: z.string(), day: schoolDateSchema.nullable() }).nullable(),
  digest: z.string(),
});

export type StudentMergePreview = z.infer<typeof studentMergePreviewSchema>;

/**
 * The answer of a merge (correction 1): the kept record, and its branch,
 * which may no longer be the branch of the request.
 */
export const studentMergeResultSchema = z.object({
  student: studentDetailSchema,
  branch: mergeBranchSchema,
});

export type StudentMergeResult = z.infer<typeof studentMergeResultSchema>;
