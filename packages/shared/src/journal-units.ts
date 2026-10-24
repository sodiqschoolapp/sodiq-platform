import { z } from 'zod';
import { subjectColourSchema } from './subjects.js';

/** The unit and subject of a journal (task 6.2), apart so that every journal file can name them. */

const subjectNames = z.object({ uz: z.string(), ru: z.string(), en: z.string() });

export const journalUnitSchema = z.object({
  kind: z.enum(['class', 'group']),
  id: z.uuid(),
  /** The class shown with its grade ("7 Oxford"), or the group's name. */
  name: z.string(),
});

export const journalSubjectSchema = z.object({
  id: z.uuid(),
  names: subjectNames,
  /** The subject colour, drawn as in the timetable (review correction 3). */
  colour: subjectColourSchema,
});
