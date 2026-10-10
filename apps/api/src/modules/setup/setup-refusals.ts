import type { ErrorDetail } from '@sodiq/shared';
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
