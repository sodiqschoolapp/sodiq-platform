/**
 * Which stored distributions of a subject count (task 2.1, decisions 2, 3
 * and 14): a row counts only in the subject's current `weights_round`, and a
 * quarterly one also in its current `rating_round` with a rating exam part
 * exactly when the subject has the rating exam switch. The subjects list
 * (`quarterWeightsMissing`) and the publish check (task 5.5a-1, decision 10)
 * both read them here. A quarterly row is compared with the switches of its
 * quarter (`subject-switches.ts`; task 8.2, correction 1), not the subject's
 * current ones: a quarter that a later change does not reach keeps its rows.
 */
export interface SubjectRounds {
  readonly weights_round: number;
  readonly rating_round: number;
  readonly rating_exam: boolean;
}

/** A stored daily distribution that counts for the subject. */
export const dailyWeightsFit = (
  subject: SubjectRounds,
  stored: { readonly weights_round: number },
): boolean => stored.weights_round === subject.weights_round;

/** A stored quarterly distribution that counts for the subject. */
export const quarterWeightsFit = (
  subject: SubjectRounds,
  stored: {
    readonly weights_round: number;
    readonly rating_round: number;
    readonly rating_exam: number | null;
  },
): boolean =>
  stored.weights_round === subject.weights_round &&
  stored.rating_round === subject.rating_round &&
  (stored.rating_exam !== null) === subject.rating_exam;

/**
 * A stored distribution without the rating exam (task 9.4f, decision 7) that counts: the subject
 * has the rating exam in the quarter, and the row is of the quarter's rounds.
 */
export const primaryWeightsFit = (
  subject: SubjectRounds & { readonly journal_type?: string },
  stored: { readonly weights_round: number; readonly rating_round: number },
): boolean =>
  subject.journal_type !== 'attendance_only' &&
  subject.rating_exam &&
  stored.weights_round === subject.weights_round &&
  stored.rating_round === subject.rating_round;
