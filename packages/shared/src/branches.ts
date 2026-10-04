import { z } from 'zod';

/** The id of a branch, as routes receive it and as the branch filter is given it. */
export const branchIdSchema = z.uuid();

export type BranchId = z.infer<typeof branchIdSchema>;
