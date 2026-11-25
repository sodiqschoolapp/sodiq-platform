import type { AssistantRouteLine } from '../../access/assistant-routes.js';
import { JOURNAL_LINES } from './journal.js';
import { PEOPLE_LINES } from './people.js';
import { PLANS_LINES } from './plans.js';
import { SETUP_LINES } from './setup.js';
import { TIMETABLE_LINES } from './timetable.js';

/**
 * Task 11.20: the lines of the routes that no list held before (`ROUTE_LINES` of
 * `access/assistant-routes.ts` merges them with those of 11.12 to 11.14), one file per group of
 * API modules, by route name. Each line has its description for the model; a change says what
 * it is proposed on (`AssistantChangeLine`), as the lines of 11.13 do.
 */
export const NEW_ROUTE_LINES: Readonly<Record<string, AssistantRouteLine>> = {
  ...SETUP_LINES,
  ...PEOPLE_LINES,
  ...PLANS_LINES,
  ...TIMETABLE_LINES,
  ...JOURNAL_LINES,
};
