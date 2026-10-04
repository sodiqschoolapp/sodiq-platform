import { z } from 'zod';

/** The id of a branch, as routes receive it and as the branch filter is given it. */
export const branchIdSchema = z.uuid();

export type BranchId = z.infer<typeof branchIdSchema>;

/**
 * The header in which a request names the one branch it is for (edge cases,
 * "Who can act": "every request is checked against one branch"). The web app
 * sends the branch of the branch switcher of its tab.
 */
export const BRANCH_HEADER = 'X-Branch-Id';
