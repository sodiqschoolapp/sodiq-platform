import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { classGradeSchema } from './classes.js';
import { moveClassSchema } from './moves.js';
import { journalEntriesChoiceSchema } from './journal-entries.js';

/**
 * The move of a student to another branch (`edge/students-classes-groups`,
 * "A student moves to another branch": "The sending Academic Vice Principal
 * releases the student and the receiving one accepts, choosing class and
 * groups; the Super Admin can do both. The record, UID, relatives and history
 * stay the same and are readable in the new branch"; task 3.3c, pull request
 * #97). `from` is the first day in the new branch; the release is accepted
 * from that day on (decision 6), declined with a reason, or cancelled by the
 * sending branch while open.
 */

/** `open` until cancelled (by the sending branch or a leaving), declined or accepted. */
export const BRANCH_MOVE_STATES = ['open', 'cancelled', 'declined', 'accepted'] as const;

export const branchMoveStateSchema = z.enum(BRANCH_MOVE_STATES);

export type BranchMoveState = z.infer<typeof branchMoveStateSchema>;

/** The reason of a decline; the database keeps the same bound (`student_branch_moves_reason_check`, 0053). */
export const BRANCH_MOVE_REASON_MAX_LENGTH = 500;

/**
 * The release of a student of the branch of the request to another branch,
 * with the state the person saw (`version`, edge: "The second one gets
 * \"student changed, reload\"").
 */
export const branchMoveReleaseSchema = z.strictObject({
  toBranchId: z.uuid(),
  from: schoolDateSchema,
  version: z.int().min(0),
});

export type BranchMoveRelease = z.infer<typeof branchMoveReleaseSchema>;

export const branchMoveCancelSchema = z.strictObject({});

export type BranchMoveCancel = z.infer<typeof branchMoveCancelSchema>;

/**
 * The accept (decision 13): the class of the receiving branch and, for a
 * split or group subject of it, the group chosen; a subject left out gets the
 * smallest suitable group, tagged "placed automatically, review".
 * `confirmLanguage` answers the question asked when the class left and the
 * class chosen differ in language (decision 15).
 */
export const branchMoveAcceptSchema = z.strictObject({
  classId: z.uuid(),
  groups: z
    .array(z.strictObject({ subjectId: z.uuid(), groupId: z.uuid() }))
    .max(50)
    .refine(
      (groups) =>
        new Set(groups.map((group) => group.subjectId.toLowerCase())).size === groups.length,
      { message: 'One group per subject.' },
    ),
  confirmLanguage: z.boolean().optional(),
  /** The entries of the sending branch's journals on or after the date, voided with a reason (task 8.6). */
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type BranchMoveAccept = z.infer<typeof branchMoveAcceptSchema>;

export const branchMoveDeclineSchema = z.strictObject({
  reason: z.string().trim().min(1).max(BRANCH_MOVE_REASON_MAX_LENGTH),
});

export type BranchMoveDecline = z.infer<typeof branchMoveDeclineSchema>;

export const branchMoveParamsSchema = z.object({ id: z.uuid() });

export type BranchMoveParams = z.infer<typeof branchMoveParamsSchema>;

export const branchMoveGroupsQuerySchema = z.object({ classId: z.uuid() });

export type BranchMoveGroupsQuery = z.infer<typeof branchMoveGroupsQuerySchema>;

/** A branch as a move names it. */
export const moveBranchSchema = z.object({ id: z.uuid(), name: z.string() });

export type MoveBranch = z.infer<typeof moveBranchSchema>;

/** The branches a student of the branch of the request may be released to: every other branch, by name. */
export const branchMoveTargetsSchema = z.object({ branches: z.array(moveBranchSchema) });

export type BranchMoveTargets = z.infer<typeof branchMoveTargetsSchema>;

/**
 * One release to the branch of the request, as its incoming list shows it
 * (decision 2): the UID, the name and the grade of the student, nothing else
 * of the record until the accept.
 */
export const incomingBranchMoveSchema = z.object({
  id: z.uuid(),
  studentId: z.uuid(),
  uid: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  grade: classGradeSchema,
  fromBranch: moveBranchSchema,
  from: schoolDateSchema,
  /** The accept is open: today in the receiving branch is on or after `from` (decision 6). */
  acceptable: z.boolean(),
});

export type IncomingBranchMove = z.infer<typeof incomingBranchMoveSchema>;

export const incomingBranchMovesSchema = z.object({
  moves: z.array(incomingBranchMoveSchema),
  /** Accept and decline: `branch_moves` `edit`. */
  canDecide: z.boolean(),
  today: schoolDateSchema,
});

export type IncomingBranchMoves = z.infer<typeof incomingBranchMovesSchema>;

/** A group the accept may choose for a subject, with its free seats from the date. */
export const branchMoveGroupOptionSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  freeSeats: z.int(),
});

/** The groups offered to the accept: per split or group subject of the class, the groups and the one the placement would choose. */
export const branchMoveGroupsSchema = z.object({
  subjects: z.array(
    z.object({
      subjectId: z.uuid(),
      groups: z.array(branchMoveGroupOptionSchema),
      /** The smallest suitable group; `null` when none has a seat. */
      suggested: z.uuid().nullable(),
    }),
  ),
  /** The fewest free seats of the class from the date on. */
  freeSeats: z.int(),
});

export type BranchMoveGroups = z.infer<typeof branchMoveGroupsSchema>;

/** A release of the student, as the record shows it while it is open. */
export const studentBranchMoveSchema = z.object({
  id: z.uuid(),
  fromBranch: moveBranchSchema,
  toBranch: moveBranchSchema,
  from: schoolDateSchema,
  state: branchMoveStateSchema,
  /** Cancelled by a leaving (decision 10). */
  cancelledByLeaving: z.boolean(),
});

export type StudentBranchMove = z.infer<typeof studentBranchMoveSchema>;

/** The History line of a release, with the class it joined once accepted. */
export const branchMoveLineSchema = z.object({
  kind: z.literal('branch_move'),
  move: studentBranchMoveSchema,
  toClass: moveClassSchema.nullable(),
});

export type BranchMoveLine = z.infer<typeof branchMoveLineSchema>;
