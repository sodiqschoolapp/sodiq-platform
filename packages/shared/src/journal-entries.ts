import { z } from 'zod';
import { schoolDateSchema } from './academic-year.js';

/**
 * Journal entries met by a move, a return, a leaving or a merge (task 8.6,
 * pull request #224; `edge/students-classes-groups`: "Entries in the old
 * journals on or after the date are listed; he either moves the date past
 * them or voids them with a reason. They are never copied"; the 1 October
 * row: "A 'present' mark or a real score after the date blocks the save until
 * someone checks it").
 *
 * The writer answers `journal_entries` with one detail per entry it met
 * (`journalEntry`). The person then moves the date past them, or sends the
 * entries seen with a reason in `journalEntries`; a list that changed since
 * answers `journal_entries` again with the detail `changed`.
 */

/** The reason of a void; the database keeps the same bound (`journal_voids_reason_text_check`, 0127). */
export const JOURNAL_VOID_REASON_MAX_LENGTH = 500;

/** At most this many entries are voided by one change. */
export const JOURNAL_ENTRIES_MAX = 2000;

export const JOURNAL_ENTRY_KINDS = ['cell', 'comment', 'rating'] as const;

export const journalEntryKindSchema = z.enum(JOURNAL_ENTRY_KINDS);

export type JournalEntryKind = z.infer<typeof journalEntryKindSchema>;

/** The reason of a void, as a form asks it. */
export const journalVoidReasonSchema = z.strictObject({
  reason: z.string().trim().min(1).max(JOURNAL_VOID_REASON_MAX_LENGTH),
});

/** The entries seen, each by its id and version, and the reason of their void. */
export const journalEntriesChoiceSchema = z.strictObject({
  reason: z.string().trim().min(1).max(JOURNAL_VOID_REASON_MAX_LENGTH),
  seen: z
    .array(z.strictObject({ id: z.uuid(), version: z.int().min(1) }))
    .min(1)
    .max(JOURNAL_ENTRIES_MAX)
    .refine((seen) => new Set(seen.map((one) => one.id.toLowerCase())).size === seen.length, {
      message: 'Each entry once.',
    }),
});

export type JournalEntriesChoice = z.infer<typeof journalEntriesChoiceSchema>;

const localTextSchema = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

/**
 * One entry, as the detail `journalEntry` of a `journal_entries`,
 * `move_has_entries`, `student_merge_journal_overlap` or
 * `student_merge_journal_cut` names it. `recordId` of the detail is the entry.
 * `voidable`: the change can void it with a reason; a move dated today cannot
 * (edge: "'Today' is allowed only if the student has no entries today"), and
 * the form offers the next day.
 */
export const journalEntryDetailSchema = z.object({
  kind: journalEntryKindSchema,
  version: z.int().min(1),
  date: schoolDateSchema,
  /** The journal, `null` for a lesson no journal holds yet. */
  journalId: z.uuid().nullable(),
  unitName: z.string(),
  subject: localTextSchema,
  /** The attendance mark (0 to 3), when the entry is one. */
  mark: z.int().min(0).max(3).nullable(),
  /** The number of a work, or the rating score. */
  score: z.int().min(0).nullable(),
  /** A rating entry's "did not sit". */
  didNotSit: z.boolean(),
  voidable: z.boolean(),
});

export type JournalEntryDetail = z.infer<typeof journalEntryDetailSchema>;

/** A journal that also holds the student's figures of the quarter, on the grid (07, Transfers). */
export const carriedInSchema = z.object({
  journalId: z.uuid(),
  unitName: z.string(),
  from: schoolDateSchema,
  until: schoolDateSchema,
});

export type CarriedIn = z.infer<typeof carriedInSchema>;
