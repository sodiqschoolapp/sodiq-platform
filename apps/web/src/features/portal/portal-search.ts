import { portalGradesQuerySchema, schoolDateSchema } from '@sodiq/shared';

/** The week of a portal page in the address: a school date, or this week when left out. */
export const portalSearch = (search: Record<string, unknown>): { date?: string } => {
  const parsed = schoolDateSchema.safeParse(search.date);
  return parsed.success ? { date: parsed.data } : {};
};

/** The quarter of the Grades page in the address (task 11.3); the current quarter when left out. */
export const portalQuarterSearch = (search: Record<string, unknown>): { quarter?: string } => {
  const parsed = portalGradesQuerySchema.safeParse({ quarter: search.quarter });
  return parsed.success && parsed.data.quarter !== undefined
    ? { quarter: parsed.data.quarter }
    : {};
};
