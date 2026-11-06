import { schoolDateSchema } from '@sodiq/shared';

/** The week of a portal page in the address: a school date, or this week when left out. */
export const portalSearch = (search: Record<string, unknown>): { date?: string } => {
  const parsed = schoolDateSchema.safeParse(search.date);
  return parsed.success ? { date: parsed.data } : {};
};
