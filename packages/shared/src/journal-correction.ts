import { z } from 'zod';

/**
 * A correction of the journal (task 8.4, pull request #222; `edge/journal`,
 * Locks, unlocks and corrections: "The Academic Vice Principal corrects a
 * mark ... needs a reason ... No unlock is needed"). Sent with a single save
 * (a cell save, a work's total, "not held", add or remove, a comment) by the
 * Academic Vice Principal of the branch or the Super Admin; bulk actions take
 * none (decision 9). A rating entry's correction carries its own reason
 * (review correction 2).
 */
export const CORRECTION_REASON_MAX_LENGTH = 500;

export const correctionSchema = z.strictObject({
  reason: z.string().trim().min(1).max(CORRECTION_REASON_MAX_LENGTH),
});

export type Correction = z.infer<typeof correctionSchema>;

/** How a stored value came, as a cell shows it: typed after the edit period under an unlock, or corrected. */
export const CELL_MARKERS = ['late', 'correction'] as const;

export const cellMarkerSchema = z
  .object({
    kind: z.enum(CELL_MARKERS),
    /** The approver of the unlock (`late`), or the corrector (`correction`). */
    by: z.string().nullable(),
  })
  .nullable();

export type CellMarker = z.infer<typeof cellMarkerSchema>;

/**
 * The edit period of a lesson or a rating exam for the reader (task 8.4;
 * `07`, Editing rules and locks): its lock moment, the reader's window, an
 * open unlock, a waiting request, and whether the reader corrects.
 */
export const editLockSchema = z.object({
  /** 00:00 of the branch day after the last day of the edit period; `null` for a rating exam with no date. */
  locksAt: z.iso.datetime({ offset: true }).nullable(),
  window: z.enum(['open', 'unlocked', 'locked']),
  unlockedUntil: z.iso.datetime({ offset: true }).nullable(),
  unlockedBy: z.string().nullable(),
  /** The reader's waiting unlock request. */
  request: z.object({ id: z.uuid(), version: z.int().min(1) }).nullable(),
  /** The reader may send an unlock request: theirs to enter, locked, none waiting. */
  canRequest: z.boolean(),
  /** The reader corrects with a reason (`edge/journal`: "No unlock is needed"). */
  canCorrect: z.boolean(),
});

export type EditLock = z.infer<typeof editLockSchema>;
