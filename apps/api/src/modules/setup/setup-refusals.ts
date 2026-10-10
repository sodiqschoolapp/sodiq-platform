import { ApiException } from '../../http/api-exception.js';

const UNIQUE_VIOLATION = '23505';

/**
 * Runs a change whose name must be unique (a branch, a building, a floor, a
 * room). The unique index of the table is the guard, also for two requests at
 * the same moment: a violation becomes 409 `already_exists`. Nothing is
 * checked before the write, so the transaction that was refused leaves no row
 * and no audit entry.
 */
export async function refusingDuplicates<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if ((error as { code?: unknown }).code === UNIQUE_VIOLATION) {
      throw new ApiException('already_exists', 409);
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
