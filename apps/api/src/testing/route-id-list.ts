import type { RouteIds } from './route-id-check.js';
import { CLASSES_IDS } from './route-ids/classes.js';
import { EXEMPTIONS_IDS } from './route-ids/exemptions.js';
import { JOURNAL_IDS } from './route-ids/journal.js';
import { OTHER_IDS } from './route-ids/other.js';
import { PEOPLE_IDS } from './route-ids/people.js';
import { PLANS_IDS } from './route-ids/plans.js';
import { RESULTS_IDS } from './route-ids/results.js';
import { SETUP_IDS } from './route-ids/setup.js';
import { TIMETABLE_IDS } from './route-ids/timetable.js';

/**
 * For every id a route takes, in its path, its query or its body, the record
 * it names and the tests that send another branch's id and an unknown one
 * (task 10.3b). Written by hand, like `ROUTE_SCOPE`, one file per module
 * (`route-ids/`; the groups are with the classes, and the small modules in
 * `other.ts`), and read by `route-ids.test.ts` and the checklist.
 */
export const ROUTE_IDS: RouteIds = {
  ...SETUP_IDS,
  ...PEOPLE_IDS,
  ...CLASSES_IDS,
  ...TIMETABLE_IDS,
  ...JOURNAL_IDS,
  ...EXEMPTIONS_IDS,
  ...PLANS_IDS,
  ...RESULTS_IDS,
  ...OTHER_IDS,
};
