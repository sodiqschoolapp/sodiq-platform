import { COMMON_ACTIONS } from './common';
import { DESCRIPTIONS as ACCESS } from './access';
import { DESCRIPTIONS as ANNOUNCEMENTS } from './announcements';
import { DESCRIPTIONS as ASSISTANT } from './assistant';
import { DESCRIPTIONS as AUDIT } from './audit';
import { DESCRIPTIONS as AUTH } from './auth';
import { DESCRIPTIONS as CLASSES } from './classes';
import { DESCRIPTIONS as FEEDBACK } from './feedback';
import { DESCRIPTIONS as JOURNAL } from './journal';
import { DESCRIPTIONS as NOTIFICATIONS } from './notifications';
import { DESCRIPTIONS as PAGES } from './pages';
import { DESCRIPTIONS as PEOPLE } from './people';
import { DESCRIPTIONS as PLANS } from './plans';
import { DESCRIPTIONS as PORTAL } from './portal';
import { DESCRIPTIONS as RESULTS } from './results';
import { DESCRIPTIONS as SETUP } from './setup';
import { DESCRIPTIONS as SHARED } from './shared';
import { DESCRIPTIONS as TIMETABLE } from './timetable';

// Task 11.19 (build plan: "beside it a short description of each page and control, written
// once in English by this task and kept in the map's source, so a later task that adds a
// control fails the test until it describes it"). One file per feature; a page's id is
// `page:<path>`, a control's `<file>#<kind>:<label key>`.

const PARTS: ReadonlyArray<Readonly<Record<string, string>>> = [
  ACCESS,
  ANNOUNCEMENTS,
  ASSISTANT,
  AUDIT,
  AUTH,
  CLASSES,
  FEEDBACK,
  JOURNAL,
  NOTIFICATIONS,
  PAGES,
  PEOPLE,
  PLANS,
  PORTAL,
  RESULTS,
  SETUP,
  SHARED,
  TIMETABLE,
];

/** Every description by id; an id written twice is a fault of the source. */
export function allDescriptions(): { descriptions: Record<string, string>; twice: string[] } {
  const descriptions: Record<string, string> = {};
  const twice: string[] = [];
  for (const part of PARTS) {
    for (const [id, text] of Object.entries(part)) {
      if (Object.hasOwn(descriptions, id)) twice.push(id);
      descriptions[id] = text;
    }
  }
  return { descriptions, twice };
}

export { COMMON_ACTIONS };
