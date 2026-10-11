// The timetable rule engine, used by the API, the grid and to re-check the solver's output.
// Task 1.5 adds the times of a day and the template of a class on a date, task
// 1.4 the calendar (what a grade has on a date); the
// placement rules arrive in task 5.2.
export {
  dayEndsAfterMidnight,
  dayTimes,
  lessonSlotProblem,
  lessonTimeProblem,
  MINUTES_PER_DAY,
  type Day,
  type DaySlot,
  type DaySlotInput,
  type SlotKind,
} from './day.js';
export {
  dayOn,
  entryCovers,
  isSchoolDay,
  type CalendarEntry,
  type CalendarEntryKind,
  type CalendarSettings,
  type DayResult,
  type ExamWeek,
} from './calendar.js';
export {
  inForceOn,
  isInForceOn,
  templateFor,
  weekdayOf,
  type DatedRow,
  type SpecialDateTemplate,
  type TemplateAssignment,
  type TemplateLevel,
  type TemplateSettings,
} from './templates.js';
