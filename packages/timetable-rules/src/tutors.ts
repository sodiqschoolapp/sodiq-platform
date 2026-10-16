/**
 * The Tutor of a class at a moment (edge-cases/timetable.md, Structure, "The
 * Homework slot and Ma'naviyat soati": "Their teacher is always the class's
 * Tutor in force on the lesson's date (the acting Tutor while one is set)";
 * task 3.6c-2, pull request #125, decision 3).
 *
 * One reading for every caller: a dated lesson asks at its start; a version
 * asks at the last moment of the later of its start date and today in branch
 * time. The database reads the same in `class_tutor_on` (db/migrations/0067).
 */

/** A row of `class_tutors` as the reading needs it; ranges are half-open. */
export interface TutorRow {
  readonly staffId: string;
  readonly kind: 'tutor' | 'acting';
  readonly validFrom: Date;
  /** `null`: open. */
  readonly validUntil: Date | null;
}

const inForce = (row: TutorRow, moment: Date) =>
  row.validFrom.getTime() <= moment.getTime() &&
  (row.validUntil === null || moment.getTime() < row.validUntil.getTime());

/**
 * The staff record of the acting Tutor in force at the moment, else of the
 * Tutor, else `null`. The database allows one row of each kind at a moment.
 */
export function tutorAt(rows: readonly TutorRow[], moment: Date): string | null {
  const acting = rows.find((row) => row.kind === 'acting' && inForce(row, moment));
  if (acting !== undefined) {
    return acting.staffId;
  }
  return rows.find((row) => row.kind === 'tutor' && inForce(row, moment))?.staffId ?? null;
}
