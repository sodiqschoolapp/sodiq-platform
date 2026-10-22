import { z } from 'zod';

/**
 * What a lesson that holds data holds (task 6.1b-2, decision 2;
 * edge/timetable, After publishing: "A lesson that already has attendance
 * must be cancelled. Only the Academic Vice Principal, with a reason and a
 * list of what is affected."): the attendance marks, the numbers, the works
 * with a total and the works marked "not held" of its journal column
 * (edge/00-definitions, Data on a lesson; comments join with 8.2).
 */
export const heldDataSchema = z.object({
  attendance: z.int().min(0),
  scores: z.int().min(0),
  totals: z.int().min(0),
  notHeld: z.int().min(0),
});

export type HeldData = z.infer<typeof heldDataSchema>;
