import type { CalendarLessons } from '@sodiq/shared';

/**
 * A preview of a change over dates with no published lesson: what a calendar
 * save (task 5.6b-1) and a template change (task 5.6b-4a) answer for the
 * dated lessons when nothing is written.
 */
export const NO_LESSONS: CalendarLessons = {
  removed: [],
  created: [],
  cancelled: [],
  needsTeacher: [],
  notified: [],
  blocked: [],
  dayChanges: { key: 'e'.repeat(64), kept: [], decide: [], dropped: [], bulk: [] },
  shortenedDays: [],
  keepRefusals: [],
  exams: [],
  groupBlocks: [],
  groupBlocksUnused: [],
  names: { units: [], subjects: [], teachers: [], rooms: [] },
};
