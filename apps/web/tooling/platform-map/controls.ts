import type { Action } from '@sodiq/shared';

/**
 * A control shown only to a role whose check the walk cannot read from the code (a check
 * through props or a hook of another file), by node id, with the area and action that decide
 * it; the test checks that the area is in the permission table.
 */
export const SHOWN_WITH: Readonly<Record<string, { area: string; action: Action }>> = {};

/** The API operation a control calls, by node id, where the map names one. */
export const CALLS: Readonly<Record<string, string>> = {};
