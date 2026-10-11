import type { ErrorCode, ErrorDetail } from '@sodiq/shared';
import { ApiException } from '../../http/api-exception.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Runs a change whose name must be unique (a branch, a building, a floor, a
 * room, a division, a department). The unique index of the table is the
 * guard, also for two requests at the same moment: a violation becomes 409
 * `already_exists`. Nothing is checked before the write, so the transaction
 * that was refused leaves no row and no audit entry.
 *
 * `fields` names the path of the field each unique index covers, for a record
 * with several names (`12`, Look and feel: "Error messages say what happened
 * and what to do next"): the answer then says which one is taken in `details`.
 */
export async function refusingDuplicates<T>(
  work: () => Promise<T>,
  fields: Readonly<Record<string, string>> = {},
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    if (failure.code === UNIQUE_VIOLATION) {
      const path = typeof failure.constraint === 'string' ? fields[failure.constraint] : undefined;
      const details: ErrorDetail[] | undefined =
        path === undefined
          ? undefined
          : [{ path, code: 'already_exists', message: 'A record of this name already exists.' }];
      throw new ApiException('already_exists', 409, undefined, details);
    }
    throw error;
  }
}

/** The record named in the path is not in the branch of the request, or does not exist. */
export const notFound = (): ApiException => new ApiException('not_found', 404);

/** The fields of a record that differ between two states, for the audit entry: old and new. */
export function changesOf<T extends Record<string, unknown>>(
  before: T,
  after: T,
): { oldValue: Partial<T>; newValue: Partial<T> } | null {
  const oldValue: Partial<T> = {};
  const newValue: Partial<T> = {};
  let changed = false;
  for (const key of Object.keys(after) as (keyof T)[]) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      oldValue[key] = before[key];
      newValue[key] = after[key];
      changed = true;
    }
  }
  return changed ? { oldValue, newValue } : null;
}

const EXCLUSION_VIOLATION = '23P01';
const CHECK_VIOLATION = '23514';

/**
 * The refusals of the database for academic years and quarters
 * (db/migrations/0016) and for day templates (0017), by the name of the constraint, index or trigger
 * check that raised them. The service checks the same rules first, for an
 * answer that names the field; these answer when two requests race past the
 * service's checks, or at the commit of a deferred check.
 */
export const CONSTRAINT_REFUSALS: Readonly<Record<string, ErrorCode>> = {
  academic_years_one_current_idx: 'current_year_exists',
  academic_years_no_overlap: 'dates_overlap',
  academic_years_closed: 'year_closed',
  // No route moves a status but "Start year" before task 9.5a; a fault answers the general refusal.
  academic_years_status_order: 'request_refused',
  academic_years_out_of_order: 'year_out_of_order',
  academic_years_earlier_open: 'earlier_year_not_closed',
  quarters_no_overlap: 'quarters_out_of_order',
  quarters_order: 'quarters_out_of_order',
  // Four quarters are written with their year; a fault answers the general refusal.
  academic_year_quarters_count: 'request_refused',
  quarters_outside_year: 'outside_year',
  // Day templates (task 1.5). The other constraints of 0017 guard against a
  // fault of the service, which checks first; they stay unmapped (500).
  day_template_assignments_no_overlap: 'grade_ranges_overlap',
  day_template_version_lesson_slot: 'no_lesson_slot',
};

/**
 * Runs a change whose rules the database guards with named constraints and
 * triggers, some of them deferred to the commit: wrap the whole
 * `transactions.run(...)` call, because a deferred check raises after the work
 * has returned. A refusal named in `CONSTRAINT_REFUSALS` becomes 409 with its
 * code; anything else is thrown again as it came.
 */
export async function refusingConstraints<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    const failure = error as { code?: unknown; constraint?: unknown };
    const refusal =
      (failure.code === UNIQUE_VIOLATION ||
        failure.code === EXCLUSION_VIOLATION ||
        failure.code === CHECK_VIOLATION) &&
      typeof failure.constraint === 'string' &&
      Object.hasOwn(CONSTRAINT_REFUSALS, failure.constraint)
        ? CONSTRAINT_REFUSALS[failure.constraint]
        : undefined;
    if (refusal !== undefined) {
      throw new ApiException(refusal, 409);
    }
    throw error;
  }
}
