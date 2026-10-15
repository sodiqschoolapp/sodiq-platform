// The timetable rule engine, used by the API, the grid and to re-check the solver's output.
// Task 1.5 adds the times of a day and the template of a class on a date, task
// 1.4 the calendar (what a grade has on a date), task 3.4a the rules of one
// teaching load row; the
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
  specialDateFor,
  templateFor,
  weekdayOf,
  type DatedRow,
  type SpecialDateTemplate,
  type TemplateAssignment,
  type TemplateLevel,
  type TemplateSettings,
} from './templates.js';
export {
  sharedLessonSlots,
  twoGradeSlots,
  type SharedSlot,
  type TwoGradeDay,
} from './two-grades.js';
export {
  LOAD_PROBLEM_ORDER,
  loadRowProblems,
  ROOM_PROBLEMS,
  takesAsTutor,
  TEACHER_PROBLEMS,
  teacherProblems,
  type LoadProblem,
  type LoadRowFacts,
  type LoadSubject,
  type LoadTeacher,
  type LoadUnit,
} from './load.js';
