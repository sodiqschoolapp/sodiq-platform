import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';
import { classGradeSchema } from './classes.js';
import { journalEntriesChoiceSchema } from './journal-entries.js';

/**
 * Class and group transfers (docs/spec/04-people.md, Movements;
 * edge/students-classes-groups; task 3.3a, pull request #95). "One action with
 * an effective date": `from` is the first day in the new class or group. A
 * move dated after today is scheduled and can be changed or cancelled until
 * its date; one that has begun can be undone while nothing cut what it wrote
 * (correction 2), with a reason.
 */

export const MOVE_KINDS = ['class', 'group'] as const;

export const moveKindSchema = z.enum(MOVE_KINDS);

export type MoveKind = z.infer<typeof moveKindSchema>;

/** `scheduled`: dated after today; `done`: begun; then cancelled or undone. */
export const MOVE_STATES = ['scheduled', 'done', 'cancelled', 'undone'] as const;

export const moveStateSchema = z.enum(MOVE_STATES);

export type MoveState = z.infer<typeof moveStateSchema>;

/** The reason of an undo; the database keeps the same bound (`student_moves_reason_check`, 0050). */
export const MOVE_REASON_MAX_LENGTH = 500;

const versionSchema = z.int().min(0);

const moveReasonSchema = z.string().trim().min(1).max(MOVE_REASON_MAX_LENGTH);

/**
 * A class transfer of one student (`04`: "class transfers are done by the
 * Academic Vice Principal"), with the state the person saw (`version`, edge:
 * "The second one gets \"student changed, reload\""). `confirmLanguage`
 * answers the question asked when the two classes differ in language (`05`,
 * Language of instruction: "Moving a student between an Uzbek class and a
 * Russian class asks for confirmation").
 */
export const classTransferSchema = z.strictObject({
  studentId: z.uuid(),
  version: versionSchema,
  toClassId: z.uuid(),
  from: schoolDateSchema,
  confirmLanguage: z.boolean().optional(),
  /** The entries of the old journals on or after `from`, voided with a reason (task 8.6). */
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type ClassTransfer = z.infer<typeof classTransferSchema>;

/** The change of a scheduled class transfer: another class or another date, in one step. */
export const classTransferChangeSchema = z.strictObject({
  version: versionSchema,
  toClassId: z.uuid(),
  from: schoolDateSchema,
  confirmLanguage: z.boolean().optional(),
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type ClassTransferChange = z.infer<typeof classTransferChangeSchema>;

export const classTransferCancelSchema = z.strictObject({ version: versionSchema });

export type ClassTransferCancel = z.infer<typeof classTransferCancelSchema>;

export const classTransferUndoSchema = z.strictObject({
  version: versionSchema,
  reason: moveReasonSchema,
});

export type ClassTransferUndo = z.infer<typeof classTransferUndoSchema>;

/**
 * A group transfer (`02`, Head Teacher: "Moves students between groups of
 * those subjects"): `memberId` names the group row the person saw, which must
 * still be the student's row of the subject on `from` (decision 6).
 */
export const groupTransferSchema = z.strictObject({
  studentId: z.uuid(),
  memberId: z.uuid(),
  toGroupId: z.uuid(),
  from: schoolDateSchema,
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type GroupTransfer = z.infer<typeof groupTransferSchema>;

export const groupTransferChangeSchema = z.strictObject({
  toGroupId: z.uuid(),
  from: schoolDateSchema,
  journalEntries: journalEntriesChoiceSchema.optional(),
});

export type GroupTransferChange = z.infer<typeof groupTransferChangeSchema>;

export const groupTransferCancelSchema = z.strictObject({});

export type GroupTransferCancel = z.infer<typeof groupTransferCancelSchema>;

export const groupTransferUndoSchema = z.strictObject({ reason: moveReasonSchema });

export type GroupTransferUndo = z.infer<typeof groupTransferUndoSchema>;

export const moveParamsSchema = z.object({ id: z.uuid() });

export type MoveParams = z.infer<typeof moveParamsSchema>;

/** A class as a move names it. */
export const moveClassSchema = z.object({
  id: z.uuid(),
  grade: classGradeSchema,
  name: z.string(),
});

export type MoveClass = z.infer<typeof moveClassSchema>;

/** A group as a move names it. */
export const moveGroupSchema = z.object({ id: z.uuid(), name: z.string() });

export type MoveGroup = z.infer<typeof moveGroupSchema>;

/** One move of a student, as the record and the History tab show it. */
export const studentMoveSchema = z.object({
  id: z.uuid(),
  kind: moveKindSchema,
  /** The first day in the new class or group. */
  from: schoolDateSchema,
  /** The subject of a group move; `null` for a class move. */
  subjectId: z.uuid().nullable(),
  fromClass: moveClassSchema.nullable(),
  toClass: moveClassSchema.nullable(),
  fromGroup: moveGroupSchema.nullable(),
  toGroup: moveGroupSchema.nullable(),
  state: moveStateSchema,
  /** Cancelled by a leaving dated on or before it (decision 8). */
  cancelledByLeaving: z.boolean(),
  /**
   * The undo is open: begun, nothing cut what it wrote since, in an open year
   * (decision 10 with correction 2). Whether this reader may run it is
   * `canMoveClass` or `groupMoveSubjects` of the record.
   */
  undoable: z.boolean(),
});

export type StudentMove = z.infer<typeof studentMoveSchema>;
