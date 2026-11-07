import { portalGradesQuerySchema, schoolDateSchema } from '@sodiq/shared';

/** The week of a portal page in the address: a school date, or this week when left out. */
export const portalSearch = (search: Record<string, unknown>): { date?: string } => {
  const parsed = schoolDateSchema.safeParse(search.date);
  return parsed.success ? { date: parsed.data } : {};
};

/** The quarter of the Grades page in the address (task 11.3); the current quarter when left out. */
/**
 * Task 11.7: the page of the portal the bot's button names (`?to=announcements`, plan of #306);
 * anything else is dropped.
 */
export const portalTargetSearch = (
  search: Record<string, unknown>,
): { to?: 'announcements'; child?: string } =>
  search.to === 'announcements'
    ? {
        to: 'announcements',
        ...(typeof search.child === 'string' && /^[0-9a-f-]{36}$/i.test(search.child)
          ? { child: search.child }
          : {}),
      }
    : {};

export const portalQuarterSearch = (search: Record<string, unknown>): { quarter?: string } => {
  const parsed = portalGradesQuerySchema.safeParse({ quarter: search.quarter });
  return parsed.success && parsed.data.quarter !== undefined
    ? { quarter: parsed.data.quarter }
    : {};
};
